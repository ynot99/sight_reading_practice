import { ExerciseValidationError } from '../../shared/errors.js';
import { assertNever } from '../../shared/asserts.js';
import type { ClefKind } from './Clef.js';
import { Duration, ticksToMilliseconds } from './Duration.js';
import type { KeySignature } from './KeySignature.js';
import type { Pitch } from './Pitch.js';
import type { TimeSignature } from './TimeSignature.js';

export const STEM_DIRECTIONS = ['up', 'down'] as const;

export type StemDirection = (typeof STEM_DIRECTIONS)[number];

export const BEAM_TYPES = ['begin', 'continue', 'end', 'forward hook', 'backward hook'] as const;

export type BeamType = (typeof BEAM_TYPES)[number];

/**
 * One level of beaming on a note: eighths use level 1, sixteenths add level 2.
 *
 * Carried rather than computed. Beaming is a reading aid the writer chose -
 * two eighths beamed around a quarter say something different from six beamed
 * across the bar - and an importer that dropped it would be handing the engraver
 * a decision the composer had already made.
 */
export interface Beam {
  readonly level: number;
  readonly type: BeamType;
}

/** One or more simultaneous pitches sharing a rhythmic value. */
export interface NoteEntry {
  readonly kind: 'note';
  readonly pitches: readonly Pitch[];
  readonly duration: Duration;
  /**
   * MIDI numbers of this entry whose sound continues into the next one.
   *
   * A tie is not a second note: the key is struck once and held, which is why
   * this belongs to the *sounding* model rather than to the notation. The
   * timeline reads it and refuses to demand the note again, so a value held
   * across a bar line is one press, exactly as it is at the keyboard.
   *
   * Identified by MIDI number because a chord may never contain the same pitch
   * twice - {@link validateExercise} guarantees it - so the number names one
   * note of this entry without ambiguity, and only some of a chord's notes may
   * be tied.
   */
  readonly tiedForward: readonly number[];
  /** Beaming as the source wrote it; empty lets the engraver decide. */
  readonly beams: readonly Beam[];
  /**
   * Stem direction as the source wrote it, or `null` to let the engraver
   * choose by pitch.
   *
   * Two voices on a staff are told apart by their stems - one up, one down -
   * and which way round is the writer's decision, not a rule. Left to the
   * engraver, each note points wherever its own pitch suggests and the two
   * lines tangle.
   */
  readonly stem: StemDirection | null;
  /**
   * Whether the chord is rolled rather than struck together.
   *
   * A reading instruction as much as a sound: the squiggle tells the hand to
   * spread the chord, and a page that drops it asks for something the writer
   * did not.
   */
  readonly arpeggiated: boolean;
  /**
   * Hold this note longer than it is written.
   *
   * A reading instruction the writer chose, like the roll and the beams: how
   * much longer is the performer's, which is exactly why it has to be on the
   * page rather than turned into a number here.
   */
  readonly fermata: boolean;
  /**
   * Lift after this note - the comma over the staff.
   *
   * A breath, and the shortest of all the writer's instructions: it takes no
   * time from the bar and gives none to it, it only says that the line stops
   * here before it goes on.
   */
  readonly breath: boolean;
}

/** A drawn silence: the writer asked for this rest and the reader counts it. */
export interface RestEntry {
  readonly kind: 'rest';
  readonly duration: Duration;
}

/**
 * Time this voice is simply not there for, drawn as nothing at all.
 *
 * A rest is an instruction and a silence is an absence, and a page that
 * confuses them tells the reader to count something nobody wrote. Piano
 * writing leans on this constantly: an inner voice enters halfway through a
 * bar and leaves before the end of it, and what happens either side is not a
 * rest - the other voice on the staff is playing there, and the engraver
 * draws nothing.
 *
 * It still takes its time, so a bar goes on adding up, and it is written out
 * as MusicXML's `<forward>` - the same thing said in the format's own words.
 * Allowed only while some voice on the staff *is* drawing there; where none
 * is, the staff really does rest and one voice has to say so.
 */
export interface SilenceEntry {
  readonly kind: 'silence';
  readonly duration: Duration;
}

export type MusicalEntry = NoteEntry | RestEntry | SilenceEntry;

/** Whether an entry opens or closes the tuplet group it belongs to. */
export interface TupletPosition {
  readonly starts: boolean;
  readonly stops: boolean;
}

export interface Measure {
  readonly entries: readonly MusicalEntry[];
}

/**
 * One voice of one staff: its own clef, its own MusicXML voice and one entry
 * list per measure.
 *
 * Several parts may share a `staffNumber`. That is how real piano writing puts
 * an inner line under a melody on the same staff, and expressing it directly
 * beats flattening the two into one line - a held note under moving notes
 * stays a held note instead of becoming a chain of tied fragments.
 */
/** A clef the staff changes to, from the given measure onwards. */
export interface ClefChange {
  readonly measureIndex: number;
  readonly clef: ClefKind;
}

export interface StaffPart {
  readonly staffNumber: number;
  readonly voice: number;
  readonly clef: ClefKind;
  /**
   * Clefs the staff switches to partway through.
   *
   * A left hand climbing into the treble is written in the treble clef rather
   * than on five ledger lines, and that is a reading decision: the same notes
   * are far easier to take in. Empty for anything this program generates.
   */
  readonly clefChanges: readonly ClefChange[];
  readonly measures: readonly Measure[];
}

/** Absolute spans, in divisions, during which the damper pedal is down. */
export function pedalSpans(exercise: Exercise): readonly (readonly [number, number])[] {
  const bars = barLines(exercise);
  const spans: [number, number][] = [];
  let down: number | null = null;
  for (const mark of exercise.pedalMarks) {
    const at = (bars[mark.measureIndex]?.startTicks ?? 0) + mark.offsetTicks;
    if (mark.type === 'start') {
      down ??= at;
      continue;
    }
    if (down !== null) {
      spans.push([down, at]);
      down = null;
    }
  }
  if (down !== null) {
    // A pedal the writer never lifted holds to the last bar line.
    spans.push([down, exerciseTicks(exercise)]);
  }
  return spans;
}

/** The metre in force at a given measure. */
export function timeAtMeasure(exercise: Exercise, measureIndex: number): TimeSignature {
  let current = exercise.timeSignature;
  for (const change of exercise.timeChanges) {
    if (change.measureIndex <= measureIndex) {
      current = change.timeSignature;
    }
  }
  return current;
}

/**
 * Where every bar begins, in divisions, and what metre governs it.
 *
 * The one place that walks the bars. Every other answer about musical
 * position - how long the piece is, whether a bar is full, which bar a tick
 * falls in - is read off this, because once a metre can change partway
 * through, none of them can be had by multiplying any more.
 */
export function barLines(
  exercise: Exercise,
): readonly { readonly startTicks: number; readonly timeSignature: TimeSignature }[] {
  const bars: { startTicks: number; timeSignature: TimeSignature }[] = [];
  let startTicks = 0;
  for (let measureIndex = 0; measureIndex < measureCount(exercise); measureIndex += 1) {
    const timeSignature = timeAtMeasure(exercise, measureIndex);
    bars.push({ startTicks, timeSignature });
    startTicks += timeSignature.ticksPerMeasure;
  }
  return bars;
}

/** One stretch of the piece taken at one tempo, from `startTicks` onwards. */
export interface TempoSpan {
  readonly startTicks: number;
  readonly tempoBpm: number;
}

/**
 * Every tempo the piece is taken at, by where it begins.
 *
 * The one place that walks the tempo marks, for the same reason
 * {@link barLines} is the one place that walks the bars: once a tempo can
 * change partway through, no answer about clock time can be had by
 * multiplying. Always opens with a span at nought, so there is a tempo in
 * force everywhere.
 */
export function tempoSpans(exercise: Exercise): readonly TempoSpan[] {
  const bars = barLines(exercise);
  const spans: TempoSpan[] = [{ startTicks: 0, tempoBpm: exercise.tempoBpm }];
  const marks = exercise.tempoChanges
    .map((change) => ({
      startTicks: (bars[change.measureIndex]?.startTicks ?? 0) + change.offsetTicks,
      tempoBpm: change.tempoBpm,
    }))
    .sort((left, right) => left.startTicks - right.startTicks);
  for (const mark of marks) {
    const last = spans[spans.length - 1];
    if (last !== undefined && mark.startTicks <= last.startTicks) {
      // Two marks at one instant, or one on the downbeat the piece opens at:
      // the later of them is what is played from there.
      spans[spans.length - 1] = { startTicks: last.startTicks, tempoBpm: mark.tempoBpm };
      continue;
    }
    spans.push(mark);
  }
  return spans;
}

/** The tempo in force at a given position, in quarter notes per minute. */
export function tempoAtTick(exercise: Exercise, ticks: number): number {
  let current = exercise.tempoBpm;
  for (const span of tempoSpans(exercise)) {
    if (span.startTicks > ticks) {
      break;
    }
    current = span.tempoBpm;
  }
  return current;
}

/**
 * Milliseconds from the start of the piece to a position in it.
 *
 * Walked rather than multiplied, since each stretch runs at its own tempo.
 * Positions before the start count backwards at the opening tempo, which is
 * what a count-in needs.
 */
export function elapsedMsAt(exercise: Exercise, ticks: number): number {
  const spans = tempoSpans(exercise);
  let elapsed = 0;
  for (const [index, span] of spans.entries()) {
    if (span.startTicks >= ticks) {
      break;
    }
    const next = spans[index + 1]?.startTicks ?? Infinity;
    const until = Math.min(next, ticks);
    elapsed += ticksToMilliseconds(until - span.startTicks, span.tempoBpm);
  }
  return ticks >= 0 ? elapsed : ticksToMilliseconds(ticks, exercise.tempoBpm);
}

/** How long a stretch of the piece lasts, from one position to another. */
export function spanMs(exercise: Exercise, fromTicks: number, toTicks: number): number {
  return elapsedMsAt(exercise, toTicks) - elapsedMsAt(exercise, fromTicks);
}

/** The key in force at a given measure. */
export function keyAtMeasure(exercise: Exercise, measureIndex: number): KeySignature {
  let current = exercise.key;
  for (const change of exercise.keyChanges) {
    if (change.measureIndex <= measureIndex) {
      current = change.key;
    }
  }
  return current;
}

/** The clef in force on a staff at a given measure. */
export function clefAtMeasure(staff: StaffPart, measureIndex: number): ClefKind {
  let current = staff.clef;
  for (const change of staff.clefChanges) {
    if (change.measureIndex <= measureIndex) {
      current = change.clef;
    }
  }
  return current;
}

export interface ExerciseMetadata {
  readonly generatorId: string;
  readonly seed: number;
}

/**
 * The single source of truth for one practice item.
 *
 * Everything downstream is derived from this value: the MusicXML that OSMD
 * renders, and the expected-event timeline that MIDI input is judged against.
 * Because both derivations start here they can never drift apart.
 */
/** Where the damper pedal goes down or comes up. */
export interface PedalMark {
  readonly measureIndex: number;
  /** Offset from the start of that measure, in divisions. */
  readonly offsetTicks: number;
  readonly type: 'start' | 'stop';
}

/** A key the score changes to, from the given measure onwards. */
export interface KeyChange {
  readonly measureIndex: number;
  readonly key: KeySignature;
}

/** A metre the score changes to, from the given measure onwards. */
export interface TimeChange {
  readonly measureIndex: number;
  readonly timeSignature: TimeSignature;
}

/**
 * A tempo the score changes to, from the given point onwards.
 *
 * Placed to the division rather than to the bar, because that is how the mark
 * is written: an accelerando is a run of them inside one bar, each on the note
 * it applies from. Quarter notes per minute, like {@link Exercise.tempoBpm}
 * and like MusicXML's own `<sound tempo>`.
 */
export interface TempoChange {
  readonly measureIndex: number;
  /** Offset from the start of that measure, in divisions. */
  readonly offsetTicks: number;
  readonly tempoBpm: number;
}

export interface Exercise {
  readonly id: string;
  readonly title: string;
  readonly key: KeySignature;
  /**
   * Keys the score changes to partway through.
   *
   * The pitches themselves never depend on this - a `Pitch` carries its own
   * alteration - but what has to be *printed* does. Held to one key, a piece
   * that modulates comes out correct and unreadable, every note of the new key
   * spelled out as an accidental. Empty for anything this program generates.
   */
  readonly keyChanges: readonly KeyChange[];
  /**
   * Damper pedal marks, in the order they occur.
   *
   * They change nothing about which keys are pressed and everything about what
   * is heard, which is why they matter to playback and to the page but never
   * to the matcher.
   */
  readonly pedalMarks: readonly PedalMark[];
  readonly timeSignature: TimeSignature;
  /**
   * Metres the score changes to partway through.
   *
   * Unlike a key change, this one moves the bar lines: bars stop being all
   * the same length, so where a bar begins can no longer be worked out by
   * multiplying. Everything that needs to know asks {@link barLines}, which
   * is the one place that walks them.
   *
   * A piece held to its first metre is not merely mis-clicked, it is
   * mis-read: the bars fill up at the wrong rate, so every one of them is
   * short or over-full, and what the writer wrote as half notes comes back
   * padded with rests. Empty for anything this program generates.
   */
  readonly timeChanges: readonly TimeChange[];
  readonly tempoBpm: number;
  /**
   * Tempos the score changes to partway through.
   *
   * Like a metre change, this one is not decoration: held to its opening
   * tempo, a piece marked Lento that later says Più mosso is played at the
   * Lento throughout, and the reader is asked to sight-read the fast section
   * at a speed the writer never wrote. Ten of the reader's own thirty-two
   * scores change tempo, one of them thirty-one times.
   *
   * What it breaks is multiplication: how long a position is into the piece
   * can no longer be had from one number, so everything that converts between
   * divisions and time asks {@link elapsedMsAt}, which is the one place that
   * walks them. Empty for anything this program generates.
   */
  readonly tempoChanges: readonly TempoChange[];
  /**
   * What the first bar is *called*, which is not always 1.
   *
   * An imported excerpt is bars 20 to 27 of something, and printing them as
   * 1 to 8 makes a photocopy that lies about where it came from. The reader
   * then has no way of telling an excerpt from a whole piece, and every
   * consumer that wants a real bar number has to remember to add an offset
   * back on.
   *
   * Numbering only: nothing derived from the exercise - the timeline, the
   * matcher, the report - counts bars from here. They count from zero, as they
   * always have.
   */
  readonly firstBarNumber: number;
  readonly staves: readonly StaffPart[];
  readonly metadata: ExerciseMetadata;
}

/** What the reader should see printed over a bar, one-based. */
export function barNumberOf(exercise: Exercise, measureIndex: number): number {
  return exercise.firstBarNumber + measureIndex;
}

/** The writer's marks on a note that are neither pitch nor rhythm. */
export interface EntryMarks {
  readonly fermata?: boolean;
  readonly breath?: boolean;
}

export function noteEntry(
  pitches: Pitch | readonly Pitch[],
  duration: Duration,
  tiedForward: readonly number[] = [],
  beams: readonly Beam[] = [],
  stem: StemDirection | null = null,
  arpeggiated = false,
  marks: EntryMarks = {},
): NoteEntry {
  const list = Array.isArray(pitches) ? [...(pitches as readonly Pitch[])] : [pitches as Pitch];
  return {
    kind: 'note',
    pitches: list,
    duration,
    tiedForward: [...tiedForward],
    beams: [...beams],
    stem,
    arpeggiated,
    fermata: marks.fermata === true,
    breath: marks.breath === true,
  };
}

/** The same entry with every one of its pitches held into the next. */
export function tiedNoteEntry(
  pitches: Pitch | readonly Pitch[],
  duration: Duration,
): NoteEntry {
  const entry = noteEntry(pitches, duration);
  return { ...entry, tiedForward: entry.pitches.map((pitch) => pitch.midi) };
}

export function restEntry(duration: Duration): RestEntry {
  return { kind: 'rest', duration };
}

export function silenceEntry(duration: Duration): SilenceEntry {
  return { kind: 'silence', duration };
}

export function measureOf(entries: readonly MusicalEntry[]): Measure {
  return { entries };
}

/** Total notated length of a measure, in divisions. */
export function measureTicks(measure: Measure): number {
  return measure.entries.reduce((total, entry) => total + entry.duration.ticks, 0);
}

/** Total notated length of an exercise, in divisions. */
export function exerciseTicks(exercise: Exercise): number {
  return barLines(exercise).reduce(
    (total, bar) => total + bar.timeSignature.ticksPerMeasure,
    0,
  );
}

/** Which bar a tick falls in, and how far into it, once metres may change. */
export function positionOfTick(
  exercise: Exercise,
  ticks: number,
): { readonly measureIndex: number; readonly beat: number } {
  const bars = barLines(exercise);
  let at = 0;
  for (const [measureIndex, bar] of bars.entries()) {
    if (ticks < bar.startTicks) {
      break;
    }
    at = measureIndex;
  }
  const bar = bars[at];
  if (bar === undefined) {
    return { measureIndex: 0, beat: 1 };
  }
  return {
    measureIndex: at,
    beat: bar.timeSignature.beatOf(ticks - bar.startTicks),
  };
}

/** Number of measures; every staff is required to agree on this. */
export function measureCount(exercise: Exercise): number {
  const first = exercise.staves[0];
  return first === undefined ? 0 : first.measures.length;
}

/**
 * Structural validation. Generators run this on everything they produce, so a
 * malformed exercise can never reach the renderer or the matcher.
 */
export function validateExercise(exercise: Exercise): void {
  if (exercise.staves.length === 0) {
    throw new ExerciseValidationError('An exercise needs at least one staff.', 'staves');
  }
  if (!Number.isFinite(exercise.tempoBpm) || exercise.tempoBpm <= 0) {
    throw new ExerciseValidationError(
      `Tempo must be a positive number, got ${exercise.tempoBpm}.`,
      'tempoBpm',
    );
  }
  exercise.tempoChanges.forEach((change, index) => {
    // A tempo of nought or less does not slow the music down, it stops the
    // clock: every position after it lands at the same instant.
    if (!Number.isFinite(change.tempoBpm) || change.tempoBpm <= 0) {
      throw new ExerciseValidationError(
        `Tempo must be a positive number, got ${change.tempoBpm}.`,
        `tempoChanges[${index}]`,
      );
    }
    if (!Number.isInteger(change.offsetTicks) || change.offsetTicks < 0) {
      throw new ExerciseValidationError(
        `A tempo change sits ${change.offsetTicks} divisions into its bar.`,
        `tempoChanges[${index}]`,
      );
    }
  });

  const staffNumbers = new Set<number>();
  const voices = new Set<number>();
  const bars = measureCount(exercise);
  if (bars === 0) {
    throw new ExerciseValidationError('An exercise needs at least one measure.', 'staves[0]');
  }

  // Per bar, because a metre may change partway through and each bar has to
  // add up to the one that governs it.
  const governedBy = barLines(exercise);

  exercise.staves.forEach((staff, staffIndex) => {
    const path = `staves[${staffIndex}]`;
    // Staff numbers may repeat - that is a second voice on the same staff -
    // but a voice number may not, since it is what tells them apart.
    staffNumbers.add(staff.staffNumber);

    if (voices.has(staff.voice)) {
      throw new ExerciseValidationError(`Duplicate voice ${staff.voice}.`, path);
    }
    voices.add(staff.voice);

    if (staff.measures.length !== bars) {
      throw new ExerciseValidationError(
        `Expected ${bars} measures to match staff 0, got ${staff.measures.length}.`,
        path,
      );
    }

    staff.measures.forEach((measure, measureIndex) => {
      const measurePath = `${path}.measures[${measureIndex}]`;

      // An empty measure means this voice is not present in that bar at all,
      // which is different from resting through it: a rest is drawn and a
      // silence is not. That the staff still has something drawn on it is
      // checked once per bar, by {@link validateStaffCoverage}.
      if (measure.entries.length === 0) {
        return;
      }

      // This also catches an unfinished tuplet: two thirds of a beat leaves a
      // remainder no plain value can fill, so a group that never closes always
      // shows up here as a bar that does not add up. There is deliberately no
      // separate check for it - one that could never fire would be worse than
      // none.
      const actual = measureTicks(measure);
      const governing = governedBy[measureIndex]?.timeSignature ?? exercise.timeSignature;
      const expectedTicks = governing.ticksPerMeasure;
      if (actual !== expectedTicks) {
        throw new ExerciseValidationError(
          `Measure holds ${actual} divisions but ${governing.toString()} requires ${expectedTicks}.`,
          measurePath,
        );
      }
      measure.entries.forEach((entry, entryIndex) => {
        validateEntry(entry, `${measurePath}.entries[${entryIndex}]`);
      });
    });

    validateTies(staff, path);
  });

  validateStaffCoverage(exercise, governedBy);
}

/** The spans an entry list draws on the page, as [from, to) pairs. */
function drawnSpans(measure: Measure | undefined): readonly (readonly [number, number])[] {
  const spans: [number, number][] = [];
  let cursor = 0;
  for (const entry of measure?.entries ?? []) {
    const ends = cursor + entry.duration.ticks;
    if (entry.kind !== 'silence') {
      spans.push([cursor, ends]);
    }
    cursor = ends;
  }
  return spans;
}

/**
 * Every bar of every staff has something drawn across the whole of it.
 *
 * A voice may vanish from a bar or from part of one, because piano writing
 * puts an inner line under a melody and the line comes and goes. What it may
 * not do is leave the staff blank: a bar with nothing drawn in it is not
 * silence the reader can count, it is a hole. Checked across the staff rather
 * than per voice, since covering each other is the whole point of them.
 */
function validateStaffCoverage(
  exercise: Exercise,
  governedBy: ReturnType<typeof barLines>,
): void {
  const staffNumbers = [...new Set(exercise.staves.map((staff) => staff.staffNumber))];
  const bars = measureCount(exercise);

  for (let measureIndex = 0; measureIndex < bars; measureIndex += 1) {
    const expected =
      governedBy[measureIndex]?.timeSignature.ticksPerMeasure ??
      exercise.timeSignature.ticksPerMeasure;
    for (const staffNumber of staffNumbers) {
      const spans = exercise.staves
        .filter((staff) => staff.staffNumber === staffNumber)
        .flatMap((staff) => drawnSpans(staff.measures[measureIndex]))
        .sort((left, right) => left[0] - right[0]);
      // Walk the spans in order, carrying how far the staff is covered so far.
      // Overlapping voices simply push it further; a span that starts beyond
      // it is the far side of a hole.
      let reached = 0;
      for (const [from, to] of spans) {
        if (from > reached) {
          break;
        }
        reached = Math.max(reached, to);
      }
      if (reached < expected) {
        throw new ExerciseValidationError(
          `Staff ${staffNumber} draws nothing from ${reached} to ${expected} divisions of this bar.`,
          `measures[${measureIndex}]`,
        );
      }
    }
  }
}

/**
 * Where each entry sits in its tuplet group; plain values get `null`.
 *
 * A group has to be *found* rather than stored, because nothing in the music
 * marks its boundaries: three triplet eighths are simply three entries in a
 * row. The rule that finds them is that a complete group always spans a plain
 * notated value - three triplet eighths make a quarter - while no part of one
 * ever does, since a third or two thirds of a quarter is not a value anyone
 * can write. Accumulating until the span becomes notatable therefore closes a
 * group exactly where it ends, and handles two groups in a row as well as a
 * group of mixed values.
 */
export function tupletPositions(
  entries: readonly MusicalEntry[],
): readonly (TupletPosition | null)[] {
  const positions: (TupletPosition | null)[] = [];
  let span = 0;
  let openedAt = -1;

  entries.forEach((entry, index) => {
    // A silence is drawn as nothing, so it can belong to no group: a bracket
    // reaching across it would be drawn over empty staff and would count a
    // value the reader cannot see.
    if (entry.kind === 'silence' || !entry.duration.isTuplet) {
      positions.push(null);
      span = 0;
      openedAt = -1;
      return;
    }
    const previous = openedAt >= 0 ? entries[openedAt]?.duration : undefined;
    if (previous !== undefined && !previous.sameTuplet(entry.duration)) {
      // A ratio can only change between groups; close the old one rather than
      // emit nonsense. `validateTuplets` refuses this shape outright.
      span = 0;
      openedAt = -1;
    }
    const starts = span === 0;
    if (starts) {
      openedAt = index;
    }
    span += entry.duration.ticks;
    const stops = Duration.isNotatable(span);
    if (stops) {
      span = 0;
      openedAt = -1;
    }
    positions.push({ starts, stops });
  });

  return positions;
}

/**
 * Checks that every tie lands somewhere.
 *
 * A tie that leads into a rest, into a different pitch or off the end of the
 * piece is not a held note - it is a note the player would be waiting to
 * release forever, and a timeline that quietly never demands it again. Ties
 * cross bar lines by design, which is most of what they are for, so this walks
 * the staff rather than each measure.
 */
function validateTies(staff: StaffPart, path: string): void {
  const entries = staff.measures.flatMap((measure, measureIndex) =>
    measure.entries.map((entry, entryIndex) => ({
      entry,
      where: `${path}.measures[${measureIndex}].entries[${entryIndex}]`,
    })),
  );

  entries.forEach((current, index) => {
    const { entry, where } = current;
    if (entry.kind !== 'note' || entry.tiedForward.length === 0) {
      return;
    }
    const next = entries[index + 1]?.entry;
    for (const midi of entry.tiedForward) {
      if (next === undefined) {
        throw new ExerciseValidationError(
          `A tie on MIDI ${midi} runs off the end of the staff.`,
          where,
        );
      }
      if (next.kind !== 'note') {
        throw new ExerciseValidationError(`A tie on MIDI ${midi} leads into a rest.`, where);
      }
      if (!next.pitches.some((pitch) => pitch.midi === midi)) {
        throw new ExerciseValidationError(
          `A tie on MIDI ${midi} leads into an entry that does not contain it.`,
          where,
        );
      }
    }
  });
}

function validateEntry(entry: MusicalEntry, path: string): void {
  switch (entry.kind) {
    case 'rest':
    case 'silence':
      return;
    case 'note': {
      if (entry.pitches.length === 0) {
        throw new ExerciseValidationError('Note entry has no pitches.', path);
      }
      const seen = new Set<number>();
      for (const pitch of entry.pitches) {
        if (seen.has(pitch.midi)) {
          throw new ExerciseValidationError(
            `Pitch ${pitch.toString()} is duplicated inside a chord.`,
            path,
          );
        }
        seen.add(pitch.midi);
      }
      for (const midi of entry.tiedForward) {
        if (!seen.has(midi)) {
          throw new ExerciseValidationError(
            `A tie names MIDI ${midi}, which this entry does not play.`,
            path,
          );
        }
      }
      return;
    }
    default:
      return assertNever(entry, `Unknown entry kind at ${path}`);
  }
}

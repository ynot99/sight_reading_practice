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

/**
 * An ornament leaning on the note that follows it.
 *
 * It takes no time from the bar, which is the whole of why it is here rather
 * than in the entry list: written as a real note it has to be paid for, and
 * the payment either moves the note it leans on off its beat or shortens the
 * one before. Neither is what the page says. The engraver draws it small and
 * squeezes it in, and the bar goes on adding up.
 *
 * `duration` is how it is *drawn* - a sixteenth, an eighth - and buys nothing.
 */
export interface GraceNote {
  readonly pitches: readonly Pitch[];
  readonly duration: Duration;
  /**
   * The stroke through the stem: an acciaccatura rather than an appoggiatura.
   *
   * A reading instruction the writer chose, and the difference between "crush
   * this in" and "lean on the beat" - which is a decision about how it sounds,
   * so it is carried rather than decided here.
   */
  readonly slashed: boolean;
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
   * Shorten this note - the dot over the head.
   *
   * A reading instruction like the fermata and the comma, and the same kind of
   * thing: how much shorter is the performer's, so it belongs on the page
   * rather than being turned into a length here. It takes nothing from the bar
   * either - a staccato quarter is still a quarter of the bar, and moving the
   * notes after it would be rewriting the rhythm the writer set down.
   */
  readonly staccato: boolean;
  /**
   * Lift after this note - the comma over the staff.
   *
   * A breath, and the shortest of all the writer's instructions: it takes no
   * time from the bar and gives none to it, it only says that the line stops
   * here before it goes on.
   */
  readonly breath: boolean;
  /**
   * Ornaments leaning on this note, in the order they are played.
   *
   * On the entry rather than beside it, because that is what they are: the
   * engraver hangs them off this notehead and the cursor never stops on them.
   * Empty for anything this program generates.
   */
  readonly graces: readonly GraceNote[];
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
/**
 * A clef the staff changes to, from this moment onwards.
 *
 * Placed like a pedal mark or a dynamic - a bar and an offset into it -
 * because a clef can change partway through a bar and often does: a left
 * hand crossing up for half a beat is written in the treble clef and back
 * in the bass before the bar is out. Kept to whole bars, the two changes
 * become one at the bar line, the return is lost, and a page of the left
 * hand is drawn in the wrong clef.
 */
export interface ClefChange {
  readonly measureIndex: number;
  readonly offsetTicks: number;
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
 *
 * Walked once per piece, and kept. Being the one place every answer about
 * position is read off, it is asked constantly - several times for each note
 * a playback gathers - and it used to walk every bar every time. On a score of
 * thirteen hundred bars that made gathering a playback's notes take four
 * seconds, with the pulse already running, and the beats of those seconds
 * arrived all at once when it finished: the marker jumped ahead instead of
 * waiting for the first note. His: "стрибає вперед одразу ніж чекати на першу
 * ноту". Measured on the device, not guessed at.
 *
 * Kept against the exercise itself, which is never changed once made - every
 * change to a piece is a new exercise - so the answer cannot go stale, and it
 * goes when the piece does.
 */
export function barLines(
  exercise: Exercise,
): readonly { readonly startTicks: number; readonly timeSignature: TimeSignature }[] {
  const known = barLinesOf.get(exercise);
  if (known !== undefined) {
    return known;
  }
  const bars: { startTicks: number; timeSignature: TimeSignature }[] = [];
  let startTicks = 0;
  for (let measureIndex = 0; measureIndex < measureCount(exercise); measureIndex += 1) {
    const timeSignature = timeAtMeasure(exercise, measureIndex);
    bars.push({ startTicks, timeSignature });
    startTicks += timeSignature.ticksPerMeasure;
  }
  barLinesOf.set(exercise, bars);
  return bars;
}

/** {@link barLines}, once per piece. */
const barLinesOf = new WeakMap<
  Exercise,
  readonly { readonly startTicks: number; readonly timeSignature: TimeSignature }[]
>();

/**
 * Which bar a place in the music falls in, counted from nought.
 *
 * Read off {@link barLines} like every other answer about musical position: a
 * metre change moves the bar lines, so this one cannot be had by dividing
 * either. A place past the end belongs to the last bar - there is no bar after
 * the piece, and the very end of it is still in its last one.
 */
export function measureIndexAt(exercise: Exercise, ticks: number): number {
  const bars = barLines(exercise);
  let found = 0;
  for (let index = 0; index < bars.length; index += 1) {
    if ((bars[index]?.startTicks ?? 0) > ticks) {
      break;
    }
    found = index;
  }
  return found;
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
  // Once per piece, for the reason {@link barLines} is: every moment in the
  // music is timed off this, and it was being rebuilt - mapped and sorted -
  // for each of them.
  const known = tempoSpansOf.get(exercise);
  if (known !== undefined) {
    return known;
  }
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
  tempoSpansOf.set(exercise, spans);
  return spans;
}

/** {@link tempoSpans}, once per piece. */
const tempoSpansOf = new WeakMap<Exercise, readonly TempoSpan[]>();

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

/** The clef in force on a staff at a given moment. */
export function clefAt(staff: StaffPart, measureIndex: number, offsetTicks: number): ClefKind {
  let current = staff.clef;
  for (const change of staff.clefChanges) {
    const reached =
      change.measureIndex < measureIndex ||
      (change.measureIndex === measureIndex && change.offsetTicks <= offsetTicks);
    if (reached) {
      current = change.clef;
    }
  }
  return current;
}

/**
 * The clef a staff is read in as a bar begins.
 *
 * What most callers want: the clef a bar opens in is the clef its reader
 * meets. A change partway through governs from where it is written, which
 * `clefAt` answers.
 */
export function clefAtMeasure(staff: StaffPart, measureIndex: number): ClefKind {
  return clefAt(staff, measureIndex, 0);
}

/**
 * The clef a staff is left in once a bar is over.
 *
 * Every change inside the bar included, which is what the bar after it
 * inherits. Written out repeats need this and the opening clef both: a bar
 * read a second time may follow a different bar than it did the first time.
 */
export function clefAfterMeasure(staff: StaffPart, measureIndex: number): ClefKind {
  let current = staff.clef;
  for (const change of staff.clefChanges) {
    if (change.measureIndex <= measureIndex) {
      current = change.clef;
    }
  }
  return current;
}

/** A bar's printed name, and whether the reader has seen it before. */
export interface BarLabel {
  readonly number: number;
  readonly repeated: boolean;
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
/**
 * How loud the writer asked for it to be, from here on.
 *
 * Every level a piano piece is actually written in, quietest first. Clair de
 * Lune opens in `pp` and asks for `ppp` before the first page is out, so
 * stopping at two p's would have played its quietest music at the same
 * loudness as its merely quiet music; a Minecraft arrangement asks for
 * `pppp`, and ends on `n` - niente, nothing - under a diminuendo seven bars
 * long. A level this program cannot name is dropped, and a dropped one is
 * not merely unprinted: the music goes on at whatever was in force before,
 * which is how that ending came out at an even mezzo-piano.
 *
 * `sf` and the rest are left out on purpose: they are accents on one note
 * rather than a level to keep, and a level is what this is - it holds until
 * the next one, the way a tempo does.
 */
export const DYNAMIC_LEVELS = [
  'n',
  'pppp',
  'ppp',
  'pp',
  'p',
  'mp',
  'mf',
  'f',
  'ff',
  'fff',
  'ffff',
] as const;

export type DynamicLevel = (typeof DYNAMIC_LEVELS)[number];

/**
 * One dynamic mark, where the writer put it.
 *
 * Placed like a pedal mark - a bar and an offset into it - because that is
 * where the format puts it: a direction sits between notes, so the cursor is
 * already where the mark belongs. Kept per staff, since the hands are marked
 * separately as often as not.
 */
export interface DynamicMark {
  readonly measureIndex: number;
  readonly offsetTicks: number;
  readonly level: DynamicLevel;
  /** The staff it was written under, or `null` where the file did not say. */
  readonly staffNumber: number | null;
  /**
   * Which side of the staff the writer put it on, where the file said.
   *
   * Carried rather than chosen, like the beams and the stems and the words.
   * Below is where a piano dynamic usually goes and so is what this defaults
   * to - but a staff carrying two lines marks the upper one above, and
   * forcing every mark below stacks a row of them under one bar and loses
   * which line each belongs to.
   */
  readonly placement?: 'above' | 'below';
  /**
   * Worked out from a hairpin rather than written, and never printed.
   *
   * The same rule the implied tempo changes follow: a crescendo is heard as
   * a handful of levels because levels are the only language this program's
   * loudness speaks, but nobody wrote them and printing them would put four
   * dynamic marks under one bar.
   */
  readonly implied?: boolean;
}

/**
 * How hard a level is struck, `0..1`.
 *
 * Steps rather than a curve, because steps are what is written, and spread
 * as widely as the instrument allows: from `ppp` to `fff` is about fifteen
 * decibels here, where two neighbouring levels three decibels apart were
 * being reported as no difference at all. The ends are close together on
 * purpose - the two loudest are a hair apart because the recordings will
 * not go louder, and the two quietest because the player will not go much
 * quieter without the note disappearing. Neither end is where the music
 * lives; they are there so that a mark naming one is heard at all.
 *
 * Loudness is only half of it. A piano struck harder is *brighter*, not
 * merely louder, and one recording per note cannot say that by itself - so
 * the player darkens a quiet note as well as lowering it. Which is what a
 * sampler with sixteen velocity layers gets for free and this one has to
 * imitate; the layers themselves are a download, not a rule.
 */
export const DYNAMIC_VELOCITY: Readonly<Record<DynamicLevel, number>> = {
  n: 0.04,
  pppp: 0.07,
  ppp: 0.1,
  pp: 0.2,
  p: 0.33,
  mp: 0.47,
  mf: 0.62,
  f: 0.78,
  ff: 0.92,
  fff: 0.93,
  ffff: 1,
};

/**
 * How loud the music is where this tick falls, for a given staff.
 *
 * The mark in force is the last one at or before the moment, and a mark with
 * no staff of its own speaks for every staff - which is how a piece with one
 * line of dynamics under the piano is written. Where nothing has been marked
 * yet the answer is `null`: silence about loudness is not an instruction, and
 * the caller has a default of its own.
 */
export function dynamicAt(
  exercise: Exercise,
  measureIndex: number,
  offsetTicks: number,
  staffNumber: number | null,
): DynamicLevel | null {
  return markInForce(exercise, measureIndex, offsetTicks, staffNumber)?.level ?? null;
}

/** The same question, answered with the mark itself: where it is matters. */
function markInForce(
  exercise: Exercise,
  measureIndex: number,
  offsetTicks: number,
  staffNumber: number | null,
): DynamicMark | null {
  // Read off the bar lines rather than compared bar by bar: a hairpin that
  // stops at the end of one bar and a mark written at the start of the next
  // are the same moment, and the wedge asking what it is heading for has to
  // find it. That is the ending of his Minecraft arrangement exactly - a
  // diminuendo closing on the barline with niente under the first note after
  // it - and spelled the other way the mark was not there.
  const bars = barLines(exercise);
  const at = (measure: number, offset: number): number => (bars[measure]?.startTicks ?? 0) + offset;
  const here = at(measureIndex, offsetTicks);
  const isBefore = (mark: DynamicMark): boolean => at(mark.measureIndex, mark.offsetTicks) <= here;
  const isLater = (mark: DynamicMark, than: DynamicMark | null): boolean =>
    than === null ||
    mark.measureIndex > than.measureIndex ||
    (mark.measureIndex === than.measureIndex && mark.offsetTicks >= than.offsetTicks);

  let latest: DynamicMark | null = null;
  let mine: DynamicMark | null = null;
  for (const mark of exercise.dynamicMarks) {
    if (!isBefore(mark)) {
      continue;
    }
    if (isLater(mark, latest)) {
      latest = mark;
    }
    if (
      (mark.staffNumber === null || staffNumber === null || mark.staffNumber === staffNumber) &&
      isLater(mark, mine)
    ) {
      mine = mark;
    }
  }
  // A dynamic written under one staff of a piano part is an instruction to
  // the player, not to that hand alone: one `pp` under the treble means the
  // whole texture. Measured on his own score and it is what was wrong - the
  // left hand went on at `mf` under a right hand playing `pp`, which is
  // exactly "I hear no difference".
  //
  // A hand that has been marked separately keeps its own where the two sit
  // at the same moment, which is how `f` over `p` is written; after that the
  // later instruction governs, whichever staff it was written under.
  if (mine === null) {
    return latest;
  }
  if (latest === null) {
    return mine;
  }
  const mineIsLater =
    mine.measureIndex > latest.measureIndex ||
    (mine.measureIndex === latest.measureIndex && mine.offsetTicks >= latest.offsetTicks);
  return mineIsLater ? mine : latest;
}

/**
 * A hairpin: the music getting louder or quieter across a stretch.
 *
 * Kept as the two ends the writer drew rather than as a level at every note,
 * for the reason the words are: it is what is on the page. What it does to
 * the sound is worked out from it, the way a `rit.` is.
 */
export interface DynamicHairpin {
  readonly measureIndex: number;
  readonly offsetTicks: number;
  readonly kind: 'crescendo' | 'diminuendo';
  /** Where it stops, which the file states separately. */
  readonly untilMeasureIndex: number;
  readonly untilOffsetTicks: number;
  readonly staffNumber: number | null;
  /**
   * Which side of the staff it was drawn on, where the file said.
   *
   * Taken from the end that opens it, since a hairpin is one thing however
   * many directions state it. Two of them under one staff - the upper line
   * swelling while the lower one fades - are stacked one beneath the other
   * when both are forced below: nothing is lost, and the page stops saying
   * which of the two lines each belongs to.
   */
  readonly placement?: 'above' | 'below';
  /**
   * The word it was written as, where it was written as one.
   *
   * `cresc.` over a dashed line and a wedge say the same thing to a player
   * and different things to a reader: the word crosses a page break and a
   * wedge does not, which is why a writer choosing between them means it.
   * So this is heard exactly as a wedge is - it is the same crescendo - and
   * printed as what it was, the way the beams and the stems are.
   */
  readonly text?: string;
}

/**
 * How hard to strike a note here, `0..1`, dynamics and hairpins together.
 *
 * The written levels are steps and a hairpin is a slope, so a slope cannot be
 * said in levels: eight of them across four bars is one change, and a change
 * at the end of a crescendo is not a crescendo. The level in force gives the
 * ground, and a hairpin covering this moment lifts or lowers it towards where
 * it is heading - as smoothly as the notes come.
 *
 * Where it is heading is the mark at its far end, and where the writer put
 * none, one step of the eight: which is what a wedge between two unmarked
 * stretches means to a player.
 */
export function velocityAt(
  exercise: Exercise,
  measureIndex: number,
  offsetTicks: number,
  staffNumber: number | null,
): number {
  const bars = barLines(exercise);
  const at = (bar: number, offset: number): number => (bars[bar]?.startTicks ?? 0) + offset;
  const here = at(measureIndex, offsetTicks);
  const level = dynamicAt(exercise, measureIndex, offsetTicks, staffNumber) ?? 'mf';
  const ground = DYNAMIC_VELOCITY[level];

  // The latest hairpin that has begun by now, for this staff or for the
  // whole texture. Later ones have not started; earlier ones have been
  // answered by this one.
  let latest: DynamicHairpin | null = null;
  for (const hairpin of exercise.hairpins) {
    if (
      hairpin.staffNumber !== null &&
      staffNumber !== null &&
      hairpin.staffNumber !== staffNumber
    ) {
      continue;
    }
    const from = at(hairpin.measureIndex, hairpin.offsetTicks);
    if (from > here) {
      continue;
    }
    if (latest === null || from >= at(latest.measureIndex, latest.offsetTicks)) {
      latest = hairpin;
    }
  }
  if (latest === null) {
    return ground;
  }

  const from = at(latest.measureIndex, latest.offsetTicks);
  const until = at(latest.untilMeasureIndex, latest.untilOffsetTicks);
  if (until <= from) {
    return ground;
  }
  const ends = dynamicAt(exercise, latest.untilMeasureIndex, latest.untilOffsetTicks, staffNumber);
  const step = latest.kind === 'crescendo' ? 1 : -1;
  const next =
    DYNAMIC_LEVELS[
      Math.min(DYNAMIC_LEVELS.length - 1, Math.max(0, DYNAMIC_LEVELS.indexOf(level) + step))
    ];
  const target =
    ends !== null && ends !== level ? DYNAMIC_VELOCITY[ends] : DYNAMIC_VELOCITY[next ?? level];

  if (here <= until) {
    return ground + (target - ground) * ((here - from) / (until - from));
  }
  // Past the far end. A player does not fall back to where they began the
  // moment a wedge stops being drawn - they stay where it left them until
  // something says otherwise. So the written level wins only if it was
  // written after the hairpin ended.
  const marked = markInForce(exercise, measureIndex, offsetTicks, staffNumber);
  const markedAt = marked === null ? -1 : at(marked.measureIndex, marked.offsetTicks);
  return markedAt > until ? ground : target;
}

/**
 * An 8va or 15ma: notes drawn an octave or two from where they sound.
 *
 * The pitch in the file is always the sounding one, so this changes nothing
 * about the music - it is a way of writing high or low music without a
 * thicket of ledger lines, and a reader who has learned the sign reads it
 * faster than they read the lines. Carried whole, with the direction and the
 * size the writer chose, because the engraver applies it and this program
 * only has to say what was written.
 */
export interface OctaveShift {
  readonly measureIndex: number;
  readonly offsetTicks: number;
  readonly untilMeasureIndex: number;
  readonly untilOffsetTicks: number;
  /** As MusicXML says it: `down` draws below the sound, `up` above it. */
  readonly direction: 'up' | 'down';
  /** 8 for one octave, 15 for two. */
  readonly size: 8 | 15;
  readonly staffNumber: number | null;
}

export interface PedalMark {
  readonly measureIndex: number;
  /** Offset from the start of that measure, in divisions. */
  readonly offsetTicks: number;
  readonly type: 'start' | 'stop';
  /**
   * Drawn as a bracket rather than as the word "Ped.".
   *
   * Notation the writer chose, like the beams and the stems: the bracket says
   * exactly how long the pedal is held and the sign only says that it was
   * pressed. Both are in the reader's own library - two thousand of the one
   * and under two hundred of the other - so it is carried rather than picked.
   */
  readonly line: boolean;
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
/**
 * A word the writer put over the music about its speed.
 *
 * Carried whether or not it means anything to the clock, because it is on the
 * page and the page is what the reader reads. `accel.` and `rit.` also move
 * the clock, and `a tempo` puts it back; anything else - "dolce", "espr." -
 * is printed and left alone.
 */
export interface TempoWord {
  readonly measureIndex: number;
  readonly offsetTicks: number;
  /** Exactly as written, since that is what gets printed. */
  readonly text: string;
  readonly kind: 'accelerando' | 'ritardando' | 'a-tempo' | 'other';
  /**
   * Which side of the staff the writer put it on, where the file said.
   *
   * Carried rather than chosen, like the beams and the stems: a `rit.` and a
   * metronome mark both go above by default, and forcing ours above put the
   * two on top of each other in a bar that had them together. Where the file
   * says nothing this says nothing, and the engraver decides as it always
   * has.
   */
  readonly placement?: 'above' | 'below';
  /** How far off the staff the writer put it, in tenths, where they said. */
  readonly offsetY?: number;
}

export interface TempoChange {
  readonly measureIndex: number;
  /** Offset from the start of that measure, in divisions. */
  readonly offsetTicks: number;
  readonly tempoBpm: number;
  /**
   * Worked out rather than written, and therefore never printed.
   *
   * A gradual change is kept as a run of small constant ones, because that
   * is the only language this program's clock speaks - but they are not
   * marks the writer made, and printing them turns one `rit.` into a row of
   * numbers across the bar. What the reader sees is what the file said.
   */
  readonly implied?: boolean;
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
  /**
   * How loud, and from where.
   *
   * Carried rather than guessed at: a piece marked `pp` and played at one
   * loudness throughout is being read with a third of what the writer wrote
   * left out.
   */
  readonly dynamicMarks: readonly DynamicMark[];
  /** Words about the speed, printed and - for some of them - obeyed. */
  readonly tempoWords: readonly TempoWord[];
  /** Hairpins: getting louder, getting quieter. */
  readonly hairpins: readonly DynamicHairpin[];
  /** Stretches drawn an octave or two from where they sound. */
  readonly octaveShifts: readonly OctaveShift[];
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
  /**
   * What each bar is called, and whether it is a re-reading of an earlier one.
   *
   * Empty for music read straight through, where a bar's name is its place
   * plus {@link firstBarNumber} and nothing else needs saying.
   *
   * A repeat is written out here rather than jumped back to: the reader moves
   * forward and so does everything drawn for them - the marker, the page, the
   * veil over what is still to come, the marks left where they played. A page
   * that has to be read twice would have those two readings arguing over one
   * piece of paper. Written out, the second reading has a page of its own and
   * keeps the bar numbers of the first, so the score still says where in the
   * piece it is.
   */
  readonly barLabels: readonly BarLabel[];
  readonly staves: readonly StaffPart[];
  readonly metadata: ExerciseMetadata;
}

/** What the reader should see printed over a bar, one-based. */
export function barNumberOf(exercise: Exercise, measureIndex: number): number {
  return exercise.barLabels[measureIndex]?.number ?? exercise.firstBarNumber + measureIndex;
}

/** Whether this bar is a second reading of one already printed. */
export function barIsRepeated(exercise: Exercise, measureIndex: number): boolean {
  return exercise.barLabels[measureIndex]?.repeated === true;
}

/** The writer's marks on a note that are neither pitch nor rhythm. */
export interface EntryMarks {
  readonly fermata?: boolean;
  readonly staccato?: boolean;
  readonly breath?: boolean;
  readonly graces?: readonly GraceNote[];
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
    staccato: marks.staccato === true,
    breath: marks.breath === true,
    graces: marks.graces === undefined ? [] : [...marks.graces],
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
      entry.graces.forEach((grace, at) => {
        if (grace.pitches.length === 0) {
          throw new ExerciseValidationError(
            'A grace note has no pitches.',
            `${path}.graces[${at}]`,
          );
        }
        const heard = new Set<number>();
        for (const pitch of grace.pitches) {
          if (heard.has(pitch.midi)) {
            throw new ExerciseValidationError(
              `Pitch ${pitch.toString()} is duplicated inside a grace chord.`,
              `${path}.graces[${at}]`,
            );
          }
          heard.add(pitch.midi);
        }
      });
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

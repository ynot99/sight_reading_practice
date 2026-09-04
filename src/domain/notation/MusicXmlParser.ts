import { DomainError } from '../../shared/errors.js';
import { CLEF_DEFINITIONS, type ClefKind } from '../model/Clef.js';
import { DIVISIONS_PER_QUARTER, Duration, NOTE_TYPES, type NoteTypeName } from '../model/Duration.js';
import type { Exercise, Measure, MusicalEntry, StaffPart } from '../model/Exercise.js';
import {
  BEAM_TYPES,
  measureOf,
  noteEntry,
  restEntry,
  silenceEntry,
  validateExercise,
} from '../model/Exercise.js';
import type {
  Beam,
  BeamType,
  ClefChange,
  KeyChange,
  PedalMark,
  StemDirection,
  TimeChange,
} from '../model/Exercise.js';
import { KeySignature, type KeyMode } from '../model/KeySignature.js';
import { Pitch, type Alteration } from '../model/Pitch.js';
import { splitIntoRests } from '../generation/RhythmFiller.js';
import { TimeSignature } from '../model/TimeSignature.js';
import {
  attribute,
  child,
  childNumber,
  childText,
  childrenNamed,
  hasChild,
  type XmlNode,
} from './XmlNode.js';

/** Something the file said that the trainer cannot represent. */
export interface ImportWarning {
  readonly kind:
    | 'extra-parts'
    | 'extra-voices'
    | 'grace-notes'
    | 'changing-attributes'
    | 'unsupported-clef'
    | 'dropped-tie'
    | 'padded-measure'
    // What reading a *performance* has to decide rather than read. Kept in one
    // list because the reader meets them the same way: as the page they got
    // differing from the page they expected.
    | 'quantised'
    | 'split-by-pitch'
    | 'voices-merged'
    | 'dropped-notes';
  readonly detail: string;
}

export interface ImportedScore {
  readonly exercise: Exercise;
  /**
   * What was thrown away on the way in.
   *
   * The model is deliberately narrower than MusicXML, so an import either
   * refuses the file or tells the reader plainly what it lost. Silently
   * dropping a voice would be the worst of the three.
   */
  readonly warnings: readonly ImportWarning[];
}

/** One note as the file describes it, before it becomes an entry. */
interface RawNote {
  readonly staff: number;
  readonly voice: number;
  readonly onsetTicks: number;
  readonly ticks: number;
  readonly duration: Duration;
  readonly pitch: Pitch | null;
  readonly tieStart: boolean;
  readonly isChord: boolean;
  readonly beams: readonly Beam[];
  readonly stem: StemDirection | null;
  readonly arpeggiated: boolean;
  readonly fermata: boolean;
  readonly breath: boolean;
}

const XML_TYPE_NAMES: Readonly<Record<string, NoteTypeName>> = {
  whole: 'whole',
  half: 'half',
  quarter: 'quarter',
  eighth: 'eighth',
  '16th': '16th',
  '32nd': '32nd',
  '64th': '64th',
};

const CLEF_BY_SIGN_AND_LINE = new Map<string, ClefKind>(
  Object.entries(CLEF_DEFINITIONS).map(([kind, definition]) => [
    `${definition.sign}${definition.line}`,
    kind as ClefKind,
  ]),
);

/**
 * Reads a MusicXML document into an {@link Exercise}.
 *
 * The whole project rests on the exercise being the single source of truth, so
 * an imported score has to become one - the timeline the player is judged
 * against is derived from it, and building that from the engraver's parse of
 * the same file instead would be exactly the drift that invariant exists to
 * prevent.
 *
 * The model is narrower than the format. Where the two disagree the import
 * either refuses the file outright, when the music could not be played
 * correctly without what is missing, or drops the feature and says so.
 */
export function parseMusicXml(root: XmlNode): ImportedScore {
  const warnings: ImportWarning[] = [];
  const score = findScore(root);
  const parts = childrenNamed(score, 'part');
  const part = parts[0];
  if (part === undefined) {
    throw new DomainError('This file has no parts to read.');
  }

  const measures = childrenNamed(part, 'measure');
  if (measures.length === 0) {
    throw new DomainError('This part has no measures.');
  }

  const header = readHeader(measures, warnings);
  const { staves, pedalMarks } = readEveryPart(parts, measures.length, header, warnings);

  const exercise: Exercise = {
    id: `import-${Date.now().toString(36)}`,
    title: readTitle(score),
    key: header.key,
    keyChanges: header.keyChanges,
    timeChanges: header.timeChanges,
    pedalMarks,
    timeSignature: header.timeSignature,
    tempoBpm: header.tempoBpm,
    staves,
    firstBarNumber: readFirstBarNumber(measures),
    metadata: { generatorId: 'import.musicxml', seed: 0 },
  };

  validateExercise(exercise);
  return { exercise, warnings };
}

function findScore(root: XmlNode): XmlNode {
  if (root.name === 'score-partwise') {
    return root;
  }
  const nested = child(root, 'score-partwise');
  if (nested !== null) {
    return nested;
  }
  if (root.name === 'score-timewise' || child(root, 'score-timewise') !== null) {
    throw new DomainError(
      'This is a timewise MusicXML file. Export it as partwise - which is what MuseScore does by default.',
    );
  }
  throw new DomainError('This does not look like a MusicXML score.');
}

function readTitle(score: XmlNode): string {
  return (
    childText(child(score, 'work'), 'work-title') ??
    childText(score, 'movement-title') ??
    'Imported score'
  );
}

interface ScoreHeader {
  readonly divisions: number;
  readonly key: KeySignature;
  readonly timeSignature: TimeSignature;
  /** Metres it changes to later, by the measure each one begins at. */
  readonly timeChanges: readonly TimeChange[];
  readonly tempoBpm: number;
  readonly clefByStaff: ReadonlyMap<number, ClefKind>;
  /** Clefs a staff switches to later, keyed by the file's own staff number. */
  readonly clefChangesByStaff: ReadonlyMap<number, readonly ClefChange[]>;
  readonly keyChanges: readonly KeyChange[];
  readonly staffCount: number;
}

/**
 * How long a bar is at a given measure, in our divisions.
 *
 * Asked per bar rather than taken once, because a metre change moves the bar
 * lines: from there on, "how much fills a bar" has a different answer.
 */
function barTicksAt(header: ScoreHeader, measureIndex: number): number {
  let current = header.timeSignature;
  for (const change of header.timeChanges) {
    if (change.measureIndex <= measureIndex) {
      current = change.timeSignature;
    }
  }
  return current.ticksPerMeasure;
}

/** Reads `<clef>` elements into our own kinds, warning about the rest. */
function readClefs(
  attributes: XmlNode | null,
  warnings: ImportWarning[],
): ReadonlyMap<number, ClefKind> {
  const clefs = new Map<number, ClefKind>();
  for (const clef of childrenNamed(attributes, 'clef')) {
    const number = Number(attribute(clef, 'number') ?? '1');
    const sign = childText(clef, 'sign') ?? 'G';
    const line = childText(clef, 'line') ?? '2';
    const kind = CLEF_BY_SIGN_AND_LINE.get(`${sign}${line}`);
    if (kind === undefined) {
      warnings.push({
        kind: 'unsupported-clef',
        detail: `Staff ${number} uses a ${sign}${line} clef, which was read as treble.`,
      });
    }
    clefs.set(Number.isFinite(number) ? number : 1, kind ?? 'treble');
  }
  return clefs;
}

function readHeader(measures: readonly XmlNode[], warnings: ImportWarning[]): ScoreHeader {
  const first = measures[0];
  const attributes = child(first ?? null, 'attributes');
  const divisions = childNumber(attributes, 'divisions');
  if (divisions === null || divisions <= 0) {
    throw new DomainError('The file does not say how many divisions a quarter note has.');
  }

  const keyNode = child(attributes, 'key');
  const fifths = childNumber(keyNode, 'fifths') ?? 0;
  const mode = childText(keyNode, 'mode') === 'minor' ? 'minor' : 'major';

  const timeNode = child(attributes, 'time');
  const beats = childNumber(timeNode, 'beats');
  const beatType = childNumber(timeNode, 'beat-type');
  if (beats === null || beatType === null) {
    throw new DomainError('The file does not give a time signature.');
  }

  const staffCount = childNumber(attributes, 'staves') ?? 1;
  const clefByStaff = readClefs(attributes, warnings);

  // A clef change is followed rather than ignored: a left hand climbing into
  // the treble is written in the treble clef, and reading it on five ledger
  // lines instead is exactly the difficulty the change exists to remove.
  const clefChangesByStaff = new Map<number, ClefChange[]>();
  const keyChanges: KeyChange[] = [];
  const timeChanges: TimeChange[] = [];
  measures.forEach((measure, measureIndex) => {
    if (measureIndex === 0) {
      return;
    }
    const later = child(measure, 'attributes');
    if (later === null) {
      return;
    }
    for (const [staffNumber, clef] of readClefs(later, warnings)) {
      clefChangesByStaff.set(staffNumber, [
        ...(clefChangesByStaff.get(staffNumber) ?? []),
        { measureIndex, clef },
      ]);
    }
    // A modulation has to be followed as well. Held to one key, a piece that
    // changes key comes out correct and unreadable: every note of the new key
    // spelled with an accidental it should not need.
    const laterKey = child(later, 'key');
    const laterFifths = childNumber(laterKey, 'fifths');
    if (laterFifths !== null) {
      const laterMode = childText(laterKey, 'mode') === 'minor' ? 'minor' : 'major';
      keyChanges.push({
        measureIndex,
        key: new KeySignature(laterFifths, laterMode satisfies KeyMode),
      });
    }
    // A metre change moves the bar lines, so it cannot be ignored the way a
    // missing ornament can. Held to the first metre, every bar after the
    // change is short or over-full: the file is either refused outright or
    // read as music nobody wrote, its half notes padded out with rests.
    const laterTime = child(later, 'time');
    const laterBeats = childNumber(laterTime, 'beats');
    const laterBeatType = childNumber(laterTime, 'beat-type');
    if (laterBeats !== null && laterBeatType !== null) {
      timeChanges.push({
        measureIndex,
        timeSignature: new TimeSignature(laterBeats, laterBeatType),
      });
    }
  });

  return {
    divisions,
    key: new KeySignature(fifths, mode satisfies KeyMode),
    timeSignature: new TimeSignature(beats, beatType),
    timeChanges,
    tempoBpm: readTempo(measures),
    clefByStaff,
    clefChangesByStaff,
    keyChanges,
    staffCount: Math.max(1, staffCount),
  };
}

/**
 * What the file calls its first bar.
 *
 * Kept so that the numbers printed here are the numbers the reader sees in
 * whatever they engraved the file with, and so that a passage cut out of it
 * can go on counting from the right place. Anything that is not a plain
 * number - `X1` on a repeated bar, an implicit pickup written as `0` - falls
 * back to 1, which is what a reader counts from when nothing says otherwise.
 */
function readFirstBarNumber(measures: readonly XmlNode[]): number {
  const declared = Number(attribute(measures[0] ?? null, 'number') ?? '');
  return Number.isInteger(declared) && declared >= 1 ? declared : 1;
}

/**
 * What a score that names no tempo is read at.
 *
 * Plenty of them name none - the Nier arrangement carries no `<sound>` and no
 * metronome mark anywhere in it - and something has to be assumed. 120 is
 * what MuseScore assumes in the same case, so a file with no mark opens here
 * at the speed it opened where the reader last saw it. The number they meant
 * is a slider away either way; being off by the same amount as everyone else
 * is worth more than a lower guess that looks like the writer's own.
 */
const ASSUMED_TEMPO_BPM = 120;

function readTempo(measures: readonly XmlNode[]): number {
  for (const measure of measures) {
    for (const direction of childrenNamed(measure, 'direction')) {
      const sound = child(direction, 'sound');
      const tempo = Number(attribute(sound, 'tempo') ?? '');
      if (Number.isFinite(tempo) && tempo > 0) {
        return Math.round(tempo);
      }
      const metronome = child(child(direction, 'direction-type'), 'metronome');
      const perMinute = childNumber(metronome, 'per-minute');
      if (perMinute !== null && perMinute > 0) {
        return Math.round(perMinute);
      }
    }
  }
  return ASSUMED_TEMPO_BPM;
}

/** Divisions in the file's units, converted to ours. */
function toTicks(fileDivisions: number, divisions: number, where: string): number {
  const ticks = (fileDivisions * DIVISIONS_PER_QUARTER) / divisions;
  if (!Number.isInteger(ticks)) {
    throw new DomainError(
      `${where} lands between divisions once rescaled, which musical time here may never do.`,
    );
  }
  return ticks;
}

/**
 * @param rounding One division of the file, in ours - how far a written value
 * may sit from the number the file gives for it.
 */
function readDuration(note: XmlNode, ticks: number, where: string, rounding: number): Duration {
  const typeText = childText(note, 'type');
  // An unknown type name (128th, breve) reads as absent, and the tick count
  // decides instead - or the note is refused below.
  const type = typeText === null ? null : (XML_TYPE_NAMES[typeText] ?? null);
  const dots = childrenNamed(note, 'dot').length;
  const modification = child(note, 'time-modification');

  if (modification !== null) {
    const actual = childNumber(modification, 'actual-notes');
    const normal = childNumber(modification, 'normal-notes');
    if (type === null || actual === null || normal === null) {
      throw new DomainError(`${where} is part of a group this trainer cannot read.`);
    }
    const duration = Duration.of(type, dots === 1 ? 1 : 0, { actual, normal });
    // A file divides its quarter its own way, and a septuplet rarely fits:
    // MuseScore writes seven notes of 68, 69, 68, 69... which add up to the
    // beat while no one of them is a seventh of it. The written value is the
    // truth and the numbers are its rounding, so a disagreement smaller than
    // one of the file's own divisions is not a disagreement. Anything larger
    // still is: a note saying "quarter" and lasting a half is a broken file.
    if (Math.abs(duration.ticks - ticks) >= Math.max(rounding, 1)) {
      throw new DomainError(`${where} disagrees with itself about how long it lasts.`);
    }
    return duration;
  }

  if (Duration.isNotatable(ticks)) {
    return Duration.fromTicks(ticks);
  }
  if (type !== null) {
    return Duration.of(type, dots === 1 ? 1 : 0);
  }
  throw new DomainError(
    `${where} is a rhythmic value this trainer cannot write - it reads down to sixty-fourth notes, one dot and triplets.`,
  );
}

function readPitch(note: XmlNode): Pitch | null {
  const pitchNode = child(note, 'pitch');
  if (pitchNode === null) {
    return null;
  }
  const step = childText(pitchNode, 'step') ?? 'C';
  const octave = childNumber(pitchNode, 'octave') ?? 4;
  const alter = childNumber(pitchNode, 'alter') ?? 0;
  return new Pitch(step as Pitch['step'], octave, alter as Alteration);
}

/** Stem direction as written, which is how two voices are told apart. */
function readStem(note: XmlNode): StemDirection | null {
  const text = childText(note, 'stem');
  return text === 'up' || text === 'down' ? text : null;
}

/** Beaming exactly as the file wrote it, so the engraver need not guess. */
function readBeams(note: XmlNode): readonly Beam[] {
  const beams: Beam[] = [];
  for (const element of childrenNamed(note, 'beam')) {
    const type = element.text.trim() as BeamType;
    if (!BEAM_TYPES.includes(type)) {
      continue;
    }
    const level = Number(attribute(element, 'number') ?? '1');
    beams.push({ level: Number.isFinite(level) && level > 0 ? level : 1, type });
  }
  return beams;
}

function hasTie(note: XmlNode, type: 'start' | 'stop'): boolean {
  const ties = childrenNamed(note, 'tie');
  if (ties.some((tie) => attribute(tie, 'type') === type)) {
    return true;
  }
  return childrenNamed(child(note, 'notations'), 'tied').some(
    (tied) => attribute(tied, 'type') === type,
  );
}

/** Walks one measure, placing every note on the staff and beat it belongs to. */
/**
 * How long a grace note is given: a sixteenth.
 *
 * An acciaccatura is meant to be shorter than anything notated, which no
 * vocabulary of written values can say. A sixteenth is the nearest true thing
 * to it, and it is still one press just before the beat - which is the whole
 * of what a reader has to do with it.
 */
const GRACE_TICKS = Duration.SIXTEENTH.ticks;

/** Each run of chorded graces is one press, and one press needs one slot. */
function graceSlots(graces: readonly XmlNode[]): XmlNode[][] {
  const slots: XmlNode[][] = [];
  for (const grace of graces) {
    const last = slots[slots.length - 1];
    if (hasChild(grace, 'chord') && last !== undefined) {
      last.push(grace);
    } else {
      slots.push([grace]);
    }
  }
  return slots;
}

/**
 * Fits grace notes into the time in front of the note they lean on.
 *
 * *In front of*, not out of it. A grace note is played before the beat and
 * the note it leans on stays on the beat - which is exactly what a reader is
 * being asked to do, and what taking the time from the host got wrong: every
 * note after the ornament arrived late, and the beat is the one thing a
 * sight-reading trainer must not move.
 *
 * So the time comes from whatever was sounding before, which is where a
 * performer takes it from too. Returns `null` when it cannot be had - nothing
 * before it in the bar, too little of it, or a tuplet whose group would come
 * apart - and then the ornament is dropped rather than the beat.
 */
function fitGracesBefore(
  graces: readonly XmlNode[],
  hostOnsetTicks: number,
  before: readonly RawNote[],
  at: { readonly staff: number; readonly voice: number },
): { readonly notes: RawNote[]; readonly shortened: readonly RawNote[] } | null {
  const slots = graceSlots(graces);
  const wanted = slots.length * GRACE_TICKS;
  const host = before[0];
  if (host === undefined || host.staff !== at.staff || host.voice !== at.voice) {
    return null;
  }
  const left = host.ticks - wanted;
  if (left < GRACE_TICKS || host.duration.isTuplet || !Duration.isNotatable(left)) {
    return null;
  }

  const shortened = before.map((note) => ({
    ...note,
    ticks: left,
    duration: Duration.fromTicks(left),
  }));

  const notes: RawNote[] = [];
  slots.forEach((slot, index) => {
    const onsetTicks = hostOnsetTicks - wanted + index * GRACE_TICKS;
    slot.forEach((grace, inChord) => {
      notes.push({
        staff: childNumber(grace, 'staff') ?? at.staff,
        voice: childNumber(grace, 'voice') ?? at.voice,
        onsetTicks,
        ticks: GRACE_TICKS,
        duration: Duration.of('16th'),
        pitch: readPitch(grace),
        tieStart: false,
        fermata: false,
        breath: false,
        isChord: inChord > 0,
        beams: [],
        stem: readStem(grace),
        arpeggiated: false,
      });
    });
  });

  return { notes, shortened };
}

function readMeasureNotes(
  measure: XmlNode,
  measureIndex: number,
  header: ScoreHeader,
  warnings: ImportWarning[],
  pedalMarks: PedalMark[] = [],
): RawNote[] {
  const notes: RawNote[] = [];
  let cursor = 0;
  let previousOnset = 0;
  /** One of the file's divisions, in ours: the finest number it can write. */
  const roundingTicks = DIVISIONS_PER_QUARTER / Math.max(1, header.divisions);
  const pendingGraces: XmlNode[] = [];
  /** The notes sounding immediately before here: one, or a chord of them. */
  let lastNotes: RawNote[] = [];
  const sayOnce = (detail: string): void => {
    if (!warnings.some((warning) => warning.kind === 'grace-notes')) {
      warnings.push({ kind: 'grace-notes', detail });
    }
  };

  for (const node of measure.children) {
    if (node.name === 'backup' || node.name === 'forward') {
      const amount = childNumber(node, 'duration') ?? 0;
      const ticks = toTicks(amount, header.divisions, `Bar ${measureIndex + 1}`);
      cursor += node.name === 'backup' ? -ticks : ticks;
      // Somewhere else entirely: nothing is sounding immediately before here.
      lastNotes = [];
      continue;
    }
    if (node.name === 'direction') {
      // Directions sit between notes, so the cursor is already where the mark
      // belongs - which is the only way to place a pedal at all.
      const pedal = child(child(node, 'direction-type'), 'pedal');
      const type = attribute(pedal, 'type');
      if (type === 'start' || type === 'stop') {
        pedalMarks.push({ measureIndex, offsetTicks: cursor, type });
      }
      continue;
    }
    if (node.name !== 'note') {
      continue;
    }
    if (hasChild(node, 'grace')) {
      // Held until the note they lean on arrives: only then is it known how
      // much time there is to take from it.
      pendingGraces.push(node);
      continue;
    }

    const where = `Bar ${measureIndex + 1}`;
    const isChord = hasChild(node, 'chord');
    const rawDuration = childNumber(node, 'duration');
    const isWholeMeasureRest =
      hasChild(node, 'rest') && attribute(child(node, 'rest'), 'measure') === 'yes';
    const ticks =
      rawDuration === null && isWholeMeasureRest
        ? barTicksAt(header, measureIndex)
        : toTicks(rawDuration ?? 0, header.divisions, where);

    const staff = childNumber(node, 'staff') ?? 1;
    const voice = childNumber(node, 'voice') ?? 1;

    // A grace note is played, so it needs time - and it takes it from what was
    // sounding *before*, not from the note it leans on. The note it leans on
    // has to stay on its beat, which is the one thing a sight-reading trainer
    // must not move.
    if (pendingGraces.length > 0 && !isChord) {
      const fitted = fitGracesBefore(pendingGraces, cursor, lastNotes, { staff, voice });
      if (fitted === null) {
        sayOnce(
          `A grace note was dropped, first in bar ${measureIndex + 1}: there was nothing before it to take its time from, and an ornament missing is a smaller loss than every note after it being off the beat.`,
        );
      } else {
        for (const shortened of fitted.shortened) {
          const at = notes.indexOf(lastNotes[fitted.shortened.indexOf(shortened)] as RawNote);
          if (at >= 0) {
            notes[at] = shortened;
          }
        }
        notes.push(...fitted.notes);
        sayOnce(
          'Grace notes were written as sixteenths, taking their time from the note before them so the note they lean on keeps its beat.',
        );
      }
      pendingGraces.length = 0;
    }

    const duration =
      isWholeMeasureRest && !Duration.isNotatable(ticks)
        ? Duration.WHOLE
        : readDuration(node, ticks, where, roundingTicks);
    // A tuplet the file could not divide evenly moves the cursor by what it is
    // written as, not by the rounded number beside it. The group adds up to
    // the same beat either way, but positions taken from the roundings drift
    // inside it - and a drift of a division is a hole the next note has to be
    // padded across, which is how a bar of sevens became unwritable.
    const ownTicks = duration.isTuplet ? duration.ticks : ticks;
    const onsetTicks = isChord ? previousOnset : cursor;
    const pushed: RawNote = {
      staff,
      voice,
      onsetTicks,
      ticks: ownTicks,
      duration,
      pitch: readPitch(node),
      tieStart: hasTie(node, 'start'),
      isChord,
      beams: isChord ? [] : readBeams(node),
      stem: readStem(node),
      arpeggiated: hasChild(child(node, 'notations'), 'arpeggiate'),
      // Two of the writer's own instructions, and the page has been dropping
      // both: a fermata says hold this longer and a comma says lift after
      // it. Neither is a number - how much longer, and how long a lift, are
      // the performer's - which is exactly why they belong on the page and
      // cannot be turned into rhythm here.
      fermata: hasChild(child(node, 'notations'), 'fermata'),
      breath: hasChild(child(child(node, 'notations'), 'articulations'), 'breath-mark'),
    };
    notes.push(pushed);

    if (isChord) {
      lastNotes.push(pushed);
    } else {
      // What a grace note arriving next would take its time from.
      lastNotes.length = 0;
      lastNotes.push(pushed);
      previousOnset = cursor;
      cursor += ownTicks;
    }
  }

  return notes;
}

/** Turns the notes of one staff and measure into entries that fill the bar. */
/**
 * The values a note is worth, which is usually the one it is written as.
 *
 * A file may write a note as one value and give it the duration of another -
 * MuseScore leaves a whole note looking whole while sounding a shade less, to
 * make room for what follows. The duration is the truth about the music, so a
 * span that is not a single value becomes several tied together, exactly as a
 * writer would have to notate it.
 *
 * Tuplets are left alone: their value is decided by the group they belong to,
 * and the numbers beside them are that group's rounding rather than a
 * disagreement - see {@link readDuration}.
 */
function soundedValues(note: RawNote): readonly Duration[] {
  if (note.duration.isTuplet || note.duration.ticks === note.ticks || note.ticks <= 0) {
    return [note.duration];
  }
  try {
    return splitIntoRests(note.ticks);
  } catch {
    // Nothing can tile it - a span between the values there are. The written
    // value is the better answer than refusing the file over one note.
    return [note.duration];
  }
}

function buildMeasure(
  notes: readonly RawNote[],
  isPickup: boolean,
  ticksPerMeasure: number,
): Measure {
  const byOnset = new Map<number, RawNote[]>();
  for (const note of notes) {
    byOnset.set(note.onsetTicks, [...(byOnset.get(note.onsetTicks) ?? []), note]);
  }

  const entries: MusicalEntry[] = [];
  let cursor = 0;
  const onsets = [...byOnset.keys()].sort((left, right) => left - right);

  for (const onset of onsets) {
    const group = byOnset.get(onset) ?? [];
    const first = group[0];
    if (first === undefined) {
      continue;
    }
    if (onset > cursor) {
      // A gap the writer left rather than filled: they wrote no rest here, so
      // none is drawn. If nothing else on the staff covers it either, it
      // becomes one again in {@link restStaffThatFallsSilent}.
      for (const gap of splitIntoRests(onset - cursor)) {
        entries.push(silenceEntry(gap));
      }
      cursor = onset;
    }
    const pitches = group
      .map((note) => note.pitch)
      .filter((pitch): pitch is Pitch => pitch !== null);
    // What it *sounds*, which is not always what it is written as: a note may
    // carry a `<type>` of one value and a `<duration>` of another, and the
    // duration is the truth about the music. Written as the type alone, the
    // bar adds up to more than the metre allows and the whole file is
    // refused - which is how the reader lost a score over one bar of it.
    const values = soundedValues(first);
    if (pitches.length === 0) {
      for (const value of values) {
        entries.push(restEntry(value));
      }
    } else {
      const tied = group
        .filter((note) => note.tieStart && note.pitch !== null)
        .map((note) => note.pitch?.midi ?? 0);
      // The roll belongs to the chord, so any note carrying the mark rolls
      // it - and so do the hold and the breath, for the same reason: a
      // writer marks one note of a chord and means the chord.
      const rolled = group.some((note) => note.arpeggiated);
      const held = pitches.map((pitch) => pitch.midi);
      values.forEach((value, at) => {
        const last = at === values.length - 1;
        entries.push(
          // Everything but the last piece holds into the one after it, which
          // is what makes the pieces one press rather than several notes.
          // The writer's own marks belong to the first: they were written
          // once, over the note as they wrote it.
          noteEntry(
            pitches,
            value,
            last ? tied : held,
            at === 0 ? first.beams : [],
            first.stem,
            at === 0 && rolled,
            at === 0
              ? {
                  fermata: group.some((note) => note.fermata),
                  breath: group.some((note) => note.breath),
                }
              : {},
          ),
        );
      });
    }
    cursor += values.reduce((total, value) => total + value.ticks, 0);
  }

  if (cursor < ticksPerMeasure) {
    // The voice stops before the bar line does. In piano writing that is
    // ordinary - an inner line drops out while the melody plays on - and the
    // engraver draws nothing for it, so neither do we. Whether the *staff* is
    // left blank is a question about all its voices at once, and is answered
    // in {@link restStaffThatFallsSilent}.
    const padding = splitIntoRests(ticksPerMeasure - cursor).map((gap) => silenceEntry(gap));
    // A pickup's notes belong at the *end* of its bar - padding the tail
    // instead would move every downbeat that follows. Asked of the bar rather
    // than of this voice: a first bar is only a pickup when it is short for
    // everybody, and one inner line that stops early in bar one is an ordinary
    // absence whose notes must stay where they were written.
    entries.splice(isPickup ? 0 : entries.length, 0, ...padding);
  }

  return measureOf(entries);
}

/**
 * Every part of the score, laid out one staff after another.
 *
 * A piano piece is usually one part of two staves, but an exporter may
 * write the hands as two parts of one staff each - senbonzakura is - and
 * reading only the first of those is reading only one hand. Because it
 * *did* open, that was worse than a refusal: the reader had half the music
 * and nothing to tell them so but a warning.
 *
 * Key, metre and its changes come from the first part, since bar lengths
 * have to agree across the score for it to be one piece of music at all;
 * divisions and clefs are read per part, because those are the part's own.
 * A part that disagrees about how many bars there are is not read, and said
 * so - the alternative is refusing a file that is otherwise sound.
 */
function readEveryPart(
  parts: readonly XmlNode[],
  bars: number,
  header: ScoreHeader,
  warnings: ImportWarning[],
): { readonly staves: readonly StaffPart[]; readonly pedalMarks: readonly PedalMark[] } {
  const staves: StaffPart[] = [];
  const pedalMarks: PedalMark[] = [];

  for (const [index, part] of parts.entries()) {
    const measures = childrenNamed(part, 'measure');
    if (index > 0 && measures.length !== bars) {
      warnings.push({
        kind: 'extra-parts',
        detail: `A part with ${measures.length} bars was left out; the first has ${bars}.`,
      });
      continue;
    }
    const forThisPart = index === 0 ? header : { ...header, ...readPartAttributes(measures, warnings) };
    const built = buildStaves(measures, forThisPart, warnings);
    // Staff numbers carry on where the last part's left off, and so do voice
    // numbers: a staff number groups voices onto one printed staff, and two
    // parts share neither.
    const staffOffset = new Set(staves.map((staff) => staff.staffNumber)).size;
    const voiceOffset = staves.length;
    for (const staff of built.staves) {
      staves.push({
        ...staff,
        staffNumber: staff.staffNumber + staffOffset,
        voice: staff.voice + voiceOffset,
      });
    }
    // The pedal belongs to the instrument, and whichever part carried the
    // marks meant them for all of it.
    pedalMarks.push(...built.pedalMarks);
  }

  return { staves, pedalMarks };
}

/** What a part says about itself: how finely it counts, and its clefs. */
function readPartAttributes(
  measures: readonly XmlNode[],
  warnings: ImportWarning[],
): Pick<ScoreHeader, 'divisions' | 'clefByStaff' | 'clefChangesByStaff' | 'staffCount'> {
  const attributes = child(measures[0] ?? null, 'attributes');
  const divisions = childNumber(attributes, 'divisions');
  const clefChangesByStaff = new Map<number, ClefChange[]>();
  measures.forEach((measure, measureIndex) => {
    if (measureIndex === 0) {
      return;
    }
    for (const [staffNumber, clef] of readClefs(child(measure, 'attributes'), warnings)) {
      clefChangesByStaff.set(staffNumber, [
        ...(clefChangesByStaff.get(staffNumber) ?? []),
        { measureIndex, clef },
      ]);
    }
  });
  return {
    divisions: divisions === null || divisions <= 0 ? DIVISIONS_PER_QUARTER : divisions,
    clefByStaff: readClefs(attributes, warnings),
    clefChangesByStaff,
    staffCount: Math.max(1, childNumber(attributes, 'staves') ?? 1),
  };
}

function buildStaves(
  measures: readonly XmlNode[],
  header: ScoreHeader,
  warnings: ImportWarning[],
): { readonly staves: readonly StaffPart[]; readonly pedalMarks: readonly PedalMark[] } {
  const pedalMarks: PedalMark[] = [];
  const perMeasure = measures.map((measure, index) =>
    readMeasureNotes(measure, index, header, warnings, pedalMarks),
  );

  // One part per voice of each staff, rather than one per staff. Two voices on
  // a staff is how piano writing puts an inner line under a melody, and saying
  // so directly beats flattening them: a held note stays a held note instead of
  // becoming a chain of tied fragments, and two voices in different rhythms -
  // triplets against duples - simply keep their own.
  const pairs = new Map<string, { readonly staff: number; readonly voice: number }>();
  for (const notes of perMeasure) {
    for (const note of notes) {
      pairs.set(`${note.staff}:${note.voice}`, { staff: note.staff, voice: note.voice });
    }
  }
  if (pairs.size === 0) {
    pairs.set('1:1', { staff: 1, voice: 1 });
  }

  // A first bar that nobody fills is an anacrusis. Read across every voice at
  // once, because that is what makes it one: a bar where a single inner line
  // stops early is just an absence, and pushing its notes to the end of the
  // bar would move music the writer put on the downbeat.
  const firstBar = perMeasure[0] ?? [];
  const pickup =
    firstBar.length > 0 &&
    firstBar.every((note) => note.onsetTicks + note.ticks < barTicksAt(header, 0));

  const ordered = [...pairs.values()].sort(
    (left, right) => left.staff - right.staff || left.voice - right.voice,
  );
  const staffNumbers = [...new Set(ordered.map((pair) => pair.staff))].sort(
    (left, right) => left - right,
  );
  const extra = ordered.length - staffNumbers.length;
  if (extra > 0) {
    warnings.push({
      kind: 'extra-voices',
      detail: `${extra} extra voice${extra === 1 ? '' : 's'} were kept as their own lines.`,
    });
  }

  const parts = ordered.map((pair, index) => {
    const built = perMeasure.map((notes, measureIndex) => {
      const mine = notes.filter(
        (note) => note.staff === pair.staff && note.voice === pair.voice,
      );
      // Absent, not resting: a voice that says nothing in a bar is left out of
      // it, so the page does not carry a rest for every bar it sits out.
      if (mine.length === 0) {
        return measureOf([]);
      }
      return buildMeasure(mine, pickup && measureIndex === 0, barTicksAt(header, measureIndex));
    });

    return {
      // Voice numbers only have to tell the parts apart, and the file's own
      // may repeat across staves.
      staffNumber: staffNumbers.indexOf(pair.staff) + 1,
      voice: index + 1,
      clef:
        header.clefByStaff.get(pair.staff) ??
        (staffNumbers.indexOf(pair.staff) === 0 ? 'treble' : 'bass'),
      clefChanges: header.clefChangesByStaff.get(pair.staff) ?? [],
      measures: dropTiesThatLeadNowhere(built, warnings),
    } satisfies StaffPart;
  });

  return {
    staves: restStaffThatFallsSilent(parts, (bar) => barTicksAt(header, bar), warnings),
    pedalMarks,
  };
}

/** A half-open span of one bar, in divisions. */
type Span = readonly [number, number];

/** What the voices of one staff leave undrawn in one bar. */
function holesIn(onStaff: readonly StaffPart[], bar: number, total: number): readonly Span[] {
  const drawn: Span[] = [];
  for (const part of onStaff) {
    let cursor = 0;
    for (const entry of part.measures[bar]?.entries ?? []) {
      const ends = cursor + entry.duration.ticks;
      if (entry.kind !== 'silence') {
        drawn.push([cursor, ends]);
      }
      cursor = ends;
    }
  }
  drawn.sort((left, right) => left[0] - right[0]);

  const holes: Span[] = [];
  let reached = 0;
  for (const [from, to] of drawn) {
    if (from > reached) {
      holes.push([reached, from]);
    }
    reached = Math.max(reached, to);
  }
  if (reached < total) {
    holes.push([reached, total]);
  }
  return holes;
}

/** The part of `span` that falls inside `hole`, or null where they miss. */
function overlap(span: Span, hole: Span): Span | null {
  const from = Math.max(span[0], hole[0]);
  const to = Math.min(span[1], hole[1]);
  return from < to ? [from, to] : null;
}

/**
 * Draws the rests a staff cannot do without, and only those.
 *
 * A voice may be absent from a bar or from part of one - that is how a sparse
 * inner line stays sparse instead of littering the page with rests nobody
 * wrote. But an absence is only legible while some other voice on the staff is
 * playing there. Where none is, that stretch of staff would be blank, and
 * blank staff is not something a reader can count: it is a hole. So the holes
 * are found across the whole staff at once, and the first voice on it draws
 * rests through them - only the first, or the bar would show one rest per
 * voice.
 */
function restStaffThatFallsSilent(
  parts: readonly StaffPart[],
  ticksPerMeasure: (measureIndex: number) => number,
  warnings: ImportWarning[],
): readonly StaffPart[] {
  const bars = parts[0]?.measures.length ?? 0;
  const repairs = new Map<number, Map<number, readonly Span[]>>();

  for (let bar = 0; bar < bars; bar += 1) {
    for (const staffNumber of new Set(parts.map((part) => part.staffNumber))) {
      const onStaff = parts.filter((part) => part.staffNumber === staffNumber);
      const holes = holesIn(onStaff, bar, ticksPerMeasure(bar));
      const carrier = onStaff[0];
      if (holes.length === 0 || carrier === undefined) {
        continue;
      }
      const byBar = repairs.get(carrier.voice) ?? new Map<number, readonly Span[]>();
      byBar.set(bar, holes);
      repairs.set(carrier.voice, byBar);
      warnings.push({
        kind: 'padded-measure',
        detail: `Bar ${bar + 1} left staff ${staffNumber} blank, and was given rests.`,
      });
    }
  }

  if (repairs.size === 0) {
    return parts;
  }
  return parts.map((part) => {
    const byBar = repairs.get(part.voice);
    if (byBar === undefined) {
      return part;
    }
    return {
      ...part,
      measures: part.measures.map((measure, index) => {
        const holes = byBar.get(index);
        if (holes === undefined) {
          return measure;
        }
        // An absent voice has nothing to rewrite, so it is read as one silence
        // over the whole bar - which is what it means.
        const source =
          measure.entries.length > 0
            ? measure.entries
            : splitIntoRests(ticksPerMeasure(index)).map((gap) => silenceEntry(gap));
        return measureOf(drawThrough(source, holes));
      }),
    };
  });
}

/** Rewrites the silences of one voice into rests wherever a hole needs one. */
function drawThrough(
  entries: readonly MusicalEntry[],
  holes: readonly Span[],
): readonly MusicalEntry[] {
  const rewritten: MusicalEntry[] = [];
  let cursor = 0;
  for (const entry of entries) {
    const span: Span = [cursor, cursor + entry.duration.ticks];
    cursor = span[1];
    if (entry.kind !== 'silence') {
      rewritten.push(entry);
      continue;
    }
    // Only the parts of this silence that fall in a hole become rests; the
    // rest of it stays silent, because another voice is drawing there.
    let at = span[0];
    for (const hole of holes) {
      const inside = overlap(span, hole);
      if (inside === null) {
        continue;
      }
      for (const gap of splitIntoRests(inside[0] - at)) {
        rewritten.push(silenceEntry(gap));
      }
      for (const rest of splitIntoRests(inside[1] - inside[0])) {
        rewritten.push(restEntry(rest));
      }
      at = inside[1];
    }
    for (const gap of splitIntoRests(span[1] - at)) {
      rewritten.push(silenceEntry(gap));
    }
  }
  return rewritten;
}

/**
 * Removes ties whose other end did not survive the import.
 *
 * A tie into a dropped voice or a padded rest would otherwise fail validation
 * and take the whole file down with it. Losing the tie costs one held note;
 * refusing the score costs the reader the piece.
 */
function dropTiesThatLeadNowhere(
  measures: readonly Measure[],
  warnings: ImportWarning[],
): readonly Measure[] {
  const flat = measures.flatMap((measure) => measure.entries);
  let dropped = 0;

  const cleaned = measures.map((measure) =>
    measureOf(
      measure.entries.map((entry) => {
        if (entry.kind !== 'note' || entry.tiedForward.length === 0) {
          return entry;
        }
        const position = flat.indexOf(entry);
        const next = flat[position + 1];
        const kept = entry.tiedForward.filter(
          (midi) =>
            next !== undefined &&
            next.kind === 'note' &&
            next.pitches.some((pitch) => pitch.midi === midi),
        );
        dropped += entry.tiedForward.length - kept.length;
        return kept.length === entry.tiedForward.length
          ? entry
          : noteEntry(
              entry.pitches,
              entry.duration,
              kept,
              entry.beams,
              entry.stem,
              entry.arpeggiated,
              { fermata: entry.fermata, breath: entry.breath },
            );
      }),
    ),
  );

  if (dropped > 0) {
    warnings.push({
      kind: 'dropped-tie',
      detail: `${dropped} tie${dropped === 1 ? '' : 's'} had no note to continue into and were dropped.`,
    });
  }
  return cleaned;
}

/** Every note type this reader understands, for error messages and tests. */
export const READABLE_NOTE_TYPES: readonly NoteTypeName[] = NOTE_TYPES;

import { DomainError } from '../../shared/errors.js';
import { CLEF_DEFINITIONS, type ClefKind } from '../model/Clef.js';
import { DIVISIONS_PER_QUARTER, Duration, NOTE_TYPES, type NoteTypeName } from '../model/Duration.js';
import type { Exercise, Measure, MusicalEntry, StaffPart } from '../model/Exercise.js';
import { BEAM_TYPES, measureOf, noteEntry, restEntry, validateExercise } from '../model/Exercise.js';
import type { Beam, BeamType } from '../model/Exercise.js';
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
    | 'padded-measure';
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
}

const XML_TYPE_NAMES: Readonly<Record<string, NoteTypeName>> = {
  whole: 'whole',
  half: 'half',
  quarter: 'quarter',
  eighth: 'eighth',
  '16th': '16th',
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
  if (parts.length > 1) {
    warnings.push({
      kind: 'extra-parts',
      detail: `Only the first of ${parts.length} parts was read.`,
    });
  }

  const measures = childrenNamed(part, 'measure');
  if (measures.length === 0) {
    throw new DomainError('This part has no measures.');
  }

  const header = readHeader(measures, warnings);
  const staves = buildStaves(measures, header, warnings);

  const exercise: Exercise = {
    id: `import-${Date.now().toString(36)}`,
    title: readTitle(score),
    key: header.key,
    timeSignature: header.timeSignature,
    tempoBpm: header.tempoBpm,
    staves,
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
  readonly tempoBpm: number;
  readonly clefByStaff: ReadonlyMap<number, ClefKind>;
  readonly staffCount: number;
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
  const clefByStaff = new Map<number, ClefKind>();
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
    clefByStaff.set(Number.isFinite(number) ? number : 1, kind ?? 'treble');
  }

  // An attributes block after the first would change key, metre or clef
  // partway through, and the exercise carries only one of each.
  if (measures.slice(1).some((measure) => hasChild(measure, 'attributes'))) {
    warnings.push({
      kind: 'changing-attributes',
      detail: 'Key, metre or clef changes partway through were ignored.',
    });
  }

  return {
    divisions,
    key: new KeySignature(fifths, mode satisfies KeyMode),
    timeSignature: new TimeSignature(beats, beatType),
    tempoBpm: readTempo(measures),
    clefByStaff,
    staffCount: Math.max(1, staffCount),
  };
}

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
  return 72;
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

function readDuration(note: XmlNode, ticks: number, where: string): Duration {
  const typeText = childText(note, 'type');
  // An unknown type name (32nd, breve) reads as absent, and the tick count
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
    if (duration.ticks !== ticks) {
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
    `${where} is a rhythmic value this trainer cannot write - it reads down to sixteenth notes, one dot and triplets.`,
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
function readMeasureNotes(
  measure: XmlNode,
  measureIndex: number,
  header: ScoreHeader,
  warnings: ImportWarning[],
): RawNote[] {
  const notes: RawNote[] = [];
  let cursor = 0;
  let previousOnset = 0;
  let sawGrace = false;

  for (const node of measure.children) {
    if (node.name === 'backup' || node.name === 'forward') {
      const amount = childNumber(node, 'duration') ?? 0;
      const ticks = toTicks(amount, header.divisions, `Bar ${measureIndex + 1}`);
      cursor += node.name === 'backup' ? -ticks : ticks;
      continue;
    }
    if (node.name !== 'note') {
      continue;
    }
    if (hasChild(node, 'grace')) {
      if (!sawGrace) {
        sawGrace = true;
        warnings.push({
          kind: 'grace-notes',
          detail: `Grace notes were dropped, first in bar ${measureIndex + 1}.`,
        });
      }
      continue;
    }

    const where = `Bar ${measureIndex + 1}`;
    const isChord = hasChild(node, 'chord');
    const rawDuration = childNumber(node, 'duration');
    const isWholeMeasureRest =
      hasChild(node, 'rest') && attribute(child(node, 'rest'), 'measure') === 'yes';
    const ticks =
      rawDuration === null && isWholeMeasureRest
        ? header.timeSignature.ticksPerMeasure
        : toTicks(rawDuration ?? 0, header.divisions, where);

    const onsetTicks = isChord ? previousOnset : cursor;
    notes.push({
      staff: childNumber(node, 'staff') ?? 1,
      voice: childNumber(node, 'voice') ?? 1,
      onsetTicks,
      ticks,
      duration:
        isWholeMeasureRest && !Duration.isNotatable(ticks)
          ? Duration.WHOLE
          : readDuration(node, ticks, where),
      pitch: readPitch(node),
      tieStart: hasTie(node, 'start'),
      isChord,
      beams: isChord ? [] : readBeams(node),
    });

    if (!isChord) {
      previousOnset = cursor;
      cursor += ticks;
    }
  }

  return notes;
}

/** Turns the notes of one staff and measure into entries that fill the bar. */
function buildMeasure(
  notes: readonly RawNote[],
  measureIndex: number,
  ticksPerMeasure: number,
  warnings: ImportWarning[],
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
      for (const rest of splitIntoRests(onset - cursor)) {
        entries.push(restEntry(rest));
      }
      cursor = onset;
    }
    const pitches = group
      .map((note) => note.pitch)
      .filter((pitch): pitch is Pitch => pitch !== null);
    if (pitches.length === 0) {
      entries.push(restEntry(first.duration));
    } else {
      const tied = group
        .filter((note) => note.tieStart && note.pitch !== null)
        .map((note) => note.pitch?.midi ?? 0);
      entries.push(noteEntry(pitches, first.duration, tied, first.beams));
    }
    cursor += first.duration.ticks;
  }

  if (cursor < ticksPerMeasure) {
    const padding = splitIntoRests(ticksPerMeasure - cursor).map((rest) => restEntry(rest));
    warnings.push({
      kind: 'padded-measure',
      detail: `Bar ${measureIndex + 1} was short and was padded with rests.`,
    });
    // A short *first* bar is a pickup, and its notes belong at the end of it -
    // padding the tail instead would move every downbeat that follows.
    entries.splice(measureIndex === 0 ? 0 : entries.length, 0, ...padding);
  }

  return measureOf(entries);
}

function buildStaves(
  measures: readonly XmlNode[],
  header: ScoreHeader,
  warnings: ImportWarning[],
): readonly StaffPart[] {
  const perMeasure = measures.map((measure, index) =>
    readMeasureNotes(measure, index, header, warnings),
  );

  const staffNumbers = new Set<number>();
  for (const notes of perMeasure) {
    for (const note of notes) {
      staffNumbers.add(note.staff);
    }
  }
  if (staffNumbers.size === 0) {
    staffNumbers.add(1);
  }
  const ordered = [...staffNumbers].sort((left, right) => left - right);

  const staves = ordered.map((staffNumber, index) => {
    const voices = new Set<number>();
    for (const notes of perMeasure) {
      for (const note of notes) {
        if (note.staff === staffNumber) {
          voices.add(note.voice);
        }
      }
    }
    // The lowest voice number *this staff actually uses* - not `min(..., 1)`,
    // which would always be 1 and would silently empty a staff whose voice is
    // numbered 2, as the grand staff we write ourselves is.
    const primary = voices.size > 0 ? Math.min(...voices) : 1;
    if (voices.size > 1) {
      warnings.push({
        kind: 'extra-voices',
        detail: `Staff ${staffNumber} has ${voices.size} voices; only the first was read.`,
      });
    }

    const built = perMeasure.map((notes, measureIndex) =>
      buildMeasure(
        notes.filter((note) => note.staff === staffNumber && note.voice === primary),
        measureIndex,
        header.timeSignature.ticksPerMeasure,
        warnings,
      ),
    );

    return {
      staffNumber: index + 1,
      voice: index + 1,
      clef: header.clefByStaff.get(staffNumber) ?? (index === 0 ? 'treble' : 'bass'),
      measures: dropTiesThatLeadNowhere(built, warnings),
    } satisfies StaffPart;
  });

  return staves;
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
          : noteEntry(entry.pitches, entry.duration, kept, entry.beams);
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

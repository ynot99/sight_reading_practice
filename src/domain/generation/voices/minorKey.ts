import type { Measure, MusicalEntry, NoteEntry } from '../../model/Exercise.js';
import { measureOf } from '../../model/Exercise.js';
import type { KeySignature } from '../../model/KeySignature.js';
import type { Pitch } from '../../model/Pitch.js';

/** The seventh degree, counted from nought at the tonic. */
const SEVENTH = 6;
const SIXTH = 5;

/** A note a semitone higher on the same line or space: an accidental sharpening it. */
function sharpened(pitch: Pitch): Pitch {
  return pitch.withAlteration(pitch.alter === 1 ? 2 : pitch.alter === -1 ? 0 : 1);
}

/** Where one note of the line is, so it can be written back. */
interface Place {
  readonly measure: number;
  readonly entry: number;
  readonly note: NoteEntry;
}

/**
 * A minor line written the way minor is written: the seventh sharpened where
 * it rises to the tonic, and the sixth too where it rises to that seventh.
 *
 * The key signature of a minor key is its natural scale, and music in it does
 * not stay there: a seventh leading up to the tonic is a semitone below it,
 * which takes an accidental every time - the first accidentals a reader meets
 * are these. Going down, and anywhere else, the scale is left natural, as the
 * melodic minor has it.
 *
 * Never the far end of a tie: a tied note is one press with the note it is
 * tied from, and sharpening one end would write two pitches where the reader
 * holds one key. The near end needs no rule - a note tied on is followed by
 * itself, never by the note a step above.
 */
export function leadingUpInMinor(measures: readonly Measure[], key: KeySignature): Measure[] {
  if (key.mode !== 'minor') {
    return [...measures];
  }
  const line: Place[] = [];
  measures.forEach((measure, measureIndex) => {
    measure.entries.forEach((entry, entryIndex) => {
      if (entry.kind === 'note' && entry.pitches.length === 1) {
        line.push({ measure: measureIndex, entry: entryIndex, note: entry });
      }
    });
  });

  const raised = new Set<Place>();
  line.forEach((place, at) => {
    const next = line[at + 1];
    const pitch = place.note.pitches[0];
    const after = next?.note.pitches[0];
    if (pitch === undefined || after === undefined || heldFromTheLast(line, at)) {
      return;
    }
    if (key.degreeOf(pitch.diatonicIndex) !== SEVENTH || after.diatonicIndex !== pitch.diatonicIndex + 1) {
      return;
    }
    raised.add(place);
    const before = line[at - 1];
    const below = before?.note.pitches[0];
    if (
      before !== undefined &&
      below !== undefined &&
      below.diatonicIndex === pitch.diatonicIndex - 1 &&
      key.degreeOf(below.diatonicIndex) === SIXTH &&
      !heldFromTheLast(line, at - 1)
    ) {
      raised.add(before);
    }
  });

  if (raised.size === 0) {
    return [...measures];
  }
  return measures.map((measure, measureIndex) => {
    const entries = measure.entries.map((entry, entryIndex): MusicalEntry => {
      const place = [...raised].find((one) => one.measure === measureIndex && one.entry === entryIndex);
      if (place === undefined || entry.kind !== 'note') {
        return entry;
      }
      return { ...entry, pitches: entry.pitches.map(sharpened) };
    });
    return measureOf(entries);
  });
}

/** Whether a note is the far end of a tie, held on from the one before. */
function heldFromTheLast(line: readonly Place[], at: number): boolean {
  return (line[at - 1]?.note.tiedForward.length ?? 0) > 0;
}

/**
 * The pitch of a chord tone in a minor key, its seventh sharpened where the
 * chord is built on the fifth degree.
 *
 * The chord on the fifth degree is a major chord in a minor key - its third is
 * the leading note - and it is the chord a minor key is recognised by. Built
 * from the key signature alone it is minor, and the cadence it should make
 * is not there.
 */
export function chordToneInMinor(key: KeySignature, root: number, index: number): Pitch {
  const pitch = key.pitchAt(index);
  const onTheDominant = key.degreeOf(root) === 4;
  return key.mode === 'minor' && onTheDominant && key.degreeOf(index) === SEVENTH
    ? sharpened(pitch)
    : pitch;
}

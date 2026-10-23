import { floorMod } from '../../shared/asserts.js';
import { STEPS, alterationSign, type Alteration } from '../model/Pitch.js';
import { nameOfThePitchClass, type ChordKind } from './chordName.js';
import { thePitchClassesOfTheScale, type ScaleName } from './scales.js';

/**
 * What a chord does in its key, as a chart of the chords marks it to plan
 * by: rest (tonic), move away (subdominant), or pull back (dominant).
 *
 * Read off the degree its root is on, the three tonic chords being on the
 * first, third and sixth, the subdominant ones on the second and fourth, and
 * the dominant ones on the fifth and seventh. A chord whose root is no
 * degree of the scale - a flat seventh in a major key, say - does none of
 * them by this reading, and is said only to be outside the key.
 */
export type HarmonicFunction = 'tonic' | 'subdominant' | 'dominant';

const BY_THE_DEGREE: readonly HarmonicFunction[] = [
  'tonic',
  'subdominant',
  'tonic',
  'subdominant',
  'dominant',
  'tonic',
  'dominant',
];

/** A chord as it stands in a key: what it does there, if anything, and whether its every note is the key's. */
export interface ChordInTheKey {
  readonly function: HarmonicFunction | null;
  readonly ofTheKey: boolean;
}

/**
 * How a chord stands in a key: see `HarmonicFunction`. Its notes are the
 * key's where the scale has every one; a minor key has its raised sixth
 * and seventh as well, which its dominant and leading-note chords are made
 * with as a matter of course, and so are not borrowed from anywhere.
 */
export function theChordInTheKey(
  chord: { readonly root: number; readonly kind: ChordKind },
  key: { readonly fifths: number; readonly scale: ScaleName },
): ChordInTheKey {
  const scale = thePitchClassesOfTheScale(key.fifths, key.scale);
  const tonic = scale[0] ?? 0;
  const raised = key.scale === 'minor' ? [floorMod(tonic + 9, 12), floorMod(tonic + 11, 12)] : [];
  const degree = scale.indexOf(floorMod(chord.root, 12));
  return {
    function: degree < 0 ? null : (BY_THE_DEGREE[degree] ?? null),
    ofTheKey: chord.kind.intervals.every((step) => {
      const tone = floorMod(chord.root + step, 12);
      return scale.includes(tone) || raised.includes(tone);
    }),
  };
}

/** The pitch class of each letter unaltered. */
const NATURAL: readonly number[] = [0, 2, 4, 5, 7, 9, 11];

/**
 * How many letters above its root a note of a kind of chord is written: a
 * third two, whatever its size, a fifth four, a seventh six - the
 * diminished seventh's too, though it sounds as a sixth does.
 */
function theLettersAbove(semitones: number, kind: ChordKind): number {
  if (semitones === 9) {
    return kind.intervals.includes(6) && !kind.intervals.includes(10) ? 6 : 5;
  }
  return [0, 1, 1, 2, 2, 3, 4, 4, 4, 5, 6, 6][floorMod(semitones, 12)] ?? 0;
}

/**
 * The names of a chord's notes from its root up: the root as a key with so
 * many sharps or flats spells it, and the rest stacked on it a letter for
 * each step - so E major in A minor is E G♯ B, not E A♭ B. A root has one
 * sharp or flat at most and no kind's step is more than one from the
 * letters', so none needs more than two.
 */
export function theNotesOfTheChordNamed(
  chord: { readonly root: number; readonly kind: ChordKind },
  fifths: number,
): readonly string[] {
  const rootName = nameOfThePitchClass(chord.root, fifths);
  const rootLetter = STEPS.findIndex((step) => rootName.startsWith(step));
  return chord.kind.intervals.map((semitones) => {
    const letter = floorMod(rootLetter + theLettersAbove(semitones, chord.kind), STEPS.length);
    const off = floorMod(chord.root + semitones - (NATURAL[letter] ?? 0), 12);
    return `${STEPS[letter] ?? ''}${alterationSign((off > 6 ? off - 12 : off) as Alteration)}`;
  });
}

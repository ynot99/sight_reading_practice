import { floorMod } from '../../shared/asserts.js';
import type { KeySignature } from '../model/KeySignature.js';
import { STEPS } from '../model/Pitch.js';
import { nameTheChord } from './chordName.js';

/** A chord built on a degree of a key, as the palette offers it to write. */
export interface ChordOfTheKey {
  /** Its degree in roman numerals: upper case where its third is major, lower where minor, ° where diminished. */
  readonly numeral: string;
  /** What it is called, spelled as the key spells its black keys. */
  readonly name: string;
  /** Its keys, root first, the root in the octave of middle C. */
  readonly midis: readonly number[];
}

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

/**
 * The keys of a chord as a palette keeps it: each once, low to high. Where
 * and how often a key was struck in the notes it was taken from is the
 * figure, not the chord.
 */
export function eachKeyOnce(midis: readonly number[]): readonly number[] {
  return [...new Set(midis)].sort((low, high) => low - high);
}

/** Whether two chords are the same keys, each once. */
export function sameKeys(one: readonly number[], other: readonly number[]): boolean {
  const left = eachKeyOnce(one);
  const right = eachKeyOnce(other);
  return left.length === right.length && left.every((midi, at) => midi === right[at]);
}

/** Middle C as a staff position: the fourth octave, counted in letters. */
const MIDDLE_C_INDEX = 4 * STEPS.length;

/**
 * The seven triads a key is made of, one on each degree of its scale, from
 * the tonic up: the key's own notes stacked in thirds, so a minor key's are
 * its natural minor's, as its signature has them.
 *
 * Every root is put in the octave of middle C rather than above the tonic,
 * so whatever the key the chords stand in one place on the keyboard, and the
 * seventh of B major is not written an octave above the first of C.
 */
export function theChordsOfTheKey(key: KeySignature): readonly ChordOfTheKey[] {
  const tonic = key.tonicIndexAtOrAbove(MIDDLE_C_INDEX);
  return NUMERALS.map((numeral, degree) => {
    const root = MIDDLE_C_INDEX + floorMod(tonic + degree - MIDDLE_C_INDEX, STEPS.length);
    const midis = [root, root + 2, root + 4].map((index) => key.pitchAt(index).midi);
    const [first = 0, third = 0, fifth = 0] = midis;
    const quality = third - first === 4 ? numeral : numeral.toLowerCase();
    return {
      numeral: fifth - first === 6 ? `${quality}°` : quality,
      name: nameTheChord(midis, key.fifths) ?? '',
      midis,
    };
  });
}

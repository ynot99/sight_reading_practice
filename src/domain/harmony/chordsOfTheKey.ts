import { floorMod } from '../../shared/asserts.js';
import { KeySignature } from '../model/KeySignature.js';
import { STEPS, alterationSign, stepAt, type Alteration } from '../model/Pitch.js';
import { nameOfThePitchClass, nameTheChord } from './chordName.js';
import { theTonicOfTheScale, thePitchClassesOfTheScale, type ScaleName } from './scales.js';

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

/**
 * Two lists of kept chords brought together, where each may have kept some
 * and let go of some since they were last the same (`inStep`): the other
 * list (`theirs`), less what this one (`mine`) let go of since, with what it
 * kept since after it. Nothing is a conflict, since a chord has nothing in it
 * to change. With no list once the same, nothing here was let go of; with no
 * other list at all, this one is the list.
 */
export function theChordsMerged(
  theirs: readonly (readonly number[])[] | null,
  mine: readonly (readonly number[])[],
  inStep: readonly (readonly number[])[] | null,
): readonly (readonly number[])[] {
  if (theirs === null) {
    return mine;
  }
  const among = (list: readonly (readonly number[])[], chord: readonly number[]): boolean =>
    list.some((other) => sameKeys(other, chord));
  const before = inStep ?? [];
  const letGo = before.filter((chord) => !among(mine, chord));
  const keptSince = mine.filter((chord) => !among(before, chord) && !among(theirs, chord));
  return [...theirs.filter((chord) => !among(letGo, chord)), ...keptSince];
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
  return theChordsOfTheScale(key.fifths, key.mode);
}

/**
 * The seven triads of a scale written with a key signature, as for a key
 * (see `theChordsOfTheKey`): its own notes stacked in thirds, so a harmonic
 * minor's fifth is major and a dorian's fourth is. A note the scale raises
 * past its signature is taken a semitone up from the signature's, and its
 * root is named by its own letter - G sharp in A harmonic minor, never the A
 * flat a chart would call that key. Augmented, a triad is marked +.
 */
export function theChordsOfTheScale(fifths: number, scale: ScaleName): readonly ChordOfTheKey[] {
  const signature = KeySignature.major(fifths);
  const { step } = theTonicOfTheScale(fifths, scale);
  let tonic = MIDDLE_C_INDEX;
  while (STEPS[floorMod(tonic, STEPS.length)] !== step) {
    tonic += 1;
  }
  const pitchClasses = thePitchClassesOfTheScale(fifths, scale);
  /** How far a staff position's note in the scale is from the signature's: a semitone up where the scale raises it. */
  const raisedBy = (index: number): number => {
    const written = signature.pitchAt(index).midi;
    const wanted = pitchClasses[floorMod(index - tonic, STEPS.length)] ?? 0;
    return floorMod(wanted - written + 6, 12) - 6;
  };
  const scaleNote = (index: number): number => signature.pitchAt(index).midi + raisedBy(index);
  return NUMERALS.map((numeral, degree) => {
    const root = MIDDLE_C_INDEX + floorMod(tonic + degree - MIDDLE_C_INDEX, STEPS.length);
    const midis = [root, root + 2, root + 4].map(scaleNote);
    const [first = 0, third = 0, fifth = 0] = midis;
    const quality = third - first === 4 ? numeral : numeral.toLowerCase();
    const charted = nameTheChord(midis, fifths) ?? '';
    const step = stepAt(root);
    const spelled = `${step}${alterationSign((signature.alterationFor(step) + raisedBy(root)) as Alteration)}`;
    const asCharted = nameOfThePitchClass(first, fifths);
    return {
      numeral: fifth - first === 6 ? `${quality}°` : fifth - first === 8 ? `${quality}+` : quality,
      name: charted.startsWith(asCharted) ? `${spelled}${charted.slice(asCharted.length)}` : charted,
      midis,
    };
  });
}

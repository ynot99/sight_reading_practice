import type { KeySignature } from '../model/KeySignature.js';
import { Pitch } from '../model/Pitch.js';
import { elementAt } from '../../shared/asserts.js';

/**
 * The cadence tonic - subdominant - dominant - tonic in the hand position a
 * keyboard harmony lesson begins with: three voices over the tonic, as steps
 * of the scale from it, the tonic held where it is common and the rest
 * moving by a step; and under them the roots, as steps from the tonic an
 * octave lower. The key's own sound in four chords - which is why a
 * dictation begins with it, and a scale complex ends with it.
 */
export const THE_CADENCE = {
  upper: [
    [0, 2, 4],
    [0, 3, 5],
    [-1, 1, 4],
    [0, 2, 4],
  ],
  bass: [0, -4, -3, 0],
} as const;

/** Steps of a scale to the octave. */
export const OCTAVE = 7;

/** The leading note, as a step from the tonic within the octave. */
export const THE_SEVENTH = 6;

/**
 * Where the right hand finds a key's tonic: the first at or above the A under
 * middle C, so no key climbs far up the treble staff.
 */
export function theTonicOfTheHand(key: KeySignature): number {
  return key.tonicIndexAtOrAbove(Pitch.parse('A3').diatonicIndex);
}

/** A step of a key from a tonic, as the key writes it - its seventh raised in minor where asked, as harmony raises it. */
export function aStepOfTheKey(key: KeySignature, tonic: number, step: number, raisedInMinor: boolean): Pitch {
  const natural = key.pitchAt(tonic + step);
  const seventh = ((step % OCTAVE) + OCTAVE) % OCTAVE === THE_SEVENTH;
  return raisedInMinor && seventh && key.mode === 'minor' ? Pitch.writtenAt(natural.diatonicIndex, natural.midi + 1) : natural;
}

/**
 * The cadence of a key as it is heard, chord by chord, each its keys low to
 * high: the root under the three voices, the dominant major in minor too.
 */
export function theCadenceOfTheKey(key: KeySignature): readonly (readonly number[])[] {
  const tonic = theTonicOfTheHand(key);
  return THE_CADENCE.upper.map((steps, at) => [
    aStepOfTheKey(key, tonic - OCTAVE, elementAt(THE_CADENCE.bass, at), true).midi,
    ...steps.map((step) => aStepOfTheKey(key, tonic, step, true).midi),
  ]);
}

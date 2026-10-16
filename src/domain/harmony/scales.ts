import { floorMod } from '../../shared/asserts.js';
import { KeySignature } from '../model/KeySignature.js';
import { Pitch, STEPS, alterationSign, type Alteration, type Step } from '../model/Pitch.js';

/**
 * The scales music can be written in here: the seven-note ones, each of
 * whose notes is a letter of its own, so that chords stack on them in thirds
 * and a key signature can be written for them.
 */
export type ScaleName =
  | 'major'
  | 'minor'
  | 'harmonicMinor'
  | 'melodicMinor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian';

/** The scales in the order they are offered: the two keys first, the minor's two others, then the modes. */
export const SCALE_NAMES: readonly ScaleName[] = [
  'major',
  'minor',
  'harmonicMinor',
  'melodicMinor',
  'dorian',
  'phrygian',
  'lydian',
  'mixolydian',
  'locrian',
];

/** What a scale is made of. */
export interface ScaleShape {
  /** What it is called after its tonic: "harmonic minor". */
  readonly called: string;
  /** Its seven notes, in semitones above the tonic. */
  readonly steps: readonly number[];
  /**
   * The degree of the major scale of its key signature its tonic is on: a
   * mode is written in the signature of the major scale it is a turn of, and
   * the two other minors in the natural minor's, their raised notes as
   * accidentals.
   */
  readonly onTheDegree: number;
  /** Whether its third is minor, which is what a file's key says of it. */
  readonly minor: boolean;
}

export const SCALES: Readonly<Record<ScaleName, ScaleShape>> = {
  major: { called: 'major', steps: [0, 2, 4, 5, 7, 9, 11], onTheDegree: 0, minor: false },
  minor: { called: 'minor', steps: [0, 2, 3, 5, 7, 8, 10], onTheDegree: 5, minor: true },
  harmonicMinor: { called: 'harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11], onTheDegree: 5, minor: true },
  melodicMinor: { called: 'melodic minor', steps: [0, 2, 3, 5, 7, 9, 11], onTheDegree: 5, minor: true },
  dorian: { called: 'dorian', steps: [0, 2, 3, 5, 7, 9, 10], onTheDegree: 1, minor: true },
  phrygian: { called: 'phrygian', steps: [0, 1, 3, 5, 7, 8, 10], onTheDegree: 2, minor: true },
  lydian: { called: 'lydian', steps: [0, 2, 4, 6, 7, 9, 11], onTheDegree: 3, minor: false },
  mixolydian: { called: 'mixolydian', steps: [0, 2, 4, 5, 7, 9, 10], onTheDegree: 4, minor: false },
  locrian: { called: 'locrian', steps: [0, 1, 3, 5, 6, 8, 10], onTheDegree: 6, minor: true },
};

/** Whether something read back is the name of a scale. */
export function isAScale(value: unknown): value is ScaleName {
  return typeof value === 'string' && (SCALE_NAMES as readonly string[]).includes(value);
}

/** The letter and accidental of the tonic of a scale written with a key signature. */
export function theTonicOfTheScale(fifths: number, scale: ScaleName): { readonly step: Step; readonly alter: Alteration } {
  const signature = KeySignature.major(fifths);
  const step = STEPS[floorMod(STEPS.indexOf(signature.tonic.step) + SCALES[scale].onTheDegree, STEPS.length)] ?? 'C';
  return { step, alter: signature.alterationFor(step) };
}

/** The pitch class of the tonic of a scale written with a key signature, C being nought. */
export function theTonicPitchClass(fifths: number, scale: ScaleName): number {
  const { step, alter } = theTonicOfTheScale(fifths, scale);
  return floorMod(Pitch.fromDiatonicIndex(STEPS.indexOf(step), alter).midi, 12);
}

/**
 * The key signature a scale on a tonic is written with: that of the major
 * scale it is a turn of, spelled with the fewer accidentals - six sharps
 * rather than six flats where the two are as many.
 */
export function theSignatureOfTheScale(tonicPitchClass: number, scale: ScaleName): number {
  const major = floorMod(tonicPitchClass - (SCALES.major.steps[SCALES[scale].onTheDegree] ?? 0), 12);
  const fifths = floorMod(major * 7, 12);
  return fifths > 6 ? fifths - 12 : fifths;
}

/** The pitch classes of a scale written with a key signature, from its tonic up. */
export function thePitchClassesOfTheScale(fifths: number, scale: ScaleName): readonly number[] {
  const tonic = theTonicPitchClass(fifths, scale);
  return SCALES[scale].steps.map((step) => floorMod(tonic + step, 12));
}

/** What a key is called, its tonic spelt as its signature spells it: "D dorian", "B♭ major". */
export function theNameOfTheKey(key: { readonly fifths: number; readonly scale: ScaleName }): string {
  const { step, alter } = theTonicOfTheScale(key.fifths, key.scale);
  return `${step}${alterationSign(alter)} ${SCALES[key.scale].called}`;
}

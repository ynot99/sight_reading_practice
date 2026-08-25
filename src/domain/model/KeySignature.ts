import { DomainError } from '../../shared/errors.js';
import { elementAt } from '../../shared/asserts.js';
import { Pitch, alterationSuffix, stepAt, type Alteration, type Step } from './Pitch.js';

export type KeyMode = 'major' | 'minor';

/** Order in which sharps appear on the staff. */
const SHARP_ORDER: readonly Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];

/** Order in which flats appear on the staff. */
const FLAT_ORDER: readonly Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Tonic spelling per number of accidentals, indexed by `fifths + 7`. */
const MAJOR_TONICS: readonly (readonly [Step, Alteration])[] = [
  ['C', -1],
  ['G', -1],
  ['D', -1],
  ['A', -1],
  ['E', -1],
  ['B', -1],
  ['F', 0],
  ['C', 0],
  ['G', 0],
  ['D', 0],
  ['A', 0],
  ['E', 0],
  ['B', 0],
  ['F', 1],
  ['C', 1],
];

const MINOR_TONICS: readonly (readonly [Step, Alteration])[] = [
  ['A', -1],
  ['E', -1],
  ['B', -1],
  ['F', 0],
  ['C', 0],
  ['G', 0],
  ['D', 0],
  ['A', 0],
  ['E', 0],
  ['B', 0],
  ['F', 1],
  ['C', 1],
  ['G', 1],
  ['D', 1],
  ['A', 1],
];

/**
 * A key signature expressed the MusicXML way: a signed number of accidentals
 * plus a mode.
 *
 * Its main job is {@link KeySignature.pitchAt}, which turns an abstract staff
 * position into a correctly spelled pitch. Generators can therefore work in
 * plain integers and still produce notation that is spelled in the key.
 */
export class KeySignature {
  readonly fifths: number;
  readonly mode: KeyMode;

  constructor(fifths: number, mode: KeyMode = 'major') {
    if (!Number.isInteger(fifths) || fifths < -7 || fifths > 7) {
      throw new DomainError(`Key signature must have between -7 and 7 accidentals, got ${fifths}.`);
    }
    this.fifths = fifths;
    this.mode = mode;
  }

  static major(fifths: number): KeySignature {
    return new KeySignature(fifths, 'major');
  }

  static minor(fifths: number): KeySignature {
    return new KeySignature(fifths, 'minor');
  }

  static readonly C_MAJOR = new KeySignature(0, 'major');

  /** Accidental this key applies to a letter, ignoring local alterations. */
  alterationFor(step: Step): Alteration {
    if (this.fifths > 0) {
      return SHARP_ORDER.slice(0, this.fifths).includes(step) ? 1 : 0;
    }
    if (this.fifths < 0) {
      return FLAT_ORDER.slice(0, -this.fifths).includes(step) ? -1 : 0;
    }
    return 0;
  }

  /** The correctly spelled pitch sitting at an absolute staff position. */
  pitchAt(diatonicIndex: number): Pitch {
    const step = stepAt(diatonicIndex);
    return Pitch.fromDiatonicIndex(diatonicIndex, this.alterationFor(step));
  }

  /** Letter and accidental of the tonic. */
  get tonic(): { readonly step: Step; readonly alter: Alteration } {
    const table = this.mode === 'major' ? MAJOR_TONICS : MINOR_TONICS;
    const [step, alter] = elementAt(table, this.fifths + 7);
    return { step, alter };
  }

  /** Lowest staff position at or above `floorDiatonicIndex` that is the tonic. */
  tonicIndexAtOrAbove(floorDiatonicIndex: number): number {
    let index = floorDiatonicIndex;
    while (stepAt(index) !== this.tonic.step) {
      index += 1;
    }
    return index;
  }

  /** Accidentals rendered by this signature, in staff order. */
  get accidentalSteps(): readonly Step[] {
    return this.fifths > 0
      ? SHARP_ORDER.slice(0, this.fifths)
      : FLAT_ORDER.slice(0, -this.fifths);
  }

  get name(): string {
    const { step, alter } = this.tonic;
    return `${step}${alterationSuffix(alter)} ${this.mode}`;
  }

  equals(other: KeySignature): boolean {
    return this.fifths === other.fifths && this.mode === other.mode;
  }

  toString(): string {
    return this.name;
  }
}

/** Keys offered by the UI, from no accidentals outwards. */
export const COMMON_KEYS: readonly KeySignature[] = [
  KeySignature.major(0),
  KeySignature.major(1),
  KeySignature.major(-1),
  KeySignature.major(2),
  KeySignature.major(-2),
  KeySignature.major(3),
  KeySignature.major(-3),
  KeySignature.minor(0),
  KeySignature.minor(1),
  KeySignature.minor(-1),
];

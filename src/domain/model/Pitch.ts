import { DomainError } from '../../shared/errors.js';
import { assertInteger, elementAt, floorMod } from '../../shared/asserts.js';

export const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;

/** Letter name of a pitch, independent of any accidental. */
export type Step = (typeof STEPS)[number];

/** Chromatic displacement applied to a {@link Step}, in semitones. */
export type Alteration = -2 | -1 | 0 | 1 | 2;

const SEMITONE_BY_STEP: Readonly<Record<Step, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const INDEX_BY_STEP: Readonly<Record<Step, number>> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
};

const SHARP_SPELLING: readonly (readonly [Step, Alteration])[] = [
  ['C', 0],
  ['C', 1],
  ['D', 0],
  ['D', 1],
  ['E', 0],
  ['F', 0],
  ['F', 1],
  ['G', 0],
  ['G', 1],
  ['A', 0],
  ['A', 1],
  ['B', 0],
];

const FLAT_SPELLING: readonly (readonly [Step, Alteration])[] = [
  ['C', 0],
  ['D', -1],
  ['D', 0],
  ['E', -1],
  ['E', 0],
  ['F', 0],
  ['G', -1],
  ['G', 0],
  ['A', -1],
  ['A', 0],
  ['B', -1],
  ['B', 0],
];

/** `#`, `##`, `b`, `bb` or an empty string. */
export function alterationSuffix(alter: Alteration): string {
  if (alter === 0) {
    return '';
  }
  return alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter);
}

const PITCH_PATTERN = /^([A-Ga-g])(#{1,2}|b{1,2}|)(-?\d+)$/;

/** Returns the {@link Step} at a diatonic position, wrapping every 7 letters. */
export function stepAt(diatonicIndex: number): Step {
  return elementAt(STEPS, floorMod(diatonicIndex, STEPS.length));
}

function isStep(value: string): value is Step {
  return (STEPS as readonly string[]).includes(value);
}

function toAlteration(value: number): Alteration {
  if (value < -2 || value > 2 || !Number.isInteger(value)) {
    throw new DomainError(`Unsupported alteration: ${value}.`);
  }
  return value as Alteration;
}

/**
 * An immutable, *spelled* pitch: `F#4` and `Gb4` sound alike but are different
 * values because they occupy different staff lines. Notation code needs the
 * spelling, matching code needs {@link Pitch.midi} — both are derived here so
 * the rest of the system never has to guess.
 */
export class Pitch {
  readonly step: Step;
  readonly octave: number;
  readonly alter: Alteration;

  constructor(step: Step, octave: number, alter: Alteration = 0) {
    assertInteger(octave, 'octave');
    this.step = step;
    this.octave = octave;
    this.alter = alter;
  }

  /** Scientific pitch notation, e.g. `C4`, `F#3`, `Bb5`. */
  static parse(name: string): Pitch {
    const match = PITCH_PATTERN.exec(name.trim());
    if (match === null) {
      throw new DomainError(`Cannot parse pitch "${name}".`);
    }
    const letter = elementAt(match, 1).toUpperCase();
    const accidental = elementAt(match, 2);
    const octave = Number.parseInt(elementAt(match, 3), 10);
    if (!isStep(letter)) {
      throw new DomainError(`Cannot parse pitch "${name}".`);
    }
    const alter = accidental.startsWith('#')
      ? accidental.length
      : accidental.startsWith('b')
        ? -accidental.length
        : 0;
    return new Pitch(letter, octave, toAlteration(alter));
  }

  /**
   * Rebuilds a pitch from its absolute diatonic position (staff position),
   * which is how generators reason about melodic motion.
   */
  static fromDiatonicIndex(diatonicIndex: number, alter: Alteration = 0): Pitch {
    assertInteger(diatonicIndex, 'diatonicIndex');
    return new Pitch(
      stepAt(diatonicIndex),
      Math.floor(diatonicIndex / STEPS.length),
      alter,
    );
  }

  /**
   * Spells a MIDI note number without key context. Used for feedback labels;
   * notation always goes through {@link Pitch.fromDiatonicIndex} instead.
   */
  static fromMidi(midi: number, preferFlats = false): Pitch {
    assertInteger(midi, 'midi');
    const table = preferFlats ? FLAT_SPELLING : SHARP_SPELLING;
    const [step, alter] = elementAt(table, floorMod(midi, 12));
    return new Pitch(step, Math.floor(midi / 12) - 1, alter);
  }

  /** MIDI note number; middle C (`C4`) is 60. */
  get midi(): number {
    return (this.octave + 1) * 12 + SEMITONE_BY_STEP[this.step] + this.alter;
  }

  /** Absolute staff position, ignoring accidentals: `C4` is 28, `D4` is 29. */
  get diatonicIndex(): number {
    return this.octave * STEPS.length + INDEX_BY_STEP[this.step];
  }

  /** Same letter and octave, different accidental. */
  withAlteration(alter: Alteration): Pitch {
    return new Pitch(this.step, this.octave, alter);
  }

  /** Moves by whole staff positions; the caller re-applies key alterations. */
  transposeDiatonic(steps: number, alter: Alteration = 0): Pitch {
    return Pitch.fromDiatonicIndex(this.diatonicIndex + steps, alter);
  }

  equals(other: Pitch): boolean {
    return (
      this.step === other.step && this.octave === other.octave && this.alter === other.alter
    );
  }

  /** Enharmonic comparison: `F#4` sounds the same as `Gb4`. */
  soundsAs(other: Pitch): boolean {
    return this.midi === other.midi;
  }

  toString(): string {
    return `${this.step}${alterationSuffix(this.alter)}${this.octave}`;
  }
}

/** Human readable label for a raw MIDI note number, e.g. `60` -> `C4`. */
export function midiToLabel(midi: number, preferFlats = false): string {
  return Pitch.fromMidi(midi, preferFlats).toString();
}

import { DomainError } from '../../shared/errors.js';
import { assertInteger, assertPositive, floorMod } from '../../shared/asserts.js';
import { DIVISIONS_PER_QUARTER } from './Duration.js';

const SUPPORTED_BEAT_TYPES = [1, 2, 4, 8, 16] as const;

/** Denominator of a time signature. */
export type BeatType = (typeof SUPPORTED_BEAT_TYPES)[number];

function toBeatType(value: number): BeatType {
  const found = SUPPORTED_BEAT_TYPES.find((candidate) => candidate === value);
  if (found === undefined) {
    throw new DomainError(`Unsupported beat type: ${value}.`);
  }
  return found;
}

/** Immutable time signature with the tick arithmetic the timeline needs. */
export class TimeSignature {
  readonly beats: number;
  readonly beatType: BeatType;

  constructor(beats: number, beatType: number) {
    assertInteger(beats, 'beats');
    assertPositive(beats, 'beats');
    this.beats = beats;
    this.beatType = toBeatType(beatType);
  }

  static parse(value: string): TimeSignature {
    const [beats, beatType] = value.split('/');
    if (beats === undefined || beatType === undefined) {
      throw new DomainError(`Cannot parse time signature "${value}".`);
    }
    return new TimeSignature(Number.parseInt(beats, 10), Number.parseInt(beatType, 10));
  }

  static readonly COMMON = new TimeSignature(4, 4);

  /** Divisions in one notated beat (the denominator value). */
  get ticksPerBeat(): number {
    return (DIVISIONS_PER_QUARTER * 4) / this.beatType;
  }

  /** Divisions in one full measure. */
  get ticksPerMeasure(): number {
    return this.ticksPerBeat * this.beats;
  }

  /**
   * True for metres whose notated beats group in threes: 6/8, 9/8, 12/8.
   *
   * 3/8 is left out on purpose. It is written the same way but counted as
   * three, not as one, everywhere except at the fastest tempos.
   */
  get isCompound(): boolean {
    return this.beatType >= 8 && this.beats >= 6 && this.beats % 3 === 0;
  }

  /**
   * Divisions in one *felt* beat - what a conductor beats and the metronome
   * clicks, as opposed to {@link ticksPerBeat}, which is the notated value in
   * the denominator.
   *
   * The two differ exactly in compound time: 6/8 is written in eighths and
   * felt in two dotted quarters. Counting all six is how a beginner reads it
   * slowly, and how nobody plays it.
   */
  get ticksPerPulse(): number {
    return this.isCompound ? this.ticksPerBeat * 3 : this.ticksPerBeat;
  }

  /** Felt beats in a measure: two in 6/8, three in 3/4. */
  get pulsesPerMeasure(): number {
    return this.ticksPerMeasure / this.ticksPerPulse;
  }

  /** How a pulse divides naturally: in three when compound, otherwise in two. */
  get divisionsPerPulse(): number {
    return this.isCompound ? 3 : 2;
  }

  /** One-based felt beat (possibly fractional) inside its measure. */
  pulseOf(tick: number): number {
    return floorMod(tick, this.ticksPerMeasure) / this.ticksPerPulse + 1;
  }

  /** Quarter notes per measure, for tempo maths. */
  get quartersPerMeasure(): number {
    return this.ticksPerMeasure / DIVISIONS_PER_QUARTER;
  }

  /** Zero-based measure index for an absolute tick position. */
  measureOf(tick: number): number {
    return Math.floor(tick / this.ticksPerMeasure);
  }

  /** One-based beat position (possibly fractional) inside its measure. */
  beatOf(tick: number): number {
    return floorMod(tick, this.ticksPerMeasure) / this.ticksPerBeat + 1;
  }

  equals(other: TimeSignature): boolean {
    return this.beats === other.beats && this.beatType === other.beatType;
  }

  toString(): string {
    return `${this.beats}/${this.beatType}`;
  }
}

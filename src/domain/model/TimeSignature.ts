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

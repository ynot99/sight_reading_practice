import { DomainError } from '../../shared/errors.js';

/**
 * MusicXML divisions per quarter note. 480 keeps every value we can notate
 * (down to dotted sixteenths, and triplets when they arrive) an exact integer,
 * so timeline arithmetic never touches floating point.
 */
export const DIVISIONS_PER_QUARTER = 480;

export const NOTE_TYPES = ['whole', 'half', 'quarter', 'eighth', '16th'] as const;

/** MusicXML `<type>` value. */
export type NoteTypeName = (typeof NOTE_TYPES)[number];

/** Augmentation dots. One dot covers every rhythm the generators emit today. */
export type DotCount = 0 | 1;

const BASE_TICKS: Readonly<Record<NoteTypeName, number>> = {
  whole: DIVISIONS_PER_QUARTER * 4,
  half: DIVISIONS_PER_QUARTER * 2,
  quarter: DIVISIONS_PER_QUARTER,
  eighth: DIVISIONS_PER_QUARTER / 2,
  '16th': DIVISIONS_PER_QUARTER / 4,
};

const CACHE = new Map<string, Duration>();

/**
 * A notated rhythmic value.
 *
 * Durations are interned value objects: `Duration.of('quarter')` always
 * returns the same instance, so identity comparison is safe in hot paths.
 */
export class Duration {
  readonly type: NoteTypeName;
  readonly dots: DotCount;

  private constructor(type: NoteTypeName, dots: DotCount) {
    this.type = type;
    this.dots = dots;
  }

  static of(type: NoteTypeName, dots: DotCount = 0): Duration {
    const key = `${type}:${dots}`;
    const cached = CACHE.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const created = new Duration(type, dots);
    CACHE.set(key, created);
    return created;
  }

  /** Reconstructs the notated value for a tick count, or throws. */
  static fromTicks(ticks: number): Duration {
    for (const type of NOTE_TYPES) {
      for (const dots of [0, 1] as const) {
        const candidate = Duration.of(type, dots);
        if (candidate.ticks === ticks) {
          return candidate;
        }
      }
    }
    throw new DomainError(`${ticks} divisions cannot be notated as a single value.`);
  }

  /** True when `ticks` maps onto exactly one notated value. */
  static isNotatable(ticks: number): boolean {
    return NOTE_TYPES.some((type) =>
      ([0, 1] as const).some((dots) => Duration.of(type, dots).ticks === ticks),
    );
  }

  static readonly WHOLE = Duration.of('whole');
  static readonly DOTTED_HALF = Duration.of('half', 1);
  static readonly HALF = Duration.of('half');
  static readonly DOTTED_QUARTER = Duration.of('quarter', 1);
  static readonly QUARTER = Duration.of('quarter');
  static readonly DOTTED_EIGHTH = Duration.of('eighth', 1);
  static readonly EIGHTH = Duration.of('eighth');
  static readonly SIXTEENTH = Duration.of('16th');

  /** Length in MusicXML divisions. */
  get ticks(): number {
    const base = BASE_TICKS[this.type];
    return this.dots === 1 ? base + base / 2 : base;
  }

  /** Length in quarter notes, for tempo maths. */
  get quarters(): number {
    return this.ticks / DIVISIONS_PER_QUARTER;
  }

  equals(other: Duration): boolean {
    return this.type === other.type && this.dots === other.dots;
  }

  toString(): string {
    return this.dots === 1 ? `dotted ${this.type}` : this.type;
  }
}

/** Converts musical divisions to milliseconds at a given tempo. */
export function ticksToMilliseconds(ticks: number, beatsPerMinute: number): number {
  return (ticks / DIVISIONS_PER_QUARTER) * (60_000 / beatsPerMinute);
}

/** Converts milliseconds to musical divisions at a given tempo. */
export function millisecondsToTicks(milliseconds: number, beatsPerMinute: number): number {
  return (milliseconds / (60_000 / beatsPerMinute)) * DIVISIONS_PER_QUARTER;
}

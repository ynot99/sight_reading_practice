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

/**
 * How many notes are squeezed into the time of how many.
 *
 * A triplet is three in the time of two. Kept as a ratio rather than as a
 * `triplet: boolean` because quintuplets and sextuplets are the same idea, and
 * because the two numbers are exactly what MusicXML asks for.
 */
export interface Tuplet {
  readonly actual: number;
  readonly normal: number;
}

const NO_TUPLET: Tuplet = { actual: 1, normal: 1 };

/** Three notes in the time of two. */
export const TRIPLET: Tuplet = { actual: 3, normal: 2 };

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
  readonly tuplet: Tuplet;

  private constructor(type: NoteTypeName, dots: DotCount, tuplet: Tuplet) {
    this.type = type;
    this.dots = dots;
    this.tuplet = tuplet;
  }

  static of(type: NoteTypeName, dots: DotCount = 0, tuplet: Tuplet = NO_TUPLET): Duration {
    const key = `${type}:${dots}:${tuplet.actual}:${tuplet.normal}`;
    const cached = CACHE.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const created = new Duration(type, dots, tuplet);
    if (!Number.isInteger(created.ticks)) {
      throw new DomainError(
        `${created.toString()} does not land on a whole division; musical time must stay exact.`,
      );
    }
    CACHE.set(key, created);
    return created;
  }

  /** Three of this value in the time of two. */
  static triplet(type: NoteTypeName, dots: DotCount = 0): Duration {
    return Duration.of(type, dots, TRIPLET);
  }

  /**
   * Reconstructs the notated value for a tick count, or throws.
   *
   * Plain values only. A tuplet value is meaningless on its own - it exists
   * because of the group around it - so a lone tick count can never name one,
   * and {@link isNotatable} answering "no" for 160 divisions is what tells the
   * serializer that a triplet group has not closed yet.
   */
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
  static readonly TRIPLET_QUARTER = Duration.triplet('quarter');
  static readonly TRIPLET_EIGHTH = Duration.triplet('eighth');
  static readonly TRIPLET_SIXTEENTH = Duration.triplet('16th');

  /** Length in MusicXML divisions. */
  get ticks(): number {
    const base = BASE_TICKS[this.type];
    const dotted = this.dots === 1 ? base + base / 2 : base;
    return (dotted * this.tuplet.normal) / this.tuplet.actual;
  }

  /** True when this value belongs to a tuplet group. */
  get isTuplet(): boolean {
    return this.tuplet.actual !== this.tuplet.normal;
  }

  /** Span the whole group covers, in divisions: three triplet eighths make a quarter. */
  get tupletSpanTicks(): number {
    return this.ticks * this.tuplet.actual;
  }

  /** Length in quarter notes, for tempo maths. */
  get quarters(): number {
    return this.ticks / DIVISIONS_PER_QUARTER;
  }

  equals(other: Duration): boolean {
    return (
      this.type === other.type &&
      this.dots === other.dots &&
      this.tuplet.actual === other.tuplet.actual &&
      this.tuplet.normal === other.tuplet.normal
    );
  }

  /** True when two values belong to the same kind of group. */
  sameTuplet(other: Duration): boolean {
    return (
      this.tuplet.actual === other.tuplet.actual && this.tuplet.normal === other.tuplet.normal
    );
  }

  toString(): string {
    const dotted = this.dots === 1 ? `dotted ${this.type}` : this.type;
    return this.isTuplet ? `${dotted} (${this.tuplet.actual}:${this.tuplet.normal})` : dotted;
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

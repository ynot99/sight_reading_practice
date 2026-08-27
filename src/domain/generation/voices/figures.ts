import { clamp } from '../../../shared/asserts.js';
import type { Rng, WeightedItem } from '../Rng.js';

/**
 * The melodic figures a line can be built from.
 *
 * Fluent sight-reading is largely *recognising groups*, not decoding notes one
 * at a time: a reader who sees "a scale fragment" or "a broken chord" is doing
 * something a reader who sees four unrelated noteheads cannot. Material made of
 * independent random steps has nothing to recognise, so it trains exactly the
 * habit that has to be unlearned. These are the groups.
 */
export const FIGURE_KINDS = ['scale', 'arpeggio', 'neighbour', 'repeat', 'sequence'] as const;

export type FigureKind = (typeof FIGURE_KINDS)[number];

export type WeightedFigure = WeightedItem<FigureKind>;

/**
 * One figure, in scale degrees.
 *
 * Everything here is diatonic staff positions rather than semitones, so a
 * figure is automatically in key and correctly spelled whatever the key
 * signature is - the same trick {@link MelodyVoiceGenerator} uses.
 */
export interface Figure {
  readonly kind: FigureKind;
  /** Offsets from the figure's own first note. */
  readonly shape: readonly number[];
  /** Absolute scale-degree index of the first note. */
  readonly start: number;
}

export interface FigureWalkerOptions {
  readonly rng: Rng;
  /** Inclusive scale-degree bounds the line must stay within. */
  readonly lowest: number;
  readonly highest: number;
  readonly startIndex: number;
  /** Any tonic of the key, used to build arpeggios on real chord degrees. */
  readonly tonicIndex: number;
  readonly figures: readonly WeightedFigure[];
  /** Largest jump from one figure to the next, in scale degrees. */
  readonly maxLeap: number;
}

/** Absolute scale-degree indices a figure covers. */
export function indicesOf(figure: Figure): number[] {
  return figure.shape.map((offset) => figure.start + offset);
}

function boundsOf(shape: readonly number[]): readonly [number, number] {
  return [Math.min(...shape), Math.max(...shape)];
}

function fitsWithin(
  shape: readonly number[],
  start: number,
  lowest: number,
  highest: number,
): boolean {
  const [low, high] = boundsOf(shape);
  return start + low >= lowest && start + high <= highest;
}

/**
 * Nearest root of I, IV or V to `index`.
 *
 * Stacking thirds from an arbitrary degree is still diatonic, but it is heard
 * as a supertonic or mediant chord as often as not. Snapping the root makes an
 * arpeggio sound like the chord the reader expects to see.
 */
function nearestChordRoot(index: number, tonicIndex: number): number {
  let best = index;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const degree of [0, 3, 4]) {
    const base = tonicIndex + degree;
    const candidate = base + Math.round((index - base) / 7) * 7;
    const distance = Math.abs(candidate - index);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

/**
 * `offset * direction`, without ever producing `-0`.
 *
 * A shape is a value other code compares, and `Object.is(-0, 0)` is false, so
 * a descending figure must not carry a negative zero as its first offset.
 */
function scaled(offset: number, direction: number): number {
  return offset === 0 ? 0 : offset * direction;
}

/**
 * Chord outlines, as offsets above the root.
 *
 * Every one of these survives negation as the same stack of thirds, which
 * matters because {@link FigureWalker.place} may mirror a figure to fit it
 * inside the hand: the chord may end up built on another degree, but it stays
 * a chord.
 */
const ARPEGGIO_OUTLINES: readonly (readonly number[])[] = [
  [0, 2, 4],
  [0, 2, 4, 2],
  [0, 4, 2],
  [0, 2, 4, 6],
];

/** How many sequence steps may follow one another before the ear tires. */
const MAX_SEQUENCE_RUN = 2;

/**
 * Emits a melodic line one scale degree at a time, figure by figure.
 *
 * Stateful on purpose: `repeat` and `sequence` are defined relative to what
 * came before, which is what makes a line feel composed rather than sampled.
 * The walker never emits a note outside its range - a figure that would
 * overflow is mirrored, and only if that fails is it moved bodily, so a rising
 * run near the top of the hand turns around instead of being squashed.
 */
export class FigureWalker {
  private readonly options: FigureWalkerOptions;
  private pending: number[] = [];
  private previous: Figure | null = null;
  private sequenceRun = 0;
  private cursor: number;

  constructor(options: FigureWalkerOptions) {
    this.options = options;
    this.cursor = clamp(options.startIndex, options.lowest, options.highest);
  }

  /** The figure most recently emitted, for tests and for callers that care. */
  get lastFigure(): Figure | null {
    return this.previous;
  }

  next(): number {
    if (this.pending.length === 0) {
      this.refill();
    }
    const [index, ...rest] = this.pending;
    if (index === undefined) {
      return this.cursor;
    }
    this.pending = rest;
    this.cursor = index;
    return index;
  }

  private refill(): void {
    const kind = this.pickKind();
    const shape = this.shapeFor(kind);
    // A chord keeps its identity under octave transposition but not under
    // mirroring; a scale is the other way round - turning a run over at the
    // top of the hand is musical, dropping it an octave is not.
    const placed = this.place(shape, this.startFor(kind, shape), kind === 'arpeggio');
    const figure: Figure = { kind, shape: placed.shape, start: placed.start };

    this.sequenceRun = kind === 'sequence' ? this.sequenceRun + 1 : 0;
    this.previous = figure;
    this.pending = indicesOf(figure);
  }

  private pickKind(): FigureKind {
    const available = this.options.figures.filter((entry) => {
      if (entry.weight <= 0) {
        return false;
      }
      if (entry.value === 'repeat' || entry.value === 'sequence') {
        if (this.previous === null) {
          return false;
        }
      }
      return !(entry.value === 'sequence' && this.sequenceRun >= MAX_SEQUENCE_RUN);
    });
    return available.length > 0 ? this.options.rng.weighted(available) : 'scale';
  }

  private shapeFor(kind: FigureKind): number[] {
    const { rng } = this.options;
    switch (kind) {
      case 'scale': {
        const length = rng.int(3, 5);
        const direction = rng.bool(0.5) ? 1 : -1;
        return Array.from({ length }, (_, step) => scaled(step, direction));
      }
      case 'arpeggio': {
        const outline = rng.pick(ARPEGGIO_OUTLINES);
        // Direction is the order the notes are played in, *not* the sign of
        // the offsets. Negating them would keep the shape and lose the chord:
        // F-D-B is what you get by reading F-A-C backwards through negation,
        // and that is a diminished triad, not the subdominant it was built on.
        return rng.bool(0.5) ? [...outline] : [...outline].reverse();
      }
      case 'neighbour': {
        const direction = rng.bool(0.5) ? 1 : -1;
        return [0, direction, 0, -direction];
      }
      case 'repeat':
      case 'sequence':
        // Guarded by pickKind: these are only offered once a figure exists.
        return this.previous === null ? [0, 1, 2] : [...this.previous.shape];
      default:
        return [0, 1, 2];
    }
  }

  private startFor(kind: FigureKind, shape: readonly number[]): number {
    const { rng, maxLeap, tonicIndex } = this.options;
    const previous = this.previous;

    if (previous !== null && kind === 'repeat') {
      return previous.start;
    }
    if (previous !== null && kind === 'sequence') {
      const direction = rng.bool(0.5) ? 1 : -1;
      const distance = rng.bool(0.7) ? 1 : 2;
      return previous.start + direction * distance;
    }

    // The connecting leap is the one genuinely free choice left; inside a
    // figure every note follows from the shape.
    const desired = this.cursor + rng.int(-maxLeap, maxLeap);
    if (kind !== 'arpeggio' || shape.length === 0) {
      return desired;
    }
    // The root of a chord is its lowest note, wherever the shape starts.
    const [lowestOffset] = boundsOf(shape);
    return nearestChordRoot(desired + lowestOffset, tonicIndex) - lowestOffset;
  }

  private place(
    shape: readonly number[],
    desiredStart: number,
    preferOctave: boolean,
  ): { shape: number[]; start: number } {
    const { lowest, highest } = this.options;
    const room = highest - lowest;

    let trimmed = [...shape];
    while (trimmed.length > 1) {
      const [low, high] = boundsOf(trimmed);
      if (high - low <= room) {
        break;
      }
      trimmed = trimmed.slice(0, -1);
    }

    const shapes = [trimmed, trimmed.map((offset) => scaled(offset, -1))];
    const shifts = [0, -7, 7, -14, 14];
    const attempts = preferOctave
      ? shapes.flatMap((candidate) =>
          shifts.map((shift) => ({ shape: candidate, start: desiredStart + shift })),
        )
      : shifts.flatMap((shift) =>
          shapes.map((candidate) => ({ shape: candidate, start: desiredStart + shift })),
        );

    for (const attempt of attempts) {
      if (fitsWithin(attempt.shape, attempt.start, lowest, highest)) {
        return attempt;
      }
    }

    // Nothing fits as written: the hand is narrower than the figure plus its
    // octaves, so put it where it will at least sound.
    const [low, high] = boundsOf(trimmed);
    return { shape: trimmed, start: clamp(desiredStart, lowest - low, highest - high) };
  }
}

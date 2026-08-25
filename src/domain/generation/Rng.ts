import { DomainError } from '../../shared/errors.js';
import { elementAt } from '../../shared/asserts.js';

export interface WeightedItem<T> {
  readonly value: T;
  readonly weight: number;
}

/**
 * Deterministic random source.
 *
 * Generation depends on this interface rather than on `Math.random`, which is
 * what makes every generated exercise reproducible from its seed - both for
 * tests and for the "share this exercise" feature.
 */
export interface Rng {
  /** Uniform value in `[0, 1)`. */
  next(): number;
  /** Uniform integer in `[minInclusive, maxInclusive]`. */
  int(minInclusive: number, maxInclusive: number): number;
  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Weighted element of a non-empty array. */
  weighted<T>(items: readonly WeightedItem<T>[]): T;
  /** True with the given probability. */
  bool(probability: number): boolean;
}

/**
 * mulberry32: 32 bits of state, excellent distribution for our purposes and
 * short enough to audit at a glance.
 */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (minInclusive: number, maxInclusive: number): number => {
    if (maxInclusive < minInclusive) {
      throw new DomainError(`Empty integer range [${minInclusive}, ${maxInclusive}].`);
    }
    return minInclusive + Math.floor(next() * (maxInclusive - minInclusive + 1));
  };

  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new DomainError('Cannot pick from an empty collection.');
      }
      return elementAt(items, int(0, items.length - 1));
    },
    weighted<T>(items: readonly WeightedItem<T>[]): T {
      const total = items.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
      if (items.length === 0 || total <= 0) {
        throw new DomainError('Cannot pick from a collection without positive weight.');
      }
      let threshold = next() * total;
      for (const item of items) {
        threshold -= Math.max(0, item.weight);
        if (threshold < 0) {
          return item.value;
        }
      }
      return elementAt(items, items.length - 1).value;
    },
    bool(probability: number): boolean {
      return next() < probability;
    },
  };
}

/** Seed for exercises the user did not ask to reproduce. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

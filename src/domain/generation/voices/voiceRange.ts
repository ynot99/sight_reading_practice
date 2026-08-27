import { clamp } from '../../../shared/asserts.js';
import type { KeySignature } from '../../model/KeySignature.js';

/**
 * The tonic closest to the middle of a range, in scale degrees.
 *
 * Every melodic voice wants to open on a note that sounds like home and leaves
 * room to move in both directions, so this is worth having in one place rather
 * than once per generator.
 */
export function tonicNearestMiddle(key: KeySignature, lowest: number, highest: number): number {
  const middle = Math.round((lowest + highest) / 2);
  let candidate = key.tonicIndexAtOrAbove(lowest);
  let best = candidate;
  while (candidate <= highest) {
    if (Math.abs(candidate - middle) < Math.abs(best - middle)) {
      best = candidate;
    }
    candidate += 7;
  }
  return clamp(best, lowest, highest);
}

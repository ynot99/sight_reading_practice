import type { TimeSignature } from '../../domain/model/TimeSignature.js';
import type { ExerciseTimeline } from '../../domain/timeline/Timeline.js';
import { clicksPerPulse, type ClickPattern } from '../ports/IMetronome.js';

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b > 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

function leastCommonMultiple(left: number, right: number): number {
  const divisor = greatestCommonDivisor(left, right);
  return divisor === 0 ? 0 : Math.abs(left * right) / divisor;
}

/**
 * Finest grid the music actually lands on, as ticks.
 *
 * Every step onset and length is an exact number of divisions, so their
 * greatest common divisor is the coarsest tick that can still land on all of
 * them. Deriving it beats guessing a constant: sixteenths need four ticks per
 * beat, dotted values need eight, and triplets - when they arrive - will need
 * twelve without anyone having to remember to change a default.
 */
export function musicalResolutionTicks(
  timeline: ExerciseTimeline,
  timeSignature: TimeSignature,
): number {
  let divisor = timeSignature.ticksPerPulse;
  for (const step of timeline.steps) {
    divisor = greatestCommonDivisor(divisor, step.onsetTicks);
    divisor = greatestCommonDivisor(divisor, step.durationTicks);
  }
  return divisor > 0 ? divisor : timeSignature.ticksPerPulse;
}

/**
 * Ticks per felt beat for a run.
 *
 * Two independent demands meet here: the music has to be resolvable, and the
 * chosen click has to be soundable. Taking the lowest common multiple honours
 * both without letting either dictate the other - which is the whole point of
 * separating the click from the loop.
 */
export function subdivisionsPerPulseFor(
  timeline: ExerciseTimeline,
  timeSignature: TimeSignature,
  click: ClickPattern,
): number {
  const fromMusic = timeSignature.ticksPerPulse / musicalResolutionTicks(timeline, timeSignature);
  const fromClick = clicksPerPulse(click, timeSignature);
  return Math.max(1, leastCommonMultiple(fromMusic, fromClick));
}

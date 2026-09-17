import type { PerformanceReport } from './PerformanceReport.js';

/**
 * One thing a reading is judged on, as a share of the best it could be.
 *
 * A share and not a raw number, because the axes measure different things in
 * different units - milliseconds against a count of notes - and a shape drawn
 * from them can only be read if they agree about what "all the way out" means.
 */
export interface ProfileAxis {
  readonly name: string;
  /** Nought to one, where one is as well as it can be done. */
  readonly of: number;
  /** What the number behind it actually was, for the reader to see. */
  readonly said: string;
}

/**
 * The gap at which a reading stops being about timing at all.
 *
 * A quarter of a second is not "slightly behind"; it is a different beat. Held
 * against it rather than against a perfect nought, the axis says something at
 * every level of the ladder - against nought, a reader who is human reads as a
 * failure on every run they ever play.
 */
const TIMING_FLOOR_MS = 250;
/**
 * And the spread at which the hand stops being steady.
 *
 * Smaller than the floor above: a reader can be a long way behind the beat and
 * still be *even*, and evenness is the thing this axis is about. Landing a
 * tenth of a second either side of your own average is not a habit, it is
 * noise.
 */
const SPREAD_FLOOR_MS = 120;
/**
 * How far a press may sit from its neighbours before it counts as a knock.
 *
 * A share of the run's own loudness rather than a number of velocity units: a
 * reader playing quietly throughout has a smaller range for an accident to
 * happen in, and the same absolute jump means more there.
 */
const KNOCK_SHARE = 0.4;

function shareBelow(value: number, floor: number): number {
  if (!Number.isFinite(value) || floor <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, 1 - value / floor));
}

/**
 * How evenly the presses were struck, as a share.
 *
 * Not how *level* they were, which is what he first asked for and which would
 * mark a reader down for playing musically: a piece with a crescendo in it is
 * supposed to come out uneven, and an axis rewarding a flat velocity would give
 * its best score to a machine. What is a fault is the odd press that leaps away
 * from the ones on either side of it - the finger that caught the key too hard
 * - so that is what is counted. His: "плавність велоситі без випадкових ударів
 * по клавішах".
 */
export function theEvenness(velocities: readonly number[]): number | null {
  if (velocities.length < 3) {
    return null;
  }
  const most = Math.max(...velocities);
  const least = Math.min(...velocities);
  const range = most - least;
  if (range <= 0) {
    return 1;
  }
  let knocks = 0;
  for (let at = 1; at + 1 < velocities.length; at += 1) {
    const before = velocities[at - 1] ?? 0;
    const here = velocities[at] ?? 0;
    const after = velocities[at + 1] ?? 0;
    const among = (before + after) / 2;
    if (Math.abs(here - among) > range * KNOCK_SHARE) {
      knocks += 1;
    }
  }
  return Math.max(0, 1 - knocks / (velocities.length - 2));
}

/**
 * The shape of a reading: what it was good at, and what it was not.
 *
 * Four axes and not the five he listed, because two of the five are one thing
 * wearing two hats. Measured: the same `meanAbsoluteDeviationMs` is how far
 * behind the beat a reader was where a machine kept the time, and how long they
 * took to arrive where the music waited for them. One number; which of the two
 * it means is decided by the frame, so the axis is *named* by the frame rather
 * than drawn twice.
 *
 * Every axis is a share of the best it could be, so the shape can be read at
 * all - and every one carries the number behind it, because a shape says which
 * way a reading leans and never what it was.
 */
export function theProfile(
  report: PerformanceReport,
  velocities: readonly number[],
  keepsTime: boolean,
): readonly ProfileAxis[] {
  const { totals, timing } = report;
  const owed = Math.max(1, totals.playableSteps);
  const evenness = theEvenness(velocities);
  const axes: ProfileAxis[] = [
    {
      name: 'Accuracy',
      of: Math.min(1, totals.correct / owed),
      said: `${totals.correct} of ${totals.playableSteps}`,
    },
    {
      // The same measurement either way; what it is a measurement *of* is the
      // frame's answer. A frame that keeps time is one the reader can be late
      // against; a frame that waits is one they can only be slow in.
      name: keepsTime ? 'Timing' : 'Flow',
      of: shareBelow(timing.meanAbsoluteDeviationMs, TIMING_FLOOR_MS),
      said: `${Math.round(timing.meanAbsoluteDeviationMs)} ms ${keepsTime ? 'off the beat' : 'to arrive'}`,
    },
    {
      name: 'Stability',
      of: shareBelow(timing.deviationSpreadMs, SPREAD_FLOOR_MS),
      said: `${Math.round(timing.deviationSpreadMs)} ms either side`,
    },
  ];
  // Left off rather than drawn at nought where there is nothing to say: three
  // presses are not a hand to judge, and an axis pinned to the middle would
  // read as a fault rather than as a silence.
  if (evenness !== null) {
    axes.push({
      name: 'Dynamics',
      of: evenness,
      said: `${Math.round(evenness * 100)}% struck evenly`,
    });
  }
  return axes;
}

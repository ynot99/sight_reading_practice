import type { Measure, MusicalEntry } from '../model/Exercise.js';
import { measureOf } from '../model/Exercise.js';
import type { TimeSignature } from '../model/TimeSignature.js';
import { beamedByTheBeat } from '../generation/beaming.js';

/**
 * A part's entries laid into bars of a metre, each beamed by the beat. The
 * entries fill the bars exactly - an exercise of the solfege list is written
 * to - and `validateExercise` says so where one does not.
 */
export function intoBars(entries: readonly MusicalEntry[], time: TimeSignature): Measure[] {
  const bars: MusicalEntry[][] = [[]];
  let filled = 0;
  for (const entry of entries) {
    if (filled === time.ticksPerMeasure) {
      bars.push([]);
      filled = 0;
    }
    bars[bars.length - 1]?.push(entry);
    filled += entry.duration.ticks;
  }
  return bars.map((bar) => beamedByTheBeat(measureOf(bar), time));
}

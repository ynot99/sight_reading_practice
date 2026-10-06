import type { Beam, Measure, MusicalEntry, NoteEntry } from '../model/Exercise.js';
import { measureOf } from '../model/Exercise.js';
import { Duration } from '../model/Duration.js';
import type { TimeSignature } from '../model/TimeSignature.js';

/**
 * A generated bar beamed by the beat.
 *
 * The beat a group of eighths belongs to is the first thing a reader takes in
 * about them: four eighths beamed in two pairs are two beats at a glance, and
 * four flagged ones are four notes to count. A score brings its own beams, and
 * an engraver that is handed none draws flags, so this program has to beam
 * what it writes itself.
 *
 * One group to a felt beat - a quarter, or a dotted quarter in compound time -
 * and the whole bar where the beat is shorter than a quarter, as three-eight
 * is beamed. A rest or a longer note ends a group, and a group of one is no
 * group. Sixteenths side by side share a second beam; one alone under the
 * first hangs a hook towards its neighbour.
 */
export function beamedByTheBeat(measure: Measure, time: TimeSignature): Measure {
  const group = time.ticksPerPulse >= Duration.QUARTER.ticks ? time.ticksPerPulse : time.ticksPerMeasure;
  const beams: Beam[][] = measure.entries.map(() => []);
  let run: number[] = [];
  let runGroup = -1;
  const close = (): void => {
    if (run.length > 1) {
      beamTheRun(run, measure.entries, beams);
    }
    run = [];
  };
  let onset = 0;
  measure.entries.forEach((entry, index) => {
    const at = onset;
    onset += entry.duration.ticks;
    const inGroup = Math.floor(at / group);
    const fits = Math.floor((onset - 1) / group) === inGroup;
    if (entry.kind !== 'note' || !beamable(entry) || !fits) {
      close();
      return;
    }
    if (inGroup !== runGroup) {
      close();
      runGroup = inGroup;
    }
    run.push(index);
  });
  close();
  return measureOf(
    measure.entries.map((entry, index): MusicalEntry =>
      entry.kind === 'note' ? { ...entry, beams: beams[index] ?? [] } : entry,
    ),
  );
}

/** Shorter than a quarter: an eighth, a sixteenth, or one of a triplet. */
function beamable(entry: NoteEntry): boolean {
  return entry.duration.ticks < Duration.QUARTER.ticks;
}

/** Two beams' worth: a sixteenth, or one of a sixteenth triplet. */
function short(entry: MusicalEntry | undefined): boolean {
  return entry !== undefined && entry.duration.ticks <= Duration.SIXTEENTH.ticks;
}

function beamTheRun(run: readonly number[], entries: readonly MusicalEntry[], beams: Beam[][]): void {
  run.forEach((index, at) => {
    const type = at === 0 ? 'begin' : at === run.length - 1 ? 'end' : 'continue';
    beams[index]?.push({ level: 1, type });
  });
  run.forEach((index, at) => {
    if (!short(entries[index])) {
      return;
    }
    const before = at > 0 && short(entries[run[at - 1] ?? -1]);
    const after = at < run.length - 1 && short(entries[run[at + 1] ?? -1]);
    const type = before && after ? 'continue' : before ? 'end' : after ? 'begin' : at === 0 ? 'forward hook' : 'backward hook';
    beams[index]?.push({ level: 2, type });
  });
}

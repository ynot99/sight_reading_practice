import type { Exercise, TempoChange } from '../model/Exercise.js';
import { barLines, tempoAtTick } from '../model/Exercise.js';

/**
 * How much longer a note under a fermata is held.
 *
 * Twice, which is what a fermata is taught as and near enough to what
 * players do. The format carries no number for it - `<fermata/>` says to hold
 * and nothing about how long - so this is a reading, and one number read the
 * same way everywhere beats a different guess in each place that asks.
 */
const HELD_TIMES = 2;

/** Where a tick falls, said the way a mark is placed. */
function placeOf(
  exercise: Exercise,
  ticks: number,
): { readonly measureIndex: number; readonly offsetTicks: number } {
  const bars = barLines(exercise);
  let at = 0;
  for (const [measureIndex, bar] of bars.entries()) {
    if (bar.startTicks > ticks) {
      break;
    }
    at = measureIndex;
  }
  return { measureIndex: at, offsetTicks: Math.max(0, ticks - (bars[at]?.startTicks ?? 0)) };
}

/**
 * A piece with the notes under its fermatas actually held.
 *
 * Said as a change of speed, because that is the language the clock already
 * speaks: the metronome's plan, the timeline's milliseconds, the judging
 * window and the marker are all read off the tempo, so a fermata written this
 * way is one everything agrees about without any of them being taught a new
 * word. Lengthening the note instead would have moved the bar lines, and the
 * bar lines are where the music is printed.
 *
 * Worth doing because a whole piece can be written this way. His White Palace
 * arrangement slows down at the end of nearly every phrase and says so with
 * two or three fermatas over the last notes of the bar - two hundred and
 * eighteen of them across eighty-nine of its hundred and ninety bars, against
 * a single `rit.` in the whole file. Read and printed and given no time, that
 * piece was played straight through where it asks to breathe.
 *
 * A run of them is one stretch of slower music rather than several: three
 * fermatas over three consecutive notes are held one after another, and
 * putting the tempo back between them would be a restoration nobody hears.
 */
export function withFermatasHeld(exercise: Exercise): Exercise {
  const bars = barLines(exercise);
  // Where a fermata is written, and how long the longest note under it is.
  // Longest, because the hands hold together: one staff's quaver under the
  // other's minim is a bar that waits for the minim.
  const held = new Map<number, number>();
  for (const staff of exercise.staves) {
    staff.measures.forEach((measure, measureIndex) => {
      let at = bars[measureIndex]?.startTicks ?? 0;
      for (const entry of measure.entries) {
        if (entry.kind === 'note' && entry.fermata) {
          held.set(at, Math.max(held.get(at) ?? 0, entry.duration.ticks));
        }
        at += entry.duration.ticks;
      }
    });
  }
  if (held.size === 0) {
    return exercise;
  }

  const spans: { from: number; until: number }[] = [];
  for (const [from, ticks] of [...held.entries()].sort((left, right) => left[0] - right[0])) {
    const last = spans[spans.length - 1];
    if (last !== undefined && from <= last.until) {
      last.until = Math.max(last.until, from + ticks);
      continue;
    }
    spans.push({ from, until: from + ticks });
  }

  const added: TempoChange[] = [];
  for (const span of spans) {
    // Read before anything is added, so a fermata inside a slowing passage is
    // half of whatever was in force there - and the tempo it goes back to is
    // whatever that passage had reached by the time it let go.
    const during = Math.max(1, Math.round(tempoAtTick(exercise, span.from) / HELD_TIMES));
    const after = Math.round(tempoAtTick(exercise, span.until));
    added.push({ ...placeOf(exercise, span.from), tempoBpm: during, implied: true });
    added.push({ ...placeOf(exercise, span.until), tempoBpm: after, implied: true });
  }

  const at = (change: TempoChange): number =>
    (bars[change.measureIndex]?.startTicks ?? 0) + change.offsetTicks;
  return {
    ...exercise,
    tempoChanges: [...exercise.tempoChanges, ...added].sort((left, right) => at(left) - at(right)),
  };
}

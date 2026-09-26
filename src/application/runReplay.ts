import type { NoteVerdict } from '../domain/matching/ChordMatcher.js';
import { landing, type NoteTier } from '../domain/scoring/noteTiers.js';
import type { ExerciseTimeline } from '../domain/timeline/Timeline.js';
import { playedNoteOffset } from './playedNoteOffset.js';
import type { PlayedNote } from './ports/IScoreRenderer.js';
import { rollBeganAtMs, theMusicsPlaceAt, type RunRoll } from './session/RunRoll.js';

/**
 * How a run was judged, which is how its marks are drawn again.
 *
 * The tempo it was played at, because a mark's offset is a share of the gap
 * to the next note and the gap is only a length in milliseconds at a tempo;
 * and whether the frame kept time, because where it did not, how long a note
 * took to find is not lateness.
 */
export interface ReplayJudging {
  readonly keepsTime: boolean;
  readonly tempoBpm: number;
}

/** A mark of the run, and when in it the key went down: the run's own nought. */
export interface ReplayMark {
  readonly atMs: number;
  readonly mark: PlayedNote;
}

/**
 * Whether a run's recording can be played back over this music.
 *
 * Every press it judged has to name a step the music has, or its mark would be
 * drawn on some other note - the piece was changed since, or this is another
 * piece of the same name. And there has to be something to see.
 */
export function replayFits(roll: RunRoll, timeline: ExerciseTimeline): boolean {
  const judged = roll.presses.filter((press) => press.stepIndex !== null);
  return (
    judged.length > 0 &&
    judged.every(
      (press) => press.stepIndex !== null && press.stepIndex >= 0 && press.stepIndex < timeline.length,
    )
  );
}

/**
 * Every mark the run left on the page, with the moment each was made.
 *
 * The same marks the run drew as it went, in the same colours: right or wrong
 * against the page, how well a right one landed, and how far off its beat.
 * All settled - the run is over, and every chord in it is as found as it was
 * ever going to be. A note struck again in a chord already collected drew
 * nothing then and draws nothing now; a press the run never judged has no step
 * to be drawn on.
 */
export function theMarksOfTheRun(
  roll: RunRoll,
  timeline: ExerciseTimeline,
  judging: ReplayJudging,
): readonly ReplayMark[] {
  const began = rollBeganAtMs(roll);
  const marks: ReplayMark[] = [];
  for (const press of roll.presses) {
    const { stepIndex, verdict } = press;
    if (stepIndex === null || verdict === null || verdict === 'duplicate') {
      continue;
    }
    const tier = tierOf(verdict, stepIndex, press.deviationMs, timeline, judging);
    marks.push({
      atMs: press.downAtMs - began,
      mark: {
        stepIndex,
        midi: press.midi,
        correct: verdict !== 'wrong',
        settled: true,
        offset: judging.keepsTime
          ? playedNoteOffset(timeline, stepIndex, press.deviationMs, judging.tempoBpm)
          : 0,
        ...(tier === undefined ? {} : { tier }),
      },
    });
  }
  return marks.sort((left, right) => left.atMs - right.atMs);
}

/**
 * How well a right key landed, as the run said at the time.
 *
 * Its own window where the frame kept time; where it did not, a right key is
 * simply right, and one pressed ahead of the hand being heard is Good.
 */
function tierOf(
  verdict: NoteVerdict,
  stepIndex: number,
  deviationMs: number | null,
  timeline: ExerciseTimeline,
  judging: ReplayJudging,
): NoteTier | undefined {
  if (verdict === 'rushed') {
    return 'good';
  }
  if (verdict !== 'correct' && verdict !== 'late') {
    return undefined;
  }
  if (!judging.keepsTime || deviationMs === null) {
    return 'perfect';
  }
  return landing(timeline, stepIndex, deviationMs).tier;
}

/**
 * The step the music was at, a moment into the run, or `null` before any.
 *
 * Off the beats where the run kept them, because they say where the music
 * was - through a note held, and at a gate standing still. A run that waited
 * on every note kept no beats, and there the music was wherever the reader
 * last played.
 */
export function theStepAt(roll: RunRoll, timeline: ExerciseTimeline, atMs: number): number | null {
  const began = rollBeganAtMs(roll);
  const ticks = theMusicsPlaceAt(roll, began + atMs);
  if (ticks !== null) {
    // The last step to have begun by then; the steps are in order, and this is
    // asked on every frame of a replay of a piece thousands of steps long.
    let low = 0;
    let high = timeline.length - 1;
    let found: number | null = null;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const step = timeline.at(middle);
      if (step !== null && step.onsetTicks <= ticks) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  }
  let last: number | null = null;
  for (const press of roll.presses) {
    if (press.stepIndex !== null && press.downAtMs - began <= atMs) {
      last = press.stepIndex;
    }
  }
  return last;
}

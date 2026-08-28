import { clamp } from '../shared/asserts.js';
import { ticksToMilliseconds } from '../domain/model/Duration.js';
import type { ExerciseTimeline } from '../domain/timeline/Timeline.js';

export interface PlayedNoteOffsetOptions {
  /**
   * Deviation below which a press is drawn exactly on its note.
   *
   * Without it every mark jitters by a pixel or two and the page stops saying
   * "that one was on the beat" - which is the most useful thing it can say.
   */
  readonly deadZone?: number;
  /** Largest offset drawn, so a mark never reaches its neighbour's notehead. */
  readonly limit?: number;
}

const DEFAULT_DEAD_ZONE = 0.12;
const DEFAULT_LIMIT = 0.85;

/**
 * Where a press belongs horizontally, as a fraction of the gap to its
 * neighbour: `-0.3` is three tenths of the way back towards the previous note,
 * `+0.7` seven tenths of the way towards the next.
 *
 * Drawing a mark on its step's notehead says *which* note was played but
 * nothing about *when*. That is worst exactly where it matters most: a press
 * too early to be counted for the beat it was reaching for is judged against
 * the beat before it, so the page put the mark a whole note to the left of
 * where the reader thought they had played. Offsetting by the actual deviation
 * puts it just before the note it was aimed at, which reads as "nearly" rather
 * than as "somewhere else entirely".
 *
 * A fraction rather than pixels, because only the renderer knows how far apart
 * two noteheads ended up on the page.
 */
export function playedNoteOffset(
  timeline: ExerciseTimeline,
  stepIndex: number,
  deviationMs: number | null,
  tempoBpm: number,
  options: PlayedNoteOffsetOptions = {},
): number {
  if (deviationMs === null || deviationMs === 0 || tempoBpm <= 0) {
    return 0;
  }
  const step = timeline.at(stepIndex);
  if (step === null) {
    return 0;
  }

  // Early presses are measured against the gap behind the note, late ones
  // against the gap ahead: `durationTicks` is the distance to the next step,
  // so the previous step carries the one behind.
  const behind = timeline.at(stepIndex - 1);
  const gapTicks = deviationMs < 0 ? (behind?.durationTicks ?? step.durationTicks) : step.durationTicks;
  const gapMs = ticksToMilliseconds(gapTicks, tempoBpm);
  if (gapMs <= 0) {
    return 0;
  }

  const fraction = deviationMs / gapMs;
  const deadZone = options.deadZone ?? DEFAULT_DEAD_ZONE;
  if (Math.abs(fraction) < deadZone) {
    return 0;
  }
  const limit = options.limit ?? DEFAULT_LIMIT;
  return clamp(fraction, -limit, limit);
}

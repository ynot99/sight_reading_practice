import { spanMs, timeAtMeasure } from '../model/Exercise.js';
import type { ExerciseTimeline } from '../timeline/Timeline.js';

/**
 * How well a note that was played was placed.
 *
 * Two answers and no more. A note is Perfect when it landed in its window and
 * Good when it was the right key anywhere else the run took it - early, late,
 * a step late, ahead of the hand the reader is hearing. Every note the run
 * asked for ends as one of these or as missed, and every press it did not ask
 * for is wrong: the page, the grade and a reading's numbers are all read off
 * that one account, so none of them can say something the others do not.
 */
export type NoteTier = 'perfect' | 'good';

/** A note the run asked for and the reader played, and how well. */
export interface NoteHit {
  readonly midi: number;
  /**
   * Signed milliseconds from where the note was due; negative is early.
   * `null` where the run keeps no time, which is a run that waits.
   */
  readonly deviationMs: number | null;
  readonly tier: NoteTier;
  /**
   * How far off it could have been and still been Perfect, on the side it
   * fell. Absent where the run keeps no time.
   */
  readonly windowMs?: number;
}

/**
 * The narrowest a Perfect window gets, in milliseconds.
 *
 * About where a press against the click starts to be heard as apart from it,
 * and where the hand stops being able to do better however slow the music.
 */
export const PERFECT_FLOOR_MS = 40;

/**
 * The share of a felt beat the window grows to at slow tempi.
 *
 * A long beat is harder to place than a short one - a good player's scatter
 * grows with it, at a few per cent of the beat - so a window fixed in
 * milliseconds would be fair at 120 and a trap at 40.
 */
export const PERFECT_SHARE_OF_PULSE = 0.06;

/**
 * The most of the way to the neighbouring note the window may reach.
 *
 * Forty milliseconds is nearly half a sixteenth at 160: off by that much, the
 * rhythm is wrong rather than the timing loose. A third also keeps two
 * neighbouring notes' windows apart, so no press can be Perfect for both.
 */
export const PERFECT_SHARE_OF_GAP = 1 / 3;

/**
 * How far from its moment a note may land and still be Perfect, on the side
 * the press fell.
 *
 * The larger of the floor and the beat's share, and never past a third of the
 * way to the note on that side. The beat is the felt one - a dotted quarter
 * in 6/8 - and every length is read off the piece's own clock, so a change of
 * tempo partway through changes the window with it.
 */
export function perfectWindowMs(timeline: ExerciseTimeline, stepIndex: number, early: boolean): number {
  const step = timeline.at(stepIndex);
  if (step === null) {
    return PERFECT_FLOOR_MS;
  }
  const exercise = timeline.exercise;
  const pulseTicks = timeAtMeasure(exercise, step.measureIndex).ticksPerPulse;
  const pulseMs = spanMs(exercise, step.onsetTicks, step.onsetTicks + pulseTicks);
  const open = Math.max(PERFECT_FLOOR_MS, PERFECT_SHARE_OF_PULSE * pulseMs);
  const neighbour = timeline.at(early ? stepIndex - 1 : stepIndex + 1);
  if (neighbour === null) {
    return open;
  }
  const gapMs = early
    ? spanMs(exercise, neighbour.onsetTicks, step.onsetTicks)
    : spanMs(exercise, step.onsetTicks, neighbour.onsetTicks);
  return Math.min(open, gapMs * PERFECT_SHARE_OF_GAP);
}

/** How a note played this far from its moment landed: in its window or not, and the window. */
export function landing(
  timeline: ExerciseTimeline,
  stepIndex: number,
  deviationMs: number,
): { readonly tier: NoteTier; readonly windowMs: number } {
  const windowMs = perfectWindowMs(timeline, stepIndex, deviationMs < 0);
  return { tier: Math.abs(deviationMs) <= windowMs ? 'perfect' : 'good', windowMs };
}

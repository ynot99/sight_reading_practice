/**
 * Where every press of a run landed against the beat, on one line.
 *
 * The report already says the average and the spread, and two numbers cannot
 * show a shape: a reader who is ten presses early and ten presses late has the
 * same average as one who is dead on every time, and the same spread as one who
 * drifts. What the line adds is the shape of the scatter - a clump to the right
 * of centre is "you play late", two clumps is "you are guessing", and a spray
 * across the whole width is "you are not hearing the beat at all". That is what
 * the bar in osu! is for, and it is the one thing about timing this program
 * could not say. His: "hit error bar як в osu".
 *
 * Its edges are the reader's own tolerance, and not a number invented here. The
 * window they set is already the line between a press that counted and one that
 * did not, so the strip means "the whole of what was allowed" and a mark
 * against its edge means "that one only just landed". Widen the window and the
 * strip widens with it, saying the same thing about a looser reading.
 */

import type { NoteTier } from './noteTiers.js';

/** One press, placed across the strip. */
export interface HitMark {
  readonly deviationMs: number;
  /** Where it falls: nought at the early edge, a half at the beat, one late. */
  readonly of: number;
  /** True where it fell outside the window and is drawn against the edge. */
  readonly beyond: boolean;
  /** Perfect or Good, where the run said which. */
  readonly tier?: NoteTier;
}

/** What a run said about its notes, beside where they landed. */
export interface HitVerdicts {
  /** Perfect or Good for each deviation, in the same order. */
  readonly tiers?: readonly NoteTier[];
  /** The Perfect window of a typical note; see `PerformanceTiming.perfectMs`. */
  readonly perfectMs?: number | null;
}

/** A run's presses, ready to draw. */
export interface HitErrors {
  readonly marks: readonly HitMark[];
  /** Where the average press falls, on the same scale as the marks. */
  readonly meanOf: number;
  readonly early: number;
  readonly late: number;
  readonly toleranceMs: number;
  /** The Perfect window, as a span of the strip; `null` where the run did not say. */
  readonly perfect: { readonly from: number; readonly to: number } | null;
  /** How many were Perfect and how many Good; `null` where the run did not say. */
  readonly tally: { readonly perfect: number; readonly good: number } | null;
}

/**
 * Below this there is no scatter to look at, only a few marks.
 *
 * Three presses drawn across a strip invite a reader to see a tendency in what
 * is three points of noise, and a tendency is exactly what this is for.
 */
const ENOUGH_TO_BE_A_SHAPE = 4;

/**
 * The presses of a run, placed across a window of the given width.
 *
 * `null` where there is nothing to see: too few presses, or a window with no
 * width to place them in. A window of no width includes an endless one, which
 * is what the headless rig runs with - every press would land at dead centre
 * and the strip would say a flawless run had been played whatever happened.
 */
export function theHitErrors(
  deviations: readonly number[],
  toleranceMs: number,
  verdicts: HitVerdicts = {},
): HitErrors | null {
  if (
    deviations.length < ENOUGH_TO_BE_A_SHAPE ||
    !Number.isFinite(toleranceMs) ||
    toleranceMs <= 0
  ) {
    return null;
  }
  // Outside the window a press is still drawn, against the edge it went past.
  // Left off, a run of wild misses would draw as an empty strip, which reads as
  // a tidy one.
  const placeOf = (deviationMs: number): number =>
    Math.min(1, Math.max(0, 0.5 + deviationMs / (toleranceMs * 2)));
  const mean = deviations.reduce((sum, at) => sum + at, 0) / deviations.length;
  // Said only where there is a verdict for every mark: one list a mark short
  // would colour every mark after it with its neighbour's.
  const tiers = verdicts.tiers?.length === deviations.length ? verdicts.tiers : undefined;
  const perfectMs = verdicts.perfectMs ?? null;
  return {
    marks: deviations.map((deviationMs, at) => {
      const tier = tiers?.[at];
      return {
        deviationMs,
        of: placeOf(deviationMs),
        beyond: Math.abs(deviationMs) > toleranceMs,
        ...(tier === undefined ? {} : { tier }),
      };
    }),
    meanOf: placeOf(mean),
    // Dead on the beat is neither, and counting it as one of them would put a
    // machine's reading down as leaning whichever way the tie was broken.
    early: deviations.filter((at) => at < 0).length,
    late: deviations.filter((at) => at > 0).length,
    toleranceMs,
    perfect: perfectMs === null ? null : { from: placeOf(-perfectMs), to: placeOf(perfectMs) },
    tally:
      tiers === undefined
        ? null
        : {
            perfect: tiers.filter((tier) => tier === 'perfect').length,
            good: tiers.filter((tier) => tier === 'good').length,
          },
  };
}

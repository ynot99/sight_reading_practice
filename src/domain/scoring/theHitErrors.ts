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

/** One press, placed across the strip. */
export interface HitMark {
  readonly deviationMs: number;
  /** Where it falls: nought at the early edge, a half at the beat, one late. */
  readonly of: number;
  /** True where it fell outside the window and is drawn against the edge. */
  readonly beyond: boolean;
}

/** A run's presses, ready to draw. */
export interface HitErrors {
  readonly marks: readonly HitMark[];
  /** Where the average press falls, on the same scale as the marks. */
  readonly meanOf: number;
  readonly early: number;
  readonly late: number;
  readonly toleranceMs: number;
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
  return {
    marks: deviations.map((deviationMs) => ({
      deviationMs,
      of: placeOf(deviationMs),
      beyond: Math.abs(deviationMs) > toleranceMs,
    })),
    meanOf: placeOf(mean),
    // Dead on the beat is neither, and counting it as one of them would put a
    // machine's reading down as leaning whichever way the tie was broken.
    early: deviations.filter((at) => at < 0).length,
    late: deviations.filter((at) => at > 0).length,
    toleranceMs,
  };
}

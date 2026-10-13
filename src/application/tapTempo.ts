/**
 * A pause between taps longer than this begins a new count: the reader has
 * stopped tapping one tempo, and is about to tap another.
 */
export const TAPS_FORGOTTEN_AFTER_MS = 2_000;

/**
 * Gaps the tempo is read from, the latest ones. Enough to even out one tap
 * a little early, few enough that a tempo tapped faster is followed at once.
 */
const GAPS_READ = 4;

/**
 * The taps still counting towards a tempo, with a new one at `atMs`.
 *
 * Everything before a pause longer than {@link TAPS_FORGOTTEN_AFTER_MS} is
 * let go of, and only the latest few gaps are kept.
 */
export function tapsWith(taps: readonly number[], atMs: number): readonly number[] {
  const last = taps.at(-1);
  if (last === undefined || atMs - last > TAPS_FORGOTTEN_AFTER_MS || atMs <= last) {
    return [atMs];
  }
  return [...taps, atMs].slice(-(GAPS_READ + 1));
}

/**
 * The tempo the taps were tapped at, in beats a minute, or `null` before
 * there is a gap to read it from: the mean of the gaps, which a single early
 * tap moves less than it would move the last gap alone.
 */
export function tempoOfTaps(taps: readonly number[]): number | null {
  const first = taps[0];
  const last = taps.at(-1);
  if (first === undefined || last === undefined || taps.length < 2) {
    return null;
  }
  return 60_000 / ((last - first) / (taps.length - 1));
}

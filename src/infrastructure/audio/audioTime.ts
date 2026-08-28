/**
 * Turns a wall-clock moment into a moment on the audio clock.
 *
 * The metronome's ticks carry `performance.now()` times and Web Audio counts
 * in seconds of its own, so playing a note at a stated moment means crossing
 * between the two. Anything already past becomes "now": the audio clock cannot
 * be asked to sound something in the past, and a late note is better than a
 * silent one.
 */
export function audioTimeFor(context: BaseAudioContext, atMs: number | undefined): number {
  if (atMs === undefined) {
    return context.currentTime;
  }
  return context.currentTime + Math.max(0, (atMs - performance.now()) / 1000);
}

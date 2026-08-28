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

/**
 * Starts a note's release at `at`, without a step in the envelope.
 *
 * The value to fade *from* has to be the one the envelope will really hold
 * there. Reading `gain.value` gives the amplitude the note has right now,
 * which is correct for a key coming up and wrong for a release scheduled
 * ahead: a note that has not sounded yet reads as silence, and pinning that at
 * the release moment drops it from full volume to nothing in a single sample.
 * With every note of a playback scheduled ahead, that is a click on every one.
 *
 * So a release in the future is anchored at the peak the note was given, which
 * is what its envelope holds between the attack and here. The floor matters as
 * much: an exponential ramp starting from zero has nowhere to travel and
 * collapses into an instant cut, which is a release of no length at all.
 */
export function beginRelease(
  gain: AudioParam,
  at: number,
  releaseSec: number,
  options: { readonly now: number; readonly peak: number },
): void {
  const from = at > options.now ? options.peak : gain.value;
  gain.cancelScheduledValues(at);
  gain.setValueAtTime(Math.max(0.0001, from), at);
  gain.exponentialRampToValueAtTime(0.0001, at + releaseSec);
}

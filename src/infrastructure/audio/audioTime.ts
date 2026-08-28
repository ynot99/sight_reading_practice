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
 * Reading `gain.value` and pinning it is only right when the release is
 * happening now: for one scheduled ahead, the value read is whatever the
 * envelope holds *today* - silence, for a note that has not sounded yet - and
 * pinning that at the release moment drops the note from full volume to
 * nothing in a single sample. That discontinuity is a click, and with every
 * note of a playback scheduled ahead it is a click on every note.
 *
 * `cancelAndHoldAtTime` asks for the value the curve will actually have there,
 * which is the whole point of it. Where it is missing, holding the current
 * value is still right for an immediate release, which is the only kind such a
 * browser will be asked for in practice.
 */
export function beginRelease(gain: AudioParam, at: number, releaseSec: number): void {
  const holdable = gain as AudioParam & {
    cancelAndHoldAtTime?: (time: number) => AudioParam;
  };
  if (typeof holdable.cancelAndHoldAtTime === 'function') {
    holdable.cancelAndHoldAtTime(at);
  } else {
    gain.cancelScheduledValues(at);
    gain.setValueAtTime(Math.max(0.0001, gain.value), at);
  }
  gain.exponentialRampToValueAtTime(0.0001, at + releaseSec);
}

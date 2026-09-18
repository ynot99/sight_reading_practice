/**
 * How late a sound may be and still be worth making.
 *
 * Generous against ordinary jitter - a scheduler wakes a few milliseconds off
 * and that is nothing - and well inside any musical value at any tempo the
 * reader can play, so a note dropped here is one whose moment is genuinely
 * gone rather than one that is merely a little late.
 */
export const TOO_LATE_MS = 200;

/**
 * Whether a moment has gone by far enough that sounding it would be a lie.
 *
 * The thing this exists to prevent is a burst. `audioTimeFor` below turns
 * anything already past into "now", which is right for one note arriving a
 * hair late and catastrophic for a hundred: when the page stalls - and
 * engraving a long score stalls it for seconds - the scheduler wakes with
 * every note of those seconds overdue, and starts all of them at the same
 * instant. Their releases are scheduled against the same passed moments, so
 * each one dies immediately too. What comes out of the speaker is the piece
 * played many times too fast with every note cut off, which is exactly what he
 * heard: "коли стартує таке враження будто воно грає в 3 рази швидше, та кожна
 * нота обрізається".
 *
 * A note from a moment that has gone is not played late. It is not played.
 */
export function tooLateToSound(atMs: number | undefined, nowMs: number): boolean {
  if (atMs === undefined) {
    return false;
  }
  return nowMs - atMs > TOO_LATE_MS;
}

/**
 * Turns a wall-clock moment into a moment on the audio clock.
 *
 * The metronome's ticks carry `performance.now()` times and Web Audio counts
 * in seconds of its own, so playing a note at a stated moment means crossing
 * between the two. Anything already past becomes "now": the audio clock cannot
 * be asked to sound something in the past, and a note a hair late is better
 * than a silent one. Whether it is only a hair is {@link tooLateToSound}'s
 * question, and it is asked before a note is begun - never before one is
 * stopped, because a note that is sounding has to be stopped whenever the
 * program gets round to it.
 */
export function audioTimeFor(context: BaseAudioContext, atMs: number | undefined): number {
  if (atMs === undefined) {
    return context.currentTime;
  }
  return context.currentTime + Math.max(0, (atMs - performance.now()) / 1000);
}

/**
 * Takes a finished sound's nodes out of the graph.
 *
 * Every note and every click is a small chain - a source, perhaps a filter,
 * an envelope - connected to the speaker, and nothing here ever took one
 * down. A node left connected is not free: the audio thread walks the graph
 * hundreds of times a second, and a chain that has finished playing is still
 * a chain it has to visit. On a long score that is tens of thousands of them
 * by the end, one more for every note played, which is exactly the shape of
 * what he heard - fine at the start, worse the further in, and by bar a
 * thousand "вже слухати неможливо".
 *
 * Called when the source has ended, so the chain is silent by then: a release
 * is scheduled before the source is stopped, and the source is stopped after
 * the release has finished.
 */
export function unplug(...nodes: readonly { disconnect(): void }[]): void {
  for (const node of nodes) {
    node.disconnect();
  }
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

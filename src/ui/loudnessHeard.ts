/**
 * How long a loudness being set waits before it is sounded again.
 *
 * A slider dragged sends a value for every pixel it passes, and a sound for
 * each would run together into a buzz in which no single loudness can be
 * heard. Long enough for one note or click to be heard on its own, short
 * enough that the one heard is still about where the finger is.
 */
export const A_LOUDNESS_HEARD_EVERY_MS = 350;

/**
 * Sounds a loudness as it is set, so it is heard rather than read off a
 * number: once as the slider starts to move, then no more often than
 * {@link A_LOUDNESS_HEARD_EVERY_MS} while it moves, and once more where it is
 * let go of if that is not the loudness last heard.
 *
 * The last one is placed ahead on the clock rather than on a timer: a sound
 * is handed its moment, and the loudness it is sounded at is read as it is
 * handed over, which by then is the one the slider was left at.
 */
export class LoudnessHeard {
  private readonly sound: (atMs: number) => void;
  private freeFromMs = Number.NEGATIVE_INFINITY;
  private heard: string | null = null;

  constructor(sound: (atMs: number) => void) {
    this.sound = sound;
  }

  /** The slider moved to `value`: heard now, unless the last one has not had its time. */
  moved(value: string, nowMs: number): void {
    if (nowMs < this.freeFromMs) {
      return;
    }
    this.soundAt(value, nowMs);
  }

  /** The slider let go of at `value`: heard once the last has had its time, unless it was. */
  letGo(value: string, nowMs: number): void {
    if (value === this.heard) {
      return;
    }
    this.soundAt(value, Math.max(nowMs, this.freeFromMs));
  }

  private soundAt(value: string, atMs: number): void {
    this.sound(atMs);
    this.heard = value;
    this.freeFromMs = atMs + A_LOUDNESS_HEARD_EVERY_MS;
  }
}

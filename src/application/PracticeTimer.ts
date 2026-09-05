/**
 * How long the reader has been at the instrument.
 *
 * Counted from the notes they play rather than from the clock on the wall: a
 * page left open over lunch is not an hour of practice, and the reminder that
 * rides on this would be nagging about a rest they have already had.
 *
 * A silence longer than {@link idleAfterMs} is not practice either, so it is
 * not counted - the reader went to answer the door, and came back to the same
 * session rather than to a fresh one. Everything shorter is: thinking about a
 * bar, turning a page and reading it are all time at the keyboard, and the
 * hands are the thing being rested.
 *
 * No timer of its own. It is told when a note is heard and works the rest out
 * from the moments, which is what makes it testable without waiting.
 */
export class PracticeTimer {
  private readonly idleAfterMs: number;
  private sitting = 0;
  private lastHeardMs: number | null = null;

  constructor(options: { readonly idleAfterMs?: number } = {}) {
    this.idleAfterMs = options.idleAfterMs ?? DEFAULT_IDLE_AFTER_MS;
  }

  /** A note was played, at this moment on the page's clock. */
  noteHeard(atMs: number): void {
    const last = this.lastHeardMs;
    this.lastHeardMs = atMs;
    if (last === null) {
      return;
    }
    const gap = atMs - last;
    if (gap > 0 && gap <= this.idleAfterMs) {
      this.sitting += gap;
    }
  }

  /** How long they have been at it, in milliseconds. */
  get sittingMs(): number {
    return this.sitting;
  }

  /**
   * Starts the count again, a rest having been taken.
   *
   * The last note is forgotten with it: the first note after a rest opens a
   * new stretch rather than joining the one before the break.
   */
  reset(): void {
    this.sitting = 0;
    this.lastHeardMs = null;
  }
}

/** A silence this long is a break, whether or not anybody called it one. */
const DEFAULT_IDLE_AFTER_MS = 5 * 60_000;

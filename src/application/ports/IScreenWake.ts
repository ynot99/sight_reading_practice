/**
 * Keeps the screen awake while the reader is playing.
 *
 * A music stand is looked at and not touched. Playing a piece through takes
 * minutes during which nothing reaches the tablet - the hands are on the keys,
 * and the notes go to the trainer as MIDI rather than as taps - so the device
 * sees a reader who has walked away and turns the page off mid-bar.
 *
 * Asked for and let go rather than switched on: the request can be refused,
 * can be dropped by the browser whenever the page stops being visible, and is
 * not available at all in some of them. None of that is the run's business, so
 * everything the platform does about it lives behind this.
 */
export interface IScreenWake {
  /** Ask that the screen stay on. Safe to call when it already is. */
  hold(): void;
  /** Let it sleep again. Safe to call when it already may. */
  release(): void;
}

/** Null object for the browsers that cannot, and for tests that do not care. */
export class NoScreenWake implements IScreenWake {
  hold(): void {
    // Intentionally nothing.
  }

  release(): void {
    // Intentionally nothing.
  }
}

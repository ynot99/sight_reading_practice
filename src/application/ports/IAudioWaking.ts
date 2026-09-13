/**
 * The audio device, and whether it can sound anything yet.
 *
 * A browser will not start audio outside a user gesture, and a key on a MIDI
 * keyboard is not one: to the page, a reader playing the piano has not touched
 * it. So a trainer whose runs can begin by playing has to be able to say that
 * the device is still asleep, and to wake it from something the reader can
 * actually press.
 */
export interface IAudioWaking {
  /** Whether the device is awake and can sound something at once. */
  awake(): boolean;
  /** Asks it to wake. Only a call made inside a real gesture will succeed. */
  wake(): void;
  /**
   * Called after every attempt to wake, successful or not.
   *
   * Because the answer changes without anything else on the page changing: a
   * tap anywhere wakes the device, and a label that says "tap once" has to
   * stop saying it.
   */
  onChange(listener: () => void): () => void;
}

/** Null object for tests and for anywhere there is no page to touch. */
export class NoAudioWaking implements IAudioWaking {
  awake(): boolean {
    return true;
  }

  wake(): void {
    // Intentionally nothing.
  }

  onChange(): () => void {
    return () => undefined;
  }
}

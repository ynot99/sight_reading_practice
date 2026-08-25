/**
 * Optional audio feedback for the notes the player presses.
 *
 * Many MIDI controllers have no speakers of their own, so the trainer can
 * sound them. Silent implementations are perfectly valid, which is why the
 * session treats this port as fire-and-forget.
 */
export interface IPitchPlayer {
  play(midi: number, velocity: number): void;
  stop(midi: number): void;
  stopAll(): void;
}

/** Null object used when audio feedback is disabled or unavailable. */
export class SilentPitchPlayer implements IPitchPlayer {
  play(): void {
    // Intentionally silent.
  }

  stop(): void {
    // Intentionally silent.
  }

  stopAll(): void {
    // Intentionally silent.
  }
}

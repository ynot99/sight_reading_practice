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

/**
 * An instrument whose dampers can be lifted.
 *
 * Its own interface: a player that cannot sustain is still a perfectly good
 * player, and the practice session never asks for either.
 */
export interface ISustainPedal {
  readonly sustained: boolean;
  setSustain(down: boolean): void;
}

/** Null object used when audio feedback is disabled or unavailable. */
export class SilentPitchPlayer implements IPitchPlayer, ISustainPedal {
  readonly sustained = false;

  setSustain(): void {
    // Intentionally silent.
  }

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

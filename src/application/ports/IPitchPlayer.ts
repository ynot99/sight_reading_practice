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

/** When the recorded instrument is fetched, if at all. */
export type SampleLoading =
  /** Never download them; the synthesised tone covers every note. */
  | 'off'
  /** Download on the first key press, so an idle visit costs nothing. */
  | 'lazy'
  /** Download as soon as the page opens, so the first note is already right. */
  | 'eager';

export const SAMPLE_LOADING_MODES: readonly SampleLoading[] = ['off', 'lazy', 'eager'];

/**
 * A player backed by recordings that have to be fetched.
 *
 * Its own interface because the download is a real cost - a megabyte or so,
 * and a good deal more once decoded - and the reader is entitled to decide
 * whether to pay it.
 */
export interface ISampleLibrary {
  /** True once at least one recording is decoded and usable. */
  readonly ready: boolean;
  readonly loading: SampleLoading;
  setLoading(mode: SampleLoading): void;
  /** Fetches now, whatever the mode; a no-op when switched off. */
  load(): Promise<void>;
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

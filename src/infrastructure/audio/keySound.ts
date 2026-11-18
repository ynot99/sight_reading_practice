/**
 * A key's sound once struck: what the instrument needs to end it, when its
 * key comes up or when everything is silenced.
 *
 * The instrument keeps the keys - which is sounding, which the pedal holds,
 * how many may sound at once - and a voice keeps its own sound: the nodes it
 * is made of and the shape of its envelope. That is what lets one instrument
 * sound its keys from the built-in recordings or from a soundfont alike.
 */
export interface Voice {
  /** When it begins, on the audio clock: later than now for a note handed over ahead. */
  readonly startsAt: number;
  /** Its key let go of at `at`; `now` is the audio clock now. */
  release(at: number, now: number): void;
  /** Never to begin, if it has not; silenced at once if it has. */
  takeBack(now: number): void;
}

/** What a key is struck with: everything about it but where its sound comes from. */
export interface Strike {
  readonly context: AudioContext;
  readonly midi: number;
  /** How hard, 0 to 1. */
  readonly velocity: number;
  /** When, on the audio clock. */
  readonly at: number;
  /** As loud as the instrument is set, 0 to its most. */
  readonly level: number;
  /** To be called once the sound has ended and been unplugged. */
  readonly ended: () => void;
}

/** Where an instrument's keys get their sound: `null` where there is none for this key yet. */
export interface KeySounds {
  strike(strike: Strike): Voice | null;
}

import type { IClock } from '../../application/ports/IClock.js';
import type { IMidiSource, MidiEvent } from '../../application/ports/IMidiSource.js';
import { TypedEventEmitter, type Unsubscribe } from '../../shared/EventEmitter.js';

/** Keys drawn on the screen, pressed and let go by whatever touches them. */
export interface IPlayableKeys {
  press(midi: number): void;
  release(midi: number): void;
  /** Lets every key still down go, as when the keys stop being played. */
  releaseAll(): void;
}

/**
 * Plays the keys drawn on the screen.
 *
 * One more source among the keyboard and the computer's keys, so a key
 * touched is heard, lit, kept in the takes and named in a chord by the same
 * roads as one played. Nothing here knows the page: what is touched is the
 * view's to say, as which key was struck is the keyboard's.
 */
export class ScreenKeysMidiSource implements IMidiSource, IPlayableKeys {
  private readonly emitter = new TypedEventEmitter<{ midi: MidiEvent }>();
  private readonly clock: IClock;
  private readonly velocity: number;
  private readonly held = new Set<number>();

  constructor(clock: IClock, velocity = 0.7) {
    this.clock = clock;
    this.velocity = velocity;
  }

  subscribe(listener: (event: MidiEvent) => void): Unsubscribe {
    return this.emitter.on('midi', listener);
  }

  /** A key goes down, unless it already is: two fingers on one key are one press. */
  press(midi: number): void {
    if (this.held.has(midi)) {
      return;
    }
    this.held.add(midi);
    this.emitter.emit('midi', {
      type: 'noteon',
      midi,
      velocity: this.velocity,
      timestampMs: this.clock.now(),
      sourceId: 'screen-keys',
    });
  }

  /** A key comes up, if it was down. */
  release(midi: number): void {
    if (!this.held.delete(midi)) {
      return;
    }
    this.emitter.emit('midi', {
      type: 'noteoff',
      midi,
      timestampMs: this.clock.now(),
      sourceId: 'screen-keys',
    });
  }

  releaseAll(): void {
    for (const midi of [...this.held]) {
      this.release(midi);
    }
  }
}

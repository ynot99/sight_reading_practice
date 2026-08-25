import type { IClock } from '../../application/ports/IClock.js';
import type { IMidiSource, MidiEvent } from '../../application/ports/IMidiSource.js';
import { TypedEventEmitter, type Unsubscribe } from '../../shared/EventEmitter.js';

/** Two rows of the computer keyboard laid out like a piano octave and a half. */
export const DEFAULT_KEY_MAP: Readonly<Record<string, number>> = {
  KeyZ: 0,
  KeyS: 1,
  KeyX: 2,
  KeyD: 3,
  KeyC: 4,
  KeyV: 5,
  KeyG: 6,
  KeyB: 7,
  KeyH: 8,
  KeyN: 9,
  KeyJ: 10,
  KeyM: 11,
  Comma: 12,
  KeyQ: 12,
  Digit2: 13,
  KeyW: 14,
  Digit3: 15,
  KeyE: 16,
  KeyR: 17,
  Digit5: 18,
  KeyT: 19,
  Digit6: 20,
  KeyY: 21,
  Digit7: 22,
  KeyU: 23,
  KeyI: 24,
};

export interface ComputerKeyboardOptions {
  /** MIDI note the lowest mapped key produces. C3 by default. */
  readonly baseMidi?: number;
  readonly keyMap?: Readonly<Record<string, number>>;
  readonly velocity?: number;
}

export interface KeyboardEventLike {
  readonly code: string;
  readonly repeat: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  preventDefault(): void;
}

export interface KeyboardTarget {
  addEventListener(type: 'keydown' | 'keyup', listener: (event: KeyboardEventLike) => void): void;
  removeEventListener(
    type: 'keydown' | 'keyup',
    listener: (event: KeyboardEventLike) => void,
  ): void;
}

/**
 * Plays the trainer from the computer keyboard.
 *
 * Not a toy: it means the app is usable - and demonstrable - before a MIDI
 * keyboard is plugged in, and it is a second, completely independent
 * implementation of {@link IMidiSource}, which keeps that abstraction honest.
 */
export class ComputerKeyboardMidiSource implements IMidiSource {
  private readonly emitter = new TypedEventEmitter<{ midi: MidiEvent }>();
  private readonly clock: IClock;
  private readonly target: KeyboardTarget;
  private readonly keyMap: Readonly<Record<string, number>>;
  private readonly baseMidi: number;
  private readonly velocity: number;
  private readonly held = new Set<string>();

  private enabled = false;
  private readonly onKeyDown = (event: KeyboardEventLike): void => {
    if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    const offset = this.keyMap[event.code];
    if (offset === undefined || this.held.has(event.code)) {
      return;
    }
    event.preventDefault();
    this.held.add(event.code);
    this.emitter.emit('midi', {
      type: 'noteon',
      midi: this.baseMidi + offset,
      velocity: this.velocity,
      timestampMs: this.clock.now(),
      sourceId: 'computer-keyboard',
    });
  };

  private readonly onKeyUp = (event: KeyboardEventLike): void => {
    const offset = this.keyMap[event.code];
    if (offset === undefined || !this.held.delete(event.code)) {
      return;
    }
    this.emitter.emit('midi', {
      type: 'noteoff',
      midi: this.baseMidi + offset,
      timestampMs: this.clock.now(),
      sourceId: 'computer-keyboard',
    });
  };

  constructor(target: KeyboardTarget, clock: IClock, options: ComputerKeyboardOptions = {}) {
    this.target = target;
    this.clock = clock;
    this.keyMap = options.keyMap ?? DEFAULT_KEY_MAP;
    this.baseMidi = options.baseMidi ?? 48;
    this.velocity = options.velocity ?? 0.7;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  subscribe(listener: (event: MidiEvent) => void): Unsubscribe {
    return this.emitter.on('midi', listener);
  }

  enable(): void {
    if (this.enabled) {
      return;
    }
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
    this.enabled = true;
  }

  disable(): void {
    if (!this.enabled) {
      return;
    }
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
    this.held.clear();
    this.enabled = false;
  }
}

import { TypedEventEmitter, type IEventSource, type Unsubscribe } from '../shared/EventEmitter.js';
import type { IMidiSource, MidiEvent } from './ports/IMidiSource.js';

export interface ControlBindingEventMap {
  /** The reader turned the bound knob. `value` is `0..1`. */
  moved: { readonly value: number };
  /** A knob was learned, or forgotten when `controller` is `null`. */
  learned: { readonly controller: number | null };
  /** Whether the binding is waiting for a knob to be turned. */
  listeningChanged: { readonly listening: boolean };
  /**
   * Something arrived while learning, learned or not.
   *
   * Reported so the reader can tell "I turned the wrong thing" from "this
   * knob sends nothing at all" - a distinction they cannot make from a
   * screen that simply waits, and some knobs really are analogue.
   */
  heard: { readonly controller: number; readonly value: number; readonly positions: number };
}

/**
 * Movements a knob must make before it is believed.
 *
 * One controller message is not a knob: a keyboard sends bank selects, mode
 * messages and a reset on connect, any of which would be learned instantly and
 * then never move again. A knob being *turned* sends a stream, so asking for a
 * few distinct positions costs the reader nothing and rules the rest out.
 */
const MOVES_TO_LEARN = 3;

/**
 * Learns which knob the reader means, by having them turn it.
 *
 * There is no standard controller number for a volume knob - 7 and 11 are both
 * common, and a manufacturer may choose anything - so a table of guesses would
 * be wrong for someone. Turning the knob is the one description that is always
 * accurate, and it works for a keyboard nobody has tested.
 *
 * Owns no volume of its own: it reports where the knob is and something else
 * decides what that means, which is what keeps it usable for a second knob
 * later without becoming a volume control with opinions.
 */
export class ControlBinding {
  private readonly emitter = new TypedEventEmitter<ControlBindingEventMap>();
  private subscription: Unsubscribe | null = null;
  private bound: number | null = null;
  private listening = false;
  /** Distinct positions seen per controller while learning. */
  private readonly seen = new Map<number, Set<number>>();

  get events(): IEventSource<ControlBindingEventMap> {
    return this.emitter.asSource();
  }

  /** The controller number in use, or `null` when nothing is bound. */
  get controller(): number | null {
    return this.bound;
  }

  get isLearning(): boolean {
    return this.listening;
  }

  listenTo(source: IMidiSource): Unsubscribe {
    this.stop();
    this.subscription = source.subscribe((event) => this.accept(event));
    return () => this.stop();
  }

  stop(): void {
    this.subscription?.();
    this.subscription = null;
  }

  /** Adopts a remembered binding, without asking the reader to teach it again. */
  bindTo(controller: number | null): void {
    this.bound = controller;
    this.cancelLearning();
  }

  /** Starts waiting for a knob. The next one turned wins. */
  learn(): void {
    this.seen.clear();
    this.setListening(true);
  }

  cancelLearning(): void {
    this.seen.clear();
    this.setListening(false);
  }

  /** Gives the knob back, so the sliders are the only thing in charge again. */
  forget(): void {
    this.cancelLearning();
    if (this.bound !== null) {
      this.bound = null;
      this.emitter.emit('learned', { controller: null });
    }
  }

  dispose(): void {
    this.stop();
    this.emitter.removeAllListeners();
  }

  private accept(event: MidiEvent): void {
    if (event.type !== 'control') {
      return;
    }
    if (this.listening) {
      this.considerLearning(event.controller, event.value);
      return;
    }
    if (event.controller === this.bound) {
      this.emitter.emit('moved', { value: event.value });
    }
  }

  private considerLearning(controller: number, value: number): void {
    const positions = this.seen.get(controller) ?? new Set<number>();
    positions.add(Math.round(value * 127));
    this.seen.set(controller, positions);
    this.emitter.emit('heard', { controller, value, positions: positions.size });
    if (positions.size < MOVES_TO_LEARN) {
      return;
    }
    this.bound = controller;
    this.cancelLearning();
    this.emitter.emit('learned', { controller });
    // The turn that taught it is also a turn: acting on it means the knob
    // takes effect in the same gesture rather than on the next one.
    this.emitter.emit('moved', { value });
  }

  private setListening(listening: boolean): void {
    if (this.listening === listening) {
      return;
    }
    this.listening = listening;
    this.emitter.emit('listeningChanged', { listening });
  }
}

import type { MidiFileEvent } from '../domain/midi/MidiFile.js';
import type { IClock } from './ports/IClock.js';
import type { IMidiSource, MidiEvent } from './ports/IMidiSource.js';
import { TypedEventEmitter, type IEventSource, type Unsubscribe } from '../shared/EventEmitter.js';

export interface PerformanceRecorderOptions {
  /**
   * Events kept before the oldest are forgotten.
   *
   * A bound on memory, not on musical length: twenty thousand events is
   * something like two hours of steady playing, and the alternative is a tab
   * that grows all day.
   */
  readonly capacity?: number;
  /**
   * Silence that ends a take, in milliseconds.
   *
   * A take is bounded by silence rather than by a window of time because that
   * is where a musician would cut it: you stop, you think, you play the next
   * thing. Four seconds is long enough to survive a held pause inside a
   * phrase and short enough that a practice session does not arrive attached
   * to the idea that followed it.
   */
  readonly silenceMs?: number;
}

const DEFAULT_CAPACITY = 20_000;
const DEFAULT_SILENCE_MS = 4_000;

/** A stretch of playing, already rebased so it begins at zero. */
export interface Take {
  readonly events: readonly MidiFileEvent[];
  readonly durationMs: number;
  readonly noteCount: number;
}

/** What a recorder publishes. */
export interface RecorderEventMap {
  /**
   * A stretch of playing that has ended, because a new one has begun.
   *
   * Noticed on the next event rather than announced by a timer: the recorder
   * has no clock of its own to fire, which is what lets a whole session be
   * replayed instantly in a test. The consequence is that a take is closed
   * when the reader plays again, not the moment they stop - which is the
   * moment anything could act on it anyway.
   */
  takeClosed: { readonly take: Take };
}

interface Captured {
  readonly event: MidiFileEvent;
  /** Wall-clock arrival, kept apart so the take can be rebased on take-out. */
  readonly atMs: number;
}

/**
 * Keeps what was just played, so that it can still be kept afterwards.
 *
 * Always running, and that is the whole design. An idea worth saving is one
 * you notice *after* playing it, so a Record button would arrive too late by
 * definition - by the time the reader reaches for it the thing they wanted is
 * already in the past. The reader's button says "keep that", not "start".
 *
 * No timers of its own: it reads the clock when an event arrives, which is
 * what lets a whole session be replayed instantly in a test.
 */
export class PerformanceRecorder {
  private readonly clock: IClock;
  private readonly capacity: number;
  private readonly silenceMs: number;
  private readonly captured: Captured[] = [];
  private readonly emitter = new TypedEventEmitter<RecorderEventMap>();
  private subscription: Unsubscribe | null = null;
  /** Keys still down, so a take can release what it cut through. */
  private readonly holding = new Map<number, number>();

  constructor(clock: IClock, options: PerformanceRecorderOptions = {}) {
    this.clock = clock;
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;
  }

  get events(): IEventSource<RecorderEventMap> {
    return this.emitter.asSource();
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

  /** Everything still held, for tests and for the take's closing releases. */
  get pendingEvents(): number {
    return this.captured.length;
  }

  private accept(event: MidiEvent): void {
    const atMs = this.clock.now();
    this.closeTakeBefore(atMs);
    switch (event.type) {
      case 'noteon':
        this.holding.set(event.midi, atMs);
        this.push({ kind: 'noteOn', atMs: 0, midi: event.midi, velocity: event.velocity }, atMs);
        return;
      case 'noteoff':
        this.holding.delete(event.midi);
        this.push({ kind: 'noteOff', atMs: 0, midi: event.midi }, atMs);
        return;
      case 'pedal':
        this.push({ kind: 'sustain', atMs: 0, value: event.value }, atMs);
        return;
      default:
        return;
    }
  }

  /**
   * Publishes the stretch just ended, when this event opens a new one.
   *
   * The reader who plays an idea and then plays another has lost the first
   * one unless something files it - and they have no way of knowing that
   * until they look for it. So every take that ends is kept; deciding which
   * ones are worth keeping *for good* stays a separate act.
   */
  private closeTakeBefore(atMs: number): void {
    const last = this.captured[this.captured.length - 1];
    if (last === undefined || atMs - last.atMs < this.silenceMs) {
      return;
    }
    const closing = this.take();
    if (closing !== null) {
      this.emitter.emit('takeClosed', { take: closing });
    }
  }

  private push(event: MidiFileEvent, atMs: number): void {
    this.captured.push({ event, atMs });
    while (this.captured.length > this.capacity) {
      this.captured.shift();
    }
  }

  /**
   * The last stretch of playing, or `null` when nothing is held.
   *
   * Cut at the last silence and rebased to zero, so the file starts at the
   * first note rather than at whenever the tab was opened. Notes still down
   * when the take ends are released at its end: a note-on whose note-off
   * never arrives is a note that rings for ever in every program that opens
   * the file.
   */
  take(): Take | null {
    const from = this.startOfLastTake();
    if (from === null) {
      return null;
    }
    const slice = this.captured.slice(from);
    const first = slice[0];
    const last = slice[slice.length - 1];
    if (first === undefined || last === undefined) {
      return null;
    }

    const origin = first.atMs;
    const events: MidiFileEvent[] = slice.map(({ event, atMs }) => ({
      ...event,
      atMs: atMs - origin,
    }));

    const endMs = last.atMs - origin;
    for (const [midi, downAt] of this.holding) {
      if (downAt >= origin) {
        events.push({ kind: 'noteOff', atMs: endMs, midi });
      }
    }

    return {
      events,
      durationMs: endMs,
      noteCount: events.filter((event) => event.kind === 'noteOn').length,
    };
  }

  /** How long the take on offer is, without building it. */
  get takeDurationMs(): number {
    const from = this.startOfLastTake();
    if (from === null) {
      return 0;
    }
    const first = this.captured[from];
    const last = this.captured[this.captured.length - 1];
    return first === undefined || last === undefined ? 0 : last.atMs - first.atMs;
  }

  /** Throws away everything held, once the reader has what they wanted. */
  clear(): void {
    this.captured.length = 0;
    this.holding.clear();
  }

  /** Releases every listener. */
  dispose(): void {
    this.stop();
    this.emitter.removeAllListeners();
  }

  /** Index of the first event after the last long silence. */
  private startOfLastTake(): number | null {
    if (this.captured.length === 0) {
      return null;
    }
    for (let at = this.captured.length - 1; at > 0; at -= 1) {
      const gap = (this.captured[at]?.atMs ?? 0) - (this.captured[at - 1]?.atMs ?? 0);
      if (gap >= this.silenceMs) {
        return at;
      }
    }
    return 0;
  }
}

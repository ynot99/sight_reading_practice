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
  /**
   * Public because the reader is entitled to see this rule, not only live
   * under it: the page counts the same silence out so that the moment a
   * press would start a fresh take is shown rather than learnt by feel.
   */
  readonly silenceMs: number;
  private readonly captured: Captured[] = [];
  private readonly emitter = new TypedEventEmitter<RecorderEventMap>();
  private subscription: Unsubscribe | null = null;
  /**
   * How much had been captured when the last take was closed.
   *
   * A stretch of playing ends once. Anything at all can wake the recorder
   * afterwards - a knob being turned sends a stream of messages, and none of
   * them is playing - and each one arrived after the same silence and closed
   * the same take again. `-1` because no length can equal it.
   */
  private closedAtLength = -1;
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

  /**
   * How long the keyboard has been quiet, or `null` when nothing is held.
   *
   * Read from the clock on being asked, like everything else here, so it
   * needs no timer of its own. What it is for is the page: a reader waiting
   * to start a fresh take had no way of knowing when the last one had ended,
   * and was left counting seconds under their breath.
   */
  get silenceSoFarMs(): number | null {
    const last = this.captured[this.captured.length - 1];
    return last === undefined ? null : Math.max(0, this.clock.now() - last.atMs);
  }

  /**
   * True once the silence has run long enough that the next press begins a
   * new take rather than continuing this one.
   */
  get takeIsSealed(): boolean {
    const quiet = this.silenceSoFarMs;
    return quiet !== null && quiet >= this.silenceMs;
  }

  private accept(event: MidiEvent): void {
    const atMs = this.struckAt(event);
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
   * When the key was struck, rather than when the message got here.
   *
   * These are the same thing at the desk and they are not over a network. A
   * relay stamps each event at the keyboard and then sends it; the sending
   * is not steady, and a tablet does not wake at a steady rate either, so
   * what arrives is the right notes at slightly wrong moments - a few tens
   * of milliseconds either way, every note. That is inaudible as a number
   * and unmistakable as a sound: the recording comes back uneven, and the
   * same playing captured at the desk comes back clean. Which is exactly
   * how the reader described it.
   *
   * The stamp is already the honest answer - it is what every judgement is
   * measured against, and the whole clock-skew estimate exists to make it
   * so. This was simply never told.
   *
   * The clock stays as the fallback, for a source that stamps nothing.
   */
  private struckAt(event: MidiEvent): number {
    const stamped = event.timestampMs;
    return typeof stamped === 'number' && Number.isFinite(stamped) ? stamped : this.clock.now();
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
    if (this.captured.length === this.closedAtLength) {
      return;
    }
    this.closedAtLength = this.captured.length;
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

    // A pedal already down when the take begins, said at its beginning.
    // Same reason the held keys are released at its end: a take has to carry
    // everything needed to hear it, and a foot that went down before the cut
    // is a foot nothing downstream can know about. Without this the opening
    // of a take taken out of the middle of a session comes out dry.
    const pedal = this.pedalBefore(from);
    if (pedal !== null) {
      events.unshift({ kind: 'sustain', atMs: 0, value: pedal });
    }

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

  /**
   * How long this stretch of playing has been running, read from the clock.
   *
   * Not the same as {@link takeDurationMs}, and deliberately. That one is the
   * length of what would be *kept* - the last event minus the first - so it
   * cannot move while nothing is arriving. Shown on a counter that is
   * supposed to be running, it stands still through every small pause and
   * then jumps forward by the length of it, which reads as a fault in the
   * recording rather than as the reader having stopped for a moment.
   *
   * This is what a recorder's counter counts: time since the take opened,
   * still going while the reader thinks. Once the silence has sealed the
   * take the two are the same thing, and it is the kept length that stands.
   */
  get takeRunningMs(): number {
    if (this.takeIsSealed) {
      return this.takeDurationMs;
    }
    const from = this.startOfLastTake();
    const first = from === null ? undefined : this.captured[from];
    return first === undefined ? 0 : Math.max(0, this.clock.now() - first.atMs);
  }

  /** Throws away everything held, once the reader has what they wanted. */
  clear(): void {
    this.captured.length = 0;
    this.holding.clear();
    this.closedAtLength = -1;
  }

  /** Releases every listener. */
  dispose(): void {
    this.stop();
    this.emitter.removeAllListeners();
  }

  /**
   * How far the pedal was down just before `from`, or `null` when it was up.
   *
   * Only a pedal that is *down* is news: an up one is what a take is assumed
   * to start with, and saying so would be a mark on the page for nothing.
   */
  private pedalBefore(from: number): number | null {
    for (let at = from - 1; at >= 0; at -= 1) {
      const event = this.captured[at]?.event;
      if (event?.kind === 'sustain') {
        return event.value >= 0.5 ? event.value : null;
      }
    }
    return null;
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

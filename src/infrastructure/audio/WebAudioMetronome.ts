import { TimeSignature } from '../../domain/model/TimeSignature.js';
import type {
  BeatWeight,
  IMetronome,
  MetronomeConfig,
  MetronomeTick,
} from '../../application/ports/IMetronome.js';
import { volumeToGain, type IVolumeControl } from '../../application/ports/IVolumeControl.js';
import { TypedEventEmitter, type Unsubscribe } from '../../shared/EventEmitter.js';
import {
  buildMetronomeTick,
  isAudibleClick,
  subdivisionSecondsAt,
  ticksPerSubdivision,
} from './metronomeMath.js';

export interface WebAudioMetronomeOptions {
  /** How often the scheduler wakes up, in milliseconds. */
  readonly schedulerIntervalMs?: number;
  /** How far ahead audio is scheduled, in seconds. */
  readonly scheduleAheadSec?: number;
  readonly downbeatFrequency?: number;
  readonly beatFrequency?: number;
  readonly subdivisionFrequency?: number;
  readonly gain?: number;
}

interface ScheduledTick {
  readonly tick: MetronomeTick;
  readonly audioTime: number;
}

const DEFAULT_CONFIG: MetronomeConfig = {
  bpm: 72,
  timeSignature: new TimeSignature(4, 4),
  // Nothing to beat through until something is loaded, which counts from
  // the start in the metre above.
  bars: [],
  tempos: [],
  subdivisionsPerPulse: 4,
  click: 'pulse',
  dropout: null,
  endsAtTicks: null,
  muted: false,
};

/**
 * Web Audio metronome with look-ahead scheduling.
 *
 * `setInterval` is far too jittery to place clicks, so audio is scheduled
 * ahead of time on the audio clock while the logical tick is *delivered* at
 * its due moment. Each tick also carries the exact time it represents, which
 * lets Flow mode grade timing without inheriting any scheduler jitter.
 */
export class WebAudioMetronome implements IMetronome, IVolumeControl {
  private readonly emitter = new TypedEventEmitter<{ tick: MetronomeTick }>();
  private readonly contextFactory: () => AudioContext;
  private readonly options: Required<WebAudioMetronomeOptions>;

  private context: AudioContext | null = null;
  private config: MetronomeConfig = DEFAULT_CONFIG;
  private timer: ReturnType<typeof setInterval> | null = null;
  private queue: ScheduledTick[] = [];
  /** One-off clicks already on the audio clock, so a stop can take them back. */
  private pending: OscillatorNode[] = [];
  private nextTickIndex = 0;
  private nextTickAudioTime = 0;
  private audioEpochMs = 0;
  private currentVolume = 1;

  constructor(contextFactory: () => AudioContext, options: WebAudioMetronomeOptions = {}) {
    this.contextFactory = contextFactory;
    this.options = {
      schedulerIntervalMs: options.schedulerIntervalMs ?? 20,
      scheduleAheadSec: options.scheduleAheadSec ?? 0.12,
      downbeatFrequency: options.downbeatFrequency ?? 1600,
      beatFrequency: options.beatFrequency ?? 1100,
      subdivisionFrequency: options.subdivisionFrequency ?? 800,
      gain: options.gain ?? 0.28,
    };
  }

  get isRunning(): boolean {
    return this.timer !== null;
  }

  get volume(): number {
    return this.currentVolume;
  }

  /** Takes effect from the next click; already-scheduled ones keep their level. */
  setVolume(volume: number): void {
    this.currentVolume = Math.min(1, Math.max(0, volume));
  }

  configure(config: MetronomeConfig): void {
    if (this.timer === null) {
      this.config = config;
      return;
    }
    // Re-dressed, not restarted. The next tick keeps the moment it was going
    // to sound at and the place in the music it was going to be; only how
    // often they come afterwards, and which of them are heard, changes.
    //
    // Clicks already scheduled inside the look-ahead still sound in the old
    // pattern - they are in the audio graph, a tenth of a second ahead. That
    // is a tenth of a second, and unpicking it would mean the reader's own
    // pulse stuttering to answer a button.
    const positionTicks = this.nextTickIndex * ticksPerSubdivision(this.config);
    this.config = config;
    this.nextTickIndex = Math.ceil(positionTicks / ticksPerSubdivision(config));
  }

  onTick(listener: (tick: MetronomeTick) => void): Unsubscribe {
    return this.emitter.on('tick', listener);
  }

  start(): void {
    if (this.isRunning) {
      return;
    }
    const context = this.ensureContext();
    void context.resume();

    this.queue = [];
    this.nextTickIndex = 0;
    this.nextTickAudioTime = context.currentTime + 0.06;
    this.audioEpochMs = performance.now() - context.currentTime * 1000;

    this.timer = setInterval(() => {
      this.pump();
    }, this.options.schedulerIntervalMs);
    this.pump();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.queue = [];
    this.forgetPendingClicks();
  }

  private ensureContext(): AudioContext {
    if (this.context === null) {
      this.context = this.contextFactory();
    }
    return this.context;
  }

  /** Schedules everything due soon, then delivers everything already due. */
  private pump(): void {
    const context = this.ensureContext();
    const horizon = context.currentTime + this.options.scheduleAheadSec;

    while (this.nextTickAudioTime < horizon) {
      const tick = this.buildTick(this.nextTickIndex, this.nextTickAudioTime);
      if (!this.config.muted && isAudibleClick(tick, this.config)) {
        this.playClick(context, tick, this.nextTickAudioTime);
      }
      this.queue.push({ tick, audioTime: this.nextTickAudioTime });
      this.nextTickIndex += 1;
      this.nextTickAudioTime += subdivisionSecondsAt(this.config, this.nextTickIndex - 1);
    }

    // Delivered when the click is *heard*, not when the graph reaches it.
    //
    // `currentTime` is the frame being processed; the click leaves the
    // speaker a whole output buffer later, which on a tablet is a tenth of a
    // second or more. Everything that acts on a tick acts on it visibly -
    // the cursor steps, the step closes - so delivering at `audioTime` put
    // the marker that much ahead of the sound. The reader's report was
    // exactly that: the metronome and the notes agree, and the cursor is a
    // little in front of both.
    //
    // The arithmetic is untouched by this: `scheduledTimeMs` already says
    // when the click is heard, and it is what every judgement is measured
    // against. This only stops the page acting on a beat before there is a
    // beat to act on.
    const heard = context.currentTime - this.outputLatencyMs() / 1000;
    while (this.queue.length > 0) {
      const head = this.queue[0];
      if (head === undefined || head.audioTime > heard) {
        break;
      }
      this.queue.shift();
      this.emitter.emit('tick', head.tick);
    }
  }

  private buildTick(index: number, audioTime: number): MetronomeTick {
    return buildMetronomeTick(
      index,
      this.config,
      this.audioEpochMs + audioTime * 1000 + this.outputLatencyMs(),
    );
  }

  /**
   * How long after being scheduled a sound actually leaves the device.
   *
   * `currentTime` is the frame the context is *processing*, not the one
   * anybody has heard: a buffer's worth of audio, and on a tablet several,
   * still lie between it and the speaker. Without this the tick claimed to be
   * the moment the click was heard while being the moment it was queued -
   * which is what `MetronomeTick.scheduledTimeMs` has always promised and
   * this has never delivered.
   *
   * It matters because a reader plays to the click. Every press was then
   * judged against a beat that had not been heard yet, so playing perfectly
   * in time read as playing late, by exactly this much, on every note. The
   * browser knows the number; it was simply never asked.
   *
   * Read at each tick rather than once: plugging in headphones or waking a
   * Bluetooth speaker changes it mid-run.
   */
  private outputLatencyMs(): number {
    const context = this.context as (AudioContext & {
      outputLatency?: number;
      baseLatency?: number;
    }) | null;
    if (context === null) {
      return 0;
    }
    // `outputLatency` is the whole path and the right answer; `baseLatency`
    // is only the graph's own buffering, and stands in where the first is not
    // implemented. Neither is guaranteed, hence the floor at zero.
    const seconds = context.outputLatency ?? context.baseLatency ?? 0;
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  }

  /**
   * Sounds one click at a moment on the page's clock, running or not.
   *
   * The epoch is worked out afresh rather than taken from the last start:
   * this is asked for by a mode that never starts the pulse at all, and the
   * two clocks drift apart over a practice session anyway.
   */
  click(atMs?: number, weight: BeatWeight = 'beat'): void {
    const context = this.ensureContext();
    void context.resume();
    const epoch = performance.now() - context.currentTime * 1000;
    const at = atMs === undefined ? context.currentTime : (atMs - epoch) / 1000;
    // Kept, so that stopping can take back the ones that have not sounded.
    // These are laid out as far ahead as the reader's next entry, which on a
    // held note is a bar or more of beats waiting to be heard.
    const pending = this.sound(
      context,
      Math.max(context.currentTime, at),
      weight === 'downbeat',
      weight !== 'division',
    );
    if (pending !== null) {
      this.pending.push(pending);
    }
  }

  private playClick(context: AudioContext, tick: MetronomeTick, at: number): void {
    this.sound(context, at, tick.isDownbeat, tick.isPulse);
  }

  private sound(
    context: AudioContext,
    at: number,
    downbeat: boolean,
    pulse: boolean,
  ): OscillatorNode | null {
    const level = volumeToGain(this.currentVolume, this.options.gain);
    if (level <= 0) {
      return null;
    }
    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    oscillator.frequency.value = downbeat
      ? this.options.downbeatFrequency
      : pulse
        ? this.options.beatFrequency
        : this.options.subdivisionFrequency;
    oscillator.type = 'square';

    const peak = pulse ? level : level * 0.35;
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(peak, at + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);

    oscillator.connect(envelope).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.06);
    return oscillator;
  }

  /** Silences the one-off clicks that have not sounded yet. */
  private forgetPendingClicks(): void {
    const now = this.context?.currentTime ?? 0;
    for (const oscillator of this.pending) {
      try {
        oscillator.stop(now);
      } catch {
        // It had already finished on its own.
      }
    }
    this.pending = [];
  }
}

/** Lazily creates a single shared AudioContext, resumed on first use. */
export function createAudioContextFactory(): () => AudioContext {
  let context: AudioContext | null = null;
  return () => {
    if (context === null) {
      context = new AudioContext();
    }
    return context;
  };
}

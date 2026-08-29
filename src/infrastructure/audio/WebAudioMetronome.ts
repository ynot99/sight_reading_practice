import { TimeSignature } from '../../domain/model/TimeSignature.js';
import type { IMetronome, MetronomeConfig, MetronomeTick } from '../../application/ports/IMetronome.js';
import { volumeToGain, type IVolumeControl } from '../../application/ports/IVolumeControl.js';
import { TypedEventEmitter, type Unsubscribe } from '../../shared/EventEmitter.js';
import { buildMetronomeTick, isAudibleClick, subdivisionSeconds } from './metronomeMath.js';

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
  subdivisionsPerPulse: 4,
  click: 'pulse',
  dropout: null,
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
    this.config = config;
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
      this.nextTickAudioTime += subdivisionSeconds(this.config);
    }

    while (this.queue.length > 0) {
      const head = this.queue[0];
      if (head === undefined || head.audioTime > context.currentTime) {
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

  private playClick(context: AudioContext, tick: MetronomeTick, at: number): void {
    const level = volumeToGain(this.currentVolume, this.options.gain);
    if (level <= 0) {
      return;
    }
    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    oscillator.frequency.value = tick.isDownbeat
      ? this.options.downbeatFrequency
      : tick.isPulse
        ? this.options.beatFrequency
        : this.options.subdivisionFrequency;
    oscillator.type = 'square';

    const peak = tick.isPulse ? level : level * 0.35;
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(peak, at + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);

    oscillator.connect(envelope).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.06);
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

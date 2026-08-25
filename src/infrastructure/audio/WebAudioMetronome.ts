import { TimeSignature } from '../../domain/model/TimeSignature.js';
import type { IMetronome, MetronomeConfig, MetronomeTick } from '../../application/ports/IMetronome.js';
import { TypedEventEmitter, type Unsubscribe } from '../../shared/EventEmitter.js';
import { buildMetronomeTick, subdivisionSeconds } from './metronomeMath.js';

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
  subdivisionsPerBeat: 4,
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
export class WebAudioMetronome implements IMetronome {
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
      if (!this.config.muted) {
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
    return buildMetronomeTick(index, this.config, this.audioEpochMs + audioTime * 1000);
  }

  private playClick(context: AudioContext, tick: MetronomeTick, at: number): void {
    if (!tick.isBeat && this.options.subdivisionFrequency <= 0) {
      return;
    }
    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    oscillator.frequency.value = tick.isDownbeat
      ? this.options.downbeatFrequency
      : tick.isBeat
        ? this.options.beatFrequency
        : this.options.subdivisionFrequency;
    oscillator.type = 'square';

    const peak = tick.isBeat ? this.options.gain : this.options.gain * 0.35;
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

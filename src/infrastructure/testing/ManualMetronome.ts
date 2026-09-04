import type { IMetronome, MetronomeConfig, MetronomeTick } from '../../application/ports/IMetronome.js';
import { TimeSignature } from '../../domain/model/TimeSignature.js';
import { TypedEventEmitter, type Unsubscribe } from '../../shared/EventEmitter.js';
import {
  buildMetronomeTick,
  subdivisionSecondsAt,
  ticksPerSubdivision,
} from '../audio/metronomeMath.js';
import type { ManualClock } from './ManualClock.js';

const DEFAULT_CONFIG: MetronomeConfig = {
  bpm: 60,
  timeSignature: new TimeSignature(4, 4),
  bars: [],
  tempos: [],
  subdivisionsPerPulse: 4,
  click: 'pulse',
  dropout: null,
  endsAtTicks: null,
  muted: true,
};

/**
 * Metronome the test advances by hand.
 *
 * Ticks carry the same scheduled times a real audio clock would produce, so a
 * whole Flow-mode run can be replayed in microseconds while still exercising
 * the timing arithmetic exactly as it runs in the browser.
 */
export class ManualMetronome implements IMetronome {
  private readonly emitter = new TypedEventEmitter<{ tick: MetronomeTick }>();
  private readonly clock: ManualClock | null;

  private config: MetronomeConfig = DEFAULT_CONFIG;
  private running = false;
  private nextIndex = 0;
  /**
   * Clock time the next tick falls at, carried forward rather than derived.
   *
   * A start time plus so many equal subdivisions only works while the piece
   * keeps one tempo; carrying the moment forward costs nothing and is right
   * either way.
   */
  private nextTimeMs = 0;

  /** Every tick emitted so far, for assertions. */
  readonly emitted: MetronomeTick[] = [];

  constructor(clock?: ManualClock) {
    this.clock = clock ?? null;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentConfig(): MetronomeConfig {
    return this.config;
  }

  /** Index of the next tick that {@link advanceSubdivisions} will emit. */
  get nextTickIndex(): number {
    return this.nextIndex;
  }

  configure(config: MetronomeConfig): void {
    if (!this.running) {
      this.config = config;
      return;
    }
    // Where the next tick was going to be in the music, before anything
    // moves: the pulse is being re-dressed, not restarted, so it keeps both
    // its place and the moment it was going to sound at.
    const positionTicks = this.nextIndex * ticksPerSubdivision(this.config);

    this.config = config;
    this.nextIndex = Math.ceil(positionTicks / ticksPerSubdivision(config));
  }

  onTick(listener: (tick: MetronomeTick) => void): Unsubscribe {
    return this.emitter.on('tick', listener);
  }

  start(): void {
    this.running = true;
    this.nextIndex = 0;
    this.nextTimeMs = this.clock?.now() ?? 0;
  }

  stop(): void {
    this.running = false;
  }

  /** Milliseconds the next subdivision lasts, at the tempo in force there. */
  get subdivisionMs(): number {
    return subdivisionSecondsAt(this.config, this.nextIndex) * 1000;
  }

  /**
   * Emits the next `count` subdivisions, moving the injected clock with them
   * so listeners see wall-clock time advance exactly as it would live.
   */
  advanceSubdivisions(count = 1): MetronomeTick[] {
    const ticks: MetronomeTick[] = [];
    for (let step = 0; step < count; step += 1) {
      if (!this.running) {
        break;
      }
      const scheduledTimeMs = this.nextTimeMs;
      const tick = buildMetronomeTick(this.nextIndex, this.config, scheduledTimeMs);
      this.nextTimeMs += subdivisionSecondsAt(this.config, this.nextIndex) * 1000;
      this.nextIndex += 1;
      this.clock?.set(scheduledTimeMs);
      this.emitted.push(tick);
      ticks.push(tick);
      this.emitter.emit('tick', tick);
    }
    return ticks;
  }

  /** Emits whole beats' worth of subdivisions. */
  advanceBeats(count = 1): MetronomeTick[] {
    return this.advanceSubdivisions(count * this.config.subdivisionsPerPulse);
  }

  /** Emits subdivisions until the given musical position has been reached. */
  advanceToTicks(positionTicks: number): MetronomeTick[] {
    const emitted: MetronomeTick[] = [];
    let guard = 100_000;
    while (this.running && guard > 0) {
      const nextPosition =
        this.nextIndex * (this.config.timeSignature.ticksPerPulse / this.config.subdivisionsPerPulse);
      if (nextPosition > positionTicks) {
        break;
      }
      emitted.push(...this.advanceSubdivisions(1));
      guard -= 1;
    }
    return emitted;
  }
}

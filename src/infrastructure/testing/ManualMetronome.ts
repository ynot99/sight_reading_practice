import type { IMetronome, MetronomeConfig, MetronomeTick } from '../../application/ports/IMetronome.js';
import { TimeSignature } from '../../domain/model/TimeSignature.js';
import { TypedEventEmitter, type Unsubscribe } from '../../shared/EventEmitter.js';
import { buildMetronomeTick, subdivisionSeconds } from '../audio/metronomeMath.js';
import type { ManualClock } from './ManualClock.js';

const DEFAULT_CONFIG: MetronomeConfig = {
  bpm: 60,
  timeSignature: new TimeSignature(4, 4),
  subdivisionsPerBeat: 4,
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
  private startTimeMs = 0;

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
    this.config = config;
  }

  onTick(listener: (tick: MetronomeTick) => void): Unsubscribe {
    return this.emitter.on('tick', listener);
  }

  start(): void {
    this.running = true;
    this.nextIndex = 0;
    this.startTimeMs = this.clock?.now() ?? 0;
  }

  stop(): void {
    this.running = false;
  }

  /** Milliseconds between two subdivisions at the configured tempo. */
  get subdivisionMs(): number {
    return subdivisionSeconds(this.config) * 1000;
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
      const scheduledTimeMs = this.startTimeMs + this.nextIndex * this.subdivisionMs;
      const tick = buildMetronomeTick(this.nextIndex, this.config, scheduledTimeMs);
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
    return this.advanceSubdivisions(count * this.config.subdivisionsPerBeat);
  }

  /** Emits subdivisions until the given musical position has been reached. */
  advanceToTicks(positionTicks: number): MetronomeTick[] {
    const emitted: MetronomeTick[] = [];
    let guard = 100_000;
    while (this.running && guard > 0) {
      const nextPosition = this.nextIndex * (this.config.timeSignature.ticksPerBeat / this.config.subdivisionsPerBeat);
      if (nextPosition > positionTicks) {
        break;
      }
      emitted.push(...this.advanceSubdivisions(1));
      guard -= 1;
    }
    return emitted;
  }
}

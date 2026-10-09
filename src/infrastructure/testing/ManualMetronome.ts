import type {
  BeatWeight,
  IMetronome,
  MetronomeConfig,
  MetronomeTick,
} from '../../application/ports/IMetronome.js';
import { TimeSignature } from '../../domain/model/TimeSignature.js';
import { TypedEventEmitter, type Unsubscribe } from '../../shared/EventEmitter.js';
import {
  buildMetronomeTick,
  isHeldBack,
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
  private readonly emitter = new TypedEventEmitter<{ tick: MetronomeTick; placed: MetronomeTick }>();
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

  /**
   * Ticks placed by {@link placeAhead} and not heard yet, oldest first: what
   * a real metronome has on the audio clock ahead of the speaker.
   */
  private readonly placedNotHeard: MetronomeTick[] = [];

  /** Every tick emitted so far, for assertions. */
  readonly emitted: MetronomeTick[] = [];
  /** Every one-off click asked for, as the moment it was asked to sound at. */
  readonly clicks: { readonly atMs: number | undefined; readonly weight: BeatWeight }[] = [];

  /** How many times the clicks not yet heard were taken back. */
  clicksTakenBack = 0;

  click(atMs?: number, weight: BeatWeight = 'beat'): void {
    this.clicks.push({ atMs, weight });
  }

  takeBackTheClicks(): void {
    this.clicksTakenBack += 1;
  }

  /**
   * How long after `start()` the first tick falls, in milliseconds.
   *
   * Nought by default, which is the convenient fiction most tests want. A real
   * metronome cannot sound a click the instant it is asked to: the scheduler
   * needs a moment to place it and the device needs longer to play it, so its
   * first beat is always a little after the asking. Tests about what a run is
   * measured *by* have to be able to say so.
   */
  private readonly leadMs: number;

  constructor(clock?: ManualClock, leadMs = 0) {
    this.clock = clock ?? null;
    this.leadMs = leadMs;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get currentConfig(): MetronomeConfig {
    return this.config;
  }

  /** How many are listening for ticks heard and for ticks placed, for a test of letting go. */
  get listeners(): { readonly heard: number; readonly placed: number } {
    return { heard: this.emitter.listenerCount('tick'), placed: this.emitter.listenerCount('placed') };
  }

  /** Index of the next tick that {@link advanceSubdivisions} will emit. */
  get nextTickIndex(): number {
    return this.nextIndex - this.placedNotHeard.length;
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

  onTickPlaced(listener: (tick: MetronomeTick) => void): Unsubscribe {
    return this.emitter.on('placed', listener);
  }

  start(): void {
    this.running = true;
    this.placedNotHeard.length = 0;
    this.nextIndex = 0;
    this.nextTimeMs = (this.clock?.now() ?? 0) + this.leadMs;
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
      // Placed now and heard at once, unless it was placed ahead already:
      // there is no device here to wait for, but the order is the real one's.
      const tick = this.placedNotHeard.shift() ?? this.placeNext();
      if (tick === null) {
        break;
      }
      this.clock?.set(tick.scheduledTimeMs);
      this.emitted.push(tick);
      ticks.push(tick);
      this.emitter.emit('tick', tick);
    }
    return ticks;
  }

  /**
   * Hears every tick not yet placed `ms` later, as a device does whose delay
   * to the speaker grows - one waking up, or headphones plugged in.
   */
  delayBy(ms: number): void {
    this.nextTimeMs += ms;
  }

  /**
   * Places the next `count` ticks on the clock without their being heard, as
   * a real metronome places its clicks a look-ahead and the device's delay
   * before the speaker gets to them. {@link advanceSubdivisions} then hears
   * them, and places nothing twice.
   */
  placeAhead(count = 1): MetronomeTick[] {
    const placed: MetronomeTick[] = [];
    for (let step = 0; step < count; step += 1) {
      const tick = this.placeNext();
      if (tick === null) {
        break;
      }
      this.placedNotHeard.push(tick);
      placed.push(tick);
    }
    return placed;
  }

  private placeNext(): MetronomeTick | null {
    // Held at a gate, as the real one is: nothing past it is built, and the
    // clock stands where the test left it.
    if (!this.running || isHeldBack(this.nextIndex, this.config)) {
      return null;
    }
    const tick = buildMetronomeTick(this.nextIndex, this.config, this.nextTimeMs);
    this.nextTimeMs += subdivisionSecondsAt(this.config, this.nextIndex) * 1000;
    this.nextIndex += 1;
    this.emitter.emit('placed', tick);
    return tick;
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
      const one = this.advanceSubdivisions(1);
      if (one.length === 0) {
        break;
      }
      emitted.push(...one);
      guard -= 1;
    }
    return emitted;
  }
}

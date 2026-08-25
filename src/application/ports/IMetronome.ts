import type { Unsubscribe } from '../../shared/EventEmitter.js';
import type { TimeSignature } from '../../domain/model/TimeSignature.js';

export interface MetronomeTick {
  /** Subdivision counter since `start()`, beginning at 0. */
  readonly index: number;
  /** Zero-based measure counter since `start()`. */
  readonly measure: number;
  /** One-based beat inside the measure. */
  readonly beat: number;
  /** True for subdivisions that fall exactly on a beat. */
  readonly isBeat: boolean;
  /** True on the first beat of a measure. */
  readonly isDownbeat: boolean;
  /** Musical position since `start()`, in MusicXML divisions. */
  readonly positionTicks: number;
  /**
   * Clock time this tick represents. Audio adapters schedule sound ahead of
   * time, so this is the moment the click is *heard*, not the moment the
   * callback ran.
   */
  readonly scheduledTimeMs: number;
}

export interface MetronomeConfig {
  readonly bpm: number;
  readonly timeSignature: TimeSignature;
  /** 1 = beats only, 2 = eighths, 4 = sixteenths. */
  readonly subdivisionsPerBeat: number;
  /** Keep the pulse but stay silent (Flow mode without a click). */
  readonly muted: boolean;
}

/**
 * The pulse that drives Flow mode.
 *
 * Implementations own their own scheduling: Web Audio look-ahead in the
 * browser, manual stepping in tests.
 */
export interface IMetronome {
  readonly isRunning: boolean;
  configure(config: MetronomeConfig): void;
  start(): void;
  stop(): void;
  onTick(listener: (tick: MetronomeTick) => void): Unsubscribe;
}

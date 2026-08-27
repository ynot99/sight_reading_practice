import type { Unsubscribe } from '../../shared/EventEmitter.js';
import type { TimeSignature } from '../../domain/model/TimeSignature.js';

export interface MetronomeTick {
  /** Subdivision counter since `start()`, beginning at 0. */
  readonly index: number;
  /** Zero-based measure counter since `start()`. */
  readonly measure: number;
  /** One-based felt beat inside the measure: 1..2 in 6/8, 1..4 in 4/4. */
  readonly beat: number;
  /** True for subdivisions that fall exactly on a felt beat. */
  readonly isPulse: boolean;
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

/**
 * How much of the pulse is actually sounded.
 *
 * Deliberately musical rather than numeric: "division" is two clicks per beat
 * in simple time and three in compound, which is what the words mean and what
 * a reader of 6/8 expects to hear.
 */
export const CLICK_PATTERNS = ['downbeat', 'pulse', 'division', 'subdivision'] as const;

export type ClickPattern = (typeof CLICK_PATTERNS)[number];

/** Audible clicks in one felt beat, for a given pattern. */
export function clicksPerPulse(pattern: ClickPattern, timeSignature: TimeSignature): number {
  switch (pattern) {
    case 'downbeat':
    case 'pulse':
      return 1;
    case 'division':
      return timeSignature.divisionsPerPulse;
    case 'subdivision':
      return timeSignature.divisionsPerPulse * 2;
    default:
      return 1;
  }
}

/**
 * Bars where the click falls silent and the reader carries the pulse alone.
 *
 * The strongest timekeeping exercise there is, and the one closest to what
 * sight-reading actually asks for: keeping going when nothing is holding you
 * up. Silence is total, downbeat included - a click on the first beat would
 * answer the only question the exercise asks, which is whether you drifted.
 */
export interface MetronomeDropout {
  /** Bars of click, then the same number of bars of silence. */
  readonly bars: number;
  /**
   * Measure the cycle starts from.
   *
   * The count-in is never dropped: it is the reference the reader is given,
   * so the cycle begins where the music does.
   */
  readonly fromBar: number;
}

export interface MetronomeConfig {
  readonly bpm: number;
  readonly timeSignature: TimeSignature;
  /**
   * Ticks emitted per felt beat.
   *
   * This is *resolution*, not sound: the practice loop advances on ticks, so
   * it has to be fine enough for the shortest note in the exercise. What the
   * reader actually hears is {@link click}, which is why the two are separate
   * - one number cannot both resolve sixteenths and click only on the beat.
   */
  readonly subdivisionsPerPulse: number;
  /** Which of those ticks are sounded. */
  readonly click: ClickPattern;
  /** Bars to fall silent for, or `null` to click throughout. */
  readonly dropout: MetronomeDropout | null;
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

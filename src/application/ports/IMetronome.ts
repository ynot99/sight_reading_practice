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
 * Bars of click and bars of silence, alternating.
 *
 * The strongest timekeeping exercise there is, and the one closest to what
 * sight-reading actually asks for: keeping going when nothing is holding you
 * up. Silence is total, downbeat included - a click on the first beat would
 * answer the only question the exercise asks, which is whether you drifted.
 */
export interface MetronomeCycleDropout {
  readonly kind: 'cycle';
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

/**
 * The click gives a tempo and then leaves for good.
 *
 * The limit of the cycle above rather than a different idea: silence that
 * never ends. Stated as a bar the metronome falls silent at, not as "after
 * the count-in" - the metronome counts bars and has no notion of why that
 * one matters.
 */
export interface MetronomeSilenceFrom {
  readonly kind: 'silent-from';
  readonly fromBar: number;
}

export type MetronomeDropout = MetronomeCycleDropout | MetronomeSilenceFrom;

/**
 * When the reader hears the click at all.
 *
 * One question, one answer. It used to be two settings - a "mute" switch and
 * a "drop the click" menu - in different parts of the page, both named for
 * what they take away. A reader looking for "play it only while counting me
 * in" had to find the second option of the second one, and reasonably
 * concluded it did not exist.
 *
 * Its own axis, separate from {@link ClickPattern}: the pattern says *what a
 * click marks* and governs the count-in too, while this says *when clicks
 * sound*. Folding "only the count-in" into the pattern list would leave the
 * count-in's own pattern undefined, which is the tell that they are two
 * questions.
 */
export const CLICK_WHEN = [
  'always',
  'count-in-only',
  'cycle-1',
  'cycle-2',
  'cycle-4',
  'never',
] as const;

export type ClickWhen = (typeof CLICK_WHEN)[number];

/** Silent throughout - the pulse still runs, since the loop rides on it. */
export function clickIsSilent(when: ClickWhen): boolean {
  return when === 'never';
}

/** Bars in one sounding half of a cycle, or `null` when there is no cycle. */
export function dropoutCycleBars(when: ClickWhen): number | null {
  switch (when) {
    case 'cycle-1':
      return 1;
    case 'cycle-2':
      return 2;
    case 'cycle-4':
      return 4;
    default:
      return null;
  }
}

/**
 * Resolves the reader's choice against the bar the music starts at.
 *
 * `null` means the click sounds throughout, which is what the metronome
 * expects for "no dropout at all".
 */
export function resolveDropout(when: ClickWhen, fromBar: number): MetronomeDropout | null {
  // `always` has nothing to drop, and `never` is answered by muting rather
  // than by a dropout - a metronome told to fall silent everywhere would be
  // a cycle with no sounding half.
  if (when === 'always' || when === 'never') {
    return null;
  }
  if (when === 'count-in-only') {
    return { kind: 'silent-from', fromBar };
  }
  const bars = dropoutCycleBars(when);
  return bars === null ? null : { kind: 'cycle', bars, fromBar };
}

/** One bar of the metronome's life, in its own clock. */
export interface MetronomeBar {
  readonly startTicks: number;
  readonly timeSignature: TimeSignature;
}

/** One stretch of the metronome's life beaten at one tempo. */
export interface MetronomeTempo {
  readonly startTicks: number;
  readonly bpm: number;
}

export interface MetronomeConfig {
  readonly bpm: number;
  /**
   * Every tempo it will beat at, by where that tempo begins.
   *
   * The pulse is even only while a piece keeps one tempo. Given these, a
   * subdivision lasts as long as the tempo in force where it falls, so an
   * accelerando written into the score is beaten rather than ignored.
   *
   * Empty when nobody has worked them out, which is answered by beating
   * throughout at {@link bpm} - the same thing, for music that never changes
   * tempo.
   */
  readonly tempos: readonly MetronomeTempo[];
  readonly timeSignature: TimeSignature;
  /**
   * Every bar it will beat through: the count-in, then the music.
   *
   * A pulse generator can work out the bar and the beat by division only
   * while every bar is the same length, and a piece that changes metre
   * partway through stops being one. Given the bars, the click accents the
   * downbeat the *reader* is looking at rather than the one the opening
   * metre would have put there.
   *
   * Empty when nobody has worked them out, which is answered by counting
   * from the start in {@link timeSignature} - the same thing, for the music
   * that never changes metre.
   */
  readonly bars: readonly MetronomeBar[];
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
  /**
   * Where the music ends, after which nothing sounds.
   *
   * The pulse has to run one tick past the last note - that is the tick the
   * mode finishes on, and there is no other way to know the note has had its
   * full length. But that tick is the downbeat of a bar the page does not
   * have, and sounding it puts a beat between the last note and whatever
   * comes next: on repeat, a bar of two beats is practised as a bar of three.
   *
   * `null` when nobody has said, which clicks throughout - the same thing for
   * a metronome that is not following a piece.
   */
  readonly endsAtTicks: number | null;
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
  /**
   * Changes the pulse, which may be done while it is running.
   *
   * A reader who wants the click off, or wants four of them to the beat
   * instead of one, wants it *now* - stopping the run to ask for it is
   * stopping the thing they were asking about. Implementations must therefore
   * keep the musical position continuous across the change: what is being
   * re-dressed is how the pulse sounds and how finely it is delivered, never
   * where in the piece it has got to.
   */
  configure(config: MetronomeConfig): void;
  start(): void;
  stop(): void;
  onTick(listener: (tick: MetronomeTick) => void): Unsubscribe;
}

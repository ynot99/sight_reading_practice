import { barCells, type BarState } from './barCells.js';
import type { NoteTier } from './noteTiers.js';
import type { PerformanceReport, PerformanceTotals } from './PerformanceReport.js';
import { theProfile, type ProfileAxis } from './theProfile.js';

/** One letter a bar, in the order they are printed. */
const LETTERS: Readonly<Record<BarState, string>> = { clean: 'c', wrong: 'w', unread: '.' };
const STATES: Readonly<Record<string, BarState>> = { c: 'clean', w: 'wrong', '.': 'unread' };

/**
 * The most presses a picture draws in its scatter.
 *
 * A strip of marks says where the hand falls about the beat, and six hundred
 * of them say it as well as three thousand do - while three thousand, kept for
 * every reading of a long piece, is the difference between a history that fits
 * in the browser's store and one that silently stops being written.
 */
export const MOST_MARKS = 600;

/**
 * What a reading looked like, in what it takes to draw it again.
 *
 * Not the report it came from. A report carries a line per note - what was
 * expected, what was played, what was held against it - which is what grading
 * needs while the run is being graded, and which for a piece of three thousand
 * notes is a couple of hundred thousand characters. Fifty readings of it would
 * be more than the browser's whole store, and the store's answer to being full
 * is to quietly drop the write. So a reading keeps the picture rather than the
 * evidence: the bars as they read, the shape of the playing, and enough of the
 * scatter to see the hand's habit.
 *
 * It is also the more honest of the two. Drawn from a kept report, the profile
 * would be missing the timeline it was first drawn with, and the same reading
 * would show one shape the moment it ended and a different one a week later.
 */
export interface ReadingPicture {
  /** How each bar read: `c` clean, `w` something wrong, `.` never reached. */
  readonly bars: string;
  /** Bars whose opening the music had to wait at, by index. */
  readonly waitedAtBars: readonly number[];
  /** The shape of the reading, as the chart after a run draws it. */
  readonly axes: readonly ProfileAxis[];
  /** Presses' distances from their beats, whole milliseconds, at most `MOST_MARKS` of them. */
  readonly deviationsMs: readonly number[];
  /** How many presses those stand for, which is more where the reading was long. */
  readonly pressesJudged: number;
  /**
   * Whether each of {@link deviationsMs} was Perfect (`p`) or Good (`g`), in
   * the same order. Absent from readings kept before notes were judged so.
   */
  readonly tiersOfMarks?: string;
  /** The Perfect window of a typical note of the reading; see `PerformanceTiming.perfectMs`. */
  readonly perfectMs?: number | null;
  /** The window they were judged against, so the scatter is drawn as it was read. */
  readonly toleranceMs: number;
  readonly totals: PerformanceTotals;
  readonly meanDeviationMs: number;
  readonly meanAbsoluteDeviationMs: number;
  readonly deviationSpreadMs: number;
  /** The bar the reader stopped in, one-based, or `null` where they reached the end. */
  readonly stoppedAtBar: number | null;
}

/** The bars of a picture, back as the strip draws them. */
export function barsOfThePicture(picture: ReadingPicture): readonly { state: BarState; waited: boolean; label: string }[] {
  const waited = new Set(picture.waitedAtBars);
  return [...picture.bars].map((letter, index) => {
    const state = STATES[letter] ?? 'unread';
    const how =
      state === 'unread'
        ? 'not reached'
        : [state === 'wrong' ? 'something wrong' : 'clean', waited.has(index) ? 'waited here' : '']
            .filter((part) => part !== '')
            .join(', ');
    return { state, waited: waited.has(index), label: `Bar ${index + 1} · ${how}` };
  });
}

/** Every `nth` of them, so a long reading's scatter keeps its shape at a fraction of the size. */
function thinnedTo<T>(values: readonly T[], most: number): readonly T[] {
  const nth = Math.ceil(values.length / Math.max(1, most));
  return values.filter((_unused, index) => index % nth === 0);
}

/** The letter a verdict is kept as. */
const TIER_LETTERS: Readonly<Record<NoteTier, string>> = { perfect: 'p', good: 'g' };

/** A reading's verdicts, back from the letters they were kept as; empty where one is not a verdict. */
export function tiersOfThePicture(picture: ReadingPicture): readonly NoteTier[] {
  const letters = [...(picture.tiersOfMarks ?? '')];
  const tiers = letters.map((letter) => (letter === 'p' ? 'perfect' : letter === 'g' ? 'good' : null));
  return tiers.every((tier) => tier !== null) ? tiers : [];
}

export interface ReadingPictureInput {
  readonly report: PerformanceReport;
  /** Bars in the piece, not in the part of it that was reached. */
  readonly bars: number;
  /** How hard each press was struck, for the evenness axis. */
  readonly velocities: readonly number[];
  /** Whether the run was played to a beat at all; see `theProfile`. */
  readonly keepsTime: boolean;
  /** Where each judged entry fell in the run, in milliseconds; see `theProfile`. */
  readonly owedAtMs: readonly number[];
  /** The window a press counted as on time within. */
  readonly toleranceMs: number;
}

export function theReadingPicture(input: ReadingPictureInput): ReadingPicture {
  const { report } = input;
  const lastPlayed = report.steps.filter((step) => step.status !== 'skipped').at(-1);
  return {
    bars: barCells(report, input.bars)
      .map((cell) => LETTERS[cell.state])
      .join(''),
    waitedAtBars: [...report.waitedAtBars],
    axes: theProfile(report, input.velocities, input.keepsTime, input.owedAtMs),
    deviationsMs: thinnedTo(report.timing.deviations, MOST_MARKS).map((value) => Math.round(value)),
    pressesJudged: report.timing.deviations.length,
    // Thinned alike, so the verdict kept for a mark is that mark's.
    tiersOfMarks: thinnedTo(report.timing.tiers, MOST_MARKS)
      .map((tier) => TIER_LETTERS[tier])
      .join(''),
    perfectMs: report.timing.perfectMs,
    toleranceMs: input.toleranceMs,
    totals: report.totals,
    meanDeviationMs: report.timing.meanDeviationMs,
    meanAbsoluteDeviationMs: report.timing.meanAbsoluteDeviationMs,
    deviationSpreadMs: report.timing.deviationSpreadMs,
    stoppedAtBar: report.completed ? null : (lastPlayed?.measureIndex ?? 0) + 1,
  };
}

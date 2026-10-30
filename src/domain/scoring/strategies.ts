import { clamp } from '../../shared/asserts.js';
import { gradeFor, type IScoringStrategy, type SessionScore } from './IScoringStrategy.js';
import type { PerformanceReport } from './PerformanceReport.js';

/**
 * Note accuracy with a configurable penalty for extra, wrong presses.
 *
 * Where no note was asked for, a run that reached the end played all there
 * was - a hand with nothing to play in the passage - and one that was stopped
 * played nothing. Counted as perfect, a run stopped in its count-in, before a
 * key was touched, came out at 70% and a C.
 *
 * A Good note is worth half a Perfect one, whatever the frame. Where the run
 * waits it was struck ahead of the hand being heard; where it keeps time it
 * landed outside its window. Counted whole under a pulse, on the grounds that
 * the timing part charges for where it landed, it cost nothing: that part
 * reads the *average* miss and forgives a hundred milliseconds of it, more
 * than twice a Perfect window, so a piece played with every note Good came
 * out at 100% and an A.
 */
function accuracyOf(report: PerformanceReport, wrongNotePenalty: number): number {
  const { expectedNotes, perfectNotes, goodNotes, wrongNotes } = report.totals;
  if (expectedNotes === 0) {
    return report.completed ? 1 : 0;
  }
  const hit = (perfectNotes + GOOD_WORTH * goodNotes) / expectedNotes;
  const penalty = (wrongNotes / expectedNotes) * wrongNotePenalty;
  return clamp(hit - penalty, 0, 1);
}

/**
 * Rhythmic precision: `1` inside the tolerance, decaying to `0` once the
 * average press is a full `decayMs` away from its beat.
 */
function timingOf(report: PerformanceReport, toleranceMs: number, decayMs: number): number {
  if (report.timing.deviations.length === 0) {
    return 0;
  }
  const excess = Math.max(0, report.timing.meanAbsoluteDeviationMs - toleranceMs);
  return clamp(1 - excess / decayMs, 0, 1);
}

/** What a Good note is worth beside a Perfect one; see `accuracyOf`. */
const GOOD_WORTH = 0.5;

export interface AccuracyScoringOptions {
  readonly wrongNotePenalty?: number;
}

/** Wait-mode grading: only the notes matter, since the player sets the pace. */
export class AccuracyScoringStrategy implements IScoringStrategy {
  readonly id = 'scoring.accuracy';
  readonly label = 'Note accuracy';
  private readonly wrongNotePenalty: number;

  constructor(options: AccuracyScoringOptions = {}) {
    this.wrongNotePenalty = options.wrongNotePenalty ?? 0.5;
  }

  score(report: PerformanceReport): SessionScore {
    const accuracy = accuracyOf(report, this.wrongNotePenalty);
    const timing = timingOf(report, 120, 400);
    return {
      accuracy,
      timing,
      overall: accuracy,
      grade: gradeFor(accuracy),
      details: {
        expectedNotes: report.totals.expectedNotes,
        correctNotes: report.totals.correctNotes,
        wrongNotes: report.totals.wrongNotes,
        missedSteps: report.totals.missed,
      },
    };
  }
}

export interface TimingWeightedScoringOptions {
  readonly accuracyWeight?: number;
  readonly timingWeight?: number;
  /** Deviation that still counts as perfectly in time. */
  readonly toleranceMs?: number;
  /** Additional deviation beyond the tolerance that drives timing to zero. */
  readonly decayMs?: number;
  readonly wrongNotePenalty?: number;
}

/**
 * Flow-mode grading: playing the right notes late is not the same as playing
 * them in time, so both dimensions are weighted into the final score.
 */
export class TimingWeightedScoringStrategy implements IScoringStrategy {
  readonly id = 'scoring.timing-weighted';
  readonly label = 'Accuracy and timing';
  private readonly accuracyWeight: number;
  private readonly timingWeight: number;
  private readonly toleranceMs: number;
  private readonly decayMs: number;
  private readonly wrongNotePenalty: number;

  constructor(options: TimingWeightedScoringOptions = {}) {
    this.accuracyWeight = options.accuracyWeight ?? 0.7;
    this.timingWeight = options.timingWeight ?? 0.3;
    this.toleranceMs = options.toleranceMs ?? 100;
    this.decayMs = options.decayMs ?? 400;
    this.wrongNotePenalty = options.wrongNotePenalty ?? 0.5;
  }

  score(report: PerformanceReport): SessionScore {
    const accuracy = accuracyOf(report, this.wrongNotePenalty);
    const timing = timingOf(report, this.toleranceMs, this.decayMs);
    const totalWeight = this.accuracyWeight + this.timingWeight;
    const overall =
      totalWeight === 0 ? 0 : (accuracy * this.accuracyWeight + timing * this.timingWeight) / totalWeight;

    return {
      accuracy,
      timing,
      overall,
      grade: gradeFor(overall),
      details: {
        expectedNotes: report.totals.expectedNotes,
        correctNotes: report.totals.correctNotes,
        wrongNotes: report.totals.wrongNotes,
        missedSteps: report.totals.missed,
        meanAbsoluteDeviationMs: report.timing.meanAbsoluteDeviationMs,
      },
    };
  }
}

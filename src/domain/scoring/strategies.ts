import { clamp } from '../../shared/asserts.js';
import { gradeFor, type IScoringStrategy, type SessionScore } from './IScoringStrategy.js';
import type { PerformanceReport, StepStatus } from './PerformanceReport.js';

/** Note accuracy with a configurable penalty for extra, wrong presses. */
function accuracyOf(report: PerformanceReport, wrongNotePenalty: number): number {
  const { expectedNotes, correctNotes, wrongNotes } = report.totals;
  if (expectedNotes === 0) {
    return 1;
  }
  const hit = correctNotes / expectedNotes;
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

export interface AccuracyScoringOptions {
  readonly wrongNotePenalty?: number;
}

/**
 * Wait-mode grading: only the notes matter, since the player sets the pace.
 */
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
export interface ContinuityScoringOptions {
  /** Share of the verdict carried by the longest unbroken run. */
  readonly continuityWeight?: number;
  readonly accuracyWeight?: number;
  readonly wrongNotePenalty?: number;
}

/**
 * The longest stretch taken without falling apart, as a share of the piece.
 *
 * Sight-reading is not played twice, so the thing worth measuring is not how
 * many notes were right but how far the reader got without stopping. A single
 * fluffed note in an otherwise unbroken run is a smaller failure than a clean
 * start followed by a collapse, and the other two strategies cannot tell those
 * apart - both count notes.
 *
 * A run is broken only by a *missed* step: the music moved on without the
 * reader. Wrong notes played alongside the right ones do not break it, because
 * carrying on past a fluff is exactly the habit being trained.
 *
 * Note that this says nothing in Wait mode, where nothing moves until the
 * reader plays and so nothing can ever be missed.
 */
export class ContinuityScoringStrategy implements IScoringStrategy {
  readonly id = 'scoring.continuity';
  readonly label = 'Keeping going';
  private readonly continuityWeight: number;
  private readonly accuracyWeight: number;
  private readonly wrongNotePenalty: number;

  constructor(options: ContinuityScoringOptions = {}) {
    this.continuityWeight = options.continuityWeight ?? 0.8;
    this.accuracyWeight = options.accuracyWeight ?? 0.2;
    this.wrongNotePenalty = options.wrongNotePenalty ?? 0.25;
  }

  score(report: PerformanceReport): SessionScore {
    const played = report.steps.filter((step) => step.status !== 'skipped');
    const longestRun = longestUnbrokenRun(played.map((step) => step.status));
    // The denominator is the music, not the attempt: stopping after two clean
    // steps of sixteen must not read as a flawless run.
    const reachable = Math.max(report.totals.playableSteps, played.length);
    const continuity = reachable === 0 ? 1 : longestRun / reachable;

    const accuracy = accuracyOf(report, this.wrongNotePenalty);
    const timing = timingOf(report, 120, 400);
    const totalWeight = this.continuityWeight + this.accuracyWeight;
    const overall =
      totalWeight === 0
        ? 0
        : (continuity * this.continuityWeight + accuracy * this.accuracyWeight) / totalWeight;

    return {
      accuracy,
      timing,
      overall,
      grade: gradeFor(overall),
      details: {
        longestRun,
        playableSteps: reachable,
        breaks: report.totals.missed,
        continuity,
      },
    };
  }
}

/** Longest run of consecutive steps that the reader stayed with. */
function longestUnbrokenRun(statuses: readonly StepStatus[]): number {
  let longest = 0;
  let current = 0;
  for (const status of statuses) {
    if (status === 'missed') {
      current = 0;
      continue;
    }
    current += 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

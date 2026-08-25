import { describe, expect, it } from 'vitest';
import { gradeFor } from '../../src/domain/scoring/IScoringStrategy.js';
import {
  buildPerformanceReport,
  type StepResult,
} from '../../src/domain/scoring/PerformanceReport.js';
import {
  AccuracyScoringStrategy,
  TimingWeightedScoringStrategy,
} from '../../src/domain/scoring/strategies.js';

function step(overrides: Partial<StepResult> & Pick<StepResult, 'index' | 'status'>): StepResult {
  return {
    measureIndex: 0,
    beat: 1,
    expected: [60],
    played: [60],
    wrong: [],
    missing: [],
    deviationMs: null,
    ...overrides,
  };
}

function reportOf(steps: readonly StepResult[]) {
  return buildPerformanceReport({
    exerciseId: 'ex',
    modeId: 'mode.test',
    tempoBpm: 60,
    startedAtMs: 0,
    endedAtMs: 10_000,
    completed: true,
    steps,
  });
}

describe('buildPerformanceReport', () => {
  it('aggregates step outcomes', () => {
    const report = reportOf([
      step({ index: 0, status: 'correct', deviationMs: 20 }),
      step({ index: 1, status: 'incorrect', wrong: [61], deviationMs: -40 }),
      step({ index: 2, status: 'missed', played: [], missing: [60] }),
      step({ index: 3, status: 'skipped', expected: [], played: [] }),
    ]);

    expect(report.totals).toEqual({
      steps: 4,
      correct: 1,
      incorrect: 1,
      missed: 1,
      skipped: 1,
      expectedNotes: 3,
      correctNotes: 2,
      wrongNotes: 1,
    });
  });

  it('summarises timing over the steps that were actually played', () => {
    const report = reportOf([
      step({ index: 0, status: 'correct', deviationMs: 100 }),
      step({ index: 1, status: 'correct', deviationMs: -50 }),
      step({ index: 2, status: 'missed', deviationMs: null }),
    ]);

    expect(report.timing.deviations).toEqual([100, -50]);
    expect(report.timing.meanDeviationMs).toBe(25);
    expect(report.timing.meanAbsoluteDeviationMs).toBe(75);
    expect(report.timing.maxAbsoluteDeviationMs).toBe(100);
  });

  it('handles a run with no notes at all', () => {
    const report = reportOf([]);
    expect(report.totals.expectedNotes).toBe(0);
    expect(report.timing.meanAbsoluteDeviationMs).toBe(0);
    expect(report.timing.maxAbsoluteDeviationMs).toBe(0);
  });
});

describe('AccuracyScoringStrategy', () => {
  const strategy = new AccuracyScoringStrategy();

  it('scores a clean run perfectly', () => {
    const score = strategy.score(
      reportOf([
        step({ index: 0, status: 'correct' }),
        step({ index: 1, status: 'correct' }),
      ]),
    );
    expect(score.accuracy).toBe(1);
    expect(score.overall).toBe(1);
    expect(score.grade).toBe('A');
  });

  it('penalises wrong notes on top of missing ones', () => {
    const clean = strategy.score(
      reportOf([step({ index: 0, status: 'correct' }), step({ index: 1, status: 'correct' })]),
    );
    const messy = strategy.score(
      reportOf([
        step({ index: 0, status: 'correct' }),
        step({ index: 1, status: 'incorrect', wrong: [61, 62] }),
      ]),
    );

    expect(messy.accuracy).toBeLessThan(clean.accuracy);
    expect(messy.details['wrongNotes']).toBe(2);
  });

  it('never returns a negative score', () => {
    const score = strategy.score(
      reportOf([step({ index: 0, status: 'incorrect', played: [], missing: [60], wrong: Array.from({ length: 40 }, () => 61) })]),
    );
    expect(score.accuracy).toBe(0);
    expect(score.grade).toBe('F');
  });

  it('ignores timing in the overall verdict', () => {
    const late = strategy.score(reportOf([step({ index: 0, status: 'correct', deviationMs: 900 })]));
    expect(late.overall).toBe(1);
    expect(late.timing).toBeLessThan(1);
  });

  it('scores an exercise made only of rests as perfect', () => {
    const score = strategy.score(
      reportOf([step({ index: 0, status: 'skipped', expected: [], played: [] })]),
    );
    expect(score.accuracy).toBe(1);
  });
});

describe('TimingWeightedScoringStrategy', () => {
  const strategy = new TimingWeightedScoringStrategy({
    accuracyWeight: 0.5,
    timingWeight: 0.5,
    toleranceMs: 50,
    decayMs: 200,
  });

  it('rewards notes played inside the tolerance', () => {
    const score = strategy.score(
      reportOf([
        step({ index: 0, status: 'correct', deviationMs: 10 }),
        step({ index: 1, status: 'correct', deviationMs: -20 }),
      ]),
    );
    expect(score.timing).toBe(1);
    expect(score.overall).toBe(1);
  });

  it('decays the timing score as the average drifts', () => {
    const score = strategy.score(
      reportOf([step({ index: 0, status: 'correct', deviationMs: 150 })]),
    );
    // 150 ms is 100 ms past the 50 ms tolerance, half of the 200 ms decay.
    expect(score.timing).toBeCloseTo(0.5, 5);
    expect(score.overall).toBeCloseTo(0.75, 5);
    expect(score.details['meanAbsoluteDeviationMs']).toBe(150);
  });

  it('scores timing as zero when nothing was played in time', () => {
    const score = strategy.score(reportOf([step({ index: 0, status: 'missed', played: [], missing: [60] })]));
    expect(score.timing).toBe(0);
    expect(score.accuracy).toBe(0);
    expect(score.overall).toBe(0);
    expect(score.grade).toBe('F');
  });
});

describe('gradeFor', () => {
  it('maps overall scores onto letter grades', () => {
    expect(gradeFor(1)).toBe('A');
    expect(gradeFor(0.95)).toBe('A');
    expect(gradeFor(0.9)).toBe('B');
    expect(gradeFor(0.8)).toBe('C');
    expect(gradeFor(0.6)).toBe('D');
    expect(gradeFor(0.1)).toBe('F');
  });
});

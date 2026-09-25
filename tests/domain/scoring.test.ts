import { describe, expect, it } from 'vitest';
import { gradeFor } from '../../src/domain/scoring/IScoringStrategy.js';
import {
  buildPerformanceReport,
  noteCountsOf,
  type StepResult,
} from '../../src/domain/scoring/PerformanceReport.js';
import {
  AccuracyScoringStrategy,
  ContinuityScoringStrategy,
  TimingWeightedScoringStrategy,
} from '../../src/domain/scoring/strategies.js';
import { ScoringStrategyRegistry } from '../../src/domain/scoring/ScoringStrategyRegistry.js';
import { DomainError } from '../../src/shared/errors.js';

function step(overrides: Partial<StepResult> & Pick<StepResult, 'index' | 'status'>): StepResult {
  return {
    measureIndex: 0,
    beat: 1,
    expected: [60],
    // Its one note played when the step was, unless a test says otherwise.
    hits: [{ midi: 60, deviationMs: overrides.deviationMs ?? null, tier: 'perfect' }],
    wrong: [],
    missing: [],
    deviationMs: null,
    ...overrides,
  };
}

function reportOf(steps: readonly StepResult[], playableSteps?: number, completed = true) {
  return buildPerformanceReport({
    exerciseId: 'ex',
    modeId: 'mode.test',
    tempoBpm: 60,
    startedAtMs: 0,
    endedAtMs: 10_000,
    completed,
    playableSteps: playableSteps ?? steps.filter((entry) => entry.status !== 'skipped').length,
    steps,
  });
}

describe('buildPerformanceReport', () => {
  it('aggregates step outcomes', () => {
    const report = reportOf([
      step({ index: 0, status: 'correct', deviationMs: 20 }),
      step({ index: 1, status: 'incorrect', wrong: [61], deviationMs: -40 }),
      step({ index: 2, status: 'missed', hits: [], missing: [60] }),
      step({ index: 3, status: 'skipped', expected: [], hits: [] }),
    ]);

    expect(report.totals).toEqual({
      steps: 4,
      playableSteps: 3,
      correct: 1,
      incorrect: 1,
      missed: 1,
      skipped: 1,
      expectedNotes: 3,
      correctNotes: 2,
      perfectNotes: 2,
      goodNotes: 0,
      wrongNotes: 1,
      // Nought unless the run had a gate at the bar line to stop at.
      barsWaitedFor: 0,
    });
  });

  /** A step whose one note landed this far from its moment. */
  function timed(index: number, deviationMs: number) {
    return step({ index, status: 'correct', deviationMs, hits: [{ midi: 60, deviationMs, tier: 'good' }] });
  }

  it('summarises timing over the notes that were actually played', () => {
    const report = reportOf([
      timed(0, 100),
      timed(1, -50),
      step({ index: 2, status: 'missed', hits: [], missing: [60], deviationMs: null }),
    ]);

    expect(report.timing.deviations).toEqual([100, -50]);
    expect(report.timing.meanDeviationMs).toBe(25);
    expect(report.timing.meanAbsoluteDeviationMs).toBe(75);
    expect(report.timing.maxAbsoluteDeviationMs).toBe(100);
  });

  it('times every note of a chord, not only the one that came first', () => {
    const chord = step({
      index: 0,
      status: 'correct',
      expected: [60, 64],
      deviationMs: 10,
      hits: [
        { midi: 60, deviationMs: 10, tier: 'perfect' },
        { midi: 64, deviationMs: 90, tier: 'good' },
      ],
    });

    expect(reportOf([chord]).timing.deviations).toEqual([10, 90]);
    expect(reportOf([chord]).timing.meanAbsoluteDeviationMs).toBe(50);
  });

  it('says beside every deviation whether its note was Perfect or Good', () => {
    const chord = step({
      index: 0,
      status: 'correct',
      expected: [60, 64],
      hits: [
        { midi: 60, deviationMs: 10, tier: 'perfect', windowMs: 40 },
        { midi: 64, deviationMs: 90, tier: 'good', windowMs: 40 },
      ],
    });
    const next = step({ index: 1, status: 'correct', hits: [{ midi: 62, deviationMs: -5, tier: 'perfect', windowMs: 60 }] });

    expect(reportOf([chord, next]).timing.tiers).toEqual(['perfect', 'good', 'perfect']);
  });

  it('takes the middle window of the notes played as the window of the run', () => {
    const windows = (...each: number[]) =>
      reportOf(
        each.map((windowMs, index) =>
          step({ index, status: 'correct', hits: [{ midi: 60, deviationMs: 0, tier: 'perfect', windowMs }] }),
        ),
      ).timing.perfectMs;

    expect(windows(40, 90, 60)).toBe(60);
    expect(windows(40, 60, 90, 30)).toBe(50);
  });

  it('keeps no timing where the run keeps no time', () => {
    // Waiting for the notes: the notes are played, and none of them has a
    // moment to be off by. When each step was entered is kept on the step.
    const waited = step({
      index: 0,
      status: 'correct',
      deviationMs: 2400,
      hits: [{ midi: 60, deviationMs: null, tier: 'perfect' }],
    });

    expect(reportOf([waited]).timing.deviations).toEqual([]);
    expect(reportOf([waited]).timing.perfectMs).toBeNull();
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
      reportOf([step({ index: 0, status: 'incorrect', hits: [], missing: [60], wrong: Array.from({ length: 40 }, () => 61) })]),
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
      reportOf([step({ index: 0, status: 'skipped', expected: [], hits: [] })]),
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
    const score = strategy.score(reportOf([step({ index: 0, status: 'missed', hits: [], missing: [60] })]));
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

describe('ContinuityScoringStrategy', () => {
  const strategy = new ContinuityScoringStrategy();

  /** A step that was reached but never completed in time. */
  function missed(index: number): StepResult {
    return step({ index, status: 'missed', hits: [], missing: [60] });
  }

  it('measures the longest stretch the reader stayed with', () => {
    const score = strategy.score(
      reportOf([
        step({ index: 0, status: 'correct' }),
        step({ index: 1, status: 'correct' }),
        missed(2),
        step({ index: 3, status: 'correct' }),
        step({ index: 4, status: 'correct' }),
        step({ index: 5, status: 'correct' }),
      ]),
    );

    expect(score.details['longestRun']).toBe(3);
    expect(score.details['playableSteps']).toBe(6);
    expect(score.details['breaks']).toBe(1);
    expect(score.details['continuity']).toBeCloseTo(0.5, 10);
  });

  it('forgives a fluffed note but not a step the music took away', () => {
    const played = [
      step({ index: 0, status: 'correct' }),
      // Right notes plus a wrong one: the reader carried on, which is the
      // whole habit being trained.
      step({ index: 1, status: 'incorrect', wrong: [61] }),
      step({ index: 2, status: 'correct' }),
    ];
    expect(strategy.score(reportOf(played)).details['longestRun']).toBe(3);

    const stopped = [played[0]!, missed(1), played[2]!];
    expect(strategy.score(reportOf(stopped)).details['longestRun']).toBe(1);
  });

  it('lets rests pass without extending or breaking a run', () => {
    const score = strategy.score(
      reportOf([
        step({ index: 0, status: 'correct' }),
        step({ index: 1, status: 'skipped', expected: [], hits: [] }),
        step({ index: 2, status: 'correct' }),
      ]),
    );

    expect(score.details['longestRun']).toBe(2);
    expect(score.details['playableSteps']).toBe(2);
  });

  it('refuses to call an abandoned run flawless', () => {
    // Two clean steps, then the reader gave up on a sixteen-step exercise.
    const score = strategy.score(
      reportOf([step({ index: 0, status: 'correct' }), step({ index: 1, status: 'correct' })], 16),
    );

    expect(score.details['longestRun']).toBe(2);
    expect(score.details['continuity']).toBeCloseTo(0.125, 10);
    expect(score.grade).toBe('F');
  });

  it('separates runs that counting notes scores identically', () => {
    // Same eight steps, same two breaks, same notes played and missed - so
    // accuracy cannot tell them apart. One reader derailed once and held on
    // afterwards; the other kept falling out. That difference is the whole
    // reason this strategy exists.
    const statuses = (marks: string): StepResult[] =>
      [...marks].map((mark, index) =>
        mark === 'x' ? missed(index) : step({ index, status: 'correct' }),
      );

    const oneBreak = reportOf(statuses('.xx.....'));
    const twoBreaks = reportOf(statuses('.x..x...'));

    const accuracy = new AccuracyScoringStrategy();
    expect(accuracy.score(oneBreak).overall).toBe(accuracy.score(twoBreaks).overall);

    expect(strategy.score(oneBreak).details['longestRun']).toBe(5);
    expect(strategy.score(twoBreaks).details['longestRun']).toBe(3);
    expect(strategy.score(oneBreak).overall).toBeGreaterThan(
      strategy.score(twoBreaks).overall,
    );
  });
});

describe('a reading told as four numbers', () => {
  it('counts the notes Perfect, Good and missed, and the presses that were wrong', () => {
    const report = reportOf([
      step({
        index: 0,
        status: 'incorrect',
        expected: [60, 64],
        hits: [
          { midi: 60, deviationMs: 5, tier: 'perfect' },
          { midi: 64, deviationMs: 120, tier: 'good' },
        ],
        wrong: [61, 62],
      }),
      step({ index: 1, status: 'missed', expected: [62, 65], hits: [{ midi: 62, deviationMs: 0, tier: 'perfect' }], missing: [65] }),
    ]);

    expect(noteCountsOf(report.totals)).toEqual({ perfect: 2, good: 1, missed: 1, wrong: 2 });
  });
});

describe('a Good note in the grade', () => {
  const good = { midi: 62, deviationMs: 300, tier: 'good' } as const;
  const report = reportOf([
    step({ index: 0, status: 'correct' }),
    step({ index: 1, status: 'correct', expected: [62], hits: [good] }),
  ]);

  it('counts for half a note where the grade has no timing part to charge it', () => {
    // Waiting for the notes: a Good one there was struck ahead of the hand
    // being heard, and counted whole it would cost nothing at all.
    expect(new AccuracyScoringStrategy().score(report).accuracy).toBeCloseTo(0.75, 9);
  });

  it('counts whole where the timing part charges for where it landed', () => {
    expect(new TimingWeightedScoringStrategy().score(report).accuracy).toBe(1);
    expect(new ContinuityScoringStrategy().score(report).accuracy).toBe(1);
  });
});

describe('a run that played nothing', () => {
  const strategies = [
    new AccuracyScoringStrategy(),
    new TimingWeightedScoringStrategy(),
    new ContinuityScoringStrategy(),
  ];

  it('scores nothing for a run stopped before a note was asked for', () => {
    // His: stopped in the count-in, before a key was touched, and the
    // reading said C, 70% - accuracy over no notes at all was counted as
    // perfect, and seventy per cent of the grade is accuracy.
    const stopped = reportOf([], 16, false);

    for (const strategy of strategies) {
      const score = strategy.score(stopped);
      expect(score.accuracy).toBe(0);
      expect(score.overall).toBe(0);
      expect(score.grade).toBe('F');
    }
  });
});

describe('ScoringStrategyRegistry', () => {
  it('registers, lists and resolves strategies', () => {
    const registry = new ScoringStrategyRegistry().registerAll([
      new AccuracyScoringStrategy(),
      new ContinuityScoringStrategy(),
    ]);

    expect(registry.list()).toHaveLength(2);
    expect(registry.first().id).toBe('scoring.accuracy');
    expect(registry.get('scoring.continuity').label).toBe('Keeping going');
    expect(registry.has('scoring.continuity')).toBe(true);
  });

  it('rejects duplicates, unknown lookups and an empty catalogue', () => {
    const registry = new ScoringStrategyRegistry().register(new AccuracyScoringStrategy());
    expect(() => registry.register(new AccuracyScoringStrategy())).toThrow(DomainError);
    expect(() => registry.get('scoring.nope')).toThrow(DomainError);
    expect(() => new ScoringStrategyRegistry().first()).toThrow(DomainError);
  });
});

describe('how scattered the presses were', () => {
  function timingOf(deviations: readonly number[]) {
    return reportOf(
      deviations.map((deviationMs, index) => step({ index, status: 'correct', deviationMs })),
    ).timing;
  }

  it('tells a steady habit apart from an unsteady hand', () => {
    // Both average ten milliseconds late, and they are not the same fault: one
    // is a habit to correct, the other is precision - or, if it only appears
    // on the tablet, the path the notes travelled rather than the reader.
    const steady = timingOf([10, 10, 10, 10]);
    const scattered = timingOf([-40, 60, -30, 50]);

    expect(steady.meanDeviationMs).toBeCloseTo(10, 6);
    expect(steady.deviationSpreadMs).toBeCloseTo(0, 6);
    expect(scattered.meanDeviationMs).toBeCloseTo(10, 6);
    expect(scattered.deviationSpreadMs).toBeGreaterThan(40);
  });

  it('says nothing about the spread of a single press', () => {
    // One reading has no scatter to report, and inventing a number would let
    // the first note of a run look like a verdict on the reader.
    expect(timingOf([25]).deviationSpreadMs).toBe(0);
    expect(timingOf([]).deviationSpreadMs).toBe(0);
  });

  it('is measured about the average, not about the beat', () => {
    // A hand that is consistently 100 ms behind is perfectly consistent; the
    // lateness is the mean's business and belongs to a different question.
    expect(timingOf([100, 100, 100]).deviationSpreadMs).toBeCloseTo(0, 6);
  });
});

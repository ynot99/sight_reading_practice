import { describe, expect, it } from 'vitest';
import {
  buildPerformanceReport,
  type StepResult,
} from '../../src/domain/scoring/PerformanceReport.js';
import { worstPassage } from '../../src/domain/scoring/troubleSpots.js';

function step(
  index: number,
  measureIndex: number,
  overrides: Partial<StepResult> = {},
): StepResult {
  return {
    index,
    measureIndex,
    status: 'correct',
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
    modeId: 'mode.flow',
    tempoBpm: 60,
    startedAtMs: 0,
    endedAtMs: 1000,
    completed: true,
    playableSteps: steps.length,
    steps,
  });
}

/** One step per bar, with trouble where named. */
function run(bars: number, trouble: Readonly<Record<number, Partial<StepResult>>>) {
  return reportOf(
    Array.from({ length: bars }, (_, bar) => step(bar, bar, trouble[bar] ?? {})),
  );
}

describe('finding the bars worth drilling', () => {
  it('lands on the stretch that went worst', () => {
    const report = run(12, {
      6: { status: 'missed', missing: [60], played: [] },
      7: { status: 'missed', missing: [60], played: [] },
    });

    // Bars are one-based, as the reader counts them and as the range takes them.
    expect(worstPassage(report, { bars: 4 })).toEqual({ fromBar: 5, toBar: 8 });
  });

  it('weighs a step the music took away above an untidy one', () => {
    const report = run(8, {
      1: { status: 'incorrect', wrong: [61] },
      5: { status: 'missed', missing: [60], played: [] },
    });

    const passage = worstPassage(report, { bars: 2 });
    expect(passage?.fromBar).toBeLessThanOrEqual(6);
    expect(passage?.toBar).toBeGreaterThanOrEqual(6);
  });

  it('ignores timing, which is a matter for the tempo', () => {
    // Late throughout but never lost: there is nothing here to drill, and a
    // reader who is a little behind should be told to slow down, not to
    // practise bar three.
    const report = reportOf(
      Array.from({ length: 8 }, (_, bar) => step(bar, bar, { deviationMs: 220 })),
    );
    expect(worstPassage(report)).toBeNull();
  });

  it('says nothing when the reading was clean', () => {
    expect(worstPassage(run(8, {}))).toBeNull();
  });

  it('prefers the earlier of two equally bad passages', () => {
    // Trouble usually starts before it shows, so the earlier reading is the
    // one that caused it.
    const report = run(12, {
      1: { status: 'missed', missing: [60], played: [] },
      9: { status: 'missed', missing: [60], played: [] },
    });
    expect(worstPassage(report, { bars: 2 })?.fromBar).toBe(1);
  });

  it('never runs off the end of what was played', () => {
    const report = run(3, { 2: { status: 'missed', missing: [60], played: [] } });
    const passage = worstPassage(report, { bars: 8 });
    expect(passage).toEqual({ fromBar: 1, toBar: 3 });
  });
});

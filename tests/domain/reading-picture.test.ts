import { describe, expect, it } from 'vitest';
import type { PerformanceReport, StepResult } from '../../src/domain/scoring/PerformanceReport.js';
import { buildPerformanceReport } from '../../src/domain/scoring/PerformanceReport.js';
import {
  barsOfThePicture,
  MOST_MARKS,
  theReadingPicture,
  tiersOfThePicture,
} from '../../src/domain/scoring/ReadingPicture.js';

function step(index: number, measureIndex: number, how: Partial<StepResult> = {}): StepResult {
  return {
    index,
    status: 'correct',
    measureIndex,
    beat: 1,
    expected: [60],
    // Its one note played when the step was, unless a test says otherwise.
    hits: [{ midi: 60, deviationMs: how.deviationMs === undefined ? 0 : how.deviationMs, tier: 'perfect' }],
    wrong: [],
    missing: [],
    deviationMs: 0,
    ...how,
  };
}

function reportOf(steps: readonly StepResult[], completed = true): PerformanceReport {
  return buildPerformanceReport({
    playableSteps: steps.length,
    exerciseId: 'x',
    modeId: 'mode.flow',
    tempoBpm: 60,
    startedAtMs: 0,
    endedAtMs: 1_000,
    completed,
    steps,
  });
}

const plainly = {
  velocities: [],
  keepsTime: true,
  owedAtMs: [],
  toleranceMs: 120,
};

describe('the picture a reading keeps', () => {
  it('says how each bar read, one letter a bar', () => {
    const report = reportOf([
      step(0, 0),
      step(1, 1, { status: 'incorrect', wrong: [61] }),
      // Bar three was never reached, and is drawn as such rather than left out.
    ]);

    const picture = theReadingPicture({ report, bars: 3, ...plainly });

    expect(picture.bars).toBe('cw.');
    expect(barsOfThePicture(picture).map((bar) => bar.state)).toEqual(['clean', 'wrong', 'unread']);
  });

  it('marks the bars the music waited at, and says so in their labels', () => {
    const report: PerformanceReport = { ...reportOf([step(0, 0)]), waitedAtBars: [0] };

    const picture = theReadingPicture({ report, bars: 1, ...plainly });

    expect(picture.waitedAtBars).toEqual([0]);
    expect(barsOfThePicture(picture)[0]?.waited).toBe(true);
    expect(barsOfThePicture(picture)[0]?.label).toContain('waited here');
  });

  it('keeps the bar it was stopped in, and nothing where it was played to the end', () => {
    const stopped = reportOf([step(0, 0), step(1, 4, { status: 'skipped' })], false);

    expect(theReadingPicture({ report: stopped, bars: 5, ...plainly }).stoppedAtBar).toBe(1);
    expect(theReadingPicture({ report: reportOf([step(0, 0)]), bars: 1, ...plainly }).stoppedAtBar).toBeNull();
  });

  it('thins a long run’s scatter, and says how many presses it stands for', () => {
    // Every press kept would be a megabyte a reading of a long piece, and the
    // store's answer to being full is to drop the write without a word.
    const steps = Array.from({ length: MOST_MARKS * 3 }, (_unused, at) =>
      step(at, Math.floor(at / 10), { deviationMs: at % 2 === 0 ? 10.4 : -10.4 }),
    );

    const picture = theReadingPicture({ report: reportOf(steps), bars: 180, ...plainly });

    expect(picture.pressesJudged).toBe(MOST_MARKS * 3);
    expect(picture.deviationsMs.length).toBeLessThanOrEqual(MOST_MARKS);
    expect(picture.deviationsMs.length).toBeGreaterThan(MOST_MARKS / 2);
    // Whole milliseconds: a press is not measured to a thousandth of one, and
    // the digits would be a fifth of what is kept.
    expect(picture.deviationsMs.every((value) => Number.isInteger(value))).toBe(true);
  });

  it('keeps the verdict of every mark it keeps, thinned alike', () => {
    // Every third note Good, so a verdict kept against the wrong mark shows.
    const steps = Array.from({ length: MOST_MARKS * 3 }, (_unused, at) =>
      step(at, Math.floor(at / 10), {
        deviationMs: at % 3 === 0 ? 90 : 5,
        hits: [
          { midi: 60, deviationMs: at % 3 === 0 ? 90 : 5, tier: at % 3 === 0 ? 'good' : 'perfect', windowMs: 40 },
        ],
      }),
    );

    const picture = theReadingPicture({ report: reportOf(steps), bars: 180, ...plainly });

    const tiers = tiersOfThePicture(picture);
    expect(tiers).toHaveLength(picture.deviationsMs.length);
    expect(tiers.every((tier, at) => (tier === 'good') === (picture.deviationsMs[at] === 90))).toBe(true);
    expect(picture.perfectMs).toBe(40);
  });

  it('reads back no verdicts where a letter is not one', () => {
    const picture = theReadingPicture({ report: reportOf([step(0, 0)]), bars: 1, ...plainly });

    expect(tiersOfThePicture({ ...picture, tiersOfMarks: 'pgx' })).toEqual([]);
    expect(tiersOfThePicture({ ...picture, tiersOfMarks: 'pg' })).toEqual(['perfect', 'good']);
  });

  it('keeps every mark of a short run, in order', () => {
    const steps = [step(0, 0, { deviationMs: -8 }), step(1, 0, { deviationMs: 4 })];

    expect(theReadingPicture({ report: reportOf(steps), bars: 1, ...plainly }).deviationsMs).toEqual([
      -8, 4,
    ]);
  });

  it('carries the window the presses were judged against', () => {
    // Drawn against the window of the run it was, not of the settings now: a
    // reader who has since widened the window would see an old reading
    // redrawn as tidier than it was.
    const picture = theReadingPicture({
      report: reportOf([step(0, 0)]),
      bars: 1,
      ...plainly,
      toleranceMs: 45,
    });

    expect(picture.toleranceMs).toBe(45);
  });
});

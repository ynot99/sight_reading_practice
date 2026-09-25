import { describe, expect, it } from 'vitest';
import { buildPerformanceReport } from '../../src/domain/scoring/PerformanceReport.js';
import type { StepResult } from '../../src/domain/scoring/PerformanceReport.js';
import { theEvenness, theProfile } from '../../src/domain/scoring/theProfile.js';

function step(index: number, deviationMs: number | null, wrong: readonly number[] = []): StepResult {
  return {
    index,
    status: wrong.length > 0 ? 'incorrect' : 'correct',
    measureIndex: 0,
    beat: 1,
    expected: [60],
    hits: [{ midi: 60, deviationMs, tier: 'perfect' }],
    wrong: [...wrong],
    missing: [],
    deviationMs,
  };
}

/**
 * A step as a run that waits records it: entered at this moment, and its note
 * with no timing of its own - nothing kept the time for it to be off by.
 */
function entered(index: number, atMs: number): StepResult {
  return { ...step(index, atMs), hits: [{ midi: 60, deviationMs: null, tier: 'perfect' }] };
}

function reportOf(steps: readonly StepResult[], playableSteps?: number) {
  return buildPerformanceReport({
    exerciseId: 'ex',
    modeId: 'mode.test',
    tempoBpm: 60,
    startedAtMs: 0,
    endedAtMs: 10_000,
    completed: true,
    playableSteps: playableSteps ?? steps.length,
    steps,
  });
}

/** Four presses, none of them a knock. */
const EVEN = [0.5, 0.55, 0.5, 0.52, 0.5];

describe('the shape of a reading', () => {
  it('names the one timing axis for the frame it was read in', () => {
    // The same `meanAbsoluteDeviationMs` is how far behind the beat a reader
    // was where a machine kept the time, and how long they took to arrive where
    // the music waited for them. One number, two meanings, and the frame
    // decides which - so it is named rather than drawn twice. His list had both
    // as separate axes, and one of them would always have been empty.
    const report = reportOf([step(0, 40), step(1, 60)]);

    expect(theProfile(report, EVEN, true).map((axis) => axis.name)).toContain('Timing');
    expect(theProfile(report, EVEN, false).map((axis) => axis.name)).toContain('Flow');
    expect(theProfile(report, EVEN, true).map((axis) => axis.name)).not.toContain('Flow');
  });

  it('reads every axis as a share of the best it could be', () => {
    // Milliseconds against a count of notes: a shape drawn from them can only
    // be read if they agree about what "all the way out" means.
    const axes = theProfile(reportOf([step(0, 0), step(1, 0)]), EVEN, true);

    for (const axis of axes) {
      expect(axis.of, axis.name).toBeGreaterThanOrEqual(0);
      expect(axis.of, axis.name).toBeLessThanOrEqual(1);
    }
  });

  it('counts accuracy against the music, not against the attempt', () => {
    // Two steps played out of sixteen is not a flawless reading.
    const short = reportOf([step(0, 0), step(1, 0)], 16);

    const accuracy = theProfile(short, EVEN, true).find((axis) => axis.name === 'Accuracy');
    expect(accuracy?.of).toBeCloseTo(2 / 16, 10);
    expect(accuracy?.said).toBe('2 of 16');
  });

  it('holds timing against a gap that means something, not against nought', () => {
    // Against a perfect nought a reader who is human reads as a failure on
    // every run they ever play, and an axis that is always empty says nothing.
    const tight = theProfile(reportOf([step(0, 10), step(1, -10)]), EVEN, true);
    const loose = theProfile(reportOf([step(0, 200), step(1, -200)]), EVEN, true);

    expect(tight.find((axis) => axis.name === 'Timing')?.of ?? 0).toBeGreaterThan(0.9);
    expect(loose.find((axis) => axis.name === 'Timing')?.of ?? 1).toBeLessThan(0.3);
  });

  it('carries the number behind each axis', () => {
    // A shape says which way a reading leans and never what it was.
    const axes = theProfile(reportOf([step(0, 40), step(1, 60)]), EVEN, false);

    for (const axis of axes) {
      expect(axis.said, axis.name).not.toBe('');
    }
    expect(axes.find((axis) => axis.name === 'Flow')?.said).toContain('held up');
  });

  it('leaves dynamics off where there is no hand to judge', () => {
    // Three presses are not a hand. Drawn at nought instead, an axis nobody
    // could score reads as a fault rather than as a silence.
    const axes = theProfile(reportOf([step(0, 0)]), [0.5, 0.6], true);

    expect(axes.map((axis) => axis.name)).not.toContain('Dynamics');
    expect(axes).toHaveLength(3);
  });
});

describe('how evenly the presses were struck', () => {
  it('does not mark a reader down for playing musically', () => {
    // His first wording was the smoothness of the velocity, which a piece with
    // a crescendo in it is supposed to break: an axis rewarding a flat velocity
    // gives its best score to a machine. A rising line is not a fault.
    const crescendo = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];

    expect(theEvenness(crescendo) ?? 0).toBe(1);
  });

  it('counts the press that leaps away from the ones either side of it', () => {
    // The finger that caught the key too hard, which is what he actually meant.
    const knocked = [0.4, 0.42, 1, 0.41, 0.4, 0.42, 0.41];

    expect(theEvenness(knocked) ?? 1).toBeLessThan(1);
    expect(theEvenness(knocked) ?? 1).toBeGreaterThan(0);
  });

  it('calls a run struck at one strength perfectly even', () => {
    expect(theEvenness([0.5, 0.5, 0.5, 0.5])).toBe(1);
  });

  it('says nothing about a handful of presses', () => {
    expect(theEvenness([0.5, 0.9])).toBeNull();
  });
});

describe('what a frame that waits can be judged on', () => {
  /** A reading whose entries fall at these moments from the run's beginning. */
  function played(moments: readonly number[]) {
    return reportOf(moments.map((at, index) => entered(index, at)));
  }

  function axis(moments: readonly number[], name: string): number {
    return theProfile(played(moments), [], false).find((each) => each.name === name)?.of ?? -1;
  }

  const EVEN = [0, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000];

  it('calls a reading in even time a good one', () => {
    // The fault he found: in a frame that waits, nothing keeps the time, so the
    // deviations are measured from the run's beginning and come back as a
    // rising line however well it was played. Both axes drawn straight from
    // them read as nought for a reading of eight quarters dead on the tempo.
    // His: "начебто у wait for notes зіграв гарно, але ці метрики просто не
    // малюються".
    expect(axis(EVEN, 'Flow')).toBe(1);
    expect(axis(EVEN, 'Stability')).toBe(1);
  });

  it('does not mark a reader down for taking it slowly', () => {
    // There is no tempo but theirs. Quarters at a leisurely two seconds are as
    // steady as quarters at one, and the axis that said otherwise was scoring
    // the pace rather than the playing.
    const slow = EVEN.map((at) => at * 2.2);

    expect(axis(slow, 'Flow')).toBeCloseTo(axis(EVEN, 'Flow'), 10);
    expect(axis(slow, 'Stability')).toBeCloseTo(axis(EVEN, 'Stability'), 10);
  });

  it('lets a human hand wobble without calling it a hesitation', () => {
    const human = EVEN.map((at, index) => at + (index % 2 === 0 ? 90 : -70));

    expect(axis(human, 'Flow')).toBe(1);
    expect(axis(human, 'Stability')).toBeGreaterThan(0.7);
  });

  it('counts a stop to find the next note, without emptying the axis for one', () => {
    const hesitated = EVEN.map((at, index) => (index < 4 ? at : at + 2_500));

    expect(axis(hesitated, 'Flow')).toBeLessThan(1);
    expect(axis(hesitated, 'Flow')).toBeGreaterThan(0.5);
  });

  it('is not troubled by a reader getting on with it', () => {
    // A gap shorter than its neighbours is not a micro-pause.
    const brisk = [0, 1_000, 1_400, 2_400, 3_400, 4_400, 5_400, 6_400];

    expect(axis(brisk, 'Flow')).toBe(1);
  });

  it('marks a reading that never found a pace', () => {
    const ragged = [0, 400, 1_900, 2_100, 4_200, 4_500, 7_000, 7_300];

    expect(axis(ragged, 'Flow')).toBeLessThan(0.6);
    expect(axis(ragged, 'Stability')).toBeLessThan(0.3);
  });

  it('says how many entries held up, which is the number behind the shape', () => {
    const said = theProfile(played(EVEN), [], false).find((each) => each.name === 'Flow')?.said;

    expect(said).toBe('0 of 5 held up');
  });
});

describe('a reading of music that is not all one value', () => {
  /** Half, eighth, quarter, eighth, eighth, half - where they fall as written. */
  const WRITTEN = [0, 2_000, 2_500, 3_500, 4_000, 4_500, 6_500];

  function axis(moments: readonly number[], name: string): number {
    const report = reportOf(moments.map((at, index) => entered(index, at)));
    return theProfile(report, [], false, WRITTEN).find((each) => each.name === name)?.of ?? -1;
  }

  it('calls a reading in written time a steady one', () => {
    // The fault he found second: a piece is not made of one value, so the gaps
    // between a reader's entries are *supposed* to differ - a half note is
    // followed four times as slowly as an eighth. Measured against each other,
    // a flawless reading of a half, an eighth and a quarter scored 0.40, and
    // real music is all mixed values. His: "stability на 0% постійно".
    expect(axis(WRITTEN, 'Stability')).toBe(1);
    expect(axis(WRITTEN, 'Flow')).toBe(1);
  });

  it('is as steady at a slower tempo, held as evenly', () => {
    // There is no tempo but theirs, so what is asked is whether they held one.
    const slower = WRITTEN.map((at) => at * 1.8);

    expect(axis(slower, 'Stability')).toBeCloseTo(1, 10);
    expect(axis(slower, 'Flow')).toBe(1);
  });

  it('still sees a hand that stopped to find the next note', () => {
    // The floor must not reach so far that the thing the axis is for is gone.
    const hung = WRITTEN.map((at, index) => (index < 3 ? at : at + 2_000));

    expect(axis(hung, 'Flow')).toBeLessThan(1);
    expect(axis(hung, 'Stability')).toBeLessThan(1);
  });

  it('falls back to the gaps where nothing knew the music', () => {
    // Nothing is passed by a caller with no timeline to hand, and the axes are
    // read off the gaps alone - right for a piece in one value, and wrong in
    // the old way for anything else. Said rather than left as a silent nought.
    const even = [0, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000];
    const report = reportOf(even.map((at, index) => step(index, at)));

    expect(theProfile(report, [], false).find((each) => each.name === 'Stability')?.of).toBe(1);
  });

  it('passes over an entry the music gave no time to', () => {
    // A caller hands these in; two of them at one written moment would be a
    // division by nought, and a pace of infinity draws as a shape with a corner
    // somewhere off the page.
    const owed = [0, 1_000, 1_000, 2_000, 3_000, 4_000, 5_000];
    const played = [0, 1_000, 1_400, 2_400, 3_400, 4_400, 5_400];
    const report = reportOf(played.map((at, index) => step(index, at)));

    for (const each of theProfile(report, [], false, owed)) {
      expect(Number.isFinite(each.of), each.name).toBe(true);
      expect(each.of, each.name).toBeLessThanOrEqual(1);
    }
  });

  it('says the pace it held, as a share of what was written', () => {
    const slower = WRITTEN.map((at) => at * 1.5);
    const report = reportOf(slower.map((at, index) => step(index, at)));
    const said = theProfile(report, [], false, WRITTEN).find(
      (each) => each.name === 'Stability',
    )?.said;

    expect(said).toBe('150% of the written pace, evenly');
  });
});

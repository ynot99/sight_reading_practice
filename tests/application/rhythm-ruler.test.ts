import { describe, expect, it } from 'vitest';
import { rulerMarks } from '../../src/application/rhythmRuler.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { twoBarExercise } from '../support/fixtures.js';

const timeline = buildTimeline(twoBarExercise());

/** Where a mark sits, as the test would say it aloud. */
function placed(mark: {
  fromStep: number;
  toStep: number | null;
  fraction: number;
}): string {
  if (mark.toStep === mark.fromStep) {
    return `on ${mark.fromStep}`;
  }
  const far = mark.toStep === null ? 'the bar line' : String(mark.toStep);
  return `${mark.fraction} between ${mark.fromStep} and ${far}`;
}

describe('ruling the beat through the bars', () => {
  it('rules nothing when the reader asked for nothing', () => {
    expect(rulerMarks(timeline, 'off', 'pulse')).toEqual([]);
  });

  it('lands exactly on the notes the beats are written on', () => {
    // The fixture plays four quarters through its first bar, so every beat of
    // that bar is a note - and a line on a note is placed on it rather than
    // reckoned between anything.
    const bar = rulerMarks(timeline, 'quarter', 'pulse').slice(0, 4);

    expect(bar.map(placed)).toEqual(['on 0', 'on 1', 'on 2', 'on 3']);
    expect(bar.map((mark) => mark.weight)).toEqual(['downbeat', 'beat', 'beat', 'beat']);
  });

  it('reckons the offbeats between the notes on either side', () => {
    // Nothing is written on them, so there is no note to stand on: the line
    // falls halfway between the quarter before it and the quarter after.
    const eighths = rulerMarks(timeline, 'eighth', 'pulse').slice(0, 4);

    expect(eighths.map(placed)).toEqual([
      'on 0',
      '0.5 between 0 and 1',
      'on 1',
      '0.5 between 1 and 2',
    ]);
    expect(eighths.map((mark) => mark.weight)).toEqual([
      'downbeat',
      'division',
      'beat',
      'division',
    ]);
  });

  it('never reckons a line across a bar line', () => {
    // Reported from the page: ruled in eighths, the last line of a bar came
    // out past the bar line and into the bar after it. The next note after
    // the last one of a bar is in the *next* bar, and between them stand the
    // bar line, its margins and whatever the next bar restates - room that
    // carries no time at all.
    const eighths = rulerMarks(timeline, 'eighth', 'pulse');
    const lastOfTheBar = eighths.filter(
      (mark) => mark.ticks === Duration.WHOLE.ticks - Duration.EIGHTH.ticks,
    );

    expect(lastOfTheBar).toHaveLength(1);
    // Reckoned against the bar's own edge, which is the last place in it that
    // still means a moment of its music.
    expect(lastOfTheBar[0]?.toStep).toBeNull();
    expect(lastOfTheBar[0]?.bar).toBe(0);
    expect(lastOfTheBar[0]?.fraction).toBeGreaterThan(0);
    expect(lastOfTheBar[0]?.fraction).toBeLessThan(1);
  });

  it('starts every bar again, so a changed metre is ruled as it is written', () => {
    // Three-four after four-four: the second bar's downbeat is its own, and
    // the bar is ruled in three rather than carrying four across the line.
    const changing = buildTimeline({
      ...twoBarExercise(),
      timeChanges: [{ measureIndex: 1, timeSignature: new TimeSignature(3, 4) }],
    });
    const marks = rulerMarks(changing, 'quarter', 'pulse');
    const downbeats = marks.filter((mark) => mark.weight === 'downbeat');

    expect(downbeats).toHaveLength(2);
    expect(marks).toHaveLength(4 + 3);
  });

  describe('following the metronome', () => {
    // Four-four, then six-eight: the second bar's beat is a dotted quarter.
    const changing = buildTimeline({
      ...twoBarExercise(),
      timeChanges: [{ measureIndex: 1, timeSignature: new TimeSignature(6, 8) }],
    });
    const E = Duration.EIGHTH.ticks;
    const BAR = Duration.WHOLE.ticks;
    const ruled = (click: Parameters<typeof rulerMarks>[2]): [number, string][] =>
      rulerMarks(changing, 'metronome', click).map((mark) => [mark.ticks, mark.weight]);

    it('rules the beat of each bar where the click falls on it, a dotted quarter in six-eight', () => {
      expect(ruled('pulse')).toEqual([
        [0, 'downbeat'],
        [2 * E, 'beat'],
        [4 * E, 'beat'],
        [6 * E, 'beat'],
        [BAR, 'downbeat'],
        [BAR + 3 * E, 'beat'],
      ]);
      // Which a ruler of quarters cannot do: it misses the second beat.
      const quarters = rulerMarks(changing, 'quarter', 'pulse').map((mark) => mark.ticks);
      expect(quarters).not.toContain(BAR + 3 * E);
    });

    it('rules the parts of the beat when the click divides it, in two or in three', () => {
      expect(ruled('division').filter(([at]) => at >= BAR)).toEqual([
        [BAR, 'downbeat'],
        [BAR + E, 'division'],
        [BAR + 2 * E, 'division'],
        [BAR + 3 * E, 'beat'],
        [BAR + 4 * E, 'division'],
        [BAR + 5 * E, 'division'],
      ]);
      expect(ruled('division').filter(([at]) => at < BAR)).toHaveLength(8);
      expect(ruled('subdivision').filter(([at]) => at >= BAR)).toHaveLength(12);
      expect(ruled('subdivision').filter(([at]) => at < BAR)).toHaveLength(16);
    });

    it('rules the beat where the click marks only the bar, or only the notes', () => {
      expect(ruled('downbeat')).toEqual(ruled('pulse'));
      expect(ruled('notes')).toEqual(ruled('pulse'));
    });

    it('leaves a ruler of note values as it was, whatever the click', () => {
      expect(rulerMarks(changing, 'eighth', 'subdivision')).toEqual(rulerMarks(changing, 'eighth', 'pulse'));
    });
  });

  it('rules the whole bar even where one hand holds through it', () => {
    // The beats are the bar's, not the notes': a held chord does not stop the
    // second and third beats of its bar from being beats.
    const quarters = rulerMarks(timeline, 'quarter', 'pulse');

    expect(quarters.length).toBeGreaterThanOrEqual(4);
    expect(quarters.filter((mark) => mark.weight === 'downbeat')).toHaveLength(2);
  });

  it('rules more finely when asked, and never more coarsely', () => {
    const halves = rulerMarks(timeline, 'half', 'pulse').length;
    const quarters = rulerMarks(timeline, 'quarter', 'pulse').length;
    const sixteenths = rulerMarks(timeline, 'sixteenth', 'pulse').length;

    expect(quarters).toBeGreaterThan(halves);
    expect(sixteenths).toBeGreaterThan(quarters);
    // And the coarser ruling is a subset of the finer one, which is what
    // makes them the same ruler at different resolutions.
    expect(Duration.HALF.ticks % Duration.QUARTER.ticks).toBe(0);
  });
});

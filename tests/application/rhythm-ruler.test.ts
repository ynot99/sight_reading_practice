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
    expect(rulerMarks(timeline, 'off')).toEqual([]);
  });

  it('lands exactly on the notes the beats are written on', () => {
    // The fixture plays four quarters through its first bar, so every beat of
    // that bar is a note - and a line on a note is placed on it rather than
    // reckoned between anything.
    const bar = rulerMarks(timeline, 'quarter').slice(0, 4);

    expect(bar.map(placed)).toEqual(['on 0', 'on 1', 'on 2', 'on 3']);
    expect(bar.map((mark) => mark.weight)).toEqual(['downbeat', 'beat', 'beat', 'beat']);
  });

  it('reckons the offbeats between the notes on either side', () => {
    // Nothing is written on them, so there is no note to stand on: the line
    // falls halfway between the quarter before it and the quarter after.
    const eighths = rulerMarks(timeline, 'eighth').slice(0, 4);

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
    const eighths = rulerMarks(timeline, 'eighth');
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
    const marks = rulerMarks(changing, 'quarter');
    const downbeats = marks.filter((mark) => mark.weight === 'downbeat');

    expect(downbeats).toHaveLength(2);
    expect(marks).toHaveLength(4 + 3);
  });

  it('rules the whole bar even where one hand holds through it', () => {
    // The beats are the bar's, not the notes': a held chord does not stop the
    // second and third beats of its bar from being beats.
    const quarters = rulerMarks(timeline, 'quarter');

    expect(quarters.length).toBeGreaterThanOrEqual(4);
    expect(quarters.filter((mark) => mark.weight === 'downbeat')).toHaveLength(2);
  });

  it('rules more finely when asked, and never more coarsely', () => {
    const halves = rulerMarks(timeline, 'half').length;
    const quarters = rulerMarks(timeline, 'quarter').length;
    const sixteenths = rulerMarks(timeline, 'sixteenth').length;

    expect(quarters).toBeGreaterThan(halves);
    expect(sixteenths).toBeGreaterThan(quarters);
    // And the coarser ruling is a subset of the finer one, which is what
    // makes them the same ruler at different resolutions.
    expect(Duration.HALF.ticks % Duration.QUARTER.ticks).toBe(0);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  paintTheFallingPedal,
  paintTheLane,
  theFallingBarLines,
  theFallingNotes,
  theFallingPedal,
  theFallingRuling,
  theRisingNotes,
  theRisingPedal,
  type FallingNote,
  type LaneInks,
  type LaneNote,
  type LanePedal,
} from '../../src/ui/fallingNotes.js';
import type { KeyPlace } from '../../src/ui/replayKeys.js';
import { partlySeen } from '../../src/ui/rollPainter.js';
import { surface, type Mark } from '../support/recordingCanvas.js';

/** Every ink named by what it is for, so a note painted says which it was. */
const INKS: LaneInks = {
  perfect: 'perfect',
  good: 'good',
  wrong: 'wrong',
  aside: 'aside',
  heard: 'heard',
  edge: 'edge',
  line: 'line',
  font: 'serif',
};

const note = (fromMs: number, untilMs: number, midi = 60): FallingNote => ({
  midi,
  fromMs,
  untilMs,
  shade: 'heard',
});

/** A bar's ends to a thousandth, which is finer than any screen. */
const ends = (bars: readonly LaneNote[]): [number, number, number][] =>
  bars.map((bar) => [bar.midi, Number(bar.top.toFixed(3)), Number(bar.bottom.toFixed(3))]);

describe('the notes falling onto the keys', () => {
  it('lands a note on its key as it sounds, and lets it go on into the key while it lasts', () => {
    // A second into the music, three seconds of it ahead: the lane's top is
    // four seconds in, and its foot - the keys - is now.
    const bars = theFallingNotes(
      [
        // Sounding since half a second ago, and for another second.
        note(500, 2_000, 60),
        // A second and a half off, lasting six tenths.
        note(2_500, 3_100, 62),
        // Coming in at the top, running past it.
        note(3_500, 6_000, 64),
        // Held for ever, as a key still down when a run stopped is.
        note(0, Number.POSITIVE_INFINITY, 48),
      ],
      1_000,
      3_000,
    );

    expect(ends(bars)).toEqual([
      [60, 0.667, 1],
      [62, 0.3, 0.5],
      [64, 0, 0.167],
      [48, 0, 1],
    ]);
  });

  it('leaves out what is still above the lane, what is over, and what lasts no time', () => {
    const bars = theFallingNotes(
      [
        // Comes in at the very top of the lane this instant.
        note(4_000, 5_000),
        // Ended the instant the lane is looked at.
        note(0, 1_000),
        // Nothing to draw.
        note(2_000, 2_000),
      ],
      1_000,
      3_000,
    );

    expect(bars).toEqual([]);
  });

  it('falls at one speed down the whole lane', () => {
    // Swept across the lane a tenth at a time: a note a share of the way
    // ahead stands that share of the way up.
    for (let tenth = 0; tenth < 10; tenth += 1) {
      const [bar] = theFallingNotes([note(tenth * 300, tenth * 300 + 100)], 0, 3_000);
      expect(bar?.bottom ?? Number.NaN, String(tenth)).toBeCloseTo(1 - tenth / 10, 9);
    }
  });

  it('paints each note over its own key and edged, the white keys first and the black ones over them', () => {
    const { surface: lane, recorder } = surface(300, 200);
    const keys = new Map<number, KeyPlace>([
      [60, { left: 100, width: 20 }],
      [61, { left: 114, width: 12 }],
    ]);

    paintTheLane(
      lane,
      {
        notes: [
          { midi: 61, shade: 'wrong', top: 0.5, bottom: 1 },
          { midi: 60, shade: 'perfect', top: 0, bottom: 0.5 },
          // Not a key the keyboard has.
          { midi: 200, shade: 'good', top: 0, bottom: 1 },
        ],
        barLines: [],
        ruling: [],
      },
      keys,
      INKS,
      2,
    );

    // As many pixels as the screen has.
    expect(lane.width).toBe(600);
    expect(lane.height).toBe(400);
    expect(recorder.transform).toEqual([2, 0, 0, 2, 0, 0]);
    expect(recorder.marks.map(({ how, ink, x, y, wide, tall }) => [how, ink, x, y, wide, tall])).toEqual([
      // A pixel in from either edge of its key, and edged so that over the
      // music it is still a shape.
      ['fill', 'perfect', 101, 0, 18, 100],
      ['stroke', 'edge', 101, 0, 18, 100],
      // Over the join of the two.
      ['fill', 'wrong', 115, 100, 10, 100],
      ['stroke', 'edge', 115, 100, 10, 100],
    ]);
  });

  it('paints the shortest note tall enough to see, and on the lane', () => {
    const { surface: lane, recorder } = surface(300, 200);

    paintTheLane(
      lane,
      { notes: [{ midi: 60, shade: 'heard', top: 0.999, bottom: 1 }], barLines: [], ruling: [] },
      new Map([[60, { left: 100, width: 20 }]]),
      INKS,
      1,
    );

    expect(recorder.marks.map(({ how, y, tall }) => [how, y, tall])).toEqual([
      ['fill', 198, 2],
      ['stroke', 198, 2],
    ]);
  });
});

describe('the notes rising from the keys in free play', () => {
  it('stands a key still down on its key and grows it as it is held, and lets one let go of rise', () => {
    // Ten seconds in, three seconds of what was played above the keys.
    const bars = theRisingNotes(
      [
        // Down since a second ago, and held: asked about now, it lasts until now.
        note(9_000, 10_000, 60),
        // Down at 7.5 s, up at 8.5 s.
        note(7_500, 8_500, 62),
        // Went down before the lane's top, came up inside it.
        note(5_000, 7_600, 64),
      ],
      10_000,
      3_000,
    );

    expect(ends(bars)).toEqual([
      [60, 0.667, 1],
      [62, 0.167, 0.5],
      [64, 0, 0.2],
    ]);
  });

  it('leaves out what has risen past the top, and what lasts no time', () => {
    const bars = theRisingNotes(
      [
        // Came up the instant the lane's top was reached.
        note(5_000, 7_000),
        // Pressed this instant: nothing to draw yet.
        note(10_000, 10_000),
      ],
      10_000,
      3_000,
    );

    expect(bars).toEqual([]);
  });

  it('rises at one speed up the whole lane', () => {
    // Swept across the lane a tenth at a time: a note let go of a share of
    // the lane ago has its foot that share of the way up.
    for (let tenth = 0; tenth < 10; tenth += 1) {
      const [bar] = theRisingNotes([note(-3_500, -tenth * 300)], 0, 3_000);
      expect(bar?.bottom ?? Number.NaN, String(tenth)).toBeCloseTo(1 - tenth / 10, 9);
    }
  });

  it('stands a press of the pedal on its mark while it is down, its top where it went down', () => {
    const shown = theRisingPedal(
      [
        // Down two seconds ago and still down.
        { fromMs: 8_000, untilMs: 10_000 },
        // Down and up again inside the column.
        { fromMs: 7_000, untilMs: 7_900 },
        // Gone over the top, and not yet anything.
        { fromMs: 5_000, untilMs: 7_000 },
        { fromMs: 10_000, untilMs: 10_000 },
      ],
      10_000,
      3_000,
    );

    expect(shown.map((press) => [Number(press.lift.toFixed(3)), Number(press.foot.toFixed(3))])).toEqual([
      [0.333, 1],
      [0, 0.3],
    ]);
  });
});

describe('the pedal falling onto its mark', () => {
  /** A real colour, so what an end fades through can be told. */
  const BLUE = 'rgb(37, 99, 235)';
  const inks: LaneInks = { ...INKS, heard: BLUE };
  const painted = (presses: readonly LanePedal[]): Mark[] => {
    const { surface: column, recorder } = surface(56, 200);
    paintTheFallingPedal(column, presses, inks, 1);
    return recorder.inked(BLUE);
  };

  it('lands the foot of a press on the mark as the pedal goes down, and its top as it comes up', () => {
    const shown = theFallingPedal(
      [
        // Down a second ago, and up a second and a half from now.
        { fromMs: 0, untilMs: 2_500 },
        { fromMs: 2_500, untilMs: 3_100 },
        // Never let up.
        { fromMs: 3_500, untilMs: Number.POSITIVE_INFINITY },
        // Up already, and still to come.
        { fromMs: 0, untilMs: 1_000 },
        { fromMs: 4_000, untilMs: 5_000 },
      ],
      1_000,
      3_000,
    );

    expect(shown.map((press) => [Number(press.lift.toFixed(3)), Number(press.foot.toFixed(3))])).toEqual([
      [0.5, 1.333],
      [0.3, 0.5],
      [Number.NEGATIVE_INFINITY, 0.167],
    ]);
  });

  it('paints a short press whole, and a long one by its two ends, each fading in towards the other', () => {
    const [short] = painted([{ lift: 0.25, foot: 0.5 }]);
    expect([short?.y, short?.tall, short?.corners]).toEqual([51, 48, [16, 16, 16, 16]]);
    expect(new Set(short?.fade?.stops.map(([, colour]) => colour))).toEqual(new Set([BLUE]));

    const [foot, top] = painted([{ lift: 0, foot: 0.9 }]);
    // The foot, round at the bottom, whole for a way and faded above.
    expect([foot?.x, foot?.y, foot?.wide, foot?.tall, foot?.corners]).toEqual([12, 107, 32, 72, [0, 0, 16, 16]]);
    expect(foot?.fade).toEqual({
      fromY: 107,
      toY: 179,
      stops: [
        [0, 'rgba(37, 99, 235, 0)'],
        [1 - 1 / 3, BLUE],
        [1, BLUE],
      ],
    });
    // The top, round above, whole for a way and faded below.
    expect([top?.y, top?.tall, top?.corners]).toEqual([1, 72, [16, 16, 0, 0]]);
    expect(top?.fade?.stops).toEqual([
      [0, BLUE],
      [1 / 3, BLUE],
      [1, 'rgba(37, 99, 235, 0)'],
    ]);
  });

  it('lets the fades of two ends meet in a press too short for both, seen less between them but never gone', () => {
    // Ninety-eight pixels long: each end is seen whole for twenty-four, and
    // by the middle each has faded by a little.
    const [whole, ...more] = painted([{ lift: 0.25, foot: 0.75 }]);

    expect(more).toEqual([]);
    expect([whole?.y, whole?.tall]).toEqual([51, 98]);
    expect(whole?.fade?.stops.map(([, colour]) => colour)).toEqual([
      BLUE,
      BLUE,
      'rgba(37, 99, 235, 0.958)',
      'rgba(37, 99, 235, 0.958)',
      BLUE,
      BLUE,
    ]);

    // A hundred and thirty-eight: as long as one can be and still be painted
    // whole, and between its ends all but gone - as a longer one, painted by
    // its two ends, is gone there.
    const [longest] = painted([{ lift: 0.15, foot: 0.85 }]);
    expect(longest?.fade?.stops.map(([, colour]) => colour)).toEqual([
      BLUE,
      BLUE,
      'rgba(37, 99, 235, 0.125)',
      'rgba(37, 99, 235, 0.125)',
      BLUE,
      BLUE,
    ]);
  });

  it('paints only the foot of a pedal never let up, and the top of one let up beyond the column', () => {
    expect(painted([{ lift: Number.NEGATIVE_INFINITY, foot: 0.8 }]).map(({ y, tall }) => [y, tall])).toEqual([
      [87, 72],
    ]);

    // Its top above the column: the part of its fade that has come in, cut
    // square where the column begins.
    const [, top] = painted([{ lift: -0.2, foot: 0.9 }]);
    expect([top?.y, top?.tall, top?.corners, top?.fade?.fromY]).toEqual([0, 33, [0, 0, 0, 0], -39]);
  });

  it('takes the foot on down into the mark, and lands the top on it as the pedal comes up', () => {
    expect(
      painted([
        // Down a moment ago: its foot is past the mark, cut off square.
        { lift: -1, foot: 1.2 },
        // Down long enough for all of the foot that is painted to have gone in.
        { lift: -1, foot: 1.5 },
      ]).map(({ y, tall, corners }) => [y, tall, corners]),
    ).toEqual([[167, 33, [0, 0, 0, 0]]]);

    // Coming up in a moment: its top is all but on the mark.
    expect(painted([{ lift: 0.95, foot: 2 }]).map(({ y, tall, corners }) => [y, tall, corners])).toEqual([
      [191, 9, [4.5, 4.5, 0, 0]],
    ]);
  });

  it('leaves room to see a change of pedal between two presses end to end', () => {
    const [upper, lower] = painted([
      { lift: 0.25, foot: 0.5 },
      { lift: 0.5, foot: 0.75 },
    ]);

    expect((lower?.y ?? 0) - ((upper?.y ?? 0) + (upper?.tall ?? 0))).toBe(2);
  });

  it('paints the shortest press tall enough to see, and edges every piece', () => {
    const { surface: column, recorder } = surface(56, 200);

    paintTheFallingPedal(column, [{ lift: 0.999, foot: 1 }, { lift: 0, foot: 0.9 }], inks, 1);

    expect(recorder.inked(BLUE).map(({ y, tall }) => [y, tall])[0]).toEqual([197, 2]);
    expect(recorder.inked('edge').map((edge) => edge.fade?.fromY)).toEqual([197, 107, 1]);
  });

  it('fades an ink through its own colour, not through a transparent black', () => {
    expect(partlySeen('rgb(37, 99, 235)', 0)).toBe('rgba(37, 99, 235, 0)');
    expect(partlySeen('rgba(15, 23, 42, 0.7)', 0.5)).toBe('rgba(15, 23, 42, 0.35)');
  });
});

describe('the bar lines falling with the notes', () => {
  it('stands each where its bar begins, reaching the keys as it does', () => {
    // A second in, three ahead: a bar beginning now is on the keys, one two
    // seconds off a third of the way down.
    const lines = theFallingBarLines(
      [
        { label: '3', atMs: 1_000 },
        { label: '4', atMs: 3_000 },
        // Not come in yet, and gone already.
        { label: '5', atMs: 4_000 },
        { label: '2', atMs: 999 },
      ],
      1_000,
      3_000,
    );

    expect(lines.map(({ label, at }) => [label, Number(at.toFixed(3))])).toEqual([
      ['3', 1],
      ['4', 0.333],
    ]);
  });

  it('paints a line across the lane under the notes, with the number of its bar at its left', () => {
    const { surface: lane, recorder } = surface(300, 300);

    paintTheLane(
      lane,
      { notes: [{ midi: 60, shade: 'heard', top: 0, bottom: 0.5 }], barLines: [{ label: '12', at: 0.5 }], ruling: [] },
      new Map([[60, { left: 100, width: 20 }]]),
      INKS,
      1,
    );

    expect(recorder.font).toBe('12px serif');
    expect(
      recorder.marks.map(({ how, ink, x, y, wide, tall, words, dashes }) => [how, ink, x, y, wide, tall, words, dashes]),
    ).toEqual([
      // Broken, so as not to be taken for a line of the staff under it.
      ['stroke', 'line', 0, 149, 300, 0, undefined, [6, 4]],
      ['text', 'line', 4, 147, 0, 0, '12', undefined],
      // And the notes whole-edged over it.
      ['fill', 'heard', 101, 0, 18, 150, undefined, undefined],
      ['stroke', 'edge', 101, 0, 18, 150, undefined, []],
    ]);
  });
});

describe('the ruler at the sides of the lane', () => {
  it('stands each beat and division where it falls, leaving the bar line to the bar', () => {
    const lines = theFallingRuling(
      [
        { weight: 'downbeat', atMs: 1_000 },
        { weight: 'division', atMs: 1_500 },
        { weight: 'beat', atMs: 2_000 },
        // Not come in yet, and gone already.
        { weight: 'beat', atMs: 4_000 },
        { weight: 'division', atMs: 999 },
      ],
      1_000,
      3_000,
    );

    expect(lines.map(({ weight, at }) => [weight, Number(at.toFixed(3))])).toEqual([
      ['division', 0.833],
      ['beat', 0.667],
    ]);
  });

  it('rules a beat longer than a division, at both sides, under the bar lines and the notes', () => {
    const { surface: lane, recorder } = surface(300, 300);

    paintTheLane(
      lane,
      {
        notes: [{ midi: 60, shade: 'heard', top: 0, bottom: 0.5 }],
        barLines: [{ label: '12', at: 0.25 }],
        ruling: [
          { weight: 'beat', at: 0.5 },
          { weight: 'division', at: 0.75 },
        ],
      },
      new Map([[60, { left: 100, width: 20 }]]),
      INKS,
      1,
    );

    expect(recorder.marks.map(({ how, ink, x, y, wide, tall }) => [how, ink, x, y, wide, tall])).toEqual([
      ['fill', 'line', 0, 149, 18, 2],
      ['fill', 'line', 282, 149, 18, 2],
      ['fill', 'line', 0, 224.5, 9, 1],
      ['fill', 'line', 291, 224.5, 9, 1],
      ['stroke', 'line', 0, 74, 300, 0],
      ['text', 'line', 4, 72, 0, 0],
      ['fill', 'heard', 101, 0, 18, 150],
      ['stroke', 'edge', 101, 0, 18, 150],
    ]);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  paintTheFallingPedal,
  paintTheLane,
  theFallingBarLines,
  theFallingNotes,
  theFallingPedal,
  theFallingRuling,
  type FallingNote,
  type LaneInks,
  type LaneNote,
} from '../../src/ui/fallingNotes.js';
import type { KeyPlace } from '../../src/ui/replayKeys.js';
import { withNoAlpha } from '../../src/ui/rollPainter.js';
import { surface } from '../support/recordingCanvas.js';

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

describe('the pedal falling onto its mark', () => {
  it('lands the foot of a press on the mark as the pedal goes down, and takes it on down past it', () => {
    const shown = theFallingPedal(
      [
        // Down a second ago, and up a second and a half from now.
        { fromMs: 0, untilMs: 2_500 },
        { fromMs: 2_500, untilMs: 3_100 },
        { fromMs: 3_500, untilMs: Number.POSITIVE_INFINITY },
        // Up already, and still to come.
        { fromMs: 0, untilMs: 1_000 },
        { fromMs: 4_000, untilMs: 5_000 },
      ],
      1_000,
      3_000,
    );

    expect(shown.map((press) => [Number(press.top.toFixed(3)), Number(press.foot.toFixed(3))])).toEqual([
      [0.5, 1.333],
      [0.3, 0.5],
      [0, 0.167],
    ]);
  });

  it('paints a press whole at its foot and faded above, a change of pedal as two', () => {
    const { surface: column, recorder } = surface(56, 200);

    paintTheFallingPedal(
      column,
      [
        // Short enough to be seen whole, ending where the next begins.
        { top: 0.25, foot: 0.5 },
        { top: 0, foot: 0.8 },
      ],
      INKS,
      1,
    );

    const pills = recorder.inked('heard');
    expect(pills.map(({ x, y, wide, tall }) => [x, y, wide, tall])).toEqual([
      [12, 51, 32, 48],
      // Long: seen for its foot and the fade over it, not up to its top.
      [12, 87, 32, 72],
    ]);
    // Whole for its foot, and to nothing above that.
    expect(pills[1]?.fade).toEqual({
      fromY: 159,
      toY: 87,
      stops: [
        [0, 'heard'],
        [1 / 3, 'heard'],
        [1, 'rgba(0, 0, 0, 0)'],
      ],
    });
    // Edged, as a note is, and the edge fading with it.
    expect(recorder.inked('edge').map((edge) => edge.fade?.toY)).toEqual([27, 87]);
  });

  it('leaves room to see a change of pedal between two presses end to end', () => {
    const { surface: column, recorder } = surface(56, 200);

    paintTheFallingPedal(
      column,
      [
        { top: 0.25, foot: 0.5 },
        { top: 0.5, foot: 0.75 },
      ],
      INKS,
      1,
    );

    const [upper, lower] = recorder.inked('heard');
    expect((lower?.y ?? 0) - ((upper?.y ?? 0) + (upper?.tall ?? 0))).toBe(2);
  });

  it('takes a press on down into the mark once the pedal is down, and is gone once its fade has passed', () => {
    const { surface: column, recorder } = surface(56, 200);

    paintTheFallingPedal(
      column,
      [
        // Down a moment ago: its foot is past the mark, cut off square.
        { top: 0, foot: 1.2 },
        // Down long enough for all of it that is painted to have gone in.
        { top: 0, foot: 1.5 },
      ],
      INKS,
      1,
    );

    expect(recorder.inked('heard').map(({ y, tall, corners }) => [y, tall, corners])).toEqual([
      [167, 33, [16, 16, 0, 0]],
    ]);
  });

  it('paints the shortest press tall enough to see', () => {
    const { surface: column, recorder } = surface(56, 200);

    paintTheFallingPedal(column, [{ top: 0.999, foot: 1 }], INKS, 1);

    expect(recorder.inked('heard').map(({ y, tall }) => [y, tall])).toEqual([[197, 2]]);
  });

  it('fades an ink to the same colour unseen, not to a transparent black', () => {
    expect(withNoAlpha('rgb(37, 99, 235)')).toBe('rgba(37, 99, 235, 0)');
    expect(withNoAlpha('rgba(15, 23, 42, 0.7)')).toBe('rgba(15, 23, 42, 0)');
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

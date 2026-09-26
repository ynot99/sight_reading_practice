import { describe, expect, it } from 'vitest';
import { KEPT_EACH_MS, RollScroller, speedOf } from '../../src/ui/rollScroller.js';

/** A view of 400 by 200 on a drawing of 2000 by 500. */
function scroller(): RollScroller {
  const scrolled = new RollScroller();
  scrolled.size({ widePx: 400, tallPx: 200 }, { widePx: 2000, tallPx: 500 });
  return scrolled;
}

describe('where the MIDI viewer is scrolled to', () => {
  it('goes where it is put, and no further than the drawing', () => {
    const scrolled = scroller();

    expect(scrolled.to(300, 100)).toBe(true);
    expect([scrolled.x, scrolled.y]).toEqual([300, 100]);

    scrolled.to(5000, -40);
    // The last view's worth of the drawing, and its top.
    expect([scrolled.x, scrolled.y]).toEqual([1600, 0]);
    expect(scrolled.by(0, 0)).toBe(false);
  });

  it('stays where it is when asked to go nowhere in particular', () => {
    const scrolled = scroller();
    scrolled.to(300, 100);

    expect(scrolled.by(Number.NaN, 10)).toBe(false);
    expect(scrolled.to(Number.POSITIVE_INFINITY, 0)).toBe(false);
    expect([scrolled.x, scrolled.y]).toEqual([300, 100]);
  });

  it('stays still across a drawing no bigger than the view', () => {
    const scrolled = new RollScroller();
    scrolled.size({ widePx: 400, tallPx: 200 }, { widePx: 300, tallPx: 200 });

    expect(scrolled.by(50, 50)).toBe(false);
    expect([scrolled.x, scrolled.y]).toEqual([0, 0]);
  });

  it('comes back inside a drawing that has shrunk under it', () => {
    // A zoom out, with the view at the end of the run.
    const scrolled = scroller();
    scrolled.to(1600, 0);

    expect(scrolled.size({ widePx: 400, tallPx: 200 }, { widePx: 1000, tallPx: 500 })).toBe(true);
    expect(scrolled.x).toBe(600);
  });
});

describe('a fling', () => {
  it('goes on as far as its speed would carry it, slowing as a scroll view does', () => {
    const scrolled = scroller();
    scrolled.fling(1, 0);

    // A second, and the rest of it: a speed that keeps this share of itself
    // each millisecond covers speed / -ln(share) in all.
    scrolled.step(1000);
    const aSecondIn = scrolled.x;
    scrolled.step(60_000);

    expect(aSecondIn).toBeCloseTo((1 - KEPT_EACH_MS ** 1000) / -Math.log(KEPT_EACH_MS), 6);
    expect(scrolled.x).toBeCloseTo(1 / -Math.log(KEPT_EACH_MS), 0);
    expect(scrolled.flinging).toBe(false);
  });

  it('goes as far however often the frames come', () => {
    const everyFrame = scroller();
    const everyOther = scroller();
    everyFrame.fling(1.5, 0);
    everyOther.fling(1.5, 0);

    for (let frame = 0; frame < 30; frame += 1) {
      everyFrame.step(16);
      if (frame % 2 === 1) {
        everyOther.step(32);
      }
    }

    expect(everyOther.x).toBeCloseTo(everyFrame.x, 6);
  });

  it('stops against the end of the drawing, and only that way', () => {
    const scrolled = scroller();
    scrolled.to(1590, 100);
    scrolled.fling(3, 0.2);

    scrolled.step(16);

    expect(scrolled.x).toBe(1600);
    // Still going down, which has room.
    expect(scrolled.flinging).toBe(true);
    const was = scrolled.y;
    scrolled.step(16);
    expect(scrolled.x).toBe(1600);
    expect(scrolled.y).toBeGreaterThan(was);
  });

  it('is over once it has run into the end of the drawing', () => {
    const scrolled = scroller();
    scrolled.to(1590, 100);
    scrolled.fling(3, 0);

    scrolled.step(16);

    expect(scrolled.flinging).toBe(false);
  });

  it('is stopped by a hand putting the view somewhere, and too slow to go at all is no fling', () => {
    const scrolled = scroller();
    scrolled.fling(2, 0);
    scrolled.by(10, 0);
    expect(scrolled.flinging).toBe(false);

    scrolled.fling(0.01, 0);
    expect(scrolled.flinging).toBe(false);
  });

  it('goes no faster than a hand can mean, however hard it was thrown', () => {
    const hard = scroller();
    const harder = scroller();
    hard.fling(8, 0);
    harder.fling(80, 0);

    hard.step(16);
    harder.step(16);

    expect(harder.x).toBe(hard.x);
  });
});

describe('how fast a finger was going as it let go', () => {
  it('reads its last tenth of a second', () => {
    const trail = [
      { atMs: 0, x: 0, y: 0 },
      { atMs: 100, x: 100, y: 0 },
      { atMs: 150, x: 200, y: 10 },
      { atMs: 200, x: 300, y: 20 },
    ];

    expect(speedOf(trail, 205)).toEqual({ x: 2, y: 0.2 });
  });

  it('says it was not thrown where it stood still before letting go', () => {
    const trail = [
      { atMs: 0, x: 0, y: 0 },
      { atMs: 50, x: 100, y: 0 },
    ];

    expect(speedOf(trail, 200)).toEqual({ x: 0, y: 0 });
    expect(speedOf([], 0)).toEqual({ x: 0, y: 0 });
    expect(speedOf([{ atMs: 10, x: 5, y: 5 }], 12)).toEqual({ x: 0, y: 0 });
  });
});

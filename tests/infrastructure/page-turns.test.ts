import { describe, expect, it } from 'vitest';
import {
  overflowBelow,
  swipeDirection,
  visibleHeightOf,
} from '../../src/infrastructure/rendering/pageTurns.js';

describe('how much of the frame the reader can see', () => {
  it('takes the part inside the screen rather than the whole frame', () => {
    // A score frame is given a minimum of one screen and then grows to
    // whatever is engraved in it, so on a long piece its height *is* the
    // length of the piece. Asked how tall the window was, it answered with
    // the whole thing - which cuts the column into one page and leaves a
    // turn nowhere to go.
    expect(visibleHeightOf({ top: 0, bottom: 4_000 }, 800)).toBe(800);
  });

  it('stops at the top of the screen for a frame scrolled partly off it', () => {
    expect(visibleHeightOf({ top: -300, bottom: 4_000 }, 800)).toBe(800);
    expect(visibleHeightOf({ top: 200, bottom: 4_000 }, 800)).toBe(600);
  });

  it('takes a frame that fits at its own height', () => {
    expect(visibleHeightOf({ top: 100, bottom: 500 }, 800)).toBe(400);
  });

  it('falls back to the frame when there is no screen to measure', () => {
    expect(visibleHeightOf({ top: 0, bottom: 400 }, 0)).toBe(400);
  });

  it('is nothing at all for a frame scrolled right off the screen', () => {
    expect(visibleHeightOf({ top: 900, bottom: 1_200 }, 800)).toBe(0);
  });
});

describe('what the engraver drew past the page it was given', () => {
  it('is nothing when the drawing sits inside the page', () => {
    expect(overflowBelow({ y: 7, height: 600 }, 777)).toBe(0);
    expect(overflowBelow({ y: 0, height: 777 }, 777)).toBe(0);
  });

  it('measures from the top of the drawing, not from the top of the page', () => {
    // The music starts a little way down the page, and that margin is part of
    // what has to fit: a system pushed past the bottom is clipped by the
    // page's own edge, which is why this is measured at all.
    expect(overflowBelow({ y: 7, height: 802 }, 777)).toBe(32);
  });

  it('answers nothing for a page nothing has been drawn on', () => {
    expect(overflowBelow({ y: 0, height: 0 }, 777)).toBe(0);
  });
});

describe('reading a swipe', () => {
  it('turns forward when the page is dragged to the left', () => {
    // The way every reader has held a book.
    expect(swipeDirection({ x: 300, y: 100 }, { x: 100, y: 110 })).toBe(1);
    expect(swipeDirection({ x: 100, y: 100 }, { x: 300, y: 110 })).toBe(-1);
  });

  it('ignores a finger that barely moved', () => {
    // A reader steadying the tablet is not asking for the next page.
    expect(swipeDirection({ x: 300, y: 100 }, { x: 270, y: 100 })).toBe(0);
  });

  it('ignores a finger that was mostly going down the page', () => {
    // They are trying to look at the staff below, which is a scroll.
    expect(swipeDirection({ x: 300, y: 100 }, { x: 200, y: 300 })).toBe(0);
  });
});

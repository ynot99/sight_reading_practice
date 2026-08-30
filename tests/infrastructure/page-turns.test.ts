import { describe, expect, it } from 'vitest';
import type { DrawnMeasure } from '../../src/infrastructure/rendering/passageBrackets.js';
import {
  pageContaining,
  pageOffsetFor,
  pagesOf,
  scrollTopFor,
  swipeDirection,
  systemsOf,
  visibleHeightOf,
  type SystemBand,
} from '../../src/infrastructure/rendering/pageTurns.js';

/** Systems a hundred tall, two hundred apart. */
function bands(count: number, height = 100, gap = 200): SystemBand[] {
  return Array.from({ length: count }, (_, at) => ({
    top: at * gap,
    bottom: at * gap + height,
  }));
}

describe('finding the systems in what was drawn', () => {
  it('takes one band per line, however many bars are on it', () => {
    const measures: DrawnMeasure[] = [
      { measureIndex: 0, left: 0, right: 100, top: 20, bottom: 120 },
      { measureIndex: 1, left: 100, right: 200, top: 20, bottom: 120 },
      { measureIndex: 2, left: 0, right: 100, top: 220, bottom: 320 },
    ];

    expect(systemsOf(measures)).toEqual([
      { top: 20, bottom: 120 },
      { top: 220, bottom: 320 },
    ]);
  });

  it('reads them top to bottom whatever order the bars came in', () => {
    const measures: DrawnMeasure[] = [
      { measureIndex: 2, left: 0, right: 100, top: 220, bottom: 320 },
      { measureIndex: 0, left: 0, right: 100, top: 20, bottom: 120 },
    ];

    expect(systemsOf(measures).map((band) => band.top)).toEqual([20, 220]);
  });

  it('has nothing to say about an empty page', () => {
    expect(systemsOf([])).toEqual([]);
  });
});

describe('cutting the column into pages', () => {
  it('fits as many whole systems as the window holds', () => {
    // Three systems span 0 to 500; a window of 520 takes all three.
    expect(pagesOf(bands(3), 520)).toEqual([{ top: 0, bottom: 500, systems: 3 }]);
  });

  it('starts a new page rather than splitting a system', () => {
    // A page that ended halfway down a stave would ask the reader to turn it
    // mid-bar, which is the one thing a page turn must never do.
    const pages = pagesOf(bands(4), 350);

    expect(pages).toEqual([
      { top: 0, bottom: 300, systems: 2 },
      { top: 400, bottom: 700, systems: 2 },
    ]);
  });

  it('gives a system too tall for the window a page of its own', () => {
    // Which is what happens when the reader has zoomed a long way in. It is
    // the best that can be done, and better than a system cut in half.
    const pages = pagesOf(bands(2, 400), 200);

    expect(pages).toHaveLength(2);
    expect(pages[0]?.systems).toBe(1);
  });

  it('covers everything, in order, with no overlap', () => {
    const pages = pagesOf(bands(7), 350);

    expect(pages.reduce((total, page) => total + page.systems, 0)).toBe(7);
    for (const [at, page] of pages.entries()) {
      const next = pages[at + 1];
      expect(page.bottom).toBeGreaterThanOrEqual(page.top);
      if (next !== undefined) {
        expect(next.top).toBeGreaterThan(page.bottom);
      }
    }
  });

  it('is one page when there is no window to fit anything into', () => {
    // A page measured before the browser has laid anything out. One page
    // holding the piece is the honest answer, and it is what the reader had
    // before any of this.
    expect(pagesOf(bands(4), 0)).toEqual([{ top: 0, bottom: 700, systems: 4 }]);
  });

  it('has no pages for a score with nothing on it', () => {
    expect(pagesOf([], 500)).toEqual([]);
  });
});

describe('which page a point is on', () => {
  const pages = pagesOf(bands(6), 350);

  it('finds the page holding it', () => {
    expect(pageContaining(pages, 50)).toBe(0);
    expect(pageContaining(pages, 450)).toBe(1);
  });

  it('gives the gap between two pages to the one below it', () => {
    // There is always an answer to "which page do I turn to".
    expect(pageContaining(pages, 350)).toBe(1);
  });

  it('clamps past either end rather than saying nothing', () => {
    expect(pageContaining(pages, -500)).toBe(0);
    expect(pageContaining(pages, 99_999)).toBe(pages.length - 1);
    expect(pageContaining([], 10)).toBe(0);
  });
});

describe('scrolling to a page', () => {
  it('scales the engraving to the size it is shown at', () => {
    expect(scrollTopFor({ top: 400, bottom: 700, systems: 2 }, 0.5, 0)).toBe(200);
  });

  it('leaves a margin, so the top stave is not against the edge', () => {
    expect(scrollTopFor({ top: 400, bottom: 700, systems: 2 }, 1, 8)).toBe(392);
    // Never past the top of the score.
    expect(scrollTopFor({ top: 0, bottom: 300, systems: 2 }, 1, 8)).toBe(0);
  });

  it('says nothing useful about a page that is not there', () => {
    expect(scrollTopFor(undefined, 1)).toBe(0);
    expect(scrollTopFor({ top: 400, bottom: 700, systems: 1 }, 0)).toBe(0);
  });
});

describe('moving the engraving for a page', () => {
  const last = { top: 900, bottom: 1_400, systems: 3 };

  it('pulls the last page back so it ends where the music does', () => {
    // A scrollbar gives this for nothing - there is no scrolling past the
    // bottom - and moving the drawing has to be told. Without it the final
    // turn carries the last system to the top of the screen and leaves the
    // rest blank, which is what a reader sees as "page two is empty".
    expect(pageOffsetFor(last, 1, 1_400, 700)).toBe(700);
  });

  it('leaves a page that fits where it was asked for', () => {
    expect(pageOffsetFor({ top: 300, bottom: 800, systems: 3 }, 1, 4_000, 700, 8)).toBe(292);
  });

  it('never moves the first page at all', () => {
    expect(pageOffsetFor({ top: 0, bottom: 700, systems: 4 }, 1, 4_000, 700)).toBe(0);
    // Nor moves anything when the whole piece already fits.
    expect(pageOffsetFor(last, 1, 600, 700)).toBe(0);
  });

  it('says what it can when the window has not been measured', () => {
    expect(pageOffsetFor(last, 1, 1_400, 0, 0)).toBe(900);
  });
});

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

// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import { longExercise } from '../support/fixtures.js';
import { createScoreContainer, installCanvasStub } from '../support/osmdHarness.js';

/**
 * A window with a real size, which jsdom does not otherwise provide.
 *
 * Everything about how the column is cut into pages is arithmetic and tested
 * as such. What cannot be checked any other way is whether the arithmetic is
 * being fed the sizes it needs: an engraving whose height is read as zero
 * pages into a single page and the feature quietly does nothing at all.
 */
function withLayout(container: HTMLElement, windowHeight: number): HTMLElement {
  // The frame that clips and the box that scrolls inside it, which is the
  // arrangement the real page has - and they are not the same height.
  const frame = document.createElement('div');
  frame.className = 'score';
  const scroller = document.createElement('div');
  scroller.className = 'score__scroll';
  container.replaceWith(frame);
  frame.append(scroller);
  scroller.append(container);
  // Taller than the screen, which is what a score frame does: it is given a
  // minimum of one screen and then grows to whatever is engraved in it. The
  // screen is `windowHeight`; the frame runs well past the bottom of it.
  frame.getBoundingClientRect = (() => {
    // Follows what the renderer writes on it, so a test can see the frame
    // being cut down to the page it is showing.
    const written = Number.parseFloat(frame.style.height);
    const height = Number.isFinite(written) ? written : 99_999;
    return { left: 0, top: 0, bottom: height, width: 900, height };
  }) as Element['getBoundingClientRect'];
  scroller.getBoundingClientRect = (() =>
    ({ left: 0, top: 0, bottom: 99_999, width: 900, height: 99_999 })) as Element['getBoundingClientRect'];
  Object.defineProperty(window, 'innerHeight', { value: windowHeight, configurable: true });

  const svg = container.querySelector('svg');
  const height = Number.parseFloat(svg?.getAttribute('height') ?? '0');
  if (svg !== null) {
    // Shown at exactly the size it was drawn at, so the scale is one and the
    // numbers in the test are the engraver's own.
    svg.getBoundingClientRect = (() =>
      ({ left: 0, top: 0, width: 900, height })) as Element['getBoundingClientRect'];
  }
  return scroller;
}

/** How far up the engraving has been moved, in pixels. */
function movedBy(container: HTMLElement): number {
  const match = /translateY\((-?[\d.]+)px\)/.exec(container.style.transform);
  return match === null ? 0 : -Number.parseFloat(match[1] ?? '0');
}

describe('reading a real engraving as pages', () => {
  let container: HTMLElement;
  let renderer: OsmdScoreRenderer;
  let scroller: HTMLElement;
  let frame: HTMLElement;

  beforeAll(() => {
    installCanvasStub();
  });

  beforeEach(async () => {
    document.body.replaceChildren();
    container = createScoreContainer();
    renderer = new OsmdScoreRenderer(container, { zoom: 1 });
    // Sixteen bars is several systems at this width, and a short window makes
    // several pages of them.
    await renderer.load(new MusicXmlSerializer().serialize(longExercise({ bars: 16 })));
    scroller = withLayout(container, 200);
    frame = scroller.parentElement as HTMLElement;
  });

  it('has no pages at all until it is asked for them', () => {
    // Not "one long page": the difference matters to anything that would
    // otherwise say "page 1 of 1" at a reader who never asked for pages.
    expect(renderer.pages.count).toBe(0);
  });

  it('cuts the column into more than one page', () => {
    renderer.setPaged(true);

    expect(renderer.pages.count).toBeGreaterThan(1);
    expect(renderer.pages.at).toBe(0);
  });

  it('moves the engraving rather than re-engraving anything', () => {
    // Scrolling was the first attempt and it did nothing at all: which
    // element actually scrolls depends on the layout the score is in, and it
    // was not the one being asked. Moving the drawing cannot miss.
    renderer.setPaged(true);
    const engravings = container.querySelectorAll('svg').length;

    renderer.turnPages(1);

    expect(renderer.pages.at).toBe(1);
    expect(movedBy(container)).toBeGreaterThan(0);
    // The column is untouched: a page is a window onto it, which is what
    // keeps the cursor, the marks and the markers all still true.
    expect(container.querySelectorAll('svg')).toHaveLength(engravings);
  });

  it('puts the engraving back when pages are turned off', () => {
    renderer.setPaged(true);
    renderer.turnPages(1);
    expect(movedBy(container)).toBeGreaterThan(0);

    renderer.setPaged(false);

    expect(movedBy(container)).toBe(0);
  });

  it('stops at either end instead of running off', () => {
    renderer.setPaged(true);
    renderer.turnPages(-1);
    expect(renderer.pages.at).toBe(0);

    renderer.turnPages(999);
    expect(renderer.pages.at).toBe(renderer.pages.count - 1);
  });

  it('turns to the page a bar is on, and stays put when it is already there', () => {
    renderer.setPaged(true);
    const turns: number[] = [];
    renderer.onPagesChanged((state) => turns.push(state.at));

    renderer.showMeasure(15);
    const reached = renderer.pages.at;
    expect(reached).toBeGreaterThan(0);

    renderer.showMeasure(15);
    // Told twice about the same bar, it turns once: a page turn is for
    // looking at one thing until it is finished with.
    expect(turns).toEqual([reached]);
  });

  it('shows a page and nothing of the next one', () => {
    // The difference between a page and a view onto a scroll. Left at the
    // height of the screen, the frame goes on past the last system of the
    // page and the first system of the next peers in at the bottom -
    // visible, unreadable, and the thing a page turn is for getting rid of.
    renderer.setPaged(true);
    expect(renderer.pages.count).toBeGreaterThan(1);

    const shown = frame.getBoundingClientRect().height;

    expect(shown).toBeGreaterThan(0);
    // Cut down to its own systems rather than left at the screen's height.
    expect(shown).toBeLessThanOrEqual(200);
  });

  it('gives the frame back its height when pages are turned off', () => {
    renderer.setPaged(true);
    renderer.setPaged(false);

    expect(frame.style.height).toBe('');
  });

  it('does nothing to a scrolling score', () => {
    renderer.showMeasure(15);

    expect(movedBy(container)).toBe(0);
  });

  it('gives the scroll back when pages are turned off', () => {
    renderer.setPaged(true);
    renderer.turnPages(1);

    renderer.setPaged(false);

    expect(scroller.dataset['paged']).toBe('false');
    expect(renderer.pages.count).toBe(0);
  });
});

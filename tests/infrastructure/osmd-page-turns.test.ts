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
  const scroller = document.createElement('div');
  scroller.className = 'score__scroll';
  container.replaceWith(scroller);
  scroller.append(container);
  Object.defineProperty(scroller, 'clientHeight', { value: windowHeight, configurable: true });
  scroller.scrollTo = ((options: ScrollToOptions) => {
    Object.defineProperty(scroller, 'scrollTop', {
      value: options.top ?? 0,
      configurable: true,
      writable: true,
    });
  }) as HTMLElement['scrollTo'];

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

describe('reading a real engraving as pages', () => {
  let container: HTMLElement;
  let renderer: OsmdScoreRenderer;
  let scroller: HTMLElement;

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

  it('scrolls to a page rather than re-engraving anything', () => {
    renderer.setPaged(true);
    const engravings = container.querySelectorAll('svg').length;

    renderer.turnPages(1);

    expect(renderer.pages.at).toBe(1);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    // The column is untouched: a page is a window onto it, which is what
    // keeps the cursor, the marks and the markers all still true.
    expect(container.querySelectorAll('svg')).toHaveLength(engravings);
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

  it('does nothing to a scrolling score', () => {
    renderer.showMeasure(15);

    expect(scroller.scrollTop ?? 0).toBe(0);
  });

  it('gives the scroll back when pages are turned off', () => {
    renderer.setPaged(true);
    renderer.turnPages(1);

    renderer.setPaged(false);

    expect(scroller.dataset['paged']).toBe('false');
    expect(renderer.pages.count).toBe(0);
  });
});

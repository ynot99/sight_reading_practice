// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import { longExercise } from '../support/fixtures.js';
import { createScoreContainer, installCanvasStub } from '../support/osmdHarness.js';

/** How often the drawing is searched for one kind of thing, counted as it happens. */
function countSearches(selector: string): { readonly count: () => number; readonly stop: () => void } {
  const searched = Element.prototype.querySelectorAll;
  let count = 0;
  Element.prototype.querySelectorAll = function (this: Element, wanted: string) {
    if (wanted === selector) {
      count += 1;
    }
    return searched.call(this, wanted);
  } as typeof Element.prototype.querySelectorAll;
  return {
    count: () => count,
    stop: () => {
      Element.prototype.querySelectorAll = searched;
    },
  };
}

/** How often a page is searched for one of our own layers, counted as it happens. */
function countLayerSearches(): { readonly count: () => number; readonly stop: () => void } {
  const searched = Element.prototype.querySelector;
  let count = 0;
  Element.prototype.querySelector = function (this: Element, wanted: string) {
    if (wanted === 'g.hand-switches' || wanted === 'g.passage-markers') {
      count += 1;
    }
    return searched.call(this, wanted);
  } as typeof Element.prototype.querySelector;
  return {
    count: () => count,
    stop: () => {
      Element.prototype.querySelector = searched;
    },
  };
}

describe('reading the drawing once for each time it is drawn', () => {
  let stop: (() => void) | null = null;

  beforeAll(() => {
    installCanvasStub();
  });

  afterEach(() => {
    stop?.();
    stop = null;
  });

  async function engraved(): Promise<OsmdScoreRenderer> {
    const renderer = new OsmdScoreRenderer(createScoreContainer(), { zoom: 1 });
    await renderer.load(new MusicXmlSerializer().serialize(longExercise({ bars: 16 })));
    return renderer;
  }

  it('reads where the staves are once, however often the hands are painted', async () => {
    // The hands and the passage are painted on every start of a run or a
    // playback, twice. Each painting walked every staff line on every page and
    // asked the document for its ends one attribute at a time, and on a long
    // score that was a quarter of a second of every start - found with the
    // browser's own profiler in a trace he recorded.
    const renderer = await engraved();
    renderer.showHands([1, 2]);
    const searches = countSearches('.staffline');
    stop = searches.stop;

    renderer.showHands([1]);
    renderer.showHands([2]);
    renderer.showHands([1, 2]);

    expect(searches.count()).toBe(0);
  });

  it('reads them again when the pages are drawn again', async () => {
    // A zoom draws every page afresh, and staves read off the old pages would
    // put the switches where the staves used to be.
    const renderer = await engraved();
    renderer.showHands([1, 2]);
    const searches = countSearches('.staffline');
    stop = searches.stop;

    // Drawing again paints the hands itself, so the fresh reading happens in
    // here - off the new pages, not the old ones.
    renderer.refresh();
    renderer.showHands([1, 2]);

    expect(searches.count()).toBeGreaterThan(0);
  });

  it('finds the layers it paints the hands and the passage into without searching', async () => {
    // Both are painted on every start, on every page, and each page was
    // searched for its layer by class - a walk of the whole drawing, since the
    // layer is appended last and the search never ends early.
    const renderer = await engraved();
    renderer.showHands([1, 2]);
    renderer.showStart(0);
    const searches = countLayerSearches();
    stop = searches.stop;

    renderer.showHands([1]);
    renderer.showStart(1);

    expect(searches.count()).toBe(0);
    // And still one layer of each to a page, however often they are painted.
    for (const page of document.querySelectorAll('svg')) {
      expect(page.querySelectorAll(':scope > g.hand-switches').length).toBeLessThanOrEqual(1);
      expect(page.querySelectorAll(':scope > g.passage-markers').length).toBeLessThanOrEqual(1);
    }
  });

  it('reads the numbers on a page once, not once for every bar on it', async () => {
    // Each marked bar searched the whole page's text for its number and read
    // every piece of it, attribute by attribute: the bars times the text, all
    // through the document.
    const renderer = await engraved();
    const pages = document.querySelectorAll('svg').length;
    const searches = countSearches('text');
    stop = searches.stop;

    renderer.showStart(0);
    const first = searches.count();
    renderer.showStart(1);

    // No more than one search of each page, and none at all the second time.
    expect(first).toBeLessThanOrEqual(pages);
    expect(searches.count()).toBe(first);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import type { DrawnMeasure } from '../../src/infrastructure/rendering/passageBrackets.js';
import { longExercise } from '../support/fixtures.js';
import { createScoreContainer, installCanvasStub, withLayout } from '../support/osmdHarness.js';

/** The pages the engraver made, drawn or not. */
function sheets(container: HTMLElement): SVGSVGElement[] {
  return [...container.querySelectorAll('svg')];
}

/** Which pages have anything drawn on them. */
function drawnPages(container: HTMLElement): number[] {
  return sheets(container)
    .map((sheet, at) => (sheet.childElementCount > 0 ? at : -1))
    .filter((at) => at >= 0);
}

/** Where the engraver put each bar, which the renderer keeps to itself. */
function measuresOf(renderer: OsmdScoreRenderer): DrawnMeasure[] {
  return (renderer as unknown as { measures: DrawnMeasure[] }).measures;
}

/** The page each step was laid out on, which the renderer keeps to itself. */
function stepPages(renderer: OsmdScoreRenderer): Map<number, number> {
  return (renderer as unknown as { stepPage: Map<number, number> }).stepPage;
}

/** The first step laid out on a page. */
function firstStepOn(renderer: OsmdScoreRenderer, page: number): number {
  const steps = [...stepPages(renderer)].filter(([, on]) => on === page).map(([step]) => step);
  return Math.min(...steps);
}

/** The first bar laid out on a page. */
function firstBarOn(renderer: OsmdScoreRenderer, page: number): DrawnMeasure {
  const bar = measuresOf(renderer).find((measure) => measure.page === page);
  if (bar === undefined) {
    throw new Error(`no bar on page ${page}`);
  }
  return bar;
}

/** Every height the engraver was asked to lay a page out to. */
function spyOnPageSizes(renderer: OsmdScoreRenderer): number[] {
  const engraver = (renderer as unknown as {
    osmd: { setCustomPageFormat: (width: number, height: number) => void };
  }).osmd;
  const asked: number[] = [];
  const original = engraver.setCustomPageFormat.bind(engraver);
  engraver.setCustomPageFormat = (width: number, height: number): void => {
    asked.push(height);
    original(width, height);
  };
  return asked;
}

/** The top staff line printed on a page, read out of its drawing. */
function topLineOn(sheet: SVGSVGElement | undefined): number {
  const ys: number[] = [];
  for (const path of sheet?.querySelectorAll('.staffline path') ?? []) {
    const match = /^M[\d.]+ ([\d.]+)L[\d.]+ ([\d.]+)$/.exec(path.getAttribute('d') ?? '');
    if (match !== null && match[1] === match[2]) {
      ys.push(Number.parseFloat(match[1] ?? ''));
    }
  }
  return Math.min(...ys);
}

/**
 * Drawing only the pages near the reader.
 *
 * Every page is laid out and only a few are drawn, because every page drawn
 * at once is more than the iPad will hold for a long piece. What is drawn is
 * whatever a reader can reach in one move, and everything of ours that
 * belongs to a page is painted onto it when it is drawn.
 */
describe('drawing only the pages near the reader', { timeout: 30_000 }, () => {
  let container: HTMLElement;
  let renderer: OsmdScoreRenderer;

  beforeAll(() => {
    installCanvasStub();
  });

  afterEach(() => {
    delete (SVGSVGElement.prototype as unknown as { getBBox?: unknown }).getBBox;
    vi.restoreAllMocks();
  });

  /**
   * A clock that jumps forward by however long the test says a thing took.
   *
   * The fitting decides how much it may do by what the engraving and the
   * measuring cost, and a test cannot make the engraver slow on purpose.
   */
  function aClockThatCanBeMoved(): (ms: number) => void {
    const real = performance.now.bind(performance);
    let ahead = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => real() + ahead);
    return (ms) => {
      ahead += ms;
    };
  }

  beforeEach(async () => {
    document.body.replaceChildren();
    container = createScoreContainer();
    renderer = new OsmdScoreRenderer(container, { zoom: 1 });
    await renderer.load(new MusicXmlSerializer().serialize(longExercise({ bars: 40 })));
    withLayout(container, 260);
    renderer.setPaged(true);
    // Engraving forty bars is seconds of OSMD's own work with the rest of the
    // suite running beside it, which ten did not always cover.
  }, 60_000);

  it('draws the page being read and the one after it, and nothing on the others', () => {
    expect(renderer.pages.count).toBeGreaterThanOrEqual(6);
    // Everything of ours that could land on a far page, so that a blank page
    // is seen to stay blank: a label or a layer on it would be ours alone,
    // under ink drawn later.
    renderer.configureOverlay({ keyAt: () => KeySignature.major(0), clefAt: () => 'treble' });
    const far = firstStepOn(renderer, 4);
    renderer.showPlayed({ stepIndex: far, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });
    renderer.fadePassed(far);
    renderer.showHands([1]);
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 39 });
    renderer.showRepeatedBars([...Array(40).keys()]);

    expect(drawnPages(container)).toEqual([0, 1]);
    // Every page is still there, blank and its own size, so the count and
    // everything laid out stays what it was.
    expect(sheets(container)).toHaveLength(renderer.pages.count);
  });

  it('draws the pages around a turn and lets the ones behind go', () => {
    renderer.turnPages(3);

    // The first page stays because the marker is still on it.
    expect(drawnPages(container)).toEqual([0, 2, 3, 4]);

    renderer.turnPages(2);

    expect(drawnPages(container)).toEqual([0, 4, 5, 6]);
  });

  it('keeps the page a run starts from drawn, wherever the reader is', () => {
    // His: "не забувай що є repeat кнопка яка має швидко повернутись на старт
    // де був поставлений слайс чи курсор". A repeat goes back there, so that
    // page is never one that has to be drawn first.
    const start = firstBarOn(renderer, 3);
    renderer.showPassage({ fromMeasureIndex: start.measureIndex, toMeasureIndex: 39 });

    expect(drawnPages(container)).toContain(3);

    renderer.turnPages(6);

    expect(drawnPages(container)).toContain(3);
    expect(drawnPages(container)).not.toContain(2);
  });

  it('keeps the page the marker was moved to drawn, and the place a run begins', () => {
    renderer.showStart(firstBarOn(renderer, 5).measureIndex);

    expect(drawnPages(container)).toContain(5);

    renderer.turnPagesWithTheMusic(false);
    renderer.cursor.moveTo(firstStepOn(renderer, 3));

    // Still reading the first page: the music has gone on without turning it.
    expect(renderer.pages.at).toBe(0);
    expect(drawnPages(container)).toContain(3);
  });

  it('keeps the page the reading starts on drawn', () => {
    const from = firstStepOn(renderer, 4);

    renderer.dimUnplayed({ staves: [], from, to: from + 10 });

    expect(drawnPages(container)).toContain(4);
  });

  it('paints a page drawn later as though it had been drawn all along', () => {
    // Everything of ours is kept as the thing it is a picture of, so a page
    // drawn when it is reached is painted from that.
    renderer.configureOverlay({ keyAt: () => KeySignature.major(0), clefAt: () => 'treble' });
    const step = firstStepOn(renderer, 5);
    renderer.showPlayed({ stepIndex: step, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });
    renderer.fadePassed(step);
    renderer.showHands([1]);
    expect(drawnPages(container)).not.toContain(5);

    renderer.turnPages(5);

    const page = sheets(container)[5];
    expect(page?.querySelectorAll('.played-note').length).toBeGreaterThan(0);
    expect(page?.querySelectorAll('.note--passed').length).toBeGreaterThan(0);
    expect(page?.querySelectorAll('g.hand-switch').length).toBeGreaterThan(0);
  });

  it('measures the bars of a page drawn later by its printed lines', () => {
    // A marker stands from the top line of a system to its bottom one, and
    // those are read off the drawing - so a page drawn later is measured
    // again once it is, or its markers stand where the engraver guessed.
    const bar = firstBarOn(renderer, 4);
    renderer.showPassage({ fromMeasureIndex: bar.measureIndex, toMeasureIndex: 39 });

    renderer.turnPages(4);

    const marker = (): { y: string | null; height: string | null } => {
      const drawn = sheets(container)[4]?.querySelector('.passage-marker--start .passage-marker__bar');
      return { y: drawn?.getAttribute('y') ?? null, height: drawn?.getAttribute('height') ?? null };
    };
    const turnedTo = marker();
    expect(Number(turnedTo.y)).toBe(topLineOn(sheets(container)[4]));

    // The same page engraved while it is the one being read, so drawn by the
    // engraving itself and measured with everything else. The bottom is where
    // the engraver's own reckoning and the page part company - its box
    // reaches down round whatever hangs below the staff - and it is the same.
    renderer.refresh();

    expect(turnedTo).toEqual(marker());
  });

  it('draws only the near pages at the engraving itself, not all of them and then some go', () => {
    // The whole point: every page drawn for a moment is every page in memory
    // at once, which is the moment the iPad closes the tab.
    const engraver = (renderer as unknown as { osmd: { render: () => void } }).osmd;
    const render = engraver.render.bind(engraver);
    const drawnAtEngraving: number[][] = [];
    engraver.render = (): void => {
      render();
      drawnAtEngraving.push(drawnPages(container));
    };

    renderer.refresh();

    expect(drawnAtEngraving).toEqual([[0, 1]]);
  });

  it('finds a page’s printed numbers again each time it is drawn', async () => {
    // Read once and kept, for the page - and a page let go of and drawn
    // again is the same page with new text on it.
    const numbered = {
      ...longExercise({ bars: 40 }),
      barLabels: [...Array(40).keys()].map((at) => ({ number: at + 101, repeated: false })),
    };
    await renderer.load(new MusicXmlSerializer().serialize(numbered));
    const engraversOwn = (page: SVGSVGElement | undefined): Element[] =>
      [...(page?.querySelectorAll('text') ?? [])].filter(
        (text) =>
          /^\d+$/.test(text.textContent ?? '') &&
          !['bar-position', 'bar-printed'].includes(text.getAttribute('class') ?? '') &&
          (text as SVGTextElement).style.display !== 'none',
      );
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 39 });
    renderer.turnPages(4);
    renderer.turnPages(-4);
    renderer.turnPages(4);

    const page = sheets(container)[4];
    // Every bar is called by its place here, so none of the engraver's own
    // numbers is left standing - on the page drawn the second time too.
    expect(page?.querySelectorAll('.bar-position').length).toBeGreaterThan(0);
    expect(engraversOwn(page)).toEqual([]);
  });

  it('does not measure the pages of a piece whose engraving alone is past the budget', () => {
    // Measuring draws every page in turn, and on the longest score he has
    // that is three hundred pages drawn for a pass there is no time for.
    const moveTheClock = aClockThatCanBeMoved();
    const engraver = (renderer as unknown as { osmd: { render: () => void } }).osmd;
    const render = engraver.render.bind(engraver);
    engraver.render = (): void => {
      render();
      moveTheClock(5_000);
    };
    let measured = 0;
    (SVGSVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = function getBBox(
      this: SVGSVGElement,
    ): DOMRect {
      measured += 1;
      return { x: 0, y: 0, width: 10, height: 10 } as DOMRect;
    };

    renderer.refresh();

    expect(measured).toBe(0);
  });

  it('counts the measuring as part of what a pass costs', () => {
    // The engraving draws a page or two and the measuring draws the rest, so
    // a piece whose drawing is the dear part is given the passes its whole
    // cost affords, not the passes its engraving alone would.
    const asked = spyOnPageSizes(renderer);
    const moveTheClock = aClockThatCanBeMoved();
    (SVGSVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = function getBBox(
      this: SVGSVGElement,
    ): DOMRect {
      moveTheClock(1_000);
      const box = Number((this.getAttribute('viewBox') ?? '').split(/[\s,]+/)[3] ?? 0);
      return { x: 0, y: 0, width: 10, height: box + 50 } as DOMRect;
    };

    renderer.refresh();

    // Asked for the page once, and not again: every page spills, but a pass
    // costs seconds of measuring and there is no budget left for one.
    expect(asked).toHaveLength(1);
  });

  it('measures every page for what spills past it, and leaves only the near ones drawn', () => {
    // What spills is ink, and only a drawn page has any: so the page the
    // engraver overfilled is found only if every page is drawn to be
    // measured. One at a time, and let go again.
    const asked = spyOnPageSizes(renderer);
    const last = renderer.pages.count - 1;
    let most = 0;
    (SVGSVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox =
      function getBBox(this: SVGSVGElement): DOMRect {
        most = Math.max(most, drawnPages(container).length);
        const box = Number((this.getAttribute('viewBox') ?? '').split(/[\s,]+/)[3] ?? 0);
        const spills = this.childElementCount > 0 && sheets(container).indexOf(this) === last;
        return { x: 0, y: 0, width: 10, height: spills ? box + 50 : box - 5 } as DOMRect;
      };

    renderer.refresh();

    // Asked once, and then again shorter for the page that spilled.
    expect(asked.length).toBeGreaterThan(1);
    expect(asked[1] ?? 0).toBeLessThan(asked[0] ?? 0);
    // Never more than the near pages and the one being measured: every page
    // drawn at once, even for a moment, is what the iPad will not hold.
    expect(most).toBeLessThanOrEqual(3);
    expect(drawnPages(container)).toEqual([0, 1]);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { printedAtEachStep, type PrintedStep } from '../../src/domain/notation/printedIds.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { readThePage, type PageLayout } from '../../src/infrastructure/rendering/verovio/pageLayout.js';
import { VerovioCore } from '../../src/infrastructure/rendering/verovio/VerovioCore.js';
import { VerovioEngraver } from '../../src/infrastructure/rendering/verovio/VerovioEngraver.js';
import { VerovioScoreRenderer } from '../../src/infrastructure/rendering/verovio/VerovioScoreRenderer.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry } from '../../src/domain/model/Exercise.js';
import { bar, longExercise, p, twoBarExercise } from '../support/fixtures.js';
import { lineToThe } from '../support/verovioLine.js';

/**
 * The renderer on a page jsdom holds, drawn by Verovio itself on this thread.
 *
 * jsdom lays nothing out, so the surface has no size: the renderer lays the
 * music out on the page it uses for a surface not measured yet, 1024 by 768,
 * which is a real page and the same one every time.
 */
let core: VerovioCore;
beforeAll(async () => {
  core = await VerovioCore.start();
});

const serializer = new MusicXmlSerializer();

interface Printed {
  readonly xml: string;
  readonly steps: readonly PrintedStep[];
}

/** A score as the controller hands it over: the printing, and where each step is on it. */
function printed(exercise: Exercise): Printed {
  return { xml: serializer.serialize(exercise), steps: printedAtEachStep(buildTimeline(exercise)) };
}

const LONG = printed(longExercise({ bars: 240 }));

interface Stage {
  readonly renderer: VerovioScoreRenderer;
  readonly engraver: VerovioEngraver;
  readonly surface: HTMLElement;
  readonly scroller: HTMLElement;
}

const stages: Stage[] = [];

function aStage(): Stage {
  const scroller = document.createElement('div');
  scroller.className = 'score__scroll';
  const surface = document.createElement('div');
  surface.className = 'score__surface';
  scroller.append(surface);
  document.body.append(scroller);
  const engraver = new VerovioEngraver(lineToThe(core));
  const stage = { renderer: new VerovioScoreRenderer(surface, engraver), engraver, surface, scroller };
  stages.push(stage);
  return stage;
}

afterEach(() => {
  for (const stage of stages.splice(0)) {
    stage.renderer.dispose();
    stage.scroller.remove();
  }
});

function sheets(surface: HTMLElement): HTMLElement[] {
  return [...surface.querySelectorAll<HTMLElement>(':scope > .score__page')];
}

/** The pages the reader can see. */
function showing(surface: HTMLElement): number[] {
  return sheets(surface)
    .map((sheet, page) => (sheet.style.display === 'none' ? -1 : page))
    .filter((page) => page >= 0);
}

/** The pages that hold their drawing. */
function drawn(surface: HTMLElement): number[] {
  return sheets(surface)
    .map((sheet, page) => (sheet.querySelector('svg') === null ? -1 : page))
    .filter((page) => page >= 0);
}

function label(surface: HTMLElement, page: number): string | null {
  return sheets(surface)[page]?.querySelector('text.page-label')?.textContent ?? null;
}

async function aPagedScore(): Promise<Stage> {
  const stage = aStage();
  stage.renderer.setPaged(true);
  await stage.renderer.load(LONG.xml, LONG.steps);
  return stage;
}

describe('a score read in pages', () => {
  it('lays it out on pages the size of the window and shows the one being read', async () => {
    const { renderer, surface, scroller } = await aPagedScore();

    expect(renderer.pages.count).toBeGreaterThan(3);
    expect(sheets(surface)).toHaveLength(renderer.pages.count);
    expect(showing(surface)).toEqual([0]);
    // And says so on the box that scrolls, which is what takes its scrollbar away.
    expect(scroller.dataset['paged']).toBe('true');
  });

  it('draws the page being read and the one beside it, and no others', async () => {
    // On the Alkan every page drawn at once is more than the iPad will hold.
    const { surface } = await aPagedScore();

    expect(drawn(surface)).toEqual([0, 1]);
  });

  it('turns, drawing the pages either side of the new one and letting the far ones go', async () => {
    const { renderer, surface } = await aPagedScore();

    renderer.turnPages(2);

    expect(renderer.pages.at).toBe(2);
    expect(showing(surface)).toEqual([2]);
    await vi.waitFor(() => {
      expect(drawn(surface)).toEqual([1, 2, 3]);
    });
  });

  it('stops at either end', async () => {
    const { renderer, surface } = await aPagedScore();

    renderer.turnPages(-1);
    expect(renderer.pages.at).toBe(0);

    renderer.turnPages(999);
    expect(renderer.pages.at).toBe(renderer.pages.count - 1);
    // And the last page is the one on the screen, not none of them.
    expect(showing(surface)).toEqual([renderer.pages.count - 1]);
  });

  it('tells whoever is listening each time the page changes', async () => {
    const { renderer } = await aPagedScore();
    const heard: number[] = [];
    renderer.onPagesChanged((state) => heard.push(state.at));

    renderer.turnPages(1);
    renderer.turnPages(1);

    expect(heard).toEqual([1, 2]);
  });

  it('turns to the page a bar is on, and not when it is already on this one', async () => {
    const { renderer } = await aPagedScore();
    const heard: number[] = [];
    renderer.onPagesChanged((state) => heard.push(state.at));

    renderer.showMeasure(0);
    await new Promise((done) => setTimeout(done, 20));
    expect(renderer.pages.at).toBe(0);
    // Not even turned to itself: a reader who has looked ahead is not pulled back.
    expect(heard).toEqual([]);

    renderer.showMeasure(239);
    await vi.waitFor(() => {
      expect(renderer.pages.at).toBe(renderer.pages.count - 1);
    });
  });

  it('says in the corner of each page what the piece is and which page of it', async () => {
    const { renderer, surface } = await aPagedScore();

    expect(label(surface, 0)).toBe(`Long fixture · Page 1 of ${String(renderer.pages.count)}`);
    renderer.turnPages(1);
    await vi.waitFor(() => {
      expect(label(surface, 2)).toBe(`Long fixture · Page 3 of ${String(renderer.pages.count)}`);
    });
  });

  it('keeps room above the music for what the corner says, the same at any print', async () => {
    const { renderer, engraver } = await aPagedScore();
    const relayout = vi.spyOn(engraver, 'relayout');
    const roomAt = (shape: { readonly scale: number; readonly pageMarginTop?: number } | undefined): number =>
      ((shape?.pageMarginTop ?? 0) * (shape?.scale ?? 0)) / 100;

    renderer.setZoom(0.4);
    renderer.setZoom(2.5);

    const [small, large] = relayout.mock.calls.map(([shape]) => shape);
    expect(roomAt(small)).toBeGreaterThanOrEqual(32);
    expect(roomAt(large)).toBeGreaterThanOrEqual(32);
    expect(roomAt(large)).toBeLessThan(34);
  });

  it('goes back to the first page at the start', async () => {
    const { renderer, surface } = await aPagedScore();
    renderer.turnPages(3);

    renderer.scrollToStart();

    expect(renderer.pages.at).toBe(0);
    expect(showing(surface)).toEqual([0]);
  });

  it('opens new music at its own first page', async () => {
    const { renderer } = await aPagedScore();
    renderer.turnPages(3);

    await renderer.load(LONG.xml, LONG.steps);

    expect(renderer.pages.at).toBe(0);
  });
});

describe('a score scrolled rather than turned', () => {
  it('stands every page one above the next, with no count of them', async () => {
    const { renderer, surface, scroller } = await aPagedScore();

    renderer.setPaged(false);

    expect(showing(surface)).toHaveLength(sheets(surface).length);
    expect(renderer.pages.count).toBe(0);
    expect(scroller.dataset['paged']).toBe('false');
  });

  it('keeps every page its height, drawn or not, so the column is as long as the music', async () => {
    const { surface } = await aPagedScore();
    const heights = new Set(sheets(surface).map((sheet) => sheet.style.height));

    expect(heights.size).toBe(1);
    expect([...heights][0]).toMatch(/^\d+(\.\d+)?px$/);
  });

  it('names the piece at the top of the column only, and counts nothing', async () => {
    const { renderer, surface } = await aPagedScore();

    renderer.setPaged(false);

    expect(label(surface, 0)).toBe('Long fixture');
    expect(label(surface, 1)).toBeNull();
  });
});

describe('a layout again', () => {
  it('fits more on a page at a smaller print, and fewer at a larger', async () => {
    const { renderer } = await aPagedScore();
    const at = renderer.pages.count;

    renderer.setZoom(renderer.zoom * 0.6);
    await vi.waitFor(() => {
      expect(renderer.pages.count).toBeLessThan(at);
    });
  });

  it('keeps the reader at the bar that was at the top of their page', async () => {
    // A zoom is not a request to start again, and a page number means nothing
    // across two layouts - the bar does.
    const { renderer, surface } = await aPagedScore();
    renderer.turnPages(3);
    await vi.waitFor(() => {
      expect(drawn(surface)).toContain(3);
    });
    const top = readThePage(sheets(surface)[3]?.querySelector('svg') as SVGSVGElement).systems[0]
      ?.bars[0]?.id;

    const before = renderer.pages.count;

    renderer.setZoom(renderer.zoom * 1.4);

    // The old layout stays on the screen until the new one is ready, and it
    // holds that bar too: wait for the new one.
    await vi.waitFor(() => {
      expect(renderer.pages.count).toBeGreaterThan(before);
    });
    await vi.waitFor(() => {
      const page = sheets(surface)[renderer.pages.at]?.querySelector('svg');
      expect(page).not.toBeNull();
      const bars = readThePage(page as SVGSVGElement).systems.flatMap((system) => system.bars.map((bar) => bar.id));
      expect(bars).toContain(top);
    });
  });

  it('ends on the last zoom asked for, however quickly they came', async () => {
    const stage = await aPagedScore();
    const once = await aPagedScore();
    once.renderer.setZoom(0.5);
    await vi.waitFor(() => {
      expect(once.renderer.zoom).toBe(0.5);
      expect(sheets(once.surface).length).toBeGreaterThan(0);
    });

    stage.renderer.setZoom(2);
    stage.renderer.setZoom(0.5);

    await vi.waitFor(() => {
      expect(stage.renderer.pages.count).toBe(once.renderer.pages.count);
    });
  });

  it('lays out again when the width changes, and not for a height the toolbar took', async () => {
    const { renderer, engraver } = await aPagedScore();
    const relayout = vi.spyOn(engraver, 'relayout');

    renderer.handleContainerResize(1024);
    expect(relayout).not.toHaveBeenCalled();

    renderer.handleContainerResize(700);
    expect(relayout).toHaveBeenCalledTimes(1);
  });
});

describe('a finger on the music', () => {
  function finger(surface: HTMLElement, type: string, clientX: number, clientY = 100): void {
    surface.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX, clientY }));
  }

  it('turns the page when it swipes across', async () => {
    const { renderer, surface } = await aPagedScore();

    finger(surface, 'pointerdown', 600);
    finger(surface, 'pointerup', 400);
    expect(renderer.pages.at).toBe(1);

    finger(surface, 'pointerdown', 400);
    finger(surface, 'pointerup', 600);
    expect(renderer.pages.at).toBe(0);
  });

  it('says a touch was a touch, and a swipe was not', async () => {
    const { renderer, surface } = await aPagedScore();
    let touched = 0;
    renderer.onScoreTapped(() => {
      touched += 1;
    });

    finger(surface, 'pointerdown', 500);
    finger(surface, 'pointerup', 503);
    finger(surface, 'pointerdown', 600);
    finger(surface, 'pointerup', 400);

    expect(touched).toBe(1);
  });
});

describe('the marker', () => {
  /** Where on the screen a page's things are: its reading, and pixels to a unit. */
  function readingOf(surface: HTMLElement, page: number): { layout: PageLayout; scale: number } {
    const drawing = sheets(surface)[page]?.querySelector('svg') as SVGSVGElement;
    const layout = readThePage(drawing);
    return { layout, scale: Number.parseFloat(drawing.getAttribute('width') ?? '0') / layout.width };
  }

  function box(element: Element | null | undefined): { left: number; top: number; right: number; bottom: number } {
    const style = (element as HTMLElement | null)?.style;
    const left = Number.parseFloat(style?.left ?? 'NaN');
    const top = Number.parseFloat(style?.top ?? 'NaN');
    return {
      left,
      top,
      right: left + Number.parseFloat(style?.width ?? 'NaN'),
      bottom: top + Number.parseFloat(style?.height ?? 'NaN'),
    };
  }

  function marker(surface: HTMLElement): HTMLElement | null {
    return surface.querySelector<HTMLElement>('.score__cursor:not(.score__cursor--other)');
  }

  it('stands over every head of its step, across both staves of the system', async () => {
    // Two staves, and a chord with a second in it, whose heads Verovio sets
    // side by side: a band from the first head alone would leave the second
    // uncovered, and one as tall as the treble alone would leave the bass.
    const { renderer, surface } = aStage();
    const twoBars = twoBarExercise();
    const [treble, bass] = twoBars.staves;
    const spread = printed({
      ...twoBars,
      staves: [
        {
          ...(treble as NonNullable<typeof treble>),
          measures: [
            bar(
              noteEntry([p('C4'), p('D4')], Duration.QUARTER),
              noteEntry(p('D4'), Duration.QUARTER),
              noteEntry(p('E4'), Duration.QUARTER),
              noteEntry(p('F4'), Duration.QUARTER),
            ),
            ...(treble?.measures.slice(1) ?? []),
          ],
        },
        bass as NonNullable<typeof bass>,
      ],
    });
    await renderer.load(spread.xml, spread.steps);

    renderer.cursor.moveTo(0);

    const drawn = marker(surface);
    expect(drawn?.closest('.score__page')).toBe(sheets(surface)[0]);
    const { layout, scale } = readingOf(surface, 0);
    const step = spread.steps[0];
    const heads = (step?.printed ?? []).map((here) => layout.heads.get(here.id)?.x ?? NaN);
    expect(new Set(heads).size).toBeGreaterThan(1);
    const system = layout.systems[0];
    const [top, second] = system?.bars[0]?.staves[0]?.lines ?? [];
    const space = (second ?? NaN) - (top ?? NaN);
    const at = box(drawn);
    expect(at.left).toBeLessThanOrEqual((Math.min(...heads) - space / 2) * scale);
    expect(at.right).toBeGreaterThanOrEqual((Math.max(...heads) + space) * scale);
    expect(at.top).toBeLessThanOrEqual(((system?.top ?? NaN) - space) * scale);
    expect(at.bottom).toBeGreaterThanOrEqual(((system?.bottom ?? NaN) + space) * scale);
  });

  it('moves along with the music', async () => {
    const { renderer, surface } = await aPagedScore();
    renderer.cursor.moveTo(1);
    const before = box(marker(surface)).left;

    renderer.cursor.moveTo(2);

    expect(box(marker(surface)).left).toBeGreaterThan(before);
    expect(renderer.cursor.position).toBe(2);
  });

  it('goes back to the first step when it is reset', async () => {
    const { renderer, surface } = await aPagedScore();
    renderer.cursor.moveTo(9);
    renderer.cursor.moveTo(0);
    const first = box(marker(surface)).left;
    renderer.cursor.moveTo(9);

    renderer.cursor.reset();

    expect(renderer.cursor.position).toBe(0);
    expect(box(marker(surface)).left).toBe(first);
  });

  it('comes off the page when it is hidden, and back when it is shown', async () => {
    const { renderer, surface } = await aPagedScore();
    renderer.cursor.moveTo(3);

    renderer.cursor.hide();
    expect(marker(surface)).toBeNull();

    renderer.cursor.show();
    expect(marker(surface)).not.toBeNull();
  });

  it('stands on a page not being read only once that page is drawn', async () => {
    const { renderer, surface } = await aPagedScore();
    const late = LONG.steps.length - 1;

    renderer.cursor.moveTo(late);
    expect(marker(surface)).toBeNull();

    renderer.turnPages(999);
    await vi.waitFor(() => {
      expect(marker(surface)?.closest('.score__page')).toBe(sheets(surface)[renderer.pages.count - 1]);
    });
  });

  it('finds its step again on a new layout, on the page the step is on now', async () => {
    const { renderer, surface } = await aPagedScore();
    renderer.turnPages(3);
    const step = Math.floor(LONG.steps.length * 0.55);
    renderer.cursor.moveTo(step);
    const before = renderer.pages.count;
    const name = LONG.steps[step]?.printed[0]?.id ?? '';

    renderer.setZoom(renderer.zoom * 1.4);

    await vi.waitFor(() => {
      expect(renderer.pages.count).toBeGreaterThan(before);
      const holding = marker(surface)?.closest('.score__page');
      expect(holding?.querySelector(`[id="${name}"]`)).not.toBeNull();
    });
  });

  it('forgets where the last layout drew its step', async () => {
    // Laid out again, the page its step was on may not be drawn at all - the
    // reader went on to another - and a marker put where the old layout had
    // it would stand on a page with nothing on it.
    const { renderer, surface } = await aPagedScore();
    renderer.turnPages(3);
    await vi.waitFor(() => {
      expect(drawn(surface)).toEqual([2, 3, 4]);
    });
    // A step late on page 3, which a larger print carries past the pages
    // drawn round the reader's.
    const step = LONG.steps.findIndex((each) => each.barId === 'm160');
    renderer.cursor.moveTo(step);
    expect(marker(surface)?.closest('.score__page')).toBe(sheets(surface)[3]);
    const before = renderer.pages.count;

    renderer.setZoom(renderer.zoom * 1.4);

    // Every page round the reader drawn, which is when the marker is put down.
    await vi.waitFor(() => {
      expect(renderer.pages.count).toBeGreaterThan(before);
      const at = renderer.pages.at;
      expect(drawn(surface)).toEqual([at - 1, at, at + 1]);
    });
    const holding = marker(surface)?.closest('.score__page');
    // Nowhere, or on the page that bar is drawn on now - never on a page the
    // old layout had it on.
    expect(holding === null || holding === undefined || holding.querySelector('[id="m160"]') !== null).toBe(true);
  });

  it('comes off a page that is let go of', async () => {
    const { renderer, surface } = await aPagedScore();
    renderer.cursor.moveTo(0);
    expect(marker(surface)).not.toBeNull();

    renderer.turnPages(3);

    await vi.waitFor(() => {
      expect(drawn(surface)).toEqual([2, 3, 4]);
    });
    expect(marker(surface)).toBeNull();
  });

  it('keeps the other hand’s marker a marker of its own', async () => {
    const { renderer, surface } = await aPagedScore();
    renderer.cursor.moveTo(1);

    renderer.otherHand.moveTo(4);

    const other = surface.querySelector('.score__cursor--other');
    expect(other).not.toBeNull();
    expect(box(other).left).toBeGreaterThan(box(marker(surface)).left);
    expect(renderer.otherHand.position).toBe(4);
    expect(renderer.cursor.position).toBe(1);
  });
});

describe('clearing', () => {
  it('takes the pages away and says there are none', async () => {
    const { renderer, surface } = await aPagedScore();

    renderer.clear();

    expect(sheets(surface)).toHaveLength(0);
    expect(renderer.pages.count).toBe(0);
  });

  it('lays out nothing again after it, which there is no music for', async () => {
    const { renderer, engraver } = aStage();
    const two = printed(twoBarExercise());
    await renderer.load(two.xml, two.steps);
    renderer.clear();
    const relayout = vi.spyOn(engraver, 'relayout');

    renderer.setZoom(2);

    expect(relayout).not.toHaveBeenCalled();
  });
});

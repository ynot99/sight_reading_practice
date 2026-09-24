// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { readThePage } from '../../src/infrastructure/rendering/verovio/pageLayout.js';
import { VerovioCore } from '../../src/infrastructure/rendering/verovio/VerovioCore.js';
import { VerovioEngraver } from '../../src/infrastructure/rendering/verovio/VerovioEngraver.js';
import { VerovioScoreRenderer } from '../../src/infrastructure/rendering/verovio/VerovioScoreRenderer.js';
import { longExercise, twoBarExercise } from '../support/fixtures.js';
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
const LONG = serializer.serialize(longExercise({ bars: 240 }));

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
  await stage.renderer.load(LONG);
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

    await renderer.load(LONG);

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

describe('what the run moves', () => {
  it('keeps where the cursor is, which the run asks', async () => {
    const { renderer } = await aPagedScore();

    renderer.cursor.moveTo(7);
    expect(renderer.cursor.position).toBe(7);
    renderer.cursor.reset();
    expect(renderer.cursor.position).toBe(0);
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
    await renderer.load(serializer.serialize(twoBarExercise()));
    renderer.clear();
    const relayout = vi.spyOn(engraver, 'relayout');

    renderer.setZoom(2);

    expect(relayout).not.toHaveBeenCalled();
  });
});

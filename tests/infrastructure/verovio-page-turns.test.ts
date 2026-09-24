// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { readThePage, type PageLayout } from '../../src/infrastructure/rendering/verovio/pageLayout.js';
import { elementAt } from '../../src/shared/asserts.js';
import { twoBarExercise } from '../support/fixtures.js';
import { printed, sheets, verovioStages, whenDrawn, type Stage } from '../support/verovioStage.js';

/**
 * Pages that follow the music under Verovio: turned as it leaves one,
 * scrolled to as it goes down the column, and the top of the next page shown
 * over the first system once the last one is being played.
 */
const { aStage } = verovioStages();

/** A grand staff of as many bars as asked for, the two fixture bars over and over. */
function grandStaff(bars: number): Exercise {
  const base = twoBarExercise();
  return {
    ...base,
    staves: base.staves.map((staff) => ({
      ...staff,
      measures: Array.from({ length: bars }, (_, at) => elementAt(staff.measures, at % staff.measures.length)),
    })),
  };
}

const PIECE = printed(grandStaff(120));

async function aScore(paged = true): Promise<Stage> {
  const stage = aStage();
  stage.renderer.setPaged(paged);
  await stage.renderer.load(PIECE.xml, PIECE.steps);
  return stage;
}

function readingOf(surface: HTMLElement, page: number): { layout: PageLayout; scale: number } {
  const drawing = sheets(surface)[page]?.querySelector('svg') as SVGSVGElement;
  const layout = readThePage(drawing);
  return { layout, scale: Number.parseFloat(drawing.getAttribute('width') ?? '0') / layout.width };
}

/** The first step of a system of a drawn page. */
function firstStepOf(surface: HTMLElement, page: number, system: number): number {
  const bar = readingOf(surface, page).layout.systems.at(system)?.bars[0]?.id;
  const step = PIECE.steps.findIndex((each) => each.barId === bar);
  expect(step).toBeGreaterThanOrEqual(0);
  return step;
}

function previewOn(surface: HTMLElement, page: number): SVGGElement | null {
  return sheets(surface)[page]?.querySelector<SVGGElement>('svg.score__over > g.page-preview') ?? null;
}

describe('a page turned by the music', () => {
  it('turns to the next page when the music reaches it', async () => {
    const { renderer, surface } = await aScore();
    const heard: number[] = [];
    renderer.onPagesChanged((state) => heard.push(state.at));

    renderer.cursor.moveTo(firstStepOf(surface, 1, 0));

    expect(renderer.pages.at).toBe(1);
    expect(heard).toEqual([1]);
  });

  it('turns to a page not drawn, once the engraver has said where the music is', async () => {
    const { renderer, engraver } = await aScore();
    const far = PIECE.steps.findIndex((each) => each.barId === 'm110');
    const page = ((await engraver.pageOf('m110')) ?? NaN) - 1;
    expect(page).toBeGreaterThan(2);

    renderer.cursor.moveTo(far);

    await whenDrawn(() => {
      expect(renderer.pages.at).toBe(page);
    });
  });

  it('does not go back to a page the music has already left by the time the answer comes', async () => {
    const { renderer, surface } = await aScore();
    const far = PIECE.steps.findIndex((each) => each.barId === 'm110');

    renderer.cursor.moveTo(far);
    renderer.cursor.moveTo(firstStepOf(surface, 0, 1));
    await new Promise((done) => setTimeout(done, 200));

    expect(renderer.pages.at).toBe(0);
  });

  it('stays where the reader is for a marker put back, shown, or moved by the other hand', async () => {
    // Bookkeeping, not the music: a page that followed it would throw the
    // reader back to the first page every time a run was set up.
    const { renderer, surface } = await aScore();
    renderer.turnPages(1);

    renderer.cursor.reset();
    renderer.cursor.show();
    renderer.otherHand.moveTo(firstStepOf(surface, 0, 0));

    expect(renderer.pages.at).toBe(1);
  });

  it('leaves the turning to the reader who asked to turn the pages themselves', async () => {
    const { renderer, surface } = await aScore();

    renderer.turnPagesWithTheMusic(false);
    renderer.cursor.moveTo(firstStepOf(surface, 1, 0));
    expect(renderer.pages.at).toBe(0);

    renderer.turnPagesWithTheMusic(true);
    renderer.cursor.moveTo(firstStepOf(surface, 1, 0) + 1);
    expect(renderer.pages.at).toBe(1);
  });
});

describe('a scrolled score following the music', () => {
  /**
   * The column as a browser would lay it out: each page under the last, the
   * view four hundred pixels tall at the top of the column, and whatever it
   * is asked to scroll to written down.
   */
  function laidOut(stage: Stage): { top: number }[] {
    const asked: { top: number }[] = [];
    const height = Number.parseFloat(elementAt(sheets(stage.surface), 0).style.height);
    for (const [page, sheet] of sheets(stage.surface).entries()) {
      sheet.getBoundingClientRect = () => ({ top: page * height, bottom: (page + 1) * height }) as DOMRect;
    }
    stage.scroller.getBoundingClientRect = () => ({ top: 0, bottom: 400 }) as DOMRect;
    Object.defineProperty(stage.scroller, 'clientHeight', { value: 400 });
    stage.scroller.scrollTo = ((options: ScrollToOptions) => {
      asked.push({ top: options.top ?? NaN });
    }) as Element['scrollTo'];
    return asked;
  }

  function markerBand(surface: HTMLElement): { top: number; height: number } {
    const marker = surface.querySelector<HTMLElement>('.score__cursor:not(.score__cursor--other)');
    return { top: Number.parseFloat(marker?.style.top ?? 'NaN'), height: Number.parseFloat(marker?.style.height ?? 'NaN') };
  }

  it('brings the system the music reaches into the middle of the view', async () => {
    const stage = await aScore(false);
    const asked = laidOut(stage);
    const height = Number.parseFloat(elementAt(sheets(stage.surface), 0).style.height);

    stage.renderer.cursor.moveTo(firstStepOf(stage.surface, 1, 1));

    const band = markerBand(stage.surface);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.top).toBeCloseTo(height + band.top + band.height / 2 - 200, 5);
  });

  it('scrolls once for a system, not for every note of it', async () => {
    const stage = await aScore(false);
    const asked = laidOut(stage);
    const first = firstStepOf(stage.surface, 0, 1);

    stage.renderer.cursor.moveTo(first);
    stage.renderer.cursor.moveTo(first + 1);
    stage.renderer.cursor.moveTo(first + 2);
    stage.renderer.cursor.moveTo(firstStepOf(stage.surface, 0, 2));

    expect(asked).toHaveLength(2);
  });

  it('scrolls to the top of a page not drawn yet, once the engraver has said which', async () => {
    const stage = await aScore(false);
    const asked = laidOut(stage);
    const height = Number.parseFloat(elementAt(sheets(stage.surface), 0).style.height);
    const far = PIECE.steps.findIndex((each) => each.barId === 'm110');
    const page = ((await stage.engraver.pageOf('m110')) ?? NaN) - 1;
    expect(page).toBeGreaterThan(2);

    stage.renderer.cursor.moveTo(far);

    await whenDrawn(() => {
      expect(asked.at(-1)?.top).toBe(page * height);
    });
  });
});

describe('the top of the next page, shown early', () => {
  it('stands over the first system once the music reaches the last one, and not before', async () => {
    const { renderer, surface } = await aScore();
    const systems = readingOf(surface, 0).layout.systems.length;
    expect(systems).toBeGreaterThan(1);

    renderer.cursor.moveTo(firstStepOf(surface, 0, systems - 2));
    expect(previewOn(surface, 0)).toBeNull();

    renderer.cursor.moveTo(firstStepOf(surface, 0, systems - 1));
    const preview = previewOn(surface, 0);
    expect(preview).not.toBeNull();
    // The page ahead, as Verovio drew it: its first bar is in there.
    const ahead = readingOf(surface, 1).layout.systems[0]?.bars[0]?.id ?? '';
    expect(preview?.querySelector(`g.measure#${ahead}`)).not.toBeNull();
    // The whole drawing, named as it is named: the stylesheet Verovio writes
    // into a page draws its lines only inside the drawing it names.
    const drawing = sheets(surface)[1]?.querySelector('svg');
    expect(drawing?.id).not.toBe('');
    expect(preview?.querySelector(`svg[id="${drawing?.id ?? ''}"]`)).not.toBeNull();
  });

  it('reaches halfway to the second system, on ground of its own, with a line to say where it ends', async () => {
    const { renderer, surface } = await aScore();
    const { layout, scale } = readingOf(surface, 0);

    renderer.cursor.moveTo(firstStepOf(surface, 0, layout.systems.length - 1));

    const bottom = (((layout.systems[0]?.bottom ?? NaN) + (layout.systems[1]?.top ?? NaN)) / 2) * scale;
    const preview = previewOn(surface, 0);
    expect(Number(preview?.querySelector('rect.page-preview__ground')?.getAttribute('height'))).toBeCloseTo(bottom, 5);
    expect(Number(preview?.querySelector('clipPath rect')?.getAttribute('height'))).toBeCloseTo(bottom, 5);
    expect(Number(preview?.querySelector('line.page-preview__edge')?.getAttribute('y1'))).toBeCloseTo(bottom, 5);
  });

  it('shows the first system of the page ahead and none of its second', async () => {
    const { renderer, surface } = await aScore();
    const systems = readingOf(surface, 0).layout.systems.length;
    const ahead = readingOf(surface, 1);

    renderer.cursor.moveTo(firstStepOf(surface, 0, systems - 1));

    const preview = previewOn(surface, 0);
    const cut = preview?.querySelectorAll('clipPath rect')[1];
    // And cut by it: the copy stands inside what the cut is applied to.
    const id = preview?.querySelectorAll('clipPath')[1]?.id ?? '';
    expect(preview?.querySelector(`g[clip-path="url(#${id})"] > svg`)).not.toBeNull();
    const [first, second] = ahead.layout.systems;
    expect(Number(cut?.getAttribute('height'))).toBeCloseTo(
      (((first?.bottom ?? NaN) + (second?.top ?? NaN)) / 2) * ahead.scale,
      5,
    );
  });

  it('stands its first system where this page’s first system was', async () => {
    // Where no layout engine can measure its ink, the staff's own top.
    const { renderer, surface } = await aScore();
    const here = readingOf(surface, 0);
    const ahead = readingOf(surface, 1);

    renderer.cursor.moveTo(firstStepOf(surface, 0, here.layout.systems.length - 1));

    const moved = previewOn(surface, 0)?.querySelector('g[clip-path] > g')?.getAttribute('transform') ?? '';
    const [down, , up] = [...moved.matchAll(/translate\(0, (-?[\d.]+)\)|scale\(([\d.]+)\)/g)].map((each) =>
      Number(each[1] ?? each[2]),
    );
    expect((up ?? NaN) + (down ?? NaN)).toBeCloseTo(
      (here.layout.systems[0]?.top ?? NaN) * here.scale - (ahead.layout.systems[0]?.top ?? NaN) * ahead.scale,
      5,
    );
  });

  it('is under the page’s label, which still says which page this is', async () => {
    const { renderer, surface } = await aScore();
    const systems = readingOf(surface, 0).layout.systems.length;

    renderer.cursor.moveTo(firstStepOf(surface, 0, systems - 1));

    const layers = [...(sheets(surface)[0]?.querySelector('svg.score__over')?.children ?? [])].map((each) =>
      each.getAttribute('class'),
    );
    expect(layers.indexOf('page-preview')).toBeLessThan(layers.indexOf('page-label'));
  });

  it('covers the hand switches of the system it stands over, and gives them back', async () => {
    const { renderer, surface } = await aScore();
    renderer.showHands([1, 2]);
    const systems = readingOf(surface, 0).layout.systems.length;
    const covered = (): string[] =>
      [...(sheets(surface)[0]?.querySelectorAll<SVGGElement>('g.hand-switch') ?? [])].map(
        (each) => each.dataset['covered'] ?? '',
      );

    renderer.cursor.moveTo(firstStepOf(surface, 0, systems - 1));
    expect(covered()).toEqual(['true', 'true', ...Array.from({ length: 2 * (systems - 1) }, () => '')]);

    // Drawn again with the preview standing: still covered.
    renderer.showHands([2]);
    expect(covered().slice(0, 2)).toEqual(['true', 'true']);

    renderer.cursor.moveTo(firstStepOf(surface, 0, 0));
    expect(covered().every((each) => each === '')).toBe(true);
  });

  it('goes with the page it stood on when the page turns', async () => {
    const { renderer, surface } = await aScore();
    const systems = readingOf(surface, 0).layout.systems.length;
    renderer.cursor.moveTo(firstStepOf(surface, 0, systems - 1));

    renderer.cursor.moveTo(firstStepOf(surface, 1, 0));

    expect(renderer.pages.at).toBe(1);
    expect(previewOn(surface, 0)).toBeNull();
    expect(previewOn(surface, 1)).toBeNull();
  });

  it('is not shown when not wanted, and not in a scrolled score', async () => {
    const { renderer, surface } = await aScore();
    const systems = readingOf(surface, 0).layout.systems.length;

    renderer.showNextPagePreview(false);
    renderer.cursor.moveTo(firstStepOf(surface, 0, systems - 1));
    expect(previewOn(surface, 0)).toBeNull();

    renderer.showNextPagePreview(true);
    expect(previewOn(surface, 0)).not.toBeNull();

    renderer.setPaged(false);
    expect(previewOn(surface, 0)).toBeNull();
  });

  it('is shown once the page ahead is drawn, when it was not yet', async () => {
    const { renderer, surface } = await aScore();
    renderer.turnPages(3);
    await whenDrawn(() => {
      expect(sheets(surface)[4]?.querySelector('svg')).not.toBeNull();
    });
    const systems = readingOf(surface, 3).layout.systems.length;
    const last = firstStepOf(surface, 3, systems - 1);
    renderer.turnPages(-3);
    await whenDrawn(() => {
      expect(sheets(surface)[4]?.querySelector('svg')).toBeNull();
    });

    renderer.turnPages(3);
    renderer.cursor.moveTo(last);

    await whenDrawn(() => {
      expect(previewOn(surface, 3)).not.toBeNull();
    });
  });

  it('is a picture: a finger on it neither touches the music nor points at a bar', async () => {
    const { renderer, surface } = await aScore();
    const systems = readingOf(surface, 0).layout.systems.length;
    renderer.cursor.moveTo(firstStepOf(surface, 0, systems - 1));
    let touched = 0;
    const bars: number[] = [];
    renderer.onScoreTapped(() => {
      touched += 1;
    });
    renderer.onBarHeld((bar) => bars.push(bar));
    const ground = previewOn(surface, 0)?.querySelector('rect.page-preview__ground');

    vi.useFakeTimers();
    try {
      ground?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 300, clientY: 60 }));
      vi.advanceTimersByTime(600);
      ground?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX: 300, clientY: 60 }));
    } finally {
      vi.useRealTimers();
    }

    expect(touched).toBe(0);
    expect(bars).toEqual([]);
  });
});

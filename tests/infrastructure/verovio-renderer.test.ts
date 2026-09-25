// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { PrintedStep } from '../../src/domain/notation/printedIds.js';
import { readThePage, type PageLayout } from '../../src/infrastructure/rendering/verovio/pageLayout.js';
import type { VerovioScoreRenderer } from '../../src/infrastructure/rendering/verovio/VerovioScoreRenderer.js';
import { keepTheTrail, timeTheStart, traceTheStart } from '../../src/shared/timeTheStart.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { noteEntry, restEntry } from '../../src/domain/model/Exercise.js';
import { bar, beamedSixteenths, longExercise, p, twoBarExercise } from '../support/fixtures.js';
import { laidOutAt, printed, sheets, verovioStages, whenDrawn, type Stage } from '../support/verovioStage.js';

const { aStage } = verovioStages();

const LONG = printed(longExercise({ bars: 240 }));

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

describe('the trail an opening leaves', () => {
  it('keeps each stage of opening a score as it is reached', async () => {
    // His Alkan closes the page on the iPad while it opens, and the console
    // goes with the page; what is kept is read back on the next visit, and
    // its last line is the last stage the page lived through.
    const kept: string[][] = [];
    traceTheStart(true);
    keepTheTrail((lines) => kept.push([...lines]));
    try {
      timeTheStart('score asked for');
      const { renderer } = aStage();
      renderer.setPaged(true);

      await renderer.load(LONG.xml, LONG.steps);

      const stages = (kept.at(-1) ?? []).map((line) => /ms {3}(engraver: [^(]+?)(?: \(|$| {3})/.exec(line)?.[1] ?? '');
      expect(stages.filter((stage) => stage !== '')).toEqual([
        'engraver: sent to Verovio',
        'engraver: room made in Verovio',
        'engraver: laid out',
        'engraver: pages near the reader drawn',
      ]);
    } finally {
      keepTheTrail(null);
      traceTheStart(false);
    }
  });
});

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
    await whenDrawn(() => {
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
    await whenDrawn(() => {
      expect(renderer.pages.at).toBe(renderer.pages.count - 1);
    });
  });

  it('says in the corner of each page what the piece is and which page of it', async () => {
    const { renderer, surface } = await aPagedScore();

    expect(label(surface, 0)).toBe(`Long fixture · Page 1 of ${String(renderer.pages.count)}`);
    renderer.turnPages(1);
    await whenDrawn(() => {
      expect(label(surface, 2)).toBe(`Long fixture · Page 3 of ${String(renderer.pages.count)}`);
    });
  });

  it('keeps OSMD’s room above the music and after it, and never too little for the label', async () => {
    // Fifty pixels at 100%, and its share of the print at any other, as
    // OSMD's was. With Verovio's own margins a system ran on under the marks
    // of the modes in the top right, and its high notes under the clock.
    const { renderer, surface } = await aPagedScore();

    for (const [zoom, top, right] of [
      [1, 50, 50],
      [2.5, 125, 125],
      // The label's room, where OSMD's would be less than it needs.
      [0.4, 32, 20],
    ] as const) {
      await laidOutAt(renderer, surface, zoom);
      const drawing = sheets(surface)[0]?.querySelector('svg') as SVGSVGElement;
      const layout = readThePage(drawing);
      const scale = Number.parseFloat(drawing.getAttribute('width') ?? '0') / layout.width;
      const margin = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(
        drawing.querySelector('g.page-margin')?.getAttribute('transform') ?? '',
      );
      const ends = (layout.systems[0]?.bars ?? []).map((bar) => bar.right);
      expect(Number(margin?.[2]) * scale).toBeGreaterThanOrEqual(top - 1);
      expect(Number(margin?.[2]) * scale).toBeLessThan(top + 1);
      expect((layout.width - Math.max(...ends)) * scale).toBeGreaterThanOrEqual(right - 1.5);
      expect((layout.width - Math.max(...ends)) * scale).toBeLessThan(right + 1.5);
    }
  });

  it('asks for a page that fits the room inside the box, reserves and all', async () => {
    // The box keeps room at both ends - above the page, and the transport
    // bar's below it - and a page sized to the window overflowed by the strip
    // nobody owned, which the frame grew to hold and the document scrolled by.
    const { renderer, engraver, scroller } = aStage();
    const load = vi.spyOn(engraver, 'load');
    scroller.style.paddingTop = '8px';
    scroller.style.paddingBottom = '92px';
    scroller.getBoundingClientRect = () => ({ left: 0, top: 0, bottom: 260, width: 900, height: 260 }) as DOMRect;
    renderer.setPaged(true);

    await renderer.load(LONG.xml, LONG.steps);

    const shape = load.mock.calls[0]?.[1];
    const tall = ((shape?.pageHeight ?? NaN) * (shape?.scale ?? NaN)) / 100;
    expect(tall).toBeLessThanOrEqual(260 - 8 - 92);
    expect(tall).toBeGreaterThan(260 - 8 - 92 - 1);
  });

  it('does not scroll after the marker in a score read in pages', async () => {
    // A turn is what shows the next system; a scroll on every beat is an
    // animation over the whole page started again before the last finished.
    const { renderer, scroller } = await aPagedScore();
    const scrolled = vi.fn();
    scroller.scrollTo = scrolled as Element['scrollTo'];

    for (const step of [1, 2, 3, 40, 41]) {
      renderer.cursor.moveTo(step);
    }

    expect(scrolled).not.toHaveBeenCalled();
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
    await whenDrawn(() => {
      expect(renderer.pages.count).toBeLessThan(at);
    });
  });

  it('keeps the reader at the bar that was at the top of their page', async () => {
    // A zoom is not a request to start again, and a page number means nothing
    // across two layouts - the bar does.
    const { renderer, surface } = await aPagedScore();
    renderer.turnPages(3);
    await whenDrawn(() => {
      expect(drawn(surface)).toContain(3);
    });
    const top = readThePage(sheets(surface)[3]?.querySelector('svg') as SVGSVGElement).systems[0]
      ?.bars[0]?.id;

    const before = renderer.pages.count;

    renderer.setZoom(renderer.zoom * 1.4);

    // The old layout stays on the screen until the new one is ready, and it
    // holds that bar too: wait for the new one.
    await whenDrawn(() => {
      expect(renderer.pages.count).toBeGreaterThan(before);
    });
    await whenDrawn(() => {
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
    await whenDrawn(() => {
      expect(once.renderer.zoom).toBe(0.5);
      expect(sheets(once.surface).length).toBeGreaterThan(0);
    });

    stage.renderer.setZoom(2);
    stage.renderer.setZoom(0.5);

    await whenDrawn(() => {
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
    // From the top line to the bottom one, and no further: OSMD's did, and
    // a band past them runs into the tempo and the words over the staff.
    expect(at.top).toBeCloseTo((system?.top ?? NaN) * scale, 5);
    expect(at.bottom).toBeCloseTo((system?.bottom ?? NaN) * scale, 5);
  });

  it('is three spaces wide, centred on the head it stands on', async () => {
    const { renderer, surface } = aStage();
    const two = printed(twoBarExercise());
    await renderer.load(two.xml, two.steps);

    renderer.cursor.moveTo(1);

    const { layout, scale } = readingOf(surface, 0);
    const [top, second] = layout.systems[0]?.bars[0]?.staves[0]?.lines ?? [];
    const space = (second ?? NaN) - (top ?? NaN);
    const head = layout.heads.get(two.steps[1]?.printed[0]?.id ?? '')?.x ?? NaN;
    const at = box(marker(surface));
    expect(at.right - at.left).toBeCloseTo(3 * space * scale, 5);
    expect((at.left + at.right) / 2).toBeCloseTo((head + 0.59 * space) * scale, 5);
  });

  it('stands on the first note, and not over a rest the other hand keeps for the whole bar', async () => {
    // His Canon in D: the bass begins alone under a bar of rest, which the
    // engraver sets in the middle of the bar - and a marker stretched to
    // cover it lay over half the bass's notes as well.
    const { renderer, surface } = aStage();
    const twoBars = twoBarExercise();
    const [treble, bass] = twoBars.staves;
    const alone = printed({
      ...twoBars,
      staves: [
        { ...(treble as NonNullable<typeof treble>), measures: [bar(restEntry(Duration.WHOLE)), ...(treble?.measures.slice(1) ?? [])] },
        {
          ...(bass as NonNullable<typeof bass>),
          measures: [
            bar(
              noteEntry(p('C3'), Duration.QUARTER),
              noteEntry(p('E3'), Duration.QUARTER),
              noteEntry(p('G3'), Duration.QUARTER),
              noteEntry(p('C4'), Duration.QUARTER),
            ),
            ...(bass?.measures.slice(1) ?? []),
          ],
        },
      ],
    });
    await renderer.load(alone.xml, alone.steps);

    renderer.cursor.moveTo(0);

    const { layout, scale } = readingOf(surface, 0);
    const rest = layout.heads.get('r0-1-0');
    expect(rest?.wholeBar).toBe(true);
    const second = layout.heads.get('n0-2-1-0')?.x ?? NaN;
    expect(box(marker(surface)).right).toBeLessThan(second * scale);
  });

  it('stands on a rest for the whole bar when that is all its step draws', async () => {
    const { renderer, surface } = aStage();
    const twoBars = twoBarExercise();
    const [treble, bass] = twoBars.staves;
    const resting = printed({
      ...twoBars,
      staves: [
        { ...(treble as NonNullable<typeof treble>), measures: [bar(restEntry(Duration.WHOLE)), ...(treble?.measures.slice(1) ?? [])] },
        { ...(bass as NonNullable<typeof bass>), measures: [bar(restEntry(Duration.WHOLE)), ...(bass?.measures.slice(1) ?? [])] },
      ],
    });
    await renderer.load(resting.xml, resting.steps);

    renderer.cursor.moveTo(0);

    const { layout, scale } = readingOf(surface, 0);
    const rest = layout.heads.get('r0-1-0')?.x ?? NaN;
    const at = box(marker(surface));
    expect(at.left).toBeLessThan(rest * scale);
    expect(at.right).toBeGreaterThan(rest * scale);
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
    await whenDrawn(() => {
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

    await whenDrawn(() => {
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
    await whenDrawn(() => {
      expect(drawn(surface)).toEqual([2, 3, 4]);
    });
    // A step late on page 3, which a larger print carries past the pages
    // drawn round the reader's: in its last bar, whichever that is.
    const lastBar = readingOf(surface, 3).layout.systems.at(-1)?.bars.at(-1)?.id ?? '';
    const step = LONG.steps.findIndex((each) => each.barId === lastBar);
    renderer.cursor.moveTo(step);
    expect(marker(surface)?.closest('.score__page')).toBe(sheets(surface)[3]);
    const before = renderer.pages.count;

    renderer.setZoom(renderer.zoom * 1.4);

    // Every page round the reader drawn, which is when the marker is put down.
    await whenDrawn(() => {
      expect(renderer.pages.count).toBeGreaterThan(before);
      const at = renderer.pages.at;
      expect(drawn(surface)).toEqual([at - 1, at, at + 1]);
    });
    const holding = marker(surface)?.closest('.score__page');
    // Nowhere, or on the page that bar is drawn on now - never on a page the
    // old layout had it on.
    expect(holding === null || holding === undefined || holding.querySelector(`[id="${lastBar}"]`) !== null).toBe(true);
  });

  it('comes off a page that is let go of', async () => {
    const { renderer, surface } = await aPagedScore();
    renderer.cursor.moveTo(0);
    expect(marker(surface)).not.toBeNull();

    renderer.turnPages(3);

    await whenDrawn(() => {
      expect(drawn(surface)).toEqual([2, 3, 4]);
    });
    expect(marker(surface)).toBeNull();
  });

  it('keeps the other hand’s marker off the page until the run shows it', async () => {
    // It moves only while the run plays the other hand; shown from the start,
    // it stood still on the first note through a whole run waiting for notes.
    const { renderer, surface } = await aPagedScore();
    renderer.cursor.moveTo(1);
    renderer.otherHand.moveTo(4);

    expect(surface.querySelector('.score__cursor--other')).toBeNull();
    expect(marker(surface)).not.toBeNull();
  });

  it('keeps the other hand’s marker a marker of its own', async () => {
    const { renderer, surface } = await aPagedScore();
    renderer.cursor.moveTo(1);

    renderer.otherHand.moveTo(4);
    renderer.otherHand.show();

    const other = surface.querySelector('.score__cursor--other');
    expect(other).not.toBeNull();
    expect(box(other).left).toBeGreaterThan(box(marker(surface)).left);
    expect(renderer.otherHand.position).toBe(4);
    expect(renderer.cursor.position).toBe(1);
  });
});

describe('what was played', () => {
  const C_MAJOR = KeySignature.major(0);
  const context = {
    keyAt: () => C_MAJOR,
    clefAt: (staffNumber: number) => (staffNumber === 1 ? ('treble' as const) : ('bass' as const)),
  };

  /** Two bars, both hands, opened with the overlay told the key and the clefs. */
  async function twoBarsOpen(): Promise<Stage & { readonly steps: readonly PrintedStep[] }> {
    const stage = aStage();
    stage.renderer.setPaged(true);
    const two = printed(twoBarExercise());
    await stage.renderer.load(two.xml, two.steps);
    stage.renderer.configureOverlay(context);
    return { ...stage, steps: two.steps };
  }

  /** Lays the music out again at another print, and waits until it has. */
  async function laidOutAgain(renderer: VerovioScoreRenderer, surface: HTMLElement): Promise<void> {
    const before = sheets(surface)[0]?.querySelector('svg');
    renderer.setZoom(renderer.zoom * 1.3);
    await whenDrawn(() => {
      const now = sheets(surface)[0]?.querySelector('svg');
      expect(now).not.toBeNull();
      expect(now).not.toBe(before);
    });
  }

  function ringsOf(surface: HTMLElement, page = 0): Element[] {
    return [...(sheets(surface)[page]?.querySelectorAll('.played-overlay ellipse.played-note') ?? [])];
  }

  /** Where a named head is drawn, in the page's units. */
  function headOf(surface: HTMLElement, id: string): { x: number; y: number } {
    const drawing = sheets(surface)[0]?.querySelector('svg') as SVGSVGElement;
    const head = readThePage(drawing).heads.get(id);
    return { x: head?.x ?? NaN, y: head?.y ?? NaN };
  }

  it('rings a right note round the note where it is printed', async () => {
    const { renderer, surface } = await twoBarsOpen();

    renderer.showPlayed({ stepIndex: 0, midi: 60, correct: true, offset: 0 });

    const [ring] = ringsOf(surface);
    expect(ring?.getAttribute('class')).toContain('played--correct');
    // Over the notes, in a drawing of ours over the page rather than inside
    // Verovio's: its stylesheet strokes every ring in there black.
    const page = sheets(surface)[0];
    expect(page?.querySelector('svg.score__over > g.played-overlay')).not.toBeNull();
    expect(page?.querySelector('svg')?.querySelector('.played-overlay')).toBeNull();
    // Placed in the page's units, as its notes were read: scaled to its pixels.
    const drawing = page?.querySelector('svg') as SVGSVGElement;
    const pixelsToAUnit = Number.parseFloat(drawing.getAttribute('width') ?? '0') / readThePage(drawing).width;
    const scaled = /scale\(([\d.eE+-]+)\)/.exec(
      page?.querySelector('svg.score__over > g.played-overlay')?.getAttribute('transform') ?? '',
    );
    expect(Number(scaled?.[1])).toBeCloseTo(pixelsToAUnit, 8);
    const c4 = headOf(surface, 'n0-1-0-0');
    expect(Number(ring?.getAttribute('cy'))).toBe(c4.y);
    // Round the head's middle, not its left edge where Verovio places it.
    expect(Number(ring?.getAttribute('cx'))).toBeGreaterThan(c4.x);
  });

  it('rings a note written an octave from where it sounds where it is drawn, and one outside the sign where it always was', async () => {
    // The pitch in the file is the sounding one and the page draws it an
    // octave away under an 8va: a mark placed by the pitch alone would ring
    // the empty staff an octave above the note.
    const stage = aStage();
    stage.renderer.setPaged(true);
    const written = twoBarExercise();
    const shifted = printed({
      ...written,
      octaveShifts: [
        {
          measureIndex: 0,
          offsetTicks: 0,
          untilMeasureIndex: 0,
          untilOffsetTicks: Duration.WHOLE.ticks,
          direction: 'down',
          size: 8,
          staffNumber: 1,
        },
      ],
      staves: written.staves.map((staff, at) =>
        at === 0
          ? {
              ...staff,
              measures: [
                bar(...['C6', 'D6', 'E6', 'F6'].map((name) => noteEntry(p(name), Duration.QUARTER))),
                ...staff.measures.slice(1),
              ],
            }
          : staff,
      ),
    });
    await stage.renderer.load(shifted.xml, shifted.steps);
    stage.renderer.configureOverlay(context);

    stage.renderer.showPlayed({ stepIndex: 0, midi: p('C6').midi, correct: true, offset: 0 });
    stage.renderer.showPlayed({ stepIndex: 4, midi: p('G4').midi, correct: true, offset: 0 });

    const [under, outside] = ringsOf(stage.surface);
    expect(Number(under?.getAttribute('cy'))).toBe(headOf(stage.surface, 'n0-1-0-0').y);
    expect(Number(outside?.getAttribute('cy'))).toBe(headOf(stage.surface, 'n1-1-0-0').y);
  });

  it('rings the left hand’s note on the bass staff, where it is printed', async () => {
    const { renderer, surface } = await twoBarsOpen();

    renderer.showPlayed({ stepIndex: 0, midi: 48, correct: true, offset: 0 });

    expect(Number(ringsOf(surface)[0]?.getAttribute('cy'))).toBe(headOf(surface, 'n0-2-0-0').y);
  });

  it('draws a wrong note on its own place on the staff, with its sharp and its ledger line', async () => {
    const { renderer, surface } = await twoBarsOpen();

    // C sharp over the C that was asked for: the same place on the staff, and
    // a sharp to say so.
    renderer.showPlayed({ stepIndex: 0, midi: 61, correct: false, offset: 0 });

    const page = sheets(surface)[0];
    const [ring] = ringsOf(surface);
    expect(ring?.getAttribute('class')).toContain('played--wrong');
    expect(Number(ring?.getAttribute('cy'))).toBe(headOf(surface, 'n0-1-0-0').y);
    expect(page?.querySelector('.played-overlay text.played-accidental')?.textContent).toBe('♯');
    expect(page?.querySelectorAll('.played-overlay line.played-ledger')).toHaveLength(1);
  });

  it('places a wrong note nobody printed by where it falls on the staff', async () => {
    // G4, two places above the E4 on the bottom line.
    const { renderer, surface } = await twoBarsOpen();
    const staff = readThePage(sheets(surface)[0]?.querySelector('svg') as SVGSVGElement).systems[0]?.bars[0]
      ?.staves[0];
    const halfSpace = (((staff?.lines[1] ?? 0) - (staff?.lines[0] ?? 0)) / 2);

    renderer.showPlayed({ stepIndex: 0, midi: 67, correct: false, offset: 0 });

    expect(Number(ringsOf(surface)[0]?.getAttribute('cy'))).toBe((staff?.bottom ?? NaN) - 2 * halfSpace);
  });

  it('places a wrong note right on a page that says one note over and over', async () => {
    // Pairs of different notes are how OSMD's pages were measured, and a page
    // of one repeated note has none. Verovio's lines say the distance anyway.
    const stage = aStage();
    const twoBars = twoBarExercise();
    const [treble, bass] = twoBars.staves;
    const same = printed({
      ...twoBars,
      staves: [
        {
          ...(treble as NonNullable<typeof treble>),
          measures: [
            bar(...Array.from({ length: 4 }, () => noteEntry(p('C4'), Duration.QUARTER))),
            bar(noteEntry(p('C4'), Duration.WHOLE)),
          ],
        },
        {
          ...(bass as NonNullable<typeof bass>),
          measures: [bar(noteEntry(p('C3'), Duration.WHOLE)), bar(noteEntry(p('C3'), Duration.WHOLE))],
        },
      ],
    });
    await stage.renderer.load(same.xml, same.steps);
    stage.renderer.configureOverlay(context);
    const staff = readThePage(sheets(stage.surface)[0]?.querySelector('svg') as SVGSVGElement).systems[0]
      ?.bars[0]?.staves[0];
    const halfSpace = ((staff?.lines[1] ?? 0) - (staff?.lines[0] ?? 0)) / 2;

    stage.renderer.showPlayed({ stepIndex: 0, midi: 67, correct: false, offset: 0 });

    expect(Number(ringsOf(stage.surface)[0]?.getAttribute('cy'))).toBe((staff?.bottom ?? NaN) - 2 * halfSpace);
  });

  it('leans a press played early towards the note before it', async () => {
    const { renderer, surface } = await twoBarsOpen();
    renderer.showPlayed({ stepIndex: 0, midi: 60, correct: true, offset: 0 });
    renderer.showPlayed({ stepIndex: 1, midi: 62, correct: true, offset: 0 });
    const [c4, d4] = ringsOf(surface).map((ring) => Number(ring.getAttribute('cx')));
    renderer.clearPlayed();

    renderer.showPlayed({ stepIndex: 1, midi: 62, correct: true, offset: -0.5 });

    const early = Number(ringsOf(surface)[0]?.getAttribute('cx'));
    expect(early).toBeLessThan(d4 ?? NaN);
    expect(early).toBeGreaterThan(c4 ?? NaN);
  });

  it('draws a right note of a beat not yet finished pale, until the beat is', async () => {
    const { renderer, surface } = await twoBarsOpen();

    renderer.showPlayed({ stepIndex: 0, midi: 60, correct: true, offset: 0, settled: false });
    expect(ringsOf(surface)[0]?.getAttribute('class')).toContain('played--unsettled');

    renderer.settlePlayed(0);
    expect(ringsOf(surface)[0]?.getAttribute('class')).not.toContain('played--unsettled');
  });

  it('takes one press off again, and leaves the others', async () => {
    const { renderer, surface } = await twoBarsOpen();
    renderer.showPlayed({ stepIndex: 0, midi: 60, correct: true, offset: 0 });
    renderer.showPlayed({ stepIndex: 0, midi: 62, correct: false, offset: 0 });

    renderer.hidePlayed({ stepIndex: 0, midi: 62 });

    expect(ringsOf(surface)).toHaveLength(1);
    expect(ringsOf(surface)[0]?.getAttribute('class')).toContain('played--correct');
  });

  it('clears every press, and a new layout does not bring them back', async () => {
    const { renderer, surface } = await twoBarsOpen();
    renderer.showPlayed({ stepIndex: 0, midi: 60, correct: true, offset: 0 });
    renderer.showPlayed({ stepIndex: 1, midi: 62, correct: true, offset: 0 });

    renderer.clearPlayed();
    expect(ringsOf(surface)).toHaveLength(0);

    await laidOutAgain(renderer, surface);
    expect(ringsOf(surface)).toHaveLength(0);
  });

  it('draws again on a new layout exactly what is left: nothing taken off, nothing unsettled that was settled', async () => {
    const { renderer, surface } = await twoBarsOpen();
    renderer.showPlayed({ stepIndex: 0, midi: 60, correct: true, offset: 0, settled: false });
    renderer.showPlayed({ stepIndex: 1, midi: 62, correct: true, offset: 0, settled: false });
    renderer.showPlayed({ stepIndex: 2, midi: 64, correct: true, offset: 0 });
    renderer.hidePlayed({ stepIndex: 2, midi: 64 });
    renderer.settlePlayed(0);

    await laidOutAgain(renderer, surface);

    const drawn = [...(sheets(surface)[0]?.querySelectorAll('.played-overlay ellipse') ?? [])].map(
      (ring) => [ring.getAttribute('data-mark'), ring.classList.contains('played--unsettled')],
    );
    expect(drawn).toEqual([
      ['0:60', false],
      ['1:62', true],
    ]);
  });

  it('leans a press from where its step’s first head stands, however a chord spreads them', async () => {
    // A chord with a second sets one head beside the other; the step stands
    // where the first of them is, which is where its marker stands too.
    const stage = aStage();
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
              noteEntry(p('E4'), Duration.QUARTER),
              noteEntry(p('F4'), Duration.QUARTER),
              noteEntry(p('G4'), Duration.QUARTER),
            ),
            ...(treble?.measures.slice(1) ?? []),
          ],
        },
        // A rest under it, so the chord's own heads are all this step draws.
        {
          ...(bass as NonNullable<typeof bass>),
          measures: [bar(restEntry(Duration.WHOLE)), ...(bass?.measures.slice(1) ?? [])],
        },
      ],
    });
    await stage.renderer.load(spread.xml, spread.steps);
    stage.renderer.configureOverlay(context);
    stage.renderer.showPlayed({ stepIndex: 1, midi: 64, correct: true, offset: 0 });
    const onTime = Number(ringsOf(stage.surface)[0]?.getAttribute('cx'));
    stage.renderer.clearPlayed();
    const heads = ['n0-1-0-0', 'n0-1-0-1'].map((id) => headOf(stage.surface, id).x);
    const step0 = Math.min(...heads);
    const step0Ring = onTime - (headOf(stage.surface, 'n0-1-1-0').x - step0);

    stage.renderer.showPlayed({ stepIndex: 1, midi: 64, correct: true, offset: -0.5 });

    expect(Number(ringsOf(stage.surface)[0]?.getAttribute('cx'))).toBeCloseTo((onTime + step0Ring) / 2, 5);
  });

  it('draws a press on a page drawn later, as though it had been drawn all along', async () => {
    const { renderer, surface } = await aPagedScore();
    renderer.configureOverlay(context);
    const late = LONG.steps.length - 2;
    const midi = LONG.steps[late]?.printed[0]?.midi ?? 60;

    renderer.showPlayed({ stepIndex: late, midi, correct: true, offset: 0 });
    renderer.turnPages(999);

    await whenDrawn(() => {
      expect(ringsOf(surface, renderer.pages.count - 1)).toHaveLength(1);
    });
  });

  it('draws the presses again on a new layout', async () => {
    const { renderer, surface } = await twoBarsOpen();
    renderer.showPlayed({ stepIndex: 0, midi: 60, correct: true, offset: 0 });

    renderer.setZoom(renderer.zoom * 1.3);

    await whenDrawn(() => {
      expect(ringsOf(surface)).toHaveLength(1);
      expect(Number(ringsOf(surface)[0]?.getAttribute('cy'))).toBe(headOf(surface, 'n0-1-0-0').y);
    });
  });
});

describe('what has been played past, and what the run will not ask for', () => {
  /** Two bars, both hands, opened in pages. */
  async function twoBarsOpen(): Promise<Stage> {
    const stage = aStage();
    stage.renderer.setPaged(true);
    const two = printed(twoBarExercise());
    await stage.renderer.load(two.xml, two.steps);
    return stage;
  }

  function classesOf(surface: HTMLElement, id: string): string {
    return surface.querySelector(`[id="${id}"]`)?.getAttribute('class') ?? '';
  }

  it('takes the notes of a step played past off the page, in both hands', async () => {
    const { renderer, surface } = await twoBarsOpen();

    renderer.fadePassed(0);

    expect(classesOf(surface, 'n0-1-0-0')).toContain('note--passed');
    expect(classesOf(surface, 'n0-2-0-0')).toContain('note--passed');
    expect(classesOf(surface, 'n0-1-1-0')).not.toContain('note--passed');
  });

  it('takes a note’s ledger line off with it', async () => {
    // Verovio draws ledger lines with the staff, not the note: left behind,
    // one would hang where middle C was.
    const { renderer, surface } = await twoBarsOpen();
    const ledger = surface
      .querySelector('[id="n0-1-0-0"]')
      ?.closest('g.staff')
      ?.querySelector('g.ledgerLines > path');
    expect(ledger).not.toBeNull();

    renderer.fadePassed(1);
    expect(ledger?.getAttribute('class') ?? '').not.toContain('note--passed');

    renderer.fadePassed(0);
    expect(ledger?.getAttribute('class')).toContain('note--passed');
  });

  it('takes a chord off whole, stem and all', async () => {
    // The stem is the chord's, not any one note's.
    const { renderer, surface } = await twoBarsOpen();

    renderer.fadePassed(4);

    const chord = surface.querySelector('[id="n1-2-0-0"]')?.parentElement;
    expect(chord?.getAttribute('class')).toContain('chord');
    expect(chord?.getAttribute('class')).toContain('note--passed');
  });

  describe('a beam and a tuplet', () => {
    /** Two groups of four beamed sixteenths, steps 0-3 and 4-7. */
    async function beamedOpen(): Promise<Stage> {
      const stage = aStage();
      stage.renderer.setPaged(true);
      const beamed = printed(beamedSixteenths());
      await stage.renderer.load(beamed.xml, beamed.steps);
      return stage;
    }

    /** Whether each beam's own lines have gone, in the order drawn. */
    function beamsGone(surface: HTMLElement): boolean[] {
      return [...surface.querySelectorAll('g.beam')].map((beam) => {
        const lines = [...beam.querySelectorAll(':scope > polygon')];
        expect(lines.length).toBeGreaterThan(0);
        return lines.every((line) => line.classList.contains('note--passed'));
      });
    }

    it('keeps a beam while it still joins a note that is showing', async () => {
      // Gone with its first note, it would strand the three it still joins.
      const { renderer, surface } = await beamedOpen();

      renderer.fadePassed(0);
      renderer.fadePassed(1);
      renderer.fadePassed(2);

      expect(beamsGone(surface)).toEqual([false, false]);
    });

    it('takes the beam once every note under it has gone, and leaves the next group’s', async () => {
      const { renderer, surface } = await beamedOpen();

      for (const step of [0, 1, 2, 3]) {
        renderer.fadePassed(step);
      }

      expect(beamsGone(surface)).toEqual([true, false]);
    });

    it('brings the beam back with the notes', async () => {
      const { renderer, surface } = await beamedOpen();
      for (const step of [0, 1, 2, 3]) {
        renderer.fadePassed(step);
      }

      renderer.clearFaded();

      expect(surface.querySelectorAll('.note--passed')).toHaveLength(0);
    });

    it('dims a beam with the hand it belongs to', async () => {
      const { renderer, surface } = await beamedOpen();

      renderer.dimUnplayed({ staves: [2], from: 0, to: 7 });

      const lines = [...surface.querySelectorAll('g.beam > polygon')];
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => line.classList.contains('note--unplayed'))).toBe(true);
    });

    it('takes a triplet’s number and bracket with its last note', async () => {
      const base = twoBarExercise();
      const three = Duration.of('eighth', 0, { actual: 3, normal: 2 });
      const triplet = printed({
        ...base,
        staves: base.staves.map((staff, at) =>
          at === 0
            ? {
                ...staff,
                measures: [
                  bar(
                    noteEntry(p('C4'), three),
                    noteEntry(p('D4'), three),
                    noteEntry(p('E4'), three),
                    noteEntry(p('F4'), Duration.DOTTED_HALF),
                  ),
                  ...staff.measures.slice(1),
                ],
              }
            : staff,
        ),
      });
      const stage = aStage();
      stage.renderer.setPaged(true);
      await stage.renderer.load(triplet.xml, triplet.steps);
      const ink = (): boolean[] =>
        [...stage.surface.querySelectorAll('g.tuplet > g.tupletNum, g.tuplet > g.tupletBracket')].map((each) =>
          each.classList.contains('note--passed'),
        );
      expect(ink()).toHaveLength(2);

      stage.renderer.fadePassed(0);
      stage.renderer.fadePassed(1);
      expect(ink()).toEqual([false, false]);

      stage.renderer.fadePassed(2);
      expect(ink()).toEqual([true, true]);
    });
  });

  it('puts them all back', async () => {
    const { renderer, surface } = await twoBarsOpen();
    renderer.fadePassed(0);
    renderer.fadePassed(1);

    renderer.clearFaded();

    expect(surface.querySelectorAll('.note--passed')).toHaveLength(0);
  });

  it('takes them off a page drawn later, as though it had been drawn all along', async () => {
    const { renderer, surface } = await aPagedScore();
    const late = LONG.steps.length - 2;
    const name = LONG.steps[late]?.printed[0]?.id ?? '';

    renderer.fadePassed(late);
    renderer.turnPages(999);

    await whenDrawn(() => {
      expect(classesOf(surface, name)).toContain('note--passed');
    });
  });

  it('dims the hand not being read', async () => {
    const { renderer, surface } = await twoBarsOpen();

    renderer.dimUnplayed({ staves: [1], from: 0, to: 99 });

    expect(classesOf(surface, 'n0-2-0-0')).toContain('note--unplayed');
    expect(classesOf(surface, 'n0-1-0-0')).not.toContain('note--unplayed');
  });

  it('dims what is outside the passage, and undims it again', async () => {
    const { renderer, surface } = await twoBarsOpen();

    renderer.dimUnplayed({ staves: [], from: 2, to: 3 });
    expect(classesOf(surface, 'n0-1-0-0')).toContain('note--unplayed');
    expect(classesOf(surface, 'n0-1-2-0')).not.toContain('note--unplayed');
    // Both ends are the passage's own.
    expect(classesOf(surface, 'n0-1-3-0')).not.toContain('note--unplayed');
    expect(classesOf(surface, 'n1-1-0-0')).toContain('note--unplayed');

    renderer.dimUnplayed(null);
    expect(surface.querySelectorAll('.note--unplayed')).toHaveLength(0);
  });

  it('dims a page drawn later as well', async () => {
    const { renderer, surface } = await aPagedScore();
    const late = LONG.steps.length - 2;
    const name = LONG.steps[late]?.printed[0]?.id ?? '';

    renderer.dimUnplayed({ staves: [], from: 0, to: 3 });
    renderer.turnPages(999);

    await whenDrawn(() => {
      expect(classesOf(surface, name)).toContain('note--unplayed');
    });
  });
});

describe('a step the reader keeps missing', () => {
  it('says on the surface how often, up to four', async () => {
    const { renderer, surface } = await aPagedScore();

    renderer.showTrouble(2);
    expect(surface.dataset['trouble']).toBe('2');

    renderer.showTrouble(9);
    expect(surface.dataset['trouble']).toBe('4');

    renderer.showTrouble(0);
    expect(surface.dataset['trouble']).toBeUndefined();
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

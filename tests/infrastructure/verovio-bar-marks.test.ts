// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { rulerMarks, type RulerMark } from '../../src/application/rhythmRuler.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { barId, measureIndexOfBar } from '../../src/domain/notation/printedIds.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { readThePage, type PageLayout } from '../../src/infrastructure/rendering/verovio/pageLayout.js';
import { elementAt } from '../../src/shared/asserts.js';
import { twoBarExercise } from '../support/fixtures.js';
import { laidOutAt, printed, sheets, verovioStages, whenDrawn, type Printed, type Stage } from '../support/verovioStage.js';

/**
 * What the page says about a bar beyond its notes, under Verovio: which bar
 * of the playing it is, whether it is a second reading of one already
 * printed, and where its beats fall.
 */
const { aStage } = verovioStages();

/**
 * A grand staff of as many bars as asked for, the two fixture bars over and
 * over, with the bar labels given.
 */
function grandStaff(bars: number, barLabels: Exercise['barLabels'] = []): Exercise {
  const base = twoBarExercise();
  return {
    ...base,
    barLabels,
    staves: base.staves.map((staff) => ({
      ...staff,
      measures: Array.from({ length: bars }, (_, at) => elementAt(staff.measures, at % staff.measures.length)),
    })),
  };
}

/**
 * Twelve bars, bars five to eight again, and eight more: a repeat written
 * out, so the second reading keeps the first's numbers and every bar after it
 * is further into the playing than its number says.
 */
const REPEATED = grandStaff(
  24,
  Array.from({ length: 24 }, (_, at) =>
    at < 12
      ? { number: at + 1, repeated: false }
      : at < 16
        ? { number: at - 7, repeated: true }
        : { number: at - 3, repeated: false },
  ),
);
const REPEATED_PRINTED = printed(REPEATED);

async function aScore(score: Printed): Promise<Stage> {
  const stage = aStage();
  stage.renderer.setPaged(true);
  await stage.renderer.load(score.xml, score.steps);
  return stage;
}

function drawingOf(surface: HTMLElement, page: number): SVGSVGElement {
  const drawing = sheets(surface)[page]?.querySelector('svg');
  if (drawing === null || drawing === undefined) {
    throw new Error(`Page ${String(page)} is not drawn.`);
  }
  return drawing;
}

/** A drawn page read by our own reader, and its pixels to a unit. */
function readingOf(surface: HTMLElement, page: number): { layout: PageLayout; scale: number } {
  const drawing = drawingOf(surface, page);
  const layout = readThePage(drawing);
  return { layout, scale: Number.parseFloat(drawing.getAttribute('width') ?? '0') / layout.width };
}

/**
 * What the number printed over a bar says, as the reader sees it: the
 * figures Verovio sets at a size, inside a text that is itself of no size.
 */
function numberOver(surface: HTMLElement, page: number, measureIndex: number): string | null {
  const bar = drawingOf(surface, page).querySelector(`g.measure#${barId(measureIndex)}`);
  const figures = bar?.querySelector(':scope > g.mNum tspan[font-size]');
  return figures === null || figures === undefined ? null : (figures.textContent ?? '').trim();
}

function markOver(surface: HTMLElement, measureIndex: number): SVGGElement | null {
  return surface.querySelector<SVGGElement>(`g.bar-mark[data-bar="${String(measureIndex)}"]`);
}

describe('the numbers over the bars', () => {
  it('prints one over every second bar, as the page always had', async () => {
    const { surface } = await aScore(printed(grandStaff(8)));

    const numbered = [...drawingOf(surface, 0).querySelectorAll('g.measure')]
      .filter((bar) => bar.querySelector(':scope > g.mNum') !== null)
      .map((bar) => measureIndexOfBar(bar.id));
    expect(numbered).toEqual([1, 3, 5, 7]);
  });

  it('calls a bar by its place in the playing where the number written on it is not that', async () => {
    // The hold, the markers and the boxes all count the playing, so the page
    // does too.
    const { surface } = await aScore(REPEATED_PRINTED);

    expect(numberOver(surface, 0, 1)).toBe('2');
    expect(numberOver(surface, 0, 13)).toBe('14');
    expect(numberOver(surface, 0, 17)).toBe('18');
  });

  it('puts the writer’s number on the line above a bar read twice, and the turning arrow after it', async () => {
    const { renderer, surface } = await aScore(REPEATED_PRINTED);

    renderer.showRepeatedBars([12, 13, 14, 15]);

    const mark = markOver(surface, 13);
    const written = mark?.querySelector('text.bar-printed');
    expect(written?.textContent).toBe('6');
    const { layout, scale } = readingOf(surface, 0);
    const number = layout.systems.flatMap((system) => system.bars).find((bar) => bar.id === barId(13))?.number;
    expect(number).toBeDefined();
    const writtenY = Number.parseFloat(written?.getAttribute('y') ?? 'NaN');
    expect(writtenY).toBeLessThan((number?.y ?? NaN) * scale - (number?.size ?? NaN) * scale * 0.5);
    // After the number it stands over, as an exponent sits.
    const ring = mark?.querySelector('.repeat-mark__ring')?.getAttribute('d') ?? '';
    const ringX = Number(/^M\s*(-?[\d.]+)/.exec(ring)?.[1]);
    expect(ringX).toBeGreaterThan(Number.parseFloat(written?.getAttribute('x') ?? 'NaN'));
  });

  it('marks only the bars read twice, and only where a number is printed over them', async () => {
    const { renderer, surface } = await aScore(REPEATED_PRINTED);

    renderer.showRepeatedBars([12, 13, 14, 15]);

    const marked = [...surface.querySelectorAll('g.bar-mark')].map((mark) => Number(mark.getAttribute('data-bar')));
    expect(marked).toEqual([13, 15]);
  });

  it('marks a bar read twice without a word above it where its number and place agree', async () => {
    // Numbered by its place already, it has no second number to give - only
    // the arrow saying it has been read before.
    const labels = Array.from({ length: 8 }, (_, at) => ({ number: at + 1, repeated: at === 3 }));
    const { renderer, surface } = await aScore(printed(grandStaff(8, labels)));

    renderer.showRepeatedBars([3]);

    const mark = markOver(surface, 3);
    expect(mark?.querySelector('g.repeat-mark')).not.toBeNull();
    expect(mark?.querySelector('text.bar-printed')).toBeNull();
  });

  it('takes the marks off, and keeps calling the bars by their places', async () => {
    const { renderer, surface } = await aScore(REPEATED_PRINTED);
    renderer.showRepeatedBars([12, 13, 14, 15]);

    renderer.showRepeatedBars([]);

    expect(surface.querySelectorAll('g.bar-mark')).toHaveLength(0);
    expect(numberOver(surface, 0, 13)).toBe('14');
  });

  it('marks them again on the pages of a new layout', async () => {
    const { renderer, surface } = await aScore(REPEATED_PRINTED);
    renderer.showRepeatedBars([12, 13, 14, 15]);

    await laidOutAt(renderer, surface, 0.5);

    const page = sheets(surface).findIndex((sheet) => sheet.querySelector('g.bar-mark') !== null);
    expect(page).toBeGreaterThanOrEqual(0);
    expect(numberOver(surface, page, 13)).toBe('14');
  });
});

describe('the rhythm ruler', () => {
  //   treble: C4 D4 E4 F4 | G4 (whole)
  //   bass:   C3 (whole)  | [G2 D3] (half) + half rest
  const EIGHT = grandStaff(8);
  const EIGHT_PRINTED = printed(EIGHT);
  const QUARTERS = rulerMarks(buildTimeline(EIGHT), 'quarter');

  function lines(surface: HTMLElement, page = 0): { x: number; top: number; bottom: number; weight: string }[] {
    return [...(sheets(surface)[page]?.querySelectorAll('g.rhythm-ruler line') ?? [])].map((line) => ({
      x: Number.parseFloat(line.getAttribute('x1') ?? 'NaN'),
      top: Number.parseFloat(line.getAttribute('y1') ?? 'NaN'),
      bottom: Number.parseFloat(line.getAttribute('y2') ?? 'NaN'),
      weight: /ruler-line--(\w+)/.exec(line.getAttribute('class') ?? '')?.[1] ?? '',
    }));
  }

  /** Where a step's heads stand across the page, in its pixels: the leftmost's middle. */
  function stepX(surface: HTMLElement, stepIndex: number): number {
    const { layout, scale } = readingOf(surface, 0);
    const step = elementAt(EIGHT_PRINTED.steps, stepIndex);
    const heads = step.printed.map((here) => layout.heads.get(here.id)?.x).filter((x): x is number => x !== undefined);
    const [top, second] = layout.systems[0]?.bars[0]?.staves[0]?.lines ?? [];
    const space = (second ?? NaN) - (top ?? NaN);
    return (Math.min(...heads) + 0.59 * space) * scale;
  }

  /** A bar's ruled line, counted from its downbeat. */
  function markAt(bar: number, beat: number): RulerMark {
    return elementAt(
      QUARTERS.filter((mark) => mark.bar === bar),
      beat,
    );
  }

  it('rules a line for every beat of every bar on the page, top staff to bottom staff', async () => {
    const { renderer, surface } = await aScore(EIGHT_PRINTED);

    renderer.showRhythmRuler(QUARTERS);

    const { layout, scale } = readingOf(surface, 0);
    const ruled = lines(surface);
    expect(ruled).toHaveLength(QUARTERS.length);
    const system = elementAt(layout.systems, 0);
    for (const line of ruled.slice(0, 4)) {
      expect(line.top).toBeCloseTo(system.top * scale, 5);
      expect(line.bottom).toBeCloseTo(system.bottom * scale, 5);
    }
    expect(ruled[0]?.weight).toBe('downbeat');
    expect(ruled[1]?.weight).toBe('beat');
  });

  it('stands a line that falls on a note on that note', async () => {
    const { renderer, surface } = await aScore(EIGHT_PRINTED);

    renderer.showRhythmRuler([QUARTERS[1] as RulerMark]);

    expect(lines(surface)[0]?.x).toBeCloseTo(stepX(surface, 1), 5);
  });

  it('reckons a line that falls between two notes by how far between them it falls', async () => {
    // Bar two holds a whole note over a half and a half rest: its second beat
    // is halfway from the first step of the bar to the second.
    const { renderer, surface } = await aScore(EIGHT_PRINTED);
    const second = markAt(1, 1);
    expect(second.fraction).toBeCloseTo(0.5, 5);

    renderer.showRhythmRuler([second]);

    expect(lines(surface)[0]?.x).toBeCloseTo((stepX(surface, 4) + stepX(surface, 5)) / 2, 5);
  });

  it('reckons the last line of a bar towards its bar line, not across it', async () => {
    const { renderer, surface } = await aScore(EIGHT_PRINTED);
    const fourth = markAt(1, 3);
    expect(fourth.toStep).toBeNull();

    renderer.showRhythmRuler([fourth]);

    const { layout, scale } = readingOf(surface, 0);
    const right = (layout.systems[0]?.bars[1]?.right ?? NaN) * scale;
    expect(lines(surface)[0]?.x).toBeCloseTo(stepX(surface, 5) + (right - stepX(surface, 5)) * fourth.fraction, 5);
  });

  it('rules nothing between two notes on different systems', async () => {
    const { renderer, surface } = await aScore(printed(grandStaff(40)));
    const { layout } = readingOf(surface, 0);
    const steps = printed(grandStaff(40)).steps;
    const lastOfFirst = layout.systems[0]?.bars.at(-1)?.id;
    const from = steps.map((step) => step.barId).lastIndexOf(lastOfFirst ?? '');
    expect(from).toBeGreaterThan(0);

    renderer.showRhythmRuler([{ fromStep: from, toStep: from + 1, fraction: 0.5, weight: 'beat', ticks: 0, bar: 0 }]);

    expect(lines(surface)).toHaveLength(0);
  });

  it('is drawn in the drawing under the music', async () => {
    const { renderer, surface } = await aScore(EIGHT_PRINTED);

    renderer.showRhythmRuler(QUARTERS);

    const page = sheets(surface)[0];
    expect(page?.querySelectorAll('svg.score__under > g.rhythm-ruler line')).toHaveLength(QUARTERS.length);
    expect(drawingOf(surface, 0).querySelector('.rhythm-ruler')).toBeNull();
  });

  it('is taken away', async () => {
    const { renderer, surface } = await aScore(EIGHT_PRINTED);
    renderer.showRhythmRuler(QUARTERS);

    renderer.showRhythmRuler([]);

    expect(lines(surface)).toHaveLength(0);
  });

  it('is ruled on a page drawn later, and again on a new layout', async () => {
    const long = grandStaff(60);
    const marks = rulerMarks(buildTimeline(long), 'quarter');
    const { renderer, surface } = await aScore(printed(long));
    renderer.showRhythmRuler(marks);
    expect(lines(surface, 2)).toHaveLength(0);

    renderer.turnPages(1);
    await whenDrawn(() => {
      expect(lines(surface, 2).length).toBeGreaterThan(0);
    });

    await laidOutAt(renderer, surface, 0.5);
    expect(lines(surface, renderer.pages.at).length).toBeGreaterThan(0);
  });

  describe('the beat', () => {
    function beats(surface: HTMLElement, page = 0): number[] {
      return [...(sheets(surface)[page]?.querySelectorAll('g.ruler-beat-mark line') ?? [])].map((line) =>
        Number.parseFloat(line.getAttribute('x1') ?? 'NaN'),
      );
    }

    it('stands on the line the music has reached, and moves on with it', async () => {
      const { renderer, surface } = await aScore(EIGHT_PRINTED);
      renderer.showRhythmRuler(QUARTERS);
      const ruled = lines(surface);

      renderer.showBeat(QUARTERS[1] ?? null);
      expect(beats(surface)).toEqual([ruled[1]?.x]);

      renderer.showBeat(QUARTERS[2] ?? null);
      expect(beats(surface)).toEqual([ruled[2]?.x]);

      renderer.showBeat(null);
      expect(beats(surface)).toEqual([]);
    });

    it('is drawn between the ruler and the music, in the weight of its line', async () => {
      const { renderer, surface } = await aScore(EIGHT_PRINTED);

      renderer.showBeat(QUARTERS[0] ?? null);

      // Over the ruler, and under the music.
      const under = sheets(surface)[0]?.querySelector('svg.score__under');
      const layers = [...(under?.children ?? [])].map((child) => child.getAttribute('class'));
      expect(layers).toEqual(['rhythm-ruler', 'ruler-beat-mark']);
      expect(under?.querySelector('g.ruler-beat-mark line')?.getAttribute('class')).toBe('ruler-beat ruler-beat--downbeat');
    });

    it('stands on the page its step is on, and comes back with that page', async () => {
      const long = grandStaff(60);
      const marks = rulerMarks(buildTimeline(long), 'quarter');
      const { renderer, surface } = await aScore(printed(long));
      const onPageTwo = marks.find((mark) => mark.bar === 59);

      renderer.showBeat(onPageTwo ?? null);
      expect(surface.querySelectorAll('g.ruler-beat-mark line')).toHaveLength(0);

      renderer.turnPages(1);
      await whenDrawn(() => {
        expect(beats(surface, 2)).toHaveLength(1);
      });
    });
  });
});

// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { DrawnPassage } from '../../src/application/ports/IScoreRenderer.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { measureIndexOfBar } from '../../src/domain/notation/printedIds.js';
import { readThePage } from '../../src/infrastructure/rendering/verovio/pageLayout.js';
import { elementAt } from '../../src/shared/asserts.js';
import { twoBarExercise } from '../support/fixtures.js';
import { laidOutAt, printed, sheets, verovioStages, whenDrawn, type Printed, type Stage } from '../support/verovioStage.js';

/**
 * What is drawn over the music to be read and taken hold of, under Verovio:
 * the passage markers, the start of the run and the hand switches, and what
 * a finger does to them.
 *
 * Where each belongs is arithmetic tested on its own (`passageBrackets`);
 * this is the half that says the arithmetic is fed what Verovio drew, on the
 * page it drew it on - a bar read off the wrong page, or a staff off the
 * wrong system, looks exactly like a working feature until it is on a page.
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

const SHORT = printed(grandStaff(8));
const LONG = printed(grandStaff(60));

async function aScore(score: Printed, paged = true): Promise<Stage> {
  const stage = aStage();
  stage.renderer.setPaged(paged);
  await stage.renderer.load(score.xml, score.steps);
  showWhole(stage.surface);
  return stage;
}

/**
 * Shows every drawn page at exactly the size it was drawn, with its corner
 * at the corner of the screen - which jsdom, laying nothing out, will not.
 */
function showWhole(surface: HTMLElement): void {
  for (const sheet of sheets(surface)) {
    const drawing = sheet.querySelector('svg');
    if (drawing !== null) {
      const width = Number.parseFloat(drawing.getAttribute('width') ?? '0');
      const height = Number.parseFloat(drawing.getAttribute('height') ?? '0');
      drawing.getBoundingClientRect = () => ({ left: 0, top: 0, width, height }) as DOMRect;
    }
  }
}

interface BarOnScreen {
  readonly measureIndex: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** A drawn page's bars, in its pixels, read off the page by our own reader. */
function barsOn(surface: HTMLElement, page: number): BarOnScreen[] {
  const drawing = sheets(surface)[page]?.querySelector('svg');
  if (drawing === null || drawing === undefined) {
    return [];
  }
  const layout = readThePage(drawing);
  const scale = Number.parseFloat(drawing.getAttribute('width') ?? '0') / layout.width;
  return layout.systems.flatMap((system) =>
    system.bars.map((bar) => ({
      measureIndex: measureIndexOfBar(bar.id) ?? -1,
      left: bar.left * scale,
      right: bar.right * scale,
      top: system.top * scale,
      bottom: system.bottom * scale,
    })),
  );
}

function barOn(surface: HTMLElement, page: number, measureIndex: number): BarOnScreen {
  const found = barsOn(surface, page).find((bar) => bar.measureIndex === measureIndex);
  if (found === undefined) {
    throw new Error(`Bar ${String(measureIndex)} is not drawn on page ${String(page)}.`);
  }
  return found;
}

function markers(within: Element | undefined): SVGGElement[] {
  return [...(within?.querySelectorAll<SVGGElement>('g.passage-marker') ?? [])];
}

/** A marker's line, as the numbers it was drawn with. */
function lineOf(marker: Element | undefined): { x: number; top: number; bottom: number } {
  const rect = marker?.querySelector('rect.passage-marker__bar');
  const width = Number.parseFloat(rect?.getAttribute('width') ?? 'NaN');
  const y = Number.parseFloat(rect?.getAttribute('y') ?? 'NaN');
  return {
    x: Number.parseFloat(rect?.getAttribute('x') ?? 'NaN') + width / 2,
    top: y,
    bottom: y + Number.parseFloat(rect?.getAttribute('height') ?? 'NaN'),
  };
}

function centreOf(circle: Element | null | undefined): { x: number; y: number } {
  return {
    x: Number.parseFloat(circle?.getAttribute('cx') ?? 'NaN'),
    y: Number.parseFloat(circle?.getAttribute('cy') ?? 'NaN'),
  };
}

function finger(target: Element | null | undefined, type: string, x: number, y: number): void {
  target?.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
}

/** Lands and lifts without moving. */
function tap(target: Element | null | undefined, x: number, y: number): void {
  finger(target, 'pointerdown', x, y);
  finger(target, 'pointerup', x, y);
}

/**
 * Lands and stays put long enough to be pointing, then lifts.
 *
 * The clock is faked round the gesture rather than the test waiting half a
 * second: the hold is a timer, and a suite that slept for every one of them
 * would spend longer waiting than engraving.
 */
function hold(target: Element | null | undefined, x: number, y: number): void {
  vi.useFakeTimers();
  try {
    finger(target, 'pointerdown', x, y);
    vi.advanceTimersByTime(600);
    finger(target, 'pointerup', x, y);
  } finally {
    vi.useRealTimers();
  }
}

function listen(stage: Stage): { passages: DrawnPassage[]; bars: number[]; ends: string[]; taps: number } {
  const heard = { passages: [] as DrawnPassage[], bars: [] as number[], ends: [] as string[], taps: 0 };
  stage.renderer.onPassageDragged((passage) => heard.passages.push(passage));
  stage.renderer.onBarHeld((measureIndex) => heard.bars.push(measureIndex));
  stage.renderer.onMarkerHeld((end) => heard.ends.push(end));
  stage.renderer.onScoreTapped(() => {
    heard.taps += 1;
  });
  return heard;
}

describe('the passage markers', () => {
  it('draws nothing until a passage is given', async () => {
    const { surface } = await aScore(SHORT);

    expect(markers(surface)).toHaveLength(0);
  });

  it('stands one on the bar line before the passage and one on the bar line after it, across both staves', async () => {
    const { renderer, surface } = await aScore(SHORT);

    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 3 });

    const [start, end] = markers(surface);
    expect(start?.getAttribute('data-edge')).toBe('start');
    expect(end?.getAttribute('data-edge')).toBe('end');
    const first = barOn(surface, 0, 1);
    const last = barOn(surface, 0, 3);
    expect(lineOf(start).x).toBeCloseTo(first.left, 5);
    expect(lineOf(end).x).toBeCloseTo(last.right, 5);
    // Top line of the treble to bottom line of the bass.
    expect(lineOf(start).top).toBeCloseTo(first.top, 5);
    expect(lineOf(start).bottom).toBeCloseTo(first.bottom, 5);
  });

  it('draws each on the page its bar is on, and none on a page that does not hold it', async () => {
    // Only the pages near the reader are drawn. A passage running on to a
    // page far ahead has its end there, not at the last bar that happens to
    // be drawn - which is where the edge of the music would put it.
    const { renderer, surface } = await aScore(LONG);
    const lastBar = 59;

    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: lastBar });

    expect(markers(sheets(surface)[0]).map((marker) => marker.getAttribute('data-edge'))).toEqual(['start']);
    expect(markers(sheets(surface)[1])).toHaveLength(0);

    renderer.turnPages(renderer.pages.count - 1);
    const lastPage = renderer.pages.count - 1;
    await whenDrawn(() => {
      expect(markers(sheets(surface)[lastPage]).map((marker) => marker.getAttribute('data-edge'))).toEqual(['end']);
    });
    expect(lineOf(markers(sheets(surface)[lastPage])[0]).x).toBeCloseTo(barOn(surface, lastPage, lastBar).right, 5);
  });

  it('waits at the end of the piece when the passage reaches past it', async () => {
    // Where a drag widening the passage ends up.
    const { renderer, surface } = await aScore(SHORT);

    renderer.showPassage({ fromMeasureIndex: -4, toMeasureIndex: 40 });

    const [start, end] = markers(surface);
    expect(lineOf(start).x).toBeCloseTo(barOn(surface, 0, 0).left, 5);
    expect(lineOf(end).x).toBeCloseTo(barOn(surface, 0, 7).right, 5);
  });

  it('grows the dots of a repeat bar line when the passage plays round, facing into it', async () => {
    const { renderer, surface } = await aScore(SHORT);

    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2, repeating: true });

    const [start, end] = markers(surface);
    const dots = (marker: Element | undefined): number[] =>
      [...(marker?.querySelectorAll('circle.passage-marker__dot') ?? [])].map((dot) => centreOf(dot).x);
    expect(dots(start)).toHaveLength(2);
    expect(Math.min(...dots(start))).toBeGreaterThan(lineOf(start).x);
    expect(Math.max(...dots(end))).toBeLessThan(lineOf(end).x);

    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });
    expect(surface.querySelectorAll('circle.passage-marker__dot')).toHaveLength(0);
  });

  it('draws them in a drawing of ours over the page, the page’s size, and not inside Verovio’s', async () => {
    // Verovio's page carries a stylesheet that strokes every shape in it:
    // inside it, the area a marker is taken hold of by came out as a box.
    const { renderer, surface } = await aScore(SHORT);

    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });
    renderer.showHands([1, 2]);

    const page = elementAt(sheets(surface), 0);
    const verovio = page.querySelector('svg');
    const over = page.querySelector('svg.score__over');
    expect(over?.querySelectorAll('g.passage-marker')).toHaveLength(2);
    expect(over?.querySelectorAll('g.hand-switch').length).toBeGreaterThan(0);
    expect(verovio?.querySelector('.passage-marker, .hand-switch')).toBeNull();
    expect([over?.getAttribute('width'), over?.getAttribute('height')]).toEqual([
      verovio?.getAttribute('width'),
      verovio?.getAttribute('height'),
    ]);
  });

  it('takes them away again', async () => {
    const { renderer, surface } = await aScore(SHORT);
    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });

    renderer.hidePassage();

    expect(markers(surface)).toHaveLength(0);
  });

  it('stands them again on the pages of a new layout', async () => {
    // A zoom throws every page away and everything drawn on it. The passage
    // is not a thing that should vanish because the reader made the notes
    // bigger.
    const { renderer, surface } = await aScore(SHORT);
    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });
    const before = lineOf(markers(surface)[0]).x;

    renderer.setZoom(renderer.zoom * 1.5);

    await whenDrawn(() => {
      const [start] = markers(surface);
      expect(start).toBeDefined();
      expect(lineOf(start).x).not.toBeCloseTo(before, 0);
    });
    const page = sheets(surface).findIndex((sheet) => markers(sheet).length > 0);
    expect(lineOf(markers(surface)[0]).x).toBeCloseTo(barOn(surface, page, 1).left, 5);
  });

  it('marks the bar the music will start from, quietly, and only with the passage', async () => {
    // A sign and not a control: nothing to take hold of.
    const { renderer, surface } = await aScore(SHORT);
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 5 });

    renderer.showStart(2);

    const mark = surface.querySelector('g.start-marker');
    expect(mark?.querySelectorAll('circle')).toHaveLength(0);
    const line = mark?.querySelector('rect.start-marker__bar');
    const x =
      Number.parseFloat(line?.getAttribute('x') ?? 'NaN') + Number.parseFloat(line?.getAttribute('width') ?? 'NaN') / 2;
    expect(x).toBeCloseTo(barOn(surface, 0, 2).left, 5);

    renderer.hidePassage();
    expect(surface.querySelector('g.start-marker')).toBeNull();

    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 5 });
    renderer.showStart(null);
    expect(surface.querySelector('g.start-marker')).toBeNull();
  });
});

describe('a finger on the markers', () => {
  it('moves the passage a bar out from the top handle, and a bar in from the bottom one', async () => {
    const stage = await aScore(SHORT);
    const heard = listen(stage);
    stage.renderer.showPassage({ fromMeasureIndex: 2, toMeasureIndex: 4 });

    const [start] = markers(stage.surface);
    const top = centreOf(start?.querySelector('circle.passage-marker__grip--top'));
    tap(stage.surface, top.x, top.y);
    // And the passage moved is the one drawn now.
    const [moved] = markers(stage.surface);
    const bottom = centreOf(moved?.querySelector('circle.passage-marker__grip--bottom'));
    tap(stage.surface, bottom.x, bottom.y);

    expect(heard.passages.map((each) => [each.fromMeasureIndex, each.toMeasureIndex])).toEqual([
      [1, 4],
      [2, 4],
    ]);
    // A handle pressed is not a touch on the music.
    expect(heard.taps).toBe(0);
  });

  it('answers a tap on the handle itself, whatever the coordinates say', async () => {
    // The browser has already worked out what the finger landed on; the
    // coordinates here are nowhere near the handle.
    const stage = await aScore(SHORT);
    const heard = listen(stage);
    stage.renderer.showPassage({ fromMeasureIndex: 2, toMeasureIndex: 4 });

    const [, end] = markers(stage.surface);
    tap(end?.querySelector('circle.passage-marker__grip--top'), 9_999, 9_999);
    const [start] = markers(stage.surface);
    tap(start?.querySelector('circle.passage-marker__grip--bottom'), 9_999, 9_999);

    expect(heard.passages.map((each) => [each.fromMeasureIndex, each.toMeasureIndex])).toEqual([
      [2, 5],
      [3, 5],
    ]);
  });

  it('drags a marker to the bar line it is let go over, keeping what the passage was', async () => {
    const stage = await aScore(SHORT);
    const heard = listen(stage);
    stage.renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 5, repeating: true });
    const [, end] = markers(stage.surface);
    const line = lineOf(end);
    const target = barOn(stage.surface, 0, 2);

    finger(end, 'pointerdown', line.x, (line.top + line.bottom) / 2);
    finger(stage.surface, 'pointermove', target.right - 4, target.top + 10);
    // Drawn where it is being taken, before it is let go.
    expect(lineOf(markers(stage.surface)[1]).x).toBeCloseTo(target.right, 5);
    finger(stage.surface, 'pointerup', target.right - 4, target.top + 10);

    expect(heard.passages).toEqual([{ fromMeasureIndex: 0, toMeasureIndex: 2, repeating: true }]);
  });

  it('puts the marker back where it was when the browser takes the touch away', async () => {
    const stage = await aScore(SHORT);
    const heard = listen(stage);
    stage.renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 5 });
    const [, end] = markers(stage.surface);
    const line = lineOf(end);
    const target = barOn(stage.surface, 0, 2);

    finger(end, 'pointerdown', line.x, (line.top + line.bottom) / 2);
    finger(stage.surface, 'pointermove', target.right - 4, target.top + 10);
    finger(stage.surface, 'pointercancel', target.right - 4, target.top + 10);

    expect(lineOf(markers(stage.surface)[1]).x).toBeCloseTo(line.x, 5);
    finger(stage.surface, 'pointerup', target.right - 4, target.top + 10);
    expect(heard.passages).toEqual([]);
  });

  it('is being dragged once it has moved, and does not go off as a hold as well', async () => {
    const stage = await aScore(SHORT);
    const heard = listen(stage);
    stage.renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 5 });
    const [, end] = markers(stage.surface);
    const line = lineOf(end);
    const target = barOn(stage.surface, 0, 2);

    vi.useFakeTimers();
    try {
      finger(end, 'pointerdown', line.x, (line.top + line.bottom) / 2);
      finger(stage.surface, 'pointermove', target.right - 4, target.top + 10);
      vi.advanceTimersByTime(600);
      finger(stage.surface, 'pointerup', target.right - 4, target.top + 10);
    } finally {
      vi.useRealTimers();
    }

    expect(heard.ends).toEqual([]);
    expect(heard.passages.map((each) => each.toMeasureIndex)).toEqual([2]);
  });

  it('turns the page when a marker is dragged off the side of it', async () => {
    const stage = await aScore(LONG);
    stage.renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 2 });
    const [, end] = markers(stage.surface);
    const line = lineOf(end);
    const lastOnPage = barsOn(stage.surface, 0).at(-1) as BarOnScreen;
    const width = Number.parseFloat(sheets(stage.surface)[0]?.querySelector('svg')?.getAttribute('width') ?? 'NaN');

    finger(end, 'pointerdown', line.x, (line.top + line.bottom) / 2);
    // Along the last system, and into the margin past its last bar.
    finger(stage.surface, 'pointermove', width - 2, lastOnPage.top + 10);

    expect(stage.renderer.pages.at).toBe(1);
  });

  it('says when a finger is held on a marker, and neither moves the passage nor points at a bar', async () => {
    const stage = await aScore(SHORT);
    const heard = listen(stage);
    stage.renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 3 });
    const [, end] = markers(stage.surface);
    const line = lineOf(end);

    hold(end, line.x, (line.top + line.bottom) / 2);

    expect(heard.ends).toEqual(['to']);
    expect(heard.bars).toEqual([]);
    // Letting go afterwards must not nudge the passage a bar: the reader did not tap.
    expect(heard.passages).toEqual([]);
  });

  it('cannot be taken hold of while a run is being played', async () => {
    // A run is being graded: a passage moved halfway through makes the report
    // a report of nothing in particular. Not by the handle, which is not
    // drawn, and not by landing beside the line either.
    const stage = await aScore(SHORT);
    const heard = listen(stage);
    stage.renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 3, movable: false });
    const [start] = markers(stage.surface);
    expect(start?.getAttribute('data-locked')).toBe('true');
    expect(start?.querySelectorAll('circle.passage-marker__grip')).toHaveLength(0);
    const line = lineOf(start);
    const far = barOn(stage.surface, 0, 5);

    finger(stage.surface, 'pointerdown', line.x + 3, line.top + 5);
    finger(stage.surface, 'pointermove', far.left + 4, line.top + 5);
    finger(stage.surface, 'pointerup', far.left + 4, line.top + 5);

    expect(heard.passages).toEqual([]);
  });
});

describe('a finger on the music', () => {
  it('points at the bar it is held on, wherever in it that is', async () => {
    const stage = await aScore(SHORT);
    const heard = listen(stage);
    const second = barOn(stage.surface, 0, 1);

    // Above the staff, in the middle of the bar, nowhere near a note.
    hold(stage.surface, (second.left + second.right) / 2, second.top - 20);

    expect(heard.bars).toEqual([1]);
    expect(heard.taps).toBe(0);
  });

  it('points at nothing once the renderer has been let go of', async () => {
    const stage = await aScore(SHORT);
    const heard = listen(stage);
    const second = barOn(stage.surface, 0, 1);

    vi.useFakeTimers();
    try {
      finger(stage.surface, 'pointerdown', (second.left + second.right) / 2, second.top - 20);
      stage.renderer.dispose();
      vi.advanceTimersByTime(600);
    } finally {
      vi.useRealTimers();
    }

    expect(heard.bars).toEqual([]);
  });

  it('forgets the passage with the music it was chosen on', async () => {
    const { renderer, surface } = await aScore(SHORT);
    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });

    renderer.clear();
    await renderer.load(SHORT.xml, SHORT.steps);

    expect(markers(surface)).toHaveLength(0);
  });

  it('points at a bar of the page it is over, when the score is scrolled', async () => {
    const stage = await aScore(LONG, false);
    const first = elementAt(sheets(stage.surface), 0);
    const second = elementAt(sheets(stage.surface), 1);
    const height = Number.parseFloat(first.style.height);
    // The second page under the first, as the column stands them.
    first.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1024, bottom: height }) as DOMRect;
    second.getBoundingClientRect = () => ({ left: 0, top: height, right: 1024, bottom: 2 * height }) as DOMRect;
    const drawing = second.querySelector('svg') as SVGSVGElement;
    const width = Number.parseFloat(drawing.getAttribute('width') ?? '0');
    drawing.getBoundingClientRect = () => ({ left: 0, top: height, width, height }) as DOMRect;
    const heard = listen(stage);
    const bar = elementAt(barsOn(stage.surface, 1), 2);

    hold(stage.surface, (bar.left + bar.right) / 2, height + (bar.top + bar.bottom) / 2);

    expect(heard.bars).toEqual([bar.measureIndex]);
  });
});

describe('the hand switches', () => {
  /** Where Verovio drew a system's brace begins, in the page's pixels. */
  function braceLeft(surface: HTMLElement, page: number): number {
    const drawing = sheets(surface)[page]?.querySelector('svg') as SVGSVGElement;
    const layout = readThePage(drawing);
    const scale = Number.parseFloat(drawing.getAttribute('width') ?? '0') / layout.width;
    const margin = Number(/translate\(\s*(-?[\d.]+)/.exec(drawing.querySelector('g.page-margin')?.getAttribute('transform') ?? '')?.[1]);
    const xs = [...drawing.querySelectorAll('g.grpSym path')].flatMap((path) =>
      [...(path.getAttribute('d') ?? '').matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((pair) => Number(pair[1])),
    );
    expect(xs.length).toBeGreaterThan(0);
    return (margin + Math.min(...xs)) * scale;
  }

  function switchesOn(surface: HTMLElement, page = 0): SVGGElement[] {
    return [...(sheets(surface)[page]?.querySelectorAll<SVGGElement>('g.hand-switch') ?? [])];
  }

  function boxOf(rect: Element | null | undefined): { left: number; right: number; top: number; bottom: number } {
    const left = Number.parseFloat(rect?.getAttribute('x') ?? 'NaN');
    const top = Number.parseFloat(rect?.getAttribute('y') ?? 'NaN');
    return {
      left,
      top,
      right: left + Number.parseFloat(rect?.getAttribute('width') ?? 'NaN'),
      bottom: top + Number.parseFloat(rect?.getAttribute('height') ?? 'NaN'),
    };
  }

  it('draws one beside every staff of every system, in room of its own left of the brace', async () => {
    const { renderer, surface } = await aScore(LONG);

    renderer.showHands([1, 2]);

    const systems = readThePage(sheets(surface)[0]?.querySelector('svg') as SVGSVGElement).systems.length;
    const switches = switchesOn(surface);
    expect(switches.map((each) => each.getAttribute('data-staff'))).toEqual(
      Array.from({ length: systems }, () => ['1', '2']).flat(),
    );
    const brace = braceLeft(surface, 0);
    for (const each of switches) {
      const hit = boxOf(each.querySelector('rect.hand-switch__hit'));
      expect(hit.right - hit.left).toBeGreaterThan(20);
      // On the page, and clear of the brace.
      expect(hit.left).toBeGreaterThan(0);
      expect(hit.right).toBeLessThan(brace);
    }
  });

  it('keeps that room at any print', async () => {
    // The brace grows with the print; a fingertip does not.
    const { renderer, surface } = await aScore(SHORT);
    renderer.showHands([1, 2]);

    for (const zoom of [0.4, 2.5]) {
      await laidOutAt(renderer, surface, zoom);
      expect(switchesOn(surface).length).toBeGreaterThan(0);
      const hit = boxOf(switchesOn(surface)[0]?.querySelector('rect.hand-switch__hit'));
      expect(hit.left).toBeGreaterThan(0);
      expect(hit.right).toBeLessThan(braceLeft(surface, 0));
    }
  });

  it('centres each on the printed lines of its own staff', async () => {
    const { renderer, surface } = await aScore(SHORT);

    renderer.showHands([1, 2]);

    const drawing = sheets(surface)[0]?.querySelector('svg') as SVGSVGElement;
    const layout = readThePage(drawing);
    const scale = Number.parseFloat(drawing.getAttribute('width') ?? '0') / layout.width;
    const staves = layout.systems.flatMap((system) => system.bars[0]?.staves ?? []);
    const tabs = switchesOn(surface).map((each) => boxOf(each.querySelector('rect.hand-switch__tab')));
    expect(tabs).toHaveLength(staves.length);
    for (const [at, tab] of tabs.entries()) {
      const staff = elementAt(staves, at);
      expect((tab.top + tab.bottom) / 2).toBeCloseTo(((staff.top + staff.bottom) / 2) * scale, 5);
    }
  });

  it('draws the hand that is off differently from the one that is on, and none with the furniture away', async () => {
    const { renderer, surface } = await aScore(SHORT);

    renderer.showHands([2]);
    expect(switchesOn(surface).slice(0, 2).map((each) => [each.dataset['staff'], each.dataset['on']])).toEqual([
      ['1', 'false'],
      ['2', 'true'],
    ]);

    renderer.showHands([]);
    expect(switchesOn(surface)).toHaveLength(0);
  });

  it('says which staff was pressed, and nothing else', async () => {
    const stage = await aScore(SHORT);
    const heard = listen(stage);
    const pressed: number[] = [];
    stage.renderer.onHandToggled((staffNumber) => pressed.push(staffNumber));
    stage.renderer.showHands([1, 2]);

    tap(switchesOn(stage.surface)[1]?.querySelector('rect.hand-switch__hit'), 5, 5);

    expect(pressed).toEqual([2]);
    expect(heard.taps).toBe(0);
    expect(heard.bars).toEqual([]);
  });

  it('draws them on a page drawn later', async () => {
    const { renderer, surface } = await aScore(LONG);
    renderer.showHands([1, 2]);
    expect(switchesOn(surface, 2)).toHaveLength(0);

    renderer.turnPages(1);

    await whenDrawn(() => {
      expect(switchesOn(surface, 2).length).toBeGreaterThan(0);
    });
  });
});

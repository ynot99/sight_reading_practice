// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import type { DrawnMeasure } from '../../src/infrastructure/rendering/passageBrackets.js';
import { bar, longExercise, p, twoBarExercise } from '../support/fixtures.js';
import { noteEntry, type Exercise, type StaffPart } from '../../src/domain/model/Exercise.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { createScoreContainer, installCanvasStub, staffLineYs } from '../support/osmdHarness.js';

function markers(container: HTMLElement): SVGGElement[] {
  return [...container.querySelectorAll('g.passage-marker')] as SVGGElement[];
}

/**
 * A pointer that landed and lifted without moving, in the drawing's own
 * pixels - which the stub below makes the same as the screen's.
 */
function tap(container: HTMLElement, x: number, y: number): void {
  for (const type of ['pointerdown', 'pointerup']) {
    container.dispatchEvent(
      new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }),
    );
  }
}

/**
 * A finger that lands and stays put long enough to be pointing.
 *
 * The clock is faked around the gesture rather than the test waiting half a
 * second: the hold is a timer, and a suite that slept for every one of them
 * would spend longer waiting than engraving.
 */
function hold(container: HTMLElement, x: number, y: number): void {
  vi.useFakeTimers();
  try {
    container.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 1, bubbles: true }),
    );
    vi.advanceTimersByTime(600);
  } finally {
    vi.useRealTimers();
  }
}

/** A tap whose target is the handle, wherever the coordinates claim to be. */
function tapOn(target: Element | null | undefined, x: number, y: number): void {
  for (const type of ['pointerdown', 'pointerup']) {
    target?.dispatchEvent(
      new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, bubbles: true }),
    );
  }
}

/** Shows the engraving at exactly the size it was drawn, which jsdom will not. */
function showAt(renderer: OsmdScoreRenderer, container: HTMLElement): void {
  void renderer;
  const svg = container.querySelector('svg');
  const height = Number.parseFloat(svg?.getAttribute('height') ?? '0');
  const width = Number.parseFloat(svg?.getAttribute('width') ?? '0');
  if (svg !== null) {
    svg.getBoundingClientRect = (() =>
      ({ left: 0, top: 0, width, height })) as Element['getBoundingClientRect'];
  }
}

/** Where an arrow points, as the x of the middle point of its path. */
function tipOf(path: string): number {
  const points = [...path.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)];
  return Number.parseFloat(points[1]?.[1] ?? 'NaN');
}

/** The bar of a marker, as the numbers it was actually drawn with. */
function barOf(marker: SVGGElement | undefined): { x: number; top: number; bottom: number } {
  // The drawn bar, not the invisible area a fingertip is allowed to land on.
  const rect = marker?.querySelector('rect.passage-marker__bar');
  const x = Number.parseFloat(rect?.getAttribute('x') ?? 'NaN');
  const y = Number.parseFloat(rect?.getAttribute('y') ?? 'NaN');
  const height = Number.parseFloat(rect?.getAttribute('height') ?? 'NaN');
  return { x, top: y, bottom: y + height };
}

/**
 * The markers against the real engraver.
 *
 * Everything about where they belong is arithmetic on fabricated numbers and
 * tested as such; this is the test that says the arithmetic is being fed what
 * OSMD actually drew. It is the half that cannot be checked any other way -
 * a bar read off the wrong object, or measured on one staff of two, looks
 * exactly like a working feature until it is on a page.
 */
describe('passage markers over a real engraving', () => {
  let container: HTMLElement;
  let renderer: OsmdScoreRenderer;

  beforeAll(() => {
    installCanvasStub();
  });

  beforeEach(async () => {
    document.body.replaceChildren();
    container = createScoreContainer();
    renderer = new OsmdScoreRenderer(container, { zoom: 1 });
    await renderer.load(new MusicXmlSerializer().serialize(longExercise({ bars: 4 })));
  });

  it('draws nothing until a passage is given', () => {
    expect(markers(container)).toHaveLength(0);
  });

  it('stands one marker at each end of the passage', () => {
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 3 });

    const [start, end] = markers(container);
    expect(start?.getAttribute('class')).toContain('passage-marker--start');
    expect(end?.getAttribute('class')).toContain('passage-marker--end');
    expect(barOf(start).x).toBeLessThan(barOf(end).x);
  });

  it('moves them onto the bars it is asked for', () => {
    // The whole point: the markers have to follow the passage, and the bars
    // have to be read off the engraving rather than guessed at from a count.
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 3 });
    const [wideStart, wideEnd] = markers(container);
    const outer = { start: barOf(wideStart).x, end: barOf(wideEnd).x };

    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });

    const [start, end] = markers(container);
    expect(barOf(start).x).toBeGreaterThan(outer.start);
    expect(barOf(end).x).toBeLessThan(outer.end);
  });

  it('keeps them at the edge when the passage reaches past what is drawn', () => {
    // Which is where a drag that is widening the passage ends up: the bars it
    // is asking for are not engraved, because the engraving *is* the passage.
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 3 });
    const edges = markers(container).map((marker) => barOf(marker).x);

    renderer.showPassage({ fromMeasureIndex: -4, toMeasureIndex: 40 });

    expect(markers(container).map((marker) => barOf(marker).x)).toEqual(edges);
  });

  it('grows the dots of a repeat bar line when the passage plays round', () => {
    // Music already has a sign for this, so the markers become it rather than
    // growing a badge in some private language. Facing inwards, because that
    // is which side of a repeat the dots go on.
    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2, repeating: true });

    const [start, end] = markers(container);
    const dotsOf = (marker: SVGGElement | undefined): number[] =>
      [...(marker?.querySelectorAll('circle.passage-marker__dot') ?? [])].map((dot) =>
        Number.parseFloat(dot.getAttribute('cx') ?? 'NaN'),
      );

    expect(dotsOf(start)).toHaveLength(2);
    expect(dotsOf(end)).toHaveLength(2);
    // Inside the passage on both sides: after the opening line, before the
    // closing one.
    expect(Math.min(...dotsOf(start))).toBeGreaterThan(barOf(start).x);
    expect(Math.max(...dotsOf(end))).toBeLessThan(barOf(end).x);
  });

  it('gives each marker a fingertip of area to be taken hold of', () => {
    // A marker is a few pixels wide and a fingertip is a centimetre. This is
    // also what tells the browser, before the touch begins, that moving it is
    // not going to scroll the page.
    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });

    const [start] = markers(container);
    const hit = start?.querySelector('rect.passage-marker__hit');
    const bar = barOf(start);
    const width = Number.parseFloat(hit?.getAttribute('width') ?? 'NaN');
    const left = Number.parseFloat(hit?.getAttribute('x') ?? 'NaN');

    expect(width).toBeGreaterThan(20);
    expect(left).toBeLessThan(bar.x);
    expect(left + width).toBeGreaterThan(bar.x);
  });

  it('draws an arrow on each handle saying which way it moves', () => {
    // The two handles on a marker are not the same button: the top takes in
    // another bar and the bottom gives one up. An arrow is the shortest way
    // to say so, and without it they are two identical circles.
    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });

    const [start, end] = markers(container);
    const arrows = (marker: SVGGElement | undefined): string[] =>
      [...(marker?.querySelectorAll('path.passage-marker__arrow') ?? [])].map(
        (path) => path.getAttribute('d') ?? '',
      );

    expect(arrows(start)).toHaveLength(2);
    expect(arrows(end)).toHaveLength(2);
    // The top of the start marker points back towards the front of the
    // piece, which is the way it will move; the bottom points the other way.
    const [outward, inward] = arrows(start).map((d) => tipOf(d) - barOf(start).x);
    expect(outward).toBeLessThan(0);
    expect(inward).toBeGreaterThan(0);
  });

  it('leaves the dots off a passage that is played once', () => {
    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });

    expect(container.querySelectorAll('circle.passage-marker__dot')).toHaveLength(0);
  });

  it('moves the passage a bar when a handle is tapped', () => {
    // The gesture nothing else in the suite can see: a tap on a handle is a
    // button and a drag from it is a handle, and telling them apart is the
    // whole of it. Dragging was the only way to move a marker, which meant
    // taking hold of a line a few pixels wide to change one bar.
    showAt(renderer, container);
    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });
    const chosen: { fromMeasureIndex: number; toMeasureIndex: number }[] = [];
    renderer.onPassageDragged((passage) => chosen.push(passage));

    const [start] = markers(container);
    const top = start?.querySelector('circle.passage-marker__grip--top');
    tap(container, Number(top?.getAttribute('cx')), Number(top?.getAttribute('cy')));

    // The top handle of the start marker takes in the bar before it.
    expect(chosen).toEqual([{ fromMeasureIndex: 0, toMeasureIndex: 2 }]);
  });

  it('gives up a bar from the handle at the other end of the marker', () => {
    showAt(renderer, container);
    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });
    const chosen: { fromMeasureIndex: number; toMeasureIndex: number }[] = [];
    renderer.onPassageDragged((passage) => chosen.push(passage));

    const [start] = markers(container);
    const bottom = start?.querySelector('circle.passage-marker__grip--bottom');
    tap(container, Number(bottom?.getAttribute('cx')), Number(bottom?.getAttribute('cy')));

    expect(chosen).toEqual([{ fromMeasureIndex: 2, toMeasureIndex: 2 }]);
  });

  it('answers a tap on the handle itself, whatever the coordinates say', () => {
    // The reader's report, and the reason the coordinates are no longer
    // trusted for this: working the mapping out by hand assumes the drawing
    // and the box on screen are a plain ratio of one another, and the error
    // grows with distance from the corner - so the handles at the top were
    // nearly right, the ones lower down had to be pressed below themselves,
    // and the right-hand marker could not be taken hold of at all.
    //
    // The browser has already worked out what the finger landed on. The
    // coordinates here are deliberately nowhere near the handle.
    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });
    const chosen: { fromMeasureIndex: number; toMeasureIndex: number }[] = [];
    renderer.onPassageDragged((passage) => chosen.push(passage));

    const [, end] = markers(container);
    const top = end?.querySelector('circle.passage-marker__grip--top');
    tapOn(top, 9_999, 9_999);

    // The top handle of the end marker takes in the bar after it.
    expect(chosen).toEqual([{ fromMeasureIndex: 1, toMeasureIndex: 3 }]);
  });

  it('drags the right-hand marker as readily as the left', () => {
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 3 });
    const chosen: { fromMeasureIndex: number; toMeasureIndex: number }[] = [];
    renderer.onPassageDragged((passage) => chosen.push(passage));
    showAt(renderer, container);

    const [, end] = markers(container);
    const bar = end?.querySelector('rect.passage-marker__bar');
    const held = Number(bar?.getAttribute('x'));
    // Taken hold of at the marker and let go over the second bar.
    end?.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: held, clientY: 130, pointerId: 1, bubbles: true }),
    );
    container.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 300, clientY: 130, pointerId: 1, bubbles: true }),
    );

    expect(chosen).toHaveLength(1);
    expect(chosen[0]?.fromMeasureIndex).toBe(0);
    expect(chosen[0]?.toMeasureIndex).toBeLessThan(3);
  });

  it('says when a finger is held on a marker rather than on a bar', () => {
    // Told apart by what is under the finger, not by where in the bar it
    // landed: a marker is a drawn thing with an edge to aim at, and "near
    // the bar line" against "in the middle of the bar" is a distinction a
    // fingertip cannot reliably make.
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 3 });
    showAt(renderer, container);
    const ends: string[] = [];
    const bars: number[] = [];
    renderer.onMarkerHeld((end) => ends.push(end));
    renderer.onBarHeld((measureIndex) => bars.push(measureIndex));
    const chosen: unknown[] = [];
    renderer.onPassageDragged((passage) => chosen.push(passage));

    const [, end] = markers(container);
    const held = Number(end?.querySelector('rect.passage-marker__bar')?.getAttribute('x'));
    vi.useFakeTimers();
    try {
      end?.dispatchEvent(
        new PointerEvent('pointerdown', {
          clientX: held,
          clientY: 130,
          pointerId: 1,
          bubbles: true,
        }),
      );
      vi.advanceTimersByTime(600);
      container.dispatchEvent(
        new PointerEvent('pointerup', {
          clientX: held,
          clientY: 130,
          pointerId: 1,
          bubbles: true,
        }),
      );
    } finally {
      vi.useRealTimers();
    }

    expect(ends).toEqual(['to']);
    // Not both: a hold on a marker is not a hold on the bar behind it.
    expect(bars).toEqual([]);
    // And letting go afterwards must not also nudge the passage a bar - a
    // tap on a grip already means that, and the reader did not tap.
    expect(chosen).toEqual([]);
  });

  describe('the hand switches', () => {
    // A grand staff, because the whole feature is one switch per hand and the
    // four-bar fixture above is written on a single staff.
    beforeEach(async () => {
      await renderer.load(new MusicXmlSerializer().serialize(twoBarExercise()));
      showAt(renderer, container);
    });

    it('draws one beside every staff, outside the music', () => {
      // Repeated the way a clef is, so there is one within reach of wherever
      // the eye happens to be - a single switch at the top of the page would
      // be a switch to go and find.
      renderer.showHands([1, 2]);
      renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 1 });

      const switches = [...container.querySelectorAll('g.hand-switch')];
      expect(switches.map((drawn) => drawn.getAttribute('data-staff'))).toEqual(['1', '2']);

      // Clear of the staff: the marker at bar one stands on the opening bar
      // line, and every switch is left of it.
      const [firstBarLine] = markers(container);
      for (const drawn of switches) {
        const hit = drawn.querySelector('rect.hand-switch__hit');
        const x = Number.parseFloat(hit?.getAttribute('x') ?? 'NaN');
        const width = Number.parseFloat(hit?.getAttribute('width') ?? 'NaN');
        expect(width).toBeGreaterThan(20);
        expect(x + width).toBeLessThanOrEqual(barOf(firstBarLine).x);
      }
    });

    it('stands each one against its own staff', () => {
      renderer.showHands([1, 2]);

      const tops = [...container.querySelectorAll('rect.hand-switch__hit')].map((hit) =>
        Number.parseFloat(hit.getAttribute('y') ?? 'NaN'),
      );
      // The upper switch is above the lower one, which is the whole of what
      // "the switch for this hand" means on the page.
      expect(tops).toHaveLength(2);
      expect(tops[0]).toBeLessThan(tops[1] ?? 0);
    });

    /**
     * The five printed lines of each staff, read off the drawing.
     *
     * Ledger lines are drawn in the same group and have to be told from the
     * staff's own: a ledger is a couple of note-widths, a staff line runs the
     * width of the measure.
     */
    function printedStaves(): number[][] {
      return [...container.querySelectorAll('.staffline')].map((group) => {
        const lines = [...group.querySelectorAll('path')]
          .map((path) => /^M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)$/.exec(path.getAttribute('d') ?? ''))
          .filter((drawn): drawn is RegExpExecArray => drawn !== null && drawn[2] === drawn[4])
          .map((drawn) => ({
            y: Number.parseFloat(drawn[2] ?? '0'),
            width: Number.parseFloat(drawn[3] ?? '0') - Number.parseFloat(drawn[1] ?? '0'),
          }));
        const widest = Math.max(...lines.map((line) => line.width), 0);
        return [
          ...new Set(lines.filter((line) => line.width >= widest / 2).map((line) => line.y)),
        ].sort((a, b) => a - b);
      });
    }

    it('centres each switch on the printed lines, not on what is written', async () => {
      // The complaint this answers: the switches sat below the staff, and by
      // a different amount on each hand. They were centred in the engraver's
      // box for the staff, and that box is drawn round what is *on* it -
      // stems, beams, an inner voice hanging below. The lines themselves are
      // where the staff is.
      const lopsided = twoBarExercise();
      const treble = lopsided.staves[0];
      const withLedgers: Exercise = {
        ...lopsided,
        staves: [
          {
            ...(treble as StaffPart),
            measures: [
              bar(noteEntry(p('C7'), Duration.WHOLE)),
              bar(noteEntry(p('C7'), Duration.WHOLE)),
            ],
          },
          ...lopsided.staves.slice(1),
        ],
      };
      await renderer.load(new MusicXmlSerializer().serialize(withLedgers));
      showAt(renderer, container);
      renderer.showHands([1, 2]);

      const staves = printedStaves();
      const tabs = [...container.querySelectorAll('rect.hand-switch__tab')];
      expect(tabs).toHaveLength(staves.length);

      for (const [at, tab] of tabs.entries()) {
        const lines = staves[at] ?? [];
        const middle = ((lines[0] ?? 0) + (lines[lines.length - 1] ?? 0)) / 2;
        const y = Number.parseFloat(tab.getAttribute('y') ?? 'NaN');
        const height = Number.parseFloat(tab.getAttribute('height') ?? 'NaN');
        expect(y + height / 2).toBeCloseTo(middle, 5);
      }
    });

    it('is not fooled by a bracket running under the staff', async () => {
      // The complaint this answers: on a piece with the pedal written out,
      // the upper switch sat below its staff and the lower one did not.
      //
      // A pedal bracket is drawn in the same group as the staff's own lines
      // and runs most of the system, so telling the lines apart by width
      // alone let it in - and it lies well below the staff, so it dragged the
      // middle down with it. Measured on the reader's own copy of City of
      // Tears the switch was 21.8 pixels low.
      const pedalled: Exercise = {
        ...twoBarExercise(),
        pedalMarks: [
          { measureIndex: 0, offsetTicks: 0, type: 'start', line: true },
          { measureIndex: 1, offsetTicks: Duration.WHOLE.ticks - 1, type: 'stop', line: true },
        ],
      };
      await renderer.load(new MusicXmlSerializer().serialize(pedalled));
      showAt(renderer, container);
      renderer.showHands([1, 2]);

      const staves = printedStaves();
      const tabs = [...container.querySelectorAll('rect.hand-switch__tab')];
      expect(tabs).toHaveLength(staves.length);

      for (const [at, tab] of tabs.entries()) {
        const lines = staves[at] ?? [];
        // Five lines and no more: the bracket is not one of them.
        expect(lines).toHaveLength(5);
        const middle = ((lines[0] ?? 0) + (lines[4] ?? 0)) / 2;
        const y = Number.parseFloat(tab.getAttribute('y') ?? 'NaN');
        const height = Number.parseFloat(tab.getAttribute('height') ?? 'NaN');
        expect(y + height / 2).toBeCloseTo(middle, 5);
      }
    });

    it('draws both switches the same size, whatever is on their staves', async () => {
      // Two controls that do the same thing have to look the same, and one of
      // these staves is carrying ledger lines the other is not.
      const lopsided = twoBarExercise();
      const treble = lopsided.staves[0];
      const withLedgers: Exercise = {
        ...lopsided,
        staves: [
          {
            ...(treble as StaffPart),
            measures: [
              bar(noteEntry(p('C7'), Duration.WHOLE)),
              bar(noteEntry(p('C7'), Duration.WHOLE)),
            ],
          },
          ...lopsided.staves.slice(1),
        ],
      };
      await renderer.load(new MusicXmlSerializer().serialize(withLedgers));
      showAt(renderer, container);
      renderer.showHands([1, 2]);

      const sizes = [...container.querySelectorAll('rect.hand-switch__tab')].map((tab) => [
        tab.getAttribute('width'),
        tab.getAttribute('height'),
      ]);
      expect(sizes).toHaveLength(2);
      expect(sizes[0]).toEqual(sizes[1]);
    });

    it('says which staff was pressed, and nothing else', () => {
      renderer.showHands([1, 2]);
      const pressed: number[] = [];
      renderer.onHandToggled((staffNumber) => pressed.push(staffNumber));
      const taps: unknown[] = [];
      renderer.onScoreTapped(() => taps.push(true));

      const [first] = [...container.querySelectorAll('g.hand-switch')];
      tapOn(first?.querySelector('rect.hand-switch__hit'), 5, 5);

      expect(pressed).toEqual([1]);
      // A press on a switch is that switch, and not a tap on the music.
      expect(taps).toEqual([]);
    });

    it('draws the hand that is off differently from the one that is on', () => {
      renderer.showHands([2]);

      const states = [...container.querySelectorAll('g.hand-switch')].map((drawn) => [
        drawn.getAttribute('data-staff'),
        drawn.getAttribute('data-on'),
      ]);
      expect(states).toEqual([
        ['1', 'false'],
        ['2', 'true'],
      ]);
    });
  });

  it('marks the bar the music will start from, quietly', () => {
    // A sign and not a control: nothing to take hold of, and it must not
    // swallow a touch aimed at the music or at a marker beside it.
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 3 });
    renderer.showStart(2);

    const mark = container.querySelector('g.start-marker');
    expect(mark).not.toBeNull();
    expect(mark?.querySelectorAll('circle')).toHaveLength(0);
    // On the bar it names, which is inside the passage rather than at an end.
    const bar = mark?.querySelector('rect.start-marker__bar');
    const at = Number.parseFloat(bar?.getAttribute('x') ?? 'NaN');
    const [start, end] = markers(container);
    expect(at).toBeGreaterThan(barOf(start).x);
    expect(at).toBeLessThan(barOf(end).x);

    renderer.showStart(null);
    expect(container.querySelector('g.start-marker')).toBeNull();
  });

  it('points at the bar a finger rests on, wherever in it that is', () => {
    // The gesture nothing else can see. A notehead is the size of a pencil
    // tip and a fingertip is a centimetre, so aiming at one was most of the
    // effort and most of the misses; a bar is a box several thumbprints
    // wide, and a run begins at a bar line anyway.
    showAt(renderer, container);
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 3 });
    const pointed: number[] = [];
    renderer.onBarHeld((measureIndex) => pointed.push(measureIndex));

    // Held in the empty space of the second bar, nowhere near a notehead.
    const measures = (renderer as unknown as { measures: DrawnMeasure[] }).measures;
    const second = measures.find((measure) => measure.measureIndex === 1);
    const middle = ((second?.left ?? 0) + (second?.right ?? 0)) / 2;
    hold(container, middle, (second?.top ?? 0) - 30);

    expect(pointed).toEqual([1]);
  });

  it('takes them away again', () => {
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 1 });
    renderer.hidePassage();

    expect(markers(container)).toHaveLength(0);
  });

  it('survives the page being engraved again', () => {
    // A zoom, a resize or a tempo change throws the old SVG away and
    // everything drawn on it. The passage is not a thing that should vanish
    // because the reader made the notes bigger.
    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });
    const before = markers(container).map((marker) => barOf(marker).x);

    renderer.refresh();

    expect(markers(container).map((marker) => barOf(marker).x)).toEqual(before);
  });

  it('spans both hands, not just the staff it was measured on', async () => {
    // A grand staff draws each bar twice, once per hand. Measured on the
    // first of them the marker hangs off the treble with the bass line
    // running out from under it.
    document.body.replaceChildren();
    const grand = createScoreContainer();
    const twoStaves = new OsmdScoreRenderer(grand, { zoom: 1 });
    await twoStaves.load(new MusicXmlSerializer().serialize(twoBarExercise()));

    twoStaves.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 1 });

    const lines = staffLineYs(grand);
    const top = Math.min(...lines);
    const bottom = Math.max(...lines);
    const [start] = markers(grand);
    expect(lines.length).toBeGreaterThan(5);
    expect(barOf(start).top).toBeLessThanOrEqual(top);
    expect(barOf(start).bottom).toBeGreaterThanOrEqual(bottom);
  });
});

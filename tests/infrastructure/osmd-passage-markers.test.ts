// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import { longExercise, twoBarExercise } from '../support/fixtures.js';
import { createScoreContainer, installCanvasStub, staffLineYs } from '../support/osmdHarness.js';

function markers(container: HTMLElement): SVGGElement[] {
  return [...container.querySelectorAll('g.passage-marker')] as SVGGElement[];
}

/** The bar of a marker, as the numbers it was actually drawn with. */
function barOf(marker: SVGGElement | undefined): { x: number; top: number; bottom: number } {
  const rect = marker?.querySelector('rect');
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

  it('leaves the dots off a passage that is played once', () => {
    renderer.showPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });

    expect(container.querySelectorAll('circle.passage-marker__dot')).toHaveLength(0);
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

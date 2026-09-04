// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { restEntry } from '../../src/domain/model/Exercise.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import { bar, longExercise } from '../support/fixtures.js';
import { createScoreContainer, installCanvasStub } from '../support/osmdHarness.js';

/** The renderer's own record of which page each step was drawn on. */
function stepPages(renderer: OsmdScoreRenderer): Map<number, number> {
  return (renderer as unknown as { stepPage: Map<number, number> }).stepPage;
}

/** A window with a real size, which jsdom does not otherwise provide. */
function withLayout(container: HTMLElement, windowHeight: number): void {
  const frame = document.createElement('div');
  frame.className = 'score';
  const scroller = document.createElement('div');
  scroller.className = 'score__scroll';
  container.replaceWith(frame);
  frame.append(scroller);
  scroller.append(container);
  frame.getBoundingClientRect = (() => ({
    left: 0,
    top: 0,
    bottom: 99_999,
    width: 900,
    height: 99_999,
  })) as Element['getBoundingClientRect'];
  scroller.getBoundingClientRect = (() => ({
    left: 0,
    top: 0,
    bottom: windowHeight,
    width: 900,
    height: windowHeight,
  })) as Element['getBoundingClientRect'];
  Object.defineProperty(window, 'innerHeight', { value: windowHeight, configurable: true });
}

/** Twenty bars, with a late one that is nothing but rests. */
function withARestBar(at: number): Exercise {
  const base = longExercise({ bars: 20 });
  const [staff] = base.staves;
  if (staff === undefined) {
    throw new Error('expected a staff');
  }
  return {
    ...base,
    staves: [
      {
        ...staff,
        measures: staff.measures.map((measure, index) =>
          index === at ? bar(restEntry(Duration.WHOLE)) : measure,
        ),
      },
    ],
  };
}

describe('a bar of rests belongs to the page it is drawn on', { timeout: 30_000 }, () => {
  let container: HTMLElement;
  let renderer: OsmdScoreRenderer;

  beforeAll(() => {
    installCanvasStub();
  });

  beforeEach(() => {
    document.body.replaceChildren();
    container = createScoreContainer();
    renderer = new OsmdScoreRenderer(container, { zoom: 1 });
    renderer.setPaged(true);
    withLayout(container, 260);
  });

  it('gives every step a page, rests included', async () => {
    // A rest has no pitch, and the walk that records where the engraver put
    // each step skipped anything without one. A bar of rests therefore
    // belonged to no page at all, which reads as page one - so the page
    // turned back to the beginning under a reader in the middle of the
    // piece, and the marker went with it.
    const exercise = withARestBar(14);
    await renderer.load(new MusicXmlSerializer().serialize(exercise));

    const timeline = buildTimeline(exercise);
    const pages = stepPages(renderer);

    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline.steps.filter((step) => !pages.has(step.index))).toEqual([]);
  });

  it('puts it on the page it is actually on, not on the first', async () => {
    const exercise = withARestBar(14);
    await renderer.load(new MusicXmlSerializer().serialize(exercise));

    expect(renderer.pages.count).toBeGreaterThan(1);

    const timeline = buildTimeline(exercise);
    const pages = stepPages(renderer);
    const rest = timeline.steps.find((step) => step.measureIndex === 14);
    expect(rest).toBeDefined();

    const before = pages.get((rest?.index ?? 0) - 1);
    const after = pages.get((rest?.index ?? 0) + 1);
    const own = pages.get(rest?.index ?? 0);
    // Late enough in a paged engraving to be past the first page, which is
    // what the bug got wrong every time.
    expect(own).toBeGreaterThan(0);
    // And between its neighbours, which is all a page break allows.
    expect(own).toBeGreaterThanOrEqual(before ?? 0);
    expect(own).toBeLessThanOrEqual(after ?? Number.POSITIVE_INFINITY);
  });

  it('keeps the page the music had reached when it can be told nothing', async () => {
    // Two whole bars of rest in a row are drawn as one multi-rest, so the
    // second bar has no graphical object at all to ask about.
    const base = longExercise({ bars: 20 });
    const [staff] = base.staves;
    if (staff === undefined) {
      throw new Error('expected a staff');
    }
    const silent = bar(restEntry(Duration.WHOLE));
    const exercise: Exercise = {
      ...base,
      staves: [
        {
          ...staff,
          measures: staff.measures.map((measure, index) =>
            index === 14 || index === 15 ? silent : measure,
          ),
        },
      ],
    };
    await renderer.load(new MusicXmlSerializer().serialize(exercise));

    const timeline = buildTimeline(exercise);
    const pages = stepPages(renderer);
    const rests = timeline.steps.filter(
      (step) => step.measureIndex === 14 || step.measureIndex === 15,
    );

    expect(rests.length).toBeGreaterThan(0);
    for (const step of rests) {
      expect(pages.get(step.index)).toBe(pages.get(step.index - 1));
    }
  });
});

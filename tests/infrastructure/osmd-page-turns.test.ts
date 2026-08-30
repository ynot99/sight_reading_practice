// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { longExercise } from '../support/fixtures.js';
import { createScoreContainer, installCanvasStub } from '../support/osmdHarness.js';

/**
 * A window with a real size, which jsdom does not otherwise provide.
 *
 * The frame and the box that scrolls inside it, arranged the way the real
 * page has them - the frame taller than the screen, because it is given a
 * minimum of one screen and then grows to what is engraved in it.
 */
function withLayout(container: HTMLElement, windowHeight: number): HTMLElement {
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
  Object.defineProperty(window, 'innerHeight', { value: windowHeight, configurable: true });
  return scroller;
}

/** The pages the engraver drew. */
function sheets(container: HTMLElement): SVGSVGElement[] {
  return [...container.querySelectorAll('svg')];
}

/** Which of them the reader can see. */
function showing(container: HTMLElement): number[] {
  return sheets(container)
    .map((sheet, at) => (sheet.style.display === 'none' ? -1 : at))
    .filter((at) => at >= 0);
}

/**
 * Reading a real engraving as pages.
 *
 * The engraver does the breaking: given a page size it lays the music out as
 * separate pages and draws each into an SVG of its own. That is the whole of
 * the feature, and it is why there is so little arithmetic left to test - a
 * turn is showing one element and hiding the others, and nothing here can cut
 * a system in half because nothing here decides where a system goes.
 */
describe('reading a real engraving as pages', { timeout: 30_000 }, () => {
  let container: HTMLElement;
  let renderer: OsmdScoreRenderer;

  beforeAll(() => {
    installCanvasStub();
  });

  beforeEach(async () => {
    document.body.replaceChildren();
    container = createScoreContainer();
    renderer = new OsmdScoreRenderer(container, { zoom: 1 });
    // Small enough that the engraver can be run several times in a test and
    // still long enough to need more than one page.
    await renderer.load(new MusicXmlSerializer().serialize(longExercise({ bars: 16 })));
    withLayout(container, 260);
  });

  it('is one endless column until it is asked for pages', () => {
    expect(sheets(container)).toHaveLength(1);
    expect(renderer.pages.count).toBe(0);
  });

  it('has the engraver break the music into several pages', () => {
    renderer.setPaged(true);

    expect(sheets(container).length).toBeGreaterThan(1);
    expect(renderer.pages.count).toBe(sheets(container).length);
    expect(renderer.pages.at).toBe(0);
  });

  it('shows one page and hides the rest', () => {
    // Which is the whole of a page turn. No scrolling, no transform and
    // nothing measured: the page that is not being read is not displayed.
    renderer.setPaged(true);
    expect(showing(container)).toEqual([0]);

    renderer.turnPages(1);

    expect(showing(container)).toEqual([1]);
    expect(renderer.pages.at).toBe(1);
  });

  it('stops at either end instead of running off', () => {
    renderer.setPaged(true);
    renderer.turnPages(-1);
    expect(renderer.pages.at).toBe(0);

    renderer.turnPages(999);
    expect(renderer.pages.at).toBe(renderer.pages.count - 1);
    expect(showing(container)).toEqual([renderer.pages.count - 1]);
  });

  it('turns to the page a bar is on, and stays put when it is already there', () => {
    renderer.setPaged(true);
    const turns: number[] = [];
    renderer.onPagesChanged((state) => turns.push(state.at));

    renderer.showMeasure(15);
    const reached = renderer.pages.at;
    expect(reached).toBeGreaterThan(0);

    renderer.showMeasure(15);
    // Told twice about the same bar it turns once: a page turn is for
    // looking at one thing until it is finished with.
    expect(turns).toEqual([reached]);
  });

  it('does nothing to a scrolling score', () => {
    renderer.showMeasure(15);

    expect(sheets(container)).toHaveLength(1);
    expect(showing(container)).toEqual([0]);
  });

  it('gives back the endless column when pages are turned off', () => {
    renderer.setPaged(true);
    renderer.turnPages(1);

    renderer.setPaged(false);

    expect(sheets(container)).toHaveLength(1);
    expect(showing(container)).toEqual([0]);
    expect(renderer.pages.count).toBe(0);
  });

  it('makes more pages of the same music when the reader zooms in', () => {
    // The page keeps the size it is given on screen and the music inside it
    // grows instead, so a reader who has made the notes bigger has more
    // pages of them - which is what a book does.
    renderer.setPaged(true);
    const before = renderer.pages.count;

    renderer.setZoom(1.6);
    // The reader's zoom is applied and then the page is engraved again,
    // which is what the controller does with it.
    renderer.refresh();

    expect(renderer.pages.count).toBeGreaterThan(before);
    expect(showing(container)).toHaveLength(1);
  });

  it('draws what was played on the page it was played on', () => {
    // Every page is an SVG of its own whose coordinates start again at
    // nought, so a mark drawn into the first sheet for a note on the second
    // is a mark on the wrong music - and on the page nobody is looking at.
    renderer.setPaged(true);
    renderer.configureOverlay({
      keyAt: () => KeySignature.major(0),
      clefAt: () => 'treble',
    });
    const last = renderer.pages.count - 1;
    expect(last).toBeGreaterThan(0);
    // A bar on the last page, and the step the cursor reaches there.
    const step = 4 * 15;

    renderer.showPlayed({ stepIndex: step, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });

    const drawn = sheets(container).map((sheet) => sheet.querySelectorAll('.played-note').length);
    expect(drawn[0]).toBe(0);
    expect(drawn[last]).toBeGreaterThan(0);
  });

  it('puts each passage marker on the page its own bar is drawn on', () => {
    // A passage can run across a page break, and then the two markers are
    // not on the same sheet at all.
    renderer.setPaged(true);
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 15 });

    const markers = sheets(container).map(
      (sheet) => sheet.querySelectorAll('g.passage-marker').length,
    );
    expect(markers[0]).toBe(1);
    expect(markers[renderer.pages.count - 1]).toBe(1);
  });

  it('prints the page number on the page, the way a score has it', () => {
    // Part of the page and not part of the screen: it stays put, it is there
    // before anything is turned, and it goes wherever the page goes - which
    // is what a pill announcing a turn cannot do.
    renderer.setPaged(true);
    const count = renderer.pages.count;

    const numbers = sheets(container).map(
      (sheet) => sheet.querySelector('text.page-number')?.textContent ?? '',
    );

    expect(numbers[0]).toBe(`Page 1 of ${count}`);
    expect(numbers[count - 1]).toBe(`Page ${count} of ${count}`);
  });

  it('says nothing about pages on a score that is one column', () => {
    // "Page 1 of 1" at a reader who never asked for pages is furniture.
    renderer.setPaged(true);
    renderer.setPaged(false);

    expect(container.querySelector('text.page-number')).toBeNull();
  });

  it('turns the page itself when the cursor moves onto another one', () => {
    // The cursor is what every mode moves - practising, listening, a take
    // played back - so following it is what makes the page turn itself in
    // all of them. Told by the practice run instead, it turned during a run
    // and sat still through everything else.
    renderer.setPaged(true);
    expect(renderer.pages.at).toBe(0);

    renderer.cursor.moveTo(4 * 15);

    expect(renderer.pages.at).toBeGreaterThan(0);
  });

  it('does not let its own bookkeeping turn the page', () => {
    // Reading where every step was drawn means running the cursor from the
    // top and putting it back. A page that followed that would end every
    // re-engraving on page one, however far in the reader had got.
    renderer.setPaged(true);
    renderer.turnPages(1);

    renderer.refresh();

    expect(renderer.pages.at).toBe(1);
  });

  it('keeps the reader on their page across a re-engraving', () => {
    renderer.setPaged(true);
    renderer.turnPages(1);

    renderer.refresh();

    expect(renderer.pages.at).toBe(1);
    expect(showing(container)).toEqual([1]);
  });
});

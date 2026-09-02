// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import type { DrawnMeasure } from '../../src/infrastructure/rendering/passageBrackets.js';
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

/** Where the engraver put each bar, which the renderer keeps to itself. */
function measuresOf(renderer: OsmdScoreRenderer): DrawnMeasure[] {
  return (renderer as unknown as { measures: DrawnMeasure[] }).measures;
}

/**
 * Shows every page at exactly the size it was drawn.
 *
 * jsdom lays nothing out, and the pointer arithmetic falls back to the box
 * on screen against the size in the drawing when there is no layout to ask.
 */
function showSheetsAtTheirOwnSize(container: HTMLElement): void {
  for (const sheet of sheets(container)) {
    const width = Number.parseFloat(sheet.getAttribute('width') ?? '0');
    const height = Number.parseFloat(sheet.getAttribute('height') ?? '0');
    sheet.getBoundingClientRect = (() =>
      ({ left: 0, top: 0, width, height })) as Element['getBoundingClientRect'];
  }
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

  it('opens in pages when that is how the reader left it', async () => {
    // The setting is restored before anything is engraved, so there is
    // nothing on the page to turn pages *on*. Asked for only at the moment
    // the reader flips the switch, a visit that opens in pages got one
    // endless column and had to be switched off and on again.
    document.body.replaceChildren();
    const fresh = createScoreContainer();
    const opening = new OsmdScoreRenderer(fresh, { zoom: 1 });
    opening.setPaged(true);
    withLayout(fresh, 260);

    await opening.load(new MusicXmlSerializer().serialize(longExercise({ bars: 16 })));

    expect(sheets(fresh).length).toBeGreaterThan(1);
    expect(opening.pages.count).toBe(sheets(fresh).length);
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

  it('turns the page when a marker is dragged past the last bar on it', () => {
    // The reader's report: this worked on a laptop and never on the tablet.
    // The threshold was the page's own width, and the page is as wide as the
    // screen - a mouse can leave the window and a finger cannot. The
    // engraver leaves a margin after the last bar, and that margin is
    // somewhere a finger can actually reach.
    renderer.setPaged(true);
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 15 });
    showSheetsAtTheirOwnSize(container);
    expect(renderer.pages.at).toBe(0);

    const onThisPage = measuresOf(renderer).filter((measure) => measure.page === 0);
    const last = onThisPage[onThisPage.length - 1];
    const marker = container.querySelector('g.passage-marker--end');
    marker?.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 1, bubbles: true }),
    );
    // Out into the margin the engraver left after the last bar.
    container.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: (last?.right ?? 0) + 30,
        clientY: (last?.top ?? 0) + 10,
        pointerId: 1,
        bubbles: true,
      }),
    );

    expect(renderer.pages.at).toBe(1);
  });

  it('turns once while the finger stays out there, not over and over', () => {
    // Held past the end, the finger is past the new page's last bar the
    // moment it arrives - so without this the reader would watch the whole
    // piece flip by. Coming back inside arms it again.
    renderer.setPaged(true);
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 15 });
    showSheetsAtTheirOwnSize(container);
    const onThisPage = measuresOf(renderer).filter((measure) => measure.page === 0);
    const last = onThisPage[onThisPage.length - 1];
    const marker = container.querySelector('g.passage-marker--end');
    marker?.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 1, bubbles: true }),
    );
    const outside = {
      clientX: (last?.right ?? 0) + 30,
      clientY: (last?.top ?? 0) + 10,
      pointerId: 1,
      bubbles: true,
    };

    container.dispatchEvent(new PointerEvent('pointermove', outside));
    const afterOne = renderer.pages.at;
    container.dispatchEvent(new PointerEvent('pointermove', outside));
    container.dispatchEvent(new PointerEvent('pointermove', outside));

    expect(renderer.pages.at).toBe(afterOne);
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

  it('turns back to the first page when the marker is sent to the top', () => {
    // The button for going back to the beginning asks for a position the
    // marker may already hold. Asking moves nothing and still says so, which
    // is what turns the page - without it the reader pressed the button on
    // page three and stayed there while the marker went to bar one.
    renderer.setPaged(true);
    renderer.cursor.moveTo(4 * 15);
    expect(renderer.pages.at).toBeGreaterThan(0);
    renderer.cursor.moveTo(0);
    expect(renderer.pages.at).toBe(0);

    renderer.turnPages(1);
    renderer.cursor.moveTo(0);

    expect(renderer.pages.at).toBe(0);
  });

  it('stays where it is when the marker is only being put back', () => {
    // A finished run and a re-engraving both put the marker on the first
    // note. A page that followed that threw the reader onto page one every
    // time - after every run, and every time they touched a setting.
    renderer.setPaged(true);
    renderer.cursor.moveTo(4 * 15);
    const reading = renderer.pages.at;
    expect(reading).toBeGreaterThan(0);

    renderer.cursor.reset();

    expect(renderer.pages.at).toBe(reading);
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

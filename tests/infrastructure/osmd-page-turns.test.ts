// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import type { DrawnMeasure } from '../../src/infrastructure/rendering/passageBrackets.js';
import { longExercise } from '../support/fixtures.js';
import { createScoreContainer, installCanvasStub, withLayout } from '../support/osmdHarness.js';


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

/** The box the stylesheet takes the scrollbar away from. */
function scrollerOf(container: HTMLElement): HTMLElement | null {
  return container.closest('.score__scroll');
}

/** Every height the engraver was asked to lay a page out to. */
function spyOnPageSizes(renderer: OsmdScoreRenderer): number[] {
  const engraver = (renderer as unknown as {
    osmd: { setCustomPageFormat: (width: number, height: number) => void };
  }).osmd;
  const asked: number[] = [];
  const original = engraver.setCustomPageFormat.bind(engraver);
  engraver.setCustomPageFormat = (width: number, height: number): void => {
    asked.push(height);
    original(width, height);
  };
  return asked;
}

/**
 * Makes every page report a drawing taller than its own box.
 *
 * jsdom lays nothing out, so the real overflow cannot happen here - but the
 * measurement is a bounding box against a `viewBox`, and both of those can be
 * answered without a layout engine.
 */
function everyPageDrawsPastItsBox(): void {
  (SVGSVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox =
    function getBBox(this: SVGSVGElement): DOMRect {
      const box = Number((this.getAttribute('viewBox') ?? '').split(/[\s,]+/)[3] ?? 0);
      return { x: 0, y: 0, width: 10, height: box + 50 } as DOMRect;
    };
}

/** How wide the page is, in the units the bars were measured in. */
function pageWidth(container: HTMLElement): number {
  const svg = sheets(container).find((sheet) => sheet.style.display !== 'none');
  return Number((svg?.getAttribute('viewBox') ?? '').split(/[\s,]+/)[2] ?? 0);
}

/** Whether the engraver's own marker is on show. */
function markerShown(renderer: OsmdScoreRenderer): boolean {
  const engraver = renderer as unknown as { osmd: { cursor: { hidden: boolean } } };
  return !engraver.osmd.cursor.hidden;
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

  afterEach(() => {
    // The stub is on the prototype, so it has to come off again.
    delete (SVGSVGElement.prototype as unknown as { getBBox?: unknown }).getBBox;
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
    // And it says so on the page, which is what takes the scrollbar away.
    // Set before the first engraving and then never again - coming back here
    // finds the setting already on and leaves at the top - this was written
    // nowhere for the rest of the session, and a page that turns could also
    // be nudged half a system out of place by a finger.
    expect(scrollerOf(fresh)?.dataset['paged']).toBe('true');
  });

  it('says on the page when the reader goes back to one column', () => {
    renderer.setPaged(true);
    expect(scrollerOf(container)?.dataset['paged']).toBe('true');

    renderer.setPaged(false);

    expect(scrollerOf(container)?.dataset['paged']).toBe('false');
  });

  it('asks for a page that fits the room inside the box, reserves and all', () => {
    // Not the window minus what we remembered to subtract. The box keeps
    // room at both ends - eight pixels above the page and the transport bar's
    // room below it - and a page sized to the window overflowed by the strip
    // nobody owned, which the frame then grew to hold and the document
    // scrolled by.
    const asked = spyOnPageSizes(renderer);
    const scroller = container.closest('.score__scroll');
    if (!(scroller instanceof HTMLElement)) {
      throw new Error('expected a scrolling box');
    }
    scroller.style.paddingTop = '8px';
    scroller.style.paddingBottom = '92px';
    scroller.getBoundingClientRect = (() =>
      ({ left: 0, top: 0, bottom: 260, width: 900, height: 260 })) as Element['getBoundingClientRect'];

    renderer.setPaged(true);

    expect(asked[0]).toBe((260 - 8 - 92) / 10);
  });

  it('asks for a shorter page when the engraver drew past the one it got', () => {
    // The engraver fits systems by its own reckoning of their heights, and
    // that reckoning is short of what it then draws - a beam over a run of
    // short values, an inner voice hanging below its stave. The page is an
    // SVG cut to the size we asked for, so the surplus is not below the fold:
    // it is clipped off, and the last system comes out sliced in half.
    const asked = spyOnPageSizes(renderer);
    everyPageDrawsPastItsBox();

    renderer.setPaged(true);

    expect(asked.length).toBeGreaterThan(1);
    const first = asked[0] ?? 0;
    const last = asked[asked.length - 1] ?? 0;
    expect(last).toBeLessThan(first);
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
    // Halfway into the margin the engraver left after the last bar.
    container.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: ((last?.right ?? 0) + pageWidth(container)) / 2 + 2,
        clientY: (last?.top ?? 0) + 10,
        pointerId: 1,
        bubbles: true,
      }),
    );

    expect(renderer.pages.at).toBe(1);
  });

  it('stays put for a hand that has merely passed the last bar line', () => {
    // The reader's report from the laptop: a drag to the right was so eager
    // that starting one could land them on the next page. One pixel past a
    // bar line is where a hand goes by accident; the margin has to be
    // crossed on purpose.
    renderer.setPaged(true);
    renderer.showPassage({ fromMeasureIndex: 0, toMeasureIndex: 15 });
    showSheetsAtTheirOwnSize(container);
    const onThisPage = measuresOf(renderer).filter((measure) => measure.page === 0);
    const last = onThisPage[onThisPage.length - 1];
    const marker = container.querySelector('g.passage-marker--end');
    marker?.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 1, bubbles: true }),
    );

    container.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: (last?.right ?? 0) + 2,
        clientY: (last?.top ?? 0) + 10,
        pointerId: 1,
        bubbles: true,
      }),
    );

    expect(renderer.pages.at).toBe(0);
  });

  it('turns back when a marker is dragged into the margin before the first bar', () => {
    // The other half of the reader's report: leftwards did nothing at all.
    // Which way a page turned was decided by *which* handle was held - the
    // start marker reached backwards and the end marker forwards - so anyone
    // dragging the end marker back towards the start was stuck on the page
    // they were on, however far they went.
    renderer.setPaged(true);
    renderer.turnPages(1);
    const onThisPage = measuresOf(renderer).filter((measure) => measure.page === 1);
    const first = onThisPage[0];
    const last = onThisPage[onThisPage.length - 1];
    renderer.showPassage({
      fromMeasureIndex: first?.measureIndex ?? 0,
      toMeasureIndex: last?.measureIndex ?? 0,
    });
    showSheetsAtTheirOwnSize(container);
    const marker = container.querySelector('g.passage-marker--end');
    marker?.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 10, clientY: 10, pointerId: 1, bubbles: true }),
    );

    container.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: (first?.left ?? 0) / 2 - 1,
        clientY: (first?.top ?? 0) + 10,
        pointerId: 1,
        bubbles: true,
      }),
    );

    expect(renderer.pages.at).toBe(0);
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

  it('prints what the page is on the page, the way a score has it', () => {
    // Part of the page and not part of the screen: it stays put, it is there
    // before anything is turned, and it goes wherever the page goes - which
    // is what a pill announcing a turn cannot do. And the title is beside the
    // number rather than printed over the first system, so it costs no
    // vertical room and is answered on every page instead of only the first.
    renderer.setPaged(true);
    const count = renderer.pages.count;

    const labels = sheets(container).map(
      (sheet) => sheet.querySelector('text.page-label')?.textContent ?? '',
    );

    expect(labels[0]).toBe(`Long fixture · Page 1 of ${count}`);
    expect(labels[count - 1]).toBe(`Long fixture · Page ${count} of ${count}`);
  });

  it('does not scroll after the marker in a mode that turns pages', async () => {
    // The engraver scrolls the page to keep its marker in view, with a smooth
    // behaviour, on *every* step. In pages there is nothing to scroll - a
    // turn is what shows the next system - and leaving it on meant an
    // animation over tens of thousands of elements started again before the
    // last had finished: a stall on every beat, worst on a tablet.
    //
    // Told before anything was engraved, which is how a visit that opens in
    // pages arrives, the switch used to be missed entirely: it was applied
    // after an early return. So the readers who never touched it were the
    // ones who paid.
    document.body.replaceChildren();
    const fresh = createScoreContainer();
    const opening = new OsmdScoreRenderer(fresh, { zoom: 1 });
    opening.setPaged(true);
    withLayout(fresh, 260);

    await opening.load(new MusicXmlSerializer().serialize(longExercise({ bars: 16 })));

    const engraver = (opening as unknown as { osmd: { FollowCursor: boolean } }).osmd;
    expect(engraver.FollowCursor).toBe(false);

    // And it comes back for a reader who goes back to one column, where
    // following the marker is the only thing that moves the music.
    opening.setPaged(false);
    expect(engraver.FollowCursor).toBe(true);
  });

  it('turns a page without searching the drawing for anything', () => {
    // A search by class walks the whole page, and the things being looked for
    // - the page number, the overlay layer - are appended last, so the walk
    // never ends early. Done for every page of the score on every turn, that
    // made a turn a visible stall on a long piece: the music stopped for a
    // moment and then caught up all at once, because the clock had gone on
    // without the thread. This is the invariant, since the cost itself is not
    // something an assertion can see.
    renderer.setPaged(true);
    const searched: string[] = [];
    for (const sheet of sheets(container)) {
      const original = sheet.querySelector.bind(sheet);
      sheet.querySelector = ((selector: string) => {
        searched.push(selector);
        return original(selector);
      }) as Element['querySelector'];
    }

    renderer.turnPages(1);
    renderer.turnPages(1);

    expect(searched).toEqual([]);
    // And the pages still say which they are, one label apiece.
    for (const [at, sheet] of sheets(container).entries()) {
      const labels = sheet.querySelectorAll('text.page-label');
      expect(labels).toHaveLength(1);
      expect(labels[0]?.textContent).toBe(
        `Long fixture · Page ${at + 1} of ${renderer.pages.count}`,
      );
    }
  });

  it('opens new music at its own first page', async () => {
    // The complaint this answers: a piece opened while page four of the last
    // one was on screen stayed on page four - a page nobody had turned to,
    // in music they had not started reading.
    //
    // A re-engraving is different and deliberately so: a zoom or a rotation
    // puts the reader back where they were. This is new music.
    renderer.setPaged(true);
    renderer.turnPages(1);
    expect(renderer.pages.at).toBeGreaterThan(0);

    await renderer.load(new MusicXmlSerializer().serialize(longExercise({ bars: 16 })));

    expect(renderer.pages.at).toBe(0);
    expect(showing(container)).toEqual([0]);
  });

  it('says nothing about pages on a score that is one column', () => {
    // "Page 1 of 1" at a reader who never asked for pages is furniture. The
    // title is not: a column has a top, and what piece it is the top of is
    // worth saying there.
    renderer.setPaged(true);
    renderer.setPaged(false);

    const label = container.querySelector('text.page-label');
    expect(label?.textContent).toBe('Long fixture');
  });

  it('says only the pages when the score has no title to say', async () => {
    // A generated exercise can arrive nameless, and " · Page 1 of 3" with
    // nothing in front of the separator is furniture of a worse kind.
    document.body.replaceChildren();
    const bare = createScoreContainer();
    const nameless = new OsmdScoreRenderer(bare, { zoom: 1 });
    withLayout(bare, 260);

    await nameless.load(new MusicXmlSerializer().serialize(longExercise({ bars: 16, title: '' })));
    nameless.setPaged(true);

    const label = bare.querySelector('text.page-label');
    expect(label?.textContent).toBe(`Page 1 of ${nameless.pages.count}`);
  });

  it('cuts a title too long for the corner it is written in', async () => {
    // SVG text does not wrap: an untrimmed one runs off the side of the page
    // and out of the drawing entirely, taking the page number with it.
    document.body.replaceChildren();
    const wordy = createScoreContainer();
    const long = new OsmdScoreRenderer(wordy, { zoom: 1 });
    withLayout(wordy, 260);
    const title = 'Nausicaa of the Valley of the Wind: Requiem for a Dying World, Arranged';

    await long.load(new MusicXmlSerializer().serialize(longExercise({ bars: 16, title })));
    long.setPaged(true);

    const written = wordy.querySelector('text.page-label')?.textContent ?? '';
    const shown = written.split(' · ')[0] ?? '';
    expect(shown).toHaveLength(48);
    expect(shown.endsWith('…')).toBe(true);
    expect(title.startsWith(shown.slice(0, -1))).toBe(true);
    // And the page number survives the cut, which is the point of cutting.
    expect(written.endsWith(`Page 1 of ${long.pages.count}`)).toBe(true);
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

  it('does not show the marker on a page it is not on', () => {
    // The engraver keeps one marker for the whole score and places it in the
    // coordinates of its own page, so a marker on page one shown while page
    // two is up stands over page two's first bar and claims to be there.
    // Turning the marker on is as much a way of doing that as moving it, and
    // that is the path a tempo nudge takes.
    renderer.setPaged(true);
    renderer.turnPages(1);

    renderer.cursor.show();

    expect(markerShown(renderer)).toBe(false);

    // And it comes back on the page it belongs to, without being asked again.
    renderer.turnPages(-1);
    expect(markerShown(renderer)).toBe(true);
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

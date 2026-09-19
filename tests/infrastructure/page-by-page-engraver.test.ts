// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { PageByPageEngraver } from '../../src/infrastructure/rendering/PageByPageEngraver.js';
import { longExercise } from '../support/fixtures.js';
import { createScoreContainer, installCanvasStub } from '../support/osmdHarness.js';

/** A piece long enough to need several pages of the size asked for. */
const MUSIC = new MusicXmlSerializer().serialize(longExercise({ bars: 24 }));

/** Pages of 900 by 250 pixels, which the fixture fills several of. */
const PAGE = { width: 90, height: 25 };

async function engraved(pages: Iterable<number> | null): Promise<{
  engraver: PageByPageEngraver;
  sheets: () => SVGSVGElement[];
}> {
  const container = createScoreContainer();
  const engraver = new PageByPageEngraver(container, { autoResize: false, backend: 'svg' });
  await engraver.load(MUSIC, '');
  engraver.setCustomPageFormat(PAGE.width, PAGE.height);
  engraver.drawOnly(pages);
  engraver.render();
  return { engraver, sheets: () => [...container.querySelectorAll('svg')] };
}

/**
 * A page as drawn, less the names the drawing hands out as it goes: they count
 * up across everything drawn, so a page drawn later carries other ones.
 */
function asDrawn(sheet: SVGSVGElement | undefined): string {
  return (sheet?.outerHTML ?? '').replace(/ id="[^"]*"/g, '');
}

/** One note the layout placed on a page, with the group it was drawn as. */
function aNoteOn(engraver: PageByPageEngraver, page: number): Element | null {
  const system = engraver.GraphicSheet.MusicPages[page]?.MusicSystems[0];
  const entry = system?.StaffLines[0]?.Measures[0]?.staffEntries[0];
  const note = entry?.graphicalVoiceEntries[0]?.notes[0] as unknown as
    | { getSVGGElement?: () => Element | null | undefined }
    | undefined;
  return note?.getSVGGElement?.() ?? null;
}

beforeAll(() => {
  installCanvasStub();
});

describe('laying out every page and drawing only some', () => {
  it('draws every page when nobody says otherwise', async () => {
    // Exactly what the engraver always did, which is what every piece that
    // fits in memory has been read with.
    const { engraver, sheets } = await engraved(null);

    expect(engraver.pageCount).toBeGreaterThanOrEqual(3);
    expect(sheets().every((sheet) => sheet.childElementCount > 0)).toBe(true);
  });

  it('lays every page out and draws only the ones asked for', async () => {
    const { engraver, sheets } = await engraved([1]);

    // Every page is there, at its size, and only one has anything in it.
    expect(sheets()).toHaveLength(engraver.pageCount);
    expect(sheets().map((sheet) => sheet.childElementCount > 0)).toEqual(
      sheets().map((_sheet, index) => index === 1),
    );
    expect(sheets()[2]?.getAttribute('height')).toBeTruthy();
    expect(engraver.isDrawn(1)).toBe(true);
    expect(engraver.isDrawn(0)).toBe(false);
  });

  it('draws a page later exactly as a whole engraving draws it', async () => {
    // The layout is whole, so the page cannot come out any different - and
    // this is the engraver's own drawing asked, not a copy of it.
    const whole = await engraved(null);
    const some = await engraved([0]);

    const drew = some.engraver.drawPage(2);

    expect(drew).toBe(true);
    expect(asDrawn(some.sheets()[2])).toBe(asDrawn(whole.sheets()[2]));
  });

  it('does not draw a page twice', async () => {
    const { engraver, sheets } = await engraved([0]);
    const once = sheets()[0]?.childElementCount;

    expect(engraver.drawPage(0)).toBe(false);
    expect(sheets()[0]?.childElementCount).toBe(once);
  });

  it('blanks a page it forgets, and leaves nothing inside what the layout still holds', async () => {
    // The layout keeps a hold on what it drew, so a page taken away is not let
    // go of. What it holds is emptied instead, so there is nothing left in it
    // to keep: read to the end of a long piece, that is the difference.
    const { engraver, sheets } = await engraved([1]);
    const held = aNoteOn(engraver, 1);
    expect(held?.childElementCount ?? 0).toBeGreaterThan(0);

    engraver.forgetPage(1);

    expect(sheets()[1]?.childElementCount).toBe(0);
    expect(engraver.isDrawn(1)).toBe(false);
    expect(held?.childNodes.length).toBe(0);
    expect(held?.attributes.length).toBe(0);
    // The page keeps its size, so nothing around it moves.
    expect(sheets()[1]?.getAttribute('height')).toBeTruthy();
  });

  it('draws a forgotten page again the same', async () => {
    const whole = await engraved(null);
    const { engraver, sheets } = await engraved([1]);

    engraver.forgetPage(1);
    engraver.drawPage(1);

    expect(asDrawn(sheets()[1])).toBe(asDrawn(whole.sheets()[1]));
  });

  it('has no page drawn once the drawing is cleared', async () => {
    const { engraver } = await engraved(null);

    engraver.clear();

    expect(engraver.isDrawn(0)).toBe(false);
  });

  it('starts from blank pages at every engraving', async () => {
    const { engraver, sheets } = await engraved([0]);
    engraver.drawPage(2);

    engraver.render();

    expect(engraver.isDrawn(2)).toBe(false);
    expect(sheets()[2]?.childElementCount).toBe(0);
    expect(engraver.isDrawn(0)).toBe(true);
  });
});

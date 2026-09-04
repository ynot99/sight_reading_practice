// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import { DomScoreImporter } from '../../src/infrastructure/notation/DomScoreImporter.js';
import { longExercise } from '../support/fixtures.js';
import { createScoreContainer, installCanvasStub, withLayout } from '../support/osmdHarness.js';

const importer = new DomScoreImporter();
const serializer = new MusicXmlSerializer();

/** One bar with the pedal down, written as the bracket MuseScore writes. */
const PEDALLED = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time>
      <clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="below"><direction-type><pedal type="start" line="yes"/>
      </direction-type><staff>1</staff></direction>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration>
      <voice>1</voice><type>whole</type></note>
      <direction placement="below"><direction-type><pedal type="stop" line="yes"/>
      </direction-type><staff>1</staff></direction>
    </measure>
  </part>
</score-partwise>`;

describe('what the page says about a repeat and a pedal', () => {
  let container: HTMLElement;
  let renderer: OsmdScoreRenderer;

  beforeAll(() => {
    installCanvasStub();
  });

  beforeEach(() => {
    document.body.replaceChildren();
    container = createScoreContainer();
    renderer = new OsmdScoreRenderer(container, { zoom: 1 });
  });

  /** Where the engraver put each numeric label, by its own coordinates. */
  function numbers(): { text: string; x: number }[] {
    return [...container.querySelectorAll('text')]
      .filter((text) => /^\d+$/.test(text.textContent ?? ''))
      .map((text) => ({
        text: text.textContent ?? '',
        x: Number.parseFloat(text.getAttribute('x') ?? '0'),
      }));
  }

  it('marks the number of a bar that is a second reading', async () => {
    // A repeat is written out rather than jumped back to, so the numbers go
    // back on their own and the mark is what says why. Beside the number,
    // which is the thing needing explaining and the one place above the staff
    // already kept clear of notes.
    await renderer.load(new MusicXmlSerializer().serialize(longExercise({ bars: 12 })));
    expect(container.querySelectorAll('.repeat-mark')).toHaveLength(0);
    // The engraver numbers some of the bars, not all of them.
    const drawn = numbers();
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.length).toBeLessThan(12);

    renderer.showRepeatedBars([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    // One mark per number, never one per bar: a bar the engraver did not
    // number asks the reader no question, so it is given no answer.
    expect(container.querySelectorAll('.repeat-mark')).toHaveLength(drawn.length);
  });

  it('puts it to the right of the number, as an exponent sits', async () => {
    await renderer.load(new MusicXmlSerializer().serialize(longExercise({ bars: 12 })));
    renderer.showRepeatedBars([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    const marks = [...container.querySelectorAll('.repeat-mark__ring')].map((ring) =>
      Number.parseFloat(/^M ([-\d.]+) /.exec(ring.getAttribute('d') ?? '')?.[1] ?? 'NaN'),
    );
    const first = Math.min(...numbers().map((each) => each.x));

    expect(marks.length).toBeGreaterThan(0);
    // Every mark is right of the leftmost number, and the nearest one is
    // clear of its own digits rather than sitting on them.
    expect(Math.min(...marks)).toBeGreaterThan(first);
  });

  it('marks nothing where the engraver numbered nothing', async () => {
    await renderer.load(new MusicXmlSerializer().serialize(longExercise({ bars: 12 })));
    const numbered = numbers().length;

    // Every bar re-read, but only the numbered ones can carry the answer.
    renderer.showRepeatedBars([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const all = container.querySelectorAll('.repeat-mark').length;
    renderer.showRepeatedBars([0]);
    const one = container.querySelectorAll('.repeat-mark').length;

    expect(all).toBe(numbered);
    expect(one).toBeLessThanOrEqual(1);
  });

  it('marks the pages the reader is not looking at yet', async () => {
    // A mark is drawn once and then turned to, so it belongs on the page its
    // own bar is on - the way the passage markers already do it. Asked for
    // "the bars on this page" instead, the marks existed only on whichever
    // page happened to be current when they were last painted, and turning
    // anywhere else showed none.
    document.body.replaceChildren();
    const paged = createScoreContainer();
    const renderer2 = new OsmdScoreRenderer(paged, { zoom: 1 });
    withLayout(paged, 260);
    await renderer2.load(new MusicXmlSerializer().serialize(longExercise({ bars: 16 })));
    renderer2.setPaged(true);
    expect(renderer2.pages.count).toBeGreaterThan(1);

    renderer2.showRepeatedBars([...Array(16).keys()]);

    const perSheet = [...paged.querySelectorAll('svg')].map(
      (sheet) => sheet.querySelectorAll('.repeat-mark').length,
    );
    expect(perSheet.filter((count) => count > 0).length).toBeGreaterThan(1);
  });

  it('keeps them through the re-engraving a zoom is', async () => {
    // The complaint this answers: zooming in made the marks disappear for
    // good. Zooming cuts the piece into more pages, so nearly every repeated
    // bar landed on a page that was never painted - the marks were not lost,
    // they had only ever been drawn on one page.
    document.body.replaceChildren();
    const paged = createScoreContainer();
    const renderer2 = new OsmdScoreRenderer(paged, { zoom: 1 });
    withLayout(paged, 260);
    await renderer2.load(new MusicXmlSerializer().serialize(longExercise({ bars: 16 })));
    renderer2.setPaged(true);
    renderer2.showRepeatedBars([...Array(16).keys()]);

    const before = paged.querySelectorAll('.repeat-mark').length;
    expect(before).toBeGreaterThan(0);

    renderer2.setZoom(2);
    renderer2.refresh();

    // One per number the engraver drew, whatever the zoom did to how many of
    // them there are: the mark answers a printed number, so there are exactly
    // as many as there are numbers to answer.
    const numbers = [...paged.querySelectorAll('text')].filter((text) =>
      /^\d+$/.test(text.textContent ?? ''),
    ).length;
    expect(paged.querySelectorAll('.repeat-mark')).toHaveLength(numbers);
  });

  it('draws the pedal the way its writer drew it', () => {
    // A bracket, which is what MuseScore wrote and what says exactly how long
    // the pedal is held. The word "Ped." says only that it was pressed - and
    // asked for that instead, the engraver laid one system out four times too
    // tall.
    const { exercise } = importer.read(PEDALLED);

    expect(exercise.pedalMarks).toHaveLength(2);
    expect(exercise.pedalMarks.every((mark) => mark.line)).toBe(true);
    expect(serializer.serialize(exercise)).toContain('line="yes"');
  });
});

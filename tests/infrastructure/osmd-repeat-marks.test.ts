// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import { DomScoreImporter } from '../../src/infrastructure/notation/DomScoreImporter.js';
import { longExercise } from '../support/fixtures.js';
import { createScoreContainer, installCanvasStub } from '../support/osmdHarness.js';

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

  it('marks the bars that are a second reading', async () => {
    // A repeat is written out rather than jumped back to, so without a mark
    // the music reads as a piece that simply says the same thing twice.
    await renderer.load(new MusicXmlSerializer().serialize(longExercise({ bars: 6 })));

    expect(container.querySelectorAll('.repeat-mark')).toHaveLength(0);

    renderer.showRepeatedBars([2, 3]);

    const marks = container.querySelectorAll('.repeat-mark');
    expect(marks).toHaveLength(2);
    // A turning arrow and not a repeat sign: nothing here turns back, and a
    // sign saying it did would be the page lying about its own layout.
    expect(marks[0]?.querySelector('.repeat-mark__ring')).not.toBeNull();
    expect(marks[0]?.querySelector('.repeat-mark__head')).not.toBeNull();
  });

  it('takes the marks away when there is nothing to mark', async () => {
    await renderer.load(new MusicXmlSerializer().serialize(longExercise({ bars: 6 })));
    renderer.showRepeatedBars([1]);
    expect(container.querySelectorAll('.repeat-mark')).toHaveLength(1);

    renderer.showRepeatedBars([]);

    expect(container.querySelectorAll('.repeat-mark')).toHaveLength(0);
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

// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { DomScoreImporter } from '../../src/infrastructure/notation/DomScoreImporter.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import { Duration } from '../../src/domain/model/Duration.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { createScoreContainer, installCanvasStub } from '../support/osmdHarness.js';

/**
 * A bass staff whose hand crosses up for one beat and comes back.
 *
 * Bar 36 of his Minecraft arrangement, in miniature: two clef changes inside
 * one bar, neither of them on the bar line.
 */
const crossing = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>24</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time><staves>1</staves>
      <clef number="1"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>24</duration>
      <voice>1</voice><type>quarter</type><staff>1</staff></note>
      <attributes><clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration>
      <voice>1</voice><type>quarter</type><staff>1</staff></note>
      <attributes><clef number="1"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>48</duration>
      <voice>1</voice><type>half</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

/** The same bar, with the change falling inside a note the upper voice holds. */
const heldOver = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>24</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time><staves>1</staves>
      <clef number="1"><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>48</duration>
      <voice>1</voice><type>half</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>48</duration>
      <voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>96</duration></backup>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>24</duration>
      <voice>2</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>24</duration>
      <voice>2</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>24</duration>
      <voice>2</voice><type>quarter</type><staff>1</staff></note>
      <attributes><clef number="1"><sign>F</sign><line>4</line></clef></attributes>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>24</duration>
      <voice>2</voice><type>quarter</type><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

const importer = new DomScoreImporter();
const serializer = new MusicXmlSerializer();

/** Where every glyph the engraver drew begins, left to right. */
async function glyphsAcross(exercise: Exercise): Promise<readonly number[]> {
  document.body.replaceChildren();
  const container = createScoreContainer();
  const renderer = new OsmdScoreRenderer(container, { zoom: 1 });
  await renderer.load(serializer.serialize(exercise));
  return [...container.querySelectorAll('path')]
    .map((path) => path.getAttribute('d') ?? '')
    .filter((d) => d.length > 200)
    .map((d) => Number(/^M([\d.]+)/.exec(d)?.[1] ?? NaN))
    .sort((left, right) => left - right);
}

/** What the engraver actually put on the page. */
interface Drawn {
  readonly glyphs: number;
  readonly ledgerLines: number;
}

async function draw(exercise: Exercise): Promise<Drawn> {
  document.body.replaceChildren();
  const container = createScoreContainer();
  const renderer = new OsmdScoreRenderer(container, { zoom: 1 });
  await renderer.load(serializer.serialize(exercise));
  const paths = [...container.querySelectorAll('path')].map(
    (path) => path.getAttribute('d') ?? '',
  );
  const straight = paths
    .map((d) => /^M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)$/.exec(d))
    .filter((said): said is RegExpExecArray => said !== null);
  return {
    // A clef, a notehead and a time signature are long curves; the lines of
    // the staff are not.
    glyphs: paths.filter((d) => d.length > 200).length,
    // Short and level, which nothing else on a page of whole notes is.
    ledgerLines: straight.filter(
      (said) =>
        Number(said[2]) === Number(said[4]) && Number(said[3]) - Number(said[1]) < 20,
    ).length,
  };
}

describe('a clef that changes partway through a bar', () => {
  beforeAll(() => {
    installCanvasStub();
  });

  it('is drawn where the writer changed it, and takes the ledger lines away', async () => {
    // The whole point of the change: the note in the middle is written in the
    // clef that puts it on the staff. Lose where the change happens and the
    // bar is drawn in one clef - which is what this program did, because a
    // clef change knew only which bar it was in.
    const exercise = importer.read(crossing).exercise;
    const flattened: Exercise = {
      ...exercise,
      staves: exercise.staves.map((staff) => ({ ...staff, clefChanges: [] })),
    };

    const kept = await draw(exercise);
    const lost = await draw(flattened);

    expect(kept.glyphs).toBe(lost.glyphs + 2);
    expect(kept.ledgerLines).toBeLessThan(lost.ledgerLines);
  });

  it('is drawn where it happens, not where the held voice next lets go', async () => {
    // The engraver reads the cursor, so a clef wrapped in a backup lands where
    // the writer put it. Written instead at the next boundary of the voice it
    // shares a stream with, it is drawn against the bar line - a whole beat
    // late, governing notes that have already gone by.
    const exercise = importer.read(heldOver).exercise;
    const atTheBarLine: Exercise = {
      ...exercise,
      staves: exercise.staves.map((staff) => ({
        ...staff,
        clefChanges: staff.clefChanges.map((change) => ({
          ...change,
          offsetTicks: Duration.WHOLE.ticks,
        })),
      })),
    };

    const asWritten = await glyphsAcross(exercise);
    const late = await glyphsAcross(atTheBarLine);

    expect(asWritten).toHaveLength(late.length);
    expect(asWritten[asWritten.length - 1]).toBeLessThan(late[late.length - 1] ?? 0);
  });
});

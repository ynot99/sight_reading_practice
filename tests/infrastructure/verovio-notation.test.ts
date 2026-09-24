// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry, type Exercise } from '../../src/domain/model/Exercise.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { DomScoreImporter } from '../../src/infrastructure/notation/DomScoreImporter.js';
import { readThePage } from '../../src/infrastructure/rendering/verovio/pageLayout.js';
import { VerovioCore, type PageShape } from '../../src/infrastructure/rendering/verovio/VerovioCore.js';
import { allowTheEngraverItsTime } from '../support/verovioStage.js';
import { bar, p, twoBarExercise } from '../support/fixtures.js';

/**
 * What Verovio draws of the notation we carry: a clef changed partway through
 * a bar, a hairpin on the side it was written, a crescendo written as a word,
 * music written an octave from where it sounds, and a pedal held as a line.
 *
 * Each is written because a score the reader plays has it, and each was once
 * lost on the way to the page. Asked of the drawing itself.
 */
let core: VerovioCore;
beforeAll(async () => {
  core = await VerovioCore.start();
});
allowTheEngraverItsTime();

const serializer = new MusicXmlSerializer();
const importer = new DomScoreImporter();
const SHAPE: PageShape = { pageWidth: 2200, pageHeight: 1400, scale: 50 };

/** The first page Verovio draws of an exercise. */
function drawn(exercise: Exercise): SVGSVGElement {
  core.load(serializer.serialize(exercise), SHAPE);
  const page = new DOMParser().parseFromString(core.page(1), 'image/svg+xml').documentElement;
  return page as unknown as SVGSVGElement;
}

/** Where a glyph is placed: its `translate(x, y)`. */
function placeOf(use: Element | null | undefined): { x: number; y: number } {
  const found = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(use?.getAttribute('transform') ?? '');
  return { x: Number(found?.[1] ?? NaN), y: Number(found?.[2] ?? NaN) };
}

/** The top line of the first staff, in the frame the page's marks are drawn in. */
function topLineOf(page: SVGSVGElement): number {
  const line = /M\s*-?[\d.]+\s+(-?[\d.]+)/.exec(page.querySelector('g.staff > path')?.getAttribute('d') ?? '');
  return Number(line?.[1] ?? NaN);
}

/**
 * A bass staff whose hand crosses up for one beat and comes back.
 *
 * Bar 36 of his Minecraft arrangement, in miniature: two clef changes inside
 * one bar, neither of them on the bar line.
 */
const CROSSING = `<?xml version="1.0" encoding="UTF-8"?>
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
const HELD_OVER = `<?xml version="1.0" encoding="UTF-8"?>
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

describe('a clef that changes partway through a bar', () => {
  /**
   * The clefs drawn inside the bar, which a change is - the one it opens with
   * is not. Those with a glyph: Verovio also leaves an empty one in each other
   * voice of the staff, standing for the change there.
   */
  function changes(page: SVGSVGElement): Element[] {
    return [...page.querySelectorAll('g.layer g.clef')].filter((clef) => clef.querySelector('use') !== null);
  }

  it('is drawn where the writer changed it, and takes the ledger lines away', () => {
    // The note in the middle is written in the clef that puts it on the
    // staff. Lose the change and the bar is drawn in one clef, the middle
    // note on a ladder of ledger lines.
    const exercise = importer.read(CROSSING).exercise;
    const flattened: Exercise = {
      ...exercise,
      staves: exercise.staves.map((staff) => ({ ...staff, clefChanges: [] })),
    };

    const kept = drawn(exercise);
    const lost = drawn(flattened);

    expect(changes(kept)).toHaveLength(2);
    expect(changes(lost)).toHaveLength(0);
    expect(kept.querySelectorAll('g.ledgerLines path').length).toBeLessThan(
      lost.querySelectorAll('g.ledgerLines path').length,
    );
  });

  it('is drawn where it happens, not where the held voice next lets go', () => {
    // Written at the next boundary of the voice it shares a stream with, it
    // would stand against the bar line, a whole beat late.
    const exercise = importer.read(HELD_OVER).exercise;
    const atTheBarLine: Exercise = {
      ...exercise,
      staves: exercise.staves.map((staff) => ({
        ...staff,
        clefChanges: staff.clefChanges.map((change) => ({ ...change, offsetTicks: Duration.WHOLE.ticks })),
      })),
    };

    const asWritten = placeOf(changes(drawn(exercise))[0]?.querySelector('use')).x;
    const late = placeOf(changes(drawn(atTheBarLine))[0]?.querySelector('use')).x;

    expect(asWritten).toBeLessThan(late);
    // Before the note it governs, which is the last in the bar.
    const page = drawn(exercise);
    const heads = readThePage(page).heads;
    const lastHead = Math.max(...[...heads.values()].map((head) => head.x));
    const margin = Number(/translate\(\s*(-?[\d.]+)/.exec(page.querySelector('g.page-margin')?.getAttribute('transform') ?? '')?.[1]);
    expect(asWritten + margin).toBeLessThan(lastHead);
  });
});

/** One line swelling while another fades, under or over the treble. */
function twoHairpins(upper: 'above' | 'below', words: string | undefined = undefined): Exercise {
  return {
    ...twoBarExercise(),
    hairpins: [
      {
        measureIndex: 0,
        offsetTicks: 0,
        kind: 'crescendo',
        untilMeasureIndex: 1,
        untilOffsetTicks: 0,
        staffNumber: 1,
        placement: upper,
        ...(words === undefined ? {} : { text: words }),
      },
      {
        measureIndex: 0,
        offsetTicks: 0,
        kind: 'diminuendo',
        untilMeasureIndex: 1,
        untilOffsetTicks: 0,
        staffNumber: 1,
        placement: 'below',
      },
    ],
  };
}

/** The highest point of each hairpin drawn. */
function hairpinTops(page: SVGSVGElement): number[] {
  return [...page.querySelectorAll('g.hairpin polyline')].map((line) =>
    Math.min(
      ...(line.getAttribute('points') ?? '')
        .trim()
        .split(/\s+/)
        .map((point) => Number(point.split(',')[1])),
    ),
  );
}

describe('a hairpin', () => {
  it('is drawn above the staff where the writer put it above', () => {
    const page = drawn(twoHairpins('above'));
    const top = topLineOf(page);

    const tops = hairpinTops(page);
    expect(tops).toHaveLength(2);
    expect(tops.filter((y) => y < top)).toHaveLength(1);
  });

  it('is drawn below where the writer said below', () => {
    const page = drawn(twoHairpins('below'));

    const tops = hairpinTops(page);
    expect(tops).toHaveLength(2);
    expect(tops.filter((y) => y < topLineOf(page))).toHaveLength(0);
  });

  it('written as a word, is that word and not a wedge as well', () => {
    // What he saw in his arrangement at bars 188 to 189: the page says
    // `cresc.`, so the page has to say `cresc.`
    const page = drawn(twoHairpins('below', 'cresc.'));

    expect(page.textContent).toContain('cresc.');
    expect(hairpinTops(page)).toHaveLength(1);
  });
});

/** High music in bar one, written an octave lower under an 8va. */
function underAnOctaveSign(pitches = ['C6', 'D6', 'E6', 'F6'], shifted = true): Exercise {
  const written = twoBarExercise();
  return {
    ...written,
    octaveShifts: shifted
      ? [
          {
            measureIndex: 0,
            offsetTicks: 0,
            untilMeasureIndex: 0,
            untilOffsetTicks: Duration.WHOLE.ticks,
            direction: 'down',
            size: 8,
            staffNumber: 1,
          },
        ]
      : [],
    staves: written.staves.map((staff, at) =>
      at === 0
        ? {
            ...staff,
            measures: [
              bar(...pitches.map((name) => noteEntry(p(name), Duration.QUARTER))),
              staff.measures[1] ?? bar(noteEntry(p('G4'), Duration.WHOLE)),
            ],
          }
        : staff,
    ),
  };
}

describe('music written an octave from where it sounds', () => {
  it('is drawn an octave down, where C5 to F5 would be, under a sign over that bar only', () => {
    // Against each page's own top line: the sign takes room above the staff,
    // and the whole system stands lower for it.
    const onTheStaff = (exercise: Exercise): (number | undefined)[] => {
      const layout = readThePage(drawn(exercise));
      const top = layout.systems[0]?.bars[0]?.staves[0]?.top ?? NaN;
      return ['n0-1-0-0', 'n0-1-1-0', 'n0-1-2-0', 'n0-1-3-0'].map((name) => {
        const head = layout.heads.get(name);
        return head === undefined ? undefined : head.y - top;
      });
    };
    const page = drawn(underAnOctaveSign());
    const sign = page.querySelector('g.octave');

    expect(sign).not.toBeNull();
    expect(onTheStaff(underAnOctaveSign())).toEqual(onTheStaff(underAnOctaveSign(['C5', 'D5', 'E5', 'F5'], false)));
    // The line runs out within the bar it covers.
    const ends = [...(sign?.querySelectorAll('path') ?? [])].map((path) =>
      Number(/L\s*(-?[\d.]+)/.exec(path.getAttribute('d') ?? '')?.[1] ?? NaN),
    );
    const barLine = readThePage(page).systems[0]?.bars[0]?.right ?? NaN;
    const margin = Number(/translate\(\s*(-?[\d.]+)/.exec(page.querySelector('g.page-margin')?.getAttribute('transform') ?? '')?.[1]);
    expect(ends.length).toBeGreaterThan(0);
    expect(Math.max(...ends) + margin).toBeLessThanOrEqual(barLine);
  });
});

describe('a pedal held as a line', () => {
  it('is drawn as a bracket, the way its writer drew it, and not as the word', () => {
    const pedalled: Exercise = {
      ...twoBarExercise(),
      pedalMarks: [
        { measureIndex: 0, offsetTicks: 0, type: 'start', line: true },
        { measureIndex: 1, offsetTicks: Duration.WHOLE.ticks - 1, type: 'stop', line: true },
      ],
    };

    const page = drawn(pedalled);

    expect(page.querySelectorAll('g.pedal rect').length).toBeGreaterThan(0);
    expect(page.querySelectorAll('g.pedal use')).toHaveLength(0);
  });
});

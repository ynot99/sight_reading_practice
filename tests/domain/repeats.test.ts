// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import { barIsRepeated, barNumberOf, measureCount, validateExercise } from '../../src/domain/model/Exercise.js';
import { NO_REPEAT, playedOrder, type BarRepeat } from '../../src/domain/notation/unrollRepeats.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { DomScoreImporter } from '../../src/infrastructure/notation/DomScoreImporter.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';

const importer = new DomScoreImporter();
const serializer = new MusicXmlSerializer();

function bars(...marks: Partial<BarRepeat>[]): BarRepeat[] {
  return marks.map((mark) => ({ ...NO_REPEAT, ...mark }));
}

describe('the order the bars are read in', () => {
  it('leaves music without repeats alone', () => {
    expect(playedOrder(bars({}, {}, {}))).toEqual([0, 1, 2]);
  });

  it('goes back to the sign and comes forward again', () => {
    // Bars two and three inside a repeat: 1 2 3 2 3 4.
    expect(playedOrder(bars({}, { opens: true }, { closes: true }, {}))).toEqual([
      0, 1, 2, 1, 2, 3,
    ]);
  });

  it('goes back to the beginning when nothing opened the span', () => {
    // A closing repeat with no opening one repeats from the top, which is
    // what the sign means and what every engraver does with it.
    expect(playedOrder(bars({}, { closes: true }, {}))).toEqual([0, 1, 0, 1, 2]);
  });

  it('takes a span as many times as the file asks', () => {
    expect(playedOrder(bars({ opens: true }, { closes: true, times: 3 }))).toEqual([
      0, 1, 0, 1, 0, 1,
    ]);
  });

  it('reads the first ending once and the second in its place', () => {
    // 1 | 2 (first ending) :| 3 (second ending) - read as 1 2 1 3.
    const written = bars(
      { opens: true },
      { endings: [1], endsEnding: true, closes: true },
      { endings: [2], endsEnding: true },
    );
    expect(playedOrder(written)).toEqual([0, 1, 0, 2]);
  });

  it('carries an ending across every bar of its bracket', () => {
    // A bracket two bars long: only its ends are marked in the file, and the
    // bar between would otherwise look like music played every time round.
    const written = bars(
      { opens: true },
      { endings: [1] },
      { endings: [1], endsEnding: true, closes: true },
      { endings: [2], endsEnding: true },
    );
    expect(playedOrder(written)).toEqual([0, 1, 2, 0, 3]);
  });

  it('stops rather than looping for ever on repeats that contradict', () => {
    // A span that always jumps back would lay out a page that never finishes.
    const forever = playedOrder(bars({ opens: true }, { closes: true, times: 1000 }));
    expect(forever.length).toBeLessThanOrEqual(16);
  });
});

describe('a score written out from its repeats', () => {
  /** Four bars where two and three are inside a repeat. */
  const REPEATED = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time>
      <clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration>
      <voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="2">
      <barline location="left"><repeat direction="forward"/></barline>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>16</duration>
      <voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="3">
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>16</duration>
      <voice>1</voice><type>whole</type></note>
      <barline location="right"><repeat direction="backward"/></barline>
    </measure>
    <measure number="4">
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>16</duration>
      <voice>1</voice><type>whole</type></note>
    </measure>
  </part>
</score-partwise>`;

  it('reads six bars where four are printed', () => {
    const { exercise, warnings } = importer.read(REPEATED);

    expect(measureCount(exercise)).toBe(6);
    expect(buildTimeline(exercise).steps.map((step) => step.measureIndex)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(warnings.map((warning) => warning.kind)).toContain('repeats-unrolled');
  });

  it('keeps the bar numbers the score gave them', () => {
    // The whole cost of writing it out, and the reason it is paid this way:
    // the reader compares the page with the file it came from, so bar four
    // has to be bar four however many bars are read before it.
    const { exercise } = importer.read(REPEATED);

    expect([0, 1, 2, 3, 4, 5].map((at) => barNumberOf(exercise, at))).toEqual([
      1, 2, 3, 2, 3, 4,
    ]);
    expect([0, 1, 2, 3, 4, 5].map((at) => barIsRepeated(exercise, at))).toEqual([
      false,
      false,
      false,
      true,
      true,
      false,
    ]);
  });

  it('plays the repeated bars again rather than once', () => {
    const { exercise } = importer.read(REPEATED);
    const played = buildTimeline(exercise).steps.flatMap((step) => step.expectedMidi);

    // C D E D E F, which is the music as it is actually read.
    expect(played).toEqual([72, 74, 76, 74, 76, 77]);
  });

  it('survives being put away and opened again', () => {
    // The library keeps the file this writes, so the numbering has to come
    // back with it - otherwise a stored score reopens as bars one to six.
    const { exercise } = importer.read(REPEATED);
    const { exercise: back } = importer.read(serializer.serialize(exercise));

    expect(measureCount(back)).toBe(6);
    expect([0, 1, 2, 3, 4, 5].map((at) => barNumberOf(back, at))).toEqual([1, 2, 3, 2, 3, 4]);
    expect([0, 1, 2, 3, 4, 5].map((at) => barIsRepeated(back, at))).toEqual([
      false,
      false,
      false,
      true,
      true,
      false,
    ]);
    expect(() => validateExercise(back)).not.toThrow();
  });

  it('presses the pedal on both readings of a bar', () => {
    const pedalled = REPEATED.replace(
      '<measure number="2">\n      <barline location="left"><repeat direction="forward"/></barline>',
      '<measure number="2">\n      <barline location="left"><repeat direction="forward"/></barline>' +
        '<direction placement="below"><direction-type><pedal type="start" line="yes"/>' +
        '</direction-type><staff>1</staff></direction>',
    );
    const { exercise } = importer.read(pedalled);

    // Bar two is read at positions one and three, and the pedal goes down at
    // both: everything positioned by bar moves with the music.
    expect(exercise.pedalMarks.map((mark) => mark.measureIndex)).toEqual([1, 3]);
  });

  it('keeps every bar adding up to its metre', () => {
    const { exercise } = importer.read(REPEATED);
    expect(() => validateExercise(exercise)).not.toThrow();
    expect(Duration.WHOLE.ticks).toBeGreaterThan(0);
  });
});

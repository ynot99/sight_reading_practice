// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import {
  barIsRepeated,
  barLines,
  barNumberOf,
  dynamicAt,
  measureCount,
  pedalHeldUntil,
  tempoAtTick,
  validateExercise,
  type DynamicLevel,
} from '../../src/domain/model/Exercise.js';
import {
  NO_REPEAT,
  playedOrder,
  unrollRepeats,
  type BarRepeat,
} from '../../src/domain/notation/unrollRepeats.js';
import { longExercise } from '../support/fixtures.js';
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
    // both: everything positioned by bar moves with the music. Never lifted,
    // it is still down where the reading turns back - and bar two was first
    // read with it up, so it comes up there and goes down again with the bar:
    // a change of pedal, as a reader turning back makes one.
    expect(exercise.pedalMarks.map((mark) => [mark.measureIndex, mark.type])).toEqual([
      [1, 'start'],
      [3, 'stop'],
      [3, 'start'],
    ]);
  });

  /** The repeated score with a direction written at the start of a bar. */
  function withDirection(bar: number, direction: string): string {
    const opening = new RegExp(
      `(<measure number="${String(bar)}">` +
        '(?:\\s*<barline location="left">.*?</barline>)?' +
        '(?:\\s*<attributes>[\\s\\S]*?</attributes>)?)',
    );
    return REPEATED.replace(opening, `$1<direction>${direction}</direction>`);
  }

  /** Where a line lies in the reading: bar and offset at each end. */
  function spans(marks: readonly { measureIndex: number; offsetTicks: number; untilMeasureIndex: number; untilOffsetTicks: number }[]): number[][] {
    return marks.map((mark) => [mark.measureIndex, mark.offsetTicks, mark.untilMeasureIndex, mark.untilOffsetTicks]);
  }

  const WHOLE = Duration.WHOLE.ticks;

  it('reads a dynamic on both readings of its bar', () => {
    // Left where the file put it, the second reading was played at whatever
    // loudness the first had ended on.
    const { exercise } = importer.read(
      withDirection(2, '<direction-type><dynamics><f/></dynamics></direction-type><staff>1</staff>'),
    );

    expect(exercise.dynamicMarks.map((mark) => mark.measureIndex)).toEqual([1, 3]);
  });

  it('reads a word about the speed on both readings of its bar', () => {
    const { exercise } = importer.read(
      withDirection(3, '<direction-type><words>rit.</words></direction-type>'),
    );

    expect(exercise.tempoWords.map((word) => word.measureIndex)).toEqual([2, 4]);
  });

  it('draws an octave sign under every reading of the bars it covers', () => {
    // Bars two and three, read twice. The second reading had no sign over
    // notes written an octave from where they sound.
    const signed = withDirection(2, '<direction-type><octave-shift type="down" size="8"/></direction-type>')
      .replace(
        /(<measure number="3">[\s\S]*?<type>whole<\/type><\/note>)/,
        '$1<direction><direction-type><octave-shift type="stop" size="8"/></direction-type></direction>',
      );
    const { exercise } = importer.read(signed);

    expect(spans(exercise.octaveShifts)).toEqual([
      [1, 0, 2, WHOLE],
      [3, 0, 4, WHOLE],
    ]);
  });

  it('draws a sign begun before the repeat again over the bars read twice', () => {
    // From bar one to the end of bar three: the second reading arrives at bar
    // two from the end of bar three, and is still under the sign.
    const signed = withDirection(1, '<direction-type><octave-shift type="down" size="8"/></direction-type>')
      .replace(
        /(<measure number="3">[\s\S]*?<type>whole<\/type><\/note>)/,
        '$1<direction><direction-type><octave-shift type="stop" size="8"/></direction-type></direction>',
      );
    const { exercise } = importer.read(signed);

    expect(spans(exercise.octaveShifts)).toEqual([
      [0, 0, 2, WHOLE],
      [3, 0, 4, WHOLE],
    ]);
  });

  it('ends a hairpin at the bar line where the reading turns back', () => {
    // From bar three into bar four. The first reading of bar three turns back
    // to bar two at its end, so the hairpin ends with it; the second goes on
    // into bar four.
    const swelling = withDirection(3, '<direction-type><wedge type="crescendo"/></direction-type>').replace(
      /(<measure number="4">)/,
      '$1<direction><direction-type><wedge type="stop"/></direction-type></direction>',
    );
    const { exercise } = importer.read(swelling);

    expect(spans(exercise.hairpins)).toEqual([
      [2, 0, 2, WHOLE],
      [4, 0, 5, 0],
    ]);
  });

  it('keeps a line’s own start and end inside a bar, and starts it again at the bar line', () => {
    // Read 1 2 3 2 3 4, a line from a beat into bar one to two beats into bar
    // three: the first reading keeps both of its ends; the second arrives at
    // bar two under it, so it starts at that bar line and keeps the end.
    const q = Duration.QUARTER.ticks;
    const line = {
      measureIndex: 0,
      offsetTicks: q,
      untilMeasureIndex: 2,
      untilOffsetTicks: q * 2,
      direction: 'down' as const,
      size: 8 as const,
      staffNumber: 1,
    };
    const unrolled = unrollRepeats({ ...longExercise({ bars: 4 }), octaveShifts: [line] }, [0, 1, 2, 1, 2, 3]);

    expect(spans(unrolled.octaveShifts)).toEqual([
      [0, q, 2, q * 2],
      [3, 0, 4, q * 2],
    ]);
  });

  it('draws nothing of a line that ends at the bar line a reading arrives at', () => {
    // Ending where bar two begins, it covers none of bar two - and the second
    // reading begins there.
    const q = Duration.QUARTER.ticks;
    const hairpin = {
      measureIndex: 0,
      offsetTicks: q,
      untilMeasureIndex: 1,
      untilOffsetTicks: 0,
      kind: 'crescendo' as const,
      staffNumber: 1,
    };
    const unrolled = unrollRepeats({ ...longExercise({ bars: 4 }), hairpins: [hairpin] }, [0, 1, 2, 1, 2, 3]);

    expect(spans(unrolled.hairpins)).toEqual([[0, q, 1, 0]]);
  });

  describe('a bar read again, read as it was the first time', () => {
    // Read 1 2 3 2 3 4: bars two and three twice.
    const order = [0, 1, 2, 1, 2, 3];
    const q = Duration.QUARTER.ticks;
    const base = longExercise({ bars: 4, tempoBpm: 60 });
    const atBar = (exercise: ReturnType<typeof unrollRepeats>, at: number, offset = 0): number =>
      (barLines(exercise)[at]?.startTicks ?? 0) + offset;
    const dynamic = (measureIndex: number, offsetTicks: number, level: DynamicLevel, staffNumber: number | null = null) => ({
      measureIndex,
      offsetTicks,
      level,
      staffNumber,
    });

    it('starts the second reading at the loudness the first began at', () => {
      // A repeat is read as the page is read anywhere else. The stretch ends
      // forte, and the second reading began forte.
      const unrolled = unrollRepeats(
        { ...base, dynamicMarks: [dynamic(0, 0, 'p'), dynamic(1, q * 2, 'f')] },
        order,
      );

      expect(dynamicAt(unrolled, 3, 0, 1)).toBe('p');
      expect(dynamicAt(unrolled, 3, q * 2, 1)).toBe('f');
      // A mark of the page, so a score kept and opened again reads the same.
      expect(unrolled.dynamicMarks.find((mark) => mark.measureIndex === 3 && mark.offsetTicks === 0)?.implied).not.toBe(true);
    });

    it('puts back a hand marked on its own inside the stretch', () => {
      const unrolled = unrollRepeats(
        { ...base, dynamicMarks: [dynamic(0, 0, 'p'), dynamic(2, 0, 'f', 2)] },
        order,
      );

      expect(dynamicAt(unrolled, 3, 0, 2)).toBe('p');
      expect(dynamicAt(unrolled, 4, 0, 2)).toBe('f');
    });

    it('states nothing again where the stretch left the loudness as it found it', () => {
      const unrolled = unrollRepeats({ ...base, dynamicMarks: [dynamic(0, 0, 'p')] }, order);

      expect(unrolled.dynamicMarks.map((mark) => mark.measureIndex)).toEqual([0]);
    });

    it('starts the second reading at the speed the first began at', () => {
      const unrolled = unrollRepeats(
        { ...base, tempoChanges: [{ measureIndex: 2, offsetTicks: 0, tempoBpm: 90 }] },
        order,
      );

      expect(tempoAtTick(unrolled, atBar(unrolled, 3))).toBe(60);
      expect(tempoAtTick(unrolled, atBar(unrolled, 4))).toBe(90);
    });

    it('lifts the pedal at the turn where it was up when the bar was first read', () => {
      // Pressed in bar three and lifted in bar four: the turn back from bar
      // three goes to a bar read with the pedal up.
      const unrolled = unrollRepeats(
        {
          ...base,
          pedalMarks: [
            { measureIndex: 2, offsetTicks: 0, type: 'start', line: true },
            { measureIndex: 3, offsetTicks: 0, type: 'stop', line: true },
          ],
        },
        order,
      );

      expect(pedalHeldUntil(unrolled, atBar(unrolled, 3, q))).toBeNull();
      expect(pedalHeldUntil(unrolled, atBar(unrolled, 4, q))).not.toBeNull();
    });

    it('presses it again where it was down when the bar was first read', () => {
      // Down from the top and lifted halfway into bar two: bar two was first
      // read with it down.
      const unrolled = unrollRepeats(
        {
          ...base,
          pedalMarks: [
            { measureIndex: 0, offsetTicks: 0, type: 'start', line: true },
            { measureIndex: 1, offsetTicks: q * 2, type: 'stop', line: true },
          ],
        },
        order,
      );

      expect(pedalHeldUntil(unrolled, atBar(unrolled, 3, q))).not.toBeNull();
      expect(pedalHeldUntil(unrolled, atBar(unrolled, 3, q * 3))).toBeNull();
    });
  });

  it('keeps every bar adding up to its metre', () => {
    const { exercise } = importer.read(REPEATED);
    expect(() => validateExercise(exercise)).not.toThrow();
    expect(Duration.WHOLE.ticks).toBeGreaterThan(0);
  });
});

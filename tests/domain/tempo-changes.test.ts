// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import {
  elapsedMsAt,
  exerciseTicks,
  spanMs,
  tempoAtTick,
  tempoSpans,
  validateExercise,
} from '../../src/domain/model/Exercise.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { DomScoreImporter } from '../../src/infrastructure/notation/DomScoreImporter.js';
import { twoBarExercise } from '../support/fixtures.js';

const importer = new DomScoreImporter();
const serializer = new MusicXmlSerializer();

/** Two bars of 4/4 at 60, with whatever tempo marks are asked for. */
function withTempos(changes: Exercise['tempoChanges']): Exercise {
  return { ...twoBarExercise(), tempoChanges: changes };
}

const BAR = Duration.WHOLE.ticks;

describe('a piece that changes tempo', () => {
  it('takes each stretch at its own speed', () => {
    // 60 to the quarter is a second a beat, so the first bar is four seconds;
    // doubled for the second, it is two.
    const exercise = withTempos([{ measureIndex: 1, offsetTicks: 0, tempoBpm: 120 }]);

    expect(tempoAtTick(exercise, 0)).toBe(60);
    expect(tempoAtTick(exercise, BAR - 1)).toBe(60);
    expect(tempoAtTick(exercise, BAR)).toBe(120);
    expect(elapsedMsAt(exercise, BAR)).toBe(4000);
    expect(elapsedMsAt(exercise, exerciseTicks(exercise))).toBe(6000);
    expect(spanMs(exercise, BAR, 2 * BAR)).toBe(2000);
  });

  it('changes partway through a bar, where the mark is written', () => {
    const exercise = withTempos([
      { measureIndex: 0, offsetTicks: Duration.HALF.ticks, tempoBpm: 120 },
    ]);

    // Two beats at a second, then two at half of one.
    expect(elapsedMsAt(exercise, BAR)).toBe(3000);
    expect(tempoAtTick(exercise, Duration.HALF.ticks)).toBe(120);
  });

  it('reads a mark on the first instant as the tempo it opens at', () => {
    const exercise = withTempos([{ measureIndex: 0, offsetTicks: 0, tempoBpm: 90 }]);
    const spans = tempoSpans(exercise);

    expect(spans).toEqual([{ startTicks: 0, tempoBpm: 90 }]);
    expect(elapsedMsAt(exercise, BAR)).toBeCloseTo((4 * 60_000) / 90, 6);
  });

  it('counts a run of marks inside one bar in order', () => {
    // A ritardando as it is actually written: a mark on each beat.
    const exercise = withTempos(
      [120, 90, 60].map((tempoBpm, beat) => ({
        measureIndex: 0,
        offsetTicks: Duration.QUARTER.ticks * (beat + 1),
        tempoBpm,
      })),
    );

    expect(tempoSpans(exercise).map((span) => span.tempoBpm)).toEqual([60, 120, 90, 60]);
    const quarter = 60_000;
    expect(elapsedMsAt(exercise, BAR)).toBeCloseTo(
      quarter / 60 + quarter / 120 + quarter / 90 + quarter / 60,
      6,
    );
  });

  it('refuses a tempo that would stop the clock', () => {
    expect(() =>
      validateExercise(withTempos([{ measureIndex: 1, offsetTicks: 0, tempoBpm: 0 }])),
    ).toThrow(/positive number/);
  });

  it('survives being written out and read back', () => {
    const exercise = withTempos([
      { measureIndex: 0, offsetTicks: Duration.QUARTER.ticks, tempoBpm: 96 },
      { measureIndex: 0, offsetTicks: Duration.QUARTER.ticks * 2, tempoBpm: 108 },
      { measureIndex: 1, offsetTicks: 0, tempoBpm: 132 },
    ]);
    const { exercise: back } = importer.read(serializer.serialize(exercise));

    expect(tempoSpans(back)).toEqual(tempoSpans(exercise));
  });

  it('places a mark where no voice has a note to hang it on', () => {
    // The second bar of the fixture is a whole note over a half and a rest,
    // so a mark a quarter in belongs to nothing that is written there. Placed
    // beside the nearest note it would land on the wrong beat, or on top of
    // the mark before it.
    const exercise = withTempos([
      { measureIndex: 1, offsetTicks: Duration.QUARTER.ticks, tempoBpm: 96 },
      { measureIndex: 1, offsetTicks: Duration.QUARTER.ticks * 3, tempoBpm: 72 },
    ]);
    const { exercise: back } = importer.read(serializer.serialize(exercise));

    expect(back.tempoChanges).toEqual(exercise.tempoChanges);
  });
});

describe('reading tempo marks from a file', () => {
  function score(directions: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time>
      <clef><sign>G</sign><line>2</line></clef></attributes>
      ${directions}
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration>
      <voice>1</voice><type>whole</type></note>
    </measure>
    <measure number="2">
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>8</duration>
      <voice>1</voice><type>half</type></note>
      <direction placement="above"><sound tempo="150"/></direction>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>8</duration>
      <voice>1</voice><type>half</type></note>
    </measure>
  </part>
</score-partwise>`;
  }

  it('keeps every mark, not only the first', () => {
    const { exercise } = importer.read(score('<direction placement="above"><sound tempo="72"/></direction>'));

    expect(exercise.tempoBpm).toBe(72);
    expect(exercise.tempoChanges).toEqual([
      { measureIndex: 1, offsetTicks: Duration.HALF.ticks, tempoBpm: 150 },
    ]);
  });

  it('reads a printed mark against the beat it names', () => {
    // "eighth = 100" is a hundred eighths a minute, which is fifty quarters.
    // Read as a hundred, the piece plays at twice its own speed.
    const { exercise } = importer.read(
      score(
        '<direction placement="above"><direction-type><metronome>' +
          '<beat-unit>eighth</beat-unit><per-minute>100</per-minute>' +
          '</metronome></direction-type></direction>',
      ),
    );

    expect(exercise.tempoBpm).toBe(50);
  });

  it('opens at the assumed tempo when the writer marks nothing until later', () => {
    const { exercise } = importer.read(score(''));

    expect(exercise.tempoBpm).toBe(120);
    expect(exercise.tempoChanges.map((change) => change.tempoBpm)).toEqual([150]);
  });
});

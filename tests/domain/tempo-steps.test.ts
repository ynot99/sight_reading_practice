import { describe, expect, it } from 'vitest';
import { A_STEP_BACK_AT_MOST_BPM, MARKS_IN_A_RUN, withTempoStepsAsWords } from '../../src/domain/notation/tempoSteps.js';
import { tempoWordKind, withTempoWordsPlayed } from '../../src/domain/notation/tempoWords.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { ScoreFileImporter } from '../../src/infrastructure/notation/ScoreFileImporter.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { longExercise } from '../support/fixtures.js';
import type { Exercise, TempoChange, TempoWord } from '../../src/domain/model/Exercise.js';

const BEAT = Duration.QUARTER.ticks;

/** Eight bars of quarters at 100, with the marks and words given. */
function piece(tempoChanges: readonly TempoChange[], tempoWords: readonly TempoWord[] = []): Exercise {
  return { ...longExercise({ bars: 8, tempoBpm: 100 }), tempoChanges, tempoWords };
}

/** A mark of speed so many beats into the piece: four to a bar. */
function mark(beat: number, tempoBpm: number): TempoChange {
  return { measureIndex: Math.floor(beat / 4), offsetTicks: (beat % 4) * BEAT, tempoBpm };
}

function word(beat: number, text: string): TempoWord {
  return { measureIndex: Math.floor(beat / 4), offsetTicks: (beat % 4) * BEAT, text, kind: tempoWordKind(text) };
}

/** Each change as its beat, its speed, and whether it is printed. */
const said = (exercise: Exercise): string[] =>
  exercise.tempoChanges.map(
    (change) =>
      `${String(change.measureIndex * 4 + change.offsetTicks / BEAT)}=${String(change.tempoBpm)}${change.unprinted === true ? ' unprinted' : ''}`,
  );
const words = (exercise: Exercise): string[] =>
  exercise.tempoWords.map((each) => `${String(each.measureIndex * 4 + each.offsetTicks / BEAT)}:${each.text}`);

describe('a gradual change written as a run of marks', () => {
  it('is printed as its first mark, a word where it begins and the mark it arrives at, every step still heard', () => {
    const climbing = withTempoStepsAsWords(piece([mark(4, 101), mark(5, 102), mark(6, 103), mark(7, 104)]));

    expect(said(climbing)).toEqual(['4=101', '5=102 unprinted', '6=103 unprinted', '7=104']);
    expect(words(climbing)).toEqual(['4:accel.']);
    const falling = withTempoStepsAsWords(piece([mark(4, 99), mark(5, 98), mark(6, 97)]));
    expect(said(falling)).toEqual(['4=99', '5=98 unprinted', '6=97']);
    expect(words(falling)).toEqual(['4:rit.']);
  });

  it('is three marks at least: two are a change and a change back', () => {
    expect(MARKS_IN_A_RUN).toBe(3);
    const two = withTempoStepsAsWords(piece([mark(4, 101), mark(5, 102)]));

    expect(said(two)).toEqual(['4=101', '5=102']);
    expect(words(two)).toEqual([]);
  });

  it('runs while each mark is within a bar of the one before, and no further', () => {
    // A bar apart, still a run; a bar and a beat, two changes.
    const within = withTempoStepsAsWords(piece([mark(4, 101), mark(8, 102), mark(12, 103)]));
    const apart = withTempoStepsAsWords(piece([mark(4, 101), mark(8, 102), mark(13, 103)]));

    expect(said(within)).toEqual(['4=101', '8=102 unprinted', '12=103']);
    expect(said(apart)).toEqual(['4=101', '8=102', '13=103']);
  });

  it('runs on over a step back no larger than a hand-drawn curve jitters by, and stops at a larger one', () => {
    expect(A_STEP_BACK_AT_MOST_BPM).toBe(2);
    const jitter = withTempoStepsAsWords(piece([mark(4, 110), mark(5, 106), mark(6, 108), mark(7, 104)]));
    const back = withTempoStepsAsWords(piece([mark(4, 110), mark(5, 106), mark(6, 109), mark(7, 104)]));

    expect(said(jitter)).toEqual(['4=110', '5=106 unprinted', '6=108 unprinted', '7=104']);
    // Back three: the run is two marks, and none of it is one.
    expect(said(back).filter((change) => change.endsWith('unprinted'))).toEqual([]);
  });

  it('is found among marks read to the same whole number as the one before, which then go', () => {
    // 100.2, 100.4 ... read as 100, 100, 101: the first two say the speed in force.
    const tenths = withTempoStepsAsWords(piece([mark(4, 100), mark(5, 100), mark(6, 101), mark(7, 101), mark(8, 102)]));

    expect(said(tenths)).toEqual(['6=101 unprinted', '8=102']);
    expect(words(tenths)).toEqual(['4:accel.']);
  });

  it('arrives where it first says its last speed, those after saying the same being no change', () => {
    const arrived = withTempoStepsAsWords(piece([mark(4, 101), mark(5, 102), mark(6, 103), mark(7, 103), mark(8, 103)]));

    expect(said(arrived)).toEqual(['4=101', '5=102 unprinted', '6=103']);
  });

  it('is no run where it ends where it began', () => {
    const there = withTempoStepsAsWords(piece([mark(4, 101), mark(5, 102), mark(6, 101)]));

    expect(said(there)).toEqual(['4=101', '5=102', '6=101']);
  });

  it('sets off again from where one run arrives', () => {
    const upAndDown = withTempoStepsAsWords(
      piece([mark(4, 101), mark(5, 104), mark(6, 107), mark(7, 100), mark(8, 93)]),
    );

    expect(said(upAndDown)).toEqual(['4=101', '5=104 unprinted', '6=107', '7=100 unprinted', '8=93']);
    expect(words(upAndDown)).toEqual(['4:accel.', '6:rit.']);
  });

  it('never runs on into a mark under a tempo, the speed put back on purpose, which may begin one', () => {
    const tempo = withTempoStepsAsWords(
      piece([mark(4, 99), mark(5, 98), mark(6, 96), mark(7, 101), mark(8, 102), mark(9, 103)], [word(7, 'a tempo')]),
    );

    expect(said(tempo)).toEqual(['4=99', '5=98 unprinted', '6=96', '7=101', '8=102 unprinted', '9=103']);
    expect(words(tempo)).toEqual(['4:rit.', '7:a tempo', '7:accel.']);
    // Under it less than a beat late, it is still put back; a beat late, it is a step.
    const halfABeat = { measureIndex: 1, offsetTicks: BEAT + BEAT / 2, tempoBpm: 98 };
    const late = withTempoStepsAsWords(
      piece([mark(4, 99), halfABeat, mark(6, 97), mark(7, 96)], [word(5, 'a tempo')]),
    );
    expect(said(late)).toEqual(['4=99', '5.5=98', '6=97 unprinted', '7=96']);
    const aBeat = withTempoStepsAsWords(
      piece([mark(4, 99), mark(5, 98), mark(6, 97)], [word(4, 'a tempo')]),
    );
    expect(said(aBeat)).toEqual(['4=99', '5=98 unprinted', '6=97']);
  });

  it('adds no word where the writer said the same about it, from a bar before it to where it arrives', () => {
    const run = [mark(5, 99), mark(6, 98), mark(7, 97)];
    const aBarBefore = withTempoStepsAsWords(piece(run, [word(1, 'rit.')]));
    const atItsEnd = withTempoStepsAsWords(piece(run, [word(7, 'rit.')]));
    const tooEarly = withTempoStepsAsWords(piece(run, [word(0, 'rit.')]));
    const tooLate = withTempoStepsAsWords(piece(run, [word(8, 'rit.')]));
    const otherWay = withTempoStepsAsWords(piece(run, [word(5, 'accel.')]));

    expect(words(aBarBefore)).toEqual(['1:rit.']);
    expect(words(atItsEnd)).toEqual(['7:rit.']);
    // A word of its kind over a step is no speed put back, and the run runs on.
    expect(said(atItsEnd)).toEqual(['5=99', '6=98 unprinted', '7=97']);
    expect(words(tooEarly)).toEqual(['0:rit.', '5:rit.']);
    expect(words(tooLate)).toEqual(['5:rit.', '8:rit.']);
    expect(words(otherWay)).toEqual(['5:accel.', '5:rit.']);
  });

  it('leaves alone a piece with nothing of the kind', () => {
    const plain = piece([mark(4, 80), mark(12, 120)]);

    expect(withTempoStepsAsWords(plain)).toBe(plain);
  });

  it('is played as the file says it, a word over it telling the clock nothing more', () => {
    // `rit.` before marks it is already told by: no step of the word's own between them.
    const told = withTempoWordsPlayed(
      withTempoStepsAsWords(piece([mark(4, 99), mark(8, 98), mark(12, 97)], [word(4, 'rit.')])),
    );

    expect(said(told)).toEqual(['4=99', '8=98 unprinted', '12=97']);
  });
});

describe('a step of a gradual change kept in a file', () => {
  const serializer = new MusicXmlSerializer();
  const importer = new ScoreFileImporter();

  it('is written as a speed of the bar with nothing printed, and read back as one, the run and its word as they were', () => {
    const stepped = withTempoStepsAsWords(piece([mark(4, 101), mark(5, 102), mark(6, 103), mark(7, 104)]));

    const xml = serializer.serialize(stepped);
    expect(xml.match(/<metronome/g)?.length).toBe(3);
    expect(xml).toMatch(/<sound tempo="102"\/>/);
    expect(xml).toMatch(/<sound tempo="103"\/>/);
    const back = importer.read(xml).exercise;
    expect(said(back)).toEqual(said(stepped));
    expect(words(back)).toEqual(words(stepped));
  });

  it('is found in a file that prints every step, as it is opened', () => {
    // Every mark printed, as a writer's program exports them.
    const xml = serializer.serialize(piece([mark(4, 101), mark(5, 102), mark(6, 103), mark(7, 104)]));
    expect(xml.match(/<metronome/g)?.length).toBe(5);

    const opened = importer.read(xml).exercise;

    expect(said(opened)).toEqual(['4=101', '5=102 unprinted', '6=103 unprinted', '7=104']);
    expect(words(opened)).toEqual(['4:accel.']);
  });

  it('is read from a speed of the bar standing alone, which prints nothing, wherever it stands', () => {
    // Far from any other mark: one step and no run, kept unprinted all the same.
    const xml = serializer
      .serialize(piece([mark(4, 90), mark(20, 110)]))
      .replace(/(<measure number="4"[^>]*>)/, '$1<sound tempo="95"/>');

    expect(said(importer.read(xml).exercise)).toEqual(['4=90', '12=95 unprinted', '20=110']);
  });
});

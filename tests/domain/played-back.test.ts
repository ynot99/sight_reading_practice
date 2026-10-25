import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import { measureOf, noteEntry, restEntry, type Exercise, type Measure } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { theQuestionsPlayedBack } from '../../src/domain/solfege/playedBack.js';
import { theCadenceOfTheKey } from '../../src/domain/solfege/cadence.js';

/** One voice of the bars given, played back with questions over the bars given. */
function playedBack(measures: readonly Measure[], questions: readonly (readonly [number, number])[] | null): Exercise {
  return {
    id: 'by-ear',
    title: 'By ear',
    key: KeySignature.C_MAJOR,
    keyChanges: [],
    timeChanges: [],
    tempoChanges: [],
    pedalMarks: [],
    dynamicMarks: [],
    tempoWords: [],
    hairpins: [],
    octaveShifts: [],
    timeSignature: new TimeSignature(4, 4),
    tempoBpm: 60,
    firstBarNumber: 1,
    barLabels: [],
    staves: [{ staffNumber: 1, voice: 1, clef: 'treble', clefChanges: [], measures }],
    metadata: { generatorId: 'test', seed: 0 },
    ...(questions === null ? {} : { playedBack: { questions: questions.map(([from, until]) => ({ from, until })), heard: true, keyFirst: false } }),
  };
}

const quarters = (...names: string[]): Measure => measureOf(names.map((name) => (name === '-' ? restEntry(Duration.QUARTER) : noteEntry(Pitch.parse(name), Duration.QUARTER))));

describe('music played back', () => {
  it('gives the first step a key is asked at in each question and finds every one after it, across its bars', () => {
    const bars = [quarters('C4', 'D4', 'E4', 'F4'), quarters('G4', 'F4', 'E4', 'D4'), quarters('-', 'E4', 'G4', 'C5'), quarters('B4', 'A4', 'G4', 'C5')];
    // Two questions of two bars: the second bar's first note is the first question's.
    expect(theQuestionsPlayedBack(buildTimeline(playedBack(bars, [[0, 2], [2, 4]])))).toEqual([
      { given: 0, found: [1, 2, 3, 4, 5, 6, 7] },
      // A question opening on a rest gives the note after it.
      { given: 9, found: [10, 11, 12, 13, 14, 15] },
    ]);
    // A question a bar.
    expect(theQuestionsPlayedBack(buildTimeline(playedBack(bars, [[0, 1], [1, 2], [2, 3], [3, 4]]))).map((question) => question.given)).toEqual([0, 4, 9, 12]);
    // Music that is read asks nothing.
    expect(theQuestionsPlayedBack(buildTimeline(playedBack(bars, null)))).toEqual([]);
  });

  it('asks nothing of a question of one note, or of bars in no question, which are played as written', () => {
    const bars = [quarters('C4', 'D4', 'E4', 'F4'), measureOf([noteEntry(Pitch.parse('C4'), Duration.WHOLE)]), quarters('E4', 'F4', 'G4', 'A4')];
    expect(theQuestionsPlayedBack(buildTimeline(playedBack(bars, [[1, 2], [2, 3]])))).toEqual([{ given: 5, found: [6, 7, 8] }]);
    // A bar between two questions, in neither: played as written, nothing hidden in it.
    const between = [...bars, quarters('C4', 'D4', 'E4', 'F4')];
    expect(theQuestionsPlayedBack(buildTimeline(playedBack(between, [[0, 1], [2, 4]])))).toEqual([
      { given: 0, found: [1, 2, 3] },
      { given: 5, found: [6, 7, 8, 9, 10, 11, 12] },
    ]);
  });

  it('hears a key by its cadence: the root under three voices, the dominant major in minor', () => {
    expect(theCadenceOfTheKey(KeySignature.major(0))).toEqual([
      [48, 60, 64, 67],
      [41, 60, 65, 69],
      [43, 59, 62, 67],
      [48, 60, 64, 67],
    ]);
    // A minor: G sharp in the dominant.
    expect(theCadenceOfTheKey(KeySignature.minor(0))[2]).toEqual([40, 56, 59, 64]);
  });
});

import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import { measureOf, noteEntry, restEntry, type Exercise, type Measure } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { theQuestionsByEar } from '../../src/domain/solfege/byEar.js';
import { theCadenceOfTheKey } from '../../src/domain/solfege/cadence.js';

/** One voice of the bars given, played by ear with questions at the bars given. */
function byEar(measures: readonly Measure[], questionsAt: readonly number[] | null): Exercise {
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
    ...(questionsAt === null ? {} : { byEar: { questionsAt, keyFirst: false } }),
  };
}

const quarters = (...names: string[]): Measure => measureOf(names.map((name) => (name === '-' ? restEntry(Duration.QUARTER) : noteEntry(Pitch.parse(name), Duration.QUARTER))));

describe('music played back by ear', () => {
  it('gives the first step a key is asked at in each question and finds every one after it, across its bars', () => {
    const bars = [quarters('C4', 'D4', 'E4', 'F4'), quarters('G4', 'F4', 'E4', 'D4'), quarters('-', 'E4', 'G4', 'C5'), quarters('B4', 'A4', 'G4', 'C5')];
    // Two questions of two bars: the second bar's first note is the first question's.
    expect(theQuestionsByEar(buildTimeline(byEar(bars, [0, 2])))).toEqual([
      { given: 0, found: [1, 2, 3, 4, 5, 6, 7] },
      // A question opening on a rest gives the note after it.
      { given: 9, found: [10, 11, 12, 13, 14, 15] },
    ]);
    // A question a bar.
    expect(theQuestionsByEar(buildTimeline(byEar(bars, [0, 1, 2, 3]))).map((question) => question.given)).toEqual([0, 4, 9, 12]);
    // Music that is read asks nothing.
    expect(theQuestionsByEar(buildTimeline(byEar(bars, null)))).toEqual([]);
  });

  it('asks nothing of a question of one note, or of bars before the first question', () => {
    const bars = [quarters('C4', 'D4', 'E4', 'F4'), measureOf([noteEntry(Pitch.parse('C4'), Duration.WHOLE)]), quarters('E4', 'F4', 'G4', 'A4')];
    expect(theQuestionsByEar(buildTimeline(byEar(bars, [1, 2])))).toEqual([{ given: 5, found: [6, 7, 8] }]);
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

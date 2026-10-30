import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import { validateExercise } from '../../src/domain/model/Exercise.js';
import { RHYTHM_LEVELS, RHYTHMS_IN_A_ROUND, theRhythmicDictation, theRhythmsRead } from '../../src/domain/solfege/rhythmicDictation.js';

const SEEDS = Array.from({ length: 60 }, (_, seed) => seed + 1);

/** The lengths each level writes, over many rounds. */
function lengthsOf(level: (typeof RHYTHM_LEVELS)[number]): Set<number> {
  return new Set(
    SEEDS.flatMap((seed) =>
      (theRhythmicDictation({ level, seed }).staves[0]?.measures ?? []).flatMap((measure) => measure.entries.map((entry) => entry.duration.ticks)),
    ),
  );
}

describe('rhythmic dictation', () => {
  it('reads the bars a round of dictation asks, nothing heard and nothing kept off the page, tapped through in time', () => {
    for (const level of RHYTHM_LEVELS) {
      for (const seed of SEEDS.slice(0, 20)) {
        const read = theRhythmsRead({ level, seed });
        const heard = theRhythmicDictation({ level, seed });
        expect(() => {
          validateExercise(read);
        }).not.toThrow();
        expect([read.staves, read.title, read.metadata.generatorId === heard.metadata.generatorId, read.id === heard.id]).toEqual([
          heard.staves,
          'Rhythm reading',
          false,
          false,
        ]);
        expect(read.playedBack).toEqual({ questions: [], heard: false, keyFirst: false, inTime: 'throughout' });
        expect(theRhythmsRead({ level, seed })).toEqual(read);
      }
    }
  });

  it('is a valid round of eight bars on one key, each a question heard and tapped back in time, the same for the same seed', () => {
    for (const level of RHYTHM_LEVELS) {
      for (const seed of SEEDS.slice(0, 20)) {
        const round = theRhythmicDictation({ level, seed });
        expect(() => {
          validateExercise(round);
        }).not.toThrow();
        const notes = (round.staves[0]?.measures ?? []).flatMap((measure) => measure.entries);
        expect(notes.every((entry) => entry.kind === 'note' && entry.pitches.map((pitch) => pitch.toString()).join() === 'B4')).toBe(true);
        expect(round.playedBack).toEqual({
          questions: Array.from({ length: RHYTHMS_IN_A_ROUND }, (_, at) => ({ from: at, until: at + 1 })),
          heard: true,
          keyFirst: false,
          inTime: 'each-bar',
        });
        expect(theRhythmicDictation({ level, seed })).toEqual(round);
      }
    }
  });

  it('writes crotchets, quavers and minims at first, and dotted notes and semiquavers after', () => {
    const sorted = (lengths: Set<number>): number[] => [...lengths].sort((one, other) => one - other);
    expect(sorted(lengthsOf('simple'))).toEqual([Duration.EIGHTH.ticks, Duration.QUARTER.ticks, Duration.HALF.ticks]);
    expect(sorted(lengthsOf('dotted'))).toEqual(
      [Duration.SIXTEENTH, Duration.EIGHTH, Duration.QUARTER, Duration.DOTTED_QUARTER, Duration.HALF, Duration.DOTTED_HALF].map((each) => each.ticks),
    );
  });
});

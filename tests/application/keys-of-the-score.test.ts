import { describe, expect, it } from 'vitest';
import { theKeysOfTheScore } from '../../src/application/keysOfTheScore.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { bar, chordsExercise, p, twoBarExercise } from '../support/fixtures.js';

const IN_D_MINOR = [
  ['D3', 'F4', 'A4'],
  ['G3', 'Bb4', 'D5'],
  ['A3', 'C#5', 'E5'],
  ['D3', 'F4', 'A4'],
];

describe('the keys of a score', () => {
  it('reads each key from the bar it begins in, as the music says it, where the signature does not', () => {
    // One flat and no word of a mode: D minor, as its music keeps coming home to D.
    const exercise = chordsExercise([...IN_D_MINOR, ...IN_D_MINOR], { key: KeySignature.major(-1) });
    expect(theKeysOfTheScore(exercise, buildTimeline(exercise))).toEqual([{ measureIndex: 0, fifths: -1, scale: 'minor' }]);

    // In C, then three flats from the fifth bar, and C minor there.
    const changing = chordsExercise(
      [
        ['C3', 'E4', 'G4'],
        ['F3', 'A4', 'C5'],
        ['G3', 'B4', 'D5', 'F5'],
        ['C3', 'E4', 'G4'],
        ['C3', 'Eb4', 'G4'],
        ['F3', 'Ab4', 'C5'],
        ['G3', 'B4', 'D5', 'F5'],
        ['C3', 'Eb4', 'G4'],
      ],
      { key: KeySignature.major(0), keyChanges: [{ measureIndex: 4, key: KeySignature.major(-3) }] },
    );
    expect(theKeysOfTheScore(changing, buildTimeline(changing))).toEqual([
      { measureIndex: 0, fifths: 0, scale: 'major' },
      { measureIndex: 4, fifths: -3, scale: 'minor' },
    ]);
  });

  it('begins a key where the music moves to another its signature writes too', () => {
    const inC = [
      ['C3', 'E4', 'G4'],
      ['F3', 'A4', 'C5'],
      ['G3', 'B4', 'D5', 'F5'],
      ['C3', 'E4', 'G4'],
    ];
    const inA = [
      ['A2', 'C4', 'E4'],
      ['D3', 'F4', 'A4'],
      ['E3', 'G#4', 'B4', 'D5'],
      ['A2', 'C4', 'E4'],
    ];
    const exercise = chordsExercise([...inC, ...inC, ...inA, ...inA, ...inA], { key: KeySignature.major(0) });
    expect(theKeysOfTheScore(exercise, buildTimeline(exercise))).toEqual([
      { measureIndex: 0, fifths: 0, scale: 'major' },
      { measureIndex: 8, fifths: 0, scale: 'minor' },
    ]);
  });

  it('keeps a key the score writes as minor', () => {
    const inFMajor = chordsExercise(
      [
        ['F3', 'A4', 'C5'],
        ['Bb3', 'D4', 'F4'],
        ['C3', 'E4', 'G4', 'Bb4'],
        ['F3', 'A4', 'C5'],
      ],
      { key: KeySignature.minor(-1) },
    );
    expect(theKeysOfTheScore(inFMajor, buildTimeline(inFMajor))).toEqual([{ measureIndex: 0, fifths: -1, scale: 'minor' }]);
  });

  it('hears its chords as the pedal holds them', () => {
    // A quaver of C under E, G and B, then G: with the pedal down, C major seventh over C, bar after bar.
    const pedalled = (marked: boolean) => ({
      ...twoBarExercise({ key: KeySignature.major(0) }),
      pedalMarks: marked ? [{ measureIndex: 0, offsetTicks: 0, type: 'start' as const, line: true }] : [],
      staves: [
        { staffNumber: 1, voice: 1, clef: 'treble' as const, clefChanges: [], measures: Array.from({ length: 8 }, () => bar(noteEntry(['E4', 'G4', 'B4'].map(p), Duration.WHOLE))) },
        {
          staffNumber: 2,
          voice: 2,
          clef: 'bass' as const,
          clefChanges: [],
          measures: Array.from({ length: 8 }, () => bar(noteEntry(p('C2'), Duration.EIGHTH), noteEntry(p('G2'), Duration.EIGHTH), noteEntry(p('G2'), Duration.DOTTED_HALF))),
        },
      ],
    });
    const withThePedal = pedalled(true);
    expect(theKeysOfTheScore(withThePedal, buildTimeline(withThePedal))).toEqual([{ measureIndex: 0, fifths: 0, scale: 'major' }]);
    // Without it, the C is a quaver passing under E minor.
    const without = pedalled(false);
    expect(theKeysOfTheScore(without, buildTimeline(without))).not.toEqual([{ measureIndex: 0, fifths: 0, scale: 'major' }]);
  });

  it('works them out once a score', () => {
    const exercise = chordsExercise(IN_D_MINOR, { key: KeySignature.major(-1) });
    const timeline = buildTimeline(exercise);
    expect(theKeysOfTheScore(exercise, timeline)).toBe(theKeysOfTheScore(exercise, timeline));
  });
});

import { Duration } from '../../src/domain/model/Duration.js';
import type { Exercise, Measure, MusicalEntry } from '../../src/domain/model/Exercise.js';
import { measureOf, noteEntry, restEntry } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';

/** Shorthand for `Pitch.parse`, to keep fixtures readable. */
export function p(name: string): Pitch {
  return Pitch.parse(name);
}

export function bar(...entries: MusicalEntry[]): Measure {
  return measureOf(entries);
}

export interface ExerciseOverrides {
  readonly id?: string;
  readonly title?: string;
  readonly key?: KeySignature;
  readonly timeSignature?: TimeSignature;
  readonly tempoBpm?: number;
}

/**
 * Two bars of 4/4 that exercise every structural feature the trainer cares
 * about: a melody, a sustained note under it, a chord and a rest.
 *
 *   treble: C4 D4 E4 F4 | G4 (whole)
 *   bass:   C3 (whole)  | [G2 D3] (half) + half rest
 */
export function twoBarExercise(overrides: ExerciseOverrides = {}): Exercise {
  return {
    id: overrides.id ?? 'fixture-two-bar',
    title: overrides.title ?? 'Two bar fixture',
    key: overrides.key ?? KeySignature.major(0),
    keyChanges: [],
    timeSignature: overrides.timeSignature ?? new TimeSignature(4, 4),
    tempoBpm: overrides.tempoBpm ?? 60,
    metadata: { generatorId: 'fixture', seed: 1 },
    staves: [
      {
        staffNumber: 1,
        voice: 1,
        clef: 'treble',
        clefChanges: [],
        measures: [
          bar(
            noteEntry(p('C4'), Duration.QUARTER),
            noteEntry(p('D4'), Duration.QUARTER),
            noteEntry(p('E4'), Duration.QUARTER),
            noteEntry(p('F4'), Duration.QUARTER),
          ),
          bar(noteEntry(p('G4'), Duration.WHOLE)),
        ],
      },
      {
        staffNumber: 2,
        voice: 2,
        clef: 'bass',
        clefChanges: [],
        measures: [
          bar(noteEntry(p('C3'), Duration.WHOLE)),
          bar(noteEntry([p('G2'), p('D3')], Duration.HALF), restEntry(Duration.HALF)),
        ],
      },
    ],
  };
}

/** One bar of 4/4, treble only, four quarter notes: the simplest useful case. */
export function singleBarExercise(overrides: ExerciseOverrides = {}): Exercise {
  return {
    id: overrides.id ?? 'fixture-single-bar',
    title: overrides.title ?? 'Single bar fixture',
    key: overrides.key ?? KeySignature.major(0),
    keyChanges: [],
    timeSignature: overrides.timeSignature ?? new TimeSignature(4, 4),
    tempoBpm: overrides.tempoBpm ?? 60,
    metadata: { generatorId: 'fixture', seed: 2 },
    staves: [
      {
        staffNumber: 1,
        voice: 1,
        clef: 'treble',
        clefChanges: [],
        measures: [
          bar(
            noteEntry(p('C4'), Duration.QUARTER),
            noteEntry(p('D4'), Duration.QUARTER),
            noteEntry(p('E4'), Duration.QUARTER),
            noteEntry(p('F4'), Duration.QUARTER),
          ),
        ],
      },
    ],
  };
}

/** MIDI numbers of the fixture pitches, for readable expectations. */
/**
 * One bar of 6/8: two dotted-quarter beats, each filled with three eighths.
 *
 * Exists so that compound time can be exercised without pretending a bar of
 * 4/4 is one - the whole point of the pulse arithmetic is that the two count
 * differently.
 */
export function compoundBarExercise(overrides: ExerciseOverrides = {}): Exercise {
  const melody = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4'].map((name) =>
    noteEntry(p(name), Duration.EIGHTH),
  );
  return {
    id: overrides.id ?? 'fixture-compound',
    title: overrides.title ?? 'Compound fixture',
    key: overrides.key ?? KeySignature.major(0),
    keyChanges: [],
    timeSignature: overrides.timeSignature ?? new TimeSignature(6, 8),
    tempoBpm: overrides.tempoBpm ?? 60,
    metadata: { generatorId: 'fixture', seed: 2 },
    staves: [
      { staffNumber: 1, voice: 1, clef: 'treble', clefChanges: [], measures: [bar(...melody)] },
      {
        staffNumber: 2,
        voice: 2,
        clef: 'bass',
        clefChanges: [],
        measures: [
          bar(
            noteEntry(p('C3'), Duration.QUARTER),
            restEntry(Duration.QUARTER),
            restEntry(Duration.QUARTER),
          ),
        ],
      },
    ],
  };
}

/**
 * Two bars of 4/4 with a note held across the bar line.
 *
 *   treble: C4 (half) D4 E4 ~ | E4 (whole)
 *   bass:   C3 (whole)        | C3 (whole)
 *
 * The tied E4 is struck once and held, so the downbeat of bar two demands the
 * left hand's C3 and nothing else - which is the whole point of the tie and
 * the one thing a timeline can get wrong about it.
 */
export function tiedExercise(overrides: ExerciseOverrides = {}): Exercise {
  const held = p('E4');
  return {
    id: overrides.id ?? 'fixture-tied',
    title: overrides.title ?? 'Tied fixture',
    key: overrides.key ?? KeySignature.major(0),
    keyChanges: [],
    timeSignature: overrides.timeSignature ?? new TimeSignature(4, 4),
    tempoBpm: overrides.tempoBpm ?? 60,
    metadata: { generatorId: 'fixture', seed: 3 },
    staves: [
      {
        staffNumber: 1,
        voice: 1,
        clef: 'treble',
        clefChanges: [],
        measures: [
          bar(
            noteEntry(p('C4'), Duration.HALF),
            noteEntry(p('D4'), Duration.QUARTER),
            noteEntry(held, Duration.QUARTER, [held.midi]),
          ),
          bar(noteEntry(held, Duration.WHOLE)),
        ],
      },
      {
        staffNumber: 2,
        voice: 2,
        clef: 'bass',
        clefChanges: [],
        measures: [
          bar(noteEntry(p('C3'), Duration.WHOLE)),
          bar(noteEntry(p('C3'), Duration.WHOLE)),
        ],
      },
    ],
  };
}

export const MIDI = {
  G2: p('G2').midi,
  C3: p('C3').midi,
  D3: p('D3').midi,
  C4: p('C4').midi,
  D4: p('D4').midi,
  E4: p('E4').midi,
  F4: p('F4').midi,
  G4: p('G4').midi,
  C5: p('C5').midi,
  F5: p('F5').midi,
} as const;

import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import {
  exerciseTicks,
  measureCount,
  measureTicks,
  noteEntry,
  restEntry,
  validateExercise,
} from '../../src/domain/model/Exercise.js';
import { ExerciseValidationError } from '../../src/shared/errors.js';
import { bar, p, twoBarExercise } from '../support/fixtures.js';

function withTrebleMeasures(exercise: Exercise, measures: Exercise['staves'][number]['measures']): Exercise {
  const [treble, ...rest] = exercise.staves;
  if (treble === undefined) {
    throw new Error('fixture has no staves');
  }
  return { ...exercise, staves: [{ ...treble, measures }, ...rest] };
}

describe('exercise validation', () => {
  it('accepts a well-formed grand staff exercise', () => {
    expect(() => validateExercise(twoBarExercise())).not.toThrow();
    expect(measureCount(twoBarExercise())).toBe(2);
    expect(exerciseTicks(twoBarExercise())).toBe(3840);
  });

  it('rejects measures that do not add up to the time signature', () => {
    const broken = withTrebleMeasures(twoBarExercise(), [
      bar(noteEntry(p('C4'), Duration.QUARTER)),
      bar(noteEntry(p('G4'), Duration.WHOLE)),
    ]);
    expect(() => validateExercise(broken)).toThrow(ExerciseValidationError);
    expect(() => validateExercise(broken)).toThrow(/480 divisions but 4\/4 requires 1920/);
  });

  it('rejects staves with different bar counts', () => {
    const broken = withTrebleMeasures(twoBarExercise(), [bar(noteEntry(p('G4'), Duration.WHOLE))]);
    expect(() => validateExercise(broken)).toThrow(/Expected 1 measures/);
  });

  it('rejects duplicated pitches inside a chord', () => {
    const broken = withTrebleMeasures(twoBarExercise(), [
      bar(noteEntry([p('C4'), p('C4')], Duration.WHOLE)),
      bar(noteEntry(p('G4'), Duration.WHOLE)),
    ]);
    expect(() => validateExercise(broken)).toThrow(/duplicated inside a chord/);
  });

  it('rejects note entries without pitches and empty measures', () => {
    const noPitches = withTrebleMeasures(twoBarExercise(), [
      bar({ kind: 'note', pitches: [], duration: Duration.WHOLE, tiedForward: [] }),
      bar(noteEntry(p('G4'), Duration.WHOLE)),
    ]);
    expect(() => validateExercise(noPitches)).toThrow(/no pitches/);

    const empty = withTrebleMeasures(twoBarExercise(), [bar(), bar(noteEntry(p('G4'), Duration.WHOLE))]);
    expect(() => validateExercise(empty)).toThrow(ExerciseValidationError);
  });

  it('rejects a non-positive tempo', () => {
    expect(() => validateExercise({ ...twoBarExercise(), tempoBpm: 0 })).toThrow(/Tempo/);
  });

  it('rejects duplicate staff numbers and voices', () => {
    const exercise = twoBarExercise();
    const [treble, bass] = exercise.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('fixture has two staves');
    }
    expect(() =>
      validateExercise({ ...exercise, staves: [treble, { ...bass, staffNumber: 1 }] }),
    ).toThrow(/Duplicate staff number/);
    expect(() =>
      validateExercise({ ...exercise, staves: [treble, { ...bass, voice: 1 }] }),
    ).toThrow(/Duplicate voice/);
  });

  it('measures the notated length of a bar', () => {
    expect(measureTicks(bar(noteEntry(p('C4'), Duration.HALF), restEntry(Duration.HALF)))).toBe(1920);
  });
});

import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import {
  barLines,
  exerciseTicks,
  measureCount,
  measureTicks,
  noteEntry,
  restEntry,
  silenceEntry,
  timeAtMeasure,
  validateExercise,
} from '../../src/domain/model/Exercise.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { ExerciseValidationError } from '../../src/shared/errors.js';
import { bar, p, partialVoiceExercise, twoBarExercise } from '../support/fixtures.js';

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
    expect(exerciseTicks(twoBarExercise())).toBe(Duration.WHOLE.ticks * 2);
  });

  it('rejects measures that do not add up to the time signature', () => {
    const broken = withTrebleMeasures(twoBarExercise(), [
      bar(noteEntry(p('C4'), Duration.QUARTER)),
      bar(noteEntry(p('G4'), Duration.WHOLE)),
    ]);
    expect(() => validateExercise(broken)).toThrow(ExerciseValidationError);
    expect(() => validateExercise(broken)).toThrow(
      new RegExp(`${Duration.QUARTER.ticks} divisions but 4/4 requires ${Duration.WHOLE.ticks}`),
    );
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
      bar({
        kind: 'note',
        pitches: [],
        duration: Duration.WHOLE,
        tiedForward: [],
        beams: [],
        stem: null,
        fermata: false,
        breath: false,
        arpeggiated: false,
      }),
      bar(noteEntry(p('G4'), Duration.WHOLE)),
    ]);
    expect(() => validateExercise(noPitches)).toThrow(/no pitches/);

    const empty = withTrebleMeasures(twoBarExercise(), [bar(), bar(noteEntry(p('G4'), Duration.WHOLE))]);
    expect(() => validateExercise(empty)).toThrow(ExerciseValidationError);
  });

  it('rejects a non-positive tempo', () => {
    expect(() => validateExercise({ ...twoBarExercise(), tempoBpm: 0 })).toThrow(/Tempo/);
  });

  it('rejects two parts claiming the same voice', () => {
    const exercise = twoBarExercise();
    const [treble, bass] = exercise.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('fixture has two staves');
    }
    expect(() =>
      validateExercise({ ...exercise, staves: [treble, { ...bass, voice: 1 }] }),
    ).toThrow(/Duplicate voice/);
  });

  it('allows two voices to share a staff', () => {
    // Which is how an inner line sits under a melody on one staff, and the
    // reason a held note need not be chopped into tied fragments.
    const exercise = twoBarExercise();
    const [treble, bass] = exercise.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('fixture has two staves');
    }
    expect(() =>
      validateExercise({
        ...exercise,
        staves: [treble, { ...bass, staffNumber: 1, clef: 'treble' }],
      }),
    ).not.toThrow();
  });

  it('holds each bar to the metre that governs it', () => {
    // A metre change moves the bar lines. Held to the first metre, every bar
    // after the change is short or over-full - which is how three of the
    // reader's scores were refused and a fourth was read as music nobody
    // wrote.
    const base = twoBarExercise();
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    const threeFour = new TimeSignature(3, 4);
    const changed: Exercise = {
      ...base,
      timeChanges: [{ measureIndex: 1, timeSignature: threeFour }],
      staves: [
        {
          ...treble,
          measures: [
            bar(noteEntry(p('C4'), Duration.WHOLE)),
            bar(noteEntry(p('D4'), Duration.DOTTED_HALF)),
          ],
        },
        {
          ...bass,
          measures: [
            bar(noteEntry(p('C3'), Duration.WHOLE)),
            bar(noteEntry(p('G2'), Duration.DOTTED_HALF)),
          ],
        },
      ],
    };

    expect(() => validateExercise(changed)).not.toThrow();
    expect(timeAtMeasure(changed, 0).toString()).toBe('4/4');
    expect(timeAtMeasure(changed, 1).toString()).toBe('3/4');
    // And the whole piece is a bar of each rather than two of the first.
    expect(exerciseTicks(changed)).toBe(Duration.WHOLE.ticks + Duration.DOTTED_HALF.ticks);
    expect(barLines(changed).map((line) => line.startTicks)).toEqual([0, Duration.WHOLE.ticks]);
  });

  it('says which metre a bar failed to fill, not which one it started in', () => {
    const base = twoBarExercise();
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    const broken: Exercise = {
      ...base,
      timeChanges: [{ measureIndex: 1, timeSignature: new TimeSignature(3, 4) }],
      staves: [
        {
          ...treble,
          measures: [bar(noteEntry(p('C4'), Duration.WHOLE)), bar(noteEntry(p('D4'), Duration.WHOLE))],
        },
        {
          ...bass,
          measures: [bar(noteEntry(p('C3'), Duration.WHOLE)), bar(noteEntry(p('G2'), Duration.WHOLE))],
        },
      ],
    };

    expect(() => validateExercise(broken)).toThrow(/3\/4 requires/);
  });

  it('measures the notated length of a bar', () => {
    expect(measureTicks(bar(noteEntry(p('C4'), Duration.HALF), restEntry(Duration.HALF)))).toBe(
      Duration.WHOLE.ticks,
    );
  });
});

describe('a voice that is absent rather than resting', () => {
  it('lets a voice come and go inside a bar another voice plays through', () => {
    const exercise = partialVoiceExercise();

    expect(() => validateExercise(exercise)).not.toThrow();
    // It still takes its time, so the bar goes on adding up.
    expect(measureTicks(exercise.staves[1]?.measures[0] ?? bar())).toBe(Duration.WHOLE.ticks);
  });

  it('refuses a stretch of staff with nothing drawn on it at all', () => {
    // The only other voice stops after two beats, so the second half of the
    // bar would be blank staff - which is not silence a reader can count.
    const exercise = partialVoiceExercise([
      noteEntry(p('G3'), Duration.HALF),
      silenceEntry(Duration.HALF),
    ]);
    const [melody, ...rest] = exercise.staves;
    if (melody === undefined) {
      throw new Error('expected a melody');
    }
    const holed: Exercise = {
      ...exercise,
      staves: [
        {
          ...melody,
          measures: [bar(noteEntry(p('C4'), Duration.HALF), silenceEntry(Duration.HALF))],
        },
        ...rest,
      ],
    };

    expect(() => validateExercise(holed)).toThrow(ExerciseValidationError);
    expect(() => validateExercise(holed)).toThrow(/draws nothing/);
  });

  it('counts voices that overlap rather than following one after the other', () => {
    // Two voices each covering three beats, offset by one: between them they
    // cover the bar, and a rule that only added up lengths would say so too -
    // this one has to notice that they overlap and still reach the bar line.
    const exercise = partialVoiceExercise([
      silenceEntry(Duration.QUARTER),
      noteEntry(p('G3'), Duration.DOTTED_HALF),
    ]);
    const [melody, ...rest] = exercise.staves;
    if (melody === undefined) {
      throw new Error('expected a melody');
    }

    expect(() =>
      validateExercise({
        ...exercise,
        staves: [
          {
            ...melody,
            measures: [bar(noteEntry(p('C4'), Duration.DOTTED_HALF), silenceEntry(Duration.QUARTER))],
          },
          ...rest,
        ],
      }),
    ).not.toThrow();
  });

  it('will not let the last voice on a staff vanish', () => {
    const alone = twoBarExercise();
    const [treble, bass] = alone.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }

    expect(() =>
      validateExercise({
        ...alone,
        staves: [
          { ...treble, measures: [bar(silenceEntry(Duration.WHOLE)), treble.measures[1] ?? bar()] },
          bass,
        ],
      }),
    ).toThrow(/draws nothing/);
  });
});

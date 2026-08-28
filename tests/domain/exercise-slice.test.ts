import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { measureCount, noteEntry, validateExercise } from '../../src/domain/model/Exercise.js';
import { sliceExercise } from '../../src/domain/model/exerciseSlice.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { DomainError } from '../../src/shared/errors.js';
import { bar, p, tiedExercise, twoBarExercise } from '../support/fixtures.js';

/** Four bars of single whole notes, so the seams are easy to see. */
function fourBars(overrides: Partial<Exercise> = {}): Exercise {
  const base = twoBarExercise();
  const [treble] = base.staves;
  if (treble === undefined) {
    throw new Error('expected a staff');
  }
  return {
    ...base,
    staves: [
      {
        ...treble,
        measures: ['C4', 'D4', 'E4', 'F4'].map((name) =>
          bar(noteEntry(p(name), Duration.WHOLE)),
        ),
      },
    ],
    ...overrides,
  };
}

describe('taking a passage out of a score', () => {
  it('keeps only the bars asked for, counted as a reader counts them', () => {
    const passage = sliceExercise(fourBars(), 2, 3);

    expect(measureCount(passage)).toBe(2);
    expect(buildTimeline(passage).steps.map((step) => step.expectedMidi)).toEqual([
      [p('D4').midi],
      [p('E4').midi],
    ]);
    expect(() => validateExercise(passage)).not.toThrow();
  });

  it('is a score in its own right, which is the point', () => {
    // Nothing downstream should be able to tell it came out of a longer piece.
    const passage = sliceExercise(fourBars(), 3, 4);
    expect(passage.title).toContain('bars 3');
    expect(() => validateExercise(passage)).not.toThrow();
  });

  it('states the clef and key the passage inherits', () => {
    const base = fourBars();
    const [treble] = base.staves;
    if (treble === undefined) {
      throw new Error('expected a staff');
    }
    const modulating: Exercise = {
      ...base,
      keyChanges: [{ measureIndex: 2, key: KeySignature.major(-2) }],
      staves: [{ ...treble, clefChanges: [{ measureIndex: 1, clef: 'bass' }] }],
    };

    // Bars three and four inherit both changes, so neither may be left implied.
    const passage = sliceExercise(modulating, 3, 4);
    expect(passage.key.fifths).toBe(-2);
    expect(passage.staves[0]?.clef).toBe('bass');
    expect(passage.keyChanges).toEqual([]);
    expect(passage.staves[0]?.clefChanges).toEqual([]);
  });

  it('renumbers a change that falls inside the passage', () => {
    const base = fourBars();
    const modulating: Exercise = {
      ...base,
      keyChanges: [{ measureIndex: 2, key: KeySignature.major(3) }],
    };

    const passage = sliceExercise(modulating, 2, 4);
    expect(passage.keyChanges).toHaveLength(1);
    expect(passage.keyChanges[0]?.measureIndex).toBe(1);
  });

  it('cuts a tie that would lead out of the last bar', () => {
    // The note would otherwise be one nobody ever releases.
    const passage = sliceExercise(tiedExercise(), 1, 1);
    const entries = passage.staves[0]?.measures[0]?.entries ?? [];
    const last = entries.at(-1);

    expect(last?.kind === 'note' ? last.tiedForward : ['unexpected']).toEqual([]);
    expect(() => validateExercise(passage)).not.toThrow();
  });

  it('presses a pedal the passage opens under', () => {
    const pedalled: Exercise = {
      ...fourBars(),
      pedalMarks: [
        { measureIndex: 0, offsetTicks: 0, type: 'start' },
        { measureIndex: 3, offsetTicks: 0, type: 'stop' },
      ],
    };

    const passage = sliceExercise(pedalled, 2, 3);
    // Opening dry where the piece opens it held is audibly a different phrase.
    expect(passage.pedalMarks[0]).toEqual({ measureIndex: 0, offsetTicks: 0, type: 'start' });
  });

  it('drops a voice that says nothing in the passage', () => {
    const base = twoBarExercise();
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    // A voice present only in bar two vanishes when bar one is taken alone.
    const sparse: Exercise = {
      ...base,
      staves: [treble, { ...bass, measures: [bar(), bass.measures[1] ?? bar()] }],
    };

    const passage = sliceExercise(sparse, 1, 1);
    expect(passage.staves).toHaveLength(1);
    expect(() => validateExercise(passage)).not.toThrow();
  });

  it('hands back the whole piece when nothing is being narrowed', () => {
    const whole = fourBars();
    expect(sliceExercise(whole, 1, 4)).toBe(whole);
  });

  it('keeps the request inside the piece', () => {
    const passage = sliceExercise(fourBars(), 0, 99);
    expect(measureCount(passage)).toBe(4);
  });

  it('refuses a passage with nothing in it', () => {
    const empty: Exercise = { ...fourBars(), staves: [] };
    expect(() => sliceExercise(empty, 1, 2)).toThrow(DomainError);
  });
});

import { describe, expect, it } from 'vitest';
import { withHairpinsPlayed } from '../../src/domain/notation/hairpins.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { longExercise } from '../support/fixtures.js';
import type { DynamicHairpin, Exercise } from '../../src/domain/model/Exercise.js';

/** Four bars of quarters, with whatever marks and hairpins are given. */
function piece(
  hairpins: readonly DynamicHairpin[],
  dynamicMarks: Exercise['dynamicMarks'] = [],
): Exercise {
  return { ...longExercise({ bars: 4, tempoBpm: 60 }), hairpins, dynamicMarks };
}

/** The levels a hairpin worked out, in order, without the written ones. */
function worked(exercise: Exercise): string[] {
  return withHairpinsPlayed(exercise)
    .dynamicMarks.filter((mark) => mark.implied === true)
    .map((mark) => mark.level);
}

describe('a hairpin, heard', () => {
  it('climbs to the mark it is heading for', () => {
    // A crescendo names no level, so where it is going is what stands at its
    // far end: from p at bar one to f at bar three is p, mp, mf, f.
    const swelling = piece(
      [
        {
          measureIndex: 0,
          offsetTicks: 0,
          kind: 'crescendo',
          untilMeasureIndex: 2,
          untilOffsetTicks: 0,
          staffNumber: null,
        },
      ],
      [
        { measureIndex: 0, offsetTicks: 0, level: 'p', staffNumber: null },
        { measureIndex: 2, offsetTicks: 0, level: 'f', staffNumber: null },
      ],
    );

    expect(worked(swelling)).toEqual(['mp', 'mf']);
  });

  it('falls to the mark it is heading for', () => {
    const fading = piece(
      [
        {
          measureIndex: 0,
          offsetTicks: 0,
          kind: 'diminuendo',
          untilMeasureIndex: 2,
          untilOffsetTicks: 0,
          staffNumber: null,
        },
      ],
      [
        { measureIndex: 0, offsetTicks: 0, level: 'f', staffNumber: null },
        { measureIndex: 2, offsetTicks: 0, level: 'p', staffNumber: null },
      ],
    );

    expect(worked(fading)).toEqual(['mf', 'mp']);
  });

  it('moves by one step where the writer marked no destination', () => {
    // Which is what a hairpin between two unmarked stretches means to a
    // player: louder, by about as much as the next level up.
    const alone = piece([
      {
        measureIndex: 0,
        offsetTicks: 0,
        kind: 'crescendo',
        untilMeasureIndex: 1,
        untilOffsetTicks: 0,
        staffNumber: null,
      },
    ]);

    // From the unmarked default, one step up.
    expect(worked(alone)).toEqual(['f']);
  });

  it('says nothing where it would climb past the loudest there is', () => {
    const alreadyLoudest = piece(
      [
        {
          measureIndex: 0,
          offsetTicks: 0,
          kind: 'crescendo',
          untilMeasureIndex: 1,
          untilOffsetTicks: 0,
          staffNumber: null,
        },
      ],
      [{ measureIndex: 0, offsetTicks: 0, level: 'fff', staffNumber: null }],
    );

    expect(worked(alreadyLoudest)).toEqual([]);
  });

  it('leaves a piece with no hairpins exactly as it was', () => {
    const plain = piece([]);

    expect(withHairpinsPlayed(plain)).toBe(plain);
  });

  it('spreads its levels across the stretch it covers', () => {
    // Not all at the start and not all at the end: the point of a hairpin is
    // that the change happens over the music it is drawn under.
    const swelling = piece(
      [
        {
          measureIndex: 0,
          offsetTicks: 0,
          kind: 'crescendo',
          untilMeasureIndex: 3,
          untilOffsetTicks: 0,
          staffNumber: null,
        },
      ],
      [
        { measureIndex: 0, offsetTicks: 0, level: 'pp', staffNumber: null },
        { measureIndex: 3, offsetTicks: 0, level: 'f', staffNumber: null },
      ],
    );

    const added = withHairpinsPlayed(swelling).dynamicMarks.filter(
      (mark) => mark.implied === true,
    );
    const bars = added.map((mark) => mark.measureIndex);

    expect(added.length).toBeGreaterThan(1);
    expect(new Set(bars).size).toBeGreaterThan(1);
    expect(Math.max(...bars)).toBeLessThanOrEqual(3);
    void Duration.QUARTER;
  });
});

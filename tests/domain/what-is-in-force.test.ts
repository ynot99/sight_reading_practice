import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import {
  DYNAMIC_VELOCITY,
  dynamicAt,
  pedalHeldUntil,
  pedalSpans,
  velocityAt,
} from '../../src/domain/model/Exercise.js';
import type { Exercise, PedalMark } from '../../src/domain/model/Exercise.js';
import { twoBarExercise } from '../support/fixtures.js';

const q = Duration.QUARTER.ticks;

function pedal(measureIndex: number, offsetTicks: number, type: 'start' | 'stop'): PedalMark {
  return { measureIndex, offsetTicks, type, line: true };
}

describe('the pedal in force where a key is struck', () => {
  it('lets a key go where the first line listed over it lifts', () => {
    // How a pedal change is often written: the next line begins a moment
    // before the last one ends. A key struck under both belongs to the line
    // that was down first and is let go when that one comes up; a key struck
    // after the lift rings with the second.
    const piece: Exercise = {
      ...twoBarExercise(),
      pedalMarks: [pedal(0, 0, 'start'), pedal(1, 0, 'stop'), pedal(0, 3 * q, 'start'), pedal(1, 2 * q, 'stop')],
    };

    expect(pedalHeldUntil(piece, 0)).toBe(4 * q);
    expect(pedalHeldUntil(piece, 3 * q)).toBe(4 * q);
    expect(pedalHeldUntil(piece, 4 * q)).toBe(6 * q);
    expect(pedalHeldUntil(piece, 6 * q)).toBeNull();
  });

  it('gives the answer a walk along every line gives, at every moment', () => {
    // Asked for every note a playback gathers, and a walk along every line for
    // each of them was a large part of the wait before a long score began. It
    // is looked up now, and must not answer differently anywhere: here a file
    // that lists a bar's release before its press, the way two staves'
    // directions come out of a file, and a line left down to the end.
    const piece: Exercise = {
      ...twoBarExercise(),
      pedalMarks: [
        pedal(0, 0, 'start'),
        pedal(0, q, 'stop'),
        pedal(0, 3 * q, 'stop'),
        pedal(0, 2 * q, 'start'),
        pedal(1, 0, 'start'),
        pedal(1, q, 'stop'),
        pedal(1, 2 * q, 'start'),
      ],
    };
    const walked = (ticks: number): number | null =>
      pedalSpans(piece).find(([from, to]) => ticks >= from && ticks < to)?.[1] ?? null;

    for (let ticks = -q; ticks <= 9 * q; ticks += q / 4) {
      expect(pedalHeldUntil(piece, ticks)).toBe(walked(ticks));
    }
  });
});

describe('the dynamic in force at a moment', () => {
  it('reads a mark at the start of a bar as later than one at the end of the bar before', () => {
    // The two are one moment, and the next bar's mark is the one a player
    // reads on arriving there - whichever order the file lists them in.
    const piece: Exercise = {
      ...twoBarExercise(),
      dynamicMarks: [
        { measureIndex: 1, offsetTicks: 0, level: 'ff', staffNumber: null },
        { measureIndex: 0, offsetTicks: 4 * q, level: 'pp', staffNumber: null },
      ],
    };

    expect(dynamicAt(piece, 1, 0, null)).toBe('ff');
    expect(dynamicAt(piece, 1, 0, 1)).toBe('ff');
  });

  it('takes the one listed last of two marks written at one place', () => {
    const piece: Exercise = {
      ...twoBarExercise(),
      dynamicMarks: [
        { measureIndex: 0, offsetTicks: q, level: 'p', staffNumber: null },
        { measureIndex: 0, offsetTicks: q, level: 'f', staffNumber: null },
      ],
    };

    expect(dynamicAt(piece, 0, 2 * q, 1)).toBe('f');
  });

  it('pays no heed to a hairpin that has not begun yet', () => {
    const piece: Exercise = {
      ...twoBarExercise(),
      hairpins: [
        {
          measureIndex: 1,
          offsetTicks: 0,
          kind: 'diminuendo',
          untilMeasureIndex: 1,
          untilOffsetTicks: 4 * q,
          staffNumber: null,
        },
      ],
    };

    expect(velocityAt(piece, 0, 2 * q, 1)).toBe(DYNAMIC_VELOCITY.mf);
  });

  it('follows the hairpin listed last of two that begin together', () => {
    const piece: Exercise = {
      ...twoBarExercise(),
      hairpins: [
        {
          measureIndex: 0,
          offsetTicks: 0,
          kind: 'crescendo',
          untilMeasureIndex: 1,
          untilOffsetTicks: 0,
          staffNumber: null,
        },
        {
          measureIndex: 0,
          offsetTicks: 0,
          kind: 'diminuendo',
          untilMeasureIndex: 1,
          untilOffsetTicks: 0,
          staffNumber: null,
        },
      ],
    };

    // Unmarked, the ground is mezzo-forte, and halfway along the wedge the
    // later of the two has taken it down.
    expect(velocityAt(piece, 0, 2 * q, 1)).toBeLessThan(DYNAMIC_VELOCITY.mf);
  });
});

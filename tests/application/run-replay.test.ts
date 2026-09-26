import { describe, expect, it } from 'vitest';
import {
  replayFits,
  theMarksOfTheRun,
  theStepAt,
  type ReplayJudging,
} from '../../src/application/runReplay.js';
import type { RolledBeat, RolledPress, RunRoll } from '../../src/application/session/RunRoll.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { MIDI, twoBarExercise } from '../support/fixtures.js';

/**
 * Two bars at sixty: four quarters, a step a second, then a whole note over a
 * half and a rest - six steps in all.
 */
const timeline = buildTimeline(twoBarExercise({ tempoBpm: 60 }));
const q = Duration.QUARTER.ticks;
/** When the run was played, on the clock it was played by. */
const PLAYED_AT = 90_000;
const IN_TIME: ReplayJudging = { keepsTime: true, tempoBpm: 60 };

function press(how: Partial<RolledPress> & { readonly downAtMs: number }): RolledPress {
  return {
    midi: MIDI.C4,
    upAtMs: how.downAtMs + 200,
    velocity: 0.7,
    verdict: 'correct',
    stepIndex: 0,
    deviationMs: 0,
    ...how,
  };
}

function beat(atMs: number, positionTicks: number): RolledBeat {
  return { atMs, weight: 'beat', positionTicks };
}

function roll(presses: readonly RolledPress[], beats: readonly RolledBeat[] = []): RunRoll {
  return { presses, beats, pedal: [], rushes: [], truncated: false };
}

describe('whether a run can be replayed over the music open', () => {
  it('can, where every judged press names a step the music has', () => {
    expect(timeline.length).toBe(6);
    expect(replayFits(roll([press({ downAtMs: PLAYED_AT, stepIndex: 5 })]), timeline)).toBe(true);
  });

  it('cannot, where a press names a step past the end of it', () => {
    // The piece was changed since, or this is another piece of the same name:
    // drawn anyway, the mark would stand on some other note.
    const run = roll([
      press({ downAtMs: PLAYED_AT, stepIndex: 0 }),
      press({ downAtMs: PLAYED_AT + 1_000, stepIndex: 6 }),
    ]);

    expect(replayFits(run, timeline)).toBe(false);
  });

  it('cannot, where nothing was judged to show', () => {
    expect(replayFits(roll([press({ downAtMs: PLAYED_AT, stepIndex: null, verdict: null })]), timeline)).toBe(false);
  });
});

describe('the marks a run left, and when', () => {
  it('draws each one from the run’s own nought, in the order they were made', () => {
    const run = roll([
      press({ downAtMs: PLAYED_AT + 1_000, stepIndex: 1, midi: MIDI.D4 }),
      press({ downAtMs: PLAYED_AT, stepIndex: 0 }),
    ]);

    const marks = theMarksOfTheRun(run, timeline, IN_TIME);

    expect(marks.map((each) => [each.atMs, each.mark.stepIndex, each.mark.midi])).toEqual([
      [0, 0, MIDI.C4],
      [1_000, 1, MIDI.D4],
    ]);
    expect(marks.every((each) => each.mark.settled === true)).toBe(true);
  });

  it('leaves out what the run drew nothing for', () => {
    const run = roll([
      press({ downAtMs: PLAYED_AT }),
      press({ downAtMs: PLAYED_AT + 10, verdict: 'duplicate' }),
      press({ downAtMs: PLAYED_AT + 20, verdict: null, stepIndex: null }),
    ]);

    expect(theMarksOfTheRun(run, timeline, IN_TIME)).toHaveLength(1);
  });

  it('colours them as the run did', () => {
    const run = roll([
      press({ downAtMs: PLAYED_AT, stepIndex: 0, deviationMs: 20 }),
      press({ downAtMs: PLAYED_AT + 1_300, stepIndex: 1, deviationMs: 300 }),
      // Far enough ahead to be drawn ahead: a tenth of the gap is drawn on the note.
      press({ downAtMs: PLAYED_AT + 1_700, stepIndex: 2, verdict: 'rushed', deviationMs: -300 }),
      press({ downAtMs: PLAYED_AT + 2_000, stepIndex: 2, verdict: 'wrong', midi: MIDI.C5 }),
    ]);

    const [inTheWindow, late, rushed, wrong] = theMarksOfTheRun(run, timeline, IN_TIME).map(
      (each) => each.mark,
    );

    expect(inTheWindow?.tier).toBe('perfect');
    expect(late?.tier).toBe('good');
    expect(late?.offset ?? 0).toBeGreaterThan(0);
    expect(rushed?.tier).toBe('good');
    expect(rushed?.offset ?? 0).toBeLessThan(0);
    expect(wrong?.correct).toBe(false);
    expect(wrong?.tier).toBeUndefined();
  });

  it('draws no lateness where the frame kept no time', () => {
    // Where the music waits for the reader, taking a moment to find the note
    // is not being late, and the run did not draw it so.
    const run = roll([press({ downAtMs: PLAYED_AT, stepIndex: 1, deviationMs: 700 })]);

    const [mark] = theMarksOfTheRun(run, timeline, { keepsTime: false, tempoBpm: 60 });

    expect(mark?.mark.offset).toBe(0);
    expect(mark?.mark.tier).toBe('perfect');
  });
});

describe('where the music was, a moment into the run', () => {
  it('follows the beats, through a note held and a gate stood at', () => {
    const run = roll(
      [press({ downAtMs: PLAYED_AT })],
      [
        beat(PLAYED_AT, 0),
        beat(PLAYED_AT + 1_000, q),
        // The third beat fell, the music stood, and the reader gave it later.
        beat(PLAYED_AT + 2_000, q * 2),
        beat(PLAYED_AT + 3_500, q * 2),
        beat(PLAYED_AT + 4_500, q * 3),
      ],
    );

    expect(theStepAt(run, timeline, 500)).toBe(0);
    expect(theStepAt(run, timeline, 1_500)).toBe(1);
    expect(theStepAt(run, timeline, 3_000)).toBe(2);
    expect(theStepAt(run, timeline, 4_600)).toBe(3);
  });

  it('follows the presses where the run kept no beats', () => {
    const run = roll([
      press({ downAtMs: PLAYED_AT + 200, stepIndex: 0 }),
      press({ downAtMs: PLAYED_AT + 3_000, stepIndex: 1 }),
    ]);

    // The run begins at its first press, which is its nought.
    expect(theStepAt(run, timeline, 1_000)).toBe(0);
    expect(theStepAt(run, timeline, 2_800)).toBe(1);
  });
});

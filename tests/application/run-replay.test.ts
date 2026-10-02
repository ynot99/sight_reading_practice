import { describe, expect, it } from 'vitest';
import {
  replayFits,
  theKeysDownAt,
  theMarksOfTheRun,
  thePedalDownAt,
  thePressesBetween,
  thePressesOfTheRun,
  theBarsOfTheRun,
  theRulingOfTheRun,
  theStepAt,
  type ReplayJudging,
} from '../../src/application/runReplay.js';
import type { RolledBeat, RolledPress, RunRoll } from '../../src/application/session/RunRoll.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { rulerMarks } from '../../src/application/rhythmRuler.js';
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

describe('when the run reached a bar', () => {
  /** When the run reached one bar, or `null` where it never did. */
  const reached = (run: RunRoll, measureIndex: number): number | null =>
    theBarsOfTheRun(run, timeline).find((bar) => bar.measureIndex === measureIndex)?.atMs ?? null;

  it('lists every bar the run reached, once each', () => {
    const run = roll(
      [press({ downAtMs: PLAYED_AT })],
      [beat(PLAYED_AT, 0), beat(PLAYED_AT + 1_000, q), beat(PLAYED_AT + 4_000, q * 4), beat(PLAYED_AT + 5_000, q * 5)],
    );

    expect(theBarsOfTheRun(run, timeline)).toEqual([
      { measureIndex: 0, atMs: 0 },
      { measureIndex: 1, atMs: 4_000 },
    ]);
  });

  it('reads the beats, where the music got to a bar line given late at the moment it fell due', () => {
    const run = roll(
      [press({ downAtMs: PLAYED_AT })],
      [
        beat(PLAYED_AT, 0),
        beat(PLAYED_AT + 1_000, q),
        beat(PLAYED_AT + 2_000, q * 2),
        beat(PLAYED_AT + 3_000, q * 3),
        // The second bar's line fell due, the music stood, and the reader
        // gave it later.
        beat(PLAYED_AT + 4_000, q * 4),
        beat(PLAYED_AT + 5_500, q * 4),
        beat(PLAYED_AT + 6_500, q * 5),
      ],
    );

    expect(reached(run, 0)).toBe(0);
    expect(reached(run, 1)).toBe(4_000);
    // Where the marker stands then, which is the bar's first step.
    expect(theStepAt(run, timeline, 4_000)).toBe(4);
    // A bar the piece does not have.
    expect(reached(run, 2)).toBeNull();
  });

  it('reads the presses where the run kept no beats', () => {
    const run = roll([
      press({ downAtMs: PLAYED_AT + 200, stepIndex: 0 }),
      press({ downAtMs: PLAYED_AT + 3_000, stepIndex: 2 }),
      press({ downAtMs: PLAYED_AT + 5_000, stepIndex: 4 }),
      press({ downAtMs: PLAYED_AT + 5_100, midi: MIDI.C5, verdict: 'wrong', stepIndex: 4 }),
    ]);

    // The run begins at its first press.
    expect(reached(run, 0)).toBe(0);
    expect(reached(run, 1)).toBe(4_800);
    expect(theStepAt(run, timeline, 4_800)).toBe(4);
  });

  it('says a bar the run never stood in was never reached, before it or after', () => {
    // Stopped in the first bar.
    const stopped = roll([press({ downAtMs: PLAYED_AT })], [beat(PLAYED_AT, 0), beat(PLAYED_AT + 1_000, q)]);
    expect(reached(stopped, 1)).toBeNull();
    const stoppedUnbeaten = roll([press({ downAtMs: PLAYED_AT, stepIndex: 1 })]);
    expect(reached(stoppedUnbeaten, 1)).toBeNull();

    // A passage of the second bar alone.
    const passage = roll([press({ downAtMs: PLAYED_AT, stepIndex: 4 })], [beat(PLAYED_AT, q * 4), beat(PLAYED_AT + 1_000, q * 5)]);
    expect(reached(passage, 0)).toBeNull();
    expect(reached(passage, 1)).toBe(0);
    const passageUnbeaten = roll([press({ downAtMs: PLAYED_AT, stepIndex: 4 })]);
    expect(reached(passageUnbeaten, 0)).toBeNull();
  });
});

describe('where the run reached the ruler', () => {
  const eighths = rulerMarks(timeline, 'eighth');
  const ruled = (run: RunRoll): [string, number][] =>
    theRulingOfTheRun(run, eighths).map((moment) => [moment.weight, Math.round(moment.atMs)]);

  it('puts a line on a beat where the beat fell, and one between two its share of the way', () => {
    const run = roll(
      [press({ downAtMs: PLAYED_AT })],
      [beat(PLAYED_AT, 0), beat(PLAYED_AT + 1_000, q), beat(PLAYED_AT + 2_000, q * 2)],
    );

    expect(ruled(run)).toEqual([
      ['downbeat', 0],
      ['division', 500],
      ['beat', 1_000],
      ['division', 1_500],
      ['beat', 2_000],
    ]);
  });

  it('holds the lines after a gate back until the music went on, and rules nothing past the last beat', () => {
    // The second bar's line fell due at four seconds, the music stood, and
    // the reader gave it at five and a half: the half beat after it is half
    // way from there to the next beat, not from where it fell due.
    const run = roll(
      [press({ downAtMs: PLAYED_AT })],
      [
        beat(PLAYED_AT, 0),
        beat(PLAYED_AT + 4_000, q * 4),
        beat(PLAYED_AT + 5_500, q * 4),
        beat(PLAYED_AT + 6_500, q * 5),
      ],
    );

    const second = ruled(run).filter(([, atMs]) => atMs >= 4_000);
    expect(second).toEqual([
      ['downbeat', 4_000],
      ['division', 6_000],
      ['beat', 6_500],
    ]);
  });

  it('guesses at none where the run kept no beats', () => {
    const run = roll([press({ downAtMs: PLAYED_AT, stepIndex: 0 }), press({ downAtMs: PLAYED_AT + 1_000, stepIndex: 1 })]);

    expect(ruled(run)).toEqual([]);
  });
});

describe('the keys down, and the pedal, a moment into the run', () => {
  it('lights each key from when it went down to when it came up, as its press was judged', () => {
    const run = roll([
      press({ downAtMs: PLAYED_AT, upAtMs: PLAYED_AT + 800, stepIndex: 0, midi: MIDI.C4, deviationMs: 10 }),
      press({ downAtMs: PLAYED_AT + 1_300, upAtMs: PLAYED_AT + 1_900, stepIndex: 1, midi: MIDI.D4, deviationMs: 300 }),
      press({ downAtMs: PLAYED_AT + 1_400, upAtMs: PLAYED_AT + 1_600, midi: MIDI.C5, verdict: 'wrong', stepIndex: 1 }),
      press({ downAtMs: PLAYED_AT + 1_500, upAtMs: null, midi: MIDI.G2, verdict: 'other-hand', stepIndex: 1 }),
    ]);
    const presses = thePressesOfTheRun(run, timeline, IN_TIME);
    const at = (ms: number): [number, string][] => [...theKeysDownAt(presses, ms)];

    // Lit the moment it goes down, and dark the moment it comes up.
    expect(at(0)).toEqual([[MIDI.C4, 'perfect']]);
    expect(at(400)).toEqual([[MIDI.C4, 'perfect']]);
    expect(at(800)).toEqual([]);
    // Let go of: dark again.
    expect(at(1_000)).toEqual([]);
    expect(at(1_550)).toEqual([
      [MIDI.D4, 'good'],
      [MIDI.C5, 'wrong'],
      [MIDI.G2, 'aside'],
    ]);
    // Still held when the run stopped, so held to the end.
    expect(at(60_000)).toEqual([[MIDI.G2, 'aside']]);
  });

  it('gives the presses down at some moment between two, each in its colour', () => {
    // What falls onto the keys before they go down: a press still held at
    // the first moment, or going down before the second. One that came up
    // exactly at the first, or goes down exactly at the second, is not there.
    const run = roll([
      press({ downAtMs: PLAYED_AT, upAtMs: PLAYED_AT + 800, stepIndex: 0, midi: MIDI.C4, deviationMs: 10 }),
      press({ downAtMs: PLAYED_AT + 1_300, upAtMs: PLAYED_AT + 1_900, stepIndex: 1, midi: MIDI.D4, deviationMs: 300 }),
      press({ downAtMs: PLAYED_AT + 1_500, upAtMs: null, midi: MIDI.G2, verdict: 'other-hand', stepIndex: 1 }),
    ]);
    const presses = thePressesOfTheRun(run, timeline, IN_TIME);
    const between = (from: number, until: number): [number, string][] =>
      thePressesBetween(presses, from, until).map((one) => [one.midi, one.shade]);

    expect(between(800, 1_300)).toEqual([]);
    expect(between(799, 1_301)).toEqual([
      [MIDI.C4, 'perfect'],
      [MIDI.D4, 'good'],
    ]);
    // Held when the run stopped, so down to the end of it.
    expect(between(30_000, 33_000)).toEqual([[MIDI.G2, 'aside']]);
  });

  it('says the pedal is down while it was, and to the end where it was never let up', () => {
    const run: RunRoll = {
      ...roll([press({ downAtMs: PLAYED_AT })]),
      pedal: [
        { downAtMs: PLAYED_AT + 500, upAtMs: PLAYED_AT + 1_500 },
        { downAtMs: PLAYED_AT + 3_000, upAtMs: null },
      ],
    };

    expect(thePedalDownAt(run, 100)).toBe(false);
    expect(thePedalDownAt(run, 1_000)).toBe(true);
    expect(thePedalDownAt(run, 2_000)).toBe(false);
    expect(thePedalDownAt(run, 9_000)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { barLines, elapsedMsAt, tempoSpans } from '../../src/domain/model/Exercise.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { twoBarExercise } from '../support/fixtures.js';

describe('the bars and tempos of a piece, walked once', () => {
  it('walks the bars of one piece once, however often it is asked', () => {
    // Asked several times for each note a playback gathers, and it used to walk
    // every bar every time: on a score of thirteen hundred bars, gathering the
    // notes took four seconds with the pulse already running, and the marker
    // jumped ahead instead of waiting for the first note. His: "стрибає вперед
    // одразу ніж чекати на першу ноту".
    const piece = twoBarExercise();

    expect(barLines(piece)).toBe(barLines(piece));
    expect(tempoSpans(piece)).toBe(tempoSpans(piece));
  });

  it('never hands one piece the bars of another', () => {
    // Kept against the piece itself, so a second piece - a different metre, a
    // different length - has answers of its own. Kept anywhere wider and the
    // first piece opened would decide where the bar lines of every later one
    // fall.
    const common = twoBarExercise({ timeSignature: new TimeSignature(4, 4) });
    const waltz = twoBarExercise({ timeSignature: new TimeSignature(3, 4) });

    const inFour = barLines(common);
    const inThree = barLines(waltz);

    expect(inThree).not.toBe(inFour);
    expect(inThree[1]?.startTicks).toBe(waltz.timeSignature.ticksPerMeasure);
    expect(inFour[1]?.startTicks).toBe(common.timeSignature.ticksPerMeasure);
  });

  it('times a piece at its own tempo, not at the last one asked about', () => {
    // A piece taken at another speed is another exercise, and it is timed as
    // one: the retimed copy the controller makes must not inherit the
    // original's tempo because the original was asked about first.
    const slow = twoBarExercise({ tempoBpm: 60 });
    const fast = twoBarExercise({ tempoBpm: 120 });
    const bar = slow.timeSignature.ticksPerMeasure;

    expect(elapsedMsAt(slow, bar)).toBe(4_000);
    expect(elapsedMsAt(fast, bar)).toBe(2_000);
    expect(elapsedMsAt(slow, bar)).toBe(4_000);
  });
});

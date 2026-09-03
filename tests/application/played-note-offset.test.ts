import { describe, expect, it } from 'vitest';
import { playedNoteOffset } from '../../src/application/playedNoteOffset.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { twoBarExercise } from '../support/fixtures.js';

// Quarter notes at 60 bpm: every gap in the first bar is exactly 1000 ms.
const timeline = buildTimeline(twoBarExercise({ tempoBpm: 60 }));

describe('playedNoteOffset', () => {
  it('reports how far through the gap a press landed', () => {
    // Half a beat late on step 1 is halfway to step 2.
    expect(playedNoteOffset(timeline, 1, 500, 60)).toBeCloseTo(0.5, 10);
    // A third of a beat early is a third of the way back to step 0.
    expect(playedNoteOffset(timeline, 1, -333, 60)).toBeCloseTo(-0.333, 3);
  });

  it('is the case the reader actually complained about', () => {
    // Pressed 300 ms before beat 2, too early to be counted for it, so judged
    // against beat 1 - which put the mark a whole note to the left of where it
    // felt like it had been played. It now sits just before beat 2.
    const offset = playedNoteOffset(timeline, 0, 700, 60);
    expect(offset).toBeCloseTo(0.7, 10);
  });

  it('scales with the tempo, not with milliseconds', () => {
    // Twice the tempo halves the gap, so the same lateness reads as twice as
    // far through it.
    expect(playedNoteOffset(timeline, 1, 250, 60)).toBeCloseTo(0.25, 10);
    expect(playedNoteOffset(timeline, 1, 250, 120)).toBeCloseTo(0.5, 10);
  });

  it('calls a press near the beat simply on the beat', () => {
    expect(playedNoteOffset(timeline, 1, 60, 60)).toBe(0);
    expect(playedNoteOffset(timeline, 1, -60, 60)).toBe(0);
    // And the boundary is a real one: just past it, the mark moves.
    expect(playedNoteOffset(timeline, 1, 200, 60)).toBeCloseTo(0.2, 10);
  });

  it('never lets a mark reach the note it is leaning towards', () => {
    expect(playedNoteOffset(timeline, 1, 5_000, 60)).toBeCloseTo(0.85, 10);
    expect(playedNoteOffset(timeline, 1, -5_000, 60)).toBeCloseTo(-0.85, 10);
  });

  it('measures an early press against the gap behind it', () => {
    // Step 4 opens bar two and lasts two beats, while the step before it lasts
    // one. The same 500 ms therefore means different things either side of it,
    // and an early press must not be flattened by the long note it lands on.
    expect(timeline.at(3)?.durationTicks).toBe(Duration.QUARTER.ticks);
    expect(timeline.at(4)?.durationTicks).toBe(Duration.HALF.ticks);
    expect(playedNoteOffset(timeline, 4, -500, 60)).toBeCloseTo(-0.5, 10);
    expect(playedNoteOffset(timeline, 4, 500, 60)).toBeCloseTo(0.25, 10);
  });

  it('has nothing to say without a deviation or a step', () => {
    expect(playedNoteOffset(timeline, 1, null, 60)).toBe(0);
    expect(playedNoteOffset(timeline, 999, 500, 60)).toBe(0);
    expect(playedNoteOffset(timeline, 1, 500, 0)).toBe(0);
  });

  it('falls back to its own gap at the very first step', () => {
    // Nothing behind step 0 to measure against, so its own length stands in.
    expect(playedNoteOffset(timeline, 0, -500, 60)).toBeCloseTo(-0.5, 10);
  });
});

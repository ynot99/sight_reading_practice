import { describe, expect, it } from 'vitest';
import { PracticeTimer } from '../../src/application/PracticeTimer.js';

describe('how long the reader has been at the instrument', () => {
  it('counts nothing until a second note says how long the first lasted', () => {
    const timer = new PracticeTimer();

    timer.noteHeard(1_000);

    // One note is a moment, not a stretch.
    expect(timer.sittingMs).toBe(0);
  });

  it('counts the time between the notes they play', () => {
    const timer = new PracticeTimer();

    timer.noteHeard(0);
    timer.noteHeard(30_000);
    timer.noteHeard(90_000);

    expect(timer.sittingMs).toBe(90_000);
  });

  it('does not count a silence long enough to be a break', () => {
    // A page left open over lunch is not an hour of practice, and a reminder
    // riding on this would be nagging about a rest already taken.
    const timer = new PracticeTimer({ idleAfterMs: 60_000 });

    timer.noteHeard(0);
    timer.noteHeard(10_000);
    timer.noteHeard(10_000 + 45 * 60_000);
    timer.noteHeard(10_000 + 45 * 60_000 + 5_000);

    expect(timer.sittingMs).toBe(15_000);
  });

  it('counts the thinking, which is time at the keyboard too', () => {
    // Working a bar out, turning the page, reading it: the hands are what is
    // being rested, and they are on the keys throughout.
    const timer = new PracticeTimer({ idleAfterMs: 60_000 });

    timer.noteHeard(0);
    timer.noteHeard(40_000);

    expect(timer.sittingMs).toBe(40_000);
  });

  it('starts again from nothing when a rest is taken', () => {
    const timer = new PracticeTimer();
    timer.noteHeard(0);
    timer.noteHeard(60_000);
    expect(timer.sittingMs).toBe(60_000);

    timer.reset();

    expect(timer.sittingMs).toBe(0);
    // And the note before the rest is forgotten with it: the next note opens
    // a new stretch rather than joining the one across the break.
    timer.noteHeard(90_000);
    expect(timer.sittingMs).toBe(0);
  });
});

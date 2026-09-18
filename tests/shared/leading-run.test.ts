import { describe, expect, it } from 'vitest';
import { lastOfLeadingRun } from '../../src/shared/leadingRun.js';

describe('the last of a leading run, found by halving', () => {
  const starts = [0, 10, 10, 20, 40];

  it('finds the last item that has begun by a moment', () => {
    expect(lastOfLeadingRun(starts, (at) => at <= 25)).toBe(3);
    expect(lastOfLeadingRun(starts, (at) => at <= 40)).toBe(4);
  });

  it('takes the last of several that begin together', () => {
    // Where the question is "the latest by now", two things at one moment are
    // settled by which comes later in the list - so the last of them it must be.
    expect(lastOfLeadingRun(starts, (at) => at <= 10)).toBe(2);
  });

  it('says so when nothing has begun yet', () => {
    expect(lastOfLeadingRun(starts, (at) => at <= -1)).toBe(-1);
    expect(lastOfLeadingRun([], () => true)).toBe(-1);
  });

  it('agrees with a walk at every moment', () => {
    for (let moment = -5; moment <= 45; moment += 1) {
      const walked = starts.reduce((last, at, index) => (at <= moment ? index : last), -1);
      expect(lastOfLeadingRun(starts, (at) => at <= moment)).toBe(walked);
    }
  });
});

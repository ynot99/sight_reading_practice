import { describe, expect, it } from 'vitest';
import { fittingPassesWorth } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';

describe('how many engravings the page fitting may spend', () => {
  it('spends freely where an engraving costs nothing', () => {
    // Which is every score the reader owns but one. This is the four passes it
    // has always been: taking the surplus off changes which systems fit, so a
    // single pass is a guess.
    expect(fittingPassesWorth(5)).toBe(4);
    expect(fittingPassesWorth(150)).toBe(4);
    // Half a second is already a slow engraving for one of his arrangements,
    // and it still keeps every pass: nothing he owns loses one.
    expect(fittingPassesWorth(500)).toBe(4);
  });

  it('spends less as an engraving gets dearer', () => {
    expect(fittingPassesWorth(700)).toBe(2);
    expect(fittingPassesWorth(1_000)).toBe(2);
    expect(fittingPassesWorth(2_000)).toBe(1);
  });

  it('spends nothing at all on a score that takes seconds to draw', () => {
    // Measured on a thirteen-hundred bar score: one engraving is twenty-one
    // seconds, so four passes turned opening it into a hundred seconds of
    // drawing, each allocating the whole drawing again. A reader waiting that
    // long has a worse page than one looking at a clipped system - and zooming
    // engraves and fits again at a moment they chose.
    expect(fittingPassesWorth(2_100)).toBe(0);
    expect(fittingPassesWorth(2_500)).toBe(0);
    expect(fittingPassesWorth(21_000)).toBe(0);
  });

  it('spends freely where nothing was measured', () => {
    // No clock, or a render that took no measurable time: the old behaviour is
    // the safe answer, not "give up".
    expect(fittingPassesWorth(0)).toBe(4);
    expect(fittingPassesWorth(Number.NaN)).toBe(4);
    expect(fittingPassesWorth(-1)).toBe(4);
  });
});

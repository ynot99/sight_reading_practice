import { describe, expect, it } from 'vitest';
import { staffLinesIn } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';

/** A horizontal line, as the engraver draws one. */
function rule(y: number, width: number, from = 50): { y: number; from: number; to: number } {
  return { y, from, to: from + width };
}

/**
 * Telling a staff's own five lines from everything drawn beside them.
 *
 * The numbers here are measured, not invented: they come from the reader's
 * own copy of City of Tears and from the fixtures, printed out of the
 * engraving. What they are being asked is the one question the hand switches
 * ask of a staff - where is its middle - and every wrong answer to that shows
 * as a control sitting somewhere the staff is not.
 */
describe('finding the five lines of a staff', () => {
  it('takes the five evenly spaced lines and nothing else', () => {
    const lines = [rule(105.5, 400), rule(115.5, 400), rule(125.5, 400), rule(135.5, 400), rule(145.5, 400)];

    expect(staffLinesIn(lines)).toEqual([105.5, 115.5, 125.5, 135.5, 145.5]);
  });

  it('leaves out a bracket running under the staff', () => {
    // City of Tears, first system, treble: the pedal's bracket at 189.1 runs
    // 286.7 against staff lines of 400, which is over half of one - so a rule
    // that told them apart by width alone let it in, and it dragged the
    // staff's middle 21.8 pixels down with it.
    const lines = [
      rule(105.5, 400),
      rule(115.5, 400),
      rule(125.5, 400),
      rule(135.5, 400),
      rule(145.5, 400),
      rule(189.1, 286.7),
    ];

    expect(staffLinesIn(lines)).toEqual([105.5, 115.5, 125.5, 135.5, 145.5]);
  });

  it('leaves out ledger lines, which lie on the staff’s own grid', () => {
    // City of Tears, first system, bass: two ledger lines above the staff, at
    // exactly the staff's spacing - so spacing alone cannot tell them apart,
    // and taking the first five evenly spaced would take two ledgers and
    // three staff lines.
    const lines = [
      rule(205.5, 18),
      rule(215.5, 18),
      rule(225.5, 400),
      rule(235.5, 400),
      rule(245.5, 400),
      rule(255.5, 400),
      rule(265.5, 400),
    ];

    expect(staffLinesIn(lines)).toEqual([225.5, 235.5, 245.5, 255.5, 265.5]);
  });

  it('is not thrown by a bracket longer than any one staff line', () => {
    // The staff's lines are drawn per measure, so a system of two bars draws
    // each line twice and neither copy spans the system. A bracket that runs
    // the whole of it is then longer than any of them - and measured against
    // the widest line in the group, every staff line would have been thrown
    // away and the switch left with nothing to stand on.
    const lines = [
      rule(105.5, 244.9),
      rule(105.5, 108.1, 300),
      rule(115.5, 244.9),
      rule(115.5, 108.1, 300),
      rule(125.5, 244.9),
      rule(125.5, 108.1, 300),
      rule(135.5, 244.9),
      rule(135.5, 108.1, 300),
      rule(145.5, 244.9),
      rule(145.5, 108.1, 300),
      rule(178.0, 600),
    ];

    expect(staffLinesIn(lines)).toEqual([105.5, 115.5, 125.5, 135.5, 145.5]);
  });

  it('says nothing rather than guessing when there is no staff there', () => {
    // A group with no five evenly spaced lines in it is not a staff, and an
    // answer made up from what is there would put a switch on music.
    expect(staffLinesIn([rule(10, 100), rule(20, 100)])).toEqual([]);
    expect(staffLinesIn([])).toEqual([]);
  });
});

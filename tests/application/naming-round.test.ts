import { describe, expect, it } from 'vitest';
import { NamingRound } from '../../src/application/solfege/NamingRound.js';
import type { NamingQuestion } from '../../src/domain/model/Exercise.js';

const interval = (measureIndex: number, answer: string): NamingQuestion => ({
  measureIndex,
  parts: [{ asks: 'Interval', choices: ['m3', 'M3', 'P5'], answer }],
});

const chord: NamingQuestion = {
  measureIndex: 2,
  parts: [
    { asks: 'Quality', choices: ['Major', 'Minor'], answer: 'Minor' },
    { asks: 'Position', choices: ['Root position', 'First inversion'], answer: 'First inversion' },
  ],
};

describe('a naming round', () => {
  it('judges a question once every part is picked, right only where every part is, and moves on only from one answered', () => {
    const round = new NamingRound([interval(0, 'M3'), chord, interval(3, 'P5')]);
    expect([round.place, round.asking?.measureIndex, round.answered, round.over]).toEqual([0, 0, null, false]);
    // Not moved on from a question not answered; nothing picked that is not offered.
    expect(round.next()).toBe(false);
    expect(round.pick(0, 'P8')).toBe(false);
    expect(round.pick(1, 'M3')).toBe(false);
    expect(round.pick(0, 'M3')).toBe(true);
    expect(round.answered).toEqual({ question: round.questions[0], picked: ['M3'], right: true });
    // Answered, it is not answered again.
    expect(round.pick(0, 'm3')).toBe(false);
    expect(round.next()).toBe(true);

    // Two parts: judged when both are, a part picked again before then changed.
    expect(round.pick(0, 'Major')).toBe(true);
    expect([round.pickedSoFar, round.answered]).toEqual([['Major', null], null]);
    round.pick(0, 'Minor');
    round.pick(1, 'Root position');
    expect(round.answered).toEqual({ question: chord, picked: ['Minor', 'Root position'], right: false });
    round.next();
    round.pick(0, 'm3');
    round.next();
    expect([round.over, round.asking, round.score, round.answers.map((each) => each.right)]).toEqual([
      true,
      null,
      { right: 1, of: 3 },
      [true, false, false],
    ]);
    // Over, nothing more is picked or moved to.
    expect([round.pick(0, 'M3'), round.next()]).toEqual([false, false]);
  });
});

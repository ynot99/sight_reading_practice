import { describe, expect, it } from 'vitest';
import { drillTaskPassed, planTheDrill } from '../../src/application/drill/SectionDrill.js';

/** A task, as short as it can be said, for comparing whole plans. */
function said(task: {
  fromBar: number;
  toBar: number;
  hand: number | null;
  tempoPercent: number;
}): string {
  return `${task.fromBar}-${task.toBar} ${task.hand ?? 'both'} ${task.tempoPercent}%`;
}

describe('learning a piece section by section', () => {
  it('takes each section with one hand, then the other, then both', () => {
    // His line 93, in his order: slowly with the left, then the right, then
    // both - the left hand first because it is usually the ground the rest
    // is heard against.
    const plan = planTheDrill(8, { sectionBars: 4, hands: [1, 2] });

    expect(plan.slice(0, 6).map(said)).toEqual([
      '1-4 1 70%',
      '1-4 2 70%',
      '1-4 both 70%',
      '5-8 1 70%',
      '5-8 2 70%',
      '5-8 both 70%',
    ]);
  });

  it('glues the sections together, and then the whole piece', () => {
    const plan = planTheDrill(16, { sectionBars: 4, hands: [1, 2] });
    const joined = plan.filter((task) => task.stage !== 'section');

    expect(joined.map(said)).toEqual([
      '1-8 both 85%',
      '9-16 both 85%',
      '1-16 both 100%',
    ]);
  });

  it('asks for both hands only, where there is only one staff', () => {
    // Generated material is often a single line, and "now the left hand" is
    // an instruction with nothing behind it.
    const plan = planTheDrill(8, { sectionBars: 4, hands: [1] });

    expect(plan.map(said)).toEqual(['1-4 both 70%', '5-8 both 70%', '1-8 both 100%']);
  });

  it('does not ask twice for the same bars', () => {
    // A round of gluing that would hand back a stretch already played
    // exactly as it stands is skipped: the reader has just done it.
    const plan = planTheDrill(10, { sectionBars: 4, hands: [1, 2] });
    const joined = plan.filter((task) => task.stage === 'joined').map(said);

    expect(joined).toEqual(['1-8 both 85%']);
    // Bars 9 and 10 are a section of their own and are not glued to
    // themselves; the whole piece picks them up.
    expect(plan.at(-1) && said(plan.at(-1) as never)).toBe('1-10 both 100%');
  });

  it('has nothing to say about a piece shorter than a section', () => {
    // Four bars split into fours is one section, and gluing it to nothing
    // and then playing "the whole piece" would be the same bars three times.
    const plan = planTheDrill(4, { sectionBars: 4, hands: [1, 2] });

    expect(plan.map(said)).toEqual(['1-4 1 70%', '1-4 2 70%', '1-4 both 70%']);
  });

  it('has nothing at all to say about no bars', () => {
    expect(planTheDrill(0, { hands: [1, 2] })).toEqual([]);
  });

  it('moves on only for a clean reading that reached the end', () => {
    // "Until it is learned perfectly", in his words - and a run stopped
    // halfway is not a reading of the passage at all.
    expect(drillTaskPassed({ completed: true, overall: 0.98 })).toBe(true);
    expect(drillTaskPassed({ completed: true, overall: 0.8 })).toBe(false);
    expect(drillTaskPassed({ completed: false, overall: 1 })).toBe(false);
    expect(drillTaskPassed(null)).toBe(false);
  });
});

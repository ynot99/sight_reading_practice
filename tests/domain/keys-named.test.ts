import { describe, expect, it } from 'vitest';
import { validateExercise, type Exercise } from '../../src/domain/model/Exercise.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { KEYS_ASKED, SIGNATURES_IN_A_ROUND, theKeysNamed } from '../../src/domain/solfege/keysNamed.js';

const SEEDS = Array.from({ length: 60 }, (_, seed) => seed + 1);

/** The key each bar is written in: the opening one, then each change. */
function keysOf(round: Exercise): { readonly fifths: number; readonly mode: string }[] {
  return Array.from({ length: SIGNATURES_IN_A_ROUND }, (_, bar) => {
    const key = bar === 0 ? round.key : round.keyChanges.find((change) => change.measureIndex === bar)?.key;
    return { fifths: key?.fifths ?? Number.NaN, mode: key?.mode ?? '' };
  });
}

describe('keys by name', () => {
  it('is a valid round of ten signatures, a bar each with a rest, no signature twice running, the same for the same seed', () => {
    for (const as of KEYS_ASKED) {
      for (const seed of SEEDS.slice(0, 20)) {
        const round = theKeysNamed({ as, seed });
        expect(() => {
          validateExercise(round);
        }).not.toThrow();
        expect(buildTimeline(round).steps.every((step) => step.expectedMidi.length === 0)).toBe(true);
        const keys = keysOf(round);
        expect(keys.every((key, at) => at === 0 || key.fifths !== keys[at - 1]?.fifths)).toBe(true);
        expect(theKeysNamed({ as, seed })).toEqual(round);
      }
    }
  });

  it('asks each signature as the key asked, its choices every tonic of that mode round the circle of fifths', () => {
    const asked = new Set<string>();
    for (const as of KEYS_ASKED) {
      for (const seed of SEEDS) {
        const round = theKeysNamed({ as, seed });
        keysOf(round).forEach((key, at) => {
          const part = round.byName?.[at]?.parts[0];
          expect(part?.asks).toBe(key.mode === 'minor' ? 'Minor key' : 'Major key');
          if (as !== 'either') {
            expect(key.mode).toBe(as);
          }
          asked.add(`${key.mode} ${String(key.fifths)}`);
          expect(part?.answer).toBe(part?.choices[key.fifths + 7]);
        });
      }
    }
    // Every signature, as either mode; and asked either, both modes come up.
    expect(asked.size).toBe(30);
    const either = new Set(SEEDS.flatMap((seed) => keysOf(theKeysNamed({ as: 'either', seed })).map((key) => key.mode)));
    expect([...either].sort()).toEqual(['major', 'minor']);
    const choices = (as: 'major' | 'minor'): readonly string[] => theKeysNamed({ as, seed: 1 }).byName?.[0]?.parts[0]?.choices ?? [];
    expect(choices('major')).toEqual(['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯']);
    expect(choices('minor')).toEqual(['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯']);
  });
});

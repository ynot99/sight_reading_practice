import { describe, expect, it } from 'vitest';
import { eachKeyOnce, sameKeys, theChordsMerged, theChordsOfTheKey } from '../../src/domain/harmony/chordsOfTheKey.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { STEPS } from '../../src/domain/model/Pitch.js';

/** Every key a sketch can be written in. */
const EVERY_KEY = (['major', 'minor'] as const).flatMap((mode) =>
  Array.from({ length: 15 }, (_, at) => new KeySignature(at - 7, mode)),
);

const MIDDLE_C = 60;

describe('the keys of a chord', () => {
  it('are each key once, low to high, wherever and however often struck', () => {
    expect(eachKeyOnce([67, 60, 64, 60, 48])).toEqual([48, 60, 64, 67]);
    expect(sameKeys([64, 60, 67, 60], [60, 64, 67])).toBe(true);
    // Another octave is another chord, and so is one key more.
    expect(sameKeys([60, 64, 67], [48, 64, 67])).toBe(false);
    expect(sameKeys([60, 64, 67], [60, 64, 67, 71])).toBe(false);
    expect(sameKeys([60, 64, 67, 71], [60, 64, 67])).toBe(false);
  });
});

describe('two lists of kept chords brought together', () => {
  const C = [60, 64, 67];
  const F = [53, 57, 60];
  const G = [55, 59, 62];
  const AM = [57, 60, 64];
  const DM = [50, 53, 57];

  it('does to the other list what this one kept and let go of since they were the same, and keeps what the other did', () => {
    const cases: [string, number[][] | null, number[][], number[][] | null, number[][]][] = [
      // [what, theirs, mine, inStep, merged]
      ['no other list: this one is the list', null, [C, F], [C, G], [C, F]],
      ['never the same: both kept, the other\'s first', [G, C], [C, F], null, [G, C, F]],
      ['kept here since: after the other\'s', [C, G], [C, F], [C], [C, G, F]],
      ['let go of here since: gone from the other', [C, F, G], [C], [C, F], [C, G]],
      ['let go of there since: stays gone', [C], [C, F], [C, F], [C]],
      ['kept there since: stays', [C, F, AM], [C, F], [C, F], [C, F, AM]],
      ['kept on both since: once', [C, DM], [C, DM], [C], [C, DM]],
      ['let go of on both since: gone', [C], [C], [C, F], [C]],
      ['each kept one and let go of one', [C, AM], [F, G], [C, F], [AM, G]],
      ['the same keys however written', [[67, 64, 60]], [[60, 64, 67, 60], F], [[64, 60, 67]], [[67, 64, 60], F]],
    ];
    for (const [what, theirs, mine, inStep, merged] of cases) {
      expect(theChordsMerged(theirs, mine, inStep), what).toEqual(merged);
    }
  });
});

describe('the chords of a key', () => {
  it('names the seven of C major and of A minor, with their numerals', () => {
    const said = (key: KeySignature): string[] => theChordsOfTheKey(key).map(({ name, numeral }) => `${numeral} ${name}`);
    expect(said(KeySignature.major(0))).toEqual(['I C', 'ii Dm', 'iii Em', 'IV F', 'V G', 'vi Am', 'vii° Bdim']);
    expect(said(KeySignature.minor(0))).toEqual(['i Am', 'ii° Bdim', 'III C', 'iv Dm', 'v Em', 'VI F', 'VII G']);
    expect(theChordsOfTheKey(KeySignature.major(0))[0]?.midis).toEqual([60, 64, 67]);
  });

  it('spells them as the key does', () => {
    expect(theChordsOfTheKey(KeySignature.major(-3)).map(({ name }) => name)).toEqual([
      'E♭',
      'Fm',
      'Gm',
      'A♭',
      'B♭',
      'Cm',
      'Ddim',
    ]);
    expect(theChordsOfTheKey(KeySignature.minor(3)).map(({ name }) => name)).toEqual([
      'F♯m',
      'G♯dim',
      'A',
      'Bm',
      'C♯m',
      'D',
      'E',
    ]);
  });

  it('stacks the key\'s own notes in thirds on each degree, from the tonic up, rooted in the octave of middle C', () => {
    // Swept: every key a signature can have, major and minor.
    for (const key of EVERY_KEY) {
      const inTheKey = new Set(
        Array.from({ length: STEPS.length }, (_, step) => (key.pitchAt(step).midi % 12 + 12) % 12),
      );
      const tonic = (key.pitchAt(key.tonicIndexAtOrAbove(0)).midi % 12 + 12) % 12;
      const chords = theChordsOfTheKey(key);
      expect(chords, key.name).toHaveLength(7);
      expect(((chords[0]?.midis[0] ?? 0) % 12 + 12) % 12, key.name).toBe(tonic);
      // Each a degree above the last: seven different roots.
      expect(new Set(chords.map(({ midis }) => (midis[0] ?? 0) % 12)).size, key.name).toBe(7);
      for (const { midis, name, numeral } of chords) {
        const [root = 0, third = 0, fifth = 0] = midis;
        // A flat C is the B below middle C, and a sharp B the C above the B.
        expect(root, key.name).toBeGreaterThanOrEqual(MIDDLE_C - 1);
        expect(root, key.name).toBeLessThanOrEqual(MIDDLE_C + 12);
        expect(midis.every((midi) => inTheKey.has(midi % 12)), `${key.name} ${name}`).toBe(true);
        expect([3, 4], `${key.name} ${name}`).toContain(third - root);
        expect([6, 7], `${key.name} ${name}`).toContain(fifth - root);
        // The numeral says the third and the fifth.
        expect(numeral === numeral.toUpperCase(), `${key.name} ${numeral}`).toBe(third - root === 4);
        expect(numeral.endsWith('°'), `${key.name} ${numeral}`).toBe(fifth - root === 6);
        expect(name, `${key.name} ${numeral}`).not.toBe('');
      }
    }
  });
});

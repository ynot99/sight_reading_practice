import { describe, expect, it } from 'vitest';
import { TAPS_FORGOTTEN_AFTER_MS, tapsWith, tempoOfTaps } from '../../src/application/tapTempo.js';

/** The taps as they stand after each of these moments in turn. */
function tapped(...moments: number[]): readonly number[] {
  return moments.reduce<readonly number[]>((taps, atMs) => tapsWith(taps, atMs), []);
}

describe('a tempo tapped', () => {
  it('needs two taps, and is then the beat they were apart', () => {
    expect(tempoOfTaps(tapped())).toBeNull();
    expect(tempoOfTaps(tapped(1_000))).toBeNull();
    expect(tempoOfTaps(tapped(1_000, 1_500))).toBe(120);
  });

  it('is the mean of the gaps, so one early tap moves it little', () => {
    // 500, 400 and 600 apart: a hundred and twenty, not the last gap's hundred.
    expect(tempoOfTaps(tapped(0, 500, 900, 1_500))).toBe(120);
  });

  it('follows the latest few gaps only, so a tempo tapped faster is taken up at once', () => {
    const slow = [0, 1_000, 2_000, 3_000, 4_000];
    const fast = [4_500, 5_000, 5_500, 6_000];
    const taps = tapped(...slow, ...fast);

    expect(taps).toEqual([4_000, 4_500, 5_000, 5_500, 6_000]);
    expect(tempoOfTaps(taps)).toBe(120);
  });

  it('begins again after a pause, the band swept across where it is drawn', () => {
    for (const gap of [TAPS_FORGOTTEN_AFTER_MS - 1, TAPS_FORGOTTEN_AFTER_MS, TAPS_FORGOTTEN_AFTER_MS + 1]) {
      const taps = tapped(0, 500, 500 + gap);
      expect(taps).toHaveLength(gap > TAPS_FORGOTTEN_AFTER_MS ? 1 : 3);
    }
  });

  it('begins again on a tap no later than the last, as a clock that went back would give', () => {
    expect(tapped(1_000, 1_000)).toEqual([1_000]);
    expect(tapped(1_000, 900)).toEqual([900]);
  });
});

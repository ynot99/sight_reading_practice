import { describe, expect, it } from 'vitest';
import { ChordMatcher, type MatchPolicy } from '../../src/domain/matching/ChordMatcher.js';

const RHYTHM_ONLY: MatchPolicy = {
  toleranceMs: 250,
  pitchClassOnly: false,
  anyPitch: true,
};

describe('judging the rhythm and not the notes', () => {
  it('takes any note as the one that was written', () => {
    const matcher = new ChordMatcher([60, 64], RHYTHM_ONLY);

    // Nowhere near the chord, and still the right thing to have done.
    const outcome = matcher.accept(41, 0);

    expect(outcome.verdict).toBe('correct');
    expect(matcher.completed).toBe(true);
  });

  it('treats a chord as the one gesture it is', () => {
    const matcher = new ChordMatcher([60, 64, 67], RHYTHM_ONLY);
    matcher.accept(60, 0);

    // The rest of the hand landing is not two more notes to be judged.
    expect(matcher.accept(64, 4).verdict).toBe('duplicate');
    expect(matcher.accept(67, 8).verdict).toBe('duplicate');
    expect(matcher.summary().wrong).toEqual([]);
  });

  it('counts a tapped step as played, so accuracy is not a lie', () => {
    const matcher = new ChordMatcher([60, 64], RHYTHM_ONLY);
    matcher.accept(48, 0);

    // The reader did what was asked; reporting both notes as missing would
    // score the exercise as though nothing had sounded.
    expect(matcher.summary().missing).toEqual([]);
    expect(matcher.remaining).toEqual([]);
  });

  it('still names the notes until they are tapped', () => {
    // The reader is reading them, even while only the timing is judged.
    const matcher = new ChordMatcher([60, 64], RHYTHM_ONLY);
    expect(matcher.remaining).toEqual([60, 64]);
    expect(matcher.expected).toEqual([60, 64]);
  });

  it('starts over cleanly when the attempt does', () => {
    const matcher = new ChordMatcher([60], RHYTHM_ONLY);
    matcher.accept(72, 0);
    matcher.restartAttempt();

    expect(matcher.completed).toBe(false);
    expect(matcher.accept(50, 10).verdict).toBe('correct');
  });

  it('leaves the ordinary rules exactly as they were', () => {
    const strict = new ChordMatcher([60, 64], { toleranceMs: 250, pitchClassOnly: false });

    expect(strict.accept(41, 0).verdict).toBe('wrong');
    expect(strict.accept(60, 4).verdict).toBe('correct');
    expect(strict.completed).toBe(false);
    expect(strict.accept(64, 8).completed).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { ChordMatcher, DEFAULT_MATCH_POLICY } from '../../src/domain/matching/ChordMatcher.js';

const C_MAJOR_TRIAD = [60, 64, 67];

describe('ChordMatcher', () => {
  it('completes when every expected pitch has been played', () => {
    const matcher = new ChordMatcher(C_MAJOR_TRIAD, { toleranceMs: 200, pitchClassOnly: false });

    expect(matcher.accept(60, 0).completed).toBe(false);
    expect(matcher.accept(67, 20).completed).toBe(false);
    const last = matcher.accept(64, 35);

    expect(last.verdict).toBe('correct');
    expect(last.completed).toBe(true);
    expect(matcher.remaining).toEqual([]);
    expect(matcher.matched).toEqual([60, 67, 64]);
  });

  it('accepts the notes of a chord in any order', () => {
    const matcher = new ChordMatcher(C_MAJOR_TRIAD, DEFAULT_MATCH_POLICY);
    for (const midi of [67, 64, 60]) {
      matcher.accept(midi, 0);
    }
    expect(matcher.completed).toBe(true);
  });

  it('reports the notes still missing', () => {
    const matcher = new ChordMatcher(C_MAJOR_TRIAD, DEFAULT_MATCH_POLICY);
    const outcome = matcher.accept(64, 0);
    expect(outcome.remaining).toEqual([60, 67]);
    expect(matcher.summary().missing).toEqual([60, 67]);
  });

  it('flags unexpected presses without losing the ones already collected', () => {
    const matcher = new ChordMatcher(C_MAJOR_TRIAD, { toleranceMs: 500, pitchClassOnly: false });
    matcher.accept(60, 0);
    const wrong = matcher.accept(61, 10);

    expect(wrong.verdict).toBe('wrong');
    expect(wrong.completed).toBe(false);
    expect(matcher.wrong).toEqual([61]);
    expect(matcher.remaining).toEqual([64, 67]);

    matcher.accept(64, 20);
    matcher.accept(67, 30);
    expect(matcher.completed).toBe(true);
    expect(matcher.summary().wrong).toEqual([61]);
  });

  it('treats a repeated note of the chord as a duplicate, not an error', () => {
    const matcher = new ChordMatcher(C_MAJOR_TRIAD, DEFAULT_MATCH_POLICY);
    matcher.accept(60, 0);
    const again = matcher.accept(60, 10);

    expect(again.verdict).toBe('duplicate');
    expect(matcher.wrong).toEqual([]);
    expect(matcher.matched).toEqual([60]);
  });

  describe('tolerance window', () => {
    it('restarts the attempt when a note arrives too late to be simultaneous', () => {
      const matcher = new ChordMatcher(C_MAJOR_TRIAD, { toleranceMs: 100, pitchClassOnly: false });
      matcher.accept(60, 0);
      matcher.accept(64, 50);

      const late = matcher.accept(67, 400);

      expect(late.windowRestarted).toBe(true);
      expect(late.verdict).toBe('correct');
      expect(late.completed).toBe(false);
      // Only the late note survives the restart; the window now starts there.
      expect(matcher.matched).toEqual([67]);
      expect(matcher.windowStartMs).toBe(400);
      expect(matcher.remaining).toEqual([60, 64]);
    });

    it('keeps notes exactly on the tolerance boundary', () => {
      const matcher = new ChordMatcher(C_MAJOR_TRIAD, { toleranceMs: 100, pitchClassOnly: false });
      matcher.accept(60, 0);
      matcher.accept(64, 100);
      const outcome = matcher.accept(67, 100);

      expect(outcome.windowRestarted).toBe(false);
      expect(outcome.completed).toBe(true);
    });

    it('accumulates indefinitely when the window is infinite', () => {
      const matcher = new ChordMatcher(C_MAJOR_TRIAD, {
        toleranceMs: Number.POSITIVE_INFINITY,
        pitchClassOnly: false,
      });
      matcher.accept(60, 0);
      matcher.accept(64, 10_000);
      const outcome = matcher.accept(67, 90_000);

      expect(outcome.windowRestarted).toBe(false);
      expect(outcome.completed).toBe(true);
    });

    it('does not start the window on a wrong note', () => {
      const matcher = new ChordMatcher([60], { toleranceMs: 50, pitchClassOnly: false });
      matcher.accept(61, 0);
      expect(matcher.windowStartMs).toBeNull();

      const outcome = matcher.accept(60, 5_000);
      expect(outcome.windowRestarted).toBe(false);
      expect(outcome.completed).toBe(true);
    });
  });

  describe('octave-insensitive matching', () => {
    it('accepts the right note name in any octave', () => {
      const matcher = new ChordMatcher([60, 64], { toleranceMs: 200, pitchClassOnly: true });
      expect(matcher.accept(72, 0).verdict).toBe('correct');
      expect(matcher.accept(52, 10).verdict).toBe('correct');
      expect(matcher.completed).toBe(true);
    });

    it('still rejects the wrong note name', () => {
      const matcher = new ChordMatcher([60], { toleranceMs: 200, pitchClassOnly: true });
      expect(matcher.accept(61, 0).verdict).toBe('wrong');
    });
  });

  it('starts complete when nothing is expected', () => {
    const matcher = new ChordMatcher([], DEFAULT_MATCH_POLICY);
    expect(matcher.completed).toBe(true);
    expect(matcher.accept(60, 0).verdict).toBe('wrong');
  });

  it('can be reset for a fresh attempt', () => {
    const matcher = new ChordMatcher(C_MAJOR_TRIAD, DEFAULT_MATCH_POLICY);
    matcher.accept(60, 0);
    matcher.accept(61, 5);

    matcher.restartAttempt();
    expect(matcher.matched).toEqual([]);
    expect(matcher.wrong).toEqual([61]);

    matcher.reset();
    expect(matcher.wrong).toEqual([]);
    expect(matcher.remaining).toEqual(C_MAJOR_TRIAD);
  });

  it('deduplicates the expected set', () => {
    const matcher = new ChordMatcher([60, 60, 64], DEFAULT_MATCH_POLICY);
    expect(matcher.expected).toEqual([60, 64]);
  });
});

describe('an ornament printed at a step', () => {
  it('is neither asked for nor held against the reader', () => {
    // A grace note is on the page, so playing it is reading the page
    // correctly and must not be marked wrong. It is also the performer's to
    // add, so nothing waits for it.
    const matcher = new ChordMatcher([60], DEFAULT_MATCH_POLICY, [59]);

    const ornament = matcher.accept(59, 0);
    expect(ornament.verdict).toBe('ornament');
    expect(ornament.completed).toBe(false);
    expect(matcher.wrong).toEqual([]);
    expect(matcher.remaining).toEqual([60]);

    const note = matcher.accept(60, 10);
    expect(note.verdict).toBe('correct');
    expect(note.completed).toBe(true);
    expect(matcher.matched).toEqual([60]);
  });

  it('completes the step without it', () => {
    const matcher = new ChordMatcher([60], DEFAULT_MATCH_POLICY, [59]);

    expect(matcher.accept(60, 0).completed).toBe(true);
    expect(matcher.remaining).toEqual([]);
  });

  it('still calls a note that is neither wrong', () => {
    const matcher = new ChordMatcher([60], DEFAULT_MATCH_POLICY, [59]);

    expect(matcher.accept(70, 0).verdict).toBe('wrong');
    expect(matcher.wrong).toEqual([70]);
  });
});

import { describe, expect, it } from 'vitest';
import { PracticeHistory, type PracticeAttempt } from '../../src/application/PracticeHistory.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';

function attempt(overall: number, atMs = 0): PracticeAttempt {
  return { atMs, overall, grade: 'B', completed: true };
}

describe('every reading there has been', () => {
  it('flattens the passages into one list, newest first', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:A bars:1-4', attempt(0.5, 1_000));
    history.record('score:B', attempt(0.9, 3_000));
    history.record('score:A bars:1-4', attempt(0.7, 2_000));

    expect(history.lastReadings().map((reading) => reading.atMs)).toEqual([3_000, 2_000, 1_000]);
    expect(history.lastReadings()[0]?.key).toBe('score:B');
  });

  it('keeps only what was asked for', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    for (let at = 0; at < 30; at += 1) {
      history.record('score:A', attempt(0.5, at));
    }

    expect(history.lastReadings(5)).toHaveLength(5);
    expect(history.lastReadings(5)[0]?.atMs).toBe(29);
  });

  it('lets only finished readings into the best', () => {
    // A run stopped after four notes of a hard passage can score anything at
    // all, and a table of bests it could win would be a table of who stopped
    // soonest.
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:A', { atMs: 1, overall: 1, grade: 'A', completed: false });
    history.record('score:B', { atMs: 2, overall: 0.8, grade: 'B', completed: true });

    expect(history.bestReadings().map((reading) => reading.key)).toEqual(['score:B']);
  });

  it('puts the best first, and the most recent of equals above the rest', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:A', { atMs: 1, overall: 0.9, grade: 'A', completed: true });
    history.record('score:B', { atMs: 2, overall: 0.9, grade: 'A', completed: true });
    history.record('score:C', { atMs: 3, overall: 0.95, grade: 'A', completed: true });

    expect(history.bestReadings().map((reading) => reading.key)).toEqual([
      'score:C',
      'score:B',
      'score:A',
    ]);
  });

  it('carries the speed and the hand it was played with', () => {
    // A score means nothing without them: eighty-two per cent of a passage
    // at seventy with one hand is a different afternoon's work.
    const store = new InMemorySettingsStore();
    const history = new PracticeHistory(store);
    history.record('score:A', {
      atMs: 1,
      overall: 0.8,
      grade: 'B',
      completed: true,
      tempoPercent: 70,
      hand: 2,
    });

    const next = new PracticeHistory(store);
    next.load();

    expect(next.lastReadings()[0]?.tempoPercent).toBe(70);
    expect(next.lastReadings()[0]?.hand).toBe(2);
  });
});

describe('filing what is known under another name', () => {
  it('moves what the naming moves and leaves the rest', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('one', attempt(0.8));
    history.record('two', attempt(0.5));

    history.rekey((key) => (key === 'one' ? 'moved' : key));

    expect(history.summary('moved')?.last).toBeCloseTo(0.8);
    expect(history.summary('one')).toBeNull();
    expect(history.summary('two')?.last).toBeCloseTo(0.5);
  });

  it('keeps it across a visit', () => {
    const store = new InMemorySettingsStore();
    const first = new PracticeHistory(store);
    first.record('one', attempt(0.8));
    first.rekey((key) => (key === 'one' ? 'moved' : key));

    const next = new PracticeHistory(store);
    next.load();

    expect(next.summary('moved')?.last).toBeCloseTo(0.8);
  });
});

describe('what has been practised before', () => {
  it('answers "again?" and "better?"', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('bars:1-4', attempt(0.6, 1));
    history.record('bars:1-4', attempt(0.9, 2));
    history.record('bars:1-4', attempt(0.8, 3));

    expect(history.summary('bars:1-4')).toEqual({
      attempts: 3,
      best: 0.9,
      last: 0.8,
      previous: 0.9,
    });
  });

  it('says nothing about a passage never played', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    expect(history.summary('bars:1-4')).toBeNull();
  });

  it('survives the visit that recorded it', () => {
    const store = new InMemorySettingsStore();
    const first = new PracticeHistory(store);
    first.record('level:one', attempt(0.75, 10));

    // A different instance reading the same store is the next visit.
    const next = new PracticeHistory(store);
    next.load();
    expect(next.summary('level:one')?.last).toBe(0.75);
  });

  it('keeps passages apart', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('bars:1-4', attempt(0.4));
    history.record('bars:5-8', attempt(0.9));

    expect(history.summary('bars:1-4')?.best).toBe(0.4);
    expect(history.summary('bars:5-8')?.best).toBe(0.9);
  });

  it('remembers a bounded number of readings', () => {
    const history = new PracticeHistory(new InMemorySettingsStore(), 3);
    for (let index = 0; index < 10; index += 1) {
      history.record('bars:1-4', attempt(index / 10, index));
    }
    const summary = history.summary('bars:1-4');

    expect(summary?.attempts).toBe(3);
    // The best of what is still remembered, which is honest about its window.
    expect(summary?.best).toBeCloseTo(0.9, 10);
  });

  it('ignores anything stored that no longer parses', () => {
    // A hand-edited value or an older format costs the passage, not the app.
    const store = new InMemorySettingsStore();
    store.write({ version: 1, passages: { 'bars:1-4': ['nonsense', { overall: 'x' }] } });
    const history = new PracticeHistory(store);
    history.load();

    expect(history.summary('bars:1-4')).toBeNull();
    expect(() => history.record('bars:1-4', attempt(0.5))).not.toThrow();
  });

  it('forgets everything when asked', () => {
    const store = new InMemorySettingsStore();
    const history = new PracticeHistory(store);
    history.record('bars:1-4', attempt(0.5));

    history.forget();

    expect(history.summary('bars:1-4')).toBeNull();
    expect(store.read()).toBeNull();
  });
});

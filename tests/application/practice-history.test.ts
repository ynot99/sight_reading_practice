import { describe, expect, it } from 'vitest';
import { PracticeHistory, type PracticeAttempt } from '../../src/application/PracticeHistory.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';

function attempt(overall: number, atMs = 0): PracticeAttempt {
  return { atMs, overall, grade: 'B', completed: true };
}

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

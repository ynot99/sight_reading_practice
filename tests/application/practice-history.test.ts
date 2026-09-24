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

/** A picture of the given weight, for filling a budget with something real-shaped. */
function picture(marks: number): NonNullable<PracticeAttempt['picture']> {
  return {
    bars: 'c'.repeat(20),
    waitedAtBars: [],
    axes: [],
    deviationsMs: Array.from({ length: marks }, (_unused, at) => at),
    pressesJudged: marks,
    toleranceMs: 120,
    totals: {
      steps: marks,
      playableSteps: marks,
      correct: marks,
      incorrect: 0,
      missed: 0,
      skipped: 0,
      expectedNotes: marks,
      correctNotes: marks,
      wrongNotes: 0,
      barsWaitedFor: 0,
    },
    meanDeviationMs: 0,
    meanAbsoluteDeviationMs: 0,
    deviationSpreadMs: 0,
    stoppedAtBar: null,
  };
}

function roll(presses: number): NonNullable<PracticeAttempt['roll']> {
  return {
    presses: Array.from({ length: presses }, (_unused, at) => ({
      midi: 60,
      downAtMs: at,
      upAtMs: at + 1,
      velocity: 0.5,
      verdict: null,
      stepIndex: null,
      deviationMs: null,
    })),
    beats: [],
    pedal: [],
    rushes: [],
    truncated: false,
  };
}

/** A reading with everything on it, as one recorded by a run has. */
function rich(overall: number, atMs: number, marks = 40): PracticeAttempt {
  return { ...attempt(overall, atMs), picture: picture(marks), roll: roll(marks) };
}

describe('keeping the history inside the store', () => {
  it('gives up the oldest reading’s roll first, then its picture, then the reading', () => {
    // The browser's store answers a write it has no room for by refusing it,
    // and the refusal is swallowed - so a history that grew until it was
    // refused would stop being written with nothing said anywhere.
    const store = new InMemorySettingsStore();
    const history = new PracticeHistory(store, 50, JSON.stringify(rich(0.5, 0)).length * 2 + 200);

    history.record('score:A', rich(0.5, 1_000));
    history.record('score:A', rich(0.6, 2_000));
    history.record('score:A', rich(0.7, 3_000));
    history.record('score:A', rich(0.8, 4_000));

    const kept = history.lastReadings(10, 'score:A');
    expect(kept.map((reading) => reading.atMs)).toEqual([4_000, 3_000, 2_000, 1_000]);
    // The newest keeps everything; what is behind it gives things up in turn.
    expect(kept[0]?.roll).not.toBeUndefined();
    expect(kept[0]?.picture).not.toBeUndefined();
    expect(kept.at(-1)?.roll).toBeUndefined();
    expect(kept.at(-1)?.picture).toBeUndefined();
    expect(JSON.stringify(store.read()).length).toBeLessThan(
      JSON.stringify(rich(0.5, 0)).length * 4,
    );
  });

  it('drops the oldest readings themselves once even their numbers do not fit', () => {
    const history = new PracticeHistory(new InMemorySettingsStore(), 50, 150);

    for (let at = 1; at <= 6; at += 1) {
      history.record('score:A', attempt(0.5, at * 1_000));
    }

    const kept = history.lastReadings(10);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(6);
    // Newest first, so what is dropped is the oldest.
    expect(kept[0]?.atMs).toBe(6_000);
  });

  it('keeps what it was given where there is room for all of it', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());

    history.record('score:A', rich(0.5, 1_000));
    history.record('score:A', rich(0.6, 2_000));

    expect(history.lastReadings(10).every((reading) => reading.roll !== undefined)).toBe(true);
  });

  it('reads a kept picture and roll back, and refuses nonsense in their place', () => {
    const store = new InMemorySettingsStore();
    const history = new PracticeHistory(store);
    history.record('score:A', rich(0.5, 1_000));
    const written = JSON.parse(JSON.stringify(store.read())) as {
      passages: Record<string, Record<string, unknown>[]>;
    };
    const read = new PracticeHistory(store);
    read.load();
    expect(read.lastReadings()[0]?.picture?.bars).toBe('c'.repeat(20));
    expect(read.lastReadings()[0]?.roll?.presses).toHaveLength(40);

    for (const written1 of written.passages['score:A'] ?? []) {
      written1['picture'] = 'not a picture';
      written1['roll'] = { presses: 'not a list' };
    }
    store.write(written);
    const after = new PracticeHistory(store);
    after.load();

    expect(after.lastReadings()[0]?.overall).toBe(0.5);
    expect(after.lastReadings()[0]?.picture).toBeUndefined();
    expect(after.lastReadings()[0]?.roll).toBeUndefined();
  });
});

describe('what a reading says it was played with', () => {
  it('keeps the frame and the squares, and gives them back', () => {
    const store = new InMemorySettingsStore();
    const history = new PracticeHistory(store);
    history.record('score:A', {
      ...attempt(0.8, 1_000),
      modeId: 'mode.wait',
      modes: ['survival', 'blind'],
    });

    const read = new PracticeHistory(store);
    read.load();

    const kept = read.lastReadings()[0];
    expect(kept?.modeId).toBe('mode.wait');
    expect(kept?.modes).toEqual(['survival', 'blind']);
  });

  it('says nothing where the store holds nonsense in their place', () => {
    const store = new InMemorySettingsStore();
    store.write({
      version: 1,
      passages: {
        'score:A': [
          { atMs: 1, overall: 0.5, grade: 'B', completed: true, modeId: 7, modes: 'wait' },
        ],
      },
    });
    const history = new PracticeHistory(store);
    history.load();

    expect(history.lastReadings()[0]?.modeId).toBeUndefined();
    expect(history.lastReadings()[0]?.modes).toBeUndefined();
  });
});

describe('the readings of one piece', () => {
  it('narrows both lists to it, passages of it included', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:A', attempt(0.5, 1_000));
    history.record('score:A bars:4-8', attempt(0.9, 2_000));
    history.record('score:B', attempt(0.7, 3_000));

    expect(history.lastReadings(10, 'score:A').map((reading) => reading.atMs)).toEqual([
      2_000, 1_000,
    ]);
    expect(history.bestReadings(10, 'score:A').map((reading) => reading.overall)).toEqual([
      0.9, 0.5,
    ]);
  });

  it('shows one reading a piece in the best of everything, and every exercise', () => {
    // An afternoon on one piece otherwise fills the table with itself, and the
    // rest of the library is not there to compare it with. A ladder step is
    // not a piece: every reading of `level:1a` was a different melody.
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:A', attempt(0.5, 1_000));
    history.record('score:A bars:1-4', attempt(0.8, 2_000));
    history.record('level:1a', attempt(0.6, 3_000));
    history.record('level:1a', attempt(0.7, 4_000));

    expect(history.bestReadings(10).map((reading) => reading.overall)).toEqual([0.8, 0.7, 0.6]);
  });

  it('still lets only finished readings into the best of one piece', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:A', { ...attempt(0.9, 1_000), completed: false });
    history.record('score:A', attempt(0.4, 2_000));

    expect(history.bestReadings(10, 'score:A').map((reading) => reading.overall)).toEqual([0.4]);
  });
});

describe('taking one reading out', () => {
  it('removes the one played at that moment, and says it did', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:A', attempt(0.5, 1_000));
    history.record('score:A', attempt(0.6, 2_000));

    expect(history.remove('score:A', 2_000)).toBe(true);
    expect(history.lastReadings().map((reading) => reading.atMs)).toEqual([1_000]);
  });

  it('says so where there is no such reading, and leaves the rest alone', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:A', attempt(0.5, 1_000));

    expect(history.remove('score:A', 9_999)).toBe(false);
    expect(history.remove('score:B', 1_000)).toBe(false);
    expect(history.lastReadings()).toHaveLength(1);
  });

  it('forgets the passage entirely when its last reading goes', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:A bars:1-4', attempt(0.5, 1_000));

    history.remove('score:A bars:1-4', 1_000);

    expect(history.summary('score:A bars:1-4')).toBeNull();
  });
});

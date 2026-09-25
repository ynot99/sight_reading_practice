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

  it('puts a stopped reading below every finished one, whatever it scored', () => {
    // A run stopped after four notes of a hard passage can score anything at
    // all, and a table of bests it could win would be a table of who stopped
    // soonest. Left out, though, a piece never played to the end was missing.
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:A', { atMs: 1, overall: 1, grade: 'A', completed: false });
    history.record('score:B', { atMs: 2, overall: 0.8, grade: 'B', completed: true });
    history.record('score:C', { atMs: 3, overall: 0.3, grade: 'F', completed: true });

    expect(history.bestReadings().map((reading) => reading.key)).toEqual([
      'score:B',
      'score:C',
      'score:A',
    ]);
  });

  it('puts it below the finished ones however hard its piece is', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:Hard', { atMs: 1, overall: 0.9, grade: 'A', completed: false });
    history.record('score:Easy', { atMs: 2, overall: 0.5, grade: 'D', completed: true });

    const ranked = history.bestReadings(10, undefined, (key) => (key === 'score:Hard' ? 9 : 1));

    expect(ranked.map((reading) => reading.key)).toEqual(['score:Easy', 'score:Hard']);
  });

  it('ranks stopped readings among themselves as it ranks the finished', () => {
    // Hardest first and then by score, below the line where finishing ends.
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:Easy', { atMs: 1, overall: 0.9, grade: 'A', completed: false });
    history.record('score:Hard', { atMs: 2, overall: 0.2, grade: 'F', completed: false });

    const ranked = history.bestReadings(10, undefined, (key) => (key === 'score:Hard' ? 9 : 1));

    expect(ranked.map((reading) => reading.key)).toEqual(['score:Hard', 'score:Easy']);
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

  it('ranks the hardest piece first, whatever it scored', () => {
    // His: "Та сортувати по складності". Among pieces as hard as each other,
    // the better reading first - played earlier, so it is the score and not
    // the time that puts it there.
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:Easy', { atMs: 1, overall: 0.95, grade: 'A', completed: true });
    history.record('score:Also hard', { atMs: 2, overall: 0.8, grade: 'B', completed: true });
    history.record('score:Hard', { atMs: 3, overall: 0.6, grade: 'C', completed: true });
    const stars: Readonly<Record<string, number>> = {
      'score:Easy': 3,
      'score:Hard': 7,
      'score:Also hard': 7,
    };

    const ranked = history.bestReadings(10, undefined, (key) => stars[key] ?? null);

    expect(ranked.map((reading) => reading.key)).toEqual([
      'score:Also hard',
      'score:Hard',
      'score:Easy',
    ]);
  });

  it('puts what nobody has rated after what has been, by score', () => {
    // An unrated piece says nothing either way about how hard it is, and an
    // exercise has no stars at all.
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:Rated', { atMs: 1, overall: 0.5, grade: 'D', completed: true });
    history.record('score:Unrated', { atMs: 2, overall: 0.99, grade: 'A', completed: true });
    history.record('level:1a', { atMs: 3, overall: 0.7, grade: 'B', completed: true });

    const ranked = history.bestReadings(10, undefined, (key) => (key === 'score:Rated' ? 2 : null));

    expect(ranked.map((reading) => reading.key)).toEqual([
      'score:Rated',
      'score:Unrated',
      'level:1a',
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
    tiersOfMarks: 'pg',
    perfectMs: 45,
    totals: {
      steps: marks,
      playableSteps: marks,
      correct: marks,
      incorrect: 0,
      missed: 0,
      skipped: 0,
      expectedNotes: marks,
      correctNotes: marks,
      perfectNotes: marks,
      goodNotes: 0,
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

describe('the best readings of a passage, kept whatever comes after them', () => {
  /** A reading stopped partway, having played this many notes right. */
  function stopped(atMs: number, played: number, overall = 0.5, stoppedAtBar = 5): PracticeAttempt {
    return {
      atMs,
      overall,
      grade: 'C',
      completed: false,
      stoppedAtBar,
      notes: { perfect: played, good: 0, missed: 0, wrong: 0 },
    };
  }

  const kept = (history: PracticeHistory): number[] =>
    history
      .lastReadings(100, 'score:A')
      .map((reading) => reading.atMs)
      .sort((left, right) => left - right);

  it('keeps the best played to the end, beyond the newest it keeps', () => {
    const history = new PracticeHistory(new InMemorySettingsStore(), 3);
    history.record('score:A', attempt(0.95, 1));
    for (let at = 2; at <= 8; at += 1) {
      history.record('score:A', attempt(0.6, at));
    }

    expect(kept(history)).toEqual([1, 6, 7, 8]);
  });

  it('keeps the best of those stopped as well, by the notes they got right', () => {
    // Fifteen bars of twenty played cleanly are not undone by a whole run
    // played badly the day after.
    const history = new PracticeHistory(new InMemorySettingsStore(), 3);
    history.record('score:A', stopped(1, 40, 0.3));
    history.record('score:A', stopped(2, 10, 0.9));
    for (let at = 3; at <= 8; at += 1) {
      history.record('score:A', attempt(0.95 - at / 100, at));
    }

    // The first finished one is the best of those, and the first stopped
    // one - fewer points, more notes - the best of the others.
    expect(kept(history)).toEqual([1, 3, 6, 7, 8]);
  });

  it('asks how far a reading got where it counted no notes', () => {
    // Readings kept before notes were counted.
    const history = new PracticeHistory(new InMemorySettingsStore(), 2);
    const old = (atMs: number, stoppedAtBar: number, overall: number): PracticeAttempt => ({
      atMs,
      overall,
      grade: 'C',
      completed: false,
      stoppedAtBar,
    });
    history.record('score:A', old(1, 30, 0.2));
    history.record('score:A', old(2, 5, 0.9));
    history.record('score:A', old(3, 5, 0.8));
    history.record('score:A', old(4, 6, 0.1));

    expect(kept(history)).toEqual([1, 3, 4]);
  });

  it('counts the Good notes a stopped reading played as well as the Perfect ones', () => {
    const history = new PracticeHistory(new InMemorySettingsStore(), 1);
    const played = (atMs: number, perfect: number, good: number): PracticeAttempt => ({
      ...stopped(atMs, perfect),
      notes: { perfect, good, missed: 0, wrong: 0 },
    });
    history.record('score:A', played(1, 10, 30));
    history.record('score:A', played(2, 20, 0));
    history.record('score:A', attempt(0.5, 3));

    expect(kept(history)).toEqual([1, 3]);
  });

  it('breaks a tie in notes between two stopped readings by the grade', () => {
    const history = new PracticeHistory(new InMemorySettingsStore(), 1);
    history.record('score:A', stopped(1, 20, 0.4));
    history.record('score:A', stopped(2, 20, 0.6));
    history.record('score:A', stopped(3, 20, 0.5));
    history.record('score:A', attempt(0.5, 4));

    expect(kept(history)).toEqual([2, 4]);
  });

  it('keeps the newer of two as good as each other', () => {
    const history = new PracticeHistory(new InMemorySettingsStore(), 1);
    history.record('score:A', attempt(0.8, 1));
    history.record('score:A', attempt(0.8, 2));
    history.record('score:A', stopped(3, 20, 0.6));
    history.record('score:A', stopped(4, 20, 0.6));
    history.record('score:A', attempt(0.5, 5));

    expect(kept(history)).toEqual([2, 4, 5]);
  });

  it('still has the best reading after a visit', () => {
    // Kept beyond the newest, so it is written first - and reading the
    // store back must not take the newest of it and lose the best.
    const store = new InMemorySettingsStore();
    const history = new PracticeHistory(store, 3);
    history.record('score:A', attempt(0.95, 1));
    for (let at = 2; at <= 8; at += 1) {
      history.record('score:A', attempt(0.6, at));
    }

    const next = new PracticeHistory(store, 3);
    next.load();

    expect(kept(next)).toEqual([1, 6, 7, 8]);
  });

  it('keeps a passage practised long ago down to its best, rather than forgetting it', () => {
    // Every passage chosen is a passage of its own, so two hundred of them
    // come round in a few weeks of practice.
    const history = new PracticeHistory(new InMemorySettingsStore(), 50);
    history.record('score:A', attempt(0.95, 1));
    history.record('score:A', attempt(0.5, 2));
    for (let at = 0; at < 200; at += 1) {
      history.record(`score:B bars:${String(at)}-${String(at + 1)}`, attempt(0.5, 10 + at));
    }

    expect(kept(history)).toEqual([1]);
    // The two hundred practised since keep all they had.
    expect(history.summary('score:B bars:0-1')?.attempts).toBe(1);
  });

  it('keeps the best reading when the store has room only for newer ones, as its numbers', () => {
    // Room for the newest whole and little else: the readings between give
    // up everything and then themselves, and the best only its detail.
    const store = new InMemorySettingsStore();
    const budget = JSON.stringify(rich(0.5, 0)).length + 300;
    const history = new PracticeHistory(store, 50, budget);
    history.record('score:A', rich(0.99, 1));
    for (let at = 2; at <= 8; at += 1) {
      history.record('score:A', rich(0.5, at));
    }

    const readings = history.lastReadings(100, 'score:A');
    const best = readings.find((reading) => reading.atMs === 1);
    expect(readings.length).toBeLessThan(8);
    expect(best?.overall).toBe(0.99);
    expect(best?.roll).toBeUndefined();
    expect(best?.picture).toBeUndefined();
    // Kept inside the budget all the same: its room was set aside, not added.
    const written = store.read() as { passages: Record<string, unknown[]> };
    const used = Object.values(written.passages)
      .flat()
      .reduce<number>((sum, reading) => sum + JSON.stringify(reading).length, 0);
    expect(used).toBeLessThanOrEqual(budget);
  });
});

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
    expect(read.lastReadings()[0]?.picture?.tiersOfMarks).toBe('pg');
    expect(read.lastReadings()[0]?.picture?.perfectMs).toBe(45);
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

describe('the notes a reading keeps count of', () => {
  it('keeps them, and reads them back', () => {
    const store = new InMemorySettingsStore();
    const history = new PracticeHistory(store);
    history.record('score:A', {
      atMs: 1,
      overall: 0.8,
      grade: 'B',
      completed: true,
      notes: { perfect: 312, good: 40, missed: 5, wrong: 3 },
    });

    const read = new PracticeHistory(store);
    read.load();

    expect(read.lastReadings()[0]?.notes).toEqual({ perfect: 312, good: 40, missed: 5, wrong: 3 });
  });

  it('keeps nothing where one of the four is not a count', () => {
    const store = new InMemorySettingsStore();
    const history = new PracticeHistory(store);
    history.record('score:A', { atMs: 1, overall: 0.8, grade: 'B', completed: true });
    const written = JSON.parse(JSON.stringify(store.read())) as {
      passages: Record<string, Record<string, unknown>[]>;
    };
    const [kept] = written.passages['score:A'] ?? [];

    for (const nonsense of [
      { perfect: 1, good: 2, missed: 3 },
      { perfect: 1, good: 2, missed: 3, wrong: -1 },
      { perfect: 1.5, good: 2, missed: 3, wrong: 0 },
      { perfect: '1', good: 2, missed: 3, wrong: 0 },
    ]) {
      if (kept !== undefined) {
        kept['notes'] = nonsense;
      }
      store.write(written);
      const read = new PracticeHistory(store);
      read.load();

      expect(read.lastReadings()[0]?.overall).toBe(0.8);
      expect(read.lastReadings()[0]?.notes).toBeUndefined();
    }
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

  it('lists the stopped readings of one piece below its finished ones', () => {
    // His: with only this piece asked for, and none of its readings finished,
    // the best of it was an empty list.
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:A', { ...attempt(0.9, 1_000), completed: false });
    history.record('score:A', attempt(0.4, 2_000));
    history.record('score:A', { ...attempt(0.95, 3_000), completed: false });

    expect(history.bestReadings(10, 'score:A').map((reading) => reading.overall)).toEqual([
      0.4, 0.95, 0.9,
    ]);
  });

  it('stands a piece in the best of everything by a finished reading where it has one', () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    history.record('score:A', { ...attempt(0.9, 1_000), completed: false });
    history.record('score:A', attempt(0.4, 2_000));
    history.record('score:B', { ...attempt(0.3, 3_000), completed: false });
    history.record('score:B', { ...attempt(0.6, 4_000), completed: false });

    // A by the reading that finished, not the better one that did not; B,
    // never finished, by the best of its stopped ones.
    expect(history.bestReadings(10).map((reading) => [reading.key, reading.overall])).toEqual([
      ['score:A', 0.4],
      ['score:B', 0.6],
    ]);
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

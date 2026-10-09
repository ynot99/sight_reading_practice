import { describe, expect, it } from 'vitest';
import { DrillProgress } from '../../src/application/drill/DrillProgress.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';

describe('where each piece’s section plan has got to', () => {
  it('keeps a piece’s place for the next visit, and forgets it when asked', () => {
    const store = new InMemorySettingsStore();
    const progress = new DrillProgress(store);
    progress.load();

    progress.keep('score:Berceuse', { sectionBars: 4, at: 5, finishedAtMs: null });
    const next = new DrillProgress(store);
    next.load();

    expect(next.of('score:Berceuse')).toEqual({ sectionBars: 4, at: 5, finishedAtMs: null });
    expect(next.of('score:Canon')).toBeNull();

    next.forget('score:Berceuse');
    const after = new DrillProgress(store);
    after.load();
    expect(after.of('score:Berceuse')).toBeNull();
  });

  it('carries a piece’s place over to the name it is given', () => {
    const progress = new DrillProgress(new InMemorySettingsStore());
    progress.keep('score:Old', { sectionBars: 2, at: 1, finishedAtMs: 7 });

    progress.rename('score:Old', 'score:New');

    expect(progress.of('score:Old')).toBeNull();
    expect(progress.of('score:New')).toEqual({ sectionBars: 2, at: 1, finishedAtMs: 7 });
  });

  it('reads past what no longer parses rather than trusting it', () => {
    const store = new InMemorySettingsStore();
    store.write({
      version: 1,
      pieces: {
        'score:Good': { sectionBars: 4, at: 2, finishedAtMs: 'yesterday' },
        'score:No sections': { sectionBars: 0, at: 2 },
        'score:Half a step': { sectionBars: 4, at: 1.5 },
        'score:Behind': { sectionBars: 4, at: -1 },
        'score:Nothing': 'step two',
      },
    });
    const progress = new DrillProgress(store);

    progress.load();

    expect(progress.of('score:Good')).toEqual({ sectionBars: 4, at: 2, finishedAtMs: null });
    expect(progress.of('score:No sections')).toBeNull();
    expect(progress.of('score:Half a step')).toBeNull();
    expect(progress.of('score:Behind')).toBeNull();
    expect(progress.of('score:Nothing')).toBeNull();
  });
});

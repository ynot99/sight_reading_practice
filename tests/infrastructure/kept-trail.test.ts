import { describe, expect, it } from 'vitest';
import { KeptTrail, TRAIL_STORAGE_KEY } from '../../src/infrastructure/storage/KeptTrail.js';

/** The browser's small store, as far as the trail uses it. */
function store(): { items: Map<string, string>; getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

describe('the timings kept for the next visit', () => {
  it('reads back the lines it kept', () => {
    const shelf = store();
    new KeptTrail(shelf).keep(['score asked for', 'engraver: file read']);

    expect(new KeptTrail(shelf).lastKept()).toEqual(['score asked for', 'engraver: file read']);
  });

  it('has nothing where nothing was kept, or what was kept is not lines', () => {
    const shelf = store();
    expect(new KeptTrail(shelf).lastKept()).toEqual([]);

    shelf.setItem(TRAIL_STORAGE_KEY, '{ not a list');
    expect(new KeptTrail(shelf).lastKept()).toEqual([]);

    shelf.setItem(TRAIL_STORAGE_KEY, JSON.stringify(['kept', 3, null]));
    expect(new KeptTrail(shelf).lastKept()).toEqual(['kept']);
  });

  it('never throws, where there is no store or it is full', () => {
    // It is there to find out what went wrong, and must not be another thing
    // that does.
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('the quota has been exceeded');
      },
      removeItem: () => undefined,
    };

    expect(() => new KeptTrail(full).keep(['a line'])).not.toThrow();
    expect(() => new KeptTrail(null).keep(['a line'])).not.toThrow();
    expect(new KeptTrail(null).lastKept()).toEqual([]);
  });
});

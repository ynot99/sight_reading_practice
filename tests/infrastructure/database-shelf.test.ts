import { describe, expect, it } from 'vitest';
import { openShelf, type ShelfDatabase } from '../../src/infrastructure/storage/DatabaseShelf.js';
import type { StorageLike } from '../../src/infrastructure/storage/LocalStorageSettingsStore.js';

const KEY = 'app/takes';

/** The small store, as a map. */
function smallStore(entries: Record<string, string> = {}): StorageLike & {
  readonly entries: Map<string, string>;
} {
  const held = new Map(Object.entries(entries));
  return {
    entries: held,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => {
      held.set(key, value);
    },
    removeItem: (key) => {
      held.delete(key);
    },
  };
}

/** The database, as a map, with a switch to make it refuse. */
function database(entries: Record<string, unknown> = {}): ShelfDatabase & {
  readonly entries: Map<string, unknown>;
  refusing: boolean;
} {
  const held = new Map(Object.entries(entries));
  const store = {
    entries: held,
    refusing: false,
    get: (key: string) =>
      store.refusing ? Promise.reject(new Error('no')) : Promise.resolve(held.get(key)),
    put: (key: string, value: unknown) => {
      if (store.refusing) {
        return Promise.reject(new Error('no'));
      }
      held.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      held.delete(key);
      return Promise.resolve();
    },
  };
  return store;
}

/** Lets the writes the shelf sent on their way arrive. */
async function settled(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('a shelf moved out of the small store', () => {
  it('moves what the small store holds into the database, and empties it there', async () => {
    // The small store holds about five megabytes for the whole site, and the
    // takes shared it with the settings: a full one refuses every write, the
    // settings' included, without a word.
    const small = smallStore({ [KEY]: JSON.stringify({ takes: [1, 2, 3] }) });
    const kept = database();

    const shelf = await openShelf(kept, small, KEY);

    expect(shelf.read()).toEqual({ takes: [1, 2, 3] });
    expect(kept.entries.get(KEY)).toEqual({ takes: [1, 2, 3] });
    expect(small.entries.has(KEY)).toBe(false);
  });

  it('leaves it where it is when the database will not take it', async () => {
    // Taken out of the small store only once the database has it: the other
    // order could lose it.
    const small = smallStore({ [KEY]: JSON.stringify({ takes: [1] }) });
    const kept = database();
    kept.refusing = true;

    const shelf = await openShelf(kept, small, KEY);

    expect(shelf.read()).toEqual({ takes: [1] });
    expect(small.entries.has(KEY)).toBe(true);
  });

  it('reads a shelf already moved from the database', async () => {
    const shelf = await openShelf(database({ [KEY]: { takes: [7] } }), smallStore(), KEY);

    expect(shelf.read()).toEqual({ takes: [7] });
  });

  it('takes the small store as the newest word when both hold the shelf', async () => {
    // A visit that could not open the database wrote to the small store, so
    // what is there came after what the database holds.
    const small = smallStore({ [KEY]: JSON.stringify({ takes: ['newer'] }) });
    const kept = database({ [KEY]: { takes: ['older'] } });

    const shelf = await openShelf(kept, small, KEY);

    expect(shelf.read()).toEqual({ takes: ['newer'] });
    expect(kept.entries.get(KEY)).toEqual({ takes: ['newer'] });
  });

  it('answers at once from what it holds, and sends every change to the database', async () => {
    const kept = database();
    const shelf = await openShelf(kept, smallStore(), KEY);

    shelf.write({ takes: [1] });
    expect(shelf.read()).toEqual({ takes: [1] });
    await settled();
    expect(kept.entries.get(KEY)).toEqual({ takes: [1] });

    shelf.clear();
    expect(shelf.read()).toBeNull();
    await settled();
    expect(kept.entries.has(KEY)).toBe(false);
  });

  it('stays in the small store where there is no database', async () => {
    const small = smallStore({ [KEY]: JSON.stringify({ takes: [1] }) });

    const shelf = await openShelf(null, small, KEY);
    shelf.write({ takes: [2] });

    expect(JSON.parse(small.entries.get(KEY) ?? 'null')).toEqual({ takes: [2] });
  });
});

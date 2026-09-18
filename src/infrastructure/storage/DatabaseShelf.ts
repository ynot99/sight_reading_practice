import type { ISettingsStore } from '../../application/ports/ISettingsStore.js';
import { request, type IndexedDbFactory } from './IndexedDbScoreStore.js';
import { LocalStorageSettingsStore, type StorageLike } from './LocalStorageSettingsStore.js';

/**
 * A database of its own rather than a second store in the scores' one: adding
 * a store means upgrading the database, and an upgrade of the one that holds
 * the library is a risk with nothing to gain.
 */
const DATABASE = 'sight-reading-practice-shelves';
const VERSION = 1;
const STORE = 'shelves';

/** As much of a database as a shelf needs: a value under a key. */
export interface ShelfDatabase {
  /** What is kept under `key`, or `undefined` when nothing is. */
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The browser's database, or `null` where it cannot be opened. */
export function openShelfDatabase(factory: IndexedDbFactory | null): Promise<ShelfDatabase | null> {
  if (factory === null) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const opening = factory.open(DATABASE, VERSION);
      opening.onupgradeneeded = () => {
        if (!opening.result.objectStoreNames.contains(STORE)) {
          opening.result.createObjectStore(STORE);
        }
      };
      opening.onsuccess = () => resolve(new IndexedDbShelves(opening.result));
      opening.onerror = () => resolve(null);
      opening.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

class IndexedDbShelves implements ShelfDatabase {
  private readonly database: IDBDatabase;

  constructor(database: IDBDatabase) {
    this.database = database;
  }

  get(key: string): Promise<unknown> {
    return request(this.database.transaction(STORE, 'readonly').objectStore(STORE).get(key));
  }

  async put(key: string, value: unknown): Promise<void> {
    await request(this.database.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key));
  }

  async delete(key: string): Promise<void> {
    await request(this.database.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
  }
}

/**
 * One shelf, kept in the database rather than the small store.
 *
 * The small store - `localStorage` - holds about five megabytes for the whole
 * site, and the takes shared it with the readings and the settings: a hundred
 * takes of a long piece fill it, and a full small store refuses every write,
 * the settings' included, without a word. The database is sized for
 * documents.
 *
 * Read from memory and written through, so that what used the small store
 * goes on reading and writing it the same way: the database is asked once, on
 * opening, and every change is sent to it as it happens. Best effort, like
 * the store it replaces: a write the database refuses must not break the
 * application.
 */
class DatabaseShelf implements ISettingsStore {
  private readonly database: ShelfDatabase;
  private readonly key: string;
  private value: unknown;

  constructor(database: ShelfDatabase, key: string, value: unknown) {
    this.database = database;
    this.key = key;
    this.value = value;
  }

  read(): unknown {
    return this.value;
  }

  write(value: unknown): void {
    this.value = value;
    void this.database.put(this.key, value).catch(() => undefined);
  }

  clear(): void {
    this.value = null;
    void this.database.delete(this.key).catch(() => undefined);
  }
}

/**
 * Opens a shelf in the database, moving it out of the small store first.
 *
 * Whatever the small store still holds under the key is the newest word on it:
 * either it has never been moved, or a visit that could not open the database
 * wrote there instead. So it is moved even over what the database already
 * holds, and taken out of the small store only once the database has it -
 * never the other way round, which could lose it. Where there is no database,
 * or it will not take the shelf, the shelf stays where it was and is kept
 * there as it always was.
 */
export async function openShelf(
  database: ShelfDatabase | null,
  local: StorageLike | null,
  key: string,
): Promise<ISettingsStore> {
  const small = new LocalStorageSettingsStore(local, key);
  if (database === null) {
    return small;
  }
  const moving = small.read();
  if (moving !== null) {
    try {
      await database.put(key, moving);
    } catch {
      return small;
    }
    small.clear();
    return new DatabaseShelf(database, key, moving);
  }
  try {
    return new DatabaseShelf(database, key, (await database.get(key)) ?? null);
  } catch {
    return small;
  }
}

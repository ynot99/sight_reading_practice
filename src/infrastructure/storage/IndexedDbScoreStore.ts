import type {
  IScoreStore,
  StoredScore,
  StoredScoreSummary,
} from '../../application/ports/IScoreStore.js';

const DATABASE = 'sight-reading-practice';
const VERSION = 1;
const STORE = 'scores';

/** The slice of the global the store needs, so a test can hand it nothing. */
export type IndexedDbFactory = Pick<IDBFactory, 'open'>;

export function browserIndexedDb(): IndexedDbFactory | null {
  return typeof indexedDB === 'undefined' ? null : indexedDB;
}

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error ?? new Error('The score store refused.'));
  });
}

/**
 * Keeps scores in the browser's database.
 *
 * Not key-value storage: a hundred-bar piece serialises to a few hundred
 * kilobytes, and a handful of them would fill the few megabytes the settings
 * and the practice history already share. IndexedDB is the only store in a
 * browser sized for documents.
 *
 * Every failure is answered with an empty library rather than an exception.
 * A refused database - a private window, a browser with storage switched off,
 * a quota already spent - costs the reader their saved scores, and the file
 * on their disk is still there; it must not cost them the trainer.
 */
export class IndexedDbScoreStore implements IScoreStore {
  private readonly factory: IndexedDbFactory | null;
  private opened: Promise<IDBDatabase | null> | null = null;

  constructor(factory: IndexedDbFactory | null = browserIndexedDb()) {
    this.factory = factory;
  }

  async list(): Promise<readonly StoredScoreSummary[]> {
    const all = await this.withStore('readonly', (store) =>
      request<StoredScore[]>(store.getAll() as IDBRequest<StoredScore[]>),
    );
    // The document is left behind on purpose: a list of ten scores would
    // otherwise carry megabytes of MusicXML nobody is about to read.
    return (all ?? []).map(({ musicXml: _musicXml, ...summary }) => summary);
  }

  async read(id: string): Promise<StoredScore | null> {
    const found = await this.withStore('readonly', (store) =>
      request<StoredScore | undefined>(store.get(id) as IDBRequest<StoredScore | undefined>),
    );
    return found ?? null;
  }

  async write(score: StoredScore): Promise<void> {
    await this.withStore('readwrite', (store) => request(store.put(score)));
  }

  async remove(id: string): Promise<void> {
    await this.withStore('readwrite', (store) => request(store.delete(id)));
  }

  async clear(): Promise<void> {
    await this.withStore('readwrite', (store) => request(store.clear()));
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    use: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T | null> {
    const database = await this.database();
    if (database === null) {
      return null;
    }
    try {
      return await use(database.transaction(STORE, mode).objectStore(STORE));
    } catch {
      return null;
    }
  }

  private database(): Promise<IDBDatabase | null> {
    this.opened ??= this.openDatabase();
    return this.opened;
  }

  private openDatabase(): Promise<IDBDatabase | null> {
    const factory = this.factory;
    if (factory === null) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      try {
        const opening = factory.open(DATABASE, VERSION);
        opening.onupgradeneeded = () => {
          if (!opening.result.objectStoreNames.contains(STORE)) {
            opening.result.createObjectStore(STORE, { keyPath: 'id' });
          }
        };
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => resolve(null);
        opening.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
}

import type { IScoreStore } from '../../application/ports/IScoreStore.js';
import type { ISettingsStore } from '../../application/ports/ISettingsStore.js';
import type {
  IKeepsTheStore,
  IStorageGauge,
  StorageReading,
  StorageShelf,
  StoragePart,
  StoragePartKind,
} from '../../application/ports/IStorageGauge.js';

/** The corner of `navigator.storage` this needs, named so a test can stand in. */
export interface StorageManagerLike {
  estimate(): Promise<{
    readonly usage?: number;
    readonly quota?: number;
  }>;
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
}

/** The corner of `localStorage` this needs. */
export interface ReadableStorage {
  getItem(key: string): string | null;
}

/** A shelf of the small store, and the key it is kept under. */
export interface ShelfKey {
  readonly name: string;
  readonly key: string;
}

/** The corner of the Cache API this needs: where the offline copy of the app is kept. */
export interface CacheStorageLike {
  keys(): Promise<readonly string[]>;
  open(name: string): Promise<CacheLike>;
}

export interface CacheLike {
  keys(): Promise<readonly { readonly url: string }[]>;
  match(request: { readonly url: string }): Promise<{ blob(): Promise<{ readonly size: number }> } | undefined>;
}

/**
 * A part of what the site keeps that the program weighs for itself.
 *
 * Handed in rather than looked for, because only the composition knows
 * where each part lives and how many of it there are.
 */
export interface KeptPart {
  readonly kind: StoragePartKind;
  measure(): Promise<{ readonly bytes: number; readonly count: number | null }>;
}

/** What else the gauge weighs, beyond what the browser says. */
export interface WeighedAlso {
  readonly parts?: readonly KeptPart[];
  readonly caches?: CacheStorageLike | null;
  /**
   * Where in the offline copy the piano's recordings are, by the start of
   * their path: they are most of it, and a part of their own.
   */
  readonly soundUnder?: string;
}

/**
 * About how many bytes a kept value takes: its JSON, in UTF-8.
 *
 * About, because a database keeps a value in its own form and with its own
 * overhead - but in proportion to this, which is what a bar of parts needs.
 */
export function bytesOfKept(value: unknown): number {
  const written = JSON.stringify(value);
  return written === undefined ? 0 : new TextEncoder().encode(written).length;
}

/** The library, each score read and weighed: it keeps the whole document of every one. */
export function keptScores(store: IScoreStore): KeptPart {
  return {
    kind: 'scores',
    measure: async () => {
      const listed = await store.list();
      let bytes = 0;
      for (const summary of listed) {
        bytes += bytesOfKept(await store.read(summary.id));
      }
      return { bytes, count: listed.length };
    },
  };
}

/** Values kept whole in stores of their own: the readings, the takes, the settings. */
export function keptWhole(
  kind: StoragePartKind,
  stores: readonly ISettingsStore[],
  count: () => number | null,
): KeptPart {
  return {
    kind,
    measure: () =>
      Promise.resolve({
        bytes: stores.reduce((sum, store) => sum + bytesOfKept(store.read()), 0),
        count: count(),
      }),
  };
}

export function browserCaches(): CacheStorageLike | null {
  return (globalThis as { caches?: CacheStorageLike }).caches ?? null;
}

export function browserStorageManager(): StorageManagerLike | null {
  const manager = (globalThis.navigator as { storage?: StorageManagerLike } | undefined)?.storage;
  return manager ?? null;
}

/**
 * Reads the browser's own account of what this site keeps.
 *
 * Every answer the browser declines to give is `null` rather than nought: a
 * browser that will not say how much room there is has not said there is
 * none, and the page must not claim it has.
 */
export class BrowserStorageGauge implements IStorageGauge, IKeepsTheStore {
  private readonly manager: StorageManagerLike | null;
  private readonly local: ReadableStorage | null;
  private readonly shelfKeys: readonly ShelfKey[];
  private readonly parts: readonly KeptPart[];
  private readonly caches: CacheStorageLike | null;
  private readonly soundUnder: string;

  constructor(
    manager: StorageManagerLike | null,
    local: ReadableStorage | null,
    shelves: readonly ShelfKey[],
    also: WeighedAlso = {},
  ) {
    this.manager = manager;
    this.local = local;
    this.shelfKeys = shelves;
    this.parts = also.parts ?? [];
    this.caches = also.caches ?? null;
    this.soundUnder = also.soundUnder ?? 'samples/';
  }

  async read(): Promise<StorageReading> {
    const [estimate, persisted, ours, cached] = await Promise.all([
      this.estimate(),
      this.persisted(),
      this.ourOwn(),
      this.theOfflineCopy(),
    ]);
    return {
      usedBytes: numberOrNull(estimate?.usage),
      quotaBytes: numberOrNull(estimate?.quota),
      persisted,
      parts: [...ours, ...cached],
      shelves: this.shelves(),
    };
  }

  /** The parts handed in, each weighed; one that cannot be is left out rather than said to be nothing. */
  private async ourOwn(): Promise<StoragePart[]> {
    const weighed = await Promise.all(
      this.parts.map(async (part): Promise<StoragePart | null> => {
        try {
          const { bytes, count } = await part.measure();
          return { kind: part.kind, bytes, count };
        } catch {
          return null;
        }
      }),
    );
    return weighed.filter((part): part is StoragePart => part !== null);
  }

  /**
   * The offline copy, split into the piano's recordings and the app itself.
   *
   * Every file weighed by reading it back: the cache will not say how big
   * anything in it is. Asked for only when the reader opens the pane that
   * shows it, so the cost - a read of some tens of megabytes - is paid then.
   */
  private async theOfflineCopy(): Promise<StoragePart[]> {
    const caches = this.caches;
    if (caches === null) {
      return [];
    }
    try {
      let sound = 0;
      let app = 0;
      for (const name of await caches.keys()) {
        const shelf = await caches.open(name);
        for (const request of await shelf.keys()) {
          const kept = await shelf.match(request);
          const bytes = kept === undefined ? 0 : (await kept.blob()).size;
          if (new URL(request.url).pathname.includes(this.soundUnder)) {
            sound += bytes;
          } else {
            app += bytes;
          }
        }
      }
      return [
        { kind: 'sound', bytes: sound, count: null },
        { kind: 'app', bytes: app, count: null },
      ];
    } catch {
      return [];
    }
  }

  /**
   * Asks only where it has not been promised already. Chrome and Safari decide
   * without a word to the reader, by how much the site is used; Firefox asks
   * them once, and remembers the answer.
   */
  async askToKeep(): Promise<boolean | null> {
    try {
      if ((await this.manager?.persisted?.()) === true) {
        return true;
      }
      const asked = this.manager?.persist?.();
      return asked === undefined ? null : await asked;
    } catch {
      return null;
    }
  }

  private async estimate(): Promise<Awaited<ReturnType<StorageManagerLike['estimate']>> | null> {
    try {
      return (await this.manager?.estimate()) ?? null;
    } catch {
      return null;
    }
  }

  private async persisted(): Promise<boolean | null> {
    try {
      const asked = this.manager?.persisted?.();
      return asked === undefined ? null : await asked;
    } catch {
      return null;
    }
  }

  private shelves(): StorageShelf[] {
    return this.shelfKeys.map(({ name, key }) => {
      let held: string | null = null;
      try {
        held = this.local?.getItem(key) ?? null;
      } catch {
        // A store that refuses to be read holds nothing that can be counted.
      }
      return { name, characters: held === null ? 0 : key.length + held.length };
    });
  }
}

function numberOrNull(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

import type {
  IStorageGauge,
  StorageReading,
  StorageShelf,
} from '../../application/ports/IStorageGauge.js';

/** The corner of `navigator.storage` this needs, named so a test can stand in. */
export interface StorageManagerLike {
  estimate(): Promise<{
    readonly usage?: number;
    readonly quota?: number;
    /** Chromium only: the same total, broken out by where it is kept. */
    readonly usageDetails?: { readonly indexedDB?: number };
  }>;
  persisted?(): Promise<boolean>;
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
export class BrowserStorageGauge implements IStorageGauge {
  private readonly manager: StorageManagerLike | null;
  private readonly local: ReadableStorage | null;
  private readonly shelfKeys: readonly ShelfKey[];

  constructor(
    manager: StorageManagerLike | null,
    local: ReadableStorage | null,
    shelves: readonly ShelfKey[],
  ) {
    this.manager = manager;
    this.local = local;
    this.shelfKeys = shelves;
  }

  async read(): Promise<StorageReading> {
    const [estimate, persisted] = await Promise.all([this.estimate(), this.persisted()]);
    return {
      usedBytes: numberOrNull(estimate?.usage),
      quotaBytes: numberOrNull(estimate?.quota),
      databaseBytes: numberOrNull(estimate?.usageDetails?.indexedDB),
      persisted,
      shelves: this.shelves(),
    };
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

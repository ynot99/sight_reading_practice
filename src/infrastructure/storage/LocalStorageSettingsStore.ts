import type { ISettingsStore } from '../../application/ports/ISettingsStore.js';

/** The slice of `Storage` used here, so tests need no browser. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DEFAULT_STORAGE_KEY = 'sight-reading-practice/settings';

/**
 * Settings kept in the browser, on this device only.
 *
 * Every call is wrapped: Safari throws from `localStorage` in private
 * browsing, and a full quota throws on write. Losing the memory of a slider
 * position is a triviality - failing to start because of it would not be.
 */
export class LocalStorageSettingsStore implements ISettingsStore {
  private readonly storage: StorageLike | null;
  private readonly key: string;

  constructor(storage: StorageLike | null, key: string = DEFAULT_STORAGE_KEY) {
    this.storage = storage;
    this.key = key;
  }

  read(): unknown {
    if (this.storage === null) {
      return null;
    }
    try {
      const raw = this.storage.getItem(this.key);
      return raw === null ? null : (JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }

  write(value: unknown): void {
    if (this.storage === null) {
      return;
    }
    try {
      this.storage.setItem(this.key, JSON.stringify(value));
    } catch {
      // Private mode, or the quota is full. Nothing worth interrupting for.
    }
  }

  clear(): void {
    if (this.storage === null) {
      return;
    }
    try {
      this.storage.removeItem(this.key);
    } catch {
      // As above.
    }
  }
}

/** `localStorage` when the host allows it, `null` when merely touching it throws. */
export function browserStorage(): StorageLike | null {
  try {
    const candidate = globalThis.localStorage;
    if (candidate === undefined || candidate === null) {
      return null;
    }
    // Reading is enough to trigger the private-mode failure on older Safari.
    candidate.getItem(DEFAULT_STORAGE_KEY);
    return candidate;
  } catch {
    return null;
  }
}

import { describe, expect, it } from 'vitest';
import * as storage from '../../src/infrastructure/storage/LocalStorageSettingsStore.js';
import {
  DEFAULT_STORAGE_KEY,
  KEPT_STORAGE_KEYS,
  LocalStorageSettingsStore,
  type StorageLike,
} from '../../src/infrastructure/storage/LocalStorageSettingsStore.js';

class FakeStorage implements StorageLike {
  private readonly entries = new Map<string, string>();

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Reproduces Safari in private browsing, and a full quota. */
class HostileStorage implements StorageLike {
  getItem(): string {
    throw new Error('SecurityError');
  }

  setItem(): void {
    throw new Error('QuotaExceededError');
  }

  removeItem(): void {
    throw new Error('SecurityError');
  }
}

describe('LocalStorageSettingsStore', () => {
  it('round-trips a value', () => {
    const storage = new FakeStorage();
    const store = new LocalStorageSettingsStore(storage);

    store.write({ practice: { tempoBpm: 72 } });

    expect(store.read()).toEqual({ practice: { tempoBpm: 72 } });
    expect(storage.getItem(DEFAULT_STORAGE_KEY)).toContain('72');
  });

  it('reports nothing when the key has never been written', () => {
    expect(new LocalStorageSettingsStore(new FakeStorage()).read()).toBeNull();
  });

  it('treats unreadable contents as nothing', () => {
    const storage = new FakeStorage();
    storage.setItem(DEFAULT_STORAGE_KEY, '{ this is not json');

    expect(new LocalStorageSettingsStore(storage).read()).toBeNull();
  });

  it('clears what it wrote', () => {
    const storage = new FakeStorage();
    const store = new LocalStorageSettingsStore(storage);
    store.write({ a: 1 });

    store.clear();

    expect(store.read()).toBeNull();
    expect(storage.size).toBe(0);
  });

  it('never lets a hostile storage break the app', () => {
    const store = new LocalStorageSettingsStore(new HostileStorage());

    // Private browsing throws from every one of these.
    expect(() => store.write({ a: 1 })).not.toThrow();
    expect(store.read()).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });

  it('is inert when the host has no storage at all', () => {
    const store = new LocalStorageSettingsStore(null);

    expect(() => store.write({ a: 1 })).not.toThrow();
    expect(store.read()).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });

  it('keeps separate keys apart', () => {
    const storage = new FakeStorage();
    new LocalStorageSettingsStore(storage, 'one').write({ value: 1 });
    new LocalStorageSettingsStore(storage, 'two').write({ value: 2 });

    expect(new LocalStorageSettingsStore(storage, 'one').read()).toEqual({ value: 1 });
    expect(new LocalStorageSettingsStore(storage, 'two').read()).toEqual({ value: 2 });
  });
});

describe('what a backup has to carry', () => {
  it('lists every key anything is kept under', () => {
    // The backup is what stands between a reader and a browser told to clear
    // its site data, and the way it would fail is silence: a store added and
    // not carried loses nothing today and everything on the day it is needed.
    // So the list is named once, and this says the list is all of them.
    const declared = Object.entries(storage)
      .filter(([name, value]) => name.endsWith('_STORAGE_KEY') && typeof value === 'string')
      .map(([, value]) => value as string);

    expect(declared.length).toBeGreaterThan(0);
    expect([...KEPT_STORAGE_KEYS].sort()).toEqual(declared.sort());
  });

  it('gives each of them a key of its own', () => {
    // Two stores at one key is one store, and the second of them is a blob
    // the first overwrites.
    expect(new Set(KEPT_STORAGE_KEYS).size).toBe(KEPT_STORAGE_KEYS.length);
  });
});

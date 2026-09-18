import { describe, expect, it } from 'vitest';
import {
  BrowserStorageGauge,
  type StorageManagerLike,
} from '../../src/infrastructure/storage/BrowserStorageGauge.js';

const SHELVES = [
  { name: 'settings', key: 'app/settings' },
  { name: 'takes', key: 'app/takes' },
];

function localHolding(entries: Record<string, string>): { getItem(key: string): string | null } {
  return { getItem: (key) => entries[key] ?? null };
}

describe('reading what the browser keeps for the site', () => {
  it('passes on every answer the browser gives', async () => {
    const manager: StorageManagerLike = {
      estimate: () =>
        Promise.resolve({ usage: 5_000, quota: 1_000_000, usageDetails: { indexedDB: 4_000 } }),
      persisted: () => Promise.resolve(true),
    };
    const gauge = new BrowserStorageGauge(
      manager,
      localHolding({ 'app/settings': '{"a":1}' }),
      SHELVES,
    );

    const reading = await gauge.read();

    expect(reading.usedBytes).toBe(5_000);
    expect(reading.quotaBytes).toBe(1_000_000);
    expect(reading.databaseBytes).toBe(4_000);
    expect(reading.persisted).toBe(true);
    // The key is kept as well as the value, so both are counted.
    expect(reading.shelves).toEqual([
      { name: 'settings', characters: 'app/settings'.length + '{"a":1}'.length },
      { name: 'takes', characters: 0 },
    ]);
  });

  it('says nothing the browser did not say', async () => {
    // Safari gives a total and no breakdown; a browser without the storage
    // manager gives nothing; a refusal is not an answer either.
    const noBreakdown = new BrowserStorageGauge(
      { estimate: () => Promise.resolve({ usage: 10, quota: 20 }) },
      null,
      SHELVES,
    );
    const nothing = new BrowserStorageGauge(null, null, SHELVES);
    const refusing = new BrowserStorageGauge(
      {
        estimate: () => Promise.reject(new Error('no')),
        persisted: () => Promise.reject(new Error('no')),
      },
      null,
      SHELVES,
    );

    const partly = await noBreakdown.read();
    expect(partly.databaseBytes).toBeNull();
    expect(partly.persisted).toBeNull();

    for (const reading of [await nothing.read(), await refusing.read()]) {
      expect(reading.usedBytes).toBeNull();
      expect(reading.quotaBytes).toBeNull();
      expect(reading.persisted).toBeNull();
    }
  });

  it('counts nothing on a shelf that will not be read', async () => {
    const gauge = new BrowserStorageGauge(
      null,
      {
        getItem: () => {
          throw new Error('private mode');
        },
      },
      SHELVES,
    );

    const reading = await gauge.read();

    expect(reading.shelves.map((shelf) => shelf.characters)).toEqual([0, 0]);
  });
});

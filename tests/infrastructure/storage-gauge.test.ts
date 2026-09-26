import { describe, expect, it } from 'vitest';
import {
  BrowserStorageGauge,
  bytesOfKept,
  keptScores,
  keptWhole,
  type CacheStorageLike,
  type StorageManagerLike,
} from '../../src/infrastructure/storage/BrowserStorageGauge.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import type { IScoreStore } from '../../src/application/ports/IScoreStore.js';

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
      estimate: () => Promise.resolve({ usage: 5_000, quota: 1_000_000 }),
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

describe('weighing what the site keeps, part by part', () => {
  /** An offline copy holding the given files, by address and size. */
  function cacheHolding(files: Record<string, number>): CacheStorageLike {
    const requests = Object.keys(files).map((url) => ({ url }));
    return {
      keys: () => Promise.resolve(['app.v1']),
      open: () =>
        Promise.resolve({
          keys: () => Promise.resolve(requests),
          match: (request: { readonly url: string }) =>
            Promise.resolve({ blob: () => Promise.resolve({ size: files[request.url] ?? 0 }) }),
        }),
    };
  }

  it('weighs each part it is handed, and says how many of it there are', async () => {
    const readings = new InMemorySettingsStore();
    readings.write({ passages: { 'score:A': [{ atMs: 1 }] } });
    const gauge = new BrowserStorageGauge(null, null, [], {
      parts: [keptWhole('readings', [readings], () => 1)],
    });

    const reading = await gauge.read();

    expect(reading.parts).toEqual([
      { kind: 'readings', bytes: bytesOfKept(readings.read()), count: 1 },
    ]);
  });

  it('weighs every score in the library, each document whole', async () => {
    const documents: Record<string, unknown> = { a: { id: 'a', musicXml: 'x'.repeat(100) }, b: { id: 'b', musicXml: 'y'.repeat(50) } };
    const store = {
      list: () => Promise.resolve([{ id: 'a' }, { id: 'b' }]),
      read: (id: string) => Promise.resolve(documents[id] ?? null),
    } as unknown as IScoreStore;

    const weighed = await keptScores(store).measure();

    expect(weighed).toEqual({
      bytes: bytesOfKept(documents['a']) + bytesOfKept(documents['b']),
      count: 2,
    });
  });

  it('splits the offline copy into the piano and the app, by where each file lives', async () => {
    const gauge = new BrowserStorageGauge(null, null, [], {
      caches: cacheHolding({
        'https://site.example/app/samples/piano/C4.mp3': 300,
        'https://site.example/app/samples/piano/A4.mp3': 200,
        'https://site.example/app/assets/index-abc.js': 40,
        'https://site.example/app/': 10,
      }),
    });

    const reading = await gauge.read();

    expect(reading.parts).toEqual([
      { kind: 'sound', bytes: 500, count: null },
      { kind: 'app', bytes: 50, count: null },
    ]);
  });

  it('leaves out a part that cannot be weighed, rather than saying it is empty', async () => {
    const gauge = new BrowserStorageGauge(null, null, [], {
      parts: [
        { kind: 'scores', measure: () => Promise.reject(new Error('no database')) },
        keptWhole('settings', [new InMemorySettingsStore()], () => null),
      ],
      caches: {
        keys: () => Promise.reject(new Error('no caches')),
        open: () => Promise.reject(new Error('no caches')),
      },
    });

    const reading = await gauge.read();

    expect(reading.parts.map((part) => part.kind)).toEqual(['settings']);
  });

  it('counts a kept value in the bytes it is written in', () => {
    // A letter outside plain English is two bytes and more, and a piece's
    // name is often one.
    expect(bytesOfKept({ a: 'ї' })).toBe('{"a":"ї"}'.length + 1);
    expect(bytesOfKept(null)).toBe(4);
    expect(bytesOfKept(undefined)).toBe(0);
  });
});

describe('asking the browser to keep the site', () => {
  it('asks only where it has not been promised already', async () => {
    let asked = 0;
    const promised = new BrowserStorageGauge(
      {
        estimate: () => Promise.resolve({}),
        persisted: () => Promise.resolve(true),
        persist: () => {
          asked += 1;
          return Promise.resolve(true);
        },
      },
      null,
      SHELVES,
    );

    expect(await promised.askToKeep()).toBe(true);
    expect(asked).toBe(0);
  });

  it('passes on what the browser decides', async () => {
    const refused = new BrowserStorageGauge(
      {
        estimate: () => Promise.resolve({}),
        persisted: () => Promise.resolve(false),
        persist: () => Promise.resolve(false),
      },
      null,
      SHELVES,
    );
    const granted = new BrowserStorageGauge(
      {
        estimate: () => Promise.resolve({}),
        persisted: () => Promise.resolve(false),
        persist: () => Promise.resolve(true),
      },
      null,
      SHELVES,
    );

    expect(await refused.askToKeep()).toBe(false);
    expect(await granted.askToKeep()).toBe(true);
  });

  it('says nothing where the browser cannot be asked', async () => {
    const nothing = new BrowserStorageGauge(null, null, SHELVES);
    const noAsking = new BrowserStorageGauge({ estimate: () => Promise.resolve({}) }, null, SHELVES);
    const refusing = new BrowserStorageGauge(
      {
        estimate: () => Promise.resolve({}),
        persisted: () => Promise.resolve(false),
        persist: () => Promise.reject(new Error('no')),
      },
      null,
      SHELVES,
    );

    expect(await nothing.askToKeep()).toBeNull();
    expect(await noAsking.askToKeep()).toBeNull();
    expect(await refusing.askToKeep()).toBeNull();
  });
});

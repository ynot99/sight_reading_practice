import { describe, expect, it } from 'vitest';
import type { StorageReading } from '../../src/application/ports/IStorageGauge.js';
import { sizeOf, theStorageAccount } from '../../src/ui/storageReport.js';

const MB = 1024 * 1024;

function reading(over: Partial<StorageReading> = {}): StorageReading {
  return {
    usedBytes: 26 * MB,
    quotaBytes: 9.6 * 1024 * MB,
    persisted: false,
    parts: [
      { kind: 'scores', bytes: 6 * MB, count: 98 },
      { kind: 'sound', bytes: 14 * MB, count: null },
      { kind: 'readings', bytes: 1 * MB, count: 340 },
    ],
    shelves: [
      { name: 'settings', characters: 3 * 1024 },
      { name: 'takes', characters: 1536 * 1024 },
    ],
    ...over,
  };
}

describe('what the device keeps, said to the reader', () => {
  it('says how much is kept of how much may be, as he wrote it', () => {
    // His: "скільки ліміт 3Gb/9Gb".
    expect(theStorageAccount(reading()).total).toBe('26.0 MB / 9.6 GB');
  });

  it('draws the bar as what is kept, biggest part first, and every part in it', () => {
    // Twenty-six megabytes of nine gigabytes is a bar with a hair in it, so
    // the whole bar is what is kept.
    const pieces = theStorageAccount(reading()).pieces;

    expect(pieces.map((piece) => [piece.name, piece.bytes / MB, piece.count])).toEqual([
      ['Piano sound', 14, null],
      ['Scores', 6, 98],
      // What the parts do not account for, which is the browser's own keeping.
      ['Other', 5, null],
      ['Readings', 1, 340],
    ]);
    expect(pieces.reduce((sum, piece) => sum + piece.share, 0)).toBeCloseTo(1, 10);
    expect(pieces[0]?.share).toBeCloseTo(14 / 26, 10);
  });

  it('has no Other where the parts account for all of it', () => {
    const pieces = theStorageAccount(reading({ usedBytes: 21 * MB })).pieces;

    expect(pieces.map((piece) => piece.kind)).not.toContain('other');
  });

  it('says what the parts come to where the browser will not give a total', () => {
    const account = theStorageAccount(reading({ usedBytes: null, quotaBytes: null }));

    expect(account.total).toBe('about 21.0 MB');
    expect(account.pieces.map((piece) => piece.kind)).not.toContain('other');
  });

  it('says whether it will be kept, and what it means that it will not', () => {
    expect(theStorageAccount(reading({ persisted: true })).kept).toBe('Kept from being cleared.');
    expect(theStorageAccount(reading({ persisted: false })).kept).toContain('Home Screen');
    expect(theStorageAccount(reading({ persisted: null })).kept).toContain('does not say');
  });

  it('says what the small store holds, shelf by shelf', () => {
    expect(theStorageAccount(reading()).small).toBe(
      'Small store: 1.5 MB of about 5.0 MB (settings 3 KB, takes 1.5 MB)',
    );
  });

  it('draws nothing out of nothing', () => {
    const account = theStorageAccount(reading({ usedBytes: 0, parts: [] }));

    expect(account.pieces).toEqual([]);
  });

  it('says a size the way a reader would', () => {
    expect(sizeOf(0)).toBe('0 B');
    expect(sizeOf(1023)).toBe('1023 B');
    expect(sizeOf(2048)).toBe('2 KB');
    expect(sizeOf(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(sizeOf(150 * 1024 * 1024)).toBe('150 MB');
  });
});

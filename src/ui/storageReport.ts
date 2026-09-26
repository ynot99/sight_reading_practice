import type { StoragePartKind, StorageReading } from '../application/ports/IStorageGauge.js';

/**
 * About how much the small store holds for a whole site.
 *
 * Five megabytes is what the standard suggests and roughly what browsers give,
 * though each counts it its own way - so this is said as "about", and the
 * shelves are what is worth reading: which of them is growing.
 */
export const SMALL_STORE_BYTES = 5 * 1024 * 1024;

/** A piece of the bar: one part of what is kept, or what the parts do not account for. */
export interface StoragePiece {
  readonly kind: StoragePartKind | 'other';
  readonly name: string;
  readonly bytes: number;
  /** How much of the bar it takes, nought to one. */
  readonly share: number;
  readonly count: number | null;
}

/** What the Storage pane says, worked out from what the gauge read. */
export interface StorageAccount {
  /** How much is kept, and how much may be: "26.0 MB / 9.6 GB". */
  readonly total: string;
  /** The bar and its legend, in one order, biggest first. */
  readonly pieces: readonly StoragePiece[];
  /** Whether it will be kept, and what that means. */
  readonly kept: string;
  /** The small store, which has a few megabytes for the whole site. */
  readonly small: string;
}

const NAMES: Readonly<Record<StoragePiece['kind'], string>> = {
  scores: 'Scores',
  readings: 'Readings',
  takes: 'Takes',
  sound: 'Piano sound',
  app: 'App',
  settings: 'Settings',
  other: 'Other',
};

/**
 * What the device keeps for the trainer, as a bar of what it is made of.
 *
 * His, of iOS: "рисочка яка заповнюється різними кольорами - та легенда
 * знизу щоб сказати що скільки займає". The whole bar is what is kept rather
 * than the room there is for it: twenty-six megabytes of nine gigabytes is a
 * bar with a hair in it, and nothing to read. The room is said in words,
 * as he asked - "3Gb/9Gb".
 *
 * What the parts do not account for is the browser's own keeping of them,
 * and is a piece of its own rather than spread over the others. Every answer
 * the browser would not give is said to be missing rather than shown as
 * nought.
 */
export function theStorageAccount(reading: StorageReading): StorageAccount {
  const weighed = reading.parts.reduce((sum, part) => sum + part.bytes, 0);
  const other =
    reading.usedBytes === null ? 0 : Math.max(0, reading.usedBytes - weighed);
  const whole = weighed + other;
  const pieces: StoragePiece[] = [
    ...reading.parts.map((part) => ({
      kind: part.kind,
      name: NAMES[part.kind],
      bytes: part.bytes,
      share: whole > 0 ? part.bytes / whole : 0,
      count: part.count,
    })),
    ...(other > 0
      ? [{ kind: 'other' as const, name: NAMES.other, bytes: other, share: other / whole, count: null }]
      : []),
  ].sort((left, right) => right.bytes - left.bytes);

  const used = reading.usedBytes === null ? `about ${sizeOf(weighed)}` : sizeOf(reading.usedBytes);
  const total = reading.quotaBytes === null ? used : `${used} / ${sizeOf(reading.quotaBytes)}`;
  const kept =
    reading.persisted === null
      ? 'Whether it is kept from being cleared, the browser does not say.'
      : reading.persisted
        ? 'Kept from being cleared.'
        : 'Not kept from being cleared: Safari may clear it after a week unvisited, unless the app is on the Home Screen.';
  // Characters rather than bytes, and near enough the same: what is kept
  // there is JSON, which is almost all plain letters.
  const small = reading.shelves.reduce((sum, shelf) => sum + shelf.characters, 0);
  const shelves = reading.shelves
    .map((shelf) => `${shelf.name} ${sizeOf(shelf.characters)}`)
    .join(', ');
  return {
    total,
    pieces,
    kept,
    small: `Small store: ${sizeOf(small)} of about ${sizeOf(SMALL_STORE_BYTES)}${shelves === '' ? '' : ` (${shelves})`}`,
  };
}

/** A size said the way a reader would say it. */
export function sizeOf(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit >= 2 && value < 100 ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unit] ?? 'B'}`;
}

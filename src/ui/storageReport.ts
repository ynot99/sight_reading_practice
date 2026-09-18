import type { StorageReading } from '../application/ports/IStorageGauge.js';

/**
 * About how much the small store holds for a whole site.
 *
 * Five megabytes is what the standard suggests and roughly what browsers give,
 * though each counts it its own way - so this is said as "about", and the
 * shelves are what is worth reading: which of them is growing.
 */
export const SMALL_STORE_BYTES = 5 * 1024 * 1024;

/**
 * What the device keeps for the trainer, a line at a time, for a reader who
 * wants to know whether there is room and whether it will be kept.
 *
 * Every answer the browser would not give is said to be missing rather than
 * shown as nought.
 */
export function describeStorage(reading: StorageReading): string[] {
  const everything =
    reading.usedBytes === null
      ? 'the browser does not say'
      : reading.quotaBytes === null
        ? sizeOf(reading.usedBytes)
        : `${sizeOf(reading.usedBytes)} of ${sizeOf(reading.quotaBytes)} allowed`;
  const scores =
    reading.databaseBytes === null
      ? 'this browser does not break them out'
      : sizeOf(reading.databaseBytes);
  const kept =
    reading.persisted === null ? 'the browser does not say' : reading.persisted ? 'yes' : 'no';
  // Characters rather than bytes, and near enough the same: what is kept
  // there is JSON, which is almost all plain letters.
  const small = reading.shelves.reduce((sum, shelf) => sum + shelf.characters, 0);
  const shelves = reading.shelves
    .map((shelf) => `${shelf.name} ${sizeOf(shelf.characters)}`)
    .join(', ');
  return [
    `Everything this site keeps: ${everything}`,
    `Scores: ${scores}`,
    `Kept from being cleared: ${kept}`,
    `Small store: ${sizeOf(small)} of about ${sizeOf(SMALL_STORE_BYTES)} (${shelves})`,
  ];
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

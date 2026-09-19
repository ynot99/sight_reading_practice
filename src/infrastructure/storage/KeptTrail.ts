import type { ITimingTrail } from '../../application/ports/ITimingTrail.js';
import type { StorageLike } from './LocalStorageSettingsStore.js';

export const TRAIL_STORAGE_KEY = 'sight-reading-practice/timing-trail';

/**
 * The start timings, kept in the browser's small store.
 *
 * That one and not the database: it is written as each line is printed and
 * before the next thing happens, and a write to the database is only asked
 * for and finished later - which a page closed for want of memory never
 * reaches. Nothing here may throw: the timings are for finding out what went
 * wrong, and must not be another thing that does.
 */
export class KeptTrail implements ITimingTrail {
  private readonly storage: StorageLike | null;

  constructor(storage: StorageLike | null) {
    this.storage = storage;
  }

  keep(lines: readonly string[]): void {
    try {
      this.storage?.setItem(TRAIL_STORAGE_KEY, JSON.stringify(lines));
    } catch {
      // A full store keeps the lines it had.
    }
  }

  lastKept(): readonly string[] {
    try {
      const kept: unknown = JSON.parse(this.storage?.getItem(TRAIL_STORAGE_KEY) ?? '[]');
      return Array.isArray(kept) ? kept.filter((line): line is string => typeof line === 'string') : [];
    } catch {
      return [];
    }
  }
}

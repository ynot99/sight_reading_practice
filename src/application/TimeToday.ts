import type { ISettingsStore } from './ports/ISettingsStore.js';

const STORAGE_VERSION = 1;

/** Days kept, which is enough for a week's worth of looking back later. */
const KEEP_DAYS = 60;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The calendar day a moment falls on, in the reader's own time zone.
 *
 * Local rather than UTC, and a string rather than a number: practice at
 * eleven at night belongs to that evening, whatever a clock in Greenwich
 * says, and the day it belongs to is the thing being stored.
 */
export function dayOf(atMs: number): string {
  const at = new Date(atMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/**
 * How long this application has been in front of the reader today.
 *
 * Wall-clock time with the page open, and deliberately not the same question
 * as the one the rest reminder asks. That one counts *notes*, because hands
 * are what a rest is for; this one counts the sitting down, because what it
 * answers is "have I practised today", and a reader who spent twenty minutes
 * reading a page without playing it has practised.
 *
 * Kept per day and written down, so that closing the tab, reloading, or
 * coming back after supper carries on the same number rather than starting a
 * new one. Nothing here has a timer: it is told about stretches of time and
 * adds them up, which is what makes it testable without waiting.
 *
 * What it deliberately does *not* do yet is notice that the reader has walked
 * away with the page open. Counting only while the page is on screen gets
 * most of that, and the rest - a page watched by nobody - needs a judgement
 * about what idle means that is worth making on its own.
 */
export class TimeToday {
  private readonly store: ISettingsStore;
  private readonly keep: number;
  private days = new Map<string, number>();

  constructor(store: ISettingsStore, keep = KEEP_DAYS) {
    this.store = store;
    this.keep = keep;
  }

  /** Reads what earlier visits wrote, ignoring anything that no longer parses. */
  load(): void {
    this.days = new Map();
    const raw = this.store.read();
    if (!isRecord(raw)) {
      return;
    }
    const days = raw['days'];
    if (!isRecord(days)) {
      return;
    }
    for (const [day, value] of Object.entries(days)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        this.days.set(day, value);
      }
    }
    this.trim();
  }

  /**
   * Adds a stretch of time to the day it happened on.
   *
   * A stretch that is not a positive number of milliseconds is not time and
   * is dropped: the caller is measuring the gap between two readings of a
   * clock, and a clock that has been put back gives a negative one.
   */
  add(atMs: number, forMs: number): void {
    if (!Number.isFinite(forMs) || forMs <= 0) {
      return;
    }
    const day = dayOf(atMs);
    this.days.set(day, (this.days.get(day) ?? 0) + forMs);
    this.trim();
    this.flush();
  }

  /** How long the day holding this moment has had, in milliseconds. */
  msOn(atMs: number): number {
    return this.days.get(dayOf(atMs)) ?? 0;
  }

  /** Every day that has any time on it, oldest first. */
  get everyDay(): readonly { readonly day: string; readonly ms: number }[] {
    return [...this.days.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([day, ms]) => ({ day, ms }));
  }

  forget(): void {
    this.days = new Map();
    this.flush();
  }

  /** The oldest days go first: this is a habit, not an archive. */
  private trim(): void {
    if (this.days.size <= this.keep) {
      return;
    }
    const kept = [...this.days.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-this.keep);
    this.days = new Map(kept);
  }

  private flush(): void {
    this.store.write({
      version: STORAGE_VERSION,
      days: Object.fromEntries(this.days),
    });
  }
}

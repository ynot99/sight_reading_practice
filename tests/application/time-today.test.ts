import { describe, expect, it } from 'vitest';
import { TimeToday, dayOf } from '../../src/application/TimeToday.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';

/** A moment on a named day, in the reader's own time zone. */
function at(year: number, month: number, day: number, hour = 12): number {
  return new Date(year, month - 1, day, hour).getTime();
}

describe('how long the application has been open today', () => {
  it('adds time to the day it happened on', () => {
    const time = new TimeToday(new InMemorySettingsStore());
    const morning = at(2026, 9, 6, 9);
    const evening = at(2026, 9, 6, 21);

    time.add(morning, 10 * 60_000);
    time.add(evening, 5 * 60_000);

    expect(time.msOn(morning)).toBe(15 * 60_000);
  });

  it('starts the day again at midnight, in the zone the reader lives in', () => {
    // Practice at eleven at night belongs to that evening, whatever a clock
    // in Greenwich says about which day it is.
    const time = new TimeToday(new InMemorySettingsStore());
    time.add(at(2026, 9, 6, 23), 20 * 60_000);

    time.add(at(2026, 9, 7, 1), 4 * 60_000);

    expect(time.msOn(at(2026, 9, 6))).toBe(20 * 60_000);
    expect(time.msOn(at(2026, 9, 7))).toBe(4 * 60_000);
  });

  it('carries on the same number after the page is closed and opened', () => {
    // The whole point of writing it down: a reload, a closed tab, coming
    // back after supper - all of it is the same day.
    const store = new InMemorySettingsStore();
    const morning = new TimeToday(store);
    morning.add(at(2026, 9, 6, 9), 12 * 60_000);

    const evening = new TimeToday(store);
    evening.load();
    evening.add(at(2026, 9, 6, 20), 8 * 60_000);

    expect(evening.msOn(at(2026, 9, 6))).toBe(20 * 60_000);
  });

  it('is not moved by a stretch that is not time', () => {
    // The caller measures the gap between two readings of a clock, and a
    // clock that has been put back gives a negative one.
    const time = new TimeToday(new InMemorySettingsStore());
    const today = at(2026, 9, 6);

    time.add(today, -5_000);
    time.add(today, Number.NaN);
    time.add(today, 0);

    expect(time.msOn(today)).toBe(0);
  });

  it('keeps a habit rather than an archive', () => {
    const time = new TimeToday(new InMemorySettingsStore(), 3);

    for (const day of [1, 2, 3, 4, 5]) {
      time.add(at(2026, 9, day), 60_000);
    }

    expect(time.everyDay.map((each) => each.day)).toEqual([
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
    ]);
  });

  it('survives anything at all in storage', () => {
    const store = new InMemorySettingsStore();
    store.write({ days: { '2026-09-06': 'a while', '2026-09-07': 60_000 }, junk: true });
    const time = new TimeToday(store);

    time.load();

    expect(time.msOn(at(2026, 9, 6))).toBe(0);
    expect(time.msOn(at(2026, 9, 7))).toBe(60_000);
  });

  it('names a day the way the reader would', () => {
    expect(dayOf(at(2026, 9, 6))).toBe('2026-09-06');
  });
});

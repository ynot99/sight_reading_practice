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

  it('counts the days practised in a row', () => {
    const time = new TimeToday(new InMemorySettingsStore());
    for (const day of [4, 5, 6]) {
      time.add(at(2026, 9, day), 10 * 60_000);
    }

    expect(time.streakEndingOn(at(2026, 9, 6))).toBe(3);
  });

  it('breaks the run on a day that was missed', () => {
    const time = new TimeToday(new InMemorySettingsStore());
    for (const day of [1, 2, 5, 6]) {
      time.add(at(2026, 9, day), 10 * 60_000);
    }

    expect(time.streakEndingOn(at(2026, 9, 6))).toBe(2);
  });

  it('keeps the run of yesterday standing until today is missed', () => {
    // A run of days should not read as broken all morning merely because
    // the reader has not sat down yet.
    const time = new TimeToday(new InMemorySettingsStore());
    for (const day of [4, 5]) {
      time.add(at(2026, 9, day), 10 * 60_000);
    }

    expect(time.streakEndingOn(at(2026, 9, 6, 9))).toBe(2);

    time.add(at(2026, 9, 6, 10), 10 * 60_000);

    expect(time.streakEndingOn(at(2026, 9, 6, 10))).toBe(3);
  });

  it('does not count a day the page was merely glanced at', () => {
    // A run of days that a glance can extend is a run worth nothing.
    const time = new TimeToday(new InMemorySettingsStore());
    time.add(at(2026, 9, 5), 10 * 60_000);
    time.add(at(2026, 9, 6), 20_000);

    expect(time.streakEndingOn(at(2026, 9, 6))).toBe(1);
    expect(TimeToday.counts(20_000)).toBe(false);
  });

  it('gives the last seven days, gaps and all', () => {
    const time = new TimeToday(new InMemorySettingsStore());
    time.add(at(2026, 9, 1), 10 * 60_000);
    time.add(at(2026, 9, 6), 10 * 60_000);

    const week = time.lastDays(at(2026, 9, 6), 7);

    expect(week.map((each) => each.day)).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ]);
    expect(week.map((each) => TimeToday.counts(each.ms))).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it('names a day the way the reader would', () => {
    expect(dayOf(at(2026, 9, 6))).toBe('2026-09-06');
  });
});

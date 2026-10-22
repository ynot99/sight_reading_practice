import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  A_PLAYBACK_PAUSES_MS,
  AudioClockReading,
  CLOCKS_APART_MS,
  CLOCKS_WATCHED_MS,
  TOO_LATE_MS,
  theAudioClocks,
  tooLateToSound,
} from '../../src/infrastructure/audio/audioTime.js';

describe('whether a moment has gone', () => {
  it('lets ordinary lateness through', () => {
    // A scheduler waking a few milliseconds off is nothing, and a note a hair
    // late is better than a silent one.
    expect(tooLateToSound(1_000, 1_000)).toBe(false);
    expect(tooLateToSound(1_000, 1_030)).toBe(false);
    expect(tooLateToSound(1_000, 1_000 + TOO_LATE_MS)).toBe(false);
  });

  it('drops a note from a moment that is genuinely gone', () => {
    // The burst this exists to prevent: the page stalls, the scheduler wakes
    // with seconds of notes overdue, and every one of them would otherwise be
    // started at the same instant and released immediately after. His: "таке
    // враження будто воно грає в 3 рази швидше, та кожна нота обрізається".
    expect(tooLateToSound(1_000, 1_000 + TOO_LATE_MS + 1)).toBe(true);
    expect(tooLateToSound(1_000, 4_000)).toBe(true);
  });

  it('says nothing about a sound with no moment of its own', () => {
    // No moment means "now", which cannot be late.
    expect(tooLateToSound(undefined, 9_999)).toBe(false);
  });

  it('never calls a sound still to come late', () => {
    expect(tooLateToSound(2_000, 1_000)).toBe(false);
  });
});

describe('the audio clock against the page clock, for the playback timings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A device at two seconds on its own clock, at ten on the page's. */
  const device = (more: Record<string, unknown> = {}): BaseAudioContext =>
    ({ currentTime: 2, outputLatency: 0.04, baseLatency: 0.005, ...more }) as unknown as BaseAudioContext;

  it('says how far the audio clock has moved since the reading, and the latencies reported', () => {
    vi.spyOn(performance, 'now').mockReturnValue(10_000);
    const reading = new AudioClockReading();
    reading.hold(7_950);
    let asked = 0;
    // Its nought at 8 s of the page's clock now: 50 ms after the reading. And
    // what the device says it has played is never asked.
    const clocks = theAudioClocks(
      device({
        getOutputTimestamp: () => {
          asked += 1;
          return { contextTime: 1.9, performanceTime: 9_930 };
        },
      }),
      reading,
    );

    expect(clocks.driftMs).toBeCloseTo(50);
    expect(clocks.outputMs).toBeCloseTo(40);
    expect(clocks.baseMs).toBeCloseTo(5);
    expect(asked).toBe(0);
  });

  it('says nothing it was not told, and no drift from a reading taken fresh', () => {
    vi.spyOn(performance, 'now').mockReturnValue(10_000);

    expect(theAudioClocks({ currentTime: 2 } as unknown as BaseAudioContext, new AudioClockReading())).toEqual({
      driftMs: 0,
      outputMs: null,
      baseMs: null,
    });
  });
});

describe('the reading sounds are placed by while the metronome is not beating', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A device whose clock stood some milliseconds since its last buffer when
   * asked at a moment of the page's: its nought then reads that much later.
   */
  const asked = (reading: AudioClockReading, pageMs: number, stoodMs: number): number => {
    vi.spyOn(performance, 'now').mockReturnValue(pageMs);
    // Its nought is at 8 s of the page's clock.
    return reading.of({ currentTime: (pageMs - 8_000 - stoodMs) / 1000 } as unknown as BaseAudioContext);
  };

  it('keeps the first while sounds go on being placed, however the clock stood when each was', () => {
    const reading = new AudioClockReading();
    const stood = [6, 0, 13, 2, 9, 11, 4];
    const read = stood.map((stoodMs, at) => asked(reading, 10_000 + at * 50, stoodMs));

    expect(read.map((each) => each - 8_000)).toEqual(stood.map(() => 6));
  });

  it('takes the earliest of a stretch instead where it stands further from the kept than a buffer wanders', () => {
    for (const apartMs of [-30, -CLOCKS_APART_MS - 1, -CLOCKS_APART_MS, 0, CLOCKS_APART_MS, CLOCKS_APART_MS + 1, 30]) {
      const reading = new AudioClockReading();
      asked(reading, 10_000, 0);
      // A stretch of readings that far off, the earliest of them without a stand.
      for (let at = 1; at <= 10; at += 1) {
        asked(reading, 10_000 + (at * CLOCKS_WATCHED_MS) / 10, apartMs + (at % 3) * 4);
      }
      const now = asked(reading, 10_000 + CLOCKS_WATCHED_MS + 50, apartMs + 7) - 8_000;

      expect(now, String(apartMs)).toBe(Math.abs(apartMs) > CLOCKS_APART_MS ? apartMs : 0);
    }
  });

  it('follows the clocks moving apart partway through a long playback, a stretch at a time', () => {
    const reading = new AudioClockReading();
    const step = CLOCKS_WATCHED_MS / 10;
    // A stretch together, then the device's clock falls 30 ms behind.
    const read = Array.from({ length: 31 }, (_, at) => asked(reading, 10_000 + at * step, at <= 10 ? 0 : 30) - 8_000);

    expect(read.slice(0, 20)).toEqual(read.slice(0, 20).map(() => 0));
    expect(read.at(-1)).toBe(30);
  });

  it("reads afresh after a quiet spell, and the metronome's own while it beats", () => {
    const reading = new AudioClockReading();
    asked(reading, 10_000, 9);
    expect(asked(reading, 10_000 + A_PLAYBACK_PAUSES_MS, 2) - 8_000).toBe(9);
    expect(asked(reading, 10_000 + 2 * A_PLAYBACK_PAUSES_MS + 1, 2) - 8_000).toBe(2);
    reading.hold(7_000);
    expect(asked(reading, 20_000, 5)).toBe(7_000);
    reading.release();
    expect(asked(reading, 20_050, 5) - 8_000).toBe(5);
  });
});

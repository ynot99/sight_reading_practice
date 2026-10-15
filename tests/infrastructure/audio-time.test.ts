import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioClockReading, TOO_LATE_MS, theAudioClocks, tooLateToSound } from '../../src/infrastructure/audio/audioTime.js';

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

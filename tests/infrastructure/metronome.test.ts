import { describe, expect, it } from 'vitest';
import type { MetronomeConfig, MetronomeTick } from '../../src/application/ports/IMetronome.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import {
  buildMetronomeTick,
  subdivisionSeconds,
  ticksPerSubdivision,
} from '../../src/infrastructure/audio/metronomeMath.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { ManualMetronome } from '../../src/infrastructure/testing/ManualMetronome.js';

const COMMON: MetronomeConfig = {
  bpm: 60,
  timeSignature: new TimeSignature(4, 4),
  subdivisionsPerBeat: 4,
  muted: true,
};

describe('metronome maths', () => {
  it('derives subdivision length from the tempo and the denominator', () => {
    expect(subdivisionSeconds(COMMON)).toBeCloseTo(0.25, 10);
    expect(subdivisionSeconds({ ...COMMON, bpm: 120 })).toBeCloseTo(0.125, 10);
    expect(subdivisionSeconds({ ...COMMON, subdivisionsPerBeat: 1 })).toBeCloseTo(1, 10);
    // In 6/8 a beat is an eighth note, so it is half as long as a quarter.
    expect(
      subdivisionSeconds({
        ...COMMON,
        timeSignature: new TimeSignature(6, 8),
        subdivisionsPerBeat: 1,
      }),
    ).toBeCloseTo(0.5, 10);
  });

  it('derives the musical length of a subdivision', () => {
    expect(ticksPerSubdivision(COMMON)).toBe(120);
    expect(ticksPerSubdivision({ ...COMMON, subdivisionsPerBeat: 1 })).toBe(480);
  });

  it('locates a tick in the bar', () => {
    const first = buildMetronomeTick(0, COMMON, 0);
    expect(first).toEqual<MetronomeTick>({
      index: 0,
      measure: 0,
      beat: 1,
      isBeat: true,
      isDownbeat: true,
      positionTicks: 0,
      scheduledTimeMs: 0,
    });

    const offBeat = buildMetronomeTick(2, COMMON, 500);
    expect(offBeat.isBeat).toBe(false);
    expect(offBeat.beat).toBe(1);
    expect(offBeat.positionTicks).toBe(240);

    const secondBeat = buildMetronomeTick(4, COMMON, 1000);
    expect(secondBeat.isBeat).toBe(true);
    expect(secondBeat.isDownbeat).toBe(false);
    expect(secondBeat.beat).toBe(2);

    const secondBar = buildMetronomeTick(16, COMMON, 4000);
    expect(secondBar.measure).toBe(1);
    expect(secondBar.beat).toBe(1);
    expect(secondBar.isDownbeat).toBe(true);
    expect(secondBar.positionTicks).toBe(1920);
  });
});

describe('ManualMetronome', () => {
  it('emits ticks only while running', () => {
    const metronome = new ManualMetronome();
    metronome.configure(COMMON);
    const ticks: MetronomeTick[] = [];
    metronome.onTick((tick) => ticks.push(tick));

    metronome.advanceSubdivisions(4);
    expect(ticks).toHaveLength(0);

    metronome.start();
    metronome.advanceSubdivisions(4);
    expect(ticks).toHaveLength(4);

    metronome.stop();
    metronome.advanceSubdivisions(4);
    expect(ticks).toHaveLength(4);
  });

  it('moves the injected clock to each tick', () => {
    const clock = new ManualClock(1000);
    const metronome = new ManualMetronome(clock);
    metronome.configure(COMMON);
    metronome.start();

    metronome.advanceBeats(2);

    expect(metronome.subdivisionMs).toBe(250);
    expect(clock.now()).toBe(1000 + 7 * 250);
    expect(metronome.emitted).toHaveLength(8);
    expect(metronome.emitted.at(-1)?.scheduledTimeMs).toBe(clock.now());
  });

  it('advances up to a musical position', () => {
    const clock = new ManualClock();
    const metronome = new ManualMetronome(clock);
    metronome.configure(COMMON);
    metronome.start();

    metronome.advanceToTicks(480);

    expect(metronome.emitted.at(-1)?.positionTicks).toBe(480);
    expect(metronome.nextTickIndex).toBe(5);
  });

  it('restarts its counters on each start', () => {
    const clock = new ManualClock();
    const metronome = new ManualMetronome(clock);
    metronome.configure(COMMON);

    metronome.start();
    metronome.advanceBeats(1);
    clock.set(9000);
    metronome.start();
    const [tick] = metronome.advanceSubdivisions(1);

    expect(tick?.index).toBe(0);
    expect(tick?.scheduledTimeMs).toBe(9000);
  });
});

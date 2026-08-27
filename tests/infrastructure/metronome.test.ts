import { describe, expect, it } from 'vitest';
import type { MetronomeConfig, MetronomeTick } from '../../src/application/ports/IMetronome.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import {
  buildMetronomeTick,
  isAudibleClick,
  subdivisionSeconds,
  ticksPerSubdivision,
} from '../../src/infrastructure/audio/metronomeMath.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { ManualMetronome } from '../../src/infrastructure/testing/ManualMetronome.js';

const COMMON: MetronomeConfig = {
  bpm: 60,
  timeSignature: new TimeSignature(4, 4),
  subdivisionsPerPulse: 4,
  click: 'subdivision',
  muted: true,
};

function audibleIndices(config: MetronomeConfig, count: number): number[] {
  return Array.from({ length: count }, (_, index) => index).filter((index) =>
    isAudibleClick(buildMetronomeTick(index, config, 0), config),
  );
}

describe('which ticks are heard', () => {
  it('sounds as much of the pulse as was asked for', () => {
    expect(audibleIndices({ ...COMMON, click: 'subdivision' }, 8)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(audibleIndices({ ...COMMON, click: 'division' }, 8)).toEqual([0, 2, 4, 6]);
    expect(audibleIndices({ ...COMMON, click: 'pulse' }, 8)).toEqual([0, 4]);
    expect(audibleIndices({ ...COMMON, click: 'downbeat' }, 32)).toEqual([0, 16]);
  });

  it('divides a compound pulse in three, not in two', () => {
    const compound: MetronomeConfig = {
      ...COMMON,
      timeSignature: new TimeSignature(6, 8),
      subdivisionsPerPulse: 6,
    };
    // Two dotted-quarter beats to the bar, each of three eighths.
    expect(audibleIndices({ ...compound, click: 'pulse' }, 12)).toEqual([0, 6]);
    expect(audibleIndices({ ...compound, click: 'division' }, 12)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(audibleIndices({ ...compound, click: 'downbeat' }, 24)).toEqual([0, 12]);
  });

  it('falls back to the pulse when the resolution cannot express the click', () => {
    // Two ticks per beat cannot sound four clicks in it; the beat can always
    // be sounded, so that is what happens rather than nothing or a stutter.
    const coarse: MetronomeConfig = { ...COMMON, subdivisionsPerPulse: 2, click: 'subdivision' };
    expect(audibleIndices(coarse, 8)).toEqual([0, 2, 4, 6]);
  });
});

describe('metronome maths', () => {
  it('derives subdivision length from the tempo and the denominator', () => {
    expect(subdivisionSeconds(COMMON)).toBeCloseTo(0.25, 10);
    expect(subdivisionSeconds({ ...COMMON, bpm: 120 })).toBeCloseTo(0.125, 10);
    expect(subdivisionSeconds({ ...COMMON, subdivisionsPerPulse: 1 })).toBeCloseTo(1, 10);
    // 6/8 is felt in two dotted quarters, so one pulse is a quarter and a
    // half - not the eighth note the denominator names.
    expect(
      subdivisionSeconds({
        ...COMMON,
        timeSignature: new TimeSignature(6, 8),
        subdivisionsPerPulse: 1,
      }),
    ).toBeCloseTo(1.5, 10);
  });

  it('derives the musical length of a subdivision', () => {
    expect(ticksPerSubdivision(COMMON)).toBe(120);
    expect(ticksPerSubdivision({ ...COMMON, subdivisionsPerPulse: 1 })).toBe(480);
  });

  it('locates a tick in the bar', () => {
    const first = buildMetronomeTick(0, COMMON, 0);
    expect(first).toEqual<MetronomeTick>({
      index: 0,
      measure: 0,
      beat: 1,
      isPulse: true,
      isDownbeat: true,
      positionTicks: 0,
      scheduledTimeMs: 0,
    });

    const offBeat = buildMetronomeTick(2, COMMON, 500);
    expect(offBeat.isPulse).toBe(false);
    expect(offBeat.beat).toBe(1);
    expect(offBeat.positionTicks).toBe(240);

    const secondBeat = buildMetronomeTick(4, COMMON, 1000);
    expect(secondBeat.isPulse).toBe(true);
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

import { describe, expect, it } from 'vitest';
import type {
  MetronomeConfig,
  MetronomeDropout,
  MetronomeTick,
} from '../../src/application/ports/IMetronome.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { Duration } from '../../src/domain/model/Duration.js';
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
  bars: [],
  subdivisionsPerPulse: 4,
  click: 'subdivision',
  dropout: null,
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
      bars: [],
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

describe('bars the click sits out', () => {
  // One tick per beat keeps the arithmetic readable: index 4 starts bar 2.
  const PULSED: MetronomeConfig = { ...COMMON, subdivisionsPerPulse: 1, click: 'pulse' };

  const CYCLE = (bars: number, fromBar: number): MetronomeDropout => ({
    kind: 'cycle',
    bars,
    fromBar,
  });

  function barsHeard(config: MetronomeConfig, bars: number): number[] {
    return Array.from({ length: bars * 4 }, (_, index) => index)
      .filter((index) => isAudibleClick(buildMetronomeTick(index, config, 0), config))
      .map((index) => Math.floor(index / 4) + 1)
      .filter((bar, at, all) => all.indexOf(bar) === at);
  }

  it('alternates equal runs of click and silence', () => {
    const config = { ...PULSED, dropout: CYCLE(2, 0) };
    expect(barsHeard(config, 8)).toEqual([1, 2, 5, 6]);
  });

  it('leaves the reader completely alone, downbeat included', () => {
    const config: MetronomeConfig = { ...PULSED, dropout: CYCLE(1, 0) };
    const secondBar = [4, 5, 6, 7].map((index) => buildMetronomeTick(index, config, 0));
    expect(secondBar[0]?.isDownbeat).toBe(true);
    for (const tick of secondBar) {
      expect(isAudibleClick(tick, config)).toBe(false);
    }
  });

  it('never drops the count-in, which is the reference being given', () => {
    // One bar of count-in, then two on and two off from the music onwards.
    const config = { ...PULSED, dropout: CYCLE(2, 1) };
    expect(barsHeard(config, 8)).toEqual([1, 2, 3, 6, 7]);
  });

  describe('a click that gives the tempo and leaves', () => {
    it('sounds the count-in and nothing after it', () => {
      const config: MetronomeConfig = {
        ...PULSED,
        dropout: { kind: 'silent-from', fromBar: 1 },
      };
      // The reader is handed one bar of pulse and carries the rest alone.
      expect(barsHeard(config, 12)).toEqual([1]);
    });

    it('never comes back, however long the run is', () => {
      const config: MetronomeConfig = {
        ...PULSED,
        dropout: { kind: 'silent-from', fromBar: 2 },
      };
      // The cycle rule would have let it return; this one must not.
      expect(barsHeard(config, 40)).toEqual([1, 2]);
    });

    it('is silent from the very first bar when there is no count-in', () => {
      const config: MetronomeConfig = {
        ...PULSED,
        dropout: { kind: 'silent-from', fromBar: 0 },
      };
      expect(barsHeard(config, 4)).toEqual([]);
    });
  });

  it('is off when no cycle is set', () => {
    expect(barsHeard({ ...PULSED, dropout: null }, 4)).toEqual([1, 2, 3, 4]);
    expect(barsHeard({ ...PULSED, dropout: CYCLE(0, 0) }, 4)).toEqual([1, 2, 3, 4]);
  });

  it('drops whatever the click pattern would have sounded', () => {
    const config: MetronomeConfig = {
      ...COMMON,
      click: 'subdivision',
      dropout: CYCLE(1, 0),
    };
    // Bar one keeps all sixteen sixteenths; bar two keeps none.
    const heard = Array.from({ length: 32 }, (_, index) => index).filter((index) =>
      isAudibleClick(buildMetronomeTick(index, config, 0), config),
    );
    expect(heard).toHaveLength(16);
    expect(Math.max(...heard)).toBe(15);
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
        bars: [],
        subdivisionsPerPulse: 1,
      }),
    ).toBeCloseTo(1.5, 10);
  });

  it('derives the musical length of a subdivision', () => {
    expect(ticksPerSubdivision(COMMON)).toBe(Duration.SIXTEENTH.ticks);
    expect(ticksPerSubdivision({ ...COMMON, subdivisionsPerPulse: 1 })).toBe(Duration.QUARTER.ticks);
  });

  it('moves the downbeat when the bars it was given change metre', () => {
    // A pulse generator can find the bar by division only while every bar is
    // the same length. Told which bars there are, it accents the downbeat the
    // reader is looking at rather than the one the opening metre would have
    // put there - which for a piece that drops from 4/4 to 3/4 is a beat
    // further along every bar after the change.
    const whole = Duration.WHOLE.ticks;
    const config: MetronomeConfig = {
      ...COMMON,
      subdivisionsPerPulse: 1,
      click: 'pulse',
      bars: [
        { startTicks: 0, timeSignature: new TimeSignature(4, 4) },
        { startTicks: whole, timeSignature: new TimeSignature(3, 4) },
        { startTicks: whole + Duration.DOTTED_HALF.ticks, timeSignature: new TimeSignature(3, 4) },
      ],
    };

    const downbeats = Array.from({ length: 11 }, (_, index) => index).filter(
      (index) => buildMetronomeTick(index, config, 0).isDownbeat,
    );

    // Quarters: bar one at 0, then every three rather than every four.
    expect(downbeats).toEqual([0, 4, 7, 10]);
    expect(buildMetronomeTick(5, config, 0).beat).toBe(2);
    expect(buildMetronomeTick(5, config, 0).measure).toBe(1);
  });

  it('goes on beating in the last metre after the music has run out', () => {
    // A run that reaches the end keeps a pulse for the mode to finish on,
    // and it has to beat in something.
    const config: MetronomeConfig = {
      ...COMMON,
      subdivisionsPerPulse: 1,
      click: 'pulse',
      bars: [{ startTicks: 0, timeSignature: new TimeSignature(3, 4) }],
    };

    expect(buildMetronomeTick(3, config, 0).isDownbeat).toBe(true);
    expect(buildMetronomeTick(3, config, 0).measure).toBe(1);
    expect(buildMetronomeTick(6, config, 0).measure).toBe(2);
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
    expect(offBeat.positionTicks).toBe(Duration.EIGHTH.ticks);

    const secondBeat = buildMetronomeTick(4, COMMON, 1000);
    expect(secondBeat.isPulse).toBe(true);
    expect(secondBeat.isDownbeat).toBe(false);
    expect(secondBeat.beat).toBe(2);

    const secondBar = buildMetronomeTick(16, COMMON, 4000);
    expect(secondBar.measure).toBe(1);
    expect(secondBar.beat).toBe(1);
    expect(secondBar.isDownbeat).toBe(true);
    expect(secondBar.positionTicks).toBe(Duration.WHOLE.ticks);
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

    metronome.advanceToTicks(Duration.QUARTER.ticks);

    expect(metronome.emitted.at(-1)?.positionTicks).toBe(Duration.QUARTER.ticks);
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

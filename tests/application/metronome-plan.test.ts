import { describe, expect, it } from 'vitest';
import {
  clicksPerPulse,
  type ClickWhen,
  type ClickPattern,
} from '../../src/application/ports/IMetronome.js';
import {
  musicalResolutionTicks,
  subdivisionsPerPulseFor,
} from '../../src/application/session/metronomePlan.js';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import { FlowMode } from '../../src/application/modes/FlowMode.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { measureOf, noteEntry, type Exercise } from '../../src/domain/model/Exercise.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { compoundBarExercise, p, twoBarExercise } from '../support/fixtures.js';
import { createHarness } from '../support/harness.js';

const COMMON = new TimeSignature(4, 4);
const COMPOUND = new TimeSignature(6, 8);

/** One bar of `count` equal notes filling the metre. */
function evenBar(timeSignature: TimeSignature, duration: Duration): Exercise {
  const count = timeSignature.ticksPerMeasure / duration.ticks;
  const entries = Array.from({ length: count }, () => noteEntry(p('C4'), duration));
  return {
    ...twoBarExercise({ timeSignature }),
    staves: [
      { staffNumber: 1, voice: 1, clef: 'treble', clefChanges: [], measures: [measureOf(entries)] },
    ],
  };
}

describe('clicksPerPulse', () => {
  it('counts a division in twos, or in threes when the metre is compound', () => {
    const expected: Record<ClickPattern, [number, number]> = {
      downbeat: [1, 1],
      pulse: [1, 1],
      division: [2, 3],
      subdivision: [4, 6],
    };
    for (const [pattern, [simple, compound]] of Object.entries(expected) as [
      ClickPattern,
      [number, number],
    ][]) {
      expect({ pattern, simple: clicksPerPulse(pattern, COMMON) }).toEqual({ pattern, simple });
      expect({ pattern, compound: clicksPerPulse(pattern, COMPOUND) }).toEqual({
        pattern,
        compound,
      });
    }
  });
});

describe('musicalResolutionTicks', () => {
  it('is as coarse as the music allows', () => {
    expect(musicalResolutionTicks(buildTimeline(evenBar(COMMON, Duration.QUARTER)), COMMON)).toBe(
      Duration.QUARTER.ticks,
    );
    expect(musicalResolutionTicks(buildTimeline(evenBar(COMMON, Duration.EIGHTH)), COMMON)).toBe(
      Duration.EIGHTH.ticks,
    );
    expect(
      musicalResolutionTicks(buildTimeline(evenBar(COMMON, Duration.SIXTEENTH)), COMMON),
    ).toBe(Duration.SIXTEENTH.ticks);
  });

  it('lands on every onset of a mixed bar', () => {
    const timeline = buildTimeline(twoBarExercise());
    const resolution = musicalResolutionTicks(timeline, COMMON);
    for (const step of timeline.steps) {
      expect(step.onsetTicks % resolution).toBe(0);
      expect(step.durationTicks % resolution).toBe(0);
    }
  });
});

describe('subdivisionsPerPulseFor', () => {
  it('resolves the shortest note in the exercise', () => {
    const sixteenths = buildTimeline(evenBar(COMMON, Duration.SIXTEENTH));
    expect(subdivisionsPerPulseFor(sixteenths, COMMON, 'pulse')).toBe(4);

    const quarters = buildTimeline(evenBar(COMMON, Duration.QUARTER));
    expect(subdivisionsPerPulseFor(quarters, COMMON, 'pulse')).toBe(1);
  });

  it('ticks often enough to sound the click that was asked for', () => {
    // Nothing shorter than a quarter, yet a sixteenth-note click still has to
    // land somewhere: the click is what raises the resolution here, not the
    // music. This is the separation the whole thing exists for.
    const quarters = buildTimeline(evenBar(COMMON, Duration.QUARTER));
    expect(subdivisionsPerPulseFor(quarters, COMMON, 'subdivision')).toBe(4);
    expect(subdivisionsPerPulseFor(quarters, COMMON, 'division')).toBe(2);
    expect(subdivisionsPerPulseFor(quarters, COMMON, 'downbeat')).toBe(1);
  });

  it('satisfies both demands at once', () => {
    // Eighths need two ticks per beat, a sixteenth click needs four.
    const eighths = buildTimeline(evenBar(COMMON, Duration.EIGHTH));
    expect(subdivisionsPerPulseFor(eighths, COMMON, 'subdivision')).toBe(4);
    // Triplet-shaped demands would not divide evenly into a binary click, so
    // the multiple of both is what has to be taken.
    const compound = buildTimeline(compoundBarExercise());
    expect(subdivisionsPerPulseFor(compound, COMPOUND, 'pulse')).toBe(3);
    expect(subdivisionsPerPulseFor(compound, COMPOUND, 'division')).toBe(3);
    expect(subdivisionsPerPulseFor(compound, COMPOUND, 'subdivision')).toBe(6);
  });
});

describe('dropping the click', () => {
  function configFor(clickWhen: ClickWhen, countInBars: number) {
    const harness = createHarness({
      exercise: twoBarExercise(),
      mode: new FlowMode(),
      options: { countInBars, click: 'pulse', clickWhen },
    });
    harness.session.start();
    return harness.metronome.currentConfig;
  }

  it('starts the cycle where the music does, not where the metronome did', () => {
    expect(configFor('cycle-2', 1).dropout).toEqual({ kind: 'cycle', bars: 2, fromBar: 1 });
    expect(configFor('cycle-2', 0).dropout).toEqual({ kind: 'cycle', bars: 2, fromBar: 0 });
  });

  it('asks for nothing when it is switched off', () => {
    expect(configFor('never', 1).dropout).toBeNull();
  });

  it('lets the click give the tempo and then leave', () => {
    // Silence from where the music starts, so the count-in is still heard.
    expect(configFor('count-in-only', 1).dropout).toEqual({ kind: 'silent-from', fromBar: 1 });
    expect(configFor('count-in-only', 0).dropout).toEqual({ kind: 'silent-from', fromBar: 0 });
  });
});

describe('count-in', () => {
  function countInBeatsFor(exercise: Exercise, bars: number): number[] {
    const harness = createHarness({
      exercise,
      mode: new FlowMode(),
      options: { countInBars: bars, clickWhen: 'never', click: 'pulse' },
    });
    harness.session.start();
    harness.metronome.advanceSubdivisions(32);
    return harness.of('countIn').map((event) => event.beatsRemaining);
  }

  it('is a bar long, however many beats that is', () => {
    expect(countInBeatsFor(twoBarExercise(), 1)).toEqual([4, 3, 2, 1]);
    // One bar of 6/8 is two dotted-quarter beats, not six eighths. Counting
    // "1 2 3 4" into it would leave the reader out of phase with the bar.
    expect(countInBeatsFor(compoundBarExercise(), 1)).toEqual([2, 1]);
  });

  it('can be turned off, and then the pulse is only what the mode needs', () => {
    expect(countInBeatsFor(twoBarExercise(), 0)).toEqual([]);

    const harness = createHarness({
      exercise: twoBarExercise(),
      mode: new WaitMode(),
      options: { countInBars: 0, clickWhen: 'never', click: 'pulse' },
    });
    harness.session.start();
    expect(harness.session.status).toBe('running');
  });
});

import { describe, expect, it } from 'vitest';
import {
  clicksPerPulse,
  type ClickWhen,
  type ClickPattern,
} from '../../src/application/ports/IMetronome.js';
import {
  metronomeBars,
  metronomeTempos,
  musicalResolutionTicks,
  subdivisionsPerPulseFor,
} from '../../src/application/session/metronomePlan.js';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import { FlowMode } from '../../src/application/modes/FlowMode.js';
import { Duration } from '../../src/domain/model/Duration.js';
import {
  measureOf,
  noteEntry,
  type Exercise,
  type MusicalEntry,
} from '../../src/domain/model/Exercise.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { compoundBarExercise, p, twoBarExercise } from '../support/fixtures.js';
import { createHarness } from '../support/harness.js';
import { isAudibleClick } from '../../src/infrastructure/audio/metronomeMath.js';

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

/** Two bars in 4/4 and 3/4, which is nausicaa's shape. */
function changingMetre(): Exercise {
  const base = twoBarExercise();
  const [treble, bass] = base.staves;
  if (treble === undefined || bass === undefined) {
    throw new Error('expected two staves');
  }
  return {
    ...base,
    timeChanges: [{ measureIndex: 1, timeSignature: new TimeSignature(3, 4) }],
    staves: [
      {
        ...treble,
        measures: [
          measureOf([noteEntry(p('C4'), Duration.WHOLE)]),
          measureOf([noteEntry(p('D4'), Duration.DOTTED_HALF)]),
        ],
      },
      {
        ...bass,
        measures: [
          measureOf([noteEntry(p('C3'), Duration.WHOLE)]),
          measureOf([noteEntry(p('G2'), Duration.DOTTED_HALF)]),
        ],
      },
    ],
  };
}

describe('the bars a metronome beats through', () => {
  it('lays the count-in in front of the music', () => {
    const bars = metronomeBars(twoBarExercise(), { countInBars: 2, fromTicks: 0 });
    const whole = Duration.WHOLE.ticks;

    // Two counted, then the two the piece is made of.
    expect(bars.map((bar) => bar.startTicks)).toEqual([0, whole, whole * 2, whole * 3]);
  });

  it('moves the bar lines where the metre changes', () => {
    const bars = metronomeBars(changingMetre(), { countInBars: 1, fromTicks: 0 });
    const whole = Duration.WHOLE.ticks;

    expect(bars.map((bar) => bar.startTicks)).toEqual([0, whole, whole * 2]);
    expect(bars.map((bar) => bar.timeSignature.toString())).toEqual(['4/4', '4/4', '3/4']);
  });

  it('counts the reader in to the metre the music is about to start in', () => {
    // Resuming into the 3/4 bar. Counted in four to music that begins in
    // three is the worst possible way to arrive.
    const bars = metronomeBars(changingMetre(), {
      countInBars: 1,
      fromTicks: Duration.WHOLE.ticks,
    });

    expect(bars.map((bar) => bar.timeSignature.toString())).toEqual(['3/4', '3/4']);
    expect(bars.map((bar) => bar.startTicks)).toEqual([0, Duration.DOTTED_HALF.ticks]);
  });
});

/**
 * A bar that mixes tuplets sharing no factor, which is what collapses the
 * grid: sevens, fives, sixes and thirty-seconds, a beat of each.
 */
function tupletsAgainstEachOther(): Exercise {
  const beat = (count: number, value: Duration): MusicalEntry[] =>
    Array.from({ length: count }, () => noteEntry(p('C4'), value));
  const entries = [
    ...beat(7, Duration.of('16th', 0, { actual: 7, normal: 4 })),
    ...beat(5, Duration.of('16th', 0, { actual: 5, normal: 4 })),
    ...beat(6, Duration.of('16th', 0, { actual: 6, normal: 4 })),
    ...beat(8, Duration.of('32nd')),
  ];
  return {
    ...twoBarExercise(),
    staves: [
      { staffNumber: 1, voice: 1, clef: 'treble', clefChanges: [], measures: [measureOf(entries)] },
    ],
  };
}

describe('how fine the practice loop runs', () => {
  it('takes what ordinary music asks for, exactly', () => {
    // Sixteenths want four to the beat, and nothing here changes that.
    const sixteenths = buildTimeline(evenBar(COMMON, Duration.SIXTEENTH));

    expect(subdivisionsPerPulseFor(sixteenths, COMMON, 'pulse')).toBe(4);
  });

  it('refuses to run faster than a loop can be run, whatever the music wants', () => {
    // Landing on every onset of these costs eight hundred and forty ticks a
    // beat - two thousand a second, each one running the whole practice loop.
    // The page stopped answering altogether: not a stutter, a reader unable
    // to tell whether their own stop button had registered.
    const timeline = buildTimeline(tupletsAgainstEachOther());
    const exact = COMMON.ticksPerPulse / musicalResolutionTicks(timeline, COMMON);
    expect(exact).toBeGreaterThan(100);

    const used = subdivisionsPerPulseFor(timeline, COMMON, 'pulse');

    expect(used).toBeLessThanOrEqual(48);
  });

  it('keeps a grid that divides the beat, so the bar lines stay where they are', () => {
    const timeline = buildTimeline(tupletsAgainstEachOther());

    for (const click of ['downbeat', 'pulse', 'division', 'subdivision'] as ClickPattern[]) {
      const used = subdivisionsPerPulseFor(timeline, COMMON, click);
      expect({ click, remainder: COMMON.ticksPerPulse % used }).toEqual({ click, remainder: 0 });
      // And the click still lands on the beats it names, which is the one
      // demand here a reader would hear being broken.
      expect({ click, over: used % clicksPerPulse(click, COMMON) }).toEqual({ click, over: 0 });
    }
  });

  it('runs a compound metre inside the ceiling too', () => {
    const timeline = buildTimeline(tupletsAgainstEachOther());

    const used = subdivisionsPerPulseFor(timeline, COMPOUND, 'division');

    expect(used).toBeLessThanOrEqual(48);
    expect(COMPOUND.ticksPerPulse % used).toBe(0);
    expect(used % clicksPerPulse('division', COMPOUND)).toBe(0);
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

  it('beats the run through the bars the reader is looking at', () => {
    // End to end: the session hands the metronome the bars, so the accent
    // lands on the bar line the page draws. Nausicaa's shape - 4/4 into 3/4
    // - and the second downbeat comes a beat sooner than the opening metre
    // would have put it.
    const harness = createHarness({
      exercise: changingMetre(),
      mode: new FlowMode(),
      options: { countInBars: 0, clickWhen: 'always', click: 'pulse' },
    });

    harness.session.start();
    harness.metronome.advanceSubdivisions(8);

    const downbeats = harness.metronome.emitted
      .filter((tick) => tick.isDownbeat)
      .map((tick) => tick.positionTicks);
    expect(downbeats).toContain(Duration.WHOLE.ticks);
    expect(downbeats).toContain(Duration.WHOLE.ticks + Duration.DOTTED_HALF.ticks);
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

describe('the tempos the metronome will beat at', () => {
  /** Two bars at 60, the second at 120. */
  function retimed(): Exercise {
    return {
      ...twoBarExercise({ tempoBpm: 60 }),
      tempoChanges: [{ measureIndex: 1, offsetTicks: 0, tempoBpm: 120 }],
    };
  }

  it('lays the tempos out on the metronome clock, not the music one', () => {
    const tempos = metronomeTempos(retimed(), { countInBars: 1, fromTicks: 0 });

    // One bar of count-in in front, so the change arrives a bar later than it
    // does in the music.
    expect(tempos).toEqual([
      { startTicks: 0, bpm: 60 },
      { startTicks: Duration.WHOLE.ticks * 2, bpm: 120 },
    ]);
  });

  it('counts a passage in at the tempo it is about to begin at', () => {
    // Beginning in the fast half, being counted in at the opening Lento would
    // hand the reader a pulse the music never plays.
    const tempos = metronomeTempos(retimed(), {
      countInBars: 1,
      fromTicks: Duration.WHOLE.ticks,
    });

    expect(tempos).toEqual([{ startTicks: 0, bpm: 120 }]);
  });
});

describe('where the click stops', () => {
  it('sounds a beat for every beat of the music and no more', () => {
    // The pulse has to run one tick past the last note - that is the tick the
    // mode finishes on - but a click there is the downbeat of a bar the page
    // does not have. Practised on repeat, a passage of eight beats was heard
    // as nine.
    const harness = createHarness({
      exercise: twoBarExercise({ tempoBpm: 60 }),
      mode: new FlowMode(),
      options: { countInBars: 0, clickWhen: 'always', click: 'pulse' },
    });
    harness.session.start();
    harness.metronome.advanceSubdivisions(20);

    const config = harness.metronome.currentConfig;
    const heard = harness.metronome.emitted.filter((tick) => isAudibleClick(tick, config));

    expect(harness.session.status).toBe('completed');
    expect(heard).toHaveLength(8);
    expect(config.endsAtTicks).toBe(Duration.WHOLE.ticks * 2);
  });

  it('stops at the end of the passage, not of the piece', () => {
    // The bars run on to the end of the score either way, so the passage's
    // own end is the only thing that says where the click has nothing left
    // to mark.
    const harness = createHarness({
      exercise: twoBarExercise({ tempoBpm: 60 }),
      mode: new FlowMode(),
      // The four quarters of bar one, and no further.
      options: { countInBars: 0, clickWhen: 'always', click: 'pulse', stopAfterIndex: 3 },
    });
    harness.session.start();
    harness.metronome.advanceSubdivisions(20);

    const config = harness.metronome.currentConfig;
    const heard = harness.metronome.emitted.filter((tick) => isAudibleClick(tick, config));

    expect(config.endsAtTicks).toBe(Duration.WHOLE.ticks);
    expect(heard).toHaveLength(4);
  });
});

describe('where the run says the music has got to', () => {
  it('counts the bar off the bar lines once the metre changes', () => {
    // Worked out by dividing by the opening metre, every position after a
    // change lands in the wrong bar - and the pill was reading that.
    const base = twoBarExercise({ tempoBpm: 60 });
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    const twoFour = new TimeSignature(2, 4);
    const harness = createHarness({
      exercise: {
        ...base,
        timeChanges: [{ measureIndex: 1, timeSignature: twoFour }],
        staves: [
          {
            ...treble,
            measures: [
              measureOf([
                noteEntry(p('C4'), Duration.QUARTER),
                noteEntry(p('D4'), Duration.QUARTER),
                noteEntry(p('E4'), Duration.QUARTER),
                noteEntry(p('F4'), Duration.QUARTER),
              ]),
              measureOf([
                noteEntry(p('G4'), Duration.QUARTER),
                noteEntry(p('A4'), Duration.QUARTER),
              ]),
              measureOf([
                noteEntry(p('B4'), Duration.QUARTER),
                noteEntry(p('C5'), Duration.QUARTER),
              ]),
            ],
          },
          {
            ...bass,
            measures: [
              measureOf([noteEntry(p('C3'), Duration.WHOLE)]),
              measureOf([noteEntry(p('G2'), Duration.HALF)]),
              measureOf([noteEntry(p('G2'), Duration.HALF)]),
            ],
          },
        ],
      },
      mode: new FlowMode(),
      options: { countInBars: 0, clickWhen: 'never', click: 'pulse' },
    });

    harness.session.start();
    harness.metronome.advanceSubdivisions(10);

    const seen = harness.of('positionChanged');
    // Four beats of 4/4, then two of 2/4, then two more. Divided by the
    // opening metre, the third bar is bar two beats three and four - a bar
    // that never ends, and a beat the reader is not on.
    expect(seen.filter((at) => at.measureIndex === 0).map((at) => at.beat)).toEqual([1, 2, 3, 4]);
    expect(seen.filter((at) => at.measureIndex === 1).map((at) => at.beat)).toEqual([1, 2]);
    expect(seen.filter((at) => at.measureIndex === 2).map((at) => at.beat)).toEqual([1, 2]);
  });
});

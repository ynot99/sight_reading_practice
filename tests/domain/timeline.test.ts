import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry, restEntry } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { MIDI, bar, p, singleBarExercise, twoBarExercise } from '../support/fixtures.js';

describe('buildTimeline', () => {
  const timeline = buildTimeline(twoBarExercise());

  it('creates one step per distinct onset across both staves', () => {
    const q = Duration.QUARTER.ticks;
    expect(timeline.steps.map((step) => step.onsetTicks)).toEqual([
      0, q, q * 2, q * 3, q * 4, q * 6,
    ]);
    expect(timeline.totalTicks).toBe(q * 8);
  });

  it('merges simultaneous notes from different staves into one step', () => {
    expect(timeline.require(0).expectedMidi).toEqual([MIDI.C3, MIDI.C4]);
    expect(timeline.require(4).expectedMidi).toEqual([MIDI.G2, MIDI.D3, MIDI.G4]);
  });

  it('does not repeat a held note under a moving line', () => {
    // The bass whole note is demanded once, at its onset only.
    expect(timeline.require(1).expectedMidi).toEqual([MIDI.D4]);
    expect(timeline.require(2).expectedMidi).toEqual([MIDI.E4]);
    expect(timeline.require(3).expectedMidi).toEqual([MIDI.F4]);
  });

  it('keeps rest positions as steps that expect nothing', () => {
    const rest = timeline.require(5);
    expect(rest.notes).toHaveLength(0);
    expect(rest.expectedMidi).toEqual([]);
    expect(timeline.playableSteps).toHaveLength(5);
  });

  it('measures each step up to the next onset', () => {
    const q = Duration.QUARTER.ticks;
    expect(timeline.steps.map((step) => step.durationTicks)).toEqual([q, q, q, q, q * 2, q * 2]);
  });

  it('locates every step in the bar structure', () => {
    expect(timeline.steps.map((step) => step.measureIndex)).toEqual([0, 0, 0, 0, 1, 1]);
    expect(timeline.steps.map((step) => step.beat)).toEqual([1, 2, 3, 4, 1, 3]);
  });

  it('counts the notes a player has to produce', () => {
    // 2 + 1 + 1 + 1 + 3 across the five playable steps.
    expect(timeline.noteCount).toBe(8);
    expect(timeline.length).toBe(6);
  });

  it('exposes safe and unsafe lookups', () => {
    expect(timeline.at(99)).toBeNull();
    expect(() => timeline.require(99)).toThrow();
    expect(timeline.stepAtTick(Duration.HALF.ticks + 1)?.onsetTicks).toBe(Duration.HALF.ticks);
    expect(timeline.stepAtTick(-1)).toBeNull();
  });

  it('deduplicates a pitch notated in both hands at the same instant', () => {
    const doubled = buildTimeline({
      ...singleBarExercise(),
      staves: [
        {
          staffNumber: 1,
          voice: 1,
          clef: 'treble',
          clefChanges: [],
          measures: [bar(noteEntry(p('C4'), Duration.WHOLE))],
        },
        {
          staffNumber: 2,
          voice: 2,
          clef: 'bass',
          clefChanges: [],
          measures: [bar(noteEntry(p('C4'), Duration.WHOLE))],
        },
      ],
    });

    expect(doubled.require(0).notes).toHaveLength(2);
    expect(doubled.require(0).expectedMidi).toEqual([MIDI.C4]);
    expect(doubled.noteCount).toBe(1);
  });

  it('handles a bar that is entirely rests', () => {
    const silent = buildTimeline({
      id: 'silent',
      title: 'silent',
      key: KeySignature.major(0),
      keyChanges: [],
      pedalMarks: [],
      timeSignature: new TimeSignature(4, 4),
      tempoBpm: 60,
      firstBarNumber: 1,
      metadata: { generatorId: 'fixture', seed: 0 },
      staves: [
        {
          staffNumber: 1,
          voice: 1,
          clef: 'treble',
          clefChanges: [],
          measures: [bar(restEntry(Duration.WHOLE))],
        },
      ],
    });

    expect(silent.length).toBe(1);
    expect(silent.playableSteps).toHaveLength(0);
    expect(silent.require(0).durationTicks).toBe(Duration.WHOLE.ticks);
  });
});

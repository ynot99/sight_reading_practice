import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry, restEntry, silenceEntry } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import {
  MIDI,
  bar,
  p,
  partialVoiceExercise,
  singleBarExercise,
  twoBarExercise,
} from '../support/fixtures.js';

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

  it('counts bars by where they begin once the metre changes', () => {
    // Bars stop being all the same length at a metre change, so a position
    // can no longer be had by multiplying: bar three of a piece that drops to
    // 3/4 begins earlier than four times a whole note.
    const base = twoBarExercise();
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    const threeFour = new TimeSignature(3, 4);
    const timeline = buildTimeline({
      ...base,
      timeChanges: [{ measureIndex: 1, timeSignature: threeFour }],
      staves: [
        {
          ...treble,
          measures: [
            bar(noteEntry(p('C4'), Duration.WHOLE)),
            bar(
              noteEntry(p('D4'), Duration.QUARTER),
              noteEntry(p('E4'), Duration.QUARTER),
              noteEntry(p('F4'), Duration.QUARTER),
            ),
          ],
        },
        {
          ...bass,
          measures: [
            bar(noteEntry(p('C3'), Duration.WHOLE)),
            bar(noteEntry(p('G2'), Duration.DOTTED_HALF)),
          ],
        },
      ],
    });

    const quarter = Duration.QUARTER.ticks;
    expect(timeline.steps.map((step) => step.onsetTicks)).toEqual([
      0,
      quarter * 4,
      quarter * 5,
      quarter * 6,
    ]);
    expect(timeline.steps.map((step) => step.measureIndex)).toEqual([0, 1, 1, 1]);
    // And the beats are counted inside the new bar, not the old one.
    expect(timeline.steps.map((step) => step.beat)).toEqual([1, 1, 2, 3]);
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
      timeChanges: [],
      tempoChanges: [],
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

describe('a silence is not a place the cursor stops', () => {
  it('makes no step of its own, where a rest would', () => {
    // The engraver draws nothing for a silence, so its cursor never stops
    // there. A step for it would be a position the reader is held at with
    // nothing on the page to explain why.
    const silent = buildTimeline(partialVoiceExercise());
    const q = Duration.QUARTER.ticks;
    expect(silent.steps.map((step) => step.onsetTicks)).toEqual([0, q, q * 2, q * 3]);

    // Written as rests instead, the same bar is the same four positions - the
    // difference is what is drawn, not where the cursor can be. So make the
    // lower voice enter off the beat, where only it has anything to say.
    const offBeat = buildTimeline(
      partialVoiceExercise([
        silenceEntry(Duration.EIGHTH),
        noteEntry(p('G3'), Duration.HALF),
        silenceEntry(Duration.DOTTED_QUARTER),
      ]),
    );
    expect(offBeat.steps.map((step) => step.onsetTicks)).toEqual([
      0,
      Duration.EIGHTH.ticks,
      q,
      q * 2,
      q * 3,
    ]);

    const drawn = buildTimeline(
      partialVoiceExercise([
        restEntry(Duration.EIGHTH),
        noteEntry(p('G3'), Duration.HALF),
        restEntry(Duration.DOTTED_QUARTER),
      ]),
    );
    // The rests are drawn, so the engraver stops on them and so do we: the
    // one after the held note is a position the silent version does not have.
    expect(drawn.steps.map((step) => step.onsetTicks)).toEqual([
      0,
      Duration.EIGHTH.ticks,
      q,
      q * 2,
      q * 2 + Duration.EIGHTH.ticks,
      q * 3,
    ]);
  });
});

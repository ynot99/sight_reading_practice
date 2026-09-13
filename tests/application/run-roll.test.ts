import { describe, expect, it } from 'vitest';
import {
  RollRecorder,
  beatsWorthMarking,
  theBeatNearest,
  theMusicsBeats,
  clicksBefore,
  clicksUpTo,
  rollAsEvents,
  rollBeganAtMs,
  type RolledPress,
  type RunRoll,
} from '../../src/application/session/RunRoll.js';
import { FlowMode } from '../../src/application/modes/FlowMode.js';
import type { MetronomeTick } from '../../src/application/ports/IMetronome.js';
import type {
  MidiNoteOffEvent,
  MidiNoteOnEvent,
  MidiPedalEvent,
} from '../../src/application/ports/IMidiSource.js';
import type { NoteJudgedEvent } from '../../src/application/session/SessionEvents.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { MIDI, twoBarExercise } from '../support/fixtures.js';
import { createHarness } from '../support/harness.js';

function down(midi: number, atMs: number, velocity = 0.8): MidiNoteOnEvent {
  return { type: 'noteon', midi, velocity, timestampMs: atMs, sourceId: 'test' };
}

function up(midi: number, atMs: number): MidiNoteOffEvent {
  return { type: 'noteoff', midi, timestampMs: atMs, sourceId: 'test' };
}

function pedal(isDown: boolean, atMs: number, value = isDown ? 1 : 0): MidiPedalEvent {
  return { type: 'pedal', pedal: 'sustain', down: isDown, value, timestampMs: atMs, sourceId: 'test' };
}

function verdict(midi: number, event: Partial<NoteJudgedEvent> = {}): NoteJudgedEvent {
  return {
    midi,
    verdict: 'correct',
    stepIndex: 0,
    deviationMs: null,
    remaining: [],
    ...event,
  };
}

function pressOf(midi: number, downAtMs: number, upAtMs: number | null): RolledPress {
  return {
    midi,
    downAtMs,
    upAtMs,
    velocity: 0.8,
    verdict: 'correct',
    stepIndex: 0,
    deviationMs: null,
  };
}

function roll(over: Partial<RunRoll> = {}): RunRoll {
  return { presses: [], beats: [], pedal: [], truncated: false, ...over };
}

function tick(at: number, of: Partial<MetronomeTick> = {}): MetronomeTick {
  return {
    index: 0,
    measure: 0,
    beat: 1,
    isPulse: true,
    isDownbeat: true,
    positionTicks: 0,
    scheduledTimeMs: at,
    ...of,
  };
}

describe('writing a run down', () => {
  it('pairs a key going down with the release that ends it', () => {
    const roller = new RollRecorder();
    roller.keyDown(down(MIDI.C4, 100, 0.6));
    roller.keyUp(up(MIDI.C4, 450));

    expect(roller.roll().presses).toEqual([
      {
        midi: MIDI.C4,
        downAtMs: 100,
        upAtMs: 450,
        velocity: 0.6,
        verdict: null,
        stepIndex: null,
        deviationMs: null,
      },
    ]);
  });

  it('leaves a key still held when the run ends open', () => {
    // Inventing a release at the run's end would say the reader let go there.
    const roller = new RollRecorder();
    roller.keyDown(down(MIDI.C4, 100));

    expect(roller.roll().presses[0]?.upAtMs).toBeNull();
  });

  it('releases the oldest press of a pitch, not the newest', () => {
    // A trill strikes one pitch twice inside a few hundred milliseconds. Close
    // the newest and the first note of it runs to the end of the piece.
    const roller = new RollRecorder();
    roller.keyDown(down(MIDI.C4, 100));
    roller.keyDown(down(MIDI.C4, 300));
    roller.keyUp(up(MIDI.C4, 350));

    expect(roller.roll().presses.map((press) => press.upAtMs)).toEqual([350, null]);
  });

  it('ignores a release of a key that was never pressed', () => {
    // A key let go of after a run has ended, or held from before it began.
    const roller = new RollRecorder();
    roller.keyUp(up(MIDI.C4, 100));

    expect(roller.roll().presses).toEqual([]);
  });

  it('attaches a verdict to the press it was given for', () => {
    const roller = new RollRecorder();
    roller.keyDown(down(MIDI.C4, 100));
    roller.judged(verdict(MIDI.C4, { verdict: 'rushed', stepIndex: 3, deviationMs: -80 }));

    const press = roller.roll().presses[0];
    expect(press?.verdict).toBe('rushed');
    expect(press?.stepIndex).toBe(3);
    expect(press?.deviationMs).toBe(-80);
  });

  it('gives a late verdict to the press that was waiting for it', () => {
    // A note struck before the music reached it is held and judged when the
    // gate it was reaching for opens - by which time the reader may have
    // struck the same key again.
    const roller = new RollRecorder();
    roller.keyDown(down(MIDI.C4, 100));
    roller.keyDown(down(MIDI.C4, 500));
    roller.judged(verdict(MIDI.C4, { verdict: 'correct' }));

    expect(roller.roll().presses.map((press) => press.verdict)).toEqual(['correct', null]);
  });

  it('keeps a press nothing was decided about', () => {
    // Saying `null` is how the picture admits no verdict was reached, rather
    // than quietly calling the press wrong.
    const roller = new RollRecorder();
    roller.keyDown(down(MIDI.C4, 100));

    expect(roller.roll().presses[0]?.verdict).toBeNull();
  });

  it('makes one span of a pedal pressed through many values', () => {
    // Half-pedalling is a stream of values on the way down. One span.
    const roller = new RollRecorder();
    roller.pedal(pedal(true, 100, 0.4));
    roller.pedal(pedal(true, 120, 0.8));
    roller.pedal(pedal(true, 140, 1));
    roller.pedal(pedal(false, 900));

    expect(roller.roll().pedal).toEqual([{ downAtMs: 100, upAtMs: 900 }]);
  });

  it('leaves the pedal open where it is still down', () => {
    const roller = new RollRecorder();
    roller.pedal(pedal(true, 100));

    expect(roller.roll().pedal).toEqual([{ downAtMs: 100, upAtMs: null }]);
  });

  it('says nothing of a pedal lifted that was never put down', () => {
    const roller = new RollRecorder();
    roller.pedal(pedal(false, 100));

    expect(roller.roll().pedal).toEqual([]);
  });

  it('weighs a click by what it marks', () => {
    // The grid draws a downbeat heavier than a beat and a beat heavier than
    // what falls between them, so the weight travels with the moment.
    const roller = new RollRecorder();
    roller.beat(tick(0), 0);
    roller.beat(tick(250, { isDownbeat: false, isPulse: false }), Duration.QUARTER.ticks / 4);
    roller.beat(tick(500, { isDownbeat: false, isPulse: true, beat: 2 }), Duration.QUARTER.ticks);

    expect(roller.roll().beats.map((beat) => beat.weight)).toEqual([
      'downbeat',
      'division',
      'beat',
    ]);
  });

  it('forgets the last run when the next one begins', () => {
    const roller = new RollRecorder();
    roller.keyDown(down(MIDI.C4, 100));
    roller.beat(tick(0), 0);
    roller.pedal(pedal(true, 50));
    roller.reset();

    expect(roller.roll()).toEqual({ presses: [], beats: [], pedal: [], truncated: false });
  });

  it('says so where it stopped taking things down', () => {
    // A run is bounded by the piece and cannot reach this, but a run left
    // going all afternoon would - and a measuring tool that quietly discards
    // half its measurements is worse than one that admits it.
    const roller = new RollRecorder();
    for (let index = 0; index < 20_001; index += 1) {
      roller.keyDown(down(MIDI.C4, index));
    }

    const roll = roller.roll();
    expect(roll.presses).toHaveLength(20_000);
    expect(roll.truncated).toBe(true);
  });
});

describe('the run as something to listen to', () => {
  it('pairs every press into a note that starts and stops', () => {
    const played = roll({
      presses: [
        { ...pressOf(MIDI.C4, 1000, 1400), velocity: 0.5 },
        pressOf(MIDI.E4, 1200, 1600),
      ],
    });

    expect(rollAsEvents(played)).toEqual([
      { kind: 'noteOn', atMs: 0, midi: MIDI.C4, velocity: 0.5 },
      { kind: 'noteOn', atMs: 200, midi: MIDI.E4, velocity: 0.8 },
      { kind: 'noteOff', atMs: 400, midi: MIDI.C4 },
      { kind: 'noteOff', atMs: 600, midi: MIDI.E4 },
    ]);
  });

  it('measures from the same nought the drawing does', () => {
    // Otherwise the note that sounds is not the note under the head. The roll
    // begins at its first event whatever that event is, so a run whose first
    // click is long before its first press starts from the click.
    const played = roll({
      beats: [{ atMs: 4000, weight: 'downbeat', positionTicks: Duration.QUARTER.ticks * 4 }],
      presses: [pressOf(MIDI.C4, 5000, 5200)],
    });

    expect(rollBeganAtMs(played)).toBe(4000);
    expect(rollAsEvents(played)[0]?.atMs).toBe(1000);
  });

  it('lets go of a key that was still down at the end', () => {
    // It has to be let go of somewhere, and the alternative is a note that
    // sounds for ever. Where it is let go of is where the roll stops, which is
    // a moment past its last event - the same moment the drawing gives such a
    // note its width, and the only length it can be given at all in a mode
    // with no pulse, where a roll is presses and nothing else.
    const played = roll({
      beats: [{ atMs: 0, weight: 'downbeat', positionTicks: Duration.QUARTER.ticks * 0 }, { atMs: 3000, weight: 'beat', positionTicks: Duration.QUARTER.ticks * 3 }],
      presses: [pressOf(MIDI.C4, 0, null)],
    });

    const off = rollAsEvents(played).find((event) => event.kind === 'noteOff');
    expect(off?.atMs).toBe(4000);
  });

  it('carries the pedal, down and up', () => {
    const played = roll({ pedal: [{ downAtMs: 1000, upAtMs: 2000 }] });

    expect(rollAsEvents(played)).toEqual([
      { kind: 'sustain', atMs: 0, value: 1 },
      { kind: 'sustain', atMs: 1000, value: 0 },
    ]);
  });

  it('hands the events over in time order', () => {
    // The player walks them forwards and never looks back, so an event out of
    // order is an event it plays at the wrong moment or not at all.
    const played = roll({
      presses: [pressOf(MIDI.C4, 3000, 3100), pressOf(MIDI.E4, 1000, 1100)],
      pedal: [{ downAtMs: 2000, upAtMs: 2500 }],
    });

    const times = rollAsEvents(played).map((event) => event.atMs);
    expect([...times].sort((left, right) => left - right)).toEqual(times);
  });
});

describe('the beat a run was measured against', () => {
  it('marks the bar lines and the beats, and never what falls between', () => {
    // A pulse may be running at four ticks to the beat for the practice loop's
    // sake. All four drawn is a grey wash; all four sounded is a rattle.
    const played = roll({
      beats: [
        { atMs: 0, weight: 'downbeat', positionTicks: Duration.QUARTER.ticks * 0 },
        { atMs: 250, weight: 'division', positionTicks: Duration.QUARTER.ticks * 0.25 },
        { atMs: 500, weight: 'beat', positionTicks: Duration.QUARTER.ticks * 0.5 },
      ],
    });

    expect(beatsWorthMarking(played).map((beat) => beat.weight)).toEqual([
      'downbeat',
      'beat',
    ]);
  });

  it('tells a bar line given late from the one that fell due', () => {
    // The tick where the gate closed and the first tick of the pulse the press
    // restarted are both that bar's downbeat, recorded at two moments. Same
    // place in the music, so the second is the reader giving it - and the gap
    // between them is the wait, which is the thing worth seeing.
    const played = roll({
      beats: [
        { atMs: 4000, weight: 'downbeat', positionTicks: 0 },
        { atMs: 4120, weight: 'downbeat', positionTicks: 0 },
        { atMs: 5000, weight: 'beat', positionTicks: Duration.QUARTER.ticks },
      ],
    });

    const marked = beatsWorthMarking(played);
    expect(marked.map((beat) => beat.given)).toEqual([false, true, false]);
    expect(marked.map((beat) => beat.lateByMs)).toEqual([null, 120, null]);
  });

  it('does not click a bar line the reader gave themselves', () => {
    // They played it, and heard it on their own instrument at the time. A
    // second click there is the machine agreeing rather than keeping time.
    const played = roll({
      beats: [
        { atMs: 4000, weight: 'downbeat', positionTicks: 0 },
        { atMs: 4120, weight: 'downbeat', positionTicks: 0 },
      ],
    });

    expect(theMusicsBeats(played).map((beat) => beat.atMs)).toEqual([4000]);
  });

  it('finds the beat nearest a moment, so a tap lands on the grid', () => {
    // A finger is worth about a tenth of a second at any readable zoom, and
    // nobody pointing at a run means a moment between two beats.
    const played = roll({
      beats: [
        { atMs: 1000, weight: 'downbeat', positionTicks: 0 },
        { atMs: 2000, weight: 'beat', positionTicks: Duration.QUARTER.ticks },
        { atMs: 3000, weight: 'beat', positionTicks: Duration.QUARTER.ticks * 2 },
      ],
    });

    // Measured from the roll's own beginning, which is its first event.
    expect(theBeatNearest(played, 620)).toBe(1000);
    expect(theBeatNearest(played, 1400)).toBe(1000);
    expect(theBeatNearest(played, 5000)).toBe(2000);
  });

  it('gives a tie to the beat already begun', () => {
    const played = roll({
      beats: [
        { atMs: 0, weight: 'downbeat', positionTicks: 0 },
        { atMs: 1000, weight: 'beat', positionTicks: Duration.QUARTER.ticks },
      ],
    });

    expect(theBeatNearest(played, 500)).toBe(0);
  });

  it('leaves the moment alone where the music has no beats at all', () => {
    // A frame that waits for the reader runs no pulse, and moving the head
    // somewhere they did not point would be worse than not snapping.
    expect(theBeatNearest(roll({}), 640)).toBe(640);
  });

  it('never snaps to a bar line the reader gave late', () => {
    // They meant the beat, which is where they were trying to be.
    const played = roll({
      beats: [
        { atMs: 0, weight: 'downbeat', positionTicks: 0 },
        { atMs: 400, weight: 'downbeat', positionTicks: 0 },
      ],
    });

    expect(theBeatNearest(played, 380)).toBe(0);
  });

  it('marks every tick the pulse gave, where a finer grid is asked for', () => {
    // The eighths or the sixteenths, whichever the run needed to resolve its
    // shortest note - and the same list answers for the lines and the clicks,
    // so the eye and the ear cannot be on different grids.
    const played = roll({
      beats: [
        { atMs: 0, weight: 'downbeat', positionTicks: 0 },
        { atMs: 250, weight: 'division', positionTicks: Duration.QUARTER.ticks / 4 },
        { atMs: 500, weight: 'beat', positionTicks: Duration.QUARTER.ticks },
      ],
    });

    expect(beatsWorthMarking(played).map((beat) => beat.atMs)).toEqual([0, 500]);
    expect(beatsWorthMarking(played, 'divisions').map((beat) => beat.atMs)).toEqual([0, 250, 500]);
    expect(theMusicsBeats(played, 'divisions')).toHaveLength(3);
  });

  it('snaps to a division only where divisions are drawn', () => {
    // Snapping to a line the reader cannot see would move the head somewhere
    // they had no way to mean.
    const played = roll({
      beats: [
        { atMs: 0, weight: 'downbeat', positionTicks: 0 },
        { atMs: 250, weight: 'division', positionTicks: Duration.QUARTER.ticks / 4 },
        { atMs: 1000, weight: 'beat', positionTicks: Duration.QUARTER.ticks },
      ],
    });

    expect(theBeatNearest(played, 240)).toBe(0);
    expect(theBeatNearest(played, 240, 'divisions')).toBe(250);
  });

  it('counts the finer clicks as spent too', () => {
    const played = roll({
      beats: [
        { atMs: 0, weight: 'downbeat', positionTicks: 0 },
        { atMs: 250, weight: 'division', positionTicks: Duration.QUARTER.ticks / 4 },
        { atMs: 500, weight: 'beat', positionTicks: Duration.QUARTER.ticks },
      ],
    });

    expect(clicksBefore(played, 400)).toBe(1);
    expect(clicksBefore(played, 400, 'divisions')).toBe(2);
  });

  it('hands over only the clicks the window has reached', () => {
    // Laid out in windows the way the notes are: a click has to be placed
    // before it sounds, and a whole run's worth at once could not be taken
    // back when the reader stops.
    const played = roll({
      beats: [
        { atMs: 1000, weight: 'downbeat', positionTicks: Duration.QUARTER.ticks * 1 },
        { atMs: 2000, weight: 'beat', positionTicks: Duration.QUARTER.ticks * 2 },
        { atMs: 3000, weight: 'beat', positionTicks: Duration.QUARTER.ticks * 3 },
      ],
    });

    // Measured from the roll's own beginning, which is its first event.
    expect(clicksUpTo(played, 0, 1100).map((beat) => beat.atMs)).toEqual([1000, 2000]);
  });

  it('does not hand the same click over twice', () => {
    const played = roll({
      beats: [
        { atMs: 0, weight: 'downbeat', positionTicks: Duration.QUARTER.ticks * 0 },
        { atMs: 1000, weight: 'beat', positionTicks: Duration.QUARTER.ticks * 1 },
      ],
    });

    expect(clicksUpTo(played, 1, 5000).map((beat) => beat.atMs)).toEqual([1000]);
  });

  it('counts a click due at this instant as still to come, not as spent', () => {
    // The two questions disagree on exactly the boundary, which is the whole of
    // it: counted the other way, a playback from the beginning spent the
    // downbeat before sounding it, and a tap on a bar line lost that bar's
    // click.
    const played = roll({
      beats: [
        { atMs: 0, weight: 'downbeat', positionTicks: Duration.QUARTER.ticks * 0 },
        { atMs: 1000, weight: 'beat', positionTicks: Duration.QUARTER.ticks * 1 },
        { atMs: 2000, weight: 'beat', positionTicks: Duration.QUARTER.ticks * 2 },
      ],
    });

    expect(clicksBefore(played, 0)).toBe(0);
    expect(clicksUpTo(played, 0, 0).map((beat) => beat.atMs)).toEqual([0]);
    expect(clicksBefore(played, 1000)).toBe(1);
    expect(clicksBefore(played, 1001)).toBe(2);
  });

  it('counts what is behind a moment, measured from where the roll began', () => {
    const played = roll({
      beats: [
        { atMs: 4000, weight: 'downbeat', positionTicks: Duration.QUARTER.ticks * 4 },
        { atMs: 5000, weight: 'beat', positionTicks: Duration.QUARTER.ticks * 5 },
      ],
    });

    expect(clicksBefore(played, 500)).toBe(1);
  });

  it('counts only the clicks it would sound, never the ones it skips', () => {
    // Otherwise the count of what has been handed over slides against the list
    // it indexes into, and every click after the first subdivision is wrong.
    const played = roll({
      beats: [
        { atMs: 0, weight: 'downbeat', positionTicks: Duration.QUARTER.ticks * 0 },
        { atMs: 250, weight: 'division', positionTicks: Duration.QUARTER.ticks * 0.25 },
        { atMs: 1000, weight: 'beat', positionTicks: Duration.QUARTER.ticks * 1 },
      ],
    });

    expect(clicksUpTo(played, 1, 5000).map((beat) => beat.atMs)).toEqual([1000]);
  });
});

describe('the roll a run leaves behind', () => {
  it('writes down what was played, with the verdicts the page was marked by', () => {
    const harness = createHarness({
      exercise: twoBarExercise({ tempoBpm: 60 }),
      mode: new FlowMode(),
      options: { countInBars: 0, clickWhen: 'always', click: 'pulse' },
    });
    harness.session.start();
    harness.metronome.advanceSubdivisions(1);
    const step = harness.session.currentStep;
    for (const note of step?.expectedMidi ?? []) {
      harness.midi.noteOn(note, harness.clock.now());
    }
    harness.midi.noteOff(MIDI.C4, harness.clock.now() + 200);

    const roll = harness.session.roll;
    expect(roll.presses.length).toBeGreaterThan(0);
    expect(roll.presses.map((press) => press.midi)).toEqual([...(step?.expectedMidi ?? [])]);
    expect(roll.presses.every((press) => press.verdict !== null)).toBe(true);
    // And the one key that was let go of is the only one with an end.
    expect(roll.presses.filter((press) => press.upAtMs !== null)).toHaveLength(1);
  });

  it('takes the pedal down, which the run itself has nothing to say about', () => {
    const harness = createHarness({
      exercise: twoBarExercise({ tempoBpm: 60 }),
      mode: new FlowMode(),
      options: { countInBars: 0 },
    });
    harness.session.start();
    harness.metronome.advanceSubdivisions(1);
    harness.midi.pedal(true, harness.clock.now());
    harness.midi.pedal(false, harness.clock.now() + 500);

    expect(harness.session.roll.pedal).toHaveLength(1);
  });

  it('forgets the run before it', () => {
    // The session outlives one run: a roll still carrying the last attempt
    // would draw two performances over one grid, which is the smudge the
    // whole design exists to avoid.
    const harness = createHarness({
      exercise: twoBarExercise({ tempoBpm: 60 }),
      mode: new FlowMode(),
      options: { countInBars: 0 },
    });
    harness.session.start();
    harness.metronome.advanceSubdivisions(1);
    harness.midi.noteOn(MIDI.C4, harness.clock.now());
    expect(harness.session.roll.presses).toHaveLength(1);

    // A session may be run again once it has been stopped, which is the one
    // way the same roll is asked to hold two performances.
    harness.session.abort();
    harness.session.start();

    expect(harness.session.roll.presses).toEqual([]);
  });

  it('draws its grid from the clicks of the music, not of the count', () => {
    // The count-in is heard before the music the grid is of, and a line there
    // would put a bar of nothing in front of the first note.
    const harness = createHarness({
      exercise: twoBarExercise({ tempoBpm: 60 }),
      mode: new FlowMode(),
      options: { countInBars: 1, clickWhen: 'always', click: 'pulse' },
    });
    harness.session.start();
    // The whole count, and the tick that ends it.
    harness.metronome.advanceSubdivisions(5);

    const roll = harness.session.roll;
    expect(roll.beats).toHaveLength(1);
    expect(roll.beats[0]?.atMs).toBe(Duration.WHOLE.ticks / Duration.QUARTER.ticks * 1000);
  });
});

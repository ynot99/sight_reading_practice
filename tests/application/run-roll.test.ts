import { describe, expect, it } from 'vitest';
import {
  RollRecorder,
  beatsWorthMarking,
  momentOfTicks,
  theGrid,
  theRushes,
  theWaits,
  theBeatNearest,
  theMusicsPlaceAt,
  theMusicsBeats,
  clicksBefore,
  clicksUpTo,
  rollAsEvents,
  rollBeganAtMs,
  rollEndedAtMs,
  rollOfTheTake,
  takeOfTheRun,
  type RolledBeat,
  type RolledPress,
  type RunRoll,
} from '../../src/application/session/RunRoll.js';
import { FlowMode } from '../../src/application/modes/FlowMode.js';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import type {
  MidiNoteOffEvent,
  MidiNoteOnEvent,
  MidiPedalEvent,
} from '../../src/application/ports/IMidiSource.js';
import type { NoteJudgedEvent } from '../../src/application/session/SessionEvents.js';
import type { Take } from '../../src/application/PerformanceRecorder.js';
import type { MidiFileEvent } from '../../src/domain/midi/MidiFile.js';
import type { BeatWeight } from '../../src/application/ports/IMetronome.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { MIDI, offBeatAfterALongNote, twoBarExercise } from '../support/fixtures.js';
import { createHarness } from '../support/harness.js';

function beatOf(atMs: number, weight: BeatWeight, positionTicks: number): RolledBeat {
  return { atMs, weight, positionTicks };
}

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
  return { presses: [], beats: [], pedal: [], rushes: [], truncated: false, ...over };
}

describe('where a run begins', () => {
  it('gives itself a beat even between the clicks the reader chose', () => {
    // A passage taken up partway through can begin where the click has nothing
    // to say, and without a beat of its own there is nothing for the reader's
    // first entry to be measured against - so the time they took to reach their
    // first note would not be in the picture at all.
    const { session } = createHarness({
      exercise: offBeatAfterALongNote({ tempoBpm: 60 }),
      mode: new WaitMode(),
      options: { startAtIndex: 2, clickWhen: 'with-me', countInBars: 0, click: 'pulse' },
    });
    session.start();

    // Written as a division, which is what a place the click does not mark is:
    // not drawn as a line of the grid, and there - which is all it has to be for
    // the reader's own entry to make a pair with it and a section out of it.
    expect(session.roll.beats.map((beat) => [beat.atMs, beat.weight])).toEqual([
      [0, 'division'],
    ]);
  });
});

describe('the stretches the music stood still in', () => {
  it('reads a wait off a pair of beats at one place, however fine they are', () => {
    // One shape of evidence for one mark: the music was at that place twice -
    // once when it fell due and once when the reader gave it - and the gap
    // between them is the waiting. A gate at a bar line leaves that pair, and so
    // does every entry of a frame that waits on each note.
    const roller = new RollRecorder();
    roller.beat(0, 'downbeat', 0);
    roller.beat(500, 'downbeat', 0);
    roller.beat(2_000, 'division', Duration.EIGHTH.ticks);
    roller.beat(2_400, 'division', Duration.EIGHTH.ticks);

    expect(theWaits(roller.roll())).toEqual([
      { fromMs: 0, untilMs: 500 },
      { fromMs: 2_000, untilMs: 2_400 },
    ]);
  });

  it('does not call a reader arriving promptly a wait', () => {
    // Every entry in a frame that waits is later than the beat it answers by
    // *something* - the reader is a hand and not a clock - so without a floor
    // the first beat of every counted-in run came out with a section on it. The
    // count had just told him where the beat was and he arrived eighty
    // milliseconds after it. His: "на початку гри є якась дивна жовта секція,
    // хоча звідки їй там взятись якщо це початок гри".
    const roller = new RollRecorder();
    roller.beat(4_000, 'downbeat', 0);
    roller.beat(4_080, 'downbeat', 0);

    expect(theWaits(roller.roll())).toEqual([]);
  });

  it('still draws a stretch the music really stood still for', () => {
    // The thing the section exists for, and the floor must not reach it. His,
    // when he asked for them: "якщо я просто чекаю, то весь цей час має просто
    // замальовуватись жовтою секцією".
    const roller = new RollRecorder();
    roller.beat(4_000, 'downbeat', 0);
    roller.beat(6_500, 'downbeat', 0);

    expect(theWaits(roller.roll())).toEqual([{ fromMs: 4_000, untilMs: 6_500 }]);
  });

  it('keeps a rush apart from a wait, having no width to draw', () => {
    // The music moved on when the reader played, so the stretch between where
    // they arrived and where the beat was due is time that never elapsed. There
    // is also no second beat at that place to measure against: the one they
    // overtook never fell.
    const roller = new RollRecorder();
    roller.rushed(1_600, 400);

    expect(theWaits(roller.roll())).toEqual([]);
    expect(theRushes(roller.roll())).toEqual([{ atMs: 1_600, byMs: 400 }]);
  });

  it('refuses a rush that says nothing', () => {
    // An arrival at the moment the music was ready is not early, and one the
    // music had already passed is a wait.
    const roller = new RollRecorder();
    roller.rushed(1_000, 0);
    roller.rushed(1_000, 2);
    roller.rushed(1_000, -50);

    expect(theRushes(roller.roll())).toEqual([]);
  });
});

describe('where in the music a moment of the run was', () => {
  it('reads it off the last beat written at or before that moment', () => {
    // A place in the picture is a time; a passage is a stretch of music. The
    // beats are the bridge, because each one carries the place it marks.
    const roller = new RollRecorder();
    roller.beat(0, 'downbeat', 0);
    roller.beat(1_000, 'beat', Duration.QUARTER.ticks);
    roller.beat(2_000, 'beat', Duration.QUARTER.ticks * 2);

    expect(theMusicsPlaceAt(roller.roll(), 1_400)).toBe(Duration.QUARTER.ticks);
    expect(theMusicsPlaceAt(roller.roll(), 2_000)).toBe(Duration.QUARTER.ticks * 2);
  });

  it('takes the last by moment, not the last written down', () => {
    // A bar line given late is written twice - where it fell due and where the
    // reader gave it - and those two arrive out of order.
    const roller = new RollRecorder();
    roller.beat(0, 'downbeat', 0);
    roller.beat(2_000, 'beat', Duration.QUARTER.ticks * 2);
    roller.beat(1_000, 'beat', Duration.QUARTER.ticks);

    expect(theMusicsPlaceAt(roller.roll(), 2_500)).toBe(Duration.QUARTER.ticks * 2);
  });

  it('says nothing about a moment in front of the music', () => {
    const roller = new RollRecorder();
    roller.beat(1_000, 'downbeat', 0);

    expect(theMusicsPlaceAt(roller.roll(), 500)).toBeNull();
  });
});

describe('taking back the beats the reader overtook', () => {
  it('keeps the moment itself and forgets what came after it', () => {
    // A waiting frame lays the beats between two entries out ahead of the
    // reader. Come in early and the music moves on from there, so the beats
    // still standing in the stretch they left never belonged to the run - while
    // one scheduled for the very instant they came in did sound.
    const roller = new RollRecorder();
    roller.beat(0, 'downbeat', 0);
    roller.beat(1000, 'beat', Duration.QUARTER.ticks);
    roller.beat(2000, 'beat', Duration.QUARTER.ticks * 2);
    roller.beat(3000, 'beat', Duration.QUARTER.ticks * 3);

    roller.forgetBeatsFrom(2000);

    expect(roller.roll().beats.map((beat) => beat.atMs)).toEqual([0, 1000, 2000]);
  });
});

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

  it('opens a pedal that was already down where the music began', () => {
    // The foot goes down and *then* the chord is played, which is how the
    // instrument is played - so the press that began the span can be older
    // than the run, and the lift that came later had nothing to close. The
    // whole span was dropped, and a pedal held through a run was drawn as one
    // never touched. His: "якщо я натискаю його рано, то воно показується що
    // воно з самого початку взагалі не було натиснуто".
    const roller = new RollRecorder();
    roller.pedalWasAlreadyDown(1000);
    roller.pedal(pedal(false, 1800));

    expect(roller.roll().pedal).toEqual([{ downAtMs: 1000, upAtMs: 1800 }]);
  });

  it('leaves a pedal already written down where the foot put it', () => {
    // Said twice - by a count-in and again by a run picked up after a pause -
    // it is still the one press, and its moment is the reader's own.
    const roller = new RollRecorder();
    roller.pedal(pedal(true, 900));
    roller.pedalWasAlreadyDown(1000);
    roller.pedal(pedal(false, 1800));

    expect(roller.roll().pedal).toEqual([{ downAtMs: 900, upAtMs: 1800 }]);
  });

  it('weighs a click by what it marks', () => {
    // The grid draws a downbeat heavier than a beat and a beat heavier than
    // what falls between them, so the weight travels with the moment.
    const roller = new RollRecorder();
    roller.beat(0, 'downbeat', 0);
    roller.beat(250, 'division', Duration.QUARTER.ticks / 4);
    roller.beat(500, 'beat', Duration.QUARTER.ticks);

    expect(roller.roll().beats.map((beat) => beat.weight)).toEqual([
      'downbeat',
      'division',
      'beat',
    ]);
  });

  it('forgets the last run when the next one begins', () => {
    const roller = new RollRecorder();
    roller.keyDown(down(MIDI.C4, 100));
    roller.beat(0, 'downbeat', 0);
    roller.rushed(100, 800);
    roller.pedal(pedal(true, 50));
    roller.reset();

    expect(roller.roll()).toEqual({
      presses: [],
      beats: [],
      pedal: [],
      rushes: [],
      truncated: false,
    });
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
      beats: [beatOf(4000, 'downbeat', Duration.QUARTER.ticks * 4)],
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
      beats: [beatOf(0, 'downbeat', Duration.QUARTER.ticks * 0), beatOf(3000, 'beat', Duration.QUARTER.ticks * 3)],
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
        beatOf(0, 'downbeat', Duration.QUARTER.ticks * 0),
        beatOf(250, 'division', Duration.QUARTER.ticks * 0.25),
        beatOf(500, 'beat', Duration.QUARTER.ticks * 0.5),
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
        beatOf(4000, 'downbeat', 0),
        beatOf(4120, 'downbeat', 0),
        beatOf(5000, 'beat', Duration.QUARTER.ticks),
      ],
    });

    const marked = beatsWorthMarking(played);
    expect(marked.map((beat) => beat.given)).toEqual([false, true, false]);
    expect(marked.map((beat) => beat.lateByMs)).toEqual([null, 120, null]);
  });

  it('keeps a bar line the reader gave at the coarsest reading of all', () => {
    // At that level it is half of what there is to see: where the bar fell and
    // where it was taken.
    const played = roll({
      beats: [
        beatOf(0, 'downbeat', 0),
        beatOf(180, 'downbeat', 0),
        beatOf(500, 'beat', Duration.QUARTER.ticks),
      ],
    });

    const bars = theGrid(played, { beats: false, parts: 1 });
    expect(bars.map((line) => line.atMs)).toEqual([0, 180]);
    expect(bars.map((line) => line.given)).toEqual([false, true]);
  });

  it('does not click a bar line the reader gave themselves', () => {
    // They played it, and heard it on their own instrument at the time. A
    // second click there is the machine agreeing rather than keeping time.
    const played = roll({
      beats: [
        beatOf(4000, 'downbeat', 0),
        beatOf(4120, 'downbeat', 0),
      ],
    });

    expect(theMusicsBeats(played).map((beat) => beat.atMs)).toEqual([4000]);
  });

  it('finds the beat nearest a moment, so a tap lands on the grid', () => {
    // A finger is worth about a tenth of a second at any readable zoom, and
    // nobody pointing at a run means a moment between two beats.
    const played = roll({
      beats: [
        beatOf(1000, 'downbeat', 0),
        beatOf(2000, 'beat', Duration.QUARTER.ticks),
        beatOf(3000, 'beat', Duration.QUARTER.ticks * 2),
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
        beatOf(0, 'downbeat', 0),
        beatOf(1000, 'beat', Duration.QUARTER.ticks),
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
        beatOf(0, 'downbeat', 0),
        beatOf(400, 'downbeat', 0),
      ],
    });

    expect(theBeatNearest(played, 380)).toBe(0);
  });

  it('cuts each beat into the parts that were asked for', () => {
    // Asked for rather than read off the run: every tick the pulse happened to
    // give was as fine as the shortest note in the piece, which put sixteen
    // lines in a bar and made the click a rattle.
    const played = roll({
      beats: [
        beatOf(0, 'downbeat', 0),
        beatOf(1000, 'beat', Duration.QUARTER.ticks),
      ],
    });

    expect(theGrid(played).map((line) => line.atMs)).toEqual([0, 1000]);
    expect(theGrid(played, { beats: true, parts: 2 }).map((line) => line.atMs)).toEqual([
      0, 500, 1000,
    ]);
    expect(theGrid(played, { beats: true, parts: 4 }).map((line) => line.atMs)).toEqual([
      0, 250, 500, 750, 1000,
    ]);
  });

  it('gives a cut line no place in the score, because it has none', () => {
    const played = roll({
      beats: [
        beatOf(0, 'downbeat', 0),
        beatOf(1000, 'beat', Duration.QUARTER.ticks),
      ],
    });

    const cut = theGrid(played, { beats: true, parts: 2 })[1];
    expect(cut?.positionTicks).toBeNull();
    expect(cut?.weight).toBe('division');
  });

  it('never cuts inside a wait', () => {
    // A quarter-beat line drawn in the middle of a bar line's waiting would be a
    // beat that never existed. The stretch cut is from where the first beat was
    // taken to where the second fell.
    const played = roll({
      beats: [
        beatOf(0, 'downbeat', 0),
        // Fell at 1000, taken at 1800.
        beatOf(1000, 'downbeat', Duration.QUARTER.ticks),
        beatOf(1800, 'downbeat', Duration.QUARTER.ticks),
        beatOf(2800, 'beat', Duration.QUARTER.ticks * 2),
      ],
    });

    const cuts = theGrid(played, { beats: true, parts: 2 })
      .filter((line) => line.positionTicks === null)
      .map((line) => line.atMs);
    // Halfway to where the bar line fell, then halfway from where it was taken.
    expect(cuts).toEqual([500, 2300]);
  });

  it('snaps to a cut line only where the grid is cut', () => {
    // Snapping to a line the reader cannot see would move the head somewhere
    // they had no way to mean.
    const played = roll({
      beats: [
        beatOf(0, 'downbeat', 0),
        beatOf(1000, 'beat', Duration.QUARTER.ticks),
      ],
    });

    expect(theBeatNearest(played, 460)).toBe(0);
    expect(theBeatNearest(played, 460, { beats: true, parts: 2 })).toBe(500);
  });

  it('counts the cut clicks as spent too', () => {
    const played = roll({
      beats: [
        beatOf(0, 'downbeat', 0),
        beatOf(1000, 'beat', Duration.QUARTER.ticks),
      ],
    });

    expect(clicksBefore(played, 600)).toBe(1);
    expect(clicksBefore(played, 600, { beats: true, parts: 2 })).toBe(2);
  });

  it('places a moment in the music between the clicks that happened', () => {
    // No tempo can join written time to real time: this is read off the clicks.
    const played = roll({
      beats: [
        beatOf(1000, 'downbeat', 0),
        beatOf(2000, 'beat', Duration.QUARTER.ticks),
      ],
    });

    // Measured from the roll's own beginning, which is its first click.
    expect(momentOfTicks(played, 0)).toBe(0);
    expect(momentOfTicks(played, Duration.QUARTER.ticks / 2)).toBe(500);
    expect(momentOfTicks(played, Duration.QUARTER.ticks)).toBe(1000);
  });

  it('gives a waited bar line two moments, one for each direction', () => {
    // Something beginning there began when the reader gave it; something ending
    // there was over when the beat fell due. One answer for both drew a note
    // ending on the bar line all the way to the end of the wait.
    const played = roll({
      beats: [
        beatOf(0, 'downbeat', 0),
        // The bar line fell at 1000 and was taken at 1400.
        beatOf(1000, 'downbeat', Duration.QUARTER.ticks),
        beatOf(1400, 'downbeat', Duration.QUARTER.ticks),
      ],
    });

    expect(momentOfTicks(played, Duration.QUARTER.ticks, 'starts')).toBe(1400);
    expect(momentOfTicks(played, Duration.QUARTER.ticks, 'ends')).toBe(1000);
    // And the stretch between two places is the music between them, which is
    // from where the first was taken to where the second fell - the waiting at
    // the far end is not part of it.
    expect(momentOfTicks(played, Duration.QUARTER.ticks / 2)).toBe(500);
  });

  it('runs on past the last click at the rate of the last stretch', () => {
    // The last bar's notes lie beyond the last click there is, and they have to
    // be drawn somewhere.
    const played = roll({
      beats: [
        beatOf(0, 'downbeat', 0),
        beatOf(1000, 'beat', Duration.QUARTER.ticks),
      ],
    });

    expect(momentOfTicks(played, Duration.QUARTER.ticks * 2)).toBe(2000);
  });

  it('says nothing where there are no clicks to measure between', () => {
    // A frame that runs no pulse has nothing to place anything against.
    expect(momentOfTicks(roll({}), 0)).toBeNull();

    // One click can answer about its own place and about nowhere else: there is
    // no second moment to measure a rate against.
    const only = roll({ beats: [beatOf(400, 'downbeat', 0)] });
    expect(momentOfTicks(only, 0)).toBe(0);
    expect(momentOfTicks(only, Duration.QUARTER.ticks)).toBeNull();
  });

  it('hands over only the clicks the window has reached', () => {
    // Laid out in windows the way the notes are: a click has to be placed
    // before it sounds, and a whole run's worth at once could not be taken
    // back when the reader stops.
    const played = roll({
      beats: [
        beatOf(1000, 'downbeat', Duration.QUARTER.ticks * 1),
        beatOf(2000, 'beat', Duration.QUARTER.ticks * 2),
        beatOf(3000, 'beat', Duration.QUARTER.ticks * 3),
      ],
    });

    // Measured from the roll's own beginning, which is its first event.
    expect(clicksUpTo(played, 0, 1100).map((beat) => beat.atMs)).toEqual([1000, 2000]);
  });

  it('does not hand the same click over twice', () => {
    const played = roll({
      beats: [
        beatOf(0, 'downbeat', Duration.QUARTER.ticks * 0),
        beatOf(1000, 'beat', Duration.QUARTER.ticks * 1),
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
        beatOf(0, 'downbeat', Duration.QUARTER.ticks * 0),
        beatOf(1000, 'beat', Duration.QUARTER.ticks * 1),
        beatOf(2000, 'beat', Duration.QUARTER.ticks * 2),
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
        beatOf(4000, 'downbeat', Duration.QUARTER.ticks * 4),
        beatOf(5000, 'beat', Duration.QUARTER.ticks * 5),
      ],
    });

    expect(clicksBefore(played, 500)).toBe(1);
  });

  it('counts only the clicks it would sound, never the ones it skips', () => {
    // Otherwise the count of what has been handed over slides against the list
    // it indexes into, and every click after the first subdivision is wrong.
    const played = roll({
      beats: [
        beatOf(0, 'downbeat', Duration.QUARTER.ticks * 0),
        beatOf(250, 'division', Duration.QUARTER.ticks * 0.25),
        beatOf(1000, 'beat', Duration.QUARTER.ticks * 1),
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

  it('takes a pedal put down over the count-in, from where the music begins', () => {
    // The count is not the run. Dated where the foot moved, a pedal put on at
    // the top of a two-bar count would hang two bars of empty drawing in front
    // of the first note to hold one band; down when the music began is the
    // whole of what the picture has to say about it.
    const harness = createHarness({
      exercise: twoBarExercise({ tempoBpm: 60 }),
      mode: new FlowMode(),
      options: { countInBars: 1 },
    });
    harness.session.start();
    harness.midi.pedal(true, 100);
    harness.metronome.advanceSubdivisions(5);
    harness.midi.pedal(false, 5000);

    const began = rollBeganAtMs(harness.session.roll);
    expect(harness.session.roll.pedal).toEqual([{ downAtMs: began, upAtMs: 5000 }]);
    expect(began).toBeGreaterThan(100);
  });

  it('does not put the pedal back down for a run picked up after a pause', () => {
    // The foot is followed through the run and not only up to its start. Lifted
    // and then paused over, a run that resumed still believed the pedal was
    // where it had been when the music began, and opened a second span at the
    // pick-up that no foot had asked for.
    const harness = createHarness({
      exercise: twoBarExercise({ tempoBpm: 60 }),
      mode: new FlowMode(),
      // Counted back in, which is where a resumed run writes its first beat
      // down again - and where it would put the foot back down with it.
      options: { countInBars: 1 },
    });
    harness.session.start();
    // Down before the music, which is the state the run is handed - and then
    // lifted inside it, so what the run was handed has stopped being true.
    harness.midi.pedal(true, 100);
    harness.metronome.advanceSubdivisions(5);
    harness.midi.pedal(false, 4_600);
    harness.session.pause();
    harness.session.resume();
    harness.metronome.advanceSubdivisions(5);

    const began = rollBeganAtMs(harness.session.roll);
    expect(harness.session.roll.pedal).toEqual([{ downAtMs: began, upAtMs: 4_600 }]);
  });

  it('takes no click placed after the run is over', () => {
    // The roll is what *this run* did, and a beat placed after it has ended
    // belongs to nothing. Said here rather than left to the callers: it is a
    // public way in, and the next caller has no way to know the rule.
    const harness = createHarness({
      exercise: twoBarExercise({ tempoBpm: 60 }),
      mode: new FlowMode(),
      options: { countInBars: 0 },
    });
    harness.session.start();
    harness.metronome.advanceSubdivisions(1);
    const during = harness.session.roll.beats.length;

    harness.session.abort();
    harness.session.writeDownAClick(harness.clock.now(), 'beat', 0);

    expect(harness.session.roll.beats).toHaveLength(during);
  });

  it('knows a beat it already has, by its place and its moment together', () => {
    // Same place at the same instant is one beat written down twice. A bar line
    // and the reader giving it late are the same place a *wait* apart, and that
    // pair is the whole of what the picture of a held bar is made of - so the
    // moment has to count as much as the place.
    const roller = new RollRecorder();
    roller.beat(1000, 'downbeat', 0);

    expect(roller.hasBeatAt(0, 1000)).toBe(true);
    expect(roller.hasBeatAt(0, 1004)).toBe(true);
    // A wait apart: a different beat, and the picture needs both.
    expect(roller.hasBeatAt(0, 1800)).toBe(false);
    // Same instant, elsewhere in the music: also a different beat.
    expect(roller.hasBeatAt(Duration.QUARTER.ticks, 1000)).toBe(false);
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

describe('a run kept with the recordings', () => {
  it('is the same kind of thing as anything else in the list', () => {
    // One player, one file format, one list: where a stream of notes came from
    // is not something the list has to know. His: "MIDI viewer - додати кнопку
    // щоб зберегти current performance як MIDI запис у список".
    const roller = new RollRecorder();
    roller.beat(0, 'downbeat', 0);
    roller.keyDown(down(MIDI.C4, 0));
    roller.keyUp(up(MIDI.C4, 400));

    const take = takeOfTheRun(roller.roll());

    expect(take?.noteCount).toBe(1);
    expect(take?.events[0]).toMatchObject({ kind: 'noteOn', atMs: 0, midi: MIDI.C4 });
    // A moment of air past the last thing that happened, the same length the
    // drawing gives it.
    expect(take?.durationMs).toBe(rollEndedAtMs(roller.roll()) - rollBeganAtMs(roller.roll()));
  });

  it('refuses a run with nothing played in it', () => {
    // The same rule the recorder keeps: a recording of no notes is not a
    // recording, whichever way in it was filed by.
    const roller = new RollRecorder();
    roller.beat(0, 'downbeat', 0);
    roller.pedal({
      type: 'pedal',
      pedal: 'sustain',
      down: true,
      value: 1,
      timestampMs: 0,
      sourceId: 'test',
    });

    expect(takeOfTheRun(roller.roll())).toBeNull();
  });

  it('counts from the run’s own beginning', () => {
    // A run begun a minute into the page's clock is not a minute long.
    const roller = new RollRecorder();
    roller.beat(60_000, 'downbeat', 0);
    roller.keyDown(down(MIDI.C4, 60_000));
    roller.keyUp(up(MIDI.C4, 60_400));

    const take = takeOfTheRun(roller.roll());

    expect(take?.events[0]?.atMs).toBe(0);
    expect(take?.durationMs).toBeLessThan(2_000);
  });
});

describe('a recording drawn by the same machinery', () => {
  /** A take as the list holds one: a stream of notes with times on it. */
  function takeOf(events: readonly MidiFileEvent[]): Take {
    return {
      events,
      durationMs: 2_000,
      noteCount: events.filter((event) => event.kind === 'noteOn').length,
    };
  }

  it('pairs each press with the release that ends it', () => {
    const roll = rollOfTheTake(
      takeOf([
        { kind: 'noteOn', atMs: 0, midi: MIDI.C4, velocity: 0.7 },
        { kind: 'noteOff', atMs: 300, midi: MIDI.C4 },
      ]),
    );

    expect(roll.presses).toEqual([
      {
        midi: MIDI.C4,
        downAtMs: 0,
        upAtMs: 300,
        velocity: 0.7,
        verdict: null,
        stepIndex: null,
        deviationMs: null,
      },
    ]);
  });

  it('releases the oldest press of a pitch, not the newest', () => {
    // A trill strikes one pitch twice inside a few hundred milliseconds, and
    // closing the newest leaves the first ringing to the end.
    const roll = rollOfTheTake(
      takeOf([
        { kind: 'noteOn', atMs: 0, midi: MIDI.C4, velocity: 0.7 },
        { kind: 'noteOn', atMs: 100, midi: MIDI.C4, velocity: 0.7 },
        { kind: 'noteOff', atMs: 150, midi: MIDI.C4 },
      ]),
    );

    expect(roll.presses.map((press) => press.upAtMs)).toEqual([150, null]);
  });

  it('draws the pedal as the spans it was held for', () => {
    const roll = rollOfTheTake(
      takeOf([
        { kind: 'sustain', atMs: 0, value: 1 },
        { kind: 'noteOn', atMs: 10, midi: MIDI.C4, velocity: 0.7 },
        { kind: 'sustain', atMs: 800, value: 0 },
        { kind: 'sustain', atMs: 900, value: 1 },
      ]),
    );

    // The last one is still down when the recording ends, and says so.
    expect(roll.pedal).toEqual([
      { downAtMs: 0, upAtMs: 800 },
      { downAtMs: 900, upAtMs: null },
    ]);
  });

  it('gives it no grid at all', () => {
    // Not an omission: a run has beats because something kept its time, and
    // free playing had nothing keeping it. Lines across it would be a metre
    // nobody played claiming to be the one that was. His: "without vertical
    // lines to indicate the beat, because the beat can be gibberish".
    const roll = rollOfTheTake(
      takeOf([{ kind: 'noteOn', atMs: 0, midi: MIDI.C4, velocity: 0.7 }]),
    );

    expect(roll.beats).toEqual([]);
    expect(roll.rushes).toEqual([]);
  });

  it('comes back out of a run the same as it went in', () => {
    // The two halves are one road: a run is kept, and the kept thing is looked
    // at with the drawing the run was looked at with.
    const roller = new RollRecorder();
    roller.beat(0, 'downbeat', 0);
    roller.keyDown(down(MIDI.C4, 0));
    roller.keyUp(up(MIDI.C4, 400));
    const take = takeOfTheRun(roller.roll());

    const again = take === null ? null : rollOfTheTake(take);

    expect(again?.presses.map((press) => [press.midi, press.downAtMs, press.upAtMs])).toEqual([
      [MIDI.C4, 0, 400],
    ]);
  });
});

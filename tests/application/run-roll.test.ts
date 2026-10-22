import { describe, expect, it } from 'vitest';
import {
  RollRecorder,
  beatsWorthMarking,
  momentOfTicks,
  theMomentsOfTicks,
  theGrid,
  theRushes,
  theWaits,
  theBeatNearest,
  theBarsAcross,
  takeWithThePlayingRecorded,
  theNotesRecorded,
  theNextLineOfTheGrid,
  theLineOfTheGridUnder,
  theEndAKeyFitsTo,
  aKeyIsOverAnotherOfItsPitch,
  PLAIN_GRID,
  theMusicsPlaceAt,
  theMusicsBeats,
  clicksBefore,
  clicksUpTo,
  rollAsEvents,
  rollBeganAtMs,
  rollEndedAtMs,
  rollOfTheScore,
  rollOfTheTake,
  barsCountedOnItsBeats,
  takeOfTheRun,
  takeWithoutTheKeys,
  takeWithTheKeysChanged,
  takeWithTheKeysCopied,
  takeWithTheKeyCut,
  takeWithTheNotesPasted,
  takeWithTheChordsBroken,
  theKeysInTurn,
  theClipboardTextOf,
  theClipboardTextOfTheChange,
  theChangeOnTheClipboard,
  theNotesCopied,
  theNotesOnTheClipboard,
  takeWithThePedalAt,
  theKeysOnTheGrid,
  theKeysHumanized,
  HUMANIZED_SHADE_AT_MOST,
  HUMANIZED_BY_AT_MOST,
  takeWithAKeyAdded,
  theKeysOfTheTake,
  type RolledBeat,
  type RolledPress,
  type RunRoll,
} from '../../src/application/session/RunRoll.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { FlowMode } from '../../src/application/modes/FlowMode.js';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import type {
  MidiNoteOffEvent,
  MidiNoteOnEvent,
  MidiPedalEvent,
} from '../../src/application/ports/IMidiSource.js';
import type { NoteJudgedEvent } from '../../src/application/session/SessionEvents.js';
import type { Take } from '../../src/application/PerformanceRecorder.js';
import { inTheOrderPlayed, type MidiFileEvent } from '../../src/domain/midi/MidiFile.js';
import type { BeatWeight } from '../../src/application/ports/IMetronome.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { MIDI, offBeatAfterALongNote, twoBarExercise, unisonInTwoVoices } from '../support/fixtures.js';
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
    atMs: 0,
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

  it('records playing into a take from a moment, over what is there, its pedal with it, letting go of what was still down', () => {
    const there: MidiFileEvent[] = [
      { kind: 'noteOn', atMs: 1_000, midi: MIDI.C4, velocity: 0.5 },
      { kind: 'noteOff', atMs: 1_400, midi: MIDI.C4 },
    ];
    const played: MidiFileEvent[] = [
      // A little before its nought, as a downbeat is often struck.
      { kind: 'noteOn', atMs: -30, midi: MIDI.E4, velocity: 0.8 },
      { kind: 'sustain', atMs: 0, value: 1 },
      // Over the C already there: left out.
      { kind: 'noteOn', atMs: 50, midi: MIDI.C4, velocity: 0.6 },
      { kind: 'noteOff', atMs: 200, midi: MIDI.C4 },
      { kind: 'noteOff', atMs: 300, midi: MIDI.E4 },
      { kind: 'sustain', atMs: 350, value: 0 },
      // Still down when it stopped.
      { kind: 'noteOn', atMs: 450, midi: MIDI.G4, velocity: 0.7 },
      { kind: 'sustain', atMs: 500, value: 1 },
    ];
    const { events, pasted } = takeWithThePlayingRecorded(there, played, 1_000, 600);
    expect(pasted).toEqual([
      { midi: MIDI.E4, downAtMs: 970 },
      { midi: MIDI.G4, downAtMs: 1_450 },
    ]);
    expect(events).toEqual([
      { kind: 'noteOn', atMs: 970, midi: MIDI.E4, velocity: 0.8 },
      { kind: 'sustain', atMs: 1_000, value: 1 },
      { kind: 'noteOn', atMs: 1_000, midi: MIDI.C4, velocity: 0.5 },
      { kind: 'noteOff', atMs: 1_300, midi: MIDI.E4 },
      { kind: 'sustain', atMs: 1_350, value: 0 },
      { kind: 'noteOff', atMs: 1_400, midi: MIDI.C4 },
      { kind: 'noteOn', atMs: 1_450, midi: MIDI.G4, velocity: 0.7 },
      { kind: 'sustain', atMs: 1_500, value: 1 },
      { kind: 'noteOff', atMs: 1_600, midi: MIDI.G4 },
      { kind: 'sustain', atMs: 1_600, value: 0 },
    ]);
    // Somewhere the C is free, it goes in; with the pedal let go of, nothing is added for it.
    const later = takeWithThePlayingRecorded(there, played.slice(0, 6), 3_000, 600);
    expect(later.pasted.map((key) => key.midi)).toEqual([MIDI.E4, MIDI.C4]);
    expect(later.events.filter((event) => event.kind === 'sustain')).toHaveLength(2);
    // Nothing played, nothing changes.
    expect(takeWithThePlayingRecorded(there, [], 3_000, 600)).toEqual({ events: there, pasted: [] });
    // Held into a C already there, it ends where that one begins, as a key struck again ends the note before.
    const held: MidiFileEvent[] = [
      { kind: 'noteOn', atMs: 0, midi: MIDI.C4, velocity: 0.6 },
      { kind: 'noteOff', atMs: 900, midi: MIDI.C4 },
    ];
    expect(theNotesRecorded(there, held, 700, 1_200)).toEqual([{ afterMs: 0, lengthMs: 300, midi: MIDI.C4, velocity: 0.6 }]);
    expect(takeWithThePlayingRecorded(there, held, 700, 1_200).pasted).toEqual([{ midi: MIDI.C4, downAtMs: 700 }]);
    // Struck on the moment one ends, it begins there; struck the moment one begins, it is left out.
    expect(theNotesRecorded(there, held, 1_400, 2_000).map((note) => note.lengthMs)).toEqual([900]);
    expect(theNotesRecorded(there, held, 1_000, 2_000)).toEqual([]);
    // Still down, as far as the moment it has got to, and no further than the next of its pitch.
    const down: MidiFileEvent[] = [{ kind: 'noteOn', atMs: 100, midi: MIDI.C4, velocity: 0.6 }];
    expect(theNotesRecorded(there, down, 0, 500).map((note) => [note.afterMs, note.lengthMs])).toEqual([[100, 400]]);
    expect(theNotesRecorded(there, down, 0, 5_000).map((note) => note.lengthMs)).toEqual([900]);
    // A key still down in what is there sounds on: one struck after it is left out.
    expect(theNotesRecorded([{ kind: 'noteOn', atMs: 0, midi: MIDI.C4, velocity: 0.5 }], down, 0, 500)).toEqual([]);
  });

  it('slices whole bars between two moments, either way round, across the whole run', () => {
    // Two bars of 4/4 at 120, a note through them.
    const run = rollOfTheTake({
      events: [
        { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5 },
        { kind: 'noteOff', atMs: 3_900, midi: 60 },
      ],
      beats: [0, 500, 1_000, 1_500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
    });
    expect(theMusicsBeats(run, { beats: false, parts: 1 }).map((line) => line.atMs - rollBeganAtMs(run))).toEqual([0, 2_000, 4_000]);
    const barOf = (at: number): number => (at < 2_000 - 1 ? 0 : 1);
    for (let one = 0; one < 4_000; one += 125) {
      for (let other = 0; other < 4_000; other += 375) {
        const first = Math.min(barOf(one), barOf(other));
        const last = Math.max(barOf(one), barOf(other));
        expect(theBarsAcross(run, one, other), `${String(one)} ${String(other)}`).toEqual({ fromMs: first * 2_000, toMs: (last + 1) * 2_000 });
      }
    }
    // A moment a hair before a bar line, in whole milliseconds, is on it.
    expect(theBarsAcross(run, 1_999.6, 1_999.6)).toEqual({ fromMs: 2_000, toMs: 4_000 });
    // Past the last bar line it ends where the run does.
    expect(theBarsAcross(run, 4_100, 4_100)).toEqual({ fromMs: 4_000, toMs: rollEndedAtMs(run) - rollBeganAtMs(run) });
    // With no bars, from the earlier moment to the end.
    const free = rollOfTheTake({
      events: [
        { kind: 'noteOn', atMs: 500, midi: 60, velocity: 0.5 },
        { kind: 'noteOff', atMs: 3_000, midi: 60 },
      ],
      beats: [],
    });
    // Its end measured, as every moment here is, from its own beginning.
    expect(theBarsAcross(free, 2_000, 700)).toEqual({ fromMs: 700, toMs: rollEndedAtMs(free) - 500 });
  });

  it('steps to the next line of the grid either way, from a line or from between two, across the whole run', () => {
    // Four beats of a click at 120, and a note on the first so the run has them.
    const run = rollOfTheTake({
      events: [
        { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5 },
        { kind: 'noteOff', atMs: 1_900, midi: 60 },
      ],
      beats: [0, 500, 1_000, 1_500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
    });
    const lines = theMusicsBeats(run, PLAIN_GRID).map((line) => line.atMs - rollBeganAtMs(run));
    // And the bar line the last beat ends on.
    expect(lines).toEqual([0, 500, 1_000, 1_500, 2_000]);
    for (let at = -100; at <= 2_200; at += 25) {
      const after = lines.filter((line) => line > at + 0.5);
      const before = lines.filter((line) => line < at - 0.5);
      expect(theNextLineOfTheGrid(run, at, PLAIN_GRID, 1), `${String(at)} on`).toBe(after.length === 0 ? null : Math.min(...after));
      expect(theNextLineOfTheGrid(run, at, PLAIN_GRID, -1), `${String(at)} back`).toBe(before.length === 0 ? null : Math.max(...before));
    }
    // A note put on a line in whole milliseconds is on it, not beside it.
    expect(theNextLineOfTheGrid(run, 500.4, PLAIN_GRID, 1)).toBe(1_000);
    expect(theNextLineOfTheGrid(run, 499.6, PLAIN_GRID, 1)).toBe(1_000);
    expect(theNextLineOfTheGrid(run, 499.6, PLAIN_GRID, -1)).toBe(0);
    expect(theNextLineOfTheGrid(run, 500.4, PLAIN_GRID, -1)).toBe(0);
    // Cut finer, it steps by the parts.
    expect(theNextLineOfTheGrid(run, 500, { beats: true, parts: 2 }, 1)).toBe(750);
  });

  it('finds the cell of the grid a moment is in: the line at or before it, across the whole run', () => {
    const run = rollOfTheTake({
      events: [
        { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5 },
        { kind: 'noteOff', atMs: 1_900, midi: 60 },
      ],
      beats: [0, 500, 1_000, 1_500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
    });
    for (let at = 0; at <= 2_200; at += 25) {
      expect(theLineOfTheGridUnder(run, at, PLAIN_GRID), String(at)).toBe(Math.min(2_000, Math.floor(at / 500) * 500));
    }
    // Half a millisecond short of a line is on it; before the first line, the moment itself.
    expect(theLineOfTheGridUnder(run, 999.6, PLAIN_GRID)).toBe(1_000);
    expect(theLineOfTheGridUnder(run, 999.4, PLAIN_GRID)).toBe(500);
    expect(theLineOfTheGridUnder(run, -40, PLAIN_GRID)).toBe(-40);
  });

  it('lets a key be written only where none of its pitch is, cut short where the next begins', () => {
    // One of 62 from 1000 to 1500, one of 64 there too, and one of 62 never let go of from 3000.
    const events: MidiFileEvent[] = [
      { kind: 'noteOn', atMs: 1_000, midi: 62, velocity: 0.5 },
      { kind: 'noteOn', atMs: 1_000, midi: 64, velocity: 0.5 },
      { kind: 'noteOff', atMs: 1_500, midi: 62 },
      { kind: 'noteOff', atMs: 1_500, midi: 64 },
      { kind: 'noteOn', atMs: 3_000, midi: 62, velocity: 0.5 },
    ];
    // A beat long, begun at every moment across them.
    for (let down = 0; down <= 3_400; down += 50) {
      const asked = { midi: 62, downAtMs: down, upAtMs: down + 500 };
      const inside = (down >= 1_000 && down < 1_500) || down >= 3_000;
      const expected = inside ? null : Math.min(down + 500, down < 1_000 ? 1_000 : 3_000);
      expect(theEndAKeyFitsTo(events, asked), String(down)).toBe(expected);
    }
    // Another pitch is no matter.
    expect(theEndAKeyFitsTo(events, { midi: 63, downAtMs: 1_000, upAtMs: 1_500 })).toBe(1_500);
    // Cut to nothing is not written: a note may not end where it begins.
    expect(theEndAKeyFitsTo(events, { midi: 62, downAtMs: 1_000, upAtMs: 1_000 })).toBeNull();
    expect(theEndAKeyFitsTo([], { midi: 62, downAtMs: 1_000, upAtMs: 1_000 })).toBeNull();
  });

  it('says a key moved is over another of its pitch only where the two sound together, swept across it', () => {
    const still: MidiFileEvent[] = [
      { kind: 'noteOn', atMs: 1_000, midi: 62, velocity: 0.5 },
      { kind: 'noteOff', atMs: 1_500, midi: 62 },
    ];
    const withAMoved = (down: number, midi = 62): MidiFileEvent[] => [
      ...still,
      { kind: 'noteOn', atMs: down, midi, velocity: 0.5 },
      { kind: 'noteOff', atMs: down + 500, midi },
    ];
    for (let down = 0; down <= 2_000; down += 25) {
      // Touching end to start is not over; any more is - begun on it above all.
      expect(aKeyIsOverAnotherOfItsPitch(withAMoved(down), [{ midi: 62, downAtMs: down }]), String(down)).toBe(
        down < 1_500 && down + 500 > 1_000,
      );
    }
    // Another pitch is never over it.
    expect(aKeyIsOverAnotherOfItsPitch(withAMoved(1_200, 64), [{ midi: 64, downAtMs: 1_200 }])).toBe(false);
    // Two named are not asked of each other, and a pair over each other that is not named is no matter.
    expect(aKeyIsOverAnotherOfItsPitch(withAMoved(1_200), [{ midi: 62, downAtMs: 1_200 }, { midi: 62, downAtMs: 1_000 }])).toBe(false);
    expect(aKeyIsOverAnotherOfItsPitch([...withAMoved(1_200), ...withAMoved(3_000, 70).slice(2)], [{ midi: 70, downAtMs: 3_000 }])).toBe(
      false,
    );
    // A key never let go of sounds on to the end.
    const open: MidiFileEvent[] = [{ kind: 'noteOn', atMs: 0, midi: 62, velocity: 0.5 }, ...withAMoved(5_000).slice(2)];
    expect(aKeyIsOverAnotherOfItsPitch(open, [{ midi: 62, downAtMs: 5_000 }])).toBe(true);
    expect(aKeyIsOverAnotherOfItsPitch(open, [{ midi: 62, downAtMs: 0 }])).toBe(true);
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

  it('places every position of a long run between the right pair of clicks, before the first and past the last as well', () => {
    // Forty clicks a beat apart, beginning a beat in, the pace going back and
    // forth - four tenths of a second, then six: swept a seventh of a beat at
    // a time from before the first to past the last, every place is as far
    // between the two clicks either side of it as it is between them in the
    // music, and outside them, on at the pace of the nearest two.
    const QUARTER = Duration.QUARTER.ticks;
    const clicks = Array.from({ length: 40 }, (_, at) => ({
      atMs: 1_000 + Math.floor(at / 2) * 1_000 + (at % 2) * 400,
      positionTicks: (at + 1) * QUARTER,
    }));
    const played = roll({
      beats: clicks.map((click, at) => beatOf(click.atMs, at === 0 ? 'downbeat' : 'beat', click.positionTicks)),
    });
    const origin = (momentOfTicks(played, QUARTER) ?? Number.NaN) - 1_000;
    const momentOf = theMomentsOfTicks(played);
    for (let position = 0; position <= 42 * QUARTER; position += QUARTER / 7) {
      // The first click past it, or the last where none is; and never the first, which has none before it.
      const past = clicks.findIndex((click) => click.positionTicks > position);
      const to = Math.max(1, past === -1 ? clicks.length - 1 : past);
      const [from, until] = [clicks[to - 1], clicks[to]];
      const expected =
        origin +
        (from?.atMs ?? 0) +
        ((position - (from?.positionTicks ?? 0)) * ((until?.atMs ?? 0) - (from?.atMs ?? 0))) / QUARTER;
      expect(momentOf(position) ?? Number.NaN).toBeCloseTo(expected, 6);
      expect(momentOfTicks(played, position, 'ends') ?? Number.NaN).toBeCloseTo(expected, 6);
    }
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
      beats: [],
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

  it('gives it the beats of the click it was played to, from the first of its first bar, and its bars a count of their own', () => {
    // Bars of three, 500 ms a beat; the playing begins on the third beat of a
    // bar and goes on past the last beat heard.
    const roll = rollOfTheTake({
      ...takeOf([
        { kind: 'noteOn', atMs: 0, midi: MIDI.C4, velocity: 0.7 },
        { kind: 'noteOff', atMs: 2_100, midi: MIDI.C4 },
      ]),
      beats: [-1_000, -500, 0, 500, 1_000].map((atMs, at) => ({ atMs, beat: at % 3, beatsInBar: 3 })),
    });

    expect(roll.beats).toEqual(
      [-1_000, -500, 0, 500, 1_000, 1_500, 2_000, 2_500].map((atMs, at) => ({
        atMs,
        weight: at % 3 === 0 ? 'downbeat' : 'beat',
        positionTicks: at * Duration.QUARTER.ticks,
      })),
    );
    const name = barsCountedOnItsBeats(roll);
    expect([0, 3, 6, 1].map((at) => name(at * Duration.QUARTER.ticks))).toEqual(['1', '2', '3', null]);
  });

  it('places the beats of a click by their own value', () => {
    const roll = rollOfTheTake({
      events: [
        { kind: 'noteOn', atMs: 0, midi: MIDI.C4, velocity: 0.7 },
        { kind: 'noteOff', atMs: 600, midi: MIDI.C4 },
      ],
      beats: [0, 250, 500].map((atMs, at) => ({ atMs, beat: at, beatsInBar: 6, beatType: 8 })),
    });

    expect(roll.beats.map((beat) => beat.positionTicks)).toEqual([0, 1, 2, 3].map((at) => at * Duration.EIGHTH.ticks));
  });

  it('gives it no grid at all where it was played without the click', () => {
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

describe('the roll of a score', () => {
  it('draws the notes of the exercise as correct and timed from the tempo', () => {
    const exercise = twoBarExercise({ tempoBpm: 60 });
    const timeline = buildTimeline(exercise);
    const roll = rollOfTheScore(exercise, timeline);

    expect(roll.presses.length).toBeGreaterThan(0);
    expect(roll.presses.every((press) => press.verdict === 'correct')).toBe(true);
    expect(roll.presses.every((press) => press.deviationMs === null)).toBe(true);
    expect(roll.presses.every((press) => press.stepIndex !== null)).toBe(true);
    // At 60 bpm, C4 quarter note lasts 1000ms, C3 whole note lasts 4000ms
    const c4 = roll.presses.find((press) => press.midi === MIDI.C4);
    const c3 = roll.presses.find((press) => press.midi === MIDI.C3);
    expect(c4?.downAtMs).toBe(0);
    expect(c4?.upAtMs).toBe(1_000);
    expect(c3?.downAtMs).toBe(0);
    expect(c3?.upAtMs).toBe(4_000);
  });

  it('marks every beat of every measure in the exercise', () => {
    const exercise = twoBarExercise({ tempoBpm: 60 });
    const timeline = buildTimeline(exercise);
    const roll = rollOfTheScore(exercise, timeline);

    // 2 bars of 4/4 = 8 beats
    expect(roll.beats.length).toBe(8);
    expect(roll.beats[0]).toEqual({ atMs: 0, weight: 'downbeat', positionTicks: 0 });
    expect(roll.beats[1]).toEqual({ atMs: 1_000, weight: 'beat', positionTicks: Duration.QUARTER.ticks });
    expect(roll.beats[4]).toEqual({ atMs: 4_000, weight: 'downbeat', positionTicks: Duration.QUARTER.ticks * 4 });
  });

  it('draws a unison as one press, as long as the longer of its voices', () => {
    const exercise = unisonInTwoVoices({ tempoBpm: 60 });
    const roll = rollOfTheScore(exercise, buildTimeline(exercise));

    const struck = roll.presses.filter((press) => press.midi === MIDI.C4 && press.downAtMs === 0);
    expect(struck.map((press) => press.upAtMs)).toEqual([2_000]);
  });

  it('converts pedal marks into pedal spans', () => {
    const exercise = {
      ...twoBarExercise({ tempoBpm: 60 }),
      pedalMarks: [
        { measureIndex: 0, offsetTicks: 0, type: 'start' as const, line: true },
        { measureIndex: 1, offsetTicks: 0, type: 'stop' as const, line: true },
      ],
    };
    const timeline = buildTimeline(exercise);
    const roll = rollOfTheScore(exercise, timeline);

    expect(roll.pedal).toEqual([{ downAtMs: 0, upAtMs: 4_000 }]);
  });
});


describe('changing a recording', () => {
  const on = (atMs: number, midi: number): MidiFileEvent => ({ kind: 'noteOn', atMs, midi, velocity: 0.7 });
  const off = (atMs: number, midi: number): MidiFileEvent => ({ kind: 'noteOff', atMs, midi });

  it('pairs each key with the release of the oldest press of its pitch still down', () => {
    const events = [on(0, MIDI.C4), on(100, MIDI.C4), on(120, MIDI.E4), off(150, MIDI.C4), off(300, MIDI.C4)];

    expect(theKeysOfTheTake(events).map(({ midi, downAtMs, upAtMs, on: down, off: up }) => [midi, downAtMs, upAtMs, down, up])).toEqual([
      [MIDI.C4, 0, 150, 0, 3],
      [MIDI.C4, 100, 300, 1, 4],
      [MIDI.E4, 120, null, 2, null],
    ]);
  });

  it('takes keys out, each its press and its release, and leaves every other alone', () => {
    const pedal: MidiFileEvent = { kind: 'sustain', atMs: 50, value: 1 };
    const events = [on(0, MIDI.C4), pedal, on(100, MIDI.C4), off(150, MIDI.C4), on(200, MIDI.E4), off(300, MIDI.C4)];

    // The second C, which is let go of last: the pairing the drawing has.
    expect(takeWithoutTheKeys(events, [{ midi: MIDI.C4, downAtMs: 100 }])).toEqual([
      on(0, MIDI.C4),
      pedal,
      off(150, MIDI.C4),
      on(200, MIDI.E4),
    ]);
    // A key still down at the end has no release to take; and two at once.
    expect(
      takeWithoutTheKeys(events, [
        { midi: MIDI.E4, downAtMs: 200 },
        { midi: MIDI.C4, downAtMs: 0 },
      ]),
    ).toEqual([pedal, on(100, MIDI.C4), off(300, MIDI.C4)]);
  });

  it('takes out nothing where any key named is not there, and the only key as well as any', () => {
    const events = [on(0, MIDI.C4), off(150, MIDI.C4), on(200, MIDI.E4), off(300, MIDI.E4)];

    expect(takeWithoutTheKeys(events, [{ midi: MIDI.C4, downAtMs: 1 }])).toBeNull();
    expect(
      takeWithoutTheKeys(events, [
        { midi: MIDI.C4, downAtMs: 0 },
        { midi: MIDI.D4, downAtMs: 0 },
      ]),
    ).toBeNull();
    // A sketch may be emptied, to be written again.
    expect(takeWithoutTheKeys([on(0, MIDI.C4), off(150, MIDI.C4)], [{ midi: MIDI.C4, downAtMs: 0 }])).toEqual([]);
  });

  it('changes keys all at once, press and release, in their places in time', () => {
    const pedal: MidiFileEvent = { kind: 'sustain', atMs: 50, value: 1 };
    const events = [on(0, MIDI.C4), pedal, off(150, MIDI.C4), on(200, MIDI.E4), off(300, MIDI.E4)];

    // The C past the E and a tone higher, and the E where the C was, held
    // longer: each found where it was, though the other has moved there.
    expect(
      takeWithTheKeysChanged(events, [
        { key: { midi: MIDI.C4, downAtMs: 0 }, midi: MIDI.D4, downAtMs: 250, upAtMs: 400 },
        { key: { midi: MIDI.E4, downAtMs: 200 }, midi: MIDI.E4, downAtMs: 0, upAtMs: 500 },
      ]),
    ).toEqual([on(0, MIDI.E4), pedal, on(250, MIDI.D4), off(400, MIDI.D4), off(500, MIDI.E4)]);
  });

  it('lets a key still down at the end go where asked, or leaves it down', () => {
    const events = [on(0, MIDI.C4), on(100, MIDI.E4), off(200, MIDI.E4)];
    const c = { midi: MIDI.C4, downAtMs: 0 };

    expect(takeWithTheKeysChanged(events, [{ key: c, midi: MIDI.C4, downAtMs: 0, upAtMs: 150 }])).toEqual([
      on(0, MIDI.C4),
      on(100, MIDI.E4),
      off(150, MIDI.C4),
      off(200, MIDI.E4),
    ]);
    expect(takeWithTheKeysChanged(events, [{ key: c, midi: MIDI.D4, downAtMs: 50, upAtMs: null }])).toEqual([
      on(50, MIDI.D4),
      on(100, MIDI.E4),
      off(200, MIDI.E4),
    ]);
  });

  it('gives a key to a hand, back to its pitch, or leaves its hand as it was', () => {
    const handed: MidiFileEvent = { kind: 'noteOn', atMs: 0, midi: MIDI.C4, velocity: 0.7, hand: 'left' };
    const events = [handed, off(300, MIDI.C4), on(500, MIDI.E4), off(800, MIDI.E4)];
    const c = { key: { midi: MIDI.C4, downAtMs: 0 }, midi: MIDI.C4, downAtMs: 0, upAtMs: 300 };
    const e = { key: { midi: MIDI.E4, downAtMs: 500 }, midi: MIDI.E4, downAtMs: 500, upAtMs: 800 };

    expect(theKeysOfTheTake(events).map((key) => key.hand)).toEqual(['left', undefined]);
    expect(rollOfTheTake({ events, beats: [] }).presses.map((press) => press.hand)).toEqual(['left', undefined]);
    expect(takeWithTheKeysChanged(events, [{ ...e, hand: 'right' }])?.[2]).toEqual({ ...on(500, MIDI.E4), hand: 'right' });
    expect(takeWithTheKeysChanged(events, [{ ...c, hand: null }])?.[0]).toEqual(on(0, MIDI.C4));
    expect(takeWithTheKeysChanged(events, [{ ...c, downAtMs: 100, upAtMs: 400 }])?.[0]).toEqual({ ...handed, atMs: 100 });
  });

  it('changes nothing where any key named is not there', () => {
    const events = [on(0, MIDI.C4), off(150, MIDI.C4)];

    expect(
      takeWithTheKeysChanged(events, [
        { key: { midi: MIDI.C4, downAtMs: 0 }, midi: MIDI.D4, downAtMs: 0, upAtMs: 150 },
        { key: { midi: MIDI.C4, downAtMs: 1 }, midi: MIDI.D4, downAtMs: 9, upAtMs: 150 },
      ]),
    ).toBeNull();
  });

  it('adds a key, struck and let go of, in its place in time', () => {
    const events = [on(0, MIDI.C4), off(500, MIDI.C4), on(500, MIDI.E4), off(1_000, MIDI.E4)];

    expect(takeWithAKeyAdded(events, { midi: MIDI.D4, downAtMs: 250, upAtMs: 500, velocity: 0.5 })).toEqual([
      on(0, MIDI.C4),
      { kind: 'noteOn', atMs: 250, midi: MIDI.D4, velocity: 0.5 },
      off(500, MIDI.C4),
      off(500, MIDI.D4),
      on(500, MIDI.E4),
      off(1_000, MIDI.E4),
    ]);
  });

  it('copies keys beside themselves, as loud and in the same hand, those copied staying', () => {
    const handed = { ...on(0, MIDI.C4), velocity: 0.25, hand: 'left' as const };
    const events = [handed, off(400, MIDI.C4), on(500, MIDI.E4), on(500, MIDI.G4), off(900, MIDI.G4)];
    const c = { midi: MIDI.C4, downAtMs: 0 };
    const e = { midi: MIDI.E4, downAtMs: 500 };

    expect(takeWithTheKeysCopied(events, [c], 1_000, 12)).toEqual([
      handed,
      off(400, MIDI.C4),
      on(500, MIDI.E4),
      on(500, MIDI.G4),
      off(900, MIDI.G4),
      { ...handed, atMs: 1_000, midi: MIDI.C5 },
      off(1_400, MIDI.C5),
    ]);
    // One still down at the end is copied still down.
    const sharp = MIDI.E4 + 2;
    expect(takeWithTheKeysCopied(events, [e], 0, 2)?.filter((event) => (event.kind === 'noteOn' || event.kind === 'noteOff') && event.midi === sharp)).toEqual([on(500, sharp)]);
    expect(takeWithTheKeysCopied(events, [c, { midi: MIDI.C4, downAtMs: 1 }], 1_000, 0)).toBeNull();
  });

  it('copies keys as notes from the first of them, earliest first, those still down left out', () => {
    const handed = { ...on(300, MIDI.G4), velocity: 0.25, hand: 'left' as const };
    const events = inTheOrderPlayed([
      on(100, MIDI.E4),
      off(200, MIDI.E4),
      handed,
      off(700, MIDI.G4),
      on(300, MIDI.C4),
      off(500, MIDI.C4),
      on(400, MIDI.D4),
      on(900, MIDI.F4),
      off(950, MIDI.F4),
    ]);
    // The F not named; the D still down at the end.
    const named = [
      { midi: MIDI.G4, downAtMs: 300 },
      { midi: MIDI.C4, downAtMs: 300 },
      { midi: MIDI.D4, downAtMs: 400 },
      { midi: MIDI.E4, downAtMs: 100 },
    ];

    expect(theNotesCopied(events, named)).toEqual([
      { afterMs: 0, lengthMs: 100, midi: MIDI.E4, velocity: 0.7 },
      { afterMs: 200, lengthMs: 200, midi: MIDI.C4, velocity: 0.7 },
      { afterMs: 200, lengthMs: 400, midi: MIDI.G4, velocity: 0.25, hand: 'left' },
    ]);
  });

  it('keeps how loud a key is written where it is moved, takes it away where asked, and draws it on the roll', () => {
    const events = inTheOrderPlayed([
      { kind: 'noteOn', atMs: 0, midi: MIDI.C4, velocity: 0.5, loudness: { level: 'mp', shade: 20 } },
      off(200, MIDI.C4),
      { kind: 'noteOn', atMs: 0, midi: MIDI.E4, velocity: 0.5, loudness: { level: null, shade: 0 } },
      off(200, MIDI.E4),
      { kind: 'dynamic', atMs: 0, level: 'pp' },
    ]);
    const moved = takeWithTheKeysChanged(events, [{ key: { midi: MIDI.C4, downAtMs: 0 }, midi: MIDI.D4, downAtMs: 100, upAtMs: 300 }]) ?? [];
    expect(moved.find((event) => event.kind === 'noteOn' && event.midi === MIDI.D4)).toMatchObject({ loudness: { level: 'mp', shade: 20 } });
    const unwritten = takeWithTheKeysChanged(events, [{ key: { midi: MIDI.C4, downAtMs: 0 }, midi: MIDI.C4, downAtMs: 0, upAtMs: 200, loudness: null }]) ?? [];
    expect(unwritten.find((event) => event.kind === 'noteOn' && event.midi === MIDI.C4)).not.toHaveProperty('loudness');
    expect(rollOfTheTake({ events, beats: [] }).presses.map((press) => [press.midi, press.written])).toEqual([
      [MIDI.C4, { level: 'mp', own: true }],
      [MIDI.E4, { level: 'pp', own: false }],
    ]);
  });

  it('copies how loud each note is written with it, and takes back no loudness that is none', () => {
    const events = inTheOrderPlayed([
      { kind: 'noteOn', atMs: 0, midi: MIDI.C4, velocity: 0.5, loudness: { level: 'mp', shade: 20 } },
      off(200, MIDI.C4),
      { kind: 'noteOn', atMs: 100, midi: MIDI.E4, velocity: 0.5 },
      off(300, MIDI.E4),
    ]);
    const copied = theNotesCopied(events, [
      { midi: MIDI.C4, downAtMs: 0 },
      { midi: MIDI.E4, downAtMs: 100 },
    ]);
    expect(copied.map((note) => note.loudness)).toEqual([{ level: 'mp', shade: 20 }, undefined]);
    expect(theNotesOnTheClipboard(theClipboardTextOf(copied))).toEqual(copied);
    const pasted = takeWithTheNotesPasted([], copied, 1_000).events.filter((event) => event.kind === 'noteOn');
    expect(pasted.map((event) => (event.kind === 'noteOn' ? event.loudness : null))).toEqual([{ level: 'mp', shade: 20 }, undefined]);
    const written = JSON.parse(theClipboardTextOf(copied)) as { copied: string; notes: Record<string, unknown>[] };
    for (const loudness of [{ level: 'loud', shade: 0 }, { level: 'mp', shade: 101 }, { level: 'mp' }, 'mp', null]) {
      expect(theNotesOnTheClipboard(JSON.stringify({ ...written, notes: [{ ...written.notes[0], loudness }] }))).toBeNull();
    }
  });

  it('reads back a change it wrote to the clipboard, any part of it, and nothing else', () => {
    const whole = { key: { fifths: -7, scale: 'dorian' as const }, metre: { beatsInBar: 6, beatType: 8 }, crotchetsPerMinute: 92.5 };
    expect(theChangeOnTheClipboard(theClipboardTextOfTheChange(whole))).toEqual(whole);
    for (const part of [
      { key: { fifths: 7, scale: 'major' as const } },
      { metre: { beatsInBar: 1, beatType: 32 } },
      { crotchetsPerMinute: 1 },
      { dynamic: 'pp' as const },
      { dynamic: 'f' as const, gradually: true as const },
    ]) {
      expect(theChangeOnTheClipboard(theClipboardTextOfTheChange(part))).toEqual(part);
    }
    // A change of nothing is nothing to paste.
    expect(theChangeOnTheClipboard(theClipboardTextOfTheChange({}))).toBeNull();
    const written = JSON.parse(theClipboardTextOfTheChange(whole)) as { copied: string; change: Record<string, unknown> };
    const withPart = (part: Record<string, unknown>): string => JSON.stringify({ ...written, change: { ...written.change, ...part } });
    for (const part of [
      { key: { fifths: 8, scale: 'major' } },
      { key: { fifths: -8, scale: 'major' } },
      { key: { fifths: 1.5, scale: 'major' } },
      { key: { fifths: '1', scale: 'major' } },
      { key: { fifths: 1, scale: 'blues' } },
      { key: { fifths: 1 } },
      { key: null },
      { key: 'G major' },
      { metre: { beatsInBar: 0, beatType: 4 } },
      { metre: { beatsInBar: 33, beatType: 4 } },
      { metre: { beatsInBar: 2.5, beatType: 4 } },
      { metre: { beatsInBar: 3, beatType: 3 } },
      { metre: { beatsInBar: 3, beatType: 64 } },
      { metre: { beatsInBar: 3, beatType: '4' } },
      { metre: { beatsInBar: '3', beatType: 4 } },
      { metre: null },
      { crotchetsPerMinute: 0 },
      { crotchetsPerMinute: -60 },
      { crotchetsPerMinute: '90' },
      { crotchetsPerMinute: null },
      { dynamic: 'loud' },
      { dynamic: 5 },
      { dynamic: null },
      // Gradually, only to a dynamic, and only said so.
      { gradually: true },
      { dynamic: 'f', gradually: 1 },
      { dynamic: 'f', gradually: false },
    ]) {
      expect(theChangeOnTheClipboard(withPart(part)), JSON.stringify(part)).toBeNull();
    }
    expect(theChangeOnTheClipboard(withPart({ crotchetsPerMinute: 'endless' }).replace('"endless"', '1e999'))).toBeNull();
    // Notes are not a change, nor a change notes.
    expect(theChangeOnTheClipboard(theClipboardTextOf([{ afterMs: 0, lengthMs: 100, midi: 60, velocity: 0.5 }]))).toBeNull();
    expect(theNotesOnTheClipboard(theClipboardTextOfTheChange(whole))).toBeNull();
    // Called something else, it is not a change, whatever it holds.
    expect(theChangeOnTheClipboard(JSON.stringify({ ...written, copied: 'sight-reading-practice/notes' }))).toBeNull();
    for (const other of ['G major', '', 'null', '{"copied":"sight-reading-practice/change"}', '{"copied":"sight-reading-practice/change","change":null}']) {
      expect(theChangeOnTheClipboard(other), other).toBeNull();
    }
  });

  it('reads back the notes it wrote to the clipboard, and nothing else', () => {
    const notes = [
      { afterMs: 0, lengthMs: 100, midi: 0, velocity: 1 },
      { afterMs: 200.5, lengthMs: 0.5, midi: 127, velocity: 0.01, hand: 'left' as const },
      { afterMs: 200, lengthMs: 400, midi: MIDI.G4, velocity: 0.5, hand: 'right' as const },
    ];
    const text = theClipboardTextOf(notes);
    expect(theNotesOnTheClipboard(text)).toEqual(notes);

    const written = JSON.parse(text) as { copied: string; notes: Record<string, unknown>[] };
    const withNote = (change: Record<string, unknown>): string =>
      JSON.stringify({ ...written, notes: [...written.notes.slice(0, 2), { ...written.notes[2], ...change }] });
    for (const change of [
      { afterMs: -1 },
      { afterMs: '0' },
      { afterMs: null },
      { lengthMs: 0 },
      { lengthMs: -5 },
      { lengthMs: undefined },
      { midi: 60.5 },
      { midi: -1 },
      { midi: 128 },
      { midi: '60' },
      { velocity: 0 },
      { velocity: 1.01 },
      { velocity: true },
      { hand: 'both' },
      { hand: null },
    ]) {
      expect(theNotesOnTheClipboard(withNote(change)), JSON.stringify(change)).toBeNull();
    }
    // A number too large for a double is read as an endless one.
    for (const field of ['afterMs', 'lengthMs']) {
      const endless = withNote({ [field]: 'endless' }).replace('"endless"', '1e999');
      expect(theNotesOnTheClipboard(endless), field).toBeNull();
    }
    for (const other of [
      'C4 E4 G4',
      '',
      'null',
      '[]',
      JSON.stringify({ ...written, copied: 'another program' }),
      JSON.stringify({ notes: written.notes }),
      JSON.stringify({ ...written, notes: {} }),
      JSON.stringify({ ...written, notes: [] }),
      JSON.stringify({ ...written, notes: [...written.notes, 5] }),
      JSON.stringify({ ...written, notes: [null] }),
    ]) {
      expect(theNotesOnTheClipboard(other), other).toBeNull();
    }
  });

  it('turns a chord broken up, down, or up and back down without striking the top or the bottom twice', () => {
    const chord = [MIDI.G4, MIDI.C4, MIDI.E4, MIDI.C4];
    expect(theKeysInTurn(chord, 'up')).toEqual([MIDI.C4, MIDI.E4, MIDI.G4]);
    expect(theKeysInTurn(chord, 'down')).toEqual([MIDI.G4, MIDI.E4, MIDI.C4]);
    expect(theKeysInTurn(chord, 'upAndDown')).toEqual([MIDI.C4, MIDI.E4, MIDI.G4, MIDI.E4]);
    expect(theKeysInTurn([...chord, MIDI.C5], 'upAndDown')).toEqual([MIDI.C4, MIDI.E4, MIDI.G4, MIDI.C5, MIDI.G4, MIDI.E4]);
    expect(theKeysInTurn([MIDI.C4, MIDI.G4], 'upAndDown')).toEqual([MIDI.C4, MIDI.G4]);
  });

  it('breaks each chord named into a key a line of the grid, over its length, as hard and in the hand it was', () => {
    // C E G struck at 1000 and held to 2000, C the hardest, in the left hand.
    const events = inTheOrderPlayed([
      { kind: 'noteOn', atMs: 1_000, midi: MIDI.C4, velocity: 0.9, hand: 'left' },
      on(1_000, MIDI.E4),
      on(1_000, MIDI.G4),
      off(2_000, MIDI.C4),
      off(1_800, MIDI.E4),
      off(2_000, MIDI.G4),
      on(3_000, MIDI.D4),
      off(3_500, MIDI.D4),
    ]);
    const chord = [MIDI.C4, MIDI.E4, MIDI.G4].map((midi) => ({ midi, downAtMs: 1_000 }));
    // Lines every 250 ms, one of them off the millisecond, and some outside the chord.
    const lines = [0, 500, 1_000, 1_250, 1_500.4, 1_750, 2_000, 2_250];
    const notes = (taken: readonly MidiFileEvent[]): (number | string)[][] =>
      theKeysOfTheTake(taken).map((key) => [key.downAtMs, key.midi, key.upAtMs ?? -1, key.velocity, key.hand ?? '']);

    const broken = takeWithTheChordsBroken(events, chord, lines, 'up');
    expect(notes(broken?.events ?? [])).toEqual([
      [1_000, MIDI.C4, 1_250, 0.9, 'left'],
      [1_250, MIDI.E4, 1_500, 0.7, ''],
      [1_500, MIDI.G4, 1_750, 0.7, ''],
      [1_750, MIDI.C4, 2_000, 0.9, 'left'],
      [3_000, MIDI.D4, 3_500, 0.7, ''],
    ]);
    expect(broken?.keys).toEqual([
      { midi: MIDI.C4, downAtMs: 1_000 },
      { midi: MIDI.E4, downAtMs: 1_250 },
      { midi: MIDI.G4, downAtMs: 1_500 },
      { midi: MIDI.C4, downAtMs: 1_750 },
    ]);
    expect(notes(takeWithTheChordsBroken(events, chord, lines, 'down')?.events ?? []).map(([, midi]) => midi)).toEqual([
      MIDI.G4,
      MIDI.E4,
      MIDI.C4,
      MIDI.G4,
      MIDI.D4,
    ]);

    // A key named alone stays as it is, and is still among the keys; and
    // with no chord broken there is nothing to change.
    const withTheD = takeWithTheChordsBroken(events, [...chord, { midi: MIDI.D4, downAtMs: 3_000 }], lines, 'up');
    expect(withTheD?.keys).toContainEqual({ midi: MIDI.D4, downAtMs: 3_000 });
    expect(notes(withTheD?.events ?? [])).toEqual(notes(broken?.events ?? []));
    expect(takeWithTheChordsBroken(events, [{ midi: MIDI.D4, downAtMs: 3_000 }], lines, 'up')).toBeNull();
    // One key named twice is no chord.
    const theC = { midi: MIDI.C4, downAtMs: 1_000 };
    expect(takeWithTheChordsBroken(events, [theC, theC], lines, 'up')).toBeNull();
    // Nor is one no line falls inside.
    expect(takeWithTheChordsBroken(events, chord, [0, 2_000, 2_500], 'up')).toBeNull();
    // And a key not there refuses the whole.
    expect(takeWithTheChordsBroken(events, [...chord, { midi: MIDI.F4, downAtMs: 1_000 }], lines, 'up')).toBeNull();
  });

  it('breaks two chords at once, each over its own length, leaving out a key that would sound over another of its pitch', () => {
    // C with a short G, held to 1000; then D F to 1500; and a G not named
    // inside the first chord's length, after its own G has let go.
    const events = inTheOrderPlayed([
      on(0, MIDI.C4),
      on(0, MIDI.G4),
      off(200, MIDI.G4),
      off(1_000, MIDI.C4),
      on(1_000, MIDI.D4),
      on(1_000, MIDI.F4),
      off(1_500, MIDI.D4),
      off(1_500, MIDI.F4),
    ]);
    const named = [
      { midi: MIDI.C4, downAtMs: 0 },
      { midi: MIDI.G4, downAtMs: 0 },
      { midi: MIDI.D4, downAtMs: 1_000 },
      { midi: MIDI.F4, downAtMs: 1_000 },
    ];
    const lines = [0, 250, 500, 750, 1_000, 1_250, 1_500];
    const steps = (taken: readonly MidiFileEvent[]): number[][] =>
      theKeysOfTheTake(taken).map((key) => [key.downAtMs, key.midi, key.upAtMs ?? -1]);
    expect(steps(takeWithTheChordsBroken(events, named, lines, 'up')?.events ?? [])).toEqual([
      [0, MIDI.C4, 250],
      [250, MIDI.G4, 500],
      [500, MIDI.C4, 750],
      [750, MIDI.G4, 1_000],
      [1_000, MIDI.D4, 1_250],
      [1_250, MIDI.F4, 1_500],
    ]);
    // The G not named sounds where the last G of the first chord would.
    const under = inTheOrderPlayed([...events, on(800, MIDI.G4), off(900, MIDI.G4)]);
    expect(takeWithTheChordsBroken(under, named, lines, 'up')?.keys).toEqual([
      { midi: MIDI.C4, downAtMs: 0 },
      { midi: MIDI.G4, downAtMs: 250 },
      { midi: MIDI.C4, downAtMs: 500 },
      { midi: MIDI.D4, downAtMs: 1_000 },
      { midi: MIDI.F4, downAtMs: 1_250 },
    ]);
  });

  it('pastes notes from a moment on, leaving out each that would be over another of its pitch', () => {
    const events = [on(1_000, MIDI.C4), off(1_400, MIDI.C4), on(1_500, MIDI.D4), off(2_000, MIDI.D4)];
    const handed = { afterMs: 300, lengthMs: 200, midi: MIDI.E4, velocity: 0.25, hand: 'left' as const };

    // Into empty places, the first where asked, rounded to the millisecond.
    const { events: pasted, pasted: keys } = takeWithTheNotesPasted(
      events,
      [{ afterMs: 0, lengthMs: 100, midi: MIDI.G4, velocity: 0.5 }, handed],
      2_000.4,
    );
    expect(pasted).toEqual(
      inTheOrderPlayed([
        ...events,
        { kind: 'noteOn', atMs: 2_000, midi: MIDI.G4, velocity: 0.5 },
        off(2_100, MIDI.G4),
        { kind: 'noteOn', atMs: 2_300, midi: MIDI.E4, velocity: 0.25, hand: 'left' },
        off(2_500, MIDI.E4),
      ]),
    );
    expect(keys).toEqual([
      { midi: MIDI.G4, downAtMs: 2_000 },
      { midi: MIDI.E4, downAtMs: 2_300 },
    ]);

    // Over a C, on a D, and sounding into that D: those three left out;
    // ending where the C begins, and beginning where the D ends, kept.
    const over = [
      { afterMs: 400, lengthMs: 400, midi: MIDI.C4, velocity: 0.5 },
      { afterMs: 700, lengthMs: 100, midi: MIDI.D4, velocity: 0.5 },
      { afterMs: 0, lengthMs: 701, midi: MIDI.D4, velocity: 0.5 },
      { afterMs: 0, lengthMs: 200, midi: MIDI.C4, velocity: 0.5 },
      { afterMs: 1_200, lengthMs: 100, midi: MIDI.D4, velocity: 0.5 },
    ];
    expect(takeWithTheNotesPasted(events, over, 800).pasted).toEqual([
      { midi: MIDI.C4, downAtMs: 800 },
      { midi: MIDI.D4, downAtMs: 2_000 },
    ]);
    // Two pasted over each other: the second is left out.
    expect(
      takeWithTheNotesPasted(
        [],
        [
          { afterMs: 0, lengthMs: 400, midi: MIDI.C4, velocity: 0.5 },
          { afterMs: 200, lengthMs: 400, midi: MIDI.C4, velocity: 0.5 },
          { afterMs: 0, lengthMs: 400, midi: MIDI.C4, velocity: 0.5 },
        ],
        0,
      ),
    ).toEqual({
      events: [{ kind: 'noteOn', atMs: 0, midi: MIDI.C4, velocity: 0.5 }, off(400, MIDI.C4)],
      pasted: [{ midi: MIDI.C4, downAtMs: 0 }],
    });
  });

  it('cuts a key in two at a moment inside it, the second part as loud and in the same hand', () => {
    const handed = { ...on(0, MIDI.C4), velocity: 0.25, hand: 'left' as const };
    const events = [handed, off(1_000, MIDI.C4), on(200, MIDI.E4)];
    const c = { midi: MIDI.C4, downAtMs: 0 };

    const cut = takeWithTheKeyCut(inTheOrderPlayed(events), c, 400) ?? [];
    expect(cut).toEqual([handed, on(200, MIDI.E4), off(400, MIDI.C4), { ...handed, atMs: 400 }, off(1_000, MIDI.C4)]);
    // Read back, two keys where there was one, each ending where it should.
    expect(theKeysOfTheTake(cut).filter((key) => key.midi === MIDI.C4).map((key) => [key.downAtMs, key.upAtMs])).toEqual([
      [0, 400],
      [400, 1_000],
    ]);
    // One still down at the end, cut, leaves its second part down.
    expect(
      theKeysOfTheTake(takeWithTheKeyCut(inTheOrderPlayed(events), { midi: MIDI.E4, downAtMs: 200 }, 900) ?? [])
        .filter((key) => key.midi === MIDI.E4)
        .map((key) => [key.downAtMs, key.upAtMs]),
    ).toEqual([
      [200, 900],
      [900, null],
    ]);
    // Not at either end, nor outside, nor of a key not there.
    for (const at of [0, 1_000, 1_200, -5]) {
      expect(takeWithTheKeyCut(inTheOrderPlayed(events), c, at), String(at)).toBeNull();
    }
    expect(takeWithTheKeyCut(inTheOrderPlayed(events), { midi: MIDI.C4, downAtMs: 1 }, 400)).toBeNull();
  });

  it('holds the pedal down over a stretch, joining what it covers and keeping a press it only meets', () => {
    const ped = (atMs: number, value: number): MidiFileEvent => ({ kind: 'sustain', atMs, value });
    const spans = (events: readonly MidiFileEvent[]): (number | null)[][] =>
      rollOfTheTake({ events, beats: [] }).pedal.map((span) => [span.downAtMs, span.upAtMs]);
    const pressed = [ped(300, 1), ped(800, 0)];

    // Where there was none.
    expect(spans(takeWithThePedalAt([], 100, 500, true))).toEqual([[100, 500]]);
    // Over the start of one, over its end, and inside it: one press.
    expect(spans(takeWithThePedalAt(pressed, 100, 500, true))).toEqual([[100, 800]]);
    expect(spans(takeWithThePedalAt(pressed, 600, 1_000, true))).toEqual([[300, 1_000]]);
    expect(takeWithThePedalAt(pressed, 400, 600, true)).toEqual(pressed);
    // Meeting one at either end: a change of pedal there, two presses.
    expect(spans(takeWithThePedalAt(pressed, 800, 1_000, true))).toEqual([
      [300, 800],
      [800, 1_000],
    ]);
    expect(spans(takeWithThePedalAt(pressed, 100, 300, true))).toEqual([
      [100, 300],
      [300, 800],
    ]);
    // Nothing for a stretch of no length, pressing or letting go.
    expect(takeWithThePedalAt(pressed, 500, 500, true)).toEqual(pressed);
    expect(takeWithThePedalAt(pressed, 500, 500, false)).toEqual(pressed);
  });

  it('lets the pedal go over a stretch, leaving the rest pressed as it was, half-pedal and all', () => {
    const ped = (atMs: number, value: number): MidiFileEvent => ({ kind: 'sustain', atMs, value });
    const spans = (events: readonly MidiFileEvent[]): (number | null)[][] =>
      rollOfTheTake({ events, beats: [] }).pedal.map((span) => [span.downAtMs, span.upAtMs]);
    const pressed = [ped(300, 1), ped(800, 0)];

    // Inside a press, two presses.
    expect(spans(takeWithThePedalAt(pressed, 400, 600, false))).toEqual([
      [300, 400],
      [600, 800],
    ]);
    // The whole of it: nothing left saying anything.
    expect(takeWithThePedalAt(pressed, 300, 800, false)).toEqual([]);
    // Either of two that meet, and the other stays.
    const changed = [ped(0, 1), ped(300, 0), ped(300, 1), ped(600, 0)];
    expect(spans(takeWithThePedalAt(changed, 300, 600, false))).toEqual([[0, 300]]);
    expect(spans(takeWithThePedalAt(changed, 0, 300, false))).toEqual([[300, 600]]);
    // One still down at the end, let go of to the end.
    expect(takeWithThePedalAt([ped(300, 1)], 300, Number.POSITIVE_INFINITY, false)).toEqual([]);

    // A half-pedalled take keeps every value outside the stretch, and its notes.
    const half = [
      ped(0, 0.7),
      ped(200, 0.9),
      ped(400, 0.2),
      on(450, MIDI.C4),
      off(600, MIDI.C4),
      ped(1_000, 0.8),
      ped(1_100, 0.95),
      ped(1_200, 0),
    ];
    const held = takeWithThePedalAt(half, 500, 700, true);
    expect(held.filter((event) => event.atMs < 500 || event.atMs > 700)).toEqual(
      half.filter((event) => event.atMs < 500 || event.atMs > 700),
    );
    expect(held.filter((event) => event.kind !== 'sustain')).toEqual([on(450, MIDI.C4), off(600, MIDI.C4)]);
    expect(spans(held)).toEqual([
      [0, 400],
      [500, 700],
      [1_000, 1_200],
    ]);
  });

  it('humanizes a key written at a level within half the way to the next, its level kept, and a played one by its velocity', () => {
    const shades = new Set<number>();
    for (let at = 0; at < 300; at += 1) {
      const events = inTheOrderPlayed([
        { kind: 'noteOn', atMs: at, midi: MIDI.C4, velocity: 0.5, loudness: { level: 'p', shade: 0 } },
        off(at + 200, MIDI.C4),
        { kind: 'noteOn', atMs: at, midi: MIDI.E4, velocity: 0.5, loudness: { level: null, shade: 0 } },
        off(at + 200, MIDI.E4),
      ]);
      for (const change of theKeysHumanized(events, [
        { midi: MIDI.C4, downAtMs: at },
        { midi: MIDI.E4, downAtMs: at },
      ])) {
        expect(change.velocity).toBeUndefined();
        expect(change.loudness?.level).toBe(change.midi === MIDI.C4 ? 'p' : null);
        shades.add(change.loudness?.shade ?? 0);
      }
    }
    expect(Math.min(...shades)).toBe(-HUMANIZED_SHADE_AT_MOST);
    expect(Math.max(...shades)).toBe(HUMANIZED_SHADE_AT_MOST);
    expect(shades.has(0)).toBe(false);
  });

  it('strikes the named keys each up to the most humanizing moves harder or softer, the same keys alike, all else as it was', () => {
    const struck = (atMs: number, midi: number, steps: number): MidiFileEvent[] => [
      { kind: 'noteOn', atMs, midi, velocity: steps / 127 },
      off(atMs + 300, midi),
    ];
    const moved = new Map<number, number>();
    // Across many chords, every loudness: the whole band either way is used, and nothing past it.
    for (let chord = 0; chord < 200; chord += 1) {
      const steps = 1 + ((chord * 37) % 127);
      const events = inTheOrderPlayed([...struck(chord * 10, MIDI.C4, steps), ...struck(chord * 10, MIDI.E4, steps), ...struck(5_000, MIDI.G4, 64)]);
      const named = [
        { midi: MIDI.C4, downAtMs: chord * 10 },
        { midi: MIDI.E4, downAtMs: chord * 10 },
      ];
      const changes = theKeysHumanized(events, named);
      expect(changes).toEqual(theKeysHumanized(events, named));
      for (const change of changes) {
        const by = Math.round((change.velocity ?? 0) * 127) - steps;
        expect(by).not.toBe(0);
        expect(Math.abs(by)).toBeLessThanOrEqual(HUMANIZED_BY_AT_MOST);
        expect(Math.round((change.velocity ?? 0) * 127)).toBeGreaterThanOrEqual(1);
        expect(Math.round((change.velocity ?? 0) * 127)).toBeLessThanOrEqual(127);
        expect([change.key.midi, change.midi, change.downAtMs, change.upAtMs]).toEqual([
          change.key.midi,
          change.key.midi,
          chord * 10,
          chord * 10 + 300,
        ]);
        moved.set(by, (moved.get(by) ?? 0) + 1);
      }
      // A key not named is never changed.
      expect(changes.some((change) => change.key.midi === MIDI.G4)).toBe(false);
    }
    expect(Math.min(...moved.keys())).toBe(-HUMANIZED_BY_AT_MOST);
    expect(Math.max(...moved.keys())).toBe(HUMANIZED_BY_AT_MOST);
    // Two keys of one chord are not struck alike every time.
    const alike = Array.from({ length: 50 }, (_, chord) => {
      const events = inTheOrderPlayed([...struck(chord * 10, MIDI.C4, 64), ...struck(chord * 10, MIDI.E4, 64)]);
      const changes = theKeysHumanized(events, [
        { midi: MIDI.C4, downAtMs: chord * 10 },
        { midi: MIDI.E4, downAtMs: chord * 10 },
      ]);
      const [first, second] = changes.map((change) => change.velocity);
      return changes.length === 2 && first === second;
    });
    expect(alike.filter(Boolean).length).toBeLessThan(10);
    // Humanized again, being other loudnesses by then, another answer.
    const events = inTheOrderPlayed([...struck(0, MIDI.C4, 64), ...struck(0, MIDI.E4, 64)]);
    const named = [
      { midi: MIDI.C4, downAtMs: 0 },
      { midi: MIDI.E4, downAtMs: 0 },
    ];
    const once = theKeysHumanized(events, named);
    const after = takeWithTheKeysChanged(events, once) ?? [];
    const steps = (changes: readonly { readonly velocity?: number }[]): number[] =>
      changes.map((change) => Math.round((change.velocity ?? 0) * 127));
    const firstBy = steps(once).map((each) => each - 64);
    const againBy = steps(theKeysHumanized(after, named)).map((each, at) => each - (steps(once)[at] ?? 0));
    expect(againBy).not.toEqual(firstBy);
    // Nothing named, nothing changed.
    expect(theKeysHumanized(events, [])).toEqual([]);
  });

  it('puts keys on the nearest line of the grid, as long as they were, never on or over another of their pitch', () => {
    const key = (atMs: number, upAtMs: number, midi: number): MidiFileEvent[] => [on(atMs, midi), off(upAtMs, midi)];
    const events = inTheOrderPlayed([
      // Nearer the beat before, and nearer the one after.
      ...key(120, 370, MIDI.C4),
      ...key(380, 450, MIDI.E4),
      // On a line already.
      ...key(1_000, 1_200, MIDI.G4),
      // Its nearest line is where another of its pitch, not chosen, begins.
      ...key(1_500, 1_550, MIDI.D4),
      ...key(1_620, 1_700, MIDI.D4),
      // Moved first, it would sound over the next, not yet moved: it stays,
      // and the next goes.
      ...key(2_380, 2_980, MIDI.F4),
      ...key(2_990, 3_100, MIDI.F4),
      // Both nearest the same line: the first goes, and the second would begin on it.
      ...key(4_100, 4_150, MIDI.C5),
      ...key(4_200, 4_250, MIDI.C5),
      // The first goes later, and the second, going earlier, would begin
      // inside it where it went: the second stays.
      ...key(6_260, 6_780, MIDI.F5),
      ...key(7_030, 7_100, MIDI.F5),
    ]);
    const beats = [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 }));
    const chosen = [
      [MIDI.C4, 120],
      [MIDI.E4, 380],
      [MIDI.G4, 1_000],
      [MIDI.D4, 1_620],
      [MIDI.F4, 2_380],
      [MIDI.F4, 2_990],
      [MIDI.C5, 4_100],
      [MIDI.C5, 4_200],
      [MIDI.F5, 6_260],
      [MIDI.F5, 7_030],
    ].map(([midi = 0, downAtMs = 0]) => ({ midi, downAtMs }));

    const changes = theKeysOnTheGrid(rollOfTheTake({ events, beats }), events, chosen, PLAIN_GRID);

    expect(changes.map(({ key: { midi, downAtMs: from }, downAtMs, upAtMs }) => [midi, from, downAtMs, upAtMs])).toEqual([
      [MIDI.C4, 120, 0, 250],
      [MIDI.E4, 380, 500, 570],
      [MIDI.F4, 2_990, 3_000, 3_110],
      [MIDI.C5, 4_100, 4_000, 4_050],
      [MIDI.F5, 6_260, 6_500, 7_020],
    ]);
    // On a grid cut finer, the nearer line of it.
    const finer = theKeysOnTheGrid(rollOfTheTake({ events, beats }), events, chosen.slice(0, 1), { beats: true, parts: 4 });
    expect(finer.map((change) => change.downAtMs)).toEqual([125]);
    // None where a key named is not there.
    expect(theKeysOnTheGrid(rollOfTheTake({ events, beats }), events, [{ midi: MIDI.C4, downAtMs: 1 }], PLAIN_GRID)).toEqual([]);
  });

  it('draws room past the end of a sketch where it is asked for, an empty one included', () => {
    const beats = [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 }));
    const played = rollOfTheTake({ events: [on(0, MIDI.C4), off(900, MIDI.C4)], beats }, 3);
    const empty = rollOfTheTake({ events: [], beats }, 8);

    expect(played.beats.map((beat) => beat.atMs)).toEqual([0, 500, 1_000, 1_500, 2_000, 2_500]);
    expect(empty.beats.map((beat) => beat.atMs)).toEqual([0, 500, 1_000, 1_500, 2_000, 2_500, 3_000, 3_500, 4_000, 4_500]);
    expect(rollOfTheTake({ events: [on(0, MIDI.C4), off(900, MIDI.C4)], beats }).beats).toHaveLength(3);
  });
});

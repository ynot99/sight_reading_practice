import { describe, expect, it } from 'vitest';
import { TakePlayer } from '../../src/application/TakePlayer.js';
import type { MidiFileEvent } from '../../src/domain/midi/MidiFile.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { RecordingPitchPlayer } from '../../src/infrastructure/testing/RecordingPitchPlayer.js';

/** C4 for a second, then E4 for a second. */
const TAKE: readonly MidiFileEvent[] = [
  { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.8 },
  { kind: 'noteOff', atMs: 1_000, midi: 60 },
  { kind: 'noteOn', atMs: 1_000, midi: 64, velocity: 0.8 },
  { kind: 'noteOff', atMs: 2_000, midi: 64 },
];

function rig(startAtMs = 0) {
  const clock = new ManualClock(startAtMs);
  const instrument = new RecordingPitchPlayer();
  return { clock, instrument, player: new TakePlayer({ instrument, clock }) };
}

describe('playing a take back', () => {
  it('places each note at its own moment, not at the moment it is handed over', () => {
    // The instrument already takes a time, because a melody placed on
    // delivery rather than on schedule is audibly uneven.
    const { clock, instrument, player } = rig(5_000);

    player.play('take-1', TAKE);
    // Only what is nearly due: the rest is not the instrument's business yet.
    expect(instrument.played.map((note) => [note.midi, note.atMs])).toEqual([[60, 5_000]]);

    clock.advance(900);
    player.pump();

    expect(instrument.played.map((note) => [note.midi, note.atMs])).toEqual([
      [60, 5_000],
      [64, 6_000],
    ]);
  });

  it('hands over only what is nearly due, so stopping can take it back', () => {
    // Handing the whole take over at once was the first attempt and it was
    // wrong twice: the instrument keeps one voice per pitch, so a repeated
    // note released the earlier one before it had sounded, and stopping could
    // only silence what was already sounding - everything scheduled beyond
    // that played on with nothing left to stop it.
    const { clock, instrument, player } = rig();
    const long: MidiFileEvent[] = [];
    for (let at = 0; at < 10; at += 1) {
      long.push({ kind: 'noteOn', atMs: at * 1_000, midi: 60, velocity: 0.8 });
      long.push({ kind: 'noteOff', atMs: at * 1_000 + 500, midi: 60 });
    }

    player.play('take-1', long);
    expect(instrument.played).toHaveLength(1);

    clock.advance(1_000);
    player.pump();
    expect(instrument.played).toHaveLength(2);

    player.stop();
    clock.advance(60_000);
    player.pump();

    // Nothing more was handed over after the stop.
    expect(instrument.played).toHaveLength(2);
  });

  it('knows how far in it is, from the clock rather than from a counter', () => {
    const { clock, player } = rig();
    player.play('take-1', TAKE);
    expect(player.positionMs).toBe(0);

    clock.advance(750);

    expect(player.positionMs).toBe(750);
    expect(player.playing).toBe('take-1');
    expect(player.durationMs).toBe(2_000);
  });

  it('stops at the end rather than running on into silence', () => {
    const { clock, player } = rig();
    player.play('take-1', TAKE);

    clock.advance(9_000);

    expect(player.positionMs).toBe(2_000);
    expect(player.finished).toBe(true);
  });

  it('picks up where it was paused', () => {
    const { clock, player } = rig();
    player.play('take-1', TAKE);
    clock.advance(600);

    player.pause();
    expect(player.playing).toBeNull();
    expect(player.positionMs).toBe(600);

    clock.advance(10_000);
    // Time passing while paused is not time in the take.
    expect(player.positionMs).toBe(600);
  });

  it('strikes a note the seek lands inside, rather than skipping it', () => {
    // A listener who drops into the middle of a held chord should hear the
    // chord, not the silence between its attack and its release.
    const { instrument, player } = rig(1_000);

    player.play('take-1', TAKE, 500);

    expect(instrument.played.map((note) => note.midi)).toEqual([60]);
    // Struck at the seek, not half a second before it.
    expect(instrument.played[0]?.atMs).toBe(1_000);
  });

  it('leaves behind what the seek has already passed', () => {
    const { instrument, player } = rig();

    player.play('take-1', TAKE, 1_500);

    expect(instrument.played.map((note) => note.midi)).toEqual([64]);
  });

  it('silences the instrument the moment it is stopped', () => {
    const { instrument, player } = rig();
    player.play('take-1', TAKE);

    player.stop();

    expect(instrument.stopAllCount).toBeGreaterThan(0);
    expect(player.playing).toBeNull();
    expect(player.positionMs).toBe(0);
  });

  it('carries on from a seek made while it was playing', () => {
    const { clock, player } = rig();
    player.play('take-1', TAKE);
    clock.advance(200);

    player.seek(1_500);

    expect(player.playing).toBe('take-1');
    expect(player.positionMs).toBe(1_500);
  });

  it('releases a note the take never released', () => {
    // A note-on whose note-off never arrives is a note that rings for ever.
    const { instrument, player } = rig();

    player.play('take-1', [{ kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.8 }]);

    expect(instrument.stopped.map((note) => note.midi)).toEqual([60]);
  });
});

describe('a take with the same key struck twice in quick succession', () => {
  /** C4 twice, a tenth of a second apart: well inside the look-ahead. */
  const REPEATED: readonly MidiFileEvent[] = [
    { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.8 },
    { kind: 'noteOff', atMs: 90, midi: 60 },
    { kind: 'noteOn', atMs: 100, midi: 60, velocity: 0.8 },
    { kind: 'noteOff', atMs: 190, midi: 60 },
  ];

  it('hands both over ahead, each at its own moment', () => {
    const { instrument, player } = rig();

    player.play('take-1', REPEATED);

    expect(instrument.played.map((note) => note.atMs)).toEqual([0, 100]);
    expect(instrument.stopped.map((note) => note.atMs)).toEqual([90, 190]);
  });

  it('hands over a repeat that follows straight on in time to sound on its moment', () => {
    // Every repeated note of a written score follows straight on: the key
    // comes up at the very moment it is struck again. Held back until the key
    // before it was up, the repeat went over only once the clock had reached
    // it, and sounded late by however long the page took to look again - the
    // stutter on the second of two notes alike in the drawing of a score.
    const { clock, instrument, player } = rig();

    player.play('take-1', [
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.8 },
      { kind: 'noteOff', atMs: 300, midi: 60 },
      { kind: 'noteOn', atMs: 300, midi: 60, velocity: 0.8 },
      { kind: 'noteOff', atMs: 600, midi: 60 },
    ]);
    clock.advance(100);
    player.pump();

    expect(instrument.played.map((note) => note.atMs)).toEqual([0, 300]);
    // And the first is told to end where the second begins, not before.
    expect(instrument.stopped.map((note) => note.atMs)).toEqual([300, 600]);
  });

  it('leaves different pitches to be handed over together', () => {
    // The rule is per pitch, not a queue: a chord is one gesture.
    const { instrument, player } = rig();

    player.play('take-1', [
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.8 },
      { kind: 'noteOn', atMs: 0, midi: 64, velocity: 0.8 },
      { kind: 'noteOn', atMs: 0, midi: 67, velocity: 0.8 },
      { kind: 'noteOff', atMs: 400, midi: 60 },
      { kind: 'noteOff', atMs: 400, midi: 64 },
      { kind: 'noteOff', atMs: 400, midi: 67 },
    ]);

    expect(instrument.played.map((note) => note.midi)).toEqual([60, 64, 67]);
  });

});

describe('a take played with the sustain pedal down', () => {
  /** The pedal goes down at once and comes up after two seconds. */
  function pedalled(...notes: readonly MidiFileEvent[]): MidiFileEvent[] {
    return [
      { kind: 'sustain', atMs: 0, value: 1 },
      ...notes,
      { kind: 'sustain', atMs: 2_000, value: 0 },
    ];
  }

  /** Halfway on the damper, which is where the felt reaches the strings. */
  const HALFWAY = 64 / 127;

  /** When the instrument was told to end the note it was given at `startMs`. */
  function endOf(instrument: RecordingPitchPlayer, midi: number, nth = 0): number | undefined {
    return instrument.stopped.filter((note) => note.midi === midi)[nth]?.atMs;
  }

  it('lets a released key ring until the dampers come down', () => {
    // Letting a key up under the pedal does nothing at all: the string goes
    // on ringing until the pedal comes up. That is the whole reason a
    // pedalled passage sounds joined up rather than as a row of short notes.
    const { instrument, player } = rig();

    player.play('take-1', pedalled(
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.8 },
      { kind: 'noteOff', atMs: 200, midi: 60 },
    ));

    expect(endOf(instrument, 60)).toBe(2_000);
  });

  it('rings a repeated note right up to the moment it is struck again', () => {
    // The bug this is here for: the note was ended when the *next* one was
    // handed to the instrument, which is a quarter of a second before it
    // sounds. Under a pedal held down through a whole piece that is a hole
    // punched in the sound ahead of every repeat - which is what it sounded
    // like.
    const { clock, instrument, player } = rig();

    player.play('take-1', pedalled(
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.8 },
      { kind: 'noteOff', atMs: 200, midi: 60 },
      { kind: 'noteOn', atMs: 900, midi: 60, velocity: 0.8 },
      { kind: 'noteOff', atMs: 1_100, midi: 60 },
    ));
    clock.advance(700);
    player.pump();

    expect(instrument.played.map((note) => note.atMs)).toEqual([0, 900]);
    // Not 650, which is where it was handed over.
    expect(endOf(instrument, 60)).toBe(900);
    expect(endOf(instrument, 60, 1)).toBe(2_000);
  });

  it('rings to the end of the take when the pedal was never lifted', () => {
    const { instrument, player } = rig();

    player.play('take-1', [
      { kind: 'sustain', atMs: 0, value: 1 },
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.8 },
      { kind: 'noteOff', atMs: 200, midi: 60 },
      { kind: 'noteOn', atMs: 900, midi: 64, velocity: 0.8 },
      { kind: 'noteOff', atMs: 1_500, midi: 64 },
    ]);

    expect(endOf(instrument, 60)).toBe(1_500);
  });

  it('ends a note at the key when the pedal was up under it', () => {
    // A pedal pressed *after* the key came up catches nothing, exactly as on
    // the instrument.
    const { instrument, player } = rig();

    player.play('take-1', [
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.8 },
      { kind: 'noteOff', atMs: 200, midi: 60 },
      { kind: 'sustain', atMs: 300, value: 1 },
      { kind: 'sustain', atMs: 900, value: 0 },
    ]);

    expect(endOf(instrument, 60)).toBe(200);
  });

  it('reads a pedal that reports itself twice on every press', () => {
    // This keyboard sends the damper twice on each movement and reports the
    // halfway point on the way through, in both directions. Only the
    // crossings mean anything.
    const { instrument, player } = rig();

    player.play('take-1', [
      { kind: 'sustain', atMs: 0, value: HALFWAY },
      { kind: 'sustain', atMs: 0, value: HALFWAY },
      { kind: 'sustain', atMs: 20, value: 1 },
      { kind: 'sustain', atMs: 20, value: 1 },
      { kind: 'noteOn', atMs: 100, midi: 60, velocity: 0.8 },
      { kind: 'noteOff', atMs: 300, midi: 60 },
      { kind: 'sustain', atMs: 800, value: HALFWAY },
      { kind: 'sustain', atMs: 810, value: 0 },
    ]);

    // Damped where the felt reached the strings, not where the pedal
    // finished travelling.
    expect(endOf(instrument, 60)).toBe(800);
  });

  it('hears a change of pedal that never reported a zero', () => {
    // What the reader's own keyboard does. A foot that comes up and goes
    // straight back down - the way a pianist clears the harmony - is
    // reported as `127, 64, 127`, eighty milliseconds apart, with no zero in
    // it anywhere. Read by MIDI's own convention that 64 is already "on",
    // that is no movement at all, and every note before the change went on
    // ringing through it.
    const { clock, instrument, player } = rig();

    player.play('take-1', [
      { kind: 'sustain', atMs: 0, value: 1 },
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.8 },
      { kind: 'noteOff', atMs: 200, midi: 60 },
      { kind: 'sustain', atMs: 900, value: HALFWAY },
      { kind: 'sustain', atMs: 980, value: 1 },
      { kind: 'noteOn', atMs: 1_000, midi: 64, velocity: 0.8 },
      { kind: 'noteOff', atMs: 1_200, midi: 64 },
      { kind: 'sustain', atMs: 2_000, value: 0 },
    ]);
    clock.advance(1_000);
    player.pump();

    expect(endOf(instrument, 60)).toBe(900);
    expect(endOf(instrument, 64)).toBe(2_000);
  });

  it('does not strike everything still ringing when the reader seeks', () => {
    // Under a long pedal half the take is ringing at any moment, and
    // striking all of it again at the seek would be a chord nobody played.
    const { instrument, player } = rig();

    player.play('take-1', pedalled(
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.8 },
      { kind: 'noteOff', atMs: 200, midi: 60 },
      { kind: 'noteOn', atMs: 1_000, midi: 64, velocity: 0.8 },
      { kind: 'noteOff', atMs: 1_200, midi: 64 },
    ), 900);

    expect(instrument.played.map((note) => note.midi)).toEqual([64]);
  });
});

describe('taking a take slowly', () => {
  it('advances at the speed it was asked for', () => {
    const { clock, player } = rig();
    player.setSpeed(0.5);
    player.play('take-1', TAKE);

    clock.advance(1_000);

    // A second of room time is half a second of the take.
    expect(player.positionMs).toBe(500);
  });

  it('widens the gaps and moves no pitch', () => {
    // Which is what makes this worth having over a recording of sound: the
    // notes are the same notes, further apart.
    const { clock, instrument, player } = rig(5_000);
    player.setSpeed(0.5);
    player.play('take-1', TAKE);

    clock.advance(1_800);
    player.pump();

    expect(instrument.played.map((note) => [note.midi, note.atMs])).toEqual([
      [60, 5_000],
      // A second into the take, which at half speed is two seconds of room.
      [64, 7_000],
    ]);
  });

  it('keeps its place when the speed is changed while it sounds', () => {
    // The note under the head has to stay under the head.
    const { clock, player } = rig();
    player.play('take-1', TAKE);
    clock.advance(600);

    player.setSpeed(0.5);

    expect(player.positionMs).toBe(600);
    clock.advance(400);
    expect(player.positionMs).toBe(800);
  });

  it('refuses a speed nobody could listen at', () => {
    // Slower than a quarter is a drawing you watch rather than a performance,
    // and faster than its own is not what anybody asked for.
    const { player } = rig();

    player.setSpeed(0.01);
    expect(player.speed).toBe(0.25);

    player.setSpeed(4);
    expect(player.speed).toBe(1);
  });
});

describe('playing a stretch of a take round and round', () => {
  /** C, D, E and F, half a second each; E held on into F's time. */
  const FOUR: readonly MidiFileEvent[] = [
    { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.8 },
    { kind: 'noteOff', atMs: 500, midi: 60 },
    { kind: 'noteOn', atMs: 500, midi: 62, velocity: 0.8 },
    { kind: 'noteOff', atMs: 1_000, midi: 62 },
    { kind: 'noteOn', atMs: 1_000, midi: 64, velocity: 0.8 },
    { kind: 'noteOff', atMs: 1_800, midi: 64 },
    { kind: 'noteOn', atMs: 1_500, midi: 65, velocity: 0.8 },
    { kind: 'noteOff', atMs: 2_000, midi: 65 },
  ];
  const D_TO_E = { fromMs: 500, toMs: 1_500 };
  /** What was struck and stopped, by when, pumped every `stepMs` up to `untilMs`. */
  const heard = (player: TakePlayer, clock: ManualClock, instrument: RecordingPitchPlayer, untilMs: number, stepMs: number) => {
    while (clock.now() < untilMs) {
      clock.advance(stepMs);
      player.pump();
    }
    return {
      struck: instrument.played.map((note) => [note.midi, note.atMs]),
      stopped: instrument.stopped.map((note) => [note.midi, note.atMs]),
    };
  };

  it('begins the stretch again where it ends, each lap handed over ahead as any note is, however often it is pumped', () => {
    for (const stepMs of [10, 50, 80, 200]) {
      const { clock, instrument, player } = rig();
      player.play('take-1', FOUR, 600, D_TO_E);
      // D was sounding where it began, so it is struck there; E is cut where
      // the stretch ends; F, after it, is never heard.
      expect(heard(player, clock, instrument, 2_900, stepMs), String(stepMs)).toEqual({
        struck: [
          [62, 0],
          [64, 400],
          [62, 900],
          [64, 1_400],
          [62, 1_900],
          [64, 2_400],
          [62, 2_900],
        ],
        stopped: [
          [62, 400],
          [64, 900],
          [62, 1_400],
          [64, 1_900],
          [62, 2_400],
          [64, 2_900],
          [62, 3_400],
        ],
      });
      expect(player.finished).toBe(false);
    }
  });

  it('hands the next lap over within the look-ahead, before the end it begins at is reached', () => {
    const { clock, instrument, player } = rig();
    player.play('take-1', FOUR, 600, D_TO_E);
    // A quarter of a second short of the end, the lap after it has its first note.
    clock.set(649);
    player.pump();
    expect(instrument.played.map((note) => [note.midi, note.atMs])).not.toContainEqual([62, 900]);
    clock.set(650);
    player.pump();
    expect(instrument.played.map((note) => [note.midi, note.atMs])).toContainEqual([62, 900]);
    // And a lap after that one only as its own end comes near; then the take played again goes round from its own first lap.
    expect(instrument.played.map((note) => note.atMs)).not.toContain(1_900);
    player.play('take-1', FOUR, 600, D_TO_E);
    expect(instrument.played.at(-1)).toEqual({ midi: 62, velocity: 0.8, atMs: 650 });
  });

  it('goes round a stretch that ends after the last note, the silence after it and all', () => {
    const { clock, instrument, player } = rig();
    player.play('take-1', FOUR, 1_600, { fromMs: 1_500, toMs: 3_000 });
    // Past the last note and short of the stretch's end: still going, at the end of what there is.
    clock.set(900);
    expect([player.positionMs, player.finished, player.goingRound]).toEqual([2_000, false, { fromMs: 1_500, toMs: 3_000 }]);
    // The next lap a second and a half after it began: E still down where it begins, and F.
    expect(heard(player, clock, instrument, 1_450, 50).struck.slice(-2)).toEqual([
      [64, 1_400],
      [65, 1_400],
    ]);
    // Held, nothing goes round; played again from there, it does.
    player.pause();
    expect(player.goingRound).toBeNull();
  });

  it('says where it is in the stretch, and how many laps it has begun', () => {
    const { clock, player } = rig();
    player.play('take-1', FOUR, 600, D_TO_E);
    const said: [number, number][] = [];
    for (let at = 0; at <= 2_000; at += 100) {
      clock.set(at);
      said.push([player.positionMs, player.lap]);
    }
    expect(said).toEqual([
      [600, 0], [700, 0], [800, 0], [900, 0], [1_000, 0], [1_100, 0], [1_200, 0], [1_300, 0], [1_400, 0],
      [500, 1], [600, 1], [700, 1], [800, 1], [900, 1], [1_000, 1], [1_100, 1], [1_200, 1], [1_300, 1], [1_400, 1],
      [500, 2], [600, 2],
    ]);
  });

  it('goes round only what it was set going in front of the end of, and only while it is told', () => {
    // Begun before the stretch, it plays into it and then round it.
    {
      const { clock, instrument, player } = rig();
      player.play('take-1', FOUR, 0, D_TO_E);
      expect(heard(player, clock, instrument, 1_600, 50).struck).toEqual([
        [60, 0],
        [62, 500],
        [64, 1_000],
        [62, 1_500],
      ]);
    }
    // Begun after it, it plays on to the end.
    {
      const { clock, instrument, player } = rig();
      player.play('take-1', FOUR, 1_600, D_TO_E);
      expect(heard(player, clock, instrument, 600, 50).struck).toEqual([
        [64, 0],
        [65, 0],
      ]);
      expect(player.finished).toBe(true);
    }
    // Let go of partway, it plays on from where it is.
    {
      const { clock, instrument, player } = rig();
      player.play('take-1', FOUR, 600, D_TO_E);
      heard(player, clock, instrument, 600, 50);
      player.setLoop(null);
      expect(player.positionMs).toBe(1_200);
      expect(heard(player, clock, instrument, 1_500, 50).struck.slice(-2)).toEqual([
        [64, 600],
        [65, 900],
      ]);
    }
    // Set going round while it plays, it goes round from the next time it reaches the end.
    {
      const { clock, instrument, player } = rig();
      player.play('take-1', FOUR, 600);
      heard(player, clock, instrument, 100, 50);
      player.setLoop(D_TO_E);
      expect(player.positionMs).toBe(700);
      expect(heard(player, clock, instrument, 1_000, 50).struck.slice(-2)).toEqual([
        [64, 400],
        [62, 900],
      ]);
    }
    // A stretch of nothing goes round nothing; and a take played after it goes round nothing unless told.
    {
      const { clock, instrument, player } = rig();
      player.play('take-1', FOUR, 0, { fromMs: 500, toMs: 500 });
      heard(player, clock, instrument, 2_100, 50);
      expect(player.finished).toBe(true);
      player.play('take-1', FOUR, 0);
      player.setLoop({ fromMs: 1_000, toMs: 1_000 });
      heard(player, clock, instrument, 4_300, 50);
      expect(player.finished).toBe(true);
      player.play('take-1', FOUR, 600, D_TO_E);
      player.stop();
      player.play('take-2', FOUR, 600);
      clock.advance(1_500);
      expect(player.finished).toBe(true);
    }
  });

  it('leaves the stretch where it is moved past its end, and stays in it where it is moved within', () => {
    const { clock, instrument, player } = rig();
    player.play('take-1', FOUR, 600, D_TO_E);
    // A lap and more gone round, moved back into it: from there, laps counted afresh.
    heard(player, clock, instrument, 1_200, 50);
    player.seek(700);
    expect(instrument.played.at(-1)).toEqual({ midi: 62, velocity: 0.8, atMs: 1_200 });
    clock.advance(900);
    expect([player.positionMs, player.lap]).toEqual([600, 1]);
    player.seek(1_600);
    clock.advance(500);
    player.pump();
    expect(player.finished).toBe(true);
    expect(instrument.played.at(-1)?.midi).toBe(65);
  });
});

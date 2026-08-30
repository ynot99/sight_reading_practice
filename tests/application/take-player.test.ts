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

  it('does not let the second one kill the first before it sounds', () => {
    // The instrument keeps one voice per pitch, and striking a key re-hits
    // the string *now* rather than when the note was scheduled for. Handed
    // both at once, the first was silenced before it had ever been heard -
    // which is a run of repeated notes coming out clipped to nothing.
    const { clock, instrument, player } = rig();

    player.play('take-1', REPEATED);
    expect(instrument.played).toHaveLength(1);

    // Handed over once the first has finished, and not a moment later: two
    // notes of one pitch never overlap, so that moment is at or before the
    // second one's own beginning.
    clock.advance(90);
    player.pump();

    expect(instrument.played.map((note) => note.atMs)).toEqual([0, 100]);
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
    // This keyboard sends the damper twice on each press and again halfway.
    // Only the crossings mean anything, and a half-press is still a press.
    const { instrument, player } = rig();

    player.play('take-1', [
      { kind: 'sustain', atMs: 0, value: 0.504 },
      { kind: 'sustain', atMs: 0, value: 0.504 },
      { kind: 'sustain', atMs: 20, value: 1 },
      { kind: 'sustain', atMs: 20, value: 1 },
      { kind: 'noteOn', atMs: 100, midi: 60, velocity: 0.8 },
      { kind: 'noteOff', atMs: 300, midi: 60 },
      { kind: 'sustain', atMs: 800, value: 0.504 },
      { kind: 'sustain', atMs: 810, value: 0 },
    ]);

    expect(endOf(instrument, 60)).toBe(810);
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

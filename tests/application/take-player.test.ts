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

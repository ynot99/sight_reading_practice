import { describe, expect, it } from 'vitest';
import { ExercisePlayer } from '../../src/application/ExercisePlayer.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { FakeScoreRenderer } from '../../src/infrastructure/testing/FakeScoreRenderer.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { ManualMetronome } from '../../src/infrastructure/testing/ManualMetronome.js';
import { RecordingPitchPlayer } from '../../src/infrastructure/testing/RecordingPitchPlayer.js';
import { MIDI, tiedExercise, twoBarExercise } from '../support/fixtures.js';

function rig(exercise = twoBarExercise({ tempoBpm: 60 })) {
  const clock = new ManualClock();
  const metronome = new ManualMetronome(clock);
  const instrument = new RecordingPitchPlayer();
  const renderer = new FakeScoreRenderer();
  const player = new ExercisePlayer({
    metronome,
    instrument,
    cursor: renderer.cursor,
    // Wide enough that one tick schedules the bar ahead of it.
    horizonMs: 2_000,
  });
  return { player, metronome, instrument, renderer, timeline: buildTimeline(exercise) };
}

describe('listening to an exercise', () => {
  it('sounds every note the score asks for', () => {
    const { player, metronome, instrument, timeline } = rig();
    player.start(timeline, { staffNumber: null, clickAudible: false });
    metronome.advanceSubdivisions(8);

    expect(instrument.played.map((note) => note.midi).sort((a, b) => a - b)).toEqual(
      [...timeline.steps.flatMap((step) => step.notes.map((note) => note.midi))].sort(
        (a, b) => a - b,
      ),
    );
  });

  it('places them ahead of the tick that scheduled them', () => {
    // A tick arrives after the moment it stands for, so a note played on
    // delivery is late by however long the scheduler slept. Every note carries
    // the moment it should sound instead.
    const { player, metronome, instrument, timeline } = rig();
    player.start(timeline, { staffNumber: null, clickAudible: false });
    metronome.advanceSubdivisions(8);

    for (const note of instrument.played) {
      expect(note.atMs).toBeTypeOf('number');
    }
    // At 60 bpm the fixture's quarters fall a second apart. The last step is a
    // rest, so nothing is scheduled for it.
    const onsets = [...new Set(instrument.played.map((note) => note.atMs))].sort(
      (left, right) => (left ?? 0) - (right ?? 0),
    );
    expect(onsets).toEqual([0, 1000, 2000, 3000, 4000]);
  });

  it('holds a note for as long as it is written, ties included', () => {
    const { player, metronome, instrument, timeline } = rig(tiedExercise({ tempoBpm: 60 }));
    player.start(timeline, { staffNumber: null, clickAudible: false });
    metronome.advanceSubdivisions(12);

    // The tied E4 is struck on beat four and held through the whole next bar:
    // one sound of five beats, not two of one and four.
    const held = instrument.played.filter((note) => note.midi === MIDI.E4);
    expect(held).toHaveLength(1);
    const release = instrument.stopped.find((note) => note.midi === MIDI.E4);
    expect((release?.atMs ?? 0) - (held[0]?.atMs ?? 0)).toBe(5_000);
  });

  it('strikes a unison once, however many voices notate it', () => {
    // Two hands may write the same sounding pitch at the same instant. That is
    // one key on the keyboard, and striking it twice doubles the attack into a
    // knock.
    const base = twoBarExercise({ tempoBpm: 60 });
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    const doubled = {
      ...base,
      staves: [treble, { ...bass, staffNumber: 1, voice: 3, measures: treble.measures }, bass],
    };
    const { player, metronome, instrument } = rig(doubled);
    player.start(buildTimeline(doubled), { staffNumber: null, clickAudible: false });
    metronome.advanceSubdivisions(8);

    const struck = instrument.played.map((note) => `${note.midi}@${note.atMs}`);
    expect(new Set(struck).size).toBe(struck.length);
  });

  it('can sound one hand alone', () => {
    const { player, metronome, instrument, timeline } = rig();
    player.start(timeline, { staffNumber: 2, clickAudible: false });
    metronome.advanceSubdivisions(8);

    const sounded = new Set(instrument.played.map((note) => note.midi));
    expect(sounded.has(MIDI.C3)).toBe(true);
    expect(sounded.has(MIDI.C4)).toBe(false);
  });

  it('walks the cursor with the music', () => {
    const { player, metronome, renderer, timeline } = rig();
    player.start(timeline, { staffNumber: null, clickAudible: false });

    metronome.advanceSubdivisions(1);
    expect(renderer.cursor.position).toBe(0);
    metronome.advanceSubdivisions(1);
    expect(renderer.cursor.position).toBe(1);
    expect(timeline.at(1)?.onsetTicks).toBe(480);
  });

  it('stops itself at the end, and says so', () => {
    const { player, metronome, timeline } = rig();
    let finished = 0;
    player.events.on('finished', () => {
      finished += 1;
    });
    player.start(timeline, { staffNumber: null, clickAudible: false });
    expect(player.isPlaying).toBe(true);

    metronome.advanceSubdivisions(12);

    expect(finished).toBe(1);
    expect(player.isPlaying).toBe(false);
    expect(metronome.isRunning).toBe(false);
  });

  it('goes quiet when it is stopped partway', () => {
    const { player, metronome, instrument, timeline } = rig();
    player.start(timeline, { staffNumber: null, clickAudible: false });
    metronome.advanceSubdivisions(2);

    player.stop();

    expect(player.isPlaying).toBe(false);
    expect(instrument.stopAllCount).toBeGreaterThan(0);
  });

  it('uses no timer of its own', () => {
    // The whole playback replays from hand-advanced ticks, which is the same
    // property the practice loop has and the reason either can be tested.
    const { player, metronome, instrument, timeline } = rig();
    player.start(timeline, { staffNumber: null, clickAudible: false });
    metronome.advanceSubdivisions(12);

    expect(instrument.played.length).toBeGreaterThan(0);
  });
});

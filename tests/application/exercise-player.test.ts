import { describe, expect, it } from 'vitest';
import { ExercisePlayer } from '../../src/application/ExercisePlayer.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { FakeScoreRenderer } from '../../src/infrastructure/testing/FakeScoreRenderer.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { ManualMetronome } from '../../src/infrastructure/testing/ManualMetronome.js';
import { RecordingPitchPlayer } from '../../src/infrastructure/testing/RecordingPitchPlayer.js';
import {
  MIDI,
  arpeggiatedExercise,
  bar,
  p,
  tiedExercise,
  twoBarExercise,
} from '../support/fixtures.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { noteEntry, restEntry } from '../../src/domain/model/Exercise.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';

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
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });
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
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });
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

  it('holds where it is when it is paused, and says where', () => {
    // A step and not a tick: picking up partway through a note would sound
    // its tail without its beginning, and the marker would land where no
    // note starts.
    const { player, metronome, renderer, timeline } = rig();
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });
    metronome.advanceSubdivisions(2);
    const reached = renderer.cursor.position;
    expect(reached).toBeGreaterThan(0);

    player.pause();

    expect(player.isPlaying).toBe(false);
    expect(player.pausedAt).toBe(reached);
    // And the pulse under it has stopped, not merely gone quiet.
    const ticks = metronome.emitted.length;
    metronome.advanceSubdivisions(4);
    expect(metronome.emitted).toHaveLength(ticks);
  });

  it('picks up from there rather than from the top', () => {
    const { player, metronome, instrument, timeline } = rig();
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });
    metronome.advanceSubdivisions(2);
    player.pause();
    const from = player.pausedAt ?? -1;
    expect(from).toBeGreaterThan(0);
    const heardBefore = instrument.played.length;

    player.start(timeline, {
      staffNumber: null,
      click: 'pulse',
      clickWhen: 'never',
      fromIndex: from,
    });

    // Picking it up is a performance again, and it is no longer being held.
    expect(player.isPlaying).toBe(true);
    expect(player.pausedAt).toBeNull();
    metronome.advanceSubdivisions(8);
    // Exactly the music from the hold onwards, and none of what came before
    // it: the whole point of holding is not to sit through it again.
    const heardAfter = instrument.played.slice(heardBefore).map((note) => note.midi);
    const expected = timeline.steps
      .slice(from)
      .flatMap((step) => step.notes.map((note) => note.midi));
    expect(heardAfter.sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
  });

  it('anchors the clock before doing anything that takes time', () => {
    // Starting the metronome is what fixes the performance to the audio
    // clock: its first tick is placed a fixed moment ahead of *now*, so every
    // millisecond spent before that call is silence added in front of the
    // music. Gathering the notes walks the whole timeline and moving the
    // marker walks the engraver's cursor from wherever it stood. On a
    // two-hundred-bar piece those two came to about ninety milliseconds
    // before this order changed, and a reader tapping along could hear them
    // as a repeat that came in late.
    const clock = new ManualClock();
    const metronome = new ManualMetronome(clock);
    const renderer = new FakeScoreRenderer();
    const order: string[] = [];
    const startMetronome = metronome.start.bind(metronome);
    metronome.start = (): void => {
      order.push('clock');
      startMetronome();
    };
    const moveCursor = renderer.cursor.moveTo.bind(renderer.cursor);
    renderer.cursor.moveTo = (index: number): void => {
      order.push('cursor');
      moveCursor(index);
    };
    const player = new ExercisePlayer({
      metronome,
      instrument: new RecordingPitchPlayer(),
      cursor: renderer.cursor,
      horizonMs: 2_000,
    });

    player.start(buildTimeline(twoBarExercise({ tempoBpm: 60 })), {
      staffNumber: null,
      click: 'pulse',
      clickWhen: 'never',
    });

    expect(order[0]).toBe('clock');
    expect(order).toContain('cursor');
    // And the music still sounds, so nothing was lost by deferring it: the
    // first tick is not delivered until it is due, which is long after both.
    metronome.advanceSubdivisions(8);
    expect(renderer.cursor.position).toBeGreaterThan(0);
  });

  it('leaves the marker on the last note, not in the bar after it', () => {
    // The complaint this answers: on a repeat the music visibly overran by a
    // bar before starting again. The tick that ends a stretch stands at the
    // end of its last note, which is the beginning of the next one - so a
    // marker moved before the end was noticed walked into the bar after the
    // passage, and the page turned forward and straight back with it.
    const { player, metronome, renderer, timeline } = rig();
    const last = 1;
    player.start(timeline, {
      staffNumber: null,
      click: 'pulse',
      clickWhen: 'never',
      toIndex: last,
    });

    metronome.advanceSubdivisions(16);

    expect(renderer.cursor.position).toBe(last);
    expect(Math.max(...renderer.cursor.moves)).toBe(last);
  });

  it('says nothing about a position past the end of the stretch', () => {
    // The page follows the position, so publishing one in the bar after the
    // passage is what turned the page there.
    const { player, metronome, timeline } = rig();
    const seen: number[] = [];
    player.events.on('positionChanged', (at) => seen.push(at.measureIndex));
    player.start(timeline, {
      staffNumber: null,
      click: 'pulse',
      clickWhen: 'never',
      toIndex: 1,
    });

    metronome.advanceSubdivisions(16);

    const lastBar = timeline.at(1)?.measureIndex ?? 0;
    expect(Math.max(...seen)).toBe(lastBar);
  });

  it('is not being held once it has ended of its own accord', () => {
    // A performance that reached its end is not one waiting to be picked up;
    // pressing the button after one means hearing it again.
    const { player, metronome, timeline } = rig();
    const finished: unknown[] = [];
    player.events.on('finished', () => finished.push(true));
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });

    metronome.advanceSubdivisions(16);

    expect(finished).toHaveLength(1);
    expect(player.pausedAt).toBeNull();
  });

  it('forgets a held place when the performance is ended', () => {
    const { player, metronome, timeline } = rig();
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });
    metronome.advanceSubdivisions(2);
    player.pause();
    expect(player.pausedAt).not.toBeNull();

    player.end();

    expect(player.pausedAt).toBeNull();
  });

  describe('playing a passage round again', () => {
    /** Every distinct moment a note was started, in order. */
    function onsets(instrument: RecordingPitchPlayer): number[] {
      return [...new Set(instrument.played.map((note) => note.atMs ?? 0))].sort((a, b) => a - b);
    }

    it('goes round inside one performance, without stopping', () => {
      // The whole point. A repeat used to be a new performance: the metronome
      // was stopped and started, which re-anchors it to the audio clock a
      // fixed lead ahead of now, and everything the restart had to do first
      // was silence in front of the music.
      const { player, metronome, timeline } = rig();
      const finished: unknown[] = [];
      player.events.on('finished', () => finished.push(true));

      player.start(timeline, {
        staffNumber: null,
        click: 'pulse',
        clickWhen: 'never',
        repeat: true,
      });
      metronome.advanceSubdivisions(20);

      expect(finished).toEqual([]);
      expect(player.isPlaying).toBe(true);
      expect(metronome.isRunning).toBe(true);
    });

    it('sounds the next lap a lap after the last, to the millisecond', () => {
      // The seam costs nothing, which is what "seamless" has to mean: the
      // notes of the next round are handed over while the last of this one
      // are still sounding, exactly as any other note is handed over ahead of
      // its moment.
      const { player, metronome, instrument, timeline } = rig();
      player.start(timeline, {
        staffNumber: null,
        click: 'pulse',
        clickWhen: 'never',
        repeat: true,
      });
      metronome.advanceSubdivisions(16);

      // The fixture is eight quarters at 60 bpm, so a lap is eight seconds.
      const heard = onsets(instrument);
      const lap = 8_000;
      expect(heard).toContain(0);
      expect(heard).toContain(lap);
      expect(heard).toContain(lap + 1_000);
    });

    it('takes the marker back to the beginning of the passage', () => {
      const { player, metronome, renderer, timeline } = rig();
      player.start(timeline, {
        staffNumber: null,
        click: 'pulse',
        clickWhen: 'never',
        toIndex: 1,
        repeat: true,
      });

      metronome.advanceSubdivisions(6);

      // Two steps round and round: nothing past the passage is ever visited,
      // and the marker goes *back* - which is the only way a step can follow
      // one that came after it.
      const moves = renderer.cursor.moves;
      expect(Math.max(...moves)).toBe(1);
      expect(moves.some((at, index) => index > 0 && at < (moves[index - 1] ?? 0))).toBe(true);
    });

    it('keeps clicking, having no end to stop at', () => {
      // The end exists to stop the click sounding one more downbeat after the
      // last note. Going round, the end of a lap is the beginning of the next
      // one, and a click that stopped there would stop for good.
      const { player, metronome, timeline } = rig();
      player.start(timeline, {
        staffNumber: null,
        click: 'pulse',
        clickWhen: 'always',
        toIndex: 1,
        repeat: true,
      });

      expect(metronome.currentConfig.endsAtTicks).toBeNull();
    });

    it('lays out the passage again, not what follows it in the piece', () => {
      // What comes after the passage is not what comes next when it plays
      // again. Left in, two 4/4 bars followed by a bar of 3/4 were accented
      // as 3/4 on the second reading.
      const { player, metronome, timeline } = rig();
      player.start(timeline, {
        staffNumber: null,
        click: 'pulse',
        clickWhen: 'always',
        toIndex: 3,
        repeat: true,
      });

      const bars = metronome.currentConfig.bars;
      const lap = Duration.WHOLE.ticks;
      // One bar per lap, laid end to end - and every one of them the metre the
      // passage is in rather than whatever the piece does next.
      expect(bars.length).toBeGreaterThan(2);
      expect(bars.slice(0, 3).map((bar) => bar.startTicks)).toEqual([0, lap, lap * 2]);
      expect(bars.every((bar) => bar.timeSignature.equals(timeline.exercise.timeSignature))).toBe(
        true,
      );
    });

    it('goes round the passage, not round from where it was picked up', () => {
      // The complaint this answers: repeating one bar and pausing halfway
      // through it made that half bar the loop, and the reader heard the back
      // half of the bar over and over.
      //
      // A pause says where the music picks up. It does not say what the
      // passage is - and the passage is what a lap is.
      const { player, metronome, instrument, timeline } = rig();
      const bar = 4; // Four quarters at 60 bpm: the fixture's first bar.
      player.start(timeline, {
        staffNumber: null,
        click: 'pulse',
        clickWhen: 'never',
        toIndex: bar - 1,
        repeat: true,
      });
      metronome.advanceSubdivisions(2);
      const from = player.pausedAt;
      player.pause();
      const heldAt = player.pausedAt ?? 0;
      expect(heldAt).toBeGreaterThan(0);
      void from;

      // Picked up where it stopped, and the loop is still the whole bar.
      player.start(timeline, {
        staffNumber: null,
        click: 'pulse',
        clickWhen: 'never',
        fromIndex: heldAt,
        toIndex: bar - 1,
        repeat: true,
        loopFromIndex: 0,
      });
      const before = instrument.played.length;
      metronome.advanceSubdivisions(12);

      // Every note of the bar comes round, including the ones in front of
      // where the reader had paused.
      const sounded = new Set(instrument.played.slice(before).map((note) => note.midi));
      const whole = new Set(
        timeline.steps.slice(0, bar).flatMap((step) => step.notes.map((note) => note.midi)),
      );
      for (const midi of whole) {
        expect(sounded).toContain(midi);
      }
    });

    it('takes the marker back to the top of the passage, not to the pause', () => {
      const { player, metronome, renderer, timeline } = rig();
      player.start(timeline, {
        staffNumber: null,
        click: 'pulse',
        clickWhen: 'never',
        fromIndex: 2,
        toIndex: 3,
        repeat: true,
        loopFromIndex: 0,
      });

      metronome.advanceSubdivisions(6);

      // It came round to step 0, which is where the passage begins - not to
      // step 2, which is only where this performance happened to start.
      expect(renderer.cursor.moves).toContain(0);
    });

    it('stops going round when the reader says so, at the end of the lap', () => {
      // A reader who turns the repeat off means this reading to be the last,
      // and saying so must not stop the music.
      const { player, metronome, timeline } = rig();
      const finished: unknown[] = [];
      player.events.on('finished', () => finished.push(true));
      player.start(timeline, {
        staffNumber: null,
        click: 'pulse',
        clickWhen: 'never',
        repeat: true,
      });
      metronome.advanceSubdivisions(2);

      player.setRepeating(false);
      expect(finished).toEqual([]);
      expect(player.isPlaying).toBe(true);

      metronome.advanceSubdivisions(10);
      expect(finished).toHaveLength(1);
    });
  });

  it('holds a note for as long as it is written, ties included', () => {
    const { player, metronome, instrument, timeline } = rig(tiedExercise({ tempoBpm: 60 }));
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });
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
    player.start(buildTimeline(doubled), { staffNumber: null, click: 'pulse', clickWhen: 'never' });
    metronome.advanceSubdivisions(8);

    const struck = instrument.played.map((note) => `${note.midi}@${note.atMs}`);
    expect(new Set(struck).size).toBe(struck.length);
  });

  it('lets the pedal hold a note past its written length', () => {
    // A quarter struck under the pedal rings until the pedal comes up, which
    // is the only way a schedule of starts and stops can say "damper down".
    const base = twoBarExercise({ tempoBpm: 60 });
    const pedalled = {
      ...base,
      pedalMarks: [
        { measureIndex: 0, offsetTicks: 0, type: 'start' as const, line: true },
        { measureIndex: 1, offsetTicks: 0, type: 'stop' as const, line: true },
      ],
    };
    const { player, metronome, instrument } = rig(pedalled);
    player.start(buildTimeline(pedalled), { staffNumber: null, click: 'pulse', clickWhen: 'never' });
    metronome.advanceSubdivisions(12);

    // The first note is written as a quarter and released at the bar line.
    const struck = instrument.played.find((note) => note.midi === MIDI.C4);
    const release = instrument.stopped.find((note) => note.midi === MIDI.C4);
    expect(struck?.atMs).toBe(0);
    expect(release?.atMs).toBe(4_000);
  });

  it('can sound one hand alone', () => {
    const { player, metronome, instrument, timeline } = rig();
    player.start(timeline, { staffNumber: 2, click: 'pulse', clickWhen: 'never' });
    metronome.advanceSubdivisions(8);

    const sounded = new Set(instrument.played.map((note) => note.midi));
    expect(sounded.has(MIDI.C3)).toBe(true);
    expect(sounded.has(MIDI.C4)).toBe(false);
  });

  it('walks the cursor with the music', () => {
    const { player, metronome, renderer, timeline } = rig();
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });

    metronome.advanceSubdivisions(1);
    expect(renderer.cursor.position).toBe(0);
    metronome.advanceSubdivisions(1);
    expect(renderer.cursor.position).toBe(1);
    expect(timeline.at(1)?.onsetTicks).toBe(Duration.QUARTER.ticks);
  });

  it('stops itself at the end, and says so', () => {
    const { player, metronome, timeline } = rig();
    let finished = 0;
    player.events.on('finished', () => {
      finished += 1;
    });
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });
    expect(player.isPlaying).toBe(true);

    metronome.advanceSubdivisions(12);

    expect(finished).toBe(1);
    expect(player.isPlaying).toBe(false);
    expect(metronome.isRunning).toBe(false);
  });

  it('goes quiet when it is stopped partway', () => {
    const { player, metronome, instrument, timeline } = rig();
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });
    metronome.advanceSubdivisions(2);

    player.stop();

    expect(player.isPlaying).toBe(false);
    expect(instrument.stopAllCount).toBeGreaterThan(0);
  });

  it('uses no timer of its own', () => {
    // The whole playback replays from hand-advanced ticks, which is the same
    // property the practice loop has and the reason either can be tested.
    const { player, metronome, instrument, timeline } = rig();
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });
    metronome.advanceSubdivisions(12);

    expect(instrument.played.length).toBeGreaterThan(0);
  });
});

describe('rolling a chord the writer marked', () => {
  /** Attack times of one chord, low note first. */
  function attacks(instrument: RecordingPitchPlayer): { midi: number; atMs: number }[] {
    return instrument.played
      .map((note) => ({ midi: note.midi, atMs: note.atMs ?? 0 }))
      .sort((left, right) => left.midi - right.midi);
  }

  function playArpeggio(options: { tempoBpm?: number; staffNumber?: number | null } = {}) {
    const harness = rig(arpeggiatedExercise({ tempoBpm: options.tempoBpm ?? 60 }));
    harness.player.start(harness.timeline, {
      staffNumber: options.staffNumber ?? null,
      click: 'pulse',
      clickWhen: 'never',
    });
    harness.metronome.advanceSubdivisions(4);
    return harness;
  }

  it('spreads the notes instead of striking them together', () => {
    const { instrument } = playArpeggio();
    const times = attacks(instrument).map((note) => note.atMs);

    expect(new Set(times).size).toBe(times.length);
  });

  it('rolls from the bottom up, as a hand does', () => {
    const { instrument } = playArpeggio();
    const played = attacks(instrument);

    // C3 G3 C4 E4 G4: sorted by pitch, the times must also be ascending.
    expect(played.map((note) => note.midi)).toEqual([MIDI.C3, MIDI.G3, MIDI.C4, MIDI.E4, MIDI.G4]);
    for (let at = 1; at < played.length; at += 1) {
      const previous = played[at - 1]?.atMs ?? 0;
      expect((played[at]?.atMs ?? 0) > previous).toBe(true);
    }
  });

  it('starts on the beat rather than arriving on it', () => {
    const { instrument } = playArpeggio();

    // The click sounds here and the cursor sits here, so the lowest note -
    // the one carrying the harmony - lands with them.
    expect(attacks(instrument)[0]?.atMs).toBe(0);
  });

  it('rolls across both staves as one gesture', () => {
    const { instrument } = playArpeggio();
    const played = attacks(instrument);
    const gaps = played
      .slice(1)
      .map((note, at) => note.atMs - (played[at]?.atMs ?? 0));

    // Two separate rolls would restart at zero for the treble, leaving one
    // gap of zero and the hands struck together.
    for (const gap of gaps) {
      expect(gap).toBeGreaterThan(0);
    }
    expect(new Set(gaps.map((gap) => Math.round(gap))).size).toBe(1);
  });

  it('releases the chord together, however late a note began', () => {
    const { instrument } = playArpeggio();

    // The hand lifts once: only the attack moves.
    const releases = new Set(instrument.stopped.map((note) => note.atMs));
    expect(releases.size).toBe(1);
  });

  it('keeps the roll inside its own beat at speed', () => {
    // A whole-note chord has room to spare, so the cap only shows itself on a
    // short one: an eighth at 240 bpm lasts 125 ms, and the delay that sounds
    // right slowly would spread five notes over 152.
    const harness = rig(shortArpeggio());
    harness.player.start(harness.timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });
    harness.metronome.advanceSubdivisions(8);

    const played = attacks(harness.instrument);
    const spread = (played[played.length - 1]?.atMs ?? 0) - (played[0]?.atMs ?? 0);

    expect(played).toHaveLength(5);
    expect(spread).toBeGreaterThan(0);
    expect(spread).toBeLessThanOrEqual(125 / 2);
  });

  it('starts on the beat when only one hand is being heard', () => {
    const { instrument } = playArpeggio({ staffNumber: 1 });
    const played = attacks(instrument);

    // The bass is not sounding at all, so waiting for its share of the roll
    // would open a gap with nothing in it.
    expect(played.map((note) => note.midi)).toEqual([MIDI.C4, MIDI.E4, MIDI.G4]);
    expect(played[0]?.atMs).toBe(0);
  });

  it('leaves an unmarked chord struck together', () => {
    const { instrument } = rigAndPlay();

    // The fixture's bass chord carries no roll, so both notes land at once.
    const chord = instrument.played.filter(
      (note) => note.midi === MIDI.G2 || note.midi === MIDI.D3,
    );
    expect(new Set(chord.map((note) => note.atMs)).size).toBe(1);
  });

  /**
   * The same rolled chord, but on an eighth note at 240 bpm.
   *
   * Written by hand rather than from the shared fixture because the point is
   * the *step being short*: the cap it exercises is invisible at any duration
   * with room to spare.
   */
  function shortArpeggio(): Exercise {
    const rolled = noteEntry([p('C4'), p('E4'), p('G4')], Duration.EIGHTH, [], [], null, true);
    const bass = noteEntry([p('C3'), p('G3')], Duration.EIGHTH, [], [], null, true);
    const rest = [restEntry(Duration.HALF), restEntry(Duration.QUARTER), restEntry(Duration.EIGHTH)];
    return {
      id: 'fixture-short-arpeggio',
      title: 'Short arpeggio',
      key: KeySignature.major(0),
      keyChanges: [],
      timeChanges: [],
      tempoChanges: [],
      pedalMarks: [],
      timeSignature: new TimeSignature(4, 4),
      tempoBpm: 240,
      firstBarNumber: 1,
      barLabels: [],
      metadata: { generatorId: 'fixture', seed: 1 },
      staves: [
        { staffNumber: 1, voice: 1, clef: 'treble', clefChanges: [], measures: [bar(rolled, ...rest)] },
        { staffNumber: 2, voice: 2, clef: 'bass', clefChanges: [], measures: [bar(bass, ...rest)] },
      ],
    };
  }

  function rigAndPlay() {
    const harness = rig();
    harness.player.start(harness.timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });
    harness.metronome.advanceSubdivisions(8);
    return harness;
  }
});

describe('what is heard over a performance', () => {
  it('is silent when the reader asked for the click only while counted in', () => {
    // A performance has no count-in, so "only the count-in" is silence - and
    // a plain yes-or-no lost that, playing the click through the whole thing
    // for a reader who had asked to hear it only while being counted in.
    const harness = rig();
    harness.player.start(harness.timeline, { staffNumber: null, click: 'pulse', clickWhen: 'count-in-only' });

    expect(harness.metronome.currentConfig.dropout).toEqual({ kind: 'silent-from', fromBar: 0 });
  });

  it('changes what is heard without interrupting the performance', () => {
    const harness = rig();
    harness.player.start(harness.timeline, { staffNumber: null, click: 'pulse', clickWhen: 'always' });
    harness.metronome.advanceSubdivisions(2);

    harness.player.applyClick('pulse', 'never');

    expect(harness.metronome.currentConfig.muted).toBe(true);
    expect(harness.player.isPlaying).toBe(true);
  });
});

describe('playing a piece that changes tempo', () => {
  /** Two bars at 60, the second at 120: the fixture's own notes, faster. */
  function retimed(): Exercise {
    return {
      ...twoBarExercise({ tempoBpm: 60 }),
      tempoChanges: [{ measureIndex: 1, offsetTicks: 0, tempoBpm: 120 }],
    };
  }

  it('sounds the faster stretch faster', () => {
    // Bar one is four quarters at a second each; bar two is a whole note
    // beginning at four seconds, and at 120 it lasts two rather than four.
    const { player, metronome, instrument, timeline } = rig(retimed());
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });
    metronome.advanceSubdivisions(16);

    const first = instrument.played.find((note) => note.midi === MIDI.C4);
    const second = instrument.played.find((note) => note.midi === MIDI.G4);
    expect(first?.atMs).toBe(0);
    expect(second?.atMs).toBe(4000);

    const release = instrument.stopped.find((note) => note.midi === MIDI.G4);
    expect(release?.atMs).toBe(6000);
  });

  it('beats the change as well as sounding it', () => {
    const { player, metronome, timeline } = rig(retimed());
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'always' });

    expect(metronome.currentConfig.tempos).toEqual([
      { startTicks: 0, bpm: 60 },
      { startTicks: Duration.WHOLE.ticks, bpm: 120 },
    ]);
  });
});

describe('a performance follows the reader as a run does', () => {
  it('clicks the part of the pulse they asked for', () => {
    // Fixed at the felt beat, a performance clicked in crotchets to somebody
    // who had asked for the half-beats - and the setting looked broken rather
    // than unimplemented, because the same button worked the moment they
    // pressed Start.
    const { player, metronome, timeline } = rig();
    player.start(timeline, { staffNumber: null, click: 'division', clickWhen: 'always' });

    expect(metronome.currentConfig.click).toBe('division');
    expect(metronome.currentConfig.subdivisionsPerPulse % 2).toBe(0);
  });

  it('changes the click mid-performance without interrupting it', () => {
    const { player, metronome, timeline } = rig();
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'always' });
    metronome.advanceSubdivisions(2);

    player.applyClick('subdivision', 'always');

    expect(metronome.currentConfig.click).toBe('subdivision');
    expect(player.isPlaying).toBe(true);
  });

  it('says where the music has reached', () => {
    // Only a run published it, so the pill went blank the moment the machine
    // took over the playing - which is exactly when a reader following along
    // wants to know where they are.
    const { player, metronome, timeline } = rig();
    const seen: { measureIndex: number; beat: number }[] = [];
    player.events.on('positionChanged', (at) => seen.push(at));

    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });
    metronome.advanceSubdivisions(6);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toEqual({ measureIndex: 0, beat: 1 });
    // Two bars of 4/4, so it reaches the second bar and counts its beats from
    // one again rather than going on to five.
    expect(seen.some((at) => at.measureIndex === 1 && at.beat === 1)).toBe(true);
    expect(seen.every((at) => at.beat <= 4)).toBe(true);
  });

  it('takes a passage the reader widens while it plays', () => {
    // The stretch was read once at the start and never again, so clearing the
    // passage changed nothing until the performance was stopped and started.
    const { player, metronome, instrument, timeline } = rig();
    player.start(timeline, {
      staffNumber: null,
      click: 'pulse',
      clickWhen: 'never',
      fromIndex: 0,
      // The first bar only.
      toIndex: 3,
    });
    metronome.advanceSubdivisions(2);
    const heardWhileNarrow = instrument.played.length;

    player.retarget(timeline.length - 1);
    metronome.advanceSubdivisions(4);

    expect(player.isPlaying).toBe(true);
    expect(instrument.played.length).toBeGreaterThan(heardWhileNarrow);
    // And nothing already sounded is sounded twice.
    const struck = instrument.played.map((note) => `${note.midi}@${note.atMs}`);
    expect(new Set(struck).size).toBe(struck.length);
  });

  it('sounds nothing twice when a marker moves during a repeat', () => {
    // The complaint this answers: moving a passage marker while a repeating
    // playback ran fired several notes at once and loudly.
    //
    // The scheduler's place was carried as a count, and the count runs on
    // across laps while a passage repeats - so clamping it to the length of
    // the rebuilt list landed it partway through some earlier lap. Every note
    // from there to the horizon was handed over with a moment already long
    // past, and an instrument asked to play at a moment gone by plays at
    // once.
    const { player, metronome, instrument, timeline } = rig();
    player.start(timeline, {
      staffNumber: null,
      click: 'pulse',
      clickWhen: 'never',
      toIndex: 3,
      repeat: true,
    });
    // Well into the third time round, so the count is far past the list.
    metronome.advanceSubdivisions(14);
    const heard = instrument.played.length;
    expect(heard).toBeGreaterThan(4);

    player.retarget(timeline.length - 1);
    metronome.advanceSubdivisions(1);

    // Nothing arrives in a heap: one tick's worth of new sound at most, and
    // no moment sounded twice.
    const struck = instrument.played.map((note) => `${note.midi}@${note.atMs}`);
    expect(new Set(struck).size).toBe(struck.length);
    expect(instrument.played.length - heard).toBeLessThan(4);
  });

  it('stops where a passage narrowed mid-performance now ends', () => {
    const { player, metronome, timeline } = rig();
    const finished: number[] = [];
    player.events.on('finished', () => finished.push(1));
    player.start(timeline, { staffNumber: null, click: 'pulse', clickWhen: 'never' });
    metronome.advanceSubdivisions(4);

    player.retarget(3);
    metronome.advanceSubdivisions(2);

    expect(finished).toHaveLength(1);
    expect(player.isPlaying).toBe(false);
  });
});

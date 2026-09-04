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
        { measureIndex: 0, offsetTicks: 0, type: 'start' as const },
        { measureIndex: 1, offsetTicks: 0, type: 'stop' as const },
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

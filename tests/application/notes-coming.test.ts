import { describe, expect, it } from 'vitest';
import { BarMode } from '../../src/application/modes/BarMode.js';
import { FlowMode } from '../../src/application/modes/FlowMode.js';
import type { IPracticeMode } from '../../src/application/modes/IPracticeMode.js';
import { NoteMode } from '../../src/application/modes/NoteMode.js';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import type { NotesComing } from '../../src/application/session/PracticeSession.js';
import { MIDI, twoBarExercise } from '../support/fixtures.js';
import { createHarness, type Harness } from '../support/harness.js';

/**
 * Two bars at sixty, counted in for one: the music begins at four seconds,
 * a quarter a second. The first bar's four quarters, both hands on the first;
 * the second bar's chord, and a rest the bass keeps that is owed nothing.
 */
function harnessFor(mode: IPracticeMode): Harness {
  return createHarness({
    exercise: twoBarExercise({ tempoBpm: 60 }),
    mode,
    options: {
      countInBars: 1,
      clickWhen: 'never',
      click: 'subdivision',
      matchPolicy: { toleranceMs: 250, pitchClassOnly: false },
    },
  });
}

/** Through the count-in to the tick the music begins on. */
function countedIn(harness: Harness): void {
  harness.session.start();
  harness.metronome.advanceSubdivisions(4 * 4 + 1);
}

function play(harness: Harness, ...midi: readonly number[]): void {
  for (const note of midi) {
    harness.midi.noteOn(note, harness.clock.now());
  }
}

const said = (coming: readonly NotesComing[]): [number, number, number[]][] =>
  coming.map((notes) => [notes.stepIndex, notes.atMs, [...notes.midis].sort((left, right) => left - right)]);

describe('the notes the music will reach on its own', () => {
  it('gives each the reader owes, and when its beat falls, where the music keeps time', () => {
    const harness = harnessFor(new FlowMode());
    expect(harness.session.notesComingBefore(60_000)).toEqual([]);
    countedIn(harness);

    expect(said(harness.session.notesComingBefore(9_000))).toEqual([
      [0, 4_000, [MIDI.C3, MIDI.C4]],
      [1, 5_000, [MIDI.D4]],
      [2, 6_000, [MIDI.E4]],
      [3, 7_000, [MIDI.F4]],
      [4, 8_000, [MIDI.G2, MIDI.D3, MIDI.G4]],
    ]);
    // Not one whose beat falls at the moment asked about, and not the rest
    // the bass keeps, which is owed nothing.
    expect(said(harness.session.notesComingBefore(7_000)).map(([step]) => step)).toEqual([0, 1, 2]);
    expect(said(harness.session.notesComingBefore(60_000)).map(([step]) => step)).toEqual([0, 1, 2, 3, 4]);

    harness.session.pause();
    expect(harness.session.notesComingBefore(60_000)).toEqual([]);
  });

  it('gives none past the bar line, and none while the music stands at one, where it waits at bar lines', () => {
    const harness = harnessFor(new BarMode());
    countedIn(harness);

    // The first bar's downbeat is the reader's to give.
    expect(harness.session.notesComingBefore(60_000)).toEqual([]);

    play(harness, MIDI.C3, MIDI.C4);
    const begun = harness.clock.now();

    expect(said(harness.session.notesComingBefore(60_000)).map(([step, atMs]) => [step, atMs - begun])).toEqual([
      [0, 0],
      [1, 1_000],
      [2, 2_000],
      [3, 3_000],
    ]);
  });

  it('gives none past a note not yet played, where the music waits at every note', () => {
    const harness = harnessFor(new NoteMode());
    countedIn(harness);

    expect(said(harness.session.notesComingBefore(60_000)).map(([step]) => step)).toEqual([0]);

    // Played in time, and the music goes on: the next is known too.
    play(harness, MIDI.C3, MIDI.C4);

    expect(said(harness.session.notesComingBefore(60_000)).map(([step, atMs]) => [step, atMs])).toEqual([
      [0, 4_000],
      [1, 5_000],
    ]);
  });

  it('gives none where the reader is the clock', () => {
    const harness = harnessFor(new WaitMode());
    countedIn(harness);
    play(harness, MIDI.C3, MIDI.C4);

    expect(harness.session.notesComingBefore(60_000)).toEqual([]);
  });

  it('says where each mode may stand, as its gates do', () => {
    expect(new FlowMode().standsStill).toBe('nowhere');
    expect(new BarMode().standsStill).toBe('at-bar-lines');
    expect(new NoteMode().standsStill).toBe('at-notes');
    expect(new WaitMode().standsStill).toBe('at-notes');
  });
});

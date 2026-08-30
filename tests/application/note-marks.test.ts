import { describe, expect, it } from 'vitest';
import { FlowMode } from '../../src/application/modes/FlowMode.js';
import { playedNoteOffset } from '../../src/application/playedNoteOffset.js';
import { MIDI, twoBarExercise } from '../support/fixtures.js';
import { createHarness } from '../support/harness.js';

/** One bar of 4/4 at 60 bpm: a quarter lasts a second, a subdivision 250 ms. */
const SUBDIVISION_MS = 250;
const TICKS_TO_START = 4 * 4 + 1;
const RUN_STARTS_AT_MS = (TICKS_TO_START - 1) * SUBDIVISION_MS;
/** The second beat wants D4, and nothing else on the page does. */
const DUE_AT_MS = 1_000;

interface Decision {
  readonly verdict: string;
  readonly stepIndex: number;
  /** Where the mark lands, as a fraction of the gap to its neighbour. */
  readonly offset: number;
}

/**
 * Plays D4 at one moment and reports what the page decided about it.
 *
 * The first beat is played cleanly first, so nothing is owed and the only
 * thing under test is where this one press lands.
 */
function pressAt(atMs: number): Decision {
  const harness = createHarness({
    exercise: twoBarExercise({ tempoBpm: 60 }),
    mode: new FlowMode(),
    options: {
      countInBars: 1,
      clickWhen: 'never',
      click: 'subdivision',
      matchPolicy: { toleranceMs: 250, pitchClassOnly: false },
    },
  });
  harness.session.start();
  harness.metronome.advanceSubdivisions(TICKS_TO_START);
  harness.midi.playChord([MIDI.C3, MIDI.C4], RUN_STARTS_AT_MS);

  const target = RUN_STARTS_AT_MS + atMs;
  while (harness.clock.now() < target - SUBDIVISION_MS) {
    harness.metronome.advanceSubdivisions(1);
  }
  harness.clock.set(target);
  harness.midi.noteOn(MIDI.D4);
  harness.metronome.advanceSubdivisions(12);

  const judged = harness.of('noteJudged').filter((event) => event.midi === MIDI.D4).at(-1);
  if (judged === undefined) {
    throw new Error(`Nothing was judged for a press at ${atMs} ms.`);
  }
  return {
    verdict: judged.verdict,
    stepIndex: judged.stepIndex,
    offset: playedNoteOffset(harness.timeline, judged.stepIndex, judged.deviationMs, 60),
  };
}

/**
 * Every millisecond a press could land on, swept.
 *
 * Written as a sweep rather than as cases because the faults here have all
 * been *seams*: a press one millisecond either side of some boundary getting
 * a different colour, or jumping most of a beat across the page. Cases chosen
 * by hand test the places one already thought about, which are exactly the
 * places that were not broken.
 */
describe('where a press lands on the page', () => {
  const SWEEP = Array.from({ length: 33 }, (_, at) => 200 + at * 50);

  it('is never called wrong while its own beat is the nearer one', () => {
    // Dead on the beat was once the single moment the page called wrong: the
    // rule refused anything at or past the beat, so the press fell through to
    // the step behind, which is not asking for that note.
    for (const at of SWEEP.filter((each) => Math.abs(each - DUE_AT_MS) < DUE_AT_MS / 2)) {
      expect({ at, verdict: pressAt(at).verdict }).toEqual({ at, verdict: 'correct' });
    }
  });

  it('belongs to whichever beat it was nearer to', () => {
    for (const at of SWEEP) {
      const nearer = Math.abs(at - DUE_AT_MS) < Math.abs(at - 0) ? 1 : 0;
      expect({ at, step: pressAt(at).stepIndex }).toEqual({ at, step: nearer });
    }
  });

  it('moves across the page in step with the press, never jumping', () => {
    // The mark's place is the reader's only picture of *when* they played, so
    // it has to move the way the playing did: a millisecond later must never
    // be a leap, and never backwards.
    const places = SWEEP.map((at) => {
      const { stepIndex, offset } = pressAt(at);
      // Distance from the first beat, in gaps, so both steps share one line.
      return { at, place: stepIndex + offset };
    });

    for (let index = 1; index < places.length; index += 1) {
      const previous = places[index - 1];
      const current = places[index];
      if (previous === undefined || current === undefined) {
        continue;
      }
      expect({ at: current.at, forward: current.place >= previous.place }).toEqual({
        at: current.at,
        forward: true,
      });
      expect({ at: current.at, leap: current.place - previous.place > 0.5 }).toEqual({
        at: current.at,
        leap: false,
      });
    }
  });

  it('draws a press within the dead zone exactly on its note', () => {
    // Nobody lands on a beat to the millisecond, and a mark that trembled
    // would stop the page ever saying "that one was on the beat".
    expect(pressAt(DUE_AT_MS).offset).toBe(0);
    expect(pressAt(DUE_AT_MS - 100).offset).toBe(0);
    expect(pressAt(DUE_AT_MS + 100).offset).toBe(0);
  });
});

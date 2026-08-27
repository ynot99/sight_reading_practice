import { describe, expect, it } from 'vitest';
import { FlowMode } from '../../src/application/modes/FlowMode.js';
import { TimingWeightedScoringStrategy } from '../../src/domain/scoring/strategies.js';
import { MIDI, twoBarExercise } from '../support/fixtures.js';
import { createHarness, type Harness } from '../support/harness.js';

/** Bar of 4/4 at 60 bpm: one quarter note lasts 1000 ms, one subdivision 250 ms. */
const SUBDIVISION_MS = 250;
const COUNT_IN_BARS = 1;
/** Felt beats the count-in occupies: one bar of 4/4. */
const COUNT_IN_PULSES = 4;
/** Ticks consumed by the count-in, plus the tick that starts the music. */
const TICKS_TO_START = COUNT_IN_PULSES * 4 + 1;
/** Clock time of musical position zero, once the count-in has been played. */
const RUN_STARTS_AT_MS = (TICKS_TO_START - 1) * SUBDIVISION_MS;

function flowHarness(): Harness {
  return createHarness({
    exercise: twoBarExercise({ tempoBpm: 60 }),
    mode: new FlowMode(),
    scoring: new TimingWeightedScoringStrategy(),
    options: {
      countInBars: COUNT_IN_BARS,
      metronomeMuted: true,
      // Sixteenth-note resolution: the loop ticks at least as often as the
      // chosen click, and this exercise's quarters would otherwise need only
      // one tick per beat.
      click: 'subdivision',
      matchPolicy: { toleranceMs: 250, pitchClassOnly: false },
    },
  });
}

/** Starts the session and plays through the count-in. */
function startAndCountIn(harness: Harness): void {
  harness.session.start();
  harness.metronome.advanceSubdivisions(TICKS_TO_START);
}

describe('Flow mode', () => {
  it('runs a count-in before the first note', () => {
    const harness = flowHarness();
    harness.session.start();

    expect(harness.session.status).toBe('counting-in');
    expect(harness.metronome.isRunning).toBe(true);

    harness.metronome.advanceSubdivisions(4);
    expect(harness.of('countIn').map((event) => event.beatsRemaining)).toEqual([4]);
    expect(harness.session.status).toBe('counting-in');

    harness.metronome.advanceSubdivisions(4);
    expect(harness.of('countIn').map((event) => event.beatsRemaining)).toEqual([4, 3]);

    harness.metronome.advanceSubdivisions(8);
    expect(harness.of('countIn').map((event) => event.beatsRemaining)).toEqual([4, 3, 2, 1]);

    harness.metronome.advanceSubdivisions(1);
    expect(harness.session.status).toBe('running');
    expect(harness.session.currentIndex).toBe(0);
  });

  it('anchors musical position zero to the first beat after the count-in', () => {
    const harness = flowHarness();
    startAndCountIn(harness);

    // The clock now sits on the last emitted tick: the first beat of the music.
    expect(harness.clock.now()).toBe((TICKS_TO_START - 1) * SUBDIVISION_MS);
    expect(harness.session.currentStep?.onsetTicks).toBe(0);
  });

  it('advances with the beat, whatever the player does', () => {
    const harness = flowHarness();
    startAndCountIn(harness);

    expect(harness.session.currentIndex).toBe(0);
    harness.metronome.advanceSubdivisions(3);
    expect(harness.session.currentIndex).toBe(0);

    harness.metronome.advanceSubdivisions(1);
    expect(harness.session.currentIndex).toBe(1);

    harness.metronome.advanceSubdivisions(4);
    expect(harness.session.currentIndex).toBe(2);
  });

  it('marks untouched steps as missed and ends the run on its own', () => {
    const harness = flowHarness();
    startAndCountIn(harness);
    harness.metronome.advanceSubdivisions(32);

    expect(harness.session.status).toBe('completed');
    const statuses = harness.of('stepCompleted').map((event) => event.result.status);
    expect(statuses).toEqual(['missed', 'missed', 'missed', 'missed', 'missed', 'skipped']);

    const [finished] = harness.of('finished');
    expect(finished?.report.totals.correctNotes).toBe(0);
    expect(finished?.score.overall).toBe(0);
    expect(finished?.score.grade).toBe('F');
  });

  it('scores notes played on the beat as perfectly in time', () => {
    const harness = flowHarness();
    startAndCountIn(harness);

    harness.midi.playChord([MIDI.C3, MIDI.C4]);
    harness.metronome.advanceSubdivisions(4);
    harness.midi.noteOn(MIDI.D4);
    harness.metronome.advanceSubdivisions(4);
    harness.midi.noteOn(MIDI.E4);
    harness.metronome.advanceSubdivisions(4);
    harness.midi.noteOn(MIDI.F4);
    harness.metronome.advanceSubdivisions(4);
    harness.midi.playChord([MIDI.G2, MIDI.D3, MIDI.G4]);
    harness.metronome.advanceSubdivisions(16);

    const results = harness.of('stepCompleted').map((event) => event.result);
    expect(results.map((result) => result.status)).toEqual([
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
      'skipped',
    ]);
    expect(results.slice(0, 5).every((result) => result.deviationMs === 0)).toBe(true);

    const [finished] = harness.of('finished');
    expect(finished?.report.timing.meanAbsoluteDeviationMs).toBe(0);
    expect(finished?.score.timing).toBe(1);
    expect(finished?.score.accuracy).toBe(1);
    expect(finished?.score.grade).toBe('A');
  });

  it('measures how late a press was, relative to the printed beat', () => {
    const harness = flowHarness();
    startAndCountIn(harness);

    // One subdivision after the beat: 250 ms late.
    harness.metronome.advanceSubdivisions(1);
    harness.midi.playChord([MIDI.C3, MIDI.C4]);
    harness.metronome.advanceSubdivisions(3);

    const [first] = harness.of('stepCompleted');
    expect(first?.result.status).toBe('correct');
    expect(first?.result.deviationMs).toBe(250);
  });

  it('measures early presses as negative deviations', () => {
    const harness = flowHarness();
    startAndCountIn(harness);
    harness.metronome.advanceSubdivisions(3);

    // Played 250 ms before the second step is due.
    harness.metronome.advanceSubdivisions(1);
    harness.clock.advance(-SUBDIVISION_MS);
    harness.midi.noteOn(MIDI.D4);
    harness.clock.advance(SUBDIVISION_MS);
    harness.metronome.advanceSubdivisions(4);

    const second = harness.of('stepCompleted')[1];
    expect(second?.result.deviationMs).toBe(-SUBDIVISION_MS);
  });

  it('counts an incomplete chord as missed but keeps what was played', () => {
    const harness = flowHarness();
    startAndCountIn(harness);

    harness.midi.noteOn(MIDI.C4);
    harness.metronome.advanceSubdivisions(4);

    const [first] = harness.of('stepCompleted');
    expect(first?.result.status).toBe('missed');
    expect(first?.result.played).toEqual([MIDI.C4]);
    expect(first?.result.missing).toEqual([MIDI.C3]);
  });

  it('treats presses during a rest position as extra notes', () => {
    const harness = flowHarness();
    startAndCountIn(harness);
    // Move into the final rest position.
    harness.metronome.advanceSubdivisions(24);
    expect(harness.session.currentStep?.notes).toHaveLength(0);

    harness.midi.noteOn(MIDI.C4);

    const judged = harness.of('noteJudged');
    expect(judged.at(-1)?.verdict).toBe('wrong');
    harness.metronome.advanceSubdivisions(8);
    const last = harness.of('stepCompleted').at(-1);
    expect(last?.result.wrong).toEqual([MIDI.C4]);
  });

  describe('a press that arrives just before the beat', () => {
    it('counts for the note it was reaching for, not against the one going out', () => {
      const harness = flowHarness();
      startAndCountIn(harness);
      // Step 0 falls on musical zero, step 1 a quarter note later.
      harness.metronome.advanceSubdivisions(3);

      harness.clock.set(RUN_STARTS_AT_MS + 950);
      harness.midi.noteOn(MIDI.D4);
      // Nothing is judged yet: the step it belongs to has not opened.
      expect(harness.of('noteJudged')).toHaveLength(0);

      harness.metronome.advanceSubdivisions(1);

      const [judged] = harness.of('noteJudged');
      expect(judged?.verdict).toBe('correct');
      expect(judged?.stepIndex).toBe(1);
      // Fifty milliseconds early, and recorded as such.
      expect(judged?.deviationMs).toBe(-50);
    });

    it('leaves the step it was aimed at looking clean', () => {
      const harness = flowHarness();
      startAndCountIn(harness);
      harness.metronome.advanceSubdivisions(3);
      harness.clock.set(RUN_STARTS_AT_MS + 950);
      harness.midi.noteOn(MIDI.D4);
      // Far enough for both steps to have run their course.
      harness.metronome.advanceSubdivisions(8);

      const results = harness.of('stepCompleted').map((event) => event.result);
      // The bar it was played against keeps no wrong note...
      expect(results[0]?.wrong).toEqual([]);
      // ...and the bar it was meant for counts it.
      expect(results[1]?.status).toBe('correct');
      expect(results[1]?.played).toEqual([MIDI.D4]);
    });

    it('still belongs where it fell when it is nowhere near the beat', () => {
      const harness = flowHarness();
      startAndCountIn(harness);
      harness.metronome.advanceSubdivisions(2);

      // Three hundred milliseconds early is not a mis-timed beat, it is a
      // different note.
      harness.clock.set(RUN_STARTS_AT_MS + 700);
      harness.midi.noteOn(MIDI.D4);

      const [judged] = harness.of('noteJudged');
      expect(judged?.verdict).toBe('wrong');
      expect(judged?.stepIndex).toBe(0);
    });

    it('never steals a chord note the current step is still waiting for', () => {
      const harness = flowHarness();
      startAndCountIn(harness);
      harness.midi.noteOn(MIDI.C4);
      harness.metronome.advanceSubdivisions(3);

      // C3 completes the chord of step 0, late but unmistakably its own.
      harness.clock.set(RUN_STARTS_AT_MS + 950);
      harness.midi.noteOn(MIDI.C3);

      const judged = harness.of('noteJudged');
      expect(judged.at(-1)?.verdict).toBe('correct');
      expect(judged.at(-1)?.stepIndex).toBe(0);
      expect(judged.at(-1)?.deviationMs).toBe(950);
    });

    it('shrinks the window with the tempo, rather than swallowing a step', () => {
      const harness = createHarness({
        // A quarter note lasts 200 ms here, so half a step is 100 ms.
        exercise: twoBarExercise({ tempoBpm: 300 }),
        mode: new FlowMode(),
        options: {
          countInBars: COUNT_IN_BARS,
          metronomeMuted: true,
          click: 'subdivision',
          matchPolicy: { toleranceMs: 250, pitchClassOnly: false },
        },
      });
      startAndCountIn(harness);
      // A subdivision is 50 ms at this tempo, so the music starts here.
      const fastStart = (TICKS_TO_START - 1) * 50;
      harness.metronome.advanceSubdivisions(1);

      // 119 ms early: inside the fixed window, but past half a step, which is
      // all the room there is at this tempo.
      harness.clock.set(fastStart + 81);
      harness.midi.noteOn(MIDI.D4);

      const [judged] = harness.of('noteJudged');
      expect(judged?.stepIndex).toBe(0);
      expect(judged?.verdict).toBe('wrong');
    });

    it('forgets anything held back when the run ends', () => {
      const harness = flowHarness();
      startAndCountIn(harness);
      harness.metronome.advanceSubdivisions(3);
      harness.clock.set(RUN_STARTS_AT_MS + 950);
      harness.midi.noteOn(MIDI.D4);

      harness.session.abort();
      harness.session.start();
      harness.metronome.advanceSubdivisions(TICKS_TO_START);

      // The press belonged to a run that is over.
      expect(harness.of('noteJudged')).toHaveLength(0);
    });
  });

  it('publishes the pulse to interested listeners only while running', () => {
    const harness = flowHarness();
    harness.session.start();
    harness.metronome.advanceSubdivisions(TICKS_TO_START - 1);
    expect(harness.of('beat')).toHaveLength(0);

    harness.metronome.advanceSubdivisions(1);
    expect(harness.of('beat')).toHaveLength(1);
    expect(harness.of('beat')[0]?.positionTicks).toBe(1920);
  });

  it('stops the pulse when the run ends', () => {
    const harness = flowHarness();
    startAndCountIn(harness);
    harness.metronome.advanceSubdivisions(32);

    expect(harness.session.status).toBe('completed');
    expect(harness.metronome.isRunning).toBe(false);
  });
});

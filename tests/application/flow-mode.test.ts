import { describe, expect, it } from 'vitest';
import { FlowMode } from '../../src/application/modes/FlowMode.js';
import { TimingWeightedScoringStrategy } from '../../src/domain/scoring/strategies.js';
import { MIDI, twoBarExercise } from '../support/fixtures.js';
import { createHarness, type Harness } from '../support/harness.js';

/** Bar of 4/4 at 60 bpm: one quarter note lasts 1000 ms, one subdivision 250 ms. */
const SUBDIVISION_MS = 250;
const COUNT_IN_BEATS = 2;
/** Ticks consumed by the count-in, plus the tick that starts the music. */
const TICKS_TO_START = COUNT_IN_BEATS * 4 + 1;

function flowHarness(): Harness {
  return createHarness({
    exercise: twoBarExercise({ tempoBpm: 60 }),
    mode: new FlowMode(),
    scoring: new TimingWeightedScoringStrategy(),
    options: {
      countInBeats: COUNT_IN_BEATS,
      metronomeMuted: true,
      subdivisionsPerBeat: 4,
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
    expect(harness.of('countIn').map((event) => event.beatsRemaining)).toEqual([2]);
    expect(harness.session.status).toBe('counting-in');

    harness.metronome.advanceSubdivisions(4);
    expect(harness.of('countIn').map((event) => event.beatsRemaining)).toEqual([2, 1]);

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

  it('publishes the pulse to interested listeners only while running', () => {
    const harness = flowHarness();
    harness.session.start();
    harness.metronome.advanceSubdivisions(8);
    expect(harness.of('beat')).toHaveLength(0);

    harness.metronome.advanceSubdivisions(1);
    expect(harness.of('beat')).toHaveLength(1);
    expect(harness.of('beat')[0]?.positionTicks).toBe(960);
  });

  it('stops the pulse when the run ends', () => {
    const harness = flowHarness();
    startAndCountIn(harness);
    harness.metronome.advanceSubdivisions(32);

    expect(harness.session.status).toBe('completed');
    expect(harness.metronome.isRunning).toBe(false);
  });
});

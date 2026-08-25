import { describe, expect, it } from 'vitest';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import { MIDI, twoBarExercise } from '../support/fixtures.js';
import { createHarness, type Harness } from '../support/harness.js';

function waitHarness(overrides: Partial<Parameters<typeof createHarness>[0]> = {}): Harness {
  return createHarness({
    exercise: twoBarExercise(),
    mode: new WaitMode(),
    options: {
      countInBeats: 0,
      metronomeMuted: true,
      matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false },
    },
    ...overrides,
  });
}

describe('Wait mode', () => {
  it('starts running immediately and without a pulse', () => {
    const harness = waitHarness();
    harness.session.start();

    expect(harness.session.status).toBe('running');
    expect(harness.metronome.isRunning).toBe(false);
    expect(harness.session.currentIndex).toBe(0);
    expect(harness.of('stepEntered')[0]?.step.expectedMidi).toEqual([MIDI.C3, MIDI.C4]);
  });

  it('does not advance until every notated pitch has sounded', () => {
    const harness = waitHarness();
    harness.session.start();

    harness.midi.noteOn(MIDI.C4, 0);
    expect(harness.session.currentIndex).toBe(0);

    harness.midi.noteOn(MIDI.C3, 30);
    expect(harness.session.currentIndex).toBe(1);
    expect(harness.session.currentStep?.expectedMidi).toEqual([MIDI.D4]);
  });

  it('records wrong notes but keeps waiting for the right ones', () => {
    const harness = waitHarness();
    harness.session.start();
    harness.midi.playChord([MIDI.C3, MIDI.C4], 0);

    harness.midi.noteOn(MIDI.E4, 100);
    expect(harness.session.currentIndex).toBe(1);

    harness.midi.noteOn(MIDI.D4, 200);
    expect(harness.session.currentIndex).toBe(2);

    const [, second] = harness.of('stepCompleted');
    expect(second?.result.status).toBe('incorrect');
    expect(second?.result.wrong).toEqual([MIDI.E4]);
    expect(second?.result.played).toEqual([MIDI.D4]);
  });

  it('publishes a verdict for every press', () => {
    const harness = waitHarness();
    harness.session.start();

    harness.midi.noteOn(MIDI.C4, 0);
    harness.midi.noteOn(MIDI.C4, 10);
    harness.midi.noteOn(MIDI.F5, 20);

    expect(harness.of('noteJudged').map((event) => event.verdict)).toEqual([
      'correct',
      'duplicate',
      'wrong',
    ]);
    expect(harness.of('noteJudged')[0]?.remaining).toEqual([MIDI.C3]);
  });

  it('skips rest positions without waiting for input', () => {
    const harness = waitHarness();
    harness.session.start();

    harness.midi.playChord([MIDI.C3, MIDI.C4], 0);
    harness.midi.noteOn(MIDI.D4, 100);
    harness.midi.noteOn(MIDI.E4, 200);
    harness.midi.noteOn(MIDI.F4, 300);
    expect(harness.session.currentIndex).toBe(4);

    harness.midi.playChord([MIDI.G2, MIDI.D3, MIDI.G4], 400);

    // The final rest position completes on its own, ending the session.
    const statuses = harness.of('stepCompleted').map((event) => event.result.status);
    expect(statuses).toEqual(['correct', 'correct', 'correct', 'correct', 'correct', 'skipped']);
    expect(harness.session.status).toBe('completed');
  });

  it('reports a clean run as a perfect score', () => {
    const harness = waitHarness();
    harness.session.start();

    harness.midi.playChord([MIDI.C3, MIDI.C4], 0);
    harness.midi.noteOn(MIDI.D4, 100);
    harness.midi.noteOn(MIDI.E4, 200);
    harness.midi.noteOn(MIDI.F4, 300);
    harness.midi.playChord([MIDI.G2, MIDI.D3, MIDI.G4], 400);

    const [finished] = harness.of('finished');
    expect(finished).toBeDefined();
    expect(finished?.report.completed).toBe(true);
    expect(finished?.report.totals.expectedNotes).toBe(8);
    expect(finished?.report.totals.correctNotes).toBe(8);
    expect(finished?.report.totals.wrongNotes).toBe(0);
    expect(finished?.report.steps).toHaveLength(6);
    expect(finished?.score.accuracy).toBe(1);
    expect(finished?.score.grade).toBe('A');
    expect(harness.session.report).toBe(finished?.report);
  });

  it('ignores input once the run is over', () => {
    const harness = waitHarness();
    harness.session.start();
    harness.midi.playChord([MIDI.C3, MIDI.C4], 0);
    harness.midi.noteOn(MIDI.D4, 10);
    harness.midi.noteOn(MIDI.E4, 20);
    harness.midi.noteOn(MIDI.F4, 30);
    harness.midi.playChord([MIDI.G2, MIDI.D3, MIDI.G4], 40);
    expect(harness.session.status).toBe('completed');

    const judgedBefore = harness.of('noteJudged').length;
    harness.midi.noteOn(MIDI.C4, 50);
    expect(harness.of('noteJudged')).toHaveLength(judgedBefore);
  });

  it('ignores input before the session starts', () => {
    const harness = waitHarness();
    harness.midi.noteOn(MIDI.C4, 0);
    expect(harness.of('noteJudged')).toHaveLength(0);
    expect(harness.session.status).toBe('idle');
  });

  describe('with a finite chord window', () => {
    it('treats a late note as the start of a new attempt', () => {
      const harness = waitHarness({
        exercise: twoBarExercise(),
        mode: new WaitMode(),
        options: {
          countInBeats: 0,
          metronomeMuted: true,
          matchPolicy: { toleranceMs: 200, pitchClassOnly: false },
        },
      });
      harness.session.start();

      harness.midi.noteOn(MIDI.C3, 0);
      harness.midi.noteOn(MIDI.C4, 1_000);
      // The window restarted, so only C4 counts and the step is not complete.
      expect(harness.session.currentIndex).toBe(0);

      harness.midi.noteOn(MIDI.C3, 1_050);
      expect(harness.session.currentIndex).toBe(1);
    });
  });

  describe('with octave-insensitive matching', () => {
    it('accepts the right note names in any octave', () => {
      const harness = waitHarness({
        exercise: twoBarExercise(),
        mode: new WaitMode(),
        options: {
          countInBeats: 0,
          metronomeMuted: true,
          matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: true },
        },
      });
      harness.session.start();

      harness.midi.noteOn(MIDI.C4 + 12, 0);
      harness.midi.noteOn(MIDI.C3 - 12, 10);
      expect(harness.session.currentIndex).toBe(1);
    });
  });

  describe('lifecycle', () => {
    it('can be aborted mid-run and still reports what was played', () => {
      const harness = waitHarness();
      harness.session.start();
      harness.midi.playChord([MIDI.C3, MIDI.C4], 0);
      harness.clock.set(500);

      harness.session.abort();

      expect(harness.session.status).toBe('aborted');
      const [finished] = harness.of('finished');
      expect(finished?.report.completed).toBe(false);
      expect(finished?.report.steps).toHaveLength(1);
      expect(finished?.report.endedAtMs).toBe(500);
    });

    it('replays the current bar after a pause', () => {
      const harness = waitHarness();
      harness.session.start();
      harness.midi.playChord([MIDI.C3, MIDI.C4], 0);
      harness.midi.noteOn(MIDI.D4, 100);
      expect(harness.session.currentIndex).toBe(2);

      harness.session.pause();
      expect(harness.session.status).toBe('paused');
      harness.midi.noteOn(MIDI.E4, 150);
      expect(harness.session.currentIndex).toBe(2);

      harness.session.resume();
      expect(harness.session.status).toBe('running');
      // Bar one restarts from its first step, and its results are discarded.
      expect(harness.session.currentIndex).toBe(0);
      expect(harness.session.stepResults).toHaveLength(0);
    });

    it('restarts cleanly after finishing', () => {
      const harness = waitHarness();
      harness.session.start();
      harness.midi.playChord([MIDI.C3, MIDI.C4], 0);
      harness.session.abort();

      harness.session.start();
      expect(harness.session.status).toBe('running');
      expect(harness.session.currentIndex).toBe(0);
      expect(harness.session.stepResults).toHaveLength(0);
      expect(harness.session.report).toBeNull();
    });

    it('publishes each status change once', () => {
      const harness = waitHarness();
      harness.session.start();
      harness.session.abort();

      expect(harness.of('statusChanged').map((event) => event.status)).toEqual([
        'counting-in',
        'running',
        'aborted',
      ]);
    });
  });
});

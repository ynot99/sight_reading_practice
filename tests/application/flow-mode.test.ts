import { describe, expect, it } from 'vitest';
import { FlowMode } from '../../src/application/modes/FlowMode.js';
import { TimingWeightedScoringStrategy } from '../../src/domain/scoring/strategies.js';
import { MIDI, bar, p, twoBarExercise } from '../support/fixtures.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry } from '../../src/domain/model/Exercise.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
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
      clickWhen: 'never',
      // Sixteenth-note resolution: the loop ticks at least as often as the
      // chosen click, and this exercise's quarters would otherwise need only
      // one tick per beat.
      click: 'subdivision',
      matchPolicy: { toleranceMs: 250, pitchClassOnly: false },
    },
  });
}

/**
 * One bar of 6/8: a dotted quarter, then three eighths.
 *
 * Written in six and felt in two, and deliberately without a step on every
 * beat - a bar of straight eighths would have the cursor announcing beats 2
 * and 3 by itself, and the reading taken from the pulse would never be tested.
 */
function sixEightExercise() {
  return {
    ...twoBarExercise({ tempoBpm: 60 }),
    timeSignature: new TimeSignature(6, 8),
    staves: [
      {
        staffNumber: 1,
        voice: 1,
        clef: 'treble' as const,
        clefChanges: [],
        measures: [
          bar(
            noteEntry(p('C4'), Duration.DOTTED_QUARTER),
            noteEntry(p('D4'), Duration.EIGHTH),
            noteEntry(p('E4'), Duration.EIGHTH),
            noteEntry(p('F4'), Duration.EIGHTH),
          ),
        ],
      },
    ],
  };
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

    it('belongs to the beat it was nearer to, when that beat wants it', () => {
      // Three hundred milliseconds before the second beat of a slow bar is
      // nearer to that beat than to the one behind it, and the second beat is
      // the one asking for this note. Read as a wrong note at the first beat
      // instead, the page marked in red a reader who had played the right
      // note slightly ahead of it.
      const harness = flowHarness();
      startAndCountIn(harness);
      harness.metronome.advanceSubdivisions(2);

      harness.clock.set(RUN_STARTS_AT_MS + 700);
      harness.midi.noteOn(MIDI.D4);
      harness.metronome.advanceSubdivisions(2);

      const judged = harness.of('noteJudged').at(-1);
      expect(judged?.verdict).toBe('correct');
      expect(judged?.stepIndex).toBe(1);
      // Early, and by how much: the page draws it just before its own note.
      expect(judged?.deviationMs).toBe(-300);
    });

    it('still belongs where it fell when the beat ahead does not want it', () => {
      // A note nobody is expecting yet has to be very close indeed before it
      // is read as an early anything.
      const harness = flowHarness();
      startAndCountIn(harness);
      harness.metronome.advanceSubdivisions(2);

      harness.clock.set(RUN_STARTS_AT_MS + 700);
      harness.midi.noteOn(MIDI.F5);

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
          clickWhen: 'never',
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

    it('counts a press that beat the very first beat', () => {
      const harness = flowHarness();
      harness.session.start();
      // Stop one tick short: the count-in is over but the music has not begun.
      harness.metronome.advanceSubdivisions(TICKS_TO_START - 1);
      expect(harness.session.status).toBe('counting-in');

      harness.clock.set(RUN_STARTS_AT_MS - 40);
      harness.midi.noteOn(MIDI.C4);
      // Nothing to judge it against yet.
      expect(harness.of('noteJudged')).toHaveLength(0);

      harness.metronome.advanceSubdivisions(1);

      const [judged] = harness.of('noteJudged');
      expect(judged?.verdict).toBe('correct');
      expect(judged?.stepIndex).toBe(0);
      expect(judged?.deviationMs).toBe(-40);
    });

    it('takes a whole chord anticipated at the downbeat', () => {
      const harness = flowHarness();
      harness.session.start();
      harness.metronome.advanceSubdivisions(TICKS_TO_START - 1);

      harness.clock.set(RUN_STARTS_AT_MS - 30);
      harness.midi.noteOn(MIDI.C3);
      harness.clock.set(RUN_STARTS_AT_MS - 20);
      harness.midi.noteOn(MIDI.C4);
      harness.metronome.advanceSubdivisions(1);

      expect(harness.of('noteJudged').map((event) => event.verdict)).toEqual([
        'correct',
        'correct',
      ]);
      expect(harness.of('stepCompleted')).toHaveLength(0);
      expect(harness.session.currentIndex).toBe(0);
    });

    it('throws away noodling from the middle of the count-in', () => {
      const harness = flowHarness();
      harness.session.start();
      harness.metronome.advanceSubdivisions(TICKS_TO_START - 1);

      // Half a second before the music: not an anticipated downbeat.
      harness.clock.set(RUN_STARTS_AT_MS - 500);
      harness.midi.noteOn(MIDI.C4);
      harness.metronome.advanceSubdivisions(1);

      expect(harness.of('noteJudged')).toHaveLength(0);
    });

    it('does not carry a count-in press into a later run', () => {
      const harness = flowHarness();
      harness.session.start();
      harness.metronome.advanceSubdivisions(TICKS_TO_START - 1);
      harness.clock.set(RUN_STARTS_AT_MS - 40);
      harness.midi.noteOn(MIDI.C4);

      harness.session.abort();
      harness.session.start();
      harness.metronome.advanceSubdivisions(TICKS_TO_START);

      expect(harness.of('noteJudged')).toHaveLength(0);
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

  describe('where the music has got to', () => {
    it('goes on counting through a note the cursor is holding', () => {
      const harness = flowHarness();
      startAndCountIn(harness);
      // The second bar: one whole note in the treble, so the cursor has
      // nothing to do for four beats.
      harness.metronome.advanceSubdivisions(16);
      const held = harness.of('stepEntered').length;
      expect(harness.of('positionChanged').at(-1)).toEqual({ measureIndex: 1, beat: 1 });

      harness.metronome.advanceSubdivisions(4);

      expect(harness.of('stepEntered')).toHaveLength(held);
      expect(harness.of('positionChanged').at(-1)).toEqual({ measureIndex: 1, beat: 2 });
    });

    it('reports felt beats and not the resolution the loop happens to run at', () => {
      const harness = flowHarness();
      startAndCountIn(harness);
      // Into the held note, where nothing but the pulse is publishing.
      harness.metronome.advanceSubdivisions(16);
      const atTheBar = harness.of('positionChanged').length;

      // Three sixteenths: the loop needs them, and nobody counts them.
      harness.metronome.advanceSubdivisions(3);
      expect(harness.of('positionChanged')).toHaveLength(atTheBar);

      // The fourth completes the beat, which is what a reader is counting.
      harness.metronome.advanceSubdivisions(1);
      expect(harness.of('positionChanged')).toHaveLength(atTheBar + 1);
    });

    it('counts the beats the metre is written in, not the ones it is felt in', () => {
      // 6/8 is written in eighths and felt in two dotted quarters. The
      // position is reported in notated beats - the timeline counts them that
      // way and always has - so a reading taken once per felt pulse went 1, 4,
      // 1, 4 and looked exactly like a display dropping beats.
      const harness = createHarness({
        exercise: sixEightExercise(),
        mode: new FlowMode(),
        options: {
          countInBars: 0,
          clickWhen: 'never',
          click: 'pulse',
          matchPolicy: { toleranceMs: 250, pitchClassOnly: false },
        },
      });
      harness.session.start();
      // A whole bar, which is six notated beats however few notes fill it.
      harness.metronome.advanceSubdivisions(6);

      expect(harness.of('positionChanged').map((event) => event.beat)).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
    });

    it('picks the count back up where the music resumes, not at bar one', () => {
      const harness = flowHarness();
      startAndCountIn(harness);
      harness.metronome.advanceSubdivisions(20);

      harness.session.pause();
      harness.session.resume();
      // Counted back in first, so the reader can get their hands back to the
      // keys before the music moves again.
      expect(harness.session.status).toBe('counting-in');
      harness.metronome.advanceSubdivisions(TICKS_TO_START);

      // The bar is replayed from its head, so the count picks up there - at
      // bar two, which is the whole of what the offset is for.
      expect(harness.of('positionChanged').at(-1)).toEqual({ measureIndex: 1, beat: 1 });

      harness.metronome.advanceSubdivisions(4);

      expect(harness.of('positionChanged').at(-1)).toEqual({ measureIndex: 1, beat: 2 });
    });

    it('scores the bar it picks up from against the beat it really is', () => {
      // The count-in runs the metronome from zero again while the music picks
      // up at bar two, so the two clocks have to be reconciled or every press
      // after a pause is judged against the wrong onset.
      const harness = flowHarness();
      startAndCountIn(harness);
      harness.metronome.advanceSubdivisions(20);
      harness.session.pause();
      harness.session.resume();
      harness.metronome.advanceSubdivisions(TICKS_TO_START);

      harness.midi.playChord([MIDI.G2, MIDI.D3, MIDI.G4]);
      // The half note this bar opens with, played out to its end.
      harness.metronome.advanceSubdivisions(8);

      const landed = harness.of('stepCompleted').at(-1)?.result;
      expect(landed?.measureIndex).toBe(1);
      expect(landed?.status).toBe('correct');
      expect(landed?.deviationMs).toBe(0);
    });
  });

  it('stops the pulse when the run ends', () => {
    const harness = flowHarness();
    startAndCountIn(harness);
    harness.metronome.advanceSubdivisions(32);

    expect(harness.session.status).toBe('completed');
    expect(harness.metronome.isRunning).toBe(false);
  });
});

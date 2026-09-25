import { describe, expect, it } from 'vitest';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import { MIDI, arpeggiatedExercise, bar, longExercise, p, twoBarExercise } from '../support/fixtures.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { noteEntry } from '../../src/domain/model/Exercise.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { createHarness, type Harness } from '../support/harness.js';

function waitHarness(overrides: Partial<Parameters<typeof createHarness>[0]> = {}): Harness {
  return createHarness({
    exercise: twoBarExercise(),
    mode: new WaitMode(),
    options: {
      countInBars: 0,
      clickWhen: 'never',
      matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false },
    },
    ...overrides,
  });
}

describe('a press that beats the hand the reader is hearing', () => {
  /**
   * Two bars of crotchets at 60bpm, so every beat is written a second apart.
   *
   * The matching tolerance stays infinite, as it is everywhere in a waiting
   * mode - a chord being learned takes as long as it takes - which is exactly
   * why the window here is the early window instead.
   */
  function against(rushing: 'allowed' | 'a-mistake'): Harness {
    return createHarness({
      exercise: longExercise({ bars: 2, tempoBpm: 60 }),
      mode: new WaitMode(),
      options: {
        countInBars: 0,
        clickWhen: 'never',
        earlyWindowMs: 120,
        matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false },
        rushing,
      },
    });
  }

  function noteAt(harness: Harness, index: number): number {
    return harness.timeline.steps[index]?.expectedMidi[0] ?? 0;
  }

  it('counts against the step where the reader asked for it', () => {
    // His: late is allowed, early is not. The mode waits for him, but the
    // hand he is hearing does not - it is placed a written second after his
    // last press - and a note struck at once has gone past it.
    const harness = against('a-mistake');
    harness.session.start();
    harness.midi.noteOn(noteAt(harness, 0), 0);

    harness.midi.noteOn(noteAt(harness, 1), 0);

    expect(harness.of('noteJudged').map((one) => one.verdict)).toEqual(['correct', 'rushed']);
    // The note that was asked for, so the run moves on - and Good rather
    // than Perfect, which is what it costs: the right key, off its moment.
    // Not a wrong note as well; one press is one thing.
    const [first, second] = harness.of('stepCompleted').map((one) => one.result);
    expect(first?.hits.map((hit) => hit.tier)).toEqual(['perfect']);
    expect(second?.hits.map((hit) => hit.tier)).toEqual(['good']);
    expect(second?.wrong).toEqual([]);
    // The music waits here, so there is no moment for a note to be off by.
    expect(second?.hits.map((hit) => hit.deviationMs)).toEqual([null]);
  });

  it('leaves the reader as long as they like to be late', () => {
    // The other half of the same sentence, and the promise a waiting mode
    // makes: nothing here can be late, so nothing here is punished for it.
    const harness = against('a-mistake');
    harness.session.start();
    harness.midi.noteOn(noteAt(harness, 0), 0);

    harness.midi.noteOn(noteAt(harness, 1), 4_000);

    expect(harness.of('noteJudged').map((one) => one.verdict)).toEqual(['correct', 'correct']);
    expect(harness.of('stepCompleted').map((one) => one.result.status)).toEqual([
      'correct',
      'correct',
    ]);
  });

  it('says nothing at all where there is no hand to be ahead of', () => {
    // Off is off, and off is also what the controller passes whenever the
    // accompaniment is silent: with nothing sounding there is nothing to be
    // early against, and a mode that waits has no other clock to offer.
    const harness = against('allowed');
    harness.session.start();
    harness.midi.noteOn(noteAt(harness, 0), 0);

    harness.midi.noteOn(noteAt(harness, 1), 0);

    expect(harness.of('noteJudged').map((one) => one.verdict)).toEqual(['correct', 'correct']);
  });

  it('cannot rush the note the run opens on', () => {
    // Nothing has yet said what o'clock the music is at: the written clock is
    // set by the reader's last press, and there has not been one.
    const harness = against('a-mistake');
    harness.session.start();

    harness.midi.noteOn(noteAt(harness, 0), 0);

    expect(harness.of('noteJudged').map((one) => one.verdict)).toEqual(['correct']);
  });

  it('lets a press land a little ahead without holding it against them', () => {
    // Nobody plays exactly with anything. The window is the early window,
    // which is this program's one answer to how far before a moment a press
    // still counts as aimed at it - and not the matching tolerance, which in
    // a waiting mode is infinite on purpose.
    const harness = against('a-mistake');
    harness.session.start();
    harness.midi.noteOn(noteAt(harness, 0), 0);

    harness.midi.noteOn(noteAt(harness, 1), 900);

    expect(harness.of('noteJudged').map((one) => one.verdict)).toEqual(['correct', 'correct']);
  });

  it('holds one that is further ahead than that', () => {
    const harness = against('a-mistake');
    harness.session.start();
    harness.midi.noteOn(noteAt(harness, 0), 0);

    harness.midi.noteOn(noteAt(harness, 1), 600);

    expect(harness.of('noteJudged').map((one) => one.verdict)).toEqual(['correct', 'rushed']);
  });

  it('holds a press that is early against the reader, not against the page', () => {
    // The mutation this exists for: due read off the run's own clock instead
    // of the reader's last press. A reader five seconds behind the page who
    // then plays the next note a tenth of a second later has gone straight
    // past the accompaniment - and against the run's clock they are five
    // seconds late, which would say the opposite.
    const harness = against('a-mistake');
    harness.session.start();
    harness.midi.noteOn(noteAt(harness, 0), 5_000);

    harness.midi.noteOn(noteAt(harness, 1), 5_100);

    expect(harness.of('noteJudged').map((one) => one.verdict)).toEqual(['correct', 'rushed']);
  });

  it('measures the written second from where the reader put it', () => {
    // The anchor is the press, not the run's own clock - the same anchor the
    // accompaniment is placed from. A reader five seconds behind the page is
    // not rushing the next note; they are playing it in time with the hand
    // that followed them there.
    const harness = against('a-mistake');
    harness.session.start();
    harness.midi.noteOn(noteAt(harness, 0), 5_000);

    harness.midi.noteOn(noteAt(harness, 1), 6_000);

    expect(harness.of('noteJudged').map((one) => one.verdict)).toEqual(['correct', 'correct']);
  });
});

describe('a press aimed at a later beat', () => {
  /** Two bars of crotchets, so there is always a next beat to reach for. */
  function ahead(playingAhead: 'a-mistake' | 'moves-on'): Harness {
    return createHarness({
      exercise: longExercise({ bars: 2, tempoBpm: 60 }),
      mode: new WaitMode(),
      options: {
        countInBars: 0,
        clickWhen: 'never',
        matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false },
        playingAhead,
      },
    });
  }

  it('is a wrong note where the reader is learning not to play early', () => {
    // What it has always been, and still the default: the beat goes on
    // waiting and the press is held against it.
    const harness = ahead('a-mistake');
    harness.session.start();
    const next = harness.timeline.steps[1]?.expectedMidi[0] ?? 0;

    harness.midi.noteOn(next, harness.clock.now());

    expect(harness.session.currentIndex).toBe(0);
    expect(harness.of('noteJudged')[0]?.verdict).toBe('wrong');
  });

  it('moves on to it where the reader asked for that', () => {
    // His: pressing the next note to get to it. The beat left behind is
    // finished the ordinary way, so it comes out missed - the music went past
    // it, which here is exactly what happened - and the press itself is the
    // right note of the beat it was aimed at rather than a wrong one.
    const harness = ahead('moves-on');
    harness.session.start();
    const next = harness.timeline.steps[1]?.expectedMidi[0] ?? 0;

    harness.midi.noteOn(next, harness.clock.now());

    // Two beats finish on the one press: the one left behind, and the one it
    // was aimed at - which is a single note, so playing it completes it.
    expect(harness.of('stepCompleted').map((one) => one.result.status)).toEqual([
      'missed',
      'correct',
    ]);
    expect(harness.of('noteJudged')[0]?.verdict).toBe('correct');
  });

  it('stays where it is for a note belonging to no beat nearby', () => {
    // One beat and no further, which is the rule the late presses already
    // follow: a note two beats off is a reader who has lost their place
    // rather than one who is ahead.
    const harness = ahead('moves-on');
    harness.session.start();
    const far = harness.timeline.steps[2]?.expectedMidi[0] ?? 0;

    harness.midi.noteOn(far, harness.clock.now());

    expect(harness.session.currentIndex).toBe(0);
    expect(harness.of('noteJudged')[0]?.verdict).toBe('wrong');
  });

  it('moves on by the hand being practised, not by the other one', () => {
    // His question: does this fight "hear the other hand"? It cannot - that
    // setting only *sounds* notes and never reaches the judging - but the two
    // do meet at the hand filter, which is worth saying out loud. What counts
    // as the next beat's note is what this hand is asked for there; the other
    // hand's note of that beat is not the reader's to play, so pressing it is
    // not moving on.
    const both: Exercise = {
      ...twoBarExercise(),
      staves: [
        {
          staffNumber: 1,
          voice: 1,
          clef: 'treble',
          clefChanges: [],
          measures: [
            bar(
              noteEntry(p('C4'), Duration.QUARTER),
              noteEntry(p('D4'), Duration.QUARTER),
              noteEntry(p('E4'), Duration.QUARTER),
              noteEntry(p('F4'), Duration.QUARTER),
            ),
          ],
        },
        {
          staffNumber: 2,
          voice: 2,
          clef: 'bass',
          clefChanges: [],
          measures: [
            bar(
              noteEntry(p('C3'), Duration.QUARTER),
              noteEntry(p('D3'), Duration.QUARTER),
              noteEntry(p('E3'), Duration.QUARTER),
              noteEntry(p('F3'), Duration.QUARTER),
            ),
          ],
        },
      ],
    };
    const rightHandOnly = (): Harness =>
      createHarness({
        exercise: both,
        mode: new WaitMode(),
        options: {
          countInBars: 0,
          clickWhen: 'never',
          matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false },
          playingAhead: 'moves-on',
          expectedStaff: 1,
        },
      });

    const own = rightHandOnly();
    own.session.start();
    own.midi.noteOn(p('D4').midi, own.clock.now());

    expect(own.of('stepCompleted').map((one) => one.result.status)).toEqual(['missed', 'correct']);

    const other = rightHandOnly();
    other.session.start();
    other.midi.noteOn(p('D3').midi, other.clock.now());

    expect(other.session.currentIndex).toBe(0);
    expect(other.of('stepCompleted')).toHaveLength(0);
  });

  it('does not move on past the end of the passage', () => {
    const harness = createHarness({
      exercise: longExercise({ bars: 2, tempoBpm: 60 }),
      mode: new WaitMode(),
      options: {
        countInBars: 0,
        clickWhen: 'never',
        matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false },
        playingAhead: 'moves-on',
        stopAfterIndex: 0,
      },
    });
    harness.session.start();
    const beyond = harness.timeline.steps[1]?.expectedMidi[0] ?? 0;

    harness.midi.noteOn(beyond, harness.clock.now());

    expect(harness.of('noteJudged')[0]?.verdict).toBe('wrong');
  });
});

describe('Wait mode', () => {
  it('starts running immediately and without a pulse', () => {
    const harness = waitHarness();
    harness.session.start();

    expect(harness.session.status).toBe('running');
    expect(harness.metronome.isRunning).toBe(false);
    expect(harness.session.currentIndex).toBe(0);
    expect(harness.of('stepEntered')[0]?.step.expectedMidi).toEqual([MIDI.C3, MIDI.C4]);
  });

  it('lets a chord be found one note at a time', () => {
    // Reported from the page, and it is what this mode is *for*: a chord
    // being learned is taken slowly, and the window that judges whether two
    // notes were struck together belongs to the mode that keeps time. At 250
    // milliseconds the second note restarted the attempt and the first was
    // forgotten, so the chord could never be completed at all.
    //
    // A finite window on purpose: the harness above hands every other test an
    // infinite one, which is exactly why the suite never saw this.
    const harness = createHarness({
      exercise: twoBarExercise(),
      mode: new WaitMode(),
      options: {
        countInBars: 0,
        clickWhen: 'never',
        matchPolicy: { toleranceMs: 250, pitchClassOnly: false },
      },
    });
    harness.session.start();

    harness.midi.noteOn(MIDI.C3, harness.clock.now());
    // Longer than any window a reader would set, and nothing like long
    // enough to find a chord in.
    harness.clock.set(harness.clock.now() + 3_000);
    harness.midi.noteOn(MIDI.C4, harness.clock.now());

    expect(harness.session.currentIndex).toBe(1);
    expect(harness.of('stepCompleted')[0]?.result.status).toBe('correct');
  });

  it('keeps a press that beat the first beat of the count-in', () => {
    // Not a Flow-mode concern: the session was dropping the input before any
    // mode saw it, so waiting for the notes did not help either.
    const harness = waitHarness({
      options: {
        countInBars: 1,
        clickWhen: 'never',
        matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false },
      },
    });
    harness.session.start();
    // One bar of 4/4, one tick per beat: four ticks of count-in.
    harness.metronome.advanceSubdivisions(4);
    expect(harness.session.status).toBe('counting-in');

    harness.clock.set(harness.clock.now() + 960);
    harness.midi.noteOn(MIDI.C4);
    harness.metronome.advanceSubdivisions(1);

    expect(harness.of('noteJudged').map((event) => event.verdict)).toEqual(['correct']);
  });

  it('asks for one hand alone when the reader is working on one', () => {
    // The page still shows both staves and the cursor still visits every step;
    // only what is demanded narrows.
    const harness = waitHarness({
      options: {
        countInBars: 0,
        clickWhen: 'never',
        expectedStaff: 2,
        matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false },
      },
    });
    harness.session.start();

    expect(harness.of('stepEntered')[0]?.expectedMidi).toEqual([MIDI.C3]);
    // The bass note alone completes the step the right hand also plays in,
    // and the run then walks past the three the right hand plays alone: they
    // are no more this reader's to play than a rest is. Landing on the first
    // of them was where the session used to stop dead.
    harness.midi.noteOn(MIDI.C3);
    expect(harness.session.currentIndex).toBe(4);
  });

  it('advances on any note at all when only the rhythm is being read', () => {
    const harness = waitHarness({
      options: {
        countInBars: 0,
        clickWhen: 'never',
        matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false, anyPitch: true },
      },
    });
    harness.session.start();

    // The step wants C3 and C4; one wrong note carries it, because what is
    // being read here is the rhythm.
    harness.midi.noteOn(MIDI.G4);

    expect(harness.session.currentIndex).toBe(1);
    expect(harness.of('stepCompleted')[0]?.result.status).toBe('correct');
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
    expect(second?.result.hits.map((hit) => hit.midi)).toEqual([MIDI.D4]);
  });

  it('publishes a verdict for every press', () => {
    const harness = waitHarness();
    harness.session.start();

    harness.midi.noteOn(MIDI.C4, 0);
    harness.midi.noteOff(MIDI.C4, 80);
    harness.midi.noteOn(MIDI.C4, 160);
    harness.midi.noteOn(MIDI.F5, 200);

    // The key struck again is an extra note, like any other key not asked for.
    expect(harness.of('noteJudged').map((event) => event.verdict)).toEqual([
      'correct',
      'wrong',
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
    it('pays it no attention, the reader not being timed here', () => {
      // It used to restart the attempt, which is the rule a mode that keeps
      // time needs. Flow still has it - see its own tests - and this mode,
      // whose whole purpose is taking a chord slowly, no longer does.
      const harness = waitHarness({
        exercise: twoBarExercise(),
        mode: new WaitMode(),
        options: {
          countInBars: 0,
          clickWhen: 'never',
          matchPolicy: { toleranceMs: 200, pitchClassOnly: false },
        },
      });
      harness.session.start();

      harness.midi.noteOn(MIDI.C3, 0);
      harness.midi.noteOn(MIDI.C4, 1_000);

      expect(harness.session.currentIndex).toBe(1);
    });
  });

  describe('with octave-insensitive matching', () => {
    it('accepts the right note names in any octave', () => {
      const harness = waitHarness({
        exercise: twoBarExercise(),
        mode: new WaitMode(),
        options: {
          countInBars: 0,
          clickWhen: 'never',
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

describe('waiting while practising one hand', () => {
  /**
   * A right hand holding a whole note while the left keeps moving.
   *
   *   treble: C4 (whole)          | C4 (whole)
   *   bass:   C3 D3 E3 F3 quarters| C3 (whole)
   *
   * Reading the right hand alone, bars one's second, third and fourth beats
   * have nothing for that hand to play - which is exactly where the run used
   * to stop dead.
   */
  function heldRightHand(): Exercise {
    return {
      id: 'held-right-hand',
      title: 'Held right hand',
      key: KeySignature.major(0),
      keyChanges: [],
      timeChanges: [],
      tempoChanges: [],
      pedalMarks: [],
      dynamicMarks: [],
      tempoWords: [],
      hairpins: [],
      octaveShifts: [],
      timeSignature: new TimeSignature(4, 4),
      tempoBpm: 60,
      firstBarNumber: 1,
      barLabels: [],
      metadata: { generatorId: 'fixture', seed: 1 },
      staves: [
        {
          staffNumber: 1,
          voice: 1,
          clef: 'treble',
          clefChanges: [],
          measures: [bar(noteEntry(p('C4'), Duration.WHOLE)), bar(noteEntry(p('C4'), Duration.WHOLE))],
        },
        {
          staffNumber: 2,
          voice: 2,
          clef: 'bass',
          clefChanges: [],
          measures: [
            bar(
              noteEntry(p('C3'), Duration.QUARTER),
              noteEntry(p('D3'), Duration.QUARTER),
              noteEntry(p('E3'), Duration.QUARTER),
              noteEntry(p('F3'), Duration.QUARTER),
            ),
            bar(noteEntry(p('C3'), Duration.WHOLE)),
          ],
        },
      ],
    };
  }

  function rightHandOnly(): Harness {
    return createHarness({
      exercise: heldRightHand(),
      mode: new WaitMode(),
      options: {
        countInBars: 0,
        clickWhen: 'never',
        expectedStaff: 1,
        matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false },
      },
    });
  }

  it('walks past the steps that hand has nothing in', () => {
    const harness = rightHandOnly();
    harness.session.start();

    // One press of C4 satisfies the whole first bar: the three beats where
    // only the left hand moves are not this hand's to play.
    harness.midi.noteOn(MIDI.C4, 0);

    expect(harness.session.currentIndex).toBe(4);
    expect(harness.session.status).toBe('running');
  });

  it('finishes rather than stopping dead partway', () => {
    const harness = rightHandOnly();
    harness.session.start();

    harness.midi.noteOn(MIDI.C4, 0);
    harness.midi.noteOn(MIDI.C4, 10);

    // The bug: the session waited for notes it would never demand, and no
    // key could move it on again.
    expect(harness.session.status).toBe('completed');
  });

  it('leaves the position where the reader is, however long the click runs on', () => {
    // The metronome is still going - it counted them in, and the reader may
    // have asked to hear it - but here the reader is what moves the piece. A
    // position taken from the pulse would walk off into bars nobody has
    // played, several of them ahead of the cursor still waiting for a chord.
    const harness = waitHarness({
      options: {
        countInBars: 1,
        clickWhen: 'always',
        matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false },
      },
    });
    harness.session.start();
    harness.metronome.advanceSubdivisions(5);
    expect(harness.session.status).toBe('running');

    harness.metronome.advanceSubdivisions(40);

    expect(harness.metronome.isRunning).toBe(true);
    expect(harness.of('positionChanged')).toEqual([{ measureIndex: 0, beat: 1 }]);
  });

  it('does not count the other hand against the reader', () => {
    const harness = rightHandOnly();
    harness.session.start();
    harness.midi.noteOn(MIDI.C4, 0);
    harness.midi.noteOn(MIDI.C4, 10);

    const report = harness.session.report;
    // Those steps were never this hand's to play, so they are skipped in the
    // sense a rest is - not missed.
    expect(report?.totals.missed).toBe(0);
    expect(report?.totals.expectedNotes).toBe(2);
  });
});

describe('a chord the writer marked to be rolled', () => {
  /** The fixture's rolled chord: C4 E4 G4 over C3 G3, all at one onset. */
  function rolledHarness(): Harness {
    return createHarness({
      exercise: arpeggiatedExercise(),
      mode: new WaitMode(),
      options: {
        countInBars: 0,
        clickWhen: 'never',
        // The window a reader actually practises with, rather than one opened
        // wide to make the test pass.
        matchPolicy: { toleranceMs: 250, pitchClassOnly: false },
      },
    });
  }

  it('is not thrown away for being spread out, which is what a roll is', () => {
    // The bug this answers: the window exists to tell one chord from the next
    // by how close its notes are, and a roll answers that question
    // differently on purpose. Held to it, the later notes of a spread threw
    // the attempt away and started it again - so the chord never completed
    // and no key the reader pressed could finish it.
    const harness = rolledHarness();
    harness.session.start();

    // Rolled from the bottom, over most of a second: slower than the window,
    // which is an ordinary speed for five notes under one hand.
    for (const midi of [MIDI.C3, MIDI.G3, MIDI.C4, MIDI.E4, MIDI.G4]) {
      harness.midi.noteOn(midi, harness.clock.now());
      harness.clock.advance(200);
    }

    expect(harness.of('noteJudged').map((event) => event.verdict)).toEqual([
      'correct',
      'correct',
      'correct',
      'correct',
      'correct',
    ]);
    expect(harness.session.status).toBe('completed');
  });

  it('is exempt for its own reason, not as a general loosening', () => {
    // The freedom the roll gets is an instruction on the page, not a general
    // loosening - and the mode that keeps time still tells two chords a beat
    // apart apart. That rule is tested where it now lives, in Flow: this one
    // says only that the roll is exempt for its own reason.
    const harness = rolledHarness();
    harness.session.start();

    for (const midi of [MIDI.C3, MIDI.G3, MIDI.C4, MIDI.E4]) {
      harness.midi.noteOn(midi, harness.clock.now());
      harness.clock.advance(300);
    }

    // Four of the five collected, spread far wider than any window, and the
    // fifth still owed rather than the attempt having started over.
    expect(harness.of('noteJudged').at(-1)?.remaining).toEqual([MIDI.G4]);
  });
});

describe('a note the other hand was going to play', () => {
  it('is neither right nor wrong, because the page does print it', () => {
    // Practising one hand narrows what is demanded but not what is printed,
    // and the two staves are the engraver's division of the music rather than
    // the player's. An inner voice written on the lower staff is ordinary,
    // and taking it with the right hand is reading the page correctly - yet
    // it was marked in red for playing what was in front of the reader.
    const harness = createHarness({
      exercise: twoBarExercise(),
      mode: new WaitMode(),
      options: {
        countInBars: 0,
        clickWhen: 'never',
        expectedStaff: 1,
        matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false },
      },
    });
    harness.session.start();

    // C3 is the left hand's note in this step; C4 is the right hand's.
    harness.midi.noteOn(MIDI.C3, 0);

    expect(harness.of('noteJudged').at(-1)?.verdict).toBe('other-hand');
    // Still waiting for the note it did ask for.
    expect(harness.session.currentIndex).toBe(0);
  });

  it('costs the reader nothing in the report', () => {
    const harness = createHarness({
      exercise: twoBarExercise(),
      mode: new WaitMode(),
      options: {
        countInBars: 0,
        clickWhen: 'never',
        expectedStaff: 1,
        matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false },
      },
    });
    harness.session.start();

    harness.midi.noteOn(MIDI.C3, 0);
    harness.midi.noteOn(MIDI.C4, 10);

    const [first] = harness.of('stepCompleted');
    expect(first?.result.status).toBe('correct');
    expect(first?.result.wrong).toEqual([]);
  });

  it('still calls a note that is not on the page wrong', () => {
    // The freedom is about the printed page, not about accuracy: a note
    // nobody wrote is still a note nobody wrote.
    const harness = createHarness({
      exercise: twoBarExercise(),
      mode: new WaitMode(),
      options: {
        countInBars: 0,
        clickWhen: 'never',
        expectedStaff: 1,
        matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false },
      },
    });
    harness.session.start();

    harness.midi.noteOn(MIDI.F5, 0);

    expect(harness.of('noteJudged').at(-1)?.verdict).toBe('wrong');
  });

  it('leaves both hands alone, where everything printed is asked for', () => {
    const harness = createHarness({
      exercise: twoBarExercise(),
      mode: new WaitMode(),
      options: {
        countInBars: 0,
        clickWhen: 'never',
        matchPolicy: { toleranceMs: Number.POSITIVE_INFINITY, pitchClassOnly: false },
      },
    });
    harness.session.start();

    harness.midi.noteOn(MIDI.C3, 0);

    expect(harness.of('noteJudged').at(-1)?.verdict).toBe('correct');
  });
});

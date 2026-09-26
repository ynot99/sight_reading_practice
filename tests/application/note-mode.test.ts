import { describe, expect, it } from 'vitest';
import { NoteMode } from '../../src/application/modes/NoteMode.js';
import { theWaits } from '../../src/application/session/RunRoll.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry, restEntry } from '../../src/domain/model/Exercise.js';
import { TimingWeightedScoringStrategy } from '../../src/domain/scoring/strategies.js';
import { MIDI, bar, p, twoBarExercise } from '../support/fixtures.js';
import { createHarness, type Harness } from '../support/harness.js';

/** 4/4 at 60 bpm: a quarter lasts 1000 ms, and the loop ticks every 250. */
const SUBDIVISION_MS = 250;
/** One bar counted in, then the tick the music begins on. */
const TICKS_TO_START = 4 * 4 + 1;
/** Where that tick falls: after a bar of four beats. */
const MUSIC_BEGINS_AT_MS = 4_000;
/**
 * How late a note here may be and still be Perfect: six per cent of a beat at
 * 60, which is past the forty millisecond floor and well short of a third of
 * the way to the next quarter.
 */
const PERFECT_LATE_MS = 60;

function noteHarness(exercise = twoBarExercise({ tempoBpm: 60 })): Harness {
  return createHarness({
    exercise,
    mode: new NoteMode(),
    scoring: new TimingWeightedScoringStrategy(),
    options: {
      countInBars: 1,
      clickWhen: 'never',
      click: 'subdivision',
      matchPolicy: { toleranceMs: 250, pitchClassOnly: false },
    },
  });
}

/** Up to the first note of the piece, whose beat has just fallen. */
function startAndCountIn(harness: Harness): void {
  harness.session.start();
  harness.metronome.advanceSubdivisions(TICKS_TO_START);
}

function pressAt(harness: Harness, atMs: number, ...midi: readonly number[]): void {
  harness.clock.set(atMs);
  for (const note of midi) {
    harness.midi.noteOn(note, atMs);
  }
}

/** The first chord played on its beat, and the loop up to the second note's. */
function toTheSecondNote(harness: Harness): void {
  startAndCountIn(harness);
  pressAt(harness, MUSIC_BEGINS_AT_MS, MIDI.C3, MIDI.C4);
  harness.metronome.advanceSubdivisions(4);
}

/** Whether the pulse was begun again, which is the music having stood. */
function thePulseBeganAgain(harness: Harness): boolean {
  return harness.metronome.nextTickIndex === 0;
}

describe('Note mode', () => {
  it('lets the music run on when a note is met in time', () => {
    const harness = noteHarness();
    startAndCountIn(harness);

    pressAt(harness, MUSIC_BEGINS_AT_MS + 30, MIDI.C3, MIDI.C4);
    const ticks = harness.metronome.advanceSubdivisions(4);

    // The beats come as they were written, and the second note is reached on
    // its own.
    expect(ticks.map((tick) => tick.scheduledTimeMs)).toEqual([4_250, 4_500, 4_750, 5_000]);
    expect(harness.of('stepEntered').at(-1)?.step.index).toBe(1);
    const judged = harness.of('noteJudged').find((event) => event.midi === MIDI.C4);
    expect(judged?.deviationMs).toBe(30);
    expect(judged?.tier).toBe('perfect');
  });

  it('stands at a note not met by the end of its Perfect window', () => {
    // The music runs up to the note and no further: not a tick past it, and
    // the note is not finished by the clock.
    const harness = noteHarness();
    startAndCountIn(harness);
    const before = harness.metronome.emitted.length;

    const ticks = harness.metronome.advanceSubdivisions(8);

    expect(ticks).toEqual([]);
    expect(harness.metronome.emitted).toHaveLength(before);
    expect(harness.of('stepCompleted')).toEqual([]);
    expect(harness.session.currentStep?.index).toBe(0);
  });

  it('takes the press after the window as the beat, and counts on from it', () => {
    const harness = noteHarness();
    startAndCountIn(harness);

    pressAt(harness, MUSIC_BEGINS_AT_MS + 1_500, MIDI.C3, MIDI.C4);

    const judged = harness.of('noteJudged').find((event) => event.midi === MIDI.C4);
    expect(judged?.deviationMs).toBe(0);
    expect(judged?.tier).toBe('perfect');
    expect(thePulseBeganAgain(harness)).toBe(true);

    // The note's own beat again, then a quarter to the next note.
    harness.metronome.advanceSubdivisions(1 + 4);

    expect(harness.of('stepEntered').at(-1)?.step.index).toBe(1);
    expect(harness.clock.now()).toBe(MUSIC_BEGINS_AT_MS + 1_500 + 1_000);
  });

  describe('across the band around a note', () => {
    // The second note, due at five seconds. Where each press lands, what it
    // is worth, and whether the music had to stand for it.
    const due = MUSIC_BEGINS_AT_MS + 1_000;
    const cases: readonly {
      readonly offsetMs: number;
      readonly deviationMs: number;
      readonly tier: 'perfect' | 'good';
      readonly stood: boolean;
    }[] = [
      { offsetMs: -100, deviationMs: -100, tier: 'good', stood: false },
      { offsetMs: -61, deviationMs: -61, tier: 'good', stood: false },
      { offsetMs: -60, deviationMs: -60, tier: 'perfect', stood: false },
      { offsetMs: 0, deviationMs: 0, tier: 'perfect', stood: false },
      { offsetMs: 30, deviationMs: 30, tier: 'perfect', stood: false },
      { offsetMs: PERFECT_LATE_MS, deviationMs: PERFECT_LATE_MS, tier: 'perfect', stood: false },
      { offsetMs: PERFECT_LATE_MS + 1, deviationMs: 0, tier: 'perfect', stood: true },
      { offsetMs: 400, deviationMs: 0, tier: 'perfect', stood: true },
    ];

    for (const { offsetMs, deviationMs, tier, stood } of cases) {
      it(`${offsetMs > 0 ? '+' : ''}${String(offsetMs)} ms: ${tier}, ${stood ? 'after standing' : 'in time'}`, () => {
        const harness = noteHarness();
        startAndCountIn(harness);
        pressAt(harness, MUSIC_BEGINS_AT_MS, MIDI.C3, MIDI.C4);
        if (offsetMs < 0) {
          // Ahead of the beat, while the first note is still the open one.
          harness.metronome.advanceSubdivisions(3);
          pressAt(harness, due + offsetMs, MIDI.D4);
          harness.metronome.advanceSubdivisions(1);
        } else {
          harness.metronome.advanceSubdivisions(4);
          pressAt(harness, due + offsetMs, MIDI.D4);
        }

        const judged = harness.of('noteJudged').find((event) => event.midi === MIDI.D4);
        expect(judged?.verdict).toBe('correct');
        expect(judged?.deviationMs).toBe(deviationMs);
        expect(judged?.tier).toBe(tier);
        expect(thePulseBeganAgain(harness)).toBe(stood);

        // And the music goes on to the next note, a beat on - from the beat
        // where it stood, the note's own beat falling again first.
        harness.metronome.advanceSubdivisions(stood ? 5 : 4);
        expect(harness.session.currentStep?.index).toBe(2);
      });
    }
  });

  it('moves the pulse on to the next note when one is met in time', () => {
    // Held just past the second note now, on the pulse's own count: four
    // beats of count-in and one of music.
    const harness = noteHarness();
    startAndCountIn(harness);

    pressAt(harness, MUSIC_BEGINS_AT_MS + 10, MIDI.C3, MIDI.C4);

    expect(harness.metronome.currentConfig.holdsPastTicks).toBe(Duration.QUARTER.ticks * 5);
  });

  it('opens nothing with a wrong note', () => {
    const harness = noteHarness();
    startAndCountIn(harness);

    pressAt(harness, MUSIC_BEGINS_AT_MS + 500, MIDI.C5);

    expect(harness.of('noteJudged').at(-1)?.verdict).toBe('wrong');
    expect(thePulseBeganAgain(harness)).toBe(false);
    expect(harness.metronome.advanceSubdivisions(4)).toEqual([]);

    pressAt(harness, MUSIC_BEGINS_AT_MS + 900, MIDI.C3, MIDI.C4);

    expect(thePulseBeganAgain(harness)).toBe(true);
  });

  it('waits for the whole chord', () => {
    const harness = noteHarness();
    startAndCountIn(harness);

    pressAt(harness, MUSIC_BEGINS_AT_MS + 20, MIDI.C4);

    expect(harness.metronome.advanceSubdivisions(4)).toEqual([]);

    // Played together, as a chord has to be.
    pressAt(harness, MUSIC_BEGINS_AT_MS + 800, MIDI.C3, MIDI.C4);

    expect(thePulseBeganAgain(harness)).toBe(true);
  });

  it('writes the wait down, where the beat fell and where it was given', () => {
    // So the picture of the run draws it as a wait, as it does a bar line's.
    const harness = noteHarness();
    toTheSecondNote(harness);

    pressAt(harness, MUSIC_BEGINS_AT_MS + 1_000 + 700, MIDI.D4);
    harness.metronome.advanceSubdivisions(1);

    const atTheNote = harness.session.roll.beats.filter(
      (beat) => beat.positionTicks === Duration.QUARTER.ticks,
    );
    expect(atTheNote.map((beat) => beat.atMs)).toEqual([5_000, 5_700]);
    expect(theWaits(harness.session.roll)).toEqual([{ fromMs: 5_000, untilMs: 5_700 }]);
  });

  it('counts the notes the music had to stand at', () => {
    const harness = noteHarness();
    toTheSecondNote(harness);
    pressAt(harness, MUSIC_BEGINS_AT_MS + 1_000 + 700, MIDI.D4);
    harness.session.abort();

    const report = harness.of('finished').at(-1)?.report;
    expect(report?.waitedAtBars).toEqual([0]);
  });

  it('stands at the first note of the bar it resumes at', () => {
    // A pause picks the run up at the top of its bar, counted in again, and
    // the note the music is held past is found again from there - reckoned
    // from where the pulse now begins, not from where it began before.
    const harness = noteHarness();
    toTheSecondNote(harness);
    pressAt(harness, MUSIC_BEGINS_AT_MS + 1_000, MIDI.D4);

    harness.session.pause();
    harness.session.resume();
    harness.metronome.advanceSubdivisions(TICKS_TO_START);

    expect(harness.session.currentStep?.index).toBe(0);
    expect(harness.metronome.advanceSubdivisions(8)).toEqual([]);
  });

  it('carries a rest by the clock, and stands at the note after it', () => {
    const base = twoBarExercise({ tempoBpm: 60 });
    const harness = noteHarness({
      ...base,
      staves: [
        {
          staffNumber: 1,
          voice: 1,
          clef: 'treble' as const,
          clefChanges: [],
          measures: [
            bar(
              noteEntry(p('C4'), Duration.QUARTER),
              restEntry(Duration.QUARTER),
              noteEntry(p('E4'), Duration.QUARTER),
              noteEntry(p('F4'), Duration.QUARTER),
            ),
          ],
        },
      ],
    });
    startAndCountIn(harness);
    pressAt(harness, MUSIC_BEGINS_AT_MS, MIDI.C4);

    // Through the rest and on to the third beat, with nobody pressing.
    harness.metronome.advanceSubdivisions(8);
    const stoodAt = harness.clock.now();
    harness.metronome.advanceSubdivisions(8);

    expect(stoodAt).toBe(MUSIC_BEGINS_AT_MS + 2_000);
    expect(harness.clock.now()).toBe(stoodAt);
    expect(harness.session.currentStep?.expectedMidi).toEqual([MIDI.E4]);
  });

  it('lets a subdivision past a note sound once the note is met in time', () => {
    // The tick a quarter of a beat after the note is built before anybody
    // could know whether the note would be played; held back, it comes at its
    // own moment all the same once it is.
    const harness = noteHarness();
    startAndCountIn(harness);

    expect(harness.metronome.advanceSubdivisions(1)).toEqual([]);
    pressAt(harness, MUSIC_BEGINS_AT_MS + 50, MIDI.C3, MIDI.C4);
    const [next] = harness.metronome.advanceSubdivisions(1);

    expect(next?.scheduledTimeMs).toBe(MUSIC_BEGINS_AT_MS + SUBDIVISION_MS);
  });
});

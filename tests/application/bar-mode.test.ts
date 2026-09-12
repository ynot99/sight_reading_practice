import { describe, expect, it } from 'vitest';
import { BarMode } from '../../src/application/modes/BarMode.js';
import { isAudibleClick } from '../../src/infrastructure/audio/metronomeMath.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry, restEntry } from '../../src/domain/model/Exercise.js';
import { TimingWeightedScoringStrategy } from '../../src/domain/scoring/strategies.js';
import { MIDI, bar, p, twoBarExercise } from '../support/fixtures.js';
import { createHarness, type Harness } from '../support/harness.js';

/** Bar of 4/4 at 60 bpm: one quarter lasts 1000 ms, one subdivision 250 ms. */
const SUBDIVISION_MS = 250;
const COUNT_IN_PULSES = 4;
/** Ticks consumed by the count-in, plus the tick that starts the music. */
const TICKS_TO_START = COUNT_IN_PULSES * 4 + 1;
/** Sixteenth-note ticks in one bar of 4/4. */
const SUBDIVISIONS_PER_BAR = 16;
/** And in one quarter of it. */
const SUBDIVISIONS_PER_BEAT = 4;
/**
 * Ticks from a bar's downbeat to the next one.
 *
 * One more than the subdivisions the bar lasts: the first tick is the bar's
 * own downbeat at position nought, so the next bar's is the seventeenth.
 */
const TICKS_TO_NEXT_BAR = SUBDIVISIONS_PER_BAR + 1;

function barHarness(exercise = twoBarExercise({ tempoBpm: 60 })): Harness {
  return createHarness({
    exercise,
    mode: new BarMode(),
    scoring: new TimingWeightedScoringStrategy(),
    options: {
      countInBars: 1,
      clickWhen: 'never',
      click: 'subdivision',
      matchPolicy: { toleranceMs: 250, pitchClassOnly: false },
    },
  });
}

/** Up to the gate that stands at the first note of the piece. */
function startAndCountIn(harness: Harness): void {
  harness.session.start();
  harness.metronome.advanceSubdivisions(TICKS_TO_START);
}

function press(harness: Harness, ...midi: readonly number[]): void {
  for (const note of midi) {
    harness.midi.noteOn(note, harness.clock.now());
  }
}

/**
 * One bar of quarters, then a bar that begins with a rest.
 *
 * One staff, so that what is owed at each step is exactly what is printed.
 */
function restFirstExercise() {
  const base = twoBarExercise({ tempoBpm: 60 });
  return {
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
            noteEntry(p('D4'), Duration.QUARTER),
            noteEntry(p('E4'), Duration.QUARTER),
            noteEntry(p('F4'), Duration.QUARTER),
          ),
          bar(
            restEntry(Duration.QUARTER),
            noteEntry(p('G4'), Duration.QUARTER),
            noteEntry(p('C4'), Duration.HALF),
          ),
        ],
      },
    ],
  };
}

describe('Bar mode', () => {
  it('waits at the first note of the piece before the pulse runs at all', () => {
    // His: "коли я запускаю гру, то перші ноти мають чекати на мій інпут". The
    // count-in gives the tempo and then stands aside; nothing moves until the
    // reader plays.
    const harness = barHarness();
    startAndCountIn(harness);

    expect(harness.metronome.isRunning).toBe(false);
    expect(harness.of('stepCompleted')).toHaveLength(0);

    harness.clock.advance(2_000);
    press(harness, MIDI.C3, MIDI.C4);

    expect(harness.metronome.isRunning).toBe(true);
  });

  it('lets the clock carry the cursor inside the bar', () => {
    // The whole difference from Wait mode, and what makes this a test of
    // rhythm: a note not played while its slice of time is open is missed and
    // the music goes on without it.
    const harness = barHarness();
    startAndCountIn(harness);
    press(harness, MIDI.C3, MIDI.C4);

    // Two beats and the tick that ends the second, with the second note of
    // the bar never played.
    harness.metronome.advanceSubdivisions(SUBDIVISIONS_PER_BEAT * 2 + 1);

    expect(harness.of('stepCompleted')).toHaveLength(2);
    expect(harness.of('stepEntered').at(-1)?.step.index).toBe(2);
    // Missed, not waited for, which is the whole difference from Wait mode.
    expect(harness.of('stepCompleted').at(-1)?.result.status).not.toBe('correct');
  });

  it('stops the pulse at the bar line and waits at the next bar', () => {
    const harness = barHarness();
    startAndCountIn(harness);
    press(harness, MIDI.C3, MIDI.C4);

    harness.metronome.advanceSubdivisions(TICKS_TO_NEXT_BAR);

    expect(harness.metronome.isRunning).toBe(false);
    expect(harness.of('stepEntered').at(-1)?.step.measureIndex).toBe(1);
  });

  it('does not open the gate for a wrong note', () => {
    // His: "сильна доля не має гратися допоки я не натисну правильні ноти".
    const harness = barHarness();
    startAndCountIn(harness);
    press(harness, MIDI.C3, MIDI.C4);
    harness.metronome.advanceSubdivisions(TICKS_TO_NEXT_BAR);

    press(harness, MIDI.C5);

    expect(harness.metronome.isRunning).toBe(false);
    expect(harness.of('noteJudged').at(-1)?.verdict).toBe('wrong');
  });

  it('gives the bar its downbeat where the reader put it', () => {
    // The press that opens the gate *is* the beat, so the bar is counted from
    // there: three seconds spent finding the chord leaves the reader in tempo
    // again from the moment they found it, not three seconds behind.
    const harness = barHarness();
    startAndCountIn(harness);
    press(harness, MIDI.C3, MIDI.C4);
    harness.metronome.advanceSubdivisions(TICKS_TO_NEXT_BAR);
    harness.clock.advance(3_000);

    press(harness, MIDI.G2, MIDI.D3, MIDI.G4);

    expect(harness.metronome.isRunning).toBe(true);
    const judged = harness.of('noteJudged').filter((event) => event.midi === MIDI.G4);
    expect(judged.at(-1)?.verdict).toBe('correct');
    expect(judged.at(-1)?.deviationMs).toBe(0);
  });

  it('counts nobody in when it starts a bar partway through', () => {
    // What he saw first: the pulse came back and played a whole bar by itself,
    // downbeat and all. A count-in sits at the front of the metronome's own
    // timeline with the music shifted behind it, so a restart that kept it
    // beat the count while the run read those beats as music. There is nobody
    // to count in partway through a piece.
    const harness = barHarness();
    startAndCountIn(harness);
    press(harness, MIDI.C3, MIDI.C4);
    harness.metronome.advanceSubdivisions(TICKS_TO_NEXT_BAR);
    press(harness, MIDI.G2, MIDI.D3, MIDI.G4);

    expect(harness.metronome.currentConfig.bars).toHaveLength(1);
    expect(harness.metronome.currentConfig.bars[0]?.startTicks).toBe(0);

    harness.metronome.advanceSubdivisions(1);

    expect(harness.of('positionChanged').at(-1)?.measureIndex).toBe(1);
    expect(harness.metronome.isRunning).toBe(true);
  });

  it('sounds no downbeat the reader has not played', () => {
    // His: "може сильну долю без мене не грати? Бо наразі на початку кожного
    // такту сильна доля грається сама". The tick that crosses a bar line *is*
    // the next downbeat, and a look-ahead scheduler has committed its sound a
    // tenth of a second before the run is even told about it - so stopping the
    // pulse when the gate closes cannot unsound it. The click is given this
    // bar and no more instead, so it has nothing to say at the line.
    const harness = barHarness();
    startAndCountIn(harness);
    press(harness, MIDI.C3, MIDI.C4);

    const ticks = harness.metronome.advanceSubdivisions(TICKS_TO_NEXT_BAR);
    const config = harness.metronome.currentConfig;
    const atTheLine = ticks.at(-1);

    // The one that closed the gate, and it is a downbeat.
    expect(atTheLine?.isDownbeat).toBe(true);
    expect(isAudibleClick(atTheLine!, config)).toBe(false);
    // Every beat of the bar before it still sounds: this silences the line,
    // not the pulse.
    expect(ticks.filter((tick) => isAudibleClick(tick, config)).length).toBeGreaterThan(0);

    // And the downbeat he does play is heard, because the bar he opens is the
    // bar the click has then been given.
    press(harness, MIDI.G2, MIDI.D3, MIDI.G4);
    const opening = harness.metronome.advanceSubdivisions(1).at(0);

    expect(isAudibleClick(opening!, harness.metronome.currentConfig)).toBe(true);
  });

  it('measures a note inside the bar against the page, not against the gate', () => {
    // Once the bar has begun, this is Flow: the second note is due a beat
    // after the first, wherever the reader chose to put the first.
    const harness = barHarness();
    startAndCountIn(harness);
    press(harness, MIDI.C3, MIDI.C4);

    // Three quarters of a beat in, where the page asks for a whole one. The
    // press is nearer the beat it is reaching for than the one still open, so
    // it is held back and judged when that beat arrives - which is Flow's own
    // rule, inherited whole.
    harness.metronome.advanceSubdivisions(SUBDIVISIONS_PER_BEAT);
    press(harness, MIDI.D4);
    harness.metronome.advanceSubdivisions(1);

    const judged = harness.of('noteJudged').find((event) => event.midi === MIDI.D4);
    expect(judged?.verdict).toBe('correct');
    expect(judged?.deviationMs).toBe(-SUBDIVISION_MS);
  });

  it('puts the gate at the first note of a bar, never on a rest', () => {
    // A bar opening with a quarter rest waits at the note after it, and that
    // note keeps its place: the rest is carried by the clock, so the reader
    // gives the second beat rather than being handed the downbeat.
    const harness = barHarness(restFirstExercise());
    startAndCountIn(harness);
    press(harness, MIDI.C4);
    harness.metronome.advanceSubdivisions(TICKS_TO_NEXT_BAR);

    // Into the second bar and onto its rest, which owes nothing and so holds
    // nothing: the pulse is still running.
    expect(harness.of('stepEntered').at(-1)?.step.measureIndex).toBe(1);
    expect(harness.metronome.isRunning).toBe(true);

    // A beat later the note arrives, and there the pulse stops.
    harness.metronome.advanceSubdivisions(SUBDIVISIONS_PER_BEAT);


    expect(harness.metronome.isRunning).toBe(false);
    press(harness, MIDI.G4);
    expect(harness.metronome.isRunning).toBe(true);
  });

  it('never stops inside a bar, however badly it goes', () => {
    // There is one gate per bar and it stands at the bar line. Nothing the
    // reader does or fails to do in the middle of a bar stops the clock -
    // that is what they are practising against.
    const harness = barHarness();
    startAndCountIn(harness);
    press(harness, MIDI.C3, MIDI.C4);

    // The whole bar but its last tick, with nothing else played at all.
    harness.metronome.advanceSubdivisions(SUBDIVISIONS_PER_BAR);

    expect(harness.metronome.isRunning).toBe(true);
    expect(harness.of('stepCompleted')).toHaveLength(3);
  });
});

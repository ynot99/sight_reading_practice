import { describe, expect, it } from 'vitest';
import { BarMode } from '../../src/application/modes/BarMode.js';
import { TimingWeightedScoringStrategy } from '../../src/domain/scoring/strategies.js';
import { MIDI, twoBarExercise } from '../support/fixtures.js';
import { createHarness, type Harness } from '../support/harness.js';

/** Bar of 4/4 at 60 bpm: one quarter lasts 1000 ms, one subdivision 250 ms. */
const SUBDIVISION_MS = 250;
const COUNT_IN_PULSES = 4;
/** Ticks consumed by the count-in, plus the tick that starts the music. */
const TICKS_TO_START = COUNT_IN_PULSES * 4 + 1;
/** Sixteenth-note ticks in one bar of 4/4. */
const SUBDIVISIONS_PER_BAR = 16;

function barHarness(): Harness {
  return createHarness({
    exercise: twoBarExercise({ tempoBpm: 60 }),
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

function startAndCountIn(harness: Harness): void {
  harness.session.start();
  harness.metronome.advanceSubdivisions(TICKS_TO_START);
}

/** The first bar of the fixture: a treble line over one held bass note. */
function playTheFirstBar(harness: Harness): void {
  harness.midi.noteOn(MIDI.C3, harness.clock.now());
  harness.midi.noteOn(MIDI.C4, harness.clock.now());
  harness.midi.noteOn(MIDI.D4, harness.clock.now());
  harness.midi.noteOn(MIDI.E4, harness.clock.now());
  harness.midi.noteOn(MIDI.F4, harness.clock.now());
}

describe('Bar mode', () => {
  it('never plays a note for the reader', () => {
    // The whole difference from Flow. There the pulse finalises each step as
    // its slice of time runs out, so a reader who falls behind has the bar
    // marked missed under them and nothing is left to wait for. Here the
    // cursor does not move until the note is found.
    const harness = barHarness();
    startAndCountIn(harness);

    harness.metronome.advanceSubdivisions(SUBDIVISIONS_PER_BAR - 1);

    expect(harness.of('stepCompleted')).toHaveLength(0);
    expect(harness.of('stepEntered')).toHaveLength(1);
  });

  it('silences the pulse at the bar line until the reader begins the next bar', () => {
    // His: "метроном закінчив грати цей бар - то він просто мовчить поки
    // гравець не дійде до наступного бару". Counting on would put beats over
    // music nobody has played.
    const harness = barHarness();
    startAndCountIn(harness);

    harness.metronome.advanceSubdivisions(SUBDIVISIONS_PER_BAR);

    expect(harness.metronome.isRunning).toBe(false);

    playTheFirstBar(harness);

    // Finishing the old bar is not beginning the new one. His second report:
    // "сильна доля має гратись як я граю" - a downbeat handed over on the
    // last note of the bar before leaves nowhere to move to.
    expect(harness.metronome.isRunning).toBe(false);
    // The cursor is at the next bar, which is what the silence was for.
    expect(harness.of('stepEntered').at(-1)?.step.measureIndex).toBe(1);

    harness.clock.advance(700);
    harness.midi.noteOn(MIDI.G2, harness.clock.now());

    expect(harness.metronome.isRunning).toBe(true);
  });

  it('counts nobody in when it starts a bar partway through', () => {
    // What he actually saw first: the pulse came back and played a whole bar
    // by itself, downbeat and all, before anything was asked of him. The
    // restart was set up with the count-in still in it, so the metronome beat
    // its count while the run read those beats as music - the click ran on
    // without him and the wait ended up a bar out of place. There is nobody
    // to count in partway through a piece.
    const harness = barHarness();
    startAndCountIn(harness);
    harness.metronome.advanceSubdivisions(SUBDIVISIONS_PER_BAR);
    playTheFirstBar(harness);
    harness.midi.noteOn(MIDI.G2, harness.clock.now());

    // One bar of music is left and no bar of counting in front of it.
    expect(harness.metronome.currentConfig.bars).toHaveLength(1);
    expect(harness.metronome.currentConfig.bars[0]?.startTicks).toBe(0);

    // And the beats that follow are the new bar's own, rather than a count
    // beaten over music nobody has played.
    harness.metronome.advanceSubdivisions(1);

    expect(harness.of('positionChanged').at(-1)?.measureIndex).toBe(1);
    expect(harness.metronome.isRunning).toBe(true);
  });

  it('marks a note played into that silence late, rather than forgiving it', () => {
    // What keeps the mode honest. The bar line buys the *next* bar; forgiving
    // this one would let a reader play a bar behind for a whole piece and be
    // graded as though they had kept time.
    const harness = barHarness();
    startAndCountIn(harness);
    harness.metronome.advanceSubdivisions(SUBDIVISIONS_PER_BAR);

    harness.midi.noteOn(MIDI.C4, harness.clock.now());

    const judged = harness.of('noteJudged').find((event) => event.midi === MIDI.C4);
    expect(judged?.verdict).toBe('correct');
    // A whole bar late, because that is when it was played: the note was due
    // at the top of the bar and arrived after the bar's time had run out.
    expect(judged?.deviationMs).toBe(SUBDIVISIONS_PER_BAR * SUBDIVISION_MS);
  });

  it('starts the next bar in tempo from the moment the reader reached it', () => {
    // The bar that was lost is lost; the one after it is clean. A note played
    // the instant the new bar opens is on the beat, however long the reader
    // spent finding their way out of the last one.
    const harness = barHarness();
    startAndCountIn(harness);
    harness.metronome.advanceSubdivisions(SUBDIVISIONS_PER_BAR);
    // A second and a half of silence spent finding the way out of bar one,
    // which is the whole point: without it the run's origin would not have to
    // move for this to pass.
    harness.clock.advance(1_500);
    playTheFirstBar(harness);
    harness.clock.advance(700);

    harness.midi.noteOn(MIDI.G4, harness.clock.now());

    const judged = harness.of('noteJudged').find((event) => event.midi === MIDI.G4);
    expect(judged?.verdict).toBe('correct');
    expect(judged?.deviationMs).toBe(0);
  });

  it('calls a note played before its written beat early', () => {
    // Judged against the page, not against when the cursor happened to arrive.
    // The cursor reaches the second note the instant the first is finished, so
    // a press that beats the written beat reads as on time by that measure and
    // as early by the only one that means anything here.
    const harness = barHarness();
    startAndCountIn(harness);
    harness.midi.noteOn(MIDI.C3, harness.clock.now());
    harness.midi.noteOn(MIDI.C4, harness.clock.now());

    // Half a beat into a bar whose second note is written a whole beat in.
    harness.clock.advance(500);
    harness.midi.noteOn(MIDI.D4, harness.clock.now());

    const judged = harness.of('noteJudged').find((event) => event.midi === MIDI.D4);
    expect(judged?.verdict).toBe('correct');
    expect(judged?.deviationMs).toBe(-500);
  });

  it('waits on notes and never on a rest', () => {
    // A step nobody has to play owes nothing, so the cursor slides past it at
    // once. The fixture's second bar ends in a rest under a held note: if that
    // were waited on, the run could never finish, because no key would ever
    // be demanded there.
    const harness = barHarness();
    startAndCountIn(harness);
    playTheFirstBar(harness);
    harness.midi.noteOn(MIDI.G2, harness.clock.now());
    harness.midi.noteOn(MIDI.D3, harness.clock.now());
    harness.midi.noteOn(MIDI.G4, harness.clock.now());

    expect(harness.of('finished')).toHaveLength(1);
    // The rest went by as skipped rather than as a step anybody failed.
    const last = harness.of('stepCompleted').at(-1);
    expect(last?.result.status).toBe('skipped');
  });

  it('keeps time while the bar it is in still owes nothing', () => {
    // Nothing owed means nothing to wait for, so the pulse is never held: a
    // bar of rests, or one holding a note tied from before, simply passes.
    const harness = barHarness();
    startAndCountIn(harness);
    playTheFirstBar(harness);

    // Into the second bar, whose own notes are still unplayed, so the pulse
    // runs its length and only then falls silent.
    harness.metronome.advanceSubdivisions(SUBDIVISIONS_PER_BAR - 1);

    expect(harness.metronome.isRunning).toBe(true);
  });

  it('gives a held bar its downbeat where the reader put it', () => {
    // The press that starts the bar *is* the beat, so what follows is counted
    // from there: the reader who spent three seconds finding the note is in
    // tempo again from the moment they found it, not three seconds behind.
    const harness = barHarness();
    startAndCountIn(harness);
    harness.metronome.advanceSubdivisions(SUBDIVISIONS_PER_BAR);
    playTheFirstBar(harness);
    harness.clock.advance(3_000);

    harness.midi.noteOn(MIDI.G2, harness.clock.now());

    const judged = harness.of('noteJudged').find((event) => event.midi === MIDI.G2);
    expect(judged?.verdict).toBe('correct');
    expect(judged?.deviationMs).toBe(0);
  });
});

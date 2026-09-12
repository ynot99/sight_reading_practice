import { describe, expect, it } from 'vitest';
import { BarMode } from '../../src/application/modes/BarMode.js';
import { isAudibleClick } from '../../src/infrastructure/audio/metronomeMath.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry, restEntry } from '../../src/domain/model/Exercise.js';
import { TimingWeightedScoringStrategy } from '../../src/domain/scoring/strategies.js';
import { MIDI, bar, p, twoBarExercise } from '../support/fixtures.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { ManualMetronome } from '../../src/infrastructure/testing/ManualMetronome.js';
import { MockMidiAdapter } from '../../src/infrastructure/testing/MockMidiAdapter.js';
import { PracticeSession } from '../../src/application/session/PracticeSession.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import type { NoteJudgedEvent } from '../../src/application/session/SessionEvents.js';
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

function barHarness(
  exercise = twoBarExercise({ tempoBpm: 60 }),
  anyPitch = false,
): Harness {
  return createHarness({
    exercise,
    mode: new BarMode(),
    scoring: new TimingWeightedScoringStrategy(),
    options: {
      countInBars: 1,
      clickWhen: 'never',
      click: 'subdivision',
      matchPolicy: { toleranceMs: 250, pitchClassOnly: false, anyPitch },
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

/** How long after it is asked for the first click of a pulse is heard. */
const CLICK_LEAD_MS = 30;

describe('Bar mode', () => {
  it('measures a bar by the beat that is heard, not by the press that asked for it', () => {
    // Both of his at once: "метроном дуже маленький проміжок часу трохи тупить"
    // and "я точно в метроном натиснув правильну клавішу, але кольорова нота
    // зявилась трохи правіше".
    //
    // A key press carries no output latency - the note is under the finger the
    // instant it is played - and a click carries the device's whole output
    // path, plus the runway the scheduler needs to place it. Anchor the bar to
    // the press and the two disagree by that much for the whole bar: a reader
    // playing exactly with the click is read late on every note, and every
    // mark is drawn to the right of its notehead. Which is what he saw.
    const clock = new ManualClock();
    const midi = new MockMidiAdapter({ clock });
    const metronome = new ManualMetronome(clock, CLICK_LEAD_MS);
    const exercise = twoBarExercise({ tempoBpm: 60 });
    const session = new PracticeSession({
      timeline: buildTimeline(exercise),
      mode: new BarMode(),
      midi,
      metronome,
      clock,
      scoring: new TimingWeightedScoringStrategy(),
      options: {
        countInBars: 1,
        clickWhen: 'never',
        click: 'subdivision',
        matchPolicy: { toleranceMs: 250, pitchClassOnly: false, anyPitch: true },
      },
    });
    const judged: NoteJudgedEvent[] = [];
    session.events.on('noteJudged', (event) => judged.push(event));

    session.start();
    metronome.advanceSubdivisions(TICKS_TO_START);
    // The gate is open and the reader gives the downbeat.
    const gaveAt = clock.now();
    midi.noteOn(MIDI.C4, gaveAt);

    // The click that answers is a moment behind the hand that asked for it.
    const first = metronome.advanceSubdivisions(1).at(0);
    expect(first?.scheduledTimeMs).toBe(gaveAt + CLICK_LEAD_MS);

    // On to the second beat of the bar, and played exactly with its click.
    metronome.advanceSubdivisions(SUBDIVISIONS_PER_BEAT);
    midi.noteOn(MIDI.C4, clock.now());

    const second = judged.at(-1);
    expect(second?.verdict).toBe('correct');
    // Dead on. Counted from the press instead, this reads as a reader who is
    // behind the click by exactly the lead the click was given - and the mark
    // is drawn that far to the right of its notehead.
    expect(second?.deviationMs).toBe(0);
  });

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

  it('stays in the first bar when the opening chord lands on the beat', () => {
    // His: "самий перший бар, якщо я точно влучу у перші ноти - то чомусь я
    // одразу стрибаю на наступний бар, повністю пропускаючи поточний бар".
    //
    // A chord played exactly on the downbeat arrives while the run is still
    // counting in, and is replayed the moment the music begins - which is the
    // moment the first gate closes, so it opens it again and the pulse is
    // started anew. The tick carrying all of that is the count-in's own, and
    // it was then handed to the mode *after* the restart had rewritten where
    // ticks sit in the music: it read as one whole bar, and the cursor walked
    // the first bar in a single step.
    const harness = barHarness();
    harness.session.start();
    // Inside the early window, which is what "exactly" means: the press is
    // aimed at the downbeat and arrives before the music does.
    harness.metronome.advanceSubdivisions(TICKS_TO_START - 1);
    harness.clock.advance(SUBDIVISION_MS - 100);
    press(harness, MIDI.C3, MIDI.C4);

    harness.metronome.advanceSubdivisions(1);

    expect(harness.of('stepEntered').at(-1)?.step.measureIndex).toBe(0);
    expect(harness.of('stepEntered').at(-1)?.step.index).toBe(0);
    expect(harness.of('stepCompleted')).toHaveLength(0);
    // And the bar it is in is running, because the chord opened its gate.
    expect(harness.metronome.isRunning).toBe(true);
  });

  it('sounds nothing at the first note until the reader gives that beat', () => {
    // His: "перший тік метроному грається навіть якщо я нічого не натискав".
    // The tick the count-in lands on is the music's own first beat, and it has
    // been heard before the run is told it exists - a look-ahead scheduler
    // commits the click a tenth of a second early - so no gate closed in
    // reaction to it can unsound it. The click is given the count-in and
    // nothing past it, and the reader's press hands it the first bar.
    const harness = barHarness();
    harness.session.start();

    const ticks = harness.metronome.advanceSubdivisions(TICKS_TO_START);
    const config = harness.metronome.currentConfig;
    const landing = ticks.at(-1);

    expect(landing?.isDownbeat).toBe(true);
    expect(isAudibleClick(landing!, config)).toBe(false);
    // The count itself is still beaten: it is the only thing giving the tempo.
    expect(ticks.slice(0, -1).some((tick) => isAudibleClick(tick, config))).toBe(true);

    press(harness, MIDI.C3, MIDI.C4);
    const opening = harness.metronome.advanceSubdivisions(1).at(0);

    expect(isAudibleClick(opening!, harness.metronome.currentConfig)).toBe(true);
  });

  it('takes a downbeat given early, however early it is given', () => {
    // His, in the mode he was testing in: "якщо я влучив правильно, але
    // трішечки раніше - то гра просто зупиняється допоки я ще раз не натисну".
    //
    // Flow keeps a press back for the beat ahead only inside a narrow window,
    // because earlier than that it is a wrong note against the beat still
    // sounding. But the beat ahead here is a gate, and the reader is not
    // reaching for a note - they are giving the downbeat, and may give it
    // whenever they are ready. Outside the window the press was spent as a
    // wrong note against a beat that wanted nothing, and the gate closed on an
    // empty hand.
    const harness = barHarness(twoBarExercise({ tempoBpm: 60 }), true);
    startAndCountIn(harness);
    press(harness, MIDI.C4);

    // Rhythm only: one tap a beat, through the bar. Walked by where the music
    // is rather than by counting ticks, because a beat is four subdivisions
    // and five ticks.
    for (const beat of [1, 2, 3]) {
      harness.metronome.advanceToTicks(beat * Duration.QUARTER.ticks);
      press(harness, MIDI.C4);
    }

    // A quarter of a beat later, which is far outside the early window - and
    // with nothing left in this bar for the press to have been aimed at.
    harness.metronome.advanceSubdivisions(1);
    press(harness, MIDI.C4);

    // By ticks to the line, not by position: opening the gate starts the pulse
    // afresh, and a walk that asks "where is the music" would go on emitting
    // through the bar it has just begun.
    harness.metronome.advanceSubdivisions(3);

    // The bar line came and went on that press: no second one was needed.
    expect(harness.metronome.isRunning).toBe(true);
    expect(harness.of('stepEntered').at(-1)?.step.measureIndex).toBe(1);
  });

  it('widens that window for the bar line and nowhere else', () => {
    // Inside a bar the narrow rule stands: a press after the chord is
    // complete is an extra note now, not an early one for the beat ahead.
    // Only at a bar line is the reader giving a downbeat rather than reaching
    // for a note, and only there may they give it whenever they like.
    const harness = barHarness(twoBarExercise({ tempoBpm: 60 }), true);
    startAndCountIn(harness);
    press(harness, MIDI.C4);

    // A subdivision later, with this beat already tapped and the next one in
    // the same bar.
    harness.metronome.advanceSubdivisions(1);
    press(harness, MIDI.C4);

    // Judged here rather than kept for the beat ahead.
    expect(harness.of('noteJudged').at(-1)?.verdict).toBe('duplicate');
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

  it('opens the gate with a press that arrived just before the bar line', () => {
    // His, and it was a dead end rather than a blemish: "наступний такт не
    // реєструє те що я натиснув якщо я натиснув за долю секунди, та кольорова
    // нота малюється буд-то я влучив дуже гарно, але такт все ще чекає на мій
    // інпут". Flow holds a press nearer the beat it is reaching for than the
    // one still sounding and hands it over when that beat arrives; at a bar
    // line that beat is the gate. Graded and left there, the chord was spent -
    // so no second attempt could open the gate either, and the run could not
    // go on at all.
    const harness = barHarness();
    startAndCountIn(harness);
    press(harness, MIDI.C3, MIDI.C4);

    // A quarter of a second before the bar line, reaching for it.
    harness.metronome.advanceSubdivisions(TICKS_TO_NEXT_BAR - 1);
    press(harness, MIDI.G2, MIDI.D3, MIDI.G4);

    // Nothing yet: the beat they were aimed at has not arrived.
    expect(harness.metronome.isRunning).toBe(true);

    harness.metronome.advanceSubdivisions(1);

    // The bar line came, the gate closed on it, and the press that was waiting
    // is what opens it again.
    expect(harness.metronome.isRunning).toBe(true);
    expect(harness.of('stepEntered').at(-1)?.step.measureIndex).toBe(1);
    const judged = harness.of('noteJudged').filter((event) => event.midi === MIDI.G4);
    expect(judged.at(-1)?.verdict).toBe('correct');
  });

  it('counts the bar lines the music had to wait at', () => {
    // The one number worth reading off this mode, and the one that says when
    // to leave it: the gate stops catching you before the notes stop being
    // wrong. The opening gate is not counted - every run waits there, and a
    // floor of one under a number whose point is reaching nought is no use.
    const harness = barHarness();
    startAndCountIn(harness);
    press(harness, MIDI.C3, MIDI.C4);
    harness.metronome.advanceSubdivisions(TICKS_TO_NEXT_BAR);
    press(harness, MIDI.G2, MIDI.D3, MIDI.G4);
    harness.session.abort();

    const report = harness.of('finished').at(-1)?.report;
    expect(report?.totals.barsWaitedFor).toBe(1);
  });

  it('says which bars it waited at, not only how many', () => {
    // The count says how ready the reader is; this says where, which is the
    // question a strip of cells can answer by being looked at.
    const harness = barHarness();
    startAndCountIn(harness);
    press(harness, MIDI.C3, MIDI.C4);
    harness.metronome.advanceSubdivisions(TICKS_TO_NEXT_BAR);
    press(harness, MIDI.G2, MIDI.D3, MIDI.G4);
    harness.session.abort();

    const report = harness.of('finished').at(-1)?.report;
    expect(report?.waitedAtBars).toEqual([1]);
    expect(report?.totals.barsWaitedFor).toBe(1);
  });

  it('counts nothing where the reader keeps up', () => {
    const harness = barHarness();
    startAndCountIn(harness);
    press(harness, MIDI.C3, MIDI.C4);
    harness.session.abort();

    const report = harness.of('finished').at(-1)?.report;
    expect(report?.totals.barsWaitedFor).toBe(0);
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

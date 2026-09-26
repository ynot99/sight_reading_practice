import type { MetronomeTick } from '../ports/IMetronome.js';
import type { MidiNoteOnEvent } from '../ports/IMidiSource.js';
import type { PracticeContext } from '../session/PracticeContext.js';
import { FlowMode } from './FlowMode.js';
import type { PracticeStep } from './IPracticeMode.js';

export const BAR_MODE_ID = 'mode.bar';

/**
 * Flow inside the bar, and a gate at every bar line.
 *
 * His, and it is the step missing between the two that existed. Flow is
 * unusable on music you are not fluent in: one stumble and the pulse is gone,
 * so the grade stops reporting what was misread and reports how long the
 * recovery took. Wait asks nothing of the clock, so the rhythm - half of
 * reading - is never tested.
 *
 * So this is Flow, exactly, with one thing added: the music does not cross a
 * bar line by itself. At the first note of every bar - and at the first note
 * of the piece - the pulse falls silent and nothing moves until the reader
 * plays that note. Their press *is* the downbeat: the bar is counted from
 * where they put it, so however long they spent finding their way out of the
 * last bar, they are in tempo again from the moment they arrive.
 *
 * Inside the bar nothing waits. A note not played while its slice of time is
 * open is missed and the cursor goes on, which is what makes this a test of
 * rhythm rather than of note-finding, and what makes the bar line worth
 * arriving at.
 *
 * Wrong notes do not open the gate. "Сильна доля не має гратися допоки я не
 * натисну правильні ноти" - so the bar begins when the notated chord has been
 * sounded, and a wrong press at the gate is recorded and changes nothing.
 *
 * The gate is never on a rest. It stands at the first step of the bar that
 * asks for a press, so a bar beginning with a rest has that rest carried by
 * the clock and waits at the note after it - which keeps that note where the
 * page puts it rather than promoting it to the downbeat. A bar that asks for
 * nothing at all has no gate and simply passes.
 */
export class BarMode extends FlowMode {
  override readonly id = BAR_MODE_ID;
  override readonly label = 'Wait at the bar line';
  // The gate stands at the first note of the piece as much as at every bar
  // line after it, and the pulse must be silent there too: his, again -
  // "перший тік метроному грається навіть якщо я нічого не натискав".
  override readonly waitsForTheFirstBeat = true;

  /** Whether this bar's gate is still to come. */
  private awaitingTheBar = true;
  /** The bar the cursor was in, so that leaving one can be noticed. */
  private lastMeasure: number | null = null;

  override onSessionStart(context: PracticeContext): void {
    super.onSessionStart(context);
    this.awaitingTheBar = true;
    this.lastMeasure = null;
  }

  override onSessionEnd(context: PracticeContext): void {
    super.onSessionEnd(context);
    this.awaitingTheBar = true;
    this.lastMeasure = null;
  }

  override holdsAt(context: PracticeContext, step: PracticeStep): number | null {
    if (this.lastMeasure !== step.measureIndex) {
      this.lastMeasure = step.measureIndex;
      this.awaitingTheBar = true;
    }
    // The matcher rather than the step's own notes, for the reason Wait mode
    // gives: a step can hold notes this reader is not being asked for, and a
    // gate on one of those would never open.
    if (!this.awaitingTheBar || context.matcher === null) {
      return null;
    }
    this.awaitingTheBar = false;
    return step.onsetTicks;
  }

  override onBeat(context: PracticeContext, tick: MetronomeTick): void {
    // A tick can span several steps, and one that crosses a bar line has
    // already closed the gate on the other side of it. The pulse is stopped
    // by then, so this only guards the rest of that one tick's walk.
    if (context.holdingAtBarLine) {
      return;
    }
    super.onBeat(context, tick);
  }

  /**
   * Whether this press belongs to the beat ahead rather than the one open.
   *
   * Flow's answer, widened at a bar line. Its window is narrow on purpose - a
   * press a moment before the beat is reaching for it, and one much earlier is
   * a wrong note against the beat still sounding. But where the beat ahead is
   * a *gate*, the reader is not reaching for a note at all: they are giving
   * the downbeat, and they may give it whenever they are ready. A bar whose
   * last step owes nothing has one thing left to be played in it, and that is
   * the bar after it.
   *
   * His, and it is why the run kept stopping at every line: "якщо я влучив
   * правильно, але трішечки раніше - то гра просто зупиняється допоки я ще раз
   * не натисну". The press fell outside the window, was spent as a wrong note
   * against a beat that wanted nothing, and the gate it was meant for closed
   * on an empty hand.
   */
  /**
   * Whether this press is the reader taking the bar ahead, early.
   *
   * True only where the bar they are in has nothing left owing and the next
   * step is across a bar line. Then there is one thing left to be played here
   * and it is the bar after this one, however much of this one's written time
   * is still to run.
   */
  private takesTheBarAhead(context: PracticeContext): boolean {
    const step = context.currentStep;
    const next = step === null ? null : context.timeline.at(step.index + 1);
    if (step === null || next === null || next.measureIndex === step.measureIndex) {
      return false;
    }
    const matcher = context.matcher;
    return matcher === null || matcher.remaining.length === 0;
  }

  override onNoteOn(context: PracticeContext, event: MidiNoteOnEvent): void {
    if (!context.holdingAtBarLine && this.takesTheBarAhead(context)) {
      // The bar begins *here*, on the press, rather than being kept until the
      // written line arrives. Held back instead - which is what Flow does with
      // a press reaching for the beat ahead - the reader played their downbeat
      // and then waited for the clock to catch up to it, a pause as long as
      // they were early and a different length every time. His: "буд-то воно
      // навмисно трохи зупиняється на старті такту", and "ці старти тактів
      // нестабільно з однаковим таймінгом починаються".
      //
      // The bar being left is finished by definition - it owes nothing - so
      // closing it is the whole of what taking the next one early means.
      context.completeStep();
    }

    if (!context.holdingAtBarLine) {
      super.onNoteOn(context, event);
      return;
    }
    this.openTheGateWith(context, event);
  }

  /**
   * A press kept back for this step, which is how the gate is usually opened.
   *
   * Flow holds a press that is nearer the beat it is reaching for than the one
   * still sounding, and hands it over when that beat arrives. At a bar line
   * that beat *is* the gate, so the press has to open it: graded and left
   * there - which is what happened - the note came back marked a good hit
   * while the music went on waiting for a note the reader had already played,
   * and the chord it belonged to was spent, so no second attempt could ever
   * open it either.
   */
  protected override judgeTheHeldPress(
    context: PracticeContext,
    event: MidiNoteOnEvent,
  ): void {
    if (!context.holdingAtBarLine) {
      super.judgeTheHeldPress(context, event);
      return;
    }
    this.openTheGateWith(context, event);
  }

  private openTheGateWith(context: PracticeContext, event: MidiNoteOnEvent): void {
    const matcher = context.matcher;
    if (matcher === null) {
      // Nothing is owed here, so there is nothing for the gate to open on.
      context.judgeNote(event.midi, 'wrong', null, event.timestampMs);
      return;
    }

    const outcome = matcher.accept(event.midi, event.timestampMs);
    // No deviation at a gate: the reader is being asked where the beat is,
    // not whether they found it in time. Measuring them against a clock that
    // is standing still would be measuring them against nothing.
    context.judgeNote(
      event.midi,
      outcome.verdict,
      outcome.verdict === 'correct' ? 0 : null,
      event.timestampMs,
    );

    if (outcome.completed) {
      // The chord is complete, so the bar begins - here, at this press. The
      // step itself is still the clock's to finish, exactly as in Flow: a
      // chord played in full still takes the time the page gives it.
      context.startTheHeldBarAt(event.timestampMs);
    }
  }
}

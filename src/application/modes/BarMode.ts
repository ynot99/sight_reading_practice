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

  override onStepEntered(context: PracticeContext, step: PracticeStep): void {
    if (this.lastMeasure !== step.measureIndex) {
      this.lastMeasure = step.measureIndex;
      this.awaitingTheBar = true;
    }
    // The matcher rather than the step's own notes, for the reason Wait mode
    // gives: a step can hold notes this reader is not being asked for, and a
    // gate on one of those would never open.
    if (this.awaitingTheBar && context.matcher !== null) {
      this.awaitingTheBar = false;
      context.holdForTheBar(step.onsetTicks);
    }
    super.onStepEntered(context, step);
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

  override onNoteOn(context: PracticeContext, event: MidiNoteOnEvent): void {
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
      context.judgeNote(event.midi, 'wrong', null);
      return;
    }

    const outcome = matcher.accept(event.midi, event.timestampMs);
    // No deviation at a gate: the reader is being asked where the beat is,
    // not whether they found it in time. Measuring them against a clock that
    // is standing still would be measuring them against nothing.
    context.judgeNote(event.midi, outcome.verdict, outcome.verdict === 'correct' ? 0 : null);

    if (outcome.completed) {
      // The chord is complete, so the bar begins - here, at this press. The
      // step itself is still the clock's to finish, exactly as in Flow: a
      // chord played in full still takes the time the page gives it.
      context.startTheHeldBarAt(event.timestampMs);
    }
  }
}

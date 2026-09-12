import type { MetronomeTick } from '../ports/IMetronome.js';
import type { MidiNoteOnEvent } from '../ports/IMidiSource.js';
import type { PracticeContext } from '../session/PracticeContext.js';
import { BasePracticeMode, type PracticeStep } from './IPracticeMode.js';

export const BAR_MODE_ID = 'mode.bar';

/**
 * The tick the bar the step belongs to ends on.
 *
 * Read off the steps rather than counted from the metre: a piece that changes
 * metre has bars of different lengths from there on, and the opening metre
 * puts every bar line after the change in the wrong place. The engraver has
 * already decided where the bars are and every step carries which one it is
 * in, so the line is the first onset that belongs to a different bar.
 */
function barLineAfter(context: PracticeContext, step: PracticeStep): number {
  for (let index = step.index + 1; index < context.timeline.length; index += 1) {
    const next = context.timeline.at(index);
    if (next === null) {
      break;
    }
    if (next.measureIndex !== step.measureIndex) {
      return next.onsetTicks;
    }
  }
  return context.timeline.totalTicks;
}

/**
 * The clock runs inside the bar; the bar line waits for you.
 *
 * His, and it is the step between the two that already exist. Flow is
 * unusable on music the reader is not fluent in: one stumble and the pulse is
 * gone, so the grade stops reporting what was misread and reports how long
 * the recovery took instead. Wait asks nothing of the clock at all, so the
 * rhythm - which is half of reading - is never tested. This asks for the
 * rhythm and makes the bar line a place to be found again: a stumble costs
 * the rest of that bar and nothing beyond it.
 *
 * So the cursor waits, exactly as it does in Wait mode, and every press is
 * judged against where it was *written* to fall, exactly as in Flow. The
 * pulse plays the bar out and then goes quiet; when the reader has played the
 * bar's last note, the next bar begins in tempo from that moment.
 *
 * The waiting never happens on a rest. A step nobody has to play owes
 * nothing, so the cursor slides past it at once - which costs nothing,
 * because the note after it is still due when the page says it is due. A bar
 * of nothing but rests, or one holding a note tied from before, owes nothing
 * at all: it has nothing to wait for and simply passes in time.
 *
 * And the wait forgives nothing in the bar it is in. A note played into the
 * silence is late, and is marked late: what the bar line buys is the *next*
 * bar clean. Forgiving the bar would let a reader play a bar behind for the
 * whole piece and be graded as though they had kept time.
 */
export class BarMode extends BasePracticeMode {
  readonly id = BAR_MODE_ID;
  readonly label = 'Wait at the bar line';
  readonly requiresMetronome = true;
  override readonly defaultScoringId = 'scoring.timing-weighted';

  /**
   * Nothing owed here, so nothing to wait for.
   *
   * The matcher rather than the step's own notes, for the reason Wait mode
   * gives: a step can hold notes this reader is not being asked for, and
   * waiting on those waits for a press that will never be demanded.
   */
  override onStepEntered(context: PracticeContext, _step: PracticeStep): void {
    if (context.matcher === null) {
      context.completeStep('skipped');
    }
  }

  override onBeat(context: PracticeContext, tick: MetronomeTick): void {
    const step = context.currentStep;
    if (step === null) {
      return;
    }
    // The pulse never completes a step for the reader; the only thing it
    // decides is when the bar's time is up and the waiting starts.
    const line = barLineAfter(context, step);
    if (context.positionTicks(tick) >= line) {
      context.holdForTheBar(line);
    }
  }

  override onNoteOn(context: PracticeContext, event: MidiNoteOnEvent): void {
    // Before anything is judged, because this press may be what decides what
    // o'clock it is: where the pulse is waiting at a bar line the reader has
    // reached, starting the bar is the first thing this press does, and the
    // beat it is measured against is the one it has just given.
    context.startTheHeldBarAt(event.timestampMs);

    // Before the matcher is asked anything, because asking it is what records
    // a wrong note: a press the reader meant as "on to the next one" is not a
    // mistake they should have to see marked and then forgiven.
    if (context.movesOnTo(event.midi)) {
      context.completeStep();
    }

    const matcher = context.matcher;
    const step = context.currentStep;
    if (matcher === null || step === null) {
      // Pressed where nothing is owed: still worth reporting as an extra note.
      context.judgeNote(event.midi, 'wrong', null);
      return;
    }

    const outcome = matcher.accept(event.midi, event.timestampMs);
    // Against the written moment, which is what makes this mode about rhythm:
    // the cursor may have been sitting here for a second, and how long the
    // reader took to find the note is exactly the thing being measured.
    const deviationMs = event.timestampMs - context.scheduledTimeMs(step.onsetTicks);
    context.judgeNote(event.midi, outcome.verdict, deviationMs);

    if (outcome.completed) {
      context.completeStep();
    }
  }
}

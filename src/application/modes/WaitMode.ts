import type { MidiNoteOnEvent } from '../ports/IMidiSource.js';
import type { PracticeContext } from '../session/PracticeContext.js';
import { BasePracticeMode, type PracticeStep } from './IPracticeMode.js';

export const WAIT_MODE_ID = 'mode.wait';

/**
 * The cursor waits for the player.
 *
 * Nothing advances until the notated chord has actually been sounded, so this
 * is the mode for learning the page rather than for keeping time. Wrong notes
 * are recorded and reported but never block progress once the right ones
 * arrive - stopping the session on every slip would make practice miserable.
 */
/**
 * Whether this press beat the music to the note.
 *
 * Only where the reader asked for it, which is where they are playing one
 * hand against the other: the mode waits for them, so late costs nothing,
 * but the hand they are hearing does not wait - and a reader who is ahead of
 * it is not playing with it.
 *
 * The window is the early window, which is already this program's answer to
 * "how far before a moment does a press still count as aimed at it". Not the
 * matching tolerance: in a waiting mode that is deliberately infinite - a
 * chord being learned takes as long as it takes - so nothing measured against
 * it could ever be early.
 */
function rushed(context: PracticeContext, event: MidiNoteOnEvent): boolean {
  if (context.options.rushing !== 'a-mistake') {
    return false;
  }
  const due = context.stepDueAtMs;
  return due !== null && event.timestampMs < due - context.options.earlyWindowMs;
}

export class WaitMode extends BasePracticeMode {
  readonly id = WAIT_MODE_ID;
  readonly label = 'Wait for the notes';
  readonly requiresMetronome = false;

  override onStepEntered(context: PracticeContext, _step: PracticeStep): void {
    // The matcher, not the step's own notes. A step can hold notes this
    // reader is not being asked for - the other hand keeps moving under a
    // held one - and waiting on those is waiting for a press that will never
    // be demanded, with no key able to move the run on again. The session has
    // already decided what is expected here; asking it is the only way the
    // two cannot drift apart.
    if (context.matcher === null) {
      // Nothing to wait for: a rest, or a bar belonging to the other hand.
      context.completeStep('skipped');
    }
  }

  override onNoteOn(context: PracticeContext, event: MidiNoteOnEvent): void {
    // Before the matcher is asked anything, because asking it is what records
    // a wrong note: a press the reader meant as "on to the next one" is not a
    // mistake they should have to see marked and then forgiven.
    if (context.movesOnTo(event.midi)) {
      context.completeStep();
    }
    const matcher = context.matcher;
    if (matcher === null) {
      return;
    }

    const outcome = matcher.accept(event.midi, event.timestampMs);
    const deviationMs =
      outcome.verdict === 'correct' ? event.timestampMs - context.stepEnteredAtMs : null;
    context.judgeNote(
      event.midi,
      rushed(context, event) ? 'rushed' : outcome.verdict,
      deviationMs,
      event.timestampMs,
    );

    if (outcome.completed) {
      context.completeStep();
    }
  }
}

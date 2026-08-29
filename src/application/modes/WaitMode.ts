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
    const matcher = context.matcher;
    if (matcher === null) {
      return;
    }

    const outcome = matcher.accept(event.midi, event.timestampMs);
    const deviationMs =
      outcome.verdict === 'correct' ? event.timestampMs - context.stepEnteredAtMs : null;
    context.judgeNote(event.midi, outcome.verdict, deviationMs);

    if (outcome.completed) {
      context.completeStep();
    }
  }
}

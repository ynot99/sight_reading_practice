import type { MetronomeTick } from '../ports/IMetronome.js';
import type { MidiNoteOnEvent } from '../ports/IMidiSource.js';
import type { PracticeContext } from '../session/PracticeContext.js';
import { BasePracticeMode } from './IPracticeMode.js';

export const FLOW_MODE_ID = 'mode.flow';

/**
 * The cursor keeps walking; the player has to keep up.
 *
 * Each step owns a slice of musical time. When that slice elapses the step is
 * finalised no matter what was played, which is what makes this mode measure
 * sight-reading fluency rather than note-finding ability.
 *
 * Timing is judged against the *scheduled* onset derived from the tempo, not
 * against the moment a tick callback happened to run, so audio scheduling
 * jitter never shows up in the player's score.
 */
export class FlowMode extends BasePracticeMode {
  readonly id = FLOW_MODE_ID;
  readonly label = 'Flow with the metronome';
  readonly requiresMetronome = true;

  override onBeat(context: PracticeContext, tick: MetronomeTick): void {
    const position = context.positionTicks(tick);

    // A single tick can span several steps at fast tempi or fine subdivisions.
    let guard = context.timeline.length + 1;
    while (guard > 0) {
      guard -= 1;
      const step = context.currentStep;
      if (step === null) {
        return;
      }
      if (position < step.onsetTicks + step.durationTicks) {
        return;
      }
      context.completeStep();
    }
  }

  override onNoteOn(context: PracticeContext, event: MidiNoteOnEvent): void {
    const matcher = context.matcher;
    const step = context.currentStep;
    if (matcher === null || step === null) {
      // Pressed during a rest: still worth reporting as an extra note.
      context.judgeNote(event.midi, 'wrong', null);
      return;
    }

    const outcome = matcher.accept(event.midi, event.timestampMs);
    const deviationMs =
      outcome.verdict === 'correct'
        ? event.timestampMs - context.scheduledTimeMs(step.onsetTicks)
        : null;
    context.judgeNote(event.midi, outcome.verdict, deviationMs);
  }
}

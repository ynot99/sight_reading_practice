import type { MetronomeTick } from '../ports/IMetronome.js';
import type { MidiNoteOnEvent } from '../ports/IMidiSource.js';
import type { PracticeContext } from '../session/PracticeContext.js';
import { BasePracticeMode, type PracticeStep } from './IPracticeMode.js';

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
  override readonly defaultScoringId = 'scoring.timing-weighted';

  /** Presses that arrived just before the beat they were aimed at. */
  private early: MidiNoteOnEvent[] = [];

  override onSessionStart(): void {
    this.early = [];
  }

  override onSessionEnd(): void {
    this.early = [];
  }

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

  /** Anything held back for this step is judged the moment it opens. */
  override onStepEntered(context: PracticeContext, _step: PracticeStep): void {
    if (this.early.length === 0) {
      return;
    }
    const waiting = this.early;
    this.early = [];
    for (const event of waiting) {
      this.judge(context, event);
    }
  }

  override onNoteOn(context: PracticeContext, event: MidiNoteOnEvent): void {
    if (this.isAimedAtTheNextStep(context, event)) {
      // Held back rather than judged: it belongs to a step that has not begun.
      this.early.push(event);
      return;
    }
    this.judge(context, event);
  }

  /**
   * Whether a press was reaching for the beat that has not arrived yet.
   *
   * Only presses the current step has no use for are considered: a chord note
   * arriving late is still that chord's, and handing it to the next step would
   * turn one well-played bar into two badly played ones.
   *
   * The window never runs past halfway to the next beat, so at a brisk tempo
   * it shrinks with the music instead of swallowing whole steps.
   */
  private isAimedAtTheNextStep(context: PracticeContext, event: MidiNoteOnEvent): boolean {
    const step = context.currentStep;
    if (step === null) {
      return false;
    }
    const next = context.timeline.at(step.index + 1);
    if (next === null) {
      return false;
    }

    const matcher = context.matcher;
    if (matcher !== null && matcher.remaining.includes(event.midi)) {
      return false;
    }

    const dueAt = context.scheduledTimeMs(next.onsetTicks);
    const untilDue = dueAt - event.timestampMs;
    if (untilDue <= 0) {
      return false;
    }
    const gap = dueAt - context.scheduledTimeMs(step.onsetTicks);
    return untilDue <= Math.min(context.options.earlyWindowMs, gap / 2);
  }

  private judge(context: PracticeContext, event: MidiNoteOnEvent): void {
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

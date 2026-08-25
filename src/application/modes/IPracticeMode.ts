import type { TimelineStep } from '../../domain/timeline/Timeline.js';
import type { MidiNoteOffEvent, MidiNoteOnEvent } from '../ports/IMidiSource.js';
import type { MetronomeTick } from '../ports/IMetronome.js';
import type { PracticeContext } from '../session/PracticeContext.js';

/** Alias so mode implementations need one import instead of two. */
export type PracticeStep = TimelineStep;

/**
 * How a practice run advances and how input is judged.
 *
 * Wait mode and Flow mode differ only in *when* the cursor moves and *what
 * counts as being on time*; everything else - the timeline, the matcher, the
 * report - is shared. Encapsulating just that difference is what keeps new
 * modes (metronome-free tempo ramps, exam runs, repeat-until-clean drills) a
 * small, additive change.
 */
export interface IPracticeMode {
  readonly id: string;
  readonly label: string;
  /** When true, the session starts a pulse even if the click is muted. */
  readonly requiresMetronome: boolean;

  onSessionStart(context: PracticeContext): void;
  onStepEntered(context: PracticeContext, step: PracticeStep): void;
  onNoteOn(context: PracticeContext, event: MidiNoteOnEvent): void;
  onNoteOff(context: PracticeContext, event: MidiNoteOffEvent): void;
  onBeat(context: PracticeContext, tick: MetronomeTick): void;
  onSessionEnd(context: PracticeContext): void;
}

/**
 * No-op defaults.
 *
 * Subclasses override only the hooks they care about, which keeps each mode
 * readable and guarantees that adding a hook to the interface later cannot
 * break existing modes.
 */
export abstract class BasePracticeMode implements IPracticeMode {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly requiresMetronome: boolean;

  onSessionStart(_context: PracticeContext): void {
    // No-op by default.
  }

  onStepEntered(_context: PracticeContext, _step: PracticeStep): void {
    // No-op by default.
  }

  onNoteOn(_context: PracticeContext, _event: MidiNoteOnEvent): void {
    // No-op by default.
  }

  onNoteOff(_context: PracticeContext, _event: MidiNoteOffEvent): void {
    // No-op by default.
  }

  onBeat(_context: PracticeContext, _tick: MetronomeTick): void {
    // No-op by default.
  }

  onSessionEnd(_context: PracticeContext): void {
    // No-op by default.
  }
}

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
  /**
   * Whether the music's own first beat is the reader's to give.
   *
   * The pulse is silent until they give it. Asked at the start rather than
   * discovered from the first hold, because a look-ahead scheduler commits a
   * click before the run is told the tick exists: by the time a mode could
   * say "wait here", the beat it wanted silenced has been heard.
   */
  readonly waitsForTheFirstBeat: boolean;
  /**
   * Whether a gate lets the music run up to its note and holds it only past it.
   *
   * The other way a gate can stand. At a bar line the pulse falls silent at the
   * gate and the reader's press is the downbeat. At every note that would be no
   * pulse at all, so there the beat falls as written, the reader has the note's
   * Perfect window to meet it, and only after that does the music stand still.
   */
  readonly holdsPastTheGate: boolean;
  /**
   * Grading this mode is usually judged by.
   *
   * A default, not a binding: the reader may grade any mode by any registered
   * strategy, the way any preset combines with any rhythm.
   */
  readonly defaultScoringId: string;

  /**
   * Where this step makes the music stand still and wait to be given a beat.
   *
   * The tick to hold at, or `null` for a mode that never waits. Asked as a
   * question rather than done as a side effect of entering the step, because
   * everything the step is announced to has to know: an accompaniment told
   * about a step and not about the gate on it comes in by itself, which is
   * exactly what a reader hears as the other hand running away from them.
   */
  holdsAt(context: PracticeContext, step: PracticeStep): number | null;

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

  /** Concrete so that adding the field cannot break an existing mode. */
  readonly defaultScoringId: string = 'scoring.accuracy';

  /** Concrete for the same reason: most modes count themselves in. */
  readonly waitsForTheFirstBeat: boolean = false;

  /** And this one: a gate, where a mode has one, is at a bar line. */
  readonly holdsPastTheGate: boolean = false;

  /** Nothing waits, by default: most modes are carried by the clock. */
  holdsAt(_context: PracticeContext, _step: PracticeStep): number | null {
    return null;
  }

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

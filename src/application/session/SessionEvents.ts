import type { NoteVerdict } from '../../domain/matching/ChordMatcher.js';
import type { PerformanceReport, StepResult } from '../../domain/scoring/PerformanceReport.js';
import type { SessionScore } from '../../domain/scoring/IScoringStrategy.js';
import type { TimelineStep } from '../../domain/timeline/Timeline.js';
import type { MetronomeTick } from '../ports/IMetronome.js';
import type { SessionStatus } from './SessionState.js';

export interface StatusChangedEvent {
  readonly previous: SessionStatus;
  readonly status: SessionStatus;
}

export interface CountInEvent {
  readonly beatsRemaining: number;
}

export interface StepEnteredEvent {
  readonly step: TimelineStep;
  /**
   * What *this run* asks for here, which is not always what the step holds:
   * practising one hand narrows it. The page shows the step; the panel that
   * says what to play has to say what is actually being waited for.
   */
  readonly expectedMidi: readonly number[];
}

export interface StepCompletedEvent {
  readonly result: StepResult;
}

/**
 * Where the music has reached.
 *
 * Deliberately not the same question as {@link StepEnteredEvent}, which asks
 * which cursor position is open. The two answers coincide only while the
 * reader is what moves the piece: under the metronome the beat goes on
 * counting through a held note, and a display taken from the step stood still
 * for the whole of it.
 */
export interface PositionEvent {
  /** Zero-based, as the timeline counts; the page numbers it from the score. */
  readonly measureIndex: number;
  /** One-based notated beat, possibly fractional. */
  readonly beat: number;
}

export interface NoteJudgedEvent {
  readonly midi: number;
  readonly verdict: NoteVerdict;
  readonly stepIndex: number;
  /** Only meaningful in beat-driven modes; `null` when timing is not judged. */
  readonly deviationMs: number | null;
  readonly remaining: readonly number[];
}

export interface SessionFinishedEvent {
  readonly report: PerformanceReport;
  readonly score: SessionScore;
}

/** Everything a practice session publishes. */
export interface SessionEventMap {
  statusChanged: StatusChangedEvent;
  countIn: CountInEvent;
  stepEntered: StepEnteredEvent;
  stepCompleted: StepCompletedEvent;
  positionChanged: PositionEvent;
  noteJudged: NoteJudgedEvent;
  beat: MetronomeTick;
  finished: SessionFinishedEvent;
}

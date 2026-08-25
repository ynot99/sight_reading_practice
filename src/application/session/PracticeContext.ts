import type { ChordMatcher, MatchPolicy, NoteVerdict } from '../../domain/matching/ChordMatcher.js';
import type { StepStatus } from '../../domain/scoring/PerformanceReport.js';
import type { ExerciseTimeline, TimelineStep } from '../../domain/timeline/Timeline.js';
import type { IClock } from '../ports/IClock.js';
import type { MetronomeTick } from '../ports/IMetronome.js';

export interface SessionOptions {
  /** How simultaneous presses are collected into chords. */
  readonly matchPolicy: MatchPolicy;
  /** Beats of click before the first note. */
  readonly countInBeats: number;
  /** Metronome resolution; 4 resolves sixteenth notes. */
  readonly subdivisionsPerBeat: number;
  /** Run the pulse without sounding it. */
  readonly metronomeMuted: boolean;
}

export const DEFAULT_SESSION_OPTIONS: SessionOptions = {
  matchPolicy: { toleranceMs: 250, pitchClassOnly: false },
  countInBeats: 4,
  subdivisionsPerBeat: 4,
  metronomeMuted: false,
};

/**
 * The narrow view of a running session that practice modes are given.
 *
 * Modes may inspect where the session is and tell it what happened, but they
 * cannot touch its state machine, its subscriptions or its report. That split
 * is what lets a new mode be written without any risk to the lifecycle.
 */
export interface PracticeContext {
  readonly timeline: ExerciseTimeline;
  readonly options: SessionOptions;
  readonly clock: IClock;
  readonly tempoBpm: number;

  readonly currentIndex: number;
  readonly currentStep: TimelineStep | null;
  readonly matcher: ChordMatcher | null;

  /** Clock time at which the current step became active. */
  readonly stepEnteredAtMs: number;
  /** Clock time of musical position zero for this run. */
  readonly runStartedAtMs: number;

  /** Musical position of a metronome tick, relative to this run. */
  positionTicks(tick: MetronomeTick): number;
  /** Clock time at which a musical position is due. */
  scheduledTimeMs(ticks: number): number;

  /** Reports a judged press; the session records and publishes it. */
  judgeNote(midi: number, verdict: NoteVerdict, deviationMs: number | null): void;
  /** Finalises the current step and advances. Status is derived when omitted. */
  completeStep(status?: StepStatus): void;
  /** Ends the run early (used when a mode runs out of material). */
  finish(): void;
}

import type { ChordMatcher, MatchPolicy, NoteVerdict } from '../../domain/matching/ChordMatcher.js';
import type { StepStatus } from '../../domain/scoring/PerformanceReport.js';
import type { ExerciseTimeline, TimelineStep } from '../../domain/timeline/Timeline.js';
import type { IClock } from '../ports/IClock.js';
import type {
  ClickWhen,
  ClickPattern,
  ClickSilence,
  MetronomeTick,
} from '../ports/IMetronome.js';

export interface SessionOptions {
  /** How simultaneous presses are collected into chords. */
  readonly matchPolicy: MatchPolicy;
  /**
   * Bars of click before the first note.
   *
   * Counted in bars rather than beats because that is what a count-in is: one
   * bar of 6/8 is two felt beats, not four, and asking for "four beats" of it
   * gives two thirds of a bar and leaves the reader out of phase.
   */
  readonly countInBars: number;
  /**
   * The step the run begins at.
   *
   * Nought for a piece read from the top, which is nearly always. A reader
   * who has put the cursor somewhere by hand means to start from there, and
   * the machinery for beginning partway through already exists - it is what
   * resuming from a pause does, counted back in the same way.
   */
  readonly startAtIndex?: number;
  /**
   * The last step of the run, after which it is over.
   *
   * Left out for a piece read to the end, which is what it means to have
   * chosen no passage. This is how a passage is practised: the music stays
   * whole on the page and the run is given two ends. Cutting the score down
   * instead - which is what this used to do - meant restating the clef and
   * the key, letting go of a tie that led out of the last bar and pressing
   * the pedal again at the front, and all of that is only a problem because
   * something was cut.
   */
  readonly stopAfterIndex?: number;
  /**
   * Staff whose notes are expected, or `null` for the whole texture.
   *
   * Practising one hand is not the same as practising half the music: the
   * page still shows both, and the reader still has to keep their place in
   * both. Only what is demanded narrows.
   */
  readonly expectedStaff: number | null;
  /** How much of the pulse the reader hears. */
  readonly click: ClickPattern;
  /**
   * Which of those clicks are taken away again.
   *
   * A click with a hole in it is one the reader keeps time *with* rather than
   * follows - the bar is theirs to hold when its first beat is missing.
   */
  readonly clickSilences?: ClickSilence;
  /**
   * How much of the run the click sits out.
   *
   * Not a comfort setting: carrying the pulse alone and finding out whether
   * you drifted is the timekeeping exercise, and it is the one thing a
   * metronome cannot teach while it is playing.
   */
  readonly clickWhen: ClickWhen;
  /**
   * How far before a beat a press still counts as aimed at it.
   *
   * Nobody lands exactly on the beat, and a press a few milliseconds early is
   * a well-timed attempt at the note coming up - not a wrong note added to the
   * one going out. Beyond this it is treated as belonging where it fell.
   */
  readonly earlyWindowMs: number;
  /**
   * How long a press takes to arrive, in milliseconds.
   *
   * Taken off every timestamp before anything is judged by it. A key struck
   * exactly on the beat is not *heard about* on the beat: the keyboard scans,
   * the relay forwards, the tablet wakes, and by then the beat has gone. The
   * reader who is playing perfectly then reads "late" on every note and has no
   * way to tell their habit from the path their notes travelled.
   *
   * A single number because that is what this is: a constant delay on the way
   * in. Scatter about it is a different measurement and belongs to the reader,
   * which is why the report gives the spread beside the tendency - a large
   * mean with a small spread is exactly this, and correcting it here is the
   * only honest place.
   */
  readonly inputLatencyMs: number;
  /**
   * What a press belonging to a later beat means.
   *
   * His, and he asked for both answers: some readers play a note early to
   * *get* to it, and some are learning not to. Where the music waits, the
   * difference is the whole of what the mode is teaching - so it is the
   * reader's to say rather than this program's to decide.
   *
   * `a-mistake` is what it has always been: the beat goes on waiting and the
   * press is a wrong note against it. `moves-on` leaves the beat behind
   * unplayed and takes the press as the beginning of the next one.
   */
  readonly playingAhead: PlayingAhead;
  /**
   * What a press before the written moment means.
   *
   * His, and only where he is playing one hand and hearing the other: the
   * music waits for him, so late costs nothing, but the accompaniment does
   * not wait - and a reader who beats it is not playing with it. Where there
   * is no other hand sounding there is nothing to be early against, and this
   * says `allowed`.
   */
  readonly rushing: Rushing;
}

/** @see SessionOptions.playingAhead */
export type PlayingAhead = 'a-mistake' | 'moves-on';

/** @see SessionOptions.rushing */
export type Rushing = 'allowed' | 'a-mistake';

export const DEFAULT_SESSION_OPTIONS: SessionOptions = {
  matchPolicy: { toleranceMs: 250, pitchClassOnly: false },
  countInBars: 1,
  expectedStaff: null,
  click: 'pulse',
  clickWhen: 'always',
  earlyWindowMs: 120,
  inputLatencyMs: 0,
  playingAhead: 'a-mistake',
  rushing: 'allowed',
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
  /**
   * Clock time the current step is *written* to arrive at, or `null`.
   *
   * Measured from the last step the reader owed and actually played, which is
   * the same anchor the accompaniment is placed from: what they hear and what
   * they are judged by then agree by construction. `null` before there is
   * such a step, where nothing has yet said what o'clock the music is at.
   */
  readonly stepDueAtMs: number | null;
  /** Clock time of musical position zero for this run. */
  readonly runStartedAtMs: number;

  /** Musical position of a metronome tick, relative to this run. */
  positionTicks(tick: MetronomeTick): number;
  /** Clock time at which a musical position is due. */
  scheduledTimeMs(ticks: number): number;

  /**
   * Whether a press is the reader moving on rather than a wrong note.
   *
   * True only where they asked for that, where this beat neither wants the
   * note nor prints it as an ornament, and where the beat after this one
   * does. One beat and no further, which is the rule the late presses
   * already follow: the note says which beat was meant, and a note two beats
   * off is a reader who has lost their place rather than one who is ahead.
   */
  movesOnTo(midi: number): boolean;

  /** Reports a judged press; the session records and publishes it. */
  judgeNote(midi: number, verdict: NoteVerdict, deviationMs: number | null): void;
  /** Finalises the current step and advances. Status is derived when omitted. */
  completeStep(status?: StepStatus): void;
  /** Ends the run early (used when a mode runs out of material). */
  finish(): void;
}

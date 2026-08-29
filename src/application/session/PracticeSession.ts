import { ChordMatcher, type NoteVerdict } from '../../domain/matching/ChordMatcher.js';
import { ticksToMilliseconds } from '../../domain/model/Duration.js';
import type { IScoringStrategy, SessionScore } from '../../domain/scoring/IScoringStrategy.js';
import {
  buildPerformanceReport,
  type PerformanceReport,
  type StepResult,
  type StepStatus,
} from '../../domain/scoring/PerformanceReport.js';
import type { ExerciseTimeline, TimelineStep } from '../../domain/timeline/Timeline.js';
import { TypedEventEmitter, type IEventSource, type Unsubscribe } from '../../shared/EventEmitter.js';
import type { IPracticeMode } from '../modes/IPracticeMode.js';
import type { IClock } from '../ports/IClock.js';
import { resolveDropout, type IMetronome, type MetronomeTick } from '../ports/IMetronome.js';
import type { IMidiSource, MidiEvent, MidiNoteOnEvent } from '../ports/IMidiSource.js';
import { subdivisionsPerPulseFor } from './metronomePlan.js';
import { DEFAULT_SESSION_OPTIONS, type PracticeContext, type SessionOptions } from './PracticeContext.js';
import type { SessionEventMap } from './SessionEvents.js';
import { createSessionMachine, type SessionStatus, type SessionTrigger } from './SessionState.js';

export interface PracticeSessionDependencies {
  readonly timeline: ExerciseTimeline;
  readonly mode: IPracticeMode;
  readonly midi: IMidiSource;
  readonly metronome: IMetronome;
  readonly clock: IClock;
  readonly scoring: IScoringStrategy;
  readonly options?: Partial<SessionOptions>;
}

/**
 * Runs one exercise from the count-in to the final report.
 *
 * The session owns the lifecycle (state machine, subscriptions, step cursor,
 * results) and delegates the two questions that differ between practice
 * styles - when to advance, and how to judge a press - to an
 * {@link IPracticeMode}. It talks to hardware only through ports, so the
 * entire loop runs headless in tests.
 */
export class PracticeSession {
  private readonly timeline: ExerciseTimeline;
  private readonly mode: IPracticeMode;
  private readonly midi: IMidiSource;
  private readonly metronome: IMetronome;
  private readonly clock: IClock;
  private readonly scoring: IScoringStrategy;
  private readonly options: SessionOptions;

  private readonly emitter = new TypedEventEmitter<SessionEventMap>();
  private readonly machine = createSessionMachine();
  private readonly context: PracticeContext;

  private subscriptions: Unsubscribe[] = [];
  private results: StepResult[] = [];

  private stepIndex = -1;
  private matcher: ChordMatcher | null = null;
  private stepEnteredAt = 0;
  private stepDeviationMs: number | null = null;
  private stepWrongNotes: number[] = [];

  private runStartedAt = 0;
  private positionOffsetTicks = 0;
  private countInRemaining = 0;
  /** Whether the pause landed before the music had begun. */
  private pausedInCountIn = false;
  /** Note-ons that landed during the count-in, kept until the music starts. */
  private beforeTheMusic: MidiNoteOnEvent[] = [];
  private lastReport: PerformanceReport | null = null;
  private lastScore: SessionScore | null = null;

  constructor(dependencies: PracticeSessionDependencies) {
    this.timeline = dependencies.timeline;
    this.mode = dependencies.mode;
    this.midi = dependencies.midi;
    this.metronome = dependencies.metronome;
    this.clock = dependencies.clock;
    this.scoring = dependencies.scoring;
    this.options = { ...DEFAULT_SESSION_OPTIONS, ...dependencies.options };
    this.context = this.createContext();
  }

  get events(): IEventSource<SessionEventMap> {
    return this.emitter.asSource();
  }

  get status(): SessionStatus {
    return this.machine.state;
  }

  get currentIndex(): number {
    return this.stepIndex;
  }

  get currentStep(): TimelineStep | null {
    return this.timeline.at(this.stepIndex);
  }

  get stepResults(): readonly StepResult[] {
    return this.results;
  }

  get report(): PerformanceReport | null {
    return this.lastReport;
  }

  get score(): SessionScore | null {
    return this.lastScore;
  }

  /** Tempo actually used for the run; taken from the exercise. */
  get tempoBpm(): number {
    return this.timeline.exercise.tempoBpm;
  }

  /** Begins (or restarts) a run. */
  start(): void {
    const previous = this.machine.state;
    this.machine.dispatch('start');
    this.resetRunState();
    this.emitStatus(previous);

    this.metronome.configure({
      bpm: this.tempoBpm,
      timeSignature: this.timeline.exercise.timeSignature,
      subdivisionsPerPulse: subdivisionsPerPulseFor(
        this.timeline,
        this.timeline.exercise.timeSignature,
        this.options.click,
      ),
      click: this.options.click,
      dropout: resolveDropout(
        this.options.clickDropout,
        Math.max(0, this.options.countInBars),
      ),
      muted: this.options.metronomeMuted,
    });

    this.subscriptions.push(this.midi.subscribe((event) => this.handleMidi(event)));
    this.subscriptions.push(this.metronome.onTick((tick) => this.handleTick(tick)));

    if (this.usesPulse()) {
      this.countInRemaining = Math.max(0, this.countInPulses());
      this.metronome.start();
      return;
    }

    this.beginRunning(this.clock.now(), 0);
  }

  pause(): void {
    const wasCountingIn = this.machine.state === 'counting-in';
    if (!this.dispatch('pause')) {
      return;
    }
    this.pausedInCountIn = wasCountingIn;
    this.metronome.stop();
  }

  /**
   * Resumes from the top of the current measure.
   *
   * Restarting mid-bar would leave the click out of phase with the notation
   * and would score half-played chords twice, so the bar is replayed instead.
   */
  resume(): void {
    if (this.pausedInCountIn) {
      // Back to the count, and to the whole of it: a count-in half heard
      // gives the reader no tempo, which is the only thing it is for.
      if (!this.dispatch('resumeCountIn')) {
        return;
      }
      this.pausedInCountIn = false;
      this.countInRemaining = Math.max(0, this.countInPulses());
      this.metronome.start();
      return;
    }
    if (!this.dispatch('resume')) {
      return;
    }

    const target = this.measureStartStep(this.currentStep);
    const measureStartTicks = target?.onsetTicks ?? 0;
    this.results = this.results.filter((result) => result.index < (target?.index ?? 0));
    this.positionOffsetTicks = -measureStartTicks;
    this.runStartedAt = this.clock.now() - ticksToMilliseconds(measureStartTicks, this.tempoBpm);

    if (this.usesPulse()) {
      this.metronome.start();
    }
    this.enterStep(target?.index ?? 0);
  }

  /** Stops the run and publishes the report gathered so far. */
  abort(): void {
    if (!this.dispatch('abort')) {
      return;
    }
    this.finalise(false);
  }

  /** Releases every subscription without publishing a report. */
  dispose(): void {
    this.teardown();
    this.emitter.removeAllListeners();
  }

  /** Count-in length in felt beats: one bar of 6/8 is two, not six. */
  /**
   * The pitches this run asks for at a step.
   *
   * A step where the chosen hand has nothing to play is a rest for this run,
   * even though the other hand is busy - the cursor still stops there, because
   * the reader is still reading it.
   */
  private expectedAt(step: TimelineStep): readonly number[] {
    const staff = this.options.expectedStaff;
    if (staff === null) {
      return step.expectedMidi;
    }
    return [
      ...new Set(step.notes.filter((note) => note.staffNumber === staff).map((note) => note.midi)),
    ];
  }

  private countInPulses(): number {
    const pulses = this.timeline.exercise.timeSignature.pulsesPerMeasure;
    return Math.max(0, Math.round(this.options.countInBars * pulses));
  }

  private usesPulse(): boolean {
    return (
      this.mode.requiresMetronome ||
      this.options.countInBars > 0 ||
      !this.options.metronomeMuted
    );
  }

  private resetRunState(): void {
    this.teardown();
    this.results = [];
    this.stepIndex = -1;
    this.matcher = null;
    this.stepDeviationMs = null;
    this.stepWrongNotes = [];
    this.runStartedAt = 0;
    this.positionOffsetTicks = 0;
    this.countInRemaining = 0;
    this.beforeTheMusic = [];
    this.lastReport = null;
    this.lastScore = null;
  }

  private beginRunning(atMs: number, offsetTicks: number): void {
    this.runStartedAt = atMs;
    this.positionOffsetTicks = offsetTicks;
    this.dispatch('countInComplete');
    this.mode.onSessionStart(this.context);
    this.enterStep(0);
    this.replayPressesAimedAtTheFirstBeat(atMs);
  }

  /**
   * Hands the mode any press that arrived just before the music did.
   *
   * The early-press window already covers every other step, but the first one
   * had nothing in front of it: the run had not started, so the press was not
   * held back, it was discarded. The session decides only *whether the input
   * survives*; what it is worth is still the mode's call, so these go through
   * the ordinary note-on path with their real timestamps and are graded as
   * early exactly like any other anticipated beat.
   */
  private replayPressesAimedAtTheFirstBeat(runStartedAtMs: number): void {
    const held = this.beforeTheMusic;
    this.beforeTheMusic = [];
    if (this.status !== 'running') {
      return;
    }
    for (const event of held) {
      if (runStartedAtMs - event.timestampMs <= this.options.earlyWindowMs) {
        this.mode.onNoteOn(this.context, event);
      }
    }
  }

  private enterStep(index: number): void {
    const step = this.timeline.at(index);
    if (step === null) {
      this.finish();
      return;
    }

    this.stepIndex = index;
    const expected = this.expectedAt(step);
    this.matcher =
      expected.length > 0 ? new ChordMatcher(expected, this.options.matchPolicy) : null;
    this.stepEnteredAt = this.clock.now();
    this.stepDeviationMs = null;
    this.stepWrongNotes = [];

    this.emitter.emit('stepEntered', { step, expectedMidi: expected });
    this.mode.onStepEntered(this.context, step);
  }

  private completeStep(status?: StepStatus): void {
    if (this.status !== 'running') {
      return;
    }
    const step = this.currentStep;
    if (step === null) {
      return;
    }

    const summary = this.matcher?.summary() ?? null;
    const result: StepResult = {
      index: step.index,
      status: status ?? this.deriveStatus(),
      measureIndex: step.measureIndex,
      beat: step.beat,
      expected: summary?.expected ?? [],
      played: summary?.matched ?? [],
      wrong: [...this.stepWrongNotes],
      missing: summary?.missing ?? [],
      deviationMs: this.stepDeviationMs,
    };

    this.results.push(result);
    this.emitter.emit('stepCompleted', { result });

    if (step.index + 1 >= this.timeline.length) {
      this.finish();
      return;
    }
    this.enterStep(step.index + 1);
  }

  private deriveStatus(): StepStatus {
    if (this.matcher === null) {
      return 'skipped';
    }
    if (!this.matcher.completed) {
      return 'missed';
    }
    return this.stepWrongNotes.length === 0 ? 'correct' : 'incorrect';
  }

  private finish(): void {
    if (!this.dispatch('complete')) {
      return;
    }
    this.finalise(true);
  }

  private finalise(completed: boolean): void {
    this.mode.onSessionEnd(this.context);
    this.teardown();

    const report = buildPerformanceReport({
      exerciseId: this.timeline.exercise.id,
      modeId: this.mode.id,
      tempoBpm: this.tempoBpm,
      startedAtMs: this.runStartedAt,
      endedAtMs: this.clock.now(),
      completed,
      playableSteps: this.timeline.steps.filter((step) => this.expectedAt(step).length > 0)
        .length,
      steps: this.results,
    });
    const score = this.scoring.score(report);
    this.lastReport = report;
    this.lastScore = score;
    this.emitter.emit('finished', { report, score });
  }

  private teardown(): void {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];
    if (this.metronome.isRunning) {
      this.metronome.stop();
    }
  }

  private handleMidi(event: MidiEvent): void {
    if (this.status === 'counting-in') {
      // Nobody lands exactly on the first beat, and a press a few
      // milliseconds ahead of it is an attempt at the first note, not noise.
      // Dropping it here made the first chord of a run vanish without even a
      // wrong-note verdict to show for it.
      if (event.type === 'noteon') {
        this.beforeTheMusic.push(event);
      }
      return;
    }
    if (this.status !== 'running') {
      return;
    }
    switch (event.type) {
      case 'noteon':
        this.mode.onNoteOn(this.context, event);
        return;
      case 'noteoff':
        this.mode.onNoteOff(this.context, event);
        return;
      default:
        // The pedal changes how the instrument sounds, never what was played.
        return;
    }
  }

  private handleTick(tick: MetronomeTick): void {
    if (this.status === 'counting-in') {
      if (!tick.isPulse) {
        return;
      }
      if (this.countInRemaining > 0) {
        this.emitCountIn(this.countInRemaining);
        this.countInRemaining -= 1;
        return;
      }
      this.beginRunning(tick.scheduledTimeMs, tick.positionTicks);
    }

    if (this.status !== 'running') {
      return;
    }
    this.emitter.emit('beat', tick);
    this.mode.onBeat(this.context, tick);
  }

  private emitCountIn(beatsRemaining: number): void {
    this.emitter.emit('countIn', { beatsRemaining });
  }

  private judgeNote(midi: number, verdict: NoteVerdict, deviationMs: number | null): void {
    if (verdict === 'wrong') {
      this.stepWrongNotes.push(midi);
    }
    if (verdict === 'correct' && this.stepDeviationMs === null) {
      this.stepDeviationMs = deviationMs;
    }
    this.emitter.emit('noteJudged', {
      midi,
      verdict,
      stepIndex: this.stepIndex,
      deviationMs,
      remaining: this.matcher?.remaining ?? [],
    });
  }

  /** First step of the measure the given step belongs to. */
  private measureStartStep(step: TimelineStep | null): TimelineStep | null {
    if (step === null) {
      return this.timeline.at(0);
    }
    const found = this.timeline.steps.find(
      (candidate) => candidate.measureIndex === step.measureIndex,
    );
    return found ?? step;
  }

  /** Applies a trigger when it is legal, publishing the status change. */
  private dispatch(trigger: SessionTrigger): boolean {
    const previous = this.machine.state;
    if (this.machine.tryDispatch(trigger) === null) {
      return false;
    }
    this.emitStatus(previous);
    return true;
  }

  private emitStatus(previous: SessionStatus): void {
    this.emitter.emit('statusChanged', { previous, status: this.machine.state });
  }

  private createContext(): PracticeContext {
    const session = this;
    return {
      get timeline() {
        return session.timeline;
      },
      get options() {
        return session.options;
      },
      get clock() {
        return session.clock;
      },
      get tempoBpm() {
        return session.tempoBpm;
      },
      get currentIndex() {
        return session.stepIndex;
      },
      get currentStep() {
        return session.currentStep;
      },
      get matcher() {
        return session.matcher;
      },
      get stepEnteredAtMs() {
        return session.stepEnteredAt;
      },
      get runStartedAtMs() {
        return session.runStartedAt;
      },
      positionTicks: (tick: MetronomeTick) => tick.positionTicks - session.positionOffsetTicks,
      scheduledTimeMs: (ticks: number) =>
        session.runStartedAt + ticksToMilliseconds(ticks, session.tempoBpm),
      judgeNote: (midi: number, verdict: NoteVerdict, deviationMs: number | null) => {
        session.judgeNote(midi, verdict, deviationMs);
      },
      completeStep: (status?: StepStatus) => {
        session.completeStep(status);
      },
      finish: () => {
        session.finish();
      },
    };
  }
}

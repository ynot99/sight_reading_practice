import { ChordMatcher, type MatchPolicy, type NoteVerdict } from '../../domain/matching/ChordMatcher.js';
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
import {
  clickIsSilent,
  resolveDropout,
  type ClickPattern,
  type ClickWhen,
  type IMetronome,
  type MetronomeTick,
} from '../ports/IMetronome.js';
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
  private options: SessionOptions;

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
  /** Musical position last published, so an unchanged one is not republished. */
  private publishedPositionTicks: number | null = null;
  private countInRemaining = 0;
  /** Whether the pause landed before the music had begun. */
  private pausedInCountIn = false;
  /** Musical position the run is about to pick up from, in divisions. */
  private resumeAtTicks = 0;
  /** Step the run is about to pick up from. */
  private resumeAtIndex = 0;
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
        this.options.clickWhen,
        Math.max(0, this.options.countInBars),
      ),
      muted: clickIsSilent(this.options.clickWhen),
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

  /**
   * Changes how the click sounds, without stopping.
   *
   * A reader who wants it off, or wants four to the beat instead of one,
   * wants it now: stopping the run to ask is stopping the thing they were
   * asking about. The metronome keeps its place across this, so the music
   * does not move - only what is heard over it.
   *
   * The count-in is where the dropout is counted from, as at the start, so
   * "only the count-in" goes on meaning the same thing partway through a run
   * as it did before one.
   */
  applyClick(click: ClickPattern, clickWhen: ClickWhen): void {
    this.options = { ...this.options, click, clickWhen };
    if (!this.metronome.isRunning) {
      return;
    }
    this.metronome.configure({
      bpm: this.tempoBpm,
      timeSignature: this.timeline.exercise.timeSignature,
      subdivisionsPerPulse: subdivisionsPerPulseFor(
        this.timeline,
        this.timeline.exercise.timeSignature,
        click,
      ),
      click,
      dropout: resolveDropout(clickWhen, Math.max(0, this.options.countInBars)),
      muted: clickIsSilent(clickWhen),
    });
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
    const target = this.measureStartStep(this.currentStep);
    this.resumeAtTicks = target?.onsetTicks ?? 0;
    this.resumeAtIndex = target?.index ?? 0;

    // Counted back in, exactly as at the start. A run that simply resumed left
    // the reader with their hands off the keys and the music already moving,
    // which is the same problem the count-in exists to solve - it is not about
    // the beginning of a piece, it is about the moment before playing.
    if (this.countInPulses() > 0 && this.usesPulse()) {
      if (!this.dispatch('resumeCountIn')) {
        return;
      }
      this.results = this.results.filter((result) => result.index < this.resumeAtIndex);
      this.countInRemaining = this.countInPulses();
      this.metronome.start();
      return;
    }

    if (!this.dispatch('resume')) {
      return;
    }

    this.results = this.results.filter((result) => result.index < this.resumeAtIndex);
    this.positionOffsetTicks = -this.resumeAtTicks;
    this.runStartedAt = this.clock.now() - ticksToMilliseconds(this.resumeAtTicks, this.tempoBpm);

    if (this.usesPulse()) {
      this.metronome.start();
    }
    this.enterStep(this.resumeAtIndex);
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

  /**
   * How this step's presses are collected into a chord.
   *
   * A chord the writer marked to be rolled is not held to the chord window,
   * and this is the whole of that rule. The window exists to tell one chord
   * from the next by how close together its notes are - which is exactly the
   * question a roll answers differently, on purpose. Held to it, a spread
   * that took longer than the window had its later notes throw the attempt
   * away and start it again, so the chord never completed and no key the
   * reader pressed could finish it. The instruction on the page said "spread
   * these", and the reader spreading them was what broke it.
   *
   * The step still bounds the wait: under the metronome it ends when its own
   * musical time runs out, and in Wait mode nothing was timing the reader
   * anyway.
   */
  private policyFor(step: TimelineStep): MatchPolicy {
    const rolled = step.notes.some((note) => note.arpeggiated);
    return rolled
      ? { ...this.options.matchPolicy, toleranceMs: Number.POSITIVE_INFINITY }
      : this.options.matchPolicy;
  }

  private countInPulses(): number {
    const pulses = this.timeline.exercise.timeSignature.pulsesPerMeasure;
    return Math.max(0, Math.round(this.options.countInBars * pulses));
  }

  private usesPulse(): boolean {
    return (
      this.mode.requiresMetronome ||
      this.options.countInBars > 0 ||
      !clickIsSilent(this.options.clickWhen)
    );
  }

  /** The step the run ends on: the passage's last, or the piece's. */
  private get lastIndex(): number {
    const wanted = this.options.stopAfterIndex;
    const end = this.timeline.length - 1;
    return wanted === undefined ? end : Math.min(Math.max(0, Math.round(wanted)), end);
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
    this.publishedPositionTicks = null;
    // Where the run begins, which is the top of the piece unless the reader
    // has put the cursor somewhere. Beginning partway through is what
    // resuming from a pause already does, so it is the same two numbers.
    const from = this.timeline.at(Math.max(0, Math.round(this.options.startAtIndex ?? 0)));
    this.resumeAtTicks = from?.onsetTicks ?? 0;
    this.resumeAtIndex = from?.index ?? 0;
    this.countInRemaining = 0;
    this.beforeTheMusic = [];
    this.lastReport = null;
    this.lastScore = null;
  }

  /**
   * Starts the music at the tick the count-in ran out on.
   *
   * `tickPositionTicks` is where the *metronome* has got to, which is not
   * where the *music* is: after a pause the run picks up at the head of a bar
   * partway through the piece. The two are reconciled here, once, so that
   * everything downstream - the timeline, the scheduled onsets, the position
   * shown - goes on counting from the start of the piece.
   */
  private beginRunning(atMs: number, tickPositionTicks: number): void {
    this.runStartedAt = atMs - ticksToMilliseconds(this.resumeAtTicks, this.tempoBpm);
    this.positionOffsetTicks = tickPositionTicks - this.resumeAtTicks;
    this.dispatch('countInComplete');
    this.mode.onSessionStart(this.context);
    this.enterStep(this.resumeAtIndex);
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
    this.matcher = expected.length > 0 ? new ChordMatcher(expected, this.policyFor(step)) : null;
    this.stepEnteredAt = this.clock.now();
    this.stepDeviationMs = null;
    this.stepWrongNotes = [];

    this.emitter.emit('stepEntered', { step, expectedMidi: expected });
    this.publishPosition(step.onsetTicks);
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

    if (step.index >= this.lastIndex) {
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

  /**
   * The moment a press was *made*, from the moment it was heard about.
   *
   * Everything downstream judges by this: the early window, the deviation, the
   * mark drawn on the page. Corrected once, at the door, so that no part of
   * the run can be working from a different idea of when the note happened.
   */
  private struckAt(event: MidiNoteOnEvent): MidiNoteOnEvent {
    const latency = this.options.inputLatencyMs;
    return latency === 0 ? event : { ...event, timestampMs: event.timestampMs - latency };
  }

  private handleMidi(rawEvent: MidiEvent): void {
    const event =
      rawEvent.type === 'noteon' ? this.struckAt(rawEvent) : rawEvent;
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
    this.publishPulsePosition(tick);
  }

  /**
   * Moves the position on with the count, not with the cursor.
   *
   * Only where the pulse is what carries the music. Wait mode runs a
   * metronome too - for the count-in, or because the reader asked to hear it -
   * but the piece stops when they stop, so a position taken from the pulse
   * would walk off into bars nobody has played yet.
   *
   * On notated beats, which is what the position is counted in. Not the felt
   * pulse: those are the same thing only in simple time, and in 6/8 a pulse
   * is a dotted quarter while the beat reported is the eighth the metre is
   * written in - so a reading taken at the pulse went 1, 4, 1, 4 and looked
   * like it was dropping beats. Nor every tick: they arrive as often as the
   * shortest note in the exercise demands, and counting those would report
   * resolution rather than time.
   *
   * Published after the mode has had the tick, so that when a step ends here
   * the pulse's reading is the one left standing - it is never behind the
   * step, and the two never disagree by more than the step that just opened.
   */
  private publishPulsePosition(tick: MetronomeTick): void {
    if (!this.mode.requiresMetronome || this.status !== 'running') {
      return;
    }
    const ticks = this.context.positionTicks(tick);
    if (ticks % this.timeline.exercise.timeSignature.ticksPerBeat !== 0) {
      return;
    }
    this.publishPosition(ticks);
  }

  /**
   * Announces where the music has reached, if it has moved.
   *
   * Both callers land on the same tick whenever a step opens on the beat -
   * which, on most music, is most of them - and an event named for a change
   * has no business firing when nothing changed.
   */
  private publishPosition(ticks: number): void {
    if (ticks === this.publishedPositionTicks) {
      return;
    }
    this.publishedPositionTicks = ticks;
    const signature = this.timeline.exercise.timeSignature;
    this.emitter.emit('positionChanged', {
      measureIndex: signature.measureOf(ticks),
      beat: signature.beatOf(ticks),
    });
  }

  private emitCountIn(beatsRemaining: number): void {
    this.emitter.emit('countIn', { beatsRemaining });
  }

  /**
   * Whether a press the run did not ask for is on the page all the same.
   *
   * Practising one hand narrows what is demanded but not what is *printed*,
   * and the two staves are the engraver's division of the music rather than
   * the player's. An inner voice written on the lower staff is ordinary, and
   * a reader taking it with the right hand is reading the page correctly -
   * yet it was marked as a wrong note, in red, for playing what was in front
   * of them.
   *
   * Only this step's notes: re-striking something the other hand is already
   * holding is a different act, and the page is not asking for it.
   */
  private belongsToTheOtherHand(midi: number): boolean {
    const step = this.currentStep;
    if (step === null || this.options.expectedStaff === null) {
      return false;
    }
    return step.expectedMidi.includes(midi) && !this.expectedAt(step).includes(midi);
  }

  /**
   * The step just finished, if this press was still owed to it.
   *
   * The mirror of the early rule, and the half that was missing. A press
   * ahead of its beat is held back for the beat it was reaching towards; a
   * press behind one had nothing at all, because by then the cursor has moved
   * and the step it belonged to is finished. Judged against the step now open
   * - which is not asking for that note - it came out as a wrong note, in
   * red, for playing the right note slightly late.
   *
   * Which step a press belonged to is answered by *pitch* first and time
   * second: the note itself says which beat was meant, and time only bounds
   * how far it may reach back. One step, no further.
   */
  private oweingStepBefore(midi: number): StepResult | null {
    const step = this.currentStep;
    if (step === null || this.expectedAt(step).includes(midi)) {
      return null;
    }
    const previous = this.results.at(-1);
    if (previous === undefined || previous.index !== step.index - 1) {
      return null;
    }
    return previous.missing.includes(midi) ? previous : null;
  }

  private judgeNote(midi: number, rawVerdict: NoteVerdict, deviationMs: number | null): void {
    const owed = rawVerdict === 'wrong' ? this.oweingStepBefore(midi) : null;
    const verdict: NoteVerdict =
      rawVerdict !== 'wrong'
        ? rawVerdict
        : owed !== null
          ? 'late'
          : this.belongsToTheOtherHand(midi)
            ? 'other-hand'
            : 'wrong';

    if (verdict === 'wrong') {
      this.stepWrongNotes.push(midi);
    }
    if (verdict === 'correct' && this.stepDeviationMs === null) {
      this.stepDeviationMs = deviationMs;
    }
    this.emitter.emit('noteJudged', {
      midi,
      verdict,
      // Drawn on the note it was owed to, not on the one that happened to be
      // open: the mark says which note was played, and this one was that.
      stepIndex: owed === null ? this.stepIndex : owed.index,
      deviationMs: owed === null ? deviationMs : this.lateBy(owed, deviationMs),
      remaining: this.matcher?.remaining ?? [],
    });
  }

  /** How late against the step it was owed to, rather than the one now open. */
  private lateBy(owed: StepResult, deviationMs: number | null): number | null {
    const from = this.timeline.at(owed.index);
    const now = this.currentStep;
    if (deviationMs === null || from === null || now === null) {
      return deviationMs;
    }
    return deviationMs + ticksToMilliseconds(now.onsetTicks - from.onsetTicks, this.tempoBpm);
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

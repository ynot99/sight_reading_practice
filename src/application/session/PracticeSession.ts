import { ChordMatcher, type MatchPolicy, type NoteVerdict } from '../../domain/matching/ChordMatcher.js';
import type { IScoringStrategy, SessionScore } from '../../domain/scoring/IScoringStrategy.js';
import {
  buildPerformanceReport,
  type PerformanceReport,
  type StepResult,
  type StepStatus,
} from '../../domain/scoring/PerformanceReport.js';
import { expectedFor } from '../../domain/timeline/Timeline.js';
import type { ExerciseTimeline, TimelineStep } from '../../domain/timeline/Timeline.js';
import { TypedEventEmitter, type IEventSource, type Unsubscribe } from '../../shared/EventEmitter.js';
import type { IPracticeMode } from '../modes/IPracticeMode.js';
import type { IClock } from '../ports/IClock.js';
import {
  clickFollowsTheReader,
  clickIsSilent,
  resolveDropout,
  type ClickPattern,
  type ClickWhen,
  type IMetronome,
  type MetronomeBar,
  type MetronomeTempo,
  type MetronomeTick,
  type BeatWeight,
} from '../ports/IMetronome.js';
import type { IMidiSource, MidiEvent, MidiNoteOnEvent } from '../ports/IMidiSource.js';
import {
  elapsedMsAt,
  positionOfTick,
  spanMs,
  timeAtMeasure,
} from '../../domain/model/Exercise.js';
import {
  beatAt,
  metronomeBars,
  metronomeEnd,
  metronomeTempos,
  subdivisionsPerPulseFor,
} from './metronomePlan.js';
import { DEFAULT_SESSION_OPTIONS, type PracticeContext, type SessionOptions } from './PracticeContext.js';
import type { NoteJudgedEvent, SessionEventMap } from './SessionEvents.js';
import { RollRecorder, type RunRoll } from './RunRoll.js';
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
  /**
   * Where the written clock was last set, and when.
   *
   * The reader is the clock in a waiting mode: they play a step, and every
   * written moment after it falls where the page says it does relative to
   * that press. The accompaniment is placed from exactly this anchor, so
   * anything judged against it is judged against what the reader heard.
   */
  private writtenAnchor: { readonly wallMs: number; readonly ticks: number } | null = null;

  private runStartedAt = 0;
  /**
   * When the music actually began, which `runStartedAt` stops saying.
   *
   * `runStartedAt` is the wall time musical position zero maps to, and a run
   * that picks up partway through - from a pause, or at a bar line - moves it
   * backwards to keep the written clock honest. The report wants the other
   * thing: how long the reader was at it.
   */
  private runBeganAt = 0;
  /**
   * The bar line the pulse is waiting at, or `null` while it is running.
   *
   * Only Bar mode ever sets this. It is the tick the *next* bar starts on, so
   * arriving at it is what releases the hold.
   */
  private heldAtBarTicks: number | null = null;
  /**
   * Bumped whenever the pulse is restarted under a run already going.
   *
   * A tick describes where the music is only through `positionOffsetTicks`,
   * and restarting the pulse rewrites that. So a tick delivered before the
   * restart and still being acted on afterwards is not late news, it is
   * *wrong* news - it would be read against a mapping made for a different
   * pulse. This is how such a tick is recognised and dropped.
   */
  private pulseGeneration = 0;
  /** The count-in the plan now in force was laid out with. */
  private pulseCountInBars = 0;
  /**
   * Whether the run's clock is still to be taken from the pulse it restarted.
   *
   * A bar opened at a gate is begun by a key press, and a key press carries no
   * output latency - the note is under the reader's finger the instant they
   * play it. The click does carry it, and a little scheduling runway besides.
   * Anchor the bar to the press and the two disagree by that much for the
   * whole bar: every note read late, every mark drawn to the right of its
   * notehead, and a reader playing with the click told they are behind it.
   *
   * So the bar takes its clock from the first beat of the new pulse, which is
   * exactly how the count-in hands over to the music. His press still counts
   * as the downbeat - it is what asked for this beat - but what the bar is
   * *measured* by is the beat everybody can hear.
   */
  private anchorOnTheNextTick = false;
  /** Bar lines this run has stopped at. @see PerformanceReport.waitedAtBars */
  private waitedAtBars: number[] = [];
  /** What the run did, written down for drawing. @see RunRoll */
  private readonly roller = new RollRecorder();
  /**
   * Whether the run's opening gate has been opened.
   *
   * The first gate is not a bar line: every run waits there, because that is
   * where the reader begins. Counting it would put a floor of one under a
   * number whose whole point is reaching nought.
   */
  private theFirstBarHasBegun = false;
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
  /**
   * When the last press this run took notice of was made.
   *
   * Corrected on the way in like every other moment a press carries, so it
   * is when the key went down rather than when the page heard about it.
   */
  private lastStruckAtMs: number | null = null;
  /**
   * The chord the reader started the run by playing, kept the same way.
   *
   * Apart from the count-in's presses because it is not one of them. A press
   * during the count-in raises a question - was that aimed at the first beat,
   * or was it noise? - and the early window is the answer to it. The opening
   * chord raises no question: it was matched against the notes the run was
   * about to ask for, with the reader's own tolerance, and starting the run
   * *is* the answer.
   */
  private theOpeningChord: MidiNoteOnEvent[] = [];
  /**
   * Whether the sustain pedal is down, as far as this run can tell.
   *
   * Kept rather than read off the roll, because the run may begin with it
   * already down and the roll only knows what it has been told. Seeded at the
   * start from what the controller heard while nothing was running, and
   * followed from there.
   */
  private pedalIsDown = false;
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

  /**
   * Writes down a beat that nothing of ours announced.
   *
   * In a frame that waits for the reader there is no pulse to hand beats out:
   * the beat they come in on is theirs to place, and the ones between their
   * entries are placed where they are written. Whoever places them is the only
   * thing that knows they happened, so it says so here - otherwise the picture
   * of such a run has no grid at all, which is what he found: "у wait for notes
   * все ще не малюється смужок".
   */
  writeDownAClick(atMs: number, weight: BeatWeight, positionTicks: number): boolean {
    if (this.status !== 'running') {
      return false;
    }
    // Refused where this beat is already down. The music's first beat is written
    // where a waiting run begins, and the reader's own entry places that same
    // beat again the moment they play it. Heard, that was the metronome clicking
    // twice; drawn, it was a bar line given nought milliseconds late, complete
    // with an empty section to show the waiting. His: "є якісь подвійні смужки
    // які і два рази грають метроном".
    if (this.roller.hasBeatAt(positionTicks, atMs)) {
      return false;
    }
    this.roller.beat(atMs, weight, positionTicks);
    return true;
  }

  /**
   * Writes down the reader arriving before the music did; see
   * {@link RollRecorder.rushed}.
   */
  writeDownARush(atMs: number, byMs: number): void {
    if (this.status !== 'running') {
      return;
    }
    this.roller.rushed(atMs, byMs);
  }

  /**
   * Takes back the clicks from a moment onwards; see
   * {@link RollRecorder.forgetBeatsFrom}.
   */
  forgetClicksFrom(atMs: number): void {
    if (this.status !== 'running') {
      return;
    }
    this.roller.forgetBeatsFrom(atMs);
  }

  /**
   * What the run did, for drawing rather than for scoring.
   *
   * Read at any time, including part way through: the roll is a copy of what
   * has happened so far, and a key still down is left open in it.
   */
  get roll(): RunRoll {
    return this.roller.roll();
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
  /**
   * Begins the run, optionally carrying presses that arrived before it.
   *
   * A run started *by* the reader playing the opening chord has already had
   * that chord played at it, and the session did not exist to hear it. Handed
   * over here, those presses go through the same path as any press that lands
   * just ahead of the first beat - they are held, then replayed with their
   * real timestamps and graded as early - so the reader does not have to play
   * the first chord twice.
   */
  start(opening: readonly MidiNoteOnEvent[] = [], pedalWasDown = false): void {
    const previous = this.machine.state;
    this.machine.dispatch('start');
    this.resetRunState();
    this.theOpeningChord = [...opening];
    this.pedalIsDown = pedalWasDown;

    // Silent from the first note onwards where the reader gives that beat:
    // the count-in still sounds, and nothing past it does until they play.
    //
    // Unless the beat has already been given. A run begun by playing arrives
    // with that chord in hand, so its first bar is earned before the pulse has
    // ticked once - and the click may have the bar from the start. Which is
    // the only way that downbeat can ever be heard now: the pulse is no longer
    // begun again when the gate opens, so its first tick *is* the downbeat,
    // and a tick already gone by cannot be unmuted afterwards. His: "тепер не
    // чути сильної долі взагалі".
    this.configureThePulse(undefined, this.clickIsGivenAtTheStart());

    this.subscriptions.push(this.midi.subscribe((event) => this.handleMidi(event)));
    this.subscriptions.push(this.metronome.onTick((tick) => this.handleTick(tick)));

    if (this.usesPulse()) {
      this.countInRemaining = Math.max(0, this.countInPulses());
      this.metronome.start();
      // Said after the pulse has been given its moment, not before: announcing
      // a run redraws the page that is watching it, and every millisecond of
      // that spent in front of the start is a millisecond of silence in front
      // of the music.
      this.emitStatus(previous);
      // The music begins on the pulse's first tick, always. It was begun on
      // the reader's own chord for a while, to get out from under an audio
      // context that took its time waking up - but that is a *guess* at where
      // the beat was, and a reader is meant to play with the metronome rather
      // than with an estimate of it. The device is kept awake instead, so
      // there is nothing to get out from under. His, and he is right about it.
      return;
    }

    this.emitStatus(previous);
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
    this.configureThePulse();
  }

  /**
   * How the pulse is set up, wherever it is set up.
   *
   * Read off `resumeAtTicks`, which is where the click is counting *from*:
   * the bars it accents, the tempos it takes and where it stops all follow
   * the place the run is picking up at. Written once because there are three
   * such places now - the start, a change of click mid-run, and the bar line
   * this mode holds at - and a pulse configured two ways out of three is a
   * click accenting a beat nobody is on.
   */
  private configureThePulse(
    countInBars = Math.max(0, this.options.countInBars),
    stopAtTicks?: number,
  ): void {
    // Remembered, because a pulse that is re-dressed while it runs has to be
    // given the same count-in it was laid out with: the plan's ticks are
    // counted from the front of it, and a different one would move every bar
    // and every tempo under a pulse that is not going to start again.
    this.pulseCountInBars = countInBars;
    this.metronome.configure({
      bpm: this.tempoBpm,
      timeSignature: this.timeline.exercise.timeSignature,
      bars: this.barsToBeat(countInBars),
      tempos: this.temposToBeat(countInBars),
      endsAtTicks: this.endOfTheMusic(countInBars, stopAtTicks),
      subdivisionsPerPulse: subdivisionsPerPulseFor(
        this.timeline,
        this.timeline.exercise.timeSignature,
        this.options.click,
      ),
      click: this.options.click,
      dropout: resolveDropout(this.clickForThePulse(), countInBars),
      silences: this.options.clickSilences,
      muted: clickIsSilent(this.clickForThePulse()),
    });
  }

  pause(): void {
    const wasCountingIn = this.machine.state === 'counting-in';
    if (!this.dispatch('pause')) {
      return;
    }
    this.pausedInCountIn = wasCountingIn;
    // Whatever the run was waiting for, the reader is no longer answering it.
    this.heldAtBarTicks = null;
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
    this.runStartedAt = this.clock.now() - this.elapsedTo(this.resumeAtTicks);

    if (this.usesPulse()) {
      this.metronome.start();
    }
    this.enterStep(this.resumeAtIndex);
  }

  /**
   * Whether the music is standing at a bar line waiting to be given its beat.
   *
   * Anything that would otherwise move with the clock has to ask: the step has
   * been entered, but the bar it opens has not begun.
   */
  get waitingAtTheBarLine(): boolean {
    return this.heldAtBarTicks !== null;
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
    return expectedFor(step, this.options.expectedStaff);
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
    // A mode that keeps no time asks nothing about simultaneity either.
    //
    // Reported from the page, and the comment above this was already saying
    // it: in Wait mode nothing is timing the reader. The window was applied
    // all the same, and 250 milliseconds is far less than it takes to find a
    // chord you are learning - so the second note restarted the attempt, the
    // first was forgotten, and a chord taken slowly could not be completed at
    // all. Which is the mode whose whole purpose is taking it slowly.
    const timed = this.mode.requiresMetronome;
    return rolled || !timed
      ? { ...this.options.matchPolicy, toleranceMs: Number.POSITIVE_INFINITY }
      : this.options.matchPolicy;
  }

  /** The bars the metronome beats through: the count-in, then the music. */
  /**
   * Clock time from the first note of the piece to a position in it.
   *
   * Never a multiplication, because a piece may change tempo: the answer is
   * walked over the stretches it is taken at. The run's own clock starts at
   * the piece's start even when the reader begins partway through, which is
   * what lets a passage resume without every onset after it moving.
   */
  private elapsedTo(ticks: number): number {
    return elapsedMsAt(this.timeline.exercise, ticks);
  }

  private barsToBeat(countInBars: number): readonly MetronomeBar[] {
    return metronomeBars(this.timeline.exercise, {
      countInBars,
      fromTicks: this.resumeAtTicks,
    });
  }

  /**
   * Where the run's last note stops, on the metronome's clock.
   *
   * `null` unless the pulse is what carries the music. It exists to stop the
   * click sounding one more downbeat after the last note - which is right
   * when the metronome and the music are the same clock, and wrong when they
   * are not. In Wait mode the music holds still until the reader plays, so a
   * one-bar passage may take twenty seconds, and an end read off the *clock*
   * silenced the click after one bar of it. The reader was left working
   * through the bar with nothing to keep time against, which is the opposite
   * of what asking for a click means.
   */
  private endOfTheMusic(countInBars: number, stopAtTicks?: number): number | null {
    if (!this.mode.requiresMetronome) {
      return null;
    }
    const last = this.timeline.at(this.lastIndex);
    if (last === null) {
      return null;
    }
    const runEnds = last.onsetTicks + last.durationTicks;
    return metronomeEnd(this.timeline.exercise, {
      countInBars,
      fromTicks: this.resumeAtTicks,
      untilTicks: stopAtTicks === undefined ? runEnds : Math.min(stopAtTicks, runEnds),
    });
  }

  /**
   * The tick the bar this step belongs to ends on.
   *
   * Read off the steps rather than counted from the metre: a piece that
   * changes metre has bars of different lengths from there on, and the
   * opening metre puts every bar line after the change in the wrong place.
   * The engraver has already decided where the bars are and every step says
   * which one it is in.
   */
  /**
   * How much of the piece the click may have before anything has been played.
   *
   * Nothing to say, for a frame that waits to be given its first beat and has
   * not been given it. The first bar, where the chord that begins the run is
   * already in hand. And the whole run for every other frame, which is what
   * `undefined` means here.
   */
  private clickIsGivenAtTheStart(): number | undefined {
    if (!this.mode.waitsForTheFirstBeat) {
      return undefined;
    }
    const first = this.timeline.at(this.resumeAtIndex);
    if (this.theOpeningChord.length === 0 || first === null) {
      return this.resumeAtTicks;
    }
    return this.barEndAfter(first);
  }

  private barEndAfter(step: TimelineStep): number {
    for (let index = step.index + 1; index < this.timeline.length; index += 1) {
      const next = this.timeline.at(index);
      if (next === null) {
        break;
      }
      if (next.measureIndex !== step.measureIndex) {
        return next.onsetTicks;
      }
    }
    return this.timeline.totalTicks;
  }

  private temposToBeat(countInBars: number): readonly MetronomeTempo[] {
    return metronomeTempos(this.timeline.exercise, {
      countInBars,
      fromTicks: this.resumeAtTicks,
    });
  }

  private countInPulses(): number {
    // The metre the music is about to begin in, which for a piece that
    // changes metre is not always the one it opened in - and a count-in in
    // the wrong metre is the worst possible way to arrive.
    const pulses = timeAtMeasure(
      this.timeline.exercise,
      this.timeline.at(this.resumeAtIndex)?.measureIndex ?? 0,
    ).pulsesPerMeasure;
    return Math.max(0, Math.round(this.options.countInBars * pulses));
  }

  /**
   * How the running pulse should sound, given who is placing the beat.
   *
   * A beat the reader places must not be clicked by the pulse as well: the
   * two fall a moment apart and are heard as one beat clicked twice, which
   * is exactly what he heard. The pulse may still be running for a reason of
   * its own - a count-in is asked for by its own setting - and the count-in
   * *is* the machine's to give, there being nothing of the reader's to
   * follow before the music has begun. So it clicks through that and then
   * falls silent, which is what "only the count-in" already means.
   */
  private clickForThePulse(): ClickWhen {
    return clickFollowsTheReader(this.options.clickWhen) && !this.mode.requiresMetronome
      ? 'count-in-only'
      : this.options.clickWhen;
  }

  private usesPulse(): boolean {
    return this.thePulseGoesOn() || this.options.countInBars > 0;
  }

  /**
   * Whether the pulse has anything to do once the music itself has begun.
   *
   * The same question as {@link usesPulse} with the count-in taken out of it,
   * and the count-in is the one reason a pulse ever runs for a while and then
   * has no further part to play. What is left is the two reasons it has a part:
   * a mode whose loop rides on it, and a click the reader asked to go on
   * sounding whatever they do - which is a click they are measured against
   * rather than one that follows them.
   *
   * Where it is false the beats of the run are the reader's own, placed where
   * they play. Which is what decides whether they are written down, and is a
   * different question from whether they are heard.
   */
  private thePulseGoesOn(): boolean {
    return (
      this.mode.requiresMetronome ||
      // A click the reader places needs no pulse to place it - and starting
      // one would be the very thing they asked to be rid of, a machine
      // counting on through music that is waiting for them.
      (!clickIsSilent(this.options.clickWhen) &&
        !clickFollowsTheReader(this.options.clickWhen))
    );
  }

  /**
   * Whether the music of this run moves with the reader rather than with a pulse.
   *
   * The one question the picture of a run is drawn from, and it is a property of
   * the *mode* alone: what the click is set to decides what is heard and nothing
   * else. His: "краще взагалі не залежати від метроному, а залежати від flow
   * самої гри... він має дивитись як йшла музика, та розуміти де були паузи".
   *
   * A pulse carries the music in Flow and, between its gates, in the frame that
   * holds at bar lines - there its ticks are where the music got to. In a frame
   * that waits on every note it carries nothing: it may be running because the
   * reader asked to hear a click that counts on regardless, and the music still
   * stands still until they play. Its ticks are then a thing to keep up with,
   * not a record of where the music reached.
   */
  get musicMovesWithTheReader(): boolean {
    return !this.mode.requiresMetronome;
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
    this.writtenAnchor = null;
    this.runStartedAt = 0;
    this.runBeganAt = 0;
    this.heldAtBarTicks = null;
    this.anchorOnTheNextTick = false;
    this.waitedAtBars = [];
    this.roller.reset();
    this.theFirstBarHasBegun = false;
    this.pulseGeneration = 0;
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
    this.theOpeningChord = [];
    this.lastStruckAtMs = null;
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
    this.runStartedAt = atMs - this.elapsedTo(this.resumeAtTicks);
    // The first time only: a run counted back in after a pause is the same
    // run, and the report asks how long the reader played rather than how
    // long since the last interruption.
    if (this.runBeganAt === 0) {
      this.runBeganAt = atMs;
    }
    this.positionOffsetTicks = tickPositionTicks - this.resumeAtTicks;
    this.writeDownTheFirstBeat(atMs);
    // And the foot, which may have been down since before there was a run to
    // put it in. See {@link RollRecorder.pedalWasAlreadyDown}.
    if (this.pedalIsDown) {
      this.roller.pedalWasAlreadyDown(atMs);
    }
    // And the pulse is let go of where it has nothing further to do. It was
    // told to fall *silent* after a count-in and never told to stop, so in a
    // frame that waits it went on counting the written bars to itself - unheard,
    // but written into the picture of the run all the same. Drawn, that is the
    // machine's grid laid over the reader's: two grids at once, their places
    // disagreeing and their moments interleaved, which is no picture of
    // anything. This tick is already in hand and is the music's first beat, so
    // nothing of the music is lost by stopping here.
    if (!this.thePulseGoesOn() && this.metronome.isRunning) {
      this.metronome.stop();
    }
    this.dispatch('countInComplete');
    this.mode.onSessionStart(this.context);
    this.enterStep(this.resumeAtIndex);
    this.replayPressesAimedAtTheFirstBeat(atMs);
  }

  /**
   * The beat the music begins on, where nothing else will give it one.
   *
   * A frame that waits with the click in the reader's hands runs no pulse at
   * all, so until they play their first note nothing about the run is written
   * down - and the time they spent getting to it, which is the thing such a
   * frame exists to show, was not in the picture at all. His: "якщо на самому
   * початку я натиснув старт - та гра вже почалась - то якщо я просто чекаю, то
   * весь цей час має просто замальовуватись жовтою секцією".
   *
   * Only where the music moves with the reader. Where a pulse carries it, its
   * first tick *is* the music's first beat and writing another would be a beat
   * drawn as a pair - which is the machinery for a bar line given late, and
   * would claim a wait that never happened.
   */
  private writeDownTheFirstBeat(atMs: number): void {
    if (!this.musicMovesWithTheReader) {
      return;
    }
    // A beat of the music whatever the click has to say about it: a run that
    // begins between the clicks the reader chose still begins somewhere, and
    // without it there is nothing for their first entry to be measured against.
    const here = beatAt(this.timeline.exercise, this.resumeAtTicks, this.options.click);
    this.roller.beat(atMs, here?.weight ?? 'division', this.resumeAtTicks);
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
    const opening = this.theOpeningChord;
    const held = this.beforeTheMusic;
    this.theOpeningChord = [];
    this.beforeTheMusic = [];
    if (this.status !== 'running') {
      return;
    }
    // Whatever the clock says about it. A press carries the moment the key
    // went down, and the page hears about it later - by the hop from the
    // bridge, and by however much the two machines disagree about the time.
    // Weighed against the early window, the chord that had just started the
    // run was thrown out for being too old, and the run then asked the reader
    // to play it a second time. There is nothing to weigh: this chord was
    // matched against the notes the run begins with before the run existed.
    //
    // Corrected here, because these are the only presses that did not come
    // through the door where that is done - the run had no ears yet when they
    // were played.
    for (const event of opening) {
      const struck = this.struckAt(event);
      // Written down as well as judged, and written first so the verdict has a
      // press to attach itself to - the same order the ordinary door uses. These
      // are the only presses of a run that never came through it: the run did
      // not exist when they were played, so nothing recorded them, and the
      // chord the reader *began* with was missing from the picture of the run
      // it began. His: "є інша бага при стартових нотах: їх просто нема у MIDI
      // viewer коли я починаю гру".
      this.roller.keyDown(struck);
      this.mode.onNoteOn(this.context, struck);
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
    // Ornaments printed here are handed over too: on the page, so playing one
    // is reading correctly, and the performer's to add, so nothing waits for
    // it. Whichever hand it belongs to - a note the reader can see is a note
    // they may play.
    this.matcher =
      expected.length > 0
        ? new ChordMatcher(expected, this.policyFor(step), step.ornamentMidi)
        : null;
    this.stepEnteredAt = this.clock.now();
    this.stepDeviationMs = null;
    this.stepWrongNotes = [];

    // Before the step is announced to anything. A gate is part of what this
    // step *is*, and something told about the step without it - the
    // accompaniment above all - acts on a beat that has not been given.
    const hold = this.mode.holdsAt(this.context, step);
    if (hold !== null) {
      this.holdForTheBar(hold);
    }

    this.emitter.emit('stepEntered', { step, expectedMidi: expected });
    this.publishPosition(step.onsetTicks);
    this.mode.onStepEntered(this.context, step);
  }

  /**
   * Silences the pulse at a bar line the reader has not reached.
   *
   * The bar's written time is up and the cursor is still inside it, so the
   * click has nothing true left to say: counting on would put beats over
   * music nobody has played. It stops, and the reader finishes the bar in
   * silence - late, and marked late, because the wait buys the *next* bar
   * rather than this one.
   */
  private holdForTheBar(untilTicks: number): void {
    if (this.status !== 'running' || this.heldAtBarTicks !== null) {
      return;
    }
    this.heldAtBarTicks = untilTicks;
    // The pulse is not stopped here. A gate can be closed and opened again
    // inside one tick - the reader's press was waiting for this beat, or the
    // chord that began the run is replayed the instant the run exists - and
    // stopping a pulse only to start it again costs a whole scheduling lead
    // twice over, which is a tenth of a second of silence between the key and
    // the downbeat. His, and he could hear it. So the stopping waits until the
    // end of the tick, by which time a gate that was never really a wait has
    // opened again and nothing has to happen at all.
  }

  /**
   * Stops the pulse for a gate that is still standing, the tick being over.
   *
   * Also where a bar is counted as waited at: a gate opened before the pulse
   * ever stopped held nobody up, and a number meant to say how often the music
   * had to wait must not count it.
   */
  private holdIfStillWaiting(): void {
    if (this.heldAtBarTicks === null || !this.metronome.isRunning) {
      return;
    }
    const waitingAt = this.currentStep?.measureIndex;
    if (this.theFirstBarHasBegun && waitingAt !== undefined) {
      this.waitedAtBars.push(waitingAt);
    }
    this.metronome.stop();
  }

  /**
   * Starts a held bar, in tempo, with this press as its downbeat.
   *
   * The same two numbers a resume uses, for the same reason: the pulse begins
   * counting from nought again, so the offset says where in the piece that
   * nought is, and the run's origin is moved back by however much of the
   * piece is already behind. Everything downstream - the scheduled onsets,
   * the accompaniment, the position published - goes on counting from the
   * start of the piece as though nothing had happened.
   *
   * Two things this got wrong when he first played it. The bar began the
   * moment the *previous* one was finished, so the downbeat landed on the
   * last note of the old bar and there was nowhere to move to; it is the
   * press that starts the new bar instead. And the pulse was set up again
   * with the count-in still in it, so the restart spent a whole bar beating
   * the count while the run read those beats as music - the click ran on
   * without him, sounded a downbeat he had not played, and left the wait a
   * bar out of place. There is nobody to count in partway through a piece.
   */
  private startTheHeldBarAt(atMs: number): void {
    const line = this.heldAtBarTicks;
    const step = this.currentStep;
    if (line === null || step === null || step.onsetTicks < line) {
      return;
    }
    this.heldAtBarTicks = null;
    if (this.metronome.isRunning) {
      // Nothing ever stopped, so nothing has to start: the pulse is already
      // this bar's, counting from where it always was. Beginning it again
      // would only put a scheduling lead of silence between the reader's key
      // and the downbeat it asked for.
      //
      // It is still handed the bar, though. The click has nothing to say past
      // the end of the bar it has been given - that is how a downbeat nobody
      // played is kept quiet - so a gate that opened without stopping and
      // without saying this left the click mute for the whole run, until some
      // later gate did stop and say it. Which is exactly what he heard: no
      // metronome at the start, and sometimes one arriving at the second bar.
      this.configureThePulse(this.pulseCountInBars, this.barEndAfter(step));
      this.theFirstBarHasBegun = true;
      this.emitter.emit('barBegan', { stepIndex: step.index, atMs });
      return;
    }
    this.theFirstBarHasBegun = true;
    this.resumeAtTicks = step.onsetTicks;
    this.resumeAtIndex = step.index;
    this.positionOffsetTicks = -step.onsetTicks;
    this.runStartedAt = atMs - this.elapsedTo(step.onsetTicks);
    if (this.usesPulse()) {
      // Set up again before it starts: the bars it accents are counted from
      // where the run is picking up, there is no count-in, and the click is
      // given this bar and no more of the piece.
      //
      // That last one is his: "може сильну долю без мене не грати?". The tick
      // that crosses a bar line *is* the next downbeat, and it is heard before
      // the run has been told about it - a look-ahead scheduler has committed
      // the sound a tenth of a second earlier - so stopping the pulse when the
      // gate closes cannot unsound it. Told where the bar ends, the click
      // simply has nothing to say there, and the downbeat the reader hears is
      // the one their own press starts.
      this.configureThePulse(0, this.barEndAfter(step));
      this.pulseGeneration += 1;
      this.anchorOnTheNextTick = true;
      this.metronome.start();
    }
    this.emitter.emit('barBegan', { stepIndex: step.index, atMs });
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
    // Finished by a press where there was one, and otherwise by the run
    // walking through: a step of rests is nobody's doing.
    const finishedAt =
      result.status === 'skipped' ? this.clock.now() : (this.lastStruckAtMs ?? this.clock.now());
    // A step the reader played is where the written clock now stands. A step
    // that was nobody's to play moves nothing: the music went past it in
    // written time, which is what the anchor already says.
    if (result.status !== 'skipped') {
      this.writtenAnchor = { wallMs: finishedAt, ticks: step.onsetTicks };
    }
    this.emitter.emit('stepCompleted', { result, atMs: finishedAt });

    if (step.index >= this.lastIndex) {
      this.finish();
      return;
    }
    this.enterStep(step.index + 1);
  }

  /**
   * Whether a press is the reader moving on rather than a wrong note.
   *
   * One beat and no further, which is the rule the late presses already
   * follow: the note says which beat was meant, and a note two beats off is a
   * reader who has lost their place rather than one who is ahead. The beat
   * left behind is finished the ordinary way, so it comes out `missed` - the
   * music went past it, which here is exactly what happened.
   */
  private movesOnTo(midi: number): boolean {
    const step = this.currentStep;
    if (this.options.playingAhead !== 'moves-on' || step === null) {
      return false;
    }
    // Printed here, ornament or not, is not ahead: the other hand's note of
    // this beat is this beat's, and a grace note is offered rather than asked
    // for.
    if (step.expectedMidi.includes(midi) || step.ornamentMidi.includes(midi)) {
      return false;
    }
    if (step.index >= this.lastIndex) {
      return false;
    }
    const next = this.timeline.at(step.index + 1);
    return next !== null && this.expectedAt(next).includes(midi);
  }

  /**
   * When the current step is written to arrive, in clock time.
   *
   * The written distance from the last step the reader played, laid off from
   * the moment they played it - `spanMs`, so a written change of speed is
   * honoured and the answer is never a multiplication.
   */
  private stepDueAtMs(): number | null {
    const anchor = this.writtenAnchor;
    const step = this.currentStep;
    if (anchor === null || step === null) {
      return null;
    }
    return anchor.wallMs + spanMs(this.timeline.exercise, anchor.ticks, step.onsetTicks);
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
      startedAtMs: this.runBeganAt,
      endedAtMs: this.clock.now(),
      completed,
      playableSteps: this.timeline.steps.filter((step) => this.expectedAt(step).length > 0)
        .length,
      waitedAtBars: [...this.waitedAtBars],
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
        this.roller.keyDown(event);
      }
      // Taken down here too, so a key struck during the count and let go of
      // before the music starts is drawn as the short note it was rather than
      // as one still held.
      if (event.type === 'noteoff') {
        this.roller.keyUp(event);
      }
      // The foot is followed but not written down: a pedal put down over the
      // count is part of how the run *begins*, and the run begins where the
      // music does.
      if (event.type === 'pedal') {
        this.pedalIsDown = event.down;
      }
      return;
    }
    if (this.status !== 'running') {
      return;
    }
    switch (event.type) {
      case 'noteon':
        this.lastStruckAtMs = event.timestampMs;
        // Before it is judged, so the verdict has a press to attach itself to.
        this.roller.keyDown(event);
        this.mode.onNoteOn(this.context, event);
        return;
      case 'noteoff':
        this.roller.keyUp(event);
        this.mode.onNoteOff(this.context, event);
        return;
      case 'pedal':
        // The pedal changes how the instrument sounds, never what was played,
        // so the run still has nothing to say about it - but it is part of
        // what the reader did, and the picture of a run shows it.
        this.pedalIsDown = event.down;
        this.roller.pedal(event);
        return;
      default:
        return;
    }
  }

  private handleTick(tick: MetronomeTick): void {
    const pulse = this.pulseGeneration;
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

    // A tick from a pulse that has since been restarted, which is not a late
    // tick but a wrong one. It happens on the very tick that ends the
    // count-in: the mode opens its first gate there, a chord played exactly on
    // the beat arrives with it and opens that gate again, and the pulse is
    // begun anew - so this tick, still carrying the count-in's own position,
    // would be read through the new mapping and reported as a whole bar of
    // music nobody had played. His: "самий перший бар, якщо я точно влучу у
    // перші ноти - то чомусь я одразу стрибаю на наступний бар".
    if (this.status !== 'running' || this.pulseGeneration !== pulse) {
      return;
    }
    if (this.anchorOnTheNextTick) {
      // The same arithmetic `beginRunning` does, and for the same reason: this
      // tick is the music at `resumeAtTicks`, and its stamp is the moment it
      // is *heard*. Everything the bar is judged by follows from here.
      this.anchorOnTheNextTick = false;
      this.runStartedAt = tick.scheduledTimeMs - this.elapsedTo(this.resumeAtTicks);
    }
    // Only the ticks the run acts on, and only where the pulse is what carries
    // the music. A tick from a superseded pulse would put a line on the grid
    // where no click was heard, and the count-in's own clicks are before the
    // music the grid is of.
    //
    // Where the music waits on every note the pulse carries nothing: it may be
    // running because the reader asked for a click that counts on whatever they
    // do, and the music stands still until they play regardless. Written down,
    // those ticks were the machine's own grid drawn over the reader's - measured
    // on a run taken at a third of the written speed, the notes asked for sat in
    // the first four seconds and the notes played ran to twelve.
    if (!this.musicMovesWithTheReader) {
      this.roller.beat(
        tick.scheduledTimeMs,
        tick.isDownbeat ? 'downbeat' : tick.isPulse ? 'beat' : 'division',
        tick.positionTicks - this.positionOffsetTicks,
      );
    }
    this.emitter.emit('beat', tick);
    this.mode.onBeat(this.context, tick);
    this.publishPulsePosition(tick);
    // Last, because everything above can open a gate that was closed in it.
    this.holdIfStillWaiting();
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
    // Off the bar lines, not by dividing: a piece that changes metre has bars
    // of different lengths from there on, and the opening metre puts every
    // position after the change in the wrong bar.
    this.emitter.emit('positionChanged', positionOfTick(this.timeline.exercise, ticks));
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

    // A rushed press is the right note, so it counts against the step
    // without being a wrong note on the page or in the log: one ledger of
    // what was held against this step, and the verdict says which it was.
    if (verdict === 'wrong' || verdict === 'rushed') {
      this.stepWrongNotes.push(midi);
    }
    if ((verdict === 'correct' || verdict === 'rushed') && this.stepDeviationMs === null) {
      this.stepDeviationMs = deviationMs;
    }
    const judged: NoteJudgedEvent = {
      midi,
      verdict,
      // Drawn on the note it was owed to, not on the one that happened to be
      // open: the mark says which note was played, and this one was that.
      stepIndex: owed === null ? this.stepIndex : owed.index,
      deviationMs: owed === null ? deviationMs : this.lateBy(owed, deviationMs),
      remaining: this.matcher?.remaining ?? [],
    };
    // Written down and announced from one object, so the picture of the run
    // and the marks on the page cannot come to different conclusions.
    this.roller.judged(judged);
    this.emitter.emit('noteJudged', judged);
  }

  /** How late against the step it was owed to, rather than the one now open. */
  private lateBy(owed: StepResult, deviationMs: number | null): number | null {
    const from = this.timeline.at(owed.index);
    const now = this.currentStep;
    if (deviationMs === null || from === null || now === null) {
      return deviationMs;
    }
    return deviationMs + spanMs(this.timeline.exercise, from.onsetTicks, now.onsetTicks);
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
      get stepDueAtMs() {
        return session.stepDueAtMs();
      },
      get runStartedAtMs() {
        return session.runStartedAt;
      },
      get holdingAtBarLine() {
        return session.heldAtBarTicks !== null;
      },
      movesOnTo: (midi: number) => session.movesOnTo(midi),
      positionTicks: (tick: MetronomeTick) => tick.positionTicks - session.positionOffsetTicks,
      scheduledTimeMs: (ticks: number) => session.runStartedAt + session.elapsedTo(ticks),
      judgeNote: (midi: number, verdict: NoteVerdict, deviationMs: number | null) => {
        session.judgeNote(midi, verdict, deviationMs);
      },
      holdForTheBar: (untilTicks: number) => {
        session.holdForTheBar(untilTicks);
      },
      startTheHeldBarAt: (atMs: number) => {
        session.startTheHeldBarAt(atMs);
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

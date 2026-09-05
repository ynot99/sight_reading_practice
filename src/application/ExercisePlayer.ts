
import { pedalSpans, positionOfTick, spanMs } from '../domain/model/Exercise.js';
import type { ExerciseTimeline } from '../domain/timeline/Timeline.js';
import type { PositionEvent } from './session/SessionEvents.js';
import { TypedEventEmitter, type IEventSource, type Unsubscribe } from '../shared/EventEmitter.js';
import {
  clickIsSilent,
  resolveDropout,
  type ClickPattern,
  type ClickWhen,
  type IMetronome,
  type MetronomeConfig,
  type MetronomeTick,
} from './ports/IMetronome.js';
import type { IPitchPlayer } from './ports/IPitchPlayer.js';
import type { IScoreCursor } from './ports/IScoreRenderer.js';
import {
  laidEndToEnd,
  metronomeBars,
  metronomeTempos,
  subdivisionsPerPulseFor,
} from './session/metronomePlan.js';

/** Which hands to sound. `null` is both. */
export type ListeningHand = number | null;

export interface ListeningOptions {
  /** Staff to sound alone, or `null` for the whole texture. */
  readonly staffNumber: ListeningHand;
  /** Keep the pulse audible under the music. */
  /**
   * How much of the run the click sounds for.
   *
   * A performance has no count-in, so "only the count-in" means silence
   * throughout - which is what a dropout counted from bar zero already says.
   * Passing a plain yes-or-no lost that, and the click played through a
   * playback for a reader who had asked to hear it only while being counted
   * in.
   */
  readonly clickWhen: ClickWhen;
  /**
   * How much of the pulse is sounded.
   *
   * The reader's own choice, as a run takes it. Fixed at the felt beat here,
   * a performance clicked in crotchets to somebody who had asked for the
   * half-beats - and the setting looked broken rather than unimplemented,
   * because the same button worked perfectly the moment they pressed Start.
   */
  readonly click: ClickPattern;
  /**
   * The stretch to play, as the first and last step of it.
   *
   * The whole piece when left out. A reader who has chosen a passage, or put
   * their place somewhere by hand, means it for hearing the music as much as
   * for playing it - a playback that always began at bar one made them listen
   * through everything they were not working on.
   */
  readonly fromIndex?: number;
  readonly toIndex?: number;
  /**
   * Play the stretch round again when it ends, without stopping.
   *
   * Round again *inside* one performance rather than by starting another.
   * Stopping and starting re-anchors the metronome to the audio clock a fixed
   * lead ahead of now, and everything the restart does first is silence added
   * in front of the music - which a reader tapping along hears as a repeat
   * that comes in late.
   */
  readonly repeat?: boolean;
  /**
   * The step a repeat goes back to, when that is not where this began.
   *
   * A performance picked up after a pause starts where the reader stopped,
   * and the *lap* is still the passage. Told only where it began, a pause
   * halfway through a bar being looped shortened the loop to that half bar -
   * the reader heard the second half of the bar over and over.
   */
  readonly loopFromIndex?: number;
}

export interface ExercisePlayerDependencies {
  readonly metronome: IMetronome;
  readonly instrument: IPitchPlayer;
  readonly cursor: IScoreCursor;
  /** How far ahead notes are handed to the instrument, in milliseconds. */
  readonly horizonMs?: number;
}

export interface PlayerEventMap {
  started: Record<string, never>;
  finished: Record<string, never>;
  /**
   * Where the music has reached, as the bar and beat a reader would say.
   *
   * The same event a run publishes, because it answers the same question and
   * the page has one place to put the answer. Only a run published it, so the
   * pill went blank the moment the machine took over the playing - which is
   * exactly when a reader following along wants to know where they are.
   */
  positionChanged: PositionEvent;
  /**
   * The performance has reached a step of the music, and when.
   *
   * Where {@link positionChanged} says the bar and beat a reader would name,
   * this says the moment and the place in divisions - which is what anything
   * drawing *on* the page needs, and what a bar and a beat cannot be turned
   * back into. The moment is the pulse's own, so it is the same clock the
   * notes were scheduled against rather than whenever this was delivered.
   */
  stepReached: {
    readonly stepIndex: number;
    readonly ticks: number;
    readonly atMs: number;
  };
}

/** One note the player still has to start and stop. */
interface ScheduledNote {
  readonly midi: number;
  readonly atMs: number;
  readonly untilMs: number;
}

const DEFAULT_HORIZON_MS = 250;

/**
 * How many laps of a repeating passage the plan is written out for at a time.
 *
 * A bounded number, re-based as the pulse catches up: an unbounded one is not
 * available, since the plan is a list. Sixty-four readings of the same bars is
 * most of an hour on anything short, so the re-basing is rare enough to be a
 * safeguard rather than a mechanism.
 */
const PLANNED_LAPS = 64;
const LISTENING_VELOCITY = 0.7;

/**
 * Delay between consecutive notes of a rolled chord.
 *
 * A hand rolls a chord in roughly the time it takes to say it - fast enough
 * to be one gesture, slow enough that the notes are separately heard. Below
 * about 25 ms it is a flam rather than an arpeggio; above about 60 it is a
 * broken chord the writer would have notated as one.
 */
const ROLL_STEP_MS = 38;

/**
 * How much of a step a roll may occupy.
 *
 * Without a cap the same 38 ms per note that sounds right at 60 bpm runs a
 * five-note chord into the one after it at 160. Half the step keeps the roll
 * inside the beat it belongs to, whatever the tempo.
 */
const ROLL_SHARE_OF_STEP = 0.5;

/**
 * When each note of a rolled chord sounds, relative to the chord's onset.
 *
 * The roll *starts* on the beat rather than arriving on it: the cursor is at
 * that step and the click sounds there, so a roll that finished on the beat
 * would leave the lowest note - the one carrying the harmony - audibly early
 * against both. Notes are already sorted low to high, which is the direction
 * a hand rolls unless told otherwise.
 */
function rollOffsets(rolled: number, stepMs: number): number[] {
  if (rolled <= 1) {
    return [0];
  }
  const perNote = Math.min(ROLL_STEP_MS, (stepMs * ROLL_SHARE_OF_STEP) / (rolled - 1));
  return Array.from({ length: rolled }, (_, at) => at * perNote);
}

/**
 * Plays an exercise through, so the reader can hear it rather than read it.
 *
 * Deliberately not a practice mode: a mode exists to judge input, and this
 * judges nothing. What it shares with Flow mode is the pulse - the metronome
 * drives it, so no timer ever enters the application layer and a whole
 * playback can be replayed in a test in microseconds.
 *
 * Notes are handed to the instrument *ahead* of when they should sound. A tick
 * arrives up to a scheduler interval after the moment it stands for, which is
 * inaudible in a click and plainly uneven in a melody, so the sound is placed
 * on the audio clock while the cursor moves on the tick that is actually due.
 */
export class ExercisePlayer {
  private readonly deps: ExercisePlayerDependencies;
  private readonly emitter = new TypedEventEmitter<PlayerEventMap>();

  private timeline: ExerciseTimeline | null = null;
  private subscription: Unsubscribe | null = null;
  private startedAtMs: number | null = null;
  private pending: ScheduledNote[] = [];
  private nextToSchedule = 0;
  /** The stretch being played, in the timeline's own ticks. */
  private fromTicks = 0;
  private untilTicks = 0;
  private playing = false;
  /** The step the music has reached, which is where a pause holds. */
  private atIndex = 0;
  /**
   * The step last announced as reached, or nothing before the first tick.
   *
   * Its own field rather than {@link atIndex}, which starts *at* the step the
   * performance begins on - that is where a pause would hold, and the same
   * number cannot also mean "already announced" without the opening step
   * going unannounced.
   */
  private announcedIndex: number | null = null;
  /**
   * Where a pause left off, or `null` when nothing is being held.
   *
   * A step and not a tick, for the reason a run's pause is: picking up
   * partway through a note would sound its tail without its beginning, and
   * the reader following the marker would see it land somewhere no note
   * starts.
   */
  private pausedAtIndex: number | null = null;
  /** Whether the stretch plays round again, and the shape of one round. */
  private looping = false;
  /**
   * Whether the performance is *laid out* in laps, which outlives the repeat.
   *
   * Turning the repeat off means "let this reading be the last", not "stop":
   * the pulse goes on counting through the lap it is in, on the plan it was
   * given, and everything that reads its position - which lap, which note,
   * which bar of the click - has to go on reading it the same way until that
   * lap is over. Asked `looping` instead they all changed their mind at
   * once, and the music stopped where it stood: the position was read as a
   * distance from the top of a piece it had gone round twice, which is past
   * every end there is.
   */
  private laidInLaps = false;
  /** Where a lap begins, which is the passage rather than where this did. */
  private loopFromTicks = 0;
  private lapTicks = 0;
  private lapMs = 0;
  /** The first time round, which is short when the music was picked up late. */
  private firstLapTicks = 0;
  private firstLapMs = 0;
  /** The lap's own notes, timed from the lap's start rather than from here. */
  private lapNotes: ScheduledNote[] = [];
  private lapsDone = 0;
  /**
   * The furthest moment already handed to the instrument.
   *
   * Kept in time rather than as a count, because a count means nothing once
   * the list it counts into has been rebuilt - and it is rebuilt whenever the
   * reader moves a passage marker while the music plays.
   */
  private scheduledThroughMs = Number.NEGATIVE_INFINITY;
  private click: ClickPattern = 'pulse';
  private clickWhen: ClickWhen = 'never';
  private hand: ListeningHand = null;
  /** Last bar and beat announced, so an unchanged one is not announced again. */
  private publishedPosition: PositionEvent | null = null;

  /** Where the stretch ends, in the timeline's own ticks. */
  private endOf(toIndex: number | undefined): number {
    const timeline = this.timeline;
    if (timeline === null) {
      return 0;
    }
    const last = timeline.at(
      Math.min(timeline.length - 1, Math.round(toIndex ?? timeline.length - 1)),
    );
    return last === null ? timeline.totalTicks : last.onsetTicks + last.durationTicks;
  }

  /**
   * Moves the end of a performance while it is playing.
   *
   * A reader who clears the passage mid-playback means it now, and the notes
   * they have just given back have to be heard - the stretch was read once at
   * the start and never again, so clearing it changed nothing until the
   * performance was stopped and started. Where it *began* is left alone: that
   * is where this performance's clock reads nought, and moving it would move
   * every note already scheduled.
   */
  retarget(toIndex: number | undefined): void {
    if (!this.playing || this.timeline === null) {
      return;
    }
    const until = this.endOf(toIndex);
    if (until === this.untilTicks) {
      return;
    }
    this.untilTicks = until;
    // A lap is a different length now, in ticks and in time both.
    this.lapTicks = Math.max(0, this.untilTicks - this.loopFromTicks);
    this.lapMs = spanMs(this.timeline.exercise, this.loopFromTicks, this.untilTicks);
    this.firstLapTicks = Math.max(0, this.untilTicks - this.fromTicks);
    this.firstLapMs = spanMs(this.timeline.exercise, this.fromTicks, this.untilTicks);
    // Collected again, because the notes past the old end were never gathered
    // - the walk skips anything outside the stretch. Everything before it is
    // gathered identically and in the same order, so what has already been
    // handed to the instrument stays handed over exactly once.
    this.pending = this.collectNotes(this.timeline, this.hand, this.fromTicks);
    this.lapNotes =
      this.laidInLaps && this.loopFromTicks !== this.fromTicks
        ? this.collectNotes(this.timeline, this.hand, this.loopFromTicks)
        : this.pending;
    this.catchUpSchedule();
    this.applyClick(this.click, this.clickWhen);
  }

  /**
   * Puts the scheduler back where it was, in a list that has just changed.
   *
   * Carried over as a count, it meant nothing: the count runs on across laps
   * while a passage repeats, so clamping it to the length of the new list -
   * which is what used to happen - landed it partway through some earlier
   * lap. Every note from there to the horizon was then handed to the
   * instrument with a moment already long past, and an instrument asked to
   * play at a moment gone by plays at once. Moving a marker mid-performance
   * fired a whole lap of notes in one chord.
   *
   * Asked in time instead: the first note whose moment is later than the
   * furthest already scheduled. Each moment is handed over at most once, and
   * never into the past.
   */
  private catchUpSchedule(): void {
    if (this.startedAtMs === null) {
      this.nextToSchedule = 0;
      return;
    }
    const since = this.scheduledThroughMs - this.startedAtMs;
    let at = 0;
    // Walked rather than divided into, because the first time round is a
    // different length from the ones after it. It runs to the moment already
    // scheduled and no further, which is bounded by what has been heard.
    for (;;) {
      const note = this.noteAt(at);
      if (note === null || note.atMs > since) {
        break;
      }
      at += 1;
    }
    this.nextToSchedule = at;
  }

  /** Changes what is heard over a performance, without interrupting it. */
  applyClick(click: ClickPattern, clickWhen: ClickWhen): void {
    if (!this.playing || this.timeline === null) {
      return;
    }
    this.click = click;
    this.clickWhen = clickWhen;
    // The whole plan again, from the lap the pulse is on. Built inline here
    // once, it quietly undid the repeat: a reader who changed the click
    // mid-performance got a plan with the piece's own continuation in it and
    // an end to stop at, so the passage stopped going round.
    this.deps.metronome.configure(this.planFrom(this.lapsDone));
  }

  constructor(dependencies: ExercisePlayerDependencies) {
    this.deps = dependencies;
  }

  get events(): IEventSource<PlayerEventMap> {
    return this.emitter.asSource();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Where a held performance would pick up, or `null` if none is held. */
  get pausedAt(): number | null {
    return this.playing ? null : this.pausedAtIndex;
  }

  /**
   * Holds the performance where it is, rather than ending it.
   *
   * The sound stops the way it does on any stop - what is already on the
   * audio clock rings out and what is still held is silenced - but the step
   * is kept, so pressing the button again picks the music up rather than
   * starting it over. Which is what the button had always looked like it
   * would do: it is the same button that started the playback, and pressing
   * a play button again does not mean "back to the top".
   *
   * Nothing else is remembered. What to play, how fast, with what click and
   * how much of it are read from the reader's settings again on the way back
   * in, so a passage or a click changed during the pause takes effect.
   */
  pause(): void {
    if (!this.playing) {
      return;
    }
    const at = this.atIndex;
    this.stop();
    this.pausedAtIndex = at;
  }

  /** Ends the performance for good, whether it was playing or held. */
  end(): void {
    this.stop();
    this.pausedAtIndex = null;
  }

  start(timeline: ExerciseTimeline, options: ListeningOptions): void {
    this.stop();
    if (timeline.length === 0) {
      return;
    }

    this.timeline = timeline;
    this.click = options.click;
    this.clickWhen = options.clickWhen;
    this.hand = options.staffNumber;
    this.publishedPosition = null;
    const first = timeline.at(Math.max(0, Math.round(options.fromIndex ?? 0)));
    this.fromTicks = first?.onsetTicks ?? 0;
    this.atIndex = first?.index ?? 0;
    this.announcedIndex = null;
    // Whatever was being held, this is now what is happening instead.
    this.pausedAtIndex = null;
    this.untilTicks = this.endOf(options.toIndex);
    this.pending = [];
    this.nextToSchedule = 0;
    this.scheduledThroughMs = Number.NEGATIVE_INFINITY;
    this.startedAtMs = null;
    this.playing = true;
    this.looping = options.repeat === true;
    const lapStart = timeline.at(
      Math.max(0, Math.round(options.loopFromIndex ?? options.fromIndex ?? 0)),
    );
    // Never past where the music actually began: a lap that started after the
    // first note would leave the opening of it unheard for ever.
    this.loopFromTicks = Math.min(lapStart?.onsetTicks ?? this.fromTicks, this.fromTicks);
    this.lapTicks = Math.max(0, this.untilTicks - this.loopFromTicks);
    this.firstLapTicks = Math.max(0, this.untilTicks - this.fromTicks);
    // Read off the tempo spans rather than multiplied: a lap that changes
    // tempo partway is not its length in ticks times one bpm.
    this.lapMs = spanMs(timeline.exercise, this.loopFromTicks, this.untilTicks);
    this.firstLapMs = spanMs(timeline.exercise, this.fromTicks, this.untilTicks);
    this.lapsDone = 0;
    this.laidInLaps = this.looping;

    this.deps.metronome.configure(this.planFrom(0));

    this.subscription = this.deps.metronome.onTick((tick) => this.handleTick(tick));
    // The clock first, and everything that takes time after it.
    //
    // Starting the metronome is what anchors the performance to the audio
    // clock: its first tick is placed a fixed moment ahead of *now*, so every
    // millisecond spent before this call is a millisecond of silence added in
    // front of the music. Gathering the notes walks the whole timeline and
    // moving the marker walks the engraver's cursor from wherever it stood -
    // on a long piece with the passage well into it, that was most of the gap
    // a reader tapping along could hear on a repeat.
    //
    // Nothing is missed by doing them after: the first tick is not delivered
    // until it is due, which is that fixed moment away, and both of these
    // finish long before it.
    this.deps.metronome.start();
    this.pending = this.collectNotes(timeline, options.staffNumber, this.fromTicks);
    // The lap's own notes, when a lap is not simply this performance again:
    // picked up after a pause, the first time round is the tail of a lap and
    // every one after it is the whole thing.
    this.lapNotes =
      this.laidInLaps && this.loopFromTicks !== this.fromTicks
        ? this.collectNotes(timeline, options.staffNumber, this.loopFromTicks)
        : this.pending;
    this.deps.cursor.moveTo(first?.index ?? 0);
    this.emitter.emit('started', {});
  }

  /**
   * The metronome's whole plan, from a given lap onwards.
   *
   * Laid end to end when the stretch plays round again, because the metronome
   * reads its bars and its tempos off a clock that only ever goes forward.
   * What follows the passage in the *piece* is not what comes next when it
   * plays again, so only the passage's own bars are tiled - left in, two 4/4
   * bars followed by one of 3/4 were accented as 3/4 on the second reading.
   *
   * Enough laps to keep the plan ahead of the pulse for a long stretch of
   * practice, and re-based when the pulse catches up with it. Past the last
   * bar the metronome repeats the last metre, so running off the end is
   * never silence - it is only, eventually, wrong.
   */
  private planFrom(lap: number): MetronomeConfig {
    const timeline = this.timeline;
    if (timeline === null) {
      throw new Error('A plan needs music.');
    }
    const timeSignature = timeline.exercise.timeSignature;
    // No count-in in front of a playback, and it starts wherever the reader
    // put their place.
    const of = { countInBars: 0, fromTicks: this.fromTicks };
    const bars = metronomeBars(timeline.exercise, of);
    const tempos = metronomeTempos(timeline.exercise, of);
    // The lap's own plan, for every time round after the first. Picked up
    // mid-lap the two differ: the first time round is the tail of a lap and
    // is beaten from where the music actually began, and every one after it
    // is the whole lap beaten from the lap's own start.
    const round = { countInBars: 0, fromTicks: this.loopFromTicks };
    const lapBars = metronomeBars(timeline.exercise, round);
    const lapTempos = metronomeTempos(timeline.exercise, round);
    return {
      bpm: timeline.exercise.tempoBpm,
      timeSignature,
      // Counted among the *loop's* laps, of which the first time round is
      // not one: it is the tail that got the music to the loop.
      bars: this.laidInLaps ? this.roundAndRound(bars, lapBars, Math.max(0, lap - 1)) : bars,
      tempos: this.laidInLaps
        ? this.roundAndRound(tempos, lapTempos, Math.max(0, lap - 1))
        : tempos,
      // Nothing to end at while it goes round: the end of a lap is the
      // beginning of the next one, and a click that stopped there would stop
      // for good.
      endsAtTicks: this.endsAtTicks,
      subdivisionsPerPulse: subdivisionsPerPulseFor(timeline, timeSignature, this.click),
      click: this.click,
      // From bar zero, because there is no count-in in front of a playback.
      dropout: resolveDropout(this.clickWhen, 0),
      muted: clickIsSilent(this.clickWhen),
    };
  }

  /**
   * Where this reading ends, in the pulse's own ticks - `null` while it goes
   * round for ever.
   *
   * The end of the lap being played, which for a performance that never
   * repeated is the first and only one. Derived rather than stored, so that
   * a reader turning the repeat off names an end without being asked when:
   * the lap they are in is the last one, whichever that is.
   */
  private get endsAtTicks(): number | null {
    return this.looping ? null : this.firstLapTicks + this.lapsDone * this.lapTicks;
  }

  /** The same moment in milliseconds, which is what notes are timed in. */
  private get endsAtMs(): number | null {
    return this.looping ? null : this.firstLapMs + this.lapsDone * this.lapMs;
  }

  /**
   * The first time round, then the lap laid end to end after it.
   *
   * They are the same list whenever the music was picked up at the lap's own
   * start, which is every performance that was not resumed from a pause -
   * and then this is simply the lap tiled, as it was before a pause could
   * begin one partway through.
   */
  private roundAndRound<T extends { readonly startTicks: number }>(
    first: readonly T[],
    lap: readonly T[],
    from: number,
  ): T[] {
    const opening = first.filter((entry) => entry.startTicks < this.firstLapTicks);
    const rounds = laidEndToEnd(lap, this.lapTicks, PLANNED_LAPS, from).map((entry) => ({
      ...entry,
      startTicks: entry.startTicks + this.firstLapTicks,
    }));
    return [...opening, ...rounds];
  }

  /**
   * Starts or stops the stretch playing round again, mid-performance.
   *
   * A reader who turns the repeat off means it now, the way clearing the
   * passage does - and turning it on mid-performance must not stop the music
   * to say so, since stopping is the thing this exists to avoid.
   */
  setRepeating(repeat: boolean): void {
    if (!this.playing || this.looping === repeat || this.lapTicks <= 0) {
      return;
    }
    this.looping = repeat;
    if (repeat && !this.laidInLaps) {
      this.laidInLaps = true;
      // The lap's own notes, which a performance that began without a repeat
      // never gathered: picked up mid-passage, every time round after this
      // one is the whole lap and not the tail of it that is playing now.
      this.lapNotes =
        this.timeline === null || this.loopFromTicks === this.fromTicks
          ? this.pending
          : this.collectNotes(this.timeline, this.hand, this.loopFromTicks);
    }
    this.deps.metronome.configure(this.planFrom(this.lapsDone));
  }

  stop(): void {
    this.subscription?.();
    this.subscription = null;
    if (this.playing) {
      this.deps.metronome.stop();
      // Up to one horizon of sound is already on the audio clock and will ring
      // out; silencing what is still held is the most that can be undone.
      this.deps.instrument.stopAll();
    }
    this.pending = [];
    this.playing = false;
  }

  dispose(): void {
    this.stop();
    this.emitter.removeAllListeners();
  }

  /**
   * The nth note of the performance, timed from where it began.
   *
   * A flat list while nothing repeats. Where it does, the first time round is
   * whatever was left of the lap when the music was picked up, and every one
   * after it is the whole lap - so the two are asked for separately and the
   * count runs straight through both.
   */
  private noteAt(index: number): { midi: number; atMs: number; untilMs: number } | null {
    const first = this.pending;
    if (index < first.length) {
      return first[index] ?? null;
    }
    const lap = this.lapNotes;
    if (!this.laidInLaps || lap.length === 0) {
      return null;
    }
    const after = index - first.length;
    const note = lap[after % lap.length];
    if (note === undefined) {
      return null;
    }
    const base = this.firstLapMs + Math.floor(after / lap.length) * this.lapMs;
    return { midi: note.midi, atMs: base + note.atMs, untilMs: base + note.untilMs };
  }

  /**
   * How far round the music has got, and how many times it has been round.
   *
   * The metronome counts from nought whatever the music does, so where the
   * playback began is added back on - and where it goes round, only how far
   * into the lap it has got. The first time round is measured from where the
   * performance began and every one after it from where the lap does, which
   * are the same place unless the reader picked the music up mid-lap.
   */
  private lapAt(elapsed: number): { lap: number; position: number } {
    if (!this.laidInLaps || this.lapTicks <= 0 || elapsed < this.firstLapTicks) {
      return { lap: 0, position: elapsed + this.fromTicks };
    }
    const after = elapsed - this.firstLapTicks;
    return {
      lap: 1 + Math.floor(after / this.lapTicks),
      position: this.loopFromTicks + (after % this.lapTicks),
    };
  }

  /**
   * Every note to sound, flattened and timed.
   *
   * `durationTicks` on a timeline note already follows any ties out of it, so
   * a note held across a bar line is one sound of the right length rather than
   * two of the wrong one.
   *
   * The damper pedal is applied here rather than through the instrument's own
   * pedal, which belongs to the player's feet: a note struck under the pedal
   * simply rings until the pedal comes up, which is the same thing said in the
   * only terms this schedule has.
   */
  private collectNotes(
    timeline: ExerciseTimeline,
    staffNumber: ListeningHand,
    fromTicks: number,
  ): ScheduledNote[] {
    const exercise = timeline.exercise;
    const spans = pedalSpans(exercise);
    // From where this performance began, and walked rather than multiplied:
    // a piece that changes tempo has no single number to multiply by.
    const at = (ticks: number): number => spanMs(exercise, fromTicks, ticks);
    const longest = new Map<string, ScheduledNote>();
    for (const step of timeline.steps) {
      // Only the stretch being played, and timed from its own beginning.
      if (step.onsetTicks < fromTicks || step.onsetTicks >= this.untilTicks) {
        continue;
      }
      const sounding = step.notes.filter(
        (note) => staffNumber === null || note.staffNumber === staffNumber,
      );
      // Counted after the hand filter: listening to one hand of a roll
      // written across both is listening to that hand alone, and it starts
      // where the reader's own would.
      const offsets = rollOffsets(
        sounding.filter((note) => note.arpeggiated).length,
        spanMs(exercise, step.onsetTicks, step.onsetTicks + step.durationTicks),
      );
      let rolled = 0;
      for (const note of sounding) {
        const offset = note.arpeggiated ? (offsets[rolled] ?? 0) : 0;
        if (note.arpeggiated) {
          rolled += 1;
        }
        const startsAt = at(step.onsetTicks) + offset;
        const heldUntil = spans.find(
          ([from, to]) => step.onsetTicks >= from && step.onsetTicks < to,
        )?.[1];
        const endTicks = Math.max(
          step.onsetTicks + note.durationTicks,
          heldUntil ?? 0,
        );
        const until = at(endTicks);
        // Two voices may notate the same sounding pitch at the same instant.
        // That is one key on the keyboard and must be one sound here: striking
        // it twice doubles the attack into an audible knock. The longer of the
        // two wins, since the key stays down until the last of them lets go.
        const seen = `${note.midi}@${step.onsetTicks}`;
        const previous = longest.get(seen);
        if (previous === undefined || previous.untilMs < until) {
          // A rolled note is released with the rest of the chord - the hand
          // lifts once - so only the attack moves. `Math.max` is the guard
          // for a roll that a very short step has squeezed to nothing.
          longest.set(seen, {
            midi: note.midi,
            atMs: startsAt,
            untilMs: Math.max(until, startsAt),
          });
        }
      }
    }
    return [...longest.values()].sort((left, right) => left.atMs - right.atMs);
  }

  private handleTick(tick: MetronomeTick): void {
    if (!this.playing || this.timeline === null) {
      return;
    }
    // Musical zero is the first tick, so every note is timed from it.
    this.startedAtMs ??= tick.scheduledTimeMs;
    const from = this.startedAtMs;

    // Scheduled straight through the seam, which is the whole of being
    // seamless. The notes of the next lap are handed over while the last of
    // this one are still sounding, exactly as any other note is handed over
    // ahead of its moment - so the lap boundary costs nothing at all, and the
    // reader tapping along hears the downbeat where the downbeat is.
    const horizon = tick.scheduledTimeMs + (this.deps.horizonMs ?? DEFAULT_HORIZON_MS);
    // Which is also where the handing over stops. Scheduling runs ahead of
    // the pulse, so without this the lap after the last one had its opening
    // notes already on the audio clock by the time the pulse reached the end
    // and they sounded after the music had finished.
    const last = this.endsAtMs;
    for (;;) {
      const note = this.noteAt(this.nextToSchedule);
      if (note === null || from + note.atMs > horizon) {
        break;
      }
      if (last !== null && note.atMs >= last) {
        break;
      }
      this.nextToSchedule += 1;
      this.scheduledThroughMs = Math.max(this.scheduledThroughMs, from + note.atMs);
      this.deps.instrument.play(note.midi, LISTENING_VELOCITY, from + note.atMs);
      this.deps.instrument.stop(note.midi, from + note.untilMs);
    }

    // The metronome counts from nought whatever the music does, so where the
    // playback began is added back on before asking the timeline anything -
    // and where it goes round, only how far into the lap it has got.
    const elapsed = tick.positionTicks;
    const round = this.lapAt(elapsed);
    const lapsDone = round.lap;
    const position = round.position;
    // Asked before the marker is moved, not after. The tick that ends a
    // stretch stands at the end of its last note, which is the *beginning of
    // the next one* - so moving first walked the marker into the bar after
    // the passage and published a position there. On a repeat that showed as
    // the music visibly overrunning by a bar before starting again, and where
    // the next bar was on the next page the page turned forward and straight
    // back. Nothing is heard there either way: the notes were scheduled from
    // the stretch alone.
    // And it is the end of the *lap*, not of the first one. The pulse counts
    // laps laid end to end and goes on counting them after the reader turns
    // the repeat off, so an end read as the end of the first lap is a moment
    // already behind it - which ended the performance the instant they said
    // "let this be the last time round".
    const ends = this.endsAtTicks;
    if (ends !== null && elapsed >= ends) {
      this.finish();
      return;
    }
    if (lapsDone !== this.lapsDone) {
      this.lapsDone = lapsDone;
      // Kept ahead of the pulse. The plan is written out for a fixed number
      // of laps, and this is what stops it running off the end of them.
      if (lapsDone % PLANNED_LAPS === PLANNED_LAPS - 1) {
        this.deps.metronome.configure(this.planFrom(lapsDone));
      }
    }
    const step = this.timeline.stepAtTick(position);
    if (step !== null) {
      const arrived = step.index !== this.announcedIndex;
      this.announcedIndex = step.index;
      this.atIndex = step.index;
      this.deps.cursor.moveTo(step.index);
      if (arrived) {
        this.emitter.emit('stepReached', {
          stepIndex: step.index,
          ticks: step.onsetTicks,
          atMs: tick.scheduledTimeMs,
        });
      }
    }
    this.publishPosition(position);
  }

  /**
   * Announces where the music has reached, if it has moved.
   *
   * Read off the bar lines rather than worked out from the opening metre: a
   * piece that changes metre has bars of different lengths from there on, and
   * a position had by dividing lands in the wrong one.
   */
  private publishPosition(ticks: number): void {
    const timeline = this.timeline;
    if (timeline === null) {
      return;
    }
    const at = positionOfTick(timeline.exercise, Math.max(0, ticks));
    const last = this.publishedPosition;
    if (last !== null && last.measureIndex === at.measureIndex && last.beat === at.beat) {
      return;
    }
    this.publishedPosition = at;
    this.emitter.emit('positionChanged', at);
  }

  private finish(): void {
    // Ended rather than merely stopped: a performance that reached its own
    // end is not a performance being held, and pressing the button after one
    // means hearing it again from the top of the passage.
    this.end();
    this.emitter.emit('finished', {});
  }
}

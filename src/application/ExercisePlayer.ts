
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
  type MetronomeTick,
} from './ports/IMetronome.js';
import type { IPitchPlayer } from './ports/IPitchPlayer.js';
import type { IScoreCursor } from './ports/IScoreRenderer.js';
import {
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
}

/** One note the player still has to start and stop. */
interface ScheduledNote {
  readonly midi: number;
  readonly atMs: number;
  readonly untilMs: number;
}

const DEFAULT_HORIZON_MS = 250;
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
   * Where a pause left off, or `null` when nothing is being held.
   *
   * A step and not a tick, for the reason a run's pause is: picking up
   * partway through a note would sound its tail without its beginning, and
   * the reader following the marker would see it land somewhere no note
   * starts.
   */
  private pausedAtIndex: number | null = null;
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
    // Collected again, because the notes past the old end were never gathered
    // - the walk skips anything outside the stretch. Everything before it is
    // gathered identically and in the same order, so what has already been
    // handed to the instrument stays handed over exactly once.
    this.pending = this.collectNotes(this.timeline, this.hand);
    this.nextToSchedule = Math.min(this.nextToSchedule, this.pending.length);
    this.applyClick(this.click, this.clickWhen);
  }

  /** Changes what is heard over a performance, without interrupting it. */
  applyClick(click: ClickPattern, clickWhen: ClickWhen): void {
    if (!this.playing || this.timeline === null) {
      return;
    }
    this.click = click;
    this.clickWhen = clickWhen;
    const timeSignature = this.timeline.exercise.timeSignature;
    this.deps.metronome.configure({
      bpm: this.timeline.exercise.tempoBpm,
      timeSignature,
      // From where the performance actually began, which is where its own
      // clock reads nought.
      bars: metronomeBars(this.timeline.exercise, { countInBars: 0, fromTicks: this.fromTicks }),
      // Re-read, because the end may have moved: clearing the passage while
      // it plays widens what there is left to hear.
      tempos: metronomeTempos(this.timeline.exercise, {
        countInBars: 0,
        fromTicks: this.fromTicks,
      }),
      endsAtTicks: this.untilTicks - this.fromTicks,
      subdivisionsPerPulse: subdivisionsPerPulseFor(this.timeline, timeSignature, this.click),
      click: this.click,
      dropout: resolveDropout(clickWhen, 0),
      muted: clickIsSilent(clickWhen),
    });
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
    // Whatever was being held, this is now what is happening instead.
    this.pausedAtIndex = null;
    this.untilTicks = this.endOf(options.toIndex);
    this.pending = this.collectNotes(timeline, options.staffNumber);
    this.nextToSchedule = 0;
    this.startedAtMs = null;
    this.playing = true;

    const timeSignature = timeline.exercise.timeSignature;
    this.deps.metronome.configure({
      bpm: timeline.exercise.tempoBpm,
      timeSignature,
      // No count-in in front of a playback, and it starts wherever the
      // reader put their place.
      bars: metronomeBars(timeline.exercise, { countInBars: 0, fromTicks: this.fromTicks }),
      tempos: metronomeTempos(timeline.exercise, { countInBars: 0, fromTicks: this.fromTicks }),
      endsAtTicks: this.untilTicks - this.fromTicks,
      subdivisionsPerPulse: subdivisionsPerPulseFor(timeline, timeSignature, this.click),
      click: this.click,
      // From bar zero, because there is no count-in in front of a playback.
      dropout: resolveDropout(options.clickWhen, 0),
      muted: clickIsSilent(options.clickWhen),
    });

    this.subscription = this.deps.metronome.onTick((tick) => this.handleTick(tick));
    this.deps.cursor.moveTo(first?.index ?? 0);
    this.deps.metronome.start();
    this.emitter.emit('started', {});
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
  ): ScheduledNote[] {
    const exercise = timeline.exercise;
    const spans = pedalSpans(exercise);
    // From where this performance began, and walked rather than multiplied:
    // a piece that changes tempo has no single number to multiply by.
    const at = (ticks: number): number => spanMs(exercise, this.fromTicks, ticks);
    const longest = new Map<string, ScheduledNote>();
    for (const step of timeline.steps) {
      // Only the stretch being played, and timed from its own beginning.
      if (step.onsetTicks < this.fromTicks || step.onsetTicks >= this.untilTicks) {
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

    const horizon = tick.scheduledTimeMs + (this.deps.horizonMs ?? DEFAULT_HORIZON_MS);
    while (this.nextToSchedule < this.pending.length) {
      const note = this.pending[this.nextToSchedule];
      if (note === undefined || from + note.atMs > horizon) {
        break;
      }
      this.nextToSchedule += 1;
      this.deps.instrument.play(note.midi, LISTENING_VELOCITY, from + note.atMs);
      this.deps.instrument.stop(note.midi, from + note.untilMs);
    }

    // The metronome counts from nought whatever the music does, so where the
    // playback began is added back on before asking the timeline anything.
    const position = tick.positionTicks + this.fromTicks;
    const step = this.timeline.stepAtTick(position);
    if (step !== null) {
      this.atIndex = step.index;
      this.deps.cursor.moveTo(step.index);
    }
    this.publishPosition(position);
    if (position >= this.untilTicks) {
      this.finish();
    }
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


import { pedalSpans, spanMs } from '../domain/model/Exercise.js';
import type { ExerciseTimeline } from '../domain/timeline/Timeline.js';
import { TypedEventEmitter, type IEventSource, type Unsubscribe } from '../shared/EventEmitter.js';
import {
  clickIsSilent,
  resolveDropout,
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

  /** Changes what is heard over a performance, without interrupting it. */
  applyClick(clickWhen: ClickWhen): void {
    if (!this.playing || this.timeline === null) {
      return;
    }
    const timeSignature = this.timeline.exercise.timeSignature;
    this.deps.metronome.configure({
      bpm: this.timeline.exercise.tempoBpm,
      timeSignature,
      // From where the performance actually began, which is where its own
      // clock reads nought.
      bars: metronomeBars(this.timeline.exercise, { countInBars: 0, fromTicks: this.fromTicks }),
      tempos: metronomeTempos(this.timeline.exercise, {
        countInBars: 0,
        fromTicks: this.fromTicks,
      }),
      endsAtTicks: this.untilTicks - this.fromTicks,
      subdivisionsPerPulse: subdivisionsPerPulseFor(this.timeline, timeSignature, 'pulse'),
      click: 'pulse',
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

  start(timeline: ExerciseTimeline, options: ListeningOptions): void {
    this.stop();
    if (timeline.length === 0) {
      return;
    }

    this.timeline = timeline;
    const first = timeline.at(Math.max(0, Math.round(options.fromIndex ?? 0)));
    const last = timeline.at(
      Math.min(timeline.length - 1, Math.round(options.toIndex ?? timeline.length - 1)),
    );
    this.fromTicks = first?.onsetTicks ?? 0;
    this.untilTicks =
      last === null ? timeline.totalTicks : last.onsetTicks + last.durationTicks;
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
      subdivisionsPerPulse: subdivisionsPerPulseFor(timeline, timeSignature, 'pulse'),
      click: 'pulse',
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
      this.deps.cursor.moveTo(step.index);
    }
    if (position >= this.untilTicks) {
      this.finish();
    }
  }

  private finish(): void {
    this.stop();
    this.emitter.emit('finished', {});
  }
}

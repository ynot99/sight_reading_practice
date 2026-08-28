import { ticksToMilliseconds } from '../domain/model/Duration.js';
import type { ExerciseTimeline } from '../domain/timeline/Timeline.js';
import { TypedEventEmitter, type IEventSource, type Unsubscribe } from '../shared/EventEmitter.js';
import type { IMetronome, MetronomeTick } from './ports/IMetronome.js';
import type { IPitchPlayer } from './ports/IPitchPlayer.js';
import type { IScoreCursor } from './ports/IScoreRenderer.js';
import { subdivisionsPerPulseFor } from './session/metronomePlan.js';

/** Which hands to sound. `null` is both. */
export type ListeningHand = number | null;

export interface ListeningOptions {
  /** Staff to sound alone, or `null` for the whole texture. */
  readonly staffNumber: ListeningHand;
  /** Keep the pulse audible under the music. */
  readonly clickAudible: boolean;
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
  private playing = false;

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
    this.pending = this.collectNotes(timeline, options.staffNumber);
    this.nextToSchedule = 0;
    this.startedAtMs = null;
    this.playing = true;

    const timeSignature = timeline.exercise.timeSignature;
    this.deps.metronome.configure({
      bpm: timeline.exercise.tempoBpm,
      timeSignature,
      subdivisionsPerPulse: subdivisionsPerPulseFor(timeline, timeSignature, 'pulse'),
      click: 'pulse',
      dropout: null,
      muted: !options.clickAudible,
    });

    this.subscription = this.deps.metronome.onTick((tick) => this.handleTick(tick));
    this.deps.cursor.reset();
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
   */
  private collectNotes(
    timeline: ExerciseTimeline,
    staffNumber: ListeningHand,
  ): ScheduledNote[] {
    const tempo = timeline.exercise.tempoBpm;
    const longest = new Map<string, ScheduledNote>();
    for (const step of timeline.steps) {
      for (const note of step.notes) {
        if (staffNumber !== null && note.staffNumber !== staffNumber) {
          continue;
        }
        // Two voices may notate the same sounding pitch at the same instant.
        // That is one key on the keyboard and must be one sound here: striking
        // it twice doubles the attack into an audible knock. The longer of the
        // two wins, since the key stays down until the last of them lets go.
        const at = ticksToMilliseconds(step.onsetTicks, tempo);
        const until = ticksToMilliseconds(step.onsetTicks + note.durationTicks, tempo);
        const seen = `${note.midi}@${step.onsetTicks}`;
        const previous = longest.get(seen);
        if (previous === undefined || previous.untilMs < until) {
          longest.set(seen, { midi: note.midi, atMs: at, untilMs: until });
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

    const position = tick.positionTicks;
    const step = this.timeline.stepAtTick(position);
    if (step !== null) {
      this.deps.cursor.moveTo(step.index);
    }
    if (position >= this.timeline.totalTicks) {
      this.finish();
    }
  }

  private finish(): void {
    this.stop();
    this.emitter.emit('finished', {});
  }
}

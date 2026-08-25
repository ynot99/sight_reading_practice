import { elementAt } from '../../shared/asserts.js';
import type { Exercise } from '../model/Exercise.js';
import { exerciseTicks } from '../model/Exercise.js';
import type { Pitch } from '../model/Pitch.js';

/** A single sounding pitch inside a timeline step. */
export interface TimelineNote {
  readonly pitch: Pitch;
  readonly midi: number;
  readonly staffNumber: number;
  /** Notated length of the note itself (not of the step). */
  readonly durationTicks: number;
}

/**
 * One cursor position: every note that starts at the same musical instant,
 * across all staves.
 *
 * A step with no notes is a rest position. It still exists because the OSMD
 * cursor stops there, and the two must advance in lockstep.
 */
export interface TimelineStep {
  readonly index: number;
  readonly onsetTicks: number;
  /** Distance to the next step (or to the end of the exercise). */
  readonly durationTicks: number;
  readonly measureIndex: number;
  /** One-based beat position inside the measure. */
  readonly beat: number;
  readonly notes: readonly TimelineNote[];
  /** Ascending MIDI numbers the player is expected to sound here. */
  readonly expectedMidi: readonly number[];
}

/**
 * The performable projection of an {@link Exercise}: a flat, ordered list of
 * expected events. This is what the practice session walks and what MIDI
 * input is judged against.
 */
export class ExerciseTimeline {
  readonly exercise: Exercise;
  readonly steps: readonly TimelineStep[];
  readonly totalTicks: number;

  constructor(exercise: Exercise, steps: readonly TimelineStep[], totalTicks: number) {
    this.exercise = exercise;
    this.steps = steps;
    this.totalTicks = totalTicks;
  }

  get length(): number {
    return this.steps.length;
  }

  /** Steps that actually require input (rest positions excluded). */
  get playableSteps(): readonly TimelineStep[] {
    return this.steps.filter((step) => step.notes.length > 0);
  }

  /** Total number of expected note-ons across the exercise. */
  get noteCount(): number {
    return this.steps.reduce((total, step) => total + step.expectedMidi.length, 0);
  }

  at(index: number): TimelineStep | null {
    return this.steps[index] ?? null;
  }

  require(index: number): TimelineStep {
    return elementAt(this.steps, index);
  }

  /** Last step whose onset is at or before `tick`, or `null` before the first. */
  stepAtTick(tick: number): TimelineStep | null {
    let found: TimelineStep | null = null;
    for (const step of this.steps) {
      if (step.onsetTicks <= tick) {
        found = step;
      } else {
        break;
      }
    }
    return found;
  }
}

/**
 * Flattens an exercise into its timeline.
 *
 * Notes from different staves that share an onset are merged into one step,
 * which is exactly how a player experiences them: press both hands together.
 * Held notes are not repeated in later steps, so a sustained bass note under a
 * running melody is only ever demanded once.
 */
export function buildTimeline(exercise: Exercise): ExerciseTimeline {
  const notesByOnset = new Map<number, TimelineNote[]>();
  const onsets = new Set<number>();
  const ticksPerMeasure = exercise.timeSignature.ticksPerMeasure;

  for (const staff of exercise.staves) {
    staff.measures.forEach((measure, measureIndex) => {
      let cursor = measureIndex * ticksPerMeasure;
      for (const entry of measure.entries) {
        onsets.add(cursor);
        if (entry.kind === 'note') {
          const bucket = notesByOnset.get(cursor) ?? [];
          for (const pitch of entry.pitches) {
            bucket.push({
              pitch,
              midi: pitch.midi,
              staffNumber: staff.staffNumber,
              durationTicks: entry.duration.ticks,
            });
          }
          notesByOnset.set(cursor, bucket);
        }
        cursor += entry.duration.ticks;
      }
    });
  }

  const totalTicks = exerciseTicks(exercise);
  const ordered = [...onsets].sort((left, right) => left - right);

  const steps: TimelineStep[] = ordered.map((onsetTicks, index) => {
    const next = ordered[index + 1] ?? totalTicks;
    const notes = (notesByOnset.get(onsetTicks) ?? [])
      .slice()
      .sort((left, right) => left.midi - right.midi);
    return {
      index,
      onsetTicks,
      durationTicks: next - onsetTicks,
      measureIndex: exercise.timeSignature.measureOf(onsetTicks),
      beat: exercise.timeSignature.beatOf(onsetTicks),
      notes,
      // Both hands may notate the same sounding pitch; the player still has
      // exactly one key to press for it.
      expectedMidi: [...new Set(notes.map((note) => note.midi))],
    };
  });

  return new ExerciseTimeline(exercise, steps, totalTicks);
}

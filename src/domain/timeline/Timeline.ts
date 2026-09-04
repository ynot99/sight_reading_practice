import { elementAt } from '../../shared/asserts.js';
import type { Exercise, MusicalEntry } from '../model/Exercise.js';
import { barLines, exerciseTicks, positionOfTick } from '../model/Exercise.js';
import type { Pitch } from '../model/Pitch.js';

/** A single sounding pitch inside a timeline step. */
export interface TimelineNote {
  readonly pitch: Pitch;
  readonly midi: number;
  readonly staffNumber: number;
  /** Notated length of the note itself (not of the step). */
  readonly durationTicks: number;
  /**
   * Part of a chord the writer marked to be rolled rather than struck.
   *
   * Carried per *note* and not per step, because one hand may roll while the
   * other strikes - and because a roll written across both staves is a single
   * gesture from the lowest note to the highest, which only a per-note flag
   * can express once the staves have been merged into one step.
   */
  readonly arpeggiated: boolean;
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
  /**
   * Ornaments printed here: playable, and never required.
   *
   * A grace note is on the page, so playing it is reading the page correctly
   * and must not be marked wrong. It is also the performer's to add, and a
   * run that waited for it would hold the reader at a note the writer offered
   * rather than asked for. So it is neither demanded nor punished.
   */
  readonly ornamentMidi: readonly number[];
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
 * How long a press actually lasts, following any ties out of this entry.
 *
 * The notated value is only half the story once a note is tied: the key stays
 * down for the whole chain, and that is what a listener hears and what
 * playback would have to schedule.
 */
function soundingTicks(
  entries: readonly { readonly entry: MusicalEntry; readonly onsetTicks: number }[],
  index: number,
  midi: number,
): number {
  let total = 0;
  for (let at = index; at < entries.length; at += 1) {
    const current = entries[at]?.entry;
    if (current === undefined) {
      break;
    }
    total += current.duration.ticks;
    if (current.kind !== 'note' || !current.tiedForward.includes(midi)) {
      break;
    }
  }
  return total;
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
  const ornamentsByOnset = new Map<number, number[]>();
  const onsets = new Set<number>();
  // Where each bar begins, rather than a bar length to multiply by: a metre
  // may change partway through, and from there on the bars are no longer all
  // the same length.
  const bars = barLines(exercise);

  for (const staff of exercise.staves) {
    const entries = staff.measures.flatMap((measure, measureIndex) => {
      let cursor = bars[measureIndex]?.startTicks ?? 0;
      return measure.entries.map((entry) => {
        const onsetTicks = cursor;
        cursor += entry.duration.ticks;
        return { entry, onsetTicks };
      });
    });

    // Pitches the previous entry is still holding. A tied note is a
    // continuation of one press, so it must not be demanded a second time.
    let held = new Set<number>();

    entries.forEach(({ entry, onsetTicks }, index) => {
      if (entry.kind === 'note' && entry.graces.length > 0) {
        const bucket = ornamentsByOnset.get(onsetTicks) ?? [];
        for (const grace of entry.graces) {
          for (const pitch of grace.pitches) {
            bucket.push(pitch.midi);
          }
        }
        ornamentsByOnset.set(onsetTicks, bucket);
      }
      // A silence is drawn as nothing, so the engraver's cursor never stops
      // there and neither may we: the two agree on *positions*, and a position
      // nobody can see is one the reader would be held at for no reason.
      if (entry.kind !== 'silence') {
        onsets.add(onsetTicks);
      }
      if (entry.kind === 'note') {
        const bucket = notesByOnset.get(onsetTicks) ?? [];
        for (const pitch of entry.pitches) {
          if (held.has(pitch.midi)) {
            continue;
          }
          bucket.push({
            pitch,
            midi: pitch.midi,
            staffNumber: staff.staffNumber,
            durationTicks: soundingTicks(entries, index, pitch.midi),
            arpeggiated: entry.arpeggiated,
          });
        }
        notesByOnset.set(onsetTicks, bucket);
      }
      held = entry.kind === 'note' ? new Set(entry.tiedForward) : new Set();
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
      ...positionOfTick(exercise, onsetTicks),
      notes,
      // Both hands may notate the same sounding pitch; the player still has
      // exactly one key to press for it.
      expectedMidi: [...new Set(notes.map((note) => note.midi))],
      // Minus anything the step demands anyway: a grace on the note it is
      // already asking for is that note, and asking for it once is enough.
      ornamentMidi: [...new Set(ornamentsByOnset.get(onsetTicks) ?? [])]
        .filter((midi) => !notes.some((note) => note.midi === midi))
        .sort((left, right) => left - right),
    };
  });

  return new ExerciseTimeline(exercise, steps, totalTicks);
}

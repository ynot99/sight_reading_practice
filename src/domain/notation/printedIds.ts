import { barLines } from '../model/Exercise.js';
import type { ExerciseTimeline } from '../timeline/Timeline.js';

/**
 * The names every bar and note carries on the printed page.
 *
 * The engraver draws each `<measure>` and `<note>` of the MusicXML it is given
 * as an element that keeps the `id` it was written with, so naming them here
 * lets the page be read by name: the notes a step asks for, the bar a passage
 * ends in. Without names that is a map from time to notes the engraver has to
 * work out for itself, and on the longest score he owns that took 5.6 s on the
 * iPad.
 *
 * Named by where they stand in the {@link Exercise} rather than by a counter,
 * because the printed page and the timeline are both derived from the exercise
 * and never from each other: whatever knows where an entry stands can say its
 * name, without having seen the page.
 *
 * One entry is one `<note>` per pitch, and never split: a value that needs two
 * printed notes is two entries tied, so the pitch's place in its entry is the
 * whole of the name below the entry.
 */

/** Where an entry stands: the bar, the voice, and its place in the voice's bar. */
export interface EntryAt {
  readonly measureIndex: number;
  /** The MusicXML voice, which no two staff parts share. */
  readonly voice: number;
  readonly entryIndex: number;
}

/** The name of a bar, by its index into the exercise. */
export function barId(measureIndex: number): string {
  return `m${String(measureIndex)}`;
}

/** The bar a name belongs to, read back; `null` for a name that is not a bar's. */
export function measureIndexOfBar(id: string): number | null {
  const found = /^m(\d+)$/.exec(id);
  return found === null ? null : Number(found[1]);
}

/** The name of one pitch of a note or chord, by its place in the entry's pitches. */
export function noteId(at: EntryAt, pitchIndex: number): string {
  return `n${entryName(at)}-${String(pitchIndex)}`;
}

/**
 * The name of a rest, drawn or not.
 *
 * A silence is written as a rest nobody sees, and it is named like one: the
 * engraver keeps it as a space in the bar that still has a place across it.
 */
export function restId(at: EntryAt): string {
  return `r${entryName(at)}`;
}

/** The name of one pitch of a grace note leaning on the entry at `at`. */
export function graceId(at: EntryAt, graceIndex: number, pitchIndex: number): string {
  return `g${entryName(at)}-${String(graceIndex)}-${String(pitchIndex)}`;
}

function entryName(at: EntryAt): string {
  return `${String(at.measureIndex)}-${String(at.voice)}-${String(at.entryIndex)}`;
}

/** One note or rest the page prints at a step. */
export interface PrintedHere {
  readonly id: string;
  readonly staffNumber: number;
  /** The key a note is, or `null` for a rest. */
  readonly midi: number | null;
  /**
   * Where on the staff the note is written, or `null` for a rest - C4 is 28.
   *
   * The key does not say it: F sharp and G flat are one key and two places on
   * the staff, and a mark drawn on the wrong one is a wrong note drawn.
   */
  readonly diatonicIndex: number | null;
}

/** What the page prints where a step is. */
export interface PrintedStep {
  /** The bar the step is in, by its printed name. */
  readonly barId: string;
  /** Every note and rest that begins there, in every voice. */
  readonly printed: readonly PrintedHere[];
}

/**
 * Where on the page each step of the timeline is, by name.
 *
 * Worked out from the exercise the timeline was built from, by the same
 * reckoning the timeline makes - each voice's entries laid end to end from
 * the bar line - so a step and its notes are found without the page having
 * been read at all. A note tied over from the step before is printed again at
 * this one and is here with it, though nobody plays it: the marker stands on
 * what is drawn. A rest nobody draws is not here, having no place on the page.
 */
export function printedAtEachStep(timeline: ExerciseTimeline): readonly PrintedStep[] {
  const stepAt = new Map(timeline.steps.map((step) => [step.onsetTicks, step.index]));
  const printed = timeline.steps.map((): PrintedHere[] => []);
  const bars = barLines(timeline.exercise);
  for (const staff of timeline.exercise.staves) {
    staff.measures.forEach((measure, measureIndex) => {
      let onsetTicks = bars[measureIndex]?.startTicks ?? 0;
      measure.entries.forEach((entry, entryIndex) => {
        const step = stepAt.get(onsetTicks);
        onsetTicks += entry.duration.ticks;
        const here = step === undefined ? undefined : printed[step];
        if (here === undefined || entry.kind === 'silence') {
          return;
        }
        const at: EntryAt = { measureIndex, voice: staff.voice, entryIndex };
        if (entry.kind === 'rest') {
          here.push({ id: restId(at), staffNumber: staff.staffNumber, midi: null, diatonicIndex: null });
          return;
        }
        entry.pitches.forEach((pitch, pitchIndex) => {
          here.push({
            id: noteId(at, pitchIndex),
            staffNumber: staff.staffNumber,
            midi: pitch.midi,
            diatonicIndex: pitch.diatonicIndex,
          });
        });
      });
    });
  }
  return timeline.steps.map((step, index) => ({
    barId: barId(step.measureIndex),
    printed: printed[index] ?? [],
  }));
}

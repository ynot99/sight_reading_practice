import { clamp } from '../../shared/asserts.js';
import { DomainError } from '../../shared/errors.js';
import type { ClefChange, Exercise, KeyChange, PedalMark, StaffPart } from './Exercise.js';
import { clefAtMeasure, keyAtMeasure, measureCount, measureOf, noteEntry } from './Exercise.js';

/**
 * Cuts a passage out of a score, as a score in its own right.
 *
 * Practising eight bars of a hundred is done by making those eight bars the
 * exercise, rather than by teaching the session to start and stop in the
 * middle of a longer one. Everything downstream - the timeline, the page, the
 * cursor, the overlay, the report, the playback - then works unchanged, which
 * is the whole reason to do it this way.
 *
 * The seams are where the work is. A clef or key the passage inherits has to
 * be stated at its head, a tie leading out of the last bar has nowhere to go,
 * and a pedal already down when the passage opens has to be pressed again.
 *
 * Measures are one-based, as a reader counts them, and inclusive at both ends.
 */
export function sliceExercise(exercise: Exercise, fromBar: number, toBar: number): Exercise {
  const bars = measureCount(exercise);
  if (bars === 0) {
    throw new DomainError('There is nothing to take a passage from.');
  }
  const first = clamp(Math.trunc(fromBar), 1, bars) - 1;
  const last = clamp(Math.trunc(toBar), first + 1, bars) - 1;
  if (first === 0 && last === bars - 1) {
    return exercise;
  }

  const staves = exercise.staves
    .map((staff) => sliceStaff(staff, first, last))
    .filter((staff) => staff.measures.some((measure) => measure.entries.length > 0));

  if (staves.length === 0) {
    throw new DomainError(`Bars ${first + 1} to ${last + 1} have nothing in them.`);
  }

  return {
    ...exercise,
    id: `${exercise.id}-bars-${first + 1}-${last + 1}`,
    title: `${exercise.title} · bars ${first + 1}–${last + 1}`,
    key: keyAtMeasure(exercise, first),
    keyChanges: shift(exercise.keyChanges, first, last),
    pedalMarks: slicePedal(exercise, first, last),
    staves,
  };
}

/** Changes that fall inside the passage, renumbered from its first bar. */
function shift(changes: readonly KeyChange[], first: number, last: number): KeyChange[];
function shift(changes: readonly ClefChange[], first: number, last: number): ClefChange[];
function shift(
  changes: readonly (KeyChange | ClefChange)[],
  first: number,
  last: number,
): (KeyChange | ClefChange)[] {
  return changes
    .filter((change) => change.measureIndex > first && change.measureIndex <= last)
    .map((change) => ({ ...change, measureIndex: change.measureIndex - first }));
}

function sliceStaff(staff: StaffPart, first: number, last: number): StaffPart {
  const measures = staff.measures.slice(first, last + 1).map((measure) => measureOf(measure.entries));
  const lastMeasure = measures.at(-1);
  if (lastMeasure !== undefined) {
    // A tie out of the final bar leads nowhere now, and a note nobody ever
    // releases is worse than a note that ends where the passage does.
    measures[measures.length - 1] = measureOf(
      lastMeasure.entries.map((entry, index) =>
        entry.kind === 'note' &&
        entry.tiedForward.length > 0 &&
        index === lastMeasure.entries.length - 1
          ? noteEntry(entry.pitches, entry.duration, [], entry.beams, entry.stem, entry.arpeggiated)
          : entry,
      ),
    );
  }

  return {
    ...staff,
    // The clef the passage inherits is stated at its head, not left implied.
    clef: clefAtMeasure(staff, first),
    clefChanges: shift(staff.clefChanges, first, last),
    measures,
  };
}

/**
 * Pedal marks inside the passage, plus one for a pedal already down.
 *
 * Inheriting a pressed pedal matters: the passage would otherwise open dry
 * where the piece opens it held, which is audibly a different phrase.
 */
function slicePedal(exercise: Exercise, first: number, last: number): PedalMark[] {
  const inside = exercise.pedalMarks
    .filter((mark) => mark.measureIndex >= first && mark.measureIndex <= last)
    .map((mark) => ({ ...mark, measureIndex: mark.measureIndex - first }));

  const before = exercise.pedalMarks.filter((mark) => mark.measureIndex < first);
  const alreadyDown = before.at(-1)?.type === 'start';
  return alreadyDown && inside[0]?.type !== 'start'
    ? [{ measureIndex: 0, offsetTicks: 0, type: 'start' as const }, ...inside]
    : inside;
}

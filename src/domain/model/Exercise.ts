import { ExerciseValidationError } from '../../shared/errors.js';
import { assertNever } from '../../shared/asserts.js';
import type { ClefKind } from './Clef.js';
import type { Duration } from './Duration.js';
import type { KeySignature } from './KeySignature.js';
import type { Pitch } from './Pitch.js';
import type { TimeSignature } from './TimeSignature.js';

/** One or more simultaneous pitches sharing a rhythmic value. */
export interface NoteEntry {
  readonly kind: 'note';
  readonly pitches: readonly Pitch[];
  readonly duration: Duration;
}

/** Silence occupying a rhythmic value. */
export interface RestEntry {
  readonly kind: 'rest';
  readonly duration: Duration;
}

export type MusicalEntry = NoteEntry | RestEntry;

export interface Measure {
  readonly entries: readonly MusicalEntry[];
}

/**
 * One staff of the grand staff: its own clef, its own MusicXML voice and one
 * entry list per measure.
 */
export interface StaffPart {
  readonly staffNumber: number;
  readonly voice: number;
  readonly clef: ClefKind;
  readonly measures: readonly Measure[];
}

export interface ExerciseMetadata {
  readonly generatorId: string;
  readonly seed: number;
}

/**
 * The single source of truth for one practice item.
 *
 * Everything downstream is derived from this value: the MusicXML that OSMD
 * renders, and the expected-event timeline that MIDI input is judged against.
 * Because both derivations start here they can never drift apart.
 */
export interface Exercise {
  readonly id: string;
  readonly title: string;
  readonly key: KeySignature;
  readonly timeSignature: TimeSignature;
  readonly tempoBpm: number;
  readonly staves: readonly StaffPart[];
  readonly metadata: ExerciseMetadata;
}

export function noteEntry(pitches: Pitch | readonly Pitch[], duration: Duration): NoteEntry {
  const list = Array.isArray(pitches) ? [...(pitches as readonly Pitch[])] : [pitches as Pitch];
  return { kind: 'note', pitches: list, duration };
}

export function restEntry(duration: Duration): RestEntry {
  return { kind: 'rest', duration };
}

export function measureOf(entries: readonly MusicalEntry[]): Measure {
  return { entries };
}

/** Total notated length of a measure, in divisions. */
export function measureTicks(measure: Measure): number {
  return measure.entries.reduce((total, entry) => total + entry.duration.ticks, 0);
}

/** Total notated length of an exercise, in divisions. */
export function exerciseTicks(exercise: Exercise): number {
  return exercise.timeSignature.ticksPerMeasure * measureCount(exercise);
}

/** Number of measures; every staff is required to agree on this. */
export function measureCount(exercise: Exercise): number {
  const first = exercise.staves[0];
  return first === undefined ? 0 : first.measures.length;
}

/**
 * Structural validation. Generators run this on everything they produce, so a
 * malformed exercise can never reach the renderer or the matcher.
 */
export function validateExercise(exercise: Exercise): void {
  if (exercise.staves.length === 0) {
    throw new ExerciseValidationError('An exercise needs at least one staff.', 'staves');
  }
  if (!Number.isFinite(exercise.tempoBpm) || exercise.tempoBpm <= 0) {
    throw new ExerciseValidationError(
      `Tempo must be a positive number, got ${exercise.tempoBpm}.`,
      'tempoBpm',
    );
  }

  const staffNumbers = new Set<number>();
  const voices = new Set<number>();
  const bars = measureCount(exercise);
  if (bars === 0) {
    throw new ExerciseValidationError('An exercise needs at least one measure.', 'staves[0]');
  }

  const expectedTicks = exercise.timeSignature.ticksPerMeasure;

  exercise.staves.forEach((staff, staffIndex) => {
    const path = `staves[${staffIndex}]`;
    if (staffNumbers.has(staff.staffNumber)) {
      throw new ExerciseValidationError(`Duplicate staff number ${staff.staffNumber}.`, path);
    }
    staffNumbers.add(staff.staffNumber);

    if (voices.has(staff.voice)) {
      throw new ExerciseValidationError(`Duplicate voice ${staff.voice}.`, path);
    }
    voices.add(staff.voice);

    if (staff.measures.length !== bars) {
      throw new ExerciseValidationError(
        `Expected ${bars} measures to match staff 0, got ${staff.measures.length}.`,
        path,
      );
    }

    staff.measures.forEach((measure, measureIndex) => {
      const measurePath = `${path}.measures[${measureIndex}]`;
      const actual = measureTicks(measure);
      if (actual !== expectedTicks) {
        throw new ExerciseValidationError(
          `Measure holds ${actual} divisions but ${exercise.timeSignature.toString()} requires ${expectedTicks}.`,
          measurePath,
        );
      }
      if (measure.entries.length === 0) {
        throw new ExerciseValidationError('Measure has no entries.', measurePath);
      }
      measure.entries.forEach((entry, entryIndex) => {
        validateEntry(entry, `${measurePath}.entries[${entryIndex}]`);
      });
    });
  });
}

function validateEntry(entry: MusicalEntry, path: string): void {
  switch (entry.kind) {
    case 'rest':
      return;
    case 'note': {
      if (entry.pitches.length === 0) {
        throw new ExerciseValidationError('Note entry has no pitches.', path);
      }
      const seen = new Set<number>();
      for (const pitch of entry.pitches) {
        if (seen.has(pitch.midi)) {
          throw new ExerciseValidationError(
            `Pitch ${pitch.toString()} is duplicated inside a chord.`,
            path,
          );
        }
        seen.add(pitch.midi);
      }
      return;
    }
    default:
      return assertNever(entry, `Unknown entry kind at ${path}`);
  }
}

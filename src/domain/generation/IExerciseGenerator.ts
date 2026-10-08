import type { Exercise } from '../model/Exercise.js';
import type { KeySignature } from '../model/KeySignature.js';
import type { TimeSignature } from '../model/TimeSignature.js';
import type { RhythmProfile } from './RhythmProfile.js';
import type { Writing } from './writing.js';

/**
 * Keys and metres an exercise draws its own from.
 *
 * A level that is a set rather than one key: an examination's sight-reading
 * test is in whichever of its grade's keys it happens to be, and a reader who
 * always knew the key in advance would be practising something easier.
 */
export interface DrawnFrom {
  readonly keys?: readonly KeySignature[];
  readonly times?: readonly TimeSignature[];
}

/** Everything the user (or the UI) gets to choose about an exercise. */
export interface ExerciseRequest {
  readonly measures: number;
  readonly timeSignature: TimeSignature;
  readonly key: KeySignature;
  readonly tempoBpm: number;
  /** Rhythmic level, chosen independently of the material. */
  readonly rhythm: RhythmProfile;
  /** Omit for a fresh exercise; supply to reproduce a previous one exactly. */
  readonly seed?: number;
  /**
   * Sets to draw the key and the metre from, in place of `key` and
   * `timeSignature`. Drawn by the seed, so the same seed is the same key.
   */
  readonly drawnFrom?: DrawnFrom;
  /**
   * What the page is written with beyond its notes - chromatic notes,
   * articulation, dynamics, a pause, a slowing. Absent, nothing.
   */
  readonly writing?: Writing;
}

/**
 * Source of practice material.
 *
 * The application layer only ever sees this interface, so a MusicXML file
 * loader, an ear-training generator or a remote exercise service can be
 * substituted without touching the session logic.
 */
export interface IExerciseGenerator {
  readonly id: string;
  readonly label: string;
  generate(request: ExerciseRequest): Exercise;
}

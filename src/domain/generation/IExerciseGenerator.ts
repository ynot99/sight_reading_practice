import type { Exercise } from '../model/Exercise.js';
import type { KeySignature } from '../model/KeySignature.js';
import type { TimeSignature } from '../model/TimeSignature.js';
import type { RhythmProfile } from './RhythmProfile.js';
import type { PitchRange } from './voices/IVoiceGenerator.js';

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
   * The keys the reader has, where they are fewer than a piano's.
   *
   * A fact about the instrument in the room rather than about the exercise,
   * which is why it travels with the request instead of being written into
   * every preset: the same level is the same level on a laptop and on a
   * grand, and only the octaves it can be played in differ.
   */
  readonly withinRange?: PitchRange;
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

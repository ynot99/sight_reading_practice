import type { Measure } from '../../model/Exercise.js';
import type { KeySignature } from '../../model/KeySignature.js';
import type { Pitch } from '../../model/Pitch.js';
import type { TimeSignature } from '../../model/TimeSignature.js';
import type { Rng } from '../Rng.js';

/** Inclusive playable span for one hand. */
export interface PitchRange {
  readonly lowest: Pitch;
  readonly highest: Pitch;
}

/** Everything a voice generator is allowed to know about the exercise. */
export interface VoiceContext {
  readonly rng: Rng;
  readonly key: KeySignature;
  readonly timeSignature: TimeSignature;
  readonly measures: number;
}

/**
 * Strategy that writes the music for a single staff.
 *
 * New material - arpeggios, two-voice counterpoint, chromatic passing notes -
 * arrives as a new implementation of this interface; no existing generator,
 * session or renderer code has to change.
 */
export interface IVoiceGenerator {
  readonly id: string;
  generate(context: VoiceContext): Measure[];
}

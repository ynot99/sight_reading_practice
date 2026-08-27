import type { RhythmOptions } from '../../src/domain/generation/RhythmFiller.js';
import type { RhythmProfile } from '../../src/domain/generation/RhythmProfile.js';
import type { Duration } from '../../src/domain/model/Duration.js';

/**
 * A profile that gives every role the same rhythm.
 *
 * Voice-generator tests are about pitch, not rhythm: they want one predictable
 * value per beat so that the notes can be counted, and they should not have to
 * care which role the voice under test happens to play.
 */
export function uniformProfile(rhythm: RhythmOptions): RhythmProfile {
  return {
    id: 'test.uniform',
    label: 'Uniform',
    description: 'One rhythm for every role.',
    byRole: { lead: rhythm, inner: rhythm, accompaniment: rhythm },
  };
}

/** Profile in which every voice plays nothing but `value`. */
export function steadyProfile(value: Duration): RhythmProfile {
  return uniformProfile({
    durations: [{ value, weight: 1 }],
    restProbability: 0,
    keepInsideBeats: true,
  });
}

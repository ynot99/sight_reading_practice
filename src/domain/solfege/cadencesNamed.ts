import type { Exercise } from '../model/Exercise.js';
import { aRoundOfProgressions, type ProgressionsAsked } from './functionsNamed.js';

/**
 * The cadences a harmony course names, each by the progressions of four
 * chords that close on it, as degrees of their roots: the authentic,
 * dominant to tonic; the plagal, subdominant to tonic; the half, closing
 * on the dominant; and the deceptive, the dominant going to the
 * submediant instead of the tonic it promised.
 */
export const CADENCES = [
  {
    called: 'Authentic',
    progressions: [
      [0, 3, 4, 0],
      [0, 1, 4, 0],
      [0, 5, 4, 0],
    ],
  },
  {
    called: 'Plagal',
    progressions: [
      [0, 5, 3, 0],
      [0, 4, 3, 0],
      [0, 2, 3, 0],
    ],
  },
  {
    called: 'Half',
    progressions: [
      [0, 3, 0, 4],
      [0, 5, 1, 4],
      [0, 1, 3, 4],
    ],
  },
  {
    called: 'Deceptive',
    progressions: [
      [0, 3, 4, 5],
      [0, 1, 4, 5],
    ],
  },
] as const;

/** What a round of cadences to be named is filed as. */
export const CADENCES_BY_NAME_ID = 'solfege.cadences-by-name';

/**
 * A round of cadences to be named, a bar of four chords each in the key
 * asked, voiced as the functions are: which cadence the phrase closes on.
 * Heard - each phrase played as it is asked, its notes kept off the page
 * until it is answered - as cadences are first told apart, or read.
 *
 * The same request is the same round; another seed, another.
 */
export function theCadencesNamed(asked: ProgressionsAsked): Exercise {
  const choices = CADENCES.map((cadence) => cadence.called);
  return aRoundOfProgressions(asked, { id: CADENCES_BY_NAME_ID, title: asked.heard ? 'Cadences by ear' : 'Cadences by name' }, (rng) => {
    const cadence = rng.pick(CADENCES);
    const progressions: readonly (readonly number[])[] = cadence.progressions;
    return { degrees: rng.pick(progressions), parts: [{ asks: 'Cadence', choices, answer: cadence.called }] };
  });
}

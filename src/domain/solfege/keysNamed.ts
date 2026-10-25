import { Duration } from '../model/Duration.js';
import type { Exercise, KeyChange } from '../model/Exercise.js';
import { measureOf, restEntry } from '../model/Exercise.js';
import { KeySignature } from '../model/KeySignature.js';
import { alterationSign } from '../model/Pitch.js';
import { TimeSignature } from '../model/TimeSignature.js';
import { createRng } from '../generation/Rng.js';
import { theTonicOfTheScale } from '../harmony/scales.js';

/** Which keys a signature is asked to be named as: its major, its minor, or either. */
export const KEYS_ASKED = ['major', 'minor', 'either'] as const;
export type KeysAsked = (typeof KEYS_ASKED)[number];

/** A round of key signatures to be named: as which keys, and the seed that chooses them. */
export interface SignaturesAsked {
  readonly as: KeysAsked;
  readonly seed: number;
}

/** How many signatures a round asks. */
export const SIGNATURES_IN_A_ROUND = 10;

/** What a round of key signatures to be named is filed as. */
export const KEYS_BY_NAME_ID = 'solfege.keys-by-name';

const TIME = new TimeSignature(4, 4);

/** Every signature, seven flats to seven sharps. */
const SIGNATURES = Array.from({ length: 15 }, (_, at) => at - 7);

/** The tonic of the key a signature is, in major or in minor: "B♭", "F♯". */
export function theTonicNamed(fifths: number, minor: boolean): string {
  const { step, alter } = theTonicOfTheScale(fifths, minor ? 'minor' : 'major');
  return `${step}${alterationSign(alter)}`;
}

/**
 * A round of key signatures to be named, a bar each with nothing in it but
 * the signature and a rest: which major key it is, or which minor, or -
 * asked either - one or the other, the question saying which. Its choices
 * are every tonic of the mode asked, by the circle of fifths from seven
 * flats to seven sharps. No signature follows itself: written again, it
 * would not be printed again.
 *
 * The same request is the same round; another seed, another.
 */
export function theKeysNamed(asked: SignaturesAsked): Exercise {
  const rng = createRng(asked.seed);
  const questions: { readonly fifths: number; readonly minor: boolean }[] = [];
  for (let at = 0; at < SIGNATURES_IN_A_ROUND; at += 1) {
    const before = questions.at(-1)?.fifths;
    const fifths = rng.pick(SIGNATURES.filter((each) => each !== before));
    questions.push({ fifths, minor: asked.as === 'minor' || (asked.as === 'either' && rng.next() < 0.5) });
  }
  const keyOf = ({ fifths, minor }: { readonly fifths: number; readonly minor: boolean }): KeySignature =>
    minor ? KeySignature.minor(fifths) : KeySignature.major(fifths);
  const keyChanges: KeyChange[] = questions.slice(1).map((question, at) => ({ measureIndex: at + 1, key: keyOf(question) }));
  return {
    id: `${KEYS_BY_NAME_ID}:${String(asked.seed)}`,
    title: 'Keys by name',
    key: keyOf(questions[0] ?? { fifths: 0, minor: false }),
    keyChanges,
    timeChanges: [],
    tempoChanges: [],
    pedalMarks: [],
    dynamicMarks: [],
    tempoWords: [],
    hairpins: [],
    octaveShifts: [],
    timeSignature: TIME,
    tempoBpm: 60,
    firstBarNumber: 1,
    barLabels: [],
    staves: [{ staffNumber: 1, voice: 1, clef: 'treble', clefChanges: [], measures: questions.map(() => measureOf([restEntry(Duration.WHOLE)])) }],
    metadata: { generatorId: KEYS_BY_NAME_ID, seed: asked.seed },
    byName: questions.map((question, measureIndex) => ({
      measureIndex,
      parts: [
        {
          asks: question.minor ? 'Minor key' : 'Major key',
          choices: SIGNATURES.map((fifths) => theTonicNamed(fifths, question.minor)),
          answer: theTonicNamed(question.fifths, question.minor),
        },
      ],
    })),
  };
}

import type { Exercise, KeyChange, MusicalEntry, RehearsalMark } from '../model/Exercise.js';
import { noteEntry } from '../model/Exercise.js';
import { KeySignature } from '../model/KeySignature.js';
import { Pitch } from '../model/Pitch.js';
import { TimeSignature } from '../model/TimeSignature.js';
import { createRng } from '../generation/Rng.js';
import { theNameOfTheKey } from '../harmony/scales.js';
import { intoBars } from './bars.js';
import { aStepOfTheKey } from './cadence.js';
import { aPhrase } from './melodicDictation.js';

/**
 * The transpositions a reader is first asked for: a phrase moved to the key
 * a second, a third or a fourth away, each by the letters its tonic moves and
 * the fifths its signature does - up a major second, two sharps more.
 */
export const TRANSPOSITIONS = {
  upASecond: { called: 'Up a major second', letters: 1, fifths: 2 },
  downASecond: { called: 'Down a major second', letters: -1, fifths: -2 },
  upAThird: { called: 'Up a minor third', letters: 2, fifths: -3 },
  downAThird: { called: 'Down a minor third', letters: -2, fifths: 3 },
  upAFourth: { called: 'Up a fourth', letters: 3, fifths: -1 },
  downAFourth: { called: 'Down a fourth', letters: -3, fifths: 1 },
} as const;
export type TranspositionName = keyof typeof TRANSPOSITIONS;
export const TRANSPOSITION_NAMES = Object.keys(TRANSPOSITIONS) as TranspositionName[];

/** A round of phrases to transpose: from which key, by how far, and the seed that writes them. */
export interface TranspositionAsked {
  readonly fifths: number;
  readonly minor: boolean;
  readonly by: TranspositionName;
  readonly seed: number;
}

/** How many phrases a round asks to be transposed. */
export const TRANSPOSITIONS_IN_A_ROUND = 3;

/** What a round of transposition is filed as. */
export const TRANSPOSITION_ID = 'solfege.transposition';

/** How long a phrase is, in bars, written out once and then transposed. */
const PHRASE_BARS = 2;

const TIME = new TimeSignature(4, 4);

/** Signatures a key may be written in; past them, one the same keys spelled the other way. */
const FARTHEST = 7;
const KEYS_ROUND = 12;

/**
 * A round of transposition, as a teacher sets it: a short phrase written in
 * its key, played as written; then the same phrase to be played in another
 * key, a second, a third or a fourth away, its signature printed and named
 * over it - and its notes kept off the page but the first, each found by
 * reading the phrase before in the new key, and shown as it is.
 *
 * The phrase is written as a first dictation is (see `aPhrase`), so it is a
 * tune and not a scale, and transposed by its steps: the same degrees of the
 * new key, its leading note raised in minor as in the old. A key past seven
 * sharps or flats is written as the one the same keys spell the other way:
 * G sharp major as A flat.
 *
 * The same request is the same round; another seed, another.
 */
export function theTransposition(asked: TranspositionAsked): Exercise {
  const rng = createRng(asked.seed);
  const way = TRANSPOSITIONS[asked.by];
  const keyIn = (fifths: number): KeySignature => (asked.minor ? KeySignature.minor(fifths) : KeySignature.major(fifths));
  const from = keyIn(asked.fifths);
  const to = keyIn(theSignatureOf(asked.fifths + way.fifths));
  const fromTonic = from.tonicIndexAtOrAbove(Pitch.parse('C4').diatonicIndex);
  // The new tonic as near as its letters say: the one a few steps under where it would be, or above.
  const toTonic = to.tonicIndexAtOrAbove(fromTonic + way.letters - 3);

  const measures: MusicalEntry[][] = [];
  const keyChanges: KeyChange[] = [];
  const marks: RehearsalMark[] = [];
  const questions: { readonly from: number; readonly until: number }[] = [];
  for (let at = 0; at < TRANSPOSITIONS_IN_A_ROUND; at += 1) {
    const phrase = aPhrase(rng, { bars: PHRASE_BARS, rhythm: 'crotchets', minor: asked.minor });
    const written = at * 2 * PHRASE_BARS;
    const moved = written + PHRASE_BARS;
    if (at > 0) {
      keyChanges.push({ measureIndex: written, key: from });
    }
    keyChanges.push({ measureIndex: moved, key: to });
    marks.push({ measureIndex: moved, offsetTicks: 0, text: `In ${theNameOfTheKey({ fifths: to.fifths, scale: asked.minor ? 'minor' : 'major' })}` });
    questions.push({ from: moved, until: moved + PHRASE_BARS });
    measures.push(
      phrase.map(({ step, length }) => noteEntry(aStepOfTheKey(from, fromTonic, step, asked.minor), length)),
      phrase.map(({ step, length }) => noteEntry(aStepOfTheKey(to, toTonic, step, asked.minor), length)),
    );
  }
  return {
    id: `${TRANSPOSITION_ID}:${String(asked.seed)}`,
    title: `${way.called}: ${theNameOfTheKey({ fifths: from.fifths, scale: asked.minor ? 'minor' : 'major' })} to ${theNameOfTheKey({
      fifths: to.fifths,
      scale: asked.minor ? 'minor' : 'major',
    })}`,
    key: from,
    keyChanges,
    timeChanges: [],
    tempoChanges: [],
    pedalMarks: [],
    dynamicMarks: [],
    tempoWords: [],
    hairpins: [],
    octaveShifts: [],
    timeSignature: TIME,
    tempoBpm: 72,
    firstBarNumber: 1,
    barLabels: [],
    staves: [{ staffNumber: 1, voice: 1, clef: 'treble', clefChanges: [], measures: measures.flatMap((part) => intoBars(part, TIME)) }],
    rehearsalMarks: marks,
    metadata: { generatorId: TRANSPOSITION_ID, seed: asked.seed },
    playedBack: { questions, heard: false, keyFirst: false },
  };
}

/** A signature moved round the circle past seven sharps or flats: written as the keys the other way spell it. */
function theSignatureOf(fifths: number): number {
  return fifths > FARTHEST ? fifths - KEYS_ROUND : fifths < -FARTHEST ? fifths + KEYS_ROUND : fifths;
}

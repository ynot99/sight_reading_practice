import { Duration } from '../model/Duration.js';
import type { Exercise, NamingQuestion } from '../model/Exercise.js';
import { measureOf, noteEntry } from '../model/Exercise.js';
import { KeySignature } from '../model/KeySignature.js';
import type { Pitch } from '../model/Pitch.js';
import { TimeSignature } from '../model/TimeSignature.js';
import { createRng } from '../generation/Rng.js';
import { theChordTheKeysMake, theNumeralOfTheChord } from '../harmony/chordName.js';
import type { ScaleName } from '../harmony/scales.js';
import { aStepOfTheKey, OCTAVE, theTonicOfTheHand } from './cadence.js';
import { theNearestVoicing } from './voicing.js';

/** A round of progressions to be named: the key, and the seed that chooses them. */
export interface ProgressionsAsked {
  readonly fifths: number;
  readonly minor: boolean;
  /** Whether each progression is heard rather than read: see `Exercise.namedByEar`. */
  readonly heard: boolean;
  readonly seed: number;
}

/** How many progressions a round asks: each is four chords. */
export const PROGRESSIONS_IN_A_ROUND = 6;

/** What a round of progressions to be named is filed as. */
export const FUNCTIONS_BY_NAME_ID = 'solfege.functions-by-name';

const TIME = new TimeSignature(4, 4);

/**
 * The progressions a first harmony course has a reader name, as the
 * degrees of their roots from the tonic: each opens on the tonic, or its
 * relative, and moves through the subdominant to the dominant, or closes
 * on the tonic, as the functions go - tonic, subdominant, dominant, tonic.
 */
const PROGRESSIONS: readonly (readonly number[])[] = [
  [0, 3, 4, 0],
  [0, 5, 3, 4],
  [0, 1, 4, 0],
  [0, 3, 0, 4],
  [0, 5, 1, 4],
  [0, 4, 5, 3],
  [0, 2, 3, 4],
  [5, 3, 0, 4],
];

/** The degrees whose chord holds the leading note, raised in minor as harmony raises it: the dominant and the seventh. */
const LEADING = [4, 6];

/**
 * A round of progressions to be named, a bar each: four chords, the root in
 * the left hand and three voices in the right, each named by the numeral of
 * its root in the key - as the chart of chords numbers them, and with the
 * choices it would give: the seven of the key. In minor the dominant and
 * the chord on the leading note have it raised, as harmonic minor does, and
 * are numbered in that scale.
 *
 * The right hand moves as little as it can from one chord to the next, as
 * a keyboard harmony lesson voices them, so the reader names a chord from
 * its notes however it stands.
 *
 * Read off the page, or heard - each progression played as it is asked,
 * its notes kept off the page until it is answered - as functions are first
 * named by ear.
 *
 * The same request is the same round; another seed, another.
 */
export function theFunctionsNamed(asked: ProgressionsAsked): Exercise {
  const rng = createRng(asked.seed);
  const key = asked.minor ? KeySignature.minor(asked.fifths) : KeySignature.major(asked.fifths);
  const scale: ScaleName = asked.minor ? 'harmonicMinor' : 'major';
  const tonic = theTonicOfTheHand(key);
  const triad = (degree: number): Pitch[] =>
    [0, 2, 4].map((step) => aStepOfTheKey(key, tonic, degree + step, LEADING.includes(degree)));
  const numeralOf = (degree: number): string => {
    const chord = theChordTheKeysMake(triad(degree).map((pitch) => pitch.midi), asked.fifths, scale);
    return chord === null ? '' : theNumeralOfTheChord(chord, { fifths: asked.fifths, scale });
  };
  const choices = Array.from({ length: OCTAVE }, (_, degree) => numeralOf(degree));

  const questions: { readonly right: Pitch[][]; readonly left: Pitch[]; readonly question: NamingQuestion }[] = [];
  for (let at = 0; at < PROGRESSIONS_IN_A_ROUND; at += 1) {
    const degrees = rng.pick(PROGRESSIONS);
    const right: Pitch[][] = [];
    for (const degree of degrees) {
      right.push(theNearestVoicing(triad(degree), right.at(-1) ?? null));
    }
    questions.push({
      right,
      left: degrees.map((degree) => aStepOfTheKey(key, tonic - OCTAVE, degree > 3 ? degree - OCTAVE : degree, LEADING.includes(degree))),
      question: {
        measureIndex: at,
        parts: degrees.map((degree, place) => ({ asks: `Chord ${String(place + 1)}`, choices, answer: numeralOf(degree) })),
      },
    });
  }
  return {
    id: `${FUNCTIONS_BY_NAME_ID}:${String(asked.seed)}`,
    title: asked.heard ? 'Functions by ear' : 'Functions by name',
    key,
    keyChanges: [],
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
    staves: [
      {
        staffNumber: 1,
        voice: 1,
        clef: 'treble',
        clefChanges: [],
        measures: questions.map(({ right }) => measureOf(right.map((chord) => noteEntry(chord, Duration.QUARTER)))),
      },
      {
        staffNumber: 2,
        voice: 2,
        clef: 'bass',
        clefChanges: [],
        measures: questions.map(({ left }) => measureOf(left.map((root) => noteEntry(root, Duration.QUARTER)))),
      },
    ],
    metadata: { generatorId: FUNCTIONS_BY_NAME_ID, seed: asked.seed },
    byName: questions.map(({ question }) => question),
    ...(asked.heard ? { namedByEar: true } : {}),
  };
}

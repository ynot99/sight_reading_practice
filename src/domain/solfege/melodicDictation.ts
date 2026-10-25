import { Duration } from '../model/Duration.js';
import type { Exercise } from '../model/Exercise.js';
import { noteEntry } from '../model/Exercise.js';
import { KeySignature } from '../model/KeySignature.js';
import { Pitch } from '../model/Pitch.js';
import { TimeSignature } from '../model/TimeSignature.js';
import { createRng, type Rng } from '../generation/Rng.js';
import { intoBars } from './bars.js';
import { aStepOfTheKey, OCTAVE } from './cadence.js';

/** How long a dictation is, in bars: a phrase, or two of them. */
export const DICTATION_LENGTHS = [2, 4] as const;
export type DictationLength = (typeof DICTATION_LENGTHS)[number];

/** Its rhythm: crotchets only, or some beats in two quavers. */
export const DICTATION_RHYTHMS = ['crotchets', 'quavers'] as const;
export type DictationRhythm = (typeof DICTATION_RHYTHMS)[number];

/** A round of dictations asked for: the key, how long each is, its rhythm, and the seed that writes them. */
export interface DictationAsked {
  readonly fifths: number;
  readonly minor: boolean;
  readonly bars: DictationLength;
  readonly rhythm: DictationRhythm;
  readonly seed: number;
}

/** How many dictations a round asks: four phrases is a lesson's worth. */
export const DICTATIONS_IN_A_ROUND = 4;

/** What a round of dictations is filed as. */
export const MELODIC_DICTATION_ID = 'solfege.melodic-dictation';

/** A walking pace, so each note is heard before the next. */
const DICTATION_BPM = 72;

const TIME = new TimeSignature(4, 4);

/** How likely a beat is to be two quavers, where they are asked for. */
const QUAVERS_ON_A_BEAT = 0.35;

/**
 * How far a melody goes from its tonic, in steps of the scale: down to the
 * dominant under it, up to the tonic above - and, in a phrase of four bars,
 * the third over that.
 */
const LOWEST_STEP = -3;
const HIGHEST_STEP: Readonly<Record<DictationLength, number>> = { 2: OCTAVE, 4: OCTAVE + 2 };

/** The notes of the tonic triad, as steps from the tonic, within the range: where a melody may leap to. */
const THE_TONIC_TRIAD = [-3, 0, 2, 4, 7, 9];

/** The leap a phrase allows: a sixth, and no further. */
const WIDEST_LEAP = 5;

/**
 * A round of melodic dictations, as a music school sets them: in each, the
 * key heard first by its cadence, then a phrase played; its first note is
 * given, the rest found by ear and played back (see `Exercise.playedBack`).
 *
 * Each phrase is written as a first dictation is: it begins on a note of the
 * tonic triad, moves mostly by step, leaps only to a note of the tonic triad
 * and no wider than a sixth, and closes on the tonic, reached by a step from
 * the second or the leading note - itself reached by a step or a third, as
 * the fifth goes up to the leading note - and held for two beats. In minor the leading
 * note is raised wherever it is sung, as harmonic minor raises it, and never
 * next to the sixth below it - an augmented second is a hard interval for a
 * first ear. Every note is spelled as the key writes it.
 *
 * The same request is the same round; another seed, another.
 */
export function theMelodicDictation(asked: DictationAsked): Exercise {
  const rng = createRng(asked.seed);
  const key = asked.minor ? KeySignature.minor(asked.fifths) : KeySignature.major(asked.fifths);
  const tonic = key.tonicIndexAtOrAbove(Pitch.parse('C4').diatonicIndex);
  const entries = Array.from({ length: DICTATIONS_IN_A_ROUND }, () =>
    aPhrase(rng, asked).map(({ step, length }) => noteEntry(aStepOfTheKey(key, tonic, step, asked.minor), length)),
  );
  return {
    id: `${MELODIC_DICTATION_ID}:${String(asked.seed)}`,
    title: 'Melodic dictation',
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
    tempoBpm: DICTATION_BPM,
    firstBarNumber: 1,
    barLabels: [],
    staves: [{ staffNumber: 1, voice: 1, clef: 'treble', clefChanges: [], measures: entries.flatMap((phrase) => intoBars(phrase, TIME)) }],
    metadata: { generatorId: MELODIC_DICTATION_ID, seed: asked.seed },
    playedBack: { questions: entries.map((_, at) => ({ from: at * asked.bars, until: (at + 1) * asked.bars })), heard: true, keyFirst: true },
  };
}

/** A note of a phrase: its step from the tonic, and how long it lasts. */
export interface NoteOfAPhrase {
  readonly step: number;
  readonly length: Duration;
}

/**
 * One phrase as a first dictation is written - see `theMelodicDictation` -
 * note by note, as steps from its tonic: for a dictation, and for a phrase
 * to be transposed.
 */
export function aPhrase(rng: Rng, asked: Pick<DictationAsked, 'bars' | 'rhythm' | 'minor'>): NoteOfAPhrase[] {
  // Its rhythm first: every beat but the last two a crotchet or two quavers,
  // and the tonic held over those two.
  const beats = asked.bars * TIME.beats - 2;
  const lengths = Array.from({ length: beats }, () =>
    asked.rhythm === 'quavers' && rng.next() < QUAVERS_ON_A_BEAT ? [Duration.EIGHTH, Duration.EIGHTH] : [Duration.QUARTER],
  ).flat();
  const highest = HIGHEST_STEP[asked.bars];
  const steps: number[] = [rng.weighted<number>([
    { value: 0, weight: 3 },
    { value: 2, weight: 1 },
    { value: 4, weight: 1 },
  ])];
  // Up to the note before the last: free, within the rules.
  // The second or the leading note a note may go on to before the tonic, nearest first.
  const leadingFrom = (before: number): number[] =>
    [1, -1, OCTAVE - 1, OCTAVE + 1]
      .filter(
        (step) =>
          step >= LOWEST_STEP &&
          step <= highest &&
          step !== before &&
          Math.abs(step - before) <= 2 &&
          !anAugmentedSecond(before, step, asked.minor),
      )
      .sort((one, other) => Math.abs(one - before) - Math.abs(other - before));
  // The last of them free chosen among those that can go on to one.
  while (steps.length < lengths.length - 1) {
    const last = steps.length === lengths.length - 2;
    steps.push(aNextStep(rng, steps.at(-1) ?? 0, highest, asked.minor, (step) => !last || leadingFrom(step).length > 0));
  }
  const penultimate = leadingFrom(steps.at(-1) ?? 0)[0] ?? 1;
  steps.push(penultimate);
  steps.push(penultimate < OCTAVE / 2 ? 0 : OCTAVE);
  return steps.map((step, at) => ({ step, length: lengths[at] ?? Duration.HALF }));
}

/** The note after one: a step mostly, now and then a leap to the tonic triad, never an augmented second, and one the phrase can go on from. */
function aNextStep(rng: Rng, from: number, highest: number, minor: boolean, goesOn: (step: number) => boolean): number {
  const steps = [from - 1, from + 1].filter((step) => step >= LOWEST_STEP && step <= highest);
  const leaps = THE_TONIC_TRIAD.filter(
    (step) => step <= highest && Math.abs(step - from) > 1 && Math.abs(step - from) <= WIDEST_LEAP,
  );
  const choices = [
    ...steps.map((value) => ({ value, weight: 3 })),
    ...leaps.map((value) => ({ value, weight: 1 / Math.max(1, leaps.length / 2) })),
  ].filter(({ value }) => !anAugmentedSecond(from, value, minor) && goesOn(value));
  return choices.length === 0 ? from : rng.weighted(choices);
}

/** Whether a move between two steps is harmonic minor's augmented second: the sixth and the raised seventh. */
function anAugmentedSecond(from: number, to: number, minor: boolean): boolean {
  const degree = (step: number): number => ((step % OCTAVE) + OCTAVE) % OCTAVE;
  return minor && Math.abs(to - from) === 1 && [degree(from), degree(to)].sort().join() === '5,6';
}

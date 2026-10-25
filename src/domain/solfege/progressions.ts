import { Duration } from '../model/Duration.js';
import type { Exercise, KeyChange, MusicalEntry } from '../model/Exercise.js';
import { noteEntry } from '../model/Exercise.js';
import { KeySignature } from '../model/KeySignature.js';
import { Pitch } from '../model/Pitch.js';
import { TimeSignature } from '../model/TimeSignature.js';
import { theChordTheKeysMake, theNumeralOfTheChord } from '../harmony/chordName.js';
import { theNameOfTheKey } from '../harmony/scales.js';
import { intoBars } from './bars.js';
import { aStepOfTheKey, OCTAVE, theTonicOfTheHand } from './cadence.js';
import { theNearestVoicing } from './voicing.js';

/** A chord of a progression: the degree of its root, and whether it carries its seventh. */
interface ChordOfAProgression {
  readonly degree: number;
  readonly seventh: boolean;
}

const triad = (degree: number): ChordOfAProgression => ({ degree, seventh: false });
const seventh = (degree: number): ChordOfAProgression => ({ degree, seventh: true });

/**
 * The progressions a keyboard harmony course has played in every key: the
 * cadence, the cadence with the dominant seventh resolving, the turnaround
 * through the relative and the supertonic, the two-five-one in sevenths, and
 * the circle of fifths falling through every degree of the key to the tonic.
 */
export const PROGRESSIONS = {
  cadence: [triad(0), triad(3), triad(4), triad(0)],
  dominantSeventh: [triad(0), triad(3), seventh(4), triad(0)],
  turnaround: [triad(0), triad(5), triad(1), triad(4), triad(0)],
  twoFiveOne: [seventh(1), seventh(4), triad(0)],
  circle: [triad(0), triad(3), triad(6), triad(2), triad(5), triad(1), triad(4), triad(0)],
} as const satisfies Readonly<Record<string, readonly ChordOfAProgression[]>>;
export type ProgressionName = keyof typeof PROGRESSIONS;
export const PROGRESSION_NAMES = Object.keys(PROGRESSIONS) as ProgressionName[];

/** A progression asked for: which, in which key, and whether in that key alone or through every key. */
export interface ProgressionAsked {
  readonly progression: ProgressionName;
  readonly fifths: number;
  readonly minor: boolean;
  readonly throughEveryKey: boolean;
}

/** What a progression to play is filed as. */
export const PROGRESSION_ID = 'solfege.progression';

const TIME = new TimeSignature(4, 4);

/** Where each hand's chords lie: the right hand round middle C, the left hand's roots under it. */
const RIGHT_HAND = { lowest: Pitch.parse('F3').midi, highest: Pitch.parse('A5').midi };
const LEFT_HAND = { lowest: Pitch.parse('E2').midi, highest: Pitch.parse('E3').midi };

/** Of the circle's twelve keys, how far each is from the one before: a fifth down, so each key is the subdominant of the last. */
const DOWN_A_FIFTH = -1;
const KEYS_IN_THE_CIRCLE = 12;

/** The dominant: the one degree whose chord has the leading note raised in minor, as harmony raises it. */
const DOMINANT = 4;

/**
 * A progression to be played, a chord a minim, the right hand in three
 * voices moving as little as it can from chord to chord and the left hand
 * on the roots - in its key, or through every key round the circle, each a
 * fifth below the one before, as one key leads into the next. The key is
 * printed as its signature changes and nothing else is: no names or
 * numerals over the chords, which would take away the work.
 *
 * A chord with its seventh has the third, the fifth and the seventh in the
 * right hand over the root in the left, as keyboard harmony voices one. In
 * minor the dominant is major, its leading note raised; the circle's chord
 * on the seventh degree keeps it unraised, as the sequence falls through
 * the natural minor.
 */
export function theProgression(asked: ProgressionAsked): Exercise {
  const chords = PROGRESSIONS[asked.progression];
  const keys = asked.throughEveryKey
    ? Array.from({ length: KEYS_IN_THE_CIRCLE }, (_, at) => theSignatureAround(asked.fifths + at * DOWN_A_FIFTH))
    : [asked.fifths];
  const right: MusicalEntry[] = [];
  const left: MusicalEntry[] = [];
  const keyChanges: KeyChange[] = [];
  let bars = 0;
  let hand: Pitch[] | null = null;
  let bass: Pitch | null = null;
  for (const fifths of keys) {
    const key = asked.minor ? KeySignature.minor(fifths) : KeySignature.major(fifths);
    if (bars > 0) {
      keyChanges.push({ measureIndex: bars, key });
    }
    const tonic = theTonicOfTheHand(key);
    const rights: MusicalEntry[] = [];
    const lefts: MusicalEntry[] = [];
    chords.forEach((chord, at) => {
      const raised = chord.degree === DOMINANT;
      const steps = chord.seventh ? [2, 4, 6] : [0, 2, 4];
      const upper = steps.map((step) => aStepOfTheKey(key, tonic, chord.degree + step, raised));
      hand = theNearestVoicing(upper, hand, RIGHT_HAND);
      const root = aStepOfTheKey(key, tonic - 2 * OCTAVE, chord.degree, raised);
      bass = theNearestVoicing([root], bass === null ? null : [bass], LEFT_HAND)[0] ?? root;
      // A minim each, the last a semibreve where the chords leave half a bar.
      const length = at === chords.length - 1 && chords.length % 2 === 1 ? Duration.WHOLE : Duration.HALF;
      rights.push(noteEntry(hand, length));
      lefts.push(noteEntry(bass, length));
    });
    right.push(...rights);
    left.push(...lefts);
    bars += intoBars(rights, TIME).length;
  }
  const opening = asked.minor ? KeySignature.minor(keys[0] ?? 0) : KeySignature.major(keys[0] ?? 0);
  const named = theProgressionNamed(asked.progression, asked.minor);
  const where = asked.throughEveryKey ? 'through every key' : `in ${theNameOfTheKey({ fifths: asked.fifths, scale: asked.minor ? 'minor' : 'major' })}`;
  return {
    id: `${PROGRESSION_ID}:${asked.progression}:${String(asked.fifths)}:${asked.minor ? 'minor' : 'major'}:${String(asked.throughEveryKey)}`,
    title: `${named} ${where}`,
    key: opening,
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
    staves: [
      { staffNumber: 1, voice: 1, clef: 'treble', clefChanges: [], measures: intoBars(right, TIME) },
      { staffNumber: 2, voice: 2, clef: 'bass', clefChanges: [], measures: intoBars(left, TIME) },
    ],
    metadata: { generatorId: PROGRESSION_ID, seed: 0 },
  };
}

/**
 * What a progression is called in a mode, by the numerals of its chords as
 * the chart of chords numbers them - "I–IV–V7–I", "ii°7–V7–i" - so the list
 * and the chart say the same.
 */
export function theProgressionNamed(progression: ProgressionName, minor: boolean): string {
  const key = minor ? KeySignature.minor(0) : KeySignature.major(0);
  const scale = minor ? 'harmonicMinor' : 'major';
  const tonic = theTonicOfTheHand(key);
  return PROGRESSIONS[progression]
    .map((chord) => {
      const raised = chord.degree === DOMINANT;
      const keys = [0, 2, 4, ...(chord.seventh ? [6] : [])].map((step) => aStepOfTheKey(key, tonic, chord.degree + step, raised).midi);
      const heard = theChordTheKeysMake(keys, 0, scale);
      return heard === null ? '?' : theNumeralOfTheChord(heard, { fifths: 0, scale });
    })
    .join('–');
}

/** A signature round the circle, kept between six flats and five sharps: G flat rather than F sharp, B rather than C flat. */
function theSignatureAround(fifths: number): number {
  return ((((fifths + 6) % KEYS_IN_THE_CIRCLE) + KEYS_IN_THE_CIRCLE) % KEYS_IN_THE_CIRCLE) - 6;
}

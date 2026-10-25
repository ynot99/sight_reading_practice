import { Duration } from '../model/Duration.js';
import type { Exercise, NamingPart } from '../model/Exercise.js';
import { measureOf, noteEntry } from '../model/Exercise.js';
import { KeySignature } from '../model/KeySignature.js';
import { Pitch } from '../model/Pitch.js';
import { TimeSignature } from '../model/TimeSignature.js';
import { createRng } from '../generation/Rng.js';

/**
 * The triads, each by the semitones of its third and fifth over the root:
 * the four a first harmony course names.
 */
export const TRIADS = [
  { called: 'Major', third: 4, fifth: 7 },
  { called: 'Minor', third: 3, fifth: 7 },
  { called: 'Diminished', third: 3, fifth: 6 },
  { called: 'Augmented', third: 4, fifth: 8 },
] as const;

/**
 * The seventh chords, each by the semitones of its third, fifth and seventh
 * over the root: the five a harmony course names after the triads.
 */
export const SEVENTHS = [
  { called: 'Dominant seventh', third: 4, fifth: 7, seventh: 10 },
  { called: 'Major seventh', third: 4, fifth: 7, seventh: 11 },
  { called: 'Minor seventh', third: 3, fifth: 7, seventh: 10 },
  { called: 'Half-diminished seventh', third: 3, fifth: 6, seventh: 10 },
  { called: 'Diminished seventh', third: 3, fifth: 6, seventh: 9 },
] as const;

/** Where a triad's root stands: at the bottom, or under its third or its fifth. */
export const POSITIONS = ['Root position', 'First inversion', 'Second inversion'] as const;

/**
 * A round of chords to be named: what is asked of them - their quality as
 * triads, their position too, or their quality among triads and sevenths -
 * whether they are heard or read, and the seed that chooses them.
 */
export interface ChordsAsked {
  readonly asks: ChordsAsks;
  readonly heard: boolean;
  readonly seed: number;
}

/** What a round of chords asks of each. */
export const CHORDS_ASKS = ['quality', 'positions', 'sevenths'] as const;
export type ChordsAsks = (typeof CHORDS_ASKS)[number];

/** How many chords a round asks. */
export const CHORDS_IN_A_ROUND = 10;

/** What a round of chords to be named is filed as. */
export const CHORDS_BY_NAME_ID = 'solfege.chords-by-name';

const TIME = new TimeSignature(4, 4);

/** The notes a chord may use: the treble staff and a ledger line or two either side. */
const LOWEST = Pitch.parse('A3').midi;
const HIGHEST = Pitch.parse('A5').midi;

/** The steps of a triad over its root: a third and a fifth, two letters each. */
const LETTERS = { third: 2, fifth: 4, seventh: 6 } as const;

/** Steps to the octave, and the semitones of one. */
const OCTAVE_LETTERS = 7;
const OCTAVE_SEMITONES = 12;

/**
 * A round of chords to be named, a bar each, held for the bar: which of the
 * four triads it is - and, where asked, where it stands, its root at the
 * bottom or under its third or its fifth - or which of the triads and the
 * seventh chords, in root position. Read off the page, or heard, its notes
 * kept off it until it is answered (see `Exercise.namedByEar`), as a chord
 * is first named by ear. Every note is spelled as the chord writes
 * it, a third and a fifth over the root by their letters - an augmented
 * triad on A sharp has its fifth on E double sharp - and the roots are as
 * often with flats as with sharps, every one fitted between the A under
 * middle C and the A two octaves up.
 *
 * The same request is the same round; another seed, another.
 */
export function theChordsNamed(asked: ChordsAsked): Exercise {
  const rng = createRng(asked.seed);
  const inversions = asked.asks === 'positions';
  const kinds: readonly { readonly called: string; readonly third: number; readonly fifth: number; readonly seventh?: number }[] =
    asked.asks === 'sevenths' ? [...TRIADS, ...SEVENTHS] : TRIADS;
  const questions = Array.from({ length: CHORDS_IN_A_ROUND }, () => {
    const triad = rng.pick(kinds);
    const position = inversions ? rng.int(0, POSITIONS.length - 1) : 0;
    // As high as the inversion puts its highest note, and no higher.
    const span = position === 0 ? (triad.seventh ?? triad.fifth) : position === 1 ? OCTAVE_SEMITONES : triad.third + OCTAVE_SEMITONES;
    const root = Pitch.fromMidi(rng.int(LOWEST, HIGHEST - span), rng.next() < 0.5);
    const third = Pitch.writtenAt(root.diatonicIndex + LETTERS.third, root.midi + triad.third);
    const fifth = Pitch.writtenAt(root.diatonicIndex + LETTERS.fifth, root.midi + triad.fifth);
    const up = (pitch: Pitch): Pitch => Pitch.writtenAt(pitch.diatonicIndex + OCTAVE_LETTERS, pitch.midi + OCTAVE_SEMITONES);
    const seventh = triad.seventh === undefined ? [] : [Pitch.writtenAt(root.diatonicIndex + LETTERS.seventh, root.midi + triad.seventh)];
    const notes = position === 0 ? [root, third, fifth, ...seventh] : position === 1 ? [third, fifth, up(root)] : [fifth, up(root), up(third)];
    const parts: NamingPart[] = [{ asks: 'Quality', choices: kinds.map((each) => each.called), answer: triad.called }];
    if (inversions) {
      parts.push({ asks: 'Position', choices: [...POSITIONS], answer: POSITIONS[position] ?? 'Root position' });
    }
    return { measure: measureOf([noteEntry(notes, Duration.WHOLE)]), parts };
  });
  return {
    id: `${CHORDS_BY_NAME_ID}:${String(asked.seed)}`,
    title: asked.heard ? 'Chords by ear' : 'Chords by name',
    key: KeySignature.C_MAJOR,
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
    staves: [{ staffNumber: 1, voice: 1, clef: 'treble', clefChanges: [], measures: questions.map((question) => question.measure) }],
    metadata: { generatorId: CHORDS_BY_NAME_ID, seed: asked.seed },
    byName: questions.map((question, measureIndex) => ({ measureIndex, parts: question.parts })),
    ...(asked.heard ? { namedByEar: true } : {}),
  };
}

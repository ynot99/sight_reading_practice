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

/** Where a triad's root stands: at the bottom, or under its third or its fifth. */
export const POSITIONS = ['Root position', 'First inversion', 'Second inversion'] as const;

/** A round of chords to be named: whether their positions are asked too, and the seed that chooses them. */
export interface ChordsAsked {
  readonly inversions: boolean;
  readonly seed: number;
}

/** How many chords a round asks. */
export const CHORDS_IN_A_ROUND = 10;

/** What a round of chords to be named is filed as. */
export const CHORDS_BY_NAME_ID = 'solfege.chords-by-name';

const TIME = new TimeSignature(4, 4);

/** The notes a chord may use: the treble staff and a ledger line or two either side. */
const LOWEST = Pitch.parse('A3').midi;
const HIGHEST = Pitch.parse('A5').midi;

/** The steps of a triad over its root: a third and a fifth, two letters each. */
const LETTERS = { third: 2, fifth: 4 } as const;

/** Steps to the octave, and the semitones of one. */
const OCTAVE_LETTERS = 7;
const OCTAVE_SEMITONES = 12;

/**
 * A round of triads to be named, a bar each, held for the bar: which of the
 * four it is - and, where asked, where it stands, its root at the bottom or
 * under its third or its fifth. Every note is spelled as the triad writes
 * it, a third and a fifth over the root by their letters - an augmented
 * triad on A sharp has its fifth on E double sharp - and the roots are as
 * often with flats as with sharps, every one fitted between the A under
 * middle C and the A two octaves up.
 *
 * The same request is the same round; another seed, another.
 */
export function theChordsNamed(asked: ChordsAsked): Exercise {
  const rng = createRng(asked.seed);
  const questions = Array.from({ length: CHORDS_IN_A_ROUND }, () => {
    const triad = rng.pick(TRIADS);
    const position = asked.inversions ? rng.int(0, POSITIONS.length - 1) : 0;
    // As high as the inversion puts its highest note, and no higher.
    const span = position === 0 ? triad.fifth : position === 1 ? OCTAVE_SEMITONES : triad.third + OCTAVE_SEMITONES;
    const root = Pitch.fromMidi(rng.int(LOWEST, HIGHEST - span), rng.next() < 0.5);
    const third = Pitch.writtenAt(root.diatonicIndex + LETTERS.third, root.midi + triad.third);
    const fifth = Pitch.writtenAt(root.diatonicIndex + LETTERS.fifth, root.midi + triad.fifth);
    const up = (pitch: Pitch): Pitch => Pitch.writtenAt(pitch.diatonicIndex + OCTAVE_LETTERS, pitch.midi + OCTAVE_SEMITONES);
    const notes = position === 0 ? [root, third, fifth] : position === 1 ? [third, fifth, up(root)] : [fifth, up(root), up(third)];
    const parts: NamingPart[] = [{ asks: 'Quality', choices: TRIADS.map((each) => each.called), answer: triad.called }];
    if (asked.inversions) {
      parts.push({ asks: 'Position', choices: [...POSITIONS], answer: POSITIONS[position] ?? 'Root position' });
    }
    return { measure: measureOf([noteEntry(notes, Duration.WHOLE)]), parts };
  });
  return {
    id: `${CHORDS_BY_NAME_ID}:${String(asked.seed)}`,
    title: 'Chords by name',
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
  };
}

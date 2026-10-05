import { KeySignature } from '../../domain/model/KeySignature.js';
import { TimeSignature } from '../../domain/model/TimeSignature.js';

/**
 * A grade of sight-reading: what a test at that grade may contain.
 *
 * The parameters follow the ones the examining boards publish for piano
 * sight-reading, put in this program's own words: each grade adds keys,
 * metres, rhythms and textures to everything below it, which is why a grade
 * lists only what it adds. The rungs of the ladder are the route through
 * them, one new thing at a time; a grade is what they add up to.
 */
export interface Grade {
  /** Stable: the rungs name it. */
  readonly id: string;
  /** "Initial", "Grade 3". */
  readonly label: string;
  /** What its button says among the others: "Initial", "3". */
  readonly short: string;
  /** What the grade adds that the exercises here write, in a reader's words. */
  readonly newHere: readonly string[];
  /**
   * What a test at this grade would also have and these exercises cannot yet
   * write. Said rather than left out, so a reader at the top of a grade knows
   * what it has not asked of them.
   */
  readonly notYet: readonly string[];
  /** The keys it adds. */
  readonly keys: readonly KeySignature[];
  /** The metres it adds. */
  readonly times: readonly TimeSignature[];
}

const major = (fifths: number): KeySignature => KeySignature.major(fifths);
const minor = (fifths: number): KeySignature => KeySignature.minor(fifths);
const time = (value: string): TimeSignature => TimeSignature.parse(value);

export const BUILT_IN_GRADES: readonly Grade[] = [
  {
    id: 'initial',
    label: 'Initial',
    short: 'Initial',
    newHere: [
      'each hand alone, then the hands in turn',
      'five fingers from the key note',
      'C major and D minor',
      'four-four',
      'whole, half and quarter notes',
    ],
    notYet: ['staccato and legato', 'loud and soft'],
    keys: [major(0), minor(-1)],
    times: [time('4/4')],
  },
  {
    id: 'grade-1',
    label: 'Grade 1',
    short: '1',
    newHere: ['eighth notes', 'three-four and two-four', 'G major, F major and A minor'],
    notYet: ['dotted half notes', 'accidentals in minor keys', 'slurs and accents', 'dynamics and hairpins'],
    keys: [major(1), major(-1), minor(0)],
    times: [time('3/4'), time('2/4')],
  },
  {
    id: 'grade-2',
    label: 'Grade 2',
    short: '2',
    newHere: ['both hands together', 'D major, E minor and G minor'],
    notYet: ['a dotted quarter and an eighth', 'tied notes'],
    keys: [major(2), minor(1), minor(-2)],
    times: [],
  },
  {
    id: 'grade-3',
    label: 'Grade 3',
    short: '3',
    newHere: [
      'both hands beyond five fingers',
      'two-note chords in the left hand',
      'sixteenth notes',
      'three-eight',
      'A, B flat and E flat major, B minor',
    ],
    notYet: ['two-note chords in the right hand'],
    keys: [major(3), major(-2), major(-3), minor(2)],
    times: [time('3/8')],
  },
  {
    id: 'grade-4',
    label: 'Grade 4',
    short: '4',
    newHere: ['six-eight', 'broken chords in both hands'],
    notYet: ['an upbeat', 'chromatic notes', 'pauses', 'tenuto'],
    keys: [],
    times: [time('6/8')],
  },
  {
    id: 'grade-5',
    label: 'Grade 5',
    short: '5',
    newHere: ['sequences', 'notes across the beat, and ties', 'E and A flat major, F sharp and C minor'],
    notYet: ['four-note chords', 'slowing at the end'],
    keys: [major(4), major(-4), minor(3), minor(-3)],
    times: [],
  },
];

/** The grade and every one below it, from the first. */
function upTo(gradeId: string): readonly Grade[] {
  const at = BUILT_IN_GRADES.findIndex((grade) => grade.id === gradeId);
  return at < 0 ? [] : BUILT_IN_GRADES.slice(0, at + 1);
}

/** Every key a test at this grade may be in. */
export function keysUpTo(gradeId: string): readonly KeySignature[] {
  return upTo(gradeId).flatMap((grade) => grade.keys);
}

/** Every metre a test at this grade may be in. */
export function timesUpTo(gradeId: string): readonly TimeSignature[] {
  return upTo(gradeId).flatMap((grade) => grade.times);
}

/** The keys a grade adds, for a rung that meets them before the rest. */
export function keysAddedBy(gradeId: string): readonly KeySignature[] {
  return BUILT_IN_GRADES.find((grade) => grade.id === gradeId)?.keys ?? [];
}

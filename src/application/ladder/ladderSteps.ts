import { KeySignature } from '../../domain/model/KeySignature.js';
import { TimeSignature } from '../../domain/model/TimeSignature.js';
import { keysAddedBy, keysUpTo, timesUpTo } from './grades.js';
import type { LadderStep } from './PracticeLadder.js';

const FOUR_FOUR = new TimeSignature(4, 4);
const THREE_FOUR = new TimeSignature(3, 4);
const SIX_EIGHT = new TimeSignature(6, 8);
const C_MAJOR = KeySignature.major(0);

/** The last rung of a grade: a test of it, in any of its keys and metres. */
function theWholeOf(grade: string, label: string, description: string): LadderStep {
  return {
    id: `${grade}.all`,
    grade,
    label,
    description,
    settings: {},
    draws: { keys: keysUpTo(grade), times: timesUpTo(grade) },
  };
}

/** A rung that meets the keys a grade adds, one of them drawn each time. */
function theNewKeysOf(grade: string, label: string, description: string): LadderStep {
  return {
    id: `${grade}.keys`,
    grade,
    label,
    description,
    settings: {},
    draws: { keys: keysAddedBy(grade) },
  };
}

/**
 * The route through the grades, from one hand on five notes to sequences.
 *
 * Material and rhythm are still independent settings; this only says which
 * combinations are worth meeting in which order, and it moves **one of them
 * at a time**. A rung that changed the notes *and* the rhythm *and* the key
 * at once would leave a reader who came unstuck with no way to tell which of
 * the three undid them - so a rung arriving at new material states all four
 * settings, and every rung after it changes exactly one. A test holds the
 * ladder to that.
 *
 * Keys arrive on familiar material: first the keys a grade adds, drawn one
 * at a time, then the whole grade, where the key and the metre are whichever
 * the exercise draws - which is what a test at that grade is.
 */
export const BUILT_IN_LADDER: readonly LadderStep[] = [
  {
    id: 'initial.right',
    grade: 'initial',
    label: 'Initial · a',
    description: 'The right hand alone, five fingers from C, in whole, half and quarter notes.',
    settings: {
      presetId: 'right-hand-five',
      rhythmProfileId: 'calm',
      key: C_MAJOR,
      timeSignature: FOUR_FOUR,
    },
    writes: { staccato: true, dynamics: ['p', 'f'] },
  },
  {
    id: 'initial.left',
    grade: 'initial',
    label: 'Initial · b',
    description: 'The left hand alone, five fingers from C, in the bass clef.',
    settings: {
      presetId: 'left-hand-five',
      rhythmProfileId: 'calm',
      key: C_MAJOR,
      timeSignature: FOUR_FOUR,
    },
  },
  {
    id: 'initial.minor',
    grade: 'initial',
    label: 'Initial · c',
    description: 'The left hand in D minor: five fingers from D.',
    settings: { key: KeySignature.minor(-1) },
  },
  {
    id: 'initial.turns',
    grade: 'initial',
    label: 'Initial · d',
    description: 'One hand and then the other, two bars each.',
    settings: {
      presetId: 'hands-in-turn',
      rhythmProfileId: 'calm',
      key: C_MAJOR,
      timeSignature: FOUR_FOUR,
    },
  },
  theWholeOf('initial', 'Initial · e', 'All of Initial: the hands in turn, in C major or D minor.'),
  {
    id: 'grade-1.eighths',
    grade: 'grade-1',
    label: 'Grade 1 · a',
    description: 'The hands in turn, with eighth notes.',
    settings: { rhythmProfileId: 'flowing' },
    writes: { accents: true, dynamics: ['p', 'mp', 'mf', 'f'], hairpins: true },
  },
  {
    id: 'grade-1.three',
    grade: 'grade-1',
    label: 'Grade 1 · b',
    description: 'The hands in turn in three-four.',
    settings: { timeSignature: THREE_FOUR },
  },
  theNewKeysOf('grade-1', 'Grade 1 · c', 'The new keys: G major, F major or A minor.'),
  theWholeOf(
    'grade-1',
    'Grade 1 · d',
    'All of Grade 1: any of its five keys, in four-four, three-four or two-four.',
  ),
  {
    id: 'grade-2.together',
    grade: 'grade-2',
    label: 'Grade 2 · a',
    description: 'Both hands at once, five fingers each.',
    settings: {
      presetId: 'five-finger-c',
      rhythmProfileId: 'flowing',
      key: C_MAJOR,
      timeSignature: FOUR_FOUR,
    },
    writes: { dynamics: ['pp', 'p', 'mp', 'mf', 'f'] },
  },
  theNewKeysOf('grade-2', 'Grade 2 · b', 'The new keys: D major, E minor or G minor.'),
  theWholeOf('grade-2', 'Grade 2 · c', 'All of Grade 2: both hands together, in any of its eight keys.'),
  {
    id: 'grade-3.wide',
    grade: 'grade-3',
    label: 'Grade 3 · a',
    description: 'Both hands moving beyond five fingers, with larger leaps.',
    settings: {
      presetId: 'wide-grand-staff',
      rhythmProfileId: 'flowing',
      key: C_MAJOR,
      timeSignature: FOUR_FOUR,
    },
  },
  {
    id: 'grade-3.chords',
    grade: 'grade-3',
    label: 'Grade 3 · b',
    description: 'A melody over two-note chords in the left hand.',
    settings: {
      presetId: 'melody-and-intervals',
      rhythmProfileId: 'flowing',
      key: C_MAJOR,
      timeSignature: FOUR_FOUR,
    },
  },
  {
    id: 'grade-3.sixteenths',
    grade: 'grade-3',
    label: 'Grade 3 · c',
    description: 'Two-note chords under sixteenths in pairs. Slow the tempo first.',
    settings: { rhythmProfileId: 'sixteenths' },
  },
  theNewKeysOf('grade-3', 'Grade 3 · d', 'The new keys: A, B flat or E flat major, or B minor.'),
  theWholeOf('grade-3', 'Grade 3 · e', 'All of Grade 3: any of its twelve keys, three-eight among the metres.'),
  {
    id: 'grade-4.six-eight',
    grade: 'grade-4',
    label: 'Grade 4 · a',
    description: 'Two-note chords in six-eight: two beats of three.',
    settings: { timeSignature: SIX_EIGHT },
    writes: { tenuto: true },
  },
  {
    id: 'grade-4.broken',
    grade: 'grade-4',
    label: 'Grade 4 · b',
    description: 'Broken chords in both hands, read as shapes rather than stacks.',
    settings: {
      presetId: 'figures',
      rhythmProfileId: 'flowing',
      key: C_MAJOR,
      timeSignature: FOUR_FOUR,
    },
  },
  {
    id: 'grade-4.chromatic',
    grade: 'grade-4',
    label: 'Grade 4 · c',
    description: 'Broken chords with now and then a chromatic note, leaning into the next by a half step.',
    settings: {},
    writes: { chromatic: true },
  },
  {
    id: 'grade-4.pause',
    grade: 'grade-4',
    label: 'Grade 4 · d',
    description: 'A pause over the last notes: held for longer than they are written.',
    settings: {},
    writes: { pauses: true },
  },
  theWholeOf('grade-4', 'Grade 4 · e', 'All of Grade 4: broken chords in any key and metre so far.'),
  {
    id: 'grade-5.sequences',
    grade: 'grade-5',
    label: 'Grade 5 · a',
    description: 'Sequences: a figure repeated a step higher or lower.',
    settings: {
      presetId: 'sequences',
      rhythmProfileId: 'flowing',
      key: C_MAJOR,
      timeSignature: FOUR_FOUR,
    },
    writes: { dynamics: ['pp', 'p', 'mp', 'mf', 'f', 'ff'] },
  },
  {
    id: 'grade-5.across',
    grade: 'grade-5',
    label: 'Grade 5 · b',
    description: 'Sequences that begin off the beat and hold across it.',
    settings: { rhythmProfileId: 'syncopated' },
  },
  {
    id: 'grade-5.slowing',
    grade: 'grade-5',
    label: 'Grade 5 · c',
    description: 'Sequences that slow down through the last bar, as rit. says.',
    settings: {},
    writes: { slowingAtTheEnd: true },
  },
  theNewKeysOf('grade-5', 'Grade 5 · d', 'The new keys: E or A flat major, F sharp or C minor.'),
  theWholeOf('grade-5', 'Grade 5 · e', 'All of Grade 5: any of sixteen keys. The top of the ladder.'),
];

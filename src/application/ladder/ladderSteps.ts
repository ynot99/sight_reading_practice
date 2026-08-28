import { KeySignature } from '../../domain/model/KeySignature.js';
import { TimeSignature } from '../../domain/model/TimeSignature.js';
import type { LadderStep } from './PracticeLadder.js';

const FOUR_FOUR = new TimeSignature(4, 4);
const THREE_FOUR = new TimeSignature(3, 4);
const SIX_EIGHT = new TimeSignature(6, 8);

/**
 * The route through the two axes, from a five-finger position to sequences.
 *
 * Material and rhythm are still independent settings; this only says which
 * combinations are worth meeting in which order, and it moves **one of them
 * at a time**. A rung that changed the notes *and* the rhythm *and* the key
 * at once would leave a reader who came unstuck with no way to tell which of
 * the three undid them - so a rung arriving at new material states all four
 * settings, and every rung after it changes exactly one. A test holds the
 * ladder to that.
 *
 * Keys widen slowly and lag behind the material on purpose: a new key on
 * familiar figures is a reading problem, while a new key on new figures is
 * two problems wearing one label.
 */
export const BUILT_IN_LADDER: readonly LadderStep[] = [
  {
    id: 'rung.1a',
    label: '1a',
    description: 'Five-finger position, C major, nothing shorter than a quarter.',
    settings: {
      presetId: 'five-finger-c',
      rhythmProfileId: 'calm',
      key: KeySignature.major(0),
      timeSignature: FOUR_FOUR,
    },
  },
  {
    id: 'rung.1b',
    label: '1b',
    description: 'The same position and key, now with eighth notes.',
    settings: { rhythmProfileId: 'flowing' },
  },
  {
    id: 'rung.1c',
    label: '1c',
    description: 'Five-finger position in three-four: the same reading, a new count.',
    settings: { timeSignature: THREE_FOUR },
  },
  {
    id: 'rung.2a',
    label: '2a',
    description: 'Right hand alone over an octave, quarters and halves.',
    settings: {
      presetId: 'treble-only',
      rhythmProfileId: 'calm',
      key: KeySignature.major(0),
      timeSignature: FOUR_FOUR,
    },
  },
  {
    id: 'rung.2b',
    label: '2b',
    description: 'Right hand alone with eighth notes.',
    settings: { rhythmProfileId: 'flowing' },
  },
  {
    id: 'rung.2c',
    label: '2c',
    description: 'Right hand alone in G major: one sharp to keep in mind.',
    settings: { key: KeySignature.major(1) },
  },
  {
    id: 'rung.3a',
    label: '3a',
    description: 'Left hand alone in the bass clef, quarters and halves.',
    settings: {
      presetId: 'bass-only',
      rhythmProfileId: 'calm',
      key: KeySignature.major(0),
      timeSignature: FOUR_FOUR,
    },
  },
  {
    id: 'rung.3b',
    label: '3b',
    description: 'Left hand alone with eighth notes.',
    settings: { rhythmProfileId: 'flowing' },
  },
  {
    id: 'rung.3c',
    label: '3c',
    description: 'Left hand alone in F major, where the B flat sits under the hand.',
    settings: { key: KeySignature.major(-1) },
  },
  {
    id: 'rung.4a',
    label: '4a',
    description: 'Both staves at once: a melody over held intervals.',
    settings: {
      presetId: 'melody-and-intervals',
      rhythmProfileId: 'calm',
      key: KeySignature.major(0),
      timeSignature: FOUR_FOUR,
    },
  },
  {
    id: 'rung.4b',
    label: '4b',
    description: 'Melody over intervals, with eighth notes above.',
    settings: { rhythmProfileId: 'flowing' },
  },
  {
    id: 'rung.4c',
    label: '4c',
    description: 'Melody over intervals in G major.',
    settings: { key: KeySignature.major(1) },
  },
  {
    id: 'rung.5a',
    label: '5a',
    description: 'Triads under a moving line: a chord read as one shape.',
    settings: {
      presetId: 'triads-left-hand',
      rhythmProfileId: 'calm',
      key: KeySignature.major(0),
      timeSignature: FOUR_FOUR,
    },
  },
  {
    id: 'rung.5b',
    label: '5b',
    description: 'Triads with eighth notes moving above them.',
    settings: { rhythmProfileId: 'flowing' },
  },
  {
    id: 'rung.5c',
    label: '5c',
    description: 'Triads in D major: two sharps, and both of them get used.',
    settings: { key: KeySignature.major(2) },
  },
  {
    id: 'rung.5d',
    label: '5d',
    description: 'Triads in three-four, where the chord falls on beat one only.',
    settings: { timeSignature: THREE_FOUR },
  },
  {
    id: 'rung.6a',
    label: '6a',
    description: 'The full grand staff: wider ranges and larger leaps.',
    settings: {
      presetId: 'wide-grand-staff',
      rhythmProfileId: 'flowing',
      key: KeySignature.major(0),
      timeSignature: FOUR_FOUR,
    },
  },
  {
    id: 'rung.6b',
    label: '6b',
    description: 'The full staff in B flat, where both flats are in the way.',
    settings: { key: KeySignature.major(-2) },
  },
  {
    id: 'rung.6c',
    label: '6c',
    description: 'The full staff in six-eight: two beats, three notes to each.',
    settings: { timeSignature: SIX_EIGHT },
  },
  {
    id: 'rung.7a',
    label: '7a',
    description: 'Broken chords in both hands, read as shapes rather than stacks.',
    settings: {
      presetId: 'figures',
      rhythmProfileId: 'flowing',
      key: KeySignature.major(0),
      timeSignature: FOUR_FOUR,
    },
  },
  {
    id: 'rung.7b',
    label: '7b',
    description: 'Broken chords with sixteenths. Slow the tempo before you start.',
    settings: { rhythmProfileId: 'sixteenths' },
  },
  {
    id: 'rung.8a',
    label: '8a',
    description: 'Sequences: a motif repeated a step higher, in A minor.',
    settings: {
      presetId: 'sequences',
      rhythmProfileId: 'flowing',
      key: KeySignature.minor(0),
      timeSignature: FOUR_FOUR,
    },
  },
  {
    id: 'rung.8b',
    label: '8b',
    description: 'Sequences that begin off the beat and hold across it.',
    settings: { rhythmProfileId: 'syncopated' },
  },
  {
    id: 'rung.8c',
    label: '8c',
    description: 'Sequences in triplets: three notes where two would go.',
    settings: { rhythmProfileId: 'triplets' },
  },
  {
    id: 'rung.8d',
    label: '8d',
    description: 'Sequences in E flat, three flats deep. The top of the ladder.',
    settings: { key: KeySignature.major(-3) },
  },
];

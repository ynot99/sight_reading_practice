import { Duration } from '../model/Duration.js';
import type { RhythmOptions } from './RhythmFiller.js';
import type { RhythmProfile } from './RhythmProfile.js';

/** Quarters and halves only: the first thing a reader can hold together. */
const CALM_RHYTHM: RhythmOptions = {
  durations: [
    { value: Duration.QUARTER, weight: 5 },
    { value: Duration.HALF, weight: 3 },
    { value: Duration.WHOLE, weight: 1 },
  ],
  restProbability: 0.08,
  keepInsideBeats: true,
};

/** Adds eighth-note motion. */
const FLOWING_RHYTHM: RhythmOptions = {
  durations: [
    { value: Duration.QUARTER, weight: 5 },
    { value: Duration.EIGHTH, weight: 4 },
    { value: Duration.HALF, weight: 2 },
  ],
  restProbability: 0.06,
  keepInsideBeats: true,
};

/**
 * Adds sixteenths, drawn in pairs.
 *
 * `repeat: 2` is what keeps this readable: sixteenths in real music arrive as
 * beamed groups, and a lone sixteenth wedged between two eighths is a rhythm
 * puzzle rather than sight-reading practice.
 */
const SIXTEENTH_RHYTHM: RhythmOptions = {
  durations: [
    { value: Duration.EIGHTH, weight: 5 },
    { value: Duration.SIXTEENTH, weight: 4, repeat: 2 },
    { value: Duration.QUARTER, weight: 4 },
    { value: Duration.HALF, weight: 1 },
  ],
  restProbability: 0.05,
  keepInsideBeats: true,
};

/** Long accompaniment values that leave the reading effort to the other hand. */
const SUSTAINED_RHYTHM: RhythmOptions = {
  durations: [
    { value: Duration.WHOLE, weight: 3 },
    { value: Duration.HALF, weight: 2 },
  ],
  restProbability: 0,
  keepInsideBeats: true,
};

const HALF_NOTE_RHYTHM: RhythmOptions = {
  durations: [
    { value: Duration.HALF, weight: 3 },
    { value: Duration.WHOLE, weight: 2 },
    { value: Duration.QUARTER, weight: 1 },
  ],
  restProbability: 0.05,
  keepInsideBeats: true,
};

/**
 * The built-in rhythmic ladder.
 *
 * Every profile answers the same three questions - what does the voice being
 * read do, what does a second reading voice do, what does held harmony do -
 * so any profile can be combined with any preset.
 */
export const BUILT_IN_RHYTHM_PROFILES: readonly RhythmProfile[] = [
  {
    id: 'calm',
    label: 'Quarters and halves',
    description: 'One note per beat at most. Nothing shorter than a quarter.',
    byRole: {
      lead: CALM_RHYTHM,
      inner: CALM_RHYTHM,
      accompaniment: SUSTAINED_RHYTHM,
    },
  },
  {
    id: 'flowing',
    label: 'With eighth notes',
    description: 'Eighth-note motion in the reading voice, longer values under it.',
    byRole: {
      lead: FLOWING_RHYTHM,
      inner: CALM_RHYTHM,
      accompaniment: HALF_NOTE_RHYTHM,
    },
  },
  {
    id: 'sixteenths',
    label: 'With sixteenth notes',
    description: 'Sixteenths in beamed pairs. Start slower than the tempo you can play.',
    byRole: {
      lead: SIXTEENTH_RHYTHM,
      inner: FLOWING_RHYTHM,
      accompaniment: HALF_NOTE_RHYTHM,
    },
  },
];

/** Id every preset falls back to, and the one the UI opens on. */
export const DEFAULT_RHYTHM_PROFILE_ID = 'flowing';

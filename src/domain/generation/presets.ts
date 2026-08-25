import { Duration } from '../model/Duration.js';
import { KeySignature } from '../model/KeySignature.js';
import { Pitch } from '../model/Pitch.js';
import { TimeSignature } from '../model/TimeSignature.js';
import type { ExercisePreset } from './ExercisePresetRegistry.js';
import { GrandStaffExerciseGenerator } from './GrandStaffExerciseGenerator.js';
import type { RhythmOptions } from './RhythmFiller.js';
import { HarmonyVoiceGenerator } from './voices/HarmonyVoiceGenerator.js';
import { MelodyVoiceGenerator } from './voices/MelodyVoiceGenerator.js';
import { SilentVoiceGenerator } from './voices/SilentVoiceGenerator.js';
import type { PitchRange } from './voices/IVoiceGenerator.js';

function range(lowest: string, highest: string): PitchRange {
  return { lowest: Pitch.parse(lowest), highest: Pitch.parse(highest) };
}

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
 * The built-in difficulty ladder.
 *
 * Each entry is data, not code: adding a level means adding an object here (or
 * registering one from anywhere else) rather than editing a switch statement.
 */
export const BUILT_IN_PRESETS: readonly ExercisePreset[] = [
  {
    id: 'five-finger-c',
    label: '1 · Five-finger position',
    description: 'Both hands inside a five-finger position, quarter and half notes.',
    generator: new GrandStaffExerciseGenerator({
      id: 'gen.five-finger',
      label: 'Five-finger grand staff',
      staves: [
        {
          clef: 'treble',
          voice: new MelodyVoiceGenerator({
            range: range('C4', 'G4'),
            rhythm: CALM_RHYTHM,
            maxLeap: 2,
            stepProbability: 0.75,
          }),
        },
        {
          clef: 'bass',
          voice: new MelodyVoiceGenerator({
            range: range('C3', 'G3'),
            rhythm: SUSTAINED_RHYTHM,
            maxLeap: 2,
            stepProbability: 0.7,
          }),
        },
      ],
    }),
    defaults: {
      measures: 4,
      timeSignature: new TimeSignature(4, 4),
      key: KeySignature.major(0),
      tempoBpm: 60,
    },
  },
  {
    id: 'treble-only',
    label: '2 · Right hand alone',
    description: 'Treble melody over a silent bass staff, one octave of motion.',
    generator: new GrandStaffExerciseGenerator({
      id: 'gen.treble-only',
      label: 'Treble melody',
      staves: [
        {
          clef: 'treble',
          voice: new MelodyVoiceGenerator({
            range: range('C4', 'C5'),
            rhythm: FLOWING_RHYTHM,
            maxLeap: 3,
            stepProbability: 0.7,
          }),
        },
        { clef: 'bass', voice: new SilentVoiceGenerator() },
      ],
    }),
    defaults: {
      measures: 4,
      timeSignature: new TimeSignature(4, 4),
      key: KeySignature.major(0),
      tempoBpm: 72,
    },
  },
  {
    id: 'bass-only',
    label: '3 · Left hand alone',
    description: 'Bass clef reading practice with a silent treble staff.',
    generator: new GrandStaffExerciseGenerator({
      id: 'gen.bass-only',
      label: 'Bass melody',
      staves: [
        { clef: 'treble', voice: new SilentVoiceGenerator() },
        {
          clef: 'bass',
          voice: new MelodyVoiceGenerator({
            range: range('F2', 'C4'),
            rhythm: CALM_RHYTHM,
            maxLeap: 3,
            stepProbability: 0.7,
          }),
        },
      ],
    }),
    defaults: {
      measures: 4,
      timeSignature: new TimeSignature(4, 4),
      key: KeySignature.major(0),
      tempoBpm: 66,
    },
  },
  {
    id: 'melody-and-intervals',
    label: '4 · Melody over intervals',
    description: 'Treble melody against thirds, fifths and sixths in the left hand.',
    generator: new GrandStaffExerciseGenerator({
      id: 'gen.melody-intervals',
      label: 'Melody and intervals',
      staves: [
        {
          clef: 'treble',
          voice: new MelodyVoiceGenerator({
            range: range('B3', 'E5'),
            rhythm: FLOWING_RHYTHM,
            maxLeap: 4,
            stepProbability: 0.65,
          }),
        },
        {
          clef: 'bass',
          voice: new HarmonyVoiceGenerator({
            range: range('F2', 'D4'),
            rhythm: HALF_NOTE_RHYTHM,
            shape: 'interval',
            intervalDegrees: [2, 4, 5],
            degreePool: [0, 3, 4, 5],
            harmonyPerMeasure: false,
          }),
        },
      ],
    }),
    defaults: {
      measures: 4,
      timeSignature: new TimeSignature(4, 4),
      key: KeySignature.major(1),
      tempoBpm: 72,
    },
  },
  {
    id: 'triads-left-hand',
    label: '5 · Triads in the left hand',
    description: 'Root-position triads under a moving treble line: chord reading.',
    generator: new GrandStaffExerciseGenerator({
      id: 'gen.triads',
      label: 'Triads and melody',
      staves: [
        {
          clef: 'treble',
          voice: new MelodyVoiceGenerator({
            range: range('C4', 'G5'),
            rhythm: FLOWING_RHYTHM,
            maxLeap: 4,
            stepProbability: 0.6,
          }),
        },
        {
          clef: 'bass',
          voice: new HarmonyVoiceGenerator({
            range: range('F2', 'C4'),
            rhythm: HALF_NOTE_RHYTHM,
            shape: 'triad',
            intervalDegrees: [2, 4],
            degreePool: [0, 3, 4],
            harmonyPerMeasure: true,
          }),
        },
      ],
    }),
    defaults: {
      measures: 4,
      timeSignature: new TimeSignature(4, 4),
      key: KeySignature.major(0),
      tempoBpm: 66,
    },
  },
  {
    id: 'wide-grand-staff',
    label: '6 · Full grand staff',
    description: 'Wider ranges, larger leaps and eighth-note motion in both hands.',
    generator: new GrandStaffExerciseGenerator({
      id: 'gen.wide',
      label: 'Wide grand staff',
      staves: [
        {
          clef: 'treble',
          voice: new MelodyVoiceGenerator({
            range: range('G3', 'A5'),
            rhythm: FLOWING_RHYTHM,
            maxLeap: 5,
            stepProbability: 0.55,
          }),
        },
        {
          clef: 'bass',
          voice: new MelodyVoiceGenerator({
            range: range('E2', 'D4'),
            rhythm: CALM_RHYTHM,
            maxLeap: 5,
            stepProbability: 0.55,
          }),
        },
      ],
    }),
    defaults: {
      measures: 8,
      timeSignature: new TimeSignature(4, 4),
      key: KeySignature.major(-1),
      tempoBpm: 76,
    },
  },
];

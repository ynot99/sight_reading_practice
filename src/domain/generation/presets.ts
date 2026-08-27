import { KeySignature } from '../model/KeySignature.js';
import { Pitch } from '../model/Pitch.js';
import { TimeSignature } from '../model/TimeSignature.js';
import type { ExercisePreset } from './ExercisePresetRegistry.js';
import { GrandStaffExerciseGenerator } from './GrandStaffExerciseGenerator.js';
import { HarmonyVoiceGenerator } from './voices/HarmonyVoiceGenerator.js';
import { MelodyVoiceGenerator } from './voices/MelodyVoiceGenerator.js';
import { SilentVoiceGenerator } from './voices/SilentVoiceGenerator.js';
import type { PitchRange } from './voices/IVoiceGenerator.js';

function range(lowest: string, highest: string): PitchRange {
  return { lowest: Pitch.parse(lowest), highest: Pitch.parse(highest) };
}

/**
 * The built-in difficulty ladder.
 *
 * Each entry is data, not code: adding a level means adding an object here (or
 * registering one from anywhere else) rather than editing a switch statement.
 *
 * Presets describe *material* only - which pitches, how far they leap, how
 * many notes at once. Rhythm is the other axis and lives in
 * {@link ../rhythmProfiles.js}; `defaults.rhythmProfileId` merely says which
 * rhythmic level a preset was tuned for.
 */
export const BUILT_IN_PRESETS: readonly ExercisePreset[] = [
  {
    id: 'five-finger-c',
    label: '1 · Five-finger position',
    description: 'Both hands inside a five-finger position, one note at a time.',
    generator: new GrandStaffExerciseGenerator({
      id: 'gen.five-finger',
      label: 'Five-finger grand staff',
      staves: [
        {
          clef: 'treble',
          voice: new MelodyVoiceGenerator({
            range: range('C4', 'G4'),
            role: 'lead',
            maxLeap: 2,
            stepProbability: 0.75,
          }),
        },
        {
          clef: 'bass',
          voice: new MelodyVoiceGenerator({
            range: range('C3', 'G3'),
            role: 'accompaniment',
            maxLeap: 2,
            stepProbability: 0.7,
          }),
        },
      ],
    }),
    defaults: {
      measures: 4,
      rhythmProfileId: 'calm',
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
            role: 'lead',
            maxLeap: 3,
            stepProbability: 0.7,
          }),
        },
        { clef: 'bass', voice: new SilentVoiceGenerator() },
      ],
    }),
    defaults: {
      measures: 4,
      rhythmProfileId: 'flowing',
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
            role: 'lead',
            maxLeap: 3,
            stepProbability: 0.7,
          }),
        },
      ],
    }),
    defaults: {
      measures: 4,
      rhythmProfileId: 'calm',
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
            role: 'lead',
            maxLeap: 4,
            stepProbability: 0.65,
          }),
        },
        {
          clef: 'bass',
          voice: new HarmonyVoiceGenerator({
            range: range('F2', 'D4'),
            role: 'accompaniment',
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
      rhythmProfileId: 'flowing',
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
            role: 'lead',
            maxLeap: 4,
            stepProbability: 0.6,
          }),
        },
        {
          clef: 'bass',
          voice: new HarmonyVoiceGenerator({
            range: range('F2', 'C4'),
            role: 'accompaniment',
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
      rhythmProfileId: 'flowing',
      timeSignature: new TimeSignature(4, 4),
      key: KeySignature.major(0),
      tempoBpm: 66,
    },
  },
  {
    id: 'wide-grand-staff',
    label: '6 · Full grand staff',
    description: 'Wider ranges and larger leaps, with both hands reading at once.',
    generator: new GrandStaffExerciseGenerator({
      id: 'gen.wide',
      label: 'Wide grand staff',
      staves: [
        {
          clef: 'treble',
          voice: new MelodyVoiceGenerator({
            range: range('G3', 'A5'),
            role: 'lead',
            maxLeap: 5,
            stepProbability: 0.55,
          }),
        },
        {
          clef: 'bass',
          voice: new MelodyVoiceGenerator({
            range: range('E2', 'D4'),
            role: 'inner',
            maxLeap: 5,
            stepProbability: 0.55,
          }),
        },
      ],
    }),
    defaults: {
      measures: 8,
      rhythmProfileId: 'flowing',
      timeSignature: new TimeSignature(4, 4),
      key: KeySignature.major(-1),
      tempoBpm: 76,
    },
  },
];

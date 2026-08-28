import { assertPositive } from '../../shared/asserts.js';
import type { ClefKind } from '../model/Clef.js';
import type { Exercise, StaffPart } from '../model/Exercise.js';
import { validateExercise } from '../model/Exercise.js';
import type { ExerciseRequest, IExerciseGenerator } from './IExerciseGenerator.js';
import { createRng, randomSeed } from './Rng.js';
import type { IVoiceGenerator, VoiceContext } from './voices/IVoiceGenerator.js';

export interface StaffPlan {
  readonly clef: ClefKind;
  readonly voice: IVoiceGenerator;
}

export interface GrandStaffGeneratorConfig {
  readonly id: string;
  readonly label: string;
  /** Top staff first. Two entries produce a classic grand staff. */
  readonly staves: readonly StaffPlan[];
}

/**
 * Composes per-staff voice strategies into a complete, validated exercise.
 *
 * The generator itself knows nothing about melodies, chords or rhythm: it
 * owns seeding, staff/voice numbering and the validation contract, and
 * delegates the music to {@link IVoiceGenerator} implementations.
 */
export class GrandStaffExerciseGenerator implements IExerciseGenerator {
  readonly id: string;
  readonly label: string;
  private readonly staves: readonly StaffPlan[];

  constructor(config: GrandStaffGeneratorConfig) {
    this.id = config.id;
    this.label = config.label;
    this.staves = config.staves;
  }

  generate(request: ExerciseRequest): Exercise {
    assertPositive(request.measures, 'measures');
    assertPositive(request.tempoBpm, 'tempoBpm');

    const seed = request.seed ?? randomSeed();
    const context: VoiceContext = {
      rng: createRng(seed),
      key: request.key,
      timeSignature: request.timeSignature,
      measures: request.measures,
      rhythm: request.rhythm,
    };

    const staves: StaffPart[] = this.staves.map((plan, index) => ({
      staffNumber: index + 1,
      voice: index + 1,
      clef: plan.clef,
      clefChanges: [],
      measures: plan.voice.generate(context),
    }));

    const exercise: Exercise = {
      id: `${this.id}-${seed.toString(16)}`,
      title: `${request.key.name} · ${request.timeSignature.toString()} · ${request.measures} bars`,
      key: request.key,
      timeSignature: request.timeSignature,
      tempoBpm: request.tempoBpm,
      staves,
      metadata: { generatorId: this.id, seed },
    };

    validateExercise(exercise);
    return exercise;
  }
}

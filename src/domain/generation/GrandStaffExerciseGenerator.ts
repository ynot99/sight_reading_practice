import { assertPositive } from '../../shared/asserts.js';
import type { ClefKind } from '../model/Clef.js';
import type { Exercise, StaffPart } from '../model/Exercise.js';
import { validateExercise } from '../model/Exercise.js';
import type { ExerciseRequest, IExerciseGenerator } from './IExerciseGenerator.js';
import { createRng, randomSeed } from './Rng.js';
import { written } from './writing.js';
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
    const rng = createRng(seed);
    // Drawn before any note, and only where there is a set to draw from, so a
    // request for one key spends nothing on it and writes what it always has.
    const keys = request.drawnFrom?.keys;
    const key = keys === undefined ? request.key : rng.pick(keys);
    const times = request.drawnFrom?.times;
    const timeSignature = times === undefined ? request.timeSignature : rng.pick(times);
    const context: VoiceContext = {
      rng,
      key,
      timeSignature,
      measures: request.measures,
      rhythm: request.rhythm,
      ...(request.withinRange === undefined ? {} : { withinRange: request.withinRange }),
    };

    const staves: StaffPart[] = this.staves.map((plan, index) => ({
      staffNumber: index + 1,
      voice: index + 1,
      clef: plan.clef,
      clefChanges: [],
      measures: plan.voice.generate(context),
    }));

    const plain: Exercise = {
      id: `${this.id}-${seed.toString(16)}`,
      title: `${key.name} · ${timeSignature.toString()} · ${request.measures} bars`,
      key,
      keyChanges: [],
      timeChanges: [],
      tempoChanges: [],
      pedalMarks: [],
      dynamicMarks: [],
      tempoWords: [],
      hairpins: [],
      octaveShifts: [],
      timeSignature,
      tempoBpm: request.tempoBpm,
      staves,
      firstBarNumber: 1,
      barLabels: [],
      metadata: { generatorId: this.id, seed },
    };

    // After every note is drawn, from the same source, so the notes of a page
    // are the same with or without what is written over them.
    const exercise = request.writing === undefined ? plain : written(plain, request.writing, rng);
    validateExercise(exercise);
    return exercise;
  }
}

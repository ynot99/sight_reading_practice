import type { Exercise } from '../../domain/model/Exercise.js';
import type { ExerciseRequest, IExerciseGenerator } from '../../domain/generation/IExerciseGenerator.js';

/**
 * Where the next exercise comes from.
 *
 * Asynchronous on purpose: today the material is generated in-process, but a
 * MusicXML file picker or a remote library must be able to slot in without
 * changing the controller.
 */
export interface IExerciseProvider {
  provide(request: ExerciseRequest): Promise<Exercise>;
}

/** Adapts a synchronous {@link IExerciseGenerator} to the provider port. */
export class GeneratedExerciseProvider implements IExerciseProvider {
  private readonly generator: IExerciseGenerator;

  constructor(generator: IExerciseGenerator) {
    this.generator = generator;
  }

  provide(request: ExerciseRequest): Promise<Exercise> {
    return Promise.resolve(this.generator.generate(request));
  }
}

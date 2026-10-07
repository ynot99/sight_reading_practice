import { DomainError } from '../../shared/errors.js';
import type { Exercise } from '../model/Exercise.js';
import type { ExerciseRequest, IExerciseGenerator } from './IExerciseGenerator.js';
import { createRng, randomSeed } from './Rng.js';

/**
 * Mixed into the seed before the material is drawn, so that the draw and the
 * page it chooses are not read off the same numbers: unmixed, the first value
 * both take would decide the material and the key together.
 */
const MATERIAL_STREAM = 0x6d617465;

/**
 * A page from one of several generators, which one drawn by its seed.
 *
 * A test at a grade is in whichever of the grade's materials it happens to
 * be, as it is in whichever of its keys. The chosen generator is handed the
 * same seed it was drawn by, so the page is exactly the one it writes from
 * that seed on its own: a page gone back to is the same page, and a material
 * drawn is that material as it always was.
 */
export class OneOfTheGenerators implements IExerciseGenerator {
  readonly id: string;
  readonly label: string;
  private readonly generators: readonly IExerciseGenerator[];

  constructor(id: string, label: string, generators: readonly IExerciseGenerator[]) {
    if (generators.length === 0) {
      throw new DomainError(`"${id}" has no generators to draw from.`);
    }
    this.id = id;
    this.label = label;
    this.generators = generators;
  }

  generate(request: ExerciseRequest): Exercise {
    const seed = request.seed ?? randomSeed();
    const chosen = createRng((seed ^ MATERIAL_STREAM) >>> 0).pick(this.generators);
    return chosen.generate({ ...request, seed });
  }
}

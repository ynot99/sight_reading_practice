import type { DrawnFrom } from '../../domain/generation/IExerciseGenerator.js';
import { DomainError } from '../../shared/errors.js';
import type { PracticeSettings } from '../PracticeController.js';
import type { Grade } from './grades.js';

/**
 * One rung of the practice ladder.
 *
 * A rung is a *point in the settings space*, not a new kind of exercise: it
 * names a combination of material, rhythm, key and metre that is worth
 * meeting in that order. The axes stay exactly as they were and can still be
 * set by hand - the ladder is a route through them, which is why leaving it
 * costs nothing and is always visible.
 */
export interface LadderStep {
  /** Stable across releases: it is stored, and a run is keyed by it. */
  readonly id: string;
  /** The grade the rung belongs to, by its id. */
  readonly grade: string;
  /** Short name, in the reader's terms: "Grade 2 · b". */
  readonly label: string;
  /** What this rung asks of them, in one line. */
  readonly description: string;
  /** The settings this rung *is*. Everything else is left as it was. */
  readonly settings: Partial<PracticeSettings>;
  /**
   * Keys and metres each exercise on this rung draws its own from, in place
   * of the settings' one. Not folded into the rungs after it: drawing is
   * what this rung asks, not a setting the route has reached.
   */
  readonly draws?: DrawnFrom;
}

/**
 * The rungs in order, and the arithmetic of moving between them.
 *
 * Ordered rather than a registry keyed by id: on a ladder, "the next one" is
 * the whole point, and a `Map` cannot answer it.
 */
export class PracticeLadder {
  private readonly steps: readonly LadderStep[];
  private readonly indexById: ReadonlyMap<string, number>;
  private readonly grades: ReadonlyMap<string, Grade>;

  constructor(steps: readonly LadderStep[], grades: readonly Grade[]) {
    const index = new Map<string, number>();
    const byId = new Map(grades.map((grade) => [grade.id, grade]));
    steps.forEach((step, at) => {
      if (index.has(step.id)) {
        throw new DomainError(`Ladder step "${step.id}" is registered twice.`);
      }
      if (!byId.has(step.grade)) {
        throw new DomainError(`Ladder step "${step.id}" names no grade there is ("${step.grade}").`);
      }
      index.set(step.id, at);
    });
    this.steps = steps;
    this.indexById = index;
    this.grades = byId;
  }

  /** The grade a rung belongs to. */
  gradeOf(step: LadderStep): Grade {
    const grade = this.grades.get(step.grade);
    if (grade === undefined) {
      throw new DomainError(`Unknown grade "${step.grade}".`);
    }
    return grade;
  }

  list(): readonly LadderStep[] {
    return this.steps;
  }

  has(id: string): boolean {
    return this.indexById.has(id);
  }

  get(id: string): LadderStep {
    const step = this.find(id);
    if (step === null) {
      throw new DomainError(`Unknown ladder step "${id}".`);
    }
    return step;
  }

  /** The rung with this id, or `null` - used where a stored id may be stale. */
  find(id: string): LadderStep | null {
    const at = this.indexById.get(id);
    return at === undefined ? null : (this.steps[at] ?? null);
  }

  first(): LadderStep {
    const step = this.steps[0];
    if (step === undefined) {
      throw new DomainError('The ladder has no rungs.');
    }
    return step;
  }

  /** One-based position, for "3 of 19". */
  positionOf(id: string): number {
    const at = this.indexById.get(id);
    return at === undefined ? 0 : at + 1;
  }

  /**
   * The rung `offset` away, clamped to the ends.
   *
   * Clamped rather than wrapped or refused: the top of the ladder is a place
   * to stay, and a reader who keeps reading cleanly there should not be sent
   * back to the beginning.
   */
  step(id: string, offset: number): LadderStep {
    const at = this.indexById.get(id);
    if (at === undefined) {
      return this.first();
    }
    const wanted = Math.min(this.steps.length - 1, Math.max(0, at + offset));
    return this.steps[wanted] ?? this.first();
  }

  /**
   * Everything a rung stands for, and not merely what it changed.
   *
   * The rungs are written as deltas so that each one reads as the single
   * thing it moves, but a reader arriving at one has to get the whole
   * setting: folding the route up to here is what makes any rung reachable
   * from any other, rather than only from the one below it.
   */
  resolve(id: string): Partial<PracticeSettings> {
    const at = this.indexById.get(id);
    if (at === undefined) {
      return {};
    }
    let settings: Partial<PracticeSettings> = {};
    for (const step of this.steps.slice(0, at + 1)) {
      settings = { ...settings, ...step.settings };
    }
    return settings;
  }

  /** Whether there is anywhere further to go in that direction. */
  canStep(id: string, offset: number): boolean {
    return this.step(id, offset).id !== id;
  }
}

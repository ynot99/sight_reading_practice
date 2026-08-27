import { DomainError } from '../../shared/errors.js';
import type { IScoringStrategy } from './IScoringStrategy.js';

/**
 * Open/closed catalogue of grading policies.
 *
 * Grading used to be a function of the practice mode, which quietly decided
 * that how you are judged follows from how the cursor moves. It does not: the
 * same Flow run is worth grading for accuracy, for timing or for how far it
 * got without breaking, and which of those the reader is working on is their
 * choice. Modes keep a default, the way presets keep a rhythm.
 */
export class ScoringStrategyRegistry {
  private readonly strategies = new Map<string, IScoringStrategy>();

  register(strategy: IScoringStrategy): this {
    if (this.strategies.has(strategy.id)) {
      throw new DomainError(`Scoring strategy "${strategy.id}" is already registered.`);
    }
    this.strategies.set(strategy.id, strategy);
    return this;
  }

  registerAll(strategies: Iterable<IScoringStrategy>): this {
    for (const strategy of strategies) {
      this.register(strategy);
    }
    return this;
  }

  has(id: string): boolean {
    return this.strategies.has(id);
  }

  get(id: string): IScoringStrategy {
    const strategy = this.strategies.get(id);
    if (strategy === undefined) {
      throw new DomainError(`Unknown scoring strategy "${id}".`);
    }
    return strategy;
  }

  list(): readonly IScoringStrategy[] {
    return [...this.strategies.values()];
  }

  /** First registered strategy; used when nothing else has been chosen. */
  first(): IScoringStrategy {
    const [strategy] = this.strategies.values();
    if (strategy === undefined) {
      throw new DomainError('No scoring strategies are registered.');
    }
    return strategy;
  }
}

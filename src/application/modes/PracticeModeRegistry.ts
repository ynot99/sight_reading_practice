import { DomainError } from '../../shared/errors.js';
import type { IPracticeMode } from './IPracticeMode.js';

/**
 * Open/closed catalogue of practice modes.
 *
 * The UI renders whatever is registered here, so shipping a new mode never
 * means editing a switch statement or a hard-coded list of options.
 */
export class PracticeModeRegistry {
  private readonly modes = new Map<string, IPracticeMode>();

  register(mode: IPracticeMode): this {
    if (this.modes.has(mode.id)) {
      throw new DomainError(`Practice mode "${mode.id}" is already registered.`);
    }
    this.modes.set(mode.id, mode);
    return this;
  }

  registerAll(modes: Iterable<IPracticeMode>): this {
    for (const mode of modes) {
      this.register(mode);
    }
    return this;
  }

  has(id: string): boolean {
    return this.modes.has(id);
  }

  get(id: string): IPracticeMode {
    const mode = this.modes.get(id);
    if (mode === undefined) {
      throw new DomainError(`Unknown practice mode "${id}".`);
    }
    return mode;
  }

  list(): readonly IPracticeMode[] {
    return [...this.modes.values()];
  }

  first(): IPracticeMode {
    const [mode] = this.modes.values();
    if (mode === undefined) {
      throw new DomainError('No practice modes are registered.');
    }
    return mode;
  }
}

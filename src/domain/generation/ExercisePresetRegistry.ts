import { DomainError } from '../../shared/errors.js';
import type { KeySignature } from '../model/KeySignature.js';
import type { TimeSignature } from '../model/TimeSignature.js';
import type { IExerciseGenerator } from './IExerciseGenerator.js';

/** Sensible starting values the UI pre-fills when a preset is chosen. */
export interface PresetDefaults {
  readonly measures: number;
  /** Rhythmic level this preset was tuned for. */
  readonly rhythmProfileId: string;
  readonly timeSignature: TimeSignature;
  readonly key: KeySignature;
  readonly tempoBpm: number;
}

/** A named difficulty level: a generator plus the settings it was tuned for. */
export interface ExercisePreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly generator: IExerciseGenerator;
  readonly defaults: PresetDefaults;
}

/**
 * Open/closed registry of practice material.
 *
 * New levels are registered at the composition root; nothing else in the
 * application needs to learn about them.
 */
export class ExercisePresetRegistry {
  private readonly presets = new Map<string, ExercisePreset>();

  register(preset: ExercisePreset): this {
    if (this.presets.has(preset.id)) {
      throw new DomainError(`Preset "${preset.id}" is already registered.`);
    }
    this.presets.set(preset.id, preset);
    return this;
  }

  registerAll(presets: Iterable<ExercisePreset>): this {
    for (const preset of presets) {
      this.register(preset);
    }
    return this;
  }

  has(id: string): boolean {
    return this.presets.has(id);
  }

  get(id: string): ExercisePreset {
    const preset = this.presets.get(id);
    if (preset === undefined) {
      throw new DomainError(`Unknown exercise preset "${id}".`);
    }
    return preset;
  }

  list(): readonly ExercisePreset[] {
    return [...this.presets.values()];
  }

  /** First registered preset; the UI opens on it. */
  first(): ExercisePreset {
    const [preset] = this.presets.values();
    if (preset === undefined) {
      throw new DomainError('No exercise presets are registered.');
    }
    return preset;
  }
}

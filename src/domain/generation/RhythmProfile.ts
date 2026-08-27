import { DomainError } from '../../shared/errors.js';
import type { RhythmOptions } from './RhythmFiller.js';

/**
 * What a staff is doing rhythmically, independent of what it is playing.
 *
 * Roles exist so that rhythm can be chosen separately from material: a
 * five-finger exercise and a full grand-staff one both have a voice being
 * read and a voice supporting it, and "add sixteenths" should mean the same
 * thing in each.
 */
export const VOICE_ROLES = ['lead', 'inner', 'accompaniment'] as const;

export type VoiceRole = (typeof VOICE_ROLES)[number];

/**
 * A rhythmic difficulty level, applied across every preset.
 *
 * This is the second axis of the exercise settings. Without it, "quarters and
 * halves" versus "with sixteenths" would have to be baked into each preset,
 * and every new rhythm would multiply the length of the level list instead of
 * combining with what is already there.
 */
export interface RhythmProfile {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly byRole: Readonly<Record<VoiceRole, RhythmOptions>>;
}

/**
 * Open/closed catalogue of rhythmic levels, mirroring the preset registry.
 */
export class RhythmProfileRegistry {
  private readonly profiles = new Map<string, RhythmProfile>();

  register(profile: RhythmProfile): this {
    if (this.profiles.has(profile.id)) {
      throw new DomainError(`Rhythm profile "${profile.id}" is already registered.`);
    }
    this.profiles.set(profile.id, profile);
    return this;
  }

  registerAll(profiles: Iterable<RhythmProfile>): this {
    for (const profile of profiles) {
      this.register(profile);
    }
    return this;
  }

  has(id: string): boolean {
    return this.profiles.has(id);
  }

  get(id: string): RhythmProfile {
    const profile = this.profiles.get(id);
    if (profile === undefined) {
      throw new DomainError(`Unknown rhythm profile "${id}".`);
    }
    return profile;
  }

  list(): readonly RhythmProfile[] {
    return [...this.profiles.values()];
  }

  /** First registered profile; used when nothing else has been chosen. */
  first(): RhythmProfile {
    const [profile] = this.profiles.values();
    if (profile === undefined) {
      throw new DomainError('No rhythm profiles are registered.');
    }
    return profile;
  }
}

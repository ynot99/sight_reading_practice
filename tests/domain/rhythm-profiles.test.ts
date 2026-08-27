import { describe, expect, it } from 'vitest';
import { fillMeasure, type RhythmOptions } from '../../src/domain/generation/RhythmFiller.js';
import {
  RhythmProfileRegistry,
  VOICE_ROLES,
  type VoiceRole,
} from '../../src/domain/generation/RhythmProfile.js';
import {
  BUILT_IN_RHYTHM_PROFILES,
  DEFAULT_RHYTHM_PROFILE_ID,
} from '../../src/domain/generation/rhythmProfiles.js';
import { createRng } from '../../src/domain/generation/Rng.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { DomainError } from '../../src/shared/errors.js';

const SIGNATURES = [new TimeSignature(4, 4), new TimeSignature(3, 4), new TimeSignature(6, 8)];

function slotsFor(rhythm: RhythmOptions, timeSignature: TimeSignature, bars: number) {
  return Array.from({ length: bars }, (_, seed) =>
    fillMeasure(timeSignature, createRng(seed), rhythm),
  );
}

describe('repeated rhythmic values', () => {
  const pairs: RhythmOptions = {
    durations: [
      { value: Duration.QUARTER, weight: 1 },
      { value: Duration.SIXTEENTH, weight: 6, repeat: 2 },
    ],
    restProbability: 0,
    keepInsideBeats: true,
  };

  it('emits a repeated value as a run of copies', () => {
    const measures = slotsFor(pairs, new TimeSignature(4, 4), 40);
    const sixteenthRuns = measures.flatMap((slots) => {
      const runs: number[] = [];
      let run = 0;
      for (const slot of slots) {
        if (slot.duration.equals(Duration.SIXTEENTH)) {
          run += 1;
          continue;
        }
        if (run > 0) {
          runs.push(run);
        }
        run = 0;
      }
      if (run > 0) {
        runs.push(run);
      }
      return runs;
    });

    expect(sixteenthRuns.length).toBeGreaterThan(0);
    // Runs are made of whole pairs, never an odd sixteenth on its own.
    for (const run of sixteenthRuns) {
      expect(run % 2).toBe(0);
    }
  });

  it('never splits a group across a beat', () => {
    for (const timeSignature of SIGNATURES) {
      for (const slots of slotsFor(pairs, timeSignature, 30)) {
        for (let index = 0; index < slots.length; index += 1) {
          const slot = slots[index];
          if (slot === undefined || !slot.duration.equals(Duration.SIXTEENTH)) {
            continue;
          }
          const beat = Math.floor(slot.onsetTicks / timeSignature.ticksPerBeat);
          const partner = slot.onsetTicks % (Duration.SIXTEENTH.ticks * 2) === 0
            ? slots[index + 1]
            : slots[index - 1];
          expect(partner).toBeDefined();
          expect(partner?.duration.equals(Duration.SIXTEENTH)).toBe(true);
          expect(Math.floor((partner?.onsetTicks ?? -1) / timeSignature.ticksPerBeat)).toBe(beat);
        }
      }
    }
  });

  it('still fills the bar exactly', () => {
    for (const timeSignature of SIGNATURES) {
      for (const slots of slotsFor(pairs, timeSignature, 30)) {
        const total = slots.reduce((sum, slot) => sum + slot.duration.ticks, 0);
        expect(total).toBe(timeSignature.ticksPerMeasure);
      }
    }
  });

  it('treats a missing, zero or fractional repeat as a single copy', () => {
    const odd: RhythmOptions = {
      durations: [
        { value: Duration.QUARTER, weight: 1, repeat: 0 },
        { value: Duration.HALF, weight: 1, repeat: 1.5 },
      ],
      restProbability: 0,
      keepInsideBeats: true,
    };
    for (const slots of slotsFor(odd, new TimeSignature(4, 4), 20)) {
      const total = slots.reduce((sum, slot) => sum + slot.duration.ticks, 0);
      expect(total).toBe(new TimeSignature(4, 4).ticksPerMeasure);
    }
  });
});

describe('built-in rhythm profiles', () => {
  it('covers every voice role', () => {
    for (const profile of BUILT_IN_RHYTHM_PROFILES) {
      for (const role of VOICE_ROLES) {
        expect(profile.byRole[role].durations.length).toBeGreaterThan(0);
      }
    }
  });

  it('names a default that actually exists', () => {
    expect(BUILT_IN_RHYTHM_PROFILES.map((profile) => profile.id)).toContain(
      DEFAULT_RHYTHM_PROFILE_ID,
    );
  });

  it('is the profile every preset asks for by default', () => {
    const ids = new Set(BUILT_IN_RHYTHM_PROFILES.map((profile) => profile.id));
    for (const preset of BUILT_IN_PRESETS) {
      expect(ids).toContain(preset.defaults.rhythmProfileId);
    }
  });

  function shortestOf(id: string, role: VoiceRole): number {
    const profile = BUILT_IN_RHYTHM_PROFILES.find((candidate) => candidate.id === id);
    if (profile === undefined) {
      throw new Error(`No profile ${id}.`);
    }
    return Math.min(
      ...slotsFor(profile.byRole[role], new TimeSignature(4, 4), 40)
        .flat()
        .map((slot) => slot.duration.ticks),
    );
  }

  it('keeps the calm profile at a quarter note or longer', () => {
    for (const role of VOICE_ROLES) {
      expect(shortestOf('calm', role)).toBeGreaterThanOrEqual(Duration.QUARTER.ticks);
    }
  });

  it('gives the flowing profile eighths but nothing shorter', () => {
    expect(shortestOf('flowing', 'lead')).toBe(Duration.EIGHTH.ticks);
  });

  it('actually produces sixteenths in the leading voice', () => {
    expect(shortestOf('sixteenths', 'lead')).toBe(Duration.SIXTEENTH.ticks);
    // The hand underneath is deliberately left slower than the hand reading.
    expect(shortestOf('sixteenths', 'accompaniment')).toBeGreaterThanOrEqual(
      Duration.QUARTER.ticks,
    );
  });
});

describe('RhythmProfileRegistry', () => {
  it('registers, lists and resolves profiles', () => {
    const registry = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);
    expect(registry.list()).toHaveLength(BUILT_IN_RHYTHM_PROFILES.length);
    const first = registry.first();
    expect(registry.get(first.id)).toBe(first);
    expect(registry.has(first.id)).toBe(true);
  });

  it('rejects duplicate ids and unknown lookups', () => {
    const registry = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);
    const [profile] = BUILT_IN_RHYTHM_PROFILES;
    if (profile === undefined) {
      throw new Error('expected built-in rhythm profiles');
    }
    expect(() => registry.register(profile)).toThrow(DomainError);
    expect(() => registry.get('nope')).toThrow(DomainError);
    expect(registry.has('nope')).toBe(false);
  });

  it('refuses to hand out a first profile when empty', () => {
    expect(() => new RhythmProfileRegistry().first()).toThrow(DomainError);
  });
});

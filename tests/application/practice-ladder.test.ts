import { describe, expect, it } from 'vitest';
import { PracticeLadder, type LadderStep } from '../../src/application/ladder/PracticeLadder.js';
import { BUILT_IN_LADDER } from '../../src/application/ladder/ladderSteps.js';
import { ExercisePresetRegistry } from '../../src/domain/generation/ExercisePresetRegistry.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';

function rung(id: string): LadderStep {
  return { id, label: id, description: id, settings: {} };
}

const THREE = new PracticeLadder([rung('a'), rung('b'), rung('c')]);

describe('the arithmetic of a ladder', () => {
  it('knows where each rung sits', () => {
    expect(THREE.positionOf('b')).toBe(2);
    expect(THREE.list()).toHaveLength(3);
  });

  it('steps either way', () => {
    expect(THREE.step('b', 1).id).toBe('c');
    expect(THREE.step('b', -1).id).toBe('a');
  });

  it('stays put at the ends rather than wrapping', () => {
    // The top is a place to stay: a reader still reading cleanly there must
    // not be sent back to the bottom.
    expect(THREE.step('c', 1).id).toBe('c');
    expect(THREE.step('a', -1).id).toBe('a');
    expect(THREE.canStep('c', 1)).toBe(false);
    expect(THREE.canStep('a', -1)).toBe(false);
    expect(THREE.canStep('a', 1)).toBe(true);
  });

  it('falls back to the first rung for an id it does not know', () => {
    // A stored rung from an older release costs the reader their place, not
    // the page.
    expect(THREE.find('rung.gone')).toBeNull();
    expect(THREE.step('rung.gone', 1).id).toBe('a');
  });

  it('refuses a ladder with a repeated rung', () => {
    expect(() => new PracticeLadder([rung('a'), rung('a')])).toThrow(/twice/);
  });
});

describe('the built-in ladder', () => {
  const presets = new ExercisePresetRegistry().registerAll(BUILT_IN_PRESETS);
  const rhythms = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);
  const ladder = new PracticeLadder(BUILT_IN_LADDER);

  it('names only material and rhythms that exist', () => {
    for (const step of ladder.list()) {
      const presetId = step.settings.presetId;
      const rhythmId = step.settings.rhythmProfileId;
      expect({
        rung: step.id,
        preset: presetId === undefined || presets.has(presetId),
        rhythm: rhythmId === undefined || rhythms.has(rhythmId),
      }).toEqual({ rung: step.id, preset: true, rhythm: true });
    }
  });

  it('moves one thing at a time', () => {
    // A rung that changed the notes and the rhythm and the key at once would
    // leave a reader who came unstuck unable to say which of the three did it.
    // The first rung of each preset is exempt: arriving somewhere new states
    // everything, so that there is no inheritance to puzzle over.
    let previousPreset: string | undefined;
    for (const step of ladder.list()) {
      const { presetId, rhythmProfileId, key, timeSignature } = step.settings;
      const arriving = presetId !== undefined && presetId !== previousPreset;
      previousPreset = presetId ?? previousPreset;
      if (arriving) {
        continue;
      }
      const moved = [rhythmProfileId, key, timeSignature].filter(
        (value) => value !== undefined,
      ).length;
      expect({ rung: step.id, moved }).toEqual({ rung: step.id, moved: 1 });
    }
  });

  it('hands over everything a rung stands for, not just what it moved', () => {
    // 8b only says "syncopated"; arriving there must still bring the
    // sequences, the key and the metre the route had already set.
    const resolved = ladder.resolve('rung.8b');

    expect(resolved.rhythmProfileId).toBe('syncopated');
    expect(resolved.presetId).toBe('sequences');
    expect(resolved.key?.fifths).toBe(0);
    expect(resolved.key?.mode).toBe('minor');
    expect(resolved.timeSignature?.toString()).toBe('4/4');
  });

  it('resolves every rung to a complete set of the four it governs', () => {
    for (const step of ladder.list()) {
      const resolved = ladder.resolve(step.id);
      expect({
        rung: step.id,
        complete:
          resolved.presetId !== undefined &&
          resolved.rhythmProfileId !== undefined &&
          resolved.key !== undefined &&
          resolved.timeSignature !== undefined,
      }).toEqual({ rung: step.id, complete: true });
    }
  });

  it('starts where a beginner can start', () => {
    const first = ladder.first();
    expect(first.settings.presetId).toBe('five-finger-c');
    expect(first.settings.rhythmProfileId).toBe('calm');
    expect(first.settings.key?.fifths).toBe(0);
  });

  it('gives every rung a name and a line about it', () => {
    for (const step of ladder.list()) {
      expect({ id: step.id, named: step.label.length > 0 }).toEqual({
        id: step.id,
        named: true,
      });
      expect({ id: step.id, told: step.description.length > 10 }).toEqual({
        id: step.id,
        told: true,
      });
    }
  });
});

import { describe, expect, it } from 'vitest';
import { OneOfTheGenerators } from '../../src/domain/generation/OneOfTheGenerators.js';
import { ExercisePresetRegistry } from '../../src/domain/generation/ExercisePresetRegistry.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import type { ExerciseRequest } from '../../src/domain/generation/IExerciseGenerator.js';

const presets = new ExercisePresetRegistry().registerAll(BUILT_IN_PRESETS);
const MATERIALS = ['melody-and-intervals', 'figures', 'sequences'].map((id) => presets.get(id).generator);
const DRAWN = new OneOfTheGenerators('gen.drawn', 'Drawn', MATERIALS);

const REQUEST: ExerciseRequest = {
  measures: 4,
  key: KeySignature.major(0),
  timeSignature: new TimeSignature(4, 4),
  tempoBpm: 60,
  rhythm: new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES).get('flowing'),
};

describe('a page in one of several materials', () => {
  it('is the very page the material drawn writes from that seed on its own', () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const page = DRAWN.generate({ ...REQUEST, seed });
      const own = MATERIALS.find((generator) => generator.id === page.metadata.generatorId);
      expect(own).toBeDefined();
      expect(page).toEqual(own?.generate({ ...REQUEST, seed }));
    }
  });

  it('draws every material, and the same one for the same seed', () => {
    const drawnAt = (seed: number) => DRAWN.generate({ ...REQUEST, seed }).metadata.generatorId;
    const seen = new Set(Array.from({ length: 60 }, (_, seed) => drawnAt(seed)));
    expect([...seen].sort()).toEqual(['gen.figures', 'gen.melody-intervals', 'gen.sequences']);
    expect(drawnAt(17)).toBe(drawnAt(17));
  });

  it('does not decide the material and the key on the same numbers', () => {
    // Unmixed, the first value the draw and the page both read decided both:
    // with three materials and three keys, each material came in one key.
    const keys = [KeySignature.major(0), KeySignature.major(1), KeySignature.major(-1)];
    const pairs = new Set<string>();
    for (let seed = 0; seed < 90; seed += 1) {
      const page = DRAWN.generate({ ...REQUEST, seed, drawnFrom: { keys } });
      pairs.add(`${page.metadata.generatorId} ${page.key.name}`);
    }
    expect(pairs.size).toBe(9);
  });

  it('keeps the seed it drew a page by, so the page can be written again', () => {
    // Asked for no seed it draws one, and the material must be written from
    // that one: a second, drawn by the material, would point back at a
    // different material two times in three. Several pages, so that a
    // chance agreement cannot pass for keeping it.
    for (let page = 0; page < 12; page += 1) {
      const written = DRAWN.generate(REQUEST);
      expect(DRAWN.generate({ ...REQUEST, seed: written.metadata.seed })).toEqual(written);
    }
  });

  it('refuses to draw from nothing', () => {
    expect(() => new OneOfTheGenerators('gen.none', 'None', [])).toThrow(/no generators/);
  });
});

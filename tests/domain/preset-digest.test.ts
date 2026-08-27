import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { digestPresets } from '../support/presetDigest.js';

/**
 * Guards the difficulty ladder against accidental drift.
 *
 * Generation is seeded, so every preset at its own defaults must produce
 * exactly the same music forever. Refactoring the generation layer - moving
 * rhythm onto its own axis, reordering a random draw - is only safe if this
 * file does not move, and a diff here is readable enough to say what changed.
 */
describe('built-in presets', () => {
  it('generate exactly the music the committed digest records', () => {
    const expected = readFileSync(
      new URL('../fixtures/preset-digest.txt', import.meta.url),
      'utf8',
    );
    expect(digestPresets(BUILT_IN_PRESETS)).toBe(expected);
  });
});

import type { ExercisePreset } from '../../src/domain/generation/ExercisePresetRegistry.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';
import type { RhythmProfile } from '../../src/domain/generation/RhythmProfile.js';
import type { Measure } from '../../src/domain/model/Exercise.js';

const RHYTHMS = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);

/** Fixed seed for every digest line, so the output depends only on the code. */
const SEED = 0x5eed;

function describeMeasure(measure: Measure): string {
  return measure.entries
    .map((entry) => {
      const dotted =
        entry.duration.dots === 1 ? `${entry.duration.type}.` : entry.duration.type;
      // A triplet eighth is still written as an eighth, so the ratio has to be
      // spelled out or the digest cannot tell one from the other.
      const value = entry.duration.isTuplet
        ? `${dotted}*${entry.duration.tuplet.actual}:${entry.duration.tuplet.normal}`
        : dotted;
      if (entry.kind === 'rest') {
        return `R/${value}`;
      }
      return `${entry.pitches.map((pitch) => pitch.toString()).join('+')}/${value}`;
    })
    .join(' ');
}

/**
 * Compact, human-readable rendering of what every preset generates.
 *
 * Used to prove that a refactor of the generation layer changed nothing: the
 * digest is regenerated and compared against a committed fixture, so a
 * reordered random draw or a swapped rhythm pool shows up as a readable diff
 * rather than as a hash mismatch.
 */
export function digestPresets(
  presets: readonly ExercisePreset[],
  rhythm?: RhythmProfile,
): string {
  const lines: string[] = [];
  for (const preset of presets) {
    lines.push(`# ${preset.id}`);
    const exercise = preset.generator.generate({
      measures: preset.defaults.measures,
      timeSignature: preset.defaults.timeSignature,
      key: preset.defaults.key,
      tempoBpm: preset.defaults.tempoBpm,
      rhythm: rhythm ?? RHYTHMS.get(preset.defaults.rhythmProfileId),
      seed: SEED,
    });
    for (const staff of exercise.staves) {
      lines.push(`staff ${staff.staffNumber} (${staff.clef})`);
      staff.measures.forEach((measure, index) => {
        lines.push(`  ${index + 1}: ${describeMeasure(measure)}`);
      });
    }
    lines.push('');
  }
  return lines.join('\n');
}

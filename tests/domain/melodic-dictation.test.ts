import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import { validateExercise, type Exercise } from '../../src/domain/model/Exercise.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { elementAt } from '../../src/shared/asserts.js';
import {
  DICTATIONS_IN_A_ROUND,
  DICTATION_LENGTHS,
  DICTATION_RHYTHMS,
  theMelodicDictation,
  type DictationAsked,
} from '../../src/domain/solfege/melodicDictation.js';

/** Each phrase of a round, note by note: its pitch and its length. */
function phrases(round: Exercise, bars: number): { readonly pitch: Pitch; readonly ticks: number }[][] {
  const measures = round.staves[0]?.measures ?? [];
  return Array.from({ length: DICTATIONS_IN_A_ROUND }, (_, at) =>
    measures.slice(at * bars, (at + 1) * bars).flatMap((measure) =>
      measure.entries.flatMap((entry) => (entry.kind === 'note' ? entry.pitches.map((pitch) => ({ pitch, ticks: entry.duration.ticks })) : [])),
    ),
  );
}

const SEEDS = Array.from({ length: 80 }, (_, seed) => seed + 1);

/** Every way a round may be asked, in C, A minor, and keys of many sharps and flats. */
const ASKED: DictationAsked[] = [0, 3, -4, 7, -7].flatMap((fifths) =>
  [false, true].flatMap((minor) =>
    DICTATION_LENGTHS.flatMap((bars) => DICTATION_RHYTHMS.map((rhythm) => ({ fifths, minor, bars, rhythm, seed: 0 }))),
  ),
);

describe('a melodic dictation', () => {
  it('is a valid round of four phrases, each a question heard after its key, the same for the same seed', () => {
    for (const asked of ASKED) {
      for (const seed of SEEDS.slice(0, 10)) {
        const round = theMelodicDictation({ ...asked, seed });
        expect(() => {
          validateExercise(round);
        }).not.toThrow();
        expect([round.staves[0]?.measures.length, round.byEar]).toEqual([
          DICTATIONS_IN_A_ROUND * asked.bars,
          { questionsAt: Array.from({ length: DICTATIONS_IN_A_ROUND }, (_, at) => at * asked.bars), keyFirst: true },
        ]);
        expect(theMelodicDictation({ ...asked, seed })).toEqual(round);
      }
    }
    const first = (seed: number): string =>
      elementAt(phrases(theMelodicDictation({ ...elementAt(ASKED, 0), seed }), 2), 0)
        .map((note) => note.pitch.toString())
        .join();
    expect(first(1)).not.toEqual(first(2));
  });

  it('writes each phrase as a first dictation is: from the tonic triad, by step or a leap to the triad no wider than a sixth, closing on the tonic by a step from a note reached by a step or a third', () => {
    // Each phrase that breaks a rule, and the rule: checked as plain
    // numbers and said once, since thousands of phrases are asked.
    const broken: string[] = [];
    for (const asked of ASKED) {
      for (const seed of SEEDS) {
        const round = theMelodicDictation({ ...asked, seed });
        const tonic = round.key.tonicIndexAtOrAbove(Pitch.parse('C4').diatonicIndex);
        for (const phrase of phrases(round, asked.bars)) {
          const steps = phrase.map((note) => note.pitch.diatonicIndex - tonic);
          const at = (index: number): number => steps.at(index) ?? Number.NaN;
          const rules: [string, boolean][] = [
            ['begins on the tonic triad', [0, 2, 4].includes(at(0))],
            // Closing: the tonic held two beats, reached by a step from the second or the leading note.
            ['ends on the tonic', at(-1) === 0 || at(-1) === 7],
            ['holds it two beats', phrase.at(-1)?.ticks === Duration.HALF.ticks],
            ['reaches it by a step', Math.abs(at(-2) - at(-1)) === 1],
            // The second or the leading note before it, reached by a step or a third.
            ['reaches the note before it by a step or a third', Math.abs(at(-3) - at(-2)) <= 2],
            // Between the dominant under the tonic and the tonic above, or its third in a long phrase.
            ['stays in range', Math.min(...steps) >= -3 && Math.max(...steps) <= (asked.bars === 4 ? 9 : 7)],
            [
              'moves by step or a leap to the triad no wider than a sixth',
              steps.slice(1, -2).every((step, index) => {
                const leap = Math.abs(step - at(index));
                return leap <= 1 || ([0, 2, 4].includes(((step % 7) + 7) % 7) && leap <= 5);
              }),
            ],
          ];
          for (const [rule, kept] of rules) {
            if (!kept) {
              broken.push(`${rule}: ${steps.join(' ')}`);
            }
          }
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('raises the leading note in minor and never moves to it from the sixth, an augmented second', () => {
    for (const fifths of [0, 3, -4]) {
      for (const seed of SEEDS) {
        const round = theMelodicDictation({ fifths, minor: true, bars: 4, rhythm: 'crotchets', seed });
        const tonic = round.key.tonicIndexAtOrAbove(Pitch.parse('C4').diatonicIndex);
        const tonicMidi = round.key.pitchAt(tonic).midi;
        for (const phrase of phrases(round, 4)) {
          for (const [at, note] of phrase.entries()) {
            const step = note.pitch.diatonicIndex - tonic;
            if (step === -1 || step === 6) {
              // A semitone under the tonic it leads to.
              expect((((tonicMidi - note.pitch.midi) % 12) + 12) % 12).toBe(1);
            }
            const before = phrase[at - 1];
            if (before !== undefined && Math.abs(note.pitch.diatonicIndex - before.pitch.diatonicIndex) === 1) {
              expect(Math.abs(note.pitch.midi - before.pitch.midi)).toBeLessThan(3);
            }
          }
        }
      }
    }
  });

  it('splits some beats into quavers where asked, never the closing tonic, and none in crotchets', () => {
    const lengths = (rhythm: 'crotchets' | 'quavers'): Set<number> =>
      new Set(
        SEEDS.flatMap((seed) =>
          phrases(theMelodicDictation({ fifths: 0, minor: false, bars: 2, rhythm, seed }), 2).flatMap((phrase) => phrase.map((note) => note.ticks)),
        ),
      );
    expect([...lengths('crotchets')].sort((one, other) => one - other)).toEqual([Duration.QUARTER.ticks, Duration.HALF.ticks]);
    expect([...lengths('quavers')].sort((one, other) => one - other)).toEqual([Duration.EIGHTH.ticks, Duration.QUARTER.ticks, Duration.HALF.ticks]);
  });
});

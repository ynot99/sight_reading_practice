import { describe, expect, it } from 'vitest';
import { validateExercise, type Exercise } from '../../src/domain/model/Exercise.js';
import { theChordTheKeysMake, theNumeralOfTheChord } from '../../src/domain/harmony/chordName.js';
import { PROGRESSIONS_IN_A_ROUND, theFunctionsNamed } from '../../src/domain/solfege/functionsNamed.js';

const SEEDS = Array.from({ length: 40 }, (_, seed) => seed + 1);
const KEYS = [0, 2, -3, 6, -7].flatMap((fifths) => [false, true].map((minor) => ({ fifths, minor })));

/** Each bar's chords, the right hand's three keys and the left hand's one. */
function chordsOf(round: Exercise): { readonly right: number[]; readonly left: number }[][] {
  const [right, left] = round.staves;
  return (right?.measures ?? []).map((measure, bar) =>
    measure.entries.map((entry, at) => {
      const bass = left?.measures[bar]?.entries[at];
      return {
        right: entry.kind === 'note' ? entry.pitches.map((pitch) => pitch.midi) : [],
        left: bass?.kind === 'note' ? (bass.pitches[0]?.midi ?? 0) : 0,
      };
    }),
  );
}

describe('functions by name', () => {
  it('is a valid round of six progressions of four chords, both hands, the same for the same seed', () => {
    for (const key of KEYS) {
      for (const seed of SEEDS.slice(0, 10)) {
        const round = theFunctionsNamed({ ...key, seed });
        expect(() => {
          validateExercise(round);
        }).not.toThrow();
        expect([round.staves.map((staff) => staff.measures.length), round.byName?.map((question) => question.parts.length)]).toEqual([
          [PROGRESSIONS_IN_A_ROUND, PROGRESSIONS_IN_A_ROUND],
          Array.from({ length: PROGRESSIONS_IN_A_ROUND }, () => 4),
        ]);
        expect(theFunctionsNamed({ ...key, seed })).toEqual(round);
      }
    }
  });

  it('names each chord as the chart numbers it, its root in the bass, the right hand moving as little as it can', () => {
    const broken: string[] = [];
    for (const key of KEYS) {
      const scale = key.minor ? 'harmonicMinor' : 'major';
      for (const seed of SEEDS) {
        const round = theFunctionsNamed({ ...key, seed });
        chordsOf(round).forEach((bar, at) => {
          const parts = round.byName?.[at]?.parts ?? [];
          bar.forEach((chord, place) => {
            const heard = theChordTheKeysMake([chord.left, ...chord.right], key.fifths, scale);
            const numeral = heard === null ? '' : theNumeralOfTheChord(heard, { fifths: key.fifths, scale });
            const before = bar[place - 1];
            const said = [
              parts[place]?.answer === numeral,
              parts[place]?.choices.includes(numeral) === true,
              ((chord.left % 12) + 12) % 12 === heard?.root,
              before === undefined || chord.right.every((midi, voice) => Math.abs(midi - (before.right[voice] ?? midi)) <= 5),
            ];
            if (said.includes(false)) {
              broken.push(`${String(key.fifths)}${key.minor ? 'm' : ''} bar ${String(at)} chord ${String(place)}: ${String(said)}`);
            }
          });
          // Opening on the tonic, or its relative.
          if (!['I', 'i', 'vi', 'VI'].includes(parts[0]?.answer ?? '')) {
            broken.push(`opens on ${parts[0]?.answer ?? ''}`);
          }
        });
      }
    }
    expect(broken).toEqual([]);
  });

  it('offers the seven chords of the key, the dominant and the leading note raised in minor', () => {
    const choices = (minor: boolean): readonly string[] => theFunctionsNamed({ fifths: 0, minor, seed: 1 }).byName?.[0]?.parts[0]?.choices ?? [];
    expect(choices(false)).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
    expect(choices(true)).toEqual(['i', 'ii°', 'III', 'iv', 'V', 'VI', 'vii°']);
  });
});

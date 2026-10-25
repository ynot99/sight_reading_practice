import { describe, expect, it } from 'vitest';
import { validateExercise } from '../../src/domain/model/Exercise.js';
import { theChordTheKeysMake, theNumeralOfTheChord } from '../../src/domain/harmony/chordName.js';
import { CADENCES, theCadencesNamed } from '../../src/domain/solfege/cadencesNamed.js';
import { PROGRESSIONS_IN_A_ROUND } from '../../src/domain/solfege/functionsNamed.js';

const SEEDS = Array.from({ length: 40 }, (_, seed) => seed + 1);

/** The numerals of the last two chords of each bar, as the chart numbers them. */
function closings(fifths: number, minor: boolean, heard: boolean, seed: number): { readonly said: string; readonly answer: string }[] {
  const round = theCadencesNamed({ fifths, minor, heard, seed });
  const scale = minor ? 'harmonicMinor' : 'major';
  const [right, left] = round.staves;
  return (right?.measures ?? []).map((measure, bar) => {
    const numerals = measure.entries.map((entry, at) => {
      const bass = left?.measures[bar]?.entries[at];
      const keys = [
        ...(bass?.kind === 'note' ? bass.pitches.map((pitch) => pitch.midi) : []),
        ...(entry.kind === 'note' ? entry.pitches.map((pitch) => pitch.midi) : []),
      ];
      const chord = theChordTheKeysMake(keys, fifths, scale);
      return chord === null ? '' : theNumeralOfTheChord(chord, { fifths, scale });
    });
    return { said: numerals.slice(-2).join(' '), answer: round.byName?.[bar]?.parts[0]?.answer ?? '' };
  });
}

describe('cadences by name', () => {
  it('is a valid round of six phrases, read or heard, the same for the same seed', () => {
    for (const heard of [false, true]) {
      for (const minor of [false, true]) {
        const round = theCadencesNamed({ fifths: -2, minor, heard, seed: 3 });
        expect(() => {
          validateExercise(round);
        }).not.toThrow();
        expect([round.title, round.namedByEar, round.staves[0]?.measures.length, round.byName?.[0]?.parts[0]?.choices]).toEqual([
          heard ? 'Cadences by ear' : 'Cadences by name',
          heard ? true : undefined,
          PROGRESSIONS_IN_A_ROUND,
          ['Authentic', 'Plagal', 'Half', 'Deceptive'],
        ]);
        expect(theCadencesNamed({ fifths: -2, minor, heard, seed: 3 })).toEqual(round);
      }
    }
  });

  it('closes each phrase on the cadence it asks, as the chart numbers its last two chords', () => {
    const closes: Readonly<Record<string, readonly string[]>> = {
      Authentic: ['V I', 'V i'],
      Plagal: ['IV I', 'iv i'],
      Half: ['I V', 'ii V', 'IV V', 'i V', 'ii° V', 'iv V'],
      Deceptive: ['V vi', 'V VI'],
    };
    const asked = new Set<string>();
    const broken: string[] = [];
    for (const fifths of [0, 4, -5]) {
      for (const minor of [false, true]) {
        for (const seed of SEEDS) {
          for (const { said, answer } of closings(fifths, minor, false, seed)) {
            asked.add(answer);
            if (closes[answer]?.includes(said) !== true) {
              broken.push(`${String(fifths)}${minor ? 'm' : ''} ${answer}: ${said}`);
            }
          }
        }
      }
    }
    expect(broken).toEqual([]);
    expect([...asked].sort()).toEqual(CADENCES.map((cadence) => cadence.called).sort());
  });
});

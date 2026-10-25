import { describe, expect, it } from 'vitest';
import { validateExercise, type Exercise } from '../../src/domain/model/Exercise.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { theChordTheKeysMake, theNumeralOfTheChord } from '../../src/domain/harmony/chordName.js';
import { PROGRESSION_NAMES, PROGRESSIONS, theProgression, theProgressionNamed } from '../../src/domain/solfege/progressions.js';

/** Every chord played, the right hand's keys and the left's, and the signature it is played under. */
function chordsOf(exercise: Exercise): { readonly right: number[]; readonly left: number; readonly fifths: number }[] {
  const [right, left] = exercise.staves;
  const out: { right: number[]; left: number; fifths: number }[] = [];
  (right?.measures ?? []).forEach((measure, bar) => {
    const fifths = [...exercise.keyChanges].reverse().find((change) => change.measureIndex <= bar)?.key.fifths ?? exercise.key.fifths;
    measure.entries.forEach((entry, at) => {
      const bass = left?.measures[bar]?.entries[at];
      out.push({
        right: entry.kind === 'note' ? entry.pitches.map((pitch) => pitch.midi) : [],
        left: bass?.kind === 'note' ? (bass.pitches[0]?.midi ?? 0) : 0,
        fifths,
      });
    });
  });
  return out;
}

const ASKED = PROGRESSION_NAMES.flatMap((progression) =>
  [false, true].flatMap((minor) => [false, true].map((throughEveryKey) => ({ progression, minor, throughEveryKey }))),
);

describe('a progression to play', () => {
  it('is valid in every key, and through every key round the circle a fifth down at a time', () => {
    for (const asked of ASKED) {
      for (const fifths of [0, 4, -5, 7, -7]) {
        const exercise = theProgression({ ...asked, fifths });
        expect(() => {
          validateExercise(exercise);
        }).not.toThrow();
        if (asked.throughEveryKey) {
          const keys = [exercise.key.fifths, ...exercise.keyChanges.map((change) => change.key.fifths)];
          expect(keys).toHaveLength(12);
          // Each a fifth below the last, G flat for F sharp, B for C flat.
          expect(keys.every((key, at) => at === 0 || (((keys[at - 1] ?? 0) - key - 1) % 12 === 0 && key >= -6 && key <= 5))).toBe(true);
        } else {
          expect([exercise.key.fifths, exercise.keyChanges]).toEqual([fifths, []]);
        }
      }
    }
  });

  it('plays every chord as its numeral says, the root in the bass, the right hand moving as little as it can and each hand in its place', () => {
    const broken: string[] = [];
    for (const asked of ASKED) {
      for (const fifths of [0, 3, -4]) {
        const exercise = theProgression({ ...asked, fifths });
        const named = theProgressionNamed(asked.progression, asked.minor).split('–');
        const scale = asked.minor ? 'harmonicMinor' : 'major';
        chordsOf(exercise).forEach((chord, at, all) => {
          const heard = theChordTheKeysMake([chord.left, ...chord.right], chord.fifths, scale);
          const numeral = heard === null ? '' : theNumeralOfTheChord(heard, { fifths: chord.fifths, scale });
          const before = all[at - 1];
          const said = [
            numeral === named[at % named.length],
            ((chord.left % 12) + 12) % 12 === heard?.root,
            before === undefined || chord.right.every((midi, voice) => Math.abs(midi - (before.right[voice] ?? midi)) <= 5),
            chord.right.every((midi) => midi >= Pitch.parse('F3').midi && midi <= Pitch.parse('A5').midi),
            chord.left >= Pitch.parse('E2').midi && chord.left <= Pitch.parse('E3').midi,
          ];
          if (said.includes(false)) {
            broken.push(`${asked.progression} ${asked.minor ? 'minor' : 'major'} ${String(fifths)} chord ${String(at)} ${numeral}: ${String(said)}`);
          }
        });
      }
    }
    expect(broken).toEqual([]);
  });

  it('is called by its numerals, as the chart of chords numbers them, and where it is played', () => {
    expect(PROGRESSION_NAMES.map((name) => theProgressionNamed(name, false))).toEqual(['I–IV–V–I', 'I–IV–V7–I', 'I–vi–ii–V–I', 'ii7–V7–I', 'I–IV–vii°–iii–vi–ii–V–I']);
    expect(PROGRESSION_NAMES.map((name) => theProgressionNamed(name, true))).toEqual(['i–iv–V–i', 'i–iv–V7–i', 'i–VI–ii°–V–i', 'iiø7–V7–i', 'i–iv–♭VII–III–VI–ii°–V–i']);
    expect(theProgression({ progression: 'dominantSeventh', fifths: -3, minor: false, throughEveryKey: false }).title).toBe('I–IV–V7–I in E♭ major');
    expect(theProgression({ progression: 'cadence', fifths: 0, minor: true, throughEveryKey: true }).title).toBe('i–iv–V–i through every key');
    // A minim a chord, the last held a whole bar where the chords leave half of one.
    const lengths = (progression: keyof typeof PROGRESSIONS): number => theProgression({ progression, fifths: 0, minor: false, throughEveryKey: false }).staves[0]?.measures.length ?? 0;
    expect([lengths('cadence'), lengths('turnaround'), lengths('twoFiveOne'), lengths('circle')]).toEqual([2, 3, 2, 4]);
  });
});

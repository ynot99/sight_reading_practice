import { describe, expect, it } from 'vitest';
import { validateExercise } from '../../src/domain/model/Exercise.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { theChordTheKeysMake } from '../../src/domain/harmony/chordName.js';
import { CHORDS_IN_A_ROUND, POSITIONS, TRIADS, theChordsNamed } from '../../src/domain/solfege/chordsNamed.js';

const SEEDS = Array.from({ length: 60 }, (_, seed) => seed + 1);

/** What the program names a triad of each quality, by its kind. */
const SUFFIXES: Readonly<Record<string, string>> = {
  Major: '',
  Minor: 'm',
  Diminished: 'dim',
  Augmented: '+',
  'Dominant seventh': '7',
  'Major seventh': 'maj7',
  'Minor seventh': 'm7',
  'Half-diminished seventh': 'm7♭5',
  'Diminished seventh': 'dim7',
};

describe('chords by name', () => {
  it('is a valid round of ten chords, a bar each, the same for the same seed', () => {
    for (const inversions of [false, true]) {
      for (const seed of SEEDS) {
        const round = theChordsNamed({ asks: inversions ? 'positions' : 'quality', heard: false, seed });
        expect(() => {
          validateExercise(round);
        }).not.toThrow();
        expect([round.title, round.staves[0]?.measures.length, round.byName?.map((question) => question.measureIndex)]).toEqual([
          'Chords by name',
          CHORDS_IN_A_ROUND,
          Array.from({ length: CHORDS_IN_A_ROUND }, (_, at) => at),
        ]);
        expect(theChordsNamed({ asks: inversions ? 'positions' : 'quality', heard: false, seed })).toEqual(round);
      }
    }
  });

  it('asks each triad its quality - and its position, where asked - as the program itself names it, spelled by thirds, between the A under middle C and the A two octaves up', () => {
    const asked = new Set<string>();
    const broken: string[] = [];
    for (const inversions of [false, true]) {
      for (const seed of SEEDS) {
        const round = theChordsNamed({ asks: inversions ? 'positions' : 'quality', heard: false, seed });
        round.staves[0]?.measures.forEach((measure, at) => {
          const entry = measure.entries[0];
          const notes = entry?.kind === 'note' ? entry.pitches : [];
          const parts = round.byName?.[at]?.parts ?? [];
          const quality = parts[0]?.answer ?? '';
          const position = parts[1]?.answer ?? 'Root position';
          asked.add(`${quality} ${position}`);
          const heard = theChordTheKeysMake(notes.map((pitch) => pitch.midi));
          const lowest = notes.reduce((low, pitch) => (pitch.midi < low.midi ? pitch : low), notes[0] ?? Pitch.parse('C4'));
          // Its root where its position puts it: at the bottom, or the third or the fifth there.
          const bass = (((lowest.midi - (heard?.root ?? 0)) % 12) + 12) % 12;
          const triad = TRIADS.find((each) => each.called === quality);
          const said = [
            heard?.kind.suffix === SUFFIXES[quality],
            quality === 'Augmented' || bass === [0, triad?.third, triad?.fifth][POSITIONS.indexOf(position as (typeof POSITIONS)[number])],
            // Stacked in thirds by letter, from whichever note the bass is.
            notes.every((pitch, index) => index === 0 || [2, 3].includes(pitch.diatonicIndex - (notes[index - 1]?.diatonicIndex ?? 0))),
            notes.every((pitch) => pitch.midi >= Pitch.parse('A3').midi && pitch.midi <= Pitch.parse('A5').midi),
            parts[0]?.choices.join() === 'Major,Minor,Diminished,Augmented',
            inversions ? parts[1]?.choices.join() === POSITIONS.join() : parts.length === 1,
          ];
          if (said.includes(false)) {
            broken.push(`${notes.map((pitch) => pitch.toString()).join(' ')} ${quality} ${position}: ${String(said)}`);
          }
        });
      }
    }
    expect(broken).toEqual([]);
    // Every quality, and every position where asked, comes up.
    expect(asked.size).toBe(TRIADS.length * POSITIONS.length);
  });

  it('roots its chords on flats as often as on sharps', () => {
    const roots = SEEDS.flatMap((seed) =>
      (theChordsNamed({ asks: 'quality', heard: false, seed }).staves[0]?.measures ?? []).map((measure) => {
        const entry = measure.entries[0];
        return entry?.kind === 'note' ? (entry.pitches[0]?.alter ?? 0) : 0;
      }),
    );
    expect(roots).toContain(1);
    expect(roots).toContain(-1);
  });

  it('asks seventh chords among the triads where asked, in root position, as the program names them, read or heard', () => {
    const asked = new Set<string>();
    const broken: string[] = [];
    for (const seed of Array.from({ length: 60 }, (_, at) => at + 1)) {
      const round = theChordsNamed({ asks: 'sevenths', heard: false, seed });
      round.staves[0]?.measures.forEach((measure, at) => {
        const entry = measure.entries[0];
        const notes = entry?.kind === 'note' ? entry.pitches : [];
        const parts = round.byName?.[at]?.parts ?? [];
        const quality = parts[0]?.answer ?? '';
        asked.add(quality);
        const heard = theChordTheKeysMake(notes.map((pitch) => pitch.midi));
        const said = [
          heard?.kind.suffix === SUFFIXES[quality],
          (((notes[0]?.midi ?? 0) - (heard?.root ?? 0)) % 12 + 12) % 12 === 0 || quality === 'Augmented' || quality === 'Diminished seventh',
          parts.length === 1 && parts[0]?.choices.length === 9,
          notes.every((pitch) => pitch.midi >= Pitch.parse('A3').midi && pitch.midi <= Pitch.parse('A5').midi),
        ];
        if (said.includes(false)) {
          broken.push(`${notes.map((pitch) => pitch.toString()).join(' ')} ${quality}: ${String(said)}`);
        }
      });
    }
    expect(broken).toEqual([]);
    expect(asked.size).toBe(9);
    // Heard: the same chords, named by ear.
    const heard = theChordsNamed({ asks: 'sevenths', heard: true, seed: 3 });
    const read = theChordsNamed({ asks: 'sevenths', heard: false, seed: 3 });
    expect([heard.title, heard.namedByEar, read.namedByEar, heard.staves]).toEqual(['Chords by ear', true, undefined, read.staves]);
  });
});

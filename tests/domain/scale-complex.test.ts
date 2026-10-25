import { describe, expect, it } from 'vitest';
import { validateExercise, type Exercise } from '../../src/domain/model/Exercise.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { SCALE_COMPLEX_SCALES, theScaleComplex } from '../../src/domain/solfege/scaleComplex.js';

/** What a hand plays, entry by entry, each chord its notes low to high. */
function played(exercise: Exercise, staffNumber: number): string[] {
  return (exercise.staves.find((staff) => staff.staffNumber === staffNumber)?.measures ?? []).flatMap((measure) =>
    measure.entries.flatMap((entry) => (entry.kind === 'note' ? [entry.pitches.map((pitch) => pitch.toString()).join(' ')] : [])),
  );
}

/** A hand's part, from its first bar of a part to the bar before the next. */
function part(exercise: Exercise, staffNumber: number, name: string): string[] {
  const marks = exercise.rehearsalMarks ?? [];
  const at = marks.findIndex((mark) => mark.text === name);
  const from = marks[at]?.measureIndex ?? 0;
  const until = marks[at + 1]?.measureIndex ?? exercise.staves[0]?.measures.length ?? 0;
  const staff = exercise.staves.find((each) => each.staffNumber === staffNumber);
  return played({ ...exercise, staves: staff === undefined ? [] : [{ ...staff, measures: staff.measures.slice(from, until) }] }, staffNumber);
}

describe('a scale complex', () => {
  it('is a valid exercise in every key and every scale, the same each time it is asked for', () => {
    for (let fifths = -7; fifths <= 7; fifths++) {
      for (const scale of SCALE_COMPLEX_SCALES) {
        const exercise = theScaleComplex({ fifths, scale });
        expect(() => {
          validateExercise(exercise);
        }).not.toThrow();
        expect(buildTimeline(exercise).steps.length).toBeGreaterThan(0);
        expect(theScaleComplex({ fifths, scale })).toEqual(exercise);
      }
    }
  });

  it('plays the scale two octaves, the long arpeggio, the tonic chord in its positions and the cadence, each named where it begins', () => {
    const complex = theScaleComplex({ fifths: 0, scale: 'major' });
    expect(complex.title).toBe('C major: scale, arpeggio, chords, cadence');
    expect(complex.rehearsalMarks).toEqual([
      { measureIndex: 0, offsetTicks: 0, text: 'Scale' },
      { measureIndex: 4, offsetTicks: 0, text: 'Arpeggio' },
      { measureIndex: 6, offsetTicks: 0, text: 'Chords' },
      { measureIndex: 8, offsetTicks: 0, text: 'Cadence' },
    ]);
    expect(complex.staves.map((staff) => staff.measures.length)).toEqual([10, 10]);
    const up = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const scale = [...up.map((step) => `${step}4`), ...up.map((step) => `${step}5`), 'C6'];
    expect(part(complex, 1, 'Scale')).toEqual([...scale, ...scale.slice(1, -1).reverse(), 'C4']);
    // The left hand two octaves under it.
    expect(part(complex, 2, 'Scale')).toEqual(part(complex, 1, 'Scale').map((note) => note.replace(/\d/, (octave) => String(Number(octave) - 2))));
    expect(part(complex, 1, 'Arpeggio')).toEqual(['C4', 'E4', 'G4', 'C5', 'E5', 'G5', 'C6', 'G5', 'E5', 'C5', 'G4', 'E4', 'C4']);
    expect(part(complex, 2, 'Arpeggio')[0]).toBe('C2');
    expect(part(complex, 1, 'Chords')).toEqual(['C4 E4 G4', 'E4 G4 C5', 'G4 C5 E5', 'C5 E5 G5', 'G4 C5 E5', 'E4 G4 C5', 'C4 E4 G4']);
    expect(part(complex, 2, 'Chords')[0]).toBe('C3 E3 G3');
    expect(part(complex, 1, 'Cadence')).toEqual(['C4 E4 G4', 'C4 F4 A4', 'B3 D4 G4', 'C4 E4 G4']);
    expect(part(complex, 2, 'Cadence')).toEqual(['C3', 'F2', 'G2', 'C3']);
  });

  it('plays a minor scale in the form asked for, its cadence a major dominant in every form, its tonic chords as the key writes them', () => {
    const scaleOf = (scale: 'minor' | 'harmonicMinor' | 'melodicMinor'): string[] => part(theScaleComplex({ fifths: 0, scale }), 1, 'Scale');
    // Up, then down from the top.
    const upAndDown = (notes: string[]): [string[], string[]] => [notes.slice(0, 8), notes.slice(14, 22)];
    expect(upAndDown(scaleOf('minor'))).toEqual([
      ['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4'],
      ['A5', 'G5', 'F5', 'E5', 'D5', 'C5', 'B4', 'A4'],
    ]);
    expect(upAndDown(scaleOf('harmonicMinor'))).toEqual([
      ['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G#4', 'A4'],
      ['A5', 'G#5', 'F5', 'E5', 'D5', 'C5', 'B4', 'A4'],
    ]);
    expect(upAndDown(scaleOf('melodicMinor'))).toEqual([
      ['A3', 'B3', 'C4', 'D4', 'E4', 'F#4', 'G#4', 'A4'],
      ['A5', 'G5', 'F5', 'E5', 'D5', 'C5', 'B4', 'A4'],
    ]);
    for (const scale of ['minor', 'harmonicMinor', 'melodicMinor'] as const) {
      const complex = theScaleComplex({ fifths: 0, scale });
      expect(part(complex, 1, 'Cadence')).toEqual(['A3 C4 E4', 'A3 D4 F4', 'G#3 B3 E4', 'A3 C4 E4']);
      expect(part(complex, 1, 'Chords')[0]).toBe('A3 C4 E4');
    }
  });

  it('spells every note as its key does, a raised leading note on its own letter, and begins each key near middle C', () => {
    // F sharp minor: its leading note is E sharp, not F.
    expect(part(theScaleComplex({ fifths: 3, scale: 'harmonicMinor' }), 1, 'Scale').slice(0, 8)).toEqual([
      'F#4',
      'G#4',
      'A4',
      'B4',
      'C#5',
      'D5',
      'E#5',
      'F#5',
    ]);
    // A sharp minor's is G double sharp.
    expect(part(theScaleComplex({ fifths: 7, scale: 'harmonicMinor' }), 1, 'Cadence')[2]).toBe('G##3 B#3 E#4');
    expect(part(theScaleComplex({ fifths: -3, scale: 'major' }), 1, 'Scale')[0]).toBe('Eb4');
    expect(part(theScaleComplex({ fifths: 5, scale: 'major' }), 1, 'Scale')[0]).toBe('B3');
    expect(part(theScaleComplex({ fifths: 3, scale: 'major' }), 1, 'Scale')[0]).toBe('A3');
    expect(part(theScaleComplex({ fifths: 2, scale: 'major' }), 1, 'Scale')[0]).toBe('D4');
  });

  it('refuses a key past seven sharps or flats, as a key signature does', () => {
    expect(() => theScaleComplex({ fifths: 8, scale: 'major' })).toThrow();
    expect(() => theScaleComplex({ fifths: 0.5, scale: 'major' })).toThrow();
  });
});

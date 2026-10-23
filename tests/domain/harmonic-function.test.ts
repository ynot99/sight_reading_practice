import { describe, expect, it } from 'vitest';
import { CHORD_KINDS, type ChordKind } from '../../src/domain/harmony/chordName.js';
import { theChordsOfTheScale } from '../../src/domain/harmony/chordsOfTheKey.js';
import { theChordInTheKey, theNotesOfTheChordNamed } from '../../src/domain/harmony/harmonicFunction.js';
import { SCALE_NAMES, thePitchClassesOfTheScale } from '../../src/domain/harmony/scales.js';

/** A kind of chord by its name after the root. */
function kind(suffix: string): ChordKind {
  const found = CHORD_KINDS.find((each) => each.suffix === suffix);
  if (found === undefined) {
    throw new Error(`no kind ${suffix}`);
  }
  return found;
}

const C_MAJOR = { fifths: 0, scale: 'major' as const };
const A_MINOR = { fifths: 0, scale: 'minor' as const };

describe('what a chord does in its key', () => {
  it('rests on the first, third and sixth degrees, moves away on the second and fourth, and pulls back on the fifth and seventh, in every key', () => {
    // Swept: every scale on every signature, its own seven triads.
    for (const scale of SCALE_NAMES) {
      for (let fifths = -7; fifths <= 7; fifths += 1) {
        const chords = theChordsOfTheScale(fifths, scale);
        const tones = thePitchClassesOfTheScale(fifths, scale);
        const done = chords.map(({ midis }) => {
          const root = (midis[0] ?? 0) % 12;
          const intervals = midis.map((midi) => midi - (midis[0] ?? 0));
          const triad = CHORD_KINDS.find((each) => each.intervals.join() === intervals.join()) ?? kind('');
          expect(tones.indexOf(root), `${scale} ${String(fifths)}`).toBeGreaterThanOrEqual(0);
          return theChordInTheKey({ root, kind: triad }, { fifths, scale });
        });
        expect(done.map((each) => each.function), `${scale} ${String(fifths)}`).toEqual([
          'tonic',
          'subdominant',
          'tonic',
          'subdominant',
          'dominant',
          'tonic',
          'dominant',
        ]);
        // A key's own chords are all of it.
        expect(done.every((each) => each.ofTheKey), `${scale} ${String(fifths)}`).toBe(true);
      }
    }
  });

  it('says a chord with a note outside the key is outside it, doing what its degree does where its root is a degree', () => {
    // F minor in C major, borrowed from the minor: subdominant still.
    expect(theChordInTheKey({ root: 5, kind: kind('m') }, C_MAJOR)).toEqual({ function: 'subdominant', ofTheKey: false });
    // D major in C, the dominant of the dominant: on the second degree.
    expect(theChordInTheKey({ root: 2, kind: kind('') }, C_MAJOR)).toEqual({ function: 'subdominant', ofTheKey: false });
    // A seventh adds a note: G7 is of C major, Gmaj7 is not.
    expect(theChordInTheKey({ root: 7, kind: kind('7') }, C_MAJOR)).toEqual({ function: 'dominant', ofTheKey: true });
    expect(theChordInTheKey({ root: 7, kind: kind('maj7') }, C_MAJOR)).toEqual({ function: 'dominant', ofTheKey: false });
  });

  it('gives a root that is no degree of the scale no function', () => {
    // B flat and A flat in C major: the flat seventh and sixth.
    expect(theChordInTheKey({ root: 10, kind: kind('') }, C_MAJOR)).toEqual({ function: null, ofTheKey: false });
    expect(theChordInTheKey({ root: 8, kind: kind('') }, C_MAJOR)).toEqual({ function: null, ofTheKey: false });
    // A root given past the octave is the same root.
    expect(theChordInTheKey({ root: 19, kind: kind('') }, C_MAJOR)).toEqual({ function: 'dominant', ofTheKey: true });
  });

  it('counts a minor key\'s raised sixth and seventh as its own, and only a minor key\'s', () => {
    // E major and G sharp diminished in A minor: its dominant and leading-note chords.
    expect(theChordInTheKey({ root: 4, kind: kind('') }, A_MINOR)).toEqual({ function: 'dominant', ofTheKey: true });
    expect(theChordInTheKey({ root: 4, kind: kind('7') }, A_MINOR)).toEqual({ function: 'dominant', ofTheKey: true });
    // D major, with the raised sixth: the melodic minor's.
    expect(theChordInTheKey({ root: 2, kind: kind('') }, A_MINOR)).toEqual({ function: 'subdominant', ofTheKey: true });
    // Not in dorian, whose sixth is raised already and seventh is not: A major in D dorian has a C sharp.
    expect(theChordInTheKey({ root: 9, kind: kind('') }, { fifths: 0, scale: 'dorian' })).toEqual({ function: 'dominant', ofTheKey: false });
    // Nor a note neither way, C sharp minor's in A minor.
    expect(theChordInTheKey({ root: 1, kind: kind('m') }, A_MINOR)).toEqual({ function: null, ofTheKey: false });
  });

  it('names the notes of a chord from its root up, the root as the key spells it and the rest a letter a step', () => {
    expect(theNotesOfTheChordNamed({ root: 9, kind: kind('m7') }, 0)).toEqual(['A', 'C', 'E', 'G']);
    expect(theNotesOfTheChordNamed({ root: 3, kind: kind('') }, -3)).toEqual(['E♭', 'G', 'B♭']);
    // A thing a key with sharps calls D sharp has a double-sharp third.
    expect(theNotesOfTheChordNamed({ root: 3, kind: kind('') }, 4)).toEqual(['D♯', 'F♯♯', 'A♯']);
    // E major in A minor, which charts would spell with an A flat.
    expect(theNotesOfTheChordNamed({ root: 4, kind: kind('') }, 0)).toEqual(['E', 'G♯', 'B']);
    // G flat suspended: a C flat, not a B.
    expect(theNotesOfTheChordNamed({ root: 6, kind: kind('sus4') }, -4)).toEqual(['G♭', 'C♭', 'D♭']);
    // The diminished seventh's seventh is a seventh; the sixth's sixth a sixth.
    expect(theNotesOfTheChordNamed({ root: 11, kind: kind('dim7') }, 0)).toEqual(['B', 'D', 'F', 'A♭']);
    expect(theNotesOfTheChordNamed({ root: 0, kind: kind('6') }, 0)).toEqual(['C', 'E', 'G', 'A']);
    expect(theNotesOfTheChordNamed({ root: 0, kind: kind('m7♭5') }, 0)).toEqual(['C', 'E♭', 'G♭', 'B♭']);
    expect(theNotesOfTheChordNamed({ root: 0, kind: kind('+') }, 0)).toEqual(['C', 'E', 'G♯']);
    expect(theNotesOfTheChordNamed({ root: 2, kind: kind('9') }, 0)).toEqual(['D', 'E', 'F♯', 'A', 'C']);
    // Every kind on every root in every signature: a letter a step, never more than two sharps or flats from it.
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      for (let root = 0; root < 12; root += 1) {
        for (const each of CHORD_KINDS) {
          const named = theNotesOfTheChordNamed({ root, kind: each }, fifths);
          expect(named).toHaveLength(each.intervals.length);
          expect(new Set(named.map((note) => note[0])).size, `${String(root)}${each.suffix} ${String(fifths)}`).toBe(named.length);
          for (const note of named) {
            expect(note).toMatch(/^[A-G](♯{0,2}|♭{0,2})$/);
          }
          // And each is the note it names.
          const pitchOf = (note: string): number =>
            ([0, 2, 4, 5, 7, 9, 11][['C', 'D', 'E', 'F', 'G', 'A', 'B'].indexOf(note[0] ?? '')] ?? 0) +
            [...note.slice(1)].reduce((sum, sign) => sum + (sign === '♯' ? 1 : -1), 0);
          expect(named.map((note) => (((pitchOf(note) - root) % 12) + 12) % 12)).toEqual([...each.intervals].map((step) => step % 12));
        }
      }
    }
  });
});

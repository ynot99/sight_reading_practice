import { describe, expect, it } from 'vitest';
import {
  CHORD_KINDS,
  nameOfThePitchClass,
  nameTheChord,
  theChordTheKeysMake,
  theChordTheNotesMake,
  theNotesOfTheChordNamed,
  theNumeralOfTheChord,
  type ChordHeard,
} from '../../src/domain/harmony/chordName.js';
import { theChordsOfTheScale } from '../../src/domain/harmony/chordsOfTheKey.js';
import { SCALE_NAMES, thePitchClassesOfTheScale } from '../../src/domain/harmony/scales.js';

/** Middle C's octave, so a chord built on a root lies where a hand would play it. */
const C4 = 60;

/** The notes of a kind on a root, the lowest of them the `inversion`th, raised an octave to stand on top. */
/** The pitch class a name begins with: its letter and the sharps or flats after it, before any kind. */
function thePitchClassNamed(name: string): number {
  const note = /^[A-G][♯♭]*/.exec(name)?.[0] ?? '';
  const letter = [0, 2, 4, 5, 7, 9, 11]['CDEFGAB'.indexOf(note.charAt(0))] ?? 0;
  return (((letter + [...note].filter((sign) => sign === '♯').length - [...note].filter((sign) => sign === '♭').length) % 12) + 12) % 12;
}

function voiced(root: number, intervals: readonly number[], inversion = 0): number[] {
  const notes = intervals.map((step) => C4 + root + step);
  return notes.map((midi, at) => (at < inversion ? midi + 12 : midi));
}

describe('naming the chord held', () => {
  it('names every kind on every root, standing on its root', () => {
    // Swept rather than sampled: every one of the twelve roots, every kind.
    for (let root = 0; root < 12; root += 1) {
      for (const kind of CHORD_KINDS) {
        const expected = `${nameOfThePitchClass(root, null)}${kind.suffix}`;
        expect(nameTheChord(voiced(root, kind.intervals)), expected).toBe(expected);
      }
    }
  });

  it('names every inversion over its bass, but where the notes are another chord on that bass', () => {
    // A chord whose notes, from its bass, are a kind of their own is that
    // chord: C E G A over A is A minor seventh. The rest are said over the
    // bass - as themselves, or as a plainer kind the same notes make: Csus2
    // with D below is Gsus4 over D.
    for (let root = 0; root < 12; root += 1) {
      for (const kind of CHORD_KINDS) {
        for (let inversion = 1; inversion < kind.intervals.length; inversion += 1) {
          const notes = voiced(root, kind.intervals, inversion);
          const said = nameTheChord(notes);
          // Its bass named as its notes are, a letter a step from the root.
          const bass = theNotesOfTheChordNamed({ root, kind }, 0)[inversion] ?? '';
          const slash = `${nameOfThePitchClass(root, null)}${kind.suffix}/${bass}`;
          const label = `${slash} as ${notes.join(' ')}`;
          if (said === slash) {
            continue;
          }
          // Otherwise it stood on its bass as some other kind, or was a
          // plainer kind over the same bass - never named over another.
          const bassPitch = (root + (kind.intervals[inversion] ?? 0)) % 12;
          const [named, under] = (said ?? '').split('/');
          const onTheBass = under === undefined && thePitchClassNamed(named ?? '') === bassPitch;
          expect(onTheBass || (under !== undefined && thePitchClassNamed(under) === bassPitch), `${label}: ${String(said)}`).toBe(true);
          expect(said, label).not.toBeNull();
        }
      }
    }
  });

  it('reads the ambiguous chords off the bass', () => {
    expect(nameTheChord([60, 64, 67, 69])).toBe('C6');
    expect(nameTheChord([57, 60, 64, 67])).toBe('Am7');
    // Neither on the bass: the plainer kind, said over it.
    expect(nameTheChord([52, 57, 60, 67])).toBe('Am7/E');
    expect(nameTheChord([60, 62, 67])).toBe('Csus2');
    expect(nameTheChord([55, 60, 62])).toBe('Gsus4');
    expect(nameTheChord([60, 63, 66, 70])).toBe('Cm7♭5');
    expect(nameTheChord([63, 66, 70, 72])).toBe('E♭m6');
    // Symmetrical chords stand on whatever is lowest.
    expect(nameTheChord([63, 66, 69, 72])).toBe('E♭dim7');
    expect(nameTheChord([64, 68, 72])).toBe('E+');
  });

  it('takes a seventh or a ninth with its fifth left out, never the chords the fifth defines', () => {
    expect(nameTheChord([48, 64, 70])).toBe('C7');
    expect(nameTheChord([48, 64, 71])).toBe('Cmaj7');
    expect(nameTheChord([48, 63, 70])).toBe('Cm7');
    expect(nameTheChord([48, 62, 64, 70])).toBe('C9');
    // With the fifth, the same chord all the same.
    expect(nameTheChord([48, 55, 64, 70])).toBe('C7');
    // A cluster is not an add-nine with its fifth gone.
    expect(nameTheChord([60, 62, 64])).toBeNull();
  });

  it('cares nothing for octaves or doublings, only for which note is lowest', () => {
    expect(nameTheChord([36, 48, 64, 67, 72, 76, 79])).toBe('C');
    expect(nameTheChord([40, 60, 67, 72, 79])).toBe('C/E');
  });

  it('names nothing for no notes, one note in any octaves, or notes it has no name for', () => {
    expect(nameTheChord([])).toBeNull();
    expect(nameTheChord([60])).toBeNull();
    expect(nameTheChord([48, 60, 72])).toBeNull();
    expect(nameTheChord([60, 61])).toBeNull();
    expect(nameTheChord([60, 61, 62, 63])).toBeNull();
    // A third alone is no chord: only the fifth may be left out, and only of
    // the chords it does not define.
    expect(nameTheChord([60, 63])).toBeNull();
    expect(nameTheChord([60, 64])).toBeNull();
    // A fifth alone is the one two-note chord with a name.
    expect(nameTheChord([60, 67])).toBe('C5');
  });

  it('spells the black keys as the key signature does, and as chord charts do with none', () => {
    const fSharpMajor = [66, 70, 73];
    expect(nameTheChord(fSharpMajor, 2)).toBe('F♯');
    expect(nameTheChord(fSharpMajor, -3)).toBe('G♭');
    expect(nameTheChord(fSharpMajor, 0)).toBe('F♯');
    expect(nameTheChord([63, 67, 70])).toBe('E♭');
    expect(nameTheChord([63, 67, 70], 4)).toBe('D♯');
    // The bass is a tone of the chord, and spelled as its notes are, whatever the key: C7's seventh is B♭, E's third G♯.
    expect(nameTheChord([58, 60, 64, 67], 0)).toBe('C7/B♭');
    expect(nameTheChord([58, 60, 64, 67], 3)).toBe('C7/B♭');
    expect(nameTheChord([56, 64, 71], 0)).toBe('E/G♯');
    expect(nameTheChord([56, 64, 71], -3)).toBe('E/G♯');
    expect(nameTheChord([63, 68, 72], 0)).toBe('A♭/E♭');
    expect(nameTheChord([55, 63, 70])).toBe('E♭/G');
    // White keys keep their letters.
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      expect(nameOfThePitchClass(4, fifths)).toBe('E');
    }
  });
});

describe('the chord the keys held make', () => {
  it('is the chord named, with its root and kind, on every root, every kind and every inversion', () => {
    for (let root = 0; root < 12; root += 1) {
      for (const kind of CHORD_KINDS) {
        // Standing on its root, it is that root and that kind.
        const chord = theChordTheKeysMake(voiced(root, kind.intervals), 3);
        expect([chord?.name, chord?.root, chord?.kind, chord?.exactly]).toEqual([
          `${nameOfThePitchClass(root, 3)}${kind.suffix}`,
          root,
          kind,
          true,
        ]);
        // Over another bass, named as the chord is named.
        for (let inversion = 1; inversion < kind.intervals.length; inversion += 1) {
          const keys = voiced(root, kind.intervals, inversion);
          expect(theChordTheKeysMake(keys, 3)?.name ?? null).toBe(nameTheChord(keys, 3));
        }
      }
    }
    expect(theChordTheKeysMake([64, 67, 72])).toMatchObject({ name: 'C/E', root: 0, kind: CHORD_KINDS[0] });
    expect(theChordTheKeysMake([57, 60, 64, 67])).toMatchObject({ name: 'Am7', root: 9 });
  });

  it('is none where the keys make no chord with a name', () => {
    expect(theChordTheKeysMake([])).toBeNull();
    expect(theChordTheKeysMake([60])).toBeNull();
    expect(theChordTheKeysMake([60, 61, 62])).toBeNull();
  });
});

describe('the chord some notes mostly make', () => {
  const A2 = 45;
  const note = (midi: number, lengthMs: number): { midi: number; lengthMs: number } => ({ midi, lengthMs });
  /** What a reading says: its name, and whether exactly. */
  const heard = (chord: ChordHeard | null): { name: string; exactly: boolean } | null =>
    chord === null ? null : { name: chord.name, exactly: chord.exactly };

  it('names a chord they make exactly as such', () => {
    expect(heard(theChordTheNotesMake([note(C4, 500), note(C4 + 4, 500), note(C4 + 7, 500)]))).toEqual({ name: 'C', exactly: true });
    expect(theChordTheNotesMake([])).toBeNull();
  });

  it('names a broken chord under a melody passing over it by the chord, as mostly that', () => {
    // A minor held in the left hand, and B, D and G passing over it.
    const notes = [note(A2, 1_000), note(C4, 1_000), note(C4 + 4, 1_000), note(C4 + 11, 200), note(C4 + 14, 200), note(C4 + 7, 100)];
    expect(nameTheChord(notes.map((each) => each.midi))).toBeNull();
    expect(heard(theChordTheNotesMake(notes))).toEqual({ name: 'Am', exactly: false });
    // Where the G sounds as long as the rest, it is the seventh: on the bass,
    // where A minor seventh and C sixth are the same notes.
    const seventh = [note(A2, 1_000), note(C4, 1_000), note(C4 + 4, 1_000), note(C4 + 7, 1_000), note(C4 + 14, 100)];
    expect(heard(theChordTheNotesMake(seventh))).toEqual({ name: 'Am7', exactly: false });
    // Over the lowest note where that is another tone of it; and in a key, spelled as it spells.
    const overE = [note(C4 - 8, 1_000), note(C4, 1_000), note(C4 + 7, 1_000), note(C4 + 6, 100)];
    expect(heard(theChordTheNotesMake(overE))).toEqual({ name: 'C/E', exactly: false });
    // And not over a note passing under it.
    const passingUnder = [note(C4 - 18, 100), note(C4, 1_000), note(C4 + 4, 1_000), note(C4 + 7, 1_000)];
    expect(heard(theChordTheNotesMake(passingUnder))).toEqual({ name: 'C', exactly: false });
    // The same notes as A minor seventh, on C: C sixth, the bass deciding.
    const onC = [note(C4 - 12, 1_000), note(C4 + 4, 1_000), note(C4 + 7, 1_000), note(C4 + 9, 1_000), note(C4 + 14, 100)];
    expect(heard(theChordTheNotesMake(onC))).toEqual({ name: 'C6', exactly: false });
    expect(theChordTheNotesMake([note(C4 + 1, 900), note(C4 + 5, 900), note(C4 + 8, 900), note(C4 + 7, 50)], -4)?.name).toBe('D♭');
    // The fifth left out of a seventh, as a pianist leaves it.
    expect(heard(theChordTheNotesMake([note(C4, 900), note(C4 + 4, 900), note(C4 + 10, 900), note(C4 + 2, 50), note(C4 + 6, 50)]))).toEqual({
      name: 'C7',
      exactly: false,
    });
  });

  it('names nothing where the chord accounts for less than half of the sounding', () => {
    // C, E and G a tenth of a second each, against an F sharp of a length swept across the line.
    for (let sharp = 1; sharp <= 600; sharp += 1) {
      const named = theChordTheNotesMake([note(C4, 100), note(C4 + 4, 100), note(C4 + 7, 100), note(C4 + 6, sharp)]);
      expect(heard(named)).toEqual(sharp <= 300 ? { name: 'C', exactly: false } : null);
    }
  });

  it('takes a note into the chord only where it sounds long enough to be heard as part of it', () => {
    // A minor a second each, a B swept across the line, and an F sharp too
    // short to count. A tone costs fifteen hundredths of the whole: the B is
    // the ninth once it is worth more than that.
    for (let ninth = 1; ninth <= 1_000; ninth += 1) {
      const notes = [note(A2, 1_000), note(C4, 1_000), note(C4 + 4, 1_000), note(C4 + 11, ninth), note(C4 + 6, 10)];
      const total = 3_010 + ninth;
      expect(theChordTheNotesMake(notes)?.name).toBe(ninth > 0.15 * total ? 'Am(add9)' : 'Am');
    }
  });
});

describe('the degree of a chord in a scale', () => {
  const readOf = (midis: readonly number[]): ChordHeard => {
    const chord = theChordTheNotesMake(midis.map((midi) => ({ midi, lengthMs: 500 })));
    if (chord === null) {
      throw new Error(`No chord in ${midis.join(' ')}.`);
    }
    return chord;
  };

  it('writes each chord of every scale as the drawer of chords does', () => {
    for (const scale of SCALE_NAMES) {
      for (let fifths = -7; fifths <= 7; fifths += 1) {
        const pitchClasses = thePitchClassesOfTheScale(fifths, scale);
        for (const chord of theChordsOfTheScale(fifths, scale)) {
          expect(theNumeralOfTheChord(readOf(chord.midis), pitchClasses), `${chord.name} in ${String(fifths)} ${scale}`).toBe(chord.numeral);
        }
      }
    }
  });

  it('writes what a kind adds after the numeral, and a root the scale has not from the degree beside it', () => {
    const cMajor = thePitchClassesOfTheScale(0, 'major');
    const said = (midis: readonly number[], scale: readonly number[] = cMajor): string => theNumeralOfTheChord(readOf(midis), scale);
    expect(said([C4 + 7, C4 + 11, C4 + 14, C4 + 17])).toBe('V7');
    expect(said([C4 - 3, C4, C4 + 4, C4 + 7])).toBe('vi7');
    expect(said([C4, C4 + 4, C4 + 7, C4 + 11])).toBe('Imaj7');
    expect(said([C4 - 1, C4 + 2, C4 + 5, C4 + 9])).toBe('viiø7');
    expect(said([C4 + 7, C4 + 12, C4 + 14])).toBe('Vsus4');
    // B flat in C major: a semitone under B, the seventh degree.
    expect(said([C4 - 2, C4 + 2, C4 + 5])).toBe('♭VII');
    expect(said([C4 + 3, C4 + 7, C4 + 10])).toBe('♭III');
    // F sharp in A harmonic minor, which has neither G nor F sharp: a
    // semitone over F, its sixth degree.
    expect(said([C4 + 6, C4 + 10, C4 + 13], thePitchClassesOfTheScale(0, 'harmonicMinor'))).toBe('♯VI');
  });
});

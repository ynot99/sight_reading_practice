import { describe, expect, it } from 'vitest';
import { CHORD_KINDS, nameOfThePitchClass, nameTheChord } from '../../src/domain/harmony/chordName.js';

/** Middle C's octave, so a chord built on a root lies where a hand would play it. */
const C4 = 60;

/** The notes of a kind on a root, the lowest of them the `inversion`th, raised an octave to stand on top. */
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
          const bass = nameOfThePitchClass((root + (kind.intervals[inversion] ?? 0)) % 12, null);
          const slash = `${nameOfThePitchClass(root, null)}${kind.suffix}/${bass}`;
          const label = `${slash} as ${notes.join(' ')}`;
          if (said === slash) {
            continue;
          }
          // Otherwise it stood on its bass as some other kind, or was a
          // plainer kind over the same bass - never named over another.
          const onTheBass = said?.startsWith(bass) === true && said.includes('/') === false;
          expect(onTheBass || said?.endsWith(`/${bass}`) === true, `${label}: ${String(said)}`).toBe(true);
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
    // The bass is spelled the same way.
    expect(nameTheChord([58, 60, 64, 67], 0)).toBe('C7/B♭');
    expect(nameTheChord([58, 60, 64, 67], 3)).toBe('C7/A♯');
    // White keys keep their letters.
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      expect(nameOfThePitchClass(4, fifths)).toBe('E');
    }
  });
});

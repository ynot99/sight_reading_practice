import { describe, expect, it } from 'vitest';
import { theChordMovedTo } from '../../src/domain/harmony/chordMoved.js';
import { CHORD_KINDS, type ChordKind } from '../../src/domain/harmony/chordName.js';

const kind = (suffix: string): ChordKind => {
  const found = CHORD_KINDS.find((each) => each.suffix === suffix);
  if (found === undefined) {
    throw new Error(`No chord kind "${suffix}".`);
  }
  return found;
};
const [C, D, E, F, G, A] = [0, 2, 4, 5, 7, 9];
const MAJOR = kind('');
const MINOR = kind('m');

/** Where each key goes, lowest first. */
const moves = (midis: readonly number[], to: { root: number; kind: ChordKind }): number[][] =>
  [...theChordMovedTo(midis, to)].sort(([one = 0], [other = 0]) => one - other);

describe('moving a chord to another', () => {
  it('takes the lowest key to the new root and each other to the nearest of its tones', () => {
    // C E G to F: C down to F, G up to A rather than down to F, and E, which
    // went up to F with one already there, down to C instead: F, C and A,
    // and not F, F and A, which is no chord.
    expect(moves([60, 64, 67], { root: F, kind: MAJOR })).toEqual([
      [60, 53],
      [64, 60],
      [67, 69],
    ]);
  });

  it('wants every tone of a chord but a fifth its kind may go without, the third before the rest', () => {
    // C, C, E and B flat to G seventh: G, B, F and B - its fifth not wanted.
    expect(moves([48, 60, 64, 70], { root: G, kind: kind('7') })).toEqual([
      [48, 43],
      [60, 59],
      [64, 65],
      [70, 71],
    ]);
    // C, G and C to C add nine, one voice to spare: it goes to the E, not the D.
    expect(moves([48, 55, 60], { root: C, kind: kind('add9') })).toEqual([
      [48, 48],
      [55, 55],
      [60, 64],
    ]);
  });

  it('gives the third to the nearest of the voices doubling another tone', () => {
    // C G C G, already C: the lower G is nearest an E, three down; the C over
    // it four up.
    expect(moves([48, 55, 60, 67], { root: C, kind: MAJOR })).toEqual([
      [48, 48],
      [55, 52],
      [60, 60],
      [67, 67],
    ]);
  });

  it('gives the third to a voice doubling another tone where none came to it', () => {
    // C E G to G: G, D and G, then the upper G to B.
    expect(moves([60, 64, 67], { root: G, kind: MAJOR })).toEqual([
      [60, 55],
      [64, 62],
      [67, 71],
    ]);
    // To A minor: A, E and A, then the upper A to C.
    expect(moves([60, 64, 67], { root: A, kind: MINOR })).toEqual([
      [60, 57],
      [64, 64],
      [67, 72],
    ]);
  });

  it('keeps the root under the keys above it, an octave down where the nearest would rise over them', () => {
    // B under D and G, to E: E is nearer above B, which would be over D.
    // D goes to the E over it, and on to the B the chord wants.
    expect(moves([59, 62, 67], { root: E, kind: MAJOR })).toEqual([
      [59, 52],
      [62, 59],
      [67, 68],
    ]);
  });

  it('puts no two keys on one pitch, nor one on a note staying where it is', () => {
    // C E G to D sus4: E would go to the D the bass went to, and so goes on
    // to G, and G on to A.
    const sus = moves([60, 64, 67], { root: D, kind: kind('sus4') });
    expect(new Set(sus.map(([, onto]) => onto)).size).toBe(3);
    // C E G to F under an F that stays: E goes down to C instead.
    expect([...theChordMovedTo([60, 64, 67], { root: F, kind: MAJOR }, [65])].sort(([a = 0], [b = 0]) => a - b)).toEqual([
      [60, 53],
      [64, 60],
      [67, 69],
    ]);
    // And under an A that stays: G goes on up to C, and E down to the A below.
    expect([...theChordMovedTo([60, 64, 67], { root: F, kind: MAJOR }, [69])].sort(([a = 0], [b = 0]) => a - b)).toEqual([
      [60, 53],
      [64, 57],
      [67, 72],
    ]);
  });

  it('moves a key struck again and again to the same place each time', () => {
    expect(moves([60, 64, 67, 60, 64, 67], { root: F, kind: MAJOR })).toEqual(moves([60, 64, 67], { root: F, kind: MAJOR }));
  });

  it('leaves two keys two, and a chord with no third as it lands', () => {
    // C and G to A minor: A and C, the upper A spared for the third.
    expect(moves([60, 67], { root: A, kind: MINOR })).toEqual([
      [60, 57],
      [67, 72],
    ]);
    // C, E and B flat to G seventh, which may go without its fifth: G, F and B.
    expect(moves([48, 64, 70], { root: G, kind: kind('7') })).toEqual([
      [48, 43],
      [64, 65],
      [70, 71],
    ]);
    // C E G to D sus4 - D G A: no third to look for.
    expect(moves([60, 64, 67], { root: D, kind: kind('sus4') })).toEqual([
      [60, 62],
      [64, 67],
      [67, 69],
    ]);
    // One key goes to the root alone; none, nowhere.
    expect(moves([48], { root: F, kind: MAJOR })).toEqual([[48, 53]]);
    expect(moves([], { root: F, kind: MAJOR })).toEqual([]);
    expect(moves([60, 64, 67], { root: C, kind: MAJOR })).toEqual([
      [60, 60],
      [64, 64],
      [67, 67],
    ]);
  });
});

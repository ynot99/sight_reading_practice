import { describe, expect, it } from 'vitest';
import { theKeysAlongTheBars } from '../../src/domain/harmony/keysAlong.js';
import type { KeyFrom, NoteSounding } from '../../src/domain/harmony/chordsAlong.js';

const BAR_MS = 2_000;

// Each chord its bass first, held a bar.
const F = [41, 57, 60, 65];
const E_FLAT = [39, 55, 58, 63];
const B_FLAT = [46, 58, 62, 65];
const F7 = [41, 57, 60, 63];
const C = [36, 52, 55, 60];
const G = [43, 55, 59, 62];
const C7 = [36, 52, 55, 58];
const G7 = [43, 53, 59, 62];
const D_MINOR = [38, 53, 57, 62];
const G_MINOR = [43, 55, 58, 62];
const A7 = [45, 61, 64, 67];
const A_MINOR = [45, 57, 60, 64];
const E7 = [40, 56, 59, 62];
const C_MINOR = [36, 51, 55, 60];
const F_MINOR = [41, 56, 60, 65];
const A_MINOR_OVER_C = [36, 57, 60, 64];
const B_DIMINISHED = [47, 62, 65, 71];

/** A note of a bar, from a beat until a beat. */
interface Struck {
  readonly midi: number;
  readonly fromBeat: number;
  readonly untilBeat: number;
}

/** Four beats a bar, as many bars as chords, nothing held across: a chord a whole bar, or the notes of a bar each from a beat. */
function music(...chords: readonly (readonly number[] | readonly Struck[])[]): { notes: NoteSounding[]; bars: { beatsMs: number[]; untilMs: number }[] } {
  const struck = (each: number | Struck): Struck => (typeof each === 'number' ? { midi: each, fromBeat: 0, untilBeat: 4 } : each);
  return {
    notes: chords.flatMap((inTheBar, bar) =>
      inTheBar.map(struck).map(({ midi, fromBeat, untilBeat }) => ({ midi, fromMs: bar * BAR_MS + (fromBeat * BAR_MS) / 4, untilMs: bar * BAR_MS + (untilBeat * BAR_MS) / 4 })),
    ),
    bars: chords.map((_, bar) => ({ beatsMs: [0, 1, 2, 3].map((beat) => bar * BAR_MS + (beat * BAR_MS) / 4), untilMs: (bar + 1) * BAR_MS })),
  };
}

const writtenIn = (fifths: number, scale: KeyFrom['scale'] = 'major'): KeyFrom[] => [{ fromMs: Number.NEGATIVE_INFINITY, fifths, scale }];

function keysOf(chords: readonly (readonly number[] | readonly Struck[])[], written: readonly KeyFrom[]): string[] {
  const { notes, bars } = music(...chords);
  return theKeysAlongTheBars(notes, bars, written).map((key) => `${String(key.fifths)} ${key.scale}`);
}

describe('the keys the music is in, bar by bar', () => {
  it('reads which of the modes of a signature the music comes home to, and not only its major', () => {
    // Two flats: a riff in F with its flat seventh, and a tune in B♭.
    expect(keysOf([F, F, F, E_FLAT, F, F, F, E_FLAT, F], writtenIn(-2))).toEqual(Array(9).fill('-2 mixolydian'));
    expect(keysOf([B_FLAT, E_FLAT, F7, B_FLAT, B_FLAT, E_FLAT, F7, B_FLAT], writtenIn(-2))).toEqual(Array(8).fill('-2 major'));
    // One flat: D minor with its raised seventh, and F major.
    expect(keysOf([D_MINOR, G_MINOR, A7, D_MINOR, D_MINOR, G_MINOR, A7, D_MINOR], writtenIn(-1))).toEqual(Array(8).fill('-1 minor'));
    expect(keysOf([F, B_FLAT, C7, F, F, B_FLAT, C7, F], writtenIn(-1))).toEqual(Array(8).fill('-1 major'));
  });

  it('hears home in the bass on the first beat, and in the chords, where the notes alone say less', () => {
    // A minor's notes over C, bar after bar, and C to end: home is C, where the bass is.
    expect(keysOf([...Array(7).fill(A_MINOR_OVER_C), C], writtenIn(0))).toEqual(Array(8).fill('0 major'));
    // C on the first beat and a G under it after, as a riff goes: still C, the lower G only passing.
    const riff: Struck[] = [
      { midi: 36, fromBeat: 0, untilBeat: 1 },
      { midi: 31, fromBeat: 1, untilBeat: 4 },
      ...[52, 55, 60].map((midi) => ({ midi, fromBeat: 0, untilBeat: 4 })),
    ];
    expect(keysOf([...Array(6).fill(riff), G, G], writtenIn(0))).toEqual(Array(8).fill('0 major'));
    // Over E, a beat of C and three of A minor: A minor, which the chords are, and not E, which the bass is.
    const overE: Struck[] = [
      { midi: 40, fromBeat: 0, untilBeat: 4 },
      ...[55, 60, 64].map((midi) => ({ midi, fromBeat: 0, untilBeat: 1 })),
      ...[57, 60, 64].map((midi) => ({ midi, fromBeat: 1, untilBeat: 4 })),
    ];
    expect(keysOf(Array(8).fill(overE), writtenIn(0))).toEqual(Array(8).fill('0 minor'));
  });

  it('hears home where the music begins, and more surely where it ends', () => {
    // Ending on neither, it is in the key it began in.
    expect(keysOf([C, A_MINOR, C, A_MINOR, C, A_MINOR, F], writtenIn(0))).toEqual(Array(7).fill('0 major'));
    expect(keysOf([A_MINOR, C, A_MINOR, C, A_MINOR, C, F], writtenIn(0))).toEqual(Array(7).fill('0 minor'));
    // Begun in one and ended in the other, the end says.
    expect(keysOf([A_MINOR, C, A_MINOR, C, A_MINOR, C, A_MINOR, C], writtenIn(0))).toEqual(Array(8).fill('0 major'));
  });

  it('reads a key that is seldom home only where nothing likelier is, and a diminished one never', () => {
    // C and F by turns, C first: C major, though F lydian has the same notes and the last word.
    expect(keysOf([C, F, C, F, C, F, C, F], writtenIn(0))).toEqual(Array(8).fill('0 major'));
    expect(keysOf(Array(6).fill(B_DIMINISHED), writtenIn(0))).not.toContain('0 locrian');
  });

  it('keeps a key written as minor, whatever the music says', () => {
    expect(keysOf([F, B_FLAT, C7, F, F, B_FLAT, C7, F], writtenIn(-1, 'minor'))).toEqual(Array(8).fill('-1 minor'));
  });

  it('moves to another key the signature does not change to where a section is in it, at the bar it begins', () => {
    const inC = [C, F, G7, C];
    const inA = [A_MINOR, D_MINOR, E7, A_MINOR];
    expect(keysOf([...inC, ...inC, ...inA, ...inA], writtenIn(0))).toEqual([...Array(8).fill('0 major'), ...Array(8).fill('0 minor')]);
  });

  it('holds its key through a stretch of another too short to pay for leaving it, and leaves it for one long enough', () => {
    const inA = [A_MINOR, D_MINOR, E7, A_MINOR];
    const leaves = Array.from({ length: 12 }, (_, length) => {
      const between = Array.from({ length: length + 1 }, (__, at) => inA[at % inA.length] ?? A_MINOR);
      return keysOf([C, F, G7, C, ...between, C, F, G7, C], writtenIn(0)).some((key) => key !== '0 major');
    });
    // A chord from elsewhere is not a change of key; a section is; and nothing longer goes back to being none.
    expect(leaves[0]).toBe(false);
    expect(leaves.at(-1)).toBe(true);
    expect(leaves.findIndex((each) => each)).toBeGreaterThan(0);
    expect(leaves.slice(leaves.findIndex((each) => each)).every((each) => each)).toBe(true);
  });

  it('changes key freely where the signature changes, into whichever of its modes the music is in, for as short as the signature lasts', () => {
    const written: KeyFrom[] = [...writtenIn(0), { fromMs: 4 * BAR_MS, fifths: -3, scale: 'major' }];
    expect(keysOf([C, F, G7, C, C_MINOR, F_MINOR, G7, C_MINOR], written)).toEqual([...Array(4).fill('0 major'), ...Array(4).fill('-3 minor')]);
    const lastTwo: KeyFrom[] = [...writtenIn(0), { fromMs: 8 * BAR_MS, fifths: -3, scale: 'major' }];
    expect(keysOf([C, F, G7, C, C, F, G7, C, C_MINOR, G7], lastTwo)).toEqual([...Array(8).fill('0 major'), ...Array(2).fill('-3 minor')]);
  });

  it('holds a key a phrase at the least, so a first or last bar on a chord of its own is not a key of its own', () => {
    expect(keysOf([F, C, G7, C, F, C, G7, C], writtenIn(0))).toEqual(Array(8).fill('0 major'));
    expect(keysOf([C, F, G7, C, C, A_MINOR, E7, A_MINOR], writtenIn(0))).not.toContain('0 phrygian');
    expect(keysOf([C, A_MINOR, C, A_MINOR, C, A_MINOR, C, A_MINOR], writtenIn(0))).toEqual(Array(8).fill('0 major'));
  });

  it('reads a bar with nothing in it as the bars around it, and music with nothing in it as written', () => {
    expect(keysOf([C, F, [], G7, C], writtenIn(0))).toEqual(Array(5).fill('0 major'));
    expect(keysOf([[], []], writtenIn(-1))).toEqual(['-1 major', '-1 major']);
  });
});

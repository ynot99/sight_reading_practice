import { describe, expect, it } from 'vitest';
import { CHORD_KINDS } from '../../src/domain/harmony/chordName.js';
import {
  CIRCLE_RINGS,
  PLACES_ON_THE_CIRCLE,
  theKeysAtThePlace,
  theNameAtThePlace,
  theKeysOwnPlaces,
  theRingOfTheKind,
  theRootAt,
  whereOnTheCircle,
} from '../../src/domain/harmony/circleOfFifths.js';

describe('the circle of fifths', () => {
  it('goes round a fifth a place, its minors and diminished inside each major', () => {
    const roots = (ring: (typeof CIRCLE_RINGS)[number]): number[] =>
      Array.from({ length: PLACES_ON_THE_CIRCLE }, (_, place) => theRootAt({ ring, place }));
    // C G D A E B F# C# G# D# A# F.
    expect(roots('major')).toEqual([0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5]);
    // A minor inside C, E minor inside G.
    expect(roots('minor')).toEqual([9, 4, 11, 6, 1, 8, 3, 10, 5, 0, 7, 2]);
    // B diminished, the seventh of C, inside it.
    expect(roots('diminished')).toEqual([11, 6, 1, 8, 3, 10, 5, 0, 7, 2, 9, 4]);
  });

  it('finds every chord of a ring at the place its root is at, the whole way round', () => {
    for (const ring of CIRCLE_RINGS) {
      const kind = CHORD_KINDS.find((each) => theRingOfTheKind(each) === ring && each.intervals.length === 3);
      expect(kind).toBeDefined();
      for (let place = 0; place < PLACES_ON_THE_CIRCLE; place += 1) {
        expect(whereOnTheCircle(theRootAt({ ring, place }), kind ?? CHORD_KINDS[0]!)).toEqual({ ring, place });
      }
    }
  });

  it('puts each kind on the ring of its triad, and an augmented one nowhere', () => {
    expect(Object.fromEntries(CHORD_KINDS.map((kind) => [kind.suffix, theRingOfTheKind(kind)]))).toEqual({
      '': 'major',
      m: 'minor',
      dim: 'diminished',
      '+': null,
      sus4: 'major',
      sus2: 'major',
      '7': 'major',
      maj7: 'major',
      m7: 'minor',
      'm7♭5': 'diminished',
      dim7: 'diminished',
      'm(maj7)': 'minor',
      '7sus4': 'major',
      '6': 'major',
      m6: 'minor',
      add9: 'major',
      'm(add9)': 'minor',
      '9': 'major',
      maj9: 'major',
      m9: 'minor',
      '5': 'major',
    });
  });

  it('writes the chord at a place from middle C, and names it as the key the music is in spells it', () => {
    expect(theKeysAtThePlace({ ring: 'major', place: 0 })).toEqual([60, 64, 67]);
    expect(theKeysAtThePlace({ ring: 'minor', place: 0 })).toEqual([69, 72, 76]);
    expect(theKeysAtThePlace({ ring: 'diminished', place: 0 })).toEqual([71, 74, 77]);
    expect(theKeysAtThePlace({ ring: 'major', place: 6 })).toEqual([66, 70, 73]);
    expect(theNameAtThePlace({ ring: 'diminished', place: 0 }, 0)).toBe('Bdim');
    // E flat minor in A flat major; D sharp minor in E major.
    expect(theNameAtThePlace({ ring: 'minor', place: 6 }, -4)).toBe('E♭m');
    expect(theNameAtThePlace({ ring: 'minor', place: 6 }, 4)).toBe('D♯m');
  });

  it("lays a key's own triads together, by the scale on its signature", () => {
    const placed = (fifths: number, scale: Parameters<typeof theKeysOwnPlaces>[1]): string[] =>
      theKeysOwnPlaces(fifths, scale)
        .map(({ ring, place, numeral }) => `${numeral} ${ring} ${String(place)}`)
        .sort();
    // C major: F, C and G, D minor, A minor and E minor, and B diminished.
    expect(placed(0, 'major')).toEqual(
      ['I major 0', 'ii minor 11', 'iii minor 1', 'IV major 11', 'V major 1', 'vi minor 0', 'vii° diminished 0'].sort(),
    );
    // D dorian, written with C major's signature: the same places, its own numerals.
    expect(theKeysOwnPlaces(0, 'dorian').map(({ ring, place }) => `${ring} ${String(place)}`).sort()).toEqual(
      theKeysOwnPlaces(0, 'major').map(({ ring, place }) => `${ring} ${String(place)}`).sort(),
    );
    // A harmonic minor: its major fifth, E, four places round, and G#
    // diminished, the seventh of A major, at A's; its augmented third has no place.
    const harmonic = theKeysOwnPlaces(0, 'harmonicMinor');
    expect(harmonic).toHaveLength(6);
    expect(harmonic.find(({ numeral }) => numeral === 'V')).toEqual({ ring: 'major', place: 4, numeral: 'V' });
    expect(harmonic.find(({ numeral }) => numeral === 'vii°')).toEqual({ ring: 'diminished', place: 3, numeral: 'vii°' });
  });
});

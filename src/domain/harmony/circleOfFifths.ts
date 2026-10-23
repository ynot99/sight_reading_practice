import { floorMod } from '../../shared/asserts.js';
import { nameTheChord, theChordTheNotesMake, type ChordKind } from './chordName.js';
import { theChordsOfTheScale } from './chordsOfTheKey.js';
import type { ScaleName } from './scales.js';

/**
 * The circle of fifths, as three rings of chords: the twelve major chords a
 * fifth apart round the outside, C at the top and G next to it clockwise;
 * inside each, its relative minor; and innermost, the diminished chord on
 * its seventh degree. So a major key's seven triads lie together - its tonic's
 * place and the one either side on the two outer rings, and its own place on
 * the innermost - and a progression is a path round it.
 */
export type CircleRing = 'major' | 'minor' | 'diminished';

export const CIRCLE_RINGS: readonly CircleRing[] = ['major', 'minor', 'diminished'];

/** How many places round the circle there are: one for each key. */
export const PLACES_ON_THE_CIRCLE = 12;

/** A chord's place: which ring, and how far round from the top, clockwise. */
export interface PlaceOnTheCircle {
  readonly ring: CircleRing;
  readonly place: number;
}

/** A semitone count a fifth up: a place on round the circle moves the root by this. */
const A_FIFTH = 7;

/** How far above the root of the major at its place each ring's root is: A minor and B diminished at C's. */
const ROOT_ABOVE_THE_MAJOR: Readonly<Record<CircleRing, number>> = { major: 0, minor: 9, diminished: 11 };

/** The triad each ring holds, in semitones above its root. */
const TRIAD_OF_THE_RING: Readonly<Record<CircleRing, readonly number[]>> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  diminished: [0, 3, 6],
};

/** Middle C: a chord on the circle is written with its root in that octave, as the palette's are. */
const MIDDLE_C = 60;

/** The root of the chord at a place, as a pitch class. */
export function theRootAt(at: PlaceOnTheCircle): number {
  return floorMod(at.place * A_FIFTH + ROOT_ABOVE_THE_MAJOR[at.ring], 12);
}

/**
 * The ring a kind of chord belongs on: by its triad, what is added over it
 * being colour - a dominant seventh is on the major ring, a half-diminished
 * one on the diminished, which every chord with a diminished fifth is. A chord with no third (a suspended one, a fifth
 * alone) is on the major ring at its root, where its root's own chord is;
 * an augmented one, which is a fifth from nothing, is nowhere.
 */
export function theRingOfTheKind(kind: ChordKind): CircleRing | null {
  const has = (semitones: number): boolean => kind.intervals.includes(semitones);
  if (has(6)) {
    return 'diminished';
  }
  if (has(8)) {
    return null;
  }
  return kind.minor ? 'minor' : 'major';
}

/** Where a chord lies on the circle, by its root and kind; nowhere for one with no place (see `theRingOfTheKind`). */
export function whereOnTheCircle(root: number, kind: ChordKind): PlaceOnTheCircle | null {
  const ring = theRingOfTheKind(kind);
  // Seven fifths up is a semitone up, so a root is taken back to its place by sevens.
  return ring === null ? null : { ring, place: floorMod((root - ROOT_ABOVE_THE_MAJOR[ring]) * A_FIFTH, 12) };
}

/** The keys of the chord at a place, its root in the octave of middle C. */
export function theKeysAtThePlace(at: PlaceOnTheCircle): readonly number[] {
  const root = theRootAt(at);
  return TRIAD_OF_THE_RING[at.ring].map((semitones) => MIDDLE_C + root + semitones);
}

/** The keys of a chord of any kind, by its root and kind, its root in the octave of middle C, as the circle's are. */
export function theKeysOfTheChord(root: number, kind: ChordKind): readonly number[] {
  return kind.intervals.map((semitones) => MIDDLE_C + floorMod(root, 12) + semitones);
}

/**
 * What the chord at a place is called, spelt as a key with so many sharps
 * (above nought) or flats (below) spells it: the key the music is in, as the
 * lane of chords under the notes spells it, so E flat minor in A flat major
 * is not called D sharp minor round the circle.
 */
export function theNameAtThePlace(at: PlaceOnTheCircle, fifths: number): string {
  return nameTheChord(theKeysAtThePlace(at), fifths) ?? '';
}

/**
 * The places of a key's own triads, each with its numeral: those of the
 * scale on its signature, so a harmonic minor's major fifth is out at the
 * major's place, and its augmented third, which has none, is left out.
 */
export function theKeysOwnPlaces(
  fifths: number,
  scale: ScaleName,
): readonly (PlaceOnTheCircle & { readonly numeral: string })[] {
  return theChordsOfTheScale(fifths, scale).flatMap(({ midis, numeral }) => {
    const heard = theChordTheNotesMake(midis.map((midi) => ({ midi, lengthMs: 1 })));
    const at = heard === null ? null : whereOnTheCircle(heard.root, heard.kind);
    return at === null ? [] : [{ ...at, numeral }];
  });
}

/**
 * The way the music has come round the circle to a moment: the places of
 * the chords begun by then, oldest first, ending with the one sounding
 * there or the last before it - each place once where the music stays on
 * it, a chord with no place left out, and only the last `most`.
 */
export function theWayRoundTheCircle(
  chords: readonly { readonly fromMs: number; readonly root: number; readonly kind: ChordKind }[],
  atMs: number,
  most: number,
): readonly PlaceOnTheCircle[] {
  const way: PlaceOnTheCircle[] = [];
  for (const chord of [...chords].filter(({ fromMs }) => fromMs <= atMs).sort((one, other) => one.fromMs - other.fromMs)) {
    const at = whereOnTheCircle(chord.root, chord.kind);
    const last = way[way.length - 1];
    if (at !== null && (last === undefined || last.ring !== at.ring || last.place !== at.place)) {
      way.push(at);
    }
  }
  return way.slice(-most);
}

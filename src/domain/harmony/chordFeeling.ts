import { STEPS } from '../model/Pitch.js';
import type { ChordKind } from './chordName.js';
import { theChordInTheKey, theNotesOfTheChordNamed, type HarmonicFunction } from './harmonicFunction.js';
import { theTonicOfTheScale, type ScaleName } from './scales.js';

/**
 * Two things a chord makes a listener feel that can be worked out from its
 * notes and its key: how much it wants to move on - its tension - and how
 * bright or dark it is. Neither is an emotion, which melody, pace and sound
 * decide as much as harmony; both are what a writer reaches for when
 * planning where the music goes next, and a chart draws them along a piece.
 *
 * Both are models, and the weights below are the whole of them: worked out
 * here once, to be tuned by ear.
 */

type Chord = { readonly root: number; readonly kind: ChordKind };
type Key = { readonly fifths: number; readonly scale: ScaleName };

/** What a function adds to a chord's tension: home is none, going away some, pulling home most. */
const TENSION_OF_THE_FUNCTION: Readonly<Record<HarmonicFunction, number>> = {
  tonic: 0,
  subdominant: 1,
  dominant: 2,
};

/** A chord whose root is no degree of the key is somewhere away from home, as a subdominant is. */
const TENSION_AWAY_FROM_THE_KEY = 1;

/** And a note outside the key, borrowed or on its way elsewhere, adds this. */
const TENSION_OF_A_NOTE_OUTSIDE = 0.5;

/**
 * What each clash between two of its notes adds: a semitone or a major
 * seventh, and a tritone, the most; a whole tone or a minor seventh less.
 * By the smaller of the two ways round the octave between them.
 */
const TENSION_OF_A_CLASH: Readonly<Record<number, number>> = { 1: 0.5, 2: 0.25, 6: 0.5 };

/**
 * How much a chord wants to move on, in the key it is in: by what it does
 * there, by its clashes, and by whether it keeps to the key. The tonic
 * triad is nought; a dominant seventh nearly three.
 */
export function theTensionOfTheChord(chord: Chord, key: Key): number {
  const standing = theChordInTheKey(chord, key);
  const ofTheFunction = standing.function === null ? TENSION_AWAY_FROM_THE_KEY : TENSION_OF_THE_FUNCTION[standing.function];
  const tones = [...new Set(chord.kind.intervals.map((step) => step % 12))];
  let clashes = 0;
  for (const [at, one] of tones.entries()) {
    for (const other of tones.slice(at + 1)) {
      const apart = Math.abs(one - other);
      clashes += TENSION_OF_A_CLASH[Math.min(apart, 12 - apart)] ?? 0;
    }
  }
  return ofTheFunction + clashes + (standing.ofTheKey ? 0 : TENSION_OF_A_NOTE_OUTSIDE);
}

/** Where each letter stands on the line of fifths, C being nought: F one flat-ward, B five sharp-ward. */
const ON_THE_LINE: Readonly<Record<(typeof STEPS)[number], number>> = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };

/** Where a spelt note stands on the line of fifths: its letter's place, seven on for each sharp and back for each flat. */
function onTheLineOfFifths(note: string): number {
  const letter = STEPS.find((step) => note.startsWith(step)) ?? 'C';
  return ON_THE_LINE[letter] + [...note.slice(1)].reduce((sum, sign) => sum + (sign === '♯' ? 7 : sign === '♭' ? -7 : 0), 0);
}

/**
 * How much of a chord's brightness is its own - major against minor - and
 * how much is the key's: a note flat-ward of the key darkens it, so a
 * major chord borrowed from the minor is a shadow over a major key.
 */
const BRIGHT_OF_ITSELF = 0.5;
const BRIGHT_IN_THE_KEY = 0.5;

/**
 * How bright a chord is, in its key: where its notes stand on the line of
 * fifths, sharp-ward being brighter - a major third four steps on, a minor
 * third three back - measured from its own root and from the key's tonic,
 * as the scales are ranked from lydian, the brightest, to locrian. A major
 * triad of the key's tonic is one and two thirds; its minor triad less
 * than nought.
 */
export function theBrightnessOfTheChord(chord: Chord, key: Key): number {
  const notes = theNotesOfTheChordNamed(chord, key.fifths);
  const root = onTheLineOfFifths(notes[0] ?? 'C');
  const { step, alter } = theTonicOfTheScale(key.fifths, key.scale);
  const tonic = ON_THE_LINE[step] + 7 * alter;
  // A note spelt twelve fifths from where the key would spell it - B in C
  // flat major, whose black keys the chord takes its letters from - is the
  // same note, and as far as it would be spelt the key's way.
  const near = (apart: number): number => (Math.abs(apart) > 6 ? apart - 12 * Math.round(apart / 12) : apart);
  const mean = (from: number): number =>
    notes.reduce((sum, note) => sum + near(onTheLineOfFifths(note) - from), 0) / Math.max(notes.length, 1);
  return BRIGHT_OF_ITSELF * mean(root) + BRIGHT_IN_THE_KEY * mean(tonic);
}

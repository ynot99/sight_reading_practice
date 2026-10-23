import { floorMod } from '../../shared/asserts.js';
import { theBrightnessOfTheChord, theTensionOfTheChord } from './chordFeeling.js';
import { CHORD_KINDS, type ChordKind } from './chordName.js';
import { CIRCLE_RINGS, PLACES_ON_THE_CIRCLE, theKeysAtThePlace, theRootAt, type PlaceOnTheCircle } from './circleOfFifths.js';
import { theChordInTheKey } from './harmonicFunction.js';
import type { ScaleName } from './scales.js';

/**
 * What the writer wants the next chord to do, and the chords of the circle
 * that would do it after the one before: by the same tension and
 * brightness the chart draws (see `chordFeeling.ts`), so a hint and the
 * curve it would make agree.
 */
export type GoalOfTheNextChord = 'tension' | 'release' | 'brighter' | 'darker';

export const GOALS_OF_THE_NEXT_CHORD: readonly GoalOfTheNextChord[] = ['tension', 'release', 'brighter', 'darker'];

/** A chord of the circle offered as the next, with where it would take the tension and the brightness. */
export interface NextChordHint {
  readonly place: PlaceOnTheCircle;
  readonly tension: number;
  readonly brightness: number;
}

type Chord = { readonly root: number; readonly kind: ChordKind };
type Key = { readonly fifths: number; readonly scale: ScaleName };

/** How many chords are offered at most. */
const HINTS_OFFERED = 3;

/** How far a chord has to move the music the way asked to be offered at all: less is no move. */
const MOVES_AT_LEAST = 0.4;

/**
 * How much of a move counts towards a chord's place in the offer: past
 * this, a further chord is not a better one, only a stranger one - the
 * darkest chord there is would always win "darker" otherwise.
 */
const MOVE_COUNTS_UP_TO = 1;

/** What each note in common with the chord before is worth: a move by one finger is smoother than a leap. */
const WORTH_OF_A_NOTE_KEPT = 0.25;

/** And keeping to the key: a chord of it is the plainer way to the same end. */
const WORTH_OF_KEEPING_TO_THE_KEY = 0.5;

/**
 * And the way music most often goes, by how far the root moves: down a
 * fifth the most - V to I, ii to V, I to IV, one place anticlockwise round
 * the circle - and up a fifth, or down a third - I to vi, IV to ii - less.
 */
const WORTH_OF_THE_ROOT_MOVING: Readonly<Record<number, number>> = { 5: 1, 7: 0.5, 9: 0.5 };

/** A diminished triad is a chord passed through on the way somewhere, seldom the place a phrase is aimed at. */
const WORTH_OF_A_DIMINISHED = -1;

/** The chord at a place of the circle, by its root and kind. */
function theChordAtThePlace(place: PlaceOnTheCircle): Chord {
  const keys = theKeysAtThePlace(place);
  const intervals = keys.map((key) => key - (keys[0] ?? 0));
  // Every ring's triad is a kind with a name: the fallback is never taken.
  const kind = CHORD_KINDS.find((each) => each.intervals.join() === intervals.join());
  return { root: theRootAt(place), kind: kind ?? { suffix: '', intervals, fifthMayGo: false, minor: false, afterTheNumeral: '' } };
}

/** How far a chord's tension or brightness moves the way asked, from the chord before's. */
function theMove(goal: GoalOfTheNextChord, before: { tension: number; brightness: number }, after: { tension: number; brightness: number }): number {
  switch (goal) {
    case 'tension':
      return after.tension - before.tension;
    case 'release':
      return before.tension - after.tension;
    case 'brighter':
      return after.brightness - before.brightness;
    case 'darker':
      return before.brightness - after.brightness;
  }
}

/**
 * The chords of the circle that would do what is asked after a chord, in
 * its key, best first: of those that move the music at least that far the
 * way asked, the ones worth most - the move, up to a point; each note kept
 * from the chord before, keeping to the key, and the root going the way
 * music most often goes, besides; a diminished triad less - the larger move
 * first where two are worth the same. None where none moves it, as nothing
 * is more restful than the tonic.
 */
export function theChordsTowards(goal: GoalOfTheNextChord, before: Chord, key: Key): readonly NextChordHint[] {
  const was = { tension: theTensionOfTheChord(before, key), brightness: theBrightnessOfTheChord(before, key) };
  const notesBefore = new Set(before.kind.intervals.map((step) => floorMod(before.root + step, 12)));
  const offered = CIRCLE_RINGS.flatMap((ring) =>
    Array.from({ length: PLACES_ON_THE_CIRCLE }, (_, at) => {
      const place = { ring, place: at };
      const chord = theChordAtThePlace(place);
      const would = { tension: theTensionOfTheChord(chord, key), brightness: theBrightnessOfTheChord(chord, key) };
      const move = theMove(goal, was, would);
      const kept = chord.kind.intervals.filter((step) => notesBefore.has(floorMod(chord.root + step, 12))).length;
      const worth =
        Math.min(move, MOVE_COUNTS_UP_TO) +
        WORTH_OF_A_NOTE_KEPT * kept +
        (theChordInTheKey(chord, key).ofTheKey ? WORTH_OF_KEEPING_TO_THE_KEY : 0) +
        (WORTH_OF_THE_ROOT_MOVING[floorMod(chord.root - before.root, 12)] ?? 0) +
        (ring === 'diminished' ? WORTH_OF_A_DIMINISHED : 0);
      return { hint: { place, ...would }, move, worth };
    }),
  );
  return offered
    .filter((each) => each.move >= MOVES_AT_LEAST)
    .sort((one, other) => other.worth - one.worth || other.move - one.move)
    .slice(0, HINTS_OFFERED)
    .map((each) => each.hint);
}

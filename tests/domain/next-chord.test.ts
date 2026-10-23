import { describe, expect, it } from 'vitest';
import { theBrightnessOfTheChord, theTensionOfTheChord } from '../../src/domain/harmony/chordFeeling.js';
import { CHORD_KINDS, type ChordKind } from '../../src/domain/harmony/chordName.js';
import { theNameAtThePlace, theRootAt } from '../../src/domain/harmony/circleOfFifths.js';
import { GOALS_OF_THE_NEXT_CHORD, theChordsTowards, type GoalOfTheNextChord } from '../../src/domain/harmony/nextChord.js';

function kind(suffix: string): ChordKind {
  const found = CHORD_KINDS.find((each) => each.suffix === suffix);
  if (found === undefined) {
    throw new Error(`no kind ${suffix}`);
  }
  return found;
}

/** The chords offered after one in a major key, by name as the key spells them. */
function offered(goal: GoalOfTheNextChord, root: number, suffix: string, fifths = 0): string[] {
  return theChordsTowards(goal, { root, kind: kind(suffix) }, { fifths, scale: 'major' }).map((hint) => theNameAtThePlace(hint.place, fifths));
}

/** The tonic of a major key with so many sharps or flats, as a pitch class. */
const tonicOf = (fifths: number): number => (((fifths * 7) % 12) + 12) % 12;

describe('the chords offered next', () => {
  it('resolves the dominant seventh home, takes the supertonic to the dominant, and darkens the tonic to its relative minor, in every key', () => {
    for (let fifths = -6; fifths <= 6; fifths += 1) {
      const tonic = tonicOf(fifths);
      // Each offer by how far above the tonic its root is.
      const rootsOf = (goal: GoalOfTheNextChord, root: number, suffix: string): number[] =>
        theChordsTowards(goal, { root: (tonic + root) % 12, kind: kind(suffix) }, { fifths, scale: 'major' }).map(
          (hint) => (theRootAt(hint.place) - tonic + 12) % 12,
        );
      // V7 to I first; ii to V first; I to vi first.
      expect(rootsOf('release', 7, '7')[0], String(fifths)).toBe(0);
      expect(rootsOf('tension', 2, 'm')[0], String(fifths)).toBe(7);
      expect(rootsOf('darker', 0, '')[0], String(fifths)).toBe(9);
    }
  });

  it('offers nothing more restful than the tonic, and nothing tenser than the dominant seventh', () => {
    for (let fifths = -6; fifths <= 6; fifths += 1) {
      expect(offered('release', tonicOf(fifths), '', fifths), String(fifths)).toEqual([]);
      expect(offered('tension', (tonicOf(fifths) + 7) % 12, '7', fifths), String(fifths)).toEqual([]);
    }
  });

  it('offers, after C in C major, the borrowed minor subdominant to darken it as well, and the dominant to brighten it', () => {
    expect(offered('darker', 0, '')).toEqual(['Am', 'Fm', 'F']);
    expect(offered('brighter', 0, '')[0]).toBe('G');
    expect(offered('release', 7, '7')).toEqual(['C', 'Em', 'Dm']);
  });

  it('offers three at most, each a chord of the circle other than the one before that moves the music the way asked', () => {
    const key = { fifths: 0, scale: 'major' as const };
    for (const goal of GOALS_OF_THE_NEXT_CHORD) {
      for (let root = 0; root < 12; root += 1) {
        for (const suffix of ['', 'm', '7', 'dim']) {
          const before = { root, kind: kind(suffix) };
          const was = { tension: theTensionOfTheChord(before, key), brightness: theBrightnessOfTheChord(before, key) };
          const hints = theChordsTowards(goal, before, key);
          expect(hints.length).toBeLessThanOrEqual(3);
          for (const hint of hints) {
            const move = {
              tension: hint.tension - was.tension,
              release: was.tension - hint.tension,
              brighter: hint.brightness - was.brightness,
              darker: was.brightness - hint.brightness,
            }[goal];
            expect(move, `${goal} after ${String(root)}${suffix}`).toBeGreaterThanOrEqual(0.4);
          }
          expect(new Set(hints.map((hint) => `${hint.place.ring} ${String(hint.place.place)}`)).size).toBe(hints.length);
        }
      }
    }
  });

  it('seldom aims at a diminished triad: none first after any major or minor chord of C major', () => {
    for (const goal of GOALS_OF_THE_NEXT_CHORD) {
      for (const [root, suffix] of [
        [0, ''],
        [2, 'm'],
        [4, 'm'],
        [5, ''],
        [7, ''],
        [9, 'm'],
      ] as const) {
        const first = theChordsTowards(goal, { root, kind: kind(suffix) }, { fifths: 0, scale: 'major' })[0];
        expect(first?.place.ring, `${goal} after ${String(root)}${suffix}`).not.toBe('diminished');
      }
    }
  });
});

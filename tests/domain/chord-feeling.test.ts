import { describe, expect, it } from 'vitest';
import { theBrightnessOfTheChord, theTensionOfTheChord } from '../../src/domain/harmony/chordFeeling.js';
import { CHORD_KINDS, type ChordKind } from '../../src/domain/harmony/chordName.js';
import { theChordsOfTheScale } from '../../src/domain/harmony/chordsOfTheKey.js';
import { SCALE_NAMES, type ScaleName } from '../../src/domain/harmony/scales.js';

function kind(suffix: string): ChordKind {
  const found = CHORD_KINDS.find((each) => each.suffix === suffix);
  if (found === undefined) {
    throw new Error(`no kind ${suffix}`);
  }
  return found;
}

const C_MAJOR = { fifths: 0, scale: 'major' as const };
const tension = (root: number, suffix: string, key: { fifths: number; scale: ScaleName } = C_MAJOR): number =>
  theTensionOfTheChord({ root, kind: kind(suffix) }, key);
const brightness = (root: number, suffix: string, key: { fifths: number; scale: ScaleName } = C_MAJOR): number =>
  theBrightnessOfTheChord({ root, kind: kind(suffix) }, key);

/** The seven triads of a scale, as roots and kinds. */
function theTriadsOf(fifths: number, scale: ScaleName): { root: number; kind: ChordKind }[] {
  return theChordsOfTheScale(fifths, scale).map(({ midis }) => {
    const intervals = midis.map((midi) => midi - (midis[0] ?? 0));
    return { root: (midis[0] ?? 0) % 12, kind: CHORD_KINDS.find((each) => each.intervals.join() === intervals.join()) ?? kind('') };
  });
}

describe('the tension of a chord', () => {
  it('is nought at home, more going away, most pulling home, and more for each clash and each note outside the key', () => {
    expect(tension(0, '')).toBe(0);
    expect(tension(9, 'm')).toBe(0);
    expect(tension(5, '')).toBe(1);
    expect(tension(2, 'm')).toBe(1);
    expect(tension(7, '')).toBe(2);
    // The dominant seventh: its tritone and its seventh.
    expect(tension(7, '7')).toBe(2.75);
    // B diminished: its tritone.
    expect(tension(11, 'dim')).toBe(2.5);
    // A major seventh's semitone clash, at home.
    expect(tension(0, 'maj7')).toBe(0.5);
    // F minor borrowed into C major; A flat, whose root is no degree of it.
    expect(tension(5, 'm')).toBe(1.5);
    expect(tension(8, '')).toBe(1.5);
    // Its rise through a cadence.
    expect([tension(0, ''), tension(5, ''), tension(7, ''), tension(7, '7')]).toEqual([0, 1, 2, 2.75]);
  });

  it('is the same in every key for the same degree and kind', () => {
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      const tonic = ((fifths * 7) % 12 + 12) % 12;
      const key = { fifths, scale: 'major' as const };
      expect(tension(tonic + 7, '7', key), String(fifths)).toBe(2.75);
      expect(tension(tonic, '', key), String(fifths)).toBe(0);
    }
  });
});

describe('the brightness of a chord', () => {
  it('is brighter major than minor, and darker for notes flat-ward of the key', () => {
    expect(brightness(0, '')).toBeCloseTo(5 / 3, 9);
    expect(brightness(9, 'm')).toBeCloseTo(5 / 6, 9);
    // Borrowed from the minor: F minor and A flat darker than anything of the key.
    expect(brightness(5, 'm')).toBeCloseTo(-7 / 6, 9);
    expect(brightness(8, '')).toBeCloseTo(-1 / 3, 9);
    // The dominant of the dominant, sharp-ward of the key, brightest.
    expect(brightness(2, '')).toBeCloseTo(8 / 3, 9);
    // Every chord of the key between the borrowed minor's F minor and the dominant of the dominant; B diminished its darkest.
    const ofTheKey = theTriadsOf(0, 'major').map((chord) => theBrightnessOfTheChord(chord, C_MAJOR));
    expect(Math.min(...ofTheKey)).toBeGreaterThan(brightness(5, 'm'));
    expect(Math.max(...ofTheKey)).toBeLessThan(brightness(2, ''));
    expect(Math.min(...ofTheKey)).toBeCloseTo(brightness(11, 'dim'), 9);
  });

  it('ranks the scales by their chords from lydian, the brightest, to locrian, the darkest', () => {
    const order: ScaleName[] = ['lydian', 'major', 'mixolydian', 'dorian', 'minor', 'phrygian', 'locrian'];
    for (let fifths = -5; fifths <= 5; fifths += 1) {
      const meanOf = (scale: ScaleName): number => {
        const chords = theTriadsOf(fifths, scale);
        return chords.reduce((sum, chord) => sum + theBrightnessOfTheChord(chord, { fifths, scale }), 0) / chords.length;
      };
      const means = order.map(meanOf);
      expect([...means].sort((a, b) => b - a), String(fifths)).toEqual(means);
      expect(new Set(means.map((mean) => mean.toFixed(6))).size).toBe(order.length);
    }
    // The two minors besides the natural one are brighter than it, by their raised notes.
    expect(SCALE_NAMES).toContain('harmonicMinor');
  });

  it('is the same in every key for the same degree and kind, however its key is spelt', () => {
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      const tonic = ((fifths * 7) % 12 + 12) % 12;
      const key = { fifths, scale: 'major' as const };
      expect(brightness(tonic, '', key), String(fifths)).toBeCloseTo(5 / 3, 9);
      expect(brightness(tonic + 9, 'm', key), String(fifths)).toBeCloseTo(5 / 6, 9);
      expect(brightness(tonic + 8, '', key), String(fifths)).toBeCloseTo(-1 / 3, 9);
    }
  });
});

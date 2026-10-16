import { describe, expect, it } from 'vitest';
import {
  SCALE_NAMES,
  isAScale,
  thePitchClassesOfTheScale,
  theSignatureOfTheScale,
  theTonicOfTheScale,
  theNameOfTheKey,
  theTonicPitchClass,
  type ScaleName,
} from '../../src/domain/harmony/scales.js';
import { theChordsOfTheKey, theChordsOfTheScale } from '../../src/domain/harmony/chordsOfTheKey.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { alterationSign } from '../../src/domain/model/Pitch.js';

/** Every signature a key can be written with. */
const EVERY_SIGNATURE = Array.from({ length: 15 }, (_, at) => at - 7);

/** The pitch classes a signature leaves as they are: its major scale's. */
const ofTheSignature = (fifths: number): number[] =>
  Array.from({ length: 7 }, (_, letter) => (((KeySignature.major(fifths).pitchAt(28 + letter).midi % 12) + 12) % 12));

const named = (fifths: number, scale: ScaleName): string => {
  const { step, alter } = theTonicOfTheScale(fifths, scale);
  return `${step}${alterationSign(alter)}`;
};

describe('the scales music is written in', () => {
  it('puts the tonic of a major or a minor scale where the key signature puts it, for every signature', () => {
    for (const fifths of EVERY_SIGNATURE) {
      for (const mode of ['major', 'minor'] as const) {
        expect(theTonicOfTheScale(fifths, mode), `${String(fifths)} ${mode}`).toEqual(new KeySignature(fifths, mode).tonic);
      }
    }
  });

  it('puts a mode on its degree of the signature\'s major scale', () => {
    expect(SCALE_NAMES.map((scale) => named(0, scale))).toEqual(['C', 'A', 'A', 'A', 'D', 'E', 'F', 'G', 'B']);
    expect(named(-2, 'dorian')).toBe('C');
    expect(named(3, 'mixolydian')).toBe('E');
    expect(named(-6, 'lydian')).toBe('C♭');
    expect(named(7, 'locrian')).toBe('B♯');
  });

  it('is written with the signature of the major scale it is a turn of, on every tonic, in the fewer accidentals', () => {
    for (const scale of SCALE_NAMES) {
      for (let tonic = 0; tonic < 12; tonic += 1) {
        const fifths = theSignatureOfTheScale(tonic, scale);
        expect(fifths, `${scale} on ${String(tonic)}`).toBeGreaterThanOrEqual(-5);
        expect(fifths, `${scale} on ${String(tonic)}`).toBeLessThanOrEqual(6);
        expect(theTonicPitchClass(fifths, scale), `${scale} on ${String(tonic)}`).toBe(tonic);
      }
    }
    // The ones a pianist would write: D flat major, C sharp minor, F sharp major rather than G flat.
    expect(theSignatureOfTheScale(1, 'major')).toBe(-5);
    expect(theSignatureOfTheScale(1, 'minor')).toBe(4);
    expect(theSignatureOfTheScale(6, 'major')).toBe(6);
    expect(theSignatureOfTheScale(2, 'dorian')).toBe(0);
    expect(theSignatureOfTheScale(10, 'minor')).toBe(-5);
  });

  it('is the signature\'s own notes, but for the two minors that raise theirs', () => {
    for (const fifths of EVERY_SIGNATURE) {
      const own = new Set(ofTheSignature(fifths));
      for (const scale of SCALE_NAMES) {
        const notes = thePitchClassesOfTheScale(fifths, scale);
        expect(notes[0], `${scale} ${String(fifths)}`).toBe(theTonicPitchClass(fifths, scale));
        const outside = notes.filter((note) => !own.has(note));
        const raised = scale === 'harmonicMinor' ? 1 : scale === 'melodicMinor' ? 2 : 0;
        expect(outside, `${scale} ${String(fifths)}`).toHaveLength(raised);
      }
    }
    // A harmonic minor raises its seventh; a melodic its sixth and seventh.
    expect(thePitchClassesOfTheScale(0, 'harmonicMinor')).toEqual([9, 11, 0, 2, 4, 5, 8]);
    expect(thePitchClassesOfTheScale(0, 'melodicMinor')).toEqual([9, 11, 0, 2, 4, 6, 8]);
    expect(thePitchClassesOfTheScale(0, 'dorian')).toEqual([2, 4, 5, 7, 9, 11, 0]);
  });

  it('names a key by its tonic, spelt as its signature spells it, and its scale', () => {
    expect(theNameOfTheKey({ fifths: 0, scale: 'dorian' })).toBe('D dorian');
    expect(theNameOfTheKey({ fifths: -2, scale: 'major' })).toBe('B\u266d major');
    expect(theNameOfTheKey({ fifths: 4, scale: 'harmonicMinor' })).toBe('C\u266f harmonic minor');
  });

  it('knows a scale\'s name read back from one that is none', () => {
    expect(SCALE_NAMES.every(isAScale)).toBe(true);
    for (const other of ['Dorian', 'blues', '', 3, null, undefined]) {
      expect(isAScale(other)).toBe(false);
    }
  });
});

describe('the chords of a scale', () => {
  const said = (fifths: number, scale: ScaleName): string[] =>
    theChordsOfTheScale(fifths, scale).map(({ name, numeral }) => `${numeral} ${name}`);

  it('are the key\'s for a major or a minor scale, for every signature', () => {
    for (const fifths of EVERY_SIGNATURE) {
      for (const mode of ['major', 'minor'] as const) {
        expect(theChordsOfTheScale(fifths, mode)).toEqual(theChordsOfTheKey(new KeySignature(fifths, mode)));
      }
    }
  });

  it('stack the scale\'s own notes, a raised one named by its letter and an augmented triad marked', () => {
    expect(said(0, 'harmonicMinor')).toEqual(['i Am', 'ii° Bdim', 'III+ C+', 'iv Dm', 'V E', 'VI F', 'vii° G♯dim']);
    expect(said(0, 'melodicMinor')).toEqual(['i Am', 'ii Bm', 'III+ C+', 'IV D', 'V E', 'vi° F♯dim', 'vii° G♯dim']);
    expect(said(0, 'dorian')).toEqual(['i Dm', 'ii Em', 'III F', 'IV G', 'v Am', 'vi° Bdim', 'VII C']);
    expect(said(2, 'lydian')).toEqual(['I G', 'II A', 'iii Bm', 'iv° C♯dim', 'V D', 'vi Em', 'vii F♯m']);
    expect(said(-4, 'phrygian')).toEqual(['i Cm', 'II D♭', 'III E♭', 'iv Fm', 'v° Gdim', 'VI A♭', 'vii B♭m']);
    expect(said(-3, 'harmonicMinor')).toEqual(['i Cm', 'ii° Ddim', 'III+ E♭+', 'iv Fm', 'V G', 'VI A♭', 'vii° Bdim']);
    // Rooted in the octave of middle C, as a key's are.
    expect(theChordsOfTheScale(0, 'harmonicMinor')[6]?.midis).toEqual([68, 71, 74]);
    expect(theChordsOfTheScale(0, 'dorian')[0]?.midis).toEqual([62, 65, 69]);
  });
});

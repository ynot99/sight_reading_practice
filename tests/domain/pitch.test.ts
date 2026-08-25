import { describe, expect, it } from 'vitest';
import { Pitch, STEPS, midiToLabel, stepAt } from '../../src/domain/model/Pitch.js';
import { DomainError } from '../../src/shared/errors.js';

describe('Pitch', () => {
  it('places middle C at MIDI 60', () => {
    expect(new Pitch('C', 4).midi).toBe(60);
    expect(new Pitch('A', 4).midi).toBe(69);
  });

  it('applies alterations to the MIDI number but not to the staff position', () => {
    const fSharp = new Pitch('F', 4, 1);
    const gFlat = new Pitch('G', 4, -1);

    expect(fSharp.midi).toBe(gFlat.midi);
    expect(fSharp.diatonicIndex).not.toBe(gFlat.diatonicIndex);
    expect(fSharp.soundsAs(gFlat)).toBe(true);
    expect(fSharp.equals(gFlat)).toBe(false);
  });

  it('round-trips through scientific pitch notation', () => {
    for (const name of ['C4', 'F#3', 'Bb5', 'G##2', 'Dbb-1']) {
      expect(Pitch.parse(name).toString()).toBe(name);
    }
  });

  it('rejects unparseable names', () => {
    expect(() => Pitch.parse('H4')).toThrow(DomainError);
    expect(() => Pitch.parse('C')).toThrow(DomainError);
  });

  it('round-trips through the diatonic index', () => {
    for (let index = -14; index < 70; index += 1) {
      expect(Pitch.fromDiatonicIndex(index).diatonicIndex).toBe(index);
    }
    expect(Pitch.fromDiatonicIndex(28).toString()).toBe('C4');
    expect(Pitch.fromDiatonicIndex(34).toString()).toBe('B4');
    expect(Pitch.fromDiatonicIndex(35).toString()).toBe('C5');
  });

  it('walks the staff one letter at a time', () => {
    const start = Pitch.parse('B3');
    expect(start.transposeDiatonic(1).toString()).toBe('C4');
    expect(start.transposeDiatonic(-1).toString()).toBe('A3');
    expect(start.transposeDiatonic(7).toString()).toBe('B4');
  });

  it('spells MIDI numbers with sharps or flats on request', () => {
    expect(Pitch.fromMidi(61).toString()).toBe('C#4');
    expect(Pitch.fromMidi(61, true).toString()).toBe('Db4');
    expect(midiToLabel(60)).toBe('C4');
    expect(midiToLabel(21)).toBe('A0');
  });

  it('wraps staff positions in both directions', () => {
    expect(stepAt(0)).toBe('C');
    expect(stepAt(7)).toBe('C');
    expect(stepAt(-1)).toBe('B');
    expect(STEPS).toHaveLength(7);
  });
});

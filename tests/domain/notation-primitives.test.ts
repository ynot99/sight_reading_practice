import { describe, expect, it } from 'vitest';
import {
  DIVISIONS_PER_QUARTER,
  Duration,
  millisecondsToTicks,
  ticksToMilliseconds,
} from '../../src/domain/model/Duration.js';
import { COMMON_KEYS, KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { DomainError } from '../../src/shared/errors.js';

describe('Duration', () => {
  it('measures every notated value in whole divisions', () => {
    expect(Duration.WHOLE.ticks).toBe(1920);
    expect(Duration.HALF.ticks).toBe(960);
    expect(Duration.QUARTER.ticks).toBe(480);
    expect(Duration.EIGHTH.ticks).toBe(240);
    expect(Duration.SIXTEENTH.ticks).toBe(120);
    expect(Duration.DOTTED_QUARTER.ticks).toBe(720);
    expect(Duration.DOTTED_HALF.ticks).toBe(1440);
    expect(Duration.of('16th', 1).ticks).toBe(180);
  });

  it('reaches the short values imported music is written in', () => {
    // Nothing here generates these; a piano arrangement is full of them, and
    // every one of them has to stay a whole number of divisions.
    expect(Duration.of('32nd').ticks).toBe(60);
    expect(Duration.of('64th').ticks).toBe(30);
    expect(Duration.of('32nd', 1).ticks).toBe(90);
    expect(Duration.of('64th', 1).ticks).toBe(45);
    expect(Duration.triplet('32nd').ticks).toBe(40);
    expect(Duration.triplet('64th').ticks).toBe(20);
  });

  it('still closes a tuplet group on the value the group adds up to', () => {
    // The serializer infers groups: one closes when its accumulated span
    // becomes a plain notatable value. Short values make more spans notatable,
    // and a group that closed early would be written as two groups of music
    // nobody played.
    expect(Duration.isNotatable(Duration.triplet('32nd').ticks)).toBe(false);
    expect(Duration.isNotatable(Duration.triplet('32nd').ticks * 2)).toBe(false);
    expect(Duration.isNotatable(Duration.triplet('32nd').ticks * 3)).toBe(true);
    expect(Duration.isNotatable(Duration.triplet('eighth').ticks * 2)).toBe(false);
  });

  it('interns values so identity comparison is safe', () => {
    expect(Duration.of('quarter')).toBe(Duration.QUARTER);
    expect(Duration.of('half', 1)).toBe(Duration.DOTTED_HALF);
  });

  it('reconstructs values from tick counts', () => {
    expect(Duration.fromTicks(720)).toBe(Duration.DOTTED_QUARTER);
    expect(Duration.fromTicks(1440)).toBe(Duration.DOTTED_HALF);
    expect(Duration.isNotatable(1000)).toBe(false);
    expect(() => Duration.fromTicks(1000)).toThrow(DomainError);
  });

  it('converts between divisions and milliseconds at a tempo', () => {
    expect(ticksToMilliseconds(DIVISIONS_PER_QUARTER, 60)).toBe(1000);
    expect(ticksToMilliseconds(DIVISIONS_PER_QUARTER, 120)).toBe(500);
    expect(millisecondsToTicks(1000, 60)).toBe(DIVISIONS_PER_QUARTER);
  });
});

describe('TimeSignature', () => {
  it('derives beat and measure lengths from the denominator', () => {
    const common = new TimeSignature(4, 4);
    expect(common.ticksPerBeat).toBe(480);
    expect(common.ticksPerMeasure).toBe(1920);

    const compound = new TimeSignature(6, 8);
    expect(compound.ticksPerBeat).toBe(240);
    expect(compound.ticksPerMeasure).toBe(1440);

    const waltz = new TimeSignature(3, 4);
    expect(waltz.ticksPerMeasure).toBe(1440);
    expect(waltz.quartersPerMeasure).toBe(3);
  });

  it('locates a tick inside the bar structure', () => {
    const common = new TimeSignature(4, 4);
    expect(common.measureOf(0)).toBe(0);
    expect(common.measureOf(1920)).toBe(1);
    expect(common.measureOf(2400)).toBe(1);
    expect(common.beatOf(0)).toBe(1);
    expect(common.beatOf(480)).toBe(2);
    expect(common.beatOf(2400)).toBe(2);
    expect(common.beatOf(240)).toBe(1.5);
  });

  it('tells a felt beat from a notated one', () => {
    const common = new TimeSignature(4, 4);
    expect(common.isCompound).toBe(false);
    expect(common.ticksPerPulse).toBe(480);
    expect(common.pulsesPerMeasure).toBe(4);
    expect(common.divisionsPerPulse).toBe(2);

    // 6/8 is written in eighths and counted in two dotted quarters.
    const compound = new TimeSignature(6, 8);
    expect(compound.isCompound).toBe(true);
    expect(compound.ticksPerPulse).toBe(720);
    expect(compound.pulsesPerMeasure).toBe(2);
    expect(compound.divisionsPerPulse).toBe(3);
    expect(compound.pulseOf(0)).toBe(1);
    expect(compound.pulseOf(720)).toBe(2);
    expect(compound.pulseOf(240)).toBeCloseTo(1 + 1 / 3, 10);

    expect(new TimeSignature(9, 8).pulsesPerMeasure).toBe(3);
    expect(new TimeSignature(12, 8).pulsesPerMeasure).toBe(4);
  });

  it('leaves 3/8 and 6/4 alone, which are not counted in threes', () => {
    // Written the same way as 6/8 but counted as three, everywhere except at
    // the fastest tempos.
    expect(new TimeSignature(3, 8).isCompound).toBe(false);
    expect(new TimeSignature(3, 8).pulsesPerMeasure).toBe(3);
    expect(new TimeSignature(6, 4).isCompound).toBe(false);
    expect(new TimeSignature(6, 4).pulsesPerMeasure).toBe(6);
  });

  it('parses and rejects denominators it cannot notate', () => {
    expect(TimeSignature.parse('3/4').equals(new TimeSignature(3, 4))).toBe(true);
    expect(() => new TimeSignature(4, 5)).toThrow(DomainError);
    expect(() => new TimeSignature(0, 4)).toThrow(DomainError);
  });
});

describe('KeySignature', () => {
  it('names major and minor keys from the number of accidentals', () => {
    expect(KeySignature.major(0).name).toBe('C major');
    expect(KeySignature.major(1).name).toBe('G major');
    expect(KeySignature.major(-1).name).toBe('F major');
    expect(KeySignature.major(6).name).toBe('F# major');
    expect(KeySignature.major(-6).name).toBe('Gb major');
    expect(KeySignature.minor(0).name).toBe('A minor');
    expect(KeySignature.minor(-3).name).toBe('C minor');
  });

  it('applies accidentals in staff order', () => {
    const dMajor = KeySignature.major(2);
    expect(dMajor.accidentalSteps).toEqual(['F', 'C']);
    expect(dMajor.alterationFor('F')).toBe(1);
    expect(dMajor.alterationFor('C')).toBe(1);
    expect(dMajor.alterationFor('G')).toBe(0);

    const eFlatMajor = KeySignature.major(-3);
    expect(eFlatMajor.accidentalSteps).toEqual(['B', 'E', 'A']);
    expect(eFlatMajor.alterationFor('E')).toBe(-1);
    expect(eFlatMajor.alterationFor('D')).toBe(0);
  });

  it('spells staff positions inside the key', () => {
    const dMajor = KeySignature.major(2);
    // The staff position of F4 must be spelled F#4 in D major.
    expect(dMajor.pitchAt(31).toString()).toBe('F#4');
    expect(dMajor.pitchAt(28).toString()).toBe('C#4');
    expect(dMajor.pitchAt(29).toString()).toBe('D4');
  });

  it('finds the first tonic at or above a staff position', () => {
    const gMajor = KeySignature.major(1);
    const tonic = gMajor.tonicIndexAtOrAbove(28);
    expect(gMajor.pitchAt(tonic).toString()).toBe('G4');
    expect(tonic).toBeGreaterThanOrEqual(28);
  });

  it('rejects impossible signatures', () => {
    expect(() => new KeySignature(8)).toThrow(DomainError);
    expect(() => new KeySignature(1.5)).toThrow(DomainError);
  });

  it('offers a non-empty set of keys to the UI', () => {
    expect(COMMON_KEYS.length).toBeGreaterThan(5);
    expect(COMMON_KEYS.every((key) => key.name.length > 0)).toBe(true);
  });
});

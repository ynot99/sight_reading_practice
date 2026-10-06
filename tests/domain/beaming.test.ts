import { describe, expect, it } from 'vitest';
import { beamedByTheBeat } from '../../src/domain/generation/beaming.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { measureOf, noteEntry, restEntry, type Measure } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';

const VALUES = {
  w: Duration.WHOLE,
  h: Duration.HALF,
  q: Duration.QUARTER,
  e: Duration.EIGHTH,
  s: Duration.SIXTEENTH,
  t: Duration.TRIPLET_EIGHTH,
} as const;

/** A bar from letters: q e s t for the values, `r` before one for its rest. */
function bar(spec: string): Measure {
  return measureOf(
    spec.split(' ').map((token) => {
      const rest = token.startsWith('r');
      const value = VALUES[(rest ? token.slice(1) : token) as keyof typeof VALUES];
      return rest ? restEntry(value) : noteEntry(Pitch.parse('C5'), value);
    }),
  );
}

/** Each entry's beams as `level:type`, `-` where it has none. */
function said(measure: Measure): string[] {
  return measure.entries.map((entry) =>
    entry.kind === 'note' && entry.beams.length > 0
      ? entry.beams.map((beam) => `${String(beam.level)}:${beam.type}`).join(' ')
      : '-',
  );
}

const time = (value: string) => TimeSignature.parse(value);

describe('a generated bar, beamed by the beat', () => {
  it('beams the eighths of each beat together, and nothing across a beat', () => {
    expect(said(beamedByTheBeat(bar('e e q e e e e'), time('4/4')))).toEqual([
      '1:begin',
      '1:end',
      '-',
      '1:begin',
      '1:end',
      '1:begin',
      '1:end',
    ]);
  });

  it('leaves out a value that crosses into the next beat, and a quarter even inside one', () => {
    // The eighth after three sixteenths runs over the second beat.
    expect(said(beamedByTheBeat(bar('s s s e s h e'), time('4/4')))).toEqual([
      '1:begin 2:begin',
      '1:continue 2:continue',
      '1:end 2:end',
      '-',
      '-',
      '-',
      '-',
    ]);
    // A quarter and an eighth are one beat of six-eight, and a quarter is flagged by nobody.
    expect(said(beamedByTheBeat(bar('q e q e'), time('6/8')))).toEqual(['-', '-', '-', '-']);
  });

  it('leaves a group of one alone, and lets a rest end a group', () => {
    expect(said(beamedByTheBeat(bar('e re q h'), time('4/4')))).toEqual(['-', '-', '-', '-']);
    expect(said(beamedByTheBeat(bar('q e q e q'), time('4/4')))).toEqual(['-', '-', '-', '-', '-']);
  });

  it('beams three-eight as one group, and six-eight in two', () => {
    expect(said(beamedByTheBeat(bar('e e e'), time('3/8')))).toEqual(['1:begin', '1:continue', '1:end']);
    expect(said(beamedByTheBeat(bar('e e e e e e'), time('6/8')))).toEqual([
      '1:begin',
      '1:continue',
      '1:end',
      '1:begin',
      '1:continue',
      '1:end',
    ]);
  });

  it('gives sixteenths side by side a second beam, and a lone one a hook', () => {
    expect(said(beamedByTheBeat(bar('s s e h q'), time('4/4')))).toEqual([
      '1:begin 2:begin',
      '1:continue 2:end',
      '1:end',
      '-',
      '-',
    ]);
    expect(said(beamedByTheBeat(bar('s e s h q'), time('4/4')))).toEqual([
      '1:begin 2:forward hook',
      '1:continue',
      '1:end 2:backward hook',
      '-',
      '-',
    ]);
  });

  it('beams a triplet as the group it is', () => {
    expect(said(beamedByTheBeat(bar('t t t q h'), time('4/4')))).toEqual([
      '1:begin',
      '1:continue',
      '1:end',
      '-',
      '-',
    ]);
  });

  it('beams what the generator writes, and the page prints it', () => {
    const preset = BUILT_IN_PRESETS.find((one) => one.id === 'sequences');
    const exercise = preset?.generator.generate({
      measures: 4,
      timeSignature: time('4/4'),
      key: KeySignature.major(0),
      tempoBpm: 60,
      rhythm: new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES).get('flowing'),
      seed: 4,
    });
    const beamed = (exercise?.staves ?? []).flatMap((staff) =>
      staff.measures.flatMap((measure) => measure.entries.filter((entry) => entry.kind === 'note' && entry.beams.length > 0)),
    );
    expect(beamed.length).toBeGreaterThan(0);
    expect(new MusicXmlSerializer().serialize(exercise ?? (undefined as never))).toContain('<beam number="1">begin</beam>');
  });
});

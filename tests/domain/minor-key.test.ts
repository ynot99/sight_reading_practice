import { describe, expect, it } from 'vitest';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { chordToneInMinor, leadingUpInMinor } from '../../src/domain/generation/voices/minorKey.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { measureOf, noteEntry, restEntry, type Measure } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';

const A_MINOR = KeySignature.minor(0);
const RHYTHMS = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);

/** One bar of quarters, a name each; `~` after a name ties it into the next. */
function bar(...names: string[]): Measure {
  return measureOf(
    names.map((name) => {
      if (name === 'r') {
        return restEntry(Duration.QUARTER);
      }
      const tied = name.endsWith('~');
      const pitch = Pitch.parse(tied ? name.slice(0, -1) : name);
      return noteEntry(pitch, Duration.QUARTER, tied ? [pitch.midi] : []);
    }),
  );
}

function names(measures: readonly Measure[]): string {
  return measures
    .map((measure) =>
      measure.entries
        .map((entry) => (entry.kind === 'note' ? entry.pitches.map(String).join('+') : 'r'))
        .join(' '),
    )
    .join(' | ');
}

describe('the scale degree of a staff position', () => {
  it('counts from the tonic of the key, major or minor', () => {
    expect(A_MINOR.degreeOf(Pitch.parse('A4').diatonicIndex)).toBe(0);
    expect(A_MINOR.degreeOf(Pitch.parse('G4').diatonicIndex)).toBe(6);
    expect(A_MINOR.degreeOf(Pitch.parse('G2').diatonicIndex)).toBe(6);
    expect(KeySignature.major(-1).degreeOf(Pitch.parse('E5').diatonicIndex)).toBe(6);
  });
});

describe('a minor line', () => {
  it('sharpens a seventh that rises to the tonic, and a sixth that rises to it', () => {
    expect(names(leadingUpInMinor([bar('E4', 'F4', 'G4', 'A4')], A_MINOR))).toBe('E4 F#4 G#4 A4');
  });

  it('leaves the seventh alone where it does not lead up', () => {
    // Falling, as the melodic minor falls, and turning back down.
    expect(names(leadingUpInMinor([bar('A4', 'G4', 'F4', 'E4')], A_MINOR))).toBe('A4 G4 F4 E4');
    expect(names(leadingUpInMinor([bar('C4', 'G4', 'F4', 'E4')], A_MINOR))).toBe('C4 G4 F4 E4');
  });

  it('sharpens only the seventh where the sixth was not what led to it', () => {
    expect(names(leadingUpInMinor([bar('E4', 'G4', 'A4', 'C5')], A_MINOR))).toBe('E4 G#4 A4 C5');
    // A sixth an octave away is no step up to it.
    expect(names(leadingUpInMinor([bar('F5', 'G4', 'A4', 'r')], A_MINOR))).toBe('F5 G#4 A4 r');
  });

  it('reads the line across a bar line and past a rest', () => {
    expect(names(leadingUpInMinor([bar('C4', 'D4', 'F4', 'G4'), bar('r', 'A4', 'B4', 'C5')], A_MINOR))).toBe(
      'C4 D4 F#4 G#4 | r A4 B4 C5',
    );
  });

  it('never sharpens one end of a tie', () => {
    expect(names(leadingUpInMinor([bar('E4', 'G4~', 'G4', 'A4')], A_MINOR))).toBe('E4 G4 G4 A4');
    // Nor the sixth held into the seventh.
    expect(names(leadingUpInMinor([bar('F4~', 'F4', 'G4', 'A4')], A_MINOR))).toBe('F4 F4 G#4 A4');
  });

  it('leaves a major line as it is', () => {
    const major = KeySignature.major(0);
    expect(names(leadingUpInMinor([bar('E4', 'F4', 'G4', 'A4')], major))).toBe('E4 F4 G4 A4');
  });

  it('spells the sharpened note on the key signature\'s own line', () => {
    // F sharp minor: the seventh is E, sharpened to E sharp rather than F.
    const sharpKey = KeySignature.minor(3);
    expect(names(leadingUpInMinor([bar('D5', 'E5', 'F#5', 'r')], sharpKey))).toBe('D#5 E#5 F#5 r');
    // C minor: the seventh is B flat in the signature, raised to B natural.
    const flatKey = KeySignature.minor(-3);
    expect(names(leadingUpInMinor([bar('Ab4', 'Bb4', 'C5', 'r')], flatKey))).toBe('A4 B4 C5 r');
  });
});

describe('a chord in a minor key', () => {
  it('is major on the fifth degree, its third the leading note', () => {
    const e = Pitch.parse('E3').diatonicIndex;
    expect(String(chordToneInMinor(A_MINOR, e, e + 2))).toBe('G#3');
    expect(String(chordToneInMinor(A_MINOR, e, e + 4))).toBe('B3');
  });

  it('keeps the seventh natural in any other chord', () => {
    // The chord on the third degree, whose fifth is the seventh: sharpened, it
    // would be an augmented chord nobody wrote.
    const c = Pitch.parse('C3').diatonicIndex;
    expect(String(chordToneInMinor(A_MINOR, c, c + 4))).toBe('G3');
    expect(String(chordToneInMinor(KeySignature.major(0), Pitch.parse('G3').diatonicIndex, Pitch.parse('B3').diatonicIndex))).toBe('B3');
  });
});

describe('generated in a minor key', () => {
  it('sharpens a seventh only where it leads up to the tonic', () => {
    const preset = BUILT_IN_PRESETS.find((one) => one.id === 'sequences');
    if (preset === undefined) {
      throw new Error('expected the sequences');
    }
    let sharpened = 0;
    for (let seed = 0; seed < 30; seed += 1) {
      const exercise = preset.generator.generate({
        measures: 8,
        timeSignature: new TimeSignature(4, 4),
        key: A_MINOR,
        tempoBpm: 60,
        rhythm: RHYTHMS.get('flowing'),
        seed,
      });
      for (const staff of exercise.staves) {
        const line = staff.measures
          .flatMap((measure) => measure.entries)
          .flatMap((entry) => (entry.kind === 'note' && entry.pitches.length === 1 ? entry.pitches : []));
        line.forEach((pitch, at) => {
          if (pitch.step === 'G' && pitch.alter === 1) {
            sharpened += 1;
            expect(line[at + 1]?.toString().startsWith('A')).toBe(true);
          }
        });
      }
    }
    expect(sharpened).toBeGreaterThan(0);
  });

  it('writes the chord on the fifth degree major, and no other chord with the sharpened seventh', () => {
    const preset = BUILT_IN_PRESETS.find((one) => one.id === 'triads-left-hand');
    if (preset === undefined) {
      throw new Error('expected the triads');
    }
    const chords = Array.from({ length: 20 }, (_, seed) =>
      preset.generator.generate({
        measures: 4,
        timeSignature: new TimeSignature(4, 4),
        key: A_MINOR,
        tempoBpm: 60,
        rhythm: RHYTHMS.get('calm'),
        seed,
      }),
    ).flatMap((exercise) =>
      (exercise.staves[1]?.measures ?? [])
        .flatMap((measure) => measure.entries)
        .flatMap((entry) => (entry.kind === 'note' && entry.pitches.length > 1 ? [entry.pitches] : [])),
    );
    const onTheDominant = chords.filter((chord) => chord.some((pitch) => pitch.step === 'E'));
    expect(onTheDominant.length).toBeGreaterThan(0);
    // Every chord with a G in it is the dominant's, and has it sharpened.
    for (const chord of chords.filter((one) => one.some((pitch) => pitch.step === 'G'))) {
      expect(chord.map(String).join(' ')).toMatch(/E\d.*G#\d/);
    }
  });
});

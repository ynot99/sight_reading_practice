import { describe, expect, it } from 'vitest';
import { ExercisePresetRegistry } from '../../src/domain/generation/ExercisePresetRegistry.js';
import { GrandStaffExerciseGenerator } from '../../src/domain/generation/GrandStaffExerciseGenerator.js';
import type { ExerciseRequest } from '../../src/domain/generation/IExerciseGenerator.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { fillMeasure, splitIntoRests, type RhythmOptions } from '../../src/domain/generation/RhythmFiller.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';
import { createRng } from '../../src/domain/generation/Rng.js';
import { HarmonyVoiceGenerator } from '../../src/domain/generation/voices/HarmonyVoiceGenerator.js';
import { MelodyVoiceGenerator } from '../../src/domain/generation/voices/MelodyVoiceGenerator.js';
import { SilentVoiceGenerator } from '../../src/domain/generation/voices/SilentVoiceGenerator.js';
import { Duration } from '../../src/domain/model/Duration.js';
import type { Exercise, NoteEntry } from '../../src/domain/model/Exercise.js';
import { measureTicks, validateExercise } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { DomainError } from '../../src/shared/errors.js';
import { steadyProfile } from '../support/rhythm.js';

const COMMON = new TimeSignature(4, 4);
const RHYTHMS = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);

function noteEntriesOf(exercise: Exercise, staffIndex: number): NoteEntry[] {
  const staff = exercise.staves[staffIndex];
  if (staff === undefined) {
    throw new Error(`No staff ${staffIndex}.`);
  }
  return staff.measures.flatMap((measure) =>
    measure.entries.filter((entry): entry is NoteEntry => entry.kind === 'note'),
  );
}

function pitchesOf(exercise: Exercise, staffIndex: number): Pitch[] {
  return noteEntriesOf(exercise, staffIndex).flatMap((entry) => [...entry.pitches]);
}

describe('createRng', () => {
  it('produces the same stream for the same seed', () => {
    const left = createRng(1234);
    const right = createRng(1234);
    const draw = (): number[] => Array.from({ length: 8 }, () => left.next());
    const drawRight = (): number[] => Array.from({ length: 8 }, () => right.next());
    expect(draw()).toEqual(drawRight());
  });

  it('produces different streams for different seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('stays inside [0, 1) and respects integer bounds', () => {
    const rng = createRng(99);
    for (let index = 0; index < 500; index += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      const integer = rng.int(3, 7);
      expect(integer).toBeGreaterThanOrEqual(3);
      expect(integer).toBeLessThanOrEqual(7);
    }
  });

  it('honours weights', () => {
    const rng = createRng(7);
    const counts = { a: 0, b: 0 };
    for (let index = 0; index < 1000; index += 1) {
      counts[rng.weighted([
        { value: 'a' as const, weight: 9 },
        { value: 'b' as const, weight: 1 },
      ])] += 1;
    }
    expect(counts.a).toBeGreaterThan(counts.b * 3);
    expect(counts.a + counts.b).toBe(1000);
  });

  it('rejects empty or weightless collections', () => {
    const rng = createRng(1);
    expect(() => rng.pick([])).toThrow(DomainError);
    expect(() => rng.weighted([{ value: 1, weight: 0 }])).toThrow(DomainError);
    expect(() => rng.int(5, 1)).toThrow(DomainError);
  });
});

describe('fillMeasure', () => {
  const pool: RhythmOptions = {
    durations: [
      { value: Duration.QUARTER, weight: 3 },
      { value: Duration.EIGHTH, weight: 3 },
      { value: Duration.HALF, weight: 2 },
      { value: Duration.WHOLE, weight: 1 },
    ],
    restProbability: 0.2,
    keepInsideBeats: true,
  };

  it('always fills the bar exactly', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      const slots = fillMeasure(COMMON, createRng(seed), pool);
      const total = slots.reduce((sum, slot) => sum + slot.duration.ticks, 0);
      expect(total).toBe(COMMON.ticksPerMeasure);
    }
  });

  it('reports the onset of every slot', () => {
    const slots = fillMeasure(COMMON, createRng(5), pool);
    let expectedOnset = 0;
    for (const slot of slots) {
      expect(slot.onsetTicks).toBe(expectedOnset);
      expectedOnset += slot.duration.ticks;
    }
  });

  it('keeps values from straddling beats', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      for (const slot of fillMeasure(COMMON, createRng(seed), pool)) {
        const startsOnBeat = slot.onsetTicks % COMMON.ticksPerBeat === 0;
        const endsInsideBeat =
          slot.onsetTicks + slot.duration.ticks <=
          (Math.floor(slot.onsetTicks / COMMON.ticksPerBeat) + 1) * COMMON.ticksPerBeat;
        expect(startsOnBeat || endsInsideBeat).toBe(true);
      }
    }
  });

  it('only places rests on beats', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      for (const slot of fillMeasure(COMMON, createRng(seed), { ...pool, restProbability: 1 })) {
        if (slot.isRest) {
          expect(slot.onsetTicks % COMMON.ticksPerBeat).toBe(0);
        }
      }
    }
  });

  it('fills compound time with values that fit', () => {
    const sixEight = new TimeSignature(6, 8);
    const slots = fillMeasure(sixEight, createRng(3), pool);
    expect(slots.reduce((sum, slot) => sum + slot.duration.ticks, 0)).toBe(
      sixEight.ticksPerMeasure,
    );
  });

  it('tiles leftover space with notatable rests', () => {
    expect(splitIntoRests(1920)).toEqual([Duration.WHOLE]);
    expect(splitIntoRests(1440)).toEqual([Duration.DOTTED_HALF]);
    expect(splitIntoRests(600).reduce((sum, rest) => sum + rest.ticks, 0)).toBe(600);
  });
});

describe('voice generators', () => {
  const context = {
    rng: createRng(42),
    key: KeySignature.major(0),
    timeSignature: COMMON,
    measures: 4,
    rhythm: steadyProfile(Duration.QUARTER),
  };

  it('keeps a melody inside its range and in key', () => {
    const generator = new MelodyVoiceGenerator({
      range: { lowest: Pitch.parse('C4'), highest: Pitch.parse('C5') },
      role: 'lead',
      maxLeap: 3,
      stepProbability: 0.7,
    });

    const measures = generator.generate({ ...context, rng: createRng(11) });
    expect(measures).toHaveLength(4);

    for (const measure of measures) {
      expect(measureTicks(measure)).toBe(COMMON.ticksPerMeasure);
      for (const entry of measure.entries) {
        if (entry.kind !== 'note') {
          continue;
        }
        for (const pitch of entry.pitches) {
          expect(pitch.midi).toBeGreaterThanOrEqual(Pitch.parse('C4').midi);
          expect(pitch.midi).toBeLessThanOrEqual(Pitch.parse('C5').midi);
          expect(pitch.alter).toBe(0);
        }
      }
    }
  });

  it('spells a melody for the key signature', () => {
    const generator = new MelodyVoiceGenerator({
      range: { lowest: Pitch.parse('C4'), highest: Pitch.parse('C5') },
      role: 'lead',
      maxLeap: 6,
      stepProbability: 0.2,
    });

    const measures = generator.generate({
      rng: createRng(5),
      key: KeySignature.major(2),
      timeSignature: COMMON,
      measures: 8,
      rhythm: steadyProfile(Duration.QUARTER),
    });
    const pitches = measures.flatMap((measure) =>
      measure.entries.flatMap((entry) => (entry.kind === 'note' ? [...entry.pitches] : [])),
    );

    expect(pitches.length).toBeGreaterThan(0);
    for (const pitch of pitches) {
      const expectedAlter = pitch.step === 'F' || pitch.step === 'C' ? 1 : 0;
      expect(pitch.alter).toBe(expectedAlter);
    }
  });

  it('respects the maximum leap', () => {
    const generator = new MelodyVoiceGenerator({
      range: { lowest: Pitch.parse('C3'), highest: Pitch.parse('C6') },
      role: 'lead',
      maxLeap: 2,
      stepProbability: 0.5,
    });

    const measures = generator.generate({ ...context, rng: createRng(21), measures: 12 });
    const indices = measures
      .flatMap((measure) => measure.entries)
      .flatMap((entry) => (entry.kind === 'note' ? entry.pitches.map((pitch) => pitch.diatonicIndex) : []));

    for (let index = 1; index < indices.length; index += 1) {
      const previous = indices[index - 1] ?? 0;
      const current = indices[index] ?? 0;
      expect(Math.abs(current - previous)).toBeLessThanOrEqual(2);
    }
  });

  it('builds triads that stay inside the hand', () => {
    const generator = new HarmonyVoiceGenerator({
      range: { lowest: Pitch.parse('F2'), highest: Pitch.parse('C4') },
      role: 'lead',
      shape: 'triad',
      intervalDegrees: [2, 4],
      degreePool: [0, 3, 4],
      harmonyPerMeasure: true,
    });

    const measures = generator.generate({
      ...context,
      rng: createRng(8),
      measures: 6,
      rhythm: steadyProfile(Duration.WHOLE),
    });
    for (const measure of measures) {
      for (const entry of measure.entries) {
        if (entry.kind !== 'note') {
          continue;
        }
        expect(entry.pitches.length).toBeGreaterThanOrEqual(1);
        expect(entry.pitches.length).toBeLessThanOrEqual(3);
        for (const pitch of entry.pitches) {
          expect(pitch.midi).toBeGreaterThanOrEqual(Pitch.parse('F2').midi);
          expect(pitch.midi).toBeLessThanOrEqual(Pitch.parse('C4').midi);
        }
      }
    }
  });

  it('writes intervals from the configured set', () => {
    const generator = new HarmonyVoiceGenerator({
      range: { lowest: Pitch.parse('C3'), highest: Pitch.parse('C5') },
      role: 'lead',
      shape: 'interval',
      intervalDegrees: [2, 4],
      degreePool: [0, 4],
      harmonyPerMeasure: false,
    });

    const measures = generator.generate({
      ...context,
      rng: createRng(17),
      measures: 6,
      rhythm: steadyProfile(Duration.HALF),
    });
    for (const measure of measures) {
      for (const entry of measure.entries) {
        if (entry.kind !== 'note' || entry.pitches.length < 2) {
          continue;
        }
        const [low, high] = entry.pitches;
        if (low === undefined || high === undefined) {
          continue;
        }
        expect([2, 4]).toContain(Math.abs(high.diatonicIndex - low.diatonicIndex));
      }
    }
  });

  it('fills a silent staff with bar rests', () => {
    const measures = new SilentVoiceGenerator().generate({ ...context, measures: 3 });
    expect(measures).toHaveLength(3);
    for (const measure of measures) {
      expect(measure.entries.every((entry) => entry.kind === 'rest')).toBe(true);
      expect(measureTicks(measure)).toBe(COMMON.ticksPerMeasure);
    }
  });
});

describe('GrandStaffExerciseGenerator', () => {
  const generator = new GrandStaffExerciseGenerator({
    id: 'gen.test',
    label: 'Test generator',
    staves: [
      {
        clef: 'treble',
        voice: new MelodyVoiceGenerator({
          range: { lowest: Pitch.parse('C4'), highest: Pitch.parse('G4') },
          role: 'lead',
          maxLeap: 2,
          stepProbability: 0.8,
        }),
      },
      { clef: 'bass', voice: new SilentVoiceGenerator() },
    ],
  });

  const request: ExerciseRequest = {
    measures: 4,
    timeSignature: COMMON,
    key: KeySignature.major(0),
    tempoBpm: 72,
    rhythm: steadyProfile(Duration.QUARTER),
    seed: 2024,
  };

  it('produces a valid exercise', () => {
    const exercise = generator.generate(request);
    expect(() => validateExercise(exercise)).not.toThrow();
    expect(exercise.staves).toHaveLength(2);
    expect(exercise.staves[0]?.staffNumber).toBe(1);
    expect(exercise.staves[0]?.voice).toBe(1);
    expect(exercise.staves[1]?.staffNumber).toBe(2);
    expect(exercise.staves[1]?.clef).toBe('bass');
    expect(exercise.tempoBpm).toBe(72);
  });

  it('is reproducible from its seed', () => {
    const first = generator.generate(request);
    const second = generator.generate(request);
    expect(pitchesOf(second, 0).map(String)).toEqual(pitchesOf(first, 0).map(String));
    expect(second.id).toBe(first.id);
    expect(second.metadata.seed).toBe(2024);
  });

  it('produces different music for different seeds', () => {
    const a = generator.generate({ ...request, seed: 1 });
    const b = generator.generate({ ...request, seed: 2 });
    expect(pitchesOf(b, 0).map(String)).not.toEqual(pitchesOf(a, 0).map(String));
  });

  it('records a seed even when the caller does not supply one', () => {
    const exercise = generator.generate({ ...request, seed: undefined });
    expect(Number.isInteger(exercise.metadata.seed)).toBe(true);
    expect(exercise.metadata.generatorId).toBe('gen.test');
  });

  it('rejects impossible requests', () => {
    expect(() => generator.generate({ ...request, measures: 0 })).toThrow(DomainError);
    expect(() => generator.generate({ ...request, tempoBpm: 0 })).toThrow(DomainError);
  });
});

describe('built-in presets', () => {
  it('all generate valid material at their defaults', () => {
    for (const preset of BUILT_IN_PRESETS) {
      const exercise = preset.generator.generate({
        measures: preset.defaults.measures,
        timeSignature: preset.defaults.timeSignature,
        key: preset.defaults.key,
        tempoBpm: preset.defaults.tempoBpm,
        rhythm: RHYTHMS.get(preset.defaults.rhythmProfileId),
        seed: 4242,
      });
      expect(() => validateExercise(exercise)).not.toThrow();
      expect(exercise.staves).toHaveLength(2);
    }
  });

  it('generate valid material across keys and time signatures', () => {
    const signatures = [new TimeSignature(4, 4), new TimeSignature(3, 4), new TimeSignature(6, 8)];
    for (const preset of BUILT_IN_PRESETS) {
      for (const timeSignature of signatures) {
        for (const fifths of [-3, -1, 0, 2, 4]) {
          const exercise = preset.generator.generate({
            measures: 3,
            timeSignature,
            key: KeySignature.major(fifths),
            tempoBpm: 60,
            rhythm: RHYTHMS.get(preset.defaults.rhythmProfileId),
            seed: fifths + 100,
          });
          expect(() => validateExercise(exercise)).not.toThrow();
        }
      }
    }
  });

  // Rhythm is a free axis, so every combination has to be playable - not just
  // the pairing each preset happens to ship with.
  it('generate valid material under every rhythm profile', () => {
    const signatures = [new TimeSignature(4, 4), new TimeSignature(3, 4), new TimeSignature(6, 8)];
    for (const preset of BUILT_IN_PRESETS) {
      for (const profile of BUILT_IN_RHYTHM_PROFILES) {
        for (const timeSignature of signatures) {
          for (let seed = 0; seed < 8; seed += 1) {
            const exercise = preset.generator.generate({
              measures: 3,
              timeSignature,
              key: KeySignature.major(0),
              tempoBpm: 60,
              rhythm: profile,
              seed,
            });
            expect(() => validateExercise(exercise)).not.toThrow();
          }
        }
      }
    }
  });
});

describe('ExercisePresetRegistry', () => {
  it('registers, lists and resolves presets', () => {
    const registry = new ExercisePresetRegistry().registerAll(BUILT_IN_PRESETS);
    expect(registry.list()).toHaveLength(BUILT_IN_PRESETS.length);
    const first = registry.first();
    expect(registry.get(first.id)).toBe(first);
    expect(registry.has(first.id)).toBe(true);
  });

  it('rejects duplicate ids and unknown lookups', () => {
    const registry = new ExercisePresetRegistry().registerAll(BUILT_IN_PRESETS);
    const [preset] = BUILT_IN_PRESETS;
    if (preset === undefined) {
      throw new Error('expected built-in presets');
    }
    expect(() => registry.register(preset)).toThrow(DomainError);
    expect(() => registry.get('nope')).toThrow(DomainError);
    expect(() => new ExercisePresetRegistry().first()).toThrow(DomainError);
  });
});

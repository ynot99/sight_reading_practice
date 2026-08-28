import { describe, expect, it } from 'vitest';
import { fillMeasure, type RhythmOptions } from '../../src/domain/generation/RhythmFiller.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { createRng } from '../../src/domain/generation/Rng.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { validateExercise } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';

const COMMON = new TimeSignature(4, 4);

const ACROSS: RhythmOptions = {
  durations: [
    { value: Duration.QUARTER, weight: 5 },
    { value: Duration.EIGHTH, weight: 4 },
    { value: Duration.HALF, weight: 2 },
  ],
  restProbability: 0,
  keepInsideBeats: true,
  syncopation: 1,
};

function bars(rhythm: RhythmOptions, count = 40) {
  return Array.from({ length: count }, (_, seed) => fillMeasure(COMMON, createRng(seed), rhythm));
}

describe('notes that cross the beat', () => {
  it('are written as tied pieces, not as one impossible value', () => {
    const tied = bars(ACROSS)
      .flat()
      .filter((slot) => slot.tiedForward);
    expect(tied.length).toBeGreaterThan(0);

    for (const slots of bars(ACROSS)) {
      slots.forEach((slot, index) => {
        if (!slot.tiedForward) {
          return;
        }
        // A tie leads into the next slot, and that slot begins where this one
        // ends - it is one sound cut at the bar's pulse.
        const next = slots[index + 1];
        expect(next).toBeDefined();
        expect(next?.onsetTicks).toBe(slot.onsetTicks + slot.duration.ticks);
      });
    }
  });

  it('cuts exactly at the beat, so each piece can be written', () => {
    for (const slots of bars(ACROSS)) {
      for (const slot of slots) {
        if (!slot.tiedForward) {
          continue;
        }
        const end = slot.onsetTicks + slot.duration.ticks;
        expect(end % COMMON.ticksPerBeat).toBe(0);
        expect(Duration.isNotatable(slot.duration.ticks)).toBe(true);
      }
    }
  });

  it('still fills the bar exactly', () => {
    for (const slots of bars(ACROSS)) {
      expect(slots.reduce((total, slot) => total + slot.duration.ticks, 0)).toBe(
        COMMON.ticksPerMeasure,
      );
    }
  });

  it('only ever begins one off the beat, which is what makes it syncopation', () => {
    for (const slots of bars(ACROSS)) {
      slots.forEach((slot, index) => {
        // Where the chain *starts*. A long note crosses several beats, and its
        // middle pieces do begin on one - they are continuations, not entries.
        const opensChain = slot.tiedForward && slots[index - 1]?.tiedForward !== true;
        if (!opensChain) {
          return;
        }
        expect(slot.onsetTicks % COMMON.ticksPerBeat).not.toBe(0);
      });
    }
  });

  it('never ties a rest', () => {
    const withRests: RhythmOptions = { ...ACROSS, restProbability: 0.5 };
    for (const slots of bars(withRests)) {
      for (const slot of slots) {
        expect(slot.tiedForward && slot.isRest).toBe(false);
      }
    }
  });

  it('leaves a pool that never asked for it exactly as it was', () => {
    // The option is what turns it on, and the rhythmic levels that predate it
    // are untouched - which the committed digest also pins.
    const plain: RhythmOptions = { ...ACROSS, syncopation: undefined };
    for (const slots of bars(plain)) {
      expect(slots.every((slot) => !slot.tiedForward)).toBe(true);
    }
  });
});

describe('the syncopated rhythmic level', () => {
  const profile = BUILT_IN_RHYTHM_PROFILES.find((candidate) => candidate.id === 'syncopated');

  it('is offered', () => {
    expect(profile).toBeDefined();
  });

  it('writes music that holds a note across the beat, and holds one pitch', () => {
    if (profile === undefined) {
      throw new Error('expected the syncopated profile');
    }
    const preset = BUILT_IN_PRESETS.find((candidate) => candidate.id === 'treble-only');
    if (preset === undefined) {
      throw new Error('expected the preset');
    }

    let tied = 0;
    for (let seed = 0; seed < 12; seed += 1) {
      const exercise = preset.generator.generate({
        measures: 4,
        timeSignature: COMMON,
        key: KeySignature.major(0),
        tempoBpm: 72,
        rhythm: profile,
        seed,
      });
      // Validation is the real assertion here: a tie must land on the same
      // pitch in the next entry, which is only true if the melody stopped
      // moving for the length of the held note.
      expect(() => validateExercise(exercise)).not.toThrow();
      tied += exercise.staves
        .flatMap((staff) => staff.measures)
        .flatMap((measure) => measure.entries)
        .filter((entry) => entry.kind === 'note' && entry.tiedForward.length > 0).length;
    }
    expect(tied).toBeGreaterThan(0);
  });
});

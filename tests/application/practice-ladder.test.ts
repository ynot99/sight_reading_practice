import { describe, expect, it } from 'vitest';
import { PracticeLadder, type LadderStep } from '../../src/application/ladder/PracticeLadder.js';
import { BUILT_IN_GRADES, type Grade } from '../../src/application/ladder/grades.js';
import { BUILT_IN_LADDER } from '../../src/application/ladder/ladderSteps.js';
import { ExercisePresetRegistry } from '../../src/domain/generation/ExercisePresetRegistry.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { validateExercise } from '../../src/domain/model/Exercise.js';

const GRADE: Grade = { id: 'g', label: 'G', newHere: [], notYet: [], keys: [], times: [] };

function rung(id: string, grade = 'g'): LadderStep {
  return { id, grade, label: id, description: id, settings: {} };
}

const THREE = new PracticeLadder([rung('a'), rung('b'), rung('c')], [GRADE]);

describe('the arithmetic of a ladder', () => {
  it('knows where each rung sits', () => {
    expect(THREE.positionOf('b')).toBe(2);
    expect(THREE.list()).toHaveLength(3);
  });

  it('steps either way', () => {
    expect(THREE.step('b', 1).id).toBe('c');
    expect(THREE.step('b', -1).id).toBe('a');
  });

  it('stays put at the ends rather than wrapping', () => {
    // The top is a place to stay: a reader still reading cleanly there must
    // not be sent back to the bottom.
    expect(THREE.step('c', 1).id).toBe('c');
    expect(THREE.step('a', -1).id).toBe('a');
    expect(THREE.canStep('c', 1)).toBe(false);
    expect(THREE.canStep('a', -1)).toBe(false);
    expect(THREE.canStep('a', 1)).toBe(true);
  });

  it('falls back to the first rung for an id it does not know', () => {
    // A stored rung from an older release costs the reader their place, not
    // the page.
    expect(THREE.find('rung.gone')).toBeNull();
    expect(THREE.step('rung.gone', 1).id).toBe('a');
  });

  it('refuses a ladder with a repeated rung', () => {
    expect(() => new PracticeLadder([rung('a'), rung('a')], [GRADE])).toThrow(/twice/);
  });

  it('refuses a rung of a grade it was not given', () => {
    expect(() => new PracticeLadder([rung('a', 'nowhere')], [GRADE])).toThrow(/grade/);
  });

  it('says which grade a rung is in', () => {
    const other: Grade = { ...GRADE, id: 'h', label: 'H' };
    const two = new PracticeLadder([rung('a'), rung('b', 'h')], [GRADE, other]);
    expect(two.list().map((step) => two.gradeOf(step).label)).toEqual(['G', 'H']);
  });
});

describe('the built-in ladder', () => {
  const presets = new ExercisePresetRegistry().registerAll(BUILT_IN_PRESETS);
  const rhythms = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);
  const ladder = new PracticeLadder(BUILT_IN_LADDER, BUILT_IN_GRADES);

  it('names only material and rhythms that exist', () => {
    for (const step of ladder.list()) {
      const presetId = step.settings.presetId;
      const rhythmId = step.settings.rhythmProfileId;
      expect({
        rung: step.id,
        preset: presetId === undefined || presets.has(presetId),
        rhythm: rhythmId === undefined || rhythms.has(rhythmId),
      }).toEqual({ rung: step.id, preset: true, rhythm: true });
    }
  });

  it('moves one thing at a time', () => {
    // A rung that changed the notes and the rhythm and the key at once would
    // leave a reader who came unstuck unable to say which of the three did it.
    // The first rung of each preset is exempt: arriving somewhere new states
    // everything, so that there is no inheritance to puzzle over.
    let previousPreset: string | undefined;
    for (const step of ladder.list()) {
      const { presetId, rhythmProfileId, key, timeSignature } = step.settings;
      const arriving = presetId !== undefined && presetId !== previousPreset;
      previousPreset = presetId ?? previousPreset;
      if (arriving) {
        continue;
      }
      // Drawing the key and metre is the one thing a grade's last rungs move.
      const moved = [rhythmProfileId, key, timeSignature, step.draws].filter(
        (value) => value !== undefined,
      ).length;
      expect({ rung: step.id, moved }).toEqual({ rung: step.id, moved: 1 });
    }
  });

  it('hands over everything a rung stands for, not just what it moved', () => {
    // Grade 5 b only says "syncopated"; arriving there must still bring the
    // sequences, the key and the metre the route had already set.
    const resolved = ladder.resolve('grade-5.across');

    expect(resolved.rhythmProfileId).toBe('syncopated');
    expect(resolved.presetId).toBe('sequences');
    expect(resolved.key?.name).toBe('C major');
    expect(resolved.timeSignature?.toString()).toBe('4/4');
    // And a rung after one that drew its keys is on the route's own key.
    expect(ladder.resolve('grade-1.eighths').key?.name).toBe('C major');
  });

  it('resolves every rung to a complete set of the four it governs', () => {
    for (const step of ladder.list()) {
      const resolved = ladder.resolve(step.id);
      expect({
        rung: step.id,
        complete:
          resolved.presetId !== undefined &&
          resolved.rhythmProfileId !== undefined &&
          resolved.key !== undefined &&
          resolved.timeSignature !== undefined,
      }).toEqual({ rung: step.id, complete: true });
    }
  });

  it('starts where a beginner can start', () => {
    const first = ladder.first();
    expect(first.settings.presetId).toBe('right-hand-five');
    expect(first.settings.rhythmProfileId).toBe('calm');
    expect(first.settings.key?.fifths).toBe(0);
    expect(ladder.gradeOf(first).label).toBe('Initial');
  });

  it('climbs the grades in order, and ends each on the whole of it', () => {
    const order = BUILT_IN_GRADES.map((grade) => grade.id);
    const climbed = ladder.list().map((step) => order.indexOf(step.grade));
    expect(climbed).toEqual([...climbed].sort((left, right) => left - right));
    expect(new Set(climbed).size).toBe(order.length);
    // The last rung of every grade is a test of it: every key and metre so far.
    const lastOfEach = order.map((id) => ladder.list().filter((step) => step.grade === id).at(-1));
    expect(lastOfEach.map((step) => step?.draws?.keys?.length)).toEqual([2, 5, 8, 12, 12, 16]);
    expect(lastOfEach.map((step) => step?.draws?.times?.map(String).join(' '))).toEqual([
      '4/4',
      '4/4 3/4 2/4',
      '4/4 3/4 2/4',
      '4/4 3/4 2/4 3/8',
      '4/4 3/4 2/4 3/8 6/8',
      '4/4 3/4 2/4 3/8 6/8',
    ]);
  });

  it("meets a grade's new keys before the rest of them, on their own", () => {
    const newKeys = ladder.list().filter((step) => step.id.endsWith('.keys'));
    expect(
      newKeys.map((step) => [
        step.grade,
        step.draws?.keys?.map((key) => key.name).join(', '),
        step.draws?.times,
      ]),
    ).toEqual([
      ['grade-1', 'G major, F major, A minor', undefined],
      ['grade-2', 'D major, E minor, G minor', undefined],
      ['grade-3', 'A major, Bb major, Eb major, B minor', undefined],
      ['grade-5', 'E major, Ab major, F# minor, C minor', undefined],
    ]);
  });

  it('writes a valid page on every rung, in every key and metre it may draw', () => {
    for (const step of ladder.list()) {
      const settings = ladder.resolve(step.id);
      const preset = presets.get(settings.presetId ?? '');
      for (let seed = 0; seed < 24; seed += 1) {
        const exercise = preset.generator.generate({
          measures: 4,
          key: settings.key ?? preset.defaults.key,
          timeSignature: settings.timeSignature ?? preset.defaults.timeSignature,
          tempoBpm: 60,
          rhythm: rhythms.get(settings.rhythmProfileId ?? ''),
          seed,
          ...(step.draws === undefined ? {} : { drawnFrom: step.draws }),
        });
        expect(() => validateExercise(exercise)).not.toThrow();
      }
    }
  });

  it('says what each grade adds', () => {
    for (const grade of BUILT_IN_GRADES) {
      expect({ grade: grade.id, told: grade.newHere.length > 0 }).toEqual({ grade: grade.id, told: true });
    }
  });

  it('gives every rung a name and a line about it', () => {
    for (const step of ladder.list()) {
      expect({ id: step.id, named: step.label.length > 0 }).toEqual({
        id: step.id,
        named: true,
      });
      expect({ id: step.id, told: step.description.length > 10 }).toEqual({
        id: step.id,
        told: true,
      });
    }
  });
});

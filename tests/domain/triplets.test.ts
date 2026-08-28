import { describe, expect, it } from 'vitest';
import { fillMeasure } from '../../src/domain/generation/RhythmFiller.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { createRng } from '../../src/domain/generation/Rng.js';
import { Duration, TRIPLET } from '../../src/domain/model/Duration.js';
import type { Exercise, Measure } from '../../src/domain/model/Exercise.js';
import {
  noteEntry,
  restEntry,
  tupletPositions,
  validateExercise,
} from '../../src/domain/model/Exercise.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { DomainError } from '../../src/shared/errors.js';
import { bar, p, twoBarExercise } from '../support/fixtures.js';

const COMMON = new TimeSignature(4, 4);

function withTreble(exercise: Exercise, measures: readonly Measure[]): Exercise {
  const [treble, ...rest] = exercise.staves;
  if (treble === undefined) {
    throw new Error('expected a treble staff');
  }
  return { ...exercise, staves: [{ ...treble, measures }, ...rest] };
}

/** One bar: a triplet on beat one, then three plain quarters. */
function tripletBar(): Measure {
  return bar(
    noteEntry(p('C4'), Duration.TRIPLET_EIGHTH),
    noteEntry(p('D4'), Duration.TRIPLET_EIGHTH),
    noteEntry(p('E4'), Duration.TRIPLET_EIGHTH),
    noteEntry(p('F4'), Duration.QUARTER),
    noteEntry(p('G4'), Duration.QUARTER),
    noteEntry(p('A4'), Duration.QUARTER),
  );
}

describe('tuplet values', () => {
  it('divides the beat exactly, with no floating point anywhere', () => {
    expect(Duration.TRIPLET_EIGHTH.ticks).toBe(160);
    expect(Duration.TRIPLET_QUARTER.ticks).toBe(320);
    expect(Duration.TRIPLET_SIXTEENTH.ticks).toBe(80);
    // Three of them make the value they borrowed from.
    expect(Duration.TRIPLET_EIGHTH.tupletSpanTicks).toBe(Duration.QUARTER.ticks);
    expect(Duration.TRIPLET_QUARTER.tupletSpanTicks).toBe(Duration.HALF.ticks);
  });

  it('refuses a ratio that would land between divisions', () => {
    // A sixteenth split seven ways is 68.57 divisions: not a musical position
    // this project is willing to hold.
    expect(() => Duration.of('16th', 0, { actual: 7, normal: 4 })).toThrow(DomainError);
  });

  it('is a different value from the plain one it is written as', () => {
    expect(Duration.TRIPLET_EIGHTH.type).toBe('eighth');
    expect(Duration.TRIPLET_EIGHTH.equals(Duration.EIGHTH)).toBe(false);
    expect(Duration.TRIPLET_EIGHTH.isTuplet).toBe(true);
    expect(Duration.EIGHTH.isTuplet).toBe(false);
    expect(Duration.TRIPLET_EIGHTH.sameTuplet(Duration.TRIPLET_QUARTER)).toBe(true);
    expect(Duration.TRIPLET_EIGHTH.toString()).toBe('eighth (3:2)');
  });

  it('is still interned, so identity comparison stays safe', () => {
    expect(Duration.triplet('eighth')).toBe(Duration.TRIPLET_EIGHTH);
    expect(Duration.of('eighth', 0, TRIPLET)).toBe(Duration.TRIPLET_EIGHTH);
    expect(Duration.of('eighth')).not.toBe(Duration.TRIPLET_EIGHTH);
  });
});

describe('finding the group in the music', () => {
  const triplet = Duration.TRIPLET_EIGHTH;

  it('opens and closes a group of three', () => {
    const positions = tupletPositions([
      noteEntry(p('C4'), triplet),
      noteEntry(p('D4'), triplet),
      noteEntry(p('E4'), triplet),
    ]);
    expect(positions).toEqual([
      { starts: true, stops: false },
      { starts: false, stops: false },
      { starts: false, stops: true },
    ]);
  });

  it('tells two groups in a row apart', () => {
    const six = Array.from({ length: 6 }, () => noteEntry(p('C4'), triplet));
    const positions = tupletPositions(six);
    expect(positions.map((position) => position?.starts)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(positions.map((position) => position?.stops)).toEqual([
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
  });

  it('closes a group of mixed values on the same boundary', () => {
    // A triplet quarter and a triplet eighth also make one beat.
    const positions = tupletPositions([
      noteEntry(p('C4'), Duration.TRIPLET_QUARTER),
      noteEntry(p('D4'), triplet),
    ]);
    expect(positions).toEqual([
      { starts: true, stops: false },
      { starts: false, stops: true },
    ]);
  });

  it('says nothing about plain values', () => {
    expect(tupletPositions([noteEntry(p('C4'), Duration.QUARTER)])).toEqual([null]);
  });

  it('counts a rest inside the group', () => {
    const positions = tupletPositions([
      noteEntry(p('C4'), triplet),
      restEntry(triplet),
      noteEntry(p('E4'), triplet),
    ]);
    expect(positions.at(-1)).toEqual({ starts: false, stops: true });
  });
});

describe('groups that never close', () => {
  it('cannot make a bar that adds up', () => {
    // Two thirds of a beat is 320 divisions, and no plain value is anything
    // but a multiple of 120 - so an unfinished triplet can never be padded
    // into a full bar. The measure length is what catches it, and a separate
    // check for unfinished groups could never fire.
    const broken = withTreble(twoBarExercise(), [
      bar(
        noteEntry(p('C4'), Duration.TRIPLET_EIGHTH),
        noteEntry(p('D4'), Duration.TRIPLET_EIGHTH),
        noteEntry(p('E4'), Duration.QUARTER),
        noteEntry(p('F4'), Duration.QUARTER),
        noteEntry(p('G4'), Duration.QUARTER),
      ),
      bar(noteEntry(p('G4'), Duration.WHOLE)),
    ]);
    // The arithmetic behind that claim: two triplet eighths are 320
    // divisions, and the shortest plain value is 120.
    expect(320 % Duration.SIXTEENTH.ticks).not.toBe(0);
    expect(() => validateExercise(broken)).toThrow(/divisions but 4\/4 requires/);
  });

  it('accepts a complete one', () => {
    const fine = withTreble(twoBarExercise(), [
      tripletBar(),
      bar(noteEntry(p('G4'), Duration.WHOLE)),
    ]);
    expect(() => validateExercise(fine)).not.toThrow();
  });
});

describe('triplets in the printed score', () => {
  const exercise = withTreble(twoBarExercise(), [
    tripletBar(),
    bar(noteEntry(p('G4'), Duration.WHOLE)),
  ]);
  const xml = new MusicXmlSerializer({ includeMetronomeMark: false }).serialize(exercise);

  it('writes the ratio on every note of the group', () => {
    const modifications = [...xml.matchAll(/<time-modification>/g)];
    expect(modifications).toHaveLength(3);
    expect(xml).toContain('<actual-notes>3</actual-notes>');
    expect(xml).toContain('<normal-notes>2</normal-notes>');
  });

  it('brackets the group once, at its ends', () => {
    expect([...xml.matchAll(/<tuplet type="start"/g)]).toHaveLength(1);
    expect([...xml.matchAll(/<tuplet type="stop"/g)]).toHaveLength(1);
  });

  it('keeps the printed value the one a reader recognises', () => {
    // A triplet eighth is still written as an eighth; the ratio is what makes
    // it shorter, and the reader is told so by the bracket.
    expect(xml).toMatch(/<duration>160<\/duration>[\s\S]*?<type>eighth<\/type>/);
  });
});

describe('generating triplets', () => {
  const profile = BUILT_IN_RHYTHM_PROFILES.find((candidate) => candidate.id === 'triplets');

  it('is offered as a rhythmic level', () => {
    expect(profile).toBeDefined();
  });

  it('draws them in complete groups of three, never split', () => {
    if (profile === undefined) {
      throw new Error('expected the triplets profile');
    }
    let seen = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const slots = fillMeasure(COMMON, createRng(seed), profile.byRole.lead);
      expect(slots.reduce((sum, slot) => sum + slot.duration.ticks, 0)).toBe(
        COMMON.ticksPerMeasure,
      );

      let run = 0;
      for (const slot of slots) {
        if (slot.duration.isTuplet) {
          run += 1;
          continue;
        }
        expect(run % 3).toBe(0);
        run = 0;
      }
      expect(run % 3).toBe(0);
      seen += slots.filter((slot) => slot.duration.isTuplet).length;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('keeps a whole group inside one beat', () => {
    if (profile === undefined) {
      throw new Error('expected the triplets profile');
    }
    for (let seed = 0; seed < 40; seed += 1) {
      const slots = fillMeasure(COMMON, createRng(seed), profile.byRole.lead);
      for (const slot of slots) {
        if (!slot.duration.isTuplet) {
          continue;
        }
        // Every note of the group sits in the beat the group opened in, so a
        // triplet is read as "three to this beat" and never straddles two.
        const beat = Math.floor(slot.onsetTicks / COMMON.ticksPerBeat);
        const end = slot.onsetTicks + slot.duration.ticks;
        expect(Math.ceil(end / COMMON.ticksPerBeat) - 1).toBe(beat);
      }
    }
  });
});

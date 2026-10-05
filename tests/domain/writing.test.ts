import { describe, expect, it } from 'vitest';
import type { Writing } from '../../src/domain/generation/writing.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { DYNAMIC_LEVELS, type Exercise, type NoteEntry } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';

const RHYTHMS = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);

function page(
  seed: number,
  writing?: Writing,
  measures = 8,
  presetId = 'sequences',
  rhythm = 'flowing',
): Exercise {
  const preset = BUILT_IN_PRESETS.find((one) => one.id === presetId);
  if (preset === undefined) {
    throw new Error(`expected ${presetId}`);
  }
  return preset.generator.generate({
    measures,
    timeSignature: new TimeSignature(4, 4),
    key: KeySignature.major(0),
    tempoBpm: 80,
    rhythm: RHYTHMS.get(rhythm),
    seed,
    ...(writing === undefined ? {} : { writing }),
  });
}

/** Every note of a staff, with where it starts in its bar. */
function notesOf(exercise: Exercise, staff = 0): { note: NoteEntry; offset: number; bar: number }[] {
  return (exercise.staves[staff]?.measures ?? []).flatMap((measure, bar) => {
    let offset = 0;
    return measure.entries.flatMap((entry) => {
      const at = offset;
      offset += entry.duration.ticks;
      return entry.kind === 'note' ? [{ note: entry, offset: at, bar }] : [];
    });
  });
}

const SEEDS = Array.from({ length: 30 }, (_, seed) => seed);

describe('what a page is written with', () => {
  it('writes the same notes with nothing asked as with no writing at all', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      expect(page(seed, {})).toEqual(page(seed));
    }
  });

  it('leaves the notes alone for marks, and keeps the same seed the same page', () => {
    const marks: Writing = { staccato: true, accents: true, tenuto: true, dynamics: ['p', 'f'], hairpins: true };
    for (const seed of SEEDS.slice(0, 5)) {
      const marked = page(seed, marks);
      const plain = page(seed);
      const pitches = (exercise: Exercise) =>
        exercise.staves.map((staff) => notesOf(exercise, exercise.staves.indexOf(staff)).map(({ note }) => note.pitches.map(String).join('+')));
      expect(pitches(marked)).toEqual(pitches(plain));
      expect(page(seed, marks)).toEqual(marked);
    }
  });

  it('leans a chromatic note into the next by a half step, now and then, never two in a row', () => {
    const key = KeySignature.major(0);
    let leaning = 0;
    for (const seed of SEEDS) {
      for (const staff of [0, 1]) {
        const line = notesOf(page(seed, { chromatic: true }), staff).filter(({ note }) => note.pitches.length === 1);
        line.forEach(({ note }, at) => {
          const pitch = note.pitches[0];
          if (pitch === undefined || pitch.alter === key.alterationFor(pitch.step)) {
            return;
          }
          leaning += 1;
          const next = line[at + 1]?.note.pitches[0];
          expect(next).toBeDefined();
          // One staff position on, a half step away.
          expect(Math.abs((next?.diatonicIndex ?? 0) - pitch.diatonicIndex)).toBe(1);
          expect(Math.abs((next?.midi ?? 0) - pitch.midi)).toBe(1);
          expect(next?.alter).toBe(key.alterationFor(next?.step ?? 'C'));
          expect(note.tiedForward).toEqual([]);
        });
      }
    }
    expect(leaning).toBeGreaterThan(5);
    // Never past one sharp or one flat: falling a tone from E flat would be
    // E double flat, and a minor's raised sixth rising would be a double sharp.
    for (const key of [KeySignature.major(-3), KeySignature.minor(0)]) {
      const preset = BUILT_IN_PRESETS.find((one) => one.id === 'sequences');
      for (const seed of SEEDS) {
        const exercise = preset?.generator.generate({
          measures: 8,
          timeSignature: new TimeSignature(4, 4),
          key,
          tempoBpm: 80,
          rhythm: RHYTHMS.get('flowing'),
          seed,
          writing: { chromatic: true },
        });
        const alters = (exercise?.staves ?? []).flatMap((staff) =>
          staff.measures.flatMap((measure) =>
            measure.entries.flatMap((entry) => (entry.kind === 'note' ? entry.pitches.map((pitch) => pitch.alter) : [])),
          ),
        );
        expect(alters.every((alter) => Math.abs(alter) <= 1)).toBe(true);
      }
    }
    // And none without being asked for.
    for (const seed of SEEDS.slice(0, 10)) {
      const plain = notesOf(page(seed)).flatMap(({ note }) => note.pitches);
      expect(plain.every((pitch) => pitch.alter === key.alterationFor(pitch.step))).toBe(true);
    }
  });

  it('marks a dot on short notes, an accent on a downbeat and a tenuto on a long note, one to a note', () => {
    let dots = 0;
    let accents = 0;
    let tenuti = 0;
    for (const seed of SEEDS) {
      const exercise = page(seed, { staccato: true, accents: true, tenuto: true }, 8, 'figures');
      for (const staff of [0, 1]) {
        for (const { note, offset } of notesOf(exercise, staff)) {
          const marks = [note.staccato, note.accent, note.tenuto].filter(Boolean).length;
          expect(marks).toBeLessThanOrEqual(1);
          if (note.staccato) {
            dots += 1;
            expect(note.duration.ticks).toBeLessThan(Duration.HALF.ticks);
          }
          if (note.accent) {
            accents += 1;
            expect(offset).toBe(0);
          }
          if (note.tenuto) {
            tenuti += 1;
            expect(note.duration.ticks).toBeGreaterThanOrEqual(Duration.HALF.ticks);
          }
          if (marks > 0) {
            expect(note.tiedForward).toEqual([]);
          }
        }
      }
    }
    expect([dots > 0, accents > 0, tenuti > 0]).toEqual([true, true, true]);
    // Never on a tie: a note held on is not struck again, and one held over
    // is one press with the note it is held into.
    let ties = 0;
    for (const seed of SEEDS) {
      const held = page(seed, { staccato: true, accents: true, tenuto: true }, 8, 'sequences', 'syncopated');
      for (const staff of [0, 1]) {
        const line = notesOf(held, staff);
        line.forEach(({ note }, at) => {
          const fromTheLast = (line[at - 1]?.note.tiedForward.length ?? 0) > 0;
          if (note.tiedForward.length > 0 || fromTheLast) {
            ties += 1;
            expect([note.staccato, note.accent, note.tenuto]).toEqual([false, false, false]);
          }
        });
      }
    }
    expect(ties).toBeGreaterThan(0);
    // Only what is asked: dots alone write no accents.
    const dotted = SEEDS.flatMap((seed) => notesOf(page(seed, { staccato: true })));
    expect(dotted.some(({ note }) => note.accent || note.tenuto)).toBe(false);
  });

  it('marks a level at the start and, from four bars, another halfway reached by a hairpin', () => {
    const levels = ['p', 'mf', 'f'] as const;
    for (const seed of SEEDS.slice(0, 12)) {
      const exercise = page(seed, { dynamics: levels, hairpins: true });
      const [opening, halfway] = exercise.dynamicMarks;
      expect(exercise.dynamicMarks).toHaveLength(2);
      expect(levels).toContain(opening?.level);
      expect(halfway?.measureIndex).toBe(4);
      expect(halfway?.level).not.toBe(opening?.level);
      const [hairpin] = exercise.hairpins;
      expect(hairpin).toMatchObject({ measureIndex: 3, untilMeasureIndex: 4, untilOffsetTicks: 0 });
      const louder =
        DYNAMIC_LEVELS.indexOf(halfway?.level ?? 'n') > DYNAMIC_LEVELS.indexOf(opening?.level ?? 'n');
      expect(hairpin?.kind).toBe(louder ? 'crescendo' : 'diminuendo');
    }
    // No hairpins unless asked, one level only on a short page, none unasked.
    expect(page(1, { dynamics: levels }).hairpins).toEqual([]);
    expect(page(1, { dynamics: levels, hairpins: true }, 3).dynamicMarks).toHaveLength(1);
    expect(page(1, { dynamics: ['f'] }).dynamicMarks).toHaveLength(1);
    expect(page(1).dynamicMarks).toEqual([]);
  });

  it('slows the last bar beat by beat and says rit. over it', () => {
    const exercise = page(2, { slowingAtTheEnd: true }, 4);
    expect(exercise.tempoWords).toEqual([{ measureIndex: 3, offsetTicks: 0, text: 'rit.', kind: 'ritardando' }]);
    const beat = new TimeSignature(4, 4).ticksPerPulse;
    expect(exercise.tempoChanges.map((change) => [change.measureIndex, change.offsetTicks, change.tempoBpm])).toEqual([
      [3, beat, 72],
      [3, 2 * beat, 64],
      [3, 3 * beat, 56],
    ]);
    // Worked out, so never printed as numbers.
    expect(exercise.tempoChanges.every((change) => change.implied === true)).toBe(true);
  });

  it('puts a pause over the last notes, and holds them for it', () => {
    const exercise = page(3, { pauses: true }, 4, 'five-finger-c');
    for (const staff of exercise.staves) {
      const last = staff.measures.at(-1)?.entries.at(-1);
      if (last?.kind === 'note') {
        expect(last.fermata).toBe(true);
      }
    }
    expect(exercise.staves.some((staff) => staff.measures.at(-1)?.entries.at(-1)?.kind === 'note')).toBe(true);
    // Held as a slower stretch, the way a pause in a score is.
    expect(exercise.tempoChanges.some((change) => change.tempoBpm < 80)).toBe(true);
    // No other note is paused over.
    const paused = exercise.staves.flatMap((staff) =>
      staff.measures.flatMap((measure) => measure.entries.filter((entry) => entry.kind === 'note' && entry.fermata)),
    );
    expect(paused.length).toBeLessThanOrEqual(2);
  });
});

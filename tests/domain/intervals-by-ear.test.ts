import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import { validateExercise, type Exercise } from '../../src/domain/model/Exercise.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { INTERVALS, INTERVAL_WAYS, QUESTIONS_IN_A_ROUND, theIntervalsByEar, theIntervalsNamed, theIntervalsNamedByEar } from '../../src/domain/solfege/intervalsByEar.js';

/** Each bar's given note and its answer, as pitches. */
function questions(exercise: Exercise): { readonly given: Pitch; readonly answer: readonly Pitch[]; readonly lengths: readonly number[] }[] {
  return (exercise.staves[0]?.measures ?? []).map((measure) => {
    const [given, answer] = measure.entries;
    return {
      given: given?.kind === 'note' ? (given.pitches[0] ?? Pitch.parse('C4')) : Pitch.parse('C4'),
      answer: answer?.kind === 'note' ? answer.pitches : [],
      lengths: measure.entries.map((entry) => entry.duration.ticks),
    };
  });
}

const SEEDS = Array.from({ length: 60 }, (_, seed) => seed + 1);

describe('intervals by ear', () => {
  it('is a valid round of ten bars, played by ear, the same for the same seed and another for another', () => {
    for (const way of INTERVAL_WAYS) {
      for (const seed of SEEDS) {
        const round = theIntervalsByEar({ semitones: [3, 4, 7], way, seed });
        expect(() => {
          validateExercise(round);
        }).not.toThrow();
        // A question a bar, the key not heard first: an interval is heard from its own note.
        expect([round.playedBack, round.staves[0]?.measures.length]).toEqual([
          { questions: Array.from({ length: QUESTIONS_IN_A_ROUND }, (_, at) => ({ from: at, until: at + 1 })), heard: true, keyFirst: false, inTime: false },
          QUESTIONS_IN_A_ROUND,
        ]);
        expect(theIntervalsByEar({ semitones: [3, 4, 7], way, seed })).toEqual(round);
      }
    }
    const notes = (seed: number): string[] => questions(theIntervalsByEar({ semitones: [3, 4, 7], way: 'up', seed })).map((each) => each.given.toString());
    expect(notes(1)).not.toEqual(notes(2));
  });

  it('asks only the intervals chosen, each the way chosen, spelled over as many letters as it spans, between the A under middle C and the A two octaves up', () => {
    const asked = [1, 6, 9, 12];
    const heard = new Set<number>();
    for (const way of INTERVAL_WAYS) {
      for (const seed of SEEDS) {
        for (const { given, answer, lengths } of questions(theIntervalsByEar({ semitones: asked, way, seed }))) {
          expect(lengths).toEqual([Duration.HALF.ticks, Duration.HALF.ticks]);
          const other = answer.at(-1) ?? given;
          // Heard together, the bar is the note and then the two of them.
          expect(answer.map((pitch) => pitch.toString())).toEqual(way === 'together' ? [given.toString(), other.toString()] : [other.toString()]);
          const span = other.midi - given.midi;
          expect(way === 'down' ? span < 0 : span > 0).toBe(true);
          const interval = INTERVALS.find((each) => each.semitones === Math.abs(span));
          expect(asked).toContain(interval?.semitones);
          heard.add(Math.abs(span));
          expect(Math.abs(other.diatonicIndex - given.diatonicIndex)).toBe(interval?.letters);
          for (const pitch of [given, other]) {
            expect(pitch.midi).toBeGreaterThanOrEqual(Pitch.parse('A3').midi);
            expect(pitch.midi).toBeLessThanOrEqual(Pitch.parse('A5').midi);
          }
        }
      }
    }
    // Every one asked comes up.
    expect([...heard].sort((one, other) => one - other)).toEqual(asked);
  });

  it('gives its notes with flats as well as sharps, and asks any interval where none is chosen', () => {
    const given = SEEDS.flatMap((seed) => questions(theIntervalsByEar({ semitones: [7], way: 'up', seed })).map((each) => each.given.alter));
    expect(given).toContain(1);
    expect(given).toContain(-1);
    const spans = new Set(
      SEEDS.flatMap((seed) => questions(theIntervalsByEar({ semitones: [], way: 'up', seed })).map((each) => (each.answer[0]?.midi ?? 0) - each.given.midi)),
    );
    expect(spans.size).toBe(INTERVALS.length);
  });
});

describe('intervals by name', () => {
  it('asks the bars a round by ear plays which of the intervals chosen each is, read and not heard', () => {
    for (const way of INTERVAL_WAYS) {
      for (const seed of SEEDS.slice(0, 20)) {
        const asked = { semitones: [12, 3, 7], way, seed };
        const named = theIntervalsNamed(asked);
        expect([named.title, named.playedBack, named.staves]).toEqual(['Intervals by name', undefined, theIntervalsByEar(asked).staves]);
        expect(named.byName?.map((question) => question.measureIndex)).toEqual(Array.from({ length: QUESTIONS_IN_A_ROUND }, (_, at) => at));
        questions(named).forEach(({ given, answer }, at) => {
          const span = Math.abs((answer.at(-1)?.midi ?? 0) - given.midi);
          const part = named.byName?.[at]?.parts[0];
          expect([named.byName?.[at]?.parts.length, part?.asks, part?.choices, part?.answer]).toEqual([
            1,
            'Interval',
            ['m3', 'P5', 'P8'],
            INTERVALS.find((each) => each.semitones === span)?.short,
          ]);
          // Heard as its answer, it is its bar as written; as another, the
          // note given and then the one that far from it, the way the bar goes.
          expect(part?.heardAs?.[part.answer]).toEqual([[given.midi], answer.map((pitch) => pitch.midi)]);
          for (const choice of part?.choices ?? []) {
            const other = given.midi + (way === 'down' ? -1 : 1) * (INTERVALS.find((each) => each.short === choice)?.semitones ?? 0);
            expect(part?.heardAs?.[choice]).toEqual([[given.midi], way === 'together' ? [given.midi, other] : [other]]);
          }
        });
      }
    }
    // Heard rather than read: the same round, named by ear, filed apart.
    for (const way of INTERVAL_WAYS) {
      const asked = { semitones: [12, 3, 7], way, seed: 5 };
      const read = theIntervalsNamed(asked);
      const heard = theIntervalsNamedByEar(asked);
      expect(() => {
        validateExercise(heard);
      }).not.toThrow();
      expect([heard.title, heard.namedByEar, read.namedByEar, heard.staves, heard.byName, heard.metadata.generatorId === read.metadata.generatorId]).toEqual([
        'Intervals named by ear',
        true,
        undefined,
        read.staves,
        read.byName,
        false,
      ]);
    }
    // Every one offered where none is chosen.
    expect(theIntervalsNamed({ semitones: [], way: 'up', seed: 1 }).byName?.[0]?.parts[0]?.choices).toEqual(INTERVALS.map((each) => each.short));
  });
});

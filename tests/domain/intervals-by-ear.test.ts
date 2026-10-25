import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import { measureOf, noteEntry, restEntry, validateExercise, type Exercise } from '../../src/domain/model/Exercise.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { INTERVALS, INTERVAL_WAYS, QUESTIONS_IN_A_ROUND, theIntervalsByEar, theStepsByEar } from '../../src/domain/solfege/intervalsByEar.js';

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
        expect([round.byEar, round.staves[0]?.measures.length]).toEqual([true, QUESTIONS_IN_A_ROUND]);
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

  it('gives the first step of a bar a key is asked at and finds every one after it, and none of music that is read', () => {
    const round = theIntervalsByEar({ semitones: [4], way: 'together', seed: 5 });
    expect(theStepsByEar(buildTimeline(round))).toEqual({
      given: Array.from({ length: QUESTIONS_IN_A_ROUND }, (_, bar) => bar * 2),
      found: Array.from({ length: QUESTIONS_IN_A_ROUND }, (_, bar) => bar * 2 + 1),
    });
    expect(theStepsByEar(buildTimeline({ ...round, byEar: false }))).toEqual({ given: [], found: [] });
    // A bar that opens on a rest gives the note after it.
    const resting = {
      ...round,
      staves: [
        {
          staffNumber: 1,
          voice: 1,
          clef: 'treble' as const,
          clefChanges: [],
          measures: [
            measureOf([
              restEntry(Duration.QUARTER),
              noteEntry(Pitch.parse('C4'), Duration.QUARTER),
              noteEntry(Pitch.parse('E4'), Duration.QUARTER),
              noteEntry(Pitch.parse('G4'), Duration.QUARTER),
            ]),
          ],
        },
      ],
    };
    expect(theStepsByEar(buildTimeline(resting))).toEqual({ given: [1], found: [2, 3] });
    // A bar of one note gives it and asks nothing.
    const alone = {
      ...resting,
      staves: [{ staffNumber: 1, voice: 1, clef: 'treble' as const, clefChanges: [], measures: [measureOf([noteEntry(Pitch.parse('C4'), Duration.WHOLE)])] }],
    };
    expect(theStepsByEar(buildTimeline(alone))).toEqual({ given: [], found: [] });
  });
});

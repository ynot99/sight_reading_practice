import type { ExerciseTimeline } from '../timeline/Timeline.js';

/** A question of music played back by ear: the step it is given at, and the steps found after it. */
export interface QuestionByEar {
  readonly given: number;
  readonly found: readonly number[];
}

/**
 * How music played back by ear is asked, question by question: in each, the
 * first step a key is asked at is given - the question is heard from there -
 * and every step after it that asks a key is found. A question of one note
 * gives it and asks nothing, so it is none. None at all for music that is
 * read.
 */
export function theQuestionsByEar(timeline: ExerciseTimeline): readonly QuestionByEar[] {
  const byEar = timeline.exercise.byEar;
  if (byEar === undefined) {
    return [];
  }
  const beginsAt = [...byEar.questionsAt].sort((one, other) => one - other);
  const questionOf = (measureIndex: number): number => beginsAt.filter((bar) => bar <= measureIndex).length - 1;
  const asked = new Map<number, number[]>();
  for (const step of timeline.steps) {
    const question = questionOf(step.measureIndex);
    if (step.expectedMidi.length === 0 || question < 0) {
      continue;
    }
    asked.set(question, [...(asked.get(question) ?? []), step.index]);
  }
  return [...asked.values()].flatMap(([given, ...found]) => (given === undefined || found.length === 0 ? [] : [{ given, found }]));
}

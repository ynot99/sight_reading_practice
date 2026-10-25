import type { ExerciseTimeline } from '../timeline/Timeline.js';

/** A question of music played back: the step it is given at, and the steps found after it. */
export interface QuestionPlayedBack {
  readonly given: number;
  readonly found: readonly number[];
}

/**
 * How music played back is asked, question by question: in each, the first
 * step a key is asked at is given - the question is heard, or read, from
 * there - and every step after it that asks a key is found. A question of
 * one note gives it and asks nothing, so it is none; a bar in no question
 * is played as it is written. None at all for music that is read.
 */
export function theQuestionsPlayedBack(timeline: ExerciseTimeline): readonly QuestionPlayedBack[] {
  const playedBack = timeline.exercise.playedBack;
  if (playedBack === undefined) {
    return [];
  }
  return playedBack.questions.flatMap(({ from, until }) => {
    const [given, ...found] = timeline.steps
      .filter((step) => step.measureIndex >= from && step.measureIndex < until && step.expectedMidi.length > 0)
      .map((step) => step.index);
    return given === undefined || found.length === 0 ? [] : [{ given, found }];
  });
}

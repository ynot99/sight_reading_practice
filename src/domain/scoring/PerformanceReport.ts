/** Outcome of a single timeline step. */
export type StepStatus =
  /** Every expected pitch was played, with no wrong notes. */
  | 'correct'
  /** Expected pitches were played, but wrong notes were mixed in. */
  | 'incorrect'
  /** The step's time elapsed before the expected pitches were complete. */
  | 'missed'
  /** A rest position: nothing was expected. */
  | 'skipped';

export interface StepResult {
  readonly index: number;
  readonly status: StepStatus;
  readonly measureIndex: number;
  readonly beat: number;
  readonly expected: readonly number[];
  readonly played: readonly number[];
  readonly wrong: readonly number[];
  readonly missing: readonly number[];
  /**
   * Signed distance between the step's scheduled onset and the first press,
   * in milliseconds. Negative is early. `null` when nothing was played.
   */
  readonly deviationMs: number | null;
}

export interface PerformanceTotals {
  readonly steps: number;
  /**
   * Playable steps the exercise contains, reached or not.
   *
   * Without it an abandoned run looks flawless: two steps played out of
   * sixteen still gives two correct steps out of two recorded. Anything that
   * grades how far the reader got needs the denominator to be the music, not
   * the attempt.
   */
  readonly playableSteps: number;
  readonly correct: number;
  readonly incorrect: number;
  readonly missed: number;
  readonly skipped: number;
  readonly expectedNotes: number;
  readonly correctNotes: number;
  readonly wrongNotes: number;
}

export interface PerformanceTiming {
  readonly deviations: readonly number[];
  readonly meanDeviationMs: number;
  readonly meanAbsoluteDeviationMs: number;
  readonly maxAbsoluteDeviationMs: number;
  /**
   * How widely the presses were scattered about their own average.
   *
   * The mean says whether the reader runs early or late; this says whether
   * they are *consistent*, and the two answer different questions. A steady
   * hand ten milliseconds behind the beat is a habit to correct and shows as
   * a large mean with a small spread. The same average reached by landing
   * wildly either side is a precision problem - and if it appears only on the
   * tablet, it is not the reader at all but the path the notes travelled.
   */
  readonly deviationSpreadMs: number;
}

/**
 * Everything measurable about one run through an exercise.
 *
 * Scoring strategies consume this and nothing else, which keeps grading
 * policy out of the session and makes new policies trivial to add.
 */
export interface PerformanceReport {
  readonly exerciseId: string;
  readonly modeId: string;
  readonly tempoBpm: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly completed: boolean;
  readonly steps: readonly StepResult[];
  readonly totals: PerformanceTotals;
  readonly timing: PerformanceTiming;
}

export interface PerformanceReportInput {
  /** Playable steps in the exercise, whether or not they were reached. */
  readonly playableSteps: number;
  readonly exerciseId: string;
  readonly modeId: string;
  readonly tempoBpm: number;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  readonly completed: boolean;
  readonly steps: readonly StepResult[];
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Aggregates step results into the report scoring strategies consume. */
export function buildPerformanceReport(input: PerformanceReportInput): PerformanceReport {
  const totals: PerformanceTotals = {
    steps: input.steps.length,
    playableSteps: input.playableSteps,
    correct: input.steps.filter((step) => step.status === 'correct').length,
    incorrect: input.steps.filter((step) => step.status === 'incorrect').length,
    missed: input.steps.filter((step) => step.status === 'missed').length,
    skipped: input.steps.filter((step) => step.status === 'skipped').length,
    expectedNotes: input.steps.reduce((sum, step) => sum + step.expected.length, 0),
    correctNotes: input.steps.reduce(
      (sum, step) => sum + (step.expected.length - step.missing.length),
      0,
    ),
    wrongNotes: input.steps.reduce((sum, step) => sum + step.wrong.length, 0),
  };

  const deviations = input.steps
    .map((step) => step.deviationMs)
    .filter((deviation): deviation is number => deviation !== null);
  const absolute = deviations.map(Math.abs);
  const centre = mean(deviations);
  const spread =
    deviations.length < 2
      ? 0
      : Math.sqrt(mean(deviations.map((value) => (value - centre) ** 2)));

  return {
    exerciseId: input.exerciseId,
    modeId: input.modeId,
    tempoBpm: input.tempoBpm,
    startedAtMs: input.startedAtMs,
    endedAtMs: input.endedAtMs,
    completed: input.completed,
    steps: input.steps,
    totals,
    timing: {
      deviations,
      meanDeviationMs: centre,
      meanAbsoluteDeviationMs: mean(absolute),
      maxAbsoluteDeviationMs: absolute.length === 0 ? 0 : Math.max(...absolute),
      deviationSpreadMs: spread,
    },
  };
}

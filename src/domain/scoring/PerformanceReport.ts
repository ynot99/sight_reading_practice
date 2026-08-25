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
      meanDeviationMs: mean(deviations),
      meanAbsoluteDeviationMs: mean(absolute),
      maxAbsoluteDeviationMs: absolute.length === 0 ? 0 : Math.max(...absolute),
    },
  };
}

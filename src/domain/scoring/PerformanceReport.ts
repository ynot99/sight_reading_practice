import type { NoteHit, NoteTier } from './noteTiers.js';

/** Outcome of a single timeline step. */
export type StepStatus =
  /** Every expected pitch was played, with no wrong notes. */
  | 'correct'
  /** Expected pitches were played, but something counted against the step. */
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
  /**
   * The notes of the step that were played, each once, and how well.
   *
   * A note played a step late is here too, given to the step it belonged
   * to: the page draws it on that note, and a note drawn as played and
   * counted as missed is the page and the numbers disagreeing.
   */
  readonly hits: readonly NoteHit[];
  /**
   * The presses that counted against this step.
   *
   * Keys not printed here, and a key of it struck again once it had already
   * been played - on a piano every press is heard, so an extra one is an
   * extra note whatever key it is.
   */
  readonly wrong: readonly number[];
  readonly missing: readonly number[];
  /**
   * Signed distance between the step's scheduled onset and the first press,
   * in milliseconds. Negative is early. `null` when nothing was played.
   *
   * When the step was *entered*, which is what a run that waits reads its
   * reader's pace from. How well each note was timed is in {@link hits}.
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
  /** Notes played, of those expected: {@link perfectNotes} and {@link goodNotes} together. */
  readonly correctNotes: number;
  /** Notes played in their window; see `noteTiers`. */
  readonly perfectNotes: number;
  /** Notes played outside it - the right key, off its moment. */
  readonly goodNotes: number;
  readonly wrongNotes: number;
  /**
   * Bar lines the run stopped at because the reader had not arrived.
   *
   * Nought in every mode but the one with a gate at the bar line, where it is
   * the whole of what the reader wants to know: not how many notes were right
   * but how many times the music had to wait. It is the measure of when to
   * leave that mode for Flow - the gate stops catching you before the notes
   * stop being wrong.
   */
  readonly barsWaitedFor: number;
}

export interface PerformanceTiming {
  /**
   * How far from its moment every note played landed, in the order of the
   * music: each note of a chord, and a note played a step late at its own
   * lateness. Empty where the run keeps no time.
   */
  readonly deviations: readonly number[];
  /** Whether each of {@link deviations} was Perfect or Good, in the same order. */
  readonly tiers: readonly NoteTier[];
  /**
   * The Perfect window of a typical note of the run: the middle one of the
   * windows its notes were judged in, which differ with the tempo and with
   * how close the notes stand. `null` where the run keeps no time.
   */
  readonly perfectMs: number | null;
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
  /**
   * Bars whose opening the run stopped and waited at, in reading order.
   *
   * Empty in every mode but the one with a gate at the bar line. The count
   * alone says how ready the reader is; this says *where* - which is the
   * question that gets answered by looking rather than by reading.
   */
  readonly waitedAtBars: readonly number[];
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
  /** @see PerformanceReport.waitedAtBars */
  readonly waitedAtBars?: readonly number[];
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The middle one, or the mean of the middle two; `null` of none. */
function middleOf(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[half] ?? 0)
    : ((sorted[half - 1] ?? 0) + (sorted[half] ?? 0)) / 2;
}

function hitsOf(steps: readonly StepResult[], tier: NoteHit['tier']): number {
  return steps.reduce((sum, step) => sum + step.hits.filter((hit) => hit.tier === tier).length, 0);
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
    correctNotes: input.steps.reduce((sum, step) => sum + step.hits.length, 0),
    perfectNotes: hitsOf(input.steps, 'perfect'),
    goodNotes: hitsOf(input.steps, 'good'),
    wrongNotes: input.steps.reduce((sum, step) => sum + step.wrong.length, 0),
    barsWaitedFor: input.waitedAtBars?.length ?? 0,
  };

  const timed = input.steps
    .flatMap((step) => step.hits)
    .filter((hit): hit is NoteHit & { readonly deviationMs: number } => hit.deviationMs !== null);
  const deviations = timed.map((hit) => hit.deviationMs);
  const windows = timed.flatMap((hit) => (hit.windowMs === undefined ? [] : [hit.windowMs]));
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
    waitedAtBars: [...(input.waitedAtBars ?? [])],
    steps: input.steps,
    totals,
    timing: {
      deviations,
      tiers: timed.map((hit) => hit.tier),
      perfectMs: middleOf(windows),
      meanDeviationMs: centre,
      meanAbsoluteDeviationMs: mean(absolute),
      maxAbsoluteDeviationMs: absolute.length === 0 ? 0 : Math.max(...absolute),
      deviationSpreadMs: spread,
    },
  };
}

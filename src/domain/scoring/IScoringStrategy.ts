import type { PerformanceReport } from './PerformanceReport.js';

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface SessionScore {
  /** Share of expected notes played correctly, after error penalties. `0..1` */
  readonly accuracy: number;
  /** Rhythmic precision. `1` is dead on the beat; `0..1`. */
  readonly timing: number;
  /** The strategy's combined verdict. `0..1` */
  readonly overall: number;
  readonly grade: Grade;
  /** Strategy-specific numbers worth showing in the UI. */
  readonly details: Readonly<Record<string, number>>;
}

/**
 * Grading policy.
 *
 * Wait mode cares about accuracy, Flow mode also cares about timing, and a
 * future exam mode may weight sight-reading fluency differently again - all
 * without the session knowing how a score is computed.
 */
export interface IScoringStrategy {
  readonly id: string;
  readonly label: string;
  score(report: PerformanceReport): SessionScore;
}

const GRADE_THRESHOLDS: readonly (readonly [number, Grade])[] = [
  [0.95, 'A'],
  [0.85, 'B'],
  [0.7, 'C'],
  [0.5, 'D'],
];

export function gradeFor(overall: number): Grade {
  for (const [threshold, grade] of GRADE_THRESHOLDS) {
    if (overall >= threshold) {
      return grade;
    }
  }
  return 'F';
}

import type { PerformanceReport } from './PerformanceReport.js';

export interface Passage {
  /** One-based and inclusive, as a reader counts bars. */
  readonly fromBar: number;
  readonly toBar: number;
}

export interface TroubleOptions {
  /** How many bars the drill should cover. */
  readonly bars?: number;
}

const DEFAULT_BARS = 4;
/** A step the music took away is the failure; the rest are degrees of untidy. */
const MISSED = 4;
const WRONG_NOTE = 2;
const UNTIDY_STEP = 1;

/**
 * The stretch of bars a run went worst in, or `null` if none did.
 *
 * Timing is deliberately left out. A reader who is a little late throughout
 * would otherwise out-score one who fell apart in a single bar, and the second
 * is the one with something to practise - lateness is a matter for the tempo,
 * not for choosing where to work.
 *
 * Ties go to the earliest passage, because trouble usually starts before it
 * shows and the earlier reading is the one that caused it.
 */
export function worstPassage(report: PerformanceReport, options: TroubleOptions = {}): Passage | null {
  const width = Math.max(1, Math.trunc(options.bars ?? DEFAULT_BARS));
  const trouble = new Map<number, number>();
  let lastBar = 0;

  for (const step of report.steps) {
    lastBar = Math.max(lastBar, step.measureIndex);
    const cost =
      (step.status === 'missed' ? MISSED : 0) +
      (step.status === 'incorrect' ? UNTIDY_STEP : 0) +
      step.wrong.length * WRONG_NOTE;
    if (cost > 0) {
      trouble.set(step.measureIndex, (trouble.get(step.measureIndex) ?? 0) + cost);
    }
  }

  if (trouble.size === 0) {
    return null;
  }

  let bestStart = 0;
  let bestCost = -1;
  for (let start = 0; start <= Math.max(0, lastBar - width + 1); start += 1) {
    let cost = 0;
    for (let bar = start; bar < start + width; bar += 1) {
      cost += trouble.get(bar) ?? 0;
    }
    if (cost > bestCost) {
      bestCost = cost;
      bestStart = start;
    }
  }

  return { fromBar: bestStart + 1, toBar: Math.min(bestStart + width, lastBar + 1) };
}

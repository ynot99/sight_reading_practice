import type { PerformanceReport } from './PerformanceReport.js';

/** How a bar read: clean, something held against it, or never reached. */
export type BarState = 'clean' | 'wrong' | 'unread';

export interface BarCell {
  readonly label: string;
  readonly state: BarState;
  readonly waited: boolean;
}

/**
 * One cell per bar of the run, in reading order.
 *
 * His: "цифрами іноді мій мозок просто йде у loading, та не хочеться розуміти
 * що я зараз читаю". A row of numbers answers "how well"; this answers
 * "where", which is the question a reader actually has - and it answers it
 * without being read at all. Four clean bars and then a wall of red is a
 * sentence about the piece that no percentage can say.
 *
 * Two things at once, and deliberately not one: the colour is what was read
 * there, and the mark is where the music had to stop for you. A bar that
 * waited is very often also a bar with wrong notes in it, so a single colour
 * ranking one above the other would simply lose whichever came second.
 */
export function barCells(report: PerformanceReport, bars: number): readonly BarCell[] {
  const waited = new Set(report.waitedAtBars);
  return Array.from({ length: bars }, (_unused, measureIndex) => {
    const steps = report.steps.filter((step) => step.measureIndex === measureIndex);
    const wrong = steps.reduce((sum, step) => sum + step.wrong.length, 0);
    const missing = steps.reduce((sum, step) => sum + step.missing.length, 0);
    const said = [
      wrong > 0 ? `${wrong} wrong` : '',
      missing > 0 ? `${missing} missed` : '',
      waited.has(measureIndex) ? 'waited here' : '',
    ].filter((part) => part !== '');
    // The whole piece, not the part that was reached. A run abandoned in bar
    // three otherwise looks like a flawless piece three bars long, which is
    // the same lie `playableSteps` exists to stop the percentages telling.
    const state: BarState = steps.length === 0 ? 'unread' : wrong + missing === 0 ? 'clean' : 'wrong';
    const how = state === 'unread' ? 'not reached' : said.join(', ') || 'clean';
    return {
      label: `Bar ${measureIndex + 1} · ${how}`,
      state,
      waited: waited.has(measureIndex),
    };
  });
}

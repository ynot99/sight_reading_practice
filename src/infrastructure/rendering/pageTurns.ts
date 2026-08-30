import type { DrawnMeasure } from './passageBrackets.js';

/**
 * Cutting a continuously engraved score into pages that can be turned.
 *
 * The engraver lays a piece out as one tall column of systems, which is right
 * for scrolling and wrong for reading: a reader who is not playing wants to
 * turn a page, look at it, and turn the next one, and a reader who *is*
 * playing wants the page to turn itself once rather than to creep upwards
 * under the music.
 *
 * Nothing here re-engraves anything. The column stays exactly as it was and
 * the page is a window onto it - which is what keeps the cursor, the marks
 * and the passage markers all still true, since every one of them is measured
 * against that same column.
 *
 * All arithmetic, no DOM.
 */

/** The vertical band one system of the score occupies. */
export interface SystemBand {
  readonly top: number;
  readonly bottom: number;
}

/** A window onto the column, holding whole systems and nothing split. */
export interface ScorePage {
  readonly top: number;
  readonly bottom: number;
  /** How many systems are on it, which is what makes a page a page. */
  readonly systems: number;
}

/**
 * The distinct systems the bars were drawn on, in reading order.
 *
 * Bars on one line all carry that line's band, so the bands repeat; what is
 * wanted is one of each, top to bottom.
 */
export function systemsOf(measures: readonly DrawnMeasure[]): SystemBand[] {
  const bands: SystemBand[] = [];
  for (const measure of [...measures].sort((left, right) => left.top - right.top)) {
    const last = bands[bands.length - 1];
    if (last !== undefined && last.top === measure.top) {
      continue;
    }
    bands.push({ top: measure.top, bottom: measure.bottom });
  }
  return bands;
}

/**
 * As many whole systems as fit, and then a new page.
 *
 * Whole systems, always: a page that ended halfway down a stave would be
 * asking the reader to turn it mid-bar, which is the one thing a page turn
 * must never do. A system taller than the window gets a page to itself rather
 * than being split - it is the best that can be done, and it is what happens
 * when the reader has zoomed a long way in.
 *
 * The window is measured with no viewport, or none yet: with nothing to fit
 * things into there is one page and it holds the piece.
 */
export function pagesOf(
  systems: readonly SystemBand[],
  viewportHeight: number,
): ScorePage[] {
  if (systems.length === 0) {
    return [];
  }
  const first = systems[0];
  const last = systems[systems.length - 1];
  if (viewportHeight <= 0 && first !== undefined && last !== undefined) {
    return [{ top: first.top, bottom: last.bottom, systems: systems.length }];
  }

  const pages: ScorePage[] = [];
  let openedAt = 0;
  for (let at = 0; at < systems.length; at += 1) {
    const start = systems[openedAt];
    const system = systems[at];
    if (start === undefined || system === undefined) {
      continue;
    }
    if (at > openedAt && system.bottom - start.top > viewportHeight) {
      const before = systems[at - 1];
      pages.push({
        top: start.top,
        bottom: before?.bottom ?? system.top,
        systems: at - openedAt,
      });
      openedAt = at;
    }
  }
  const start = systems[openedAt];
  if (start !== undefined && last !== undefined) {
    pages.push({ top: start.top, bottom: last.bottom, systems: systems.length - openedAt });
  }
  return pages;
}

/**
 * The page a point of the column falls on.
 *
 * Nothing falls outside: a point above the first page belongs to the first
 * and one below the last belongs to the last, because the caller is asking
 * "which page do I turn to", and there is always an answer to that.
 */
export function pageContaining(pages: readonly ScorePage[], y: number): number {
  if (pages.length === 0) {
    return 0;
  }
  for (const [at, page] of pages.entries()) {
    if (y <= page.bottom) {
      return at;
    }
  }
  return pages.length - 1;
}

/**
 * How far down to scroll for a page, in the pixels the page is shown at.
 *
 * The engraving is measured in its own pixels and shown at whatever size the
 * screen gives it, so a page's top has to be scaled before it means anything
 * to a scrollbar. A small margin above, because a stave flush against the top
 * edge of a screen reads as a page that has been cut off.
 */
export function scrollTopFor(
  page: ScorePage | undefined,
  scale: number,
  marginPx = 8,
): number {
  if (page === undefined || !Number.isFinite(scale) || scale <= 0) {
    return 0;
  }
  return Math.max(0, page.top * scale - marginPx);
}

/**
 * Which way a finger went, once it has gone far enough to have meant it.
 *
 * A page turn and a scroll are the same gesture until one of them commits, so
 * a swipe has to be clearly sideways and clearly long: anything shorter is a
 * reader steadying the tablet, and anything more upright is them trying to
 * look at the staff below. Getting this wrong turns pages nobody asked to
 * turn, which is worse than a swipe that has to be repeated.
 */
export function swipeDirection(
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  minimumPx = 60,
): -1 | 0 | 1 {
  const across = to.x - from.x;
  const down = to.y - from.y;
  if (Math.abs(across) < minimumPx || Math.abs(across) < Math.abs(down) * 1.5) {
    return 0;
  }
  // Dragging the page leftwards brings the next one in from the right, which
  // is the way every reader has held a book.
  return across < 0 ? 1 : -1;
}

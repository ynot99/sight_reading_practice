import type { RungMark, RungOnThePage } from '../../application/ports/IScoreRenderer.js';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * What a page says about itself: which piece, and which page of it.
 *
 * Printed in the corner of the page rather than as a title over the first
 * system, which is where engraved music puts it: a title block costs vertical
 * room on the one page whose room is scarcest, while in the margin it costs
 * none - and being on every page it answers "what am I playing" on page seven,
 * which a printed title cannot do at all.
 */

/** How far the page's label sits from the corner of the page, in pixels. */
export const PAGE_LABEL_INSET = 18;

/**
 * How much of a title the corner of a page will take.
 *
 * Counted in characters rather than measured, because the text is an SVG
 * `<text>` and the one honest way to measure one is `getComputedTextLength`,
 * which the headless document this is tested in answers `0` to. A guess at
 * the width of a character would be a measurement in name only, so this is
 * openly a limit on length: past it a corner label has stopped being glanced
 * at and started being read, whatever it measures.
 */
const TITLE_LIMIT = 48;

/**
 * The line itself, or `''` where there is nothing to say.
 *
 * "Page 1 of 1" at a reader who never asked for pages is furniture, so the
 * count only speaks when there is more than one page. The title speaks
 * whenever the score has one - including in a single column, where it is
 * the whole of the line.
 */
export function pageLabelText(title: string, at: number, count: number): string {
  const pages = count < 2 ? '' : `Page ${String(at + 1)} of ${String(count)}`;
  return [shortened(title), pages].filter((part) => part !== '').join(' · ');
}

/** A ring at an end, a dot for a place between, and filled where the reader is. */
function glyphOf(mark: RungMark): string {
  return mark.here ? '\u25CF' : mark.rung ? '\u25CB' : '\u2022';
}

/**
 * The rung and its marks, to run on after the line a page says about itself.
 *
 * Spans of the same text and not a drawing of their own, so they follow the
 * title wherever it ends without anything measuring where that is.
 */
export function rungAfterTheTitle(doc: Document, rung: RungOnThePage): SVGElement {
  const span = (className: string, text: string): SVGElement => {
    const made = doc.createElementNS(SVG_NAMESPACE, 'tspan');
    made.setAttribute('class', className);
    made.textContent = text;
    return made;
  };
  const after = span('page-label__rung', ` \u00B7 ${rung.label} `);
  const marks = span('page-label__marks', '');
  for (const mark of rung.marks) {
    const kinds = [
      'page-label__mark',
      ...(mark.rung ? ['page-label__mark--rung'] : []),
      ...(mark.none ? ['page-label__mark--none'] : []),
      ...(mark.here ? ['page-label__mark--here'] : []),
    ];
    marks.append(span(kinds.join(' '), glyphOf(mark)));
  }
  after.append(marks);
  return after;
}

/**
 * A title cut to {@link TITLE_LIMIT}, with an ellipsis where it was cut.
 *
 * SVG text does not wrap, so a long one does not become two lines - it runs
 * off the side of the page and out of the drawing.
 */
function shortened(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= TITLE_LIMIT) {
    return trimmed;
  }
  return `${trimmed.slice(0, TITLE_LIMIT - 1).trimEnd()}…`;
}

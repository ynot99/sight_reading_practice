/**
 * The top of the next page, shown where the reader has finished reading: the
 * measurements its placing needs, whichever engraver drew the two pages.
 */

/** The one clip the preview needs; only ever one preview is on the page. */
export const PREVIEW_CLIP_ID = 'page-preview-clip';

/** The cut that leaves the previewed page its first system and nothing else. */
export const PREVIEW_SYSTEM_CLIP_ID = 'page-preview-system-clip';

/**
 * How much room the preview keeps above the highest ink it carries.
 *
 * Rather less than a staff space. Enough that a ledger line does not sit on
 * the very edge of the page, which reads as a line that has been cut rather
 * than one that ends.
 */
const PREVIEW_TOP_PAD = 8;

/**
 * What was actually drawn on a page, in the drawing's own units.
 *
 * `null` where nothing can measure it: jsdom has no layout engine and an
 * empty page has no box at all.
 */
export function boundingBoxOf(
  sheet: SVGGraphicsElement,
): { readonly y: number; readonly height: number } | null {
  if (typeof sheet.getBBox !== 'function') {
    return null;
  }
  try {
    const box = sheet.getBBox();
    return box.height > 0 ? { y: box.y, height: box.height } : null;
  } catch {
    return null;
  }
}

/**
 * Where the previewed page has to stand, as a transform for its clone.
 *
 * Three things decide it. It wants to stand where the finished system stood,
 * so the notes are where the reader last looked. It may not stand so high
 * that the ink above its staff - the ledger lines and the stems of the notes
 * on them - is cut off by the top of the page. And where even that leaves it
 * hanging past the line it stands on, it is drawn smaller rather than sliced:
 * a system with its bottom cut off says as little as one with its top cut
 * off, and the reader is looking at it precisely because it is hard.
 *
 * Without a box to ask - no layout engine, nothing drawn - the staff's own
 * top stands in for the ink, which is the honest floor: there is ink on the
 * staff lines whatever else the system carries.
 */
export function previewPlacement(
  moved: SVGGraphicsElement,
  slot: { readonly top: number },
  target: { readonly top: number; readonly bottom: number },
  bottom: number,
): string {
  const inkTop = boundingBoxOf(moved)?.y ?? target.top;
  const shift = Math.min(target.top - slot.top, inkTop - PREVIEW_TOP_PAD);
  const placedAt = inkTop - shift;
  const needs = target.bottom - inkTop;
  const room = bottom - placedAt;
  const scale = needs > room && needs > 0 && room > 0 ? room / needs : 1;
  return `translate(0, ${placedAt}) scale(${scale}) translate(0, ${-inkTop})`;
}

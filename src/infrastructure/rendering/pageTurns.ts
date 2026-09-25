/**
 * The two measurements a page turn still needs.
 *
 * The breaking itself belongs to the engraver: given a page size it lays the
 * music out as separate pages and draws each into an SVG of its own, so a
 * turn is showing one element and hiding the others. What was here before -
 * tiling systems, packing them into windows, working out how far to scroll -
 * was this project doing the engraver's job badly, and every attempt at it
 * had another edge case behind the last.
 *
 * What is left is a fact about the screen and a reading of a gesture.
 */

/**
 * How much of a frame the reader can actually see.
 *
 * Not the frame's own height. A score frame is given a minimum of one screen
 * and then grows to whatever is engraved in it, so on a long piece its height
 * *is* the length of the piece - and asked how tall the window was it
 * answered with the whole thing. Pages were then cut to the size of the
 * score, which is one page, and the little that was left over was the only
 * distance a turn could move: the pill counted pages while the music stayed
 * where it was.
 *
 * What the reader sees is the part of that frame inside the screen, which is
 * what this measures.
 */
export function visibleHeightOf(
  frame: { readonly top: number; readonly bottom: number },
  viewportHeight: number,
): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    return Math.max(0, frame.bottom - frame.top);
  }
  return Math.max(0, Math.min(frame.bottom, viewportHeight) - Math.max(frame.top, 0));
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

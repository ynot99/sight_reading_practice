/** What a walk of the engraver's cursor from the top needs of it. */
export interface WalkableCursor {
  reset(): void;
  next(): void;
  readonly iterator: { readonly EndReached: boolean };
}

/** What counting the places a piece has for something to begin needs of it. */
export interface CountableSheet {
  readonly SourceMeasures: readonly {
    readonly VerticalSourceStaffEntryContainers: readonly unknown[];
  }[];
}

/**
 * How many places in the piece anything begins at, which is as often as the
 * cursor can possibly stop: it stops only where something begins, never twice
 * in one place, and never at a place the piece does not have.
 */
export function placesToBeginIn(sheet: CountableSheet): number {
  return sheet.SourceMeasures.reduce(
    (count, measure) => count + measure.VerticalSourceStaffEntryContainers.length,
    0,
  );
}

/**
 * Walks the cursor from the top to the end of the piece, visiting every place
 * it stops, and says how many there were.
 *
 * Stopped after `places` - see {@link placesToBeginIn} - so that an engraver
 * whose cursor never reached its end could not hang the page. Read off the
 * piece, because a fixed number was once a limit on the *piece* instead: it
 * was ten thousand, and the longest score he owns has thirteen and a half
 * thousand steps. Every step after the ten-thousandth was never read, had no
 * page, and was taken to be on the first one - so a start set at bar a
 * thousand turned him back to page one, and a playback from there had the
 * marker turning the page back on every beat while the music turned it
 * forward again, until the tab hung.
 */
export function walkEveryPlace(
  cursor: WalkableCursor,
  places: number,
  visit: (index: number) => void,
): number {
  cursor.reset();
  let index = 0;
  while (!cursor.iterator.EndReached && index < places) {
    visit(index);
    index += 1;
    cursor.next();
  }
  return index;
}

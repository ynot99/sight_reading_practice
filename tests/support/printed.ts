/**
 * What a printed score says without drawing it, found in its text.
 *
 * `print-object="no"` is on more than notes - the part's name carries it, so
 * the engraver leaves it off the page - so a test asking whether a printing
 * holds notes nobody sees asks for exactly that: a `<note>` so marked,
 * whatever else its tag carries (a silence carries its name).
 */

/** One note the printing marks not to be drawn. */
export const UNSEEN_NOTE = /<note [^>]*print-object="no"[^>]*>/;

/** Every one of them, each to its closing tag. */
export const UNSEEN_NOTES = /<note [^>]*print-object="no"[^>]*>[\s\S]*?<\/note>/g;

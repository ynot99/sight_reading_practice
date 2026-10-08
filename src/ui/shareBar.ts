/** A piece of a share bar: what it is, what it is called, how much of it there is. */
export interface BarPiece {
  /** Which colour it takes, on the bar and beside its name alike. */
  readonly kind: string;
  readonly name: string;
  readonly amount: number;
  /** What the legend says of it beside its name: "12.0 MB · 98". */
  readonly said: string;
}

/**
 * Draws a bar of what a whole is made of, and a legend under it.
 *
 * Handed amounts, not shares: how much of the bar each piece takes is worked
 * out here, from the pieces together, so a caller cannot hand over shares
 * that do not add up to the bar. A piece of nothing has no place on the bar
 * and keeps its line in the legend. One too small to see is the stylesheet's
 * to keep a sliver of, since only the laid-out bar knows how wide a sliver is.
 */
export function drawTheShareBar(
  bar: HTMLElement,
  legend: HTMLElement,
  pieces: readonly BarPiece[],
): void {
  const doc = bar.ownerDocument;
  const whole = pieces.reduce((sum, piece) => sum + Math.max(0, piece.amount), 0);
  bar.replaceChildren(
    ...pieces
      .filter((piece) => piece.amount > 0)
      .map((piece) => {
        const part = doc.createElement('span');
        part.className = 'share-bar__part';
        part.dataset['kind'] = piece.kind;
        part.style.flexGrow = String(piece.amount / whole);
        part.title = `${piece.name}: ${piece.said}`;
        return part;
      }),
  );
  bar.setAttribute('aria-label', pieces.map((piece) => `${piece.name} ${piece.said}`).join(', '));
  legend.replaceChildren(
    ...pieces.map((piece) => {
      const item = doc.createElement('li');
      const dot = doc.createElement('span');
      dot.className = 'share-legend__dot';
      dot.dataset['kind'] = piece.kind;
      const name = doc.createElement('span');
      name.textContent = piece.name;
      const size = doc.createElement('span');
      size.className = 'share-legend__size';
      size.textContent = piece.said;
      item.append(dot, name, size);
      return item;
    }),
  );
}

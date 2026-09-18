/** One place the words searched for were found: a stretch of one text node. */
export interface Found {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
}

/**
 * The words a reader can see in the settings, pane by pane.
 *
 * Every pane's, and not only the one showing: the search is for what they
 * cannot find, which is usually in the pane they are not looking at. What is
 * hidden for good - a list with nothing in it yet, a control this device has
 * no use for - is left out, and so is the text of a closed list's options,
 * which no highlight could show.
 */
export function wordsIn(root: Element): Text[] {
  const texts: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const parent = text.parentElement;
    // Asked of what is inside the settings only: the sheet around them is
    // itself hidden while it is shut, and that hides nothing from a search.
    const leftOut = parent?.closest('option, select, script, style, [hidden]') ?? null;
    if (
      parent === null ||
      (text.nodeValue ?? '').trim() === '' ||
      (leftOut !== null && root.contains(leftOut))
    ) {
      continue;
    }
    texts.push(text);
  }
  return texts;
}

/**
 * Every place the words appear, in the order they are read.
 *
 * Case does not matter and the spaces at either end of what was typed do not
 * count: "Rhythm " and "rhythm" are the same question.
 */
export function findAll(texts: readonly Text[], query: string): Found[] {
  const wanted = query.trim().toLowerCase();
  if (wanted === '') {
    return [];
  }
  const found: Found[] = [];
  for (const node of texts) {
    const said = (node.nodeValue ?? '').toLowerCase();
    for (let at = said.indexOf(wanted); at >= 0; at = said.indexOf(wanted, at + wanted.length)) {
      found.push({ node, start: at, end: at + wanted.length });
    }
  }
  return found;
}

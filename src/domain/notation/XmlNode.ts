/**
 * A parsed XML element, stripped to what reading MusicXML needs.
 *
 * The domain may not touch the DOM, and it should not have to: everything the
 * importer asks of a document is "which children are called this" and "what
 * does this one say". Keeping that as a plain tree means the MusicXML rules
 * can be read, and tested, without a browser anywhere near them - the mirror
 * image of {@link XmlWriter} on the way out.
 */
export interface XmlNode {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
  /** Concatenated text directly inside this element. */
  readonly text: string;
}

export function xmlNode(
  name: string,
  attributes: Readonly<Record<string, string>> = {},
  children: readonly XmlNode[] = [],
  text = '',
): XmlNode {
  return { name, attributes, children, text };
}

/** First child with this name, or `null`. */
export function child(node: XmlNode | null, name: string): XmlNode | null {
  return node?.children.find((candidate) => candidate.name === name) ?? null;
}

/** Every child with this name, in document order. */
export function childrenNamed(node: XmlNode | null, name: string): readonly XmlNode[] {
  return node?.children.filter((candidate) => candidate.name === name) ?? [];
}

/** Trimmed text of the named child, or `null` when it is absent or empty. */
export function childText(node: XmlNode | null, name: string): string | null {
  const found = child(node, name);
  if (found === null) {
    return null;
  }
  const trimmed = found.text.trim();
  return trimmed === '' ? null : trimmed;
}

/** Numeric text of the named child, or `null` when absent or not a number. */
export function childNumber(node: XmlNode | null, name: string): number | null {
  const text = childText(node, name);
  if (text === null) {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Attribute value, or `null`. */
export function attribute(node: XmlNode | null, name: string): string | null {
  return node?.attributes[name] ?? null;
}

/** Whether a child with this name exists at all - `<dot/>`, `<chord/>`. */
export function hasChild(node: XmlNode | null, name: string): boolean {
  return child(node, name) !== null;
}

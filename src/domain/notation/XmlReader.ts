import { DomainError } from '../../shared/errors.js';
import type { XmlNode } from './XmlNode.js';

const NOT_XML = 'This file is not valid XML, so nothing could be read from it.';
const EMPTY = 'This file is empty.';

/** The five entities XML declares itself; a score declares none of its own. */
const PREDEFINED: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

const SLASH = 0x2f;
const QUESTION = 0x3f;
const BANG = 0x21;
const EQUALS = 0x3d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const GREATER_THAN = 0x3e;
const DOUBLE_QUOTE = 0x22;
const SINGLE_QUOTE = 0x27;

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

/** Text with its references read: the five entities and characters by number. */
function decoded(raw: string): string {
  if (!raw.includes('&')) {
    return raw;
  }
  return raw.replace(/&([^;&<]*);|&/g, (_whole, name: string | undefined) => {
    if (name === undefined) {
      throw new DomainError(NOT_XML);
    }
    const named = PREDEFINED[name];
    if (named !== undefined) {
      return named;
    }
    const number = /^#(?:x([0-9a-fA-F]+)|([0-9]+))$/.exec(name);
    const code = number === null ? NaN : Number.parseInt(number[1] ?? number[2] ?? '', number[1] === undefined ? 10 : 16);
    if (!Number.isInteger(code) || code < 1 || code > 0x10ffff) {
      throw new DomainError(NOT_XML);
    }
    return String.fromCodePoint(code);
  });
}

/** Where a run of text ends, refusing a document that stops before it does. */
function indexOrRefuse(text: string, wanted: string, from: number): number {
  const at = text.indexOf(wanted, from);
  if (at < 0) {
    throw new DomainError(NOT_XML);
  }
  return at;
}

/**
 * Where a start tag ends: at its first `>` outside quotes, since an attribute
 * may hold one.
 */
function endOfTag(text: string, from: number): number {
  let quote = 0;
  for (let at = from; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (quote !== 0) {
      if (code === quote) {
        quote = 0;
      }
    } else if (code === DOUBLE_QUOTE || code === SINGLE_QUOTE) {
      quote = code;
    } else if (code === GREATER_THAN) {
      return at;
    }
  }
  throw new DomainError(NOT_XML);
}

/**
 * The attributes written inside a start tag, between its name and its end.
 *
 * Each value has its tabs and line breaks read as spaces before its
 * references are read, as XML has it, so a character written by number
 * is the one character that survives as itself.
 */
function attributesIn(tag: string, from: number, to: number): Record<string, string> {
  const attributes: Record<string, string> = {};
  let at = from;
  for (;;) {
    while (at < to && isSpace(tag.charCodeAt(at))) {
      at += 1;
    }
    if (at >= to) {
      return attributes;
    }
    const nameStart = at;
    while (at < to && !isSpace(tag.charCodeAt(at)) && tag.charCodeAt(at) !== EQUALS) {
      at += 1;
    }
    const name = tag.slice(nameStart, at);
    while (at < to && isSpace(tag.charCodeAt(at))) {
      at += 1;
    }
    if (name === '' || tag.charCodeAt(at) !== EQUALS) {
      throw new DomainError(NOT_XML);
    }
    at += 1;
    while (at < to && isSpace(tag.charCodeAt(at))) {
      at += 1;
    }
    const quote = tag.charCodeAt(at);
    if (quote !== DOUBLE_QUOTE && quote !== SINGLE_QUOTE) {
      throw new DomainError(NOT_XML);
    }
    const close = tag.indexOf(String.fromCharCode(quote), at + 1);
    if (close < 0 || close >= to || name in attributes) {
      throw new DomainError(NOT_XML);
    }
    const value = tag.slice(at + 1, close);
    if (value.includes('<')) {
      throw new DomainError(NOT_XML);
    }
    attributes[name] = decoded(value.replace(/[\t\n]/g, ' '));
    at = close + 1;
    if (at < to && !isSpace(tag.charCodeAt(at))) {
      throw new DomainError(NOT_XML);
    }
  }
}

/**
 * Reads an XML document into the plain tree the MusicXML rules are read from.
 *
 * Written here rather than handed to the browser's parser, which is what it
 * was, because of what that cost on a long score: twelve million characters
 * of the Alkan took the browser 0.8 to 0.95 seconds to parse and another
 * half to three quarters of one to copy out of its document into this tree,
 * all of it holding the page still, and none of it possible off the page's
 * thread, where there is no parser. Read straight into the tree it is a
 * third of a second.
 *
 * What a score needs of XML and no more: elements and their attributes,
 * text, CDATA, and the five entities and characters by number. Comments,
 * processing instructions and the document type are passed over - nothing
 * in a score is said in them - and an entity a document declares for itself
 * is refused rather than guessed at, as is anything that is not well formed:
 * a tag never closed, or closed by another name.
 */
export function readXml(document: string): XmlNode {
  // Line ends are read as one character, as XML has it, before anything
  // else is: a carriage return is in no text and no attribute. A byte order
  // mark is space before the root, and passed over as space is.
  const text = document.replace(/\r\n?/g, '\n');
  const length = text.length;
  // Each open element's children are added to as they come, and its text
  // gathered in pieces and joined when it closes.
  const open: { name: string; attributes: Record<string, string>; children: XmlNode[]; pieces: string[] }[] = [];
  let root: XmlNode | null = null;
  let at = 0;

  const place = (node: XmlNode): void => {
    const parent = open.at(-1);
    if (parent !== undefined) {
      parent.children.push(node);
    } else if (root === null) {
      root = node;
    } else {
      throw new DomainError(NOT_XML);
    }
  };
  const textBetween = (from: number, to: number): void => {
    if (to <= from) {
      return;
    }
    const raw = text.slice(from, to);
    const parent = open.at(-1);
    if (parent !== undefined) {
      parent.pieces.push(decoded(raw));
    } else if (raw.trim() !== '') {
      // Outside the root element there may only be space.
      throw new DomainError(NOT_XML);
    }
  };

  while (at < length) {
    const less = text.indexOf('<', at);
    if (less < 0) {
      textBetween(at, length);
      break;
    }
    textBetween(at, less);
    const next = text.charCodeAt(less + 1);

    if (next === SLASH) {
      const end = indexOrRefuse(text, '>', less);
      const name = text.slice(less + 2, end).trimEnd();
      const closing = open.pop();
      if (closing === undefined || closing.name !== name) {
        throw new DomainError(NOT_XML);
      }
      place({
        name: closing.name,
        attributes: closing.attributes,
        children: closing.children,
        text: closing.pieces.length === 1 ? (closing.pieces[0] ?? '') : closing.pieces.join(''),
      });
      at = end + 1;
      continue;
    }

    if (next === QUESTION) {
      at = indexOrRefuse(text, '?>', less + 2) + 2;
      continue;
    }

    if (next === BANG) {
      if (text.startsWith('<!--', less)) {
        at = indexOrRefuse(text, '-->', less + 4) + 3;
        continue;
      }
      if (text.startsWith('<![CDATA[', less)) {
        const end = indexOrRefuse(text, ']]>', less + 9);
        const parent = open.at(-1);
        if (parent === undefined) {
          throw new DomainError(NOT_XML);
        }
        parent.pieces.push(text.slice(less + 9, end));
        at = end + 3;
        continue;
      }
      if (text.startsWith('<!DOCTYPE', less) && root === null && open.length === 0) {
        // Passed over whole, an internal subset in brackets and all. An
        // entity declared in there would be refused where it is used.
        let depth = 0;
        let end = less + 9;
        for (; end < length; end += 1) {
          const code = text.charCodeAt(end);
          if (code === OPEN_BRACKET) {
            depth += 1;
          } else if (code === CLOSE_BRACKET) {
            depth -= 1;
          } else if (code === GREATER_THAN && depth === 0) {
            break;
          }
        }
        if (end >= length) {
          throw new DomainError(NOT_XML);
        }
        at = end + 1;
        continue;
      }
      throw new DomainError(NOT_XML);
    }

    const end = endOfTag(text, less);
    const empty = text.charCodeAt(end - 1) === SLASH;
    const contentEnd = empty ? end - 1 : end;
    let nameEnd = less + 1;
    while (nameEnd < contentEnd && !isSpace(text.charCodeAt(nameEnd))) {
      nameEnd += 1;
    }
    const name = text.slice(less + 1, nameEnd);
    if (name === '' || name.includes('<')) {
      throw new DomainError(NOT_XML);
    }
    const attributes = nameEnd < contentEnd ? attributesIn(text, nameEnd, contentEnd) : {};
    if (empty) {
      place({ name, attributes, children: [], text: '' });
    } else if (open.length === 0 && root !== null) {
      throw new DomainError(NOT_XML);
    } else {
      open.push({ name, attributes, children: [], pieces: [] });
    }
    at = end + 1;
  }

  if (open.length > 0) {
    throw new DomainError(NOT_XML);
  }
  if (root === null) {
    throw new DomainError(EMPTY);
  }
  return root;
}

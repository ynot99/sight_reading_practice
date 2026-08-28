import type { IScoreImporter } from '../../application/ports/IScoreImporter.js';
import { parseMusicXml, type ImportedScore } from '../../domain/notation/MusicXmlParser.js';
import { xmlNode, type XmlNode } from '../../domain/notation/XmlNode.js';
import { DomainError } from '../../shared/errors.js';

/** Anything that turns a string into a document; the browser supplies one. */
export type XmlDocumentParser = Pick<DOMParser, 'parseFromString'>;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_NODE = 4;

/**
 * Reads MusicXML with the platform's own XML parser.
 *
 * Writing one by hand would mean re-implementing entities, CDATA and comments
 * to a standard every browser already meets. What this adapter owes the domain
 * is not parsing but *shape*: a plain tree with no DOM in it, so the MusicXML
 * rules stay testable without a browser.
 */
export class DomMusicXmlImporter implements IScoreImporter {
  private readonly parser: XmlDocumentParser;

  constructor(parser: XmlDocumentParser = new DOMParser()) {
    this.parser = parser;
  }

  read(musicXml: string): ImportedScore {
    const document = this.parser.parseFromString(musicXml, 'application/xml');
    const failure = document.getElementsByTagName('parsererror')[0];
    if (failure !== undefined) {
      throw new DomainError('This file is not valid XML, so nothing could be read from it.');
    }
    const root = document.documentElement;
    if (root === null) {
      throw new DomainError('This file is empty.');
    }
    return parseMusicXml(toXmlNode(root));
  }
}

/** Copies an element and its descendants into the domain's own tree. */
export function toXmlNode(element: Element): XmlNode {
  const attributes: Record<string, string> = {};
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute !== null) {
      attributes[attribute.name] = attribute.value;
    }
  }

  const children: XmlNode[] = [];
  let text = '';
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const node = element.childNodes.item(index);
    if (node === null) {
      continue;
    }
    if (node.nodeType === ELEMENT_NODE) {
      children.push(toXmlNode(node as Element));
      continue;
    }
    if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) {
      text += node.nodeValue ?? '';
    }
  }

  return xmlNode(element.nodeName, attributes, children, text);
}

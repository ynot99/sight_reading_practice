import type { IScoreImporter } from '../../application/ports/IScoreImporter.js';
import { parseMusicXml, type ImportedScore } from '../../domain/notation/MusicXmlParser.js';
import { looksLikeMidi, readMidiFile } from '../../domain/midi/readMidiFile.js';
import { midiToExercise } from '../../domain/notation/midiToExercise.js';
import { xmlNode, type XmlNode } from '../../domain/notation/XmlNode.js';
import { DomainError } from '../../shared/errors.js';
import {
  looksZipped,
  platformInflate,
  readZipDirectory,
  readZipEntry,
  type Inflate,
} from './zip.js';

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
export class DomScoreImporter implements IScoreImporter {
  private readonly parser: XmlDocumentParser;
  private readonly inflate: Inflate;

  constructor(parser: XmlDocumentParser = new DOMParser(), inflate: Inflate = platformInflate) {
    this.parser = parser;
    this.inflate = inflate;
  }

  /**
   * Reads whatever the reader chose, by looking at it rather than at its name.
   *
   * Three kinds arrive here and a file picker on a tablet will not tell them
   * apart: a zipped `.mxl`, plain MusicXML, and a `.mid`. The first four bytes
   * settle it in every case, which is better than trusting an extension - iOS
   * renames files freely, and a score shared through a chat app often arrives
   * with no extension at all.
   */
  async readFile(bytes: ArrayBuffer, name = ''): Promise<ImportedScore> {
    const raw = new Uint8Array(bytes);
    if (looksLikeMidi(raw)) {
      return midiToExercise(readMidiFile(raw), titleFrom(name));
    }
    return this.read(looksZipped(raw) ? await this.unpack(raw) : decodeUtf8(raw));
  }

  /**
   * Finds the score inside a `.mxl` container.
   *
   * The archive names its own root file in `META-INF/container.xml`, which is
   * the only reliable way to tell the score from the cover art, the fonts and
   * whatever else the exporter decided to pack alongside it.
   */
  private async unpack(bytes: Uint8Array): Promise<string> {
    const entries = readZipDirectory(bytes);
    const container = entries.find((entry) => entry.name === 'META-INF/container.xml');

    let wanted: string | null = null;
    if (container !== undefined) {
      const manifest = decodeUtf8(await readZipEntry(bytes, container, this.inflate));
      wanted = /<rootfile[^>]*full-path="([^"]+)"/.exec(manifest)?.[1] ?? null;
    }

    const entry =
      (wanted === null ? undefined : entries.find((candidate) => candidate.name === wanted)) ??
      entries.find(
        (candidate) =>
          !candidate.name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(candidate.name),
      );
    if (entry === undefined) {
      throw new DomainError('This archive has no score in it.');
    }
    return decodeUtf8(await readZipEntry(bytes, entry, this.inflate));
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

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
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

/**
 * A name for a file that carries no title of its own.
 *
 * MIDI has a track name and often nothing better, and what the reader called
 * the file is usually the piece - so the file name is the honest fallback,
 * with the extension and the tidying-up taken off.
 */
function titleFrom(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return stem === '' ? 'Imported performance' : stem;
}

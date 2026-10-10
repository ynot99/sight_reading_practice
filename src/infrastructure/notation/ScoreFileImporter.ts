import type { IScoreImporter } from '../../application/ports/IScoreImporter.js';
import { parseMusicXml, type ImportedScore } from '../../domain/notation/MusicXmlParser.js';
import { looksLikeMidi, readMidiFile } from '../../domain/midi/readMidiFile.js';
import { midiToExercise } from '../../domain/notation/midiToExercise.js';
import { readXml } from '../../domain/notation/XmlReader.js';
import { DomainError } from '../../shared/errors.js';
import {
  looksZipped,
  platformInflate,
  readZipDirectory,
  readZipEntry,
  type Inflate,
} from './zip.js';

/**
 * Reads a score file: a `.mxl`, plain MusicXML or a `.mid`.
 *
 * The XML is read by `readXml` rather than the browser's parser: see there
 * for what that cost. What is left to this adapter is the platform's own
 * inflater, for the archive a `.mxl` is.
 */
export class ScoreFileImporter implements IScoreImporter {
  private readonly inflate: Inflate;

  constructor(inflate: Inflate = platformInflate) {
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
    return parseMusicXml(readXml(musicXml));
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
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

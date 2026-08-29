import type { ImportedScore } from '../../domain/notation/MusicXmlParser.js';

/**
 * Turns a chosen file into something practisable.
 *
 * A port because reading XML needs a parser the domain may not touch, while
 * *what a score means* is domain knowledge and lives there. The adapter is the
 * seam between the two, and nothing above it has to know a DOM exists.
 */
export interface IScoreImporter {
  read(musicXml: string): ImportedScore;
  /**
   * Reads a chosen file, whatever kind it turns out to be.
   *
   * Three arrive: a zipped `.mxl`, plain MusicXML, and a `.mid`. Compressed is
   * what MuseScore hands you unless you ask otherwise, and MIDI is all it will
   * hand you at all on a tablet - so both are the path a reader actually
   * takes. The name is passed for the sake of a file that carries no title of
   * its own; what kind it is comes from the bytes.
   */
  readFile(bytes: ArrayBuffer, name?: string): Promise<ImportedScore>;
}

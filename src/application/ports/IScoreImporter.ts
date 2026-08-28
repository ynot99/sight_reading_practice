import type { ImportedScore } from '../../domain/notation/MusicXmlParser.js';

/**
 * Turns a MusicXML document into something practisable.
 *
 * A port because reading XML needs a parser the domain may not touch, while
 * *what MusicXML means* is domain knowledge and lives there. The adapter is
 * the seam between the two, and nothing above it has to know a DOM exists.
 */
export interface IScoreImporter {
  read(musicXml: string): ImportedScore;
}

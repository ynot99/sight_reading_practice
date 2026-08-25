/**
 * Engraves notation into whatever surface the host provides.
 *
 * The application layer never touches the DOM, OSMD or SVG: it hands over
 * MusicXML and asks for a cursor.
 */
export interface IScoreRenderer {
  load(musicXml: string): Promise<void>;
  /** Re-layout after a container resize. */
  refresh(): void;
  clear(): void;
}

/**
 * Position marker on the rendered score.
 *
 * Positions are timeline step indices, and the renderer is responsible for
 * mapping them onto its own iteration model.
 */
export interface IScoreCursor {
  readonly position: number;
  show(): void;
  hide(): void;
  reset(): void;
  moveTo(stepIndex: number): void;
}

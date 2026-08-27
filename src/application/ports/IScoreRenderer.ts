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

/**
 * How a step is marked up on the page after it has been judged.
 *
 * Kept coarse on purpose: the page is notation, not a dashboard, and a reader
 * glancing at a bar should be able to tell these apart without decoding them.
 */
export type StepHighlight =
  /** Every notated pitch, in time. */
  | 'correct'
  /** The right notes, but outside the timing tolerance. */
  | 'late'
  /** Wrong notes were played here. */
  | 'incorrect'
  /** The step went by unplayed. */
  | 'missed';

/**
 * Colours notes on the score.
 *
 * Separate from {@link IScoreRenderer} so a renderer that cannot mark
 * individual notes is still a perfectly good renderer.
 */
export interface IScoreHighlighter {
  highlight(stepIndex: number, highlight: StepHighlight): void;
  clearHighlights(): void;
}

/**
 * Note size. Its own interface for the same reason: it is an optional talent,
 * not part of being able to draw a score.
 */
export interface IScoreZoom {
  readonly zoom: number;
  setZoom(zoom: number): void;
}

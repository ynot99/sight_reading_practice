import type { ClefKind } from '../../domain/model/Clef.js';
import type { KeySignature } from '../../domain/model/KeySignature.js';

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
  /**
   * Brings the top of the page back into view.
   *
   * A long piece is scrolled through as it is read, and it stays where it was
   * left. Starting a run put the cursor at bar one and left the reader
   * looking at bar forty.
   */
  scrollToStart(): void;
  clear(): void;
}

/** A passage, as the bars of the engraving that hold it. */
export interface DrawnPassage {
  readonly fromMeasureIndex: number;
  readonly toMeasureIndex: number;
  /**
   * Whether the passage plays round again at the end.
   *
   * Drawn, because music already has a sign for it: the markers grow the two
   * dots of a repeat bar line. It is the same thing the drawer's repeat
   * button says, said where the reader is actually looking - and it is what
   * makes the markers read as the repeat brackets they are.
   */
  readonly repeating?: boolean;
}

/**
 * The two markers that hold the passage being practised.
 *
 * They replace touching a note to choose a passage, which asked the reader
 * to hit a notehead the width of a pencil and said nothing at all when it
 * missed - and even when it landed, nothing on the page showed what had been
 * chosen until the score re-engraved. A marker is a thing you can see, take
 * hold of and move, and it is where a musician would put a pencil anyway.
 *
 * Bars, not steps: a passage begins at a bar line. The renderer says which
 * bars a drag landed between; what that *means* stays the application's.
 */
export interface IPassageMarkers {
  /** Draws the markers around these bars of what is currently engraved. */
  showPassage(passage: DrawnPassage): void;
  hidePassage(): void;
  onPassageDragged(listener: (passage: DrawnPassage) => void): () => void;
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

/** One key press, and whether it belonged where it landed. */
export interface PlayedNote {
  readonly stepIndex: number;
  readonly midi: number;
  readonly correct: boolean;
  /**
   * How far from its note the press landed, as a fraction of the gap to the
   * neighbouring one: negative is early, positive late, `0` dead on.
   *
   * Kept as a fraction rather than pixels because only the renderer knows how
   * far apart two noteheads ended up, and only it knows when the neighbour is
   * on the next system and therefore no scale at all.
   */
  readonly offset: number;
}

/** What the overlay needs in order to spell and place a press. */
export interface OverlayContext {
  /** The key in force at a step, which a modulation moves. */
  readonly keyAt: (stepIndex: number) => KeySignature;
  /**
   * The clef a staff is reading in at a given step.
   *
   * A function rather than a map because a staff may change clef partway
   * through, and a mark's ledger lines are counted from the clef in force
   * where it sits - not from the one the staff opened with.
   */
  readonly clefAt: (staffNumber: number, stepIndex: number) => ClefKind;
}

/**
 * Draws what was actually played over the engraving.
 *
 * Deliberately additive: the notation underneath is never recoloured, because
 * black noteheads are the thing being learned to read. A press shows as a ring
 * at the pitch that was struck - green where it belonged, red where it did
 * not - so the page says *what* was played, rather than merely that something
 * went wrong.
 *
 * Separate from {@link IScoreRenderer} so a renderer that cannot draw over
 * itself is still a perfectly good renderer.
 */
export interface IPlayedNoteOverlay {
  /** Supplied whenever the music changes; spelling depends on the key. */
  configureOverlay(context: OverlayContext): void;
  showPlayed(note: PlayedNote): void;
  clearPlayed(): void;
}

/**
 * Fades notes once they have been passed.
 *
 * The page empties behind the reader, which pushes the eye forward instead of
 * letting it rest on music already played - reading ahead being most of what
 * sight-reading is. Faded rather than removed, so the staff, the bar lines and
 * the spacing all stay exactly where they were.
 */
export interface IScoreFade {
  fadePassed(stepIndex: number): void;
  clearFaded(): void;
}

/**
 * Note size. Its own interface for the same reason: it is an optional talent,
 * not part of being able to draw a score.
 */
export interface IScoreZoom {
  readonly zoom: number;
  setZoom(zoom: number): void;
}

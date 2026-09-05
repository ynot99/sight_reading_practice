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

/** Where the reader is in a score that is turned rather than scrolled. */
export interface ScorePageState {
  /** Zero-based, so `at + 1` is what a reader would be told. */
  readonly at: number;
  readonly count: number;
  /**
   * The two heights the pages were cut from, in screen pixels.
   *
   * Carried because a page count is impossible to argue with from outside:
   * "two pages" is right for a short piece and wrong for a long one, and
   * which it is depends entirely on these. They go in the judging log, where
   * they turn a report of "it does not work" into a measurement.
   */
  readonly windowPx: number;
  readonly contentPx: number;
}

/**
 * A score read by turning pages instead of by scrolling.
 *
 * The engraver lays a piece out as one tall column, which is right for
 * scrolling and wrong for reading: someone who is only looking through a
 * piece wants to turn a page, read it, and turn the next, and someone who is
 * playing wants the page to turn itself once rather than to creep upwards
 * under the music.
 *
 * Nothing is re-engraved for this. A page is a window onto the same column,
 * which is what keeps the cursor, the marks and the passage markers all still
 * true - every one of them is measured against that column.
 */
export interface IScorePages {
  setPaged(paged: boolean): void;
  readonly pages: ScorePageState;
  /** Turns by that many pages, stopping at either end. */
  turnPages(delta: number): void;
  /** Brings the page holding that bar into view, if it is not already. */
  showMeasure(measureIndex: number): void;
  onPagesChanged(listener: (state: ScorePageState) => void): () => void;
}

/** Which end of the passage a gesture was aimed at. */
export type PassageEnd = 'from' | 'to';

/** A passage, as the bars of the engraving that hold it. */
export interface DrawnPassage {
  readonly fromMeasureIndex: number;
  readonly toMeasureIndex: number;
  /**
   * Whether it can still be taken hold of.
   *
   * Drawn either way, because it says what is being practised and that is
   * worth seeing while playing it. Only the handles go: a run is being
   * *graded*, and a passage moved halfway through makes the report a report
   * of nothing in particular - some of it judged against one stretch and the
   * rest against another the reader never agreed to.
   *
   * `undefined` means movable, which is what it is between runs.
   */
  readonly movable?: boolean;
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
  /**
   * A touch on the music itself: not a marker, not a page being turned.
   *
   * The renderer says what happened and nothing about what it means. What it
   * means is that the markers are shown or put away, which is the
   * application's decision and not the engraver's.
   */
  /**
   * Marks the bar the music will start from, or takes the mark away.
   *
   * Its own mark and not the cursor: the cursor says where the music *is*,
   * and between runs it is at the top saying nothing useful. A reader who
   * has put their place somewhere needs to be able to see that they have,
   * and to see it while looking at the page rather than by pressing Start
   * and finding out.
   */
  showStart(measureIndex: number | null): void;
  /**
   * Marks the bars that are a second reading of ones already printed.
   *
   * A repeat is written out rather than jumped back to, so the music is on
   * the page twice and a reader with no mark to go by would think the piece
   * simply says it twice. The mark is not notation and does not pretend to
   * be: the writer drew a repeat sign, and this says "you have read this
   * before" in the one place a repeat sign no longer is.
   */
  showRepeatedBars(measureIndexes: readonly number[]): void;
  onScoreTapped(listener: () => void): () => void;
  /**
   * A finger held still on one of the two markers.
   *
   * Told apart from a hold on a bar by what is under the finger rather than
   * by where in the bar it landed: a marker is a drawn thing with an edge to
   * aim at, and "near the bar line" against "in the middle of the bar" is a
   * distinction a fingertip cannot reliably make.
   */
  onMarkerHeld(listener: (end: PassageEnd) => void): () => void;
  /**
   * A finger held still on a bar, which is how a reader points at a place.
   *
   * A bar and not a note. A notehead is the size of a pencil tip and a
   * fingertip is a centimetre, so pointing at one meant aiming at one -
   * which on a tablet is most of the effort and most of the misses. A bar is
   * a box several thumbprints wide, and it is what the answer is made of
   * anyway: a run begins at a bar line, never partway through one.
   *
   * Held rather than tapped, because a tap on the music already means
   * something and because pointing at a bar is a deliberate act - the reader
   * is saying "start here", not brushing the page.
   */
  onBarHeld(listener: (measureIndex: number) => void): () => void;
}

/**
 * The hand switches, drawn beside the staves they govern.
 *
 * Which hand is being read used to be one button in the drawer, cycling
 * through three answers - and reaching it meant a gesture, then a tap, then
 * the gesture back. A switch that sits *on* the staff it turns off needs no
 * icon to be understood and no memory to be found: it is beside the notes the
 * reader is already looking at, and it repeats down the page the way a clef
 * does, so there is one within reach of wherever the eye is.
 */
export interface IHandSwitches {
  /**
   * Which staves the run is asking for; the rest are drawn as switched off.
   *
   * Staff numbers as the score counts them, from the top down.
   */
  showHands(playing: readonly number[]): void;
  /** A switch that was pressed, by the staff it stands beside. */
  onHandToggled(listener: (staffNumber: number) => void): () => void;
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
  /**
   * Dims the music this run will not ask for.
   *
   * A hand that is not being read and the bars outside the chosen passage are
   * the same thing from the reader's side: notation still on the page, and
   * still worth having there - the passage's neighbours say what it is a
   * passage *of*, and the other hand says what this one is playing against -
   * but not what is being asked for now. Dimmed rather than removed, and
   * dimmed less than a note already played, which goes altogether: this is
   * context, not litter.
   *
   * `null` when nothing should be dimmed, which is the reader's own choice.
   */
  dimUnplayed(reading: ScoreReading | null): void;
}

/** What a run is about to ask for, as the page can see it. */
export interface ScoreReading {
  /** Staff numbers being read; empty means all of them. */
  readonly staves: readonly number[];
  /** The stretch being read, as timeline step indices. */
  readonly from: number;
  readonly to: number;
}

/**
 * Note size. Its own interface for the same reason: it is an optional talent,
 * not part of being able to draw a score.
 */
export interface IScoreZoom {
  readonly zoom: number;
  setZoom(zoom: number): void;
}

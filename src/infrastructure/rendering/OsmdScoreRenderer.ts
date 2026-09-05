import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type {
  DrawnPassage,
  IPassageMarkers,
  IScorePages,
  ScorePageState,
  IPlayedNoteOverlay,
  IScoreCursor,
  IScoreFade,
  IScoreRenderer,
  IScoreZoom,
  OverlayContext,
  PassageEnd,
  PlayedNote,
} from '../../application/ports/IScoreRenderer.js';
import {
  bracketShapes,
  gripAt,
  gripsOf,
  gripUnderPointer,
  GRIP_RADIUS_PX,
  measureAt,
  passageAfterTap,
  measureForDrag,
  pageTurnForDrag,
  passageAfterDrag,
  toDrawingPoint,
  type DrawnMeasure,
  type GripEnd,
  type PassageEdge,
} from './passageBrackets.js';
import {
  overflowBelow,
  visibleHeightOf,
  swipeDirection,
} from './pageTurns.js';
import { CursorNavigator, type ICursorPrimitive } from './CursorNavigator.js';
import {
  buildOverlayShapes,
  type OverlayShape,
  type PlayedMark,
} from './playedNoteShapes.js';
import {
  diatonicIndexOf,
  fitStaffGeometry,
  type DrawnNoteSample,
} from './staffGeometry.js';

export interface OsmdRendererOptions {
  readonly zoom?: number;
  readonly cursorColor?: string;
  readonly drawTitle?: boolean;
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Engraver units to drawing units.
 *
 * Zoom is applied by shrinking the SVG viewBox rather than by moving anything
 * inside it, so this stays constant and an overlay drawn into the same SVG
 * scales along with the notation. A test pins the relationship against a real
 * rendering, so a change in the engraver fails loudly instead of quietly
 * sliding every mark off its note.
 */
const UNITS_TO_PIXELS = 10;
/** How wide a passage marker is drawn, in the same pixels. */
const MARKER_WIDTH = 5;
/** The circle at each end of a marker, which is what a thumb aims at. */
const MARKER_GRIP_RADIUS = 9;
/** How far a repeat dot sits from the marker, and from the line between. */
const REPEAT_DOT_GAP = 9;
/** How far a finger may wander and still have meant a tap, in screen pixels. */
const TAP_SLACK_PX = 8;
/**
 * How long a finger stays put before it is pointing rather than touching.
 *
 * Long enough not to fire under a reader who is turning a page or reaching
 * for a marker, short enough that holding still feels like an instruction
 * rather than a wait.
 */
const HOLD_MS = 450;
/** How wide the "start here" line is drawn, and its little flag. */
const START_WIDTH = 3;

/**
 * How big the mark on a re-read bar is drawn.
 *
 * A rehearsal mark's worth: big enough to be seen at the stand without
 * being read as something the writer put there.
 */
const REPEAT_MARK_RADIUS = 4;

/**
 * How close to a bar number a text has to be to *be* that bar's number.
 *
 * The engraver draws it just above and just left of the bar line, a few units
 * out. Bars are more than a hundred units apart, so nothing else can be
 * mistaken for it.
 */
const NUMBER_REACH = 14;
const START_FLAG = 9;

/** How far the page's label sits from the corner of the page, in pixels. */
const PAGE_LABEL_INSET = 18;
/**
 * How much of a title the corner of a page will take.
 *
 * Counted in characters rather than measured, because the text is an SVG
 * `<text>` and the one honest way to measure one is `getComputedTextLength`,
 * which the headless document this is tested in answers `0` to. A guess at
 * the width of a character would be a measurement in name only, so this is
 * openly a limit on length: past it a corner label has stopped being glanced
 * at and started being read, whatever it measures.
 */
const TITLE_LIMIT = 48;
/** Half the width of the arrow drawn inside a handle. */
const ARROW_REACH = 3.5;

/**
 * How wide a hand switch is, and how far it stands off its staff.
 *
 * Wide enough for a fingertip, which is the whole reason it is out here
 * rather than a smaller thing drawn more precisely. The gap keeps it clear of
 * the brace and of the clef.
 */
const HAND_SWITCH_WIDTH = 26;
const HAND_SWITCH_GAP = 6;
/**
 * How tall the drawn part of a hand switch is.
 *
 * Fixed, and centred on its staff. Measured as a share of the staff's own box
 * they came out different heights from each other: the engraver's box for a
 * staff is drawn round what is on it, so the hand with the ledger lines got a
 * taller switch than the hand without. Two switches that do the same thing
 * have to look the same, whatever the music above them happens to be.
 */
const HAND_SWITCH_HEIGHT = 30;

/**
 * A title cut to {@link TITLE_LIMIT}, with an ellipsis where it was cut.
 *
 * SVG text does not wrap, so a long one does not become two lines - it runs
 * off the side of the page and out of the drawing.
 */
/**
 * Every horizontal line drawn inside an element, with the span it covers.
 *
 * The engraver draws a staff line and a ledger line the same way; what tells
 * them apart is how far they run.
 */
function horizontalRules(group: Element): { y: number; from: number; to: number }[] {
  const found: { y: number; from: number; to: number }[] = [];
  for (const path of group.querySelectorAll('path')) {
    const drawn = /^M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)$/.exec(path.getAttribute('d') ?? '');
    if (drawn === null || drawn[2] !== drawn[4]) {
      continue;
    }
    found.push({
      y: Number.parseFloat(drawn[2] ?? '0'),
      from: Number.parseFloat(drawn[1] ?? '0'),
      to: Number.parseFloat(drawn[3] ?? '0'),
    });
  }
  return found;
}

function shortened(title: string): string {
  const trimmed = title.trim();
  if (trimmed.length <= TITLE_LIMIT) {
    return trimmed;
  }
  return `${trimmed.slice(0, TITLE_LIMIT - 1).trimEnd()}…`;
}

/** As much of the engraver's own model as the markers need to read. */
interface DrawnStaff {
  readonly staffNumber: number;
  readonly page: number;
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

interface DrawnSheet {
  readonly MusicPages?: readonly { readonly MusicSystems?: readonly DrawnSystem[] }[];
}

interface DrawnSystem {
  readonly GraphicalMeasures?: readonly (readonly (DrawnGraphicalMeasure | undefined)[])[];
  readonly StaffLines?: readonly { readonly PositionAndShape?: DrawnBox }[];
  readonly PositionAndShape?: DrawnBox;
}

interface DrawnBox {
  readonly AbsolutePosition?: { readonly x: number; readonly y: number };
  readonly Size?: { readonly width: number; readonly height: number };
}

interface DrawnGraphicalMeasure {
  readonly PositionAndShape?: DrawnBox;
  readonly parentSourceMeasure?: { readonly measureListIndex?: number };
}

/**
 * The size the engraving was drawn at, in its own pixels.
 *
 * Read from the attributes rather than from `width.baseVal`: the animated
 * length is what a browser fills in, and a document that has laid nothing out
 * does not have one - which is every test that runs the real engraver without
 * a real window. The attribute is what the engraver wrote there itself.
 */
function intrinsicSize(svg: SVGSVGElement): { readonly width: number; readonly height: number } {
  // The `viewBox` first, because everything measured here is in the
  // engraver's own units and the viewBox is what those units mean. The width
  // and height attributes are the size the drawing is *shown* at, and the two
  // part company the moment the reader zooms: at 85% the box is 818 units
  // tall while the attribute says 696 pixels. Read the attribute as the unit
  // count and every position comes out eighteen per cent too far down, which
  // packs a system too many onto each page and slices the last one.
  const box = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map((part) => Number.parseFloat(part));
  const boxWidth = box[2];
  const boxHeight = box[3];
  if (boxWidth !== undefined && boxHeight !== undefined && Number.isFinite(boxWidth) && Number.isFinite(boxHeight)) {
    return { width: boxWidth, height: boxHeight };
  }
  const attribute = (name: string): number => Number.parseFloat(svg.getAttribute(name) ?? '');
  const width = attribute('width');
  const height = attribute('height');
  return {
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  };
}

/** Top and bottom of everything a system's staves cover, in pixels. */
function systemExtent(system: DrawnSystem): { top: number; bottom: number } | null {
  // The staff lines and not the measures: a measure's box is drawn round what
  // is *in* it, so an empty bar of rests reports a height of one unit and a
  // marker measured on it stops halfway down the treble. The staves are the
  // thing that is the same height whatever is written on them.
  //
  // Nor the system's own box, which reaches down into the gap before the next
  // line - a marker that long hangs into the space between systems.
  const boxes = (system.StaffLines ?? []).map((line) => line.PositionAndShape);
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    const at = box?.AbsolutePosition;
    const size = box?.Size;
    if (at === undefined || size === undefined) {
      continue;
    }
    top = Math.min(top, at.y * UNITS_TO_PIXELS);
    bottom = Math.max(bottom, (at.y + size.height) * UNITS_TO_PIXELS);
  }
  return Number.isFinite(top) && Number.isFinite(bottom) ? { top, bottom } : null;
}

/**
 * What was actually drawn on a page, in the drawing's own units.
 *
 * `null` where nothing can measure it: jsdom has no layout engine and an
 * empty page has no box at all.
 */
function boundingBoxOf(sheet: SVGSVGElement): { readonly y: number; readonly height: number } | null {
  if (typeof sheet.getBBox !== 'function') {
    return null;
  }
  try {
    const box = sheet.getBBox();
    return box.height > 0 ? { y: box.y, height: box.height } : null;
  } catch {
    return null;
  }
}

/**
 * The page itself: how tall it is in the drawing's units, and how much of a
 * pixel each of those is worth on screen.
 *
 * Read from the `viewBox` against the height it is displayed at, because
 * those two are what the engraver actually wrote - the attributes carry the
 * zoom, the box carries the drawing.
 */
function pageBoxOf(
  sheet: SVGSVGElement,
): { readonly height: number; readonly scale: number } | null {
  const viewBox = (sheet.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const height = viewBox[3];
  const shown = Number.parseFloat(sheet.getAttribute('height') ?? '');
  if (height === undefined || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  const scale = Number.isFinite(shown) && shown > 0 ? shown / height : 1;
  return { height, scale };
}

/** A bar's notes, in order, and which of them a beam group starts on. */
interface MeasureNotes {
  readonly notes: readonly Element[];
  readonly at: ReadonlyMap<Element, number>;
  readonly owners: ReadonlySet<string>;
}

/** Class that dims the notes of a step already played. */
const FADED_CLASS = 'note--passed';

/** The part of the engraver's graphical note this adapter reads. */
interface DrawnNote {
  getSVGGElement?: () => SVGGElement | null;
  readonly sourceNote?: {
    readonly pitch?: { readonly FundamentalNote?: number; readonly Octave?: number } | null;
    readonly parentStaffEntry?: { readonly parentStaff?: { readonly id?: number } };
  };
  readonly PositionAndShape?: { readonly AbsolutePosition?: { x: number; y: number } };
  /**
   * The engraver's own answer to which page this was laid out on.
   *
   * Asked only where the drawing cannot be: a rest is given no group of its
   * own in the SVG, so there is no element to look up from.
   */
  readonly parentVoiceEntry?: {
    readonly parentStaffEntry?: {
      readonly parentMeasure?: {
        readonly ParentMusicSystem?: { readonly Parent?: { readonly PageNumber?: number } };
      };
    };
  };
}

/** Bridges OSMD's forward-only cursor to {@link ICursorPrimitive}. */
class OsmdCursorPrimitive implements ICursorPrimitive {
  private readonly resolve: () => OpenSheetMusicDisplay | null;

  constructor(resolve: () => OpenSheetMusicDisplay | null) {
    this.resolve = resolve;
  }

  private get cursor(): OpenSheetMusicDisplay['cursor'] | null {
    return this.resolve()?.cursor ?? null;
  }

  get endReached(): boolean {
    const iterator = this.cursor?.iterator;
    return iterator === undefined || iterator === null ? true : iterator.EndReached;
  }

  reset(): void {
    this.cursor?.reset();
  }

  next(): void {
    this.cursor?.next();
  }

  show(): void {
    this.cursor?.show();
  }

  hide(): void {
    this.cursor?.hide();
  }
}

/**
 * OpenSheetMusicDisplay adapter.
 *
 * The only file in the project that knows OSMD exists. Everything above it
 * depends on the score ports, so swapping the engraver is a single-file
 * change.
 *
 * OSMD (with VexFlow behind it) is by far the heaviest dependency here, so it
 * is imported dynamically: the controls are interactive while the engraver is
 * still downloading.
 */
/** A marker a finger is holding, and where it has got to. */
interface PassageDrag {
  readonly edge: PassageEdge;
  readonly pointerId: number;
  readonly passage: DrawnPassage;
  /** Where the finger landed, so a tap can be told from a drag. */
  readonly from: { readonly x: number; readonly y: number };
  /** The handle it landed on, when it landed on one rather than the line. */
  readonly grip: GripEnd | null;
  /** Whether the finger is currently past the end of the page it is on. */
  readonly overshot: boolean;
}

/** A finger that may be turning a page, and where it started. */
interface PageSwipe {
  readonly pointerId: number;
  readonly from: { readonly x: number; readonly y: number };
}

export class OsmdScoreRenderer
  implements
    IScoreRenderer,
    IPlayedNoteOverlay,
    IScoreFade,
    IScoreZoom,
    IPassageMarkers,
    IScorePages
{
  private readonly container: HTMLElement;
  private readonly options: OsmdRendererOptions;
  private readonly navigator: CursorNavigator;

  /** Where each timeline step sits, and the notes drawn there. */
  private stepX = new Map<number, number>();
  private stepElements = new Map<number, SVGGElement[]>();
  /** Which sheet each step was drawn on; every page is an SVG of its own. */
  private stepPage = new Map<number, number>();
  /**
   * The engraver's systems, numbered in the order the walk meets them.
   *
   * Its own system object is the identity and is never read from; the number
   * is ours, so that a sample can carry it and two samples can be compared.
   * Rebuilt with every engraving, since the objects are.
   */
  private systemNumbers = new Map<object, number>();
  /** True while the cursor is being walked to find out what is where. */
  private walking = false;
  private faded = new Set<number>();
  private samples: DrawnNoteSample[] = [];
  /**
   * How tall a staff position is on each page, measured once per engraving.
   *
   * It is a fact about the drawing, so it changes only when the drawing does
   * - and it was being worked out again for every page on every note the
   * reader played, from every note in the score. On a long piece that was
   * thousands of measurements per keystroke, growing as the marks did, and
   * the trainer stopped answering partway through.
   */
  private geometryByPage = new Map<number, ReturnType<typeof fitStaffGeometry>>();
  /** Each page's overlay layer; see {@link overlayGroupFor}. */
  private overlayGroups = new WeakMap<SVGSVGElement, SVGGElement>();
  /** The pages as last engraved; see {@link sheets}. */
  private drawnSheets: SVGSVGElement[] | null = null;
  /** Each page's printed label; see {@link labelPage}. */
  private pageLabels = new WeakMap<SVGSVGElement, Element>();
  private marks: PlayedMark[] = [];
  private overlayContext: OverlayContext | null = null;

  /** Where the engraver put each bar, and the markers standing on them. */
  private measures: DrawnMeasure[] = [];
  private passage: DrawnPassage | null = null;
  /** The bar the music will start from, when the reader has moved it. */
  private startMeasure: number | null = null;
  private repeatedBars: readonly number[] = [];
  private passageListeners: ((passage: DrawnPassage) => void)[] = [];
  private dragging: PassageDrag | null = null;

  /** The column cut into pages, and which one is being read. */
  private paged = false;
  /**
   * How much shorter than the window a page has to be asked for.
   *
   * Kept between engravings of the same music: a piece whose systems spill
   * over spills every time, and starting from nothing again would mean two
   * engravings on every resize instead of one. Cleared when new music
   * arrives, because it is a fact about the music, not about the window.
   */
  private pageSurplusPx = 0;
  /**
   * The window the correction was measured against.
   *
   * A correction is only true of the page it was measured on. The trainer
   * opens in the desk layout and enters the reading layout a moment later,
   * which is a different window and a different page - carrying the first
   * measurement into the second would shorten a page that never spilled, and
   * carrying it again on every following engraving would go on shortening it.
   */
  private pageSurplusWindow = 0;
  private pageAt = 0;
  private pageListeners: ((state: ScorePageState) => void)[] = [];
  private swipe: PageSwipe | null = null;
  private tapListeners: (() => void)[] = [];
  private heldListeners: ((measureIndex: number) => void)[] = [];
  private markerHeldListeners: ((end: PassageEnd) => void)[] = [];
  private handListeners: ((staffNumber: number) => void)[] = [];
  /** A finger down on a hand switch, and which staff it stands beside. */
  private pressedHand: { pointerId: number; staffNumber: number } | null = null;
  /** Which staves the run is asking for; see {@link paintHands}. */
  private handsPlaying: readonly number[] = [];
  private holding: ReturnType<typeof setTimeout> | null = null;
  /** Where a touch that took hold of nothing began, so a tap can be told. */
  private tapFrom: { readonly pointerId: number; readonly x: number; readonly y: number } | null =
    null;

  private osmd: OpenSheetMusicDisplay | null = null;
  private loaded = false;
  private currentZoom: number;
  private observer: ResizeObserver | null = null;
  /** Width the sheet was last engraved for; a height change is not one. */
  private engravedWidth = 0;

  constructor(container: HTMLElement, options: OsmdRendererOptions = {}) {
    this.container = container;
    this.options = options;
    this.currentZoom = options.zoom ?? 0.85;
    this.navigator = new CursorNavigator(new OsmdCursorPrimitive(() => this.osmd));
    // The page follows the cursor, in every mode that moves it: practising,
    // listening, a take played back. Told by the page's own driver instead,
    // it would follow only where somebody had remembered to say so - and
    // during playback nobody had.
    this.navigator.onMoved((stepIndex, byTheMusic) => this.followCursor(stepIndex, byTheMusic));
    this.watchForDrags();
  }

  get cursor(): IScoreCursor {
    return this.navigator;
  }

  get zoom(): number {
    return this.currentZoom;
  }

  setZoom(zoom: number): void {
    this.currentZoom = Math.min(3, Math.max(0.3, zoom));
    if (this.osmd !== null) {
      this.osmd.zoom = this.currentZoom;
    }
  }

  async load(musicXml: string): Promise<void> {
    const osmd = await this.ensureEngraver();
    this.marks = [];
    // Nothing, rather than the engraver's "Untitled Score", for a score that
    // does not name itself. The second argument is the name it falls back to,
    // and left at its default it invents one - which the page label would
    // then print in the corner of all thirty pages as though the piece were
    // called that. An empty title is a fact about the file and says so.
    await osmd.load(musicXml, '');
    osmd.zoom = this.currentZoom;
    // Before the first engraving, not only when the reader turns pages on.
    // A visit that opens already in pages - because that is how the reader
    // left it - has nothing to turn them on, so the page was laid out as one
    // endless column and only switching the setting off and on again fixed
    // it. Asked here, the first engraving is already the right shape.
    // New music, so what the last piece spilled over says nothing about this
    // one.
    this.pageSurplusPx = 0;
    this.pageSurplusWindow = 0;
    this.markPaged();
    // The engraver may only now exist, and it is made with following on.
    this.followOrTurn();
    this.applyPageFormat();
    osmd.render();
    this.forgetSheets();
    this.fitPagesToTheirContent();
    this.loaded = true;
    this.engravedWidth = this.container.offsetWidth;
    this.walking = true;
    this.navigator.reset();
    this.walking = false;
    this.indexDrawnNotes();
    this.measures = this.readMeasures();
    this.showOnlyCurrentPage();
    this.paintOverlay();
    this.paintFaded();
    this.paintPassage();
    this.paintHands();
    this.watchContainer();
  }

  /**
   * Re-engraves when the space the sheet has to fill actually changed.
   *
   * OSMD's own `autoResize` listens to the window, and on iOS the window
   * changes height whenever the browser's toolbar collapses - which is on
   * every scroll. Each of those re-engraved the page and threw away the
   * overlay drawn on it, so the marks from a finished run vanished the moment
   * the reader scrolled to look at them.
   *
   * Width is the only thing the engraver's decisions depend on: a page that
   * got taller holds the same systems in the same places.
   */
  handleContainerResize(width: number): void {
    if (!this.loaded || width <= 0 || Math.abs(width - this.engravedWidth) < 1) {
      return;
    }
    this.refresh();
  }

  private watchContainer(): void {
    if (this.observer !== null || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      this.handleContainerResize(width);
    });
    this.observer.observe(this.container);
  }

  /** Stops watching. Called when the renderer is thrown away with the page. */
  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  refresh(): void {
    if (!this.loaded || this.osmd === null) {
      return;
    }
    this.osmd.zoom = this.currentZoom;
    // The window may be a different size than it was - a rotation, a resize,
    // the transport bar appearing - and a page is cut to the window.
    this.markPaged();
    this.applyPageFormat();
    this.osmd.render();
    this.forgetSheets();
    this.fitPagesToTheirContent();
    this.engravedWidth = this.container.offsetWidth;
    this.walking = true;
    this.navigator.reset();
    this.walking = false;
    // Re-engraving throws the old SVG away, and everything drawn on it.
    this.indexDrawnNotes();
    this.measures = this.readMeasures();
    // The reader is put back on the page they were reading rather than at the
    // front: a re-engraving is a zoom or a turn of the tablet, not a request
    // to start over. It is clamped, because there may be fewer pages now.
    this.turnToPage(this.pageAt);
    this.paintOverlay();
    this.paintFaded();
    this.paintPassage();
    this.paintHands();
  }

  /**
   * Reads the score in pages instead of one endless column.
   *
   * The engraver does the breaking. Given a page size it lays the music out
   * as separate pages and draws each into an SVG of its own, so a page turn
   * is showing one element and hiding the others - no measuring of ink, no
   * arithmetic about what fits, and nothing that can cut a system in half.
   *
   * That was worth going back for. Doing the breaking ourselves meant
   * measuring systems, guessing at beams that hang below the staves, working
   * out which box on the page was the one that scrolled, and fighting a
   * stylesheet for the height of the frame - four attempts, and every one of
   * them had another edge to it.
   *
   * The engraver's own cursor-following goes off with it: it scrolls the
   * column to keep the cursor in view, which is the opposite of a page that
   * stays still until it is turned.
   */
  setPaged(paged: boolean): void {
    if (this.paged === paged) {
      return;
    }
    this.paged = paged;
    // Before the early return below, not after it. A visit that opens already
    // in pages sets this before anything is engraved, and the stylesheet's
    // promise - no scrollbar, no drag - hung on an attribute that was then
    // never written for the rest of the session, because coming back through
    // here found the setting already true and left at the top.
    this.markPaged();
    this.followOrTurn();
    if (!this.loaded) {
      // Nothing engraved yet. The setting is kept and the first engraving
      // will be asked for in pages, which is what a visit that opens in
      // pages needs.
      return;
    }
    // A new page size is a new engraving; there is no way to page a layout
    // that was made without pages in mind.
    this.applyPageFormat();
    this.refresh();
  }

  /**
   * Tells the engraver how big a page is, in its own units.
   *
   * Ten of them to the pixel, whatever the zoom: the page keeps the size it
   * is given on screen and the music inside it grows or shrinks instead,
   * which is what makes zooming change how many pages there are rather than
   * how big they look.
   */
  private applyPageFormat(): void {
    const osmd = this.osmd as unknown as {
      setCustomPageFormat?: (width: number, height: number) => void;
      setPageFormat?: (format: string) => void;
    } | null;
    if (osmd === null) {
      return;
    }
    if (!this.paged) {
      osmd.setPageFormat?.('Endless');
      return;
    }
    const width = this.container.offsetWidth;
    const window = this.windowHeight();
    if (window !== this.pageSurplusWindow) {
      this.pageSurplusPx = 0;
      this.pageSurplusWindow = window;
    }
    const height = window - this.pageSurplusPx;
    if (width > 0 && height > 0) {
      osmd.setCustomPageFormat?.(width / UNITS_TO_PIXELS, height / UNITS_TO_PIXELS);
    }
  }

  /**
   * Whether the engraver scrolls the page to keep the marker in view.
   *
   * Off in pages, where a turn is what shows the reader the next system and
   * nothing scrolls at all. Leaving it on there is not merely redundant: the
   * engraver calls `scrollIntoView` with a smooth behaviour on *every* step,
   * which on a long score is an animation over tens of thousands of elements
   * started again before the last one has finished. On a tablet that is a
   * stall on every beat of the piece.
   *
   * Applied wherever the setting or the engraver may have changed, and
   * before the early return in {@link setPaged}: a visit that opens in pages
   * sets the mode before anything is engraved, and this used to be left
   * behind by that - so the readers who never touched the switch were the
   * ones who paid for it.
   */
  private followOrTurn(): void {
    const engraver = this.osmd as unknown as { FollowCursor?: boolean } | null;
    if (engraver !== null) {
      engraver.FollowCursor = !this.paged;
    }
  }

  /**
   * Says on the page itself whether it is being read in pages.
   *
   * The stylesheet takes the scrollbar away and stops a drag from scrolling
   * when this is set, so it has to be true of the element whenever it is true
   * of the renderer - including the visit that opens in pages before there is
   * anything engraved, and every engraving after it.
   */
  private markPaged(): void {
    const scroller = this.scroller();
    if (scroller instanceof HTMLElement) {
      scroller.dataset['paged'] = String(this.paged);
    }
  }

  /**
   * Re-engraves when the engraver drew past the page it was given.
   *
   * It fits systems onto a page by its own reckoning of how tall each one is,
   * and that reckoning is short of what actually gets drawn - a beam over a
   * run of thirty-seconds, a ledger line, an inner voice hanging below the
   * stave. The page is an SVG cut to the size we asked for, so anything past
   * the bottom is not merely off the window: it is clipped away by the page's
   * own edge, and the reader sees a system sliced in half with no way to
   * scroll to the rest of it.
   *
   * So the page is asked for again, shorter by exactly what spilled over, and
   * the system that did not fit moves to the next page where it belongs. The
   * measurement is the drawing's own bounding box against the page box, so
   * there is no margin invented here and nothing to tune.
   *
   * Once only. A second engraving lays the systems out differently and could
   * spill again by a hair; chasing that would re-engrave all night, and the
   * remedy for a hair is not another whole page.
   */
  private fitPagesToTheirContent(): void {
    if (!this.paged || this.osmd === null) {
      return;
    }
    const surplus = this.surplusBelowPage();
    if (surplus <= 0) {
      return;
    }
    this.pageSurplusPx += surplus;
    this.applyPageFormat();
    this.osmd.render();
    this.forgetSheets();
  }

  /**
   * How far the tallest page's drawing runs past the bottom of the page.
   *
   * In screen pixels: the box is in the drawing's own units, so it is scaled
   * by what the page is displayed at. Pages that cannot be measured - no
   * layout engine, no box - answer nothing, which is the right answer for a
   * page nobody can see.
   */
  private surplusBelowPage(): number {
    let worst = 0;
    for (const sheet of this.sheets) {
      const box = boundingBoxOf(sheet);
      const page = pageBoxOf(sheet);
      if (box === null || page === null || page.height <= 0) {
        continue;
      }
      worst = Math.max(worst, overflowBelow(box, page.height) * page.scale);
    }
    return worst;
  }

  /**
   * Every page the engraver drew, in reading order.
   *
   * Kept between engravings. Asking the container for them is a query over
   * the whole drawing, and this is read on every note the reader plays - on
   * a long score that one lookup was almost the entire cost of showing a
   * mark. The pages change only when the music is engraved again, which is
   * where the list is dropped.
   */
  private get sheets(): SVGSVGElement[] {
    const drawn = this.drawnSheets ?? [...this.container.querySelectorAll('svg')];
    this.drawnSheets = drawn;
    return drawn;
  }

  /** Forgets the pages, so the next reader of {@link sheets} finds them again. */
  private forgetSheets(): void {
    this.drawnSheets = null;
  }

  /** The page the reader is looking at. */
  private currentSheet(): SVGSVGElement | null {
    const sheets = this.sheets;
    return sheets[this.paged ? this.pageAt : 0] ?? sheets[0] ?? null;
  }

  /** The bars on it, which are the only ones a touch can be aimed at. */
  private measuresHere(): DrawnMeasure[] {
    return this.paged
      ? this.measures.filter((measure) => measure.page === this.pageAt)
      : this.measures;
  }

  /**
   * Where the reader is, or nothing at all when the score is one column.
   *
   * A scrolling score has no pages to be on rather than one long page: the
   * difference matters to anything that would say "page 1 of 1" at a reader
   * who never asked for pages.
   */
  get pages(): ScorePageState {
    const count = this.paged ? this.sheets.length : 0;
    return {
      at: Math.min(this.pageAt, Math.max(0, count - 1)),
      count,
      windowPx: Math.round(this.windowHeight()),
      contentPx: Math.round(this.sheets[0]?.getBoundingClientRect().height ?? 0),
    };
  }

  turnPages(delta: number): void {
    this.turnToPage(this.pageAt + delta);
  }

  showMeasure(measureIndex: number): void {
    if (!this.paged) {
      return;
    }
    const drawn = this.measures.find((measure) => measure.measureIndex === measureIndex);
    // Only when the music has actually left the page: turning to the page it
    // is already on would fight a reader who has looked ahead.
    if (drawn !== undefined && drawn.page !== this.pageAt) {
      this.turnToPage(drawn.page);
    }
  }

  onPagesChanged(listener: (state: ScorePageState) => void): () => void {
    this.pageListeners.push(listener);
    return () => {
      this.pageListeners = this.pageListeners.filter((each) => each !== listener);
    };
  }

  /**
   * How tall a page may be: the room inside the box it is drawn into.
   *
   * Asked of that box rather than worked out from the window, because the box
   * is what the page has to fit and only the box knows what has been reserved
   * inside it. Subtracting the room kept for the transport bar by hand once
   * left the strip above the page unaccounted for - eight pixels nobody
   * owned, enough to push the frame past the screen and put a scrollbar on a
   * mode whose promise is that there is nothing to scroll.
   *
   * Clamped to the screen: outside the reading layout the frame is given a
   * minimum of one screen and then grows to whatever is engraved in it, so
   * its own height is the length of the piece rather than the room a page
   * has.
   */
  private windowHeight(): number {
    const scroller = this.scroller();
    if (!(scroller instanceof HTMLElement)) {
      return 0;
    }
    const box = scroller.getBoundingClientRect();
    const visible = visibleHeightOf({ top: box.top, bottom: box.bottom }, this.viewportHeight());
    const style = getComputedStyle(scroller);
    const reserved =
      (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
    return Math.max(0, visible - reserved);
  }

  /** How tall the screen is, as far as this document can tell. */
  private viewportHeight(): number {
    const view = this.container.ownerDocument.defaultView;
    const inner = view?.innerHeight ?? 0;
    return inner > 0 ? inner : (this.container.ownerDocument.documentElement.clientHeight ?? 0);
  }

  /** Puts one page in front of the reader and takes the others away. */
  private turnToPage(index: number): void {
    const sheets = this.sheets;
    this.pageAt = Math.min(Math.max(index, 0), Math.max(0, sheets.length - 1));
    this.showOnlyCurrentPage();
    this.announcePages();
  }

  private showOnlyCurrentPage(): void {
    const sheets = this.sheets;
    for (const [at, sheet] of sheets.entries()) {
      // Only where it differs. A turn changes two pages of the thirty, and
      // assigning the same value to the rest still asks the browser to lay
      // them out again.
      const shown = !this.paged || at === this.pageAt ? '' : 'none';
      if (sheet.style.display !== shown) {
        sheet.style.display = shown;
      }
      this.labelPage(sheet, at, this.paged ? sheets.length : 0);
    }
    this.placeCursor();
  }

  /**
   * What this page is: which piece, and which page of it.
   *
   * Drawn into the sheet rather than floated over it, because that is what
   * it is: part of this page and not part of the screen. It stays put, it is
   * there before anything has been turned, and it goes wherever the page
   * goes - none of which a pill announcing a turn can do, since it says its
   * piece and disappears.
   *
   * The title is here rather than printed over the first system, which is
   * where engraved music puts it and where the engraver would put it if
   * `drawTitle` were on. A title block costs vertical room on the one page
   * whose room is scarcest, and room is what a page in this trainer is
   * always short of. In the margin it costs none - and being on every page
   * it answers "what am I playing" on page seven, which a printed title
   * cannot do at all.
   *
   * The engraver keeps both a title and a page number in its model and draws
   * neither, so this is ours to draw.
   */
  private labelPage(sheet: SVGSVGElement, at: number, count: number): void {
    // Kept rather than looked up, for the reason the overlay layer is: asking
    // the page for it by class walks the whole page, it is appended last so
    // the walk never ends early, and this runs for every page of the score on
    // every turn. Thirty pages of a long piece made a page turn a visible
    // stall - the music stopped, then caught up all at once.
    const held = this.pageLabels.get(sheet);
    const existing = held?.parentNode === sheet ? held : null;
    const label = this.pageLabel(at, count);
    if (label === '') {
      existing?.remove();
      this.pageLabels.delete(sheet);
      return;
    }
    const text = existing ?? sheet.ownerDocument.createElementNS(SVG_NAMESPACE, 'text');
    if (existing !== null && text.textContent === label) {
      return;
    }
    text.setAttribute('class', 'page-label');
    text.setAttribute('x', String(PAGE_LABEL_INSET));
    text.setAttribute('y', String(PAGE_LABEL_INSET));
    text.textContent = label;
    if (existing === null) {
      sheet.append(text);
      this.pageLabels.set(sheet, text);
    }
  }

  /**
   * The line itself, or `''` where there is nothing to say.
   *
   * "Page 1 of 1" at a reader who never asked for pages is furniture, so the
   * count only speaks when there is more than one page. The title speaks
   * whenever the score has one - including in a single column, where it is
   * the whole of the line.
   */
  private pageLabel(at: number, count: number): string {
    const title = shortened(this.osmd?.Sheet?.TitleString ?? '');
    const pages = count < 2 ? '' : `Page ${at + 1} of ${count}`;
    return [title, pages].filter((part) => part !== '').join(' · ');
  }

  /**
   * Turns to the page the cursor has just landed on.
   *
   * And takes the cursor off the page it is not on. The engraver draws it as
   * one marker over the whole sheet and positions it in the coordinates of
   * its own page, so on any other page it stands wherever those coordinates
   * happen to fall - which is a cursor hanging over unrelated music, and is
   * what the reader saw after turning a page by hand.
   */
  private followCursor(stepIndex: number, byTheMusic: boolean): void {
    // Not while the renderer is walking the cursor for its own bookkeeping.
    // Reading where every step was drawn means running the cursor from the
    // top and putting it back, and a page that followed that would end the
    // re-engraving on page one however far in the reader had got.
    if (this.walking) {
      return;
    }
    const page = this.pageOfStep(stepIndex);
    if (byTheMusic && this.paged && page !== this.pageAt) {
      this.turnToPage(page);
      return;
    }
    // The marker still has to be taken off a page it is no longer on, even
    // when the page is staying where it is.
    this.placeCursor();
  }

  /** Shows the cursor only where it belongs; the reader's choice still wins. */
  private placeCursor(): void {
    const onThisPage = !this.paged || this.pageOfStep(this.navigator.position) === this.pageAt;
    if (onThisPage && this.navigator.isWanted) {
      (this.osmd?.cursor as { show?: () => void } | undefined)?.show?.();
      return;
    }
    (this.osmd?.cursor as { hide?: () => void } | undefined)?.hide?.();
  }

  private announcePages(): void {
    const state = this.pages;
    for (const listener of [...this.pageListeners]) {
      listener(state);
    }
  }

  /** The staff whose switch a touch landed on, or `null` for anything else. */
  private handUnder(target: EventTarget | null): number | null {
    if (!(target instanceof Element)) {
      return null;
    }
    const found = target.closest('g.hand-switch');
    const staff = Number.parseInt((found as SVGGElement | null)?.dataset['staff'] ?? '', 10);
    return Number.isFinite(staff) ? staff : null;
  }

  /**
   * The marker a touch landed on, from what the browser hit-tested.
   *
   * Nothing about coordinates: the drawn handle and the area that answers for
   * it are one shape, so the element under the finger *is* the answer. Only
   * where a drag has got to needs arithmetic, and that is asked separately.
   */
  private markerUnder(target: EventTarget | null): { edge: PassageEdge; end: GripEnd | null } | null {
    let node = target instanceof Element ? target : null;
    let end: GripEnd | null = null;
    while (node !== null && node !== this.container) {
      const grip = node.getAttribute('data-end');
      if (grip === 'top' || grip === 'bottom') {
        end = grip;
      }
      if (node.getAttribute('data-locked') === 'true') {
        return null;
      }
      const edge = node.getAttribute('data-edge');
      if (edge === 'start' || edge === 'end') {
        return { edge, end };
      }
      node = node.parentElement;
    }
    return null;
  }

  /** The box that actually scrolls, which is not the one being drawn in. */
  private scroller(): Element | null {
    return this.container.closest('.score__scroll') ?? this.container.parentElement;
  }

  showPassage(passage: DrawnPassage): void {
    this.passage = passage;
    this.paintPassage();
  }

  showStart(measureIndex: number | null): void {
    this.startMeasure = measureIndex;
    this.paintPassage();
  }

  showRepeatedBars(measureIndexes: readonly number[]): void {
    this.repeatedBars = [...measureIndexes];
    this.paintPassage();
  }

  hidePassage(): void {
    this.passage = null;
    this.paintPassage();
  }

  /**
   * Reports the passage a drag left behind.
   *
   * One listener on the container rather than one per marker: the page is
   * re-engraved often - a zoom, a resize, a tempo change - and handlers bound
   * to elements would have to be rebound each time, or quietly stop working
   * after the first redraw.
   */
  onPassageDragged(listener: (passage: DrawnPassage) => void): () => void {
    this.passageListeners.push(listener);
    return () => {
      this.passageListeners = this.passageListeners.filter((each) => each !== listener);
    };
  }

  onScoreTapped(listener: () => void): () => void {
    this.tapListeners.push(listener);
    return () => {
      this.tapListeners = this.tapListeners.filter((each) => each !== listener);
    };
  }

  onBarHeld(listener: (measureIndex: number) => void): () => void {
    this.heldListeners.push(listener);
    return () => {
      this.heldListeners = this.heldListeners.filter((each) => each !== listener);
    };
  }

  onMarkerHeld(listener: (end: PassageEnd) => void): () => void {
    this.markerHeldListeners.push(listener);
    return () => {
      this.markerHeldListeners = this.markerHeldListeners.filter((each) => each !== listener);
    };
  }

  /**
   * Starts the clock on a finger that has taken hold of a marker.
   *
   * The same wait as a hold on a bar, and it ends the drag when it fires:
   * the reader asked for the marker to do something, not to be moved, and
   * letting the drag finish as well would nudge the passage a bar on the way
   * out - a tap on a grip already means that.
   */
  private watchForAMarkerHold(event: PointerEvent, edge: PassageEdge): void {
    this.cancelHold();
    this.holding = setTimeout(() => {
      this.holding = null;
      if (this.dragging?.pointerId !== event.pointerId) {
        return;
      }
      this.dragging = null;
      this.container.releasePointerCapture?.(event.pointerId);
      const end: PassageEnd = edge === 'start' ? 'from' : 'to';
      for (const listener of [...this.markerHeldListeners]) {
        listener(end);
      }
    }, HOLD_MS);
  }

  /** Starts the clock on a finger that may be pointing at a bar. */
  private watchForAHold(event: PointerEvent): void {
    this.cancelHold();
    this.holding = setTimeout(() => {
      this.holding = null;
      // Still where it landed: a finger that travelled was doing something
      // else, and by now it has been told so.
      if (this.tapFrom?.pointerId !== event.pointerId) {
        return;
      }
      // Asked at the end rather than at the start, because what is wanted is
      // where the finger *is*, and a bar is found by coordinates rather than
      // by whatever element happened to be under it.
      const point = this.drawingPointOf(event);
      const bar = point === null ? null : measureAt(this.measuresHere(), point);
      if (bar === null) {
        return;
      }
      this.tapFrom = null;
      for (const listener of [...this.heldListeners]) {
        listener(bar);
      }
    }, HOLD_MS);
  }

  private cancelHold(): void {
    if (this.holding !== null) {
      clearTimeout(this.holding);
      this.holding = null;
    }
  }

  /**
   * Follows a finger that has taken hold of a marker.
   *
   * Bound once, in the constructor, for the reason above. `pointerdown` only
   * takes hold when the touch actually landed on a marker, so everything else
   * - a scroll, a pinch - passes through untouched.
   */
  private watchForDrags(): void {
    // Before anything else, and not passive: a touch that landed on a marker
    // must not become a scroll. `touch-action` is supposed to say this on
    // its own, and on an SVG child it is not honoured everywhere - which is
    // why a marker could be moved sideways but never down the page. This
    // says it in the one way every browser obeys.
    this.container.addEventListener(
      'touchstart',
      (event) => {
        if (this.markerUnder(event.target) !== null) {
          event.preventDefault();
        }
      },
      { passive: false },
    );
    this.container.addEventListener(
      'touchmove',
      (event) => {
        if (this.dragging !== null) {
          event.preventDefault();
        }
      },
      { passive: false },
    );
    this.container.addEventListener('pointerdown', (event) => this.beginDrag(event));
    this.container.addEventListener('pointermove', (event) => this.continueDrag(event));
    this.container.addEventListener('pointerup', (event) => this.endDrag(event));
    this.container.addEventListener('pointercancel', () => {
      this.swipe = null;
      this.tapFrom = null;
      this.cancelHold();
      this.dragging = null;
      this.paintPassage();
    });
  }

  private beginDrag(event: PointerEvent): void {
    // Before anything else. A switch is a drawn thing with an edge to aim
    // at, so what the browser says was touched is the exact answer - and a
    // press on one is not a tap on the music, a hold on a bar, or a page
    // being swiped.
    const hand = this.handUnder(event.target);
    if (hand !== null) {
      this.pressedHand = { pointerId: event.pointerId, staffNumber: hand };
      return;
    }
    const passage = this.passage;
    const touched = this.markerUnder(event.target);
    const point = this.drawingPointOf(event);
    // What the browser says was touched, and only then what the arithmetic
    // makes of the coordinates. The drawn handle and the area that answers
    // for it are the same shape, so the first answer is exact.
    const edge =
      touched?.edge ??
      (passage === null || point === null
        ? null
        : gripAt(
            bracketShapes(this.measuresHere(), passage.fromMeasureIndex, passage.toMeasureIndex),
            point,
          ));
    if (edge === null || passage === null) {
      // Not a marker, so it may be a page being turned. The markers come
      // first: a finger that landed on one is moving it, whatever else it
      // then does.
      this.swipe = this.paged
        ? { pointerId: event.pointerId, from: { x: event.clientX, y: event.clientY } }
        : null;
      this.tapFrom = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      this.watchForAHold(event);
      return;
    }
    // Held for the whole gesture, so a finger that wanders off the marker -
    // which is most of them - goes on moving it instead of being dropped.
    this.container.setPointerCapture?.(event.pointerId);
    // For the mouse. A touch screen has already decided, from the
    // `touch-action` of the shape the finger landed on.
    event.preventDefault();
    this.dragging = {
      edge,
      pointerId: event.pointerId,
      passage,
      from: { x: event.clientX, y: event.clientY },
      grip: touched?.end ?? null,
      overshot: false,
    };
    this.watchForAMarkerHold(event, edge);
  }

  private continueDrag(event: PointerEvent): void {
    this.turnIfDraggedOffThePage(event);
    const began = this.tapFrom ?? this.dragging?.from ?? null;
    if (
      began !== null &&
      Math.hypot(event.clientX - began.x, event.clientY - began.y) > TAP_SLACK_PX
    ) {
      // Moving is not pointing - of a bar or of a marker. A finger that has
      // set off with a marker is dragging it, and the wait it started when it
      // landed must not go off in the middle of that.
      this.cancelHold();
    }
    const moved = this.draggedTo(event);
    if (moved === null) {
      return;
    }
    event.preventDefault();
    this.dragging = { ...this.dragging as PassageDrag, passage: moved };
    this.paintPassage();
  }

  private endDrag(event: PointerEvent): void {
    const pressed = this.pressedHand;
    if (pressed !== null && pressed.pointerId === event.pointerId) {
      this.pressedHand = null;
      // Only if the finger is still on it: one that travelled was reaching
      // for something else, even if it did not reach it.
      if (this.handUnder(event.target) === pressed.staffNumber) {
        for (const listener of [...this.handListeners]) {
          listener(pressed.staffNumber);
        }
      }
      return;
    }
    const swipe = this.swipe;
    this.swipe = null;
    if (swipe !== null && swipe.pointerId === event.pointerId) {
      const turned = swipeDirection(swipe.from, { x: event.clientX, y: event.clientY });
      if (turned !== 0) {
        this.turnPages(turned);
        this.tapFrom = null;
        return;
      }
    }

    const began = this.tapFrom;
    this.tapFrom = null;
    this.cancelHold();
    if (began !== null && began.pointerId === event.pointerId) {
      // A tap and not a drag: a finger that stayed put. Anything that moved
      // was reaching for something, even if it did not reach it.
      const wandered = Math.hypot(event.clientX - began.x, event.clientY - began.y);
      if (wandered <= TAP_SLACK_PX) {
        for (const listener of [...this.tapListeners]) {
          listener();
        }
      }
      return;
    }

    const drag = this.dragging;
    const tapped = this.tappedGrip(event, drag);
    const moved = tapped ?? this.draggedTo(event);
    this.dragging = null;
    if (moved === null || drag === undefined || drag === null) {
      return;
    }
    this.container.releasePointerCapture?.(event.pointerId);
    this.passage = moved;
    this.paintPassage();
    for (const listener of [...this.passageListeners]) {
      listener(moved);
    }
  }

  /**
   * The passage one bar out or in, when a handle was tapped rather than
   * dragged.
   *
   * A finger that stayed put on a handle meant the button; anything that
   * travelled meant the handle, even if it did not travel far. Which is why
   * this is asked before the drag: at nought pixels of movement a drag says
   * "put it back where it already was", and that is not what was meant.
   */
  private tappedGrip(event: PointerEvent, drag: PassageDrag | null): DrawnPassage | null {
    if (drag === null) {
      return null;
    }
    const wandered = Math.hypot(event.clientX - drag.from.x, event.clientY - drag.from.y);
    if (wandered > TAP_SLACK_PX) {
      return null;
    }
    const shapes = bracketShapes(
      this.measuresHere(),
      drag.passage.fromMeasureIndex,
      drag.passage.toMeasureIndex,
    );
    const point = this.drawingPointOf(event);
    const grip =
      drag.grip === null
        ? point === null
          ? null
          : gripUnderPointer(gripsOf(shapes), point)
        : (gripsOf(shapes).find(
            (each) => each.edge === drag.edge && each.end === drag.grip,
          ) ?? null);
    if (grip === null) {
      return null;
    }
    const next = passageAfterTap(
      { fromIndex: drag.passage.fromMeasureIndex, toIndex: drag.passage.toMeasureIndex },
      grip,
    );
    return { fromMeasureIndex: next.fromIndex, toMeasureIndex: next.toIndex };
  }

  /**
   * Turns the page when a marker is dragged off the side of it.
   *
   * A passage that runs onto the next page cannot be chosen otherwise: the
   * marker reaches the edge and stops, because the bar it is being taken to
   * is not on the page. Dragging past the edge is the reader saying "further
   * than this", and it is the same gesture as carrying a finger off the side
   * of a list.
   *
   * The turn does not repeat while the finger stays out there: the new page
   * occupies the same part of the screen, so the pointer is inside it again
   * the moment it arrives.
   */
  private turnIfDraggedOffThePage(event: PointerEvent): void {
    const drag = this.dragging;
    if (!this.paged || drag === null) {
      return;
    }
    const point = this.drawingPointOf(event);
    const sheet = this.currentSheet();
    if (point === null || sheet === null) {
      return;
    }

    // Into the margin the engraver leaves at the edge of the page, which is
    // somewhere a finger can actually reach - the page is as wide as the
    // screen, so nothing can be dragged beyond it. Which handle is being
    // held has nothing to do with it: either of them can want the next page.
    const beyond = pageTurnForDrag(this.measuresHere(), point, intrinsicSize(sheet).width);
    if (beyond !== 0 && !drag.overshot) {
      this.dragging = { ...drag, overshot: true };
      this.turnPages(beyond);
      return;
    }
    // Only on the way in. Held out there, the finger would be past the new
    // page's last bar too the moment it arrived, and the reader would watch
    // the whole piece flip by; coming back inside arms it again, so going
    // several pages is several small movements rather than one long wait.
    if (beyond === 0 && drag.overshot) {
      this.dragging = { ...drag, overshot: false };
    }
  }

  /** Where this event puts the passage, or `null` when nothing is held. */
  private draggedTo(event: PointerEvent): DrawnPassage | null {
    const drag = this.dragging;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return null;
    }
    const point = this.drawingPointOf(event);
    if (point === null) {
      return null;
    }
    const landedOn = measureForDrag(this.measuresHere(), point, drag.edge);
    if (landedOn === null) {
      return null;
    }
    const next = passageAfterDrag(
      { fromIndex: drag.passage.fromMeasureIndex, toIndex: drag.passage.toMeasureIndex },
      drag.edge,
      landedOn,
    );
    return { fromMeasureIndex: next.fromIndex, toMeasureIndex: next.toIndex };
  }

  /** A touch, in the pixels the engraving was measured in. */
  private drawingPointOf(event: PointerEvent): { x: number; y: number } | null {
    // The sheet being read, not the first one. Every page is an SVG of its
    // own with its own coordinates, so mapping a touch through a page that
    // is hidden gives an answer about music nobody is looking at.
    const svg = this.currentSheet();
    if (svg === null) {
      return null;
    }

    // The browser's own answer, and the only one that is always right.
    //
    // Working it out by hand - the box on screen against the size the
    // engraver drew - assumes those two are a plain ratio of one another,
    // and they are not: a `viewBox`, a transform anywhere up the tree, or
    // the page being zoomed all break it, and the error grows with distance
    // from the origin. Which is exactly how the reader found it: the handles
    // at the top were nearly right, the ones lower down had to be pressed
    // below themselves, and the right-hand marker - furthest of all from the
    // corner - could not be taken hold of at all.
    const matrix = svg.getScreenCTM?.();
    if (matrix !== null && matrix !== undefined) {
      const inside = new DOMPointReadOnly(event.clientX, event.clientY).matrixTransform(
        matrix.inverse(),
      );
      return { x: inside.x, y: inside.y };
    }

    // No layout to ask - which is every test that runs the engraver without a
    // browser. The ratio is right whenever the drawing is shown whole and
    // unrotated, which is what those tests set up.
    const box = svg.getBoundingClientRect();
    return toDrawingPoint(
      { left: box.left, top: box.top, width: box.width, height: box.height },
      intrinsicSize(svg),
      { x: event.clientX, y: event.clientY },
    );
  }

  scrollToStart(): void {
    if (this.paged) {
      // Back to the first page, not to a scroll position: the two would
      // otherwise disagree about where the reader is, and the next page turn
      // would go somewhere neither of them expected.
      this.turnToPage(0);
      return;
    }
    // The scrolling box, not the framed one: the frame holds the cover and
    // does not move. Whichever ancestor actually scrolls is the one to ask.
    this.scroller()?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  }

  clear(): void {
    this.osmd?.clear();
    this.forgetSheets();
    this.pageAt = 0;
    this.swipe = null;
    this.measures = [];
    this.passage = null;
    this.dragging = null;
    this.marks = [];
    this.stepX = new Map();
    this.stepElements = new Map();
    this.faded = new Set();
    this.samples = [];
    this.loaded = false;
  }

  configureOverlay(context: OverlayContext): void {
    this.overlayContext = context;
  }

  showPlayed(note: PlayedNote): void {
    const mark: PlayedMark = {
      stepIndex: note.stepIndex,
      midi: note.midi,
      correct: note.correct,
      offset: note.offset,
    };
    this.marks.push(mark);
    // Only the mark just made, onto the page its own note is drawn on.
    // Redrawing every mark on every page for each note played is work that
    // grows with the run: two hundred notes into a long piece it was two
    // hundred times the drawing for one keystroke, and the trainer stopped
    // answering partway through the score.
    const page = this.pageOfStep(mark.stepIndex);
    const sheet = this.sheets[page];
    const geometry = this.geometryByPage.get(page) ?? null;
    if (sheet === undefined || geometry === null) {
      return;
    }
    this.drawMarks([mark], this.overlayGroupFor(sheet), geometry);
  }

  clearPlayed(): void {
    this.marks = [];
    this.paintOverlay();
  }

  fadePassed(stepIndex: number): void {
    this.faded.add(stepIndex);
    for (const element of this.stepElements.get(stepIndex) ?? []) {
      element.classList.add(FADED_CLASS);
    }
  }

  clearFaded(): void {
    for (const stepIndex of this.faded) {
      for (const element of this.stepElements.get(stepIndex) ?? []) {
        element.classList.remove(FADED_CLASS);
      }
    }
    this.faded.clear();
  }

  /** Re-dims everything already passed, after the page has been redrawn. */
  private paintFaded(): void {
    for (const stepIndex of this.faded) {
      for (const element of this.stepElements.get(stepIndex) ?? []) {
        element.classList.add(FADED_CLASS);
      }
    }
  }

  /** Everything drawn over the engraving, rebuilt from the marks. */
  /**
   * Draws what was played, page by page.
   *
   * Per page and not once over the whole score, because every page is an SVG
   * of its own whose coordinates start again at nought. A mark for a note on
   * the second page, drawn into the first page's sheet, is a mark on the
   * wrong music - and on the page nobody is looking at.
   */
  private paintOverlay(): void {
    const context = this.overlayContext;
    // Sorted once, not filtered once per page: this runs on every note the
    // reader plays.
    const byPage = new Map<number, PlayedMark[]>();
    for (const mark of this.marks) {
      const page = this.pageOfStep(mark.stepIndex);
      byPage.set(page, [...(byPage.get(page) ?? []), mark]);
    }
    for (const [at, sheet] of this.sheets.entries()) {
      const group = this.overlayGroupFor(sheet);
      while (group.firstChild !== null) {
        group.firstChild.remove();
      }
      const marks = byPage.get(at) ?? [];
      // The heights this page was measured at, and no other: at a page break
      // the nearest note in the same step is on the sheet before, and taking
      // its height would put the mark a page out.
      const geometry = this.geometryByPage.get(at) ?? null;
      if (context === null || geometry === null || marks.length === 0) {
        continue;
      }
      this.drawMarks(marks, group, geometry);
    }
  }

  /**
   * Draws marks onto a page's overlay, leaving what is already there.
   *
   * Every mark is worked out on its own - none of them depends on another -
   * so the one that has just been played can be added without redrawing the
   * ones before it.
   */
  private drawMarks(
    marks: readonly PlayedMark[],
    group: SVGGElement,
    geometry: NonNullable<ReturnType<typeof fitStaffGeometry>>,
  ): void {
    const context = this.overlayContext;
    if (context === null || marks.length === 0) {
      return;
    }
    const shapes = buildOverlayShapes(marks, {
      geometry,
      stepX: this.stepX,
      clefAt: context.clefAt,
      keyAt: context.keyAt,
    });
    for (const shape of shapes) {
      group.append(this.createShape(shape, group.ownerDocument));
    }
  }

  /** The page a step's notes were drawn on. */
  private pageOfStep(stepIndex: number): number {
    return this.stepPage.get(stepIndex) ?? 0;
  }

  /**
   * Which system of the engraving this was drawn in, numbered as met.
   *
   * The engraver's own system object is the identity; the number is ours, so
   * that a sample can carry it and two samples can be compared. Numbered in
   * walk order, which is the order the systems run down the page.
   */
  private systemNumberOf(note: DrawnNote): number {
    const system: object | undefined =
      note.parentVoiceEntry?.parentStaffEntry?.parentMeasure?.ParentMusicSystem;
    if (system === undefined) {
      return -1;
    }
    const known = this.systemNumbers.get(system);
    if (known !== undefined) {
      return known;
    }
    const next = this.systemNumbers.size;
    this.systemNumbers.set(system, next);
    return next;
  }

  /** The page the engraver says it laid something out on, zero-based. */
  private pageOfGraphical(note: DrawnNote): number | null {
    const number =
      note.parentVoiceEntry?.parentStaffEntry?.parentMeasure?.ParentMusicSystem?.Parent
        ?.PageNumber;
    // The engraver numbers its pages from one; every page index here is from
    // nought, because it indexes the sheets it drew.
    return typeof number === 'number' && number >= 1 ? number - 1 : null;
  }

  /** The page an element belongs to, by the sheet it is drawn in. */
  private pageOfElement(element: Element): number {
    const sheet = element.closest('svg');
    const at = sheet === null ? -1 : this.sheets.indexOf(sheet as SVGSVGElement);
    return at < 0 ? 0 : at;
  }

  private createShape(shape: OverlayShape, doc: Document): SVGElement {
    const colourClass = !shape.correct
      ? 'played--wrong'
      : shape.looseTiming
        ? 'played--loose'
        : 'played--correct';
    switch (shape.kind) {
      case 'notehead': {
        const element = doc.createElementNS(SVG_NAMESPACE, 'ellipse');
        element.setAttribute('cx', String(shape.x));
        element.setAttribute('cy', String(shape.y));
        element.setAttribute('rx', String(shape.radiusX));
        element.setAttribute('ry', String(shape.radiusY));
        element.setAttribute('class', `played-note ${colourClass}`);
        return element;
      }
      case 'ledger': {
        const element = doc.createElementNS(SVG_NAMESPACE, 'line');
        element.setAttribute('x1', String(shape.x1));
        element.setAttribute('x2', String(shape.x2));
        element.setAttribute('y1', String(shape.y));
        element.setAttribute('y2', String(shape.y));
        element.setAttribute('class', `played-ledger ${colourClass}`);
        return element;
      }
      case 'accidental': {
        const element = doc.createElementNS(SVG_NAMESPACE, 'text');
        element.setAttribute('x', String(shape.x));
        element.setAttribute('y', String(shape.y));
        element.setAttribute('font-size', String(shape.size));
        element.setAttribute('text-anchor', 'middle');
        element.setAttribute('class', `played-accidental ${colourClass}`);
        element.textContent = shape.text;
        return element;
      }
      default:
        return doc.createElementNS(SVG_NAMESPACE, 'g');
    }
  }

  /**
   * Where the engraver put every bar, asked of its own model.
   *
   * The model and not the drawn SVG, for the same reason the noteheads are:
   * a bounding box has to be measured by a browser that has laid the page
   * out, and the engraver already knows the answer without one. A bar is
   * measured across every staff of its system, so a marker spans both hands
   * rather than hanging off the treble.
   */
  private readMeasures(): DrawnMeasure[] {
    const sheet = (this.osmd as unknown as { GraphicSheet?: DrawnSheet } | null)?.GraphicSheet;
    const byIndex = new Map<number, DrawnMeasure>();
    for (const [pageAt, page] of (sheet?.MusicPages ?? []).entries()) {
      for (const system of page.MusicSystems ?? []) {
        const extent = systemExtent(system);
        if (extent === null) {
          continue;
        }
        for (const staves of system.GraphicalMeasures ?? []) {
          // A grand staff draws each bar once per hand, at the same place
          // across the page; either copy gives the same left and right, and
          // the height belongs to the system rather than to the bar.
          for (const measure of staves ?? []) {
            const box = measure?.PositionAndShape;
            const at = measure?.parentSourceMeasure?.measureListIndex;
            if (box?.AbsolutePosition === undefined || box.Size === undefined || at === undefined) {
              continue;
            }
            const left = box.AbsolutePosition.x * UNITS_TO_PIXELS;
            const right = left + box.Size.width * UNITS_TO_PIXELS;
            const known = byIndex.get(at);
            byIndex.set(at, {
              measureIndex: at,
              page: pageAt,
              left: known === undefined ? left : Math.min(known.left, left),
              right: known === undefined ? right : Math.max(known.right, right),
              top: extent.top,
              bottom: extent.bottom,
            });
          }
        }
      }
    }
    return [...byIndex.values()].sort((left, right) => left.measureIndex - right.measureIndex);
  }

  /**
   * Draws the two markers, or takes them away.
   *
   * Their own group, not the overlay's: a mark for a note the reader played
   * is cleared at the start of every run, and the passage is not.
   */
  private paintPassage(): void {
    for (const sheet of this.sheets) {
      this.passageGroupFor(sheet).replaceChildren();
    }
    this.paintStart();
    this.paintRepeats();
    const showing = this.dragging?.passage ?? this.passage;
    if (showing === null) {
      return;
    }
    for (const bracket of bracketShapes(
      this.measures,
      showing.fromMeasureIndex,
      showing.toMeasureIndex,
    )) {
      // Each marker on the page its own bar is drawn on: a passage can run
      // across a page break, and then the two markers are not on the same
      // sheet at all.
      const sheet = this.sheets[this.pageOfMeasure(bracket.measureIndex)];
      if (sheet === undefined) {
        continue;
      }
      const group = this.passageGroupFor(sheet);
      const doc = sheet.ownerDocument;
      const shape = doc.createElementNS(SVG_NAMESPACE, 'g');
      shape.setAttribute('class', `passage-marker passage-marker--${bracket.edge}`);
      // Which control this is, written on the control. The browser has
      // already worked out what the finger landed on, to a better standard
      // than any arithmetic of ours; asking it is both simpler and right.
      shape.setAttribute('data-edge', bracket.edge);
      // Nothing to take hold of while it is being played. Said on the marker
      // rather than checked when a drag begins, because the browser decides
      // whether a touch will scroll the page from what is under it at the
      // moment it starts - and a marker that swallows the touch and then does
      // nothing is worse than one that never took it.
      if (showing.movable === false) {
        shape.setAttribute('data-locked', 'true');
      }
      // The part the finger is allowed to land on, and the reason it is a
      // shape of its own: a browser decides whether a touch is going to
      // scroll the page *as it begins*, from the `touch-action` of whatever
      // is under it. Setting that when the drag starts is too late by then -
      // which is exactly what happened, and why a marker could be nudged
      // sideways with great care and not moved down the page at all. So the
      // reachable area is drawn, invisibly, and it says so before anyone
      // touches it.
      const hit = doc.createElementNS(SVG_NAMESPACE, 'rect');
      hit.setAttribute('class', 'passage-marker__hit');
      hit.setAttribute('x', String(bracket.x - GRIP_RADIUS_PX));
      hit.setAttribute('y', String(bracket.top - GRIP_RADIUS_PX));
      hit.setAttribute('width', String(GRIP_RADIUS_PX * 2));
      hit.setAttribute(
        'height',
        String(Math.max(0, bracket.bottom - bracket.top) + GRIP_RADIUS_PX * 2),
      );
      shape.append(hit);

      const bar = doc.createElementNS(SVG_NAMESPACE, 'rect');
      bar.setAttribute('class', 'passage-marker__bar');
      bar.setAttribute('x', String(bracket.x - MARKER_WIDTH / 2));
      bar.setAttribute('y', String(bracket.top));
      bar.setAttribute('width', String(MARKER_WIDTH));
      bar.setAttribute('height', String(Math.max(0, bracket.bottom - bracket.top)));
      shape.append(bar);
      if (showing.repeating === true) {
        // The two dots of a repeat bar line, facing into the passage: a
        // musician reads this without being told what it is.
        const facing = bracket.edge === 'start' ? 1 : -1;
        const middle = (bracket.top + bracket.bottom) / 2;
        for (const offset of [-REPEAT_DOT_GAP, REPEAT_DOT_GAP]) {
          const dot = doc.createElementNS(SVG_NAMESPACE, 'circle');
          dot.setAttribute('class', 'passage-marker__dot');
          dot.setAttribute('cx', String(bracket.x + facing * REPEAT_DOT_GAP));
          dot.setAttribute('cy', String(middle + offset));
          dot.setAttribute('r', String(MARKER_WIDTH / 2));
          shape.append(dot);
        }
      }
      // A handle at each end, because the middle of the marker is over the
      // music and a finger there would be covering what it is choosing.
      //
      // They are buttons as well as handles: a tap moves the passage exactly
      // one bar, which is most of what is actually wanted - it was nearly
      // right and wants a bar more at the front. The arrow says which way,
      // so the rule behind it does not have to be remembered.
      for (const grip of showing.movable === false ? [] : gripsOf([bracket])) {
        const circle = doc.createElementNS(SVG_NAMESPACE, 'circle');
        circle.setAttribute('class', `passage-marker__grip passage-marker__grip--${grip.end}`);
        circle.setAttribute('data-end', grip.end);
        circle.setAttribute('cx', String(grip.x));
        circle.setAttribute('cy', String(grip.y));
        circle.setAttribute('r', String(MARKER_GRIP_RADIUS));
        shape.append(circle);

        const arrow = doc.createElementNS(SVG_NAMESPACE, 'path');
        arrow.setAttribute('class', 'passage-marker__arrow');
        const tip = grip.towards * ARROW_REACH;
        arrow.setAttribute(
          'd',
          `M ${grip.x - tip} ${grip.y - ARROW_REACH} L ${grip.x + tip} ${grip.y}` +
            ` L ${grip.x - tip} ${grip.y + ARROW_REACH}`,
        );
        shape.append(arrow);
      }
      group.append(shape);
    }
  }

  /**
   * Draws the bar the music will start from.
   *
   * A quieter line than the passage markers and with nothing to take hold
   * of: it is a sign and not a control, moved by holding a finger on a bar
   * and cleared from the transport bar. It hides with the markers, because
   * a reader who has put the furniture away has put all of it away.
   */
  /**
   * Marks each bar that is a second reading of one already printed.
   *
   * A turning arrow rather than a repeat sign: the repeat has been written
   * out, so nothing here turns back, and a sign saying it did would be the
   * page lying about its own layout. It sits above the bar line, where a
   * rehearsal mark would, and it is deliberately not in the engraver's
   * vocabulary - this is ours, not the writer's.
   */
  private paintRepeats(): void {
    for (const at of this.repeatedBars) {
      // Every page, not the one being read. `measuresHere` is for aiming a
      // touch, where only the page in front of the reader can be hit; a mark
      // is drawn once and then turned to, so asking that question here meant
      // the marks existed only on whichever page happened to be current when
      // this last ran. Turning to any other page showed none - and zooming
      // in, which cuts the piece into more pages, put nearly every repeated
      // bar on a page that had never been painted.
      const measure = this.measures.find((each) => each.measureIndex === at);
      const sheet = measure === undefined ? undefined : this.sheets[measure.page];
      if (measure === undefined || sheet === undefined) {
        continue;
      }
      // Beside the number, and only where there is one. The engraver numbers
      // every second bar or so, and the number is the thing that needs
      // explaining: a bar with no number asks the reader no question. It is
      // also the one place above the staff that is already kept clear, so
      // nothing here can land on a note.
      const number = this.numberTextNear(sheet, measure);
      if (number === null) {
        continue;
      }
      const doc = sheet.ownerDocument;
      const mark = doc.createElementNS(SVG_NAMESPACE, 'g');
      mark.setAttribute('class', 'repeat-mark');
      const x = number.x + number.width + REPEAT_MARK_RADIUS;
      const y = number.y - number.height;

      const ring = doc.createElementNS(SVG_NAMESPACE, 'path');
      ring.setAttribute('class', 'repeat-mark__ring');
      // Most of a circle, open at the top right, so the arrow has somewhere
      // to come from.
      const r = REPEAT_MARK_RADIUS;
      ring.setAttribute(
        'd',
        `M ${x + r} ${y} A ${r} ${r} 0 1 1 ${x} ${y - r}`,
      );
      mark.append(ring);

      const head = doc.createElementNS(SVG_NAMESPACE, 'path');
      head.setAttribute('class', 'repeat-mark__head');
      const tip = r * 0.55;
      head.setAttribute(
        'd',
        `M ${x - tip} ${y - r} L ${x + tip} ${y - r} L ${x} ${y - r + tip} Z`,
      );
      mark.append(head);

      this.passageGroupFor(sheet).append(mark);
    }
  }

  /**
   * The bar number the engraver drew for this bar, if it drew one.
   *
   * Found by where it is rather than by what it says: a score written out
   * from its repeats says "twenty" twice, which is the whole reason the mark
   * exists, so the text itself cannot tell the two apart.
   */
  private numberTextNear(
    sheet: SVGSVGElement,
    measure: DrawnMeasure,
  ): { x: number; y: number; width: number; height: number } | null {
    for (const text of sheet.querySelectorAll('text')) {
      if (!/^\d+$/.test(text.textContent ?? '')) {
        continue;
      }
      const x = Number.parseFloat(text.getAttribute('x') ?? '');
      const y = Number.parseFloat(text.getAttribute('y') ?? '');
      if (
        Math.abs(x - measure.left) > NUMBER_REACH ||
        Math.abs(y - measure.top) > NUMBER_REACH
      ) {
        continue;
      }
      const height = Number.parseFloat((text.getAttribute('font-size') ?? '15').replace(/[a-z]+$/i, ''));
      return {
        x,
        y,
        // Its own width, near enough: the digits are what the mark stands
        // clear of, and a glyph is about half its height across.
        width: (text.textContent?.length ?? 1) * height * 0.5,
        height: Number.isFinite(height) ? height : 15,
      };
    }
    return null;
  }

  private paintStart(): void {
    const at = this.startMeasure;
    // All of them, for the reason the repeat marks are: the reader puts their
    // place on a bar and then turns the page away from it, and the mark has
    // to be there when they turn back.
    const measure = at === null ? undefined : this.measures.find(
      (each) => each.measureIndex === at,
    );
    if (measure === undefined || this.passage === null) {
      return;
    }
    const sheet = this.sheets[measure.page];
    if (sheet === undefined) {
      return;
    }
    const doc = sheet.ownerDocument;
    const group = this.passageGroupFor(sheet);
    const shape = doc.createElementNS(SVG_NAMESPACE, 'g');
    shape.setAttribute('class', 'start-marker');

    const bar = doc.createElementNS(SVG_NAMESPACE, 'rect');
    bar.setAttribute('class', 'start-marker__bar');
    bar.setAttribute('x', String(measure.left - START_WIDTH / 2));
    bar.setAttribute('y', String(measure.top));
    bar.setAttribute('width', String(START_WIDTH));
    bar.setAttribute('height', String(Math.max(0, measure.bottom - measure.top)));
    shape.append(bar);

    // A small flag at the top, pointing the way the music will go.
    const flag = doc.createElementNS(SVG_NAMESPACE, 'path');
    flag.setAttribute('class', 'start-marker__flag');
    const top = measure.top;
    flag.setAttribute(
      'd',
      `M ${measure.left} ${top} L ${measure.left + START_FLAG} ${top + START_FLAG / 2}` +
        ` L ${measure.left} ${top + START_FLAG} Z`,
    );
    shape.append(flag);
    group.append(shape);
  }

  /** The marker layer inside one page's sheet, made if it is not there yet. */
  /**
   * Where each staff of each system was drawn, page by page.
   *
   * Read off the five printed lines rather than out of the engraver's model.
   * The model's box for a staff is drawn round what is *on* it - stems,
   * beams, an inner voice hanging below - so a switch centred in that box
   * sat below the lines, and by a different amount on each hand. The lines
   * themselves are where the staff is, by definition.
   *
   * Ledger lines are drawn in the same group and have to be told from the
   * staff's own: a ledger is a couple of note-widths and a staff line runs
   * the width of the measure, so width tells them apart. Middle C in the
   * treble is exactly this case, and it is the first note of half the
   * fixtures here.
   */
  private readStaves(): DrawnStaff[] {
    const staves: DrawnStaff[] = [];
    for (const [pageAt, sheet] of this.sheets.entries()) {
      const drawn = [...sheet.querySelectorAll('.staffline')];
      for (const [at, group] of drawn.entries()) {
        const lines = horizontalRules(group);
        const widest = Math.max(...lines.map((line) => line.to - line.from), 0);
        const full = lines.filter((line) => line.to - line.from >= widest / 2);
        if (full.length === 0) {
          continue;
        }
        const ys = full.map((line) => line.y);
        staves.push({
          // Counted from the top down within each system, which is how the
          // score numbers them and how the reader would: the right hand is
          // the upper staff.
          staffNumber: (at % Math.max(1, this.stavesPerSystem())) + 1,
          page: pageAt,
          left: Math.min(...full.map((line) => line.from)),
          top: Math.min(...ys),
          bottom: Math.max(...ys),
        });
      }
    }
    return staves;
  }

  /** How many staves each system carries, which is the same for every one. */
  private stavesPerSystem(): number {
    const sheet = (this.osmd as unknown as { GraphicSheet?: DrawnSheet } | null)?.GraphicSheet;
    for (const page of sheet?.MusicPages ?? []) {
      for (const system of page.MusicSystems ?? []) {
        const count = (system.StaffLines ?? []).length;
        if (count > 0) {
          return count;
        }
      }
    }
    return 1;
  }

  showHands(playing: readonly number[]): void {
    this.handsPlaying = [...playing];
    this.paintHands();
  }

  onHandToggled(listener: (staffNumber: number) => void): () => void {
    this.handListeners.push(listener);
    return () => {
      this.handListeners = this.handListeners.filter((each) => each !== listener);
    };
  }

  /**
   * A switch beside every staff, on every system of every page.
   *
   * Repeated the way a clef is repeated, so there is one within reach of
   * wherever the reader's eye happens to be - a single switch at the top of
   * the page would be a switch to go and find.
   *
   * Outside the staff rather than over it: the left margin holds the brace
   * and nothing else, so nothing here can land on a note.
   */
  private paintHands(): void {
    for (const sheet of this.sheets) {
      this.handGroupFor(sheet).replaceChildren();
    }
    if (this.handsPlaying.length === 0) {
      return;
    }
    for (const staff of this.readStaves()) {
      const sheet = this.sheets[staff.page];
      if (sheet === undefined) {
        continue;
      }
      const doc = sheet.ownerDocument;
      const on = this.handsPlaying.includes(staff.staffNumber);
      const height = Math.max(0, staff.bottom - staff.top);
      const group = doc.createElementNS(SVG_NAMESPACE, 'g');
      group.setAttribute('class', 'hand-switch');
      group.dataset['staff'] = String(staff.staffNumber);
      group.dataset['on'] = String(on);

      const hit = doc.createElementNS(SVG_NAMESPACE, 'rect');
      hit.setAttribute('class', 'hand-switch__hit');
      hit.setAttribute('x', String(staff.left - HAND_SWITCH_GAP - HAND_SWITCH_WIDTH));
      hit.setAttribute('y', String(staff.top));
      hit.setAttribute('width', String(HAND_SWITCH_WIDTH));
      hit.setAttribute('height', String(height));
      group.append(hit);

      const tab = doc.createElementNS(SVG_NAMESPACE, 'rect');
      tab.setAttribute('class', 'hand-switch__tab');
      tab.setAttribute('x', String(staff.left - HAND_SWITCH_GAP - HAND_SWITCH_WIDTH / 2));
      // Centred on the staff rather than measured from it, so both switches
      // are the same switch however tall the engraver drew their staves.
      tab.setAttribute('y', String(staff.top + height / 2 - HAND_SWITCH_HEIGHT / 2));
      tab.setAttribute('width', String(HAND_SWITCH_WIDTH / 2));
      tab.setAttribute('height', String(HAND_SWITCH_HEIGHT));
      tab.setAttribute('rx', String(HAND_SWITCH_WIDTH / 6));
      group.append(tab);

      this.handGroupFor(sheet).append(group);
    }
  }

  /**
   * Its own layer, and under the passage markers.
   *
   * The passage layer is emptied and redrawn every time a marker moves, and
   * these do not move at all: they belong to the staves, which only change
   * when the music is engraved again.
   */
  private handGroupFor(sheet: SVGSVGElement): SVGGElement {
    const found = sheet.querySelector('g.hand-switches');
    if (found !== null) {
      return found as SVGGElement;
    }
    const group = sheet.ownerDocument.createElementNS(SVG_NAMESPACE, 'g');
    group.setAttribute('class', 'hand-switches');
    sheet.append(group);
    return group;
  }

  private passageGroupFor(sheet: SVGSVGElement): SVGGElement {
    const found = sheet.querySelector('g.passage-markers');
    if (found !== null) {
      return found as SVGGElement;
    }
    const group = sheet.ownerDocument.createElementNS(SVG_NAMESPACE, 'g');
    group.setAttribute('class', 'passage-markers');
    sheet.append(group);
    return group;
  }

  /** The page a bar was drawn on. */
  private pageOfMeasure(measureIndex: number): number {
    return this.measures.find((measure) => measure.measureIndex === measureIndex)?.page ?? 0;
  }


  /**
   * The overlay layer inside one page's sheet, made if it is not there yet.
   *
   * One per page rather than one for the score: what is drawn on a page has
   * to live in that page's SVG or it is drawn in the wrong coordinates on
   * the wrong sheet.
   */
  /**
   * The layer a page's marks are drawn into, kept rather than looked up.
   *
   * Asking the page for it by class walks the whole drawing, and the layer is
   * appended last so the walk never ends early: on a score of twenty-odd
   * thousand elements that was the entire cost of showing a played note, paid
   * again on every keystroke.
   *
   * Keyed by the page itself, so an engraving that replaces the pages leaves
   * the old entries unreachable and the new pages simply have none.
   */
  private overlayGroupFor(sheet: SVGSVGElement): SVGGElement {
    const kept = this.overlayGroups.get(sheet);
    if (kept !== undefined && kept.parentNode === sheet) {
      return kept;
    }
    const group = sheet.ownerDocument.createElementNS(SVG_NAMESPACE, 'g');
    group.setAttribute('class', 'played-overlay');
    sheet.append(group);
    this.overlayGroups.set(sheet, group);
    return group;
  }


  /**
   * Records where the engraver put each step, and the pitches it drew there.
   *
   * Walking the cursor is the only way to ask, so the visible cursor is walked
   * once and then put back where it was.
   */
  private indexDrawnNotes(): void {
    this.walking = true;
    try {
      this.walkDrawnNotes();
    } finally {
      this.walking = false;
    }
  }

  private walkDrawnNotes(): void {
    const cursor = this.osmd?.cursor;
    if (cursor === undefined || cursor === null) {
      this.stepX = new Map();
      this.samples = [];
      return;
    }

    const restoreTo = this.navigator.position;
    const stepX = new Map<number, number>();
    const samples: DrawnNoteSample[] = [];
    this.stepElements = new Map();
    this.systemNumbers = new Map();

    cursor.reset();
    let index = 0;
    let guard = 10_000;
    while (!cursor.iterator.EndReached && guard > 0) {
      guard -= 1;
      this.readStep(cursor, index, stepX, samples);
      index += 1;
      cursor.next();
    }

    this.carryPagesForward(index);
    this.stepX = stepX;
    this.samples = samples;
    this.measureStaffHeights();
    this.attachNoteFurniture();
    this.navigator.reset();
    this.navigator.moveTo(restoreTo);
  }

  /**
   * Gives the steps that could say nothing the page of the one before them.
   *
   * Two whole bars of rest in a row are drawn as a single multi-rest, so the
   * second bar has no graphical object at all to ask. A step the engraver
   * cannot place is on the page the music had reached when it got there,
   * which is the only answer a forward walk can give and the right one: a
   * page break happens at a bar the engraver *did* draw.
   */
  private carryPagesForward(steps: number): void {
    let last = 0;
    for (let index = 0; index < steps; index += 1) {
      const known = this.stepPage.get(index);
      if (known === undefined) {
        this.stepPage.set(index, last);
        continue;
      }
      last = known;
    }
  }

  /**
   * Measures each page's staff, once per engraving.
   *
   * A page's own notes and no others: at a page break the nearest note in
   * the same step is on the sheet before, and its height belongs to that
   * page's drawing rather than this one's.
   */
  private measureStaffHeights(): void {
    const byPage = new Map<number, DrawnNoteSample[]>();
    for (const sample of this.samples) {
      byPage.set(sample.page, [...(byPage.get(sample.page) ?? []), sample]);
    }
    this.geometryByPage = new Map();
    for (const [page, samples] of byPage) {
      this.geometryByPage.set(page, fitStaffGeometry(samples));
    }
  }

  /**
   * Gives each step the stems, ledger lines and beams that belong to it.
   *
   * The cursor hands back a notehead's own group and nothing else, so fading
   * a step left its stem standing and its beam floating over the gap - which
   * reads as sixteenths that lost their flags rather than as a page emptying.
   *
   * VexFlow's ids are the link: a note drawn as `vf-auto1003` owns
   * `vf-auto1003-stem` and `vf-auto1003ledgers`, and any beam beginning at it
   * is `vf-auto1003-beam0`.
   */
  private attachNoteFurniture(): void {
    const stepOfNote = new Map<string, number>();
    for (const [stepIndex, elements] of this.stepElements) {
      for (const element of elements) {
        if (element.id !== '') {
          stepOfNote.set(element.id, stepIndex);
        }
      }
    }

    const add = (stepIndex: number, element: SVGGElement | null): void => {
      if (element === null) {
        return;
      }
      const bucket = this.stepElements.get(stepIndex) ?? [];
      bucket.push(element);
      this.stepElements.set(stepIndex, bucket);
    };

    // One pass over the drawing for each kind of furniture, and a map to look
    // them up in. Asking the document to find one element at a time cost the
    // length of the score times the size of it - thousands of full scans on a
    // long piece, every time it was engraved.
    //
    // The whole container rather than its first sheet, too: a paged score is
    // several of them, and stems on every page but the first were being left
    // behind by the notes they belong to.
    const byId = (selector: string): Map<string, SVGGElement> => {
      const found = new Map<string, SVGGElement>();
      for (const element of this.container.querySelectorAll<SVGGElement>(selector)) {
        found.set(element.id, element);
      }
      return found;
    };
    const stems = byId('g.vf-stem');
    const ledgers = byId('g.vf-ledgers');
    for (const [id, stepIndex] of stepOfNote) {
      add(stepIndex, stems.get(`${id}-stem`) ?? null);
      add(stepIndex, ledgers.get(`${id}ledgers`) ?? null);
    }

    const notes = byId('g.vf-stavenote');
    const inMeasures = new Map<Element, MeasureNotes>();
    for (const beam of this.container.querySelectorAll<SVGGElement>('g.vf-beam')) {
      const owner = beam.id.replace(/-beam\d+$/, '');
      const lastStep = this.lastStepOfBeam(owner, notes, inMeasures, stepOfNote);
      if (lastStep !== null) {
        // The *last* note of the group, not its first: a beam that left with
        // the note it starts on would strand the notes it still joins.
        add(lastStep, beam);
      }
    }
  }

  /**
   * The step the last note under a beam belongs to.
   *
   * The group runs from its owning note up to the next note that owns a beam,
   * or to the end of that measure. A group followed by unbeamed notes reaches
   * one note too far and the beam fades a moment late, which is the safe
   * direction to be wrong in: a note keeping its beam still reads correctly,
   * while a beam without notes does not.
   */
  private lastStepOfBeam(
    owner: string,
    notesById: ReadonlyMap<string, SVGGElement>,
    inMeasures: Map<Element, MeasureNotes>,
    stepOfNote: ReadonlyMap<string, number>,
  ): number | null {
    const start = notesById.get(owner) ?? null;
    const measure = start?.parentElement ?? null;
    if (start === null || measure === null) {
      return null;
    }
    // Read once per measure and kept: a bar's notes and its beam owners are
    // the same answer for every beam in it, and there may be many.
    let inMeasure = inMeasures.get(measure);
    if (inMeasure === undefined) {
      const notes = [...measure.querySelectorAll('g.vf-stavenote')];
      inMeasure = {
        notes,
        at: new Map(notes.map((note, index) => [note, index])),
        owners: new Set(
          [...measure.querySelectorAll('g.vf-beam')].map((beam) =>
            beam.id.replace(/-beam\d+$/, ''),
          ),
        ),
      };
      inMeasures.set(measure, inMeasure);
    }

    const from = inMeasure.at.get(start) ?? -1;
    let last: number | null = null;
    for (let at = from; at >= 0 && at < inMeasure.notes.length; at += 1) {
      const note = inMeasure.notes[at];
      if (note === undefined || (at > from && inMeasure.owners.has(note.id))) {
        break;
      }
      const step = stepOfNote.get(note.id);
      if (step !== undefined) {
        last = last === null ? step : Math.max(last, step);
      }
    }
    return last;
  }

  private readStep(
    cursor: NonNullable<OpenSheetMusicDisplay['cursor']>,
    stepIndex: number,
    stepX: Map<number, number>,
    samples: DrawnNoteSample[],
  ): void {
    try {
      for (const graphical of cursor.GNotesUnderCursor()) {
        const note = graphical as unknown as DrawnNote;
        const position = note.PositionAndShape?.AbsolutePosition;
        if (position === undefined) {
          continue;
        }

        if (!stepX.has(stepIndex)) {
          stepX.set(stepIndex, position.x * UNITS_TO_PIXELS);
        }

        const drawn = typeof note.getSVGGElement === 'function' ? note.getSVGGElement() : null;
        if (drawn !== null && drawn !== undefined) {
          const bucket = this.stepElements.get(stepIndex) ?? [];
          bucket.push(drawn);
          this.stepElements.set(stepIndex, bucket);
          // Which sheet the engraver put it on, read off the drawing rather
          // than worked out: a step's page is the page its notes are on.
          this.stepPage.set(stepIndex, this.pageOfElement(drawn));
        } else if (!this.stepPage.has(stepIndex)) {
          // A rest gets no group of its own in the SVG, so there is nothing
          // to look the page up from - and skipped for that, a bar of rests
          // belonged to no page at all, which reads as page one. The page
          // then turned back to the beginning under a reader in the middle of
          // the piece, and the marker went with it. The engraver knows where
          // it laid the bar out, so it is asked.
          const page = this.pageOfGraphical(note);
          if (page !== null) {
            this.stepPage.set(stepIndex, page);
          }
        }

        // Everything below is about *pitch*, which a rest has none of: it
        // takes a cursor position and a place on the page, but no staff
        // position for the overlay geometry to measure from.
        const pitch = note.sourceNote?.pitch;
        if (pitch === undefined || pitch === null) {
          continue;
        }

        const diatonicIndex = diatonicIndexOf(pitch.FundamentalNote ?? -1, pitch.Octave ?? 0);
        if (diatonicIndex === null) {
          continue;
        }
        samples.push({
          stepIndex,
          page: this.stepPage.get(stepIndex) ?? 0,
          system: this.systemNumberOf(note),
          staffNumber: note.sourceNote?.parentStaffEntry?.parentStaff?.id ?? 1,
          diatonicIndex,
          y: position.y * UNITS_TO_PIXELS,
        });
      }
    } catch {
      // A step the engraver could not describe simply contributes nothing.
    }
  }

  private async ensureEngraver(): Promise<OpenSheetMusicDisplay> {
    if (this.osmd !== null) {
      return this.osmd;
    }
    const { OpenSheetMusicDisplay: Engraver } = await import('opensheetmusicdisplay');
    const osmd = new Engraver(this.container, {
      autoResize: false,
      backend: 'svg',
      drawTitle: this.options.drawTitle ?? false,
      drawSubtitle: false,
      drawComposer: false,
      drawPartNames: false,
      drawMetronomeMarks: true,
      // The numbers the file states, which for a passage are the numbers of
      // the score it was cut out of. Drawn from 1 they would say "an eight-bar
      // piece" about bars 20 to 27, and nothing else on the page corrects it.
      drawMeasureNumbers: true,
      useXMLMeasureNumbers: true,
      autoBeam: true,
      followCursor: true,
      disableCursor: false,
      cursorsOptions: [
        {
          type: 0,
          color: this.options.cursorColor ?? '#3b82f6',
          alpha: 0.45,
          follow: true,
        },
      ],
    });
    osmd.zoom = this.currentZoom;
    this.osmd = osmd;
    return osmd;
  }
}

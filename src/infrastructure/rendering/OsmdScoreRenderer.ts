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
  PlayedNote,
} from '../../application/ports/IScoreRenderer.js';
import {
  bracketShapes,
  gripAt,
  gripsOf,
  gripUnderPointer,
  GRIP_RADIUS_PX,
  passageAfterTap,
  measureForDrag,
  passageAfterDrag,
  toDrawingPoint,
  type DrawnMeasure,
  type GripEnd,
  type PassageEdge,
} from './passageBrackets.js';
import {
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
/** How far the page number sits from the corner of the page, in pixels. */
const PAGE_NUMBER_INSET = 18;
/** Half the width of the arrow drawn inside a handle. */
const ARROW_REACH = 3.5;

/** As much of the engraver's own model as the markers need to read. */
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
  /** True while the cursor is being walked to find out what is where. */
  private walking = false;
  private faded = new Set<number>();
  private samples: DrawnNoteSample[] = [];
  private marks: PlayedMark[] = [];
  private overlayContext: OverlayContext | null = null;

  /** Where the engraver put each bar, and the markers standing on them. */
  private measures: DrawnMeasure[] = [];
  private passage: DrawnPassage | null = null;
  private passageListeners: ((passage: DrawnPassage) => void)[] = [];
  private dragging: PassageDrag | null = null;

  /** The column cut into pages, and which one is being read. */
  private paged = false;
  private pageAt = 0;
  private pageListeners: ((state: ScorePageState) => void)[] = [];
  private swipe: PageSwipe | null = null;
  private tapListeners: (() => void)[] = [];
  private heldListeners: ((stepIndex: number) => void)[] = [];
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
    this.navigator.onMoved((stepIndex) => this.followCursor(stepIndex));
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
    await osmd.load(musicXml);
    osmd.zoom = this.currentZoom;
    osmd.render();
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
    this.osmd.render();
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
    const engraver = this.osmd as unknown as { FollowCursor?: boolean } | null;
    if (engraver !== null) {
      engraver.FollowCursor = !paged;
    }
    const scroller = this.scroller();
    if (scroller instanceof HTMLElement) {
      scroller.dataset['paged'] = String(paged);
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
    const height = this.windowHeight();
    if (width > 0 && height > 0) {
      osmd.setCustomPageFormat?.(width / UNITS_TO_PIXELS, height / UNITS_TO_PIXELS);
    }
  }

  /** Every page the engraver drew, in reading order. */
  private get sheets(): SVGSVGElement[] {
    return [...this.container.querySelectorAll('svg')];
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

  /** How tall a page may be, in the pixels the reader can actually see. */
  private windowHeight(): number {
    const box = this.frame()?.getBoundingClientRect();
    const screen = this.viewportHeight();
    const height =
      box === undefined ? 0 : visibleHeightOf({ top: box.top, bottom: screen }, screen);
    const scroller = this.scroller();
    // The room kept for the transport bar, which is padding on the scrolling
    // box: a page that used it would put its last system behind the bar.
    const reserved =
      scroller instanceof HTMLElement
        ? Number.parseFloat(getComputedStyle(scroller).paddingBottom) || 0
        : 0;
    return Math.max(0, height - reserved);
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
      sheet.style.display = !this.paged || at === this.pageAt ? '' : 'none';
      this.numberPage(sheet, at, this.paged ? sheets.length : 0);
    }
    this.placeCursor();
  }

  /**
   * Writes the page number onto the page, the way a printed score has it.
   *
   * Drawn into the sheet rather than floated over it, because that is what
   * it is: part of this page and not part of the screen. It stays put, it is
   * there before anything has been turned, and it goes wherever the page
   * goes - none of which a pill announcing a turn can do, since it says its
   * piece and disappears.
   *
   * The engraver keeps a page number in its model and draws nothing with it,
   * so this is ours to draw.
   */
  private numberPage(sheet: SVGSVGElement, at: number, count: number): void {
    const existing = sheet.querySelector('text.page-number');
    if (count < 2) {
      existing?.remove();
      return;
    }
    const text = existing ?? sheet.ownerDocument.createElementNS(SVG_NAMESPACE, 'text');
    text.setAttribute('class', 'page-number');
    text.setAttribute('x', String(PAGE_NUMBER_INSET));
    text.setAttribute('y', String(PAGE_NUMBER_INSET));
    text.textContent = `Page ${at + 1} of ${count}`;
    if (existing === null) {
      sheet.append(text);
    }
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
  private followCursor(stepIndex: number): void {
    // Not while the renderer is walking the cursor for its own bookkeeping.
    // Reading where every step was drawn means running the cursor from the
    // top and putting it back, and a page that followed that would end the
    // re-engraving on page one however far in the reader had got.
    if (this.walking) {
      return;
    }
    const page = this.pageOfStep(stepIndex);
    if (this.paged && page !== this.pageAt) {
      this.turnToPage(page);
      return;
    }
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
      const edge = node.getAttribute('data-edge');
      if (edge === 'start' || edge === 'end') {
        return { edge, end };
      }
      node = node.parentElement;
    }
    return null;
  }

  /** The box that clips, which is not the one that scrolls inside it. */
  private frame(): Element | null {
    return this.container.closest('.score') ?? this.scroller();
  }

  /** The box that actually scrolls, which is not the one being drawn in. */
  private scroller(): Element | null {
    return this.container.closest('.score__scroll') ?? this.container.parentElement;
  }

  showPassage(passage: DrawnPassage): void {
    this.passage = passage;
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

  onNoteHeld(listener: (stepIndex: number) => void): () => void {
    this.heldListeners.push(listener);
    return () => {
      this.heldListeners = this.heldListeners.filter((each) => each !== listener);
    };
  }

  /**
   * The step a drawn element belongs to, looking outwards from it.
   *
   * Which element is which step is already known - it is how a passed note
   * is dimmed - so this asks nothing new of the engraver.
   */
  private stepOf(target: EventTarget | null): number | null {
    let node = target instanceof Element ? target : null;
    while (node !== null && node !== this.container) {
      for (const [stepIndex, elements] of this.stepElements) {
        if (elements.includes(node as SVGGElement)) {
          return stepIndex;
        }
      }
      node = node.parentElement;
    }
    return null;
  }

  /** Starts the clock on a finger that may be pointing at a bar. */
  private watchForAHold(event: PointerEvent): void {
    this.cancelHold();
    const step = this.stepOf(event.target);
    if (step === null) {
      return;
    }
    this.holding = setTimeout(() => {
      this.holding = null;
      // Still where it landed: a finger that travelled was doing something
      // else, and by now it has been told so.
      if (this.tapFrom?.pointerId !== event.pointerId) {
        return;
      }
      this.tapFrom = null;
      for (const listener of [...this.heldListeners]) {
        listener(step);
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
    };
  }

  private continueDrag(event: PointerEvent): void {
    this.turnIfDraggedOffThePage(event);
    const began = this.tapFrom;
    if (
      began !== null &&
      Math.hypot(event.clientX - began.x, event.clientY - began.y) > TAP_SLACK_PX
    ) {
      // Moving is not pointing.
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
    const sheet = this.currentSheet();
    if (!this.paged || this.dragging === null || sheet === null) {
      return;
    }
    const point = this.drawingPointOf(event);
    const width = intrinsicSize(sheet).width;
    if (point === null || width <= 0) {
      return;
    }
    if (point.x > width) {
      this.turnPages(1);
      return;
    }
    if (point.x < 0) {
      this.turnPages(-1);
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
    this.marks.push({
      stepIndex: note.stepIndex,
      midi: note.midi,
      correct: note.correct,
      offset: note.offset,
    });
    this.paintOverlay();
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
    for (const [at, sheet] of this.sheets.entries()) {
      const group = this.overlayGroupFor(sheet);
      while (group.firstChild !== null) {
        group.firstChild.remove();
      }
      const marks = this.marks.filter((mark) => this.pageOfStep(mark.stepIndex) === at);
      // The heights this page was measured at, and no other: at a page break
      // the nearest note in the same step is on the sheet before, and taking
      // its height would put the mark a page out.
      const geometry = fitStaffGeometry(this.samples.filter((sample) => sample.page === at));
      if (context === null || geometry === null || marks.length === 0) {
        continue;
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
  }

  /** The page a step's notes were drawn on. */
  private pageOfStep(stepIndex: number): number {
    return this.stepPage.get(stepIndex) ?? 0;
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
      for (const grip of gripsOf([bracket])) {
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

  /** The marker layer inside one page's sheet, made if it is not there yet. */
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
  private overlayGroupFor(sheet: SVGSVGElement): SVGGElement {
    const found = sheet.querySelector('g.played-overlay');
    if (found !== null) {
      return found as SVGGElement;
    }
    const group = sheet.ownerDocument.createElementNS(SVG_NAMESPACE, 'g');
    group.setAttribute('class', 'played-overlay');
    sheet.append(group);
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

    cursor.reset();
    let index = 0;
    let guard = 10_000;
    while (!cursor.iterator.EndReached && guard > 0) {
      guard -= 1;
      this.readStep(cursor, index, stepX, samples);
      index += 1;
      cursor.next();
    }

    this.stepX = stepX;
    this.samples = samples;
    this.attachNoteFurniture();
    this.navigator.reset();
    this.navigator.moveTo(restoreTo);
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
    const svg = this.container.querySelector('svg');
    if (svg === null) {
      return;
    }

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

    for (const [id, stepIndex] of stepOfNote) {
      add(stepIndex, svg.querySelector<SVGGElement>(`g.vf-stem[id="${id}-stem"]`));
      add(stepIndex, svg.querySelector<SVGGElement>(`g.vf-ledgers[id="${id}ledgers"]`));
    }

    for (const beam of svg.querySelectorAll<SVGGElement>('g.vf-beam')) {
      const owner = beam.id.replace(/-beam\d+$/, '');
      const lastStep = this.lastStepOfBeam(owner, stepOfNote);
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
  private lastStepOfBeam(owner: string, stepOfNote: ReadonlyMap<string, number>): number | null {
    const start = this.container.querySelector(`g.vf-stavenote[id="${owner}"]`);
    const measure = start?.parentElement ?? null;
    if (start === null || measure === null) {
      return null;
    }
    const notes = [...measure.querySelectorAll('g.vf-stavenote')];
    const owners = new Set(
      [...measure.querySelectorAll('g.vf-beam')].map((beam) => beam.id.replace(/-beam\d+$/, '')),
    );

    let last: number | null = null;
    for (let at = notes.indexOf(start); at < notes.length; at += 1) {
      const note = notes[at];
      if (note === undefined || (at > notes.indexOf(start) && owners.has(note.id))) {
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
        const pitch = note.sourceNote?.pitch;
        if (position === undefined || pitch === undefined || pitch === null) {
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
        }

        const diatonicIndex = diatonicIndexOf(pitch.FundamentalNote ?? -1, pitch.Octave ?? 0);
        if (diatonicIndex === null) {
          continue;
        }
        samples.push({
          stepIndex,
          page: this.stepPage.get(stepIndex) ?? 0,
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

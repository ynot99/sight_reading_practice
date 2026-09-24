import type {
  DrawnPassage,
  IHandSwitches,
  IOtherHandMarker,
  IPassageMarkers,
  IPlayedNoteOverlay,
  IRhythmRuler,
  IScoreCursor,
  IScoreFade,
  IScorePages,
  IScoreRenderer,
  IScoreZoom,
  IStuckMarker,
  OverlayContext,
  PassageEnd,
  PlayedNote,
  ScorePageState,
  ScoreReading,
} from '../../../application/ports/IScoreRenderer.js';
import type { RulerMark } from '../../../application/rhythmRuler.js';
import type { PrintedStep } from '../../../domain/notation/printedIds.js';
import { PAGE_LABEL_INSET, pageLabelText } from '../pageLabel.js';
import { swipeDirection, visibleHeightOf } from '../pageTurns.js';
import { readThePage, type PageLayout } from './pageLayout.js';
import type { PageShape } from './VerovioCore.js';
import type { VerovioEngraver } from './VerovioEngraver.js';

/**
 * The scale at a zoom of one.
 *
 * A staff space of ten pixels, which is what OSMD draws at the same zoom, so a
 * reader's zoom means the same size of print whichever engraver drew it.
 * Verovio draws eighteen pixels a space at a scale of a hundred.
 */
const SCALE_AT_ZOOM_ONE = 56;
const LEAST_ZOOM = 0.3;
const MOST_ZOOM = 3;
const FIRST_ZOOM = 0.85;

/** The page sizes Verovio accepts, in its own units. */
const WIDEST_PAGE = 100_000;
const TALLEST_PAGE = 60_000;
const SMALLEST_PAGE = 100;

/**
 * A page for a surface that has not been laid out yet - hidden, or in a test.
 * Anything is better than a page of no size, which Verovio refuses.
 */
const UNMEASURED_WIDTH_PX = 1024;
const UNMEASURED_HEIGHT_PX = 768;

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * The marker's shape, in staff spaces: from a little before the leftmost head
 * of its step, as wide as a head with room either side, and reaching a little
 * past the outer lines of the system. OSMD's was a band like this, and a band
 * is what a reader has learned to look for.
 */
const MARKER_BEFORE_HEAD = 0.6;
const MARKER_WIDTH = 2.4;
const MARKER_ABOVE_STAFF = 1.5;

/**
 * Room above the music on every page, in pixels: the page's own label is
 * written there, and Verovio's margin alone left a tempo mark touching it.
 */
const LABEL_ROOM_PX = 32;

/** A finger that has moved less than this between landing and lifting has tapped. */
const TAP_SLOP_PX = 10;

/** The pages kept drawn on either side of the one being read, or of the ones in view. */
const PAGES_EITHER_SIDE = 1;

/**
 * The score drawn by Verovio, a page at a time.
 *
 * Verovio lays the music out on pages the size of the window, in a worker (see
 * {@link VerovioEngraver}), and this shows them: one at a time when the score
 * is read in pages, stacked one above the next when it is scrolled. Only the
 * pages a reader can reach in one move are drawn - on the Alkan every page
 * drawn at once is more than the iPad will hold - and the rest stand as boxes
 * of the right size, which is all a page needs to be until it is looked at.
 *
 * A zoom and a narrower window are new layouts, because Verovio breaks systems
 * by the page's width and has no other way to make the print larger. The page
 * on the screen stays until the new layout is ready, and then the reader is
 * put back on the bar that was at the top of it.
 *
 * What is drawn over the music - the cursor, the notes played, the passage,
 * the hands, the ruler - is the next steps of the move to Verovio. Until they
 * are built this is asked for them and draws nothing, so the app runs against
 * it unchanged; the cursor alone keeps where it is, because the run asks.
 */
export class VerovioScoreRenderer
  implements
    IScoreRenderer,
    IScorePages,
    IScoreZoom,
    IPassageMarkers,
    IHandSwitches,
    IOtherHandMarker,
    IRhythmRuler,
    IPlayedNoteOverlay,
    IScoreFade,
    IStuckMarker
{
  private readonly container: HTMLElement;
  private readonly engraver: VerovioEngraver;
  /** The reader's marker, and the fainter one where the other hand has got to. */
  private readonly reader = new MarkerOnThePage(() => {
    this.placeTheMarker(this.reader, 'score__cursor');
  });
  private readonly other = new MarkerOnThePage(() => {
    this.placeTheMarker(this.other, 'score__cursor score__cursor--other');
  });
  private readonly markerElements = new Map<MarkerOnThePage, HTMLElement>();
  /** Where on the page each step is, by name; see `IScoreRenderer.load`. */
  private printed: readonly PrintedStep[] = [];
  /** What each drawn page was read as: its systems, its bars, its heads, and its size. */
  private readonly layouts = new Map<number, ReadPage>();
  /** The drawn page every named bar, note and rest is on. */
  private readonly pageOfName = new Map<string, number>();

  private currentZoom: number;
  private paged = false;
  private pageAt = 0;
  /** One box per page of the layout, in order; a page drawn holds its SVG. */
  private sheets: HTMLElement[] = [];
  private readonly drawn = new Set<number>();
  /** Pages asked of the engraver and not yet back. */
  private drawing = new Set<number>();
  /**
   * Which layout is the latest. Every answer that comes back from the engraver
   * is for the layout it was asked of, and one older than this is dropped.
   */
  private layout = 0;
  /** Whether the engraver has music to lay out again; true from the moment it is sent. */
  private hasMusic = false;
  /** The piece's name, for the corner of its pages. */
  private title = '';
  private laidOutWidth = 0;
  /** A page, as drawn on the screen. */
  private pagePx = { width: 0, height: 0 };
  private pageListeners: ((state: ScorePageState) => void)[] = [];
  private tapListeners: (() => void)[] = [];
  private observer: ResizeObserver | null = null;
  private finger: { readonly pointerId: number; readonly x: number; readonly y: number } | null = null;

  constructor(container: HTMLElement, engraver: VerovioEngraver, zoom = FIRST_ZOOM) {
    this.container = container;
    this.engraver = engraver;
    this.currentZoom = clampZoom(zoom);
    this.watchTheFingers();
    this.scroller()?.addEventListener(
      'scroll',
      () => {
        if (!this.paged) {
          this.inTheBackground(this.drawTheNearPages());
        }
      },
      { passive: true },
    );
  }

  get cursor(): IScoreCursor {
    return this.reader;
  }

  get otherHand(): IScoreCursor {
    return this.other;
  }

  get zoom(): number {
    return this.currentZoom;
  }

  setZoom(zoom: number): void {
    const next = clampZoom(zoom);
    if (next === this.currentZoom) {
      return;
    }
    this.currentZoom = next;
    this.inTheBackground(this.layOutAgain());
  }

  async load(musicXml: string, printed: readonly PrintedStep[]): Promise<void> {
    this.layout += 1;
    const layout = this.layout;
    this.hasMusic = true;
    this.title = titleOf(musicXml);
    this.printed = printed;
    const shape = this.shape();
    const count = await this.engraver.load(musicXml, shape);
    if (layout !== this.layout) {
      return;
    }
    // New music: the page the reader had reached in the last piece says
    // nothing about this one.
    this.pageAt = 0;
    this.standThePages(count, shape);
    await this.drawTheNearPages();
    this.watchTheContainer();
  }

  /** Lays the same music out again for the size the surface is now. */
  refresh(): void {
    this.inTheBackground(this.layOutAgain());
  }

  /**
   * Lays out again when the width has changed, and only then.
   *
   * On iOS the window changes height whenever the browser's toolbar folds
   * away - on every scroll - and a layout for each of those would be seconds
   * of work for nothing a reader could see.
   */
  handleContainerResize(width: number): void {
    if (!this.hasMusic || width <= 0 || Math.abs(width - this.laidOutWidth) < 1) {
      return;
    }
    this.refresh();
  }

  scrollToStart(): void {
    if (this.paged) {
      this.turnToPage(0);
      return;
    }
    this.scroller()?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  }

  clear(): void {
    this.layout += 1;
    this.hasMusic = false;
    this.title = '';
    this.printed = [];
    this.container.replaceChildren();
    this.sheets = [];
    this.drawn.clear();
    this.forgetTheReadings();
    this.drawing = new Set();
    this.pageAt = 0;
    this.announcePages();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.engraver.dispose();
  }

  // Pages

  setPaged(paged: boolean): void {
    this.paged = paged;
    // Written every time, not only on a change: a visit that opens in pages
    // says so before anything is drawn, and the stylesheet's promise - no
    // scrollbar, no drag - hangs on this.
    const scroller = this.scroller();
    if (scroller instanceof HTMLElement) {
      scroller.dataset['paged'] = String(paged);
    }
    // The same layout serves both: pages the size of the window, shown one
    // at a time or one above the next. Nothing is laid out again - only what
    // the pages say about themselves changes.
    for (const page of this.drawn) {
      this.labelThePage(page);
    }
    this.showThePages();
    this.inTheBackground(this.drawTheNearPages());
    this.announcePages();
  }

  get pages(): ScorePageState {
    const count = this.paged ? this.sheets.length : 0;
    return {
      at: Math.min(this.pageAt, Math.max(0, count - 1)),
      count,
      windowPx: Math.round(this.windowHeight()),
      contentPx: Math.round(this.pagePx.height),
    };
  }

  turnPages(delta: number): void {
    this.turnToPage(this.pageAt + delta);
  }

  showMeasure(measureIndex: number): void {
    if (!this.paged || !this.hasMusic) {
      return;
    }
    const layout = this.layout;
    this.inTheBackground(
      this.engraver.pageOf(`m${String(measureIndex)}`).then((page) => {
        // Only when the bar has left the page: turning to the page it is
        // already on would fight a reader who has looked ahead.
        if (layout === this.layout && page !== null && page - 1 !== this.pageAt) {
          this.turnToPage(page - 1);
        }
      }),
    );
  }

  onPagesChanged(listener: (state: ScorePageState) => void): () => void {
    this.pageListeners.push(listener);
    return () => {
      this.pageListeners = this.pageListeners.filter((each) => each !== listener);
    };
  }

  private turnToPage(index: number): void {
    this.pageAt = Math.min(Math.max(index, 0), Math.max(0, this.sheets.length - 1));
    this.showThePages();
    this.inTheBackground(this.drawTheNearPages());
    this.announcePages();
  }

  /** A box for every page of a new layout, the size a page is drawn at. */
  private standThePages(count: number, shape: PageShape): void {
    this.pagePx = {
      width: (shape.pageWidth * shape.scale) / 100,
      height: (shape.pageHeight * shape.scale) / 100,
    };
    this.drawn.clear();
    this.drawing = new Set();
    this.forgetTheReadings();
    this.sheets = Array.from({ length: count }, (_, page) => {
      const sheet = this.container.ownerDocument.createElement('div');
      sheet.className = 'score__page';
      sheet.dataset['page'] = String(page);
      sheet.style.height = `${String(this.pagePx.height)}px`;
      return sheet;
    });
    this.container.replaceChildren(...this.sheets);
    this.pageAt = Math.min(this.pageAt, Math.max(0, count - 1));
    this.showThePages();
    this.announcePages();
  }

  private showThePages(): void {
    for (const [page, sheet] of this.sheets.entries()) {
      // Only where it differs: a turn changes two pages of the thirty, and
      // writing the same value to the rest still asks for a layout.
      const shown = !this.paged || page === this.pageAt ? '' : 'none';
      if (sheet.style.display !== shown) {
        sheet.style.display = shown;
      }
    }
  }

  /**
   * The pages worth having drawn: the one being read and one either side, or
   * - scrolling - the ones in view and one either side of them.
   */
  private wantedPages(): ReadonlySet<number> {
    const [first, last] = this.paged ? [this.pageAt, this.pageAt] : this.pagesInView();
    const wanted = new Set<number>();
    for (let page = first - PAGES_EITHER_SIDE; page <= last + PAGES_EITHER_SIDE; page += 1) {
      if (page >= 0 && page < this.sheets.length) {
        wanted.add(page);
      }
    }
    return wanted;
  }

  /** The first and last page a scrolled score has on the screen. */
  private pagesInView(): readonly [number, number] {
    const scroller = this.scroller();
    const height = this.pagePx.height;
    if (!(scroller instanceof HTMLElement) || height <= 0) {
      return [0, 0];
    }
    const top = Math.max(0, scroller.scrollTop - this.container.offsetTop);
    const first = Math.floor(top / height);
    const last = Math.floor((top + Math.max(scroller.clientHeight, height)) / height);
    return [first, last];
  }

  /**
   * Draws the pages that are wanted, one at a time, and lets go of the rest.
   *
   * Each page is written by the engraver on its own thread and taken in here;
   * one that comes back for a layout since replaced, or that is no longer
   * wanted by the time it arrives, is dropped rather than drawn.
   */
  private async drawTheNearPages(): Promise<void> {
    const layout = this.layout;
    for (const page of this.wantedPages()) {
      if (this.drawn.has(page) || this.drawing.has(page)) {
        continue;
      }
      this.drawing.add(page);
      const svg = await this.engraver.page(page + 1);
      if (layout !== this.layout) {
        return;
      }
      this.drawing.delete(page);
      const sheet = this.sheets[page];
      if (sheet === undefined || !this.wantedPages().has(page)) {
        continue;
      }
      sheet.innerHTML = svg;
      this.drawn.add(page);
      this.readTheDrawnPage(page);
      this.labelThePage(page);
    }
    this.letTheFarPagesGo();
    this.placeTheMarkers();
  }

  /**
   * Reads a page just drawn: its systems, its bars and its heads, and which
   * names are on it - so a step is placed by arithmetic from then on, and
   * nothing asks the browser where anything is.
   */
  private readTheDrawnPage(page: number): void {
    const drawing = this.sheets[page]?.querySelector('svg');
    if (drawing === null || drawing === undefined) {
      return;
    }
    const read = readThePage(drawing);
    this.layouts.set(page, { layout: read, scale: this.pagePx.width / read.width });
    for (const name of read.heads.keys()) {
      this.pageOfName.set(name, page);
    }
    for (const system of read.systems) {
      for (const bar of system.bars) {
        this.pageOfName.set(bar.id, page);
      }
    }
  }

  /** Forgets what one page, or every page, was read as. */
  private forgetTheReadings(page?: number): void {
    if (page === undefined) {
      this.layouts.clear();
      this.pageOfName.clear();
      return;
    }
    const read = this.layouts.get(page)?.layout;
    this.layouts.delete(page);
    for (const name of read?.heads.keys() ?? []) {
      this.pageOfName.delete(name);
    }
    for (const bar of read?.systems.flatMap((system) => system.bars) ?? []) {
      this.pageOfName.delete(bar.id);
    }
  }

  private placeTheMarkers(): void {
    this.placeTheMarker(this.reader, 'score__cursor');
    this.placeTheMarker(this.other, 'score__cursor score__cursor--other');
  }

  /**
   * Stands a marker over the step it is at, on the page that step is drawn on.
   *
   * Across the whole system, as a band over the heads of the step: from a
   * little before the leftmost head, and from a little above the top line of
   * the top staff to a little below the bottom line of the lowest. Off the
   * page when it is not wanted, or when the page its step is on is not drawn -
   * which a page far from the reader is not.
   */
  private placeTheMarker(marker: MarkerOnThePage, className: string): void {
    let element = this.markerElements.get(marker);
    if (element === undefined) {
      element = this.container.ownerDocument.createElement('div');
      element.className = className;
      this.markerElements.set(marker, element);
    }
    const where = marker.isWanted ? this.whereTheStepIs(marker.position) : null;
    if (where === null) {
      element.remove();
      return;
    }
    if (element.parentElement !== where.sheet) {
      where.sheet.append(element);
    }
    element.style.left = `${String(where.left)}px`;
    element.style.top = `${String(where.top)}px`;
    element.style.width = `${String(where.width)}px`;
    element.style.height = `${String(where.height)}px`;
  }

  /** Where a step's marker stands on the screen, or `null` if its page is not drawn. */
  private whereTheStepIs(index: number): MarkerPlace | null {
    const step = this.printed[index];
    if (step === undefined) {
      return null;
    }
    const page = this.pageOfName.get(step.barId);
    const drawn = page === undefined ? undefined : this.layouts.get(page);
    const sheet = page === undefined ? undefined : this.sheets[page];
    const read = drawn?.layout;
    const system = read?.systems.find((each) => each.bars.some((bar) => bar.id === step.barId));
    const bar = system?.bars.find((each) => each.id === step.barId);
    if (drawn === undefined || read === undefined || sheet === undefined || system === undefined || bar === undefined) {
      return null;
    }
    const heads = step.printed
      .map((here) => read.heads.get(here.id)?.x)
      .filter((x): x is number => x !== undefined);
    const [top, second] = bar.staves[0]?.lines ?? [];
    const space = top !== undefined && second !== undefined ? second - top : 0;
    // Where no head of the step is drawn - which only an unseen rest would
    // leave - the marker stands at the front of its bar.
    const left = heads.length > 0 ? Math.min(...heads) - MARKER_BEFORE_HEAD * space : bar.left;
    const right = heads.length > 0 ? Math.max(...heads) : left;
    const { scale } = drawn;
    return {
      sheet,
      left: left * scale,
      top: (system.top - MARKER_ABOVE_STAFF * space) * scale,
      // As wide as it takes to cover every head, however far apart a chord
      // with a second in it sets them.
      width: (right - left + MARKER_WIDTH * space - MARKER_BEFORE_HEAD * space) * scale,
      height: (system.bottom - system.top + 2 * MARKER_ABOVE_STAFF * space) * scale,
    };
  }

  /**
   * Writes on a page which piece it is and which page of it.
   *
   * Scrolled, the pages are one column and only its top says anything - the
   * name, with no count, since a reader who never asked for pages is not on
   * page three of anything.
   */
  private labelThePage(page: number): void {
    const drawing = this.sheets[page]?.querySelector('svg');
    if (drawing === null || drawing === undefined) {
      return;
    }
    const said =
      this.paged || page === 0 ? pageLabelText(this.title, page, this.paged ? this.sheets.length : 0) : '';
    let label = drawing.querySelector(':scope > text.page-label');
    if (said === '') {
      label?.remove();
      return;
    }
    if (label === null) {
      label = drawing.ownerDocument.createElementNS(SVG_NAMESPACE, 'text');
      label.setAttribute('class', 'page-label');
      label.setAttribute('x', String(PAGE_LABEL_INSET));
      label.setAttribute('y', String(PAGE_LABEL_INSET));
      drawing.append(label);
    }
    label.textContent = said;
  }

  private letTheFarPagesGo(): void {
    const wanted = this.wantedPages();
    for (const page of [...this.drawn]) {
      if (!wanted.has(page)) {
        this.sheets[page]?.replaceChildren();
        this.drawn.delete(page);
        this.forgetTheReadings(page);
      }
    }
  }

  /**
   * The same music on pages of the size and print asked for now.
   *
   * The reader goes back to the bar that was at the top of the page they were
   * reading: a new layout is a zoom or a turned tablet, not a request to start
   * again - and the page number means nothing across layouts, the bar does.
   */
  private async layOutAgain(): Promise<void> {
    if (!this.hasMusic) {
      return;
    }
    this.layout += 1;
    const layout = this.layout;
    const anchor = this.barAtTheTop();
    const shape = this.shape();
    const count = await this.engraver.relayout(shape);
    if (layout !== this.layout) {
      return;
    }
    const page = anchor === null ? null : await this.engraver.pageOf(anchor);
    if (layout !== this.layout) {
      return;
    }
    if (page !== null) {
      this.pageAt = page - 1;
    }
    this.standThePages(count, shape);
    await this.drawTheNearPages();
  }

  /** The name of the first bar on the page being read, if it is drawn. */
  private barAtTheTop(): string | null {
    const [first] = this.paged ? [this.pageAt] : this.pagesInView();
    const svg = this.sheets[first]?.querySelector('svg');
    if (svg === null || svg === undefined) {
      return null;
    }
    try {
      return readThePage(svg).systems[0]?.bars[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * The page Verovio is to lay out on, for the surface as it is now.
   *
   * As wide as the surface and as tall as the window, drawn at the scale the
   * zoom asks for - so a page is exactly a screen, and the print is the zoom.
   */
  private shape(): PageShape {
    const widthPx = this.container.clientWidth > 0 ? this.container.clientWidth : UNMEASURED_WIDTH_PX;
    const window = this.windowHeight();
    const heightPx = window > 0 ? window : UNMEASURED_HEIGHT_PX;
    this.laidOutWidth = widthPx;
    const scale = Math.round(SCALE_AT_ZOOM_ONE * this.currentZoom);
    return {
      scale,
      pageWidth: clamp(Math.floor((widthPx * 100) / scale), SMALLEST_PAGE, WIDEST_PAGE),
      pageHeight: clamp(Math.floor((heightPx * 100) / scale), SMALLEST_PAGE, TALLEST_PAGE),
      // In pixels on the screen whatever the print: the label does not grow
      // with the zoom, so neither does the room kept for it.
      pageMarginTop: Math.ceil((LABEL_ROOM_PX * 100) / scale),
    };
  }

  /**
   * How tall a page may be: the part of the scrolling box on the screen, less
   * what it keeps for itself top and bottom (the room for the transport bar).
   */
  private windowHeight(): number {
    const scroller = this.scroller();
    if (!(scroller instanceof HTMLElement)) {
      return 0;
    }
    const box = scroller.getBoundingClientRect();
    const view = this.container.ownerDocument.defaultView;
    const visible = visibleHeightOf({ top: box.top, bottom: box.bottom }, view?.innerHeight ?? 0);
    const style = view?.getComputedStyle(scroller);
    const reserved =
      (Number.parseFloat(style?.paddingTop ?? '') || 0) + (Number.parseFloat(style?.paddingBottom ?? '') || 0);
    return Math.max(0, visible - reserved);
  }

  /** The box that scrolls, which is not the one drawn in. */
  private scroller(): Element | null {
    return this.container.closest('.score__scroll') ?? this.container.parentElement;
  }

  private watchTheContainer(): void {
    if (this.observer !== null || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.observer = new ResizeObserver((entries) => {
      this.handleContainerResize(entries[0]?.contentRect.width ?? 0);
    });
    this.observer.observe(this.container);
  }

  /**
   * Work the page asked for and does not wait on: a page drawn, a layout again.
   *
   * Its failure is not the reader's to hear. Everything here follows a score
   * that opened - and the engraver failing is said where it can be answered,
   * when a score is opened - so a page that does not come back stays as it
   * was; and the renderer let go of with work still out is the usual way for
   * that work to fail.
   */
  private inTheBackground(work: Promise<void>): void {
    work.catch(() => undefined);
  }

  private announcePages(): void {
    const state = this.pages;
    for (const listener of [...this.pageListeners]) {
      listener(state);
    }
  }

  // A finger on the music: a swipe turns a page, a touch is said to be one.

  private watchTheFingers(): void {
    this.container.addEventListener('pointerdown', (event) => {
      this.finger = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    });
    this.container.addEventListener('pointerup', (event) => {
      const from = this.finger;
      this.finger = null;
      if (from === null || from.pointerId !== event.pointerId) {
        return;
      }
      const to = { x: event.clientX, y: event.clientY };
      const turn = this.paged ? swipeDirection(from, to) : 0;
      if (turn !== 0) {
        this.turnPages(turn);
      } else if (Math.hypot(to.x - from.x, to.y - from.y) < TAP_SLOP_PX) {
        for (const listener of [...this.tapListeners]) {
          listener();
        }
      }
    });
    this.container.addEventListener('pointercancel', () => {
      this.finger = null;
    });
  }

  onScoreTapped(listener: () => void): () => void {
    this.tapListeners.push(listener);
    return () => {
      this.tapListeners = this.tapListeners.filter((each) => each !== listener);
    };
  }

  // Not drawn yet: the steps of the move after this one draw these. Until
  // then each is asked and does nothing, which is what a renderer that cannot
  // draw something is allowed to do - the run goes on the same.

  showNextPagePreview(_wanted: boolean): void {}

  turnPagesWithTheMusic(_wanted: boolean): void {}

  showPassage(_passage: DrawnPassage): void {}

  hidePassage(): void {}

  onPassageDragged(_listener: (passage: DrawnPassage) => void): () => void {
    return () => undefined;
  }

  showStart(_measureIndex: number | null): void {}

  showRepeatedBars(_measureIndexes: readonly number[]): void {}

  onMarkerHeld(_listener: (end: PassageEnd) => void): () => void {
    return () => undefined;
  }

  onBarHeld(_listener: (measureIndex: number) => void): () => void {
    return () => undefined;
  }

  showHands(_playing: readonly number[]): void {}

  onHandToggled(_listener: (staffNumber: number) => void): () => void {
    return () => undefined;
  }

  showRhythmRuler(_marks: readonly RulerMark[]): void {}

  showBeat(_mark: RulerMark | null): void {}

  showTrouble(_missteps: number): void {}

  configureOverlay(_context: OverlayContext): void {}

  showPlayed(_note: PlayedNote): void {}

  hidePlayed(_note: { readonly stepIndex: number; readonly midi: number }): void {}

  settlePlayed(_stepIndex: number): void {}

  clearPlayed(): void {}

  fadePassed(_stepIndex: number): void {}

  clearFaded(): void {}

  dimUnplayed(_reading: ScoreReading | null): void {}
}

/** A drawn page as it was read, and how many pixels of it make one of its units. */
interface ReadPage {
  readonly layout: PageLayout;
  readonly scale: number;
}

/** Where a marker stands on a page, in pixels from the page's corner. */
interface MarkerPlace {
  readonly sheet: HTMLElement;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A marker the run moves by step, and the page draws.
 *
 * Any step at once, by name, where OSMD's cursor had to be walked there one
 * position at a time. It says when it has moved, or been shown or hidden, and
 * the renderer puts it on the page.
 */
class MarkerOnThePage implements IScoreCursor {
  private at = 0;
  private wanted = true;
  private readonly moved: () => void;

  constructor(moved: () => void) {
    this.moved = moved;
  }

  get position(): number {
    return this.at;
  }

  /** Whether the reader asked to see it, wherever it is. */
  get isWanted(): boolean {
    return this.wanted;
  }

  show(): void {
    this.wanted = true;
    this.moved();
  }

  hide(): void {
    this.wanted = false;
    this.moved();
  }

  reset(): void {
    this.at = 0;
    this.moved();
  }

  moveTo(stepIndex: number): void {
    this.at = Math.max(0, stepIndex);
    this.moved();
  }
}

/**
 * The name the trainer printed the piece under, read back from what it printed.
 *
 * Verovio keeps no title it will give back, and the printed score is the one
 * place the name is certain to be - written by our own serializer, escaped by
 * our own writer, which is why only its three escapes are undone.
 */
function titleOf(musicXml: string): string {
  const found = /<work-title>([^<]*)<\/work-title>/.exec(musicXml);
  return (found?.[1] ?? '').replace(/&(lt|gt|amp);/g, (_, name: string) =>
    name === 'lt' ? '<' : name === 'gt' ? '>' : '&',
  );
}

function clampZoom(zoom: number): number {
  return clamp(zoom, LEAST_ZOOM, MOST_ZOOM);
}

function clamp(value: number, least: number, most: number): number {
  return Math.min(most, Math.max(least, value));
}

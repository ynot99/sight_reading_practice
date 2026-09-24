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
import { measureIndexOfBar, type PrintedStep } from '../../../domain/notation/printedIds.js';
import {
  drawHandSwitch,
  drawPassageMarker,
  drawStartMarker,
  HAND_SWITCH_GAP,
  HAND_SWITCH_WIDTH,
  handUnder,
  HOLD_MS,
  markerUnder,
  TAP_SLACK_PX,
} from '../furniture.js';
import { drawShape } from '../overlayElements.js';
import { PAGE_LABEL_INSET, pageLabelText } from '../pageLabel.js';
import { buildOverlayShapes, type PlayedMark } from '../playedNoteShapes.js';
import { fitStaffGeometry, type DrawnNoteSample, type StaffGeometry } from '../staffGeometry.js';
import { swipeDirection, visibleHeightOf } from '../pageTurns.js';
import {
  bracketShapes,
  gripAt,
  gripsOf,
  gripUnderPointer,
  measureAt,
  measureForDrag,
  pageTurnForDrag,
  passageAfterDrag,
  passageAfterTap,
  toDrawingPoint,
  type BracketShape,
  type DrawnMeasure,
  type GripEnd,
  type PassageEdge,
} from '../passageBrackets.js';
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
 * Half a notehead's width, in staff spaces. Verovio places a head's glyph by
 * its left edge, and a ring round the note is drawn round its middle.
 */
const HEAD_HALF_WIDTH = 0.59;

/** A step already played: its notes are gone from the page. */
const FADED_CLASS = 'note--passed';
/** What the run will not ask for: the other hand, or outside the passage. */
const UNPLAYED_CLASS = 'note--unplayed';

/**
 * How red the marker gets, at most: four misses is already "I cannot read
 * this chord", and counting higher says nothing new.
 */
const TROUBLE_LEVELS = 4;

/**
 * Room above the music on every page, in pixels: the page's own label is
 * written there, and Verovio's margin alone left a tempo mark touching it.
 */
const LABEL_ROOM_PX = 32;

/**
 * The left margin Verovio keeps for a brace, in its own units: its own default,
 * which it lays the brace out in.
 */
const BRACE_MARGIN = 50;

/**
 * Room kept left of the brace for the hand switches, in pixels at any print:
 * a switch and a gap either side of it, so it touches neither the brace nor
 * the edge of the screen.
 */
const HAND_ROOM_PX = HAND_SWITCH_WIDTH + 2 * HAND_SWITCH_GAP;

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
 * What is drawn over the music - the markers, the notes played, the passage,
 * the hands - is drawn on each page as it is drawn, from where that page says
 * its bars, staves and notes are; nothing asks the browser where anything is.
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
  /** The steps of each bar, by the bar's printed name. */
  private stepsOfBar = new Map<string, number[]>();
  /** What the reader played, drawn over the notes; see `IPlayedNoteOverlay`. */
  private marks: PlayedMark[] = [];
  private overlayContext: OverlayContext | null = null;
  /** Steps already passed, whose notes are taken off the page; see `IScoreFade`. */
  private readonly faded = new Set<number>();
  /** What the run is about to ask for, or `null` to dim nothing. */
  private reading: ScoreReading | null = null;
  /** Each drawn page's layer of played notes, and what they are placed by. */
  private readonly overlays = new Map<number, PageOverlay>();

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

  /** The passage the markers stand round, or `null` with them put away. */
  private passage: DrawnPassage | null = null;
  /** The bar the run will start from, where the reader has put it. */
  private startMeasure: number | null = null;
  /** The piece's last bar, which a marker dragged past the end waits at. */
  private lastBar = 0;
  /** Which staves the run is asking for; see `showHands`. */
  private handsPlaying: readonly number[] = [];
  private passageListeners: ((passage: DrawnPassage) => void)[] = [];
  private markerHeldListeners: ((end: PassageEnd) => void)[] = [];
  private barHeldListeners: ((measureIndex: number) => void)[] = [];
  private handListeners: ((staffNumber: number) => void)[] = [];
  /** A marker a finger is holding, and where it has got to. */
  private dragging: PassageDrag | null = null;
  /** A finger that may be turning a page. */
  private swipe: FingerAt | null = null;
  /** A finger that may be a tap on the music, or a hold on a bar. */
  private tapFrom: FingerAt | null = null;
  /** A switch a finger is on, which is pressed only if it lifts there. */
  private pressedHand: { readonly pointerId: number; readonly staffNumber: number } | null = null;
  /** The wait before a finger that stays put is pointing. */
  private holding: ReturnType<typeof setTimeout> | null = null;

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
    this.stepsOfBar = stepsByBar(printed);
    this.lastBar = Math.max(0, ...printed.map((step) => measureIndexOfBar(step.barId) ?? 0));
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
    this.stepsOfBar = new Map();
    this.container.replaceChildren();
    this.sheets = [];
    this.drawn.clear();
    this.forgetTheReadings();
    this.drawing = new Set();
    this.pageAt = 0;
    this.passage = null;
    this.letGo();
    this.announcePages();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.cancelHold();
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
      this.furnishThePage(page);
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
    const elements = new Map<string, Element>();
    for (const element of drawing.querySelectorAll('g.note[id], g.rest[id], g.mRest[id]')) {
      elements.set(element.id, element);
    }
    // As wide as the drawing says it is, which is the width the browser shows
    // it at: Verovio writes its size in whole pixels, and the page asked for
    // is a fraction of one off that.
    const wide = Number.parseFloat(drawing.getAttribute('width') ?? '');
    const scale = (Number.isFinite(wide) && wide > 0 ? wide : this.pagePx.width) / read.width;
    this.layouts.set(page, { layout: read, scale, elements });
    for (const name of read.heads.keys()) {
      this.pageOfName.set(name, page);
    }
    for (const system of read.systems) {
      for (const bar of system.bars) {
        this.pageOfName.set(bar.id, page);
      }
    }
    this.layTheOverlay(page, drawing, read);
    this.fadeAndDimThePage(read);
  }

  /** Takes off and dims what should be, on a page just drawn. */
  private fadeAndDimThePage(read: PageLayout): void {
    for (const bar of read.systems.flatMap((system) => system.bars)) {
      for (const stepIndex of this.stepsOfBar.get(bar.id) ?? []) {
        this.dimTheStep(stepIndex);
        if (this.faded.has(stepIndex)) {
          this.markTheStep(stepIndex, FADED_CLASS, true);
        }
      }
    }
  }

  /**
   * The drawn groups of a step's notes and rests, with the staff of each.
   *
   * A note of a chord gives the chord's group rather than its own: the stem
   * is the chord's, and a chord taken off note by note would leave its stem
   * standing on the page. And a note's ledger lines go with it, though
   * Verovio draws them with the staff rather than with the note: a note taken
   * off would otherwise leave its ledger line hanging where it was.
   */
  private drawnOfTheStep(stepIndex: number): { readonly element: Element; readonly staffNumber: number }[] {
    const step = this.printed[stepIndex];
    const page = step === undefined ? undefined : this.pageOfName.get(step.barId);
    const read = page === undefined ? undefined : this.layouts.get(page);
    if (step === undefined || read === undefined) {
      return [];
    }
    const drawn = new Map<Element, number>();
    for (const here of step.printed) {
      const element = read.elements.get(here.id);
      if (element === undefined) {
        continue;
      }
      const parent = element.parentElement;
      drawn.set(parent?.classList.contains('chord') === true ? parent : element, here.staffNumber);
      for (const ledger of ledgersUnder(element)) {
        drawn.set(ledger, here.staffNumber);
      }
    }
    return [...drawn].map(([element, staffNumber]) => ({ element, staffNumber }));
  }

  private markTheStep(stepIndex: number, className: string, on: boolean): void {
    for (const { element } of this.drawnOfTheStep(stepIndex)) {
      element.classList.toggle(className, on);
    }
  }

  /**
   * Dims what the run will not ask for at a step: the hand not being read,
   * and everything outside the passage.
   */
  private dimTheStep(stepIndex: number): void {
    const reading = this.reading;
    const outside = reading !== null && (stepIndex < reading.from || stepIndex > reading.to);
    for (const { element, staffNumber } of this.drawnOfTheStep(stepIndex)) {
      const otherHand =
        reading !== null && reading.staves.length > 0 && !reading.staves.includes(staffNumber);
      element.classList.toggle(UNPLAYED_CLASS, outside || otherHand);
    }
  }

  /**
   * Makes a drawn page's layer of played notes, and draws on it the ones
   * already played there - a page drawn late shows what was played on it as
   * though it had been drawn all along.
   *
   * Placed by the page's own printed notes: each head of every step on the
   * page is where that written note is, in the page's units, and the half
   * space between two staff positions is read off its lines rather than
   * measured from pairs of notes as OSMD's had to be.
   */
  private layTheOverlay(page: number, drawing: SVGSVGElement, read: PageLayout): void {
    const music = drawing.querySelector('svg.definition-scale');
    if (music === null) {
      return;
    }
    const samples: DrawnNoteSample[] = [];
    const stepX = new Map<number, number>();
    let space = 0;
    for (const [system, drawn] of read.systems.entries()) {
      for (const bar of drawn.bars) {
        const [top, second] = bar.staves[0]?.lines ?? [];
        if (space === 0 && top !== undefined && second !== undefined) {
          space = second - top;
        }
        for (const stepIndex of this.stepsOfBar.get(bar.id) ?? []) {
          for (const here of this.printed[stepIndex]?.printed ?? []) {
            const head = read.heads.get(here.id);
            if (head === undefined || here.diatonicIndex === null) {
              continue;
            }
            const x = head.x + HEAD_HALF_WIDTH * space;
            samples.push({
              stepIndex,
              page,
              system,
              staffNumber: here.staffNumber,
              diatonicIndex: here.diatonicIndex,
              y: head.y,
              x,
            });
            stepX.set(stepIndex, Math.min(stepX.get(stepIndex) ?? x, x));
          }
        }
      }
    }
    const fitted = fitStaffGeometry(samples);
    const layer = drawing.ownerDocument.createElementNS(SVG_NAMESPACE, 'g');
    layer.setAttribute('class', 'played-overlay');
    music.append(layer);
    this.overlays.set(page, {
      layer,
      geometry: fitted === null ? null : { ...fitted, stepHeight: space / 2 },
      stepX,
    });
    for (const mark of this.marks) {
      if (this.pageOfStep(mark.stepIndex) === page) {
        this.drawTheMark(mark);
      }
    }
  }

  /** The drawn page a step is on, or `undefined` when it is not drawn. */
  private pageOfStep(stepIndex: number): number | undefined {
    const step = this.printed[stepIndex];
    return step === undefined ? undefined : this.pageOfName.get(step.barId);
  }

  /** Draws one played note onto its page, if that page is drawn. */
  private drawTheMark(mark: PlayedMark): void {
    const page = this.pageOfStep(mark.stepIndex);
    const overlay = page === undefined ? undefined : this.overlays.get(page);
    const context = this.overlayContext;
    if (overlay === undefined || overlay.geometry === null || context === null) {
      return;
    }
    const shapes = buildOverlayShapes([mark], {
      geometry: overlay.geometry,
      stepX: overlay.stepX,
      clefAt: context.clefAt,
      keyAt: context.keyAt,
    });
    for (const shape of shapes) {
      const drawn = drawShape(shape, overlay.layer.ownerDocument);
      drawn.setAttribute('data-mark', `${String(mark.stepIndex)}:${String(mark.midi)}`);
      if (mark.correct && mark.settled === false) {
        drawn.classList.add('played--unsettled');
      }
      overlay.layer.append(drawn);
    }
  }

  /** Forgets what one page, or every page, was read as. */
  private forgetTheReadings(page?: number): void {
    if (page === undefined) {
      this.layouts.clear();
      this.pageOfName.clear();
      this.overlays.clear();
      return;
    }
    const read = this.layouts.get(page)?.layout;
    this.layouts.delete(page);
    this.overlays.delete(page);
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
      // The brace's own margin and the switches' room beside it: the brace
      // grows with the print, and a switch is a fingertip at any.
      pageMarginLeft: BRACE_MARGIN + Math.ceil((HAND_ROOM_PX * 100) / scale),
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

  // The passage, the start of the run and the hands, drawn on each page.

  showPassage(passage: DrawnPassage): void {
    this.passage = passage;
    this.paintThePassage();
  }

  hidePassage(): void {
    this.passage = null;
    this.paintThePassage();
  }

  showStart(measureIndex: number | null): void {
    this.startMeasure = measureIndex;
    this.paintThePassage();
  }

  showHands(playing: readonly number[]): void {
    this.handsPlaying = [...playing];
    this.paintTheHands();
  }

  /**
   * Reports the passage a drag or a tap on a handle left behind.
   *
   * One listener on the surface rather than one per marker: pages are drawn
   * and let go of as the reader moves, and handlers bound to what is drawn
   * would go with them.
   */
  onPassageDragged(listener: (passage: DrawnPassage) => void): () => void {
    this.passageListeners.push(listener);
    return () => {
      this.passageListeners = this.passageListeners.filter((each) => each !== listener);
    };
  }

  onMarkerHeld(listener: (end: PassageEnd) => void): () => void {
    this.markerHeldListeners.push(listener);
    return () => {
      this.markerHeldListeners = this.markerHeldListeners.filter((each) => each !== listener);
    };
  }

  onBarHeld(listener: (measureIndex: number) => void): () => void {
    this.barHeldListeners.push(listener);
    return () => {
      this.barHeldListeners = this.barHeldListeners.filter((each) => each !== listener);
    };
  }

  onHandToggled(listener: (staffNumber: number) => void): () => void {
    this.handListeners.push(listener);
    return () => {
      this.handListeners = this.handListeners.filter((each) => each !== listener);
    };
  }

  onScoreTapped(listener: () => void): () => void {
    this.tapListeners.push(listener);
    return () => {
      this.tapListeners = this.tapListeners.filter((each) => each !== listener);
    };
  }

  /** Draws on a page just drawn what stands on it: the passage, the hands. */
  private furnishThePage(page: number): void {
    this.paintThePassage(page);
    this.paintTheHands(page);
  }

  /**
   * Draws the two markers and the start of the run, on every page drawn or
   * on one.
   *
   * Each on the page its own bar is on - a passage can run across a page
   * break - and on none that is not drawn: it is drawn with its page, when
   * the page is. A layer of its own over the music, because what the reader
   * played is cleared at every run and the passage is not.
   */
  private paintThePassage(only?: number): void {
    const showing = this.dragging?.passage ?? this.passage;
    for (const page of only === undefined ? this.drawn : [only]) {
      const layer = this.layerOn(page, 'passage-markers');
      if (layer === null) {
        continue;
      }
      layer.replaceChildren();
      if (showing === null) {
        continue;
      }
      // The start first, so a marker standing on the same bar line is drawn
      // over it: the marker is the thing to take hold of.
      const start = this.barsOn(page).find((bar) => bar.measureIndex === this.startMeasure);
      if (start !== undefined) {
        layer.append(drawStartMarker(layer.ownerDocument, start));
      }
      for (const bracket of this.bracketsOn(page, showing)) {
        layer.append(drawPassageMarker(layer.ownerDocument, bracket, showing));
      }
    }
  }

  /**
   * A switch beside every staff of every system, on every page drawn or on
   * one.
   *
   * Repeated the way a clef is, so there is one within reach of wherever the
   * eye is; in the room kept for them left of the brace (see `shape`), so
   * none can land on a note or on the brace; and in a layer of their own,
   * which a marker being moved does not redraw.
   */
  private paintTheHands(only?: number): void {
    for (const page of only === undefined ? this.drawn : [only]) {
      const layer = this.layerOn(page, 'hand-switches');
      const read = this.layouts.get(page);
      if (layer === null || read === undefined) {
        continue;
      }
      layer.replaceChildren();
      if (this.handsPlaying.length === 0) {
        continue;
      }
      for (const system of read.layout.systems) {
        // Counted from the top of the system down, as the score numbers its
        // staves: the right hand is the upper one.
        for (const [at, staff] of (system.bars[0]?.staves ?? []).entries()) {
          const staffNumber = at + 1;
          layer.append(
            drawHandSwitch(
              layer.ownerDocument,
              { staffNumber, left: HAND_ROOM_PX, top: staff.top * read.scale, bottom: staff.bottom * read.scale },
              this.handsPlaying.includes(staffNumber),
            ),
          );
        }
      }
    }
  }

  /** The bars of a drawn page, in that page's pixels. */
  private barsOn(page: number): DrawnMeasure[] {
    const read = this.layouts.get(page);
    const bars: DrawnMeasure[] = [];
    for (const system of read?.layout.systems ?? []) {
      for (const bar of system.bars) {
        const measureIndex = measureIndexOfBar(bar.id);
        if (read === undefined || measureIndex === null) {
          continue;
        }
        bars.push({
          measureIndex,
          page,
          left: bar.left * read.scale,
          right: bar.right * read.scale,
          top: system.top * read.scale,
          bottom: system.bottom * read.scale,
        });
      }
    }
    return bars;
  }

  /**
   * The markers of a passage that stand on this page.
   *
   * Held to the piece first: a drag that reaches past either end is asking
   * for bars there are none of, and its marker waits at the end it has run
   * out of. Only the pages near the reader are drawn, so a bar that is not
   * on this page is on another one rather than past the edge of the music,
   * and its marker is drawn there when that page is.
   */
  private bracketsOn(page: number, passage: DrawnPassage): BracketShape[] {
    const from = clamp(passage.fromMeasureIndex, 0, this.lastBar);
    const to = clamp(passage.toMeasureIndex, 0, this.lastBar);
    return bracketShapes(this.barsOn(page), from, to).filter(
      (bracket) => bracket.measureIndex === (bracket.edge === 'start' ? from : to),
    );
  }

  /**
   * A layer of ours on a drawn page, over the music or behind it.
   *
   * On the page's outer drawing, whose units are the screen's pixels: a
   * marker a fingertip wide is a fingertip wide at any print. Found among the
   * drawing's own few children rather than looked for through the whole of
   * it, and made the first time it is asked for.
   */
  private layerOn(page: number, name: string, behind = false): SVGGElement | null {
    const drawing = this.drawn.has(page) ? this.sheets[page]?.querySelector('svg') : undefined;
    if (drawing === null || drawing === undefined) {
      return null;
    }
    for (const child of drawing.children) {
      if (child.classList.contains(name)) {
        return child as SVGGElement;
      }
    }
    const layer = drawing.ownerDocument.createElementNS(SVG_NAMESPACE, 'g');
    layer.setAttribute('class', name);
    if (behind) {
      drawing.prepend(layer);
    } else {
      drawing.append(layer);
    }
    return layer;
  }

  // A finger on the music: a marker taken hold of, a switch pressed, a bar
  // pointed at, a page swiped, or a touch.

  /**
   * Bound once, on the surface rather than on anything drawn, for the reason
   * `onPassageDragged` gives. A finger only takes hold when it landed on a
   * marker, so everything else - a scroll, a pinch - passes through.
   */
  private watchTheFingers(): void {
    // Before anything else, and not passive: a touch that landed on a marker
    // must not become a scroll. `touch-action` is supposed to say this on its
    // own, and on an SVG child it is not honoured everywhere - which is why a
    // marker could once be moved sideways but never down the page.
    this.container.addEventListener(
      'touchstart',
      (event) => {
        if (markerUnder(event.target, this.container) !== null) {
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
    this.container.addEventListener('pointerdown', (event) => {
      this.fingerDown(event);
    });
    this.container.addEventListener('pointermove', (event) => {
      this.fingerMoved(event);
    });
    this.container.addEventListener('pointerup', (event) => {
      this.fingerUp(event);
    });
    this.container.addEventListener('pointercancel', () => {
      this.letGo();
      this.paintThePassage();
    });
  }

  private fingerDown(event: PointerEvent): void {
    // A switch before anything else. It is a drawn thing with an edge to aim
    // at, so what the browser says was touched is the exact answer - and a
    // press on one is not a tap on the music, a hold on a bar, or a swipe.
    const hand = handUnder(event.target);
    if (hand !== null) {
      this.pressedHand = { pointerId: event.pointerId, staffNumber: hand };
      return;
    }
    const passage = this.passage;
    const touched = markerUnder(event.target, this.container);
    const at = this.pointOnAPage(event);
    // What the browser says was touched, and only then what the arithmetic
    // makes of the coordinates - and never a marker that is locked: a run is
    // being graded, and the handles it put away are not there to be found.
    const edge =
      touched?.edge ??
      (passage === null || passage.movable === false || at === null
        ? null
        : gripAt(this.bracketsOn(at.page, passage), at.point));
    if (edge === null || passage === null) {
      this.swipe = this.paged ? { pointerId: event.pointerId, x: event.clientX, y: event.clientY } : null;
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

  private fingerMoved(event: PointerEvent): void {
    this.turnIfDraggedOffThePage(event);
    const began = this.tapFrom ?? this.dragging?.from ?? null;
    if (began !== null && Math.hypot(event.clientX - began.x, event.clientY - began.y) > TAP_SLACK_PX) {
      // Moving is not pointing, at a bar or at a marker. A finger that has
      // set off with a marker is dragging it, and the wait it started when
      // it landed must not go off in the middle of that.
      this.cancelHold();
    }
    const drag = this.dragging;
    const moved = this.draggedTo(event);
    if (drag === null || moved === null) {
      return;
    }
    event.preventDefault();
    this.dragging = { ...drag, passage: moved };
    this.paintThePassage();
  }

  private fingerUp(event: PointerEvent): void {
    const pressed = this.pressedHand;
    if (pressed !== null && pressed.pointerId === event.pointerId) {
      this.pressedHand = null;
      // Only if the finger is still on it: one that travelled was reaching
      // for something else, even if it did not reach it.
      if (handUnder(event.target) === pressed.staffNumber) {
        for (const listener of [...this.handListeners]) {
          listener(pressed.staffNumber);
        }
      }
      return;
    }
    const swipe = this.swipe;
    this.swipe = null;
    if (swipe !== null && swipe.pointerId === event.pointerId) {
      const turned = swipeDirection(swipe, { x: event.clientX, y: event.clientY });
      if (turned !== 0) {
        this.tapFrom = null;
        this.cancelHold();
        this.turnPages(turned);
        return;
      }
    }

    const began = this.tapFrom;
    this.tapFrom = null;
    this.cancelHold();
    if (began !== null && began.pointerId === event.pointerId) {
      // A tap and not a drag: a finger that stayed put. Anything that moved
      // was reaching for something, even if it did not reach it.
      if (Math.hypot(event.clientX - began.x, event.clientY - began.y) <= TAP_SLACK_PX) {
        for (const listener of [...this.tapListeners]) {
          listener();
        }
      }
      return;
    }

    const drag = this.dragging;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    const moved = this.tappedGrip(event, drag) ?? this.draggedTo(event);
    this.dragging = null;
    this.container.releasePointerCapture?.(event.pointerId);
    if (moved !== null) {
      this.passage = moved;
    }
    this.paintThePassage();
    if (moved === null) {
      return;
    }
    for (const listener of [...this.passageListeners]) {
      listener(moved);
    }
  }

  /** Forgets every finger, as when the browser takes the touch for itself. */
  private letGo(): void {
    this.swipe = null;
    this.tapFrom = null;
    this.pressedHand = null;
    this.dragging = null;
    this.cancelHold();
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
  private tappedGrip(event: PointerEvent, drag: PassageDrag): DrawnPassage | null {
    if (Math.hypot(event.clientX - drag.from.x, event.clientY - drag.from.y) > TAP_SLACK_PX) {
      return null;
    }
    // The handle the browser says was touched, on whichever page its marker
    // is; or, where the finger landed on the line, the handle nearest it.
    const at = drag.grip === null ? this.pointOnAPage(event) : null;
    const grip =
      drag.grip === null
        ? at === null
          ? null
          : gripUnderPointer(gripsOf(this.bracketsOn(at.page, drag.passage)), at.point)
        : (gripsOf([...this.drawn].flatMap((page) => this.bracketsOn(page, drag.passage))).find(
            (each) => each.edge === drag.edge && each.end === drag.grip,
          ) ?? null);
    if (grip === null) {
      return null;
    }
    const next = passageAfterTap(
      { fromIndex: drag.passage.fromMeasureIndex, toIndex: drag.passage.toMeasureIndex },
      grip,
    );
    return { ...drag.passage, fromMeasureIndex: next.fromIndex, toMeasureIndex: next.toIndex };
  }

  /** Where this event puts the passage, or `null` when nothing is held. */
  private draggedTo(event: PointerEvent): DrawnPassage | null {
    const drag = this.dragging;
    const at = drag === null || drag.pointerId !== event.pointerId ? null : this.pointOnAPage(event);
    const landedOn = at === null || drag === null ? null : measureForDrag(this.barsOn(at.page), at.point, drag.edge);
    if (drag === null || landedOn === null) {
      return null;
    }
    const next = passageAfterDrag(
      { fromIndex: drag.passage.fromMeasureIndex, toIndex: drag.passage.toMeasureIndex },
      drag.edge,
      landedOn,
    );
    return { ...drag.passage, fromMeasureIndex: next.fromIndex, toMeasureIndex: next.toIndex };
  }

  /**
   * Turns the page when a marker is dragged off the side of it.
   *
   * A passage that runs onto the next page cannot be chosen otherwise: the
   * marker reaches the edge and stops, because the bar it is being taken to
   * is not on this page. Once on the way out and not again until the finger
   * has come back in - the new page is where the old one was, so a finger
   * held out there would otherwise watch the whole piece go by.
   */
  private turnIfDraggedOffThePage(event: PointerEvent): void {
    const drag = this.dragging;
    const at = this.paged && drag !== null ? this.pointOnAPage(event) : null;
    if (drag === null || at === null) {
      return;
    }
    const beyond = pageTurnForDrag(this.barsOn(at.page), at.point, this.drawnSize(at.page).width);
    if (beyond !== 0 && !drag.overshot) {
      this.dragging = { ...drag, overshot: true };
      this.turnPages(beyond);
      return;
    }
    if (beyond === 0 && drag.overshot) {
      this.dragging = { ...drag, overshot: false };
    }
  }

  /**
   * Starts the clock on a finger that has taken hold of a marker.
   *
   * It ends the drag when it fires: the reader asked the marker to do
   * something, not to be moved, and letting the drag finish as well would
   * nudge the passage a bar on the way out - a tap on a grip means that.
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
      // The bar the finger is inside, found by where it is rather than by
      // whatever element happened to be under it.
      const at = this.pointOnAPage(event);
      const bar = at === null ? null : measureAt(this.barsOn(at.page), at.point);
      if (bar === null) {
        return;
      }
      this.tapFrom = null;
      for (const listener of [...this.barHeldListeners]) {
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
   * The page a touch is on, and where on it, in that page's pixels.
   *
   * Read in pages, it is the page being read; scrolled, the drawn page the
   * finger is over. The browser's own answer where it has one - the
   * drawing's transform to the screen holds whatever the stylesheet or a
   * zoom did to it - and the page's box taken as the drawing shown whole
   * where it has none, which is a test with nothing laid out.
   */
  private pointOnAPage(event: {
    readonly clientX: number;
    readonly clientY: number;
  }): { readonly page: number; readonly point: { readonly x: number; readonly y: number } } | null {
    const page = this.paged ? this.pageAt : this.pageUnder(event.clientY);
    const drawing = page === null || !this.drawn.has(page) ? null : this.sheets[page]?.querySelector('svg');
    if (page === null || drawing === null || drawing === undefined) {
      return null;
    }
    const matrix = drawing.getScreenCTM?.();
    if (matrix !== null && matrix !== undefined) {
      const inside = new DOMPointReadOnly(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      return { page, point: { x: inside.x, y: inside.y } };
    }
    const box = drawing.getBoundingClientRect();
    const point = toDrawingPoint(
      { left: box.left, top: box.top, width: box.width, height: box.height },
      this.drawnSize(page),
      { x: event.clientX, y: event.clientY },
    );
    return point === null ? null : { page, point };
  }

  /** How large a drawn page is, in its own pixels; see `readTheDrawnPage`. */
  private drawnSize(page: number): { readonly width: number; readonly height: number } {
    const read = this.layouts.get(page);
    return read === undefined
      ? this.pagePx
      : { width: read.layout.width * read.scale, height: read.layout.height * read.scale };
  }

  /** The drawn page a scrolled score has under a height on the screen. */
  private pageUnder(clientY: number): number | null {
    for (const page of this.drawn) {
      const box = this.sheets[page]?.getBoundingClientRect();
      if (box !== undefined && clientY >= box.top && clientY < box.bottom) {
        return page;
      }
    }
    return null;
  }

  // What was played, drawn over the notes.

  configureOverlay(context: OverlayContext): void {
    this.overlayContext = context;
  }

  /**
   * Draws one press over the note it belongs to, onto its page.
   *
   * Only the mark just made: redrawing every mark for each note played is
   * work that grows with the run, and OSMD's did until the trainer stopped
   * answering two hundred notes into a long piece.
   */
  showPlayed(note: PlayedNote): void {
    const mark: PlayedMark = {
      stepIndex: note.stepIndex,
      midi: note.midi,
      correct: note.correct,
      sounding: note.sounding,
      offset: note.offset,
      settled: note.settled,
    };
    this.marks.push(mark);
    this.drawTheMark(mark);
  }

  /** Takes one press off again, found by what it is a mark of. */
  hidePlayed(note: { readonly stepIndex: number; readonly midi: number }): void {
    this.marks = this.marks.filter(
      (mark) => mark.stepIndex !== note.stepIndex || mark.midi !== note.midi,
    );
    const page = this.pageOfStep(note.stepIndex);
    const layer = page === undefined ? undefined : this.overlays.get(page)?.layer;
    for (const drawn of layer?.querySelectorAll(
      `[data-mark="${String(note.stepIndex)}:${String(note.midi)}"]`,
    ) ?? []) {
      drawn.remove();
    }
  }

  /** Says a beat has been played in full: its right notes stop being pale. */
  settlePlayed(stepIndex: number): void {
    this.marks = this.marks.map((mark) =>
      mark.stepIndex === stepIndex ? { ...mark, settled: true } : mark,
    );
    const page = this.pageOfStep(stepIndex);
    const layer = page === undefined ? undefined : this.overlays.get(page)?.layer;
    for (const drawn of layer?.querySelectorAll(`[data-mark^="${String(stepIndex)}:"]`) ?? []) {
      drawn.classList.remove('played--unsettled');
    }
  }

  clearPlayed(): void {
    this.marks = [];
    for (const overlay of this.overlays.values()) {
      overlay.layer.replaceChildren();
    }
  }

  // What has been played past, and what the run will not ask for.

  /** Takes a step's notes off the page: the page empties behind the reader. */
  fadePassed(stepIndex: number): void {
    this.faded.add(stepIndex);
    this.markTheStep(stepIndex, FADED_CLASS, true);
  }

  clearFaded(): void {
    for (const stepIndex of this.faded) {
      this.markTheStep(stepIndex, FADED_CLASS, false);
    }
    this.faded.clear();
  }

  /** Dims the notes this run will not ask for, and undims the rest. */
  dimUnplayed(reading: ScoreReading | null): void {
    this.reading = reading;
    for (const page of this.drawn) {
      const read = this.layouts.get(page)?.layout;
      for (const bar of read?.systems.flatMap((system) => system.bars) ?? []) {
        for (const stepIndex of this.stepsOfBar.get(bar.id) ?? []) {
          this.dimTheStep(stepIndex);
        }
      }
    }
  }

  /**
   * Reddens the marker for the step it is standing on, by how often the
   * reader has missed there.
   *
   * Said on the surface and left to the stylesheet, which reddens the
   * reader's marker by it and never the other hand's.
   */
  showTrouble(missteps: number): void {
    const level = Math.min(Math.max(Math.round(missteps), 0), TROUBLE_LEVELS);
    if (level <= 0) {
      delete this.container.dataset['trouble'];
      return;
    }
    this.container.dataset['trouble'] = String(level);
  }

  // Not drawn yet: the steps of the move after this one draw these. Until
  // then each is asked and does nothing, which is what a renderer that cannot
  // draw something is allowed to do - the run goes on the same.

  showNextPagePreview(_wanted: boolean): void {}

  turnPagesWithTheMusic(_wanted: boolean): void {}

  showRepeatedBars(_measureIndexes: readonly number[]): void {}

  showRhythmRuler(_marks: readonly RulerMark[]): void {}

  showBeat(_mark: RulerMark | null): void {}



}

/** A drawn page as it was read, and how many pixels of it make one of its units. */
interface ReadPage {
  readonly layout: PageLayout;
  readonly scale: number;
  /** Every named note and rest the page draws, by its name. */
  readonly elements: ReadonlyMap<string, Element>;
}

/** A drawn page's layer of played notes, and what they are placed by. */
interface PageOverlay {
  readonly layer: SVGGElement;
  /** `null` where the page prints no note to place anything by. */
  readonly geometry: StaffGeometry | null;
  /** Where each step on the page stands across it, in its units. */
  readonly stepX: ReadonlyMap<number, number>;
}

/** Where a finger landed, so a tap can be told from a drag. */
interface FingerAt {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
}

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

/**
 * The ledger lines drawn under a note's head: those of its staff that reach
 * across the head's left edge.
 *
 * Read off the staff's own group, where Verovio draws them - a short line
 * for each head that needs one, from a little before it to a little after -
 * and measured against the head as the note itself places it, which is in
 * the same frame as those lines.
 */
function ledgersUnder(note: Element): Element[] {
  const staff = note.closest('g.staff');
  const placed = HEAD_PLACE.exec(note.querySelector('g.notehead > use')?.getAttribute('transform') ?? '');
  if (staff === null || placed === null) {
    return [];
  }
  const headX = Number(placed[1]);
  return [...staff.querySelectorAll(':scope > g.ledgerLines > path')].filter((path) => {
    const found = LEDGER.exec(path.getAttribute('d') ?? '');
    if (found === null) {
      return false;
    }
    const [from, to] = [Number(found[1]), Number(found[2])].sort((a, b) => a - b);
    return from !== undefined && to !== undefined && from <= headX && headX <= to;
  });
}

/** Where a head's glyph is placed: `translate(x, y)`, the x taken. */
const HEAD_PLACE = /translate\(\s*(-?[\d.]+)/;

/** A ledger line as Verovio writes one: `M x y L x y`, the two x taken. */
const LEDGER = /M\s*(-?[\d.]+)[\s,]+-?[\d.]+\s*L\s*(-?[\d.]+)/;

/** The steps of each bar, by the bar's printed name. */
function stepsByBar(printed: readonly PrintedStep[]): Map<string, number[]> {
  const steps = new Map<string, number[]>();
  printed.forEach((step, index) => {
    const bar = steps.get(step.barId) ?? [];
    bar.push(index);
    steps.set(step.barId, bar);
  });
  return steps;
}

function clampZoom(zoom: number): number {
  return clamp(zoom, LEAST_ZOOM, MOST_ZOOM);
}

function clamp(value: number, least: number, most: number): number {
  return Math.min(most, Math.max(least, value));
}

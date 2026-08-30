import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type {
  DrawnPassage,
  IPassageMarkers,
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
  measureForDrag,
  passageAfterDrag,
  toDrawingPoint,
  type DrawnMeasure,
  type PassageEdge,
} from './passageBrackets.js';
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
}

export class OsmdScoreRenderer
  implements IScoreRenderer, IPlayedNoteOverlay, IScoreFade, IScoreZoom, IPassageMarkers
{
  private readonly container: HTMLElement;
  private readonly options: OsmdRendererOptions;
  private readonly navigator: CursorNavigator;

  /** Where each timeline step sits, and the notes drawn there. */
  private stepX = new Map<number, number>();
  private stepElements = new Map<number, SVGGElement[]>();
  private faded = new Set<number>();
  private samples: DrawnNoteSample[] = [];
  private marks: PlayedMark[] = [];
  private overlayContext: OverlayContext | null = null;
  private overlayGroup: SVGGElement | null = null;

  /** Where the engraver put each bar, and the markers standing on them. */
  private measures: DrawnMeasure[] = [];
  private passage: DrawnPassage | null = null;
  private passageGroup: SVGGElement | null = null;
  private passageListeners: ((passage: DrawnPassage) => void)[] = [];
  private dragging: PassageDrag | null = null;

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
    this.navigator.reset();
    this.indexDrawnNotes();
    this.measures = this.readMeasures();
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
    this.navigator.reset();
    // Re-engraving throws the old SVG away, and everything drawn on it.
    this.indexDrawnNotes();
    this.measures = this.readMeasures();
    this.paintOverlay();
    this.paintFaded();
    this.paintPassage();
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

  /**
   * Follows a finger that has taken hold of a marker.
   *
   * Bound once, in the constructor, for the reason above. `pointerdown` only
   * takes hold when the touch actually landed on a marker, so everything else
   * - a scroll, a pinch - passes through untouched.
   */
  private watchForDrags(): void {
    this.container.addEventListener('pointerdown', (event) => this.beginDrag(event));
    this.container.addEventListener('pointermove', (event) => this.continueDrag(event));
    this.container.addEventListener('pointerup', (event) => this.endDrag(event));
    this.container.addEventListener('pointercancel', () => {
      this.dragging = null;
      this.setDragging(false);
      this.paintPassage();
    });
  }

  /** Tells the stylesheet to stop the page scrolling under the finger. */
  private setDragging(dragging: boolean): void {
    const scroller = this.container.closest('.score__scroll');
    if (scroller instanceof HTMLElement) {
      scroller.dataset['dragging'] = String(dragging);
    }
  }

  private beginDrag(event: PointerEvent): void {
    const passage = this.passage;
    const point = this.drawingPointOf(event);
    if (passage === null || point === null) {
      return;
    }
    const edge = gripAt(
      bracketShapes(this.measures, passage.fromMeasureIndex, passage.toMeasureIndex),
      point,
    );
    if (edge === null) {
      return;
    }
    // Held for the whole gesture, so a finger that wanders off the marker -
    // which is most of them - goes on moving it instead of being dropped.
    this.container.setPointerCapture?.(event.pointerId);
    // Otherwise the score scrolls under the finger that is moving a marker.
    // Both halves are needed: the flag is what the stylesheet turns into
    // `touch-action: none`, which is the only thing a touch screen listens
    // to, and `preventDefault` covers the mouse.
    this.setDragging(true);
    event.preventDefault();
    this.dragging = { edge, pointerId: event.pointerId, passage };
  }

  private continueDrag(event: PointerEvent): void {
    const moved = this.draggedTo(event);
    if (moved === null) {
      return;
    }
    event.preventDefault();
    this.dragging = { ...this.dragging as PassageDrag, passage: moved };
    this.paintPassage();
  }

  private endDrag(event: PointerEvent): void {
    const moved = this.draggedTo(event);
    const drag = this.dragging;
    this.dragging = null;
    this.setDragging(false);
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
    const landedOn = measureForDrag(this.measures, point, drag.edge);
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
    const svg = this.container.querySelector('svg');
    if (svg === null) {
      return null;
    }
    const box = svg.getBoundingClientRect();
    return toDrawingPoint(
      { left: box.left, top: box.top, width: box.width, height: box.height },
      { width: svg.width.baseVal.value, height: svg.height.baseVal.value },
      { x: event.clientX, y: event.clientY },
    );
  }

  scrollToStart(): void {
    // The scrolling box, not the framed one: the frame holds the cover and
    // does not move. Whichever ancestor actually scrolls is the one to ask.
    const scroller = this.container.closest('.score__scroll') ?? this.container.parentElement;
    scroller?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  }

  clear(): void {
    this.osmd?.clear();
    this.measures = [];
    this.passage = null;
    this.passageGroup = null;
    this.dragging = null;
    this.marks = [];
    this.stepX = new Map();
    this.stepElements = new Map();
    this.faded = new Set();
    this.samples = [];
    this.overlayGroup = null;
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
  private paintOverlay(): void {
    const group = this.ensureOverlayGroup();
    if (group === null) {
      return;
    }
    while (group.firstChild !== null) {
      group.firstChild.remove();
    }

    const context = this.overlayContext;
    const geometry = fitStaffGeometry(this.samples);
    if (context === null || geometry === null || this.marks.length === 0) {
      return;
    }

    const shapes = buildOverlayShapes(this.marks, {
      geometry,
      stepX: this.stepX,
      clefAt: context.clefAt,
      keyAt: context.keyAt,
    });
    for (const shape of shapes) {
      group.append(this.createShape(shape, group.ownerDocument));
    }
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
    for (const page of sheet?.MusicPages ?? []) {
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
    const group = this.ensurePassageGroup();
    if (group === null) {
      return;
    }
    group.replaceChildren();
    const showing = this.dragging?.passage ?? this.passage;
    if (showing === null) {
      return;
    }
    const doc = group.ownerDocument;
    for (const bracket of bracketShapes(
      this.measures,
      showing.fromMeasureIndex,
      showing.toMeasureIndex,
    )) {
      const shape = doc.createElementNS(SVG_NAMESPACE, 'g');
      shape.setAttribute('class', `passage-marker passage-marker--${bracket.edge}`);
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
      // A grip at each end, because the middle of the marker is over the
      // music and a finger there would be covering what it is choosing.
      for (const y of [bracket.top, bracket.bottom]) {
        const grip = doc.createElementNS(SVG_NAMESPACE, 'circle');
        grip.setAttribute('class', 'passage-marker__grip');
        grip.setAttribute('cx', String(bracket.x));
        grip.setAttribute('cy', String(y));
        grip.setAttribute('r', String(MARKER_GRIP_RADIUS));
        shape.append(grip);
      }
      group.append(shape);
    }
  }

  private ensurePassageGroup(): SVGGElement | null {
    if (this.passageGroup !== null && this.passageGroup.isConnected) {
      return this.passageGroup;
    }
    const svg = this.container.querySelector('svg');
    if (svg === null) {
      return null;
    }
    const group = svg.ownerDocument.createElementNS(SVG_NAMESPACE, 'g');
    group.setAttribute('class', 'passage-markers');
    svg.append(group);
    this.passageGroup = group;
    return group;
  }

  private ensureOverlayGroup(): SVGGElement | null {
    if (this.overlayGroup !== null && this.overlayGroup.isConnected) {
      return this.overlayGroup;
    }
    const svg = this.container.querySelector('svg');
    if (svg === null) {
      return null;
    }
    const doc = svg.ownerDocument;
    const group = doc.createElementNS(SVG_NAMESPACE, 'g');
    group.setAttribute('class', 'played-overlay');
    svg.append(group);
    this.overlayGroup = group;
    return group;
  }

  /**
   * Records where the engraver put each step, and the pitches it drew there.
   *
   * Walking the cursor is the only way to ask, so the visible cursor is walked
   * once and then put back where it was.
   */
  private indexDrawnNotes(): void {
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
        }

        const diatonicIndex = diatonicIndexOf(pitch.FundamentalNote ?? -1, pitch.Octave ?? 0);
        if (diatonicIndex === null) {
          continue;
        }
        samples.push({
          stepIndex,
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

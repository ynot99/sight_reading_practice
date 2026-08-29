import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type {
  IPlayedNoteOverlay,
  IScoreCursor,
  IScoreFade,
  IScoreRenderer,
  IScoreZoom,
  OverlayContext,
  PlayedNote,
} from '../../application/ports/IScoreRenderer.js';
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
export class OsmdScoreRenderer
  implements IScoreRenderer, IPlayedNoteOverlay, IScoreFade, IScoreZoom
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
    this.paintOverlay();
    this.paintFaded();
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
    this.paintOverlay();
    this.paintFaded();
  }

  /**
   * Tells the application which step a touch landed on.
   *
   * One listener on the container rather than one per notehead: the page is
   * re-engraved often - a zoom, a resize, a tempo change - and handlers bound
   * to elements would have to be rebound each time, or quietly stop working
   * after the first redraw. Which element belongs to which step is already
   * known, so the lookup walks up from whatever was touched.
   */
  onNoteTapped(listener: (stepIndex: number) => void): () => void {
    const handle = (event: Event): void => {
      const step = this.stepOf(event.target);
      if (step !== null) {
        listener(step);
      }
    };
    this.container.addEventListener('pointerup', handle);
    return () => this.container.removeEventListener('pointerup', handle);
  }

  /** The step a drawn element belongs to, looking outwards from it. */
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

  scrollToStart(): void {
    // The scrolling box, not the framed one: the frame holds the cover and
    // does not move. Whichever ancestor actually scrolls is the one to ask.
    const scroller = this.container.closest('.score__scroll') ?? this.container.parentElement;
    scroller?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  }

  clear(): void {
    this.osmd?.clear();
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

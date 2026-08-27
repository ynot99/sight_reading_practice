import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type {
  IPlayedNoteOverlay,
  IScoreCursor,
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

/** The part of the engraver's graphical note this adapter reads. */
interface DrawnNote {
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
  implements IScoreRenderer, IPlayedNoteOverlay, IScoreZoom
{
  private readonly container: HTMLElement;
  private readonly options: OsmdRendererOptions;
  private readonly navigator: CursorNavigator;

  /** Where each timeline step sits, and the notes drawn there. */
  private stepX = new Map<number, number>();
  private samples: DrawnNoteSample[] = [];
  private marks: PlayedMark[] = [];
  private overlayContext: OverlayContext | null = null;
  private overlayGroup: SVGGElement | null = null;

  private osmd: OpenSheetMusicDisplay | null = null;
  private loaded = false;
  private currentZoom: number;

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
    this.navigator.reset();
    this.indexDrawnNotes();
    this.paintOverlay();
  }

  refresh(): void {
    if (!this.loaded || this.osmd === null) {
      return;
    }
    this.osmd.zoom = this.currentZoom;
    this.osmd.render();
    this.navigator.reset();
    // Re-engraving throws the old SVG away, and the overlay with it.
    this.indexDrawnNotes();
    this.paintOverlay();
  }

  clear(): void {
    this.osmd?.clear();
    this.marks = [];
    this.stepX = new Map();
    this.samples = [];
    this.overlayGroup = null;
    this.loaded = false;
  }

  configureOverlay(context: OverlayContext): void {
    this.overlayContext = context;
  }

  showPlayed(note: PlayedNote): void {
    this.marks.push({ stepIndex: note.stepIndex, midi: note.midi, correct: note.correct });
    this.paintOverlay();
  }

  clearPlayed(): void {
    this.marks = [];
    this.paintOverlay();
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
      clefByStaff: context.clefByStaff,
      key: context.key,
    });
    for (const shape of shapes) {
      group.append(this.createShape(shape, group.ownerDocument));
    }
  }

  private createShape(shape: OverlayShape, doc: Document): SVGElement {
    const colourClass = shape.correct ? 'played--correct' : 'played--wrong';
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
    this.navigator.reset();
    this.navigator.moveTo(restoreTo);
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

        const diatonicIndex = diatonicIndexOf(pitch.FundamentalNote ?? -1, pitch.Octave ?? 0);
        if (diatonicIndex === null) {
          continue;
        }
        samples.push({
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
      autoResize: true,
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

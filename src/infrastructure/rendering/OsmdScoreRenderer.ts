import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type {
  IScoreCursor,
  IScoreHighlighter,
  IScoreRenderer,
  IScoreZoom,
  StepHighlight,
} from '../../application/ports/IScoreRenderer.js';
import { CursorNavigator, type ICursorPrimitive } from './CursorNavigator.js';

export interface OsmdRendererOptions {
  readonly zoom?: number;
  readonly cursorColor?: string;
  readonly drawTitle?: boolean;
}

/** CSS class applied to the notes of a judged step. */
const HIGHLIGHT_CLASS: Readonly<Record<StepHighlight, string>> = {
  correct: 'note--correct',
  late: 'note--late',
  incorrect: 'note--incorrect',
  missed: 'note--missed',
};

const ALL_HIGHLIGHT_CLASSES = Object.values(HIGHLIGHT_CLASS);

/** The part of OSMD's graphical note that exposes its drawn output. */
interface DrawnNote {
  getSVGGElement?: () => SVGGElement | null;
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
export class OsmdScoreRenderer implements IScoreRenderer, IScoreHighlighter, IScoreZoom {
  private readonly container: HTMLElement;
  private readonly options: OsmdRendererOptions;
  private readonly navigator: CursorNavigator;

  /** Drawn notes per timeline step, rebuilt whenever the score is re-engraved. */
  private stepElements: SVGGElement[][] = [];
  private readonly highlights = new Map<number, StepHighlight>();

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
    this.highlights.clear();
    await osmd.load(musicXml);
    osmd.zoom = this.currentZoom;
    osmd.render();
    this.loaded = true;
    this.navigator.reset();
    this.indexDrawnNotes();
  }

  refresh(): void {
    if (!this.loaded || this.osmd === null) {
      return;
    }
    this.osmd.zoom = this.currentZoom;
    this.osmd.render();
    this.navigator.reset();
    // Re-engraving throws the old SVG away, taking every highlight with it.
    this.indexDrawnNotes();
    this.applyHighlights();
  }

  clear(): void {
    this.osmd?.clear();
    this.highlights.clear();
    this.stepElements = [];
    this.loaded = false;
  }

  highlight(stepIndex: number, highlight: StepHighlight): void {
    this.highlights.set(stepIndex, highlight);
    this.paint(stepIndex, highlight);
  }

  clearHighlights(): void {
    for (const stepIndex of this.highlights.keys()) {
      for (const element of this.stepElements[stepIndex] ?? []) {
        element.classList.remove(...ALL_HIGHLIGHT_CLASSES);
      }
    }
    this.highlights.clear();
  }

  private paint(stepIndex: number, highlight: StepHighlight): void {
    for (const element of this.stepElements[stepIndex] ?? []) {
      element.classList.remove(...ALL_HIGHLIGHT_CLASSES);
      element.classList.add(HIGHLIGHT_CLASS[highlight]);
    }
  }

  private applyHighlights(): void {
    for (const [stepIndex, highlight] of this.highlights) {
      this.paint(stepIndex, highlight);
    }
  }

  /**
   * Records which drawn notes belong to which timeline step.
   *
   * Walking the cursor is the only way to ask OSMD this question, so the
   * visible cursor is walked once and then put back where it was.
   */
  private indexDrawnNotes(): void {
    const osmd = this.osmd;
    const cursor = osmd?.cursor;
    if (osmd === null || cursor === undefined || cursor === null) {
      this.stepElements = [];
      return;
    }

    const restoreTo = this.navigator.position;
    const collected: SVGGElement[][] = [];

    cursor.reset();
    let guard = 10_000;
    while (!cursor.iterator.EndReached && guard > 0) {
      guard -= 1;
      collected.push(this.drawnNotesUnderCursor(cursor));
      cursor.next();
    }

    this.stepElements = collected;
    this.navigator.reset();
    this.navigator.moveTo(restoreTo);
  }

  private drawnNotesUnderCursor(cursor: NonNullable<OpenSheetMusicDisplay['cursor']>): SVGGElement[] {
    const elements: SVGGElement[] = [];
    try {
      for (const note of cursor.GNotesUnderCursor()) {
        const drawn = note as unknown as DrawnNote;
        const element = typeof drawn.getSVGGElement === 'function' ? drawn.getSVGGElement() : null;
        if (element !== null && element !== undefined) {
          elements.push(element);
        }
      }
    } catch {
      // A note that was not drawn (an invisible staff, say) simply has no
      // element to colour.
    }
    return elements;
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

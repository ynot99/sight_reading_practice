import type {
  DrawnPassage,
  IPassageMarkers,
  IPlayedNoteOverlay,
  IScoreFade,
  IScoreCursor,
  IScoreRenderer,
  IScoreZoom,
  OverlayContext,
  PlayedNote,
} from '../../application/ports/IScoreRenderer.js';
import type { ICursorPrimitive } from '../rendering/CursorNavigator.js';

/** In-memory cursor that records every move. */
export class FakeScoreCursor implements IScoreCursor {
  private index = 0;
  visible = false;
  readonly moves: number[] = [];
  resetCount = 0;

  get position(): number {
    return this.index;
  }

  show(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  reset(): void {
    this.index = 0;
    this.resetCount += 1;
  }

  moveTo(stepIndex: number): void {
    this.index = stepIndex;
    this.moves.push(stepIndex);
  }
}

/**
 * Renderer that keeps the MusicXML instead of drawing it.
 *
 * Lets the controller and the cursor synchronisation be tested end to end
 * without a DOM, an SVG backend or OSMD.
 */
export class FakeScoreRenderer
  implements IScoreRenderer, IPlayedNoteOverlay, IScoreFade, IScoreZoom, IPassageMarkers
{
  readonly cursor = new FakeScoreCursor();
  loadedXml: string | null = null;
  loadCount = 0;
  refreshCount = 0;
  clearCount = 0;

  /** Every press drawn over the score, in order. */
  readonly played: PlayedNote[] = [];
  overlayContext: OverlayContext | null = null;
  clearPlayedCount = 0;
  zoom = 0.85;

  configureOverlay(context: OverlayContext): void {
    this.overlayContext = context;
  }

  showPlayed(note: PlayedNote): void {
    this.played.push(note);
  }

  clearPlayed(): void {
    this.played.length = 0;
    this.clearPlayedCount += 1;
  }

  /** Steps dimmed because they have been passed. */
  readonly faded = new Set<number>();
  clearFadedCount = 0;

  fadePassed(stepIndex: number): void {
    this.faded.add(stepIndex);
  }

  clearFaded(): void {
    this.faded.clear();
    this.clearFadedCount += 1;
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
  }

  load(musicXml: string): Promise<void> {
    this.loadedXml = musicXml;
    this.loadCount += 1;
    return Promise.resolve();
  }

  refresh(): void {
    this.refreshCount += 1;
  }

  scrollToStartCount = 0;
  private passageListeners: ((passage: DrawnPassage) => void)[] = [];

  /** The bars the markers are standing around, or `null` when hidden. */
  shownPassage: DrawnPassage | null = null;

  showPassage(passage: DrawnPassage): void {
    this.shownPassage = passage;
  }

  hidePassage(): void {
    this.shownPassage = null;
  }

  onPassageDragged(listener: (passage: DrawnPassage) => void): () => void {
    this.passageListeners.push(listener);
    return () => {
      this.passageListeners = this.passageListeners.filter((each) => each !== listener);
    };
  }

  /** Stands in for a reader dragging a marker onto those bars. */
  dragPassage(passage: DrawnPassage): void {
    for (const listener of [...this.passageListeners]) {
      listener(passage);
    }
  }

  scrollToStart(): void {
    this.scrollToStartCount += 1;
  }

  clear(): void {
    this.loadedXml = null;
    this.clearCount += 1;
    this.played.length = 0;
    this.faded.clear();
  }
}

/**
 * Forward-only cursor primitive with a fixed number of positions, used to
 * verify {@link CursorNavigator} against the engraver contract.
 */
export class FakeCursorPrimitive implements ICursorPrimitive {
  private index = 0;
  private readonly length: number;
  visible = false;
  nextCalls = 0;
  resetCalls = 0;

  constructor(length: number) {
    this.length = length;
  }

  get position(): number {
    return this.index;
  }

  get endReached(): boolean {
    return this.index >= this.length - 1;
  }

  reset(): void {
    this.index = 0;
    this.resetCalls += 1;
  }

  next(): void {
    this.nextCalls += 1;
    if (this.index < this.length - 1) {
      this.index += 1;
    }
  }

  show(): void {
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }
}

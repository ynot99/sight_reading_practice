import type { IScoreCursor, IScoreRenderer } from '../../application/ports/IScoreRenderer.js';
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
export class FakeScoreRenderer implements IScoreRenderer {
  readonly cursor = new FakeScoreCursor();
  loadedXml: string | null = null;
  loadCount = 0;
  refreshCount = 0;
  clearCount = 0;

  load(musicXml: string): Promise<void> {
    this.loadedXml = musicXml;
    this.loadCount += 1;
    return Promise.resolve();
  }

  refresh(): void {
    this.refreshCount += 1;
  }

  clear(): void {
    this.loadedXml = null;
    this.clearCount += 1;
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

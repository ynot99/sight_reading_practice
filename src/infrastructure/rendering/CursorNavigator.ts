import type { IScoreCursor } from '../../application/ports/IScoreRenderer.js';

/**
 * The absolute minimum a renderer must offer to be steerable.
 *
 * Engravers expose forward-only iterators; the application thinks in absolute
 * timeline indices. Isolating that mismatch here keeps the translation
 * testable without a DOM.
 */
export interface ICursorPrimitive {
  reset(): void;
  next(): void;
  show(): void;
  hide(): void;
  readonly endReached: boolean;
}

/**
 * Turns a forward-only cursor into a random-access one.
 *
 * Moving forward steps; moving backwards rewinds and replays. Sight-reading
 * only ever moves forward one step at a time, so the rewind path is a
 * correctness fallback rather than a hot path.
 */
export class CursorNavigator implements IScoreCursor {
  private readonly primitive: ICursorPrimitive;
  private index = 0;

  constructor(primitive: ICursorPrimitive) {
    this.primitive = primitive;
  }

  get position(): number {
    return this.index;
  }

  show(): void {
    this.primitive.show();
  }

  hide(): void {
    this.primitive.hide();
  }

  reset(): void {
    this.primitive.reset();
    this.index = 0;
  }

  moveTo(stepIndex: number): void {
    const target = Math.max(0, stepIndex);
    if (target < this.index) {
      this.reset();
    }
    // Stops early at the end of the sheet, so the navigator never claims a
    // position the engraver cannot display.
    while (this.index < target && !this.primitive.endReached) {
      this.primitive.next();
      this.index += 1;
    }
  }
}

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
  /**
   * Advances without moving the marker on the page.
   *
   * A walk of a thousand steps has one interesting position - the last - and
   * an engraver's `next` puts the marker on the page at every one of them.
   * Each of those is a read of the layout and a write to the drawing, and on a
   * long score the reader watches the marker crawl from the top of the piece to
   * where they asked to start.
   */
  stepWithoutDrawing(): void;
  /** The step back that {@link stepWithoutDrawing} is the step forward of. */
  stepBackWithoutDrawing(): void;
  /** Puts the marker where the steps have left it, once. */
  drawWhereItIs(): void;
  readonly endReached: boolean;
}

/**
 * Turns a one-step-at-a-time cursor into a random-access one.
 *
 * Moving backwards used to mean rewinding to the top of the sheet and
 * replaying, on the grounds that sight-reading only ever moves forward and the
 * rewind was a correctness fallback. A passage made that false: every run of
 * one begins by going back to where it starts, from wherever the last run
 * finished, and on an eighty-five bar arrangement with a passage two thirds of
 * the way in that was a rewind of some five hundred positions - each one a move
 * of the marker on the page - between the reader's chord and the sound it was
 * meant to start. His: "коли гра закінчується на слайсі - то play to start вже
 * реагує з сильною затримкою".
 */
export class CursorNavigator implements IScoreCursor {
  private readonly primitive: ICursorPrimitive;
  private index = 0;
  /** Whether the reader asked for a cursor at all. */
  private wanted = true;
  private moved: ((stepIndex: number, byTheMusic: boolean) => void) | null = null;

  constructor(primitive: ICursorPrimitive) {
    this.primitive = primitive;
  }

  get position(): number {
    return this.index;
  }

  /** True while the reader has asked to see it, wherever it happens to be. */
  get isWanted(): boolean {
    return this.wanted;
  }

  /**
   * Told whenever the cursor lands somewhere new.
   *
   * Every mode moves the cursor - practising, listening, playing a take
   * back - so this is the one place that knows the music has gone somewhere,
   * whatever is driving it. A page that follows the cursor therefore follows
   * it in all of them, rather than only where somebody remembered to say so.
   */
  onMoved(listener: (stepIndex: number, byTheMusic: boolean) => void): void {
    this.moved = listener;
  }

  show(): void {
    this.wanted = true;
    this.primitive.show();
    // Said, for the reason a reset is: *where* the marker is decides whether
    // showing it shows the reader anything true. The engraver draws one
    // marker over the whole score and places it in the coordinates of its
    // own page, so turned on while page five is in front of them it stands
    // over page five's first bar and claims to be there.
    this.moved?.(this.index, false);
  }

  hide(): void {
    this.wanted = false;
    this.primitive.hide();
  }

  /**
   * Puts the marker back on the first note, and tells nobody.
   *
   * The difference between this and `moveTo(0)` is who asked. A reset is
   * bookkeeping - the page has been re-engraved, a run is being set up - and
   * a page that followed it threw the reader onto page one every time they
   * touched a setting. `moveTo` is the music actually going somewhere, and
   * the page follows that.
   */
  reset(): void {
    this.primitive.reset();
    this.index = 0;
    // Said, but not as the music moving. Whoever is listening still has to
    // know the marker is somewhere else - a marker left showing on a page it
    // is no longer on is a cursor hanging over unrelated music - but the page
    // must not follow, or every re-engraving and every finished run would
    // throw the reader back to the first one.
    this.moved?.(this.index, false);
  }

  moveTo(stepIndex: number): void {
    const target = Math.max(0, stepIndex);
    let walked = false;
    if (target < this.index) {
      // Whichever is fewer moves: back a step at a time, or from the top. Going
      // back is the shorter way for everything that actually happens - a
      // passage played again, a bar picked up after a pause - and the rewind
      // stays for the one case it is really shorter, which is a jump to near
      // the beginning of a long piece.
      if (this.index - target <= target) {
        while (this.index > target) {
          this.primitive.stepBackWithoutDrawing();
          this.index -= 1;
          walked = true;
        }
      } else {
        this.primitive.reset();
        this.index = 0;
      }
    }
    // Stops early at the end of the sheet, so the navigator never claims a
    // position the engraver cannot display.
    //
    // And the marker is put down once, at the end, rather than dragged through
    // every position on the way. Measured on a score of thirteen thousand
    // positions: starting a run eight hundred bars in walked some eight
    // thousand of them, each one a move of the marker on the page, and the
    // reader's report was that the further in they began the longer the wait
    // and the further the music had jumped by the time it was over. One step
    // costs the same as it ever did; a thousand now cost one drawing.
    //
    // Backwards as well, which is what every start of a passage does after
    // the last run finished at its end: measured on his device, most of the
    // time the marker took to come back a few bars was spent drawing it at
    // each of them.
    while (this.index < target && !this.primitive.endReached) {
      this.primitive.stepWithoutDrawing();
      this.index += 1;
      walked = true;
    }
    if (walked) {
      this.primitive.drawWhereItIs();
    }
    this.moved?.(this.index, true);
  }
}

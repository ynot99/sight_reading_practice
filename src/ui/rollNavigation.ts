import { speedOf, type FingerAt } from './rollScroller.js';
import {
  scrollAfterZoom,
  theWindowOnTheRun,
  zoomAfterWheel,
  pinchedTo,
  LEAST_ROW,
  LEAST_ZOOM,
  MOST_ROW,
  MOST_ZOOM,
  type FingerSpan,
  type PinchedFrom,
} from './rollView.js';
import { TAP_SLOP_PX } from './sketchEditing.js';
import type { AppView } from './AppView.js';

/** How far a wheel's line is, for a wheel that counts in lines. */
const LINE_PX = 16;

/** How far down the run the view stood, and the place down it a change of row height is held at. */
interface RowsHeld {
  readonly scrolledDownPx: number;
  readonly viewTallPx: number;
  readonly wholeTallPx: number;
  readonly atPx: number;
}

/**
 * How far a wheel turned, whichever way it turned.
 *
 * A wheel turns up and down; a trackpad swiped sideways turns only across.
 * Where a turn means a size rather than a place, either way is the same ask.
 */
function theWheelsTurn(event: WheelEvent): number {
  return event.deltaY !== 0 ? event.deltaY : event.deltaX;
}

/**
 * What moving and zooming the drawing asks of the view: where it is scrolled,
 * how it is laid out and measured, and showing it again.
 */
export type TheViewOfTheNavigation = Pick<
  AppView,
  | 'applyTheZoom'
  | 'askWhereTheViewIs'
  | 'doc'
  | 'drawnScene'
  | 'el'
  | 'panned'
  | 'rollCanvases'
  | 'rollRowPx'
  | 'rollScroller'
  | 'showTheView'
  | 'showTheWindow'
  | 'theRowAsDrawn'
  | 'theRunsHeights'
  | 'theRunsWidths'
>;

/**
 * Moving about the drawing and zooming it: a wheel over it and over its maps,
 * a finger moving it and thrown, two fingers pinching it - each holding what
 * is under the pointer, or between the fingers, where it was.
 *
 * Its own state is only the fingers down and what a gesture holds while it
 * lasts. Where the drawing is scrolled stays the view's scroller, and the
 * view shows it; the view tells this of each finger as it goes down, moves
 * and comes up.
 */
export class RollNavigation {
  private readonly host: TheViewOfTheNavigation;
  /** The frame a fling is going on in, if one is. */
  private flingFrame: number | null = null;
  /**
   * A finger moving the drawing: where the view stood when it came down, where
   * it came down, and where it has been lately - which is how fast it was
   * going when it lets go.
   */
  private rollPan: {
    readonly pointerId: number;
    readonly fromX: number;
    readonly fromY: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly trail: FingerAt[];
    moved: boolean;
  } | null = null;
  /**
   * Fingers down on the drawing, and what the zoom was when the second arrived.
   *
   * Two are a pinch. Kept by pointer id rather than counted, because a finger
   * lifted is a particular finger and the one still down has to go on meaning
   * what it meant.
   */
  private readonly rollFingers = new Map<number, { readonly x: number; readonly y: number }>();
  private pinchedFrom: PinchedFrom | null = null;
  /**
   * Whether the gesture that is ending was a pinch.
   *
   * A pinch ends with fingers coming up, and a finger coming up off an element
   * is a click as far as the page is concerned - so without this, every pinch
   * also moved the head to wherever the last finger happened to be.
   */
  pinched = false;

  constructor(host: TheViewOfTheNavigation) {
    this.host = host;
  }

  /** A press on the drawing begins: no gesture ended by it was a pinch or a pan, and a fling under way stops. */
  aPressBegins(): void {
    this.pinched = false;
    this.host.panned = false;
    this.stopTheFling();
  }

  /** How many fingers are down moving or pinching the drawing. */
  get fingersDown(): number {
    return this.rollFingers.size;
  }

  /** Whether a pointer is one of those fingers. */
  isAFinger(pointerId: number): boolean {
    return this.rollFingers.has(pointerId);
  }

  /**
   * A finger already on the drawing, holding something there, counted as one
   * of the fingers that pinch it - where a second has come down: see
   * `AppView.countTheFingerIn`.
   */
  countAsAFinger(pointerId: number, at: { readonly x: number; readonly y: number }): void {
    this.rollFingers.set(pointerId, at);
  }

  /** A finger no longer one of those moving the drawing: lifted where it was never heard, or holding something now. */
  forgetTheFinger(pointerId: number): void {
    this.rollFingers.delete(pointerId);
  }

  /** The drawing no longer moved by the finger that was moving it: it holds something else now. */
  letGoOfThePan(): void {
    this.rollPan = null;
  }

  /**
   * A finger down on the drawing to move it: the second of two begins a
   * pinch, and the only one moves the drawing where it `pans` - a finger or a
   * pen always, a mouse where the view says so.
   */
  fingerDown(event: PointerEvent, pans: boolean): void {
    this.rollFingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.beginAPinch();
    this.rollPan =
      pans && this.rollFingers.size === 1
        ? {
            pointerId: event.pointerId,
            fromX: this.host.rollScroller.x,
            fromY: this.host.rollScroller.y,
            clientX: event.clientX,
            clientY: event.clientY,
            trail: [{ atMs: event.timeStamp, x: event.clientX, y: event.clientY }],
            moved: false,
          }
        : null;
  }

  /** One of the fingers moves: a pinch with two, a pan with one. Whether it was one of them. */
  fingerMoved(event: PointerEvent): boolean {
    if (!this.rollFingers.has(event.pointerId)) {
      return false;
    }
    this.rollFingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.pinchTheRoll();
    this.panTheRoll(event);
    return true;
  }

  /** One of the fingers comes up: thrown, where it ends a pan by `pointerup`, the drawing goes on. */
  fingerUp(event: PointerEvent, thrown: boolean): void {
    if (!this.rollFingers.has(event.pointerId)) {
      return;
    }
    this.rollFingers.delete(event.pointerId);
    this.beginAPinch();
    if (this.rollPan?.pointerId === event.pointerId) {
      this.letThePanGo(event, thrown);
    }
  }

  /**
   * Moves the zoom by a wheel, leaving what is under the pointer under it.
   *
   * The pointer and not the left edge: pointing at the bar that went wrong and
   * zooming in used to slide that bar off the screen, so every turn of the
   * wheel had to be followed by hunting for the place again.
   *
   * One turn moves the zoom by a small step whatever the wheel says. A notch
   * and a trackpad flick arrive as tens against ones, and a zoom taken straight
   * from either jumps; a flick becomes a run of small steps instead, which is
   * the same gesture arriving smoothly. His: "по скролу робити зум".
   */
  scrollOrZoomTheRollByWheel(event: WheelEvent): void {
    if (this.host.drawnScene === null) {
      return;
    }
    // Held down, the wheel zooms: the convention every drawing program and the
    // browser's own page zoom use, and the one a trackpad pinch already
    // arrives as. His: "горизонтальний та вертикальний скроли зробити
    // звичайними скролами, а ctrl+скрол зробити zoom in/zoom out".
    if (event.ctrlKey || event.metaKey) {
      // Taken from the browser, which would zoom the whole page with it.
      event.preventDefault();
      this.zoomAlongTheRunByWheel(event.deltaY, event.clientX);
      return;
    }
    // And with Alt held it makes the rows taller or shorter: the height a
    // pinch changes on a screen, which a desk has no pinch for. Taken from
    // the browser too, which may otherwise go back a page on it.
    if (event.altKey) {
      event.preventDefault();
      this.zoomTheRowsByWheel(theWheelsTurn(event), event.clientY);
      return;
    }
    // Otherwise it scrolls, as it would have scrolled the page: both ways from
    // a trackpad, which keeps its own momentum, and along the run with shift
    // held where a mouse wheel only turns one way.
    //
    // And the browser is left the wheel, having nothing to do with it: nothing
    // around the drawing scrolls, and the page will not take a swipe for
    // "back". Taken from it, the first message of a gesture made the browser
    // wait on the page for every message after it, each then handled on its
    // own and drawn a frame later than the frame it arrived for. Measured on
    // his trackpad, a message waited a frame and more before it was drawn, on
    // either axis. His: "реагує canvas на скрол повільно". Left alone, the rest
    // of the gesture comes with the frame it is drawn in.
    this.stopTheFling();
    const unit =
      event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? this.host.rollScroller.viewWidePx : 1;
    const sideways = event.shiftKey && event.deltaX === 0;
    if (
      this.host.rollScroller.by(
        (sideways ? event.deltaY : event.deltaX) * unit,
        (sideways ? 0 : event.deltaY) * unit,
      )
    ) {
      this.host.askWhereTheViewIs();
    }
  }

  /** Zooms along the run by a wheel, holding the music under `clientX` where it is. */
  private zoomAlongTheRunByWheel(deltaPx: number, clientX: number): void {
    const was = Number(this.host.el.rollZoom.value);
    const now = zoomAfterWheel(was, deltaPx, LEAST_ZOOM, MOST_ZOOM);
    if (now !== was) {
      this.host.el.rollZoom.value = String(now);
      this.holdTheZoomAround(clientX, was, now);
    }
  }

  /**
   * Makes the rows taller or shorter by a wheel.
   *
   * From the row as drawn, as a pinch starts from it: the stylesheet never
   * lets the rows fall short of the room they have, and scaled from a smaller
   * row asked for, a turn up would move nothing until it had made up the
   * difference.
   */
  private zoomTheRowsByWheel(deltaPx: number, clientY: number | null): void {
    const was = Math.round(this.host.theRowAsDrawn());
    const now = zoomAfterWheel(was, deltaPx, LEAST_ROW, MOST_ROW);
    if (now !== was) {
      const held = this.theRowsHeldAt(clientY);
      this.host.rollRowPx = now;
      this.host.applyTheZoom();
      this.holdTheRows(held);
    }
  }

  /**
   * The pitch under a place down the view, as the rows are about to grow or
   * shrink: under `clientY`, or under the middle of the view where nothing on
   * the drawing was pointed at.
   *
   * Read before anything is written, as `holdTheZoomAround` reads its widths.
   */
  private theRowsHeldAt(clientY: number | null): RowsHeld {
    const heights = this.host.theRunsHeights();
    const top = clientY === null ? null : this.host.rollCanvases?.grid.getBoundingClientRect().top;
    return {
      ...heights,
      atPx: top === null || top === undefined || clientY === null ? heights.viewTallPx / 2 : clientY - top,
    };
  }

  /**
   * Scrolls the view down or up so the pitch that was under the place held is
   * under it again, now that the rows are a new height.
   *
   * Without it the top of the view stayed where it was in pixels, so a taller
   * row pushed what was in the middle down the view and out of it.
   */
  private holdTheRows(held: RowsHeld): void {
    const to = scrollAfterZoom(held.scrolledDownPx, held.atPx, held.wholeTallPx, this.host.rollScroller.wholeTallPx);
    if (this.host.rollScroller.to(this.host.rollScroller.x, to)) {
      this.host.askWhereTheViewIs();
    }
  }

  /**
   * A wheel over one of the maps: zooms along the axis that map is of.
   *
   * Along the run around the middle of the view, since the pointer is on the
   * map and not over any moment of the drawing. A plain wheel is left to the
   * browser, as over the drawing - nothing around the maps scrolls - and one
   * with Ctrl held is taken, being how a trackpad pinch arrives and what the
   * browser would zoom the whole page by.
   */
  zoomByAWheelOverAMap(event: WheelEvent, axis: 'along' | 'down'): void {
    if (this.host.drawnScene === null) {
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
    }
    if (axis === 'down') {
      this.zoomTheRowsByWheel(theWheelsTurn(event), null);
      return;
    }
    const grid = this.host.rollCanvases?.grid.getBoundingClientRect();
    this.zoomAlongTheRunByWheel(
      theWheelsTurn(event),
      grid === undefined ? 0 : grid.left + grid.width / 2,
    );
  }

  /** Moves the drawing with a finger, where one is moving it. */
  private panTheRoll(event: PointerEvent): void {
    const pan = this.rollPan;
    if (pan?.pointerId !== event.pointerId || this.rollFingers.size !== 1) {
      return;
    }
    const acrossPx = event.clientX - pan.clientX;
    const downPx = event.clientY - pan.clientY;
    // A finger is never quite still: until it has gone somewhere it is a tap,
    // and a tap puts the head down.
    if (!pan.moved && Math.hypot(acrossPx, downPx) < TAP_SLOP_PX) {
      return;
    }
    pan.moved = true;
    this.host.panned = true;
    pan.trail.push({ atMs: event.timeStamp, x: event.clientX, y: event.clientY });
    if (pan.trail.length > 32) {
      pan.trail.splice(0, pan.trail.length - 32);
    }
    if (this.host.rollScroller.to(pan.fromX - acrossPx, pan.fromY - downPx)) {
      this.host.askWhereTheViewIs();
    }
  }

  /** A finger lets go: thrown, the drawing goes on and slows; put down, it stays. */
  private letThePanGo(event: PointerEvent, thrown: boolean): void {
    const pan = this.rollPan;
    this.rollPan = null;
    // A mouse lets go where it is, as a desktop editor's drawing stops under
    // it; a finger's throw is what keeps a drawing going.
    if (pan === null || !pan.moved || !thrown || event.pointerType === 'mouse') {
      return;
    }
    const speed = speedOf(pan.trail, event.timeStamp);
    this.host.rollScroller.fling(-speed.x, -speed.y);
    this.carryTheFling();
  }

  /** Carries a fling on, a frame at a time, until it has slowed to nothing. */
  private carryTheFling(): void {
    const view = this.host.doc.defaultView;
    if (view === null || typeof view.requestAnimationFrame !== 'function') {
      return;
    }
    if (this.flingFrame !== null) {
      view.cancelAnimationFrame(this.flingFrame);
    }
    let last: number | null = null;
    const frame = (now: number): void => {
      // The first frame has no frame before it; call it one frame's worth.
      const moved = this.host.rollScroller.step(last === null ? 16 : now - last);
      last = now;
      if (moved) {
        this.host.showTheView();
      }
      this.flingFrame = this.host.rollScroller.flinging ? view.requestAnimationFrame(frame) : null;
    };
    this.flingFrame = this.host.rollScroller.flinging ? view.requestAnimationFrame(frame) : null;
  }

  stopTheFling(): void {
    this.host.rollScroller.stop();
    const view = this.host.doc.defaultView;
    if (this.flingFrame !== null && view !== null) {
      view.cancelAnimationFrame(this.flingFrame);
    }
    this.flingFrame = null;
  }

  /**
   * Applies a zoom and scrolls so the music under a point stays under it.
   *
   * The widths are the drawing's, so the column of key names is taken off both
   * - it does not stretch with the music and would drag the anchor sideways by
   * its own width every time.
   */
  private holdTheZoomAround(clientX: number, was: number, now: number): void {
    // Everything read before anything is written. The width that follows from
    // the new zoom is arithmetic, so nothing has to be asked twice.
    const widths = this.host.theRunsWidths();
    const at = clientX - (this.host.rollCanvases?.grid.getBoundingClientRect().left ?? clientX + 1);

    this.host.applyTheZoom();

    const widened = (widths.wholeWidePx * now) / was;
    const to =
      widths.wholeWidePx > 0 && at >= 0
        ? scrollAfterZoom(widths.scrolledToPx, at, widths.wholeWidePx, widened)
        : widths.scrolledToPx;
    this.host.rollScroller.to(to, this.host.rollScroller.y);
    this.host.showTheWindow(theWindowOnTheRun(this.host.rollScroller.x, widths.viewWidePx, widened));
  }

  /**
   * The gap between two fingers, or `null` unless there are exactly two.
   *
   * Exactly two: a third finger on the drawing is not a wider pinch, it is a
   * hand resting, and taking a gap from whichever two arrived first would zoom
   * on a gesture nobody made.
   */
  private theFingerSpan(): FingerSpan | null {
    if (this.rollFingers.size !== 2) {
      return null;
    }
    const [first, second] = [...this.rollFingers.values()];
    if (first === undefined || second === undefined) {
      return null;
    }
    return {
      acrossPx: Math.abs(first.x - second.x),
      downPx: Math.abs(first.y - second.y),
    };
  }

  /** Remembers where a pinch started from, or forgets there is one. */
  private beginAPinch(): void {
    const span = this.theFingerSpan();
    this.pinchedFrom =
      span === null
        ? null
        : { ...span, zoom: Number(this.host.el.rollZoom.value), row: this.host.theRowAsDrawn() };
  }

  /**
   * Zooms the drawing by how much wider the fingers have got.
   *
   * The slider is moved with it rather than left behind: it is the same
   * question, and two controls disagreeing about the answer is the fault this
   * interface keeps removing. His: "zoom слайдер маленький, та не дуже зручно
   * їм користуватись".
   *
   * And down the page as well, which has no slider: "зробити vertical pinch щоб
   * все зробити менше по висоті". A run of a wide part is sixty rows of pitch,
   * and at thirteen pixels each that is most of a tall screen before a note is
   * drawn.
   */
  private pinchTheRoll(): void {
    const from = this.pinchedFrom;
    const now = this.theFingerSpan();
    if (from === null || now === null) {
      return;
    }
    this.pinched = true;
    const asked = pinchedTo(from, now);
    const was = Number(this.host.el.rollZoom.value);
    const middle = this.theMiddleOfTheFingers();
    const held = asked.row === this.host.rollRowPx ? null : this.theRowsHeldAt(middle.y);
    this.host.el.rollZoom.value = String(asked.zoom);
    this.host.rollRowPx = asked.row;
    // Held around the point between the fingers, for the same reason the wheel
    // is held around the pointer: a pinch aimed at a bar means that bar, and
    // one aimed at a pitch that pitch.
    if (asked.zoom !== was) {
      this.holdTheZoomAround(middle.x, was, asked.zoom);
    } else {
      this.host.applyTheZoom();
    }
    if (held !== null) {
      this.holdTheRows(held);
    }
  }

  /** Where the point between two fingers is on the screen. */
  private theMiddleOfTheFingers(): { readonly x: number; readonly y: number } {
    const [first, second] = [...this.rollFingers.values()];
    return {
      x: ((first?.x ?? 0) + (second?.x ?? first?.x ?? 0)) / 2,
      y: ((first?.y ?? 0) + (second?.y ?? first?.y ?? 0)) / 2,
    };
  }
}

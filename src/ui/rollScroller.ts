/**
 * How fast a fling slows, as the share of its speed kept each millisecond.
 *
 * The rate iOS itself slows a scroll view by, so a run flung on the iPad
 * glides as far as a page flung beside it would.
 */
export const KEPT_EACH_MS = 0.998;
/** How slowly a fling may move and still be moving, in pixels a millisecond. */
const STOPS_BELOW = 0.02;
/** And how fast it may start, however hard the finger was thrown. */
const FASTEST = 8;
/** How far back a finger's movement is read for its speed as it lets go, in milliseconds. */
const SPEED_OVER_MS = 100;
/** A finger held still this long before it lets go has not flung anything. */
const HELD_STILL_MS = 50;

/** A size, in pixels. */
export interface Extent {
  readonly widePx: number;
  readonly tallPx: number;
}

/** Where a finger was, and when. */
export interface FingerAt {
  readonly atMs: number;
  readonly x: number;
  readonly y: number;
}

/**
 * How fast a finger was moving as it let go, in pixels a millisecond.
 *
 * Over its last tenth of a second, because a speed from its last two
 * positions is whatever the last few milliseconds happened to be, and nought
 * where it stood still before letting go - it was put down, not thrown.
 */
export function speedOf(trail: readonly FingerAt[], letGoAtMs: number): { x: number; y: number } {
  const last = trail.at(-1);
  if (last === undefined || letGoAtMs - last.atMs > HELD_STILL_MS) {
    return { x: 0, y: 0 };
  }
  const recent = trail.filter((point) => last.atMs - point.atMs <= SPEED_OVER_MS);
  const first = recent[0];
  if (first === undefined || last.atMs - first.atMs <= 0) {
    return { x: 0, y: 0 };
  }
  const over = last.atMs - first.atMs;
  return { x: (last.x - first.x) / over, y: (last.y - first.y) / over };
}

/**
 * Where the MIDI viewer is scrolled to, kept here rather than by the page.
 *
 * The page scrolls on its own, a frame ahead of anything painted to follow
 * it: painted to follow, the notes went behind the head in jerks, and painted
 * in tiles the page scrolled, they appeared as the scroll reached them. His,
 * of Signal: "в Signal великий canvas скролиться дуже швидко... а в нас коли я
 * скролю - я вже бачу як це все перемальовується". Signal keeps the place
 * itself and paints everything from it at once, and so does this: a wheel, a
 * trackpad and a finger move the place, and the drawing, the head and the
 * keys are all put where it says in the same frame.
 *
 * A finger let go moving keeps going and slows, as a scroll view's does.
 */
export class RollScroller {
  private atX = 0;
  private atY = 0;
  private view: Extent = { widePx: 0, tallPx: 0 };
  private whole: Extent = { widePx: 0, tallPx: 0 };
  private speedX = 0;
  private speedY = 0;

  /** How far along the drawing the view stands, in pixels. */
  get x(): number {
    return this.atX;
  }

  /** How far down it. */
  get y(): number {
    return this.atY;
  }

  get viewWidePx(): number {
    return this.view.widePx;
  }

  get viewTallPx(): number {
    return this.view.tallPx;
  }

  get wholeWidePx(): number {
    return this.whole.widePx;
  }

  get wholeTallPx(): number {
    return this.whole.tallPx;
  }

  /** Whether a fling is still going. */
  get flinging(): boolean {
    return this.speedX !== 0 || this.speedY !== 0;
  }

  /**
   * Says how big the view and the drawing are, and keeps the place inside the
   * drawing. Whether the place moved.
   */
  size(view: Extent, whole: Extent): boolean {
    this.view = view;
    this.whole = whole;
    return this.place(this.atX, this.atY);
  }

  /** Puts the view at a place, stopping any fling. Whether it moved. */
  to(x: number, y: number): boolean {
    this.stop();
    return this.place(x, y);
  }

  /** Moves the view by so much, stopping any fling. Whether it moved. */
  by(dx: number, dy: number): boolean {
    return this.to(this.atX + dx, this.atY + dy);
  }

  /** Lets the view go on at a speed, in pixels a millisecond, slowing as it goes. */
  fling(speedX: number, speedY: number): void {
    const held = (speed: number): number => {
      const kept = Math.max(-FASTEST, Math.min(FASTEST, speed));
      return Math.abs(kept) < STOPS_BELOW ? 0 : kept;
    };
    this.speedX = held(speedX);
    this.speedY = held(speedY);
  }

  /**
   * Carries a fling on by so many milliseconds. Whether the view moved.
   *
   * Worked out whole rather than a step at a time, so how far it goes does not
   * depend on how often the frames come: a speed slowing by a constant share
   * each millisecond covers its speed times the time it takes to fall away.
   */
  step(elapsedMs: number): boolean {
    if (!this.flinging || elapsedMs <= 0) {
      return false;
    }
    const kept = KEPT_EACH_MS ** elapsedMs;
    const reach = (1 - kept) / -Math.log(KEPT_EACH_MS);
    const wasX = this.atX;
    const wasY = this.atY;
    const moved = this.place(this.atX + this.speedX * reach, this.atY + this.speedY * reach);
    // Against an edge, that way is done.
    const stillX = this.atX === wasX + this.speedX * reach;
    const stillY = this.atY === wasY + this.speedY * reach;
    this.speedX = stillX && Math.abs(this.speedX * kept) >= STOPS_BELOW ? this.speedX * kept : 0;
    this.speedY = stillY && Math.abs(this.speedY * kept) >= STOPS_BELOW ? this.speedY * kept : 0;
    return moved;
  }

  stop(): void {
    this.speedX = 0;
    this.speedY = 0;
  }

  private place(x: number, y: number): boolean {
    // A place that is not a number is no place, and would stay one: every
    // place worked out from it after would be no number either.
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }
    const mostX = Math.max(0, this.whole.widePx - this.view.widePx);
    const mostY = Math.max(0, this.whole.tallPx - this.view.tallPx);
    const toX = Math.min(mostX, Math.max(0, x));
    const toY = Math.min(mostY, Math.max(0, y));
    const moved = toX !== this.atX || toY !== this.atY;
    this.atX = toX;
    this.atY = toY;
    return moved;
  }
}

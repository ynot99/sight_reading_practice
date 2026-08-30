/**
 * Where the two markers that hold a passage belong, and which bar a drag
 * has landed on.
 *
 * All arithmetic, no DOM: what the engraver drew comes in as numbers and what
 * to draw goes out as numbers, so every rule here is testable without a
 * browser. The reading of the engraving and the drawing of the shapes are the
 * renderer's, and are the only parts a test cannot see.
 */

/** Where the engraver put one bar, in the drawing's own pixels. */
export interface DrawnMeasure {
  readonly measureIndex: number;
  readonly left: number;
  readonly right: number;
  /**
   * Top of the highest staff and bottom of the lowest, in the system this
   * bar is on.
   *
   * A page holds several systems one under another, so a bar has no
   * page-wide vertical position: bar nine may be four hundred pixels below
   * bar one. A marker is therefore as tall as the system it stands in.
   */
  readonly top: number;
  readonly bottom: number;
}

/** One of the two markers, drawn as a bar with a grip at each end. */
export interface BracketShape {
  readonly edge: PassageEdge;
  /** Centre of the marker, which is the bar line it stands on. */
  readonly x: number;
  readonly top: number;
  readonly bottom: number;
}

export type PassageEdge = 'start' | 'end';

/** How far outside a marker a touch still counts as landing on it. */
export const GRIP_RADIUS_PX = 22;

/**
 * The markers for a passage running from one bar to another.
 *
 * The start stands on the bar line *before* its bar and the end on the bar
 * line *after* its bar, because a passage of one bar has to be visible as a
 * bar with something on either side of it rather than as two markers on top
 * of each other.
 *
 * `null` when the engraving has nothing in it, which is what an empty score
 * and a score not yet drawn both look like from here.
 */
export function bracketShapes(
  measures: readonly DrawnMeasure[],
  fromIndex: number,
  toIndex: number,
): readonly BracketShape[] {
  if (measures.length === 0 || toIndex < fromIndex) {
    return [];
  }
  // Clamped to what is drawn, because a drag that reaches past the edge is
  // asking for bars the engraving does not contain: the marker stays at the
  // edge it has run out of while the passage behind it goes on widening,
  // which is the only honest thing a page can show there. Markers that
  // vanished instead would leave the reader dragging nothing.
  const first = atOrEdge(measures, fromIndex);
  const last = atOrEdge(measures, toIndex);
  if (first === undefined || last === undefined) {
    return [];
  }
  return [
    { edge: 'start', x: first.left, top: first.top, bottom: first.bottom },
    { edge: 'end', x: last.right, top: last.top, bottom: last.bottom },
  ];
}

/** The bar with that index, or the nearest end of the engraving. */
function atOrEdge(measures: readonly DrawnMeasure[], index: number): DrawnMeasure | undefined {
  const exact = measures.find((measure) => measure.measureIndex === index);
  if (exact !== undefined) {
    return exact;
  }
  const first = measures[0];
  const last = measures[measures.length - 1];
  return first !== undefined && index < first.measureIndex ? first : last;
}

/**
 * The bar a dragged marker has been let go over.
 *
 * Vertical first, then horizontal: a page is read in systems, and a finger
 * an inch to the right of the last bar of line two means the end of line
 * two, not somewhere on line three. Judged by which system the touch is
 * nearest to rather than which one contains it, so a drag that strays into
 * the gap between two lines still lands somewhere.
 *
 * Which *edge* is being dragged decides where a bar's own boundary is: the
 * start marker snaps to the bar line a bar begins at and the end marker to
 * the one it finishes at, so both read as "this bar is in the passage".
 */
export function measureUnderPointer(
  measures: readonly DrawnMeasure[],
  point: { readonly x: number; readonly y: number },
  edge: PassageEdge,
): number | null {
  if (measures.length === 0) {
    return null;
  }
  const onSystem = nearestSystem(measures, point.y);
  let best: DrawnMeasure | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const measure of onSystem) {
    const boundary = edge === 'start' ? measure.left : measure.right;
    const distance = Math.abs(point.x - boundary);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = measure;
    }
  }
  return best?.measureIndex ?? null;
}

/**
 * The bar a drag has landed on, which may be outside the engraving.
 *
 * The score on screen *is* the passage - a passage is cut out and engraved on
 * its own, so bars before and after it are not drawn at all. That makes
 * narrowing obvious and widening impossible, and a marker that can only ever
 * be pulled inwards is half a control.
 *
 * So a drag past the front of the first bar, or past the back of the last,
 * keeps counting: one bar for every bar's width it overshoots by. The index
 * it returns then falls outside the drawn range - negative at the front, past
 * the end at the back - which is the honest way to say "this many bars before
 * what you can see". Whoever asked knows what the whole piece is and clamps
 * it there; nothing here can, because the engraving does not contain it.
 */
export function measureForDrag(
  measures: readonly DrawnMeasure[],
  point: { readonly x: number; readonly y: number },
  edge: PassageEdge,
): number | null {
  const landed = measureUnderPointer(measures, point, edge);
  if (landed === null || measures.length === 0) {
    return null;
  }
  const width = averageWidth(measures);
  const onSystem = nearestSystem(measures, point.y);
  const first = measures[0];
  const last = measures[measures.length - 1];

  if (edge === 'start' && first !== undefined && onSystem.includes(first) && point.x < first.left) {
    return first.measureIndex - Math.ceil((first.left - point.x) / width);
  }
  if (edge === 'end' && last !== undefined && onSystem.includes(last) && point.x > last.right) {
    return last.measureIndex + Math.ceil((point.x - last.right) / width);
  }
  return landed;
}

/** How wide a bar is here, for measuring an overshoot in bars. */
function averageWidth(measures: readonly DrawnMeasure[]): number {
  const total = measures.reduce((sum, measure) => sum + (measure.right - measure.left), 0);
  return Math.max(1, total / measures.length);
}

/** Every bar on the system whose middle is nearest the given height. */
function nearestSystem(measures: readonly DrawnMeasure[], y: number): readonly DrawnMeasure[] {
  let bestTop = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const measure of measures) {
    const distance = distanceTo(measure, y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestTop = measure.top;
    }
  }
  return measures.filter((measure) => measure.top === bestTop);
}

/** Nothing at all inside the system, and the gap to it outside. */
function distanceTo(measure: DrawnMeasure, y: number): number {
  if (y < measure.top) {
    return measure.top - y;
  }
  if (y > measure.bottom) {
    return y - measure.bottom;
  }
  return 0;
}

/**
 * The marker a touch has taken hold of, or `null` for a touch on the music.
 *
 * Generous, and deliberately: a marker is a line a few pixels wide and a
 * fingertip is a centimetre. Within the grip either side counts, and the
 * nearer marker wins where both would.
 */
export function gripAt(
  brackets: readonly BracketShape[],
  point: { readonly x: number; readonly y: number },
): PassageEdge | null {
  let best: PassageEdge | null = null;
  let bestDistance = GRIP_RADIUS_PX;
  for (const bracket of brackets) {
    if (point.y < bracket.top - GRIP_RADIUS_PX || point.y > bracket.bottom + GRIP_RADIUS_PX) {
      continue;
    }
    const distance = Math.abs(point.x - bracket.x);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = bracket.edge;
    }
  }
  return best;
}

/**
 * The passage a drag leaves behind, in bar indices.
 *
 * A marker cannot pass the other one: dragging the start past the end reads
 * as "just this bar", which is what the reader was plainly heading for, and
 * is a great deal better than a passage that runs backwards or a drag that
 * silently does nothing.
 */
export function passageAfterDrag(
  current: { readonly fromIndex: number; readonly toIndex: number },
  edge: PassageEdge,
  landedOn: number,
): { readonly fromIndex: number; readonly toIndex: number } {
  if (edge === 'start') {
    return { fromIndex: Math.min(landedOn, current.toIndex), toIndex: current.toIndex };
  }
  return { fromIndex: current.fromIndex, toIndex: Math.max(landedOn, current.fromIndex) };
}

/**
 * A point on the screen, in the drawing's own pixels.
 *
 * The engraving is drawn at one size and shown at another - the reader zooms,
 * and a tablet held sideways scales it again - so a touch has to be put back
 * into the coordinates the bars were measured in before anything can be said
 * about which bar it is over.
 */
export function toDrawingPoint(
  box: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  drawing: { readonly width: number; readonly height: number },
  client: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } | null {
  if (box.width <= 0 || box.height <= 0 || drawing.width <= 0 || drawing.height <= 0) {
    return null;
  }
  return {
    x: ((client.x - box.left) * drawing.width) / box.width,
    y: ((client.y - box.top) * drawing.height) / box.height,
  };
}

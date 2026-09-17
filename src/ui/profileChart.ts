import type { ProfileAxis } from '../domain/scoring/theProfile.js';

const SVG = 'http://www.w3.org/2000/svg';

/** The drawing's own coordinates; the page decides how big it ends up. */
const SIDE = 100;
const MIDDLE = SIDE / 2;
/** Room left round the shape for the names, which stand outside the rings. */
const REACH = 32;
/** The rings behind it, as shares of the reach. */
const RINGS = [0.25, 0.5, 0.75, 1];

/**
 * Where an axis sits on the circle.
 *
 * From the top and clockwise, which is how a face is read. Any number of axes:
 * the angle is the only thing the count decides, and it decides it for three as
 * readily as for eight - there is no version of this that is written for four.
 */
function pointOf(at: number, of: number, reach: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (at / of) * Math.PI * 2;
  return { x: MIDDLE + Math.cos(angle) * reach, y: MIDDLE + Math.sin(angle) * reach };
}

function element(tag: string, className?: string): SVGElement {
  const made = document.createElementNS(SVG, tag);
  if (className !== undefined) {
    made.setAttribute('class', className);
  }
  return made;
}

function corners(axes: readonly ProfileAxis[], reach: number, scaled: boolean): string {
  return axes
    .map((axis, at) => {
      const point = pointOf(at, axes.length, reach * (scaled ? axis.of : 1));
      return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    })
    .join(' ');
}

/**
 * How a name is laid against its spoke.
 *
 * By quadrant, which is the whole of what stops the names colliding as the axes
 * multiply: one at the top wants to be centred, one on the right wants its left
 * edge against the spoke, and one on the left the other way about. Left to a
 * single anchor they pile up either side of the vertical the moment there are
 * more than four of them.
 */
function anchorFor(x: number): string {
  if (Math.abs(x - MIDDLE) < 1) {
    return 'middle';
  }
  return x > MIDDLE ? 'start' : 'end';
}

/**
 * A reading's shape, drawn.
 *
 * Inline SVG and no library: the geometry is a loop over the axes, the colours
 * are the page's own custom properties - so it follows the reader's theme
 * without being told - and nothing here needs a canvas, which would cost the
 * theme, the tests and two hundred kilobytes for one polygon.
 *
 * A shape says which way a reading leans and never what it was, so whoever
 * draws this puts the numbers beside it.
 */
export function drawTheProfile(axes: readonly ProfileAxis[]): SVGElement {
  const chart = element('svg', 'profile');
  chart.setAttribute('viewBox', `0 0 ${SIDE} ${SIDE}`);
  chart.setAttribute('role', 'img');
  chart.setAttribute(
    'aria-label',
    `How the reading went: ${axes.map((axis) => `${axis.name}, ${axis.said}`).join('; ')}`,
  );
  if (axes.length < 3) {
    // Two axes are a line and one is a dot; neither is a shape to read. Said by
    // drawing nothing rather than by drawing something misleading.
    return chart;
  }

  for (const ring of RINGS) {
    const drawn = element('polygon', 'profile__ring');
    drawn.setAttribute('points', corners(axes, REACH * ring, false));
    chart.append(drawn);
  }

  for (let at = 0; at < axes.length; at += 1) {
    const point = pointOf(at, axes.length, REACH);
    const spoke = element('line', 'profile__spoke');
    spoke.setAttribute('x1', String(MIDDLE));
    spoke.setAttribute('y1', String(MIDDLE));
    spoke.setAttribute('x2', point.x.toFixed(2));
    spoke.setAttribute('y2', point.y.toFixed(2));
    chart.append(spoke);
  }

  const shape = element('polygon', 'profile__shape');
  shape.setAttribute('points', corners(axes, REACH, true));
  chart.append(shape);

  for (let at = 0; at < axes.length; at += 1) {
    const axis = axes[at];
    if (axis === undefined) {
      continue;
    }
    const point = pointOf(at, axes.length, REACH + 7);
    const name = element('text', 'profile__name');
    name.setAttribute('x', point.x.toFixed(2));
    name.setAttribute('y', point.y.toFixed(2));
    name.setAttribute('text-anchor', anchorFor(point.x));
    // Hung below the point on the way down and above it on the way up, so a
    // name never sits on the ring it belongs to.
    name.setAttribute('dominant-baseline', point.y > MIDDLE + 1 ? 'hanging' : 'auto');
    name.textContent = axis.name;
    chart.append(name);
  }
  return chart;
}

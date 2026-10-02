import type { DrawnPassage } from '../../application/ports/IScoreRenderer.js';
import { GRIP_RADIUS_PX, gripsOf, type BracketShape } from './passageBrackets.js';

/**
 * What is drawn over the music to be read or taken hold of: the passage
 * markers, the start of the run, the hand switches and the mark on a bar read
 * a second time.
 *
 * Shapes only, in the pixels of the page they are drawn on. Where they go is
 * the engraver's reading of its own page and each renderer's business; how
 * they look is one answer, here, whichever engraver drew the music under them.
 */

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** How wide a passage marker is drawn, in the same pixels. */
const MARKER_WIDTH = 5;
/** The circle at each end of a marker, which is what a thumb aims at. */
const MARKER_GRIP_RADIUS = 9;
/** How far a repeat dot sits from the marker, and from the line between. */
const REPEAT_DOT_GAP = 9;
/** Half the width of the arrow drawn inside a handle. */
const ARROW_REACH = 3.5;
/** How wide the "start here" line is drawn, and its little flag. */
const START_WIDTH = 3;
const START_FLAG = 9;

/**
 * How big the mark on a re-read bar is drawn.
 *
 * A rehearsal mark's worth: big enough to be seen at the stand without
 * being read as something the writer put there.
 */
export const REPEAT_MARK_RADIUS = 4;
/** Air between the number and the arrow standing after it. */
export const REPEAT_MARK_GAP = 3;
/**
 * How big the writer's own number is drawn against the place in the playing.
 *
 * Smaller, and on the line above. It is the second answer to "which bar is
 * this": the reader works in places - it is what the markers stand on and
 * what the boxes take - and wants the printed number when they go looking
 * for the same bar in the file it came from.
 */
export const BAR_PRINTED_SCALE = 0.75;
/** How far above the number's own line the writer's number sits. */
export const BAR_PRINTED_RISE = 1.05;

/**
 * How wide a hand switch is, and how far it stands off its staff.
 *
 * Wide enough for a fingertip, which is the whole reason it is out here
 * rather than a smaller thing drawn more precisely. The gap keeps it clear of
 * the brace and of the clef.
 */
export const HAND_SWITCH_WIDTH = 26;
export const HAND_SWITCH_GAP = 6;
/**
 * How tall the drawn part of a hand switch is.
 *
 * Fixed, and centred on its staff. Measured as a share of the staff's own box
 * they came out different heights from each other: the engraver's box for a
 * staff is drawn round what is on it, so the hand with the ledger lines got a
 * taller switch than the hand without. Two switches that do the same thing
 * have to look the same, whatever the music above them happens to be.
 */
const HAND_SWITCH_HEIGHT = 30;

/** How far a finger may wander and still have meant a tap, in screen pixels. */
export const TAP_SLACK_PX = 8;
/**
 * How long a finger stays put before it is pointing rather than touching.
 *
 * Long enough not to fire under a reader who is turning a page or reaching
 * for a marker, short enough that holding still feels like an instruction
 * rather than a wait.
 */
export const HOLD_MS = 450;

/**
 * One of the two passage markers, with its grips.
 *
 * Which control this is is written on the control: the browser has already
 * worked out what the finger landed on, to a better standard than any
 * arithmetic, and asking it is both simpler and right.
 */
export function drawPassageMarker(
  doc: Document,
  bracket: BracketShape,
  showing: DrawnPassage,
): SVGGElement {
  const shape = doc.createElementNS(SVG_NAMESPACE, 'g');
  shape.setAttribute('class', `passage-marker passage-marker--${bracket.edge}`);
  shape.setAttribute('data-edge', bracket.edge);
  // Nothing to take hold of while it is being played. Said on the marker
  // rather than checked when a drag begins, because the browser decides
  // whether a touch will scroll the page from what is under it at the
  // moment it starts - and a marker that swallows the touch and then does
  // nothing is worse than one that never took it.
  if (showing.movable === false) {
    shape.setAttribute('data-locked', 'true');
  }
  // The part the finger is allowed to land on, and the reason it is a
  // shape of its own: a browser decides whether a touch is going to
  // scroll the page *as it begins*, from the `touch-action` of whatever
  // is under it. Setting that when the drag starts is too late by then -
  // which is exactly what happened, and why a marker could be nudged
  // sideways with great care and not moved down the page at all. So the
  // reachable area is drawn, invisibly, and it says so before anyone
  // touches it.
  const height = Math.max(0, bracket.bottom - bracket.top);
  const hit = doc.createElementNS(SVG_NAMESPACE, 'rect');
  hit.setAttribute('class', 'passage-marker__hit');
  hit.setAttribute('x', String(bracket.x - GRIP_RADIUS_PX));
  hit.setAttribute('y', String(bracket.top - GRIP_RADIUS_PX));
  hit.setAttribute('width', String(GRIP_RADIUS_PX * 2));
  hit.setAttribute('height', String(height + GRIP_RADIUS_PX * 2));
  shape.append(hit);

  const bar = doc.createElementNS(SVG_NAMESPACE, 'rect');
  bar.setAttribute('class', 'passage-marker__bar');
  bar.setAttribute('x', String(bracket.x - MARKER_WIDTH / 2));
  bar.setAttribute('y', String(bracket.top));
  bar.setAttribute('width', String(MARKER_WIDTH));
  bar.setAttribute('height', String(height));
  shape.append(bar);
  if (showing.repeating === true) {
    // The two dots of a repeat bar line, facing into the passage: a
    // musician reads this without being told what it is.
    const facing = bracket.edge === 'start' ? 1 : -1;
    const middle = (bracket.top + bracket.bottom) / 2;
    for (const offset of [-REPEAT_DOT_GAP, REPEAT_DOT_GAP]) {
      const dot = doc.createElementNS(SVG_NAMESPACE, 'circle');
      dot.setAttribute('class', 'passage-marker__dot');
      dot.setAttribute('cx', String(bracket.x + facing * REPEAT_DOT_GAP));
      dot.setAttribute('cy', String(middle + offset));
      dot.setAttribute('r', String(MARKER_WIDTH / 2));
      shape.append(dot);
    }
  }
  // A handle at each end, because the middle of the marker is over the
  // music and a finger there would be covering what it is choosing.
  //
  // They are buttons as well as handles: a tap moves the passage exactly
  // one bar, which is most of what is actually wanted - it was nearly
  // right and wants a bar more at the front. The arrow says which way,
  // so the rule behind it does not have to be remembered.
  for (const grip of showing.movable === false ? [] : gripsOf([bracket])) {
    const circle = doc.createElementNS(SVG_NAMESPACE, 'circle');
    circle.setAttribute('class', `passage-marker__grip passage-marker__grip--${grip.end}`);
    circle.setAttribute('data-end', grip.end);
    circle.setAttribute('cx', String(grip.x));
    circle.setAttribute('cy', String(grip.y));
    circle.setAttribute('r', String(MARKER_GRIP_RADIUS));
    shape.append(circle);

    const arrow = doc.createElementNS(SVG_NAMESPACE, 'path');
    arrow.setAttribute('class', 'passage-marker__arrow');
    const tip = grip.towards * ARROW_REACH;
    arrow.setAttribute(
      'd',
      `M ${grip.x - tip} ${grip.y - ARROW_REACH} L ${grip.x + tip} ${grip.y}` +
        ` L ${grip.x - tip} ${grip.y + ARROW_REACH}`,
    );
    shape.append(arrow);
  }
  return shape;
}

/**
 * The bar the music will start from.
 *
 * A quieter line than the passage markers and with nothing to take hold
 * of: it is a sign and not a control, moved by holding a finger on a bar
 * and cleared from the transport bar.
 */
export function drawStartMarker(
  doc: Document,
  measure: { readonly left: number; readonly top: number; readonly bottom: number },
): SVGGElement {
  const shape = doc.createElementNS(SVG_NAMESPACE, 'g');
  shape.setAttribute('class', 'start-marker');

  const bar = doc.createElementNS(SVG_NAMESPACE, 'rect');
  bar.setAttribute('class', 'start-marker__bar');
  bar.setAttribute('x', String(measure.left - START_WIDTH / 2));
  bar.setAttribute('y', String(measure.top));
  bar.setAttribute('width', String(START_WIDTH));
  bar.setAttribute('height', String(Math.max(0, measure.bottom - measure.top)));
  shape.append(bar);

  // A small flag at the top, pointing the way the music will go.
  const flag = doc.createElementNS(SVG_NAMESPACE, 'path');
  flag.setAttribute('class', 'start-marker__flag');
  const top = measure.top;
  flag.setAttribute(
    'd',
    `M ${measure.left} ${top} L ${measure.left + START_FLAG} ${top + START_FLAG / 2}` +
      ` L ${measure.left} ${top + START_FLAG} Z`,
  );
  shape.append(flag);
  return shape;
}

/**
 * The switch beside one staff, saying whether that hand is being read.
 *
 * Outside the staff rather than over it, a gap to the left of where its lines
 * begin, so nothing here can land on a note.
 */
export function drawHandSwitch(
  doc: Document,
  staff: { readonly staffNumber: number; readonly left: number; readonly top: number; readonly bottom: number },
  on: boolean,
): SVGGElement {
  const height = Math.max(0, staff.bottom - staff.top);
  const group = doc.createElementNS(SVG_NAMESPACE, 'g');
  group.setAttribute('class', 'hand-switch');
  group.dataset['staff'] = String(staff.staffNumber);
  group.dataset['on'] = String(on);

  const hit = doc.createElementNS(SVG_NAMESPACE, 'rect');
  hit.setAttribute('class', 'hand-switch__hit');
  hit.setAttribute('x', String(staff.left - HAND_SWITCH_GAP - HAND_SWITCH_WIDTH));
  hit.setAttribute('y', String(staff.top));
  hit.setAttribute('width', String(HAND_SWITCH_WIDTH));
  hit.setAttribute('height', String(height));
  group.append(hit);

  const tab = doc.createElementNS(SVG_NAMESPACE, 'rect');
  tab.setAttribute('class', 'hand-switch__tab');
  tab.setAttribute('x', String(staff.left - HAND_SWITCH_GAP - HAND_SWITCH_WIDTH / 2));
  // Centred on the staff rather than measured from it, so both switches
  // are the same switch however tall the engraver drew their staves.
  tab.setAttribute('y', String(staff.top + height / 2 - HAND_SWITCH_HEIGHT / 2));
  tab.setAttribute('width', String(HAND_SWITCH_WIDTH / 2));
  tab.setAttribute('height', String(HAND_SWITCH_HEIGHT));
  tab.setAttribute('rx', String(HAND_SWITCH_WIDTH / 6));
  group.append(tab);
  return group;
}

/**
 * The turning arrow on a bar read a second time, centred at a point.
 *
 * Most of a circle, open at the top right so the arrow has somewhere to come
 * from, and a head where it ends.
 */
export function drawRepeatMark(doc: Document, x: number, y: number, r = REPEAT_MARK_RADIUS): SVGGElement {
  const mark = doc.createElementNS(SVG_NAMESPACE, 'g');
  mark.setAttribute('class', 'repeat-mark');

  const ring = doc.createElementNS(SVG_NAMESPACE, 'path');
  ring.setAttribute('class', 'repeat-mark__ring');
  ring.setAttribute('d', `M ${x + r} ${y} A ${r} ${r} 0 1 1 ${x} ${y - r}`);
  mark.append(ring);

  const head = doc.createElementNS(SVG_NAMESPACE, 'path');
  head.setAttribute('class', 'repeat-mark__head');
  const tip = r * 0.55;
  head.setAttribute('d', `M ${x - tip} ${y - r} L ${x + tip} ${y - r} L ${x} ${y - r + tip} Z`);
  mark.append(head);
  return mark;
}

/**
 * The marker a touch landed on, from what the browser hit-tested.
 *
 * Nothing about coordinates: the drawn handle and the area that answers for
 * it are one shape, so the element under the finger *is* the answer. Only
 * where a drag has got to needs arithmetic, and that is asked separately.
 */
export function markerUnder(
  target: EventTarget | null,
  within: Element,
): { readonly edge: 'start' | 'end'; readonly end: 'top' | 'bottom' | null } | null {
  let node = target instanceof Element ? target : null;
  let end: 'top' | 'bottom' | null = null;
  while (node !== null && node !== within) {
    const grip = node.getAttribute('data-end');
    if (grip === 'top' || grip === 'bottom') {
      end = grip;
    }
    if (node.getAttribute('data-locked') === 'true') {
      return null;
    }
    const edge = node.getAttribute('data-edge');
    if (edge === 'start' || edge === 'end') {
      return { edge, end };
    }
    node = node.parentElement;
  }
  return null;
}

/** The staff whose switch a touch landed on, or `null` for anything else. */
export function handUnder(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) {
    return null;
  }
  const found = target.closest('g.hand-switch');
  const staff = Number.parseInt((found as SVGGElement | null)?.dataset['staff'] ?? '', 10);
  return Number.isFinite(staff) ? staff : null;
}

import {
  CIRCLE_RINGS,
  PLACES_ON_THE_CIRCLE,
  theNameAtThePlace,
  type CircleRing,
  type PlaceOnTheCircle,
} from '../domain/harmony/circleOfFifths.js';

/**
 * The circle of fifths as a drawing: a slice of a ring for each chord, its
 * name on it, drawn once; and what it shows - the key's own chords lit,
 * with their numerals, and the chord the music is on lit more - written
 * onto the slices as it changes. See `circleOfFifths.ts`.
 */

const SVG = 'http://www.w3.org/2000/svg';

/** How far from the middle each ring runs, in the drawing's own units: the majors outermost and widest, being read most. */
const RING_EDGES: Readonly<Record<CircleRing, readonly [number, number]>> = {
  major: [72, 100],
  minor: [47, 72],
  diminished: [27, 47],
};

/** How large a ring's names are written, in the same units, and its numerals under them. */
const NAME_SIZE: Readonly<Record<CircleRing, number>> = { major: 12, minor: 9, diminished: 7 };
const NUMERAL_SIZE: Readonly<Record<CircleRing, number>> = { major: 7, minor: 6, diminished: 5 };

/** The drawing reaches a little past the outer ring, so its edge is not cut. */
const REACH = 102;

/** A point at a distance from the middle, a turn round from the top, clockwise. */
function at(radius: number, turn: number): string {
  const angle = turn * 2 * Math.PI;
  return `${(radius * Math.sin(angle)).toFixed(2)} ${(-radius * Math.cos(angle)).toFixed(2)}`;
}

/** The slice of a ring a place is: its outer edge clockwise, its inner edge back. */
function theSlice(ring: CircleRing, place: number): string {
  const [inner, outer] = RING_EDGES[ring];
  const from = (place - 0.5) / PLACES_ON_THE_CIRCLE;
  const until = (place + 0.5) / PLACES_ON_THE_CIRCLE;
  return `M ${at(outer, from)} A ${String(outer)} ${String(outer)} 0 0 1 ${at(outer, until)} L ${at(inner, until)} A ${String(inner)} ${String(inner)} 0 0 0 ${at(inner, from)} Z`;
}

/** What a chord's slice says on it: a diminished one with the sign, there being no room for the word. */
function theNameOnTheSlice(name: string): string {
  return name.replace(/dim$/, '°');
}

/**
 * Draws the circle: each slice a button, carrying its ring and place for the
 * page to read back; named when it is shown (see `showOnTheCircle`).
 */
export function drawTheCircle(doc: Document): SVGSVGElement {
  const drawing = doc.createElementNS(SVG, 'svg');
  drawing.setAttribute('viewBox', `${String(-REACH)} ${String(-REACH)} ${String(2 * REACH)} ${String(2 * REACH)}`);
  drawing.setAttribute('class', 'roll-circle__drawing');
  drawing.setAttribute('role', 'group');
  drawing.setAttribute('aria-label', 'The circle of fifths');
  for (const ring of CIRCLE_RINGS) {
    const [inner, outer] = RING_EDGES[ring];
    for (let place = 0; place < PLACES_ON_THE_CIRCLE; place += 1) {
      const slice = doc.createElementNS(SVG, 'g');
      slice.setAttribute('class', 'roll-circle__chord');
      slice.setAttribute('data-ring', ring);
      slice.setAttribute('data-place', String(place));
      slice.setAttribute('role', 'button');
      slice.setAttribute('tabindex', '0');
      const title = doc.createElementNS(SVG, 'title');
      const shape = doc.createElementNS(SVG, 'path');
      shape.setAttribute('d', theSlice(ring, place));
      // The name over the middle of the slice and the numeral under it, as
      // the page reads them, whichever way round the circle the slice faces.
      const [x, y] = at((inner + outer) / 2, place / PLACES_ON_THE_CIRCLE).split(' ').map(Number);
      const written = doc.createElementNS(SVG, 'text');
      written.setAttribute('class', 'roll-circle__name');
      written.setAttribute('x', (x ?? 0).toFixed(2));
      written.setAttribute('y', ((y ?? 0) - NUMERAL_SIZE[ring] * 0.5).toFixed(2));
      written.setAttribute('font-size', String(NAME_SIZE[ring]));
      const numeral = doc.createElementNS(SVG, 'text');
      numeral.setAttribute('class', 'roll-circle__numeral');
      numeral.setAttribute('x', (x ?? 0).toFixed(2));
      numeral.setAttribute('y', ((y ?? 0) + NAME_SIZE[ring] * 0.5).toFixed(2));
      numeral.setAttribute('font-size', String(NUMERAL_SIZE[ring]));
      slice.append(title, shape, written, numeral);
      drawing.append(slice);
    }
  }
  return drawing;
}

/** The place of a slice of the circle a pointer or a key is on, read off it; none off the slices. */
export function thePlaceOnTheCircle(target: EventTarget | null): PlaceOnTheCircle | null {
  const slice = target instanceof Element ? target.closest('[data-ring]') : null;
  const ring = CIRCLE_RINGS.find((each) => each === slice?.getAttribute('data-ring'));
  // A slice of a ring always says its place.
  return ring === undefined ? null : { ring, place: Number(slice?.getAttribute('data-place')) };
}

/**
 * Writes onto the circle what it shows: every chord named as the key the
 * music is in spells it, and named with what pressing it does; the key's
 * own lit, each with its numeral, the others without; and the chord the
 * music is on, where it has a place, lit more.
 */
export function showOnTheCircle(
  drawing: SVGSVGElement,
  shown: {
    readonly fifths: number;
    readonly ofTheKey: readonly (PlaceOnTheCircle & { readonly numeral: string })[];
    readonly here: PlaceOnTheCircle | null;
  },
): void {
  for (const slice of drawing.querySelectorAll<SVGGElement>('[data-ring]')) {
    const ring = CIRCLE_RINGS.find((each) => each === slice.getAttribute('data-ring')) ?? 'major';
    const place = Number(slice.getAttribute('data-place'));
    const name = theNameAtThePlace({ ring, place }, shown.fifths);
    const says = `Write ${name} where the cursor is`;
    slice.setAttribute('aria-label', says);
    const title = slice.querySelector('title');
    if (title !== null) {
      title.textContent = says;
    }
    const written = slice.querySelector('.roll-circle__name');
    if (written !== null) {
      written.textContent = theNameOnTheSlice(name);
    }
    const own = shown.ofTheKey.find((each) => each.ring === ring && each.place === place);
    if (own === undefined) {
      slice.removeAttribute('data-in-the-key');
    } else {
      slice.setAttribute('data-in-the-key', 'true');
    }
    const numeral = slice.querySelector('.roll-circle__numeral');
    if (numeral !== null) {
      numeral.textContent = own?.numeral ?? '';
    }
    if (shown.here?.ring === ring && shown.here.place === place) {
      slice.setAttribute('data-here', 'true');
    } else {
      slice.removeAttribute('data-here');
    }
  }
}

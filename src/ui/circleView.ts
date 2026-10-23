import {
  CIRCLE_RINGS,
  PLACES_ON_THE_CIRCLE,
  theNameAtThePlace,
  type CircleRing,
  type PlaceOnTheCircle,
} from '../domain/harmony/circleOfFifths.js';
import { MIDDLE_C, drawTheKeys, lightTheKeysOf, type KeyLight } from './replayKeys.js';

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

/**
 * The chord sounding, written in the hole in the middle with its numeral
 * under it: each as large as these, and smaller where a long one would
 * reach the ring round it - a letter being about this much of its size
 * across. The name sits above the middle and the numeral below, by these.
 */
const SOUNDING_SIZE = 16;
const SOUNDING_NUMERAL_SIZE = 9;
const SOUNDING_ROOM = 44;
const A_LETTER_IS = 0.62;
const SOUNDING_NAME_AT = -5;
const SOUNDING_NUMERAL_AT = 11;

/** How strongly the newest step of the way round is drawn, and how much less each older one. */
const NEWEST_STEP = 0.9;
const EACH_STEP_OLDER = 0.25;

/** A point at a distance from the middle, a turn round from the top, clockwise. */
function at(radius: number, turn: number): string {
  const angle = turn * 2 * Math.PI;
  return `${(radius * Math.sin(angle)).toFixed(2)} ${(-radius * Math.cos(angle)).toFixed(2)}`;
}

/** The middle of the slice a place is, where the way round passes through it. */
function theMiddleOf(place: PlaceOnTheCircle): readonly [number, number] {
  const [inner, outer] = RING_EDGES[place.ring];
  const [x, y] = at((inner + outer) / 2, place.place / PLACES_ON_THE_CIRCLE).split(' ').map(Number);
  return [x ?? 0, y ?? 0];
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
 *
 * In three layers: the slices, the way round over them, and the names over
 * that, so a step of the way never hides a name it crosses. A name is the
 * slice's in all but where it is drawn, and lets a finger through to it.
 */
export function drawTheCircle(doc: Document): SVGSVGElement {
  const drawing = doc.createElementNS(SVG, 'svg');
  drawing.setAttribute('viewBox', `${String(-REACH)} ${String(-REACH)} ${String(2 * REACH)} ${String(2 * REACH)}`);
  drawing.setAttribute('class', 'roll-circle__drawing');
  drawing.setAttribute('role', 'group');
  drawing.setAttribute('aria-label', 'The circle of fifths');
  const names = doc.createElementNS(SVG, 'g');
  names.setAttribute('class', 'roll-circle__names');
  names.setAttribute('aria-hidden', 'true');
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
      slice.append(title, shape);
      drawing.append(slice);
      const label = doc.createElementNS(SVG, 'g');
      label.setAttribute('class', 'roll-circle__label');
      label.append(written, numeral);
      names.append(label);
    }
  }
  // The hole in the middle: the chord sounding, pressed as a slice is.
  const middle = doc.createElementNS(SVG, 'circle');
  middle.setAttribute('class', 'roll-circle__middle');
  middle.setAttribute('r', String(RING_EDGES.diminished[0]));
  middle.setAttribute('role', 'button');
  middle.setAttribute('tabindex', '0');
  middle.setAttribute('aria-label', 'Write the chord sounding where the cursor is');
  const middleTitle = doc.createElementNS(SVG, 'title');
  middleTitle.textContent = 'Write the chord sounding where the cursor is';
  middle.append(middleTitle);
  drawing.append(middle);
  // Over the slices, and nothing to press: a finger goes through it to the chord under it.
  const way = doc.createElementNS(SVG, 'g');
  way.setAttribute('class', 'roll-circle__way');
  way.setAttribute('aria-hidden', 'true');
  const sounding = doc.createElementNS(SVG, 'g');
  sounding.setAttribute('class', 'roll-circle__sounding');
  sounding.setAttribute('aria-live', 'polite');
  const soundingName = doc.createElementNS(SVG, 'text');
  soundingName.setAttribute('class', 'roll-circle__sounding-name');
  soundingName.setAttribute('y', String(SOUNDING_NAME_AT));
  const soundingNumeral = doc.createElementNS(SVG, 'text');
  soundingNumeral.setAttribute('class', 'roll-circle__sounding-numeral');
  soundingNumeral.setAttribute('y', String(SOUNDING_NUMERAL_AT));
  sounding.append(soundingName, soundingNumeral);
  drawing.append(way, names, sounding);
  return drawing;
}

/** Writes some words in the middle, at the size given or smaller, as the hole fits them. */
function writeInTheMiddle(written: Element | null, words: string, size: number): void {
  if (written === null) {
    return;
  }
  written.textContent = words;
  const letters = [...words].length;
  written.setAttribute('font-size', Math.min(size, SOUNDING_ROOM / (Math.max(letters, 1) * A_LETTER_IS)).toFixed(2));
}

/** Writes the chord sounding in the middle, its numeral under it, where the middle names it; nothing there for none. */
function nameTheChordSounding(
  drawing: SVGSVGElement,
  sounding: { readonly name: string; readonly numeral: string } | null,
  named: boolean,
): void {
  const shown = named ? sounding : null;
  writeInTheMiddle(drawing.querySelector('.roll-circle__sounding-name'), shown?.name ?? '', SOUNDING_SIZE);
  writeInTheMiddle(drawing.querySelector('.roll-circle__sounding-numeral'), shown?.numeral ?? '', SOUNDING_NUMERAL_SIZE);
}

/** Draws the octave of keys under the circle, from middle C, the chord sounding to be shown on. */
export function drawTheKeysUnderTheCircle(row: HTMLElement): ReadonlyMap<number, HTMLElement> {
  return drawTheKeys(row, MIDDLE_C, MIDDLE_C + 11);
}

/**
 * Shows a chord on the octave of keys under the circle: each of its notes
 * lit on the key of its name, wherever it is played, and its root the more;
 * none lit for none.
 */
export function showTheChordOnTheKeys(
  keys: ReadonlyMap<number, HTMLElement>,
  chord: { readonly root: number; readonly keys: readonly number[] } | null,
): void {
  const onTheOctave = (midi: number): number => MIDDLE_C + (((midi % 12) + 12) % 12);
  const lit = new Map<number, KeyLight>((chord?.keys ?? []).map((midi) => [onTheOctave(midi), 'heard']));
  lightTheKeysOf(keys, lit);
  const root = chord === null ? null : onTheOctave(chord.root);
  for (const [midi, key] of keys) {
    if (midi === root) {
      key.dataset['root'] = 'true';
    } else {
      delete key.dataset['root'];
    }
  }
}

/** Whether a pointer or a key is on the middle of the circle. */
export function isTheMiddleOfTheCircle(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.roll-circle__middle') !== null;
}

/**
 * Draws the way the music came round the circle: a line from each chord to
 * the next through the middles of their slices, the older the fainter, so
 * the progression is read as a path that fades behind it.
 */
function showTheWayRound(drawing: SVGSVGElement, way: readonly PlaceOnTheCircle[]): void {
  const shown = drawing.querySelector('.roll-circle__way');
  if (shown === null) {
    return;
  }
  const doc = drawing.ownerDocument;
  const steps = way.slice(1).map((to, at) => {
    const from = way[at] ?? to;
    const [fromX, fromY] = theMiddleOf(from);
    const [toX, toY] = theMiddleOf(to);
    const step = doc.createElementNS(SVG, 'line');
    step.setAttribute('class', 'roll-circle__step');
    step.setAttribute('x1', fromX.toFixed(2));
    step.setAttribute('y1', fromY.toFixed(2));
    step.setAttribute('x2', toX.toFixed(2));
    step.setAttribute('y2', toY.toFixed(2));
    step.setAttribute('data-from', `${from.ring} ${String(from.place)}`);
    step.setAttribute('data-to', `${to.ring} ${String(to.place)}`);
    const older = way.length - 2 - at;
    step.setAttribute('stroke-opacity', (NEWEST_STEP - older * EACH_STEP_OLDER).toFixed(2));
    return step;
  });
  shown.replaceChildren(...steps);
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
 * own lit, each with its numeral, the others without; and the chord
 * sounding named in the middle and, where it has a place, lit more.
 */
export function showOnTheCircle(
  drawing: SVGSVGElement,
  shown: {
    readonly fifths: number;
    readonly ofTheKey: readonly (PlaceOnTheCircle & { readonly numeral: string })[];
    readonly here: PlaceOnTheCircle | null;
    /** The chord sounding, its name and its degree in the key, which `here` is the place of where it has one. */
    readonly sounding: { readonly name: string; readonly numeral: string } | null;
    /** Whether the middle names it: see `circleNamesTheChord`. */
    readonly named: boolean;
    /** The way the music came to where it is, oldest first: see `theWayRoundTheCircle`. */
    readonly way: readonly PlaceOnTheCircle[];
  },
): void {
  showTheWayRound(drawing, shown.way);
  nameTheChordSounding(drawing, shown.sounding, shown.named);
  // A slice's name is the one drawn in the same turn as it.
  const labels = [...drawing.querySelectorAll('.roll-circle__label')];
  for (const [turn, slice] of [...drawing.querySelectorAll<SVGGElement>('[data-ring]')].entries()) {
    const label = labels[turn];
    const ring = CIRCLE_RINGS.find((each) => each === slice.getAttribute('data-ring')) ?? 'major';
    const place = Number(slice.getAttribute('data-place'));
    const name = theNameAtThePlace({ ring, place }, shown.fifths);
    const says = `Write ${name} where the cursor is`;
    slice.setAttribute('aria-label', says);
    const title = slice.querySelector('title');
    if (title !== null) {
      title.textContent = says;
    }
    const written = label?.querySelector('.roll-circle__name') ?? null;
    if (written !== null) {
      written.textContent = theNameOnTheSlice(name);
    }
    const own = shown.ofTheKey.find((each) => each.ring === ring && each.place === place);
    for (const each of [slice, label]) {
      if (own === undefined) {
        each?.removeAttribute('data-in-the-key');
      } else {
        each?.setAttribute('data-in-the-key', 'true');
      }
    }
    const numeral = label?.querySelector('.roll-circle__numeral') ?? null;
    if (numeral !== null) {
      numeral.textContent = own?.numeral ?? '';
    }
    for (const each of [slice, label]) {
      if (shown.here?.ring === ring && shown.here.place === place) {
        each?.setAttribute('data-here', 'true');
      } else {
        each?.removeAttribute('data-here');
      }
    }
  }
}

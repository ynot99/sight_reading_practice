import type { KeyShade } from '../application/runReplay.js';
export type { KeyShade };

/**
 * How a key is lit: as its press was judged, in a replay - or as heard, in a
 * playback, where nobody played it and nothing was judged.
 */
export type KeyLight = KeyShade | 'heard';

/** The lowest key of a piano, A0. */
export const LOWEST_KEY = 21;
/** And the highest, C8: eighty-eight in all. */
export const HIGHEST_KEY = 108;
/** Middle C, which a keyboard too wide for its screen opens on. */
const MIDDLE_C = 60;

/** The pitch classes of the black keys: C#, D#, F#, G#, A#. */
const BLACK = new Set([1, 3, 6, 8, 10]);

export function isBlackKey(midi: number): boolean {
  return BLACK.has(((midi % 12) + 12) % 12);
}

/** A keyboard drawn to be lit, with what lighting it needs to reach. */
export interface ReplayKeyboard {
  readonly keys: ReadonlyMap<number, HTMLElement>;
  readonly pedal: HTMLElement;
  /** The part that scrolls, where the screen is too narrow for all of it. */
  readonly scroller: HTMLElement;
  /** The row of keys, which every key's place along the keyboard is counted from. */
  readonly row: HTMLElement;
  /** Where notes fall onto the keys from: over the row, and as wide as it. */
  readonly lane: HTMLCanvasElement;
  /** Where the pedal falls onto its mark from: over the mark, and as wide as it. */
  readonly pedalLane: HTMLCanvasElement;
  /** The mark's place, which turns the pedal falling onto it off and on. */
  readonly pedalToggle: HTMLButtonElement;
  /** Under the mark: whether the slider through what is shown again stands under the keys. */
  readonly sliderToggle: HTMLButtonElement;
}

/**
 * Draws all eighty-eight keys, and the pedal beside them, into `host`.
 *
 * All of them, as the instrument has them: the same keyboard every time is a
 * map of the real one, where a keyboard of only the keys a run used would be a
 * different picture each time. His: "Всі 88".
 *
 * Each white key holds the black key above it, placed across its right-hand
 * edge, so the two stay together however wide a white key comes out - a
 * screen that fits them all, or a phone where they keep their width and the
 * row scrolls instead.
 */
export function drawTheKeyboard(host: HTMLElement): ReplayKeyboard {
  const doc = host.ownerDocument;
  const keys = new Map<number, HTMLElement>();

  const pedal = doc.createElement('span');
  pedal.className = 'replay-keys__pedal';
  pedal.dataset['down'] = 'false';
  pedal.textContent = 'Ped.';
  // Whether the pedal falls onto the mark: filled, or empty.
  const dot = doc.createElement('span');
  dot.className = 'replay-keys__pedal-dot';
  pedal.append(dot);
  // Level with the keys, with a lane of its own over it that the pedal falls
  // down onto it through, as the notes fall onto the keys. The whole of the
  // place under that lane is what is pressed, the mark being smaller than a
  // fingertip.
  const foot = doc.createElement('button');
  foot.type = 'button';
  foot.className = 'replay-keys__pedal-foot';
  foot.append(pedal);
  const pedalLaneBox = doc.createElement('span');
  pedalLaneBox.className = 'replay-keys__lane replay-keys__pedal-lane';
  const pedalLane = doc.createElement('canvas');
  pedalLaneBox.append(pedalLane);
  // Under the mark, the slider's switch: an arrow, pointing the way the
  // strip goes when it is pressed - down while it is shown, up while it is not.
  const sliderToggle = doc.createElement('button');
  sliderToggle.type = 'button';
  sliderToggle.className = 'replay-keys__slider-toggle';
  const SVG = 'http://www.w3.org/2000/svg';
  const icon = doc.createElementNS(SVG, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const knob = doc.createElementNS(SVG, 'path');
  knob.setAttribute('d', 'M6 9.4 7.4 8l4.6 4.6L16.6 8 18 9.4l-6 6z');
  icon.append(knob);
  sliderToggle.append(icon);
  const side = doc.createElement('span');
  side.className = 'replay-keys__side';
  side.append(pedalLaneBox, foot, sliderToggle);

  const scroller = doc.createElement('div');
  scroller.className = 'replay-keys__scroller';
  // The lane and the keys in one track, so the two scroll as one and the lane
  // is as wide as the keys however wide those come out.
  const track = doc.createElement('div');
  track.className = 'replay-keys__track';
  const laneBox = doc.createElement('div');
  laneBox.className = 'replay-keys__lane';
  const lane = doc.createElement('canvas');
  laneBox.append(lane);
  const row = doc.createElement('div');
  row.className = 'replay-keys__row';
  track.append(laneBox, row);
  scroller.append(track);
  for (let midi = LOWEST_KEY; midi <= HIGHEST_KEY; midi += 1) {
    if (isBlackKey(midi)) {
      continue;
    }
    const white = doc.createElement('span');
    white.className = 'replay-keys__white';
    white.dataset['midi'] = String(midi);
    keys.set(midi, white);
    const above = midi + 1;
    if (above <= HIGHEST_KEY && isBlackKey(above)) {
      const black = doc.createElement('span');
      black.className = 'replay-keys__black';
      black.dataset['midi'] = String(above);
      keys.set(above, black);
      white.append(black);
    }
    row.append(white);
  }

  host.replaceChildren(side, scroller);
  return { keys, pedal, scroller, row, lane, pedalLane, pedalToggle: foot, sliderToggle };
}

/** Where a key stands along the row, and how wide it is drawn, in page pixels. */
export interface KeyPlace {
  readonly left: number;
  readonly width: number;
}

/**
 * Where every key stands along the row, read off the keys as drawn.
 *
 * The stylesheet decides how wide a key is - a share of the screen, or a
 * finger's width on a phone where the row scrolls instead - so anything drawn
 * over the keys asks them where they are rather than working it out again.
 */
export function whereTheKeysAre(keyboard: ReplayKeyboard): ReadonlyMap<number, KeyPlace> {
  const places = new Map<number, KeyPlace>();
  for (const [midi, key] of keyboard.keys) {
    // A black key is placed inside its white one, so its own offset is from
    // there.
    const from = isBlackKey(midi) ? (key.parentElement?.offsetLeft ?? 0) : 0;
    places.set(midi, { left: from + key.offsetLeft, width: key.offsetWidth });
  }
  return places;
}

/**
 * Lights the keys down now and the pedal, and puts the rest out.
 *
 * Only what changed is touched: this runs on every frame of a replay, and the
 * keys that change between two of them are a handful of eighty-eight.
 *
 * Two things are said of a key: `data-shade` while it is down, and
 * `data-lit`, the light it was last lit in, which stays after it comes up.
 * The stylesheet fades the light out in that colour, so it has to outlive
 * the press.
 */
export function lightTheKeys(
  keyboard: ReplayKeyboard,
  down: ReadonlyMap<number, KeyLight>,
  pedalDown: boolean,
): void {
  for (const [midi, key] of keyboard.keys) {
    const shade = down.get(midi);
    const now = key.dataset['shade'];
    if (shade === undefined) {
      if (now !== undefined) {
        delete key.dataset['shade'];
      }
      continue;
    }
    if (now !== shade) {
      key.dataset['shade'] = shade;
    }
    if (key.dataset['lit'] !== shade) {
      key.dataset['lit'] = shade;
    }
  }
  const pedal = String(pedalDown);
  if (keyboard.pedal.dataset['down'] !== pedal) {
    keyboard.pedal.dataset['down'] = pedal;
  }
}

/**
 * Where to scroll a keyboard too wide for its screen so that `midi` is in the
 * middle, or `null` where the whole of it already shows.
 */
export function scrollToShow(keyboard: ReplayKeyboard, midi: number): number | null {
  const scroller = keyboard.scroller;
  if (scroller.scrollWidth <= scroller.clientWidth) {
    return null;
  }
  const key = keyboard.keys.get(midi) ?? keyboard.keys.get(MIDDLE_C);
  if (key === undefined) {
    return null;
  }
  // A black key is placed inside its white one, so its own offset is from
  // there; the white key it stands in says where it is along the row.
  const along = isBlackKey(midi) ? (key.parentElement ?? key) : key;
  return Math.max(0, along.offsetLeft + along.offsetWidth / 2 - scroller.clientWidth / 2);
}

/**
 * Slides the row round to `midi` when it is out of sight, and leaves the row
 * where it is when it is not.
 *
 * Where the screen is too narrow for the whole keyboard, a key lit off the
 * edge is a press nobody sees. One already in view is not chased, or the row
 * would swim with every note. The same for a replay and a playback, so it is
 * written once.
 */
export function keepInView(keyboard: ReplayKeyboard, midi: number): void {
  const scroller = keyboard.scroller;
  const key = keyboard.keys.get(midi);
  if (key === undefined) {
    return;
  }
  // A keyboard that fits its screen is never moved: `scrollToShow` says so.
  const along = isBlackKey(midi) ? (key.parentElement ?? key) : key;
  const inView =
    along.offsetLeft >= scroller.scrollLeft &&
    along.offsetLeft + along.offsetWidth <= scroller.scrollLeft + scroller.clientWidth;
  const to = inView ? null : scrollToShow(keyboard, midi);
  if (to !== null && typeof scroller.scrollTo === 'function') {
    scroller.scrollTo({ left: to, behavior: 'smooth' });
  }
}

export { MIDDLE_C };

import type { KeyShade } from '../application/runReplay.js';

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

  const scroller = doc.createElement('div');
  scroller.className = 'replay-keys__scroller';
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
    scroller.append(white);
  }

  host.replaceChildren(pedal, scroller);
  return { keys, pedal, scroller };
}

/**
 * Lights the keys down now and the pedal, and puts the rest out.
 *
 * Only what changed is touched: this runs on every frame of a replay, and the
 * keys that change between two of them are a handful of eighty-eight.
 */
export function lightTheKeys(
  keyboard: ReplayKeyboard,
  down: ReadonlyMap<number, KeyShade>,
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

export { MIDDLE_C };

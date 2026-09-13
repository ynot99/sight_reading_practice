import type { RolledBeat, RolledPress, RunRoll } from '../application/session/RunRoll.js';
import { midiToLabel } from '../domain/model/Pitch.js';

/**
 * What the drawing needs beyond the roll itself.
 *
 * Only the labels: a bar's printed number is not its place in the playing,
 * because a repeat is written out and a re-read bar keeps the number it has in
 * the file. Asked of whoever has the score rather than worked out here.
 */
export interface RollDrawing {
  readonly roll: RunRoll;
  /** What the writer called the bar the metronome counted as this measure. */
  readonly barLabel: (measure: number) => string;
}

/** Semitones of air kept above and below what was played. */
const PADDING_ROWS = 2;
/** Rows drawn however few notes there were, so one note is not one stripe. */
const LEAST_ROWS = 12;
/** Seconds of grid kept past the last thing that happened. */
const TAIL_SECONDS = 1;

/** Pitch classes drawn dark, because on a keyboard they are the black keys. */
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

function isBlack(midi: number): boolean {
  return BLACK_KEYS.has(((midi % 12) + 12) % 12);
}

/**
 * A length of time as a CSS length, in terms of the zoom.
 *
 * Every position in the drawing is written this way, so zooming is one custom
 * property changing and not a redraw: the browser recomputes the whole grid
 * from the same numbers. Seconds rather than milliseconds only to keep the
 * numbers legible in the markup.
 */
function atSecond(ms: number): string {
  return `calc(var(--roll-second) * ${(ms / 1000).toFixed(4)})`;
}

function atRow(row: number): string {
  return `calc(var(--roll-row) * ${row})`;
}

/** Where the drawing's nought is: the first thing that happened, whatever it was. */
function originOf(roll: RunRoll): number {
  const first = [
    ...roll.beats.map((beat) => beat.atMs),
    ...roll.presses.map((press) => press.downAtMs),
    ...roll.pedal.map((span) => span.downAtMs),
  ];
  return first.length === 0 ? 0 : Math.min(...first);
}

/** Where it ends, with a key still down or a pedal still held running to the edge. */
function endOf(roll: RunRoll, origin: number): number {
  const last = [
    ...roll.beats.map((beat) => beat.atMs),
    ...roll.presses.map((press) => press.upAtMs ?? press.downAtMs),
    ...roll.pedal.map((span) => span.upAtMs ?? span.downAtMs),
  ];
  return (last.length === 0 ? origin : Math.max(...last)) + TAIL_SECONDS * 1000;
}

/**
 * The band of pitches drawn.
 *
 * Clamped to what was played rather than the whole keyboard: eighty-eight rows
 * of which sixty are empty puts the music in a tenth of the screen, and the
 * question being asked is about the horizontal axis.
 */
function bandOf(presses: readonly RolledPress[]): { readonly low: number; readonly high: number } {
  if (presses.length === 0) {
    return { low: 60, high: 60 + LEAST_ROWS - 1 };
  }
  const played = presses.map((press) => press.midi);
  let low = Math.min(...played) - PADDING_ROWS;
  let high = Math.max(...played) + PADDING_ROWS;
  while (high - low + 1 < LEAST_ROWS) {
    high += 1;
    if (high - low + 1 < LEAST_ROWS) {
      low -= 1;
    }
  }
  return { low, high };
}

/**
 * How a press is coloured.
 *
 * The verdicts the page is already marked by, and no new vocabulary: a note
 * the run said nothing about is drawn plainly rather than as a fault, which is
 * the difference between "this was wrong" and "nothing was decided here".
 */
function shadeOf(press: RolledPress): string {
  switch (press.verdict) {
    case 'correct':
      return 'correct';
    case 'wrong':
      return 'wrong';
    case 'rushed':
    case 'late':
      return 'off-the-beat';
    case 'duplicate':
    case 'other-hand':
      return 'aside';
    default:
      return 'unjudged';
  }
}

function element(tag: string, className: string): HTMLElement {
  const made = document.createElement(tag);
  made.className = className;
  return made;
}

/** The line a click leaves: heavy for a bar, plain for a beat. */
function lineFor(beat: RolledBeat, origin: number): HTMLElement | null {
  // Only what the reader asked to see. A click may be running at four to the
  // beat for the sake of the loop's resolution, and a line for every one of
  // them is a grey wash rather than a grid.
  if (beat.weight === 'division') {
    return null;
  }
  const line = element('div', `roll__line roll__line--${beat.weight}`);
  line.style.left = atSecond(beat.atMs - origin);
  return line;
}

function noteFor(press: RolledPress, origin: number, high: number, endMs: number): HTMLElement {
  const note = element('div', `roll__note roll__note--${shadeOf(press)}`);
  const until = press.upAtMs ?? endMs;
  note.style.left = atSecond(press.downAtMs - origin);
  note.style.width = atSecond(Math.max(0, until - press.downAtMs));
  note.style.top = atRow(high - press.midi);
  // What it was, for a finger on a cell. The deviation is the reason the view
  // exists, so it is said in milliseconds and signed: behind the beat is
  // positive, because that is the direction a reader falls.
  const off =
    press.deviationMs === null ? '' : ` · ${press.deviationMs > 0 ? '+' : ''}${Math.round(press.deviationMs)} ms`;
  note.title = `${midiToLabel(press.midi)} · ${press.verdict ?? 'not judged'}${off}`;
  if (press.upAtMs === null) {
    note.classList.add('roll__note--open');
  }
  return note;
}

/**
 * Draws a run as keys against the clicks it was played to.
 *
 * The horizontal axis is real time and the lines are the moments clicks were
 * *heard*, not a grid computed from a tempo - so a bar the reader was held at
 * is simply a wider bar, and a piece that changes tempo cannot drift away from
 * its own drawing. Everything is positioned in terms of `--roll-second` and
 * `--roll-row`, so zooming changes two custom properties and nothing is
 * rebuilt.
 */
export function drawTheRoll(drawing: RollDrawing): HTMLElement {
  const { roll } = drawing;
  const origin = originOf(roll);
  const endMs = endOf(roll, origin);
  const band = bandOf(roll.presses);
  const rows = band.high - band.low + 1;

  const view = element('div', 'roll');
  view.style.setProperty('--roll-rows', String(rows));
  view.style.setProperty('--roll-length', atSecond(endMs - origin));

  const ruler = element('div', 'roll__ruler');
  const seen = new Set<number>();
  for (const beat of roll.beats) {
    if (beat.weight !== 'downbeat' || seen.has(beat.measure)) {
      continue;
    }
    seen.add(beat.measure);
    const mark = element('span', 'roll__bar');
    mark.style.left = atSecond(beat.atMs - origin);
    mark.textContent = drawing.barLabel(beat.measure);
    ruler.append(mark);
  }

  const keys = element('div', 'roll__keys');
  for (let midi = band.high; midi >= band.low; midi -= 1) {
    const key = element('div', `roll__key${isBlack(midi) ? ' roll__key--black' : ''}`);
    key.style.top = atRow(band.high - midi);
    // Named only where the name is worth the room: every C, so the eye has
    // somewhere to land, and the black keys by their shape alone.
    key.textContent = midi % 12 === 0 ? midiToLabel(midi) : '';
    keys.append(key);
  }

  const grid = element('div', 'roll__grid');
  for (let midi = band.high; midi >= band.low; midi -= 1) {
    if (!isBlack(midi)) {
      continue;
    }
    const row = element('div', 'roll__row');
    row.style.top = atRow(band.high - midi);
    grid.append(row);
  }
  for (const beat of roll.beats) {
    const line = lineFor(beat, origin);
    if (line !== null) {
      grid.append(line);
    }
  }
  for (const press of roll.presses) {
    grid.append(noteFor(press, origin, band.high, endMs));
  }

  const pedal = element('div', 'roll__pedal');
  for (const span of roll.pedal) {
    const held = element('div', 'roll__pedal-span');
    held.style.left = atSecond(span.downAtMs - origin);
    held.style.width = atSecond(Math.max(0, (span.upAtMs ?? endMs) - span.downAtMs));
    held.title = span.upAtMs === null ? 'Pedal, still down' : 'Pedal';
    pedal.append(held);
  }

  view.append(ruler, keys, grid, pedal);
  return view;
}

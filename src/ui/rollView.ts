import {
  beatsWorthMarking,
  rollBeganAtMs,
  rollEndedAtMs,
  type GridFineness,
  type MarkedBeat,
  type RolledPress,
  type RunRoll,
} from '../application/session/RunRoll.js';
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
  /**
   * What the writer called the bar a position in the music falls in, or `null`
   * where that position is not the start of one.
   */
  readonly barLabel: (positionTicks: number) => string | null;
  /** How fine a grid to draw. The beats of the music unless asked otherwise. */
  readonly fineness?: GridFineness;
}

/** Semitones of air kept above and below what was played. */
const PADDING_ROWS = 2;
/** Rows drawn however few notes there were, so one note is not one stripe. */
const LEAST_ROWS = 12;
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

/**
 * The line a click leaves: heavy for a bar, plain for a beat.
 *
 * A bar line the reader gave late gets a line of its own kind: the metre's own
 * lines say where the beat was, and this one says where they put it, in the
 * colour of the head because like the head it is theirs rather than the music's.
 */
function lineFor(beat: MarkedBeat, origin: number): HTMLElement {
  const kind = beat.given ? 'given' : beat.weight;
  const line = element('div', `roll__line roll__line--${kind}`);
  line.style.left = atSecond(beat.atMs - origin);
  return line;
}

/**
 * The stretch a bar line waited, from where it fell due to where it was given.
 *
 * The band rather than its edge, which is his: "не просто жовту лінію, а всю
 * секцію малювати жовтим фоном". A line says *that* he was late and the band
 * says *how* late without anything having to be read - the eye takes a width
 * where it has to measure a gap.
 *
 * `null` for a beat that fell where it was meant to, which is most of them.
 */
function waitFor(beat: MarkedBeat, origin: number): HTMLElement | null {
  if (beat.lateByMs === null) {
    return null;
  }
  const band = element('div', 'roll__wait');
  band.style.left = atSecond(beat.atMs - beat.lateByMs - origin);
  band.style.width = atSecond(beat.lateByMs);
  band.title = `Bar line given ${Math.round(beat.lateByMs)} ms late`;
  return band;
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
 * The moment a tap on the grid means, in milliseconds from the roll's start.
 *
 * The drawing's whole geometry is `--roll-second` times a number of seconds, so
 * reading a position back is that arithmetic run the other way. Kept here, next
 * to the function that writes it, because a second copy of the conversion is a
 * head that lands somewhere other than where the finger did.
 *
 * `pxPerSecond` of nought or less means nothing has been laid out and there is
 * no position to read.
 */
export function timeFromTap(offsetPx: number, pxPerSecond: number): number | null {
  if (pxPerSecond <= 0) {
    return null;
  }
  return Math.max(0, (offsetPx / pxPerSecond) * 1000);
}

/** Where the head is put when the view is scrolled to it, as a fraction across. */
const HEAD_RESTS_AT = 0.25;
/** And how far across it may drift before the view is moved at all. */
const HEAD_DRIFTS_TO = 0.75;

/**
 * Where to scroll so a playback stays watchable, or `null` to leave it alone.
 *
 * Moved only when the head has left the front three quarters of the view, and
 * then put a quarter of the way in rather than in the middle: a grid that
 * re-centres on every frame cannot be read, and one that never moves is a
 * performance watched off-screen. Landing it at a quarter leaves most of the
 * width for what is about to be played, which is what the reader is looking
 * at.
 *
 * Separated from the scrolling itself because this is the part with a judgement
 * in it. The three lines that set `scrollLeft` are layout, which no test here
 * can see; these numbers are arithmetic, which every test can.
 */
export function keepTheHeadInView(
  headPx: number,
  scrolledToPx: number,
  viewWidePx: number,
): number | null {
  // Nothing is laid out, so there is no view to keep anything inside of.
  if (viewWidePx <= 0) {
    return null;
  }
  if (headPx >= scrolledToPx && headPx <= scrolledToPx + viewWidePx * HEAD_DRIFTS_TO) {
    return null;
  }
  return Math.max(0, headPx - viewWidePx * HEAD_RESTS_AT);
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
  const origin = rollBeganAtMs(roll);
  const endMs = rollEndedAtMs(roll);
  const band = bandOf(roll.presses);
  const rows = band.high - band.low + 1;

  const view = element('div', 'roll');
  view.style.setProperty('--roll-rows', String(rows));
  view.style.setProperty('--roll-length', atSecond(endMs - origin));

  // One name per bar line, where it fell due rather than where it was given:
  // the number over the grid is the page's, and the page does not move.
  const ruler = element('div', 'roll__ruler');
  for (const beat of beatsWorthMarking(roll, drawing.fineness)) {
    // Whether a place in the music begins a bar is the namer's question, not
    // this one's; all the drawing knows is that a beat the reader gave is not a
    // second bar to be named.
    const name = beat.given ? null : drawing.barLabel(beat.positionTicks);
    if (name === null) {
      continue;
    }
    const mark = element('span', 'roll__bar');
    mark.style.left = atSecond(beat.atMs - origin);
    mark.textContent = name;
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
  // Underneath everything, the rows included, and that is what makes the bands
  // darker where the black keys are: those rows are a dark wash with the ground
  // showing through, so a band beneath one is seen through it. Which is what he
  // asked for - "на чорні ноти також буде темне жовтий колір" - and it falls out
  // of the order rather than needing a second colour to keep in step.
  for (const beat of beatsWorthMarking(roll, drawing.fineness)) {
    const waited = waitFor(beat, origin);
    if (waited !== null) {
      grid.append(waited);
    }
  }
  for (let midi = band.high; midi >= band.low; midi -= 1) {
    if (!isBlack(midi)) {
      continue;
    }
    const row = element('div', 'roll__row');
    row.style.top = atRow(band.high - midi);
    grid.append(row);
  }
  // The same list a playback sounds its clicks from, so a line and a click can
  // never end up in different places.
  for (const beat of beatsWorthMarking(roll, drawing.fineness)) {
    grid.append(lineFor(beat, origin));
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

  // Where a playback has got to, moved by one custom property so following a
  // performance costs one write a frame rather than a redraw.
  const head = element('div', 'roll__head');
  grid.append(head);

  view.append(ruler, keys, grid, pedal);
  return view;
}

import {
  beatsWorthMarking,
  momentOfTicks,
  rollBeganAtMs,
  rollEndedAtMs,
  theGrid,
  theRushes,
  theWaits,
  type GridChoice,
  type GridLine,
  type RolledPress,
  type RolledRush,
  type RolledWait,
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
  /** How fine a grid to draw. Bars and whole beats unless asked otherwise. */
  readonly grid?: GridChoice;
  /**
   * The notes the run asked for, to be drawn behind the ones that were played.
   *
   * In divisions, because that is how the music knows them; where they fall in
   * the picture is worked out from the clicks that actually happened. Left out
   * unless the reader asks for them - most of the time the question is "how did
   * what I played sit against the beat", and a second layer of notes is in the
   * way of it.
   */
  readonly ghosts?: readonly RollGhost[];
  /**
   * Whether the gap between a note and where it was owed is filled in.
   *
   * On unless asked otherwise, because it is the answer to the question the
   * picture is usually open for. It is in the way of a different one: whether a
   * chord went down *together*, which is read off whether the presses line up -
   * and bands lying across them are colour between the eye and that line. His:
   * "щоб легше проаналізувати де я полінився, та натиснув ноти не разом".
   */
  readonly slips?: boolean;
  /**
   * Whether a machine kept the time of this run.
   *
   * It decides one thing: whether a note is given a band of its own saying how
   * far off the beat it came. Under a pulse that is the only mark there is for
   * it, and it belongs on that note's row because being late there holds
   * nothing up - the music went on without them.
   *
   * Where the music *waits*, the same gap is the music standing still, and it
   * is drawn full height as a section. Drawn both ways it was drawn twice, and
   * the band - one row tall, in the wait's own yellow - is a yellow note, which
   * is exactly what he was still seeing after the sections went in: "чому ти до
   * сих пір малюєш жовті ноти замість жовтих секцій".
   */
  readonly keepsTime?: boolean;
}

/** One note the music asked for, in the music's own time. */
export interface RollGhost {
  readonly midi: number;
  readonly fromTicks: number;
  readonly untilTicks: number;
  /**
   * Which step of the run asked for it.
   *
   * So that a press can be paired with the note it answered. Pitch alone will
   * not do it: a piece returns to the same note again and again, and pairing by
   * pitch would join a press to whichever of them the loop reached first.
   */
  readonly stepIndex: number;
}

/**
 * Gaps smaller than this are not drawn at all, in milliseconds.
 *
 * Below about this nobody hears a rhythmic fault, and every note is off the beat
 * by *something* - drawn without a floor, a run would be one continuous wash of
 * colour saying nothing about anywhere in particular.
 */
const SLIP_FLOOR_MS = 20;
/** And the gap at which the colour is as strong as it gets. */
const SLIP_FULL_MS = 400;
/** How solid the strongest of them is. */
const SLIP_MOST_SOLID = 0.5;

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
function bandOf(
  presses: readonly RolledPress[],
  ghosts: readonly RollGhost[],
): { readonly low: number; readonly high: number } {
  // The notes asked for count as much as the ones played: a note that was missed
  // altogether is the one worth seeing, and a band drawn round the presses alone
  // would leave it outside the picture.
  const played = [...presses.map((press) => press.midi), ...ghosts.map((ghost) => ghost.midi)];
  if (played.length === 0) {
    return { low: 60, high: 60 + LEAST_ROWS - 1 };
  }
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
      // The right note. *When* it came is the band's business, and colouring the
      // note as well made one colour mean three things - a note off the beat, the
      // distance it was off by, and the music waiting at a bar line. His: "давай
      // не робити жовтих нот - бо я про це ніколи не прохав".
      return 'correct';
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
function lineFor(beat: GridLine, origin: number): HTMLElement {
  const line = element('div', `roll__line roll__line--${beat.given ? 'given' : beat.weight}`);
  line.style.left = atSecond(beat.atMs - origin);
  if (beat.lateByMs !== null) {
    line.title = `Given ${Math.round(beat.lateByMs)} ms late`;
  }
  return line;
}

/**
 * Where the reader arrived before the music had got there.
 *
 * A line and not a section, and there cannot be one: the music moved on when
 * they played, so the stretch between here and where the beat was due is time
 * that never elapsed. Drawn whether or not the grid has a line of its own at
 * that moment - an entry between the clicks the reader chose is not drawn as a
 * beat, and hanging this on one left it with no mark at all.
 */
function rushFor(rush: RolledRush, origin: number): HTMLElement {
  const line = element('div', 'roll__line roll__line--rushed');
  line.style.left = atSecond(rush.atMs - origin);
  line.title = `Taken ${Math.round(rush.byMs)} ms early`;
  return line;
}

/**
 * The stretch the music waited, from where it fell due to where it was given.
 *
 * The band rather than its edge, which is his: "не просто жовту лінію, а всю
 * секцію малювати жовтим фоном". A line says *that* he was late and the band
 * says *how* late without anything having to be read - the eye takes a width
 * where it has to measure a gap.
 *
 * One mark for one fact, at a bar line's gate and at every note of a frame that
 * waits on each of them: in both the music stood still for him, and in both the
 * grid on either side of the band is even. His: "кожен такий slowdown
 * замальовувати жовтою секцією just like у wait for bars".
 *
 * `null` for a beat that fell where it was meant to, which is most of them.
 */
function waitFor(wait: RolledWait, origin: number): HTMLElement {
  const held = wait.untilMs - wait.fromMs;
  const band = element('div', 'roll__wait');
  band.style.left = atSecond(wait.fromMs - origin);
  band.style.width = atSecond(held);
  band.title = `The music waited ${Math.round(held)} ms`;
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

/** Closest and widest a run may be drawn, in pixels to the second. */
export const LEAST_ZOOM = 40;
export const MOST_ZOOM = 600;

/** How tall a row of pitch may be drawn, in pixels. */
export const LEAST_ROW = 4;
export const MOST_ROW = 40;

/**
 * A size two fingers are asking for.
 *
 * A ratio of distances rather than a distance: a pinch means "this much more of
 * it", and the same gesture has to mean the same thing whether the run is drawn
 * close or wide.
 *
 * To the pixel, and no coarser. It used to be snapped to the twenty the zoom
 * slider stepped in, on the grounds that a slider showing a value it cannot
 * reach is a control lying about what it does - but the answer to that is to let
 * the slider step in ones as well, not to make the gesture jump in twenty-ninths
 * of its range. His: "чи можна pinch zoom зробити більш плавним".
 */
export function scaledBy(from: number, ratio: number, least: number, most: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return from;
  }
  return Math.min(most, Math.max(least, Math.round(from * ratio)));
}

/**
 * How far apart two fingers are, along each axis separately.
 *
 * Two spans rather than one distance, because they are two questions: how much
 * of the run is on the screen, and how tall the band of pitches is drawn. A
 * single distance can only answer one of them, and answering the width with a
 * gesture made down the page is the sort of thing that makes a control feel
 * unpredictable.
 */
export interface FingerSpan {
  readonly acrossPx: number;
  readonly downPx: number;
}

/** The sizes a pinch began from, which it is measured against. */
export interface PinchedFrom extends FingerSpan {
  readonly zoom: number;
  readonly row: number;
}

/**
 * How narrow a span may be and still be part of the gesture, in pixels.
 *
 * Below it the two fingers are level, or above one another, and the ratio along
 * that axis is a small number divided by a small number - which is noise, and
 * would have a pinch straight across the screen changing the height by whatever
 * the hand wobbled.
 */
const PINCH_AXIS_FLOOR_PX = 24;

/**
 * What a pinch is asking for, in both directions at once.
 *
 * Each axis answered from its own span, so a pinch across the screen changes the
 * width alone, one down it the height alone, and a diagonal one both - which is
 * what a hand doing it expects, and needs no mode and no choosing between them.
 */
export function pinchedTo(from: PinchedFrom, now: FingerSpan): { zoom: number; row: number } {
  return {
    zoom:
      from.acrossPx < PINCH_AXIS_FLOOR_PX
        ? from.zoom
        : scaledBy(from.zoom, now.acrossPx / from.acrossPx, LEAST_ZOOM, MOST_ZOOM),
    row:
      from.downPx < PINCH_AXIS_FLOOR_PX
        ? from.row
        : scaledBy(from.row, now.downPx / from.downPx, LEAST_ROW, MOST_ROW),
  };
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
 * The gap between when a note was owed and when it was taken.
 *
 * A band on the note's own row, which is the same argument that made the wait at
 * a bar line a band: the eye takes a width where it would otherwise have to
 * measure the space between two edges. It belongs to that one note rather than
 * to the whole grid, so it is one row tall.
 *
 * Coloured by direction, and that is a judgement this program already makes
 * rather than a decoration: being late is allowed, because the music waits for
 * the reader, and being early is not, because the accompaniment does not.
 *
 * Strength by size, so that "badly rushed" looks worse than "a little early"
 * without a threshold anybody has to agree on. His: "мабуть червоні у випадку
 * якщо сильно поспішав з нотою".
 */
function slipBetween(dueAt: number, playedAt: number, row: number): HTMLElement | null {
  const gap = playedAt - dueAt;
  if (Math.abs(gap) < SLIP_FLOOR_MS) {
    return null;
  }
  const band = element('div', `roll__slip roll__slip--${gap > 0 ? 'late' : 'rushed'}`);
  band.style.left = atSecond(Math.min(dueAt, playedAt));
  band.style.width = atSecond(Math.abs(gap));
  band.style.top = atRow(row);
  band.style.opacity = String(
    Math.min(SLIP_MOST_SOLID, (Math.abs(gap) / SLIP_FULL_MS) * SLIP_MOST_SOLID),
  );
  band.title = `${gap > 0 ? 'Late' : 'Rushed'} by ${Math.abs(Math.round(gap))} ms`;
  return band;
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
  const ghosts = drawing.ghosts ?? [];
  const band = bandOf(roll.presses, ghosts);
  const rows = band.high - band.low + 1;

  const view = element('div', 'roll');
  view.style.setProperty('--roll-rows', String(rows));
  view.style.setProperty('--roll-length', atSecond(endMs - origin));

  // One name per bar line, where it fell due rather than where it was given:
  // the number over the grid is the page's, and the page does not move.
  const ruler = element('div', 'roll__ruler');
  for (const beat of beatsWorthMarking(roll)) {
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
  for (const wait of theWaits(roll)) {
    grid.append(waitFor(wait, origin));
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
  // never end up in different places - cut lines included.
  for (const beat of theGrid(roll, drawing.grid)) {
    grid.append(lineFor(beat, origin));
  }
  for (const rush of theRushes(roll)) {
    grid.append(rushFor(rush, origin));
  }
  // The press that answered each note the music asked for, by the step it was
  // owed to: a piece returns to the same pitch again and again, so pitch alone
  // would pair a press with whichever of them came first.
  const answered = new Map<string, RolledPress>();
  for (const press of roll.presses) {
    const key = `${press.stepIndex ?? -1}:${press.midi}`;
    if (!answered.has(key)) {
      answered.set(key, press);
    }
  }

  // Where each note the music asked for belongs, worked out once. The bands go
  // down here and the outlines at the end, because they want opposite sides of
  // the presses: a band is a stretch of ground and belongs under them, and an
  // outline is a thing to read against them and was being covered by them.
  const outlines: { readonly ghost: RollGhost; readonly from: number; readonly until: number }[] =
    [];
  for (const ghost of ghosts) {
    // Beginning where the beat was taken and ending where the next one fell:
    // a note is over when its time is up, not when the reader arrives. Which
    // is also what cuts it where the reader came in early - there the only
    // beat at the far end is the one they took, so the note ends there.
    const from = momentOfTicks(roll, ghost.fromTicks, 'starts');
    const until = momentOfTicks(roll, ghost.untilTicks, 'ends');
    if (from === null || until === null) {
      continue;
    }
    outlines.push({ ghost, from, until });
    // Only where the right note was played at the wrong time. No press and the
    // outline says it alone; no note asked for and there is nothing to be off
    // from.
    const press = answered.get(`${ghost.stepIndex}:${ghost.midi}`);
    const slip =
      press === undefined || drawing.slips === false || drawing.keepsTime === false
        ? null
        : slipBetween(from, press.downAtMs - origin, band.high - ghost.midi);
    if (slip !== null) {
      grid.append(slip);
    }
  }
  for (const press of roll.presses) {
    grid.append(noteFor(press, origin, band.high, endMs));
  }

  // Over the presses, and that is the whole of what they are for: an outline
  // underneath the note that answered it is an outline nobody can see, because
  // a note played at all covers most of one. His: "чи можеш зробити ghost ноти
  // щоб вони малювалися поверх моїх нот... бо наразі мої ноти перекривають
  // більшість ghost нот". They stay out of the way of the pointer, so the press
  // underneath keeps its own reading of how far off the beat it was.
  for (const { ghost, from, until } of outlines) {
    const drawn = element('div', 'roll__ghost');
    drawn.style.left = atSecond(from);
    drawn.style.width = atSecond(Math.max(0, until - from));
    drawn.style.top = atRow(band.high - ghost.midi);
    drawn.title = `${midiToLabel(ghost.midi)} · asked for here`;
    grid.append(drawn);
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

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
import type { RollLanes } from './rollTiles.js';

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

/** A note the music asked for, placed in the run: milliseconds from its start. */
interface PlacedGhost {
  readonly ghost: RollGhost;
  readonly from: number;
  readonly until: number;
}

/**
 * Where each note the music asked for falls in the run.
 *
 * One place for it, because two things draw these notes - the drawing and the
 * map of pitches down its side - and a note one of them placed and the other
 * did not is a mark with nothing beside it.
 */
function placedGhosts(roll: RunRoll, ghosts: readonly RollGhost[]): PlacedGhost[] {
  const lastMs = rollEndedAtMs(roll) - rollBeganAtMs(roll);
  const placed: PlacedGhost[] = [];
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
    // And nothing past where the run stopped. A run cut short asked for
    // nothing beyond its last click, and the notes of the rest of the piece
    // have no beat here to be placed against - so they were placed by running
    // that last pair of clicks out over the whole score, which drew a canvas
    // of notes nobody played and left the drawing scrolling far past the run
    // it is a picture of. A note the reader stopped in the middle of is theirs
    // up to where they stopped and no further. His: "MIDI viewer наразі малює
    // повний канвас нот, навіть якщо я грав тільки слайс".
    if (from >= lastMs) {
      continue;
    }
    placed.push({ ghost, from, until: Math.min(until, lastMs) });
  }
  return placed;
}

/**
 * How a press is coloured.
 *
 * The verdicts the page is already marked by, and no new vocabulary: a note
 * the run said nothing about is drawn plainly rather than as a fault, which is
 * the difference between "this was wrong" and "nothing was decided here".
 */
function shadeOf(press: RolledPress): NoteShade {
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

/** How a press is coloured: see `shadeOf`. */
export type NoteShade = 'correct' | 'wrong' | 'aside' | 'unjudged';

/** How a line of the grid is drawn: the metre's own weights, and a bar line the reader gave. */
export type LineKind = 'downbeat' | 'beat' | 'division' | 'given';

/** A stretch of the run, and what it says to a pointer resting on it, if anything. */
export interface SceneStretch {
  readonly fromMs: number;
  readonly untilMs: number;
  readonly says: string | null;
}

/** A stretch on one row of pitch, counted down from the top of the band. */
export interface SceneRowed extends SceneStretch {
  readonly row: number;
}

/** A press. */
export interface SceneNote extends SceneRowed {
  readonly shade: NoteShade;
  /** Still down when the run ended, so it runs to the edge rather than stopping. */
  readonly open: boolean;
}

/** The gap between where a note was owed and where it was taken: see `slipBetween`. */
export interface SceneSlip extends SceneRowed {
  readonly kind: 'late' | 'rushed';
  /** How solid it is drawn, nought to {@link SLIP_MOST_SOLID}. */
  readonly strength: number;
}

/** The pedal, down. */
export interface ScenePedal extends SceneStretch {
  readonly open: boolean;
}

/** An instant of the run, and what it says to a pointer resting on it, if anything. */
export interface SceneMoment {
  readonly atMs: number;
  readonly says: string | null;
}

/** A click, as a line down the grid and a tick on the ruler. */
export interface SceneLine extends SceneMoment {
  readonly kind: LineKind;
}

/** A bar's printed number, where the bar begins. */
export interface SceneBar {
  readonly atMs: number;
  readonly name: string;
}

/**
 * Everything the drawing shows, placed in the run's own time.
 *
 * Milliseconds from where the run began, and rows down from the top of the
 * band of pitches: nothing the screen knows about. How wide a second is and how
 * tall a row are the zoom's to say when it is painted, so a zoom is painting
 * again and not working everything out again. Each list is in time order, so
 * the part of the run on the screen can be found without walking the rest of
 * it - a long piece is tens of thousands of marks, and the screen shows a few
 * hundred.
 */
export interface RollScene {
  /** The pitch on the top row. */
  readonly highest: number;
  readonly rows: number;
  /** How long the run is drawn: to its last event, and a moment of air past it. */
  readonly lengthMs: number;
  /** The rows the black keys are on, which are shaded as they are on the instrument. */
  readonly blackRows: readonly number[];
  readonly waits: readonly SceneStretch[];
  /** The clicks, which the ruler marks as well as the grid: one list, so they cannot disagree. */
  readonly lines: readonly SceneLine[];
  readonly rushes: readonly SceneMoment[];
  readonly slips: readonly SceneSlip[];
  readonly notes: readonly SceneNote[];
  /** The notes the music asked for: see {@link RollDrawing.ghosts}. */
  readonly ghosts: readonly SceneRowed[];
  readonly bars: readonly SceneBar[];
  readonly pedal: readonly ScenePedal[];
}

/** A list in the order its marks begin, which a sort that keeps ties as they came leaves alone. */
function inTimeOrder<T extends SceneStretch>(marks: readonly T[]): T[] {
  return [...marks].sort((left, right) => left.fromMs - right.fromMs);
}

function momentsInTimeOrder<T extends { readonly atMs: number }>(marks: readonly T[]): T[] {
  return [...marks].sort((left, right) => left.atMs - right.atMs);
}

/**
 * The line a click leaves: heavy for a bar, plain for a beat, and a mark on the
 * ruler above as well - tall for a bar, short for a beat, shorter for what falls
 * between them.
 *
 * A bar line the reader gave late gets a line of its own kind: the metre's own
 * lines say where the beat was, and this one says where they put it, in the
 * colour of the head because like the head it is theirs rather than the music's.
 *
 * The ruler carried bar numbers and nothing else, so the metre could be read
 * off the grid below but not off the strip that exists to say where you are.
 * Marked from the same lines as the grid, so the two cannot disagree: a ruler
 * with a metre of its own would be a second answer to what the bar is.
 */
function lineOf(beat: GridLine, origin: number): SceneLine {
  return {
    atMs: beat.atMs - origin,
    kind: beat.given ? 'given' : beat.weight,
    says: beat.lateByMs === null ? null : `Given ${Math.round(beat.lateByMs)} ms late`,
  };
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
function rushOf(rush: RolledRush, origin: number): SceneMoment {
  return { atMs: rush.atMs - origin, says: `Taken ${Math.round(rush.byMs)} ms early` };
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
 */
function waitOf(wait: RolledWait, origin: number): SceneStretch {
  const held = wait.untilMs - wait.fromMs;
  return {
    fromMs: wait.fromMs - origin,
    untilMs: wait.untilMs - origin,
    says: `The music waited ${Math.round(held)} ms`,
  };
}

function noteOf(press: RolledPress, origin: number, high: number, endMs: number): SceneNote {
  const until = press.upAtMs ?? endMs;
  // What it was, for a finger on a cell. The deviation is the reason the view
  // exists, so it is said in milliseconds and signed: behind the beat is
  // positive, because that is the direction a reader falls.
  const off =
    press.deviationMs === null ? '' : ` · ${press.deviationMs > 0 ? '+' : ''}${Math.round(press.deviationMs)} ms`;
  return {
    fromMs: press.downAtMs - origin,
    untilMs: press.downAtMs - origin + Math.max(0, until - press.downAtMs),
    row: high - press.midi,
    shade: shadeOf(press),
    open: press.upAtMs === null,
    says: `${midiToLabel(press.midi)} · ${press.verdict ?? 'not judged'}${off}`,
  };
}

/** The head's two marks: its line over the grid, and its cap on the ruler. */
export interface RollHeads {
  readonly line: HTMLElement;
  readonly mark: HTMLElement;
}

/** The head's marks in a drawing, or `null` where nothing has been drawn. */
export function theHeadsOf(within: ParentNode): RollHeads | null {
  const line = within.querySelector<HTMLElement>('.roll__grid > .roll__head');
  const mark = within.querySelector<HTMLElement>('.roll__ruler > .roll__head-mark');
  return line === null || mark === null ? null : { line, mark };
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
 * Where the scroller has to stand for the head to keep its place in the view.
 *
 * The other way of following a performance - see below - moves the grid only
 * when the head has drifted out of it, which is steady to read at a walk and a
 * series of jumps at speed. This one holds the head still and moves the music,
 * the way falling notes do, so nothing on the screen moves but the music.
 *
 * `musicWidePx` is the view without the keys, which stand over the front of
 * it: a share of the whole would put a head asked to stand against the keys
 * underneath them. `standsAt` is how far across that width the head stands,
 * nought being against the keys.
 */
export function theRunScrolledUnderTheHead(
  headPx: number,
  musicWidePx: number,
  standsAt: number,
): number {
  return Math.max(0, Math.round(headPx - musicWidePx * standsAt));
}

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
 * How far a single turn of a wheel may move the zoom, as a ratio.
 *
 * A wheel notch and a trackpad flick arrive as wildly different numbers - tens
 * against ones - and a zoom taken straight from either jumps. Held to a small
 * step per message, a flick becomes a run of small steps instead, which is the
 * same gesture arriving smoothly.
 */
const ZOOM_STEP_MOST = 0.18;
/** How much of a wheel message counts towards that step. */
const ZOOM_PER_WHEEL_UNIT = 0.001;

/**
 * The ratio a wheel message is asking the zoom to move by.
 *
 * Grown rather than added to, so that a turn back undoes a turn: added, in and
 * then out by the same step lands a little below where it started, and a reader
 * rocking the wheel to settle on a size drifts downwards the whole time.
 */
export function zoomFromWheel(deltaPx: number): number {
  const asked = -deltaPx * ZOOM_PER_WHEEL_UNIT;
  return Math.exp(Math.min(ZOOM_STEP_MOST, Math.max(-ZOOM_STEP_MOST, asked)));
}

/**
 * The zoom a wheel message leaves, in whole pixels.
 *
 * A whole pixel at the least, whenever the wheel said anything at all. A
 * trackpad's finest message asks for a fraction of one, and rounded to the
 * nearest that is no change - so the gesture would do nothing at all rather
 * than a little, which is the one thing worse than doing too much.
 */
export function zoomAfterWheel(
  from: number,
  deltaPx: number,
  least: number,
  most: number,
): number {
  const ratio = zoomFromWheel(deltaPx);
  if (ratio === 1) {
    return from;
  }
  const asked = from * ratio;
  const moved =
    ratio > 1 ? Math.max(from + 1, Math.round(asked)) : Math.min(from - 1, Math.round(asked));
  return Math.min(most, Math.max(least, moved));
}

/**
 * Where to scroll so that a zoom leaves the music under a finger where it is.
 *
 * Without it a zoom moves everything the reader was looking at: they point at
 * the bar that went wrong, zoom in, and the bar slides off the screen - so the
 * gesture has to be followed by hunting for the place again, every time.
 *
 * Taken in the drawing's own coordinates rather than in music: the finger is at
 * a number of pixels across the view, that pixel stands over a moment, and the
 * moment has to come back under that pixel afterwards.
 */
export function scrollAfterZoom(
  scrolledToPx: number,
  fingerAtPx: number,
  fromWidePx: number,
  toWidePx: number,
): number {
  if (fromWidePx <= 0) {
    return scrolledToPx;
  }
  const share = (scrolledToPx + fingerAtPx) / fromWidePx;
  return Math.max(0, share * toWidePx - fingerAtPx);
}

/**
 * The bar the marker stands in, as a row of squares.
 *
 * What it is a picture *of*: where strict time has got to in this bar, drawn
 * over a picture of where the reader actually got to. The drawing itself is the
 * reader's time - it stretches wherever they waited - so a row counting in
 * written time beside it makes the gap between the two visible without anybody
 * having to measure anything. His: "квадратики які репрезентують кліки
 * метроному... та вони заповнюються із баром по клікам метроному".
 *
 * Counted from this bar's own downbeat rather than from the run's beginning,
 * which is his own second answer: "збивався кожного бару (починався з сильної
 * долі)". A metronome counting on from the top of a piece would be a bar or two
 * out by the middle of it and would say nothing about the bar in front of the
 * reader.
 */
export interface TheBarsSquares {
  /** How many clicks the bar holds. */
  readonly of: number;
  /** How many of them strict time has passed, at least one and never more. */
  readonly filled: number;
  /**
   * Strict time has left the bar behind while the reader has not.
   *
   * His: "якщо був зайвий вже клік - то всі квадратики замальовуються червоним
   * кольором". A click over is a whole click late, which on any reading is the
   * thing worth seeing rather than the fractions before it.
   */
  readonly overflowed: boolean;
}

/**
 * The squares for the moment the marker stands at.
 *
 * `null` where the run has no bar lines to count within - free playing, or a
 * moment in front of the first of them. Nothing was keeping that time, so there
 * is no strict count to hold it to.
 *
 * `clickMs` is the written length of one click, which is the one thing the roll
 * cannot know: it remembers when things happened, not how fast they were
 * supposed to.
 */
export function theSquaresOfTheBar(
  roll: RunRoll,
  atMs: number,
  clickMs: number,
  clicksInBar: number,
): TheBarsSquares | null {
  if (clickMs <= 0 || clicksInBar <= 0) {
    return null;
  }
  // How many clicks a bar holds is the metre's answer and not the run's: a run
  // stopped after one note still stopped inside a bar of four, and a row of one
  // square would be counting what was played rather than what was written.
  // Where the bar *began* is the run's answer, because that is a moment.
  // In the drawing's own time, like everything else laid against the marker: a
  // tap and a playback both give it as a distance from the run's left edge, and
  // the beats keep the page's clock. Compared as they come, a run that began a
  // few seconds into that clock had no squares at all until the playback had
  // run that far.
  const began = rollBeganAtMs(roll);
  let barBegan: number | null = null;
  for (const beat of roll.beats) {
    const at = beat.atMs - began;
    if (beat.weight === 'downbeat' && at <= atMs && at > (barBegan ?? -1)) {
      barBegan = at;
    }
  }
  if (barBegan === null) {
    return null;
  }
  // One at the downbeat itself, which is a click like any other: a bar of four
  // shows four squares and the first is filled the moment the bar begins.
  const gone = Math.floor((atMs - barBegan) / clickMs) + 1;
  return {
    of: clicksInBar,
    filled: Math.min(clicksInBar, Math.max(1, gone)),
    overflowed: gone > clicksInBar,
  };
}

/** One thing worth seeing on the map of a run, as shares of its whole length. */
export interface MapMark {
  readonly kind: 'wait' | 'rush';
  readonly fromShare: number;
  /** Nought for a rush, which is an instant rather than a stretch. */
  readonly widthShare: number;
}

/**
 * The whole run on one line: where it stood still, and where it was overtaken.
 *
 * Not the drawing made small. A run of a long piece is thousands of notes and
 * none of them is what the reader is hunting for when they scroll - they are
 * looking for the places they stopped, and a shrunken picture of the notes
 * would bury those under everything that went right. So the map draws only what
 * a scroll is a search for. His: "звичайним скролингом шукати секції де були
 * великі затупи - це складно... та самі сильні затупи по ідеї вже повинно бути
 * видно на minimap".
 *
 * Shares rather than pixels, because the strip is as wide as the sheet is and
 * nothing here knows that.
 */
export function theMapOfTheRun(roll: RunRoll): readonly MapMark[] {
  const marks: MapMark[] = [];
  for (const wait of theWaits(roll)) {
    const from = shareOfTheRun(roll, wait.fromMs);
    marks.push({
      kind: 'wait',
      fromShare: from,
      widthShare: shareOfTheRun(roll, wait.untilMs) - from,
    });
  }
  for (const rush of theRushes(roll)) {
    marks.push({ kind: 'rush', fromShare: shareOfTheRun(roll, rush.atMs), widthShare: 0 });
  }
  return marks;
}

/**
 * How far into the run a moment of it is, as a share of the whole.
 *
 * The one place that turns a moment into a place on the map, so the marks and
 * the marker standing among them cannot disagree about where anything is.
 *
 * There is always a whole to be a share of: a roll ends a moment past its last
 * event, so even one with nothing in it is a second of air long. A moment
 * outside it is held to the end it lies past rather than running off the strip.
 */
export function shareOfTheRun(roll: RunRoll, atMs: number): number {
  const began = rollBeganAtMs(roll);
  const across = rollEndedAtMs(roll) - began;
  return Math.min(1, Math.max(0, (atMs - began) / across));
}

/**
 * Which slice of the run is on the screen, as shares of the whole drawing.
 *
 * `null` where nothing has been laid out yet, the same answer and for the same
 * reason as {@link keepTheHeadInView}: a window on a drawing of no width is not
 * a window on anything, and drawing one would be a box claiming to show the
 * whole run at the moment the reader can see none of it.
 */
export function theWindowOnTheRun(
  scrolledToPx: number,
  viewWidePx: number,
  wholeWidePx: number,
): { readonly fromShare: number; readonly widthShare: number } | null {
  if (wholeWidePx <= 0 || viewWidePx <= 0) {
    return null;
  }
  const widthShare = Math.min(1, viewWidePx / wholeWidePx);
  const fromShare = Math.min(1 - widthShare, Math.max(0, scrolledToPx / wholeWidePx));
  return { fromShare, widthShare };
}

/**
 * Where to scroll so that the window sits under a finger on the map.
 *
 * Centred on the finger rather than started at it: a reader pointing at a stop
 * in the middle of the map means "show me that", and a view that began there
 * would put the thing they pointed at against its left edge with the run into
 * it out of sight.
 */
export function scrollForTheWindowAt(
  atShare: number,
  viewWidePx: number,
  wholeWidePx: number,
): number {
  const most = Math.max(0, wholeWidePx - viewWidePx);
  return Math.min(most, Math.max(0, atShare * wholeWidePx - viewWidePx / 2));
}

/** What a mark down the side says about its row: the colour its notes are drawn in. */
export type PitchMarkKind = 'wrong' | 'correct' | 'plain';

/** One row with a note on it, as shares of the band from its top. */
export interface PitchMark {
  readonly kind: PitchMarkKind;
  readonly fromShare: number;
  readonly heightShare: number;
}

/** A note in the drawing, reduced to its row and when it is there. */
export interface PitchedNote {
  readonly row: number;
  readonly fromMs: number;
  readonly untilMs: number;
  readonly kind: PitchMarkKind;
}

/**
 * Every note in the drawing by row and by time, worked out once a drawing.
 *
 * Once, because the map down the side is asked again on every frame a scroll or
 * a playback moves the view, and a run of a long piece is thousands of notes.
 * Where each of them lies in time is the expensive part, and it does not move.
 */
export interface RollPitches {
  /** How many rows the drawing has: the band {@link drawTheRoll} draws. */
  readonly rows: number;
  /** How long the run is, which is what a share of the view is a share of. */
  readonly lengthMs: number;
  readonly notes: readonly PitchedNote[];
}

/**
 * The notes of the drawing, placed as the drawing places them.
 *
 * The same band, the same notes asked for and the same colours, so that a
 * mark on the map and the note it stands for cannot disagree about either
 * where it is or what it was.
 */
export function thePitchesOfTheRun(
  roll: RunRoll,
  ghosts: readonly RollGhost[] = [],
): RollPitches {
  const origin = rollBeganAtMs(roll);
  const endMs = rollEndedAtMs(roll);
  const band = bandOf(roll.presses, ghosts);
  const notes: PitchedNote[] = roll.presses.map((press) => {
    const shade = shadeOf(press);
    return {
      row: band.high - press.midi,
      fromMs: press.downAtMs - origin,
      untilMs: (press.upAtMs ?? endMs) - origin,
      kind: shade === 'correct' || shade === 'wrong' ? shade : 'plain',
    };
  });
  for (const { ghost, from, until } of placedGhosts(roll, ghosts)) {
    notes.push({ row: band.high - ghost.midi, fromMs: from, untilMs: until, kind: 'plain' });
  }
  return { rows: band.high - band.low + 1, lengthMs: endMs - origin, notes };
}

/** Which colour a row takes where its notes differ: the fault, then the note played right. */
const HOW_TELLING: Readonly<Record<PitchMarkKind, number>> = { plain: 0, correct: 1, wrong: 2 };

/**
 * The rows with a note in the stretch of the run on the screen.
 *
 * Down the side of the drawing, and not a copy of the map under it. That one is
 * the whole run, because what a scroll along the run looks for is a place the
 * reader stopped. Up and down the question is another one: which of the notes
 * *here* are above or below the screen. So only the time the screen shows is
 * marked - every pitch of the run would fill the strip and say nothing about
 * the part being looked at. His: "щоб бачити які наразі ноти out of view", and
 * "існують для мене часто ноти які вилазять out of view".
 *
 * One mark a row, in the colour its notes are drawn in. Where they differ the
 * wrong note wins, because it is the one worth scrolling to.
 */
export function theMapOfThePitches(
  pitches: RollPitches,
  inView: { readonly fromShare: number; readonly widthShare: number },
): readonly PitchMark[] {
  const fromMs = inView.fromShare * pitches.lengthMs;
  const untilMs = (inView.fromShare + inView.widthShare) * pitches.lengthMs;
  const rows = new Map<number, PitchMarkKind>();
  for (const note of pitches.notes) {
    if (note.untilMs < fromMs || note.fromMs > untilMs) {
      continue;
    }
    const had = rows.get(note.row);
    if (had === undefined || HOW_TELLING[note.kind] > HOW_TELLING[had]) {
      rows.set(note.row, note.kind);
    }
  }
  return [...rows]
    .sort(([above], [below]) => above - below)
    .map(([row, kind]) => ({ kind, fromShare: row / pitches.rows, heightShare: 1 / pitches.rows }));
}

/** The marks of {@link theMapOfThePitches}, drawn. */
export function drawThePitchMap(marks: readonly PitchMark[]): HTMLElement {
  const map = element('div', 'roll-pitch-map__marks');
  for (const mark of marks) {
    const drawn = element('div', `roll-pitch-map__mark roll-pitch-map__mark--${mark.kind}`);
    drawn.style.top = `${(mark.fromShare * 100).toFixed(3)}%`;
    drawn.style.height = `${(mark.heightShare * 100).toFixed(3)}%`;
    map.append(drawn);
  }
  return map;
}

/** The marks of {@link theMapOfTheRun}, drawn. */
export function drawTheMap(roll: RunRoll): HTMLElement {
  const map = element('div', 'roll-map__marks');
  for (const mark of theMapOfTheRun(roll)) {
    const drawn = element('div', `roll-map__mark roll-map__mark--${mark.kind}`);
    drawn.style.left = `${(mark.fromShare * 100).toFixed(3)}%`;
    if (mark.kind === 'wait') {
      drawn.style.width = `${(mark.widthShare * 100).toFixed(3)}%`;
    }
    map.append(drawn);
  }
  return map;
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
function slipBetween(dueAt: number, playedAt: number, row: number): SceneSlip | null {
  const gap = playedAt - dueAt;
  if (Math.abs(gap) < SLIP_FLOOR_MS) {
    return null;
  }
  return {
    fromMs: Math.min(dueAt, playedAt),
    untilMs: Math.min(dueAt, playedAt) + Math.abs(gap),
    row,
    kind: gap > 0 ? 'late' : 'rushed',
    strength: Math.min(SLIP_MOST_SOLID, (Math.abs(gap) / SLIP_FULL_MS) * SLIP_MOST_SOLID),
    says: `${gap > 0 ? 'Late' : 'Rushed'} by ${Math.abs(Math.round(gap))} ms`,
  };
}

/**
 * Everything a run is drawn as, worked out once a drawing: see {@link RollScene}.
 *
 * The horizontal axis is real time and the lines are the moments clicks were
 * *heard*, not a grid computed from a tempo - so a bar the reader was held at
 * is simply a wider bar, and a piece that changes tempo cannot drift away from
 * its own drawing.
 */
export function theSceneOfTheRoll(drawing: RollDrawing): RollScene {
  const { roll } = drawing;
  const origin = rollBeganAtMs(roll);
  const endMs = rollEndedAtMs(roll);
  const ghosts = drawing.ghosts ?? [];
  const band = bandOf(roll.presses, ghosts);

  const blackRows: number[] = [];
  for (let midi = band.high; midi >= band.low; midi -= 1) {
    if (isBlack(midi)) {
      blackRows.push(band.high - midi);
    }
  }

  // One name per bar line, where it fell due rather than where it was given:
  // the number over the grid is the page's, and the page does not move.
  const bars: SceneBar[] = [];
  for (const beat of beatsWorthMarking(roll)) {
    // Whether a place in the music begins a bar is the namer's question, not
    // this one's; all the drawing knows is that a beat the reader gave is not a
    // second bar to be named.
    const name = beat.given ? null : drawing.barLabel(beat.positionTicks);
    if (name !== null) {
      bars.push({ atMs: beat.atMs - origin, name });
    }
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
  // Where each note the music asked for belongs, worked out once.
  const outlines = placedGhosts(roll, ghosts);
  const slips: SceneSlip[] = [];
  for (const { ghost, from } of outlines) {
    // Only where the right note was played at the wrong time. No press and the
    // outline says it alone; no note asked for and there is nothing to be off
    // from.
    const press = answered.get(`${ghost.stepIndex}:${ghost.midi}`);
    const slip =
      press === undefined || drawing.slips === false || drawing.keepsTime === false
        ? null
        : slipBetween(from, press.downAtMs - origin, band.high - ghost.midi);
    if (slip !== null) {
      slips.push(slip);
    }
  }

  return {
    highest: band.high,
    rows: band.high - band.low + 1,
    lengthMs: endMs - origin,
    blackRows,
    waits: inTimeOrder(theWaits(roll).map((wait) => waitOf(wait, origin))),
    // The same list a playback sounds its clicks from, so a line and a click
    // can never end up in different places - cut lines included.
    lines: momentsInTimeOrder(theGrid(roll, drawing.grid).map((beat) => lineOf(beat, origin))),
    rushes: momentsInTimeOrder(theRushes(roll).map((rush) => rushOf(rush, origin))),
    slips: inTimeOrder(slips),
    notes: inTimeOrder(roll.presses.map((press) => noteOf(press, origin, band.high, endMs))),
    ghosts: inTimeOrder(
      outlines.map(({ ghost, from, until }) => ({
        fromMs: from,
        untilMs: from + Math.max(0, until - from),
        row: band.high - ghost.midi,
        says: `${midiToLabel(ghost.midi)} · asked for here`,
      })),
    ),
    bars: momentsInTimeOrder(bars),
    pedal: inTimeOrder(
      roll.pedal.map((span) => ({
        fromMs: span.downAtMs - origin,
        untilMs: span.downAtMs - origin + Math.max(0, (span.upAtMs ?? endMs) - span.downAtMs),
        open: span.upAtMs === null,
        says: span.upAtMs === null ? 'Pedal, still down' : 'Pedal',
      })),
    ),
  };
}

/**
 * How far along a list sorted by where its marks begin each of them reaches.
 *
 * The furthest end of any mark up to and including each one, so that it never
 * goes backwards and can be searched: the first place it reaches a moment is
 * the first mark that might still be showing there. A note held for a minute
 * begins long before the screen does and is still on it, and a search on
 * beginnings alone would lose it.
 */
const reaches = new WeakMap<readonly SceneStretch[], Float64Array>();

function reachOf(marks: readonly SceneStretch[]): Float64Array {
  const known = reaches.get(marks);
  if (known !== undefined) {
    return known;
  }
  const reach = new Float64Array(marks.length);
  let furthest = Number.NEGATIVE_INFINITY;
  marks.forEach((mark, at) => {
    furthest = Math.max(furthest, mark.untilMs);
    reach[at] = furthest;
  });
  reaches.set(marks, reach);
  return reach;
}

/** The first place in a rising list that is at least `atLeast`, or its length. */
function firstFrom(length: number, valueAt: (at: number) => number, atLeast: number): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (valueAt(middle) < atLeast) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * The marks of a list that show between two moments of the run.
 *
 * Found rather than filtered: a run of a long piece is tens of thousands of
 * marks and a screen shows a few hundred of them, so walking the whole list on
 * every frame of a scroll was the cost of the drawing, whatever was on it.
 */
export function stretchesIn<T extends SceneStretch>(
  marks: readonly T[],
  fromMs: number,
  untilMs: number,
): T[] {
  const reach = reachOf(marks);
  const found: T[] = [];
  for (let at = firstFrom(marks.length, (each) => reach[each] ?? 0, fromMs); at < marks.length; at += 1) {
    const mark = marks[at];
    if (mark === undefined || mark.fromMs > untilMs) {
      break;
    }
    if (mark.untilMs >= fromMs) {
      found.push(mark);
    }
  }
  return found;
}

/** The marks of a list of instants that fall between two moments of the run. */
export function momentsIn<T extends { readonly atMs: number }>(
  marks: readonly T[],
  fromMs: number,
  untilMs: number,
): T[] {
  const found: T[] = [];
  for (let at = firstFrom(marks.length, (each) => marks[each]?.atMs ?? 0, fromMs); at < marks.length; at += 1) {
    const mark = marks[at];
    if (mark === undefined || mark.atMs > untilMs) {
      break;
    }
    found.push(mark);
  }
  return found;
}

/**
 * How near a pointer has to be to a line to be on it, in pixels.
 *
 * Lines are one and two pixels wide, which nobody can rest a pointer on; a
 * little either side is still unmistakably that line and nothing else.
 */
const POINTER_REACH_PX = 3;
/** And how narrow anything is drawn, however short: see `.roll__paint`. */
export const NARROWEST_PX = 2;

/**
 * What the grid says to a pointer resting on it, or `null` where nothing does.
 *
 * The topmost mark there that says anything, in the order they are painted -
 * except the notes the music asked for, which are painted over the presses so
 * they can be seen and must not take the pointer from them: what a finger on a
 * note is asking is what that note was *and* how far off the beat it came, and
 * the outline can answer only the first.
 */
export function whatTheGridSaysAt(
  scene: RollScene,
  atMs: number,
  row: number,
  pxPerSecond: number,
): string | null {
  const slackMs = (POINTER_REACH_PX / pxPerSecond) * 1000;
  const narrowestMs = (NARROWEST_PX / pxPerSecond) * 1000;
  const onRow = <T extends SceneRowed>(marks: readonly T[]): T | undefined =>
    stretchesIn(marks, atMs - narrowestMs, atMs)
      .filter(
        (mark) =>
          mark.row === row && Math.max(mark.untilMs, mark.fromMs + narrowestMs) >= atMs,
      )
      .at(-1);
  const near = <T extends SceneMoment>(marks: readonly T[]): T | undefined =>
    momentsIn(marks, atMs - slackMs, atMs + slackMs)
      .filter((mark) => mark.says !== null)
      .at(-1);
  return (
    onRow(scene.notes)?.says ??
    onRow(scene.slips)?.says ??
    near(scene.rushes)?.says ??
    near(scene.lines)?.says ??
    stretchesIn(scene.waits, atMs, atMs).at(-1)?.says ??
    null
  );
}

/** What the ruler says to a pointer resting on it: a bar line the reader gave late. */
export function whatTheRulerSaysAt(scene: RollScene, atMs: number, pxPerSecond: number): string | null {
  const slackMs = (POINTER_REACH_PX / pxPerSecond) * 1000;
  return (
    momentsIn(scene.lines, atMs - slackMs, atMs + slackMs)
      .filter((line) => line.says !== null)
      .at(-1)?.says ?? null
  );
}

/** What the pedal lane says to a pointer resting on it. */
export function whatThePedalSaysAt(scene: RollScene, atMs: number, pxPerSecond: number): string | null {
  const narrowestMs = (NARROWEST_PX / pxPerSecond) * 1000;
  return (
    stretchesIn(scene.pedal, atMs - narrowestMs, atMs)
      .filter((span) => Math.max(span.untilMs, span.fromMs + narrowestMs) >= atMs)
      .at(-1)?.says ?? null
  );
}

/** The row of pitch a distance down the grid falls in. */
export function rowFromTap(offsetPx: number, rowPx: number): number | null {
  return rowPx > 0 ? Math.floor(offsetPx / rowPx) : null;
}

/**
 * The frame a run is painted into: the keys, and three lanes for its tiles.
 *
 * One scroll container holding a ruler that sticks to the top, a column of
 * keys that sticks to the left, the grid, and a lane for the pedal. The run
 * was drawn into them as an element a mark, every one placed by the zoom: at
 * five thousand notes a zoom took most of a second a frame and opening the run
 * a second, because every mark of the run was laid out whether it was on the
 * screen or not. His, of Signal: "Як Signal MIDI аплікуха малює все без
 * підлагувань?" - by painting only what is on the screen. The lanes are
 * painted in tiles, near the screen and nowhere else: see `RollTiles`.
 *
 * Each lane is still an element the length of the run, so the scroller has
 * something to scroll and a tap has somewhere to land; the grid holds nothing
 * but its tiles and the head.
 */
export function drawTheRoll(scene: RollScene): HTMLElement {
  const view = element('div', 'roll');
  view.style.setProperty('--roll-rows', String(scene.rows));
  view.style.setProperty('--roll-length', atSecond(scene.lengthMs));

  const ruler = element('div', 'roll__ruler');
  // The head, marked on the strip that names the bars: its line is drawn in
  // the grid and stops where the ruler begins. His: "на ruler теж додати мітку
  // над курсором". Placed by the same custom property as the head, so it
  // follows without a line of its own.
  ruler.append(element('div', 'roll__tiles'), element('div', 'roll__head-mark'));

  const keys = element('div', 'roll__keys');
  for (let row = 0; row < scene.rows; row += 1) {
    const midi = scene.highest - row;
    const key = element('div', `roll__key${isBlack(midi) ? ' roll__key--black' : ''}`);
    key.style.top = atRow(row);
    // Named only where the name is worth the room: every C, so the eye has
    // somewhere to land, and the black keys by their shape alone.
    key.textContent = midi % 12 === 0 ? midiToLabel(midi) : '';
    keys.append(key);
  }

  const grid = element('div', 'roll__grid');
  // Where a playback has got to, moved by one custom property so following a
  // performance costs one write a frame rather than a redraw.
  grid.append(element('div', 'roll__tiles'), element('div', 'roll__head'));

  const pedal = element('div', 'roll__pedal');
  pedal.append(element('div', 'roll__tiles'));

  view.append(ruler, keys, grid, pedal);
  return view;
}

/** Where a drawing's three lanes hold their tiles, or `null` where nothing has been drawn. */
export function theLanesOf(within: ParentNode): RollLanes | null {
  const ruler = within.querySelector<HTMLElement>('.roll__ruler > .roll__tiles');
  const grid = within.querySelector<HTMLElement>('.roll__grid > .roll__tiles');
  const pedal = within.querySelector<HTMLElement>('.roll__pedal > .roll__tiles');
  return ruler === null || grid === null || pedal === null ? null : { ruler, grid, pedal };
}

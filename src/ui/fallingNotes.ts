import type { RuledMoment } from '../application/rhythmRuler.js';
import { isBlackKey, type KeyLight, type KeyPlace } from './replayKeys.js';
import { box, inksFrom, partlySeen, readied, type Surface } from './rollPainter.js';

/**
 * How far ahead the lane over the keyboard shows the music, in milliseconds
 * of it as heard.
 *
 * Long enough to see the next move of a hand coming, and short enough that
 * the notes do not crawl down the height of a screen.
 */
export const FALLING_AHEAD_MS = 3_000;

/** A note to fall onto its key: which key, from when to when, and lit how. */
export interface FallingNote {
  readonly midi: number;
  readonly fromMs: number;
  readonly untilMs: number;
  readonly shade: KeyLight;
}

/**
 * A note as the lane shows it, its ends as shares of the lane's height:
 * nought at the top, where the music comes in, and one at the keys.
 */
export interface LaneNote {
  readonly midi: number;
  readonly shade: KeyLight;
  readonly top: number;
  readonly bottom: number;
}

/**
 * Where each note stands in the lane at a moment.
 *
 * A note reaches its key at the moment it sounds and goes on into it for as
 * long as it lasts, so one sounding now stands on the keys with what is left
 * of it above them. Time runs down the lane at one speed - the lane is
 * `aheadMs` tall - so how far off a note is and how long it lasts are both
 * read as heights.
 */
export function theFallingNotes(
  notes: readonly FallingNote[],
  nowMs: number,
  aheadMs: number,
): readonly LaneNote[] {
  const bars: LaneNote[] = [];
  for (const note of notes) {
    const ends = inTheLane(note, nowMs, aheadMs);
    if (ends !== null) {
      bars.push({ midi: note.midi, shade: note.shade, ...ends });
    }
  }
  return bars;
}

/**
 * Where something lasting from one moment to another stands in the lane: its
 * top where it ends, its foot where it begins, cut to the lane - or `null`
 * where it is still above it, already past it, or lasts no time.
 */
function inTheLane(
  span: { readonly fromMs: number; readonly untilMs: number },
  nowMs: number,
  aheadMs: number,
): { readonly top: number; readonly bottom: number } | null {
  const at = (ms: number): number => 1 - (ms - nowMs) / aheadMs;
  const top = Math.max(0, at(span.untilMs));
  const bottom = Math.min(1, at(span.fromMs));
  return top >= bottom ? null : { top, bottom };
}

/**
 * A press of the pedal as the column over its mark shows it, as shares of its
 * height: `lift` where the pedal comes up and `foot` where it goes down. Not
 * cut to the column, since what is painted is its two ends: a foot gone down
 * past the mark is below one, and a lift still to come above the column is
 * below nought - endlessly, for a pedal never let up.
 */
export interface LanePedal {
  readonly lift: number;
  readonly foot: number;
}

/**
 * Where each press of the pedal stands over its mark at a moment, as a note
 * stands over its key: its foot reaching the mark as the pedal goes down, its
 * lift reaching it as it comes up. A press still above the column, or come up
 * already, is not there.
 */
export function theFallingPedal(
  presses: readonly { readonly fromMs: number; readonly untilMs: number }[],
  nowMs: number,
  aheadMs: number,
): readonly LanePedal[] {
  const at = (ms: number): number => 1 - (ms - nowMs) / aheadMs;
  const shown: LanePedal[] = [];
  for (const press of presses) {
    const lift = at(press.untilMs);
    const foot = at(press.fromMs);
    if (foot <= 0 || lift >= 1 || lift >= foot) {
      continue;
    }
    shown.push({ lift, foot });
  }
  return shown;
}

/** Where a bar of the music begins: the number printed over it, and when. */
export interface FallingBarLine {
  readonly label: string;
  readonly atMs: number;
}

/** A bar line as the lane shows it, at a share of its height from the top. */
export interface LaneBarLine {
  readonly label: string;
  readonly at: number;
}

/**
 * Where each bar line stands in the lane at a moment: in the time the notes
 * are in, so a line reaches the keys as the bar begins. One on the keys is
 * the bar beginning now; one at the very top has not come in yet.
 */
export function theFallingBarLines(
  lines: readonly FallingBarLine[],
  nowMs: number,
  aheadMs: number,
): readonly LaneBarLine[] {
  const shown: LaneBarLine[] = [];
  for (const line of lines) {
    const at = 1 - (line.atMs - nowMs) / aheadMs;
    if (at > 0 && at <= 1) {
      shown.push({ label: line.label, at });
    }
  }
  return shown;
}

/**
 * The colours of the lane: one for each way a key is lit, a note's edge and
 * a bar line - and the typeface the bar numbers are set in, which is the
 * page's.
 */
export type LaneInks = Readonly<Record<KeyLight | 'edge' | 'line', string>> & {
  readonly font: string;
};

/**
 * The stylesheet's names for them, which the keys are lit in as well: a note
 * and the key it lands on say the same thing.
 */
const LANE_INKS: Readonly<Record<keyof Omit<LaneInks, 'font'>, string>> = {
  perfect: '--keys-perfect',
  good: '--keys-good',
  wrong: '--keys-wrong',
  aside: '--keys-aside',
  heard: '--keys-heard',
  edge: '--keys-edge',
  line: '--keys-bar-line',
};

/** The lane's colours as they work out under the keyboard, on this ground. */
export function theLaneInks(keyboard: HTMLElement): LaneInks {
  const font = keyboard.ownerDocument.defaultView?.getComputedStyle(keyboard).fontFamily ?? '';
  return { ...inksFrom(keyboard, LANE_INKS), font: font === '' ? 'sans-serif' : font };
}

/** Room left between a note and the next key's, in page pixels. */
const GAP_PX = 1;
/** The least a note is drawn tall, so that the shortest still shows. */
/** A beat of the ruler, or a division of one, at a share of the lane's height. */
export interface LaneRuling {
  readonly weight: 'beat' | 'division';
  readonly at: number;
}

/**
 * Where each line of the ruler stands in the lane at a moment, in the time
 * the notes are in. A bar's own line is drawn across the lane already, so it
 * is not ruled again here.
 */
export function theFallingRuling(
  moments: readonly RuledMoment[],
  nowMs: number,
  aheadMs: number,
): readonly LaneRuling[] {
  const shown: LaneRuling[] = [];
  for (const moment of moments) {
    const at = 1 - (moment.atMs - nowMs) / aheadMs;
    if (moment.weight !== 'downbeat' && at > 0 && at <= 1) {
      shown.push({ weight: moment.weight, at });
    }
  }
  return shown;
}

/** Everything the lane shows at a moment. */
export interface LaneScene {
  readonly notes: readonly LaneNote[];
  readonly barLines: readonly LaneBarLine[];
  readonly ruling: readonly LaneRuling[];
}

const LEAST_TALL_PX = 2;
const CORNER_PX = 3;
/**
 * How far in from either edge of the lane a beat is ruled, and a division of
 * one: the ruler stands at the sides, out of the way of the notes, and a beat
 * is told from what lies between beats by its length.
 */
const RULED_PX: Readonly<Record<LaneRuling['weight'], number>> = { beat: 18, division: 9 };
const RULED_WEIGHT_PX: Readonly<Record<LaneRuling['weight'], number>> = { beat: 2, division: 1 };
/** How large a bar's number is set, and how far in from the lane's edge. */
const BAR_NUMBER_PX = 12;
const BAR_NUMBER_INSET_PX = 4;
/**
 * A bar line's dashes and weight. Broken, because under it lie the staff's
 * own lines, which are whole and run the same way.
 */
const BAR_LINE_DASHES = [6, 4];
const BAR_LINE_PX = 2;
/**
 * How far in from either side of its column a press of the pedal is drawn,
 * and how much each of its ends is taken in: a pedal lifted and pressed again
 * at one moment is two presses end to end, and is seen as two.
 */
const PEDAL_INSET_PX = 12;
const PEDAL_END_PX = 1;
/**
 * How much of a press is painted whole from each of its ends, and how far in
 * from that it fades away. A pedal is held for bars at a time, and a column
 * standing over the mark for all of it would say nothing the lit mark does
 * not; what is worth seeing coming is the moment it goes down and the moment
 * it comes up. A press shorter than both ends is seen whole, so a quick
 * change of pedal is seen as one.
 */
const PEDAL_SOLID_PX = 24;
const PEDAL_FADE_PX = 48;
const PEDAL_END_REACH_PX = PEDAL_SOLID_PX + PEDAL_FADE_PX;

/** How much of an end of a press is seen, so far in from it. */
function seenFromAnEnd(px: number): number {
  return Math.min(1, Math.max(0, 1 - (px - PEDAL_SOLID_PX) / PEDAL_FADE_PX));
}

/** A stretch of a press to paint, and how much of it is seen along it. */
interface PedalPiece {
  readonly fromPx: number;
  readonly untilPx: number;
  /** Rounded at its top, where that is the pedal coming up. */
  readonly roundTop: boolean;
  /** And at its foot, where that is the pedal going down. */
  readonly roundFoot: boolean;
  /** How much is seen, as stops from `fromPx` to `untilPx`. */
  readonly seen: readonly (readonly [number, number])[];
}

/**
 * Paints the pedal falling onto its mark: each press as a pill, in the ink a
 * key is lit as heard - the pedal is pressed, and nobody judged it - whole at
 * its two ends and faded between them, as a bracket. Its foot lands on the
 * mark as the pedal goes down and goes on down into it, out of sight; its
 * top lands as the pedal comes up. A long hold is seen going down, gone, and
 * then coming up.
 */
export function paintTheFallingPedal(
  surface: Surface,
  presses: readonly LanePedal[],
  inks: LaneInks,
  density: number,
): void {
  const ready = readied(surface, density);
  if (ready === null) {
    return;
  }
  const { paint, tallPx, widePx } = ready;
  const wide = Math.max(1, widePx - 2 * PEDAL_INSET_PX);
  for (const press of presses) {
    for (const piece of piecesOf(press, tallPx)) {
      const top = Math.max(piece.fromPx, 0);
      const foot = Math.min(piece.untilPx, tallPx);
      if (foot <= top) {
        continue;
      }
      const tall = foot - top;
      const round = Math.min(wide / 2, tall / 2);
      // An end is round where it is in the column; cut off by the column's
      // edge, or faded into the middle of a long press, it is square.
      const topRound = piece.roundTop && piece.fromPx >= 0 ? round : 0;
      const footRound = piece.roundFoot && piece.untilPx <= tallPx ? round : 0;
      box(paint, PEDAL_INSET_PX, top, wide, tall, [topRound, topRound, footRound, footRound]);
      paint.fillStyle = seenAlong(paint, piece, inks.heard);
      paint.fill();
      paint.strokeStyle = seenAlong(paint, piece, inks.edge);
      paint.lineWidth = 1;
      paint.stroke();
    }
  }
}

/**
 * What of a press is painted: the whole of it, where its two ends come close
 * enough for their fades to meet, and otherwise each end with its fade.
 */
function piecesOf(press: LanePedal, tallPx: number): readonly PedalPiece[] {
  const footPx = press.foot * tallPx - PEDAL_END_PX;
  const liftPx = Math.min(press.lift * tallPx + PEDAL_END_PX, footPx - LEAST_TALL_PX);
  const longPx = footPx - liftPx;
  if (longPx <= 2 * PEDAL_END_REACH_PX) {
    // Seen as the more of the two ends says at each place along it, which
    // changes only where one of them stops being whole or stops being seen.
    const along = [0, PEDAL_SOLID_PX, PEDAL_END_REACH_PX, longPx - PEDAL_END_REACH_PX, longPx - PEDAL_SOLID_PX, longPx]
      .filter((px) => px >= 0 && px <= longPx)
      .sort((left, right) => left - right);
    return [
      {
        fromPx: liftPx,
        untilPx: footPx,
        roundTop: true,
        roundFoot: true,
        seen: along.map((px) => [px / longPx, Math.max(seenFromAnEnd(px), seenFromAnEnd(longPx - px))] as const),
      },
    ];
  }
  const fading: readonly (readonly [number, number])[] = [
    [0, 1],
    [PEDAL_SOLID_PX / PEDAL_END_REACH_PX, 1],
    [1, 0],
  ];
  return [
    // The foot, fading upwards; and the top, fading down.
    {
      fromPx: footPx - PEDAL_END_REACH_PX,
      untilPx: footPx,
      roundTop: false,
      roundFoot: true,
      seen: fading.map(([at, seen]) => [1 - at, seen] as const).reverse(),
    },
    { fromPx: liftPx, untilPx: liftPx + PEDAL_END_REACH_PX, roundTop: true, roundFoot: false, seen: fading },
  ];
}

/** An ink seen along a piece of a press as much as its stops say. */
function seenAlong(paint: CanvasRenderingContext2D, piece: PedalPiece, ink: string): CanvasGradient {
  const along = paint.createLinearGradient(0, piece.fromPx, 0, piece.untilPx);
  for (const [at, seen] of piece.seen) {
    along.addColorStop(at, seen === 1 ? ink : partlySeen(ink, seen));
  }
  return along;
}

/**
 * Paints the notes falling onto the keys, and the bar lines among them.
 *
 * A bar line goes across the whole lane under the notes, broken so that it
 * is not taken for a line of the staff under it, with the number printed
 * over the bar on the page at its left: the notes coming can be found on the
 * score, the stretch above a line being the bar of that number. The beats
 * between, and the divisions of them, are ruled at the two sides alone, in
 * the grid the page is ruled in.
 *
 * Each over its own key and as wide as the key is drawn, and each edged, so
 * a note over the music stays a shape however busy the page under it is. The
 * black keys' notes go on last: a black key stands over the join of two
 * white ones, and so does its note. Painted whole - how much of the score
 * shows through is the stylesheet's, on the lane as a whole, so a note over
 * another does not show the one under it.
 */
export function paintTheLane(
  surface: Surface,
  scene: LaneScene,
  keys: ReadonlyMap<number, KeyPlace>,
  inks: LaneInks,
  density: number,
): void {
  const ready = readied(surface, density);
  if (ready === null) {
    return;
  }
  const { paint, tallPx, widePx, snap } = ready;
  paint.fillStyle = inks.line;
  paint.strokeStyle = inks.line;
  for (const line of scene.ruling) {
    const y = snap(line.at * tallPx) - RULED_WEIGHT_PX[line.weight] / 2;
    const reach = RULED_PX[line.weight];
    paint.fillRect(0, y, reach, RULED_WEIGHT_PX[line.weight]);
    paint.fillRect(widePx - reach, y, reach, RULED_WEIGHT_PX[line.weight]);
  }
  paint.lineWidth = BAR_LINE_PX;
  paint.font = `${String(BAR_NUMBER_PX)}px ${inks.font}`;
  paint.textBaseline = 'bottom';
  paint.setLineDash(BAR_LINE_DASHES);
  for (const line of scene.barLines) {
    const y = snap(line.at * tallPx) - BAR_LINE_PX / 2;
    paint.beginPath();
    paint.moveTo(0, y);
    paint.lineTo(widePx, y);
    paint.stroke();
    paint.fillText(line.label, BAR_NUMBER_INSET_PX, y - BAR_LINE_PX);
  }
  paint.setLineDash([]);
  const ordered = [
    ...scene.notes.filter((note) => !isBlackKey(note.midi)),
    ...scene.notes.filter((note) => isBlackKey(note.midi)),
  ];
  for (const note of ordered) {
    const key = keys.get(note.midi);
    if (key === undefined) {
      continue;
    }
    const tall = Math.max(LEAST_TALL_PX, (note.bottom - note.top) * tallPx);
    const top = Math.min(note.top * tallPx, tallPx - tall);
    const wide = Math.max(1, key.width - 2 * GAP_PX);
    box(paint, key.left + GAP_PX, top, wide, tall, Math.min(CORNER_PX, tall / 2, wide / 2));
    paint.fillStyle = inks[note.shade];
    paint.fill();
    paint.strokeStyle = inks.edge;
    paint.lineWidth = 1;
    paint.stroke();
  }
}

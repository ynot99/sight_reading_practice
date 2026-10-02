import type { RuledMoment } from '../application/rhythmRuler.js';
import { isBlackKey, type KeyLight, type KeyPlace } from './replayKeys.js';
import { box, inksFrom, readied, type Surface } from './rollPainter.js';

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
  const at = (ms: number): number => 1 - (ms - nowMs) / aheadMs;
  const bars: LaneNote[] = [];
  for (const note of notes) {
    const top = Math.max(0, at(note.untilMs));
    const bottom = Math.min(1, at(note.fromMs));
    // Cut to the lane, a note still above it or already past it has no
    // height left, and nor has one that lasts no time.
    if (top >= bottom) {
      continue;
    }
    bars.push({ midi: note.midi, shade: note.shade, top, bottom });
  }
  return bars;
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

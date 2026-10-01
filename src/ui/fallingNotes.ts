import { isBlackKey, type KeyLight, type KeyPlace } from './replayKeys.js';
import { box, inksFrom, readied, type Surface } from './rollPainter.js';

/**
 * How far ahead the lane over the keyboard shows the music, in milliseconds
 * of it as heard.
 *
 * Long enough to see the next move of a hand coming, short enough that a
 * quick note is still a block rather than a line on a lane a few fingers tall.
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
export interface FallingBar {
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
): readonly FallingBar[] {
  const at = (ms: number): number => 1 - (ms - nowMs) / aheadMs;
  const bars: FallingBar[] = [];
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

/** The colours of the lane: one for each way a key is lit, and the ground. */
export type LaneInks = Readonly<Record<KeyLight | 'ground', string>>;

/**
 * The stylesheet's names for them, which the keys are lit in as well: a note
 * and the key it lands on say the same thing.
 */
const LANE_INKS: LaneInks = {
  perfect: '--keys-perfect',
  good: '--keys-good',
  wrong: '--keys-wrong',
  aside: '--keys-aside',
  heard: '--keys-heard',
  ground: '--surface',
};

/** The lane's colours as they work out under the keyboard, on this ground. */
export function theLaneInks(keyboard: HTMLElement): LaneInks {
  return inksFrom(keyboard, LANE_INKS);
}

/** Room left between a note and the next key's, in page pixels. */
const GAP_PX = 1;
/** The least a note is drawn tall, so that the shortest still shows. */
const LEAST_TALL_PX = 2;
const CORNER_PX = 3;

/**
 * Paints the notes falling onto the keys.
 *
 * Each over its own key and as wide as the key is drawn. The black keys'
 * notes go on last, outlined in the ground: a black key stands over the join
 * of two white ones, and so does its note, which would otherwise run into
 * theirs.
 */
export function paintTheLane(
  surface: Surface,
  bars: readonly FallingBar[],
  keys: ReadonlyMap<number, KeyPlace>,
  inks: LaneInks,
  density: number,
): void {
  const ready = readied(surface, density);
  if (ready === null) {
    return;
  }
  const { paint, tallPx } = ready;
  const ordered = [
    ...bars.filter((bar) => !isBlackKey(bar.midi)),
    ...bars.filter((bar) => isBlackKey(bar.midi)),
  ];
  for (const bar of ordered) {
    const key = keys.get(bar.midi);
    if (key === undefined) {
      continue;
    }
    const tall = Math.max(LEAST_TALL_PX, (bar.bottom - bar.top) * tallPx);
    const top = Math.min(bar.top * tallPx, tallPx - tall);
    const wide = Math.max(1, key.width - 2 * GAP_PX);
    box(paint, key.left + GAP_PX, top, wide, tall, Math.min(CORNER_PX, tall / 2, wide / 2));
    paint.fillStyle = inks[bar.shade];
    paint.fill();
    if (isBlackKey(bar.midi)) {
      paint.strokeStyle = inks.ground;
      paint.lineWidth = 1;
      paint.stroke();
    }
  }
}

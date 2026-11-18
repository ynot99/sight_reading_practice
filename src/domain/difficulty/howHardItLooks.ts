import { barLines, elapsedMsAt, type Exercise } from '../model/Exercise.js';
import { buildTimeline, notesStruckAt } from '../timeline/Timeline.js';

/** The stretch the notes are counted over, and how far it moves along each time. */
const WINDOW_MS = 4_000;
const WINDOW_STEP_MS = 1_000;
/**
 * How much less each busy stretch counts than the one busier than it.
 *
 * The busiest places decide, not the average: a piece is as hard as its
 * hardest page, and a quiet introduction does not make the run after it any
 * easier. With each stretch counting nine tenths of the one before, about the
 * ten busiest carry the answer.
 */
const EACH_LESS = 0.9;

/**
 * How much the busiest places weigh against the length, in the raw measure.
 *
 * Fitted to fifty pieces a reader had judged by hand. Between them they
 * ordered those pieces as the reader had to a rank correlation of 0.85; how
 * many notes each hand has, how far they leap, how wide a chord stretches,
 * rhythms across the beat and the accidentals were each tried as well and
 * added nothing beyond these two - harder pieces have more of all of them.
 */
const BUSIEST_WEIGHT = 2.66;
const LENGTH_WEIGHT = 0.7;

/**
 * The raw measure read as stars, at twenty-one points: the same fifty
 * pieces, the raw measure at every twentieth of the way up them against the
 * reader's own stars at the same place.
 *
 * By rank and not by a straight line through them, because a line drew the
 * hardest pieces back towards the middle - a star and a third under the
 * reader, on average, on everything they had marked seven or more; read by
 * rank, half a star. Eleven points smoothed the top away again, and fifty
 * were no closer than twenty-one on a piece left out of the fitting. Read
 * across by rank, a piece busier than nine tenths of the others is given what
 * the reader gave the piece nine tenths of the way up.
 */
export const RAW_TO_STARS: readonly (readonly [raw: number, stars: number])[] = [
  [4.811, 1.2],
  [6.838, 2.5],
  [7.283, 2.79],
  [7.583, 3],
  [7.87, 3],
  [7.937, 3.55],
  [8.073, 3.8],
  [8.554, 4],
  [9.026, 4.12],
  [9.33, 4.31],
  [9.499, 4.7],
  [9.734, 4.79],
  [9.853, 5.08],
  [10.062, 5.49],
  [10.358, 5.83],
  [10.488, 6.17],
  [10.625, 6.4],
  [10.924, 6.99],
  [11.319, 8.08],
  [11.752, 8.96],
  [14.986, 10],
];

/** The most and the least the stars go to, and the precision they are given in. */
const HARDEST = 10;
const EASIEST = 1;

/**
 * How hard a piece looks from its notes, in stars from one to ten, or `null`
 * where it has none.
 *
 * A guess at the reader's own judgement from the two things that followed it
 * most closely: how many notes come in the busiest few seconds of the piece,
 * at its written tempo, and how long it is. It cannot know the reader's hands,
 * what they have played before, or that a fast piece made of one figure
 * repeated is easier than its notes say; so it is the answer where the
 * reader has given none, and theirs where they have.
 */
export function howHardItLooks(exercise: Exercise): number | null {
  const raw = theRawDifficulty(exercise);
  if (raw === null) {
    return null;
  }
  return theStarsForTheRaw(raw);
}

/**
 * The raw measure read as stars along `RAW_TO_STARS`: between two of its
 * points, along the line joining them; past the ends, along the end ones.
 * Then held inside one and ten, to a tenth.
 */
export function theStarsForTheRaw(raw: number): number {
  let below = 0;
  while (below < RAW_TO_STARS.length - 2 && raw > (RAW_TO_STARS[below + 1]?.[0] ?? Number.POSITIVE_INFINITY)) {
    below += 1;
  }
  const [rawLow, starsLow] = RAW_TO_STARS[below] ?? [0, EASIEST];
  const [rawHigh, starsHigh] = RAW_TO_STARS[below + 1] ?? [1, EASIEST];
  const across = starsLow + ((raw - rawLow) * (starsHigh - starsLow)) / (rawHigh - rawLow);
  return Math.round(Math.min(HARDEST, Math.max(EASIEST, across)) * 10) / 10;
}

/** The busiest places and the length in one number, before it is read as stars. */
export function theRawDifficulty(exercise: Exercise): number | null {
  const busiest = theBusiestPlaces(exercise);
  const bars = barLines(exercise).length;
  if (busiest === 0 || bars === 0) {
    return null;
  }
  return BUSIEST_WEIGHT * Math.log(busiest) + LENGTH_WEIGHT * Math.log(bars);
}

/**
 * Notes a second in the busiest stretches of the piece, the busiest counting
 * most: every stretch of four seconds, a second apart, its notes counted - a
 * chord is as many notes as it has keys, a tie one press - and the stretches
 * from the busiest down, each counting nine tenths of the one before.
 */
export function theBusiestPlaces(exercise: Exercise): number {
  const timeline = buildTimeline(exercise);
  const struck: { readonly atMs: number; readonly keys: number }[] = [];
  for (const step of timeline.steps) {
    const keys = notesStruckAt(step, null).length;
    if (keys > 0) {
      struck.push({ atMs: elapsedMsAt(exercise, step.onsetTicks), keys });
    }
  }
  const last = struck.at(-1);
  if (last === undefined) {
    return 0;
  }
  const stretches: number[] = [];
  let first = 0;
  let after = 0;
  let inside = 0;
  for (let from = 0; from <= last.atMs; from += WINDOW_STEP_MS) {
    while (after < struck.length && (struck[after]?.atMs ?? Number.POSITIVE_INFINITY) < from + WINDOW_MS) {
      inside += struck[after]?.keys ?? 0;
      after += 1;
    }
    while (first < after && (struck[first]?.atMs ?? Number.POSITIVE_INFINITY) < from) {
      inside -= struck[first]?.keys ?? 0;
      first += 1;
    }
    stretches.push(inside / (WINDOW_MS / 1000));
  }
  stretches.sort((left, right) => right - left);
  let total = 0;
  let weight = 1 - EACH_LESS;
  for (const notesASecond of stretches) {
    total += notesASecond * weight;
    weight *= EACH_LESS;
  }
  return total;
}

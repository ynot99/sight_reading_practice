import type { PerformanceReport } from './PerformanceReport.js';

/**
 * One thing a reading is judged on, as a share of the best it could be.
 *
 * A share and not a raw number, because the axes measure different things in
 * different units - milliseconds against a count of notes - and a shape drawn
 * from them can only be read if they agree about what "all the way out" means.
 */
export interface ProfileAxis {
  readonly name: string;
  /** Nought to one, where one is as well as it can be done. */
  readonly of: number;
  /** What the number behind it actually was, for the reader to see. */
  readonly said: string;
}

/**
 * The gap at which a reading stops being about timing at all.
 *
 * A quarter of a second is not "slightly behind"; it is a different beat. Held
 * against it rather than against a perfect nought, the axis says something at
 * every level of the ladder - against nought, a reader who is human reads as a
 * failure on every run they ever play.
 */
const TIMING_FLOOR_MS = 250;
/**
 * And the spread at which the hand stops being steady.
 *
 * Smaller than the floor above: a reader can be a long way behind the beat and
 * still be *even*, and evenness is the thing this axis is about. Landing a
 * tenth of a second either side of your own average is not a habit, it is
 * noise.
 */
const SPREAD_FLOOR_MS = 120;
/**
 * How uneven the reader's own pace may be before it stops being a pace.
 *
 * A share of that pace rather than a number of milliseconds, because in a frame
 * that waits there is no tempo but theirs: quarters taken at a leisurely two
 * seconds each are as steady as quarters at one, and a floor in milliseconds
 * would score the slower reading worse for being slower.
 *
 * One, meaning the axis empties only where the notes scatter as widely as the
 * pace itself. Half of that emptied it for a single hang in eight notes, which
 * is a reading with one hesitation in it rather than a reading with no pace.
 */
const PACE_SPREAD_SHARE = 1;

/**
 * How fast each note was taken, as a share of the length it was written at.
 *
 * Not the gaps themselves. A piece is not made of one value: a half note is
 * followed four times as slowly as an eighth, so a reading of real music scores
 * nought on evenness the moment evenness means "all the gaps alike". Measured on
 * a flawless reading of a half, an eighth and a quarter, it did. Against what
 * the music asked for, a reader holding one steady tempo comes out as one
 * number repeated, whatever the notes were.
 *
 * `owedAtMs` is where each judged entry falls in written time, in the order the
 * deviations are in. Where the two do not line up - nothing knew the music, or
 * the entries and the writing disagree about how many there were - the pace is
 * read off the gaps alone, which is right for a piece in one value and wrong in
 * the same way as before for anything else.
 */
function thePacesOf(
  deviations: readonly number[],
  owedAtMs: readonly number[],
): readonly number[] {
  const played = theGapsBetween(deviations);
  if (owedAtMs.length !== deviations.length) {
    return played;
  }
  const owed = theGapsBetween(owedAtMs);
  const paces: number[] = [];
  for (let at = 0; at < played.length; at += 1) {
    const written = owed[at] ?? 0;
    if (written > 0) {
      paces.push((played[at] ?? 0) / written);
    }
  }
  return paces;
}

/**
 * The gaps between one entry and the next, in the order they were played.
 *
 * Where the music waits, the deviations are not errors at all: nothing is
 * keeping time, so each is measured from the moment the run began and they come
 * back as a rising line - nought, a second, two seconds - however well the
 * reader played. Measured on a tidy reading of eight quarters at sixty they were
 * exactly that, and both axes drawn from them read as nought. What is in them is
 * the *difference* from one to the next, which is the reader's own pace.
 */
function theGapsBetween(deviations: readonly number[]): readonly number[] {
  const gaps: number[] = [];
  for (let at = 1; at < deviations.length; at += 1) {
    gaps.push((deviations[at] ?? 0) - (deviations[at - 1] ?? 0));
  }
  return gaps;
}

/**
 * How much longer than the notes either side of it a gap must be to be a hang.
 *
 * A share of the reader's own pace. Taken off the *range* instead - which is
 * what the velocity knocks are measured against, and rightly, since velocity has
 * ends of its own - a tight reading scored nought: wobbling ninety milliseconds
 * either way makes a range of a fifth of a second, and every note is then a long
 * way outside a fifth of that.
 */
const HANG_SHARE = 0.4;

/**
 * How few of the gaps stopped to find the next note, as a share.
 *
 * Only the long ones. A gap shorter than its neighbours is a reader getting on
 * with it, which is not a fault and is certainly not a micro-pause. His:
 * "відсутність мікропауз і «зависань» перед тактами".
 */
function theHangsIn(paces: readonly number[]): number {
  if (paces.length < 3) {
    return 0;
  }
  const held = paces.reduce((sum, pace) => sum + pace, 0) / paces.length;
  if (held <= 0) {
    return 0;
  }
  let hangs = 0;
  for (let at = 1; at + 1 < paces.length; at += 1) {
    const among = ((paces[at - 1] ?? 0) + (paces[at + 1] ?? 0)) / 2;
    if ((paces[at] ?? 0) - among > held * HANG_SHARE) {
      hangs += 1;
    }
  }
  return hangs;
}

function theFlowOf(paces: readonly number[]): number | null {
  if (paces.length < 3) {
    return null;
  }
  return Math.max(0, 1 - theHangsIn(paces) / (paces.length - 2));
}

/** How even a run of numbers is about its own average, as a share. */
function theSteadinessOf(values: readonly number[]): number | null {
  if (values.length < 2) {
    return null;
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (mean <= 0) {
    return null;
  }
  const spread = Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length,
  );
  return Math.max(0, 1 - spread / mean / PACE_SPREAD_SHARE);
}
/**
 * How far a press may sit from its neighbours before it counts as a knock.
 *
 * A share of the run's own loudness rather than a number of velocity units: a
 * reader playing quietly throughout has a smaller range for an accident to
 * happen in, and the same absolute jump means more there.
 */
const KNOCK_SHARE = 0.4;

function shareBelow(value: number, floor: number): number {
  if (!Number.isFinite(value) || floor <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, 1 - value / floor));
}

/**
 * How few of these leap away from the ones either side of them, as a share.
 *
 * Not how *level* they are. Asked of velocities, that is what he first wanted
 * and it would mark a reader down for playing musically: a piece with a
 * crescendo in it is supposed to come out uneven, and an axis rewarding a flat
 * velocity would give its best score to a machine. Asked of the gaps between
 * entries it would be worse still - it would score a reader on their tempo.
 *
 * What is a fault either way is the odd one that jumps: the finger that caught
 * the key too hard, and the hand that stopped to find the next note. His:
 * "плавність велоситі без випадкових ударів по клавішах", and "відсутність
 * мікропауз і «зависань» перед тактами".
 */
export function theEvenness(values: readonly number[]): number | null {
  const velocities = values;
  if (velocities.length < 3) {
    return null;
  }
  const most = Math.max(...velocities);
  const least = Math.min(...velocities);
  const range = most - least;
  if (range <= 0) {
    return 1;
  }
  let knocks = 0;
  for (let at = 1; at + 1 < velocities.length; at += 1) {
    const before = velocities[at - 1] ?? 0;
    const here = velocities[at] ?? 0;
    const after = velocities[at + 1] ?? 0;
    const among = (before + after) / 2;
    if (Math.abs(here - among) > range * KNOCK_SHARE) {
      knocks += 1;
    }
  }
  return Math.max(0, 1 - knocks / (velocities.length - 2));
}

/**
 * The two axes a frame that keeps time can answer.
 *
 * There the deviations are errors: something else held the beat and the reader
 * was near it or not. The mean says whether they run late as a habit, and the
 * spread says whether they are consistent about it, which are two questions.
 */
function theTimedAxes(timing: PerformanceReport['timing']): readonly ProfileAxis[] {
  return [
    {
      name: 'Timing',
      of: shareBelow(timing.meanAbsoluteDeviationMs, TIMING_FLOOR_MS),
      said: `${Math.round(timing.meanAbsoluteDeviationMs)} ms off the beat`,
    },
    {
      name: 'Stability',
      of: shareBelow(timing.deviationSpreadMs, SPREAD_FLOOR_MS),
      said: `${Math.round(timing.deviationSpreadMs)} ms either side`,
    },
  ];
}

/**
 * And the two a frame that waits can.
 *
 * Both off the reader's own pace, because there is no other: nothing keeps the
 * time, so how *fast* they went is their business and only how *evenly* is worth
 * marking. Flow counts the entries that stopped to find the next note; Stability
 * asks whether the pace held at all, as a share of itself rather than in
 * milliseconds - or a reading taken slowly would score worse for being slow.
 */
function theWaitingAxes(
  timing: PerformanceReport['timing'],
  owedAtMs: readonly number[],
): readonly ProfileAxis[] {
  const paces = thePacesOf(timing.deviations, owedAtMs);
  const held = paces.length === 0 ? 1 : paces.reduce((sum, pace) => sum + pace, 0) / paces.length;
  const flow = theFlowOf(paces);
  const steady = theSteadinessOf(paces);
  return [
    {
      name: 'Flow',
      of: flow ?? 1,
      said: `${theHangsIn(paces)} of ${Math.max(0, paces.length - 2)} held up`,
    },
    {
      name: 'Stability',
      of: steady ?? 1,
      said:
        steady === null
          ? 'too few to say'
          : `${Math.round(held * 100)}% of the written pace, evenly`,
    },
  ];
}

/**
 * The shape of a reading: what it was good at, and what it was not.
 *
 * Four axes and not the five he listed, because two of the five are one thing
 * wearing two hats. Measured: the same `meanAbsoluteDeviationMs` is how far
 * behind the beat a reader was where a machine kept the time, and how long they
 * took to arrive where the music waited for them. One number; which of the two
 * it means is decided by the frame, so the axis is *named* by the frame rather
 * than drawn twice.
 *
 * Every axis is a share of the best it could be, so the shape can be read at
 * all - and every one carries the number behind it, because a shape says which
 * way a reading leans and never what it was.
 */
export function theProfile(
  report: PerformanceReport,
  velocities: readonly number[],
  keepsTime: boolean,
  owedAtMs: readonly number[] = [],
): readonly ProfileAxis[] {
  const { totals, timing } = report;
  const owed = Math.max(1, totals.playableSteps);
  const evenness = theEvenness(velocities);
  const axes: ProfileAxis[] = [
    {
      name: 'Accuracy',
      of: Math.min(1, totals.correct / owed),
      said: `${totals.correct} of ${totals.playableSteps}`,
    },
    ...(keepsTime ? theTimedAxes(timing) : theWaitingAxes(timing, owedAtMs)),
  ];
  // Left off rather than drawn at nought where there is nothing to say: three
  // presses are not a hand to judge, and an axis pinned to the middle would
  // read as a fault rather than as a silence.
  if (evenness !== null) {
    axes.push({
      name: 'Dynamics',
      of: evenness,
      said: `${Math.round(evenness * 100)}% struck evenly`,
    });
  }
  return axes;
}

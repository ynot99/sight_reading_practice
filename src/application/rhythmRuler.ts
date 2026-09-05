import { barLines, type Exercise } from '../domain/model/Exercise.js';
import { Duration } from '../domain/model/Duration.js';
import type { ExerciseTimeline } from '../domain/timeline/Timeline.js';

/**
 * How finely the ruler is ruled, or `off` for no ruler at all.
 *
 * Named by note value rather than by a number, because that is what the
 * reader is counting in: "eighths" is a thing they say about a bar, and "8"
 * would have to be read as eighths of a bar in some metres and eighths of a
 * beat in others.
 */
export type RulerDivision =
  | 'off'
  | 'half'
  | 'quarter'
  | 'eighth'
  | 'sixteenth'
  | 'thirty-second';

export const RULER_DIVISIONS: readonly RulerDivision[] = [
  'off',
  'half',
  'quarter',
  'eighth',
  'sixteenth',
  'thirty-second',
];

const RULER_TICKS: Readonly<Record<Exclude<RulerDivision, 'off'>, number>> = {
  half: Duration.HALF.ticks,
  quarter: Duration.QUARTER.ticks,
  eighth: Duration.EIGHTH.ticks,
  sixteenth: Duration.SIXTEENTH.ticks,
  'thirty-second': Duration.SIXTEENTH.ticks / 2,
};

/**
 * The grid one ruling steps by, in divisions - nought for no ruler.
 *
 * The same number twice over: it is where the lines are drawn, and it is
 * where the invisible rests go that make the page even enough for them to be
 * worth drawing. Two grids would be two answers to one question.
 */
export function rulerStepTicks(division: RulerDivision): number {
  return division === 'off' ? 0 : RULER_TICKS[division];
}

/** What a ruled line is marking, which is how strongly it is drawn. */
export type RulerWeight = 'downbeat' | 'beat' | 'division';

/**
 * One line of the ruler, placed against the notes the engraver drew.
 *
 * Not an x and not a tick: a *place between two drawn steps*. The engraver
 * decides how wide a moment is - a bar of sixteenths against a held chord
 * does not put its third beat halfway across - so nothing above the drawing
 * can turn a moment into a position on the page. What can be said from here
 * is which two notes a moment falls between, and how far, and the renderer
 * knows where those two were drawn.
 *
 * A line that falls exactly on a drawn step says so by naming it twice, and
 * is then placed on that note precisely rather than reckoned at all. Every
 * line anybody actually plays on is one of those.
 */
export interface RulerMark {
  readonly fromStep: number;
  /**
   * The step on the far side, or `null` for the end of the bar.
   *
   * Nothing is reckoned across a bar line. The next note after the last one
   * of a bar is in the *next* bar, and between them stand the bar line, the
   * margin either side of it and whatever the next bar restates - room that
   * carries no time at all. Reckoned across it, the last division of a bar
   * came out past the bar line and into the bar after, which is where he saw
   * it. The bar's own right edge is the honest far side.
   */
  readonly toStep: number | null;
  /** Nought at `fromStep`, one at the far side. */
  readonly fraction: number;
  readonly weight: RulerWeight;
  /** The moment it stands for, which is what a marker running along it needs. */
  readonly ticks: number;
  /** The bar it is drawn in, whose right edge is the far side when there is no step. */
  readonly bar: number;
}

/**
 * The ruler for a piece: every division of every bar, in playing order.
 *
 * Bar by bar and from each bar's own start, because a bar is the unit the
 * reader counts in and the metre can change from one to the next. A division
 * that does not fit the bar - a half note ruled through 3/4 - simply runs out
 * at the bar line, which is the truth about it.
 */
export function rulerMarks(
  timeline: ExerciseTimeline,
  division: RulerDivision,
): readonly RulerMark[] {
  return rulerMarksBetween(timeline, division, 0, Number.POSITIVE_INFINITY);
}

/**
 * The ruler's lines over one stretch of the music, ends included at the front.
 *
 * What a marker running along the ruler needs, and it must be the *ruler's*
 * grid rather than the metronome's: they are two different questions and the
 * reader answers them separately - ruled in eighths while the click keeps the
 * beat is an ordinary thing to want, and the marker then skipped every line
 * the click had no opinion about.
 */
export function rulerMarksBetween(
  timeline: ExerciseTimeline,
  division: RulerDivision,
  fromTicks: number,
  untilTicks: number,
): readonly RulerMark[] {
  if (division === 'off') {
    return [];
  }
  const step = RULER_TICKS[division];
  const exercise: Exercise = timeline.exercise;
  const marks: RulerMark[] = [];
  const bars = barLines(exercise);
  for (const bar of bars) {
    const end = bar.startTicks + bar.timeSignature.ticksPerMeasure;
    if (end <= fromTicks) {
      continue;
    }
    if (bar.startTicks >= untilTicks) {
      break;
    }
    const pulse = bar.timeSignature.ticksPerPulse;
    for (let at = bar.startTicks; at < end; at += step) {
      if (at < fromTicks || at >= untilTicks) {
        continue;
      }
      const placed = placeInTheDrawing(timeline, at, end);
      if (placed === null) {
        continue;
      }
      const into = at - bar.startTicks;
      marks.push({
        ...placed,
        ticks: at,
        bar: bars.indexOf(bar),
        weight: into === 0 ? 'downbeat' : into % pulse === 0 ? 'beat' : 'division',
      });
    }
  }
  return marks;
}

/**
 * Where one moment of the music sits on the page, as a ruled line would.
 *
 * The same reckoning the ruler is drawn by, asked about a single moment: a
 * beat the run has just reached, so that a marker can stand on it.
 */
/**
 * Which two drawn steps a moment falls between, and how far along.
 *
 * `null` past the last one: there is nothing on the far side to reckon
 * against, and a line hung off the end of the music would be a guess with
 * nothing to check it.
 */
function placeInTheDrawing(
  timeline: ExerciseTimeline,
  ticks: number,
  barEndTicks: number,
): { fromStep: number; toStep: number | null; fraction: number } | null {
  const steps = timeline.steps;
  let before: number | null = null;
  for (const step of steps) {
    if (step.onsetTicks === ticks) {
      return { fromStep: step.index, toStep: step.index, fraction: 0 };
    }
    if (step.onsetTicks < ticks) {
      before = step.index;
      continue;
    }
    if (before === null) {
      return null;
    }
    const from = steps[before];
    if (from === undefined) {
      return null;
    }
    // Only where the far side is in this bar. Past the bar line the page
    // spends room on things that take no time, so the two cannot be reckoned
    // between - the bar's own edge stands in instead.
    // Strictly inside: a bar's end tick *is* the next bar's first, and the
    // note printed there is on the far side of the line.
    const inside = step.onsetTicks < barEndTicks;
    const span = (inside ? step.onsetTicks : barEndTicks) - from.onsetTicks;
    if (span <= 0) {
      return null;
    }
    return {
      fromStep: from.index,
      toStep: inside ? step.index : null,
      fraction: (ticks - from.onsetTicks) / span,
    };
  }
  // Past every step there is: the music has stopped but the bar has not, and
  // its own edge is all there is to reckon against.
  if (before === null) {
    return null;
  }
  const from = steps[before];
  const span = from === undefined ? 0 : barEndTicks - from.onsetTicks;
  return from === undefined || span <= 0
    ? null
    : { fromStep: from.index, toStep: null, fraction: (ticks - from.onsetTicks) / span };
}

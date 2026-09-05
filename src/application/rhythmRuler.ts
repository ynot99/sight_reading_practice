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
  readonly toStep: number;
  /** Nought at `fromStep`, one at `toStep`. */
  readonly fraction: number;
  readonly weight: RulerWeight;
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
  if (division === 'off') {
    return [];
  }
  const step = RULER_TICKS[division];
  const exercise: Exercise = timeline.exercise;
  const marks: RulerMark[] = [];
  for (const bar of barLines(exercise)) {
    const end = bar.startTicks + bar.timeSignature.ticksPerMeasure;
    const pulse = bar.timeSignature.ticksPerPulse;
    for (let at = bar.startTicks; at < end; at += step) {
      const placed = placeInTheDrawing(timeline, at);
      if (placed === null) {
        continue;
      }
      const into = at - bar.startTicks;
      marks.push({
        ...placed,
        weight: into === 0 ? 'downbeat' : into % pulse === 0 ? 'beat' : 'division',
      });
    }
  }
  return marks;
}

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
): { fromStep: number; toStep: number; fraction: number } | null {
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
    const span = step.onsetTicks - from.onsetTicks;
    return span <= 0
      ? null
      : {
          fromStep: from.index,
          toStep: step.index,
          fraction: (ticks - from.onsetTicks) / span,
        };
  }
  return null;
}

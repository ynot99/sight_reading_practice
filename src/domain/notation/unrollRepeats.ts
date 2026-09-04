import type {
  BarLabel,
  ClefChange,
  Exercise,
  KeyChange,
  PedalMark,
  TempoChange,
  TimeChange,
} from '../model/Exercise.js';
import {
  barNumberOf,
  clefAtMeasure,
  keyAtMeasure,
  measureCount,
  timeAtMeasure,
} from '../model/Exercise.js';

/** What the barlines of one written bar say about repeating. */
export interface BarRepeat {
  /** A forward repeat on its left barline: the span begins here. */
  readonly opens: boolean;
  /** A backward repeat on its right barline: the span ends here. */
  readonly closes: boolean;
  /** How many times the span is played in all; two unless the file says. */
  readonly times: number;
  /**
   * Which times through this bar belongs to, as a first or second ending.
   *
   * Empty for a bar that is played every time round, which is nearly all of
   * them.
   */
  readonly endings: readonly number[];
  /** The last bar of its ending: the bracket closes on its right barline. */
  readonly endsEnding: boolean;
}

export const NO_REPEAT: BarRepeat = {
  opens: false,
  closes: false,
  times: 2,
  endings: [],
  endsEnding: false,
};

/**
 * The order the bars are actually read in, following the repeat signs.
 *
 * A plain walk with one place to jump back to and a count of how many times
 * it has been taken. Endings are what makes it more than that: a bar marked
 * as the first ending is skipped on the second time round, and the reader
 * goes to the second ending instead - which is the whole reason the brackets
 * exist.
 *
 * Guarded against a file whose repeats contradict each other: a score cannot
 * be read more times through than it has bars, several times over, and a
 * reader is better served by music that stops than by a page that never
 * finishes being laid out.
 */
export function playedOrder(bars: readonly BarRepeat[]): readonly number[] {
  const order: number[] = [];
  const limit = Math.max(16, bars.length * 8);
  const jumps = new Map<number, number>();
  let at = 0;
  let openAt = 0;
  let pass = 1;

  while (at < bars.length && order.length < limit) {
    const bar = bars[at] ?? NO_REPEAT;
    if (bar.opens) {
      openAt = at;
    }
    if (bar.endings.length > 0 && !bar.endings.includes(pass)) {
      // Not this time round. Past the end of the bracket, which is where the
      // ending for this pass begins.
      at = endOfEnding(bars, at) + 1;
      continue;
    }
    order.push(at);
    if (bar.closes) {
      const made = jumps.get(at) ?? 0;
      if (made < Math.max(1, bar.times) - 1) {
        jumps.set(at, made + 1);
        pass += 1;
        at = openAt;
        continue;
      }
    }
    at += 1;
  }
  return order;
}

/** The last bar of the ending bracket that starts at `from`. */
function endOfEnding(bars: readonly BarRepeat[], from: number): number {
  for (let at = from; at < bars.length; at += 1) {
    if (bars[at]?.endsEnding === true) {
      return at;
    }
  }
  return from;
}

/**
 * Writes a repeated section out in full, in the order it is played.
 *
 * A repeat asks the reader to turn back, and everything this program draws
 * for them moves forward: the marker, the page, the veil over what is still
 * to come, the marks left where they played. Two readings of one printed page
 * would have to share all of it. Written out, the second reading has a page
 * of its own - and keeps the bar numbers of the first, so the score still
 * says where in the piece it is and still agrees with the file it came from.
 *
 * Everything positioned by bar moves with the music: a pedal in a repeated
 * bar is pressed on both readings, and a key or metre that changed inside the
 * span is stated again wherever the reading arrives at it from somewhere
 * else.
 */
export function unrollRepeats(exercise: Exercise, order: readonly number[]): Exercise {
  const written = measureCount(exercise);
  const plain = order.length === written && order.every((from, at) => from === at);
  if (plain) {
    return exercise;
  }

  const seen = new Set<number>();
  const barLabels: BarLabel[] = order.map((from) => {
    const repeated = seen.has(from);
    seen.add(from);
    return { number: barNumberOf(exercise, from), repeated };
  });

  const pedalMarks: PedalMark[] = [];
  const tempoChanges: TempoChange[] = [];
  order.forEach((from, at) => {
    for (const mark of exercise.pedalMarks) {
      if (mark.measureIndex === from) {
        pedalMarks.push({ ...mark, measureIndex: at });
      }
    }
    for (const change of exercise.tempoChanges) {
      if (change.measureIndex === from) {
        tempoChanges.push({ ...change, measureIndex: at });
      }
    }
  });

  // Stated wherever it becomes true, rather than carried over from the bar
  // before: a reading that jumps back arrives from somewhere else, and what
  // was in force there is not what is in force here.
  const keyChanges: KeyChange[] = [];
  const timeChanges: TimeChange[] = [];
  order.forEach((from, at) => {
    const previous = at === 0 ? null : (order[at - 1] ?? null);
    const key = keyAtMeasure(exercise, from);
    const time = timeAtMeasure(exercise, from);
    if (previous === null || !keyAtMeasure(exercise, previous).equals(key)) {
      if (at > 0 || !key.equals(exercise.key)) {
        keyChanges.push({ measureIndex: at, key });
      }
    }
    if (previous === null || timeAtMeasure(exercise, previous).toString() !== time.toString()) {
      if (at > 0 || time.toString() !== exercise.timeSignature.toString()) {
        timeChanges.push({ measureIndex: at, timeSignature: time });
      }
    }
  });

  return {
    ...exercise,
    barLabels,
    pedalMarks,
    tempoChanges,
    keyChanges,
    timeChanges,
    staves: exercise.staves.map((staff) => {
      const clefChanges: ClefChange[] = [];
      order.forEach((from, at) => {
        const previous = at === 0 ? null : (order[at - 1] ?? null);
        const clef = clefAtMeasure(staff, from);
        const before = previous === null ? staff.clef : clefAtMeasure(staff, previous);
        if (clef !== before) {
          clefChanges.push({ measureIndex: at, clef });
        }
      });
      return {
        ...staff,
        clefChanges,
        measures: order.map((from) => staff.measures[from] ?? { entries: [] }),
      };
    }),
  };
}

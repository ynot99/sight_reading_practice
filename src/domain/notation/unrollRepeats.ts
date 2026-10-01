import type {
  BarLabel,
  ClefChange,
  DynamicLevel,
  DynamicMark,
  Exercise,
  KeyChange,
  PedalMark,
  TempoChange,
  TempoWord,
  TimeChange,
} from '../model/Exercise.js';
import {
  barNumberOf,
  clefAfterMeasure,
  clefAtMeasure,
  keyAtMeasure,
  measureCount,
  theMarkThatGoverns,
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
 * bar is pressed on both readings, a dynamic or a word under it is read on
 * both, a line across bars - an octave sign, a hairpin - is drawn under every
 * reading of the bars it covers, and a key or metre that changed inside the
 * span is stated again wherever the reading arrives at it from somewhere
 * else. Left where the file put them, the marks under a repeated stretch
 * were read once: its second reading was played at whatever loudness the
 * first had ended on, and drawn with no octave sign over notes written an
 * octave from where they sound.
 *
 * And a bar read again is read as it was the first time. The loudness, the
 * speed and the pedal it was first read under are stated again where the
 * reading turns back to it, wherever the stretch has left them different -
 * so a stretch that ends louder than it began starts its second reading
 * where it started its first, as a reader turning back reads it. Stated as
 * marks of the page, as a key restated at a repeat is, so a score kept and
 * opened again reads the same.
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
  const dynamicMarks: DynamicMark[] = [];
  const tempoWords: TempoWord[] = [];
  const staffNumbers = [...new Set(exercise.staves.map((staff) => staff.staffNumber))];
  // How things stood as each bar was first read.
  const asFirstRead = new Map<number, InForce>();
  let standing: InForce = { dynamics: new Map(), tempoBpm: exercise.tempoBpm, pedalDown: null };
  order.forEach((from, at) => {
    const then = asFirstRead.get(from);
    if (then === undefined) {
      asFirstRead.set(from, standing);
    } else {
      standing = readAgainAsFirstRead(then, standing, at, staffNumbers, {
        dynamicMarks,
        tempoChanges,
        pedalMarks,
      });
    }
    const pedal = exercise.pedalMarks
      .filter((mark) => mark.measureIndex === from)
      .map((mark) => ({ ...mark, measureIndex: at }));
    const tempos = exercise.tempoChanges
      .filter((change) => change.measureIndex === from)
      .map((change) => ({ ...change, measureIndex: at }));
    const dynamics = exercise.dynamicMarks
      .filter((mark) => mark.measureIndex === from)
      .map((mark) => ({ ...mark, measureIndex: at }));
    pedalMarks.push(...pedal);
    tempoChanges.push(...tempos);
    dynamicMarks.push(...dynamics);
    for (const word of exercise.tempoWords) {
      if (word.measureIndex === from) {
        tempoWords.push({ ...word, measureIndex: at });
      }
    }
    standing = readOn(standing, dynamics, tempos, pedal);
  });
  const runs = runsOf(order);

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
    dynamicMarks,
    tempoWords,
    hairpins: spannedAcross(exercise, exercise.hairpins, runs),
    octaveShifts: spannedAcross(exercise, exercise.octaveShifts, runs),
    keyChanges,
    timeChanges,
    staves: exercise.staves.map((staff) => {
      const clefChanges: ClefChange[] = [];
      order.forEach((from, at) => {
        const previous = at === 0 ? null : (order[at - 1] ?? null);
        const inside = staff.clefChanges.filter((change) => change.measureIndex === from);
        // What the bar is read in as it opens, against what the bar before it
        // left behind: a re-read bar meets a different clef than it did the
        // first time round, so the change has to be stated again.
        const opening = clefAtMeasure(staff, from);
        const before = previous === null ? staff.clef : clefAfterMeasure(staff, previous);
        if (opening !== before && !inside.some((change) => change.offsetTicks === 0)) {
          clefChanges.push({ measureIndex: at, offsetTicks: 0, clef: opening });
        }
        // Then everything the writer put inside the bar, at its own place in
        // it - a hand crossing up for half a beat crosses up on every reading.
        for (const change of inside) {
          clefChanges.push({ measureIndex: at, offsetTicks: change.offsetTicks, clef: change.clef });
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

/** A stretch of the reading that is a stretch of the page. */
interface Run {
  /** Where it begins in the reading. */
  readonly at: number;
  /** And the bar of the file it begins with. */
  readonly from: number;
  readonly bars: number;
}

/**
 * The reading cut where it turns: bars read one after another as they are
 * written, from one turn back to the next.
 */
function runsOf(order: readonly number[]): readonly Run[] {
  const runs: Run[] = [];
  order.forEach((from, at) => {
    const last = runs.at(-1);
    if (last !== undefined && last.from + last.bars === from && last.at + last.bars === at) {
      runs[runs.length - 1] = { ...last, bars: last.bars + 1 };
      return;
    }
    runs.push({ at, from, bars: 1 });
  });
  return runs;
}

/** A mark drawn from one place to another. */
interface Spanning {
  readonly measureIndex: number;
  readonly offsetTicks: number;
  readonly untilMeasureIndex: number;
  readonly untilOffsetTicks: number;
}

/**
 * Lines across bars, laid over every stretch of the reading that has the bars
 * they cover.
 *
 * Where a reading arrives in the middle of a line - turned back to a bar the
 * line passes through - the line is drawn again from that bar. Where a reading
 * turns back before the line ends, it ends at that bar line. A line ending
 * exactly where a reading arrives covers nothing of it.
 */
function spannedAcross<T extends Spanning>(
  exercise: Exercise,
  marks: readonly T[],
  runs: readonly Run[],
): T[] {
  const laid: T[] = [];
  for (const mark of marks) {
    for (const run of runs) {
      const first = Math.max(mark.measureIndex, run.from);
      const last = Math.min(mark.untilMeasureIndex, run.from + run.bars - 1);
      if (first > last) {
        continue;
      }
      const offsetTicks = first === mark.measureIndex ? mark.offsetTicks : 0;
      const untilOffsetTicks =
        last === mark.untilMeasureIndex
          ? mark.untilOffsetTicks
          : timeAtMeasure(exercise, last).ticksPerMeasure;
      if (first === last && offsetTicks >= untilOffsetTicks) {
        continue;
      }
      laid.push({
        ...mark,
        measureIndex: run.at + (first - run.from),
        offsetTicks,
        untilMeasureIndex: run.at + (last - run.from),
        untilOffsetTicks,
      });
    }
  }
  return laid.sort(
    (left, right) => left.measureIndex - right.measureIndex || left.offsetTicks - right.offsetTicks,
  );
}

/** The loudness, speed and pedal a reading is under at a bar line. */
interface InForce {
  /** The last mark of each staff, and of none, where the reading placed it. */
  readonly dynamics: ReadonlyMap<number | null, DynamicMark>;
  /** As written: the speeds worked out from words are worked out afterwards. */
  readonly tempoBpm: number;
  /** The mark that put the pedal down, while it is down. */
  readonly pedalDown: PedalMark | null;
}

/** How things stand once a bar's own marks have been read. */
function readOn(
  standing: InForce,
  dynamics: readonly DynamicMark[],
  tempos: readonly TempoChange[],
  pedal: readonly PedalMark[],
): InForce {
  const byOffset = (left: { offsetTicks: number }, right: { offsetTicks: number }): number =>
    left.offsetTicks - right.offsetTicks;
  const marks = new Map(standing.dynamics);
  for (const mark of [...dynamics].sort(byOffset)) {
    marks.set(mark.staffNumber, mark);
  }
  const written = tempos.filter((change) => change.implied !== true).sort(byOffset);
  // Paired as `pedalSpans` pairs them: a press while down changes nothing,
  // and a lift while up changes nothing.
  let pedalDown = standing.pedalDown;
  for (const mark of pedal) {
    pedalDown = mark.type === 'start' ? (pedalDown ?? mark) : null;
  }
  return {
    dynamics: marks,
    tempoBpm: written.at(-1)?.tempoBpm ?? standing.tempoBpm,
    pedalDown,
  };
}

/** How loud a staff is under them, by the rule the page is read by. */
function loudnessOf(
  dynamics: ReadonlyMap<number | null, DynamicMark>,
  staffNumber: number | null,
): DynamicLevel | null {
  const own = staffNumber === null ? null : (dynamics.get(staffNumber) ?? null);
  return theMarkThatGoverns(own, dynamics.get(null) ?? null)?.level ?? null;
}

/**
 * States again, at the start of a bar read once already, what it was first
 * read under - where the reading has left it otherwise.
 *
 * Every staff's mark is stated where any staff's loudness differs: a hand
 * marked on its own inside the stretch would otherwise keep its own level
 * beside a mark for every staff stated again.
 */
function readAgainAsFirstRead(
  then: InForce,
  now: InForce,
  at: number,
  staffNumbers: readonly number[],
  into: { dynamicMarks: DynamicMark[]; tempoChanges: TempoChange[]; pedalMarks: PedalMark[] },
): InForce {
  const dynamics = new Map(now.dynamics);
  // Every staff the page has, and any a mark names that it does not.
  const staves = new Set<number | null>([
    null,
    ...staffNumbers,
    ...then.dynamics.keys(),
    ...now.dynamics.keys(),
  ]);
  const otherwise = [...staves].some(
    (staff) => loudnessOf(then.dynamics, staff) !== loudnessOf(now.dynamics, staff),
  );
  if (otherwise) {
    for (const [staff, mark] of then.dynamics) {
      const stated = { ...mark, measureIndex: at, offsetTicks: 0 };
      into.dynamicMarks.push(stated);
      dynamics.set(staff, stated);
    }
  }
  if (then.tempoBpm !== now.tempoBpm) {
    into.tempoChanges.push({ measureIndex: at, offsetTicks: 0, tempoBpm: then.tempoBpm });
  }
  let pedalDown = now.pedalDown;
  if (then.pedalDown === null && now.pedalDown !== null) {
    into.pedalMarks.push({ ...now.pedalDown, measureIndex: at, offsetTicks: 0, type: 'stop' });
    pedalDown = null;
  } else if (then.pedalDown !== null && now.pedalDown === null) {
    pedalDown = { ...then.pedalDown, measureIndex: at, offsetTicks: 0 };
    into.pedalMarks.push(pedalDown);
  }
  return { dynamics, tempoBpm: then.tempoBpm, pedalDown };
}

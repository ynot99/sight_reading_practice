import { barLines, type Exercise, type TempoChange, type TempoWord } from '../model/Exercise.js';

/**
 * How many marks of speed in a row, each close after the one before, are a
 * gradual change written out rather than separate changes. Two are a change
 * and a change back; three going one way are a curve.
 */
export const MARKS_IN_A_RUN = 3;

/**
 * How far one mark of a run may step back against the way the run goes and
 * stay in it, in quarters a minute: the jitter of a curve drawn by hand in
 * the writer's program, which goes 120, 119.2, 118.5, 119.6, 118.8 on its
 * way down.
 */
export const A_STEP_BACK_AT_MOST_BPM = 2;

/** Where a change stands, in ticks from the beginning of the piece. */
function atTicks(exercise: Exercise, change: { readonly measureIndex: number; readonly offsetTicks: number }): number {
  return (barLines(exercise)[change.measureIndex]?.startTicks ?? 0) + change.offsetTicks;
}

/**
 * A piece with its gradual changes of speed printed as a word, not as a
 * number at every step.
 *
 * A writer's program plays an `accel.` or a `rit.` only if it is told the
 * speed at every step, so a file can carry hundreds of marks a tenth of a
 * beat a minute apart - hidden in the program it was written in, since the
 * format has no way to say so, and printed here one over every few notes.
 * A run of them - `MARKS_IN_A_RUN` or more, each within a bar of the one
 * before and going one way - is one change: the first mark and the one it
 * arrives at are printed, `accel.` or `rit.` is printed where it begins
 * unless the writer said so there, and every step between still sounds,
 * kept as `unprinted`.
 *
 * A mark under `a tempo` puts the speed back, and begins anything after it
 * rather than ending what came before: a `rit.` down to a pause and `a
 * tempo` straight after are not one climb.
 *
 * Found among every mark, those read to the same whole number as the one
 * before among them: a tenth of a beat a minute at a time, most steps are.
 * Only then does a mark saying the speed already in force go, being no
 * change at all.
 */
export function withTempoStepsAsWords(exercise: Exercise): Exercise {
  const ordered = [...exercise.tempoChanges].sort((one, other) => atTicks(exercise, one) - atTicks(exercise, other));
  const written = ordered.filter((change) => change.implied !== true && change.unprinted !== true);
  const putBack = theMarksPutBack(exercise, written);
  const unprinted = new Set<TempoChange>();
  const words: TempoWord[] = [];
  let from = 0;
  while (from < written.length - 1) {
    const first = written[from];
    const until = whereTheRunEnds(exercise, written, from, putBack);
    const last = written[until];
    if (first === undefined || last === undefined || until - from + 1 < MARKS_IN_A_RUN || last.tempoBpm === first.tempoBpm) {
      from += 1;
      continue;
    }
    const arrives = whereItArrives(written, from, until);
    for (let between = from + 1; between <= until; between += 1) {
      const step = written[between];
      if (step !== undefined && between !== arrives) {
        unprinted.add(step);
      }
    }
    const word = theWordForTheRun(exercise, first, last);
    if (word !== null) {
      words.push(word);
    }
    // Where one run arrives, the next may set off.
    from = until;
  }
  const kept = withoutWhatChangesNothing(exercise, ordered).map((change) =>
    unprinted.has(change) ? { ...change, unprinted: true as const } : change,
  );
  if (unprinted.size === 0 && words.length === 0 && kept.length === exercise.tempoChanges.length) {
    return exercise;
  }
  return {
    ...exercise,
    tempoChanges: kept,
    tempoWords: [...exercise.tempoWords, ...words].sort((one, other) => atTicks(exercise, one) - atTicks(exercise, other)),
  };
}

/** How long the bar a change stands in lasts. */
function theBarOf(exercise: Exercise, change: TempoChange): number {
  return barLines(exercise)[change.measureIndex]?.timeSignature.ticksPerMeasure ?? 0;
}

/**
 * The marks under `a tempo`, less than a beat after it: the speed put back on
 * purpose, which a run may set off from and never runs on into.
 */
function theMarksPutBack(exercise: Exercise, written: readonly TempoChange[]): ReadonlySet<TempoChange> {
  const bars = barLines(exercise);
  return new Set(
    written.filter((mark) => {
      const at = atTicks(exercise, mark);
      const beat = bars[mark.measureIndex]?.timeSignature.ticksPerPulse ?? 0;
      return exercise.tempoWords.some((word) => word.kind === 'a-tempo' && atTicks(exercise, word) <= at && at - atTicks(exercise, word) < beat);
    }),
  );
}

/**
 * The last mark of the run setting off from `from`: on while each is within
 * a bar of the one before and steps the way the first step that goes
 * anywhere went - or back no further than a curve jitters - and short of a
 * mark the speed is put back at.
 */
function whereTheRunEnds(
  exercise: Exercise,
  written: readonly TempoChange[],
  from: number,
  putBack: ReadonlySet<TempoChange>,
): number {
  let way = 0;
  let until = from;
  for (let next = from + 1; next < written.length; next += 1) {
    const before = written[next - 1];
    const mark = written[next];
    if (
      before === undefined ||
      mark === undefined ||
      putBack.has(mark) ||
      atTicks(exercise, mark) - atTicks(exercise, before) > theBarOf(exercise, before)
    ) {
      break;
    }
    const step = mark.tempoBpm - before.tempoBpm;
    if (way === 0) {
      way = Math.sign(step);
    } else if (Math.sign(step) === -way && Math.abs(step) > A_STEP_BACK_AT_MOST_BPM) {
      break;
    }
    until = next;
  }
  return until;
}

/**
 * Where a run arrives: at the first mark saying where it ends, those after
 * it saying the same - as steps read to the same whole number do - being no
 * change.
 */
function whereItArrives(written: readonly TempoChange[], from: number, until: number): number {
  const last = written[until]?.tempoBpm;
  let arrives = until;
  while (arrives - 1 > from && written[arrives - 1]?.tempoBpm === last) {
    arrives -= 1;
  }
  return arrives;
}

/**
 * `accel.` or `rit.` where a run sets off, which way it goes; or none where
 * the writer said so from a bar before it to where it arrives.
 */
function theWordForTheRun(exercise: Exercise, first: TempoChange, last: TempoChange): TempoWord | null {
  const kind = last.tempoBpm > first.tempoBpm ? 'accelerando' : 'ritardando';
  const begins = atTicks(exercise, first);
  const said = exercise.tempoWords.some((word) => {
    const at = atTicks(exercise, word);
    return word.kind === kind && at >= begins - theBarOf(exercise, first) && at <= atTicks(exercise, last);
  });
  return said
    ? null
    : { measureIndex: first.measureIndex, offsetTicks: first.offsetTicks, text: kind === 'accelerando' ? 'accel.' : 'rit.', kind };
}

/** The changes without a mark saying the speed already in force, by every change before it. */
function withoutWhatChangesNothing(exercise: Exercise, ordered: readonly TempoChange[]): readonly TempoChange[] {
  let inForce = exercise.tempoBpm;
  const kept: TempoChange[] = [];
  for (const change of ordered) {
    if (change.implied !== true && change.unprinted !== true && change.tempoBpm === inForce) {
      continue;
    }
    kept.push(change);
    inForce = change.tempoBpm;
  }
  return kept;
}

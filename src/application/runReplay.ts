import type { NoteVerdict } from '../domain/matching/ChordMatcher.js';
import { barLines } from '../domain/model/Exercise.js';
import type { BarStart } from './ExercisePlayer.js';
import type { RuledMoment, RulerMark } from './rhythmRuler.js';
import { landing, type NoteTier } from '../domain/scoring/noteTiers.js';
import type { ExerciseTimeline } from '../domain/timeline/Timeline.js';
import { playedNoteOffset } from './playedNoteOffset.js';
import type { PlayedNote } from './ports/IScoreRenderer.js';
import { rollBeganAtMs, theMusicsPlaceAt, type RunRoll } from './session/RunRoll.js';

/**
 * How a run was judged, which is how its marks are drawn again.
 *
 * The tempo it was played at, because a mark's offset is a share of the gap
 * to the next note and the gap is only a length in milliseconds at a tempo;
 * and whether the frame kept time, because where it did not, how long a note
 * took to find is not lateness.
 */
export interface ReplayJudging {
  readonly keepsTime: boolean;
  readonly tempoBpm: number;
}

/** A mark of the run, and when in it the key went down: the run's own nought. */
export interface ReplayMark {
  readonly atMs: number;
  readonly mark: PlayedNote;
}

/**
 * Whether a run's recording can be played back over this music.
 *
 * Every press it judged has to name a step the music has, or its mark would be
 * drawn on some other note - the piece was changed since, or this is another
 * piece of the same name. And there has to be something to see.
 */
export function replayFits(roll: RunRoll, timeline: ExerciseTimeline): boolean {
  const judged = roll.presses.filter((press) => press.stepIndex !== null);
  return (
    judged.length > 0 &&
    judged.every(
      (press) => press.stepIndex !== null && press.stepIndex >= 0 && press.stepIndex < timeline.length,
    )
  );
}

/**
 * Every mark the run left on the page, with the moment each was made.
 *
 * The same marks the run drew as it went, in the same colours: right or wrong
 * against the page, how well a right one landed, and how far off its beat.
 * All settled - the run is over, and every chord in it is as found as it was
 * ever going to be. A note struck again in a chord already collected drew
 * nothing then and draws nothing now; a press the run never judged has no step
 * to be drawn on.
 */
export function theMarksOfTheRun(
  roll: RunRoll,
  timeline: ExerciseTimeline,
  judging: ReplayJudging,
): readonly ReplayMark[] {
  const began = rollBeganAtMs(roll);
  const marks: ReplayMark[] = [];
  for (const press of roll.presses) {
    const { stepIndex, verdict } = press;
    if (stepIndex === null || verdict === null || verdict === 'duplicate') {
      continue;
    }
    const tier = tierOf(verdict, stepIndex, press.deviationMs, timeline, judging);
    marks.push({
      atMs: press.downAtMs - began,
      mark: {
        stepIndex,
        midi: press.midi,
        correct: verdict !== 'wrong',
        settled: true,
        offset: judging.keepsTime
          ? playedNoteOffset(timeline, stepIndex, press.deviationMs, judging.tempoBpm)
          : 0,
        ...(tier === undefined ? {} : { tier }),
      },
    });
  }
  return marks.sort((left, right) => left.atMs - right.atMs);
}

/**
 * How well a right key landed, as the run said at the time.
 *
 * Its own window where the frame kept time; where it did not, a right key is
 * simply right, and one pressed ahead of the hand being heard is Good.
 */
function tierOf(
  verdict: NoteVerdict,
  stepIndex: number,
  deviationMs: number | null,
  timeline: ExerciseTimeline,
  judging: ReplayJudging,
): NoteTier | undefined {
  if (verdict === 'rushed') {
    return 'good';
  }
  if (verdict !== 'correct' && verdict !== 'late') {
    return undefined;
  }
  if (!judging.keepsTime || deviationMs === null) {
    return 'perfect';
  }
  return landing(timeline, stepIndex, deviationMs).tier;
}

/**
 * The step the music was at, a moment into the run, or `null` before any.
 *
 * Off the beats where the run kept them, because they say where the music
 * was - through a note held, and at a gate standing still. A run that waited
 * on every note kept no beats, and there the music was wherever the reader
 * last played.
 */
export function theStepAt(roll: RunRoll, timeline: ExerciseTimeline, atMs: number): number | null {
  const began = rollBeganAtMs(roll);
  const ticks = theMusicsPlaceAt(roll, began + atMs);
  if (ticks !== null) {
    // The last step to have begun by then; the steps are in order, and this is
    // asked on every frame of a replay of a piece thousands of steps long.
    let low = 0;
    let high = timeline.length - 1;
    let found: number | null = null;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const step = timeline.at(middle);
      if (step !== null && step.onsetTicks <= ticks) {
        found = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return found;
  }
  let last: number | null = null;
  for (const press of roll.presses) {
    if (press.stepIndex !== null && press.downAtMs - began <= atMs) {
      last = press.stepIndex;
    }
  }
  return last;
}

/**
 * Every bar the run reached, once each, and when, on the run's own clock. A
 * bar outside the passage the run was of, or past where it stopped, is not
 * among them.
 *
 * `theStepAt` the other way round, and read off the same things so that the
 * two agree - the marker stands on a bar's first step at the moment given
 * here. The first beat that fell inside the bar where the run kept its beats;
 * a bar line given late is written down twice, and it is where it fell due
 * that the music got there. Where the run kept none, the first press made in
 * the bar, which is where the music was taken to be.
 *
 * Worked out once for a replay, and read by everything that asks where a bar
 * is in it: going to a bar held, and the bar lines falling onto the keys.
 */
export function theBarsOfTheRun(roll: RunRoll, timeline: ExerciseTimeline): readonly BarStart[] {
  const lines = barLines(timeline.exercise);
  const began = rollBeganAtMs(roll);
  const reached = new Map<number, number>();
  const reach = (measureIndex: number, atMs: number): void => {
    const known = reached.get(measureIndex);
    if (known === undefined || atMs < known) {
      reached.set(measureIndex, atMs);
    }
  };
  if (roll.beats.length > 0) {
    for (const beat of roll.beats) {
      const measureIndex = barOf(lines, beat.positionTicks);
      if (measureIndex !== null) {
        reach(measureIndex, beat.atMs - began);
      }
    }
  } else {
    for (const press of roll.presses) {
      const step = press.stepIndex === null ? null : timeline.at(press.stepIndex);
      if (step !== null) {
        reach(step.measureIndex, press.downAtMs - began);
      }
    }
  }
  return [...reached].map(([measureIndex, atMs]) => ({ measureIndex, atMs }));
}

/**
 * When the run reached each line of the ruler, on its own clock.
 *
 * Read off the run's beats, between two of which the music went at an even
 * pace: a line on a beat is where that beat fell, and a line between two is
 * that share of the way from the last moment the music stood at the one to
 * the first it was at the other - so a gate stood at holds the lines after
 * it back until the music went on, as it held the music. A run that kept no
 * beats had no pace to share out, and its lines are not guessed at.
 */
export function theRulingOfTheRun(roll: RunRoll, marks: readonly RulerMark[]): readonly RuledMoment[] {
  const began = rollBeganAtMs(roll);
  // Each place the music stood at: when it got there, and when it last was.
  const stood: { ticks: number; firstMs: number; lastMs: number }[] = [];
  for (const beat of [...roll.beats].sort((left, right) => left.atMs - right.atMs)) {
    const last = stood.at(-1);
    if (last !== undefined && beat.positionTicks <= last.ticks) {
      last.lastMs = Math.max(last.lastMs, beat.atMs);
      continue;
    }
    stood.push({ ticks: beat.positionTicks, firstMs: beat.atMs, lastMs: beat.atMs });
  }
  const ruled: RuledMoment[] = [];
  let at = 0;
  for (const mark of marks) {
    while ((stood[at + 1]?.ticks ?? Number.POSITIVE_INFINITY) <= mark.ticks) {
      at += 1;
    }
    const here = stood[at];
    if (here === undefined || here.ticks > mark.ticks) {
      continue;
    }
    if (here.ticks === mark.ticks) {
      ruled.push({ weight: mark.weight, atMs: here.firstMs - began });
      continue;
    }
    const next = stood[at + 1];
    if (next === undefined) {
      continue;
    }
    const share = (mark.ticks - here.ticks) / (next.ticks - here.ticks);
    ruled.push({ weight: mark.weight, atMs: here.lastMs + share * (next.firstMs - here.lastMs) - began });
  }
  return ruled;
}

/** The bar a place in the music falls in, found rather than walked to. */
function barOf(lines: readonly { readonly startTicks: number }[], ticks: number): number | null {
  let low = 0;
  let high = lines.length - 1;
  let found: number | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if ((lines[middle]?.startTicks ?? Number.POSITIVE_INFINITY) <= ticks) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

/** How a key is lit while it is down: the verdict its press was given. */
export type KeyShade = 'perfect' | 'good' | 'wrong' | 'aside';

/** A key the run pressed: when it was down, and how its press was judged. */
export interface ReplayedPress {
  readonly midi: number;
  /** When it went down, on the run's own clock. */
  readonly fromMs: number;
  /** When it came up - for ever, for a key still held when the run stopped. */
  readonly untilMs: number;
  readonly shade: KeyShade;
}

/**
 * Every key the run pressed, each in the colours its mark on the page is
 * drawn in, so a key and the ring it left say the same thing.
 *
 * A press nothing was decided about - struck while the music was elsewhere, a
 * note of a chord already collected, the hand being heard - is set aside: it
 * was played, and it was not a fault.
 *
 * Worked out once for a replay and read by everything that shows a press -
 * the key lit while it is down, and the note falling onto it before - which
 * have to agree on its colour and on its moments.
 */
export function thePressesOfTheRun(
  roll: RunRoll,
  timeline: ExerciseTimeline,
  judging: ReplayJudging,
): readonly ReplayedPress[] {
  const began = rollBeganAtMs(roll);
  return roll.presses.map((press) => ({
    midi: press.midi,
    fromMs: press.downAtMs - began,
    untilMs: press.upAtMs === null ? Number.POSITIVE_INFINITY : press.upAtMs - began,
    shade: shadeOf(press.verdict, press.stepIndex, press.deviationMs, timeline, judging),
  }));
}

/**
 * The keys down a moment into the run, each lit as its press was judged.
 *
 * Down from the moment the key went down until it came up, or until the end of
 * the run for one still held when it stopped.
 */
export function theKeysDownAt(
  presses: readonly ReplayedPress[],
  atMs: number,
): ReadonlyMap<number, KeyShade> {
  const down = new Map<number, KeyShade>();
  for (const press of presses) {
    if (press.fromMs <= atMs && atMs < press.untilMs) {
      down.set(press.midi, press.shade);
    }
  }
  return down;
}

/**
 * The presses down at some moment between two: those still held at the
 * first, and those that go down before the second.
 */
export function thePressesBetween(
  presses: readonly ReplayedPress[],
  fromMs: number,
  untilMs: number,
): readonly ReplayedPress[] {
  return presses.filter((press) => press.untilMs > fromMs && press.fromMs < untilMs);
}

function shadeOf(
  verdict: NoteVerdict | null,
  stepIndex: number | null,
  deviationMs: number | null,
  timeline: ExerciseTimeline,
  judging: ReplayJudging,
): KeyShade {
  if (verdict === 'wrong') {
    return 'wrong';
  }
  if (verdict === null || stepIndex === null) {
    return 'aside';
  }
  // A right key has a tier; the rest - a chord note struck again, the hand
  // being heard - have none, and were set aside.
  return tierOf(verdict, stepIndex, deviationMs, timeline, judging) ?? 'aside';
}

/** Whether the sustain pedal was down a moment into the run. */
export function thePedalDownAt(roll: RunRoll, atMs: number): boolean {
  const began = rollBeganAtMs(roll);
  return roll.pedal.some(
    (span) =>
      span.downAtMs - began <= atMs &&
      (span.upAtMs === null || atMs < span.upAtMs - began),
  );
}

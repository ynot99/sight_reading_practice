import type { Exercise } from '../../domain/model/Exercise.js';
import { barLines, tempoAtTick, tempoSpans } from '../../domain/model/Exercise.js';
import type { TimeSignature } from '../../domain/model/TimeSignature.js';
import type { ExerciseTimeline } from '../../domain/timeline/Timeline.js';
import {
  clicksPerPulse,
  type ClickPattern,
  type MetronomeBar,
  type MetronomeTempo,
} from '../ports/IMetronome.js';

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b > 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

function leastCommonMultiple(left: number, right: number): number {
  const divisor = greatestCommonDivisor(left, right);
  return divisor === 0 ? 0 : Math.abs(left * right) / divisor;
}

/**
 * Every bar the metronome will beat through, in its own clock.
 *
 * Its clock is not the music's: it starts at the first beat of the count-in
 * and the music arrives some bars later, and a run picked up from a pause
 * starts partway into the piece. So the music's bars are shifted onto that
 * clock, with the count-in laid out in front of them.
 *
 * The count-in is beaten in the metre the music is about to *begin* in,
 * which for a piece that changes metre is not the one it opened in - being
 * counted in four to music that starts in three is the worst possible way
 * to arrive.
 *
 * A run resuming in the middle of a bar keeps that bar's remainder in the
 * count-in's metre, since there is no bar line to hang a new one on until
 * the next one comes round.
 */
/** What a moment of the music is: the bar's start, a beat, or a part of one. */
export type BeatWeight = 'downbeat' | 'beat' | 'division';

/** A moment the click marks, and how much of a moment it is. */
export interface WrittenBeat {
  readonly ticks: number;
  readonly weight: BeatWeight;
}

/**
 * The beats falling strictly between two moments of the music.
 *
 * Read off the bar lines and the metre in force at each, because both change
 * partway through a piece: a beat is a share of *its own* bar, and 6/8 is
 * felt in two dotted quarters rather than six eighths.
 */
export function beatsBetween(
  exercise: Exercise,
  fromTicks: number,
  toTicks: number,
  pattern: ClickPattern = 'pulse',
): readonly WrittenBeat[] {
  const beats: WrittenBeat[] = [];
  for (const bar of barLines(exercise)) {
    const end = bar.startTicks + bar.timeSignature.ticksPerMeasure;
    if (end <= fromTicks) {
      continue;
    }
    if (bar.startTicks >= toTicks) {
      break;
    }
    for (const beat of beatsOf(bar.startTicks, bar.timeSignature, pattern)) {
      if (beat.ticks > fromTicks && beat.ticks < toTicks) {
        beats.push(beat);
      }
    }
  }
  return beats;
}

/**
 * One bar's worth of moments, at the resolution the pattern asks for.
 *
 * The pattern says how finely the beat is divided, so it says how finely the
 * bar is walked: a reader who asked to hear the subdivisions is asking for
 * them wherever the click sounds, and a click they place themselves is no
 * exception - which is what it had become, since only the felt beats were
 * ever offered to it.
 */
function beatsOf(
  startTicks: number,
  timeSignature: TimeSignature,
  pattern: ClickPattern,
): readonly WrittenBeat[] {
  const pulse = timeSignature.ticksPerPulse;
  const step = pulse / Math.max(1, clicksPerPulse(pattern, timeSignature));
  const beats: WrittenBeat[] = [];
  for (let at = startTicks; at < startTicks + timeSignature.ticksPerMeasure; at += step) {
    const into = at - startTicks;
    beats.push({
      ticks: at,
      weight: into === 0 ? 'downbeat' : into % pulse === 0 ? 'beat' : 'division',
    });
  }
  // Only the first of the bar, when that is all the reader asked to hear.
  return pattern === 'downbeat' ? beats.filter((beat) => beat.weight === 'downbeat') : beats;
}

/** The moment a tick falls on, or `null` where the click marks nothing there. */
export function beatAt(
  exercise: Exercise,
  ticks: number,
  pattern: ClickPattern = 'pulse',
): WrittenBeat | null {
  const bar = [...barLines(exercise)].reverse().find((each) => each.startTicks <= ticks);
  if (bar === undefined) {
    return null;
  }
  return (
    beatsOf(bar.startTicks, bar.timeSignature, pattern).find((beat) => beat.ticks === ticks) ?? null
  );
}

export function metronomeBars(
  exercise: Exercise,
  options: { readonly countInBars: number; readonly fromTicks: number },
): readonly MetronomeBar[] {
  const music = barLines(exercise);
  const startsIn =
    [...music].reverse().find((bar) => bar.startTicks <= options.fromTicks)?.timeSignature ??
    exercise.timeSignature;
  const countIn = Math.max(0, Math.round(options.countInBars));
  const bars: MetronomeBar[] = Array.from({ length: countIn }, (_, index) => ({
    startTicks: index * startsIn.ticksPerMeasure,
    timeSignature: startsIn,
  }));

  const musicStarts = countIn * startsIn.ticksPerMeasure;
  const shift = musicStarts - options.fromTicks;
  for (const bar of music) {
    if (bar.startTicks >= options.fromTicks) {
      bars.push({ startTicks: bar.startTicks + shift, timeSignature: bar.timeSignature });
    }
  }
  return bars;
}

/**
 * Every tempo the metronome will beat at, in its own clock.
 *
 * The same shift {@link metronomeBars} applies, for the same reason: the
 * count-in is beaten at the tempo the music is about to *start* at, not the
 * one the piece opened in - being counted in at a Lento to music that begins
 * Presto is as useless as being counted in four to music that starts in
 * three.
 */
export function metronomeTempos(
  exercise: Exercise,
  options: { readonly countInBars: number; readonly fromTicks: number },
): readonly MetronomeTempo[] {
  const music = barLines(exercise);
  const startsIn =
    [...music].reverse().find((bar) => bar.startTicks <= options.fromTicks)?.timeSignature ??
    exercise.timeSignature;
  const countIn = Math.max(0, Math.round(options.countInBars));
  const shift = countIn * startsIn.ticksPerMeasure - options.fromTicks;

  const tempos: MetronomeTempo[] = [
    { startTicks: 0, bpm: tempoAtTick(exercise, options.fromTicks) },
  ];
  for (const span of tempoSpans(exercise)) {
    if (span.startTicks > options.fromTicks) {
      tempos.push({ startTicks: span.startTicks + shift, bpm: span.tempoBpm });
    }
  }
  return tempos;
}

/**
 * Where the music ends, on the metronome's clock.
 *
 * The same shift again. A run's end is not the piece's: a passage stops at
 * its own last note while the bars go on to the end of the score, so this is
 * the one thing that says where the click has nothing left to mark.
 */
export function metronomeEnd(
  exercise: Exercise,
  options: {
    readonly countInBars: number;
    readonly fromTicks: number;
    readonly untilTicks: number;
  },
): number {
  const music = barLines(exercise);
  const startsIn =
    [...music].reverse().find((bar) => bar.startTicks <= options.fromTicks)?.timeSignature ??
    exercise.timeSignature;
  const countIn = Math.max(0, Math.round(options.countInBars));
  return options.untilTicks + countIn * startsIn.ticksPerMeasure - options.fromTicks;
}

/**
 * Finest grid the music actually lands on, as ticks.
 *
 * Every step onset and length is an exact number of divisions, so their
 * greatest common divisor is the coarsest tick that can still land on all of
 * them. Deriving it beats guessing a constant: sixteenths need four ticks per
 * beat, dotted values need eight, and triplets - when they arrive - will need
 * twelve without anyone having to remember to change a default.
 */
export function musicalResolutionTicks(
  timeline: ExerciseTimeline,
  timeSignature: TimeSignature,
): number {
  let divisor = timeSignature.ticksPerPulse;
  // Every metre the piece passes through, not only the one it opened in: the
  // grid has to land on the beats of all of them, or the click stops falling
  // on the beat the moment the metre changes.
  for (const bar of barLines(timeline.exercise)) {
    divisor = greatestCommonDivisor(divisor, bar.timeSignature.ticksPerPulse);
  }
  for (const step of timeline.steps) {
    divisor = greatestCommonDivisor(divisor, step.onsetTicks);
    divisor = greatestCommonDivisor(divisor, step.durationTicks);
  }
  return divisor > 0 ? divisor : timeSignature.ticksPerPulse;
}

/**
 * Ticks per felt beat for a run.
 *
 * Two independent demands meet here: the music has to be resolvable, and the
 * chosen click has to be soundable. Taking the lowest common multiple honours
 * both without letting either dictate the other - which is the whole point of
 * separating the click from the loop.
 */
export function subdivisionsPerPulseFor(
  timeline: ExerciseTimeline,
  timeSignature: TimeSignature,
  click: ClickPattern,
): number {
  const fromMusic = timeSignature.ticksPerPulse / musicalResolutionTicks(timeline, timeSignature);
  const fromClick = clicksPerPulse(click, timeSignature);
  const wanted = Math.max(1, leastCommonMultiple(fromMusic, fromClick));
  if (wanted <= MAX_SUBDIVISIONS_PER_PULSE) {
    return wanted;
  }
  // Every metre the piece passes through, for the same reason
  // `musicalResolutionTicks` walks them all: a grid that lands on the opening
  // metre's beats and no others stops clicking on the beat the moment the
  // metre changes.
  const pulses = new Set(
    barLines(timeline.exercise).map((bar) => bar.timeSignature.ticksPerPulse),
  );
  pulses.add(timeSignature.ticksPerPulse);
  return coarsestGridWithin(timeSignature.ticksPerPulse, fromClick, [...pulses]);
}

/**
 * As fine as the loop is ever run, whatever the music asks for.
 *
 * Landing exactly on every onset is what {@link musicalResolutionTicks} is
 * for, and on ordinary music it costs nothing: a piece of sixteenths and
 * triplets wants twelve ticks to the beat. But the divisor collapses when a
 * piece mixes tuplets that share no factor - senbonzakura has fives, sixes,
 * sevens and thirty-seconds together, and asked for eight hundred and forty
 * ticks a beat, two thousand a second. The whole practice loop runs on each
 * one, so the page stopped answering at all: not a stutter, a reader unable
 * to tell whether their own stop button had registered.
 *
 * Forty-eight to the beat is finer than a sixty-fourth triplet, which is
 * finer than anything that can be written. What it costs is that a step may
 * open up to one subdivision late - at a hundred beats a minute, twelve
 * milliseconds, against a matching tolerance measured in hundreds. What it
 * buys is a loop that runs at a rate a tablet can keep up with, on any music
 * at all. The modes already expect it: a tick may span several steps, and
 * they walk to the one the position has reached.
 */
const MAX_SUBDIVISIONS_PER_PULSE = 48;

/**
 * The finest grid within the ceiling that still divides the beat exactly.
 *
 * Exactly, because positions are counted in whole divisions - a grid that
 * did not divide the pulse would put every tick a fraction further out of
 * step with the bar lines. Every metre's pulse, not only the opening one, or
 * the click stops landing on the beat where the metre changes. And a multiple
 * of what the click needs, because the click has to keep landing on the beat
 * it names; that is the one demand here that a reader would hear being broken.
 */
function coarsestGridWithin(
  ticksPerPulse: number,
  fromClick: number,
  pulses: readonly number[],
): number {
  const clicks = Math.max(1, fromClick);
  let best = clicks;
  for (let grid = clicks; grid <= MAX_SUBDIVISIONS_PER_PULSE; grid += clicks) {
    if (ticksPerPulse % grid !== 0) {
      continue;
    }
    const step = ticksPerPulse / grid;
    if (pulses.every((pulse) => pulse % step === 0)) {
      best = grid;
    }
  }
  return best;
}

/**
 * The same stretch of plan laid end to end, for a passage played round again.
 *
 * A repeat used to be a whole new performance: the metronome was stopped and
 * started, which re-anchors it to the audio clock a fixed lead ahead of now,
 * and everything the restart had to do first was silence added in front of
 * the music. Played round *inside* one performance the pulse never stops, and
 * there is no gap at all - but then the plan has to repeat with the music,
 * because the metronome reads its bars and its tempos off a clock that only
 * ever goes forward.
 *
 * Only the passage's own entries are tiled. What follows it in the piece is
 * not what comes next when it plays again, and left in, a passage of two 4/4
 * bars followed by a bar of 3/4 was accented as 3/4 on its second reading.
 * The tempo is re-stated at the head of every lap for the same reason: the
 * music starts again, so the tempo it starts at does too.
 */
export function laidEndToEnd<T extends { readonly startTicks: number }>(
  plan: readonly T[],
  lapTicks: number,
  laps: number,
  fromLap = 0,
): T[] {
  if (lapTicks <= 0) {
    return [...plan];
  }
  const own = plan.filter((entry) => entry.startTicks < lapTicks);
  const tiled: T[] = [];
  for (let lap = fromLap; lap < fromLap + laps; lap += 1) {
    for (const entry of own) {
      tiled.push({ ...entry, startTicks: entry.startTicks + lap * lapTicks });
    }
  }
  return tiled;
}

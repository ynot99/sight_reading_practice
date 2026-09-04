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
  return coarsestGridWithin(timeSignature.ticksPerPulse, fromClick);
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
 * step with the bar lines. And a multiple of what the click needs, because
 * the click has to keep landing on the beat it names; that is the one demand
 * here that a reader would hear being broken.
 */
function coarsestGridWithin(ticksPerPulse: number, fromClick: number): number {
  const clicks = Math.max(1, fromClick);
  let best = clicks;
  for (let grid = clicks; grid <= MAX_SUBDIVISIONS_PER_PULSE; grid += clicks) {
    if (ticksPerPulse % grid === 0) {
      best = grid;
    }
  }
  return best;
}

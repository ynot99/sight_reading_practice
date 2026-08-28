import { DomainError } from '../../shared/errors.js';
import { Duration, NOTE_TYPES } from '../model/Duration.js';
import type { TimeSignature } from '../model/TimeSignature.js';
import type { Rng, WeightedItem } from './Rng.js';

export interface WeightedDuration extends WeightedItem<Duration> {
  /**
   * How many copies to emit in a row when this value is drawn.
   *
   * Short values are only readable in groups: `repeat: 2` on a sixteenth is
   * the difference between a beamed pair and a lone sixteenth stranded
   * between two eighths. The group is all-or-nothing - a value is only
   * offered where every copy fits inside the beat - so the grid rule still
   * wins and the pair is never split.
   */
  readonly repeat?: number;
}

export interface RhythmOptions {
  /** Pool the filler samples from. Weights need not be normalised. */
  readonly durations: readonly WeightedDuration[];
  /** Chance that an eligible slot becomes a rest instead of a note. */
  readonly restProbability: number;
  /**
   * Keep values from straddling beats unless they start on one. This is what
   * separates readable sight-reading material from unreadable syncopation.
   */
  readonly keepInsideBeats: boolean;
  /**
   * Chance that a value is allowed to start off the beat and hold across it.
   *
   * Everything else this filler writes sits inside its beat, which is what
   * makes it readable and also its ceiling: real music crosses beats
   * constantly, and a note that begins off one is the commonest place a
   * reader falls apart. Crossing values are split at the boundary and tied,
   * because that is how they are written and how they are counted.
   */
  readonly syncopation?: number;
}

export interface RhythmSlot {
  readonly duration: Duration;
  readonly isRest: boolean;
  /** Offset from the start of the measure, in divisions. */
  readonly onsetTicks: number;
  /** True when this slot is the front half of a note tied to the next. */
  readonly tiedForward: boolean;
}

/** Every notatable value, longest first: used to tile leftover space. */
const LONGEST_FIRST: readonly Duration[] = NOTE_TYPES.flatMap((type) => [
  Duration.of(type, 1),
  Duration.of(type, 0),
]).sort((left, right) => right.ticks - left.ticks);

/**
 * Whether a span of `ticks` starting at `onsetTicks` respects the beat grid.
 *
 * Takes a tick span rather than a single value so that a repeated group can be
 * tested as a whole: two sixteenths are only worth offering when both of them
 * fit inside the same beat.
 */
function fitsRhythmicGrid(
  onsetTicks: number,
  ticks: number,
  ticksPerBeat: number,
  keepInsideBeats: boolean,
): boolean {
  if (!keepInsideBeats) {
    return true;
  }
  const startsOnBeat = onsetTicks % ticksPerBeat === 0;
  if (startsOnBeat) {
    // A value that begins on a beat may span whole beats, or stay inside one.
    return ticks % ticksPerBeat === 0 || ticks < ticksPerBeat;
  }
  const nextBeatBoundary = (Math.floor(onsetTicks / ticksPerBeat) + 1) * ticksPerBeat;
  return onsetTicks + ticks <= nextBeatBoundary;
}

/**
 * Cuts a value at every beat it crosses, into pieces that can each be written.
 *
 * A quarter beginning halfway through a beat is not a quarter on the page: it
 * is two eighths tied across the bar's pulse, and writing it any other way
 * hides the very thing the reader has to see.
 */
function splitAcrossBeats(onsetTicks: number, ticks: number, ticksPerBeat: number): number[] {
  const pieces: number[] = [];
  let at = onsetTicks;
  let left = ticks;
  while (left > 0) {
    const boundary = (Math.floor(at / ticksPerBeat) + 1) * ticksPerBeat;
    const piece = Math.min(left, boundary - at);
    for (const part of splitIntoRests(piece)) {
      pieces.push(part.ticks);
    }
    at += piece;
    left -= piece;
  }
  return pieces;
}

/** How many copies of a value one draw emits. */
function copiesOf(candidate: WeightedDuration): number {
  return Math.max(1, Math.trunc(candidate.repeat ?? 1));
}

/**
 * Fills exactly one measure with rhythmic values sampled from the pool.
 *
 * The result always sums to the measure length, which is the invariant
 * {@link validateExercise} later depends on.
 */
export function fillMeasure(
  timeSignature: TimeSignature,
  rng: Rng,
  options: RhythmOptions,
): RhythmSlot[] {
  const total = timeSignature.ticksPerMeasure;
  const ticksPerBeat = timeSignature.ticksPerBeat;
  const slots: RhythmSlot[] = [];
  let onsetTicks = 0;

  while (onsetTicks < total) {
    const remaining = total - onsetTicks;
    const position = onsetTicks;
    // Weighted over the entries themselves rather than their values, so the
    // drawn item keeps its `repeat` count. A repeated value is offered only
    // when the whole group fits, which is what stops a pair of sixteenths from
    // being split across a beat into two stranded ones.
    const syncopating =
      (options.syncopation ?? 0) > 0 &&
      options.keepInsideBeats &&
      position % ticksPerBeat !== 0 &&
      rng.bool(options.syncopation ?? 0);

    const candidates = options.durations
      .filter((candidate) => {
        const span = candidate.value.ticks * copiesOf(candidate);
        return (
          span <= remaining &&
          candidate.weight > 0 &&
          (syncopating ||
            fitsRhythmicGrid(position, span, ticksPerBeat, options.keepInsideBeats))
        );
      })
      .map((candidate) => ({ value: candidate, weight: candidate.weight }));

    const drawn = candidates.length > 0 ? rng.weighted(candidates) : undefined;
    const duration = drawn?.value ?? largestThatFits(remaining);
    const copies = drawn === undefined ? 1 : copiesOf(drawn);

    // A value that crosses the beat is written as tied pieces. Offered only
    // where one was not already allowed, so nothing that used to be drawn
    // changes, and only for single values - a repeated group is a group
    // because it belongs inside one beat.
    if (copies === 1 && crossesTheBeat(position, duration, ticksPerBeat, options)) {
      const pieces = splitAcrossBeats(position, duration.ticks, ticksPerBeat);
      pieces.forEach((piece, index) => {
        slots.push({
          duration: Duration.fromTicks(piece),
          isRest: false,
          onsetTicks,
          tiedForward: index < pieces.length - 1,
        });
        onsetTicks += piece;
      });
      continue;
    }

    for (let copy = 0; copy < copies; copy += 1) {
      const restEligible =
        onsetTicks % ticksPerBeat === 0 && duration.ticks % ticksPerBeat === 0;
      slots.push({
        duration,
        isRest: restEligible && rng.bool(options.restProbability),
        onsetTicks,
        tiedForward: false,
      });
      onsetTicks += duration.ticks;
    }
  }

  return slots;
}

/** Whether this draw is one of the syncopating ones, and actually crosses. */
function crossesTheBeat(
  onsetTicks: number,
  duration: Duration,
  ticksPerBeat: number,
  options: RhythmOptions,
): boolean {
  if ((options.syncopation ?? 0) <= 0 || duration.isTuplet) {
    return false;
  }
  return !fitsRhythmicGrid(onsetTicks, duration.ticks, ticksPerBeat, options.keepInsideBeats);
}

/** Longest single value that fits into `remaining` divisions. */
function largestThatFits(remaining: number): Duration {
  const found = LONGEST_FIRST.find((duration) => duration.ticks <= remaining);
  if (found === undefined) {
    throw new DomainError(`${remaining} divisions cannot be notated with the known values.`);
  }
  return found;
}

/** Tiles a span with as few rest values as possible, longest first. */
export function splitIntoRests(ticks: number): Duration[] {
  const rests: Duration[] = [];
  let remaining = ticks;
  while (remaining > 0) {
    const duration = largestThatFits(remaining);
    rests.push(duration);
    remaining -= duration.ticks;
  }
  return rests;
}

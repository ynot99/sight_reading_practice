import { DomainError } from '../../shared/errors.js';
import { Duration, NOTE_TYPES } from '../model/Duration.js';
import type { TimeSignature } from '../model/TimeSignature.js';
import type { Rng, WeightedItem } from './Rng.js';

export type WeightedDuration = WeightedItem<Duration>;

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
}

export interface RhythmSlot {
  readonly duration: Duration;
  readonly isRest: boolean;
  /** Offset from the start of the measure, in divisions. */
  readonly onsetTicks: number;
}

/** Every notatable value, longest first: used to tile leftover space. */
const LONGEST_FIRST: readonly Duration[] = NOTE_TYPES.flatMap((type) => [
  Duration.of(type, 1),
  Duration.of(type, 0),
]).sort((left, right) => right.ticks - left.ticks);

function fitsRhythmicGrid(
  onsetTicks: number,
  duration: Duration,
  ticksPerBeat: number,
  keepInsideBeats: boolean,
): boolean {
  if (!keepInsideBeats) {
    return true;
  }
  const startsOnBeat = onsetTicks % ticksPerBeat === 0;
  if (startsOnBeat) {
    // A value that begins on a beat may span whole beats, or stay inside one.
    return duration.ticks % ticksPerBeat === 0 || duration.ticks < ticksPerBeat;
  }
  const nextBeatBoundary = (Math.floor(onsetTicks / ticksPerBeat) + 1) * ticksPerBeat;
  return onsetTicks + duration.ticks <= nextBeatBoundary;
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
    const candidates = options.durations.filter(
      (candidate) =>
        candidate.value.ticks <= remaining &&
        candidate.weight > 0 &&
        fitsRhythmicGrid(position, candidate.value, ticksPerBeat, options.keepInsideBeats),
    );

    const duration =
      candidates.length > 0 ? rng.weighted(candidates) : largestThatFits(remaining);

    const restEligible =
      onsetTicks % ticksPerBeat === 0 && duration.ticks % ticksPerBeat === 0;
    slots.push({
      duration,
      isRest: restEligible && rng.bool(options.restProbability),
      onsetTicks,
    });
    onsetTicks += duration.ticks;
  }

  return slots;
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

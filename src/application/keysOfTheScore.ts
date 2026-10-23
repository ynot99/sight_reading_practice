import { theKeysAlongTheBars } from '../domain/harmony/keysAlong.js';
import type { KeyFrom } from '../domain/harmony/chordsAlong.js';
import type { ScaleName } from '../domain/harmony/scales.js';
import { barLines, elapsedMsAt, type Exercise } from '../domain/model/Exercise.js';
import type { KeySignature } from '../domain/model/KeySignature.js';
import type { ExerciseTimeline } from '../domain/timeline/Timeline.js';
import { rollOfTheScore } from './session/RunRoll.js';

/** A key a score is in from the beginning of a bar, as far as the next. */
export interface KeyOfTheScore {
  readonly measureIndex: number;
  readonly fifths: number;
  readonly scale: ScaleName;
}

/**
 * The keys a score is in, each from the bar it begins in, the first from
 * the first: read off its music bar by bar in the signatures it is written
 * with (see `theKeysAlongTheBars`), so a riff in two flats that keeps
 * coming home to F is in F mixolydian, and a song in one flat that keeps
 * coming home to D minor is in D minor - where the signatures alone said
 * B♭ major and F major.
 *
 * Read off the score itself, as it is written to sound, whatever is drawn:
 * a run of it, begun late or played wrong, is the same piece in the same
 * keys. Worked out once a score, which never changes once made.
 */
export function theKeysOfTheScore(exercise: Exercise, timeline: ExerciseTimeline): readonly KeyOfTheScore[] {
  const known = keysOf.get(exercise);
  if (known !== undefined) {
    return known;
  }
  const lines = barLines(exercise);
  const roll = rollOfTheScore(exercise, timeline);
  const bars = lines.map((line, index) => {
    const pulses = Math.max(1, Math.round(line.timeSignature.ticksPerMeasure / line.timeSignature.ticksPerPulse));
    return {
      beatsMs: Array.from({ length: pulses }, (_, pulse) => elapsedMsAt(exercise, line.startTicks + pulse * line.timeSignature.ticksPerPulse)),
      untilMs: elapsedMsAt(exercise, lines[index + 1]?.startTicks ?? line.startTicks + line.timeSignature.ticksPerMeasure),
    };
  });
  const scaleOf = (key: KeySignature): ScaleName => (key.mode === 'minor' ? 'minor' : 'major');
  const written: KeyFrom[] = [
    { fromMs: Number.NEGATIVE_INFINITY, fifths: exercise.key.fifths, scale: scaleOf(exercise.key) },
    ...exercise.keyChanges.map((change) => ({
      fromMs: bars[change.measureIndex]?.beatsMs[0] ?? Number.POSITIVE_INFINITY,
      fifths: change.key.fifths,
      scale: scaleOf(change.key),
    })),
  ];
  const notes = roll.presses.map((press) => ({ midi: press.midi, fromMs: press.downAtMs, untilMs: press.upAtMs ?? press.downAtMs }));
  const keys: KeyOfTheScore[] = [];
  theKeysAlongTheBars(notes, bars, written).forEach((key, measureIndex) => {
    const before = keys.at(-1);
    if (before === undefined || before.fifths !== key.fifths || before.scale !== key.scale) {
      keys.push({ measureIndex, fifths: key.fifths, scale: key.scale });
    }
  });
  if (keys.length === 0) {
    keys.push({ measureIndex: 0, fifths: exercise.key.fifths, scale: scaleOf(exercise.key) });
  }
  keysOf.set(exercise, keys);
  return keys;
}

/** {@link theKeysOfTheScore}, once a score. */
const keysOf = new WeakMap<Exercise, readonly KeyOfTheScore[]>();

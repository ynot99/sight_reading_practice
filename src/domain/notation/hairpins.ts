import { DYNAMIC_LEVELS, barLines, dynamicAt } from '../model/Exercise.js';
import type { DynamicLevel, DynamicMark, Exercise } from '../model/Exercise.js';

/** Where a mark or a hairpin end sits, in ticks from the start of the piece. */
function atTicks(exercise: Exercise, measureIndex: number, offsetTicks: number): number {
  const bars = barLines(exercise);
  return (bars[measureIndex]?.startTicks ?? 0) + offsetTicks;
}

/** The bar a moment falls in, and how far into it. */
function placeOf(
  exercise: Exercise,
  ticks: number,
): { measureIndex: number; offsetTicks: number } | null {
  const bars = barLines(exercise);
  const at = bars.findIndex(
    (bar) => ticks >= bar.startTicks && ticks < bar.startTicks + bar.timeSignature.ticksPerMeasure,
  );
  if (at < 0) {
    return null;
  }
  return { measureIndex: at, offsetTicks: ticks - (bars[at]?.startTicks ?? 0) };
}

/**
 * A piece with its hairpins heard.
 *
 * A crescendo says "louder from here to there" and names no level, so where
 * it is heading is the mark at its far end - and where the writer put none,
 * one step of the eight, which is what a hairpin between two unmarked
 * stretches means to a player.
 *
 * Written out as ordinary dynamic marks, for the same reason a gradual tempo
 * change is written out as ordinary tempo changes: levels are the only
 * language this program's loudness speaks, and everything downstream already
 * understands them. They are marked as worked out, so nothing prints four
 * dynamics under one bar.
 */
export function withHairpinsPlayed(exercise: Exercise): Exercise {
  if (exercise.hairpins.length === 0) {
    return exercise;
  }
  const added: DynamicMark[] = [];

  for (const hairpin of exercise.hairpins) {
    const from = atTicks(exercise, hairpin.measureIndex, hairpin.offsetTicks);
    const until = atTicks(exercise, hairpin.untilMeasureIndex, hairpin.untilOffsetTicks);
    if (until <= from) {
      continue;
    }
    const startLevel =
      dynamicAt(exercise, hairpin.measureIndex, hairpin.offsetTicks, hairpin.staffNumber) ?? 'mf';
    const startAt = DYNAMIC_LEVELS.indexOf(startLevel);
    // What it is heading for: the mark standing at the far end, or one step
    // in the direction the hairpin points.
    const endLevel = dynamicAt(
      exercise,
      hairpin.untilMeasureIndex,
      hairpin.untilOffsetTicks,
      hairpin.staffNumber,
    );
    const endAt =
      endLevel !== null && endLevel !== startLevel
        ? DYNAMIC_LEVELS.indexOf(endLevel)
        : startAt + (hairpin.kind === 'crescendo' ? 1 : -1);
    const target = Math.min(DYNAMIC_LEVELS.length - 1, Math.max(0, endAt));
    if (target === startAt) {
      continue;
    }

    // One mark for each level it passes through, evenly spaced across the
    // hairpin. The far end is left to whatever stands there - a mark of the
    // writer's own, or the last of these.
    const step = target > startAt ? 1 : -1;
    const levels: DynamicLevel[] = [];
    for (let at = startAt + step; step > 0 ? at <= target : at >= target; at += step) {
      const level = DYNAMIC_LEVELS[at];
      if (level !== undefined) {
        levels.push(level);
      }
    }
    for (const [index, level] of levels.entries()) {
      const share = (index + 1) / levels.length;
      const ticks = Math.round(from + (until - from) * share);
      const place = placeOf(exercise, Math.min(ticks, until));
      if (place === null) {
        continue;
      }
      const already = exercise.dynamicMarks.some(
        (mark) =>
          mark.measureIndex === place.measureIndex &&
          mark.offsetTicks === place.offsetTicks &&
          (mark.staffNumber === hairpin.staffNumber || mark.staffNumber === null),
      );
      if (already) {
        // The writer has said it here; this says nothing.
        continue;
      }
      added.push({ ...place, level, staffNumber: hairpin.staffNumber, implied: true });
    }
  }

  if (added.length === 0) {
    return exercise;
  }
  return {
    ...exercise,
    dynamicMarks: [...exercise.dynamicMarks, ...added].sort(
      (left, right) =>
        atTicks(exercise, left.measureIndex, left.offsetTicks) -
        atTicks(exercise, right.measureIndex, right.offsetTicks),
    ),
  };
}

import { clamp } from '../../../shared/asserts.js';
import type { Measure, MusicalEntry } from '../../model/Exercise.js';
import { measureOf, noteEntry, restEntry } from '../../model/Exercise.js';
import type { Pitch } from '../../model/Pitch.js';
import { fillMeasure, type RhythmOptions } from '../RhythmFiller.js';
import type { IVoiceGenerator, PitchRange, VoiceContext } from './IVoiceGenerator.js';

export type HarmonyShape = 'single' | 'interval' | 'triad';

export interface HarmonyVoiceOptions {
  readonly range: PitchRange;
  readonly rhythm: RhythmOptions;
  readonly shape: HarmonyShape;
  /** Scale degrees above the root used by the `interval` shape (2 = a third). */
  readonly intervalDegrees: readonly number[];
  /** Scale degrees the root is drawn from, zero-based (0 = I, 3 = IV, 4 = V). */
  readonly degreePool: readonly number[];
  /** Reuse one root for a whole measure instead of re-drawing per slot. */
  readonly harmonyPerMeasure: boolean;
}

/**
 * Accompaniment voice: single notes, diatonic intervals or root-position
 * triads on chosen scale degrees.
 *
 * This is the strategy that turns "read one note at a time" practice into
 * "read a vertical stack at a time" practice, which is where the chord
 * matcher's tolerance window starts to matter.
 */
export class HarmonyVoiceGenerator implements IVoiceGenerator {
  readonly id = 'voice.harmony';
  private readonly options: HarmonyVoiceOptions;

  constructor(options: HarmonyVoiceOptions) {
    this.options = options;
  }

  generate(context: VoiceContext): Measure[] {
    const low = this.options.range.lowest.diatonicIndex;
    const high = this.options.range.highest.diatonicIndex;
    const tonicBase = context.key.tonicIndexAtOrAbove(low);
    const measures: Measure[] = [];

    for (let measureIndex = 0; measureIndex < context.measures; measureIndex += 1) {
      const entries: MusicalEntry[] = [];
      let measureRoot: number | null = null;

      for (const slot of fillMeasure(context.timeSignature, context.rng, this.options.rhythm)) {
        if (slot.isRest) {
          entries.push(restEntry(slot.duration));
          continue;
        }
        if (measureRoot === null || !this.options.harmonyPerMeasure) {
          measureRoot = tonicBase + context.rng.pick(this.options.degreePool);
        }
        const pitches = this.buildShape(context, measureRoot, low, high);
        entries.push(noteEntry(pitches, slot.duration));
      }

      measures.push(measureOf(entries));
    }

    return measures;
  }

  private buildShape(
    context: VoiceContext,
    root: number,
    low: number,
    high: number,
  ): readonly Pitch[] {
    let indices = this.shapeIndices(context, root);

    // Octave-shift the whole shape until it sits inside the hand's range.
    while (Math.max(...indices) > high && Math.min(...indices) - 7 >= low) {
      indices = indices.map((index) => index - 7);
    }
    while (Math.min(...indices) < low && Math.max(...indices) + 7 <= high) {
      indices = indices.map((index) => index + 7);
    }

    const inRange = indices.filter((index) => index >= low && index <= high);
    const chosen = inRange.length > 0 ? inRange : [clamp(root, low, high)];
    return chosen.map((index) => context.key.pitchAt(index));
  }

  private shapeIndices(context: VoiceContext, root: number): number[] {
    switch (this.options.shape) {
      case 'single':
        return [root];
      case 'interval':
        return [root, root + context.rng.pick(this.options.intervalDegrees)];
      case 'triad':
        return [root, root + 2, root + 4];
      default:
        return [root];
    }
  }
}

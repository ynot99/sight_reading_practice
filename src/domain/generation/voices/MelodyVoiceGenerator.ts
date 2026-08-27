import { clamp } from '../../../shared/asserts.js';
import type { Measure, MusicalEntry } from '../../model/Exercise.js';
import { measureOf, noteEntry, restEntry } from '../../model/Exercise.js';
import { fillMeasure } from '../RhythmFiller.js';
import type { VoiceRole } from '../RhythmProfile.js';
import type { IVoiceGenerator, PitchRange, VoiceContext } from './IVoiceGenerator.js';
import { tonicNearestMiddle } from './voiceRange.js';

export interface MelodyVoiceOptions {
  readonly range: PitchRange;
  /** Which rhythm of the active profile this line follows. */
  readonly role: VoiceRole;
  /** Largest allowed jump, in scale degrees (1 = a second, 2 = a third). */
  readonly maxLeap: number;
  /** Probability that the next note is a neighbouring scale degree. */
  readonly stepProbability: number;
}

/**
 * Single-line melody built as a constrained random walk over scale degrees.
 *
 * Working in diatonic staff positions rather than in semitones means the line
 * is automatically in key, and correctly spelled for the key signature.
 */
export class MelodyVoiceGenerator implements IVoiceGenerator {
  readonly id = 'voice.melody';
  private readonly options: MelodyVoiceOptions;

  constructor(options: MelodyVoiceOptions) {
    this.options = options;
  }

  generate(context: VoiceContext): Measure[] {
    const low = this.options.range.lowest.diatonicIndex;
    const high = this.options.range.highest.diatonicIndex;
    let current = tonicNearestMiddle(context.key, low, high);

    const measures: Measure[] = [];
    let isFirstNote = true;

    for (let measureIndex = 0; measureIndex < context.measures; measureIndex += 1) {
      const entries: MusicalEntry[] = [];
      for (const slot of fillMeasure(context.timeSignature, context.rng, context.rhythm.byRole[this.options.role])) {
        if (slot.isRest) {
          entries.push(restEntry(slot.duration));
          continue;
        }
        if (!isFirstNote) {
          current = this.nextIndex(context, current, low, high);
        }
        isFirstNote = false;
        entries.push(noteEntry(context.key.pitchAt(current), slot.duration));
      }
      measures.push(measureOf(entries));
    }

    return measures;
  }

  private nextIndex(context: VoiceContext, current: number, low: number, high: number): number {
    const { rng } = context;
    const interval = rng.bool(this.options.stepProbability)
      ? 1
      : rng.int(2, Math.max(2, this.options.maxLeap));

    let direction = rng.bool(0.5) ? 1 : -1;
    if (current + direction * interval > high || current + direction * interval < low) {
      direction = -direction;
    }

    const candidate = current + direction * interval;
    if (candidate >= low && candidate <= high) {
      return candidate;
    }
    // Both directions overshoot (very narrow range): fall back to a step that
    // stays inside it, otherwise repeat the note.
    if (current + 1 <= high) {
      return current + 1;
    }
    if (current - 1 >= low) {
      return current - 1;
    }
    return clamp(current, low, high);
  }
}

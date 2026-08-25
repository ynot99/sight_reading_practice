import type { Measure } from '../../model/Exercise.js';
import { measureOf, restEntry } from '../../model/Exercise.js';
import { splitIntoRests } from '../RhythmFiller.js';
import type { IVoiceGenerator, VoiceContext } from './IVoiceGenerator.js';

/**
 * Fills a staff with rests.
 *
 * Used for single-hand practice: the staff is still engraved (so the reader
 * keeps their bearings on the grand staff) but demands no input, and the
 * timeline marks those positions as rest steps.
 */
export class SilentVoiceGenerator implements IVoiceGenerator {
  readonly id = 'voice.silent';

  generate(context: VoiceContext): Measure[] {
    const rests = splitIntoRests(context.timeSignature.ticksPerMeasure).map((duration) =>
      restEntry(duration),
    );
    return Array.from({ length: context.measures }, () => measureOf([...rests]));
  }
}

import type { Measure, MusicalEntry } from '../../model/Exercise.js';
import { measureOf, noteEntry, restEntry } from '../../model/Exercise.js';
import { fillMeasure } from '../RhythmFiller.js';
import type { VoiceRole } from '../RhythmProfile.js';
import { FigureWalker, type WeightedFigure } from './figures.js';
import type { IVoiceGenerator, PitchRange, VoiceContext } from './IVoiceGenerator.js';
import { tonicNearestMiddle } from './voiceRange.js';

export interface PatternVoiceOptions {
  readonly range: PitchRange;
  /** Which rhythm of the active profile this line follows. */
  readonly role: VoiceRole;
  /** Which figures the line is built from, and how often each appears. */
  readonly figures: readonly WeightedFigure[];
  /** Largest jump from one figure to the next, in scale degrees. */
  readonly maxLeap: number;
}

/**
 * Melody assembled from recognisable figures rather than from single steps.
 *
 * {@link MelodyVoiceGenerator} walks one degree at a time, which makes every
 * note independent of the one before it. That is unreadable in the way that
 * matters: a fluent reader chunks a line into scale fragments, broken chords
 * and repeated motifs, and material with no such structure gives the skill
 * nothing to attach to. This generator writes the chunks instead, and leaves
 * randomness only where real melodies have it - in which figure comes next and
 * where it starts.
 */
export class PatternVoiceGenerator implements IVoiceGenerator {
  readonly id = 'voice.pattern';
  private readonly options: PatternVoiceOptions;

  constructor(options: PatternVoiceOptions) {
    this.options = options;
  }

  generate(context: VoiceContext): Measure[] {
    const lowest = this.options.range.lowest.diatonicIndex;
    const highest = this.options.range.highest.diatonicIndex;
    const walker = new FigureWalker({
      rng: context.rng,
      lowest,
      highest,
      startIndex: tonicNearestMiddle(context.key, lowest, highest),
      tonicIndex: context.key.tonicIndexAtOrAbove(lowest),
      figures: this.options.figures,
      maxLeap: this.options.maxLeap,
    });

    const rhythm = context.rhythm.byRole[this.options.role];
    const measures: Measure[] = [];
    // A tie crosses bar lines, so what is being held outlives the measure loop.
    let holding = false;
    let current = 0;

    for (let measureIndex = 0; measureIndex < context.measures; measureIndex += 1) {
      const entries: MusicalEntry[] = [];
      for (const slot of fillMeasure(context.timeSignature, context.rng, rhythm)) {
        if (slot.isRest) {
          entries.push(restEntry(slot.duration));
          continue;
        }
        // A held note keeps its pitch, so the walker only moves on once the
        // tie has let go. Every other note draws exactly as it always did.
        if (!holding) {
          current = walker.next();
        }
        const pitch = context.key.pitchAt(current);
        entries.push(noteEntry(pitch, slot.duration, slot.tiedForward ? [pitch.midi] : []));
        holding = slot.tiedForward;
      }
      measures.push(measureOf(entries));
    }

    return measures;
  }
}

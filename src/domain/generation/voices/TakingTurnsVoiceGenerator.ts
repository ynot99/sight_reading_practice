import type { Measure, MusicalEntry } from '../../model/Exercise.js';
import { measureOf, restEntry } from '../../model/Exercise.js';
import { splitIntoRests } from '../RhythmFiller.js';
import type { IVoiceGenerator, VoiceContext } from './IVoiceGenerator.js';

export interface TakingTurnsOptions {
  /** The line this hand plays when it is its turn. */
  readonly voice: IVoiceGenerator;
  /** Which turn is this hand's, counting from nought at the first bar. */
  readonly turn: number;
  /** How many hands take turns. */
  readonly hands: number;
  /** How many bars one turn lasts. */
  readonly barsEach: number;
}

/**
 * One hand's line, played only in its own turns and resting in the others'.
 *
 * The first music written for a beginner to read is in the hands one after
 * the other, never both at once: each staff is read on its own, and the
 * reader still moves the eye between the two. Wrapped round any line rather
 * than written into one, so the material in a turn is exactly what that
 * line would have been.
 */
export class TakingTurnsVoiceGenerator implements IVoiceGenerator {
  readonly id = 'voice.taking-turns';
  private readonly options: TakingTurnsOptions;

  constructor(options: TakingTurnsOptions) {
    this.options = options;
  }

  generate(context: VoiceContext): Measure[] {
    const played = this.options.voice.generate(context);
    const rests = splitIntoRests(context.timeSignature.ticksPerMeasure);
    return played.map((measure, bar) => {
      if (!this.plays(bar)) {
        return measureOf(rests.map((duration) => restEntry(duration)));
      }
      // A note held over into the other hand's turn would sound on into a bar
      // this hand rests in, and be written as a tie to nothing.
      return this.plays(bar + 1) ? measure : lettingGo(measure);
    });
  }

  private plays(bar: number): boolean {
    const { turn, hands, barsEach } = this.options;
    return Math.floor(bar / barsEach) % hands === turn;
  }
}

/** The bar with nothing held over its closing bar line. */
function lettingGo(measure: Measure): Measure {
  const last = measure.entries.at(-1);
  if (last === undefined || last.kind !== 'note' || last.tiedForward.length === 0) {
    return measure;
  }
  const entries: MusicalEntry[] = [...measure.entries.slice(0, -1), { ...last, tiedForward: [] }];
  return measureOf(entries);
}

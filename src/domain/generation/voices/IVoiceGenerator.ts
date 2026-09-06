import type { Measure } from '../../model/Exercise.js';
import type { KeySignature } from '../../model/KeySignature.js';
import { Pitch } from '../../model/Pitch.js';
import type { TimeSignature } from '../../model/TimeSignature.js';
import type { RhythmProfile } from '../RhythmProfile.js';
import type { Rng } from '../Rng.js';

/** Inclusive playable span for one hand. */
export interface PitchRange {
  readonly lowest: Pitch;
  readonly highest: Pitch;
}

/** Everything a voice generator is allowed to know about the exercise. */
export interface VoiceContext {
  readonly rng: Rng;
  readonly key: KeySignature;
  readonly timeSignature: TimeSignature;
  readonly measures: number;
  /**
   * Rhythmic level for this exercise. A voice looks up its own role here
   * rather than owning a rhythm, which is what lets any preset be combined
   * with any rhythm.
   */
  readonly rhythm: RhythmProfile;
  /**
   * The keys the reader actually has, or `undefined` for a whole piano.
   *
   * A narrowing rather than a replacement: a voice keeps its own shape - a
   * bass line stays low and a melody stays high - and is moved and trimmed to
   * fit. Written down here rather than into each preset because it is a fact
   * about the instrument in the room, not about the exercise.
   */
  readonly withinRange?: PitchRange;
}

/**
 * A voice's range, brought inside the keys the reader has.
 *
 * Moved before it is trimmed, and by whole octaves: a bass line on a
 * two-octave keyboard is played an octave or two up, and it is still a bass
 * line. Trimming without moving would hand a generator an empty range - a
 * hand with nothing it may play - and the exercise would be silence.
 *
 * The move keeps the voice's own width where the keyboard allows it, so a
 * preset's shape survives; where it does not, both ends are simply the
 * keyboard's, and the exercise is as wide as the instrument.
 */
export function playableRange(range: PitchRange, within: PitchRange | undefined): PitchRange {
  if (within === undefined) {
    return range;
  }
  const octave = 12;
  let lowest = range.lowest.midi;
  let highest = range.highest.midi;
  const fits = highest - lowest <= within.highest.midi - within.lowest.midi;
  if (fits) {
    // It can sit inside whole, so it is moved until it does: a bass line on
    // a small keyboard is played an octave or two up and is still a bass
    // line, with all of its own width. Overlapping in a third of itself
    // would cost the voice most of its shape for no reason.
    while (lowest < within.lowest.midi) {
      lowest += octave;
      highest += octave;
    }
    while (highest > within.highest.midi) {
      lowest -= octave;
      highest -= octave;
    }
  } else {
    // Wider than the instrument: it will be trimmed whatever happens, so it
    // is only moved far enough to overlap at all.
    while (highest < within.lowest.midi) {
      lowest += octave;
      highest += octave;
    }
    while (lowest > within.highest.midi) {
      lowest -= octave;
      highest -= octave;
    }
  }
  const low = Math.max(lowest, within.lowest.midi);
  const high = Math.min(highest, within.highest.midi);
  if (low > high) {
    // Nothing of the voice survives the trim, which a keyboard narrower than
    // a step can do: the instrument itself is then the only honest answer.
    return within;
  }
  return { lowest: Pitch.fromMidi(low), highest: Pitch.fromMidi(high) };
}

/**
 * Strategy that writes the music for a single staff.
 *
 * New material - arpeggios, two-voice counterpoint, chromatic passing notes -
 * arrives as a new implementation of this interface; no existing generator,
 * session or renderer code has to change.
 */
export interface IVoiceGenerator {
  readonly id: string;
  generate(context: VoiceContext): Measure[];
}

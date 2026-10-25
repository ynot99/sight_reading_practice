import { Pitch } from '../model/Pitch.js';

/** Where a hand's chords may lie: the lowest and highest keys any of their notes may be. */
export interface HandRange {
  readonly lowest: number;
  readonly highest: number;
}

/**
 * A chord's notes laid as near the chord before as they can be - each
 * position of it in the octaves around, the one whose notes move least, as
 * a keyboard harmony lesson voices one chord after another - and, where a
 * range is given, within it. The first chord, with none before it, is laid
 * as near as it can be to where it was written, which is where it is where
 * no range moves it.
 */
export function theNearestVoicing(chord: readonly Pitch[], before: readonly Pitch[] | null, range: HandRange | null = null): Pitch[] {
  const near = before ?? chord;
  const moved = (pitch: Pitch, octaves: number): Pitch => new Pitch(pitch.step, pitch.octave + octaves, pitch.alter);
  const candidates = [-2, -1, 0, 1].flatMap((octave) =>
    chord.map((_, rotation) => [
      ...chord.slice(rotation).map((pitch) => moved(pitch, octave)),
      ...chord.slice(0, rotation).map((pitch) => moved(pitch, octave + 1)),
    ]),
  );
  const inRange = candidates.filter(
    (each) => range === null || each.every((pitch) => pitch.midi >= range.lowest && pitch.midi <= range.highest),
  );
  const distance = (each: readonly Pitch[]): number =>
    each.reduce((sum, pitch, at) => sum + Math.abs(pitch.midi - (near[at]?.midi ?? pitch.midi)), 0);
  return [...(inRange.length === 0 ? candidates : inRange)].sort((one, other) => distance(one) - distance(other))[0] ?? [...chord];
}

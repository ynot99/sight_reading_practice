import { Pitch } from '../../domain/model/Pitch.js';

export interface PianoSample {
  readonly midi: number;
  /** File name without extension, e.g. `Ds4`. */
  readonly name: string;
}

/** Lowest and highest keys of an 88-key piano. */
export const LOWEST_SAMPLED_MIDI = 21;
export const HIGHEST_SAMPLED_MIDI = 108;

/** One sample every three semitones, which is how the library was recorded. */
export const SEMITONES_BETWEEN_SAMPLES = 3;

function fileNameFor(midi: number): string {
  // `D#4` on disk is `Ds4`: a sharp is not welcome in a URL.
  return Pitch.fromMidi(midi).toString().replace('#', 's');
}

/**
 * The samples that ship with the app: A0 to C8, every third semitone.
 *
 * Thirty files instead of eighty-eight, one velocity layer instead of
 * sixteen, five seconds instead of twenty-five. The gaps are filled by
 * resampling, which is what a hardware sampler has always done.
 */
export const PIANO_SAMPLES: readonly PianoSample[] = (() => {
  const samples: PianoSample[] = [];
  for (
    let midi = LOWEST_SAMPLED_MIDI;
    midi <= HIGHEST_SAMPLED_MIDI;
    midi += SEMITONES_BETWEEN_SAMPLES
  ) {
    samples.push({ midi, name: fileNameFor(midi) });
  }
  return samples;
})();

export interface SampleChoice {
  readonly sample: PianoSample;
  /** How far the sample has to be shifted, in semitones. Never more than one. */
  readonly semitones: number;
}

/**
 * The sample to play a given key with.
 *
 * Notes outside the sampled range clamp to the nearest end rather than going
 * silent - a keyboard transposed an octave should still make a sound.
 */
export function nearestSample(midi: number): SampleChoice {
  const clamped = Math.min(HIGHEST_SAMPLED_MIDI, Math.max(LOWEST_SAMPLED_MIDI, midi));
  const step = Math.round((clamped - LOWEST_SAMPLED_MIDI) / SEMITONES_BETWEEN_SAMPLES);
  const index = Math.min(PIANO_SAMPLES.length - 1, Math.max(0, step));
  const sample = PIANO_SAMPLES[index];
  if (sample === undefined) {
    throw new Error('The piano sample table is empty.');
  }
  return { sample, semitones: midi - sample.midi };
}

/** Resampling ratio for a shift in semitones; an octave up plays twice as fast. */
export function playbackRateFor(semitones: number): number {
  return 2 ** (semitones / 12);
}

import type { MetronomeConfig, MetronomeTick } from '../../application/ports/IMetronome.js';

/** Seconds occupied by one subdivision at the configured tempo. */
export function subdivisionSeconds(config: MetronomeConfig): number {
  const secondsPerQuarter = 60 / config.bpm;
  const quartersPerBeat = 4 / config.timeSignature.beatType;
  return (secondsPerQuarter * quartersPerBeat) / config.subdivisionsPerBeat;
}

/** Musical divisions covered by one subdivision. */
export function ticksPerSubdivision(config: MetronomeConfig): number {
  return config.timeSignature.ticksPerBeat / config.subdivisionsPerBeat;
}

/**
 * Derives a tick from its ordinal.
 *
 * Shared by the Web Audio metronome and the manual one used in tests, so both
 * agree on what beat 3 of bar 2 means down to the tick.
 */
export function buildMetronomeTick(
  index: number,
  config: MetronomeConfig,
  scheduledTimeMs: number,
): MetronomeTick {
  const { subdivisionsPerBeat, timeSignature } = config;
  const beatIndex = Math.floor(index / subdivisionsPerBeat);
  return {
    index,
    measure: Math.floor(beatIndex / timeSignature.beats),
    beat: (beatIndex % timeSignature.beats) + 1,
    isBeat: index % subdivisionsPerBeat === 0,
    isDownbeat: index % (subdivisionsPerBeat * timeSignature.beats) === 0,
    positionTicks: index * ticksPerSubdivision(config),
    scheduledTimeMs,
  };
}

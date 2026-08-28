import {
  clicksPerPulse,
  type MetronomeConfig,
  type MetronomeTick,
} from '../../application/ports/IMetronome.js';
import { DIVISIONS_PER_QUARTER } from '../../domain/model/Duration.js';

/** Seconds occupied by one subdivision at the configured tempo. */
export function subdivisionSeconds(config: MetronomeConfig): number {
  const secondsPerQuarter = 60 / config.bpm;
  const quartersPerPulse = config.timeSignature.ticksPerPulse / DIVISIONS_PER_QUARTER;
  return (secondsPerQuarter * quartersPerPulse) / config.subdivisionsPerPulse;
}

/** Musical divisions covered by one subdivision. */
export function ticksPerSubdivision(config: MetronomeConfig): number {
  return config.timeSignature.ticksPerPulse / config.subdivisionsPerPulse;
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
  const { subdivisionsPerPulse, timeSignature } = config;
  const pulseIndex = Math.floor(index / subdivisionsPerPulse);
  const pulses = timeSignature.pulsesPerMeasure;
  return {
    index,
    measure: Math.floor(pulseIndex / pulses),
    beat: (pulseIndex % pulses) + 1,
    isPulse: index % subdivisionsPerPulse === 0,
    isDownbeat: index % (subdivisionsPerPulse * pulses) === 0,
    positionTicks: index * ticksPerSubdivision(config),
    scheduledTimeMs,
  };
}

/**
 * Whether a tick falls in one of the bars the click sits out.
 *
 * A cycle is a run of sounding bars followed by an equally long run of silent
 * ones; the other kind never returns at all. Both are counted from where the
 * music starts rather than from where the metronome did, so the count-in
 * always sounds.
 */
function isInSilentBar(tick: MetronomeTick, config: MetronomeConfig): boolean {
  const dropout = config.dropout;
  if (dropout === null || tick.measure < dropout.fromBar) {
    return false;
  }
  if (dropout.kind === 'silent-from') {
    return true;
  }
  if (dropout.bars <= 0) {
    return false;
  }
  const cycle = Math.floor((tick.measure - dropout.fromBar) / dropout.bars);
  return cycle % 2 === 1;
}

/**
 * Whether a tick is one the reader hears.
 *
 * The metronome always ticks at the resolution the loop needs; this decides
 * which of those ticks make a sound. Separating the two is what lets a run
 * resolve sixteenth notes while clicking only on the beat.
 */
export function isAudibleClick(tick: MetronomeTick, config: MetronomeConfig): boolean {
  if (isInSilentBar(tick, config)) {
    return false;
  }
  if (config.click === 'downbeat') {
    return tick.isDownbeat;
  }
  const wanted = clicksPerPulse(config.click, config.timeSignature);
  const every = config.subdivisionsPerPulse / wanted;
  // A click rate the resolution cannot express falls back to the pulse, which
  // is always on the grid.
  return Number.isInteger(every) ? tick.index % every === 0 : tick.isPulse;
}

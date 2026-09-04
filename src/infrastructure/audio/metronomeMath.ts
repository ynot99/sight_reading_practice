import {
  clicksPerPulse,
  type MetronomeConfig,
  type MetronomeTick,
} from '../../application/ports/IMetronome.js';
import type { TimeSignature } from '../../domain/model/TimeSignature.js';
import { DIVISIONS_PER_QUARTER } from '../../domain/model/Duration.js';

/** Seconds occupied by one subdivision at the configured tempo. */
export function subdivisionSeconds(config: MetronomeConfig): number {
  return subdivisionSecondsAt(config, 0);
}

/** The tempo in force at a position, in quarter notes per minute. */
export function bpmAt(config: MetronomeConfig, positionTicks: number): number {
  let current = config.bpm;
  for (const span of config.tempos) {
    if (span.startTicks > positionTicks) {
      break;
    }
    current = span.bpm;
  }
  return current;
}

/**
 * Seconds occupied by the subdivision that *starts* at a given index.
 *
 * A pulse is only even while the piece keeps one tempo. Where it does not,
 * each subdivision lasts as long as the tempo in force where it begins - so a
 * tempo change takes effect at the first tick at or after it, which is as
 * exactly as a grid can place anything.
 */
export function subdivisionSecondsAt(config: MetronomeConfig, index: number): number {
  const secondsPerQuarter = 60 / bpmAt(config, index * ticksPerSubdivision(config));
  const quartersPerPulse = config.timeSignature.ticksPerPulse / DIVISIONS_PER_QUARTER;
  return (secondsPerQuarter * quartersPerPulse) / config.subdivisionsPerPulse;
}

/** Musical divisions covered by one subdivision. */
export function ticksPerSubdivision(config: MetronomeConfig): number {
  return config.timeSignature.ticksPerPulse / config.subdivisionsPerPulse;
}

/**
 * The bar a position falls in, and where that bar began.
 *
 * From the table when there is one, and by counting from the start in the
 * configured metre when there is not - which is the same answer for music
 * that never changes metre, and the only one available for a metronome
 * beating on past the end of the music.
 */
function barAt(
  config: MetronomeConfig,
  positionTicks: number,
): { readonly index: number; readonly startTicks: number; readonly timeSignature: TimeSignature } {
  const bars = config.bars;
  let at = -1;
  for (const [index, bar] of bars.entries()) {
    if (bar.startTicks > positionTicks) {
      break;
    }
    at = index;
  }
  const found = at < 0 ? undefined : bars[at];
  if (found === undefined) {
    const length = config.timeSignature.ticksPerMeasure;
    const index = Math.floor(positionTicks / length);
    return { index, startTicks: index * length, timeSignature: config.timeSignature };
  }
  const length = found.timeSignature.ticksPerMeasure;
  // Past the last bar the last metre repeats: a run that reaches the end
  // keeps a pulse for the mode to finish on, and it has to beat in
  // something.
  const over = at === bars.length - 1 ? Math.floor((positionTicks - found.startTicks) / length) : 0;
  return {
    index: at + over,
    startTicks: found.startTicks + over * length,
    timeSignature: found.timeSignature,
  };
}

/**
 * Derives a tick from its ordinal.
 *
 * Shared by the Web Audio metronome and the manual one used in tests, so both
 * agree on what beat 3 of bar 2 means down to the tick.
 *
 * The pulse itself is even - one subdivision is one length of time, always -
 * and it is only *which* of those ticks begin a bar or a beat that the bars
 * decide. That keeps one clock for a piece that changes metre, and asks of
 * the grid only that it be fine enough to land on every metre's beat, which
 * is what {@link subdivisionsPerPulseFor} sees to.
 */
export function buildMetronomeTick(
  index: number,
  config: MetronomeConfig,
  scheduledTimeMs: number,
): MetronomeTick {
  const positionTicks = index * ticksPerSubdivision(config);
  const bar = barAt(config, positionTicks);
  const into = positionTicks - bar.startTicks;
  const ticksPerPulse = bar.timeSignature.ticksPerPulse;
  return {
    index,
    measure: bar.index,
    beat: Math.floor(into / ticksPerPulse) + 1,
    isPulse: into % ticksPerPulse === 0,
    isDownbeat: into === 0,
    positionTicks,
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
  // Past the last note the pulse still runs, because that is what the mode
  // finishes on, but there is no bar there for it to be the downbeat of.
  if (config.endsAtTicks !== null && tick.positionTicks >= config.endsAtTicks) {
    return false;
  }
  if (isInSilentBar(tick, config)) {
    return false;
  }
  if (config.click === 'downbeat') {
    return tick.isDownbeat;
  }
  // Against the bar this tick is in, not against the metre the piece opened
  // in. Counted from the tick's own ordinal, the click keeps the beat of the
  // opening metre for the whole run: the Minecraft credits open in 6/8 and
  // spend a hundred and forty-eight bars in 4/4, where a click every dotted
  // quarter falls a beat and a half apart and never on a bar line again.
  const bar = barAt(config, tick.positionTicks);
  const wanted = clicksPerPulse(config.click, bar.timeSignature);
  // How far apart the clicks fall, in divisions, and how far apart the ticks
  // do. A click rate the grid cannot land on - finer than a tick, or not a
  // whole number of them - falls back to the pulse, which always is on it.
  const every = bar.timeSignature.ticksPerPulse / wanted;
  const step = ticksPerSubdivision(config);
  if (!Number.isInteger(every) || every < step || every % step !== 0) {
    return tick.isPulse;
  }
  return (tick.positionTicks - bar.startTicks) % every === 0;
}

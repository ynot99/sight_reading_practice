import type { IPitchPlayer } from '../../application/ports/IPitchPlayer.js';

export interface WebAudioPitchPlayerOptions {
  readonly gain?: number;
  readonly releaseSec?: number;
  readonly maxVoices?: number;
}

interface Voice {
  readonly oscillator: OscillatorNode;
  readonly envelope: GainNode;
}

function frequencyOf(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Simple additive tone generator for MIDI controllers without their own sound.
 *
 * Deliberately not a sampled piano: the point is immediate feedback that a key
 * registered, not a convincing instrument. A sampled implementation can
 * replace it behind {@link IPitchPlayer} whenever that becomes worthwhile.
 */
export class WebAudioPitchPlayer implements IPitchPlayer {
  private readonly contextFactory: () => AudioContext;
  private readonly options: Required<WebAudioPitchPlayerOptions>;
  private readonly voices = new Map<number, Voice>();
  private context: AudioContext | null = null;

  constructor(contextFactory: () => AudioContext, options: WebAudioPitchPlayerOptions = {}) {
    this.contextFactory = contextFactory;
    this.options = {
      gain: options.gain ?? 0.16,
      releaseSec: options.releaseSec ?? 0.25,
      maxVoices: options.maxVoices ?? 12,
    };
  }

  play(midi: number, velocity: number): void {
    const context = this.ensureContext();
    this.stop(midi);
    if (this.voices.size >= this.options.maxVoices) {
      const oldest = this.voices.keys().next();
      if (!oldest.done) {
        this.stop(oldest.value);
      }
    }

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequencyOf(midi);

    const peak = Math.max(0.02, this.options.gain * Math.max(0.2, velocity));
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    envelope.gain.exponentialRampToValueAtTime(peak * 0.55, now + 0.35);

    oscillator.connect(envelope).connect(context.destination);
    oscillator.start(now);
    this.voices.set(midi, { oscillator, envelope });
  }

  stop(midi: number): void {
    const voice = this.voices.get(midi);
    if (voice === undefined || this.context === null) {
      return;
    }
    this.voices.delete(midi);

    const now = this.context.currentTime;
    const release = this.options.releaseSec;
    voice.envelope.gain.cancelScheduledValues(now);
    voice.envelope.gain.setValueAtTime(Math.max(0.0001, voice.envelope.gain.value), now);
    voice.envelope.gain.exponentialRampToValueAtTime(0.0001, now + release);
    voice.oscillator.stop(now + release + 0.02);
  }

  stopAll(): void {
    for (const midi of [...this.voices.keys()]) {
      this.stop(midi);
    }
  }

  private ensureContext(): AudioContext {
    if (this.context === null) {
      this.context = this.contextFactory();
    }
    void this.context.resume();
    return this.context;
  }
}

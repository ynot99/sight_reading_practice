import type { IPitchPlayer } from '../../application/ports/IPitchPlayer.js';
import { volumeToGain, type IVolumeControl } from '../../application/ports/IVolumeControl.js';
import { audioTimeFor, beginRelease } from './audioTime.js';

export interface WebAudioPitchPlayerOptions {
  readonly gain?: number;
  readonly releaseSec?: number;
  readonly maxVoices?: number;
}

interface Voice {
  readonly oscillator: OscillatorNode;
  readonly envelope: GainNode;
  /** Level the envelope holds between attack and release. */
  readonly peak: number;
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
export class WebAudioPitchPlayer implements IPitchPlayer, IVolumeControl {
  private readonly contextFactory: () => AudioContext;
  private readonly options: Required<WebAudioPitchPlayerOptions>;
  private readonly voices = new Map<number, Voice>();
  private context: AudioContext | null = null;
  private currentVolume = 1;

  constructor(contextFactory: () => AudioContext, options: WebAudioPitchPlayerOptions = {}) {
    this.contextFactory = contextFactory;
    this.options = {
      gain: options.gain ?? 0.16,
      releaseSec: options.releaseSec ?? 0.25,
      maxVoices: options.maxVoices ?? 12,
    };
  }

  get volume(): number {
    return this.currentVolume;
  }

  /** Takes effect from the next note; sounding ones are left alone. */
  setVolume(volume: number): void {
    this.currentVolume = Math.min(1, Math.max(0, volume));
  }

  play(midi: number, velocity: number, atMs?: number): void {
    const level = volumeToGain(this.currentVolume, this.options.gain);
    if (level <= 0) {
      return;
    }
    const context = this.ensureContext();
    // At the moment the new note sounds, not at the moment it was handed
    // over: a playback schedules notes ahead, and ending the ringing one
    // early leaves a hole before every repeated note.
    this.stop(midi, atMs);
    if (this.voices.size >= this.options.maxVoices) {
      const oldest = this.voices.keys().next();
      if (!oldest.done) {
        this.stop(oldest.value);
      }
    }

    const now = audioTimeFor(context, atMs);
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.value = frequencyOf(midi);

    const peak = Math.max(0.001, level * Math.max(0.2, velocity));
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    envelope.gain.exponentialRampToValueAtTime(peak * 0.55, now + 0.35);

    oscillator.connect(envelope).connect(context.destination);
    oscillator.start(now);
    this.voices.set(midi, { oscillator, envelope, peak });
  }

  stop(midi: number, atMs?: number): void {
    const voice = this.voices.get(midi);
    if (voice === undefined || this.context === null) {
      return;
    }
    this.voices.delete(midi);

    const now = audioTimeFor(this.context, atMs);
    const release = this.options.releaseSec;
    beginRelease(voice.envelope.gain, now, release, {
      now: this.context.currentTime,
      peak: voice.peak,
    });
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

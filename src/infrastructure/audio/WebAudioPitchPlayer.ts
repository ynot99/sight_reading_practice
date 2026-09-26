import type { IPitchPlayer } from '../../application/ports/IPitchPlayer.js';
import { volumeToGain, type IVolumeControl } from '../../application/ports/IVolumeControl.js';
import { audioTimeFor, beginRelease, takeBack, tooLateToSound, unplug } from './audioTime.js';
import { timeTheStart } from '../../shared/timeTheStart.js';

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
  /** When it begins, on the audio clock: later than now for a note handed over ahead. */
  readonly startsAt: number;
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
  /** The note each key is sounding, while its key is down. */
  private readonly voices = new Map<number, Voice>();
  /**
   * Every note started and not yet over, its key up or not: what silencing
   * everything has to reach. See the sampled player's, which this stands in for.
   */
  private readonly sounding = new Set<Voice>();
  private context: AudioContext | null = null;
  private currentVolume = 1;

  constructor(contextFactory: () => AudioContext, options: WebAudioPitchPlayerOptions = {}) {
    this.contextFactory = contextFactory;
    this.options = {
      gain: options.gain ?? 0.16,
      releaseSec: options.releaseSec ?? 0.25,
      // Enough for a pedalled passage; see `SampledPitchPlayerOptions`. An
      // oscillator costs less than a sample, so this is the cheaper of the
      // two to leave room in.
      maxVoices: options.maxVoices ?? 64,
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
    if (tooLateToSound(atMs, performance.now())) {
      timeTheStart(
        'stand-in tone: a note dropped as too late',
        () => `${String(Math.round(performance.now() - (atMs ?? 0)))} ms late`,
      );
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

    // The same floor the sampled player keeps: low enough that ppp is nearly
    // nothing, high enough that a note is still heard.
    const peak = Math.max(0.001, level * Math.max(0.05, velocity));
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    envelope.gain.exponentialRampToValueAtTime(peak * 0.55, now + 0.35);

    oscillator.connect(envelope).connect(context.destination);
    const voice: Voice = { oscillator, envelope, peak, startsAt: now };
    oscillator.onended = () => {
      this.sounding.delete(voice);
      unplug(oscillator, envelope);
    };
    oscillator.start(now);
    timeTheStart('first note sounded (fallback tone)');
    this.voices.set(midi, voice);
    this.sounding.add(voice);
  }

  stop(midi: number, atMs?: number): void {
    const voice = this.voices.get(midi);
    if (voice === undefined || this.context === null) {
      return;
    }
    this.voices.delete(midi);
    this.release(voice, this.context, audioTimeFor(this.context, atMs));
  }

  stopAll(): void {
    this.voices.clear();
    const context = this.context;
    if (context === null) {
      this.sounding.clear();
      return;
    }
    const now = context.currentTime;
    for (const voice of [...this.sounding]) {
      this.sounding.delete(voice);
      if (voice.startsAt > now) {
        takeBack(voice.oscillator, voice.envelope, now);
      } else {
        this.release(voice, context, now);
      }
    }
  }

  private release(voice: Voice, context: AudioContext, at: number): void {
    const release = this.options.releaseSec;
    beginRelease(voice.envelope.gain, at, release, {
      now: context.currentTime,
      peak: voice.peak,
    });
    try {
      voice.oscillator.stop(at + release + 0.02);
    } catch {
      // Refused as a second stop, by an older engine; the release still fades it.
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

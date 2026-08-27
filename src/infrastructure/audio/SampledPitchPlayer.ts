import type {
  IPitchPlayer,
  ISampleLibrary,
  ISustainPedal,
  SampleLoading,
} from '../../application/ports/IPitchPlayer.js';
import { SilentPitchPlayer } from '../../application/ports/IPitchPlayer.js';
import { volumeToGain, type IVolumeControl } from '../../application/ports/IVolumeControl.js';
import { PIANO_SAMPLES, nearestSample, playbackRateFor } from './pianoSampleMap.js';

export type AudioFetcher = (url: string) => Promise<ArrayBuffer>;

/** Not every pitch player has a volume; the built-in ones do. */
function hasVolumeControl(player: IPitchPlayer): player is IPitchPlayer & IVolumeControl {
  return typeof (player as Partial<IVolumeControl>).setVolume === 'function';
}

function hasSustain(player: IPitchPlayer): player is IPitchPlayer & ISustainPedal {
  return typeof (player as Partial<ISustainPedal>).setSustain === 'function';
}

export const fetchAudioBuffer: AudioFetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }
  return response.arrayBuffer();
};

export interface SampledPitchPlayerOptions {
  /** Directory holding the sample files, ending in a slash. */
  readonly baseUrl: string;
  /** Sounds the notes until the samples have arrived. */
  readonly fallback?: IPitchPlayer;
  readonly gain?: number;
  readonly releaseSec?: number;
  readonly maxVoices?: number;
  readonly fetchAudio?: AudioFetcher;
  readonly loading?: SampleLoading;
}

/** Fade applied at the end of a recording, which is cut rather than faded. */
const END_FADE_SEC = 0.4;

interface Voice {
  readonly source: AudioBufferSourceNode;
  readonly envelope: GainNode;
}

/**
 * A real piano, from thirty recordings of one.
 *
 * The library this comes from is 1.9 GB, which is not a thing a browser can
 * download. What ships instead is one velocity layer, one note every three
 * semitones, trimmed to five seconds and made mono: 1.7 MB. Keys in between
 * are covered by resampling the nearest neighbour, never more than a semitone
 * away, which is inaudible on a piano.
 *
 * Loading is lazy and never blocks: until the buffers are decoded - and for
 * any sample that failed to arrive - notes are handed to the fallback player,
 * so a key always makes a sound.
 */
export class SampledPitchPlayer
  implements IPitchPlayer, IVolumeControl, ISustainPedal, ISampleLibrary
{
  private readonly contextFactory: () => AudioContext;
  private readonly baseUrl: string;
  private readonly fallback: IPitchPlayer;
  private readonly fetchAudio: AudioFetcher;
  private readonly options: Required<
    Omit<SampledPitchPlayerOptions, 'baseUrl' | 'fallback' | 'fetchAudio' | 'loading'>
  >;

  private readonly buffers = new Map<number, AudioBuffer>();
  private readonly voices = new Map<number, Voice>();
  private readonly onFallback = new Set<number>();

  /** Keys released while the pedal was down; the dampers are still up. */
  private readonly heldByPedal = new Set<number>();

  private context: AudioContext | null = null;
  private loadPromise: Promise<void> | null = null;
  private currentVolume = 1;
  private pedalDown = false;
  private loadingMode: SampleLoading;

  constructor(contextFactory: () => AudioContext, options: SampledPitchPlayerOptions) {
    this.contextFactory = contextFactory;
    this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;
    this.fallback = options.fallback ?? new SilentPitchPlayer();
    this.fetchAudio = options.fetchAudio ?? fetchAudioBuffer;
    this.loadingMode = options.loading ?? 'lazy';
    this.options = {
      gain: options.gain ?? 1,
      releaseSec: options.releaseSec ?? 0.35,
      maxVoices: options.maxVoices ?? 16,
    };
  }

  /** How many samples are decoded and ready. */
  get loadedCount(): number {
    return this.buffers.size;
  }

  get isReady(): boolean {
    return this.buffers.size > 0;
  }

  get ready(): boolean {
    return this.isReady;
  }

  get loading(): SampleLoading {
    return this.loadingMode;
  }

  /**
   * Switching off releases the decoded audio as well as stopping the
   * download: it is the larger of the two costs by a wide margin.
   */
  setLoading(mode: SampleLoading): void {
    if (this.loadingMode === mode) {
      return;
    }
    this.loadingMode = mode;
    if (mode === 'off') {
      this.stopAll();
      this.buffers.clear();
      this.loadPromise = null;
      return;
    }
    if (mode === 'eager') {
      void this.load();
    }
  }

  get volume(): number {
    return this.currentVolume;
  }

  setVolume(volume: number): void {
    this.currentVolume = Math.min(1, Math.max(0, volume));
    if (hasVolumeControl(this.fallback)) {
      // The stand-in has to follow the same slider, or the sound would jump
      // when the samples finish loading.
      this.fallback.setVolume(this.currentVolume);
    }
  }

  get sustained(): boolean {
    return this.pedalDown;
  }

  /**
   * Lifts or drops the dampers.
   *
   * While the pedal is down a released key keeps ringing, exactly as on the
   * instrument; letting the pedal up damps everything that was waiting on it.
   */
  setSustain(down: boolean): void {
    if (this.pedalDown === down) {
      return;
    }
    this.pedalDown = down;
    if (hasSustain(this.fallback)) {
      this.fallback.setSustain(down);
    }
    if (down) {
      return;
    }
    for (const midi of [...this.heldByPedal]) {
      this.heldByPedal.delete(midi);
      this.releaseNow(midi);
    }
  }

  /**
   * Downloads and decodes the samples. Safe to call repeatedly; the work
   * happens once.
   */
  load(): Promise<void> {
    if (this.loadingMode === 'off') {
      return Promise.resolve();
    }
    this.loadPromise ??= this.loadAll();
    return this.loadPromise;
  }

  play(midi: number, velocity: number): void {
    const level = volumeToGain(this.currentVolume, this.options.gain);
    if (level <= 0) {
      return;
    }
    // First key press is what starts the download, so nothing is fetched for
    // a reader who never turns the sound on.
    void this.load();
    this.heldByPedal.delete(midi);

    const choice = nearestSample(midi);
    const buffer = this.buffers.get(choice.sample.midi);
    if (buffer === undefined) {
      this.onFallback.add(midi);
      this.fallback.play(midi, velocity);
      return;
    }

    const context = this.ensureContext();
    // Striking the key again re-hits the string, pedal or no pedal, so this
    // must not go through stop(), which would hand the voice to the pedal.
    this.releaseNow(midi);
    this.evictOldestIfFull();

    const now = context.currentTime;
    const source = context.createBufferSource();
    const envelope = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRateFor(choice.semitones);

    const peak = level * Math.max(0.15, velocity);
    // The recording carries its own attack; this only avoids a click.
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(peak, now + 0.006);

    // The recordings are cut, not faded, so a note held to the very end would
    // stop dead. Resampling changes how long the buffer lasts, so the fade
    // has to follow the playback rate.
    const playedSeconds = buffer.duration / source.playbackRate.value;
    if (playedSeconds > END_FADE_SEC) {
      envelope.gain.setValueAtTime(peak, now + playedSeconds - END_FADE_SEC);
      envelope.gain.linearRampToValueAtTime(0.0001, now + playedSeconds);
    }

    source.connect(envelope).connect(context.destination);
    source.start(now);
    source.onended = () => {
      if (this.voices.get(midi)?.source === source) {
        this.voices.delete(midi);
      }
    };
    this.voices.set(midi, { source, envelope });
  }

  stop(midi: number): void {
    if (this.pedalDown) {
      // The key is up but the damper is not: remember it for the pedal lift.
      this.heldByPedal.add(midi);
      if (this.onFallback.has(midi)) {
        this.fallback.stop(midi);
      }
      return;
    }
    this.releaseNow(midi);
  }

  private releaseNow(midi: number): void {
    if (this.onFallback.delete(midi)) {
      this.fallback.stop(midi);
      return;
    }
    const voice = this.voices.get(midi);
    if (voice === undefined || this.context === null) {
      return;
    }
    this.voices.delete(midi);
    this.release(voice, this.context.currentTime);
  }

  stopAll(): void {
    this.heldByPedal.clear();
    for (const midi of [...this.onFallback]) {
      this.onFallback.delete(midi);
    }
    this.fallback.stopAll();

    const context = this.context;
    if (context === null) {
      this.voices.clear();
      return;
    }
    const now = context.currentTime;
    for (const [midi, voice] of [...this.voices]) {
      this.voices.delete(midi);
      this.release(voice, now);
    }
  }

  private release(voice: Voice, now: number): void {
    const release = this.options.releaseSec;
    try {
      voice.envelope.gain.cancelScheduledValues(now);
      voice.envelope.gain.setValueAtTime(Math.max(0.0001, voice.envelope.gain.value), now);
      voice.envelope.gain.exponentialRampToValueAtTime(0.0001, now + release);
      voice.source.stop(now + release + 0.02);
    } catch {
      // The source had already finished on its own.
    }
  }

  private evictOldestIfFull(): void {
    if (this.voices.size < this.options.maxVoices) {
      return;
    }
    const oldest = this.voices.keys().next();
    if (!oldest.done) {
      // Making room has to actually free the voice, even under the pedal.
      this.heldByPedal.delete(oldest.value);
      this.releaseNow(oldest.value);
    }
  }

  private async loadAll(): Promise<void> {
    const context = this.ensureContext();
    await Promise.all(
      PIANO_SAMPLES.map(async (sample) => {
        try {
          const data = await this.fetchAudio(`${this.baseUrl}${sample.name}.mp3`);
          this.buffers.set(sample.midi, await context.decodeAudioData(data));
        } catch {
          // One missing note falls back; it must not sink the other twenty-nine.
        }
      }),
    );
  }

  private ensureContext(): AudioContext {
    if (this.context === null) {
      this.context = this.contextFactory();
    }
    void this.context.resume();
    return this.context;
  }
}

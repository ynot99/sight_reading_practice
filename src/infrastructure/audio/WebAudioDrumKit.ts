import type { IPitchPlayer } from '../../application/ports/IPitchPlayer.js';
import { volumeToGain } from '../../application/ports/IVolumeControl.js';
import { AudioClockReading, audioTimeFor, takeBack, tooLateToSound, unplug } from './audioTime.js';

export interface WebAudioDrumKitOptions {
  readonly gain?: number;
  /** The crossing between the clocks shared with the instrument, so a hit lands where its note would. */
  readonly reading?: AudioClockReading;
}

/**
 * One layer of a drum's sound. A tone that falls from one pitch to another
 * as it dies, which is what makes a skin sound struck; or noise through a
 * filter, which is what a snare's wires and a cymbal are. Its share of the
 * hit's loudness, and how long it rings, in seconds.
 */
type Layer =
  | { readonly tone: OscillatorType; readonly from: number; readonly to: number; readonly share: number; readonly lasts: number }
  | { readonly noise: BiquadFilterType; readonly at: number; readonly share: number; readonly lasts: number };

/**
 * How each drum of the kit is made, by its number: see `DRUM_KIT`, whose
 * order this follows. Made rather than fetched, as the hit of rhythm only
 * is, so a sketch's drums cost no download.
 */
const THE_DRUMS: ReadonlyMap<number, readonly Layer[]> = new Map([
  [36, [{ tone: 'sine', from: 150, to: 45, share: 1, lasts: 0.35 }, { tone: 'triangle', from: 1_200, to: 1_200, share: 0.3, lasts: 0.015 }]],
  [37, [{ noise: 'highpass', at: 1_500, share: 0.8, lasts: 0.18 }, { tone: 'triangle', from: 220, to: 180, share: 0.5, lasts: 0.1 }]],
  [38, [{ noise: 'bandpass', at: 1_200, share: 1, lasts: 0.15 }]],
  [39, [{ noise: 'highpass', at: 7_000, share: 0.5, lasts: 0.05 }]],
  [40, [{ noise: 'highpass', at: 7_000, share: 0.5, lasts: 0.35 }]],
  [41, [{ tone: 'sine', from: 120, to: 80, share: 0.9, lasts: 0.3 }]],
  [42, [{ tone: 'sine', from: 200, to: 140, share: 0.9, lasts: 0.25 }]],
  [43, [{ noise: 'highpass', at: 5_000, share: 0.35, lasts: 0.6 }]],
  [44, [{ noise: 'highpass', at: 4_000, share: 0.5, lasts: 1.2 }]],
]);

/** How long the noise a context keeps lasts: longer than the longest drum rings. */
const NOISE_SECONDS = 1.5;

/** One layer sounding, with what it takes to silence it. */
interface Sounding {
  readonly source: AudioScheduledSourceNode;
  readonly envelope: GainNode;
  readonly filter: BiquadFilterNode | null;
  /** When it begins, on the audio clock: later than now for one handed over ahead. */
  readonly startsAt: number;
}

/**
 * The drums a sketch is written with, as an instrument: each key a drum of
 * the kit, struck now or at a moment handed over ahead, and over by itself.
 *
 * As loud as the instrument, as the hit of rhythm only is: the drums are
 * heard beside the notes, and a writer who turned the piano down has said
 * how loud the music should be.
 */
export class WebAudioDrumKit implements IPitchPlayer {
  private readonly contextFactory: () => AudioContext;
  private readonly instrumentVolume: () => number;
  private readonly gain: number;
  private readonly reading: AudioClockReading;
  /** Every layer handed over and not yet over: what silencing has to reach. */
  private readonly sounding = new Set<Sounding>();
  private context: AudioContext | null = null;
  /** The noise the snare and the cymbals are made of, made once for the context. */
  private noise: AudioBuffer | null = null;

  constructor(
    contextFactory: () => AudioContext,
    instrumentVolume: () => number,
    options: WebAudioDrumKitOptions = {},
  ) {
    this.contextFactory = contextFactory;
    this.instrumentVolume = instrumentVolume;
    this.gain = options.gain ?? 0.5;
    this.reading = options.reading ?? new AudioClockReading();
  }

  /** Strikes the drum a number names, if the kit has one by it. */
  play(midi: number, velocity: number, atMs?: number): void {
    const layers = THE_DRUMS.get(midi);
    const level = volumeToGain(this.instrumentVolume(), this.gain);
    if (layers === undefined || level <= 0) {
      return;
    }
    const context = this.ensureContext();
    if (tooLateToSound(atMs, performance.now(), { context, reading: this.reading })) {
      return;
    }
    const at = audioTimeFor(context, atMs, this.reading);
    // The same floor the instrument keeps, so the softest hit is still heard.
    const loudness = level * Math.max(0.05, velocity);
    for (const layer of layers) {
      this.sound(context, layer, at, Math.max(0.001, loudness * layer.share));
    }
  }

  /** A drum has no length to cut: it is over by itself, whenever the key comes up. */
  stop(_midi: number, _atMs?: number): void {
    // Intentionally nothing.
  }

  stopAll(): void {
    const now = this.context?.currentTime ?? 0;
    for (const layer of this.sounding) {
      takeBack(layer.source, layer.envelope, now);
    }
    this.sounding.clear();
  }

  takeBackFrom(atMs: number): void {
    const context = this.context;
    if (context === null) {
      return;
    }
    const from = audioTimeFor(context, atMs, this.reading);
    for (const layer of this.sounding) {
      if (layer.startsAt > from) {
        takeBack(layer.source, layer.envelope, context.currentTime);
        this.sounding.delete(layer);
      }
    }
  }

  private sound(context: AudioContext, layer: Layer, at: number, peak: number): void {
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(peak, at + 0.002);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + layer.lasts);
    let source: AudioScheduledSourceNode;
    let filter: BiquadFilterNode | null = null;
    if ('tone' in layer) {
      const tone = context.createOscillator();
      tone.type = layer.tone;
      tone.frequency.setValueAtTime(layer.from, at);
      if (layer.to !== layer.from) {
        tone.frequency.exponentialRampToValueAtTime(layer.to, at + layer.lasts * 0.4);
      }
      tone.connect(envelope).connect(context.destination);
      source = tone;
    } else {
      const noise = context.createBufferSource();
      noise.buffer = this.theNoise(context);
      filter = context.createBiquadFilter();
      filter.type = layer.noise;
      filter.frequency.setValueAtTime(layer.at, at);
      noise.connect(filter).connect(envelope).connect(context.destination);
      source = noise;
    }
    const sounding: Sounding = { source, envelope, filter, startsAt: at };
    source.onended = () => {
      this.sounding.delete(sounding);
      unplug(source, envelope);
      filter?.disconnect();
    };
    source.start(at);
    source.stop(at + layer.lasts + 0.01);
    this.sounding.add(sounding);
  }

  private theNoise(context: AudioContext): AudioBuffer {
    if (this.noise === null) {
      const length = Math.round(context.sampleRate * NOISE_SECONDS);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let at = 0; at < length; at += 1) {
        samples[at] = Math.random() * 2 - 1;
      }
      this.noise = buffer;
    }
    return this.noise;
  }

  private ensureContext(): AudioContext {
    if (this.context === null) {
      this.context = this.contextFactory();
    }
    void this.context.resume();
    return this.context;
  }
}

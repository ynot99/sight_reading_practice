import type {
  IPitchPlayer,
  ISampleLibrary,
  ISustainPedal,
  SampleLoading,
} from '../../application/ports/IPitchPlayer.js';
import { SilentPitchPlayer } from '../../application/ports/IPitchPlayer.js';
import { volumeToGain, type IVolumeControl } from '../../application/ports/IVolumeControl.js';
import { PIANO_SAMPLES, nearestSample, playbackRateFor } from './pianoSampleMap.js';
import {
  AudioClockReading,
  audioTimeFor,
  beginRelease,
  takeBack,
  theAudioClocks,
  tooLateToSound,
  unplug,
} from './audioTime.js';
import { timeTheStart } from '../../shared/timeTheStart.js';
import { loudnessFor, type KeySounds, type Strike, type Voice } from './keySound.js';
import type { SoundFont, SoundFontPreset } from './soundFont.js';
import { SoundFontSounds } from './soundFontSounds.js';
import { noteANoteHanded, noteAnEvent } from '../../shared/playbackTimings.js';

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
  /**
   * Notes that may sound at once before the oldest is taken to make room.
   *
   * A piano has eighty-eight strings and a pedalled passage can have most of
   * them ringing: measured on a reader's own recording, played with the
   * pedal down throughout, twenty-three notes were sounding at any moment
   * and thirty-nine at the thickest. A ceiling of sixteen - which is what a
   * synthesiser voice count looks like - was therefore reached ninety-three
   * per cent of the time, and every note struck past it cut a note that was
   * still being heard. That is a hole in the sound several times a second,
   * and it is what a pedalled recording sounded like coming back.
   */
  readonly maxVoices?: number;
  readonly fetchAudio?: AudioFetcher;
  readonly loading?: SampleLoading;
  /** The crossing between the clocks shared with the metronome, so a note lands where its click does. */
  readonly reading?: AudioClockReading;
}

/** Fade applied at the end of a recording, which is cut rather than faded. */
const END_FADE_SEC = 0.4;

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
/**
 * A filter that opens as the note is struck harder, or `null` where the
 * device cannot make one.
 *
 * Two octaves of brightness between the softest and the loudest, which is
 * about what a piano gives and well short of what a synthesiser would. Every
 * older browser that lacks the node simply gets the note it got before.
 */
function toneFor(context: AudioContext, velocity: number): BiquadFilterNode | null {
  if (typeof context.createBiquadFilter !== 'function') {
    return null;
  }
  const how = Math.min(1, Math.max(0, velocity));
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  // 1.4 kHz at the quietest, 18 kHz at the loudest: a curve rather than a
  // line, because loudness is heard that way and so is brightness.
  filter.frequency.value = 1_400 * 2 ** (how * 3.7);
  filter.Q.value = 0.7;
  return filter;
}

export class SampledPitchPlayer
  implements IPitchPlayer, IVolumeControl, ISustainPedal, ISampleLibrary
{
  private readonly contextFactory: () => AudioContext;
  private readonly baseUrl: string;
  private readonly fallback: IPitchPlayer;
  private readonly fetchAudio: AudioFetcher;
  private readonly options: Required<
    Omit<SampledPitchPlayerOptions, 'baseUrl' | 'fallback' | 'fetchAudio' | 'loading' | 'reading'>
  >;

  private readonly buffers = new Map<number, AudioBuffer>();
  /** The note each key is sounding, while its key or the pedal holds it. */
  private readonly voices = new Map<number, Voice>();
  /**
   * Every note started and not yet over, its key up or not.
   *
   * A playback hands a note over with its end already scheduled, so its key
   * is up - and it is out of `voices` - before it has even begun. Silencing
   * only `voices` left every note handed over ahead to play on after a pause,
   * and every note still ringing to ring to its end. His: "коли ставлю
   * playback на паузу за пів біту, то курсор зупиняється одразу, а playback
   * після пів біту потім ще зіграє ноту".
   */
  private readonly sounding = new Set<Voice>();
  private readonly onFallback = new Set<number>();
  /** The built-in recordings, as a source of the keys' sound like any other. */
  private readonly theRecordings: KeySounds = { strike: (strike) => this.strikeTheRecording(strike) };
  /** Where the keys get their sound: the built-in recordings unless another was chosen. */
  private keySounds: KeySounds = this.theRecordings;

  /** Keys released while the pedal was down; the dampers are still up. */
  private readonly heldByPedal = new Set<number>();

  private context: AudioContext | null = null;
  private loadPromise: Promise<void> | null = null;
  private currentVolume = 1;
  private pedalDown = false;
  private loadingMode: SampleLoading;
  private readonly reading: AudioClockReading;

  constructor(contextFactory: () => AudioContext, options: SampledPitchPlayerOptions) {
    this.contextFactory = contextFactory;
    this.baseUrl = options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`;
    this.fallback = options.fallback ?? new SilentPitchPlayer();
    this.fetchAudio = options.fetchAudio ?? fetchAudioBuffer;
    this.loadingMode = options.loading ?? 'lazy';
    this.reading = options.reading ?? new AudioClockReading();
    this.options = {
      gain: options.gain ?? 1,
      releaseSec: options.releaseSec ?? 0.35,
      maxVoices: options.maxVoices ?? 64,
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

  /**
   * Sounds the keys from one preset of a soundfont, or from the built-in
   * recordings again for `null`.
   *
   * Whatever is sounding is let go of first: a note struck on one
   * instrument and released on another would never be released.
   */
  useSoundFont(chosen: { readonly font: SoundFont; readonly preset: SoundFontPreset } | null): void {
    this.stopAll();
    this.keySounds = chosen === null ? this.theRecordings : new SoundFontSounds(chosen.font, chosen.preset);
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

  play(midi: number, velocity: number, atMs?: number): void {
    const level = volumeToGain(this.currentVolume, this.options.gain);
    if (level <= 0) {
      return;
    }
    // Asked before anything is fetched or decoded, so that a page catching up
    // after a stall does no work at all for the notes it is dropping.
    const context = this.ensureContext();
    const gone = tooLateToSound(atMs, performance.now(), { context, reading: this.reading });
    noteANoteHanded(atMs, gone, theAudioClocks(context, this.reading));
    if (gone) {
      timeTheStart(
        'instrument: a note dropped as too late',
        () => `${String(Math.round(performance.now() - (atMs ?? 0)))} ms late`,
      );
      return;
    }
    this.heldByPedal.delete(midi);

    // Striking the key again re-hits the string, pedal or no pedal, so this
    // must not go through stop(), which would hand the voice to the pedal.
    // It happens when the new note sounds, not when it was handed over: a
    // playback hands notes a quarter of a second early, and damping the
    // ringing note *there* is a hole in the sound before every repeat.
    let voice: Voice | null = null;
    const ended = (): void => {
      if (voice !== null && this.voices.get(midi) === voice) {
        this.voices.delete(midi);
      }
      if (voice !== null) {
        this.sounding.delete(voice);
      }
    };
    voice = this.keySounds.strike({ context, midi, velocity, at: audioTimeFor(context, atMs, this.reading), level, ended });
    if (voice === null) {
      timeTheStart('instrument: a note on the stand-in tone, the samples still loading');
      this.onFallback.add(midi);
      this.fallback.play(midi, velocity, atMs);
      return;
    }
    // The one ringing is still the key's until the new one is put there.
    this.releaseNow(midi, atMs);
    this.evictOldestIfFull();
    timeTheStart('first note sounded');
    this.voices.set(midi, voice);
    this.sounding.add(voice);
  }

  /** A key struck on the built-in recordings, or `null` while its recording has not arrived. */
  private strikeTheRecording({ context, midi, velocity, at: now, level, ended }: Strike): Voice | null {
    // First key press is what starts the download, so nothing is fetched for
    // a reader who never turns the sound on.
    void this.load();
    const choice = nearestSample(midi);
    const buffer = this.buffers.get(choice.sample.midi);
    if (buffer === undefined) {
      return null;
    }

    const source = context.createBufferSource();
    const envelope = context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRateFor(choice.semitones);

    const peak = level * loudnessFor(velocity);
    // Brightness with loudness. The recordings are one velocity layer, so a
    // quiet note is the same recording turned down - which the ear hears as
    // the same note, not as a quieter touch. Rolling the top off it is the
    // cheapest honest imitation of the layers this library has and we do not
    // ship: soft is dull, hard is open.
    const tone = toneFor(context, velocity);
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

    if (tone === null) {
      source.connect(envelope).connect(context.destination);
    } else {
      source.connect(tone).connect(envelope).connect(context.destination);
    }
    source.start(now);
    source.onended = () => {
      unplug(source, ...(tone === null ? [] : [tone]), envelope);
      ended();
    };
    const releaseSec = this.options.releaseSec;
    return {
      startsAt: now,
      release: (at, current) => {
        try {
          beginRelease(envelope.gain, at, releaseSec, { now: current, peak });
          source.stop(at + releaseSec + 0.02);
        } catch {
          // The source had already finished on its own.
        }
      },
      takeBack: (current) => {
        takeBack(source, envelope, current);
      },
    };
  }

  stop(midi: number, atMs?: number): void {
    if (this.pedalDown) {
      // The key is up but the damper is not: remember it for the pedal lift.
      this.heldByPedal.add(midi);
      if (this.onFallback.has(midi)) {
        this.fallback.stop(midi, atMs);
      }
      return;
    }
    this.releaseNow(midi, atMs);
  }

  private releaseNow(midi: number, atMs?: number): void {
    if (this.onFallback.delete(midi)) {
      this.fallback.stop(midi, atMs);
      return;
    }
    const voice = this.voices.get(midi);
    if (voice === undefined || this.context === null) {
      return;
    }
    this.voices.delete(midi);
    voice.release(audioTimeFor(this.context, atMs, this.reading), this.context.currentTime);
  }

  stopAll(): void {
    this.heldByPedal.clear();
    for (const midi of [...this.onFallback]) {
      this.onFallback.delete(midi);
    }
    this.fallback.stopAll();

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
        voice.takeBack(now);
      } else {
        voice.release(now, now);
      }
    }
  }

  takeBackFrom(atMs: number): void {
    this.fallback.takeBackFrom(atMs);
    const context = this.context;
    if (context === null) {
      return;
    }
    const from = audioTimeFor(context, atMs, this.reading);
    const now = context.currentTime;
    // Only from what is sounding: a note handed over ahead was told its end
    // with it, so no key is still down on one that has not begun.
    for (const voice of [...this.sounding]) {
      if (voice.startsAt > from) {
        this.sounding.delete(voice);
        voice.takeBack(now);
      }
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
    // For the playback's timings: fetching and decoding thirty recordings is
    // work the first playback of a page does beside its first notes.
    noteAnEvent("the piano's recordings asked for");
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
    noteAnEvent(`the piano's recordings decoded, ${String(this.buffers.size)} of ${String(PIANO_SAMPLES.length)}`);
  }

  private ensureContext(): AudioContext {
    if (this.context === null) {
      this.context = this.contextFactory();
    }
    void this.context.resume();
    return this.context;
  }
}

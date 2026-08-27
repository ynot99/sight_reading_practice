import { describe, expect, it, vi } from 'vitest';
import type { IPitchPlayer, SampleLoading } from '../../src/application/ports/IPitchPlayer.js';
import { SampledPitchPlayer } from '../../src/infrastructure/audio/SampledPitchPlayer.js';
import {
  HIGHEST_SAMPLED_MIDI,
  LOWEST_SAMPLED_MIDI,
  PIANO_SAMPLES,
  nearestSample,
  playbackRateFor,
} from '../../src/infrastructure/audio/pianoSampleMap.js';

class FakeParam {
  value = 1;
  readonly ramps: { value: number; time: number }[] = [];

  setValueAtTime(value: number, time: number): FakeParam {
    this.value = value;
    this.ramps.push({ value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): FakeParam {
    this.ramps.push({ value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): FakeParam {
    this.ramps.push({ value, time });
    return this;
  }

  cancelScheduledValues(): FakeParam {
    return this;
  }
}

class FakeSource {
  buffer: unknown = null;
  readonly playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;

  connect(target: unknown): unknown {
    return target;
  }

  start(at: number): void {
    this.startedAt = at;
  }

  stop(at: number): void {
    this.stoppedAt = at;
  }
}

class FakeGain {
  readonly gain = new FakeParam();

  connect(target: unknown): unknown {
    return target;
  }
}

class FakeAudioContext {
  currentTime = 0;
  readonly destination = {};
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  decoded: string[] = [];

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }

  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
    this.decoded.push(String(data.byteLength));
    return Promise.resolve({ duration: 5 } as unknown as AudioBuffer);
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }
}

class RecordingFallback implements IPitchPlayer {
  readonly played: number[] = [];
  readonly stopped: number[] = [];
  stopAllCalls = 0;
  volume = 1;
  sustained = false;

  setSustain(down: boolean): void {
    this.sustained = down;
  }

  play(midi: number): void {
    this.played.push(midi);
  }

  stop(midi: number): void {
    this.stopped.push(midi);
  }

  stopAll(): void {
    this.stopAllCalls += 1;
  }

  setVolume(volume: number): void {
    this.volume = volume;
  }
}

function createPlayer(options: { failing?: readonly string[]; loading?: SampleLoading } = {}): {
  player: SampledPitchPlayer;
  context: FakeAudioContext;
  fallback: RecordingFallback;
  requested: string[];
} {
  const context = new FakeAudioContext();
  const fallback = new RecordingFallback();
  const requested: string[] = [];

  const player = new SampledPitchPlayer(() => context as unknown as AudioContext, {
    baseUrl: 'samples/piano',
    fallback,
    ...(options.loading === undefined ? {} : { loading: options.loading }),
    fetchAudio: (url) => {
      requested.push(url);
      if ((options.failing ?? []).some((name) => url.endsWith(`${name}.mp3`))) {
        return Promise.reject(new Error('404'));
      }
      return Promise.resolve(new ArrayBuffer(8));
    },
  });

  return { player, context, fallback, requested };
}

describe('piano sample map', () => {
  it('covers the whole keyboard, every third semitone', () => {
    expect(PIANO_SAMPLES).toHaveLength(30);
    expect(PIANO_SAMPLES[0]).toEqual({ midi: LOWEST_SAMPLED_MIDI, name: 'A0' });
    expect(PIANO_SAMPLES.at(-1)).toEqual({ midi: HIGHEST_SAMPLED_MIDI, name: 'C8' });
    expect(PIANO_SAMPLES.map((sample) => sample.name)).toContain('C4');
    // Sharps become "s" so the name is safe in a URL.
    expect(PIANO_SAMPLES.map((sample) => sample.name)).toContain('Ds4');
    expect(PIANO_SAMPLES.every((sample) => !sample.name.includes('#'))).toBe(true);
  });

  it('plays a sampled note with no shift at all', () => {
    const choice = nearestSample(60);
    expect(choice.sample.name).toBe('C4');
    expect(choice.semitones).toBe(0);
    expect(playbackRateFor(choice.semitones)).toBe(1);
  });

  it('never shifts a note by more than a semitone', () => {
    for (let midi = LOWEST_SAMPLED_MIDI; midi <= HIGHEST_SAMPLED_MIDI; midi += 1) {
      expect(Math.abs(nearestSample(midi).semitones)).toBeLessThanOrEqual(1);
    }
  });

  it('clamps notes outside the sampled range instead of going silent', () => {
    expect(nearestSample(0).sample.midi).toBe(LOWEST_SAMPLED_MIDI);
    expect(nearestSample(127).sample.midi).toBe(HIGHEST_SAMPLED_MIDI);
  });

  it('resamples by the equal-tempered ratio', () => {
    expect(playbackRateFor(12)).toBeCloseTo(2, 10);
    expect(playbackRateFor(-12)).toBeCloseTo(0.5, 10);
    expect(playbackRateFor(1)).toBeCloseTo(1.0594630943592953, 12);
  });
});

describe('SampledPitchPlayer', () => {
  it('uses the stand-in until the samples have arrived', () => {
    const { player, fallback, context } = createPlayer();

    player.play(60, 0.8);

    expect(fallback.played).toEqual([60]);
    expect(context.sources).toHaveLength(0);
  });

  it('downloads every sample once, on the first note', async () => {
    const { player, requested } = createPlayer();

    player.play(60, 0.8);
    player.play(64, 0.8);
    await player.load();

    expect(requested).toHaveLength(30);
    expect(requested).toContain('samples/piano/C4.mp3');
    expect(new Set(requested).size).toBe(30);
  });

  it('downloads nothing until a note is actually played', () => {
    const { requested } = createPlayer();
    expect(requested).toEqual([]);
  });

  it('plays the recording once it is decoded', async () => {
    const { player, context, fallback } = createPlayer();
    await player.load();

    player.play(60, 1);

    expect(player.isReady).toBe(true);
    expect(player.loadedCount).toBe(30);
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.playbackRate.value).toBe(1);
    expect(context.sources[0]?.startedAt).toBe(0);
    expect(fallback.played).toEqual([]);
  });

  it('resamples the notes between the recordings', async () => {
    const { player, context } = createPlayer();
    await player.load();

    player.play(61, 1);

    // C#4 is one semitone above the C4 recording.
    expect(context.sources[0]?.playbackRate.value).toBeCloseTo(1.059463, 5);
  });

  it('falls back for a sample that failed to download, and only that one', async () => {
    const { player, context, fallback } = createPlayer({ failing: ['C4'] });
    await player.load();

    player.play(60, 1);
    player.play(69, 1);

    expect(player.loadedCount).toBe(29);
    expect(fallback.played).toEqual([60]);
    expect(context.sources).toHaveLength(1);
  });

  it('sends the release to whichever player is sounding the note', async () => {
    const { player, fallback } = createPlayer();

    player.play(60, 1);
    await player.load();
    // Started on the stand-in, so the release has to go there too.
    player.stop(60);

    expect(fallback.stopped).toEqual([60]);
  });

  it('releases a sampled note with a fade rather than a click', async () => {
    const { player, context } = createPlayer();
    await player.load();
    player.play(60, 1);

    context.currentTime = 2;
    player.stop(60);

    expect(context.sources[0]?.stoppedAt).toBeCloseTo(2.37, 5);
  });

  it('fades the cut end of the recording instead of stopping dead', async () => {
    const { player, context } = createPlayer();
    await player.load();

    player.play(60, 1);

    // The fake buffers report five seconds; the fade lands in the last 0.4 s.
    const ramps = context.gains[0]?.gain.ramps ?? [];
    expect(ramps.some((ramp) => Math.abs(ramp.time - 4.6) < 1e-9)).toBe(true);
    expect(ramps.some((ramp) => Math.abs(ramp.time - 5) < 1e-9 && ramp.value < 0.001)).toBe(true);
  });

  it('moves the end fade with the playback rate', async () => {
    const { player, context } = createPlayer();
    await player.load();

    // C#4 is resampled a semitone up, so the buffer runs out sooner.
    player.play(61, 1);

    const playedSeconds = 5 / playbackRateFor(1);
    const ramps = context.gains[0]?.gain.ramps ?? [];
    expect(playedSeconds).toBeLessThan(5);
    expect(
      ramps.some((ramp) => Math.abs(ramp.time - playedSeconds) < 1e-9 && ramp.value < 0.001),
    ).toBe(true);
  });

  it('retriggers a repeated key instead of stacking voices', async () => {
    const { player, context } = createPlayer();
    await player.load();

    player.play(60, 1);
    player.play(60, 1);

    expect(context.sources).toHaveLength(2);
    expect(context.sources[0]?.stoppedAt).not.toBeNull();
  });

  it('scales with the volume and goes silent at zero', async () => {
    const { player, context, fallback } = createPlayer();
    await player.load();

    player.setVolume(0);
    player.play(60, 1);

    expect(context.sources).toHaveLength(0);
    // The stand-in follows the same slider, so the sound cannot jump.
    expect(fallback.volume).toBe(0);
  });

  describe('when to download', () => {
    it('waits for the first note by default', () => {
      const { player, requested } = createPlayer();
      expect(player.loading).toBe('lazy');
      expect(requested).toEqual([]);
    });

    it('downloads nothing at all when switched off', async () => {
      const { player, requested, fallback } = createPlayer({ loading: 'off' });

      player.play(60, 1);
      await player.load();

      expect(requested).toEqual([]);
      expect(player.ready).toBe(false);
      expect(fallback.played).toEqual([60]);
    });

    it('starts downloading the moment it is set to eager', () => {
      const { player, requested } = createPlayer();

      player.setLoading('eager');

      expect(requested).toHaveLength(30);
    });

    it('releases the decoded audio when switched off', async () => {
      const { player, requested } = createPlayer();
      await player.load();
      expect(player.ready).toBe(true);

      player.setLoading('off');

      // Memory is the larger cost of the two, so it goes as well.
      expect(player.ready).toBe(false);
      expect(player.loadedCount).toBe(0);

      // And it can come back.
      player.setLoading('lazy');
      await player.load();
      expect(player.loadedCount).toBe(30);
      expect(requested).toHaveLength(60);
    });

    it('ignores a mode it is already in', () => {
      const { player, requested } = createPlayer({ loading: 'eager' });
      const initial = requested.length;

      player.setLoading('eager');

      expect(requested).toHaveLength(initial);
    });
  });

  describe('sustain pedal', () => {
    it('keeps a released key ringing while the pedal is down', async () => {
      const { player, context } = createPlayer();
      await player.load();
      player.play(60, 1);

      player.setSustain(true);
      player.stop(60);

      expect(player.sustained).toBe(true);
      // The finger is off the key, but the damper has not come down.
      expect(context.sources[0]?.stoppedAt).toBeNull();
    });

    it('damps everything the pedal was holding when it comes up', async () => {
      const { player, context } = createPlayer();
      await player.load();
      player.play(60, 1);
      player.play(64, 1);
      player.setSustain(true);
      player.stop(60);
      player.stop(64);

      player.setSustain(false);

      expect(player.sustained).toBe(false);
      expect(context.sources.every((source) => source.stoppedAt !== null)).toBe(true);
    });

    it('leaves a key that is still held alone when the pedal comes up', async () => {
      const { player, context } = createPlayer();
      await player.load();
      player.play(60, 1);
      player.setSustain(true);

      player.setSustain(false);

      // Never released, so it keeps sounding.
      expect(context.sources[0]?.stoppedAt).toBeNull();
    });

    it('forgets a pedal-held note when the key is struck again', async () => {
      const { player, context } = createPlayer();
      await player.load();
      player.play(60, 1);
      player.setSustain(true);
      player.stop(60);

      player.play(60, 1);
      player.setSustain(false);

      // The retrigger stopped the first voice; the second is still ringing.
      expect(context.sources[0]?.stoppedAt).not.toBeNull();
      expect(context.sources[1]?.stoppedAt).toBeNull();
    });

    it('ignores a pedal message that changes nothing', async () => {
      const { player } = createPlayer();
      await player.load();

      player.setSustain(true);
      player.setSustain(true);

      expect(player.sustained).toBe(true);
    });

    it('passes the pedal on to the stand-in player', () => {
      const { player, fallback } = createPlayer();
      player.play(60, 1);

      player.setSustain(true);
      player.stop(60);

      // Sounding on the fallback, which does its own damping.
      expect(fallback.stopped).toEqual([60]);
    });

    it('drops the pedal when everything is silenced', async () => {
      const { player, context } = createPlayer();
      await player.load();
      player.play(60, 1);
      player.setSustain(true);
      player.stop(60);

      player.stopAll();

      expect(context.sources.every((source) => source.stoppedAt !== null)).toBe(true);
    });
  });

  it('releases everything on demand', async () => {
    const { player, context, fallback } = createPlayer();
    await player.load();
    player.play(60, 1);
    player.play(64, 1);

    player.stopAll();

    expect(context.sources.every((source) => source.stoppedAt !== null)).toBe(true);
    expect(fallback.stopAllCalls).toBe(1);
  });

  it('loads only once however often it is asked', async () => {
    const { player, requested } = createPlayer();

    await Promise.all([player.load(), player.load(), player.load()]);

    expect(requested).toHaveLength(30);
  });

  it('survives every sample failing', async () => {
    const failing = PIANO_SAMPLES.map((sample) => sample.name);
    const { player, fallback } = createPlayer({ failing });

    await expect(player.load()).resolves.toBeUndefined();
    player.play(60, 1);

    expect(player.isReady).toBe(false);
    expect(fallback.played).toEqual([60]);
  });

  it('works with no fallback at all', () => {
    const context = new FakeAudioContext();
    const player = new SampledPitchPlayer(() => context as unknown as AudioContext, {
      baseUrl: 'samples/piano/',
      fetchAudio: vi.fn(() => Promise.resolve(new ArrayBuffer(8))),
    });

    expect(() => {
      player.play(60, 1);
      player.stop(60);
      player.stopAll();
    }).not.toThrow();
  });
});

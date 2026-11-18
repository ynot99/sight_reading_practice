import { describe, expect, it } from 'vitest';
import { readSoundFont, type SoundSettings, type SoundZone } from '../../src/infrastructure/audio/soundFont.js';
import {
  evenedWithTheBuiltInPiano,
  filterCornerHz,
  gainFor,
  howLoudThePresetIs,
  levelAt,
  panFor,
  playbackRateFor,
  releaseFrom,
  SoundFontSounds,
  theEnvelope,
} from '../../src/infrastructure/audio/soundFontSounds.js';
import { SampledPitchPlayer } from '../../src/infrastructure/audio/SampledPitchPlayer.js';
import type { IPitchPlayer } from '../../src/application/ports/IPitchPlayer.js';
import { loudnessFor } from '../../src/infrastructure/audio/keySound.js';
import { GEN, range, writeSoundFont, type FileDescription, type FileSample, type FileZone } from '../support/soundFontFile.js';

/** The settings a zone is given where it says nothing, as the reader gives them. */
const NOTHING_SAID: SoundSettings = {
  coarseTune: 0,
  fineTune: 0,
  scaleTuning: 100,
  initialAttenuation: 0,
  pan: 0,
  initialFilterFc: 13_500,
  initialFilterQ: 0,
  delayVolEnv: -12_000,
  attackVolEnv: -12_000,
  holdVolEnv: -12_000,
  decayVolEnv: -12_000,
  sustainVolEnv: 0,
  releaseVolEnv: -12_000,
  keynumToVolEnvHold: 0,
  keynumToVolEnvDecay: 0,
  exclusiveClass: 0,
};

function saying(settings: Partial<SoundSettings>): SoundSettings {
  return { ...NOTHING_SAID, ...settings };
}

function aZone(zone: Partial<SoundZone> = {}): SoundZone {
  return {
    keys: { low: 0, high: 127 },
    velocities: { low: 0, high: 127 },
    sampleName: 'A',
    sampleRate: 44_100,
    start: 0,
    end: 100,
    loopStart: 0,
    loopEnd: 100,
    loop: 'none',
    rootKey: 60,
    correctionCents: 0,
    settings: NOTHING_SAID,
    ...zone,
  };
}

describe("a zone's sound, out of the soundfont's units", () => {
  it('reads timecents as seconds: nought is a second, 1200 a doubling', () => {
    const envelope = theEnvelope(saying({ delayVolEnv: 0, holdVolEnv: 1_200, releaseVolEnv: -1_200 }), 60);

    expect(envelope.delaySec).toBeCloseTo(1, 10);
    expect(envelope.holdSec).toBeCloseTo(2, 10);
    expect(envelope.releaseSec).toBeCloseTo(0.5, 10);
  });

  it("keeps each stage inside the format's range for it", () => {
    const envelope = theEnvelope(
      saying({ delayVolEnv: 9_000, attackVolEnv: 9_000, holdVolEnv: 9_000, decayVolEnv: 9_000, sustainVolEnv: 1_000, releaseVolEnv: 9_000 }),
      60,
    );

    expect(envelope.delaySec).toBeCloseTo(2 ** (5_000 / 1_200), 6);
    expect(envelope.attackSec).toBeCloseTo(2 ** (8_000 / 1_200), 6);
    expect(envelope.holdSec).toBeCloseTo(2 ** (5_000 / 1_200), 6);
    expect(envelope.decaySec).toBeCloseTo(2 ** (8_000 / 1_200), 6);
    expect(envelope.releaseSec).toBeCloseTo(2 ** (8_000 / 1_200), 6);
  });

  it('rises in no less time than it takes not to click', () => {
    expect(theEnvelope(NOTHING_SAID, 60).attackSec).toBe(0.002);
    expect(theEnvelope(saying({ attackVolEnv: 0 }), 60).attackSec).toBeCloseTo(1, 10);
  });

  it('stands at its peak where it says nothing of a fall', () => {
    const envelope = theEnvelope(saying({ decayVolEnv: 0 }), 60);

    expect(envelope.sustain).toBe(1);
    expect(envelope.decaySec).toBe(0);
  });

  it('falls to where it settles in the share of its decay that the fall takes of a hundred decibels', () => {
    const envelope = theEnvelope(saying({ decayVolEnv: 0, sustainVolEnv: 400 }), 60);

    expect(envelope.sustain).toBeCloseTo(0.01, 10);
    expect(envelope.decaySec).toBeCloseTo(0.4, 10);
    // A fall past a hundred decibels is a fall to nothing, in the whole decay.
    const toNothing = theEnvelope(saying({ decayVolEnv: 0, sustainVolEnv: 1_440 }), 60);
    expect(toNothing.decaySec).toBeCloseTo(1, 10);
    expect(toNothing.sustain).toBeCloseTo(1e-5, 10);
  });

  it('holds and falls for longer below middle C where the zone says so, and for less above', () => {
    const settings = saying({ holdVolEnv: 0, decayVolEnv: 0, sustainVolEnv: 1_000, keynumToVolEnvHold: 100, keynumToVolEnvDecay: 50 });

    expect(theEnvelope(settings, 60).holdSec).toBeCloseTo(1, 10);
    expect(theEnvelope(settings, 48).holdSec).toBeCloseTo(2, 10);
    expect(theEnvelope(settings, 72).holdSec).toBeCloseTo(0.5, 10);
    expect(theEnvelope(settings, 36).decaySec).toBeCloseTo(2, 10);
  });

  it('is nothing through its delay, rises straight, stands, and falls evenly in decibels to where it settles', () => {
    const envelope = { delaySec: 1, attackSec: 2, holdSec: 1, decaySec: 2, sustain: 0.01, releaseSec: 1 };

    expect(levelAt(envelope, 0.5)).toBe(0);
    expect(levelAt(envelope, 1)).toBe(0);
    expect(levelAt(envelope, 2)).toBeCloseTo(0.5, 10);
    expect(levelAt(envelope, 3)).toBe(1);
    expect(levelAt(envelope, 3.9)).toBe(1);
    // Half way down a fall of forty decibels is twenty down.
    expect(levelAt(envelope, 5)).toBeCloseTo(0.1, 10);
    expect(levelAt(envelope, 6)).toBeCloseTo(0.01, 10);
    expect(levelAt(envelope, 60)).toBeCloseTo(0.01, 10);
  });

  it('never rises again once it has begun to fall', () => {
    const envelope = { delaySec: 0, attackSec: 0.01, holdSec: 0.2, decaySec: 3, sustain: 0.001, releaseSec: 1 };
    let last = 1;
    for (let since = 0.21; since < 4; since += 0.01) {
      const level = levelAt(envelope, since);
      expect(level).toBeLessThanOrEqual(last + 1e-12);
      last = level;
    }
  });

  it('takes the share of its release that the decibels left to fall take of a hundred', () => {
    const envelope = { delaySec: 0, attackSec: 0.002, holdSec: 0, decaySec: 0, sustain: 1, releaseSec: 2 };

    expect(releaseFrom(envelope, 1)).toBeCloseTo(2, 10);
    expect(releaseFrom(envelope, 0.01)).toBeCloseTo(1.2, 10);
    // Never so short that it clicks.
    expect(releaseFrom(envelope, 1e-5)).toBe(0.02);
    expect(releaseFrom({ ...envelope, releaseSec: 0.001 }, 1)).toBe(0.02);
  });

  it('is as loud as how hard the key was struck, as the built-in piano is, down to a twentieth', () => {
    expect(loudnessFor(1)).toBe(1);
    expect(loudnessFor(0.5)).toBe(0.5);
    expect(loudnessFor(0.05)).toBe(0.05);
    expect(loudnessFor(0.01)).toBe(0.05);
  });

  it('is turned down by its attenuation, two hundred centibels a tenth', () => {
    expect(gainFor(0)).toBe(1);
    expect(gainFor(200)).toBeCloseTo(0.1, 10);
    expect(gainFor(-50)).toBe(1);
    expect(gainFor(5_000)).toBeCloseTo(10 ** (-1_440 / 200), 12);
  });

  it('is played at the pitch the key asks for, from the key it was recorded at and every tuning the zone says', () => {
    expect(playbackRateFor(aZone(), 72)).toBeCloseTo(2, 10);
    expect(playbackRateFor(aZone({ rootKey: 72 }), 60)).toBeCloseTo(0.5, 10);
    expect(playbackRateFor(aZone({ settings: saying({ coarseTune: -12 }) }), 60)).toBeCloseTo(0.5, 10);
    expect(playbackRateFor(aZone({ settings: saying({ fineTune: 50 }), correctionCents: -50 }), 60)).toBeCloseTo(1, 10);
    expect(playbackRateFor(aZone({ correctionCents: 100 }), 60)).toBeCloseTo(2 ** (1 / 12), 10);
    // A drum: the same pitch on every key.
    expect(playbackRateFor(aZone({ settings: saying({ scaleTuning: 0 }) }), 90)).toBe(1);
  });

  it('is filtered from its corner, or not at all where the corner is the widest', () => {
    expect(filterCornerHz(NOTHING_SAID)).toBeNull();
    expect(filterCornerHz(saying({ initialFilterFc: 6_900 }))).toBeCloseTo(8.176 * 2 ** (6_900 / 1_200), 6);
    expect(filterCornerHz(saying({ initialFilterFc: 100 }))).toBeCloseTo(8.176 * 2 ** (1_500 / 1_200), 6);
    expect(filterCornerHz(saying({ initialFilterFc: 13_499 }))).not.toBeNull();
  });

  it('is panned from all left to all right', () => {
    expect(panFor(saying({ pan: -500 }))).toBe(-1);
    expect(panFor(saying({ pan: 250 }))).toBe(0.5);
    expect(panFor(saying({ pan: 900 }))).toBe(1);
  });
});

/** A recording `seconds` long at a hundred points a second, every point at `level` of full scale. */
function steady(name: string, level: number, seconds = 1): FileSample {
  return { name, points: Array.from({ length: 100 * seconds }, () => Math.round(level * 32_768)), sampleRate: 100 };
}

function thePreset(description: FileDescription) {
  const font = readSoundFont(writeSoundFont(description));
  const preset = font.presets[0];
  if (preset === undefined) {
    throw new Error('no preset');
  }
  return { font, preset };
}

/** One instrument of the zones said over the recordings given, one preset over it. */
function oneInstrument(samples: readonly FileSample[], zones: readonly FileZone[]): FileDescription {
  return {
    samples,
    instruments: [{ name: 'Only', zones }],
    presets: [{ name: 'Only', zones: [[[GEN.instrument, 0]]] }],
  };
}

const decibels = (gain: number): number => 20 * Math.log10(gain);

describe('how loud a preset is, against the built-in piano', () => {
  it('is how loud its recording is over its first second, with its attenuation', () => {
    const { font, preset } = thePreset(oneInstrument([steady('Half', 0.5)], [[[GEN.initialAttenuation, 200], [GEN.sampleID, 0]]]));

    expect(howLoudThePresetIs(font, preset)).toBeCloseTo(decibels(0.5) - 20, 1);
  });

  it('hears only the first second of a recording', () => {
    const recording: FileSample = {
      name: 'Dies',
      points: [...Array.from({ length: 100 }, () => 16_384), ...Array.from({ length: 300 }, () => 0)],
      sampleRate: 100,
    };
    const { font, preset } = thePreset(oneInstrument([recording], [[[GEN.sampleID, 0]]]));

    expect(howLoudThePresetIs(font, preset)).toBeCloseTo(decibels(0.5), 1);
  });

  it('takes a key as the mean of the zones sounding it, left and right', () => {
    const { font, preset } = thePreset(
      oneInstrument([steady('Left', 0.5), steady('Right', 0.25)], [[[GEN.pan, -500], [GEN.sampleID, 0]], [[GEN.pan, 500], [GEN.sampleID, 1]]]),
    );

    expect(howLoudThePresetIs(font, preset)).toBeCloseTo(10 * Math.log10((0.5 ** 2 + 0.25 ** 2) / 2), 1);
  });

  it('is the middle of its keys by loudness, the loudest and the quietest counting for no more than any other', () => {
    const { font, preset } = thePreset(
      oneInstrument(
        [steady('Lowest', 0.1), steady('Middle', 0.5), steady('Top', 0.25)],
        [
          [[GEN.keyRange, range(0, 9)], [GEN.sampleID, 0]],
          [[GEN.keyRange, range(10, 69)], [GEN.sampleID, 1]],
          [[GEN.keyRange, range(70, 127)], [GEN.sampleID, 2]],
        ],
      ),
    );

    // Ten keys at the quietest, 58 between and 60 at the loudest: the middle
    // two of the 128 by loudness are both between - though the keys in the
    // middle of the keyboard are the loudest.
    expect(howLoudThePresetIs(font, preset)).toBeCloseTo(decibels(0.25), 1);
  });

  it('is between the middle two where the keys are even in number', () => {
    const { font, preset } = thePreset(
      oneInstrument(
        [steady('Low', 0.5), steady('High', 0.25)],
        [
          [[GEN.keyRange, range(0, 63)], [GEN.sampleID, 0]],
          [[GEN.keyRange, range(64, 127)], [GEN.sampleID, 1]],
        ],
      ),
    );

    expect(howLoudThePresetIs(font, preset)).toBeCloseTo((decibels(0.5) + decibels(0.25)) / 2, 1);
  });

  it('is the middle key itself where the keys are odd in number', () => {
    const { font, preset } = thePreset(
      oneInstrument(
        [steady('Low', 0.5), steady('High', 0.1)],
        [
          [[GEN.keyRange, range(0, 1)], [GEN.sampleID, 0]],
          [[GEN.keyRange, range(2, 2)], [GEN.sampleID, 1]],
        ],
      ),
    );

    expect(howLoudThePresetIs(font, preset)).toBeCloseTo(decibels(0.5), 1);
  });

  it('is heard where the keys are struck hardest', () => {
    const { font, preset } = thePreset(
      oneInstrument(
        [steady('Soft', 0.5), steady('Hard', 0.1)],
        [
          [[GEN.velRange, range(0, 100)], [GEN.sampleID, 0]],
          [[GEN.velRange, range(101, 127)], [GEN.sampleID, 1]],
        ],
      ),
    );

    expect(howLoudThePresetIs(font, preset)).toBeCloseTo(decibels(0.1), 1);
  });

  it('is nothing where it covers no key, or is silent on all of them', () => {
    const silent = thePreset(oneInstrument([steady('Nothing', 0)], [[[GEN.sampleID, 0]]]));
    const none = thePreset(oneInstrument([steady('A', 0.5)], [[[GEN.velRange, range(0, 100)], [GEN.sampleID, 0]]]));

    expect(howLoudThePresetIs(silent.font, silent.preset)).toBeNull();
    expect(howLoudThePresetIs(none.font, none.preset)).toBeNull();
    expect(evenedWithTheBuiltInPiano(none.font, none.preset)).toBe(1);
  });

  it('is turned to sound as loud as the built-in piano, down or up', () => {
    const loud = thePreset(oneInstrument([steady('Loud', 0.5)], [[[GEN.sampleID, 0]]]));
    const quiet = thePreset(oneInstrument([steady('Quiet', 0.04)], [[[GEN.sampleID, 0]]]));

    expect(decibels(0.5) + decibels(evenedWithTheBuiltInPiano(loud.font, loud.preset))).toBeCloseTo(-25.6, 1);
    expect(decibels(0.04) + decibels(evenedWithTheBuiltInPiano(quiet.font, quiet.preset))).toBeCloseTo(-25.6, 1);
  });

  it('is turned up no more than four times, however quiet it was recorded', () => {
    const faint = thePreset(oneInstrument([steady('Faint', 0.001)], [[[GEN.sampleID, 0]]]));

    expect(evenedWithTheBuiltInPiano(faint.font, faint.preset)).toBe(4);
  });
});

class FakeParam {
  value = 1;
  readonly events: { readonly kind: string; readonly value: number; readonly time: number }[] = [];
  cancelledFrom: number | null = null;

  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.events.push({ kind: 'set', value, time });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'linear', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'exponential', value, time });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.cancelledFrom = time;
    return this;
  }
}

class FakeNode {
  readonly kind: string;
  readonly connectedTo: unknown[] = [];
  unplugged = false;

  constructor(kind: string) {
    this.kind = kind;
  }

  connect<T>(target: T): T {
    this.connectedTo.push(target);
    return target;
  }

  disconnect(): void {
    this.unplugged = true;
  }
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  readonly playbackRate = new FakeParam();
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;

  start(at: number): void {
    this.startedAt = at;
  }

  stop(at: number): void {
    this.stoppedAt = at;
  }

  end(): void {
    this.onended?.();
  }
}

class FakeBuffer {
  readonly channels: number;
  readonly length: number;
  readonly sampleRate: number;
  points: Float32Array | null = null;

  constructor(channels: number, length: number, sampleRate: number) {
    this.channels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
  }

  copyToChannel(points: Float32Array): void {
    this.points = points.slice();
  }
}

class FakeContext {
  currentTime = 0;
  readonly destination = new FakeNode('speaker');
  readonly sources: FakeSource[] = [];
  readonly gains: (FakeNode & { gain: FakeParam })[] = [];
  readonly filters: (FakeNode & { type: string; frequency: FakeParam; Q: FakeParam })[] = [];
  readonly panners: (FakeNode & { pan: FakeParam })[] = [];
  readonly buffers: FakeBuffer[] = [];
  /** Rates the device will not make a buffer at. */
  refusing = new Set<number>();

  createBufferSource(): FakeSource {
    const source = new FakeSource('source');
    this.sources.push(source);
    return source;
  }

  createGain(): FakeNode & { gain: FakeParam } {
    const gain = Object.assign(new FakeNode('gain'), { gain: new FakeParam() });
    this.gains.push(gain);
    return gain;
  }

  createBiquadFilter(): FakeNode & { type: string; frequency: FakeParam; Q: FakeParam } {
    const filter = Object.assign(new FakeNode('filter'), { type: '', frequency: new FakeParam(), Q: new FakeParam() });
    this.filters.push(filter);
    return filter;
  }

  createStereoPanner(): FakeNode & { pan: FakeParam } {
    const panner = Object.assign(new FakeNode('panner'), { pan: new FakeParam() });
    this.panners.push(panner);
    return panner;
  }

  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    if (this.refusing.has(sampleRate)) {
      throw new Error('NotSupportedError');
    }
    const buffer = new FakeBuffer(channels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  resume(): Promise<void> {
    return Promise.resolve();
  }
}

/** A stereo piano of two layers over two recordings, written as a soundfont is. */
function aPiano(extra: { readonly instrumentZones?: readonly FileZone[] } = {}): FileDescription {
  return {
    samples: [
      { name: 'Soft', points: [16_384, -16_384, 8_192, 0, 0, 0, 0, 0], loop: [2, 6], originalKey: 60 },
      { name: 'Loud', points: [32_767, -32_768, 0, 0], loop: [1, 3], originalKey: 72, sampleRate: 22_050 },
    ],
    instruments: [
      {
        name: 'Piano',
        zones: extra.instrumentZones ?? [
          [[GEN.keyRange, range(21, 108)], [GEN.velRange, range(0, 63)], [GEN.pan, -500], [GEN.sampleModes, 1], [GEN.sampleID, 0]],
          [[GEN.keyRange, range(21, 108)], [GEN.velRange, range(0, 63)], [GEN.pan, 500], [GEN.sampleModes, 1], [GEN.sampleID, 0]],
          [[GEN.keyRange, range(21, 108)], [GEN.velRange, range(64, 127)], [GEN.initialAttenuation, 200], [GEN.sampleID, 1]],
        ],
      },
    ],
    presets: [{ name: 'Grand', zones: [[[GEN.instrument, 0]]] }],
  };
}

function theSounds(description: FileDescription = aPiano()): { sounds: SoundFontSounds; context: FakeContext } {
  const font = readSoundFont(writeSoundFont(description));
  const preset = font.presets[0];
  if (preset === undefined) {
    throw new Error('no preset');
  }
  return { sounds: new SoundFontSounds(font, preset), context: new FakeContext() };
}

function strike(
  sounds: SoundFontSounds,
  context: FakeContext,
  struck: { midi?: number; velocity?: number; at?: number; level?: number; ended?: () => void } = {},
) {
  return sounds.strike({
    context: context as unknown as AudioContext,
    midi: struck.midi ?? 60,
    velocity: struck.velocity ?? 0.4,
    at: struck.at ?? 0,
    level: struck.level ?? 1,
    ended: struck.ended ?? (() => undefined),
  });
}

describe('a key sounded from a soundfont', () => {
  it('plays every zone that covers the key and how hard it was struck, each panned as it says', () => {
    const { sounds, context } = theSounds();

    expect(strike(sounds, context, { velocity: 0.4 })).not.toBeNull();

    expect(context.sources).toHaveLength(2);
    expect(context.panners.map((panner) => panner.pan.value)).toEqual([-1, 1]);
    // From the recording, through its envelope and pan, to the speaker.
    const [source] = context.sources;
    const envelope = source?.connectedTo[0] as FakeNode;
    expect(envelope.kind).toBe('gain');
    expect((envelope.connectedTo[0] as FakeNode).kind).toBe('panner');
    expect((envelope.connectedTo[0] as FakeNode).connectedTo).toEqual([context.destination]);
    expect(source?.startedAt).toBe(0);
  });

  it('chooses the layer by how hard the key was struck', () => {
    const { sounds, context } = theSounds();

    strike(sounds, context, { velocity: 0.9 });

    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]?.buffer?.sampleRate).toBe(22_050);
    // Nothing panned is put through no panner.
    expect(context.panners).toHaveLength(0);
  });

  it('reads the boundary between two layers on the scale of 1 to 127', () => {
    const { sounds, context } = theSounds();

    // 63 of 127 is the soft layer's last, 64 the loud one's first; and a
    // touch that comes to 63.2 of 127 is still 63.
    strike(sounds, context, { velocity: 63 / 127 });
    strike(sounds, context, { velocity: 64 / 127 });
    strike(sounds, context, { velocity: 0.4975 });

    expect(context.sources.map((source) => source.buffer?.sampleRate)).toEqual([44_100, 44_100, 22_050, 44_100, 44_100]);
  });

  it('has nothing for a key no zone covers', () => {
    const { sounds, context } = theSounds();

    expect(strike(sounds, context, { midi: 15 })).toBeNull();
    expect(context.sources).toHaveLength(0);
  });

  it('plays the recording as the -1 to 1 the device takes, and makes it once', () => {
    const { sounds, context } = theSounds();

    strike(sounds, context, { velocity: 0.9 });
    strike(sounds, context, { velocity: 0.9, midi: 61 });

    expect(context.buffers).toHaveLength(1);
    expect(Array.from(context.buffers[0]?.points ?? [])).toEqual([32_767 / 32_768, -1, 0, 0]);
    expect(context.sources[1]?.buffer).toBe(context.buffers[0]);
  });

  it('makes the recording again for another device', () => {
    const { sounds, context } = theSounds();
    const another = new FakeContext();

    strike(sounds, context, { velocity: 0.9 });
    strike(sounds, another, { velocity: 0.9 });

    expect(another.buffers).toHaveLength(1);
  });

  it('plays it at the pitch of the key struck', () => {
    const { sounds, context } = theSounds();

    strike(sounds, context, { velocity: 0.9, midi: 60 });

    // The loud recording was made at C5.
    expect(context.sources[0]?.playbackRate.value).toBeCloseTo(0.5, 10);
  });

  it('loops where the zone says, counted in seconds from its recording', () => {
    const { sounds, context } = theSounds();

    strike(sounds, context, { velocity: 0.4 });
    strike(sounds, context, { velocity: 0.9 });

    const [soft, , loud] = context.sources;
    expect(soft?.loop).toBe(true);
    expect(soft?.loopStart).toBeCloseTo(2 / 44_100, 12);
    expect(soft?.loopEnd).toBeCloseTo(6 / 44_100, 12);
    expect(loud?.loop).toBe(false);
  });

  it('does not loop where the loop does not fit inside the recording', () => {
    for (const loop of [
      [3, 3],
      [6, 2],
      [2, 9],
    ] as const) {
      const description: FileDescription = {
        ...aPiano({ instrumentZones: [[[GEN.sampleModes, 1], [GEN.sampleID, 0]]] }),
        samples: [{ name: 'Soft', points: [1, 2, 3, 4, 5, 6, 7, 8], loop }],
      };
      const { sounds, context } = theSounds(description);

      strike(sounds, context);

      expect(context.sources[0]?.loop, `loop ${String(loop)}`).toBe(false);
    }
  });

  it('is as loud as the instrument is set, how hard it was struck, and its attenuation', () => {
    const { sounds, context } = theSounds();

    strike(sounds, context, { velocity: 0.75, level: 0.5 });

    const rise = context.gains[0]?.gain.events.find((event) => event.kind === 'linear');
    const font = readSoundFont(writeSoundFont(aPiano()));
    const evened = font.presets[0] === undefined ? Number.NaN : evenedWithTheBuiltInPiano(font, font.presets[0]);
    expect(rise?.value).toBeCloseTo(0.5 * 0.75 * 0.1 * evened, 10);
  });

  it('rises from nothing as it is struck and falls to where it settles, on the audio clock', () => {
    const description = aPiano({
      instrumentZones: [
        [[GEN.holdVolEnv, 0], [GEN.decayVolEnv, 0], [GEN.sustainVolEnv, 400], [GEN.sampleID, 0]],
      ],
    });
    const { sounds, context } = theSounds(description);

    strike(sounds, context, { velocity: 1, at: 5 });

    const events = context.gains[0]?.gain.events ?? [];
    expect(events[0]).toEqual({ kind: 'set', value: 0, time: 5 });
    const risen = 5 + 2 ** (-12_000 / 1_200) + 0.002;
    const rise = events.find((event) => event.kind === 'linear');
    expect(rise?.time).toBeCloseTo(risen, 10);
    // Forty decibels below its peak.
    const fall = events.find((event) => event.kind === 'exponential');
    expect((fall?.value ?? 0) / (rise?.value ?? 1)).toBeCloseTo(0.01, 10);
    expect(fall?.time).toBeCloseTo(risen + 1 + 0.4, 10);
  });

  it('puts the delay before the rise', () => {
    // A second of delay.
    const { sounds, context } = theSounds(aPiano({ instrumentZones: [[[33, 0], [GEN.sampleID, 0]]] }));

    strike(sounds, context);

    const events = context.gains[0]?.gain.events ?? [];
    expect(events[1]).toEqual({ kind: 'set', value: 0, time: 1 });
    expect(events.find((event) => event.kind === 'linear')?.time).toBeCloseTo(1.002, 10);
  });

  it('stands at its peak where it says nothing of a fall', () => {
    const { sounds, context } = theSounds(aPiano({ instrumentZones: [[[GEN.sampleID, 0]]] }));

    strike(sounds, context);

    expect(context.gains[0]?.gain.events.some((event) => event.kind === 'exponential')).toBe(false);
  });

  it('is filtered where its corner is below the widest', () => {
    const { sounds, context } = theSounds(
      aPiano({ instrumentZones: [[[GEN.initialFilterFc, 6_900], [9, 120], [GEN.sampleID, 0]]] }),
    );

    strike(sounds, context);

    expect(context.filters).toHaveLength(1);
    expect(context.filters[0]?.type).toBe('lowpass');
    expect(context.filters[0]?.frequency.value).toBeCloseTo(8.176 * 2 ** (6_900 / 1_200), 6);
    expect(context.filters[0]?.Q.value).toBe(12);
    expect(context.sources[0]?.connectedTo[0]).toBe(context.filters[0]);
    expect(context.filters[0]?.connectedTo[0]).toBe(context.gains[0]);
  });

  it('is let go of from where its envelope will be then, for the share of its release left', () => {
    const description = aPiano({
      instrumentZones: [
        [[GEN.holdVolEnv, -12_000], [GEN.decayVolEnv, 0], [GEN.sustainVolEnv, 400], [GEN.releaseVolEnv, 1_200], [GEN.sampleID, 0]],
      ],
    });
    const { sounds, context } = theSounds(description);
    const voice = strike(sounds, context, { velocity: 1 });
    const risen = 2 ** (-12_000 / 1_200) * 2 + 0.002;

    // Half way down its fall of forty decibels, handed over ahead of time.
    const at = risen + 0.2;
    voice?.release(at, 0);

    const gain = context.gains[0]?.gain;
    expect(gain?.cancelledFrom).toBeCloseTo(at, 10);
    const peak = gain?.events.find((event) => event.kind === 'linear')?.value ?? 1;
    const [from, fall] = gain?.events.slice(-2) ?? [];
    expect(from?.kind).toBe('set');
    // Twenty decibels below its peak.
    expect((from?.value ?? 0) / peak).toBeCloseTo(0.1, 6);
    expect(from?.time).toBeCloseTo(at, 10);
    // Eighty of the hundred decibels left, of a two-second release.
    expect(fall?.kind).toBe('exponential');
    expect(fall?.time).toBeCloseTo(at + 1.6, 6);
    expect(context.sources[0]?.stoppedAt).toBeCloseTo(at + 1.6 + 0.02, 6);
  });

  it('is let go of now where it was asked for a moment already gone', () => {
    const { sounds, context } = theSounds(aPiano({ instrumentZones: [[[GEN.sampleID, 0]]] }));
    const voice = strike(sounds, context);

    voice?.release(1, 3);

    expect(context.gains[0]?.gain.cancelledFrom).toBe(3);
  });

  it('is taken back before it begins, every zone of it', () => {
    const { sounds, context } = theSounds();
    const voice = strike(sounds, context, { at: 4 });

    voice?.takeBack(1);

    expect(context.sources.map((source) => source.stoppedAt)).toEqual([1, 1]);
    expect(context.gains.map((gain) => gain.gain.value)).toEqual([0, 0]);
  });

  it('says it is over once every zone of it has ended, and unplugs each', () => {
    const { sounds, context } = theSounds();
    let over = 0;
    strike(sounds, context, { ended: () => (over += 1) });
    const [left, right] = context.sources;

    left?.end();
    expect(over).toBe(0);
    expect(left?.unplugged).toBe(true);
    expect(context.panners[0]?.unplugged).toBe(true);

    right?.end();
    expect(over).toBe(1);
  });

  it('leaves out a zone the device cannot make a recording for, and the key with it where it is the only one', () => {
    const { sounds, context } = theSounds();
    context.refusing.add(22_050);

    expect(strike(sounds, context, { velocity: 0.9 })).toBeNull();
    expect(strike(sounds, context, { velocity: 0.4 })).not.toBeNull();
  });

  it('still sounds the zones it can make where one of a key cannot be made', () => {
    const { sounds, context } = theSounds(aPiano({ instrumentZones: [[[GEN.sampleID, 1]], [[GEN.sampleID, 0]]] }));
    context.refusing.add(22_050);

    expect(strike(sounds, context)).not.toBeNull();
    expect(context.sources.map((source) => source.buffer?.sampleRate)).toEqual([44_100]);
  });
});

class RecordingFallback implements IPitchPlayer {
  readonly played: number[] = [];

  play(midi: number): void {
    this.played.push(midi);
  }

  stop(): void {}

  stopAll(): void {}

  takeBackFrom(): void {}
}

function aPlayer(): { player: SampledPitchPlayer; context: FakeContext; fetched: string[]; fallback: RecordingFallback } {
  const context = new FakeContext();
  const fetched: string[] = [];
  const fallback = new RecordingFallback();
  const player = new SampledPitchPlayer(() => context as unknown as AudioContext, {
    baseUrl: 'samples/piano/',
    fallback,
    fetchAudio: (url) => {
      fetched.push(url);
      return Promise.resolve(new ArrayBuffer(8));
    },
  });
  return { player, context, fetched, fallback };
}

function aChosenPreset() {
  const font = readSoundFont(writeSoundFont(aPiano()));
  const preset = font.presets[0];
  if (preset === undefined) {
    throw new Error('no preset');
  }
  return { font, preset };
}

describe('the instrument sounding a soundfont', () => {
  it('sounds its keys from the soundfont, and downloads none of its own recordings', () => {
    const { player, context, fetched } = aPlayer();
    player.useSoundFont(aChosenPreset());

    player.play(60, 0.4);

    expect(context.sources).toHaveLength(2);
    expect(context.buffers).toHaveLength(1);
    expect(fetched).toEqual([]);
  });

  it('sounds a key the soundfont has nothing for on the stand-in', () => {
    const { player, fallback } = aPlayer();
    player.useSoundFont(aChosenPreset());

    player.play(15, 0.4);

    expect(fallback.played).toEqual([15]);
  });

  it('lets go of what was sounding when it is changed', () => {
    const { player, context } = aPlayer();
    player.useSoundFont(aChosenPreset());
    player.play(60, 0.4);

    player.useSoundFont(null);

    expect(context.sources.every((source) => source.stoppedAt !== null)).toBe(true);
  });

  it('goes back to its own recordings', () => {
    const { player, fetched } = aPlayer();
    player.useSoundFont(aChosenPreset());
    player.useSoundFont(null);

    player.play(60, 0.4);

    expect(fetched.length).toBeGreaterThan(0);
  });

  it('keeps a key ringing under the pedal, and lets it go with the pedal', () => {
    const { player, context } = aPlayer();
    player.useSoundFont(aChosenPreset());
    player.setSustain(true);
    player.play(60, 0.4);

    player.stop(60);
    expect(context.sources.every((source) => source.stoppedAt === null)).toBe(true);

    player.setSustain(false);
    expect(context.sources.every((source) => source.stoppedAt !== null)).toBe(true);
  });

  it('lets go of a key struck again before sounding it anew', () => {
    const { player, context } = aPlayer();
    player.useSoundFont(aChosenPreset());
    player.play(60, 0.4);

    player.play(60, 0.4);

    expect(context.sources.map((source) => source.stoppedAt !== null)).toEqual([true, true, false, false]);
  });

  it('forgets a key once its sound is over, so the next strike does not let go of it', () => {
    const { player, context } = aPlayer();
    player.useSoundFont(aChosenPreset());
    player.play(60, 0.4);
    for (const source of context.sources) {
      source.end();
    }

    player.play(60, 0.4);

    expect(context.gains[0]?.gain.cancelledFrom).toBeNull();
  });
});

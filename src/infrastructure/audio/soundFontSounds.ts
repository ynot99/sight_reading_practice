import { loudnessFor, type KeySounds, type Strike, type Voice } from './keySound.js';
import type { MidiRange, SoundFont, SoundFontPreset, SoundSettings, SoundZone } from './soundFont.js';
import { takeBack, unplug } from './audioTime.js';

/**
 * A zone's envelope, read out of the soundfont's units: how its loudness
 * rises, stands and falls, in seconds, and where it settles as a share of its
 * peak.
 */
export interface Envelope {
  readonly delaySec: number;
  readonly attackSec: number;
  readonly holdSec: number;
  /** How long it takes to fall from its peak to where it settles. */
  readonly decaySec: number;
  /** Where it settles while the key is held, as a share of its peak: 1 is no fall at all. */
  readonly sustain: number;
  /** How long a fall of the full hundred decibels takes once the key is up. */
  readonly releaseSec: number;
}

/** Seconds from timecents, where 1200 is a doubling and 0 one second. */
function seconds(timecents: number, lowest: number, highest: number): number {
  return 2 ** (Math.min(highest, Math.max(lowest, timecents)) / 1200);
}

/** The share of full loudness `centibels` of attenuation leaves. */
export function gainFor(centibels: number): number {
  return 10 ** (-Math.min(1_440, Math.max(0, centibels)) / 200);
}

/** The quietest the format speaks of: a hundred decibels down, and below it nothing is heard. */
const SILENT = 1e-5;
/** The floor every fall ramps to: an exponential ramp cannot reach nothing. */
const FLOOR = 1e-4;

/**
 * The shortest rise and fall. A sound begun or cut in no time at all clicks,
 * and the format's "none" - a thousandth of a second - is close enough to
 * none to do it.
 */
const SHORTEST_ATTACK_SEC = 0.002;
const SHORTEST_RELEASE_SEC = 0.02;

/** The format's range for each stage, in timecents. */
const DELAY_RANGE = [-12_000, 5_000] as const;
const ATTACK_RANGE = [-12_000, 8_000] as const;
const HOLD_RANGE = [-12_000, 5_000] as const;
const DECAY_RANGE = [-12_000, 8_000] as const;
const RELEASE_RANGE = [-12_000, 8_000] as const;

/** The key the format's per-key changes to an envelope are counted from. */
const MIDDLE_C = 60;

/**
 * A zone's envelope for one key.
 *
 * The fall from the peak is straight in decibels, as the format has it: its
 * decay time is how long a fall of the full hundred takes, so a zone that
 * settles forty decibels down gets there in four tenths of it. A zone may
 * also hold and fall for longer on lower keys, as a lower string rings longer.
 */
export function theEnvelope(settings: SoundSettings, midi: number): Envelope {
  const belowMiddleC = MIDDLE_C - midi;
  const sustainCentibels = Math.min(1_440, Math.max(0, settings.sustainVolEnv));
  const decayAll = seconds(settings.decayVolEnv + settings.keynumToVolEnvDecay * belowMiddleC, ...DECAY_RANGE);
  return {
    delaySec: seconds(settings.delayVolEnv, ...DELAY_RANGE),
    attackSec: Math.max(SHORTEST_ATTACK_SEC, seconds(settings.attackVolEnv, ...ATTACK_RANGE)),
    holdSec: seconds(settings.holdVolEnv + settings.keynumToVolEnvHold * belowMiddleC, ...HOLD_RANGE),
    decaySec: decayAll * Math.min(1, sustainCentibels / 1_000),
    sustain: Math.max(SILENT, gainFor(sustainCentibels)),
    releaseSec: seconds(settings.releaseVolEnv, ...RELEASE_RANGE),
  };
}

/**
 * How loud an envelope is `sinceSec` after its key was struck, as a share of
 * its peak: nothing through the delay, rising straight through the attack,
 * standing through the hold, falling evenly in decibels to where it settles.
 *
 * Worked out rather than read off the node, so that a release handed over
 * ahead - every note of a playback has one - falls from where the note will
 * really be then, and not from where it is now, which may be before it has
 * begun.
 */
export function levelAt(envelope: Envelope, sinceSec: number): number {
  const rising = sinceSec - envelope.delaySec;
  if (rising <= 0) {
    return 0;
  }
  if (rising < envelope.attackSec) {
    return rising / envelope.attackSec;
  }
  const falling = rising - envelope.attackSec - envelope.holdSec;
  if (falling <= 0) {
    return 1;
  }
  if (falling >= envelope.decaySec) {
    return envelope.sustain;
  }
  return envelope.sustain ** (falling / envelope.decaySec);
}

/** How long the release takes from `level`: the share of the hundred decibels left to fall. */
export function releaseFrom(envelope: Envelope, level: number): number {
  const decibelsLeft = 100 + 20 * Math.log10(Math.max(SILENT, level));
  return Math.max(SHORTEST_RELEASE_SEC, (envelope.releaseSec * decibelsLeft) / 100);
}

/**
 * How loud the built-in piano's recordings are: over the 88 keys, the median
 * of how loud the first second of the recording each key plays is, in
 * decibels of full scale. Measured from the files in `public/samples/piano`.
 */
export const THE_BUILT_IN_PIANO_DB = -25.6;

/**
 * The most a soundfont is turned up to sound as loud as the built-in piano.
 * One recorded very quietly is mostly its own noise, and turned up without
 * end it would be that noise, loud.
 */
const MOST_TURNED_UP = 4;

/** How much of a recording its loudness is heard from: its first second, where a struck note is loudest. */
const HEARD_OVER_SEC = 1;

/**
 * How loud a preset is: the same measure as the built-in piano's, taken
 * over the keys it covers where they are struck hardest, each key the mean
 * of its zones there - left and right, or one in the middle - with their
 * attenuation. `null` where it covers no key or is silent on all of them.
 *
 * The hardest stroke because that is where a soundfont's layers are least
 * its author's shading: the softer ones are turned down and dulled on
 * purpose, and that is the instrument and stays.
 */
export function howLoudThePresetIs(font: SoundFont, preset: SoundFontPreset): number | null {
  const known = new Map<SoundZone, number>();
  const powerOf = (zone: SoundZone): number => {
    let power = known.get(zone);
    if (power === undefined) {
      const length = Math.min(zone.end - zone.start, Math.round(zone.sampleRate * HEARD_OVER_SEC));
      let sum = 0;
      for (let index = 0; index < length; index += 1) {
        const point = (font.sampleData[zone.start + index] ?? 0) / 32_768;
        sum += point * point;
      }
      power = length > 0 ? (sum / length) * gainFor(zone.settings.initialAttenuation) ** 2 : 0;
      known.set(zone, power);
    }
    return power;
  };
  const keys: number[] = [];
  for (let midi = 0; midi <= 127; midi += 1) {
    const zones = preset.zones.filter((zone) => covers(zone.keys, midi) && covers(zone.velocities, 127));
    const power = zones.reduce((sum, zone) => sum + powerOf(zone), 0) / zones.length;
    if (zones.length > 0 && power > 0) {
      keys.push(10 * Math.log10(power));
    }
  }
  if (keys.length === 0) {
    return null;
  }
  keys.sort((one, other) => one - other);
  const middle = keys.length / 2;
  return keys.length % 2 === 1
    ? (keys[Math.floor(middle)] ?? 0)
    : ((keys[middle - 1] ?? 0) + (keys[middle] ?? 0)) / 2;
}

/**
 * What a preset is turned by to sound as loud as the built-in piano at the
 * same setting of the slider: a soundfont's recordings are each made as loud
 * as they can be, which measured nine decibels over the built-in piano's,
 * and a reader changing what the keys sound as has not asked for them
 * louder.
 */
export function evenedWithTheBuiltInPiano(font: SoundFont, preset: SoundFontPreset): number {
  const loud = howLoudThePresetIs(font, preset);
  return loud === null ? 1 : Math.min(MOST_TURNED_UP, 10 ** ((THE_BUILT_IN_PIANO_DB - loud) / 20));
}

/** The ratio a recording is played at: the cents from its own key to the one struck, and every tuning the zone says. */
export function playbackRateFor(zone: SoundZone, midi: number): number {
  const { scaleTuning, coarseTune, fineTune } = zone.settings;
  const cents = (midi - zone.rootKey) * scaleTuning + coarseTune * 100 + fineTune + zone.correctionCents;
  return 2 ** (cents / 1_200);
}

/** The filter's corner in hertz, or `null` where it is open: the format's widest is no filter at all. */
export function filterCornerHz(settings: SoundSettings): number | null {
  const cents = Math.min(13_500, Math.max(1_500, settings.initialFilterFc));
  return cents >= 13_500 ? null : 8.176 * 2 ** (cents / 1_200);
}

/** Pan from -1, all left, to 1, all right. */
export function panFor(settings: SoundSettings): number {
  return Math.min(500, Math.max(-500, settings.pan)) / 500;
}

/** How hard a key is struck, on the format's scale of 1 to 127. */
function velocityOnTheScale(velocity: number): number {
  return Math.min(127, Math.max(1, Math.round(velocity * 127)));
}

function covers(range: MidiRange, value: number): boolean {
  return value >= range.low && value <= range.high;
}

/** One zone's sound in a struck key: its nodes, and how it was shaped. */
interface ZoneSound {
  readonly source: AudioBufferSourceNode;
  readonly envelope: GainNode;
  readonly peak: number;
  readonly shape: Envelope;
}

/**
 * The keys sounded from one preset of a soundfont.
 *
 * A key struck plays every zone that covers it and how hard it was struck -
 * a stereo recording is two, left and right - each from its recording at the
 * pitch the key asks for, looped where the zone says, through its own filter,
 * envelope and pan.
 *
 * A recording is made ready the first time a zone of it is played, and kept:
 * the file holds every preset's, and a reader plays one preset over the
 * middle of the keyboard, so most are never needed.
 *
 * A zone's loop that is to run only while the key is down is played as one
 * that runs on: the loop cannot be told ahead when to stop, and a release
 * handed over ahead is how every note of a playback ends. Its envelope's
 * release is heard all the same.
 */
export class SoundFontSounds implements KeySounds {
  private readonly font: SoundFont;
  readonly preset: SoundFontPreset;
  /** What every zone is turned by to sound as loud as the built-in piano: see `evenedWithTheBuiltInPiano`. */
  private readonly evened: number;
  private readonly recordings = new Map<string, AudioBuffer | null>();
  private recordingsFor: BaseAudioContext | null = null;

  constructor(font: SoundFont, preset: SoundFontPreset) {
    this.font = font;
    this.preset = preset;
    this.evened = evenedWithTheBuiltInPiano(font, preset);
  }

  strike({ context, midi, velocity, at, level, ended }: Strike): Voice | null {
    const onTheScale = velocityOnTheScale(velocity);
    const zones = this.preset.zones.filter((zone) => covers(zone.keys, midi) && covers(zone.velocities, onTheScale));
    const sounds: ZoneSound[] = [];
    let playing = 0;
    for (const zone of zones) {
      const recording = this.recordingFor(context, zone);
      if (recording === null) {
        continue;
      }
      playing += 1;
      sounds.push(
        this.soundTheZone(context, zone, recording, { midi, velocity, at, level }, () => {
          playing -= 1;
          if (playing === 0) {
            ended();
          }
        }),
      );
    }
    if (sounds.length === 0) {
      return null;
    }
    return {
      startsAt: at,
      release: (when, now) => {
        for (const sound of sounds) {
          letGo(sound, at, when, now);
        }
      },
      takeBack: (now) => {
        for (const sound of sounds) {
          takeBack(sound.source, sound.envelope, now);
        }
      },
    };
  }

  private soundTheZone(
    context: AudioContext,
    zone: SoundZone,
    recording: AudioBuffer,
    struck: { readonly midi: number; readonly velocity: number; readonly at: number; readonly level: number },
    over: () => void,
  ): ZoneSound {
    const { settings } = zone;
    const source = context.createBufferSource();
    source.buffer = recording;
    source.playbackRate.value = playbackRateFor(zone, struck.midi);
    const loopStart = zone.loopStart - zone.start;
    const loopEnd = zone.loopEnd - zone.start;
    if (zone.loop !== 'none' && loopStart >= 0 && loopEnd > loopStart && loopEnd <= zone.end - zone.start) {
      source.loop = true;
      source.loopStart = loopStart / zone.sampleRate;
      source.loopEnd = loopEnd / zone.sampleRate;
    }

    const shape = theEnvelope(settings, struck.midi);
    const peak = struck.level * loudnessFor(struck.velocity) * gainFor(settings.initialAttenuation) * this.evened;
    const envelope = context.createGain();
    shapeTheEnvelope(envelope.gain, struck.at, shape, peak);

    const nodes: AudioNode[] = [source];
    const corner = filterCornerHz(settings);
    if (corner !== null && typeof context.createBiquadFilter === 'function') {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = corner;
      // The format gives the resonance in centibels; the node takes decibels.
      filter.Q.value = Math.min(96, Math.max(0, settings.initialFilterQ / 10));
      nodes.push(filter);
    }
    nodes.push(envelope);
    const pan = panFor(settings);
    if (pan !== 0 && typeof context.createStereoPanner === 'function') {
      const panner = context.createStereoPanner();
      panner.pan.value = pan;
      nodes.push(panner);
    }
    nodes.reduce((from, to) => from.connect(to));
    nodes.at(-1)?.connect(context.destination);

    source.start(struck.at);
    source.onended = () => {
      unplug(...nodes);
      over();
    };
    return { source, envelope, peak, shape };
  }

  /**
   * A zone's recording as something the device can play, made the first time
   * it is asked for: its points, from signed sixteen-bit to the -1 to 1 the
   * device plays.
   */
  private recordingFor(context: BaseAudioContext, zone: SoundZone): AudioBuffer | null {
    if (this.recordingsFor !== context) {
      this.recordings.clear();
      this.recordingsFor = context;
    }
    const key = `${String(zone.start)}:${String(zone.end)}:${String(zone.sampleRate)}`;
    const known = this.recordings.get(key);
    if (known !== undefined) {
      return known;
    }
    const length = zone.end - zone.start;
    let made: AudioBuffer | null = null;
    if (length > 0) {
      try {
        made = context.createBuffer(1, length, zone.sampleRate);
        const points = new Float32Array(length);
        const from = this.font.sampleData;
        for (let index = 0; index < length; index += 1) {
          points[index] = (from[zone.start + index] ?? 0) / 32_768;
        }
        made.copyToChannel(points, 0);
      } catch {
        // A rate the device will not take. The zone goes silent, not the key.
        made = null;
      }
    }
    this.recordings.set(key, made);
    return made;
  }
}

/** The rise, stand and fall of a zone, put on its gain from the moment it is struck. */
function shapeTheEnvelope(gain: AudioParam, at: number, shape: Envelope, peak: number): void {
  const risen = at + shape.delaySec + shape.attackSec;
  gain.setValueAtTime(0, at);
  if (shape.delaySec > 0) {
    gain.setValueAtTime(0, at + shape.delaySec);
  }
  gain.linearRampToValueAtTime(peak, risen);
  if (shape.sustain < 1 && shape.decaySec > 0) {
    const held = risen + shape.holdSec;
    gain.setValueAtTime(peak, held);
    gain.exponentialRampToValueAtTime(Math.max(FLOOR, peak * shape.sustain), held + shape.decaySec);
  }
}

/**
 * A zone let go of at `when`: it falls from where its envelope will be then,
 * for as much of its release as the decibels it has left to fall take.
 */
function letGo(sound: ZoneSound, struckAt: number, when: number, now: number): void {
  const at = Math.max(when, now);
  const share = levelAt(sound.shape, at - struckAt);
  const from = Math.max(FLOOR, sound.peak * share);
  const lasts = releaseFrom(sound.shape, share);
  try {
    sound.envelope.gain.cancelScheduledValues(at);
    sound.envelope.gain.setValueAtTime(from, at);
    sound.envelope.gain.exponentialRampToValueAtTime(FLOOR, at + lasts);
    sound.source.stop(at + lasts + 0.02);
  } catch {
    // The source had already finished on its own.
  }
}

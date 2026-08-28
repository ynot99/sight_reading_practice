import { KeySignature, type KeyMode } from '../domain/model/KeySignature.js';
import { TimeSignature } from '../domain/model/TimeSignature.js';
import type { PracticeSettings } from './PracticeController.js';
import type { ISettingsStore } from './ports/ISettingsStore.js';
import { SAMPLE_LOADING_MODES, type SampleLoading } from './ports/IPitchPlayer.js';
import {
  CLICK_DROPOUTS,
  CLICK_PATTERNS,
  type ClickDropout,
  type ClickPattern,
} from './ports/IMetronome.js';

/** Loudness of each sound source, `0..1`. Not a practice rule, so kept apart. */
export interface AudioSettings {
  readonly metronomeVolume: number;
  readonly instrumentVolume: number;
  readonly sampleLoading: SampleLoading;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  metronomeVolume: 0.6,
  instrumentVolume: 0.6,
  sampleLoading: 'lazy',
};

export interface RestoredSettings {
  readonly practice: Partial<PracticeSettings>;
  readonly audio: AudioSettings;
}

export interface KnownIds {
  readonly presetIds: readonly string[];
  readonly modeIds: readonly string[];
  readonly scoringIds: readonly string[];
  readonly rhythmProfileIds: readonly string[];
}

const STORAGE_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;
}

function readInteger(value: unknown, min: number, max: number): number | undefined {
  const numeric = readNumber(value, min, max);
  return numeric !== undefined && Number.isInteger(numeric) ? numeric : undefined;
}

function readId(value: unknown, known: readonly string[]): string | undefined {
  return typeof value === 'string' && known.includes(value) ? value : undefined;
}

/** `null` means "no limit", which is as real a choice as any bar number. */
function readBar(value: unknown): number | null | undefined {
  return value === null ? null : readInteger(value, 1, 999);
}

/** `null` is a real choice here - both hands - so it has to survive a reload. */
function readHand(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  return readInteger(value, 1, 4);
}

function readClickPattern(value: unknown): ClickPattern | undefined {
  return CLICK_PATTERNS.includes(value as ClickPattern) ? (value as ClickPattern) : undefined;
}

/**
 * The dropout choice, accepting the bar count this setting used to be.
 *
 * A stored `dropoutBars: 2` predates the count-in-only option and means the
 * same thing it always did; dropping it would quietly reset the click of
 * anyone who had set one.
 */
function readClickDropout(value: unknown, legacyBars: unknown): ClickDropout | undefined {
  if (CLICK_DROPOUTS.includes(value as ClickDropout)) {
    return value as ClickDropout;
  }
  const bars = readInteger(legacyBars, 0, 8);
  if (bars === undefined) {
    return undefined;
  }
  const migrated = `cycle-${bars}`;
  return bars === 0
    ? 'never'
    : CLICK_DROPOUTS.includes(migrated as ClickDropout)
      ? (migrated as ClickDropout)
      : undefined;
}

/**
 * The veil distance, accepting the checkbox this setting used to be.
 *
 * `fadePassedNotes: true` asked for exactly what `0` now means - dim a step
 * once it is done with - so an older device keeps the page it had.
 */
function readReadAhead(value: unknown, legacyFade: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  const steps = readInteger(value, 0, 4);
  if (steps !== undefined) {
    return steps;
  }
  const faded = readBoolean(legacyFade);
  return faded === undefined ? undefined : faded ? 0 : null;
}

function readKey(value: unknown): KeySignature | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const fifths = readInteger(value['fifths'], -7, 7);
  const mode = value['mode'];
  if (fifths === undefined || (mode !== 'major' && mode !== 'minor')) {
    return undefined;
  }
  return new KeySignature(fifths, mode satisfies KeyMode);
}

function readTimeSignature(value: unknown): TimeSignature | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  try {
    return TimeSignature.parse(value);
  } catch {
    return undefined;
  }
}

/** Drops every key whose value is `undefined`, so spreads stay meaningful. */
function compact<T extends object>(source: T): Partial<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Partial<T>;
}

/**
 * Rebuilds settings from whatever was stored.
 *
 * Every field is validated independently and a bad one is simply dropped, so
 * an older format, a hand-edited value or a preset that no longer exists
 * costs the reader one setting rather than a blank screen.
 */
export function decodePracticeSettings(
  value: unknown,
  known: KnownIds,
): Partial<PracticeSettings> {
  if (!isRecord(value)) {
    return {};
  }
  return compact<PracticeSettings>({
    presetId: readId(value['presetId'], known.presetIds),
    modeId: readId(value['modeId'], known.modeIds),
    scoringId: readId(value['scoringId'], known.scoringIds),
    rhythmProfileId: readId(value['rhythmProfileId'], known.rhythmProfileIds),
    key: readKey(value['key']),
    timeSignature: readTimeSignature(value['timeSignature']),
    measures: readInteger(value['measures'], 1, 32),
    tempoBpm: readInteger(value['tempoBpm'], 20, 300),
    countInBars: readInteger(value['countInBars'], 0, 4),
    clickPattern: readClickPattern(value['clickPattern']),
    handStaff: readHand(value['handStaff']),
    rangeFromBar: readBar(value['rangeFromBar']),
    rangeToBar: readBar(value['rangeToBar']),
    repeatRange: readBoolean(value['repeatRange']),
    clickDropout: readClickDropout(value['clickDropout'], value['dropoutBars']),
    metronomeMuted: readBoolean(value['metronomeMuted']),
    matchToleranceMs: readNumber(value['matchToleranceMs'], 1, 60_000),
    pitchClassOnly: readBoolean(value['pitchClassOnly']),
    rhythmOnly: readBoolean(value['rhythmOnly']),
    previewSeconds: readInteger(value['previewSeconds'], 0, 30),
    showCursor: readBoolean(value['showCursor']),
    blindMode: readBoolean(value['blindMode']),
    showPlayedNotes: readBoolean(value['showPlayedNotes']),
    readAheadSteps: readReadAhead(value['readAheadSteps'], value['fadePassedNotes']),
    zoom: readNumber(value['zoom'], 0.3, 3),
  } as PracticeSettings);
}

export function encodePracticeSettings(settings: PracticeSettings): Record<string, unknown> {
  return {
    presetId: settings.presetId,
    modeId: settings.modeId,
    scoringId: settings.scoringId,
    rhythmProfileId: settings.rhythmProfileId,
    key: { fifths: settings.key.fifths, mode: settings.key.mode },
    timeSignature: settings.timeSignature.toString(),
    measures: settings.measures,
    tempoBpm: settings.tempoBpm,
    countInBars: settings.countInBars,
    clickPattern: settings.clickPattern,
    handStaff: settings.handStaff,
    rangeFromBar: settings.rangeFromBar,
    rangeToBar: settings.rangeToBar,
    repeatRange: settings.repeatRange,
    clickDropout: settings.clickDropout,
    metronomeMuted: settings.metronomeMuted,
    // `Infinity` has no JSON representation; the slider cannot reach it anyway.
    matchToleranceMs: Number.isFinite(settings.matchToleranceMs)
      ? settings.matchToleranceMs
      : undefined,
    pitchClassOnly: settings.pitchClassOnly,
    rhythmOnly: settings.rhythmOnly,
    previewSeconds: settings.previewSeconds,
    showCursor: settings.showCursor,
    blindMode: settings.blindMode,
    showPlayedNotes: settings.showPlayedNotes,
    readAheadSteps: settings.readAheadSteps,
    zoom: settings.zoom,
  };
}

export function decodeAudioSettings(value: unknown): AudioSettings {
  if (!isRecord(value)) {
    return DEFAULT_AUDIO_SETTINGS;
  }
  const mode = value['sampleLoading'];
  return {
    metronomeVolume:
      readNumber(value['metronomeVolume'], 0, 1) ?? DEFAULT_AUDIO_SETTINGS.metronomeVolume,
    instrumentVolume:
      readNumber(value['instrumentVolume'], 0, 1) ?? DEFAULT_AUDIO_SETTINGS.instrumentVolume,
    sampleLoading: SAMPLE_LOADING_MODES.includes(mode as SampleLoading)
      ? (mode as SampleLoading)
      : DEFAULT_AUDIO_SETTINGS.sampleLoading,
  };
}

/**
 * Remembers what the reader chose last time, on this device.
 *
 * Writes the whole blob on every change: it is a few hundred bytes, and one
 * atomic value is far easier to reason about than a spread of keys that can
 * drift out of step with each other.
 */
export class SettingsRepository {
  private readonly store: ISettingsStore;
  private readonly known: KnownIds;
  private practice: Record<string, unknown> = {};
  private audio: AudioSettings = DEFAULT_AUDIO_SETTINGS;

  constructor(store: ISettingsStore, known: KnownIds) {
    this.store = store;
    this.known = known;
  }

  load(): RestoredSettings {
    const raw = this.store.read();
    const root = isRecord(raw) ? raw : {};

    const practice = decodePracticeSettings(root['practice'], this.known);
    this.audio = decodeAudioSettings(root['audio']);
    this.practice = isRecord(root['practice']) ? root['practice'] : {};

    return { practice, audio: this.audio };
  }

  savePractice(settings: PracticeSettings): void {
    this.practice = encodePracticeSettings(settings);
    this.flush();
  }

  saveAudio(audio: AudioSettings): void {
    this.audio = audio;
    this.flush();
  }

  get currentAudio(): AudioSettings {
    return this.audio;
  }

  private flush(): void {
    this.store.write({
      version: STORAGE_VERSION,
      practice: this.practice,
      audio: this.audio,
    });
  }
}

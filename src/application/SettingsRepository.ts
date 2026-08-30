import { KeySignature, type KeyMode } from '../domain/model/KeySignature.js';
import { TimeSignature } from '../domain/model/TimeSignature.js';
import type { PracticeSettings } from './PracticeController.js';
import type { ISettingsStore } from './ports/ISettingsStore.js';
import { SAMPLE_LOADING_MODES, type SampleLoading } from './ports/IPitchPlayer.js';
import {
  CLICK_WHEN,
  CLICK_PATTERNS,
  type ClickWhen,
  type ClickPattern,
} from './ports/IMetronome.js';
import { PLAYED_NOTE_DISPLAYS, type PlayedNoteDisplay } from './PracticeController.js';

/**
 * What belongs to this device rather than to the practice.
 *
 * Loudness, which knob drives it, where the samples come from and which
 * inputs are live: none of these describe the exercise, and all of them are
 * true of the desk the reader is sitting at. Kept apart from the practice
 * settings for that reason, and restored the same way.
 */
export interface AudioSettings {
  readonly metronomeVolume: number;
  readonly instrumentVolume: number;
  readonly sampleLoading: SampleLoading;
  /**
   * The knob taught to drive the note volume, or `null` for none.
   *
   * Kept with the volumes rather than with the practice settings because it
   * *is* one: which physical control reaches the same value the slider does.
   * It is a property of the keyboard on this desk, so it belongs on the
   * device alongside them.
   */
  readonly volumeController: number | null;
  /** Sound the reader's own presses back to them. */
  readonly audioFeedback: boolean;
  /** Accept the computer keyboard as a second MIDI source. */
  readonly computerKeyboard: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  metronomeVolume: 0.6,
  instrumentVolume: 0.6,
  sampleLoading: 'lazy',
  volumeController: null,
  audioFeedback: true,
  computerKeyboard: true,
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
  /** Omitted where there is no ladder; a stored rung is then simply dropped. */
  readonly ladderStepIds?: readonly string[];
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
 * When the click sounds, accepting the two settings this used to be.
 *
 * A mute switch and a dropout menu answered one question between them, so a
 * stored device carries either, both, or the bar count the dropout was before
 * that. Mute wins where both are set: someone who silenced the metronome
 * meant silence, whatever they had chosen about dropping out.
 *
 * Note the trap in the old names. `clickDropout: 'never'` meant the click
 * never *drops out* - it always sounds - while the new `never` means it never
 * sounds. Reading them by their old field name is what keeps the two apart.
 */
function readClickWhen(value: unknown, stored: Record<string, unknown>): ClickWhen | undefined {
  if (CLICK_WHEN.includes(value as ClickWhen)) {
    return value as ClickWhen;
  }
  if (readBoolean(stored['metronomeMuted']) === true) {
    return 'never';
  }
  const dropout = stored['clickDropout'];
  if (dropout === 'never') {
    return 'always';
  }
  if (dropout === 'count-in-only' || CLICK_WHEN.includes(dropout as ClickWhen)) {
    return dropout as ClickWhen;
  }
  const bars = readInteger(stored['dropoutBars'], 0, 8);
  if (bars === undefined) {
    return undefined;
  }
  const migrated = `cycle-${bars}`;
  return bars === 0
    ? 'always'
    : CLICK_WHEN.includes(migrated as ClickWhen)
      ? (migrated as ClickWhen)
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

/**
 * When the marks appear, accepting the checkbox this setting used to be.
 *
 * `showPlayedNotes: true` asked for what `live` now means, and `false` for
 * `hidden`; a stored device keeps the page it had.
 */
function readPlayedNotes(value: unknown, legacyShow: unknown): PlayedNoteDisplay | undefined {
  if (PLAYED_NOTE_DISPLAYS.includes(value as PlayedNoteDisplay)) {
    return value as PlayedNoteDisplay;
  }
  const shown = readBoolean(legacyShow);
  return shown === undefined ? undefined : shown ? 'live' : 'hidden';
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
    // What the reader chose, not the beats it came to on the last piece.
    // Anything written before this held a bpm, and a bpm cannot be read back
    // without knowing what it was a percentage *of* - which is exactly the
    // thing that had gone. Dropping it puts that visit at the written tempo,
    // which is where the reader would have started anyway.
    // Wide because it is a ratio and not a dial: the buttons step within a
    // quarter and double speed, but a tempo typed in beats is honoured as
    // typed, and the slowest piece taken at the fastest reading is a large
    // number. What actually holds the run in bounds is the bpm it works out
    // to, which is clamped to what the metronome can play.
    tempoPercent: readNumber(value['tempoPercent'], 5, 1_500),
    countInBars: readInteger(value['countInBars'], 0, 4),
    clickPattern: readClickPattern(value['clickPattern']),
    handStaff: readHand(value['handStaff']),
    rangeFromBar: readBar(value['rangeFromBar']),
    rangeToBar: readBar(value['rangeToBar']),
    repeatRange: readBoolean(value['repeatRange']),
    // `null` is a real answer here - off the route - so it has to survive a
    // reload; an id that no longer exists is not, and is dropped.
    ladderStepId:
      value['ladderStepId'] === null
        ? null
        : readId(value['ladderStepId'], known.ladderStepIds ?? []),
    clickWhen: readClickWhen(value['clickWhen'], value),
    matchToleranceMs: readNumber(value['matchToleranceMs'], 1, 60_000),
    // Bounded either way: a relay can only add delay, but a keyboard stamped
    // at the source can arrive fractionally ahead of when the page notices.
    inputLatencyMs: readInteger(value['inputLatencyMs'], -200, 800),
    startInFocus: readBoolean(value['startInFocus']),
    pitchClassOnly: readBoolean(value['pitchClassOnly']),
    rhythmOnly: readBoolean(value['rhythmOnly']),
    previewSeconds: readInteger(value['previewSeconds'], 0, 30),
    showCursor: readBoolean(value['showCursor']),
    strictTiming: readBoolean(value['strictTiming']),
    pagedScore: readBoolean(value['pagedScore']),
    blindMode: readBoolean(value['blindMode']),
    playedNotes: readPlayedNotes(value['playedNotes'], value['showPlayedNotes']),
    survival: readBoolean(value['survival']),
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
    tempoPercent: settings.tempoPercent,
    countInBars: settings.countInBars,
    clickPattern: settings.clickPattern,
    handStaff: settings.handStaff,
    rangeFromBar: settings.rangeFromBar,
    rangeToBar: settings.rangeToBar,
    repeatRange: settings.repeatRange,
    ladderStepId: settings.ladderStepId,
    clickWhen: settings.clickWhen,
    // `Infinity` has no JSON representation; the slider cannot reach it anyway.
    matchToleranceMs: Number.isFinite(settings.matchToleranceMs)
      ? settings.matchToleranceMs
      : undefined,
    inputLatencyMs: settings.inputLatencyMs,
    startInFocus: settings.startInFocus,
    pitchClassOnly: settings.pitchClassOnly,
    rhythmOnly: settings.rhythmOnly,
    previewSeconds: settings.previewSeconds,
    showCursor: settings.showCursor,
    strictTiming: settings.strictTiming,
    pagedScore: settings.pagedScore,
    blindMode: settings.blindMode,
    playedNotes: settings.playedNotes,
    survival: settings.survival,
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
    // `null` is the real answer for "no knob taught", so it has to survive a
    // reload rather than falling back to a default that means the same thing.
    volumeController: readInteger(value['volumeController'], 0, 127) ?? null,
    audioFeedback: readBoolean(value['audioFeedback']) ?? DEFAULT_AUDIO_SETTINGS.audioFeedback,
    computerKeyboard:
      readBoolean(value['computerKeyboard']) ?? DEFAULT_AUDIO_SETTINGS.computerKeyboard,
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

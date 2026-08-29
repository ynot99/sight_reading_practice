import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIO_SETTINGS,
  SettingsRepository,
  decodeAudioSettings,
  decodePracticeSettings,
  encodePracticeSettings,
  type KnownIds,
} from '../../src/application/SettingsRepository.js';
import type { PracticeSettings } from '../../src/application/PracticeController.js';
import { InMemorySettingsStore, type ISettingsStore } from '../../src/application/ports/ISettingsStore.js';
import { volumeToGain } from '../../src/application/ports/IVolumeControl.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';

const KNOWN: KnownIds = {
  presetIds: ['five-finger-c', 'triads-left-hand'],
  modeIds: ['mode.wait', 'mode.flow'],
  rhythmProfileIds: ['calm', 'flowing', 'sixteenths'],
  scoringIds: ['scoring.accuracy', 'scoring.continuity'],
  ladderStepIds: ['rung.1a', 'rung.2b'],
};

const SETTINGS: PracticeSettings = {
  presetId: 'triads-left-hand',
  modeId: 'mode.flow',
  scoringId: 'scoring.continuity',
  rhythmProfileId: 'sixteenths',
  key: KeySignature.major(-2),
  timeSignature: new TimeSignature(3, 4),
  measures: 6,
  tempoBpm: 84,
  countInBars: 2,
  clickPattern: 'downbeat',
  handStaff: 2,
  rangeFromBar: 3,
  rangeToBar: 6,
  repeatRange: true,
  ladderStepId: 'rung.2b',
  clickDropout: 'cycle-2',
  metronomeMuted: true,
  matchToleranceMs: 180,
  pitchClassOnly: true,
  rhythmOnly: true,
  previewSeconds: 8,
  showCursor: false,
  blindMode: true,
  showPlayedNotes: false,
  readAheadSteps: 2,
  zoom: 1.2,
};

describe('practice settings codec', () => {
  it('round-trips everything the reader can choose', () => {
    const restored = decodePracticeSettings(encodePracticeSettings(SETTINGS), KNOWN);

    expect(restored.presetId).toBe('triads-left-hand');
    expect(restored.modeId).toBe('mode.flow');
    expect(restored.key?.equals(KeySignature.major(-2))).toBe(true);
    expect(restored.timeSignature?.toString()).toBe('3/4');
    expect(restored.measures).toBe(6);
    expect(restored.tempoBpm).toBe(84);
    expect(restored.countInBars).toBe(2);
    expect(restored.metronomeMuted).toBe(true);
    expect(restored.matchToleranceMs).toBe(180);
    expect(restored.pitchClassOnly).toBe(true);
    expect(restored.showCursor).toBe(false);
    expect(restored.blindMode).toBe(true);
    expect(restored.clickDropout).toBe('cycle-2');
  });

  it('reads the bar count the dropout setting used to be', () => {
    // Stored before "only the count-in" existed; it still means what it did.
    const legacy = { ...encodePracticeSettings(SETTINGS), clickDropout: undefined };

    expect(decodePracticeSettings({ ...legacy, dropoutBars: 4 }, KNOWN).clickDropout).toBe(
      'cycle-4',
    );
    expect(decodePracticeSettings({ ...legacy, dropoutBars: 0 }, KNOWN).clickDropout).toBe('never');
    // A cycle length the menu never offered is dropped rather than invented.
    expect(decodePracticeSettings({ ...legacy, dropoutBars: 3 }, KNOWN).clickDropout).toBeUndefined();
  });

  it('drops a preset or mode that no longer exists', () => {
    const restored = decodePracticeSettings(
      { ...encodePracticeSettings(SETTINGS), presetId: 'level-from-2019', modeId: 'mode.gone' },
      KNOWN,
    );

    // Dropped rather than kept, so start-up cannot fail on a stale id.
    expect(restored.presetId).toBeUndefined();
    expect(restored.modeId).toBeUndefined();
    expect(restored.tempoBpm).toBe(84);
  });

  it('drops individual values that make no sense, keeping the rest', () => {
    const restored = decodePracticeSettings(
      {
        ...encodePracticeSettings(SETTINGS),
        measures: 0,
        tempoBpm: 5_000,
        countInBars: -1,
        key: { fifths: 99, mode: 'major' },
        timeSignature: '4/7',
        metronomeMuted: 'yes',
      },
      KNOWN,
    );

    expect(restored.measures).toBeUndefined();
    expect(restored.tempoBpm).toBeUndefined();
    expect(restored.countInBars).toBeUndefined();
    expect(restored.key).toBeUndefined();
    expect(restored.timeSignature).toBeUndefined();
    expect(restored.metronomeMuted).toBeUndefined();
    expect(restored.presetId).toBe('triads-left-hand');
  });

  it('survives anything at all in storage', () => {
    expect(decodePracticeSettings(null, KNOWN)).toEqual({});
    expect(decodePracticeSettings('corrupt', KNOWN)).toEqual({});
    expect(decodePracticeSettings(42, KNOWN)).toEqual({});
    expect(decodePracticeSettings([], KNOWN)).toEqual({});
  });

  it('omits a tolerance that JSON cannot express', () => {
    const encoded = encodePracticeSettings({
      ...SETTINGS,
      matchToleranceMs: Number.POSITIVE_INFINITY,
    });
    expect(encoded['matchToleranceMs']).toBeUndefined();
    expect(decodePracticeSettings(encoded, KNOWN).matchToleranceMs).toBeUndefined();
  });
});

describe('audio settings codec', () => {
  it('reads volumes and falls back per field', () => {
    expect(
      decodeAudioSettings({ metronomeVolume: 0.25, instrumentVolume: 0, sampleLoading: 'eager' }),
    ).toEqual({
      metronomeVolume: 0.25,
      instrumentVolume: 0,
      sampleLoading: 'eager',
      volumeController: null,
    });
    // A knob taught on this device outlives the visit that taught it.
    expect(decodeAudioSettings({ volumeController: 11 }).volumeController).toBe(11);
    // A controller number no keyboard can send is dropped, not trusted.
    expect(decodeAudioSettings({ volumeController: 900 }).volumeController).toBeNull();
    // An unknown mode falls back rather than reaching the player.
    expect(decodeAudioSettings({ sampleLoading: 'whenever' }).sampleLoading).toBe('lazy');
    expect(decodeAudioSettings({ metronomeVolume: 4 })).toEqual(DEFAULT_AUDIO_SETTINGS);
    expect(decodeAudioSettings(null)).toEqual(DEFAULT_AUDIO_SETTINGS);
  });
});

describe('SettingsRepository', () => {
  it('returns defaults when nothing was ever stored', () => {
    const repository = new SettingsRepository(new InMemorySettingsStore(), KNOWN);

    const restored = repository.load();

    expect(restored.practice).toEqual({});
    expect(restored.audio).toEqual(DEFAULT_AUDIO_SETTINGS);
  });

  it('gives back what was last saved on this device', () => {
    const store = new InMemorySettingsStore();
    const first = new SettingsRepository(store, KNOWN);
    first.load();
    first.savePractice(SETTINGS);
    first.saveAudio({
      metronomeVolume: 0.2,
      instrumentVolume: 0.9,
      sampleLoading: 'off',
      volumeController: 7,
    });

    const second = new SettingsRepository(store, KNOWN);
    const restored = second.load();

    expect(restored.practice.tempoBpm).toBe(84);
    expect(restored.practice.presetId).toBe('triads-left-hand');
    expect(restored.audio).toEqual({
      metronomeVolume: 0.2,
      instrumentVolume: 0.9,
      sampleLoading: 'off',
      volumeController: 7,
    });
  });

  it('keeps the practice settings when only the volume changes', () => {
    const store = new InMemorySettingsStore();
    const repository = new SettingsRepository(store, KNOWN);
    repository.load();
    repository.savePractice(SETTINGS);

    repository.saveAudio({
      metronomeVolume: 0,
      instrumentVolume: 0,
      sampleLoading: 'eager',
      volumeController: null,
    });

    const restored = new SettingsRepository(store, KNOWN).load();
    expect(restored.practice.tempoBpm).toBe(84);
    expect(restored.audio.metronomeVolume).toBe(0);
  });

  it('stamps a version, so a future format can be told apart', () => {
    const store = new InMemorySettingsStore();
    const repository = new SettingsRepository(store, KNOWN);
    repository.load();
    repository.savePractice(SETTINGS);

    expect(store.read()).toMatchObject({ version: 1 });
  });

  it('carries on when the store refuses to work', () => {
    const broken: ISettingsStore = {
      read: () => {
        throw new Error('private mode');
      },
      write: () => {
        throw new Error('quota');
      },
      clear: () => undefined,
    };
    const repository = new SettingsRepository(
      {
        read: () => {
          try {
            return broken.read();
          } catch {
            return null;
          }
        },
        write: () => undefined,
        clear: () => undefined,
      },
      KNOWN,
    );

    expect(() => repository.load()).not.toThrow();
    expect(() => repository.savePractice(SETTINGS)).not.toThrow();
  });
});

describe('volumeToGain', () => {
  it('tapers a linear slider into something that sounds even', () => {
    expect(volumeToGain(0, 0.3)).toBe(0);
    expect(volumeToGain(1, 0.3)).toBeCloseTo(0.3, 10);
    // Half way on the slider is a quarter of the gain, not half of it.
    expect(volumeToGain(0.5, 0.4)).toBeCloseTo(0.1, 10);
  });

  it('clamps values from outside the slider', () => {
    expect(volumeToGain(-1, 0.5)).toBe(0);
    expect(volumeToGain(9, 0.5)).toBeCloseTo(0.5, 10);
  });
});

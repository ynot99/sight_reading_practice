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
import type { CloudFile, ICloudDrive } from '../../src/application/ports/ICloudDrive.js';
import { SettingsSync } from '../../src/application/SettingsSync.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { LISTEN_MODE_ID, knownFrameIds } from '../../src/application/modes/ListenFrame.js';

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
  tempoPercent: 84,
  countInBars: 2,
  clickPattern: 'downbeat',
  handStaff: 2,
  rangeFromBar: 3,
  rangeToBar: 6,
  repeatRange: true,
  ladderStepId: 'rung.2b',
  clickWhen: 'cycle-2',
  inputLatencyMs: 0,
  matchToleranceMs: 180,
  pitchClassOnly: true,
  rhythmOnly: true,
  previewSeconds: 8,
  cursorWhileRunning: false, cursorWhileListening: false, cursorAtRest: false,
  strictTiming: true,
  pagedScore: true,
  playedNotes: 'at-end',
  survival: true,
  playingAhead: 'moves-on',
  survivalRefillPercent: 40,
  survivalPunishesMistakes: true,
  rhythmSoundsTheMusic: true,
  offerToSync: true,
  readAheadSteps: 2,
  zoom: 1.2,
  immediateStart: false,
  dimUnplayed: true,
  pageTurns: 'manual',
  hearTheOtherHand: true,
  showRepeatNumbers: false,
  rushingCounts: false,
  markWhileListening: true,
  showPlaybackNotes: true,
  rollScrollPlayback: true,
  rollHeadAtPercent: 35,
  rhythmRuler: 'eighth',
  rulerCursor: true,
  rulerStrength: 0.5,
  restEveryMinutes: 45,
  whatOpens: 'random',
  scoreOrder: 'hardest',
  traceTheStart: true,
  stopAtAMistake: true,
  clickSilences: 'the-downbeat',
  keyboard: '61',
  countInRun: 'once',
  countInPlayback: 'every',
};

describe('practice settings codec', () => {
  it('round-trips every setting there is, named or not', () => {
    // A codec is two lists of field names, and the way it goes wrong is that
    // one list is missing a line: the setting is chosen, kept, and gone by the
    // next visit with nothing said. The checks below say what the awkward ones
    // become; this one says none of them is simply absent.
    expect(decodePracticeSettings(encodePracticeSettings(SETTINGS), KNOWN)).toEqual(SETTINGS);
  });

  it('round-trips everything the reader can choose', () => {
    const restored = decodePracticeSettings(encodePracticeSettings(SETTINGS), KNOWN);

    expect(restored.presetId).toBe('triads-left-hand');
    expect(restored.modeId).toBe('mode.flow');
    expect(restored.key?.equals(KeySignature.major(-2))).toBe(true);
    expect(restored.timeSignature?.toString()).toBe('3/4');
    expect(restored.measures).toBe(6);
    expect(restored.tempoPercent).toBe(84);
    expect(restored.countInBars).toBe(2);
    expect(restored.clickWhen).toBe('cycle-2');
    expect(restored.matchToleranceMs).toBe(180);
    expect(restored.pitchClassOnly).toBe(true);
    expect(restored.rhythmSoundsTheMusic).toBe(true);
    expect(restored.offerToSync).toBe(true);
    expect(restored.cursorWhileRunning).toBe(false);
    expect(restored.strictTiming).toBe(true);
    expect(restored.pageTurns).toBe('manual');
    expect(restored.stopAtAMistake).toBe(true);
    expect(restored.clickSilences).toBe('the-downbeat');
    expect(restored.keyboard).toBe('61');
    expect(restored.countInRun).toBe('once');
    expect(restored.countInPlayback).toBe('every');
    expect(restored.whatOpens).toBe('random');
    expect(restored.clickWhen).toBe('cycle-2');
  });

  it('reads the checkbox that page turns used to be', () => {
    // It was one flag over a behaviour nobody could turn off: the page
    // followed the music whatever it said, and the flag only decided whether
    // the next page was shown early. So a reader who had turned it off meant
    // "turn them, quietly".
    const stored = encodePracticeSettings(SETTINGS) as Record<string, unknown>;
    const asBefore = (previewNextPage: boolean): Record<string, unknown> => ({
      ...stored,
      pageTurns: undefined,
      previewNextPage,
    });

    expect(decodePracticeSettings(asBefore(true), KNOWN).pageTurns).toBe('preview');
    expect(decodePracticeSettings(asBefore(false), KNOWN).pageTurns).toBe('automatic');
    // And a device that stored neither says nothing, rather than inventing
    // an answer here: the defaults live with the other defaults.
    expect(
      decodePracticeSettings({ ...stored, pageTurns: undefined, previewNextPage: undefined }, KNOWN)
        .pageTurns,
    ).toBeUndefined();
  });

  it('reads the two settings this one used to be', () => {
    const legacy = { ...encodePracticeSettings(SETTINGS), clickWhen: undefined };
    const when = (stored: Record<string, unknown>): string | undefined =>
      decodePracticeSettings({ ...legacy, ...stored }, KNOWN).clickWhen;

    // The trap in the old names: `clickDropout: 'never'` meant the click never
    // *drops out* - it always sounds - while the new `never` means it never
    // sounds. Reading them by their old field name keeps the two apart.
    expect(when({ clickDropout: 'never' })).toBe('always');
    expect(when({ clickDropout: 'count-in-only' })).toBe('count-in-only');
    expect(when({ clickDropout: 'cycle-2' })).toBe('cycle-2');

    // Mute wins where both are set: someone who silenced the metronome meant
    // silence, whatever they had chosen about dropping out.
    expect(when({ clickDropout: 'cycle-2', metronomeMuted: true })).toBe('never');
    expect(when({ metronomeMuted: false, clickDropout: 'never' })).toBe('always');

    // And the bar count the dropout was before either of them.
    expect(when({ dropoutBars: 4 })).toBe('cycle-4');
    expect(when({ dropoutBars: 0 })).toBe('always');
    // A cycle length the menu never offered is dropped rather than invented.
    expect(when({ dropoutBars: 3 })).toBeUndefined();
  });

  it('keeps the listening frame, which no registry holds', () => {
    // It is the same setting as the two practice modes and is not one of
    // them, so anything checking a stored frame against the registry alone
    // throws it away - and a reader who shut the app watching the machine
    // play comes back to a run waiting for them. One list says what a frame
    // may be called, and both the app and this rig read it.
    const known: KnownIds = { ...KNOWN, modeIds: knownFrameIds(KNOWN.modeIds) };

    const read = decodePracticeSettings({ ...SETTINGS, modeId: LISTEN_MODE_ID }, known);

    expect(read.modeId).toBe(LISTEN_MODE_ID);
  });

  it('drops a preset or mode that no longer exists', () => {
    const restored = decodePracticeSettings(
      { ...encodePracticeSettings(SETTINGS), presetId: 'level-from-2019', modeId: 'mode.gone' },
      KNOWN,
    );

    // Dropped rather than kept, so start-up cannot fail on a stale id.
    expect(restored.presetId).toBeUndefined();
    expect(restored.modeId).toBeUndefined();
    expect(restored.tempoPercent).toBe(84);
  });

  it('drops individual values that make no sense, keeping the rest', () => {
    const restored = decodePracticeSettings(
      {
        ...encodePracticeSettings(SETTINGS),
        measures: 0,
        tempoPercent: 5_000,
        countInBars: -1,
        key: { fifths: 99, mode: 'major' },
        timeSignature: '4/7',
        clickWhen: 'whenever',
        // Past the middle is past where the music still to come is looked at.
        rollHeadAtPercent: 80,
      },
      KNOWN,
    );

    expect(restored.measures).toBeUndefined();
    expect(restored.tempoPercent).toBeUndefined();
    expect(restored.countInBars).toBeUndefined();
    expect(restored.key).toBeUndefined();
    expect(restored.timeSignature).toBeUndefined();
    expect(restored.clickWhen).toBeUndefined();
    expect(restored.rollHeadAtPercent).toBeUndefined();
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
      audioFeedback: true,
      computerKeyboard: true,
    });
    // Switched off on this device, and still off on the next visit.
    expect(decodeAudioSettings({ computerKeyboard: false }).computerKeyboard).toBe(false);
    expect(decodeAudioSettings({ audioFeedback: false }).audioFeedback).toBe(false);
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
    first.savePractice(SETTINGS, 1_000);
    first.saveAudio({
      metronomeVolume: 0.2,
      instrumentVolume: 0.9,
      sampleLoading: 'off',
      volumeController: 7,
      audioFeedback: false,
      computerKeyboard: false,
    });

    const second = new SettingsRepository(store, KNOWN);
    const restored = second.load();

    expect(restored.practice.tempoPercent).toBe(84);
    expect(restored.practice.presetId).toBe('triads-left-hand');
    expect(restored.audio).toEqual({
      metronomeVolume: 0.2,
      instrumentVolume: 0.9,
      sampleLoading: 'off',
      volumeController: 7,
      audioFeedback: false,
      computerKeyboard: false,
    });
  });

  it('keeps the practice settings when only the volume changes', () => {
    const store = new InMemorySettingsStore();
    const repository = new SettingsRepository(store, KNOWN);
    repository.load();
    repository.savePractice(SETTINGS, 1_000);

    repository.saveAudio({
      metronomeVolume: 0,
      instrumentVolume: 0,
      sampleLoading: 'eager',
      volumeController: null,
      audioFeedback: true,
      computerKeyboard: true,
    });

    const restored = new SettingsRepository(store, KNOWN).load();
    expect(restored.practice.tempoPercent).toBe(84);
    expect(restored.audio.metronomeVolume).toBe(0);
  });

  it('stamps a version, so a future format can be told apart', () => {
    const store = new InMemorySettingsStore();
    const repository = new SettingsRepository(store, KNOWN);
    repository.load();
    repository.savePractice(SETTINGS, 1_000);

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
    expect(() => repository.savePractice(SETTINGS, 1_000)).not.toThrow();
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

/** A drive folder as a map of names to contents. */
class FolderDrive implements ICloudDrive {
  readonly signedIn = true;
  readonly files = new Map<string, { id: string; content: string }>();
  private made = 0;

  prepare(): void {}

  connect(): Promise<void> {
    return Promise.resolve();
  }

  list(): Promise<readonly CloudFile[]> {
    return Promise.resolve([...this.files].map(([name, file]) => ({ id: file.id, name })));
  }

  read(id: string): Promise<string> {
    const found = [...this.files.values()].find((file) => file.id === id);
    return found === undefined ? Promise.reject(new Error('gone')) : Promise.resolve(found.content);
  }

  write(name: string, content: string, replacing: string | null): Promise<CloudFile> {
    const id = replacing ?? `file-${String((this.made += 1))}`;
    this.files.set(name, { id, content });
    return Promise.resolve({ id, name });
  }
}

describe('settings shared between devices', () => {
  function repository(): SettingsRepository {
    const kept = new SettingsRepository(new InMemorySettingsStore(), KNOWN);
    kept.load();
    return kept;
  }

  it('times a change to a shared setting, and nothing else', () => {
    // A device that only opened, or only zoomed, has said nothing another
    // device should give way to.
    const kept = repository();
    kept.savePractice(SETTINGS, 1_000);
    kept.savePractice(SETTINGS, 2_000);
    kept.savePractice({ ...SETTINGS, zoom: 2 }, 3_000);
    expect(kept.sharedSettings().changedAtMs).toBe(1_000);

    kept.savePractice({ ...SETTINGS, zoom: 2, tempoPercent: 90 }, 4_000);

    expect(kept.sharedSettings().changedAtMs).toBe(4_000);
  });

  it('keeps that moment across a visit', () => {
    const store = new InMemorySettingsStore();
    const first = new SettingsRepository(store, KNOWN);
    first.load();
    first.savePractice(SETTINGS, 4_000);

    const again = new SettingsRepository(store, KNOWN);
    again.load();

    expect(again.sharedSettings().changedAtMs).toBe(4_000);
  });

  it('shares everything but what belongs to one device', () => {
    const kept = repository();
    kept.savePractice(SETTINGS, 1_000);

    const values = kept.sharedSettings().values;

    for (const own of ['inputLatencyMs', 'zoom', 'traceTheStart', 'rangeFromBar', 'rangeToBar']) {
      expect(values).not.toHaveProperty(own);
    }
    expect(values['tempoPercent']).toBe(84);
  });

  it('takes another device settings, keeping its own, with their moment', () => {
    // Taking a word is not saying one: a device that has only caught up must
    // not come out newer than a change made elsewhere before it did.
    const kept = repository();
    kept.savePractice(SETTINGS, 1_000);

    const now = kept.adoptSettings({
      values: { ...kept.sharedSettings().values, tempoPercent: 50, zoom: 2.5 },
      changedAtMs: 7_000,
    });
    kept.savePractice({ ...SETTINGS, ...now }, 9_000);

    expect(now.tempoPercent).toBe(50);
    expect(now.zoom).toBe(SETTINGS.zoom);
    expect(kept.sharedSettings().changedAtMs).toBe(7_000);
  });
});

describe('syncing the settings through the drive', () => {
  function device(drive: FolderDrive, changes: Partial<PracticeSettings>, atMs: number) {
    const settings = new SettingsRepository(new InMemorySettingsStore(), KNOWN);
    settings.load();
    if (atMs > 0) {
      settings.savePractice({ ...SETTINGS, ...changes }, atMs);
    }
    const applied: Partial<PracticeSettings>[] = [];
    const sync = new SettingsSync({ drive, settings, apply: (practice) => applied.push(practice) });
    return { settings, sync, applied };
  }

  it('sends them where the drive has none', async () => {
    const drive = new FolderDrive();
    const pc = device(drive, { tempoPercent: 70 }, 1_000);

    expect(await pc.sync.sync()).toBe('sent');
    expect(JSON.parse(drive.files.get('settings.json')?.content ?? '{}')).toMatchObject({
      changedAtMs: 1_000,
      practice: { tempoPercent: 70 },
    });
  });

  it('brings newer ones here and puts them in front of the reader', async () => {
    const drive = new FolderDrive();
    await device(drive, { tempoPercent: 70 }, 5_000).sync.sync();
    const ipad = device(drive, { tempoPercent: 100, zoom: 2 }, 1_000);

    expect(await ipad.sync.sync()).toBe('brought');
    expect(ipad.applied[0]?.tempoPercent).toBe(70);
    expect(ipad.applied[0]?.zoom).toBe(2);
  });

  it('sends newer ones from here over older ones on the drive', async () => {
    const drive = new FolderDrive();
    await device(drive, { tempoPercent: 70 }, 1_000).sync.sync();
    const pc = device(drive, { tempoPercent: 90 }, 5_000);

    expect(await pc.sync.sync()).toBe('sent');
    expect(pc.applied).toEqual([]);
  });

  it('starts a new device from where the others are', async () => {
    // Nothing changed here since changes were timed, so nothing here can win.
    const drive = new FolderDrive();
    await drive.write(
      'settings.json',
      JSON.stringify({ version: 1, changedAtMs: 0, practice: { tempoPercent: 70 } }),
      null,
    );
    const ipad = device(drive, {}, 0);

    expect(await ipad.sync.sync()).toBe('brought');
    expect(ipad.applied[0]?.tempoPercent).toBe(70);
  });

  it('says so when both already agree', async () => {
    const drive = new FolderDrive();
    const pc = device(drive, { tempoPercent: 70 }, 1_000);
    await pc.sync.sync();

    expect(await pc.sync.sync()).toBe('same');
  });

  it('reads settings it cannot make sense of as none', async () => {
    const drive = new FolderDrive();
    await drive.write('settings.json', 'not json', null);

    expect(await device(drive, { tempoPercent: 70 }, 1_000).sync.sync()).toBe('sent');
  });
});

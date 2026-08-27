import { PracticeController } from '../application/PracticeController.js';
import type { Unsubscribe } from '../shared/EventEmitter.js';
import { FlowMode } from '../application/modes/FlowMode.js';
import { PracticeModeRegistry } from '../application/modes/PracticeModeRegistry.js';
import { WaitMode } from '../application/modes/WaitMode.js';
import type {
  IPitchPlayer,
  ISampleLibrary,
  ISustainPedal,
} from '../application/ports/IPitchPlayer.js';
import type {
  IMidiConnection,
  IMidiDeviceDirectory,
  IMidiSource,
} from '../application/ports/IMidiSource.js';
import type { IScoreRenderer } from '../application/ports/IScoreRenderer.js';
import type { IVolumeControl } from '../application/ports/IVolumeControl.js';
import type { ISettingsStore } from '../application/ports/ISettingsStore.js';
import { SettingsRepository } from '../application/SettingsRepository.js';
import {
  LocalStorageSettingsStore,
  browserStorage,
} from '../infrastructure/storage/LocalStorageSettingsStore.js';
import { ExercisePresetRegistry } from '../domain/generation/ExercisePresetRegistry.js';
import { BUILT_IN_PRESETS } from '../domain/generation/presets.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../domain/generation/rhythmProfiles.js';
import { RhythmProfileRegistry } from '../domain/generation/RhythmProfile.js';
import { MusicXmlSerializer } from '../domain/notation/MusicXmlSerializer.js';
import { ScoringStrategyRegistry } from '../domain/scoring/ScoringStrategyRegistry.js';
import {
  AccuracyScoringStrategy,
  ContinuityScoringStrategy,
  TimingWeightedScoringStrategy,
} from '../domain/scoring/strategies.js';
import { WebAudioMetronome, createAudioContextFactory } from '../infrastructure/audio/WebAudioMetronome.js';
import { WebAudioPitchPlayer } from '../infrastructure/audio/WebAudioPitchPlayer.js';
import { SampledPitchPlayer } from '../infrastructure/audio/SampledPitchPlayer.js';
import { CompositeMidiSource } from '../infrastructure/midi/CompositeMidiSource.js';
import {
  ComputerKeyboardMidiSource,
  type KeyboardTarget,
} from '../infrastructure/midi/ComputerKeyboardMidiSource.js';
import { WebMidiAdapter } from '../infrastructure/midi/WebMidiAdapter.js';
import { WebSocketMidiSource } from '../infrastructure/midi/WebSocketMidiSource.js';
import { resolveBridgeUrl, type LocationLike } from '../infrastructure/midi/bridgeUrl.js';
import { browserMidiAccessProvider } from '../infrastructure/midi/webmidi-dom.js';
import { OsmdScoreRenderer } from '../infrastructure/rendering/OsmdScoreRenderer.js';
import { SystemClock } from '../infrastructure/time/SystemClock.js';

export interface AppRuntimeOptions {
  readonly scoreContainer: HTMLElement;
  readonly keyboardTarget: KeyboardTarget;
  /** Where the page was loaded from; decides whether to look for a bridge. */
  readonly location: LocationLike;
  /** Defaults to this device's browser storage. */
  readonly settingsStore?: ISettingsStore;
  /** Where the piano samples live; resolved against the page by default. */
  readonly sampleBaseUrl?: string;
}

/**
 * A desktop relay standing in for hardware the browser cannot reach itself.
 */
export interface IMidiBridge extends IMidiSource, IMidiConnection {
  readonly deviceName: string | null;
  readonly endpoint: string;
  onDeviceChange(listener: (device: string | null) => void): Unsubscribe;
}

/**
 * Everything the UI is allowed to talk to.
 *
 * Deliberately expressed in ports rather than in concrete adapters, so the
 * view can be driven by test doubles exactly as it is driven in the browser.
 */
export interface AppRuntime {
  readonly controller: PracticeController;
  readonly presets: ExercisePresetRegistry;
  readonly rhythms: RhythmProfileRegistry;
  readonly scorings: ScoringStrategyRegistry;
  readonly modes: PracticeModeRegistry;
  readonly webMidi: IMidiSource & IMidiConnection & IMidiDeviceDirectory;
  /** `null` when the page cannot reach a bridge, e.g. on the public site. */
  readonly bridge: IMidiBridge | null;
  readonly computerKeyboard: IMidiSource & IToggleableInput;
  readonly pitchPlayer: IPitchPlayer;
  /** `null` when the instrument has no dampers to lift. */
  readonly sustain: ISustainPedal | null;
  /** `null` when the instrument needs nothing downloaded. */
  readonly samples: ISampleLibrary | null;
  readonly renderer: IScoreRenderer;
  readonly settings: SettingsRepository;
  readonly metronomeVolume: IVolumeControl;
  readonly instrumentVolume: IVolumeControl;
  dispose(): void;
}

/** An input source the user can switch on and off. */
export interface IToggleableInput {
  readonly isEnabled: boolean;
  enable(): void;
  disable(): void;
}

/**
 * Composition root.
 *
 * This is the only place where concrete adapters meet the application. Every
 * other module receives its collaborators through constructor parameters, so
 * swapping OSMD, Web MIDI or Web Audio for something else - or for a test
 * double - happens here and nowhere else.
 */
export function createApp(options: AppRuntimeOptions): AppRuntime {
  const clock = new SystemClock();
  const audioContextFactory = createAudioContextFactory();

  const metronome = new WebAudioMetronome(audioContextFactory);

  // Recorded piano, with the synthesised tone standing in until the samples
  // have downloaded - a key must never be silent while waiting on the network.
  const pitchPlayer = new SampledPitchPlayer(audioContextFactory, {
    baseUrl: options.sampleBaseUrl ?? 'samples/piano/',
    fallback: new WebAudioPitchPlayer(audioContextFactory),
  });

  const webMidi = new WebMidiAdapter(browserMidiAccessProvider(), clock);
  const computerKeyboard = new ComputerKeyboardMidiSource(options.keyboardTarget, clock);

  // On a tablet the keyboard is plugged into a computer on the same network,
  // not into the device showing the page.
  const bridgeUrl = resolveBridgeUrl(options.location);
  const bridge =
    bridgeUrl === null ? null : new WebSocketMidiSource({ url: bridgeUrl, clock });

  const sources: IMidiSource[] = [webMidi, computerKeyboard];
  if (bridge !== null) {
    sources.push(bridge);
  }
  const midi = new CompositeMidiSource(sources);

  const renderer = new OsmdScoreRenderer(options.scoreContainer);
  const serializer = new MusicXmlSerializer();

  const presets = new ExercisePresetRegistry().registerAll(BUILT_IN_PRESETS);
  const rhythms = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);
  const scorings = new ScoringStrategyRegistry().registerAll([
    new AccuracyScoringStrategy(),
    new TimingWeightedScoringStrategy(),
    new ContinuityScoringStrategy(),
  ]);
  const modes = new PracticeModeRegistry().registerAll([new WaitMode(), new FlowMode()]);

  const settings = new SettingsRepository(
    options.settingsStore ?? new LocalStorageSettingsStore(browserStorage()),
    {
      presetIds: presets.list().map((preset) => preset.id),
      modeIds: modes.list().map((mode) => mode.id),
      rhythmProfileIds: rhythms.list().map((profile) => profile.id),
      scoringIds: scorings.list().map((strategy) => strategy.id),
    },
  );
  const restored = settings.load();
  metronome.setVolume(restored.audio.metronomeVolume);
  pitchPlayer.setVolume(restored.audio.instrumentVolume);
  pitchPlayer.setLoading(restored.audio.sampleLoading);


  const controller = new PracticeController({
    presets,
    rhythms,
    modes,
    serializer,
    renderer,
    cursor: renderer.cursor,
    overlay: renderer,
    fade: renderer,
    zoom: renderer,
    midi,
    metronome,
    clock,
    scorings,
    initialSettings: restored.practice,
  });

  // Whatever the reader changes is what they will find next time.
  controller.events.on('settingsChanged', ({ settings: current }) => {
    settings.savePractice(current);
  });

  return {
    controller,
    presets,
    rhythms,
    scorings,
    modes,
    webMidi,
    bridge,
    computerKeyboard,
    pitchPlayer,
    sustain: pitchPlayer,
    samples: pitchPlayer,
    renderer,
    settings,
    metronomeVolume: metronome,
    instrumentVolume: pitchPlayer,
    dispose(): void {
      controller.dispose();
      computerKeyboard.disable();
      void webMidi.disconnect();
      void bridge?.disconnect();
      metronome.stop();
      pitchPlayer.stopAll();
    },
  };
}

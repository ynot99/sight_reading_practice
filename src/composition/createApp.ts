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
import type {
  IHandSwitches,
  IPassageMarkers,
  IRhythmRuler,
  IScorePages,
  IScoreRenderer,
} from '../application/ports/IScoreRenderer.js';
import type { IVolumeControl } from '../application/ports/IVolumeControl.js';
import type { ISettingsStore } from '../application/ports/ISettingsStore.js';
import { SettingsRepository } from '../application/SettingsRepository.js';
import { PracticeHistory } from '../application/PracticeHistory.js';
import { PerformanceRecorder } from '../application/PerformanceRecorder.js';
import { ControlBinding } from '../application/ControlBinding.js';
import { TakeLibrary, TAKES_STORAGE_KEY } from '../application/TakeLibrary.js';
import { TakePlayer } from '../application/TakePlayer.js';
import { BackupService } from '../application/Backup.js';
import { ScoreLibrary } from '../application/ScoreLibrary.js';
import { IndexedDbScoreStore } from '../infrastructure/storage/IndexedDbScoreStore.js';
import type { IScoreStore } from '../application/ports/IScoreStore.js';
import { DownloadFileSink } from '../infrastructure/files/DownloadFileSink.js';
import type { IFileSink } from '../application/ports/IFileSink.js';
import { PracticeLadder } from '../application/ladder/PracticeLadder.js';
import { BUILT_IN_LADDER } from '../application/ladder/ladderSteps.js';
import {
  DEFAULT_STORAGE_KEY,
  HISTORY_STORAGE_KEY,
  LocalStorageSettingsStore,
  browserStorage,
} from '../infrastructure/storage/LocalStorageSettingsStore.js';
import { ExercisePresetRegistry } from '../domain/generation/ExercisePresetRegistry.js';
import { BUILT_IN_PRESETS } from '../domain/generation/presets.js';
import type { IScoreImporter } from '../application/ports/IScoreImporter.js';
import { DomScoreImporter } from '../infrastructure/notation/DomScoreImporter.js';
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
import type { IClock } from '../application/ports/IClock.js';

export interface AppRuntimeOptions {
  readonly scoreContainer: HTMLElement;
  readonly keyboardTarget: KeyboardTarget;
  /** Where the page was loaded from; decides whether to look for a bridge. */
  readonly location: LocationLike;
  /** Defaults to this device's browser storage. */
  readonly settingsStore?: ISettingsStore;
  /** Where past readings are kept; browser storage by default. */
  readonly historyStore?: ISettingsStore;
  /** Where kept takes live; browser storage by default. */
  readonly takeStore?: ISettingsStore;
  /** Where kept scores live; the browser's database by default. */
  readonly scoreStore?: IScoreStore;
  /** Where a finished file is handed over; a download by default. */
  readonly fileSink?: IFileSink;
  /** Where the piano samples live; resolved against the page by default. */
  readonly sampleBaseUrl?: string;
}

/**
 * A desktop relay standing in for hardware the browser cannot reach itself.
 */
export interface IMidiBridge extends IMidiSource, IMidiConnection {
  readonly deviceName: string | null;
  readonly endpoint: string;
  /**
   * How far the relay's clock is from this page's, or `null` until it can say.
   *
   * Worth having where a reader can see it: a hundred milliseconds of
   * lateness looks the same whether it came from their keyboard or from a
   * computer that thinks it is a different time, and only one of those is
   * theirs to fix.
   */
  readonly clockSkewMs: number | null;
  /**
   * How unsteady the hop is, or `null` until it can say.
   *
   * The half of the delay that cannot be corrected away, and therefore the
   * half worth showing: a steady hop is folded into the clock difference and
   * subtracted with it, while an unsteady one is felt directly.
   */
  readonly hopSpreadMs: number | null;
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
  readonly ladder: PracticeLadder;
  /** Always capturing, so what was just played can still be kept. */
  readonly recorder: PerformanceRecorder;
  /** The knob the reader taught to drive the note volume, if they have. */
  readonly volumeKnob: ControlBinding;
  readonly takes: TakeLibrary;
  /** Plays a kept take back, so an idea can be heard rather than only listed. */
  readonly takePlayer: TakePlayer;
  /** Carries everything off this device, since an installed app cannot see the tab's. */
  readonly backup: BackupService;
  /** Scores kept between visits, so a file is chosen from the disk once. */
  readonly scores: ScoreLibrary;
  readonly files: IFileSink;
  readonly importer: IScoreImporter;
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
  readonly renderer: IScoreRenderer &
    IPassageMarkers &
    IScorePages &
    IHandSwitches &
    IRhythmRuler;
  /**
   * The page's own clock, which every moment the run announces is on.
   *
   * The view times things - a look, a beat about to fall - and a delay is
   * the difference between a promised moment and now. Asking the same clock
   * the moment was made on is the only way those two are the same question.
   */
  readonly clock: IClock;
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

  const importer = new DomScoreImporter();
  const presets = new ExercisePresetRegistry().registerAll(BUILT_IN_PRESETS);
  const rhythms = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);
  const scorings = new ScoringStrategyRegistry().registerAll([
    new AccuracyScoringStrategy(),
    new TimingWeightedScoringStrategy(),
    new ContinuityScoringStrategy(),
  ]);
  const modes = new PracticeModeRegistry().registerAll([new WaitMode(), new FlowMode()]);
  const ladder = new PracticeLadder(BUILT_IN_LADDER);

  const settingsStore =
    options.settingsStore ?? new LocalStorageSettingsStore(browserStorage());
  const settings = new SettingsRepository(
    settingsStore,
    {
      presetIds: presets.list().map((preset) => preset.id),
      modeIds: modes.list().map((mode) => mode.id),
      rhythmProfileIds: rhythms.list().map((profile) => profile.id),
      scoringIds: scorings.list().map((strategy) => strategy.id),
      ladderStepIds: ladder.list().map((step) => step.id),
    },
  );
  // Recording from the moment the page opens, because an idea worth keeping
  // is one the player notices after playing it.
  const recorder = new PerformanceRecorder(clock);
  const takePlayer = new TakePlayer({ instrument: pitchPlayer, clock, sustain: pitchPlayer });
  const disposeRecorder = recorder.listenTo(midi);
  // Listening from the start too: a knob taught on an earlier visit has to
  // work without the reader teaching it again.
  const volumeKnob = new ControlBinding();
  const disposeKnob = volumeKnob.listenTo(midi);
  const takeStore =
    options.takeStore ?? new LocalStorageSettingsStore(browserStorage(), TAKES_STORAGE_KEY);
  const takes = new TakeLibrary(takeStore);
  takes.load();

  const scoreStore = options.scoreStore ?? new IndexedDbScoreStore();
  const scores = new ScoreLibrary({ store: scoreStore, serializer, importer });

  const historyStore =
    options.historyStore ?? new LocalStorageSettingsStore(browserStorage(), HISTORY_STORAGE_KEY);
  const history = new PracticeHistory(historyStore);
  history.load();

  // Everything kept between visits, so one file can carry all of it. Keyed by
  // where each blob lives, which is what a restore has to put it back under.
  const backup = new BackupService({
    stores: new Map([
      [DEFAULT_STORAGE_KEY, settingsStore],
      [TAKES_STORAGE_KEY, takeStore],
      [HISTORY_STORAGE_KEY, historyStore],
    ]),
    scoreStore,
    clock,
  });

  const restored = settings.load();
  metronome.setVolume(restored.audio.metronomeVolume);
  pitchPlayer.setVolume(restored.audio.instrumentVolume);
  pitchPlayer.setLoading(restored.audio.sampleLoading);
  volumeKnob.bindTo(restored.audio.volumeController);


  const controller = new PracticeController({
    presets,
    rhythms,
    modes,
    ladder,
    serializer,
    renderer,
    cursor: renderer.cursor,
    overlay: renderer,
    fade: renderer,
    stuck: renderer,
    ruler: renderer,
    zoom: renderer,
    midi,
    metronome,
    instrument: pitchPlayer,
    history,
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
    ladder,
    recorder,
    takePlayer,
    backup,
    volumeKnob,
    takes,
    scores,
    files: options.fileSink ?? new DownloadFileSink(document),
    importer,
    scorings,
    modes,
    webMidi,
    bridge,
    computerKeyboard,
    pitchPlayer,
    sustain: pitchPlayer,
    samples: pitchPlayer,
    renderer,
    clock,
    settings,
    metronomeVolume: metronome,
    instrumentVolume: pitchPlayer,
    dispose(): void {
      controller.dispose();
      disposeRecorder();
      disposeKnob();
      volumeKnob.dispose();
      computerKeyboard.disable();
      void webMidi.disconnect();
      void bridge?.disconnect();
      metronome.stop();
      pitchPlayer.stopAll();
      renderer.dispose();
    },
  };
}

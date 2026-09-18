import { PracticeController } from '../application/PracticeController.js';
import type { Unsubscribe } from '../shared/EventEmitter.js';
import { BarMode } from '../application/modes/BarMode.js';
import { FlowMode } from '../application/modes/FlowMode.js';
import { NoAudioWaking, type IAudioWaking } from '../application/ports/IAudioWaking.js';
import { NoScreenWake, type IScreenWake } from '../application/ports/IScreenWake.js';
import { ScreenWakeLock } from '../infrastructure/screen/ScreenWakeLock.js';
import { knownFrameIds } from '../application/modes/ListenFrame.js';
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
  IOtherHandMarker,
  IPassageMarkers,
  IRhythmRuler,
  IScorePages,
  IScoreRenderer,
} from '../application/ports/IScoreRenderer.js';
import type { IClickOnce } from '../application/ports/IMetronome.js';
import type { IVolumeControl } from '../application/ports/IVolumeControl.js';
import type { ISettingsStore } from '../application/ports/ISettingsStore.js';
import { SettingsRepository } from '../application/SettingsRepository.js';
import { PracticeHistory } from '../application/PracticeHistory.js';
import { TimeToday } from '../application/TimeToday.js';
import { PerformanceRecorder } from '../application/PerformanceRecorder.js';
import { ControlBinding } from '../application/ControlBinding.js';
import { TakeLibrary } from '../application/TakeLibrary.js';
import { TakePlayer } from '../application/TakePlayer.js';
import { BackupService } from '../application/Backup.js';
import { ScoreLibrary } from '../application/ScoreLibrary.js';
import {
  IndexedDbScoreStore,
  browserIndexedDb,
} from '../infrastructure/storage/IndexedDbScoreStore.js';
import { openShelf, openShelfDatabase } from '../infrastructure/storage/DatabaseShelf.js';
import { GoogleDrive, loadGoogleIdentity } from '../infrastructure/cloud/GoogleDrive.js';
import { LibrarySync } from '../application/LibrarySync.js';
import type { ICloudDrive } from '../application/ports/ICloudDrive.js';

/**
 * Which program is asking Google for the reader's drive, from the build's
 * environment: `VITE_GOOGLE_CLIENT_ID`, in `.env` on this machine and a
 * repository variable for the published site.
 *
 * Kept out of the repository at his asking. It is not a secret - it names the
 * program, it is in every built copy, and Google lets it sign in only from the
 * addresses registered for it - and a build without it has no drive.
 */
const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
import type { IScoreStore } from '../application/ports/IScoreStore.js';
import type { IStorageGauge } from '../application/ports/IStorageGauge.js';
import { DownloadFileSink } from '../infrastructure/files/DownloadFileSink.js';
import type { IFileSink } from '../application/ports/IFileSink.js';
import { PracticeLadder } from '../application/ladder/PracticeLadder.js';
import { BUILT_IN_LADDER } from '../application/ladder/ladderSteps.js';
import {
  DEFAULT_STORAGE_KEY,
  HISTORY_STORAGE_KEY,
  KEPT_STORAGE_KEYS,
  TAKES_STORAGE_KEY,
  TIME_STORAGE_KEY,
  LocalStorageSettingsStore,
  browserStorage,
} from '../infrastructure/storage/LocalStorageSettingsStore.js';
import {
  BrowserStorageGauge,
  browserStorageManager,
} from '../infrastructure/storage/BrowserStorageGauge.js';
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
import { keepAudioAwake } from '../infrastructure/audio/keepAudioAwake.js';
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
  /** Where the day counter is kept, so a test can hand it nothing. */
  readonly timeStore?: ISettingsStore;
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
  /**
   * Every reading that has been recorded, for the list of them.
   *
   * Handed to the page as well as to the controller: the controller asks it
   * about the passage in front of the reader, and the page asks it about all
   * of them at once. One history, two questions.
   */
  readonly history: PracticeHistory;
  /**
   * How long the application has been open today.
   *
   * Not the same question as the rest reminder's: that one counts notes,
   * because hands are what a rest is for.
   */
  readonly timeToday: TimeToday;
  /** Plays a kept take back, so an idea can be heard rather than only listed. */
  readonly takePlayer: TakePlayer;
  /** Carries everything off this device, since an installed app cannot see the tab's. */
  readonly backup: BackupService;
  /** What the device keeps for the trainer, and whether it will be kept. */
  readonly storage: IStorageGauge;
  /** The reader's Google Drive, one folder of it. */
  readonly cloudDrive: ICloudDrive;
  /** Keeps the library the same on every device, through that folder. */
  readonly librarySync: LibrarySync;
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
  /** Keeps the screen up while the reader is playing. */
  readonly screenWake: IScreenWake;
  /** The audio device, and whether it can sound anything yet. */
  readonly audio: IAudioWaking;
  /** `null` when the instrument has no dampers to lift. */
  readonly sustain: ISustainPedal | null;
  /** `null` when the instrument needs nothing downloaded. */
  readonly samples: ISampleLibrary | null;
  readonly renderer: IScoreRenderer &
    IPassageMarkers &
    IScorePages &
    IHandSwitches &
    IOtherHandMarker &
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
  /**
   * One click, on demand, for the page's own reasons.
   *
   * Narrowed from the metronome rather than being it: hearing a run back wants
   * the beat sounded at recorded moments, and nothing in the page has any
   * business starting or stopping the pulse a run rides on.
   */
  readonly metronomeClick: IClickOnce;
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

/** The shelves that outgrew the small store, which take a moment to open. */
export interface KeptShelves {
  readonly takes: ISettingsStore;
  readonly history: ISettingsStore;
}

/**
 * Opens the takes and the readings in the browser's database, moving them out
 * of the small store the first time.
 *
 * Before `createApp` rather than inside it: both are read while the
 * application is built, and a database only answers later. Here all the same,
 * because this is the one place adapters are made.
 */
export async function openTheShelves(): Promise<KeptShelves> {
  const database = await openShelfDatabase(browserIndexedDb());
  const local = browserStorage();
  return {
    takes: await openShelf(database, local, TAKES_STORAGE_KEY),
    history: await openShelf(database, local, HISTORY_STORAGE_KEY),
  };
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
  // Awake from the reader's first touch of the page, and kept awake.
  //
  // A browser will not start an audio context outside a user gesture, and a
  // key on a MIDI keyboard is not one - as far as the page is concerned nobody
  // has touched it. So the first thing to ask for sound created a context that
  // was suspended and then waited for it, and a run that begins by playing
  // stood still until a finger reached the screen. Asking for a click and
  // hearing one have to be the same moment: that is what playing with a
  // metronome means.
  const waking =
    typeof document === 'undefined' ? null : keepAudioAwake(audioContextFactory, document);

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
  const modes = new PracticeModeRegistry().registerAll([
    new FlowMode(),
    new BarMode(),
    new WaitMode(),
  ]);
  const ladder = new PracticeLadder(BUILT_IN_LADDER);

  const settingsStore =
    options.settingsStore ?? new LocalStorageSettingsStore(browserStorage());
  const settings = new SettingsRepository(
    settingsStore,
    {
      presetIds: presets.list().map((preset) => preset.id),
      // The listening frame among them, though the registry does not hold
      // it: it is the same setting, and a reader who left the app watching
      // the machine play should find it there when they come back.
      modeIds: knownFrameIds(modes.list().map((mode) => mode.id)),
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
  const storage = new BrowserStorageGauge(browserStorageManager(), browserStorage(), [
    { name: 'settings', key: DEFAULT_STORAGE_KEY },
    { name: 'readings', key: HISTORY_STORAGE_KEY },
    { name: 'time today', key: TIME_STORAGE_KEY },
    { name: 'takes', key: TAKES_STORAGE_KEY },
  ]);
  const scores = new ScoreLibrary({ store: scoreStore, serializer, importer, keeper: storage });
  const cloudDrive = new GoogleDrive({
    clientId: GOOGLE_CLIENT_ID,
    identity: loadGoogleIdentity(options.scoreContainer.ownerDocument),
    fetch: (url, init) => fetch(url, init),
    now: () => Date.now(),
  });
  const librarySync = new LibrarySync({
    drive: cloudDrive,
    store: scoreStore,
    reload: () => scores.load(),
  });

  const historyStore =
    options.historyStore ?? new LocalStorageSettingsStore(browserStorage(), HISTORY_STORAGE_KEY);
  const history = new PracticeHistory(historyStore);
  history.load();

  const timeStore =
    options.timeStore ?? new LocalStorageSettingsStore(browserStorage(), TIME_STORAGE_KEY);
  const timeToday = new TimeToday(timeStore);
  timeToday.load();

  // Everything kept between visits, so one file can carry all of it. Keyed by
  // where each blob lives, which is what a restore has to put it back under.
  const kept = new Map([
    [DEFAULT_STORAGE_KEY, settingsStore],
    [TAKES_STORAGE_KEY, takeStore],
    [HISTORY_STORAGE_KEY, historyStore],
    [TIME_STORAGE_KEY, timeStore],
  ]);
  // Loudly, and at startup. A store that is kept but not carried costs
  // nothing until the day the reader needs the file, and then it costs them
  // whatever was in it - so the one failure this must not have is a quiet
  // one.
  const uncarried = KEPT_STORAGE_KEYS.filter((key) => !kept.has(key));
  if (uncarried.length > 0) {
    throw new Error(`The backup would not carry: ${uncarried.join(', ')}.`);
  }
  const backup = new BackupService({ stores: kept, scoreStore, clock });

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
    storage,
    cloudDrive,
    librarySync,
    volumeKnob,
    takes,
    history,
    timeToday,
    scores,
    files: options.fileSink ?? new DownloadFileSink(document),
    importer,
    scorings,
    modes,
    webMidi,
    bridge,
    computerKeyboard,
    pitchPlayer,
    // A tablet on a music stand is looked at and not touched: a piece played
    // through sends every note as MIDI and nothing at all to the screen, so
    // the device decides nobody is there and turns the page off mid-bar.
    audio: waking ?? new NoAudioWaking(),
    screenWake:
      typeof navigator === 'undefined' || typeof document === 'undefined'
        ? new NoScreenWake()
        : new ScreenWakeLock(navigator, document),
    sustain: pitchPlayer,
    samples: pitchPlayer,
    renderer,
    clock,
    settings,
    metronomeClick: metronome,
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

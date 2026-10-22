// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import type { CloudFile, ICloudDrive } from '../../src/application/ports/ICloudDrive.js';
import type { ICodeSignIn, SignInCode } from '../../src/application/ports/ICodeSignIn.js';
import type { ITimingTrail } from '../../src/application/ports/ITimingTrail.js';
import { timeTheStart } from '../../src/shared/timeTheStart.js';
import { LibrarySync } from '../../src/application/LibrarySync.js';
import { SettingsSync } from '../../src/application/SettingsSync.js';
import { DriveSync } from '../../src/application/DriveSync.js';
import { SketchSync } from '../../src/application/SketchSync.js';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { DARK_SYSTEM_THEMES, PracticeController, TEMPO_STEP_PERCENT, THEMES } from '../../src/application/PracticeController.js';
import {
  DEFAULT_STORAGE_KEY,
  LocalStorageSettingsStore,
} from '../../src/infrastructure/storage/LocalStorageSettingsStore.js';
import { FLOW_MODE_ID, FlowMode } from '../../src/application/modes/FlowMode.js';
import { WAIT_MODE_ID } from '../../src/application/modes/WaitMode.js';
import { PracticeModeRegistry } from '../../src/application/modes/PracticeModeRegistry.js';
import { BarMode, BAR_MODE_ID } from '../../src/application/modes/BarMode.js';
import { NoteMode, NOTE_MODE_ID } from '../../src/application/modes/NoteMode.js';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import { CLICK_PATTERNS, CLICK_WHEN_CHOICES } from '../../src/application/ports/IMetronome.js';
import { HOLD_MS } from '../../src/shared/holding.js';
import { LISTEN_MODE_ID, knownFrameIds } from '../../src/application/modes/ListenFrame.js';
import { clockTime } from '../../src/ui/scrubBar.js';
import type { AppRuntime } from '../../src/composition/createApp.js';
import type { IMediaKeys, WhatIsSounding } from '../../src/application/ports/IMediaKeys.js';
import { ExercisePresetRegistry } from '../../src/domain/generation/ExercisePresetRegistry.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';
import { PracticeLadder } from '../../src/application/ladder/PracticeLadder.js';
import { PerformanceRecorder } from '../../src/application/PerformanceRecorder.js';
import { ControlBinding } from '../../src/application/ControlBinding.js';
import { DrillProgress } from '../../src/application/drill/DrillProgress.js';
import { TakeLibrary } from '../../src/application/TakeLibrary.js';
import { SketchLibrary, aKeyInTheScale } from '../../src/application/SketchLibrary.js';
import { TakeOnOffer } from '../../src/application/TakeOnOffer.js';
import { TakePlayer } from '../../src/application/TakePlayer.js';
import { BackupService } from '../../src/application/Backup.js';
import { ScoreLibrary } from '../../src/application/ScoreLibrary.js';
import { InMemoryScoreStore } from '../../src/application/ports/IScoreStore.js';
import { TimeToday } from '../../src/application/TimeToday.js';
import { PracticeHistory } from '../../src/application/PracticeHistory.js';
import type { PracticeAttempt } from '../../src/application/PracticeHistory.js';
import {
  beatsWorthMarking,
  rollBeganAtMs,
  rollEndedAtMs,
  rollOfTheTake,
  theKeysOfTheTake,
  theNotesOnTheClipboard,
  theChangeOnTheClipboard,
  theClipboardTextOf,
  theClipboardTextOfTheChange,
  theMusicsBeats,
  type RunRoll,
} from '../../src/application/session/RunRoll.js';
import { beginThePlaybackTimings } from '../../src/shared/playbackTimings.js';
import { theLatestPlayback } from '../support/playbackTimings.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { DYNAMIC_VELOCITY } from '../../src/domain/model/Exercise.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { theKeyChangesOf, type MidiFileEvent } from '../../src/domain/midi/MidiFile.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { readMidiFile } from '../../src/domain/midi/readMidiFile.js';
import { RecordingFileSink } from '../../src/application/ports/IFileSink.js';
import { BUILT_IN_GRADES } from '../../src/application/ladder/grades.js';
import { BUILT_IN_LADDER } from '../../src/application/ladder/ladderSteps.js';

import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { PrintedOnce } from '../../src/domain/notation/printedOnce.js';
import {
  AccuracyScoringStrategy,
  TimingWeightedScoringStrategy,
} from '../../src/domain/scoring/strategies.js';
import { ScoringStrategyRegistry } from '../../src/domain/scoring/ScoringStrategyRegistry.js';
import { ScoreFileImporter } from '../../src/infrastructure/notation/ScoreFileImporter.js';
import type { KeyboardTarget } from '../../src/infrastructure/midi/ComputerKeyboardMidiSource.js';
import { ComputerKeyboardMidiSource } from '../../src/infrastructure/midi/ComputerKeyboardMidiSource.js';
import { FakeScoreRenderer } from '../../src/infrastructure/testing/FakeScoreRenderer.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { ManualMetronome } from '../../src/infrastructure/testing/ManualMetronome.js';
import { MockMidiAdapter } from '../../src/infrastructure/testing/MockMidiAdapter.js';
import { RecordingPitchPlayer } from '../../src/infrastructure/testing/RecordingPitchPlayer.js';

/** Remembers whether the screen was asked to stay up, and how often. */
/** A device that starts asleep only when a test says so, and can be woken. */
class TestAudioWaking implements IAudioWaking {
  private running = true;
  private readonly listeners: (() => void)[] = [];

  asleep(): void {
    this.running = false;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  awake(): boolean {
    return this.running;
  }

  wake(): void {
    this.running = true;
    for (const listener of [...this.listeners]) {
      listener();
    }
  }

  onChange(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => undefined;
  }
}

class CountingScreenWake implements IScreenWake {
  held = false;
  holds = 0;
  releases = 0;

  hold(): void {
    this.held = true;
    this.holds += 1;
  }

  release(): void {
    this.held = false;
    this.releases += 1;
  }
}
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import type { IAudioWaking } from '../../src/application/ports/IAudioWaking.js';
import type { IScreenWake } from '../../src/application/ports/IScreenWake.js';
import { SettingsRepository } from '../../src/application/SettingsRepository.js';
import type { IVolumeControl } from '../../src/application/ports/IVolumeControl.js';
import type { SampleLoading } from '../../src/application/ports/IPitchPlayer.js';
import { WebMidiAdapter } from '../../src/infrastructure/midi/WebMidiAdapter.js';
import {
  AppView,
  describeTendency,
  healthGlideMs,
  isRealTendency,
  middle,
  spreadAround,
} from '../../src/ui/AppView.js';
import {
  MIDI,
  beamedSixteenths,
  compoundBarExercise,
  longExercise,
  offBeatAfterALongNote,
  oneHandWalksUnderAHeldNote,
  oneKeyInBothHands,
  unisonInTwoVoices,
  p,
  twoBarExercise,
} from '../support/fixtures.js';
import { Recorder } from '../support/recordingCanvas.js';
import { theFallingRuling } from '../../src/ui/fallingNotes.js';

// Resolved from the project root: in a jsdom environment `import.meta.url` is
// served over http, so it cannot be turned into a file path.
const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

/** Installs the real markup, so a renamed id fails this test rather than production. */
/**
 * The views a test has made, so that each can be let go of at the end of it.
 *
 * `mountRealMarkup` puts a fresh body up between tests, which takes every
 * listener bound to an *element* with it - but not the ones bound to the
 * `document`, which are the keys. Left alone they piled up: by the end of the
 * file a single key press ran three hundred handlers, each querying a document
 * that had grown, and the tests that press keys crept from a fraction of a
 * second to several. Under a whole suite they crossed the timeout, which is why
 * a different two of them failed on every run.
 */
const viewsMadeThisTest: AppView[] = [];

afterEach(() => {
  for (const view of viewsMadeThisTest.splice(0)) {
    view.dispose();
  }
});

function mountRealMarkup(): void {
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(INDEX_HTML)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
}

/** Records what the sample selector asked for. */
class FakeSampleLibrary {
  ready = false;
  loading: SampleLoading = 'lazy';
  loadCalls = 0;

  setLoading(mode: SampleLoading): void {
    this.loading = mode;
  }

  load(): Promise<void> {
    this.loadCalls += 1;
    return Promise.resolve();
  }
}

/** Records the pedal, so the view's routing can be checked. */
class FakeSustain {
  sustained = false;

  setSustain(down: boolean): void {
    this.sustained = down;
  }
}

/** Records what the sliders asked for. */
class FakeVolume implements IVolumeControl {
  volume = 1;

  setVolume(volume: number): void {
    this.volume = volume;
  }
}

interface Rig {
  readonly runtime: AppRuntime;
  readonly screenWake: CountingScreenWake;
  readonly audioWaking: TestAudioWaking;
  readonly mediaKeys: RecordingMediaKeys;
  readonly view: AppView;
  readonly instrument: RecordingPitchPlayer;
  readonly metronome: ManualMetronome;
  readonly midi: MockMidiAdapter;
  readonly renderer: FakeScoreRenderer;
  readonly clock: ManualClock;
  readonly store: InMemorySettingsStore;
  readonly settings: SettingsRepository;
  readonly metronomeVolume: FakeVolume;
  readonly instrumentVolume: FakeVolume;
  readonly sustain: FakeSustain;
  readonly samples: FakeSampleLibrary;
  readonly recorder: PerformanceRecorder;
  readonly volumeKnob: ControlBinding;
  readonly metronomeKnob: ControlBinding;
  readonly takes: TakeLibrary;
  readonly sketches: SketchLibrary;
  readonly scores: ScoreLibrary;
  readonly scoreStore: InMemoryScoreStore;
  readonly files: RecordingFileSink;
  readonly drive: FolderDrive;
  readonly trail: HeldTrail;
}

/** The timings kept for the next visit, held in memory. */
class HeldTrail implements ITimingTrail {
  kept: readonly string[] = [];

  keep(lines: readonly string[]): void {
    this.kept = [...lines];
  }

  lastKept(): readonly string[] {
    return this.kept;
  }
}

/** A drive folder held in memory, standing in for Google's. */
class FolderDrive implements ICloudDrive, ICodeSignIn {
  readonly files = new Map<string, { id: string; content: string }>();
  /** Out, unless a test signs in: then a Sync button standing by the clock presses itself. */
  signedIn = false;
  prepared = 0;
  /** Built without the client that signs in by a code, unless a test says otherwise. */
  available = false;
  /** Confirms the code the moment it is shown, unless a test says otherwise. */
  signInWithCode = (show: (code: SignInCode) => void): Promise<void> => {
    show({ code: 'ABCD-EFGH', url: 'https://www.google.com/device' });
    this.signedIn = true;
    return Promise.resolve();
  };
  private made = 0;

  prepare(): void {
    this.prepared += 1;
  }

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

  trash(id: string): Promise<void> {
    for (const [name, file] of this.files) {
      if (file.id === id) {
        this.files.delete(name);
      }
    }
    return Promise.resolve();
  }

  write(name: string, content: string, replacing: string | null): Promise<CloudFile> {
    const id = replacing ?? `file-${String((this.made += 1))}`;
    this.files.set(name, { id, content });
    return Promise.resolve({ id, name });
  }
}

/**
 * The keys on the screen, played into the rig's one keyboard - which is what
 * the controller and the instrument both hear here, as the composite source
 * is in `createApp`.
 */
function keysOnTheScreen(midi: MockMidiAdapter, clock: ManualClock): AppRuntime['screenKeys'] {
  const held = new Set<number>();
  const release = (key: number): void => {
    if (held.delete(key)) {
      midi.noteOff(key, clock.now());
    }
  };
  return {
    subscribe: () => () => undefined,
    press: (key) => {
      if (!held.has(key)) {
        held.add(key);
        midi.noteOn(key, clock.now());
      }
    },
    release,
    releaseAll: () => {
      for (const key of [...held]) {
        release(key);
      }
    },
  };
}

function createRig(
  webMidiOverride?: AppRuntime['webMidi'],
  store: InMemorySettingsStore = new InMemorySettingsStore(),
  scoreStore: InMemoryScoreStore = new InMemoryScoreStore(),
  drillStore: InMemorySettingsStore = new InMemorySettingsStore(),
): Rig {
  const clock = new ManualClock();
  const midi = new MockMidiAdapter({ clock });
  const metronome = new ManualMetronome(clock);
  const renderer = new FakeScoreRenderer();
  const presets = new ExercisePresetRegistry().registerAll(BUILT_IN_PRESETS);
  const modes = new PracticeModeRegistry().registerAll([
    new WaitMode(),
    new FlowMode(),
    new BarMode(),
    new NoteMode(),
  ]);
  const rhythms = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);
  const instrument = new RecordingPitchPlayer();
  const screenWake = new CountingScreenWake();
  // Awake unless a test says otherwise, which is what a desk browser is.
  const audioWaking = new TestAudioWaking();
  const mediaKeys = new RecordingMediaKeys();
  const ladder = new PracticeLadder(BUILT_IN_LADDER, BUILT_IN_GRADES);
  const recorder = new PerformanceRecorder(clock);
  recorder.listenTo(midi);
  const volumeKnob = new ControlBinding();
  volumeKnob.listenTo(midi);
  const metronomeKnob = new ControlBinding();
  metronomeKnob.listenTo(midi);
  const takes = new TakeLibrary(new InMemorySettingsStore());
  const sketches = new SketchLibrary(new InMemorySettingsStore(), () => Date.now());
  const takeOnOffer = new TakeOnOffer(recorder, takes, () => Date.now());
  const files = new RecordingFileSink();
  const importer = new ScoreFileImporter();
  // As `createApp` has it.
  const serializer = new PrintedOnce(new MusicXmlSerializer());
  const scores = new ScoreLibrary({
    store: scoreStore,
    serializer,
    importer,
    keeper: { askToKeep: () => Promise.resolve(null) },
  });
  const scorings = new ScoringStrategyRegistry().registerAll([
    new AccuracyScoringStrategy(),
    new TimingWeightedScoringStrategy(),
  ]);

  const settings = new SettingsRepository(store, {
    presetIds: presets.list().map((preset) => preset.id),
    modeIds: knownFrameIds(modes.list().map((mode) => mode.id)),
    rhythmProfileIds: rhythms.list().map((profile) => profile.id),
    ladderStepIds: ladder.list().map((step) => step.id),
  });
  const restored = settings.load();
  const metronomeVolume = new FakeVolume();
  const instrumentVolume = new FakeVolume();
  const sustain = new FakeSustain();
  const samples = new FakeSampleLibrary();

  const controller = new PracticeController({
    presets,
    rhythms,
    modes,
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
    instrument,
    clock,
    scorings,
    ladder,
    drillProgress: (() => {
      const progress = new DrillProgress(drillStore);
      progress.load();
      return progress;
    })(),
    initialSettings: {
      countInBars: 0,
      clickOn: false,
      matchToleranceMs: Number.POSITIVE_INFINITY,
      ...restored.practice,
    },
  });
  controller.events.on('settingsChanged', ({ settings: current }) => {
    settings.savePractice(current, Date.now());
  });
  // As `createApp` has it.
  recorder.followTheClick(controller.events);

  const takePlayer = new TakePlayer({ instrument, clock });
  const backup = new BackupService({
    stores: new Map([['settings', store]]),
    scoreStore,
    clock,
  });

  // Its own, so a test can put readings in it and see them listed.
  const practiceHistory = new PracticeHistory(new InMemorySettingsStore());

  // What the device keeps, as a browser that answers everything would say it.
  const storage = {
    read: () =>
      Promise.resolve({
        usedBytes: 42 * 1024 * 1024,
        quotaBytes: 100 * 1024 * 1024 * 1024,
        persisted: false,
        parts: [
          { kind: 'scores' as const, bytes: 12 * 1024 * 1024, count: 98 },
          { kind: 'sound' as const, bytes: 20 * 1024 * 1024, count: null },
        ],
        shelves: [
          { name: 'settings', characters: 3_000 },
          { name: 'takes', characters: 1_200_000 },
        ],
      }),
  };

  const drive = new FolderDrive();
  const trail = new HeldTrail();
  const librarySync = new LibrarySync({ drive, store: scoreStore, reload: () => scores.load() });
  const sketchSync = new SketchSync({ drive, sketches });
  const driveSync = new DriveSync({
    library: librarySync,
    sketches: sketchSync,
    sketchesUnsentSinceMs: () => sketches.unsentSinceMs,
    settings: new SettingsSync({
      drive,
      settings,
      apply: (practice) => {
        controller.updateSettings(practice);
      },
    }),
    scores: () => scores.list(),
    repository: settings,
    now: () => Date.now(),
  });

  const runtime: AppRuntime = {
    controller,
    history: practiceHistory,
    timeToday: new TimeToday(new InMemorySettingsStore()),
    presets,
    rhythms,
    ladder,
    recorder,
    takePlayer,
    midi,
    backup,
    storage,
    trail,
    cloudDrive: drive,
    codeSignIn: drive,
    librarySync,
    sketchSync,
    driveSync,
    volumeKnob,
    metronomeKnob,
    takes,
    sketches,
    takeOnOffer,
    scores,
    files,
    importer,
    scorings,
    modes,
    webMidi: webMidiOverride ?? midi,
    bridge: null,
    computerKeyboard: new ComputerKeyboardMidiSource(
      document as unknown as KeyboardTarget,
      clock,
    ),
    screenKeys: keysOnTheScreen(midi, clock),
    // The same object the session sounds through, as in `createApp`: one
    // instrument stands behind the reader's keys, the playback and the rest's
    // chime, and splitting it here hid a note that was left ringing.
    pitchPlayer: instrument,
    screenWake,
    audio: audioWaking,
    mediaKeys,
    sustain,
    samples,
    renderer,
    clock,
    settings,
    metronomeClick: metronome,
    metronomeVolume,
    instrumentVolume,
    dispose: () => undefined,
  };

  const view = new AppView(runtime, document);
  viewsMadeThisTest.push(view);
  return {
    runtime,
    view,
    screenWake,
    audioWaking,
    mediaKeys,
    instrument,
    metronome,
    midi,
    renderer,
    clock,
    store,
    settings,
    metronomeVolume,
    instrumentVolume,
    sustain,
    samples,
    recorder,
    volumeKnob,
    metronomeKnob,
    takes,
    sketches,
    scores,
    scoreStore,
    drive,
    files,
    trail,
  };
}

/**
 * A tap on the drawing as a browser sends it: down, up, and the click after -
 * a finger's unless said otherwise, which adds a note to those chosen or
 * takes it out.
 */
function tapTheDrawing(init: PointerEventInit, on: Element = element('roll-body')): void {
  for (const type of ['pointerdown', 'pointerup']) {
    on.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 31, ...init }));
  }
  on.dispatchEvent(new MouseEvent('click', { bubbles: true, ...init }));
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`#${id} is missing from index.html`);
  }
  return found as T;
}

/** The Modes sheet's button for a frame, by the slug it is marked with. */
function frameButton(slug: string): HTMLButtonElement {
  const found = element('modes-grid').querySelector<HTMLButtonElement>(`button[data-frame="${slug}"]`);
  if (found === null) {
    throw new Error(`no button for the ${slug} frame`);
  }
  return found;
}

/** Where the MIDI viewer's head stands, in seconds, as its line is told. */
function headAt(drawn: Element | null | undefined): string | undefined {
  return drawn?.querySelector<HTMLElement>('.roll__head')?.style.getPropertyValue('--roll-at');
}

/** A press and a let-go on a sheet's dimmed area, outside its panel. */
function tapOutside(sheet: HTMLElement): void {
  sheet.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  sheet.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/**
 * A button in a list row, found by what it says it does.
 *
 * By title rather than by position: the rows gained a button and every test
 * that had counted along the row started clicking the wrong one.
 */
/**
 * Starts, holds or picks up the machine's own performance.
 *
 * It had a button of its own with three labels; listening is a frame now, so
 * the frame is named and the one transport does the rest. Naming it again
 * when it is already named costs nothing - the controller only acts on a
 * frame that actually changes.
 */
/** Remembers what the page said it was sounding, and answers for it. */
class RecordingMediaKeys implements IMediaKeys {
  readonly said: (WhatIsSounding | null)[] = [];

  sounding(what: WhatIsSounding | null): void {
    this.said.push(what);
  }

  /** What is being said now, which is the last thing said. */
  get now(): WhatIsSounding | null {
    return this.said[this.said.length - 1] ?? null;
  }
}

async function pressListen(controller: PracticeController): Promise<void> {
  controller.updateSettings({ modeId: LISTEN_MODE_ID });
  element<HTMLButtonElement>('focus-play').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function rowButton(listId: string, title: string): HTMLButtonElement {
  const found = element(listId).querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (found === null) {
    throw new Error(`No "${title}" button in #${listId}.`);
  }
  return found;
}

/**
 * Waits for something to become true, rather than for a length of time.
 *
 * A fixed pause is a race with whatever else the machine happens to be doing,
 * and it fails where it matters least - on a loaded continuous-integration
 * runner rather than on the desk where it was written.
 */
async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for the page to catch up.');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Answers the delete question the page now asks before anything goes. */
async function confirmDeletion(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  element<HTMLButtonElement>('confirm-yes').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Emptying a whole shelf is not a button press: the word has to be typed. */
async function confirmByTyping(word = 'delete'): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const typed = element<HTMLInputElement>('confirm-typed');
  typed.value = word;
  typed.dispatchEvent(new Event('input'));
  element<HTMLButtonElement>('confirm-yes').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('AppView', () => {
  beforeEach(() => {
    mountRealMarkup();
  });

  it('finds every element it needs in the shipped markup', () => {
    expect(() => createRig()).not.toThrow();
  });

  it('fills the selectors from the registries', async () => {
    const { view } = createRig();
    await view.initialize();

    expect(element<HTMLSelectElement>('preset').options).toHaveLength(BUILT_IN_PRESETS.length);
    expect(element<HTMLSelectElement>('rhythm').options).toHaveLength(
      BUILT_IN_RHYTHM_PROFILES.length,
    );
    expect(element<HTMLSelectElement>('key').options.length).toBeGreaterThan(5);
    expect(element('preset-description').textContent).not.toBe('');
    expect(element('rhythm-description').textContent).not.toBe('');
    expect(element<HTMLSelectElement>('click').options).toHaveLength(CLICK_PATTERNS.length);
    expect(element('click-description').textContent).not.toBe('');
    // The list rather than a number kept by hand: a count written out here goes
    // stale the first time a choice is added, quietly checking less.
    expect(element<HTMLSelectElement>('dropout').options).toHaveLength(CLICK_WHEN_CHOICES.length);
    expect(element('dropout-description').textContent).not.toBe('');

    // Each choice says what it does, and none of them falls through to a
    // sentence meant for another: "with me" used to be described as a cycle
    // and came out promising to leave the reader alone for nought bars.
    for (const choice of CLICK_WHEN_CHOICES) {
      const dropout = element<HTMLSelectElement>('dropout');
      dropout.value = choice;
      dropout.dispatchEvent(new Event('change'));
      const said = element('dropout-description').textContent ?? '';
      expect(said, choice).not.toBe('');
      expect(said, choice).not.toContain('0 bar');
    }
  });

  it('loads and renders an exercise on start-up', async () => {
    const { view, renderer } = createRig();
    await view.initialize();

    expect(renderer.loadCount).toBe(1);
    // Which piece it is is printed in the corner of the page itself now,
    // beside the page number - see tests/infrastructure/page-label.
    expect(renderer.loadedXml).toContain('<work-title>');
  });

  it('regenerates when the level changes', async () => {
    const { view, renderer, runtime } = createRig();
    await view.initialize();

    const select = element<HTMLSelectElement>('preset');
    select.value = 'triads-left-hand';
    select.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.controller.settings.presetId).toBe('triads-left-hand');
    expect(renderer.loadCount).toBe(2);
  });

  it('changes the click without touching the music', async () => {
    const { view, renderer, runtime } = createRig();
    await view.initialize();
    const before = renderer.loadCount;

    const select = element<HTMLSelectElement>('click');
    select.value = 'downbeat';
    select.dispatchEvent(new Event('change'));
    await Promise.resolve();

    expect(runtime.controller.settings.clickPattern).toBe('downbeat');
    expect(element('click-description').textContent).toContain('One click per bar');
    // The click is not part of the exercise, so nothing is regenerated.
    expect(renderer.loadCount).toBe(before);
  });

  it('gives the reader a look at the page before it starts', async () => {
    vi.useFakeTimers();
    try {
      const { view, runtime } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ previewSeconds: 3 });

      element<HTMLButtonElement>('focus-play').click();

      // Nothing is running yet: the look is the point, and it ends by itself.
      expect(runtime.controller.session).toBeNull();

      vi.advanceTimersByTime(3000);
      expect(runtime.controller.session).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  describe('keeping the page back until the look', () => {
    /** Drives the slider the way a reader does, not the setting behind it. */
    function setPreview(seconds: number): void {
      const slider = element<HTMLInputElement>('preview');
      slider.value = String(seconds);
      slider.dispatchEvent(new Event('input'));
    }

    it('covers the music while a look is asked for', async () => {
      const { view } = createRig();
      await view.initialize();

      // Without a look there is nothing to keep back: the page is the page.
      expect(element('score-cover').hidden).toBe(true);

      setPreview(8);

      expect(element('score-cover').hidden).toBe(false);
      expect(element('score').classList.contains('is-covered')).toBe(true);
      expect(element('score-cover-text').textContent).toContain('8 seconds');
    });

    it('hands it over when the look begins, and not before', async () => {
      vi.useFakeTimers();
      try {
        const { view, runtime } = createRig();
        await view.initialize();
        setPreview(5);
        expect(element('score-cover').hidden).toBe(false);

        element<HTMLButtonElement>('focus-play').click();

        // The five seconds are now the whole time the reader gets with it,
        // which is the point: staring at it beforehand was the hole.
        expect(element('score-cover').hidden).toBe(true);
        expect(runtime.controller.session).toBeNull();

        vi.advanceTimersByTime(5000);
        expect(runtime.controller.session).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('puts the next exercise back under', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      setPreview(5);
      element<HTMLButtonElement>('focus-play').click();
      expect(element('score-cover').hidden).toBe(true);

      await runtime.controller.loadNewExercise();

      // A fresh page is a fresh page; the look already taken was for the last.
      expect(element('score-cover').hidden).toBe(false);
    });

    it('leaves it visible for the report once it has been read', async () => {
      vi.useFakeTimers();
      try {
        const { view, runtime } = createRig();
        await view.initialize();
        setPreview(2);
        element<HTMLButtonElement>('focus-play').click();
        vi.advanceTimersByTime(2000);
        runtime.controller.session?.abort();

        expect(element('score-cover').hidden).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('hands it over to hear it played', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      setPreview(6);

      await pressListen(runtime.controller);

      // The cursor would otherwise walk across a blank page.
      expect(element('score-cover').hidden).toBe(true);
    });
  });

  it('lets the reader cut the look short', async () => {
    vi.useFakeTimers();
    try {
      const { view, runtime } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ previewSeconds: 10 });
      element<HTMLButtonElement>('focus-play').click();

      element<HTMLButtonElement>('focus-stop').click();
      vi.advanceTimersByTime(20_000);

      // Stopping during the look means seen enough, not start in ten seconds.
      expect(runtime.controller.session).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('plays the exercise back, holds it, and picks it up again', async () => {
    // Pressing it a second time holds the music rather than throwing it
    // away. It is the same button that started the performance, and pressing
    // a play button again does not mean "back to the top" anywhere else - it
    // used to here, so hearing a phrase twice meant sitting through
    // everything in front of it again.
    const { view, runtime } = createRig();
    await view.initialize();

    // The recordings are awaited before a note sounds, so the click resolves a
    // moment later than it is made.
    await pressListen(runtime.controller);
    expect(runtime.controller.isListening).toBe(true);
    expect(element('focus-play').getAttribute('aria-label')).toBe('Pause');

    await pressListen(runtime.controller);
    expect(runtime.controller.isListening).toBe(false);
    expect(runtime.controller.isListeningPaused).toBe(true);
    expect(element('focus-play').getAttribute('aria-label')).toBe('Resume');

    await pressListen(runtime.controller);
    expect(runtime.controller.isListening).toBe(true);
    expect(runtime.controller.isListeningPaused).toBe(false);
  });

  it('shows the docked keyboard and lights sounding notes during playback, toggling with the button', async () => {
    const { view, runtime, metronome } = createRig();
    await view.initialize();
    await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    const toggle = element<HTMLButtonElement>('focus-keyboard');
    const keys = element('replay-keys');

    // Before playback, keys are hidden
    expect(keys.hidden).toBe(true);
    expect(document.body.dataset['listening']).toBeUndefined();

    await pressListen(runtime.controller);

    expect(document.body.dataset['listening']).toBe('true');
    expect(keys.hidden).toBe(false);
    expect(keys.dataset['shows']).toBe('falling-notes');
    expect(toggle.dataset['shows']).toBe('falling-notes');
    expect(toggle.title).toBe('Falling notes and keyboard. Press for keyboard only.');

    // Metronome advance sounds the step, lit as heard: nobody played it, so
    // it is in no verdict's colour - the left hand's in that hand's own.
    metronome.advanceSubdivisions(2);
    const lit = [...keys.querySelectorAll<HTMLElement>('[data-shade]')];
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.every((key) => key.dataset['shade'] === 'heard' || key.dataset['shade'] === 'heard-left')).toBe(true);

    // Pause unlights keys
    element<HTMLButtonElement>('focus-play').click();
    expect(runtime.controller.isListeningPaused).toBe(true);
    expect(keys.querySelectorAll<HTMLElement>('[data-shade]').length).toBe(0);

    // Resume lights again
    element<HTMLButtonElement>('focus-play').click();
    expect(runtime.controller.isListening).toBe(true);
    metronome.advanceSubdivisions(2);
    expect(keys.querySelectorAll<HTMLElement>('[data-shade="heard"]').length).toBeGreaterThan(0);

    // The button goes round: the keyboard alone, the score alone, and the
    // notes falling onto the keyboard again.
    toggle.click();
    expect(runtime.controller.settings.keysShown).toBe('keys');
    expect(keys.hidden).toBe(false);
    expect(keys.dataset['shows']).toBe('keys');
    expect(document.body.dataset['keysHidden']).toBeUndefined();
    expect(toggle.dataset['shows']).toBe('keys');
    expect(toggle.title).toBe('Keyboard only. Press for the score only.');

    toggle.click();
    expect(runtime.controller.settings.keysShown).toBe('none');
    expect(keys.hidden).toBe(true);
    expect(document.body.dataset['keysHidden']).toBe('true');
    expect(toggle.dataset['shows']).toBe('none');
    expect(toggle.title).toBe('The score only. Press for falling notes and keyboard.');

    toggle.click();
    expect(runtime.controller.settings.keysShown).toBe('falling-notes');
    expect(keys.hidden).toBe(false);
    expect(keys.dataset['shows']).toBe('falling-notes');
    expect(document.body.dataset['keysHidden']).toBeUndefined();

    // Stop playback cleans up keyboard and state
    element<HTMLButtonElement>('focus-stop').click();
    expect(keys.hidden).toBe(true);
    expect(document.body.dataset['listening']).toBeUndefined();
    expect(document.body.dataset['keysHidden']).toBeUndefined();
    expect(keys.querySelectorAll<HTMLElement>('[data-shade]').length).toBe(0);
  });

  it('keeps a held note lit under the notes that move over it, and lets it go where it ends', async () => {
    // The bass whole note under four quarters is down the whole bar. Lit with
    // each step's own notes alone, it went dark at the melody's second note.
    const { view, runtime, metronome } = createRig();
    await view.initialize();
    await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    const keys = element('replay-keys');
    const lit = (): number[] =>
      [...keys.querySelectorAll<HTMLElement>('[data-shade]')]
        .map((key) => Number(key.dataset['midi']))
        .sort((left, right) => left - right);
    await pressListen(runtime.controller);

    metronome.advanceSubdivisions(2);
    expect(lit()).toEqual([p('C3').midi, p('D4').midi]);

    // Into the second bar, where the whole note has ended.
    metronome.advanceSubdivisions(4);
    expect(lit()).toEqual([p('G2').midi, p('D3').midi, p('G4').midi]);

    element<HTMLButtonElement>('focus-stop').click();
  });

  it('drops the notes a playback will sound onto the keys, and lets go of them when it stops', async () => {
    const { view, runtime, metronome } = createRig();
    await view.initialize();
    await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    const lane = element('replay-keys').querySelector('canvas');
    if (lane === null) {
      throw new Error('No lane over the keys.');
    }
    await pressListen(runtime.controller);
    metronome.advanceSubdivisions(1);

    // Three seconds of the music over the keys at sixty to the crotchet: the
    // first beat on its key, the next two coming down onto theirs, and the
    // bass's whole note under all of them. Lit as heard, as the keys are -
    // the bass, written for the left hand, in that hand's own ink.
    const scene = view.fallingScene
      .map((bar) => [bar.midi, bar.shade, Number(bar.top.toFixed(3)), Number(bar.bottom.toFixed(3))])
      .sort((left, right) => Number(left[0]) - Number(right[0]));
    expect(scene).toEqual([
      [p('C3').midi, 'heard-left', 0, 1],
      [p('C4').midi, 'heard', 0.667, 1],
      [p('D4').midi, 'heard', 0.333, 0.667],
      [p('E4').midi, 'heard', 0, 0.333],
    ]);
    // And the keys they land on lit alike: the bass in the left hand's ink.
    const litKeys = (): string[][] =>
      [...element('replay-keys').querySelectorAll<HTMLElement>('[data-shade]')].map((key) => [key.dataset['midi'] ?? '', key.dataset['shade'] ?? '']);
    expect(litKeys()).toEqual([
      [String(p('C3').midi), 'heard-left'],
      [String(p('C4').midi), 'heard'],
    ]);
    // Two beats on, the second bar's bass is coming down, not yet handed to
    // the instrument, and in the left hand's ink as well.
    metronome.advanceSubdivisions(2);
    expect(
      view.fallingScene.filter((bar) => bar.midi === p('G2').midi || bar.midi === p('D3').midi).map((bar) => bar.shade),
    ).toEqual(['heard-left', 'heard-left']);

    lane.width = 300;
    element<HTMLButtonElement>('focus-stop').click();

    // Nothing falling, and the picture of what was let go of.
    expect(view.fallingScene).toEqual([]);
    expect(lane.width).toBe(0);
  });

  it('lights a key of a playback held by both hands as heard, and one held by the left alone in its ink', async () => {
    const { view, runtime, metronome } = createRig();
    await view.initialize();
    await runtime.controller.openScore(oneKeyInBothHands({ tempoBpm: 60 }));
    await pressListen(runtime.controller);
    const shadeOf = (midi: number): string | undefined =>
      element('replay-keys').querySelector<HTMLElement>(`[data-midi='${String(midi)}']`)?.dataset['shade'];

    metronome.advanceSubdivisions(1);
    expect([shadeOf(p('C4').midi), shadeOf(p('D4').midi)]).toEqual(['heard', 'heard-left']);
    metronome.advanceSubdivisions(1);
    expect(shadeOf(p('D4').midi)).toBe('heard');
    element<HTMLButtonElement>('focus-stop').click();
  });

  it('puts the keyboard up in free play, lights what is held, and lets what was played rise off the keys', async () => {
    // Nothing is coming, so the lane holds what has been played: the newest
    // at the keys, a key still down growing out of its key.
    const { view, runtime, midi, clock } = createRig();
    await view.initialize();
    await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    const keys = element('replay-keys');
    expect(keys.hidden).toBe(true);

    element<HTMLButtonElement>('focus-modes').click();
    frameButton('free').click();

    expect(runtime.controller.playsFreely).toBe(true);
    expect(keys.hidden).toBe(false);
    expect(document.body.dataset['freePlay']).toBe('true');

    const at = clock.now();
    midi.noteOn(60, at);
    clock.advance(1_500);
    midi.noteOff(60, clock.now());
    midi.noteOn(64, clock.now());
    clock.advance(750);

    const lit = [...keys.querySelectorAll<HTMLElement>('[data-shade]')];
    expect(lit.map((key) => [key.dataset['midi'], key.dataset['shade']])).toEqual([['64', 'heard']]);
    // Three seconds of what was played over the keys: middle C let go of
    // three quarters of a second ago, the E held since then.
    const scene = view.fallingScene.map((bar) => [
      bar.midi,
      bar.shade,
      Number(bar.top.toFixed(3)),
      Number(bar.bottom.toFixed(3)),
    ]);
    expect(scene).toEqual([
      [60, 'heard', 0.25, 0.75],
      [64, 'heard', 0.75, 1],
    ]);
    expect(view.fallingBarLines).toEqual([]);
    expect(view.fallingRuling).toEqual([]);

    // The chord held, named at the top while it is held.
    const chord = element<HTMLOutputElement>('free-chord');
    expect(chord.hidden).toBe(true);
    midi.noteOn(67, clock.now());
    midi.noteOn(60, clock.now());
    expect(chord.hidden).toBe(false);
    expect(chord.textContent).toBe('C');
    midi.noteOff(60, clock.now());
    // E and G alone make no chord with a name.
    expect(chord.hidden).toBe(true);
    midi.noteOn(60, clock.now());
    expect(chord.textContent).toBe('C');

    // Out of free play, the keyboard goes with it and no key stays lit.
    frameButton('free').click();
    expect(runtime.controller.playsFreely).toBe(false);
    expect(keys.hidden).toBe(true);
    expect(document.body.dataset['freePlay']).toBeUndefined();
    expect(keys.querySelectorAll('[data-shade]')).toHaveLength(0);
    // And the name with it: a chord named during a run is the score read out.
    expect(chord.hidden).toBe(true);
    midi.noteOn(72, clock.now());
    expect(chord.hidden).toBe(true);
  });

  it('plays the keys on the screen in free play, and nowhere else', async () => {
    const { view, runtime, instrument } = createRig();
    await view.initialize();
    const keys = element('replay-keys');
    const key = (midi: number): HTMLElement => {
      const found = keys.querySelector<HTMLElement>(`[data-midi="${String(midi)}"]`);
      if (found === null) {
        throw new Error(`No key ${String(midi)} on the screen.`);
      }
      return found;
    };
    const touch = (type: string, target: EventTarget, pointerId: number): void => {
      target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, pointerType: 'touch' }));
    };

    // Not in a frame a run is played in: the keys only show what is played.
    touch('pointerdown', key(60), 1);
    expect(instrument.played).toHaveLength(0);
    touch('pointerup', key(60), 1);

    element<HTMLButtonElement>('focus-modes').click();
    frameButton('free').click();

    // Two fingers, one on a white key and one on the black key inside another.
    touch('pointerdown', key(60), 1);
    touch('pointerdown', key(61), 2);
    expect(runtime.controller.freePlayKeysDown).toEqual([60, 61]);
    expect(instrument.played.map((note) => note.midi)).toEqual([60, 61]);
    expect(element('free-chord').hidden).toBe(true);

    // Let go anywhere, the key that finger was on comes up.
    touch('pointerup', document.body, 1);
    expect(runtime.controller.freePlayKeysDown).toEqual([61]);
    // A finger that slides the row instead is let go of as the slide begins.
    touch('pointercancel', key(61), 2);
    expect(runtime.controller.freePlayKeysDown).toEqual([]);

    // A key held as free play ends is let go of with it.
    touch('pointerdown', key(64), 3);
    expect(runtime.controller.freePlayKeysDown).toEqual([64]);
    frameButton('free').click();
    frameButton('free').click();
    expect(runtime.controller.freePlayKeysDown).toEqual([]);
    // So back in free play the same key sounds again rather than reading as still down.
    touch('pointerdown', key(64), 4);
    expect(runtime.controller.freePlayKeysDown).toEqual([64]);
    touch('pointerup', key(64), 4);
  });

  it('plays each key a pointer slides onto in free play, and a finger only where the keys fit the screen', async () => {
    const watched: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        private readonly report: () => void;
        constructor(report: () => void) {
          this.report = report;
        }
        observe(): void {
          watched.push(this.report);
        }
        disconnect(): void {}
      },
    );
    // jsdom lays nothing out, so where a pointer is says which key it is over:
    // x is the key's number, and anywhere else is off the keys.
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: (x: number): Element | null =>
        document.querySelector(`#replay-keys [data-midi="${String(x)}"]`) ?? document.body,
    });
    try {
      const { view, runtime, instrument } = createRig();
      await view.initialize();
      const keys = element('replay-keys');
      const row = keys.querySelector<HTMLElement>('.replay-keys__row');
      const scroller = keys.querySelector<HTMLElement>('.replay-keys__scroller');
      if (row === null || scroller === null) {
        throw new Error('No row of keys.');
      }
      const key = (midi: number): HTMLElement => {
        const found = keys.querySelector<HTMLElement>(`[data-midi="${String(midi)}"]`);
        if (found === null) {
          throw new Error(`No key ${String(midi)} on the screen.`);
        }
        return found;
      };
      const pointer = (
        type: string,
        target: EventTarget,
        pointerId: number,
        clientX: number,
        pointerType = 'touch',
      ): void => {
        target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, pointerType, clientX }));
      };
      const fitTheScreen = (fits: boolean): void => {
        Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 728 });
        Object.defineProperty(scroller, 'clientWidth', { configurable: true, value: fits ? 1000 : 400 });
        for (const report of watched) {
          report();
        }
      };
      element<HTMLButtonElement>('focus-modes').click();
      frameButton('free').click();

      // The whole keyboard on the screen: a finger plays what it slides onto.
      fitTheScreen(true);
      expect(row.dataset['scrolls']).toBe('false');
      // A finger's events keep going to the key it went down on.
      pointer('pointerdown', key(60), 1, 60);
      pointer('pointermove', key(60), 1, 60);
      pointer('pointermove', key(60), 1, 62);
      expect(runtime.controller.freePlayKeysDown).toEqual([62]);
      expect(instrument.played.map((note) => note.midi)).toEqual([60, 62]);

      // A second finger on a key the first slides over: the first leaves it,
      // and it stays down under the second.
      pointer('pointerdown', key(64), 2, 64);
      pointer('pointermove', key(60), 1, 64);
      pointer('pointermove', key(60), 1, 65);
      expect(runtime.controller.freePlayKeysDown).toEqual([64, 65]);

      // Off the keys, nothing sounds; back on, it plays again.
      pointer('pointermove', key(60), 1, 0);
      expect(runtime.controller.freePlayKeysDown).toEqual([64]);
      pointer('pointermove', key(60), 1, 67);
      expect(runtime.controller.freePlayKeysDown).toEqual([64, 67]);
      pointer('pointerup', document.body, 1, 67);
      pointer('pointerup', document.body, 2, 64);
      expect(runtime.controller.freePlayKeysDown).toEqual([]);

      // A row wider than its screen: a finger's slide moves the row, and the
      // key it went down on is all it plays.
      fitTheScreen(false);
      expect(row.dataset['scrolls']).toBe('true');
      pointer('pointerdown', key(60), 3, 60);
      pointer('pointermove', key(60), 3, 62);
      expect(runtime.controller.freePlayKeysDown).toEqual([60]);
      pointer('pointerup', document.body, 3, 62);
      // The mouse slides the row along nothing, and plays.
      pointer('pointerdown', key(60), 4, 60, 'mouse');
      pointer('pointermove', document.body, 4, 62, 'mouse');
      expect(runtime.controller.freePlayKeysDown).toEqual([62]);

      // Out of free play a pointer still held plays nothing as it moves.
      frameButton('free').click();
      pointer('pointermove', document.body, 4, 64, 'mouse');
      expect(runtime.controller.freePlayKeysDown).toEqual([]);
      expect(instrument.played.filter((note) => note.midi === 64)).toHaveLength(1);
      pointer('pointerup', document.body, 4, 64, 'mouse');
    } finally {
      vi.unstubAllGlobals();
      Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });

  it('keeps how a playback kept time, its beats and frames, and copies it for the reader to hand over', async () => {
    let now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const frames = new Map<number, FrameRequestCallback>();
    let asked = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      asked += 1;
      frames.set(asked, callback);
      return asked;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const runTheFrames = (): void => {
      const due = [...frames.values()];
      frames.clear();
      for (const frame of due) {
        frame(0);
      }
    };
    const written: string[] = [];
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string): Promise<void> => {
          written.push(text);
          return Promise.resolve();
        },
      },
    });
    try {
      const { view, runtime, metronome, files } = createRig();
      await view.initialize();
      await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
      await pressListen(runtime.controller);
      // The pulse here is a stand-in that does not begin them, so they are begun as the real one does.
      beginThePlaybackTimings();
      metronome.advanceSubdivisions(1);
      runTheFrames();
      now = 1_020;
      runTheFrames();
      // Held for four seconds, and played on: no stall between.
      runtime.controller.pauseListening();
      runTheFrames();
      now = 5_000;
      element<HTMLButtonElement>('focus-play').click();
      runTheFrames();
      now = 5_016;
      runTheFrames();

      element<HTMLButtonElement>('copy-timings').click();
      await Promise.resolve();
      const lines = (written[0] ?? '').split('\n');
      expect(lines[0]).toBe('How the last playbacks kept time, the latest first');
      expect(lines[1]).toContain(navigator.userAgent);
      expect(lines[1]).toContain('falling notes on');
      const { rows } = theLatestPlayback(written[0] ?? '');
      // Seconds nought and four: a beat acted on in the first, and the frames' longest gaps.
      expect(rows.map((row) => [row[0], row[11]])).toEqual([
        ['0', '20'],
        ['4', '16'],
      ]);
      expect(Number(rows[0]?.[8])).toBeGreaterThan(0);
      expect(element('backup-description').textContent).toBe('Copied the playback timings.');

      // And as a file, the same text.
      element<HTMLButtonElement>('save-timings').click();
      const saved = files.saved.at(-1);
      expect(saved?.fileName).toMatch(/^playback-timings-.*\.txt$/);
      expect(new TextDecoder().decode(saved?.bytes)).toBe(written[0]);
      expect(element('backup-description').textContent).toBe('Wrote the playback timings.');
    } finally {
      Reflect.deleteProperty(window.navigator, 'clipboard');
      vi.restoreAllMocks();
    }
  });

  it('paints the falling notes a frame at a time while the music moves, and not once it is held', async () => {
    // However it is held: the lane asks the controller at every frame, so a
    // performance stopped without the page being told stops the lane too.
    const frames = new Map<number, FrameRequestCallback>();
    let asked = 0;
    const ask = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      asked += 1;
      frames.set(asked, callback);
      return asked;
    });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    const runTheFrames = (): void => {
      const due = [...frames.values()];
      frames.clear();
      for (const frame of due) {
        frame(0);
      }
    };
    try {
      const { view, runtime, metronome } = createRig();
      await view.initialize();
      await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
      runtime.controller.updateSettings({ rhythmRuler: 'eighth' });
      const lane = element('replay-keys').querySelector<HTMLCanvasElement>('.replay-keys__track canvas');
      if (lane === null) {
        throw new Error('No lane over the keys.');
      }
      // A lane with room on it, since jsdom lays nothing out and has no canvas.
      const recorder = new Recorder();
      let painted = 0;
      Object.defineProperty(lane, 'clientWidth', { value: 300, configurable: true });
      Object.defineProperty(lane, 'clientHeight', { value: 100, configurable: true });
      Object.defineProperty(lane, 'getContext', {
        configurable: true,
        value: () => {
          painted += 1;
          return recorder;
        },
      });

      runTheFrames();
      expect(painted).toBe(0);

      await pressListen(runtime.controller);
      metronome.advanceSubdivisions(1);
      runTheFrames();
      runTheFrames();
      expect(painted).toBe(2);
      expect(recorder.marks.filter((mark) => mark.how === 'fill').length).toBeGreaterThan(0);
      // The first bar's line with them, on the keys as the music begins, and
      // a beat ruled at the side.
      expect(recorder.marks.some((mark) => mark.how === 'text' && mark.words === '1')).toBe(true);
      expect(recorder.marks.some((mark) => mark.how === 'fill' && mark.x === 0 && mark.wide === 18)).toBe(true);

      runtime.controller.pauseListening();
      runTheFrames();
      runTheFrames();
      expect(painted).toBe(2);

      element<HTMLButtonElement>('focus-play').click();
      runTheFrames();
      expect(painted).toBe(3);

      // Nor with the keyboard alone, when the picture is let go of, nor with
      // the score alone; and again once the notes are asked for back.
      element<HTMLButtonElement>('focus-keyboard').click();
      expect(lane.width).toBe(0);
      runTheFrames();
      runTheFrames();
      expect(painted).toBe(3);
      element<HTMLButtonElement>('focus-keyboard').click();
      runTheFrames();
      expect(painted).toBe(3);
      element<HTMLButtonElement>('focus-keyboard').click();
      runTheFrames();
      expect(painted).toBe(4);

      element<HTMLButtonElement>('focus-stop').click();
    } finally {
      ask.mockRestore();
      cancel.mockRestore();
    }
  });

  it('lets the notes be seen through the bar while they fall, and only then', async () => {
    const { view, runtime, metronome } = createRig();
    await view.initialize();
    await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    const falling = (): string | undefined => document.body.dataset['notesFalling'];
    expect(falling()).toBeUndefined();

    await pressListen(runtime.controller);
    metronome.advanceSubdivisions(1);
    expect(falling()).toBe('true');

    // Held, the bar is what the reader is about to press.
    element<HTMLButtonElement>('focus-play').click();
    expect(falling()).toBeUndefined();
    element<HTMLButtonElement>('focus-play').click();
    expect(falling()).toBe('true');

    // Nothing falls with the keyboard alone, or with the score alone.
    element<HTMLButtonElement>('focus-keyboard').click();
    expect(falling()).toBeUndefined();
    element<HTMLButtonElement>('focus-keyboard').click();
    expect(falling()).toBeUndefined();
    element<HTMLButtonElement>('focus-keyboard').click();
    expect(falling()).toBe('true');

    element<HTMLButtonElement>('focus-stop').click();
    expect(falling()).toBeUndefined();
  });

  it('drops the bar lines with the notes, numbered as the page numbers its bars', async () => {
    const { view, runtime, metronome } = createRig();
    await view.initialize();
    await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    await pressListen(runtime.controller);
    const lines = (): [string, number][] =>
      view.fallingBarLines.map((line) => [line.label, Number(line.at.toFixed(3))]);

    // The first bar begins as the music does, on the keys; the second is
    // four seconds off, past the lane's three.
    metronome.advanceSubdivisions(1);
    expect(lines()).toEqual([['1', 1]]);

    // Two seconds on, the second bar is a third of the way down.
    metronome.advanceSubdivisions(2);
    expect(lines()).toEqual([['2', 0.333]]);

    element<HTMLButtonElement>('focus-stop').click();
    expect(view.fallingBarLines).toEqual([]);
  });

  it('rules the beats and their divisions at the sides of the lane, in the grid the page is ruled in, or else the click\'s', async () => {
    const { view, runtime, metronome } = createRig();
    await view.initialize();
    await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    const ruling = (): [string, number][] =>
      view.fallingRuling.map((line) => [line.weight, Number(line.at.toFixed(3))]);

    // The page not ruled, the lane is ruled where the click falls: on the beat.
    await pressListen(runtime.controller);
    metronome.advanceSubdivisions(1);
    expect(ruling()).toEqual([
      ['beat', 0.667],
      ['beat', 0.333],
    ]);
    element<HTMLButtonElement>('focus-stop').click();

    // In eighths: a beat a second, a division between, over the lane's three
    // seconds - and the bar's own line left to the bar line.
    runtime.controller.updateSettings({ rhythmRuler: 'eighth' });
    await pressListen(runtime.controller);
    metronome.advanceSubdivisions(1);
    // The bar lines asked of the same performance first, as a frame asks.
    expect(view.fallingBarLines.map((line) => line.label)).toEqual(['1']);
    expect(ruling()).toEqual([
      ['division', 0.833],
      ['beat', 0.667],
      ['division', 0.5],
      ['beat', 0.333],
      ['division', 0.167],
    ]);

    element<HTMLButtonElement>('focus-stop').click();
    expect(view.fallingRuling).toEqual([]);
  });

  it('lets the pedal fall onto its mark as the playback holds it', async () => {
    // At sixty, down for the first two beats and again for the next two.
    const { view, runtime, metronome } = createRig();
    await view.initialize();
    await runtime.controller.openScore({
      ...twoBarExercise({ tempoBpm: 60 }),
      pedalMarks: [
        { measureIndex: 0, offsetTicks: 0, type: 'start', line: true },
        { measureIndex: 0, offsetTicks: 2 * Duration.QUARTER.ticks, type: 'stop', line: true },
        { measureIndex: 0, offsetTicks: 2 * Duration.QUARTER.ticks, type: 'start', line: true },
        { measureIndex: 1, offsetTicks: 0, type: 'stop', line: true },
      ],
    });
    const column = element('replay-keys').querySelector<HTMLCanvasElement>('.replay-keys__side canvas');
    expect(column).not.toBeNull();

    await pressListen(runtime.controller);
    metronome.advanceSubdivisions(1);

    // Two presses over the lane's three seconds: the first on the mark now,
    // the second coming down onto it two seconds off.
    expect(view.fallingPedal.map((press) => [Number(press.lift.toFixed(3)), Number(press.foot.toFixed(3))])).toEqual([
      [0.333, 1],
      [-0.333, 0.333],
    ]);

    element<HTMLButtonElement>('focus-stop').click();
    expect(view.fallingPedal).toEqual([]);
    expect(column?.width).toBe(0);
  });

  it('hides the pedal falling onto its mark, and lets it fall again, with a press of the mark', async () => {
    const frames: FrameRequestCallback[] = [];
    const ask = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const runAFrame = (): void => {
      for (const frame of frames.splice(0)) {
        frame(0);
      }
    };
    const { view, runtime, metronome } = createRig();
    await view.initialize();
    await runtime.controller.openScore({
      ...twoBarExercise({ tempoBpm: 60 }),
      pedalMarks: [
        { measureIndex: 0, offsetTicks: 0, type: 'start', line: true },
        { measureIndex: 1, offsetTicks: 0, type: 'stop', line: true },
      ],
    });
    const keys = element('replay-keys');
    const toggle = keys.querySelector<HTMLButtonElement>('.replay-keys__side button');
    const column = keys.querySelector<HTMLCanvasElement>('.replay-keys__side canvas');
    if (toggle === null || column === null) {
      throw new Error('No pedal mark to press, or no column over it.');
    }
    // A column with room on it, since jsdom lays nothing out and has no canvas.
    const recorder = new Recorder();
    Object.defineProperty(column, 'clientWidth', { value: 56, configurable: true });
    Object.defineProperty(column, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(column, 'getContext', { configurable: true, value: () => recorder });
    // The mark is in the place pressed, which is the whole of it.
    expect(toggle.contains(keys.querySelector('.replay-keys__pedal'))).toBe(true);
    expect(toggle.querySelector('.replay-keys__pedal-dot')).not.toBeNull();

    await pressListen(runtime.controller);
    metronome.advanceSubdivisions(1);
    runAFrame();
    expect(recorder.marks.length).toBeGreaterThan(0);
    expect(toggle.dataset['falls']).toBe('true');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.title).toContain('Press to hide it');

    toggle.click();

    expect(runtime.controller.settings.pedalFalls).toBe(false);
    expect(toggle.dataset['falls']).toBe('false');
    expect(toggle.title).toContain('Press to let it fall');
    // Let go of at once, and left unpainted while the music goes on.
    expect(column.width).toBe(0);
    recorder.marks.length = 0;
    runAFrame();
    expect(recorder.marks).toEqual([]);

    toggle.click();
    runAFrame();

    expect(runtime.controller.settings.pedalFalls).toBe(true);
    expect(recorder.marks.length).toBeGreaterThan(0);

    // With the keyboard alone nothing falls: dimmed, with the reason, and
    // still answering for when the notes fall again.
    element<HTMLButtonElement>('focus-keyboard').click();
    expect(toggle.dataset['idle']).toBe('true');
    expect(toggle.title).toContain('keyboard is shown alone');
    toggle.click();
    expect(runtime.controller.settings.pedalFalls).toBe(false);
    ask.mockRestore();
  });

  it('closes the cursors on the notes coming a frame at a time while a run goes, and takes them off when it stops', async () => {
    const frames: FrameRequestCallback[] = [];
    const ask = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const runAFrame = (): void => {
      for (const frame of frames.splice(0)) {
        frame(0);
      }
    };
    try {
      const { view, runtime, metronome, renderer, clock } = createRig();
      await view.initialize();
      await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0, closingCursors: true });

      element<HTMLButtonElement>('focus-play').click();
      metronome.advanceSubdivisions(1);
      const began = clock.now();
      clock.advance(750);
      runAFrame();

      // A second ahead: the first note met a moment ago and still white, and
      // the second three quarters of the way closed on it.
      expect(renderer.closing.map((cue) => [cue.stepIndex, cue.closing])).toEqual([[1, 0.75]]);
      clock.set(began + 1_050);
      runAFrame();
      expect(renderer.closing.map((cue) => [cue.stepIndex, Number(cue.closing.toFixed(2))])).toEqual([
        [1, 1],
        [2, 0.05],
      ]);

      element<HTMLButtonElement>('focus-stop').click();
      runAFrame();
      expect(renderer.closing).toEqual([]);
      expect(frames).toEqual([]);
    } finally {
      ask.mockRestore();
    }
  });

  it('closes the cursors on the first note through the count-in', async () => {
    const frames: FrameRequestCallback[] = [];
    const ask = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    try {
      const { view, runtime, metronome, renderer, clock } = createRig();
      await view.initialize();
      await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 1, closingCursors: true });

      element<HTMLButtonElement>('focus-play').click();
      // The last beat of the count-in, a tick being a beat here: the music is
      // a second away.
      metronome.advanceSubdivisions(4);
      expect(runtime.controller.session?.status).toBe('counting-in');
      clock.advance(250);
      for (const frame of frames.splice(0)) {
        frame(0);
      }

      expect(renderer.closing.map((cue) => [cue.stepIndex, cue.closing])).toEqual([[0, 0.25]]);
    } finally {
      ask.mockRestore();
    }
  });

  it('takes the keyboard away however a playback ends, not only on Stop', async () => {
    // Another frame ends the performance from inside the controller, and the
    // page hears no Stop and no end of the music.
    const { view, runtime, metronome } = createRig();
    await view.initialize();
    await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    const keys = element('replay-keys');
    await pressListen(runtime.controller);
    metronome.advanceSubdivisions(2);
    expect(keys.hidden).toBe(false);

    frameButton('wait').click();

    expect(runtime.controller.isListening).toBe(false);
    expect(keys.hidden).toBe(true);
    expect(document.body.dataset['listening']).toBeUndefined();
    expect(keys.querySelector('[data-shade]')).toBeNull();
  });

  it('brings the keyboard round to where the playback begins, not to the top of the piece', async () => {
    const { view, runtime } = createRig();
    await view.initialize();
    await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    // A keyboard wider than its screen, laid out a key every ten pixels, since
    // jsdom lays nothing out.
    const keys = element('replay-keys');
    const scroller = keys.querySelector<HTMLElement>('.replay-keys__scroller');
    if (scroller === null) {
      throw new Error('No scroller under the keys.');
    }
    let scrolledTo: number | null = null;
    Object.defineProperty(scroller, 'scrollWidth', { value: 1_000, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(scroller, 'scrollLeft', {
      configurable: true,
      get: () => scrolledTo ?? 0,
      set: (left: number) => {
        scrolledTo = left;
      },
    });
    for (const key of keys.querySelectorAll<HTMLElement>('[data-midi]')) {
      Object.defineProperty(key, 'offsetLeft', { value: Number(key.dataset['midi']) * 10 });
      Object.defineProperty(key, 'offsetWidth', { value: 10 });
    }
    runtime.controller.updateSettings({ rangeFromBar: 2, rangeToBar: 2 });

    await pressListen(runtime.controller);

    // Bar two's lowest note is G2, centred: not bar one's C3.
    expect(scrolledTo).toBe(p('G2').midi * 10 + 5 - 100);

    element<HTMLButtonElement>('focus-stop').click();
  });

  it('slides the keyboard along to a note struck out of sight during playback', async () => {
    const { view, runtime, metronome } = createRig();
    await view.initialize();
    await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    // Two hundred pixels of a keyboard laid a key every ten, since jsdom lays
    // nothing out.
    const keys = element('replay-keys');
    const scroller = keys.querySelector<HTMLElement>('.replay-keys__scroller');
    if (scroller === null) {
      throw new Error('No scroller under the keys.');
    }
    let left = 0;
    const slides: number[] = [];
    Object.defineProperty(scroller, 'scrollWidth', { value: 1_000, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 200, configurable: true });
    Object.defineProperty(scroller, 'scrollLeft', {
      configurable: true,
      get: () => left,
      set: (to: number) => {
        left = to;
      },
    });
    Object.defineProperty(scroller, 'scrollTo', {
      configurable: true,
      value: (options: ScrollToOptions) => {
        slides.push(options.left ?? Number.NaN);
      },
    });
    for (const key of keys.querySelectorAll<HTMLElement>('[data-midi]')) {
      Object.defineProperty(key, 'offsetLeft', { value: Number(key.dataset['midi']) * 10 });
      Object.defineProperty(key, 'offsetWidth', { value: 10 });
    }
    await pressListen(runtime.controller);
    // Opened on C3, which leaves D4 past the right-hand edge.
    expect(left).toBe(p('C3').midi * 10 + 5 - 100);

    metronome.advanceSubdivisions(2);

    expect(slides).toEqual([p('D4').midi * 10 + 5 - 100]);
    element<HTMLButtonElement>('focus-stop').click();
  });

  it('shows the pedal down where the music holds it during playback', async () => {
    const { view, runtime, metronome } = createRig();
    await view.initialize();
    await runtime.controller.openScore({
      ...twoBarExercise({ tempoBpm: 60 }),
      pedalMarks: [
        { measureIndex: 0, offsetTicks: 0, type: 'start', line: true },
        { measureIndex: 1, offsetTicks: 0, type: 'stop', line: true },
      ],
    });
    const pedal = element('replay-keys').querySelector<HTMLElement>('.replay-keys__pedal');
    await pressListen(runtime.controller);

    metronome.advanceSubdivisions(2);
    expect(pedal?.dataset['down']).toBe('true');

    metronome.advanceSubdivisions(4);
    expect(pedal?.dataset['down']).toBe('false');

    element<HTMLButtonElement>('focus-stop').click();
  });

  it('keeps the keyboard hidden during regular practice runs', async () => {
    const { view, runtime } = createRig();
    await view.initialize();
    const keys = element('replay-keys');

    element<HTMLButtonElement>('focus-play').click();
    expect(runtime.controller.session?.status).toBe('running');
    expect(keys.hidden).toBe(true);

    element<HTMLButtonElement>('focus-stop').click();
    expect(keys.hidden).toBe(true);
  });

  describe('the section for developers', () => {
    it('turns the start timings on from the settings, and keeps them on', async () => {
      // His: "може їх лишити при опції з settings у розділі for developers".
      const lines: string[] = [];
      const logged = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
        lines.push(String(line));
      });
      try {
        const { view, runtime } = createRig();
        await view.initialize();

        const box = element<HTMLInputElement>('trace-the-start');
        expect(box.checked).toBe(false);
        box.checked = true;
        box.dispatchEvent(new Event('change', { bubbles: true }));

        expect(runtime.controller.settings.traceTheStart).toBe(true);
        expect(lines.some((line) => line.startsWith('[timing] on'))).toBe(true);

        // And a run started now is timed: the switch reached the instrument,
        // not only the setting.
        element<HTMLButtonElement>('focus-play').click();
        expect(lines.some((line) => line.includes('run asked for'))).toBe(true);
      } finally {
        logged.mockRestore();
      }
    });

    it('says nothing in the console to a reader who never asked', async () => {
      const lines: string[] = [];
      const logged = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
        lines.push(String(line));
      });
      try {
        const { view } = createRig();
        await view.initialize();

        element<HTMLButtonElement>('focus-play').click();

        expect(lines.filter((line) => line.startsWith('[timing]'))).toEqual([]);
      } finally {
        logged.mockRestore();
      }
    });
  });

  describe('the escape key', () => {
    function pressEscape(): void {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    }

    it('gives every sheet one control that shuts it, and only one', () => {
      // The rule that stops the next sheet being forgotten. Escape used to work
      // off a list kept in the view, and the list had five of the eleven on it.
      mountRealMarkup();
      const sheets = [...document.querySelectorAll('.sheet')];

      expect(sheets.length).toBeGreaterThan(8);
      for (const sheet of sheets) {
        expect(sheet.querySelectorAll('[data-shuts]'), sheet.id).toHaveLength(1);
      }
    });

    it('shuts every sheet with that control, and so with Escape', async () => {
      // Escape and a tap outside both press the control, so a control that
      // nothing listens to leaves all three ways out dead at once - the
      // exercise sheet's was, the day it was added.
      const { view } = createRig();
      await view.initialize();
      // A confirmation, a rename and a rating are each a question, and their
      // controls are wired by the question while it waits for an answer:
      // opened without one, there is nothing for them to answer.
      const QUESTIONS = ['sheet-confirm', 'sheet-rename', 'sheet-stars'];
      const sheets = [...document.querySelectorAll<HTMLElement>('.sheet')].filter(
        (sheet) => !QUESTIONS.includes(sheet.id),
      );

      expect(sheets.length).toBeGreaterThan(8);
      const left: string[] = [];
      for (const sheet of sheets) {
        sheet.hidden = false;
        pressEscape();
        if (!sheet.hidden) left.push(sheet.id);
        sheet.hidden = true;
      }
      expect(left).toEqual([]);
    });

    it('shuts on a tap outside its panel, every sheet there is', async () => {
      // Asked of the page, as Escape is. Wired sheet by sheet it was a list,
      // and the modes, the picture of a run and then a single reading were each
      // the one it had missed. His last: "Reading діалог неможливо зачинити
      // якщо натиснути мишкою поза діалог".
      // By pressing the sheet's own control, which does whatever shutting that
      // sheet means - that each one does is the escape key's tests' to say.
      const { view } = createRig();
      await view.initialize();
      const sheets = [...document.querySelectorAll<HTMLElement>('.sheet')];

      expect(sheets.length).toBeGreaterThan(8);
      for (const sheet of sheets) {
        let pressed = 0;
        sheet.querySelector('[data-shuts]')?.addEventListener('click', () => {
          pressed += 1;
        });
        tapOutside(sheet);
        expect(pressed, sheet.id).toBe(1);
      }
    });

    it('shuts a reading on a tap outside it, and leaves the list it came from', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      runtime.history.record('score:A', { atMs: Date.now(), overall: 0.8, grade: 'B', completed: true });
      element<HTMLButtonElement>('focus-readings').click();
      element('readings-list').querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      expect(element('sheet-reading').hidden).toBe(false);

      tapOutside(element('sheet-reading'));

      expect(element('sheet-reading').hidden).toBe(true);
      expect(element('sheet-readings').hidden).toBe(false);
    });

    it('stays open when a drag begun inside its panel ends outside it', async () => {
      // Selecting the name being typed, and letting go past the panel's edge:
      // the click lands on the sheet, and is no way out.
      const { view } = createRig();
      await view.initialize();
      const sheet = element('sheet-settings');
      element<HTMLButtonElement>('focus-settings').click();

      sheet.querySelector('.sheet__panel')?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      sheet.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(sheet.hidden).toBe(false);
    });

    it('shuts the picture of a run, which no list ever had on it', async () => {
      // His: "чи можеш діалогам додати shortcut esc щоб зачиняти їх?".
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      expect(element('sheet-roll').hidden).toBe(false);

      pressEscape();

      expect(element('sheet-roll').hidden).toBe(true);
    });

    it('shuts it the way the sheet shuts, not by hiding it', async () => {
      // Several have something to put away first, and a list that hid them
      // would leave exactly that behind - here, a drawing still playing.
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      element<HTMLButtonElement>('roll-play').click();
      expect(runtime.takePlayer.playing).not.toBeNull();

      pressEscape();

      expect(runtime.takePlayer.playing).toBeNull();
    });

    it('unwinds a reading and its picture one at a time, shutting nothing by itself', async () => {
      // His: "був order відчинянь readings -> reading -> MIDI viewer та ніякий
      // діалог не зачинявся поки я сам їх не зачиню".
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record('score:A', {
        atMs: Date.now(),
        overall: 0.8,
        grade: 'B',
        completed: true,
        roll: {
          presses: [
            {
              midi: 60,
              downAtMs: 0,
              upAtMs: 300,
              velocity: 0.5,
              verdict: null,
              stepIndex: null,
              deviationMs: null,
            },
          ],
          beats: [],
          pedal: [],
          rushes: [],
          truncated: false,
        },
      });

      element<HTMLButtonElement>('focus-readings').click();
      element('readings-list').querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
      element<HTMLButtonElement>('reading-roll').click();

      // All three standing, each over the one it was opened from.
      expect(element('sheet-readings').hidden).toBe(false);
      expect(element('sheet-reading').hidden).toBe(false);
      expect(element('sheet-roll').hidden).toBe(false);
      expect(Number(element('sheet-roll').dataset['over'])).toBeGreaterThan(
        Number(element('sheet-reading').dataset['over']),
      );
      expect(Number(element('sheet-reading').dataset['over'])).toBeGreaterThan(
        Number(element('sheet-readings').dataset['over']),
      );

      pressEscape();
      expect(element('sheet-roll').hidden).toBe(true);
      expect(element('sheet-reading').hidden).toBe(false);

      pressEscape();
      expect(element('sheet-reading').hidden).toBe(true);
      expect(element('sheet-readings').hidden).toBe(false);

      pressEscape();
      expect(element('sheet-readings').hidden).toBe(true);
    });

    it('takes the sheet laid over another before the one underneath', async () => {
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      element<HTMLButtonElement>('roll-options').click();
      expect(element('sheet-roll-options').hidden).toBe(false);

      pressEscape();

      expect(element('sheet-roll-options').hidden).toBe(true);
      // And the picture is still there, which is what the reader went back to.
      expect(element('sheet-roll').hidden).toBe(false);
    });

    it('leaves the page alone when there is no sheet to shut', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();

      expect(() => pressEscape()).not.toThrow();
      // It is not a second Stop: a run behind nothing is a run in progress.
      expect(runtime.controller.session?.status).toBe('running');
    });
  });

  describe('a playback going on to other pieces', () => {
    /** Three pieces kept, the latest opened last, and the page started. */
    async function aShelf(): Promise<Rig> {
      const rig = createRig();
      let at = 1_000;
      for (const title of ['First', 'Second', 'Third']) {
        await rig.runtime.scores.keep(twoBarExercise({ title }), at);
        at += 1_000;
      }
      await rig.view.initialize();
      await rig.runtime.controller.openScore(twoBarExercise({ title: 'Second' }));
      return rig;
    }

    const playing = (rig: Rig, title: string): Promise<void> =>
      vi.waitFor(() => {
        expect(rig.runtime.controller.currentExercise?.title).toBe(title);
        expect(rig.runtime.controller.isListening).toBe(true);
      });

    it('says on its button what comes after the piece, and goes round the three when pressed', async () => {
      const { view, runtime, mediaKeys } = createRig();
      await view.initialize();
      await pressListen(runtime.controller);
      const button = element<HTMLButtonElement>('listen-goes-on');
      const drawn = (): string => element('listen-goes-on-icon').getAttribute('d') ?? '';

      expect(button.dataset['goesOn']).toBe('this');
      expect(button.title).toBe('Only this piece. Press for the shelf in its order.');
      const pictures = [drawn()];

      for (const [goesOn, said] of [
        ['list', 'The shelf in its order.'],
        ['random', 'The shelf shuffled.'],
        ['this', 'Only this piece.'],
      ] as const) {
        button.click();
        expect(runtime.controller.settings.playbackGoesOn).toBe(goesOn);
        expect(button.dataset['goesOn']).toBe(goesOn);
        expect(button.title.startsWith(said)).toBe(true);
        expect(button.getAttribute('aria-label')).toBe(button.title);
        pictures.push(drawn());
      }
      expect(new Set(pictures).size).toBe(3);
      expect(pictures.at(-1)).toBe(pictures[0]);
      // With nothing kept there is no other piece for a key to go to.
      expect(mediaKeys.now?.next).toBeNull();
      expect(mediaKeys.now?.previous).toBeNull();
    });

    it('dims the repeat while the playback goes on to other pieces, and says why', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      const repeat = element<HTMLButtonElement>('focus-repeat');
      element<HTMLButtonElement>('listen-goes-on').click();
      expect(runtime.controller.settings.playbackGoesOn).toBe('list');
      // A run still repeats, so nothing is dimmed outside a playback.
      expect(repeat.dataset['idle']).toBeUndefined();

      await pressListen(runtime.controller);
      expect(repeat.dataset['idle']).toBe('true');
      expect(repeat.title).toMatch(/other pieces/);

      element<HTMLButtonElement>('listen-goes-on').click();
      element<HTMLButtonElement>('listen-goes-on').click();
      expect(runtime.controller.settings.playbackGoesOn).toBe('this');
      expect(repeat.dataset['idle']).toBeUndefined();
      expect(repeat.title).toBe('Play the passage again and again');
    });

    it('plays a sketch written down alone, with nothing on the bar to go through the shelf by', async () => {
      const rig = await aShelf();
      rig.runtime.controller.updateSettings({ playbackGoesOn: 'list', countInBars: 0 });
      rig.sketches.begin(
        {
          events: [0, 500, 1_000, 1_500].flatMap((atMs) => [
            { kind: 'noteOn' as const, atMs, midi: 60, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: atMs + 400, midi: 60 },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Alone',
        1,
      );
      const theThree = (): boolean[] =>
        ['listen-previous', 'listen-goes-on', 'listen-next'].map((id) => element<HTMLButtonElement>(id).hidden === true);
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Write this sketch down as a score').click();
      await vi.waitFor(() => {
        expect(rig.runtime.controller.openedExercise?.title).toBe('Alone');
      });
      await pressListen(rig.runtime.controller);
      expect(rig.runtime.controller.isListening).toBe(true);
      expect(theThree()).toEqual([true, true, true]);
      // The repeat has something to say again: the playback goes nowhere else.
      expect(element('focus-repeat').dataset['idle']).toBeUndefined();

      // Played to its end, it stays the page's.
      rig.metronome.advanceSubdivisions(80);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rig.runtime.controller.isListening).toBe(false);
      expect(rig.runtime.controller.openedExercise?.title).toBe('Alone');

      // A kept score open again, they are back.
      await rig.runtime.controller.openScore(twoBarExercise({ title: 'Second' }));
      await pressListen(rig.runtime.controller);
      expect(theThree()).toEqual([false, false, false]);
    });

    it('plays the next piece on the shelf once one ends, without moving it up the shelf', async () => {
      const rig = await aShelf();
      rig.runtime.controller.updateSettings({ playbackGoesOn: 'list', countInBars: 0 });
      await pressListen(rig.runtime.controller);

      rig.metronome.advanceSubdivisions(40);

      // The shelf reads latest first: Third, Second, First.
      await playing(rig, 'First');
      expect(rig.runtime.scores.list().map((score) => score.title)).toEqual(['Third', 'Second', 'First']);
    });

    it('goes on rather than round where every lap would be counted in and repeated', async () => {
      const rig = await aShelf();
      rig.runtime.controller.updateSettings({
        playbackGoesOn: 'list',
        countInBars: 1,
        countInPlayback: 'every',
        repeatRange: true,
      });
      await pressListen(rig.runtime.controller);
      const begun = vi.spyOn(rig.runtime.controller, 'listen');

      rig.metronome.advanceSubdivisions(60);

      await playing(rig, 'First');
      // The piece that ended was not begun again on the way.
      expect(begun).toHaveBeenCalledTimes(1);
    });

    it('stops at the end of the piece where it is only this piece', async () => {
      const rig = await aShelf();
      rig.runtime.controller.updateSettings({ countInBars: 0 });
      await pressListen(rig.runtime.controller);

      rig.metronome.advanceSubdivisions(40);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(rig.runtime.controller.isListening).toBe(false);
      expect(rig.runtime.controller.currentExercise?.title).toBe('Second');
    });

    it('takes the shelf in its order again once the shuffle is turned off', async () => {
      const rig = await aShelf();
      // A shuffle that leaves the order as it is: Second, then Third, First.
      // Given back at once: everything generated after it draws its seed here.
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      rig.runtime.controller.updateSettings({ playbackGoesOn: 'random' });
      await pressListen(rig.runtime.controller);
      try {
        rig.mediaKeys.now?.next?.();
        await playing(rig, 'Third');
      } finally {
        random.mockRestore();
      }

      element<HTMLButtonElement>('listen-goes-on').click();
      expect(rig.runtime.controller.settings.playbackGoesOn).toBe('this');
      element<HTMLButtonElement>('listen-goes-on').click();
      rig.mediaKeys.now?.next?.();

      // The shelf after Third, rather than the shuffle's First.
      await playing(rig, 'Second');
    });

    it('goes on to the next piece from the key, and back, whatever comes after the piece', async () => {
      const rig = await aShelf();
      await pressListen(rig.runtime.controller);

      rig.mediaKeys.now?.next?.();
      await playing(rig, 'First');

      rig.mediaKeys.now?.previous?.();
      await playing(rig, 'Second');
    });

    it('goes to the next piece and back from the buttons either side', async () => {
      const rig = await aShelf();
      await pressListen(rig.runtime.controller);
      expect(element('listen-next').dataset['idle']).toBeUndefined();
      expect(element('listen-next').title).toBe('The next piece');

      element<HTMLButtonElement>('listen-next').click();
      await playing(rig, 'First');

      element<HTMLButtonElement>('listen-previous').click();
      await playing(rig, 'Second');
    });

    it('dims the buttons either side, and says why, with nothing kept to go to', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      await pressListen(runtime.controller);
      const title = runtime.controller.currentExercise?.title;

      for (const id of ['listen-previous', 'listen-next']) {
        expect(element(id).dataset['idle']).toBe('true');
        expect(element(id).title).toMatch(/Nothing is kept on the shelf/);
        expect(element(id).getAttribute('aria-label')).toBe(element(id).title);
      }
      element<HTMLButtonElement>('listen-next').click();
      await new Promise((resolve) => setTimeout(resolve, 20));
      // And a press that goes nowhere leaves the music playing.
      expect(runtime.controller.currentExercise?.title).toBe(title);
      expect(runtime.controller.isListening).toBe(true);

      // A piece kept since, and the next playback has somewhere to go.
      element<HTMLButtonElement>('focus-stop').click();
      await runtime.scores.keep(twoBarExercise({ title: 'Kept' }), 1_000);
      await pressListen(runtime.controller);
      expect(element('listen-next').dataset['idle']).toBeUndefined();
    });

    it('plays nothing it was opening once stopped', async () => {
      const rig = await aShelf();
      await pressListen(rig.runtime.controller);

      rig.mediaKeys.now?.next?.();
      // Stop is for a piece being opened to play, as for one playing.
      expect(element<HTMLButtonElement>('focus-stop').disabled).toBe(false);
      element<HTMLButtonElement>('focus-stop').click();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(rig.runtime.controller.isListening).toBe(false);
    });
  });

  describe('the keys the platform has outside this page', () => {
    it('hands them over while a performance plays, and names the piece', async () => {
      // They reach a page nobody is looking at, which is the whole point: a
      // piece going on a loop can be stopped without finding the tab again.
      const { view, runtime, mediaKeys } = createRig();
      await view.initialize();

      await pressListen(runtime.controller);

      expect(mediaKeys.now?.playing).toBe(true);
      expect(mediaKeys.now?.title).toBe(runtime.controller.currentExercise?.title);
    });

    it('holds a performance from the key, and picks it up from it', async () => {
      const { view, runtime, mediaKeys } = createRig();
      await view.initialize();
      await pressListen(runtime.controller);

      mediaKeys.now?.pause();

      expect(runtime.controller.isListening).toBe(false);
      expect(runtime.controller.isListeningPaused).toBe(true);
      // And the panel says so, rather than going on offering Pause over music
      // that has stopped.
      expect(mediaKeys.now?.playing).toBe(false);
      // The page agrees, which is the thing two places drift apart on.
      expect(element('focus-play').getAttribute('aria-label')).toBe('Resume');

      mediaKeys.now?.play();

      expect(runtime.controller.isListening).toBe(true);
      expect(mediaKeys.now?.playing).toBe(true);
      expect(element('focus-play').getAttribute('aria-label')).not.toBe('Resume');
    });

    it('gives them back when the performance ends', async () => {
      // A page that keeps them after its music has ended swallows them from
      // whatever the reader plays next.
      const { view, runtime, mediaKeys } = createRig();
      await view.initialize();
      await pressListen(runtime.controller);

      mediaKeys.now?.stop();

      expect(runtime.controller.isListening).toBe(false);
      expect(runtime.controller.isListeningPaused).toBe(false);
      expect(mediaKeys.now).toBeNull();
    });

    it('never takes them for a run', async () => {
      // A reader mid-run who presses pause on their headphones means the thing
      // they are listening to elsewhere. The run in front of them is not media,
      // and losing it to a key meant for something else is a practice thrown
      // away.
      const { view, runtime, mediaKeys } = createRig();
      await view.initialize();

      element<HTMLButtonElement>('focus-play').click();

      expect(runtime.controller.session?.status).toBe('running');
      expect(mediaKeys.now).toBeNull();
    });

    it('does not begin a performance from a key nobody is watching, nor hold one already held', async () => {
      // These are pressed by somebody who is not looking at this page, and a
      // fresh performance starting in a tab they have forgotten is not what
      // Play means to them.
      const { view, runtime, mediaKeys } = createRig();
      await view.initialize();
      await pressListen(runtime.controller);
      const answering = mediaKeys.now;
      answering?.pause();
      answering?.pause();
      expect(runtime.controller.isListeningPaused).toBe(true);
      answering?.stop();

      answering?.play();
      // A start waits on the samples first, so a performance begun here would
      // be under way a turn later.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runtime.controller.isListening).toBe(false);
      expect(runtime.controller.isListeningPaused).toBe(false);
    });

    it('skips a playing performance to a moment of it, and a held one to be picked up there', async () => {
      const { view, runtime, mediaKeys, renderer } = createRig();
      await view.initialize();
      await pressListen(runtime.controller);
      const place = mediaKeys.now?.placeNow();
      expect(place?.durationMs).toBeGreaterThan(0);
      const halfway = (place?.durationMs ?? 0) / 2;

      mediaKeys.now?.seekTo(halfway);

      // Playing on, from the step the moment falls in.
      expect(runtime.controller.isListening).toBe(true);
      const moved = runtime.controller.performancePlace?.positionMs ?? -1;
      expect(moved).toBeGreaterThan(0);
      expect(moved).toBeLessThanOrEqual(halfway);

      mediaKeys.now?.pause();
      expect(renderer.cursor.position).toBeGreaterThan(0);
      const toldBefore = mediaKeys.said.length;
      mediaKeys.now?.seekTo(0);
      expect(mediaKeys.said.length).toBeGreaterThan(toldBefore);

      // Still held, from the top now, the marker on it and the panel told.
      expect(runtime.controller.isListeningPaused).toBe(true);
      expect(renderer.cursor.position).toBe(0);
      expect(mediaKeys.now?.placeNow()?.positionMs).toBe(0);
      expect(mediaKeys.now?.playing).toBe(false);
    });

    it('tells the panel where the performance stands at every step', async () => {
      const { view, runtime, mediaKeys, metronome } = createRig();
      await view.initialize();
      await pressListen(runtime.controller);
      const before = mediaKeys.said.length;

      metronome.advanceSubdivisions(16);

      expect(mediaKeys.said.length).toBeGreaterThan(before);
      expect(mediaKeys.now?.playing).toBe(true);
    });

    it('gives them back when the view goes', async () => {
      const { view, runtime, mediaKeys } = createRig();
      await view.initialize();
      await pressListen(runtime.controller);

      view.dispose();

      expect(mediaKeys.now).toBeNull();
    });
  });

  describe('the slider under a performance', () => {
    it('stands under the keys while a performance plays or is held, and goes with it', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      const strip = element('listen-on-keys');
      expect(strip.hidden).toBe(true);

      await pressListen(runtime.controller);
      const place = runtime.controller.performancePlace;
      expect(strip.hidden).toBe(false);
      expect(document.body.dataset['slider']).toBe('shown');
      expect(element('listen-duration').textContent).toBe(clockTime(place?.durationMs ?? -1));

      element<HTMLButtonElement>('focus-play').click();
      expect(runtime.controller.isListeningPaused).toBe(true);
      expect(strip.hidden).toBe(false);

      element<HTMLButtonElement>('focus-stop').click();
      expect(strip.hidden).toBe(true);
      expect(document.body.dataset['slider']).toBeUndefined();
    });

    it('moves along with the performance between its steps, and stops moving when it stops', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        const { view, runtime, metronome } = createRig();
        await view.initialize();
        const timers = vi.getTimerCount();
        await pressListen(runtime.controller);
        const scrub = element<HTMLInputElement>('listen-scrub');
        const before = scrub.value;

        // Into the music, and on past the step it reached.
        metronome.advanceSubdivisions(6);
        vi.advanceTimersByTime(100);

        const place = runtime.controller.performancePlace;
        expect(scrub.value).not.toBe(before);
        expect(Number(scrub.value)).toBe(Math.round(((place?.positionMs ?? 0) / (place?.durationMs ?? 1)) * 1_000));
        expect(element('listen-position').textContent).toBe(clockTime(place?.positionMs ?? -1));

        element<HTMLButtonElement>('focus-stop').click();
        expect(vi.getTimerCount()).toBe(timers);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the slider in the lap a repeating performance is in when it is told to go on to other pieces', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        const { view, runtime, metronome } = createRig();
        await view.initialize();
        element<HTMLButtonElement>('focus-repeat').click();
        await pressListen(runtime.controller);
        const scrub = element<HTMLInputElement>('listen-scrub');
        // Round once, and into the second lap.
        let last = 0;
        let lapped = false;
        for (let tick = 0; tick < 2_000 && !lapped; tick += 1) {
          metronome.advanceSubdivisions(1);
          const now = runtime.controller.performancePlace?.positionMs ?? 0;
          lapped = now < last;
          last = now;
        }
        metronome.advanceSubdivisions(4);
        vi.advanceTimersByTime(100);
        expect(lapped).toBe(true);
        const before = Number(scrub.value);
        expect(before).toBeGreaterThan(0);
        expect(before).toBeLessThan(1_000);

        // Going on to other pieces, the repeat stops; this lap plays out, and the slider stays in it.
        element<HTMLButtonElement>('listen-goes-on').click();
        vi.advanceTimersByTime(100);
        const place = runtime.controller.performancePlace;
        expect(runtime.controller.isListening).toBe(true);
        expect(Number(scrub.value)).toBe(before);
        expect(place?.positionMs).toBeLessThan(place?.durationMs ?? 0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('holds a playing performance while dragged, and plays on from where it is let go', async () => {
      const { view, runtime, renderer } = createRig();
      await view.initialize();
      await pressListen(runtime.controller);
      const scrub = element<HTMLInputElement>('listen-scrub');
      const duration = runtime.controller.performancePlace?.durationMs ?? 0;

      scrub.value = '600';
      scrub.dispatchEvent(new Event('input'));

      // Held for the drag, at the step the slider is over.
      expect(runtime.controller.isListeningPaused).toBe(true);
      const held = runtime.controller.performancePlace?.positionMs ?? -1;
      expect(held).toBeGreaterThan(0);
      expect(held).toBeLessThanOrEqual(duration * 0.6);
      const marker = renderer.cursor.position;
      expect(marker).toBeGreaterThan(0);

      scrub.dispatchEvent(new Event('change'));

      expect(runtime.controller.isListening).toBe(true);
      expect(runtime.controller.performancePlace?.positionMs).toBe(held);
    });

    it('moves a held performance while dragged, and leaves it held', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      await pressListen(runtime.controller);
      element<HTMLButtonElement>('focus-play').click();
      const scrub = element<HTMLInputElement>('listen-scrub');

      scrub.value = '0';
      scrub.dispatchEvent(new Event('input'));
      scrub.dispatchEvent(new Event('change'));

      expect(runtime.controller.isListeningPaused).toBe(true);
      expect(runtime.controller.performancePlace?.positionMs).toBe(0);
      expect(element('focus-play').getAttribute('aria-label')).toBe('Resume');
    });
  });

  it('ends a held performance with Stop, which is what Stop is for', async () => {
    const { view, runtime } = createRig();
    await view.initialize();
    await pressListen(runtime.controller);
    await pressListen(runtime.controller);
    expect(runtime.controller.isListeningPaused).toBe(true);
    // And it offers to, rather than sitting greyed out over held music.
    expect(element<HTMLButtonElement>('focus-stop').disabled).toBe(false);

    element<HTMLButtonElement>('focus-stop').click();

    expect(runtime.controller.isListeningPaused).toBe(false);
    expect(runtime.controller.isListening).toBe(false);
    expect(element('focus-play').getAttribute('aria-label')).toBe('Start');
  });

  it('ends what the old frame was doing when the frame changes', async () => {
    // One frame at a time, and one rule in one place. A performance belongs
    // to the listening frame and a session to the other two, so leaving a
    // frame ends what it had going. This used to be a fight between the
    // transport buttons: a run was *taken away* by a playback and had no
    // session left to say so with, so Start stayed disabled for good.
    const { view, runtime } = createRig();
    await view.initialize();

    element<HTMLButtonElement>('focus-play').click();
    expect(runtime.controller.session?.status).toBe('running');

    // Which is what the listen button does now: it says "that frame" first.
    await pressListen(runtime.controller);

    expect(runtime.controller.machinePlays).toBe(true);
    expect(runtime.controller.isListening).toBe(true);
    expect(runtime.controller.session?.status).not.toBe('running');
    // Stop is not idle: something is playing, and Stop ends what is playing.
    expect(element<HTMLButtonElement>('focus-stop').disabled).toBe(false);

    // And back again, which ends the performance rather than leaving it
    // playing under a run.
    runtime.controller.updateSettings({ modeId: new WaitMode().id });

    expect(runtime.controller.isListening).toBe(false);
    expect(runtime.controller.isListeningPaused).toBe(false);
  });

  it('stops offering to stop a performance its score replaced', async () => {
    // The button said "Stop listening" over a piece that was no longer
    // playing and no longer even on the page.
    const { view, runtime } = createRig();
    await view.initialize();

    await pressListen(runtime.controller);
    expect(element('focus-play').getAttribute('aria-label')).toBe('Pause');

    await runtime.controller.loadNewExercise();

    expect(runtime.controller.isListening).toBe(false);
    expect(element('focus-play').getAttribute('aria-label')).toBe('Start');
  });

  it('tells the page which bars the reader has seen before', async () => {
    // A repeat is written out rather than jumped back to, so the numbers go
    // back on their own. Without the mark, a reader has no way of knowing
    // why - and the wiring from the score to the page had no test at all.
    const { view, runtime, renderer } = createRig();
    await view.initialize();

    const base = twoBarExercise({ title: 'With A Repeat' });
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    await runtime.controller.openScore({
      ...base,
      // Bar one read twice: two, one again, two again.
      barLabels: [
        { number: 1, repeated: false },
        { number: 2, repeated: false },
        { number: 1, repeated: true },
        { number: 2, repeated: true },
      ],
      staves: [
        { ...treble, measures: [...treble.measures, ...treble.measures] },
        { ...bass, measures: [...bass.measures, ...bass.measures] },
      ],
    });

    expect(renderer.repeatedBars).toEqual([2, 3]);
  });

  it('sounds only the hand that was chosen', async () => {
    const { view, instrument, metronome, runtime } = createRig();
    await view.initialize();

    // Both hands -> left alone -> right alone, so one press is the left.
    const hand = element<HTMLButtonElement>('focus-hands');
    hand.click();
    await pressListen(runtime.controller);
    metronome.advanceSubdivisions(8);

    // The bass staff of the fixture holds C3 and the chord under it; the
    // treble's C4 and the melody above it must stay silent.
    const sounded = new Set(instrument.played.map((note) => note.midi));
    expect(sounded.size).toBeGreaterThan(0);
    expect([...sounded].every((midi) => midi < 60)).toBe(true);
  });

  it('makes Start mean "play it to me" in the frame where the machine plays', async () => {
    // His: Start replaces playback. There is nothing else for it to mean
    // here - no run is begun in this frame - so the one button holds the
    // performance rather than starting a session beside it, which is what
    // the two of them used to fight over.
    const { view, runtime } = createRig();
    await view.initialize();
    await pressListen(runtime.controller);
    expect(runtime.controller.isListening).toBe(true);

    element<HTMLButtonElement>('focus-play').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.controller.isListeningPaused).toBe(true);
    expect(runtime.controller.session?.status).not.toBe('running');

    element<HTMLButtonElement>('focus-play').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.controller.isListening).toBe(true);
  });

  it('narrows practice to a passage without cutting the music', async () => {
    // The page keeps the whole piece; the *run* is what gets two ends. That
    // is what leaves the bar numbers meaning what they say and what stops
    // there being a seam to repair at either edge.
    const rig = createRig();
    await rig.view.initialize();
    const wholePiece = rig.runtime.controller.currentTimeline?.length ?? 0;

    const from = element<HTMLInputElement>('focus-from');
    from.value = '2';
    from.dispatchEvent(new Event('change'));
    const to = element<HTMLInputElement>('focus-to');
    to.value = '2';
    to.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    expect(rig.runtime.controller.settings.rangeFromBar).toBe(2);
    expect(rig.runtime.controller.currentTimeline?.length ?? 0).toBe(wholePiece);

    // And the run plays that bar and stops.
    rig.runtime.controller.updateSettings({ countInBars: 0, modeId: 'mode.flow' });
    const session = rig.runtime.controller.start();
    rig.metronome.advanceSubdivisions(1);
    expect(session?.currentStep?.measureIndex).toBe(1);

    rig.metronome.advanceBeats(12);
    expect(session?.status).toBe('completed');
  });

  it('opens a MusicXML file and logs what it lost', async () => {
    // The warnings are worth keeping - several faults here were found through
    // one - and not worth a line across the music, so they go to the console.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { view, runtime } = createRig();
    await view.initialize();

    const xml = new MusicXmlSerializer().serialize(twoBarExercise({ title: 'Borrowed' }));
    const input = element<HTMLInputElement>('score-file');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [{ arrayBuffer: () => Promise.resolve(new TextEncoder().encode(xml).buffer) }],
    });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.controller.openedExercise?.title).toBe('Borrowed');
    // Nothing was lost from this one, so nothing was said about it either.
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it('prints a file it opens once, for the library and the engraver both', async () => {
    // His Alkan closed the iPad's tab while it opened: printing it twice was
    // eleven million characters more at the moment the page was fullest.
    const { view, runtime } = createRig();
    await view.initialize();
    const xml = new MusicXmlSerializer().serialize(twoBarExercise({ title: 'Borrowed' }));
    const printing = vi.spyOn(MusicXmlSerializer.prototype, 'serialize');
    const input = element<HTMLInputElement>('score-file');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [{ arrayBuffer: () => Promise.resolve(new TextEncoder().encode(xml).buffer) }],
    });

    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.controller.openedExercise?.title).toBe('Borrowed');
    const plain = printing.mock.calls.filter(
      ([exercise, how]) => exercise.title === 'Borrowed' && how?.evenBars !== true,
    );
    expect(plain).toHaveLength(1);
    printing.mockRestore();
  });

  it('adds an armful of files without opening any of them', async () => {
    // His: a multi import that imports and opens nothing. Adding a shelf of
    // arrangements is a different act from picking up a piece - opening each
    // in turn engraves every one of them, which on thirty files is minutes
    // of waiting for pages nobody asked to see.
    const { view, runtime } = createRig();
    await view.initialize();
    const serializer = new MusicXmlSerializer();
    const asFile = (title: string) => ({
      name: `${title}.musicxml`,
      arrayBuffer: () =>
        Promise.resolve(
          new TextEncoder().encode(serializer.serialize(twoBarExercise({ title }))).buffer,
        ),
    });

    const input = element<HTMLInputElement>('score-file');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [asFile('First'), asFile('Second'), asFile('Third')],
    });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.scores.list().map((score) => score.title).sort()).toEqual([
      'First',
      'Second',
      'Third',
    ]);
    // Nothing on the stand: choosing three files is not choosing a piece.
    expect(runtime.controller.openedExercise).toBeNull();
    expect(element('scores-added').hidden).toBe(false);
    expect(element('scores-added').textContent).toContain('3');
  });

  it('keeps going past a file it cannot read, and names it', async () => {
    // One bad file in a shelf of thirty must not cost the other twenty-nine,
    // and the reader has no other way to tell which one was refused.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { view, runtime } = createRig();
    await view.initialize();
    element<HTMLButtonElement>('focus-scores').click();
    const serializer = new MusicXmlSerializer();
    const good = (title: string) => ({
      name: `${title}.musicxml`,
      arrayBuffer: () =>
        Promise.resolve(
          new TextEncoder().encode(serializer.serialize(twoBarExercise({ title }))).buffer,
        ),
    });

    const input = element<HTMLInputElement>('score-file');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [
        good('Fine'),
        { name: 'broken.mxl', arrayBuffer: () => Promise.resolve(new TextEncoder().encode('<nope/>').buffer) },
        good('Also fine'),
      ],
    });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.scores.list().map((score) => score.title).sort()).toEqual(['Also fine', 'Fine']);
    expect(element('scores-added').textContent).toContain('broken.mxl');
    // And says why, not only which. This line used to stop at the names, so a
    // shelf that had run out of room looked exactly like a file that was not
    // music - and the reader was left with "could not open" and nothing to do
    // about it. His: "насправді я не знаю в чому проблема".
    expect(element('scores-added').textContent?.replace('broken.mxl', '')).toMatch(/[a-z]{4}/);
    expect(element('scores-added').textContent).not.toBe('Added 2. Could not open broken.mxl.');
    // And the sheet stays up, unlike the single-file case: the reader is
    // adding a shelf, and the list they are watching is the answer.
    expect(element('sheet-scores').hidden).toBe(false);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('puts the passage boxes back when a file replaces what was on the stand', async () => {
    const { view, runtime } = createRig();
    await view.initialize();

    const from = element<HTMLInputElement>('focus-from');
    from.value = '2';
    from.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();
    expect(runtime.controller.settings.rangeFromBar).toBe(2);

    const xml = new MusicXmlSerializer().serialize(twoBarExercise({ title: 'Borrowed' }));
    const input = element<HTMLInputElement>('score-file');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [{ arrayBuffer: () => Promise.resolve(new TextEncoder().encode(xml).buffer) }],
    });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The setting and the box are one thing seen twice: a box still reading
    // "2" over music that is not narrowed is the page telling the reader
    // something untrue about what Start will play.
    expect(runtime.controller.settings.rangeFromBar).toBeNull();
    expect(from.value).toBe('');
  });

  it('gets out of its own way when a file will not open', async () => {
    // Reported from the tablet: a file that fails to import says nothing at
    // all. It did say something - in the middle of the page, where every
    // other failure is said - and the library sheet the file was chosen from
    // stands over exactly that. So the reader was left looking at a list that
    // had not changed.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { view } = createRig();
    await view.initialize();
    element<HTMLButtonElement>('focus-scores').click();
    expect(element('sheet-scores').hidden).toBe(false);

    const input = element<HTMLInputElement>('score-file');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [
        {
          name: 'bad-apple.mxl',
          arrayBuffer: () => Promise.resolve(new TextEncoder().encode('<not-a-score/>').buffer),
        },
      ],
    });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(element('sheet-scores').hidden).toBe(true);
    expect(element('score-verdict').hidden).toBe(false);
    // And it says which file, since a reader adding several at once has no
    // other way to tell which of them was refused.
    expect(element('result').textContent).toContain('bad-apple.mxl');
    expect(logged).toHaveBeenCalled();
  });

  it('explains a file it cannot read instead of going quiet', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { view, runtime } = createRig();
    await view.initialize();

    const input = element<HTMLInputElement>('score-file');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [
        {
          arrayBuffer: () =>
            Promise.resolve(new TextEncoder().encode('<shopping><item>milk</item></shopping>').buffer),
        },
      ],
    });
    input.dispatchEvent(new Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(runtime.controller.openedExercise).toBeNull();
    // Said in the middle of the page, over the music: the one place a reader
    // is certain to be looking, and where every other failure is said.
    expect(element('score-verdict').hidden).toBe(false);
    expect(element('result').textContent).toContain('Could not open');
    // And somewhere it can be copied from. The notice says one sentence,
    // which is what a reader needs mid-practice - but it cannot be selected
    // on a tablet and carries no stack, so a fault worth reporting had to be
    // read off the screen by hand.
    expect(logged).toHaveBeenCalled();
  });

  it('lets the click drop out for whole bars', async () => {
    const { view, renderer, runtime } = createRig();
    await view.initialize();
    const before = renderer.loadCount;

    const select = element<HTMLSelectElement>('dropout');
    select.value = 'cycle-2';
    select.dispatchEvent(new Event('change'));
    await Promise.resolve();

    expect(runtime.controller.settings.clickWhen).toBe('cycle-2');
    expect(element('dropout-description').textContent).toContain('2 bars');
    expect(renderer.loadCount).toBe(before);
  });

  it('offers a click that stops once the count-in is over', async () => {
    const { view, runtime } = createRig();
    await view.initialize();

    const select = element<HTMLSelectElement>('dropout');
    select.value = 'count-in-only';
    select.dispatchEvent(new Event('change'));
    await Promise.resolve();

    expect(runtime.controller.settings.clickWhen).toBe('count-in-only');
    // This rig starts with no count-in, so the choice asks for pure silence.
    expect(element('dropout-description').textContent).toContain('nothing will sound');

    const countIn = element<HTMLInputElement>('count-in');
    countIn.value = '1';
    countIn.dispatchEvent(new Event('input'));

    // The other control changes what the line means, so it has to follow.
    expect(element('dropout-description').textContent).toContain('left with it');
  });

  it('regenerates when the rhythm changes', async () => {
    const { view, renderer, runtime } = createRig();
    await view.initialize();

    const select = element<HTMLSelectElement>('rhythm');
    select.value = 'sixteenths';
    select.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.controller.settings.rhythmProfileId).toBe('sixteenths');
    expect(element('rhythm-description').textContent).toContain('Sixteenths');
    expect(renderer.loadCount).toBe(2);
  });

  it('drives a run from the buttons and shows live feedback', async () => {
    const { view, runtime, midi, renderer } = createRig();
    await view.initialize();

    element<HTMLButtonElement>('focus-play').click();

    const session = runtime.controller.session;
    expect(session?.status).toBe('running');
    expect(element('focus-play').getAttribute('aria-label')).toBe('Pause');
    expect(element<HTMLButtonElement>('focus-stop').disabled).toBe(false);

    const step = session?.currentStep;
    if (step === undefined || step === null) {
      throw new Error('expected a first step');
    }
    midi.noteOn(step.expectedMidi[0] ?? 60, 0);
    // The page is where a press shows now, and the panel that used to spell
    // it out in letters is gone.
    expect(renderer.played.length).toBeGreaterThan(0);
  });

  it('turns the one transport button through its three answers', async () => {
    // One button for start, pause and resume, as a transport has: the icon
    // says which of them it is now and the accessible name says it in words.
    const { view, runtime } = createRig();
    await view.initialize();
    expect(element('focus-play').getAttribute('aria-label')).toBe('Start');

    element<HTMLButtonElement>('focus-play').click();
    expect(element('focus-play').getAttribute('aria-label')).toBe('Pause');

    element<HTMLButtonElement>('focus-play').click();
    expect(runtime.controller.session?.status).toBe('paused');
    expect(element('focus-play').getAttribute('aria-label')).toBe('Resume');

    element<HTMLButtonElement>('focus-play').click();
    expect(runtime.controller.session?.status).toBe('running');
    expect(element('focus-play').getAttribute('aria-label')).toBe('Pause');
  });

  it('shows the final report when a run is stopped', async () => {
    const { view } = createRig();
    await view.initialize();
    element<HTMLButtonElement>('focus-play').click();

    element<HTMLButtonElement>('focus-stop').click();

    expect(element('score-verdict').hidden).toBe(false);
    expect(element('result').textContent).toContain('Overall');
    // And the letter hands its own colour over, the way a reading's row does.
    expect(element('result').querySelector('.result__grade')?.getAttribute('data-grade')).toBe(
      element('result').querySelector('.result__grade')?.textContent,
    );
    // The pill carries the verdict once there is one; the status it was
  });

  it('reports which way a run leaned, not only how far off it was', async () => {
    const { view } = createRig();
    await view.initialize();
    element<HTMLButtonElement>('focus-play').click();
    element<HTMLButtonElement>('focus-stop').click();

    expect(element('result').textContent).toContain('Tendency');
  });

  describe('what the middle of the page says', () => {
    it('is empty until there is something to say', async () => {
      const { view } = createRig();
      await view.initialize();

      expect(element('score-card').hidden).toBe(true);
      // Over the music and not over the app: in fullscreen the score is the
      // whole page anyway, and this is about the score either way.
      expect(element('score-card').parentElement?.id).toBe('score');
    });

    it('gives the verdict there, where a panel fullscreen hides cannot', async () => {
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();

      element<HTMLButtonElement>('focus-stop').click();

      expect(element('score-card').hidden).toBe(false);
      expect(element('score-verdict').hidden).toBe(false);
      expect(element('result').textContent).toContain('Overall');
    });

    it('tells the stylesheet how tall the bar is, each time it changes', async () => {
      // What keeps the verdict out from under the bar. The bar is out of the
      // flow, and taller on a narrow screen and with the drawer open.
      const watched: { report: () => void; target: Element }[] = [];
      vi.stubGlobal(
        'ResizeObserver',
        class {
          private readonly report: () => void;
          constructor(report: () => void) {
            this.report = report;
          }
          observe(target: Element): void {
            watched.push({ report: this.report, target });
          }
          disconnect(): void {}
        },
      );
      try {
        const { view } = createRig();
        await view.initialize();
        const bar = element('focus-bar');
        const ofTheBar = watched.filter((watch) => watch.target === bar);
        expect(ofTheBar).toHaveLength(1);

        for (const height of [76, 188]) {
          Object.defineProperty(bar, 'offsetHeight', { configurable: true, value: height });
          ofTheBar[0]?.report();
          expect(document.documentElement.style.getPropertyValue('--focus-bar-height')).toBe(`${String(height)}px`);
        }
      } finally {
        vi.unstubAllGlobals();
        document.documentElement.style.removeProperty('--focus-bar-height');
      }
    });

    it('puts the verdict away on a tap, the card with it', async () => {
      // It is over the music the reader is about to go back to, and touching
      // a thing you have read is how you say you have read it.
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      element<HTMLButtonElement>('focus-stop').click();

      element('score-verdict').click();

      expect(element('score-verdict').hidden).toBe(true);
      expect(element('score-card').hidden).toBe(true);
    });

    it('keeps it up when the tap was on a button inside it', async () => {
      // The drill button means "practise the worst bars", not "I have read
      // this" - and a dismissal riding on top of it would take the verdict
      // away from under a reader who was answering it.
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      element<HTMLButtonElement>('focus-stop').click();

      element<HTMLButtonElement>('drill').click();

      expect(element('score-verdict').hidden).toBe(false);
    });

    it('offers the next page from the verdict on a generated one, and never on a score', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      element<HTMLButtonElement>('focus-stop').click();
      const read = runtime.controller.currentExercise;
      expect(element('verdict-fresh').hidden).toBe(false);

      element<HTMLButtonElement>('verdict-fresh').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Other notes, not the same page written out again.
      expect(runtime.controller.currentExercise?.staves).toBeDefined();
      expect(runtime.controller.currentExercise?.staves).not.toEqual(read?.staves);
      // The report was of the page that has gone.
      expect(element('score-verdict').hidden).toBe(true);

      // A score opened has no other page behind it.
      await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
      element<HTMLButtonElement>('focus-play').click();
      element<HTMLButtonElement>('focus-stop').click();
      expect(element('score-verdict').hidden).toBe(false);
      expect(element('verdict-fresh').hidden).toBe(true);
    });

    it('takes the verdict away when the music starts again', async () => {
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      element<HTMLButtonElement>('focus-stop').click();
      expect(element('score-verdict').hidden).toBe(false);

      element<HTMLButtonElement>('focus-play').click();

      expect(element('score-verdict').hidden).toBe(true);
      expect(element('score-card').hidden).toBe(true);
    });

    it('counts the run in there, rather than in the corner of an eye', async () => {
      // What the reader is doing during a count-in is reading the first bar,
      // so the number belongs where they are already looking.
      const { view, runtime, metronome } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ countInBars: 1, modeId: FLOW_MODE_ID });
      await runtime.controller.reloadExercise();
      expect(element('score-count').hidden).toBe(true);

      runtime.controller.start();
      // The count is beaten, not announced on starting: the number is how
      // many pulses are left, and it takes a pulse to know.
      metronome.advanceBeats(1);

      expect(element('score-count').hidden).toBe(false);
      expect(Number.parseInt(element('score-count').textContent ?? '', 10)).toBeGreaterThan(0);
      expect(element('score-card').hidden).toBe(false);

      // And nowhere else counts it. The pill and the desk's status line say

      // And it is gone by the time there is a bar to play.
      metronome.advanceBeats(8);
      expect(element('score-count').hidden).toBe(true);
    });

    it('shows the page ahead only while there is music moving', async () => {
      // Reported from the page: the run stopped and the top of the next page
      // stayed hanging over the system he had just played. It exists to
      // soften a page turn, and nothing is about to turn when nothing is
      // playing.
      const { view, renderer } = createRig();
      await view.initialize();
      expect(renderer.nextPagePreview).toBe(false);

      element<HTMLButtonElement>('focus-play').click();
      expect(renderer.nextPagePreview).toBe(true);

      element<HTMLButtonElement>('focus-stop').click();
      expect(renderer.nextPagePreview).toBe(false);
    });

    it('shows it for a playback too, which is where he asked for it', async () => {
      const { view, renderer, runtime } = createRig();
      await view.initialize();

      await pressListen(runtime.controller);
      expect(renderer.nextPagePreview).toBe(true);

      // Held, not ended: the music will go on from where it is.
      await pressListen(runtime.controller);
      expect(renderer.nextPagePreview).toBe(true);

      element<HTMLButtonElement>('focus-stop').click();
      expect(renderer.nextPagePreview).toBe(false);
    });

    it('opens the ruler from its own button, and turns it down', async () => {
      // At the desk with everything else the page is set up by: it had a
      // sheet of its own reached from the drawer, and the drawer is for what
      // a reader presses with their hands on the keys.
      const { view, runtime } = createRig();
      await view.initialize();

      const strength = element<HTMLInputElement>('ruler-strength');
      strength.value = '30';
      strength.dispatchEvent(new Event('input'));

      expect(runtime.controller.settings.rulerStrength).toBeCloseTo(0.3, 5);
      // Said to the stylesheet, which scales all three weights by it at once.
      expect(element('score').style.getPropertyValue('--ruler-strength')).toBe('0.3');
    });

    it('runs the marker along the ruler, beat by beat', async () => {
      // The run says which beats are about to pass and when; the timing is
      // the view's, because the application layer has no timer. Under a held
      // note this is the only thing that moves.
      vi.useFakeTimers();
      try {
        const { view, runtime, renderer, midi, clock } = createRig();
        await view.initialize();
        await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
        runtime.controller.updateSettings({
          handStaff: 2,
          rhythmRuler: 'quarter',
          rulerCursor: true,
        });
        runtime.controller.start();
        clock.set(5_000);

        midi.noteOn(p('C3').midi, 5_000);

        // The beat he played, at once.
        vi.advanceTimersByTime(0);
        const first = renderer.beatMark;
        expect(first).not.toBeNull();

        // And the next one a quarter later, with nothing else moving.
        vi.advanceTimersByTime(1_000);
        expect(renderer.beatMark).not.toBe(first);
        expect(renderer.beatMark).not.toBeNull();

        // Stopping takes it off the page, and the beats still to come with it.
        element<HTMLButtonElement>('focus-stop').click();
        expect(renderer.beatMark).toBeNull();
        vi.advanceTimersByTime(5_000);
        expect(renderer.beatMark).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('can be found and turned off before it has ever spoken', async () => {
      // Reported: he could not find the setting. It was only in the card,
      // and the card is only on the page once a rest has fallen due - so for
      // the first half hour there was nowhere to find it at all.
      const { view, runtime } = createRig();
      await view.initialize();
      const inSettings = element<HTMLSelectElement>('rest-every-settings');
      expect(inSettings.options.length).toBeGreaterThan(1);
      expect(inSettings.value).toBe(String(runtime.controller.settings.restEveryMinutes));

      inSettings.value = '0';
      inSettings.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.restEveryMinutes).toBe(0);
      // The two chairs are one value, so the card's own follows.
      expect(element<HTMLSelectElement>('rest-every').value).toBe('0');
    });

    it('offers a rest, and counts one down when it is taken', async () => {
      // His own idea. The card appears in the middle of the page, where
      // everything the page has to say is said, and the only thing it insists
      // on is being easy to put off.
      vi.useFakeTimers();
      try {
        const { view, runtime, midi } = createRig();
        await view.initialize();
        runtime.controller.updateSettings({ restEveryMinutes: 30 });
        expect(element('score-rest').hidden).toBe(true);

        // A note a minute: the timer counts the gaps between notes, and
        // anything shorter than a break is time at the keyboard.
        for (let at = 0; at <= 31 * 60_000; at += 60_000) {
          midi.noteOn(60, at);
        }

        expect(element('score-rest').hidden).toBe(false);
        expect(element('score-card').hidden).toBe(false);
        // Said the moment it fell due, which is at the half hour itself.
        expect(element('rest-heading').textContent).toContain('30 minutes');
        expect(element('rest-tip').textContent).not.toBe('');

        element<HTMLButtonElement>('rest-take').click();

        // The clock starts again at once - the rest has begun - and the ring
        // is what says how much of it is left.
        expect(runtime.controller.sittingMs).toBe(0);
        expect(element('rest-ring').hasAttribute('hidden')).toBe(false);
        expect(element<HTMLButtonElement>('rest-take').hidden).toBe(true);

        vi.advanceTimersByTime(3 * 60_000 + 500);

        expect(element('score-rest').hidden).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('lets go of the two notes that say a rest is over', async () => {
      // His report: with the recordings not downloaded the fallback tone
      // sounds, and "як почне грати - так і не завершиться". A synthesised
      // note is held until it is released - which is right for a key - and
      // the chime pressed two keys and released neither. A recording runs
      // out on its own, which is why only a reader without them heard it.
      vi.useFakeTimers();
      try {
        const { view, runtime, midi, instrument } = createRig();
        await view.initialize();
        runtime.controller.updateSettings({ restEveryMinutes: 30 });
        for (let at = 0; at <= 31 * 60_000; at += 60_000) {
          midi.noteOn(60, at);
        }
        element<HTMLButtonElement>('rest-take').click();

        vi.advanceTimersByTime(3 * 60_000 + 500);

        for (const note of [76, 83]) {
          const struck = instrument.played.find((sounded) => sounded.midi === note);
          const released = instrument.stopped.find((sounded) => sounded.midi === note);
          expect(struck, `note ${note} sounded`).toBeDefined();
          expect(released, `note ${note} released`).toBeDefined();
          // Both ends handed over at once, so there is no second timer to be
          // lost - or to outlive the view - with the note still sounding.
          expect(released?.atMs ?? 0).toBeGreaterThan(struck?.atMs ?? 0);
        }
        // Two notes, one after the other: that is what makes it a chime and
        // not a beep.
        const [first, second] = [76, 83].map(
          (note) => instrument.played.find((sounded) => sounded.midi === note)?.atMs ?? 0,
        );
        expect(second).toBeGreaterThan(first ?? 0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('ends a rest without its chime when the music starts', async () => {
      // Back at the keys before the ring ran out: the card stood over the
      // music being read, and the chime sounded in the middle of it.
      vi.useFakeTimers();
      try {
        const { view, runtime, midi, instrument } = createRig();
        await view.initialize();
        runtime.controller.updateSettings({ restEveryMinutes: 30 });
        for (let at = 0; at <= 31 * 60_000; at += 60_000) {
          midi.noteOn(60, at);
        }
        element<HTMLButtonElement>('rest-take').click();

        element<HTMLButtonElement>('focus-play').click();

        expect(element('score-rest').hidden).toBe(true);
        element<HTMLButtonElement>('focus-stop').click();
        vi.advanceTimersByTime(3 * 60_000 + 500);
        expect(instrument.played.filter((sounded) => sounded.midi === 83)).toEqual([]);
        expect(element('score-rest').hidden).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('takes playing as "not now" to a rest only offered, and puts it off', async () => {
      vi.useFakeTimers();
      try {
        const { view, runtime, midi } = createRig();
        await view.initialize();
        runtime.controller.updateSettings({ restEveryMinutes: 30 });
        for (let at = 0; at <= 31 * 60_000; at += 60_000) {
          midi.noteOn(60, at);
        }
        expect(element('score-rest').hidden).toBe(false);

        element<HTMLButtonElement>('focus-play').click();

        expect(element('score-rest').hidden).toBe(true);
        // Put off, not left owed: an owed rest stops a repeat coming round.
        expect(runtime.controller.restIsOwed).toBe(false);
        // Nor taken: the time at the keys is still counted.
        expect(runtime.controller.sittingMs).toBeGreaterThan(30 * 60_000);
      } finally {
        vi.useRealTimers();
      }
    });

    it('closes the modes on a tap outside them, like every other sheet', async () => {
      // It was bound its own opening and its own ×, which made it the one
      // sheet a tap on the dimmed ground did not close.
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      expect(element('sheet-modes').hidden).toBe(false);

      tapOutside(element('sheet-modes'));

      expect(element('sheet-modes').hidden).toBe(true);
    });

    it('walks the other hand’s marker in time, not all at once', async () => {
      // The run says where the accompaniment will be and when; the waiting is
      // done here, because the view is the layer with a clock. Without it the
      // second marker would arrive wherever the first one did, which is the
      // fault it exists to answer.
      vi.useFakeTimers();
      try {
        const rig = createRig();
        await rig.view.initialize();
        await rig.runtime.controller.openScore(oneHandWalksUnderAHeldNote({ tempoBpm: 60 }));
        rig.runtime.controller.updateSettings({
          handStaff: 1,
          hearTheOtherHand: true,
          modeId: new WaitMode().id,
          countInBars: 0,
          clickOn: false,
        });
        rig.runtime.controller.start();
        rig.midi.noteOn(MIDI.C4, 0);

        // Only where the music has actually got to, which is the reader's own
        // step: the three under their held note are still to come.
        expect(rig.renderer.otherHand.position).toBe(0);

        rig.clock.advance(2_000);
        vi.advanceTimersByTime(2_000);

        // Two quarters of the bass later, and not the fourth.
        expect(rig.renderer.otherHand.position).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });


    it('does not walk the other hand’s marker back to bars the reader has come in ahead of', async () => {
      vi.useFakeTimers();
      try {
        const rig = createRig();
        await rig.view.initialize();
        await rig.runtime.controller.openScore(oneHandWalksUnderAHeldNote({ tempoBpm: 60 }));
        rig.runtime.controller.updateSettings({
          handStaff: 1,
          hearTheOtherHand: true,
          modeId: new WaitMode().id,
          countInBars: 0,
          clickOn: false,
        });
        rig.runtime.controller.start();
        rig.midi.noteOn(MIDI.C4, 0);
        rig.clock.advance(1_500);
        vi.advanceTimersByTime(1_500);

        // Into the second bar after two of the bass's four quarters.
        rig.midi.noteOn(MIDI.D4, rig.clock.now());
        const cameInAt = rig.renderer.otherHand.position;
        rig.clock.advance(3_000);
        vi.advanceTimersByTime(3_000);

        expect(cameInAt).toBe(4);
        expect(rig.renderer.otherHand.position).toBe(4);
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the run being looked at with the recordings', async () => {
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      expect(runtime.takes.list()).toHaveLength(0);

      element<HTMLButtonElement>('roll-keep').click();

      const kept = runtime.takes.list();
      expect(kept).toHaveLength(1);
      expect(kept[0]?.noteCount).toBeGreaterThan(0);
      // And it is in the list on the page, not only in the store.
      expect(element('takes-list').children.length).toBe(1);
    });

    it('shows the window on the map the moment the picture opens', async () => {
      // A hidden sheet has no width, so the box was worked out against nothing,
      // found nothing to say, and stayed away until the first scroll measured
      // it again. jsdom lays nothing out either, so a width is lent to it here
      // for as long as the test takes - which is the only way this suite can
      // see the difference between measuring before and after. His: "minimap
      // синій прямокутник не зявляється при відчинені діалогу, а тільки при
      // першому скролі".
      const lent = (
        name: 'clientWidth',
        width: (element: HTMLElement) => number,
      ): (() => void) => {
        const had = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
        Object.defineProperty(HTMLElement.prototype, name, {
          configurable: true,
          get(this: HTMLElement) {
            return width(this);
          },
        });
        return () => {
          if (had === undefined) {
            delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
            return;
          }
          Object.defineProperty(HTMLElement.prototype, name, had);
        };
      };
      // The view is the grid's width, the keys beside it being no part of the run.
      const giveBack = [
        lent('clientWidth', (node) => (node.classList.contains('roll__grid') ? 100 : 0)),
      ];
      try {
        const { view, runtime, midi } = createRig();
        await view.initialize();
        element<HTMLButtonElement>('focus-play').click();
        const step = runtime.controller.session?.currentStep;
        midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
        element<HTMLButtonElement>('focus-stop').click();

        element<HTMLButtonElement>('run-roll-open').click();

        // There before anybody has scrolled anything.
        expect(element('roll-map-window').hidden).toBe(false);
        expect(element('roll-map-window').style.width).not.toBe('');
      } finally {
        for (const undo of giveBack) {
          undo();
        }
      }
    });


    /**
     * Lends the drawing's grid a size, because jsdom lays nothing out.
     *
     * The grid is the view onto the run, and every number the maps are drawn
     * from follows from it, from the run and from the zoom.
     */
    function lendTheDrawingASize(view: { readonly wide: number; readonly tall: number }): () => void {
      const sizes: Record<string, (node: HTMLElement) => number> = {
        clientWidth: (node) => (node.classList.contains('roll__grid') ? view.wide : 0),
        clientHeight: (node) => (node.classList.contains('roll__grid') ? view.tall : 0),
      };
      const giveBack: (() => void)[] = [];
      for (const [name, size] of Object.entries(sizes)) {
        const had = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
        Object.defineProperty(HTMLElement.prototype, name, {
          configurable: true,
          get(this: HTMLElement) {
            return size(this);
          },
        });
        giveBack.push(() => {
          if (had === undefined) {
            delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
            return;
          }
          Object.defineProperty(HTMLElement.prototype, name, had);
        });
      }
      return () => {
        for (const undo of giveBack) {
          undo();
        }
      };
    }

    /** Turns a wheel over the drawing, as a trackpad does, either way. */
    function wheel(deltaX: number, deltaY = 0): void {
      element('roll-body').dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX, deltaY }),
      );
    }

    /** Opens the picture of a run with one note in it. */
    async function openThePictureOfARun(): Promise<ReturnType<typeof createRig>> {
      const rig = createRig();
      await rig.view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = rig.runtime.controller.session?.currentStep;
      rig.midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      return rig;
    }

    const aFrame = async (): Promise<void> =>
      new Promise((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      });

    it('moves the box on the map without laying the page out again', async () => {
      // A `left` is a layout on the map, and the next thing to measure the
      // drawing has to wait for one - so following a scroll meant reading a
      // drawing thousands of notes wide, writing a percentage, and reading it
      // again, on every scroll event. A transform is the compositor's and
      // changes no layout at all. His: "чи можна якось швидкість оновлення зони
      // minimap прискорити? Я хочу щоб все йшло плавно, як в osu!".
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 200 });
      try {
        const { view } = await openThePictureOfARun();
        const box = element('roll-map-window');
        // A second of air past the one note, at a hundred and forty to the second.
        const whole = ((view.rollScene?.lengthMs ?? 0) / 1000) * 140;
        expect(whole).toBeGreaterThan(130);
        expect(Number.parseFloat(box.style.width)).toBeCloseTo((100 / whole) * 100, 1);
        expect(box.style.transform).toBe('translateX(0.000%)');
        const wide = box.style.width;

        wheel(30);
        await aFrame();

        // Thirty along is thirty hundredths of its own width, because a
        // transform's per cent is of the element being moved, and the share it
        // is given is of the map.
        expect(box.style.transform).toBe('translateX(30.000%)');
        expect(box.style.left).toBe('');
        // The width is a width, and a scroll does not change it.
        expect(box.style.width).toBe(wide);
      } finally {
        giveBack();
      }
    });

    it('marks down the side among every key of the piano while a sketch is edited', async () => {
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 0 });
      try {
        const rig = createRig();
        await rig.view.initialize();
        rig.midi.noteOn(60, rig.clock.now());
        rig.clock.advance(300);
        rig.midi.noteOff(60, rig.clock.now());
        element<HTMLButtonElement>('focus-keep').click();
        rowButton('takes-list', 'Look at this take').click();
        const top = (): string | undefined =>
          element('roll-pitch-map').querySelector<HTMLElement>('.roll-pitch-map__mark')?.style.top;
        const listening = top();

        // Rows drawn thirty pixels tall, stretched to fill the room.
        const drawn = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
          this: HTMLElement,
        ) {
          return new DOMRect(0, 0, 0, this.classList.contains('roll__key') ? 30 : 0);
        });
        try {
          element<HTMLButtonElement>('roll-edit').click();
        } finally {
          drawn.mockRestore();
        }
        await aFrame();

        // Middle C among eighty-eight keys, C8 at the top.
        expect(top()).toBe(`${(((108 - 60) / 88) * 100).toFixed(3)}%`);
        expect(top()).not.toBe(listening);
        // And the rows as tall as they were drawn, not thinned to fit.
        expect(element('roll-body').querySelector<HTMLElement>('.roll')?.style.getPropertyValue('--roll-row-asked')).toBe(
          '30px',
        );
      } finally {
        giveBack();
      }
    });

    it('marks down the side the notes in the time on the screen', async () => {
      // His: "існують для мене часто ноти які вилазять out of view". The run is
      // one note, pressed and let go at its start, and a second of air - so
      // scrolled to the far end the screen shows none of it.
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 0 });
      try {
        const rig = createRig();
        await rig.view.initialize();
        element<HTMLButtonElement>('focus-play').click();
        const note = rig.runtime.controller.session?.currentStep?.expectedMidi[0] ?? 60;
        rig.midi.noteOn(note, 0);
        rig.midi.noteOff(note, 0);
        element<HTMLButtonElement>('focus-stop').click();
        element<HTMLButtonElement>('run-roll-open').click();
        const strip = element('roll-pitch-map');

        expect(strip.querySelectorAll('.roll-pitch-map__mark')).toHaveLength(1);
        // Nothing is laid out up and down here, so there is no box to claim the strip.
        expect(element('roll-pitch-map-window').hidden).toBe(true);

        // A scroll that changes nothing on the strip redraws nothing on it:
        // this is asked on every frame of a playback.
        const marks = strip.firstElementChild;
        // Down, which moves nothing along the run.
        wheel(0, 5);
        await aFrame();
        expect(strip.firstElementChild).toBe(marks);

        wheel(10_000);
        await aFrame();

        expect(strip.querySelectorAll('.roll-pitch-map__mark')).toHaveLength(0);
        // The box stays, over whatever is marked.
        expect(strip.lastElementChild).toBe(element('roll-pitch-map-window'));
      } finally {
        giveBack();
      }
    });

    it('boxes the rows on the screen', async () => {
      // The grid is the rows on the screen, the ruler and the pedal lane being
      // beside it: sixty tall, of twelve rows at thirteen.
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 60 });
      try {
        const { view } = await openThePictureOfARun();
        const box = element('roll-pitch-map-window');
        const whole = (view.rollScene?.rows ?? 0) * 13;

        expect(box.hidden).toBe(false);
        expect(box.style.height).toBe(`${((60 / whole) * 100).toFixed(3)}%`);
        expect(box.style.transform).toBe('translateY(0.000%)');

        wheel(0, 45);
        await aFrame();

        // Forty-five down is forty-five sixtieths of its own heights along.
        expect(box.style.transform).toBe('translateY(75.000%)');
        // And the keys go down with the rows they name.
        expect(element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y')).toBe('45px');
        expect(box.style.top).toBe('');
      } finally {
        giveBack();
      }
    });

    it('leaves a scrolling wheel to the browser, and takes a zooming one', async () => {
      // Taken, the first message of a gesture made the browser wait on the page
      // for every one after it, and each was drawn a frame later than it could
      // have been. His: "реагує canvas на скрол повільно". A zoom is still
      // taken, or the browser zooms the whole page along with the drawing.
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 200 });
      try {
        await openThePictureOfARun();
        const scrolling = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 30 });
        element('roll-body').dispatchEvent(scrolling);
        await aFrame();

        expect(scrolling.defaultPrevented).toBe(false);
        // Left to the browser, and still scrolled by us.
        expect(element('roll-map-window').style.transform).toBe('translateX(30.000%)');

        const zooming = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, ctrlKey: true });
        element('roll-body').dispatchEvent(zooming);

        expect(zooming.defaultPrevented).toBe(true);
      } finally {
        giveBack();
      }
    });

    /** How tall the rows were last asked to be, in pixels. */
    function theRowsAsked(): string {
      const drawn = element('roll-body').firstElementChild;
      return drawn instanceof HTMLElement ? drawn.style.getPropertyValue('--roll-row-asked') : '';
    }

    it('makes the rows taller and shorter on a wheel with Alt held, and leaves the width', async () => {
      // A pinch changes the height on a screen. A desk has no pinch, and the
      // held wheel changed the width alone.
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 200 });
      try {
        await openThePictureOfARun();
        const zoom = element<HTMLInputElement>('roll-zoom');
        const width = zoom.value;
        const taller = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, altKey: true });

        element('roll-body').dispatchEvent(taller);

        expect(taller.defaultPrevented).toBe(true);
        expect(theRowsAsked()).toBe('15px');
        expect(zoom.value).toBe(width);

        element('roll-body').dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, altKey: true }),
        );

        expect(theRowsAsked()).toBe('13px');
      } finally {
        giveBack();
      }
    });

    it('makes the rows taller from the height they are drawn at, where the room made them taller than asked', async () => {
      // The stylesheet fills the room with the rows, so a row asked for at
      // thirteen may stand at twenty. Grown from thirteen, the first turns up
      // would change nothing on the screen.
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 200 });
      try {
        await openThePictureOfARun();
        const key = element('roll-body').querySelector<HTMLElement>('.roll__key');
        if (key === null) {
          throw new Error('No key drawn beside the rows.');
        }
        key.getBoundingClientRect = () => ({ height: 20 }) as DOMRect;

        element('roll-body').dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, altKey: true }),
        );

        expect(theRowsAsked()).toBe('23px');
      } finally {
        giveBack();
      }
    });

    it('zooms along the run on a wheel over the map, and the rows on one over the strip of pitches', async () => {
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 200 });
      try {
        await openThePictureOfARun();
        const zoom = element<HTMLInputElement>('roll-zoom');
        const width = Number(zoom.value);
        const overTheMap = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 });

        element('roll-map').dispatchEvent(overTheMap);

        expect(Number(zoom.value)).toBeGreaterThan(width);
        // Left to the browser, as a plain wheel over the drawing is.
        expect(overTheMap.defaultPrevented).toBe(false);

        const widened = zoom.value;
        // A trackpad swiped sideways over the strip turns it too.
        element('roll-pitch-map').dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -120 }),
        );

        expect(theRowsAsked()).toBe('15px');
        expect(zoom.value).toBe(widened);

        // A trackpad pinch arrives with Ctrl held, and must not zoom the page.
        const pinched = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -10, ctrlKey: true });
        element('roll-map').dispatchEvent(pinched);

        expect(pinched.defaultPrevented).toBe(true);
      } finally {
        giveBack();
      }
    });

    it('keeps the pitch where it was as the rows grow or shrink: the middle from the strip, the pointer, the fingers', async () => {
      // Only the height changed, and the top of the view stayed where it was in
      // pixels: a taller row pushed what had been in the middle down the view.
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 60 });
      try {
        await openThePictureOfARun();
        // The view a hundred pixels down the screen, so a place on the screen
        // and one down the view are not the same number.
        for (const canvas of element('roll-body').querySelectorAll('canvas')) {
          canvas.getBoundingClientRect = () => new DOMRect(0, 100, 100, 60);
        }
        const down = (): number =>
          Number.parseFloat(
            element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
          );
        const asked = (): number => Number.parseFloat(theRowsAsked() || '13');
        // The row, counted from the top, under a place down the view.
        const rowUnder = async (atPx: number): Promise<number> => {
          await aFrame();
          return (down() + atPx) / asked();
        };
        wheel(0, 40);
        const before = await rowUnder(30);
        expect(down()).toBe(40);

        // Over the strip: around the middle of the view, either way.
        element('roll-pitch-map').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120 }));
        expect(asked()).toBe(15);
        expect(await rowUnder(30)).toBeCloseTo(before, 6);
        element('roll-pitch-map').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 }));
        expect(asked()).toBe(13);
        expect(await rowUnder(30)).toBeCloseTo(before, 6);

        // With Alt over the drawing: around the pointer.
        const underThePointer = await rowUnder(10);
        element('roll-body').dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, altKey: true, clientY: 110 }),
        );
        expect(asked()).toBe(15);
        expect(await rowUnder(10)).toBeCloseTo(underThePointer, 6);

        // Two fingers drawn apart down the page: around the point between them.
        const finger = (type: string, pointerId: number, clientY: number): void => {
          element('roll-body').dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, clientX: 0, clientY }));
        };
        finger('pointerdown', 1, 110);
        finger('pointerdown', 2, 150);
        const underTheFingers = await rowUnder(50);
        finger('pointermove', 2, 190);
        expect(asked()).toBe(30);
        expect(await rowUnder(50)).toBeCloseTo(underTheFingers, 6);
        finger('pointerup', 2, 190);
        finger('pointerup', 1, 110);
      } finally {
        giveBack();
      }
    });

    it('marks the strip of a sketch in the colours its notes are drawn in, the chosen in its own', async () => {
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 0 });
      try {
        const rig = createRig();
        await rig.view.initialize();
        rig.sketches.begin(
          {
            events: [
              [0, 72],
              [0, 48],
            ].flatMap(([atMs = 0, midi = 0]) => [
              { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
              { kind: 'noteOff' as const, atMs: atMs + 400, midi },
            ]),
            beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
          },
          'Hands',
          1,
        );
        element<HTMLButtonElement>('focus-scores').click();
        element<HTMLButtonElement>('scores-show-sketches').click();
        rowButton('sketches-list', 'Edit this sketch').click();
        const kinds = (): string[] =>
          [...element('roll-pitch-map').querySelectorAll<HTMLElement>('.roll-pitch-map__mark')].map((mark) =>
            [...mark.classList].filter((name) => name.startsWith('roll-pitch-map__mark--')).join(' '),
          );

        // The right hand's above, the left's below, not grey.
        expect(kinds()).toEqual(['roll-pitch-map__mark--right', 'roll-pitch-map__mark--left']);

        // Chosen, its row is marked chosen.
        const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
        const highest = rig.view.rollScene?.highest ?? 0;
        const down =
          Number.parseFloat(
            element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
          ) || 0;
        tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: 0.1 * zoom, clientY: (highest - 48 + 0.5) * 13 - down });
        expect(kinds()).toEqual(['roll-pitch-map__mark--right', 'roll-pitch-map__mark--chosen']);
      } finally {
        giveBack();
      }
    });

    it('sounds a key of the strip beside a sketch while it is held, and each key it is slid to, and outlines the keys of the chosen notes', async () => {
      const { view, sketches, instrument } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 60],
            [500, 64],
          ].flatMap(([atMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: atMs + 400, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Keys',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const body = element('roll-body');
      const keyOf = (midi: number): HTMLElement => {
        const found = body.querySelector<HTMLElement>(`.roll__key[data-midi='${String(midi)}']`);
        if (found === null) {
          throw new Error(`no key ${String(midi)}`);
        }
        return found;
      };
      const heard = (): (number | undefined)[][] => instrument.played.map((note) => [note.midi, note.velocity, note.atMs]);
      const ended = (): (number | undefined)[][] => instrument.stopped.map((note) => [note.midi, note.atMs]);
      const press = (type: string, on: Element, init: PointerEventInit = {}): void => {
        on.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 71, pointerType: 'mouse', button: 0, ...init }));
      };
      const head = headAt(body);
      const events = sketches.find(sketch.id)?.events;

      // Held with the mouse: heard as loud as the notes are, lit while held.
      press('pointerdown', keyOf(67));
      expect(heard()).toEqual([[67, 0.5, undefined]]);
      expect(keyOf(67).dataset['sounding']).toBe('true');
      expect(ended()).toEqual([]);
      press('pointerup', keyOf(67));
      keyOf(67).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(ended()).toEqual([[67, undefined]]);
      expect(keyOf(67).dataset['sounding']).toBeUndefined();
      // Nothing written, chosen or moved by it.
      expect(sketches.find(sketch.id)?.events).toEqual(events);
      expect(headAt(body)).toBe(head);
      // Another button sounds nothing: the right one, nor the side one.
      for (const button of [2, 3]) {
        press('pointerdown', keyOf(67), { button });
        press('pointerup', keyOf(67), { button });
      }
      expect(heard()).toHaveLength(1);

      // A finger holds it as the mouse does; slid, it sounds each key it comes
      // to in turn, letting go of the one before - by height alone, so strayed
      // onto the drawing it goes on, and past the top it stays on the top key.
      instrument.played.length = 0;
      instrument.stopped.length = 0;
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(body.querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0') || 0;
      const heightOf = (midi: number): number => (highest - midi + 0.5) * 13 - scrolledDown;
      const finger = (type: string, on: Element, clientY: number, clientX = 5): void => {
        press(type, on, { pointerType: 'touch', pointerId: 72, clientX, clientY });
      };
      finger('pointerdown', keyOf(65), heightOf(65));
      expect(heard()).toEqual([[65, 0.5, undefined]]);
      finger('pointermove', body, heightOf(65) + 4);
      expect(heard()).toHaveLength(1);
      finger('pointermove', body, heightOf(64), 300);
      finger('pointermove', body, heightOf(63), 300);
      expect(heard().map(([midi]) => midi)).toEqual([65, 64, 63]);
      expect(ended()).toEqual([
        [65, undefined],
        [64, undefined],
      ]);
      expect([keyOf(63).dataset['sounding'], keyOf(65).dataset['sounding']]).toEqual(['true', undefined]);
      const lowest = highest - (view.rollScene?.rows ?? 0) + 1;
      finger('pointermove', body, heightOf(lowest - 40));
      expect(heard().at(-1)?.[0]).toBe(lowest);
      finger('pointermove', body, -scrolledDown - 500);
      expect(heard().at(-1)?.[0]).toBe(highest);
      finger('pointerup', body, -scrolledDown - 500);
      body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(ended().at(-1)).toEqual([highest, undefined]);
      expect(sketches.find(sketch.id)?.events).toEqual(events);
      expect(headAt(body)).toBe(head);
      // A second finger makes it a pinch, and the key is let go of.
      finger('pointerdown', keyOf(65), heightOf(65));
      body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 73, pointerType: 'touch', clientX: 300, clientY: 100 }));
      expect(ended().at(-1)).toEqual([65, undefined]);
      finger('pointermove', body, heightOf(60));
      expect(heard().at(-1)?.[0]).toBe(65);
      for (const pointerId of [72, 73]) {
        body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId, pointerType: 'touch' }));
      }

      // The key of a chosen note outlined, and only while it is chosen.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a', code: 'KeyA', ctrlKey: true }));
      expect([...body.querySelectorAll<HTMLElement>(".roll__key[data-chosen='true']")].map((key) => key.dataset['midi'])).toEqual(['64', '60']);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' }));
      expect(body.querySelectorAll(".roll__key[data-chosen='true']")).toHaveLength(0);
    });

    it('lights the row of a key sounding - played, or struck by the playback at the head - on the keys and down the strip', async () => {
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 0 });
      vi.useFakeTimers();
      try {
        const rig = createRig();
        await rig.view.initialize();
        rig.sketches.begin(
          {
            events: [
              [0, 60],
              [500, 64],
            ].flatMap(([atMs = 0, midi = 0]) => [
              { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
              { kind: 'noteOff' as const, atMs: atMs + 500, midi },
            ]),
            beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
          },
          'Lit',
          1,
        );
        element<HTMLButtonElement>('focus-scores').click();
        element<HTMLButtonElement>('scores-show-sketches').click();
        rowButton('sketches-list', 'Edit this sketch').click();
        const highest = rig.view.rollScene?.highest ?? 0;
        const lit = (): number[] =>
          [...element('roll-body').querySelectorAll<HTMLElement>('.roll__key')].flatMap((key, row) =>
            key.dataset['sounding'] === 'true' ? [highest - row] : [],
          );
        const marked = (): number =>
          element('roll-pitch-map').querySelectorAll('.roll-pitch-map__mark--sounding').length;

        // A key played on the instrument: its row, with no note on it in view.
        rig.midi.noteOn(67, rig.clock.now());
        expect([lit(), marked()]).toEqual([[67], 1]);
        rig.midi.noteOn(72, rig.clock.now());
        expect([lit(), marked()]).toEqual([[72, 67], 2]);
        // Drawn again with the keys still down - a finer grid - and lit again.
        const grid = element<HTMLSelectElement>('roll-grid');
        grid.value = '2';
        grid.dispatchEvent(new Event('change'));
        expect([lit(), marked()]).toEqual([[72, 67], 2]);
        rig.midi.noteOff(67, rig.clock.now());
        rig.midi.noteOff(72, rig.clock.now());
        expect([lit(), marked()]).toEqual([[], 0]);
        // Below the lowest key there is no row to light.
        rig.midi.noteOn(10, rig.clock.now());
        expect([lit(), marked()]).toEqual([[], 0]);
        rig.midi.noteOff(10, rig.clock.now());

        // The drawing played back: the note under the head, and then the next.
        element<HTMLButtonElement>('roll-play').click();
        rig.clock.advance(100);
        vi.advanceTimersByTime(100);
        expect(lit()).toEqual([60]);
        // At the moment one ends and the next begins, only the next.
        rig.clock.advance(400);
        vi.advanceTimersByTime(100);
        expect([lit(), marked()]).toEqual([[64], 1]);
        // Stopped, nothing sounds.
        element<HTMLButtonElement>('roll-play').click();
        expect(lit()).toEqual([]);
        // Shut, the drawing is left as it was while keys are played.
        element<HTMLButtonElement>('roll-close').click();
        rig.midi.noteOn(67, rig.clock.now());
        expect(lit()).toEqual([]);
      } finally {
        vi.useRealTimers();
        giveBack();
      }
    });

    it('scrolls up and down to where a finger is on the strip', async () => {
      // Centred on the finger, as along the run: half way down the strip is
      // half the rows' worth, less half of the sixty on the screen.
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 60 });
      try {
        const { view } = await openThePictureOfARun();
        const whole = (view.rollScene?.rows ?? 0) * 13;
        const strip = element('roll-pitch-map');
        strip.getBoundingClientRect = () => ({ top: 100, height: 200 }) as DOMRect;
        strip.setPointerCapture = () => undefined;

        strip.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 5, clientY: 200 }),
        );

        const to = whole / 2 - 30;
        expect(element('roll-pitch-map-window').style.transform).toBe(
          `translateY(${((to / 60) * 100).toFixed(3)}%)`,
        );
      } finally {
        giveBack();
      }
    });

    /** How far along the run the view stands, as the head is told it once the frame has come. */
    function scrolledAlong(): number {
      const head = element('roll-body').querySelector<HTMLElement>('.roll__head');
      return Number.parseFloat(head?.style.getPropertyValue('--roll-x') ?? '0');
    }

    /**
     * A finger on the drawing, at a moment of the test's own where it says one.
     * How fast a finger was going is read off the events' own moments, and a
     * test that waited on the wall clock between them measured how busy the
     * machine was: under load a twelve-millisecond wait outlasted the hundred
     * milliseconds a throw is measured over, and the throw read as still.
     */
    function finger(type: string, clientX: number, pointerType = 'touch', atMs?: number): void {
      const event = new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType, clientX, clientY: 50 });
      if (atMs !== undefined) {
        Object.defineProperty(event, 'timeStamp', { value: atMs });
      }
      element('roll-body').dispatchEvent(event);
    }

    it('moves the drawing with a finger, and lets it glide on when it is thrown', async () => {
      // Kept by the program rather than the page, so a finger's pan and its
      // fling are the program's to do - and the drawing, the head and the keys
      // all go together. His, of Signal: "великий canvas скролиться дуже швидко".
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 200 });
      try {
        const { view } = await openThePictureOfARun();
        const whole = ((view.rollScene?.lengthMs ?? 0) / 1000) * 140;
        finger('pointerdown', 90, 'touch', 1_000);
        finger('pointermove', 80, 'touch', 1_012);
        finger('pointermove', 70, 'touch', 1_024);
        await aFrame();
        // Twenty pixels to the left is twenty pixels further along.
        expect(scrolledAlong()).toBe(20);
        // Held there before letting go: put down, not thrown.
        finger('pointerup', 70, 'touch', 1_104);
        await aFrame();
        expect(scrolledAlong()).toBe(20);

        // And thrown, it goes on - as far as the run lets it.
        finger('pointerdown', 70, 'touch', 2_000);
        finger('pointermove', 65, 'touch', 2_012);
        finger('pointermove', 60, 'touch', 2_024);
        finger('pointerup', 60, 'touch', 2_024);
        await aFrame();
        await aFrame();
        expect(scrolledAlong()).toBeGreaterThan(30);
        expect(scrolledAlong()).toBeLessThanOrEqual(whole - 100);
      } finally {
        giveBack();
      }
    });

    it('puts the head down on a tap, and not at the end of a pan', async () => {
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 200 });
      try {
        await openThePictureOfARun();
        const drawn = element('roll-body').querySelector<HTMLElement>('.roll');
        // Put exactly where it lands rather than on the nearest beat, so that
        // a tap anywhere is somewhere the head was not.
        const snap = element<HTMLInputElement>('roll-snap');
        snap.checked = false;
        snap.dispatchEvent(new Event('change', { bubbles: true }));
        const at = headAt(drawn);
        finger('pointerdown', 90);
        finger('pointermove', 60);
        finger('pointerup', 60);
        const grid = element('roll-body').querySelector('.roll__grid');
        grid?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 60 }));

        expect(headAt(drawn)).toBe(at);

        // A finger is never quite still, and a tap that wandered a pixel or two
        // is still a tap - at the moment under it, which is thirty pixels
        // further on than where it touched the screen, the drawing having been
        // moved thirty along.
        finger('pointerdown', 90);
        finger('pointermove', 92);
        finger('pointerup', 92);
        grid?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 92 }));
        expect(headAt(drawn)).toBe(((92 + 30) / 140).toFixed(3));
      } finally {
        giveBack();
      }
    });

    it('opens a picture at its beginning, wherever the last one was left', async () => {
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 200 });
      try {
        await openThePictureOfARun();
        wheel(30);
        await aFrame();
        expect(scrolledAlong()).toBe(30);

        element<HTMLButtonElement>('roll-close').click();
        element<HTMLButtonElement>('run-roll-open').click();
        await aFrame();

        expect(scrolledAlong()).toBe(0);
      } finally {
        giveBack();
      }
    });

    it('leaves a mouse pointing rather than dragging, as a page does', async () => {
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 200 });
      try {
        await openThePictureOfARun();
        finger('pointerdown', 90, 'mouse');
        finger('pointermove', 60, 'mouse');
        finger('pointerup', 60, 'mouse');
        await aFrame();

        expect(scrolledAlong()).toBe(0);
      } finally {
        giveBack();
      }
    });

    it('turns a mouse wheel along the run with shift held, and counts a wheel in lines as lines', async () => {
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 200 });
      try {
        await openThePictureOfARun();
        element('roll-body').dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 12, shiftKey: true }),
        );
        await aFrame();
        expect(scrolledAlong()).toBe(12);

        element('roll-body').dispatchEvent(
          new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 1, deltaMode: 1 }),
        );
        await aFrame();
        // A line is sixteen pixels.
        expect(scrolledAlong()).toBe(28);
      } finally {
        giveBack();
      }
    });

    it('redraws the box at most once a frame, however much is scrolled', async () => {
      // A scroll fires many times between two frames, and every one of them
      // used to redraw the box. The extra ones are thrown away unseen.
      const giveBack = lendTheDrawingASize({ wide: 100, tall: 200 });
      try {
        await openThePictureOfARun();
        // The frame the opening asked for, with the zoom it was drawn at.
        await aFrame();
        const box = element('roll-map-window');
        const at = box.style.transform;
        const frames = vi.spyOn(window, 'requestAnimationFrame');

        for (const by of [5, 10, 15]) {
          wheel(by);
        }

        // Not yet: the frame is what the scrolling goes through.
        expect(box.style.transform).toBe(at);
        expect(frames).toHaveBeenCalledTimes(1);
        frames.mockRestore();

        await aFrame();
        expect(box.style.transform).not.toBe(at);
      } finally {
        giveBack();
      }
    });


    it('puts the picture away on a click outside its panel', async () => {
      // The way out every other sheet has and this one had not: it is opened
      // from the report rather than from the transport, so it was wired on its
      // own and missed it. His: "клік поза діалог не зачиняє MIDI viewer".
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      element<HTMLButtonElement>('roll-play').click();
      expect(runtime.takePlayer.playing).not.toBeNull();

      tapOutside(element('sheet-roll'));

      expect(element('sheet-roll').hidden).toBe(true);
      // Everything closing it means, not only the sheet: the playback stops.
      expect(runtime.takePlayer.playing).toBeNull();
    });

    it('stays open for a click on the drawing itself', async () => {
      // A tap inside the panel is a tap on the run - it is how the marker is
      // placed - and closing on it would make the picture unusable.
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      element('roll-body').dispatchEvent(new MouseEvent('click', { bubbles: true }));

      expect(element('sheet-roll').hidden).toBe(false);
    });


    it('leaves the space bar to whatever is standing over the page', async () => {
      // He pressed space over the picture of a run expecting the picture to
      // play, and started a *run* behind it - with the sheet still hanging
      // there over music that had begun without him. His: "прибрати пробіл
      // shortcut щоб почати гру коли відчинені діалоги".
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      const before = runtime.controller.session?.status;

      document.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }),
      );

      expect(element('sheet-roll').hidden).toBe(false);
      expect(runtime.controller.session?.status).toBe(before);
      // It belongs to the drawing instead, which has a transport of its own.
      expect(runtime.takePlayer.playing).not.toBeNull();

      document.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }),
      );

      expect(runtime.takePlayer.playing).toBeNull();
    });

    it('leaves the space bar to a sheet standing over the picture', async () => {
      // The options sheet, a confirmation and a rename all lay themselves over
      // the top, and while one is up the keys are its own.
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      element<HTMLButtonElement>('roll-options').click();

      document.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }),
      );

      expect(runtime.takePlayer.playing).toBeNull();
    });

    it('gives the space bar back once the page is clear', async () => {
      // The rule is about what is in front of the reader, not about the key:
      // with nothing over the page it starts a run as it always has.
      const { view, runtime } = createRig();
      await view.initialize();
      expect(runtime.controller.session).toBeNull();

      document.dispatchEvent(
        new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true }),
      );

      expect(runtime.controller.session).not.toBeNull();
    });


    it('says a run has been kept by going grey', async () => {
      // Pressed again it would file a second copy of the same run under a
      // second name. His: "коли натискається Keep - можеш зробити щоб кнопка
      // становилась disabled".
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const keep = element<HTMLButtonElement>('roll-keep');
      expect(keep.disabled).toBe(false);

      keep.click();

      expect(keep.disabled).toBe(true);
      expect(runtime.takes.list()).toHaveLength(1);

      // A different run is a different thing to keep.
      element<HTMLButtonElement>('roll-close').click();
      element<HTMLButtonElement>('focus-play').click();
      const again = runtime.controller.session?.currentStep;
      midi.noteOn(again?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      expect(element<HTMLButtonElement>('roll-keep').disabled).toBe(false);
    });

    it('scrolls on a plain wheel and zooms on a held one', async () => {
      // A wheel scrolls, which the browser does better than anything written
      // here - the momentum, the rubber band, the sideways axis a trackpad
      // gives. Held down it zooms, which is the convention every drawing
      // program uses and the one a trackpad pinch already arrives as. His:
      // "горизонтальний та вертикальний скроли зробити звичайними скролами, а
      // ctrl+скрол зробити zoom in/zoom out".
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const zoom = element<HTMLInputElement>('roll-zoom');
      const was = zoom.value;
      const wheel = (ctrlKey: boolean): void => {
        element('roll-body').dispatchEvent(
          new WheelEvent('wheel', { deltaY: -120, ctrlKey, bubbles: true, cancelable: true }),
        );
      };

      wheel(false);
      expect(zoom.value, 'a plain wheel is the browser’s').toBe(was);

      wheel(true);
      expect(Number(zoom.value)).toBeGreaterThan(Number(was));
    });


    it('reads a waiting run against the pace the music asked for', async () => {
      // The pairing is the page's: the report says how late each entry was and
      // the timeline says where it was written, and the shape is drawn from the
      // two together. Asked without the second, the axis reads the gaps in
      // milliseconds and comes out in the tens of thousands of per cent - which
      // is how a flawless reading of real music scored nothing. His: "stability
      // на 0% постійно".
      const { view, runtime, midi } = createRig();
      await view.initialize();
      await runtime.controller.openScore(offBeatAfterALongNote({ tempoBpm: 60 }));
      runtime.controller.updateSettings({
        modeId: new WaitMode().id,
        countInBars: 0,
        clickOn: false,
      });
      runtime.controller.start();

      // A half, an eighth after a rest, and a quarter - each entry taken at the
      // moment it is written at, which at sixty is nought, two and a half, and
      // three seconds.
      for (const at of [0, 2_500, 3_000]) {
        const step = runtime.controller.session?.currentStep;
        for (const midi_ of step?.expectedMidi ?? []) {
          midi.noteOn(midi_, at);
        }
      }
      element<HTMLButtonElement>('focus-stop').click();

      const said = element('run-profile').textContent ?? '';
      expect(said).toContain('100% of the written pace');
    });


    it('opens a kept recording in the same picture', async () => {
      // A recording is presses and pedal against time, which is what the
      // picture draws - so looking at one asks for no second drawing. His:
      // "можливість відчинити будь який recording у MIDI viewer".
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      element<HTMLButtonElement>('roll-keep').click();
      element<HTMLButtonElement>('roll-close').click();

      // From the list, which is where a recording is actually reached from.
      element<HTMLButtonElement>('focus-takes').click();
      expect(element('sheet-takes').hidden).toBe(false);
      const look = element('takes-list').querySelector<HTMLButtonElement>(
        'button[aria-label^="Look at"]',
      );
      look?.click();

      expect(element('sheet-roll').hidden).toBe(false);
      // And the list it was asked from steps aside rather than standing over
      // the thing it has just opened.
      expect(element('sheet-takes').hidden).toBe(true);
      expect(element('roll-title').textContent).toBe('A recording');
      expect(view.rollScene?.notes.length).toBeGreaterThan(0);
      // No grid: nothing was keeping the time of free playing.
      expect(view.rollScene?.lines).toHaveLength(0);
      // And nothing a recording cannot answer is on offer.
      expect(element('roll-keep').hidden).toBe(true);
      expect(element<HTMLButtonElement>('roll-from').disabled).toBe(true);
      expect(element<HTMLButtonElement>('roll-practise').disabled).toBe(true);
    });


    it('begins a sketch of a recording, takes a note out of it where it is drawn, and puts it back', async () => {
      const { view, runtime, midi, clock, takes, sketches } = createRig();
      await view.initialize();
      // Not on a run: what was read is not changed, nor begun from.
      element<HTMLButtonElement>('focus-play').click();
      midi.noteOn(runtime.controller.session?.currentStep?.expectedMidi[0] ?? 60, clock.now());
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      const edit = element<HTMLButtonElement>('roll-edit');
      const remove = element<HTMLButtonElement>('roll-delete');
      const undo = element<HTMLButtonElement>('roll-undo');
      const redo = element<HTMLButtonElement>('roll-redo');
      expect(edit.dataset['idle']).toBe('true');
      expect(edit.title).toBe('Edit the notes. Only a sketch is edited: begin one from a recording or a score.');
      edit.click();
      expect(edit.getAttribute('aria-pressed')).toBe('false');
      expect(sketches.list()).toHaveLength(0);
      expect([remove.hidden, undo.hidden, redo.hidden]).toEqual([true, true, true]);
      element<HTMLButtonElement>('roll-close').click();

      // Three notes half a second apart, played freely and kept.
      clock.advance(10_000);
      for (const pitch of [60, 64, 67]) {
        midi.noteOn(pitch, clock.now());
        clock.advance(300);
        midi.noteOff(pitch, clock.now());
        clock.advance(200);
      }
      element<HTMLButtonElement>('focus-keep').click();
      const kept = takes.list()[0];
      expect(kept?.noteCount).toBe(3);
      rowButton('takes-list', 'Look at this take').click();
      // Nothing judged in it: its notes filled by the hand their pitch is in.
      expect(view.rollScene?.notes.map((note) => note.shade)).toEqual(['right', 'right', 'right']);
      // A recording is a record of what was played: the pencil begins a sketch.
      expect(edit.dataset['idle']).toBeUndefined();
      expect(edit.title).toBe('Begin a sketch of this recording to edit; the recording stays as it was played');
      expect(edit.getAttribute('aria-label')).toBe(edit.title);
      expect([remove.hidden, undo.hidden, redo.hidden]).toEqual([true, true, true]);
      const highest = view.rollScene?.highest ?? 0;
      edit.click();
      const sketch = sketches.list()[0];
      expect(sketches.list()).toHaveLength(1);
      expect(sketch?.title).toMatch(/^Sketch of a take, \d\d\.\d\d\.\d{4}$/);
      expect(element('roll-title').textContent).toBe(sketch?.title);
      // Opened being edited, in common time at 120 from its first note, since
      // it was played without the click: a bar line every two seconds, with
      // two bars of room after it.
      expect(edit.getAttribute('aria-pressed')).toBe('true');
      expect(edit.title).toBe('Back to listening: a tap puts the marker');
      expect(view.rollScene?.bars.map((bar) => bar.atMs)).toEqual([0, 2_000, 4_000]);
      expect([view.rollScene?.highest, view.rollScene?.rows]).toEqual([108, 88]);
      expect([remove.hidden, undo.hidden, redo.hidden]).toEqual([false, false, false]);
      expect([remove.dataset['away'], undo.dataset['away'], redo.dataset['away']]).toEqual([undefined, undefined, undefined]);
      expect(remove.dataset['idle']).toBe('true');
      expect(remove.title).toBe('Delete a note (Delete). Tap one to choose it.');
      expect(remove.getAttribute('aria-label')).toBe(remove.title);
      expect(undo.dataset['idle']).toBe('true');
      expect(undo.title).toBe('Undo (Ctrl+Z). Nothing has been changed to put back.');
      expect(redo.dataset['idle']).toBe('true');
      expect(redo.title).toBe('Redo (Shift+Ctrl+Z). Nothing has been put back to bring back.');
      expect(redo.getAttribute('aria-label')).toBe(redo.title);

      // A finger on a note, a little into it, on its row; the grid stands at
      // the drawing's corner, and a row is thirteen pixels until it is drawn.
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      // Less however far the drawing has been scrolled down.
      const scrolledDown = (): number =>
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const tapOn = (fromMs: number): void => {
        const note = view.rollScene?.notes.find((each) => each.fromMs === fromMs);
        tapTheDrawing({
          clientX: ((fromMs + 100) / 1000) * zoom,
          clientY: ((note?.row ?? 0) + 0.5) * 13 - scrolledDown(),
          shiftKey: true,
        });
      };
      const chosen = (): number[] =>
        (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => note.fromMs);
      // Editing: the tap chooses, and the marker stays where it was.
      tapOn(1_000);
      expect(chosen()).toEqual([1_000]);
      expect(headAt(element('roll-body'))).toBe('0.000');
      // The ruler still puts it somewhere to listen from, and writes nothing.
      tapTheDrawing({ clientX: 0.6 * zoom, clientY: 0 }, element('roll-body').querySelector('.roll__ruler') ?? undefined);
      expect(headAt(element('roll-body'))).toBe('0.500');
      expect(sketches.find(sketch?.id ?? '')?.noteCount).toBe(3);
      expect(chosen()).toEqual([1_000]);
      // Another tapped with Shift is chosen as well; tapped again, let go of.
      tapOn(500);
      expect(chosen()).toEqual([500, 1_000]);
      expect(remove.dataset['idle']).toBeUndefined();
      expect(remove.title).toBe('Delete the 2 chosen notes (Delete)');
      tapOn(1_000);
      expect(chosen()).toEqual([500]);
      expect(remove.title).toBe('Delete the chosen note, E4 (Delete)');

      // A playback going is of the sketch before the change, so it is held.
      element<HTMLButtonElement>('roll-play').click();
      expect(runtime.takePlayer.playing).not.toBeNull();
      remove.click();
      expect(runtime.takePlayer.playing).toBeNull();
      expect(sketches.find(sketch?.id ?? '')?.noteCount).toBe(2);
      expect(view.rollScene?.notes.map((note) => note.fromMs)).toEqual([0, 1_000]);
      // Drawn again with its room after it.
      expect(view.rollScene?.bars.map((bar) => bar.atMs)).toEqual([0, 2_000, 4_000]);
      // The recording it was begun from is as it was played, and the list of
      // sketches says what this one now holds.
      expect(takes.find(kept?.id ?? '')?.events).toEqual(kept?.events);
      expect(element('sketches-list').textContent).toContain(`${sketch?.title ?? ''} · 2 notes`);
      expect(chosen()).toEqual([]);
      // Nothing is chosen once it has gone.
      expect(remove.dataset['idle']).toBe('true');
      expect(remove.title).toBe('Delete a note (Delete). Tap one to choose it.');
      expect(undo.dataset['idle']).toBeUndefined();
      expect(undo.title).toBe('Put back the last change (Ctrl+Z; again with Shift)');

      // The last one out, then the one before it, comes back.
      tapOn(0);
      remove.click();
      // Still in its bars, which begin where they began.
      expect(view.rollScene?.notes.map((note) => note.fromMs)).toEqual([1_000]);
      // The last one too: a sketch may be emptied, to be written again.
      tapOn(1_000);
      expect(remove.dataset['idle']).toBeUndefined();
      remove.click();
      expect(sketches.find(sketch?.id ?? '')?.noteCount).toBe(0);
      expect(view.rollScene?.notes).toEqual([]);
      undo.click();
      expect(sketches.find(sketch?.id ?? '')?.noteCount).toBe(1);
      undo.click();
      expect(view.rollScene?.notes.map((note) => note.fromMs)).toEqual([0, 1_000]);
      undo.click();
      expect(sketches.find(sketch?.id ?? '')?.events).toEqual(kept?.events);
      expect(view.rollScene?.notes.map((note) => note.fromMs)).toEqual([0, 500, 1_000]);
      expect(undo.dataset['idle']).toBe('true');
      undo.click();
      expect(sketches.find(sketch?.id ?? '')?.noteCount).toBe(3);
      // Brought back one at a time by the button beside it, with no keyboard.
      expect(redo.dataset['idle']).toBeUndefined();
      expect(redo.title).toBe('Bring back the last change put back (Shift+Ctrl+Z)');
      redo.click();
      expect(sketches.find(sketch?.id ?? '')?.noteCount).toBe(2);
      // With what was chosen when it was put back.
      expect(chosen()).toEqual([0]);
      redo.click();
      expect(sketches.find(sketch?.id ?? '')?.noteCount).toBe(1);
      undo.click();
      undo.click();
      expect(sketches.find(sketch?.id ?? '')?.events).toEqual(kept?.events);
      // As it was before the first was taken out, that one chosen again.
      expect(chosen()).toEqual([500]);

      // The chosen one tapped again is let go of.
      tapOn(500);
      expect(chosen()).toEqual([]);
      // Two taps where there is no note write one: on the key of its row, in
      // the cell of the grid tapped in, a beat long, as loud as the flag over
      // it says - none marked, mezzo-forte - following it, and chosen.
      const onTheRowOf = view.rollScene?.notes.find((note) => note.fromMs === 500)?.row ?? 0;
      tapTheDrawing({ clientX: 1.4 * zoom, clientY: (onTheRowOf + 0.5) * 13 - scrolledDown() });
      expect(sketches.find(sketch?.id ?? '')?.noteCount).toBe(3);
      tapTheDrawing({ clientX: 1.4 * zoom, clientY: (onTheRowOf + 0.5) * 13 - scrolledDown() });
      const written = (sketches.find(sketch?.id ?? '')?.events ?? []).filter(
        (event) => (event.kind === 'noteOn' || event.kind === 'noteOff') && event.midi === 64 && event.atMs >= 1_000,
      );
      expect(written).toEqual([
        { kind: 'noteOn', atMs: 1_000, midi: 64, velocity: DYNAMIC_VELOCITY.mf, loudness: { level: null, shade: 0 } },
        { kind: 'noteOff', atMs: 1_500, midi: 64 },
      ]);
      expect(chosen()).toEqual([1_000]);
      // Something else done, there is nothing to bring back.
      expect(redo.dataset['idle']).toBe('true');
      undo.click();
      expect(sketches.find(sketch?.id ?? '')?.noteCount).toBe(3);
      // Below the lowest key there is nothing to write.
      tapTheDrawing({ clientX: 1.4 * zoom, clientY: 88.5 * 13 - scrolledDown() });
      tapTheDrawing({ clientX: 1.4 * zoom, clientY: 88.5 * 13 - scrolledDown() });
      expect(sketches.find(sketch?.id ?? '')?.noteCount).toBe(3);
      // And listening lets go of what was chosen, and of the keys nobody
      // played; the trash and the undo keep their places, out of sight, and a
      // tap puts the marker on the nearest beat.
      tapOn(500);
      edit.click();
      expect(edit.getAttribute('aria-pressed')).toBe('false');
      expect(edit.title).toBe('Edit the notes: a tap chooses one, a drag moves it');
      expect(chosen()).toEqual([]);
      expect(view.rollScene?.highest).toBe(highest);
      expect(scrolledDown()).toBe(0);
      expect([remove.dataset['away'], undo.dataset['away']]).toEqual(['true', 'true']);
      tapOn(1_000);
      expect(chosen()).toEqual([]);
      expect(headAt(element('roll-body'))).toBe('1.000');
      // Nor is a note taken hold of: a finger on one moves the drawing.
      const onIt = { clientX: (1.1 * zoom), clientY: ((view.rollScene?.notes.find((note) => note.fromMs === 1_000)?.row ?? 0) + 0.5) * 13 };
      for (const [type, along] of [['pointerdown', 0], ['pointermove', 0.3 * zoom], ['pointerup', 0.3 * zoom]] as const) {
        element('roll-body').dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId: 4, pointerType: 'mouse', clientX: onIt.clientX + along, clientY: onIt.clientY }),
        );
      }
      expect(sketches.find(sketch?.id ?? '')?.events).toEqual(kept?.events);
      expect(chosen()).toEqual([]);
    });

    // The metres offered for a sketch, simple and compound.
    const SKETCH_METRE_CHOICES = ['2/4', '3/4', '4/4', '5/4', '6/4', '2/2', '3/2', '3/8', '5/8', '6/8', '7/8', '9/8', '12/8'];

    it('begins a sketch of the score open, in its own bars, and leaves the score as it is written', async () => {
      const { view, runtime, sketches, files } = createRig();
      await view.initialize();
      await runtime.controller.openScore(compoundBarExercise({ title: 'In six', key: KeySignature.minor(-2) }));
      const written = runtime.controller.openedExercise;
      element<HTMLButtonElement>('focus-roll').click();
      const edit = element<HTMLButtonElement>('roll-edit');
      expect(edit.dataset['idle']).toBeUndefined();
      expect(edit.title).toBe('Begin a sketch of this score to edit; the score stays as it is written');

      edit.click();

      const sketch = sketches.list()[0];
      expect(sketch?.title).toBe('Sketch of In six');
      // In the score's key, which the editor shows and changes.
      expect(sketch?.key).toEqual({ fifths: written?.key.fifths, mode: written?.key.mode });
      // G minor: its tonic among the twelve, and its scale.
      expect(element<HTMLSelectElement>('roll-key').value).toBe('7');
      expect(element<HTMLSelectElement>('roll-scale').value).toBe('minor');
      expect(element<HTMLSelectElement>('roll-key').options).toHaveLength(12);
      element<HTMLSelectElement>('roll-key').value = '0';
      element<HTMLSelectElement>('roll-key').dispatchEvent(new Event('change'));
      expect(sketches.find(sketch?.id ?? '')?.key).toEqual({ fifths: -3, mode: 'minor' });
      expect(sketch?.noteCount).toBe(7);
      expect(sketch?.beats.map((beat) => beat.beatType)).toEqual([8, 8, 8, 8, 8, 8]);
      // In the score's metre, which the editor shows and changes: the notes
      // stay, the bars are counted afresh, and the drawing is in them.
      const metre = element<HTMLSelectElement>('roll-metre');
      expect(metre.value).toBe('6/8');
      expect([...metre.options].map((option) => option.value)).toEqual([...SKETCH_METRE_CHOICES]);
      const quavers = sketch?.beats.map((beat) => beat.atMs) ?? [];
      metre.value = '3/4';
      metre.dispatchEvent(new Event('change'));
      const counted = sketches.find(sketch?.id ?? '');
      expect(counted?.events).toEqual(sketch?.events);
      expect(counted?.beats.map((beat) => [beat.atMs, beat.beat, beat.beatsInBar, beat.beatType])).toEqual(
        // The last of the score's notes is let go of a quaver after its bar, so the click runs on to a beat there.
        [0, 2, 4, 6].map((quaver, at) => [quavers[quaver] ?? 3_000, at % 3, 3, 4]),
      );
      const barsDrawn = (): (string | number)[][] => view.rollScene?.bars.map((bar) => [bar.name, bar.atMs]) ?? [];
      expect(barsDrawn().slice(0, 3)).toEqual([
        ['1', 0],
        ['2', 3_000],
        ['3', 6_000],
      ]);
      metre.value = '2/4';
      metre.dispatchEvent(new Event('change'));
      expect(barsDrawn().slice(0, 3)).toEqual([
        ['1', 0],
        ['2', 2_000],
        ['3', 4_000],
      ]);
      expect(element('roll-title').textContent).toBe('Sketch of In six');
      expect(edit.getAttribute('aria-pressed')).toBe('true');
      expect(runtime.controller.openedExercise).toBe(written);

      // And saved in its key.
      element<HTMLButtonElement>('roll-close').click();
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Save this sketch as a MIDI file').click();
      const saved = readMidiFile(files.saved[0]?.bytes ?? new Uint8Array());
      expect([saved.fifths, saved.minor]).toEqual([-3, true]);
      // And in the metre it was last counted in.
      expect([saved.beats, saved.beatType]).toEqual([2, 4]);
    });

    it('sets the pace of a sketch, its notes keeping their beats, and puts a pace or a metre back as one change', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const played: MidiFileEvent[] = [
        { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5 },
        { kind: 'noteOff', atMs: 400, midi: 60 },
        { kind: 'noteOn', atMs: 500, midi: 64, velocity: 0.5 },
        { kind: 'noteOff', atMs: 900, midi: 64 },
      ];
      const sketch = sketches.begin(
        { events: played, beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })) },
        'At 120',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const scrolledDown = (): number =>
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const tapOn = (fromMs: number): void => {
        const note = view.rollScene?.notes.find((each) => each.fromMs === fromMs);
        tapTheDrawing({ clientX: ((fromMs + 100) / 1000) * zoom, clientY: ((note?.row ?? 0) + 0.5) * 13 - scrolledDown(), shiftKey: true });
      };
      const chosen = (): number[] =>
        (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => note.fromMs);
      const tempo = element<HTMLInputElement>('roll-tempo');
      const set = (value: string): void => {
        tempo.value = value;
        tempo.dispatchEvent(new Event('change'));
      };
      const struck = (): number[] =>
        (sketches.find(sketch.id)?.events ?? []).filter((event) => event.kind === 'noteOn').map((event) => event.atMs);
      expect(tempo.value).toBe('120');

      // The E chosen, and the sketch at half the pace: twice as far apart, the E still chosen.
      tapOn(500);
      expect(chosen()).toEqual([500]);
      set('60');
      expect(struck()).toEqual([0, 1_000]);
      expect(chosen()).toEqual([1_000]);
      expect(sketches.find(sketch.id)?.beats.slice(0, 2).map((beat) => beat.atMs)).toEqual([0, 1_000]);
      expect(tempo.value).toBe('60');

      // Out of the metronome's range, it is the nearest end of it; not a number, nothing.
      set('1000');
      expect(tempo.value).toBe('400');
      expect(struck()).toEqual([0, 150]);
      set('');
      expect(tempo.value).toBe('400');
      expect(struck()).toEqual([0, 150]);

      // Each put back as one change, the beats with the notes.
      element<HTMLButtonElement>('roll-undo').click();
      expect(struck()).toEqual([0, 1_000]);
      expect(tempo.value).toBe('60');
      element<HTMLButtonElement>('roll-undo').click();
      expect(struck()).toEqual([0, 500]);
      expect(tempo.value).toBe('120');

      // And a metre the same way.
      const metre = element<HTMLSelectElement>('roll-metre');
      metre.value = '3/4';
      metre.dispatchEvent(new Event('change'));
      expect(sketches.find(sketch.id)?.beats[0]?.beatsInBar).toBe(3);
      element<HTMLButtonElement>('roll-undo').click();
      expect(sketches.find(sketch.id)?.beats[0]?.beatsInBar).toBe(4);
      expect(metre.value).toBe('4/4');
    });

    it('names a sketch by the day it was begun, without the time, so the name fits on a phone', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        // A day and a month of one figure each, at a minute to midnight.
        vi.setSystemTime(new Date(2026, 8, 3, 23, 59, 30));
        const { view, sketches } = createRig();
        await view.initialize();
        element<HTMLButtonElement>('focus-scores').click();
        element<HTMLButtonElement>('scores-show-sketches').click();
        element<HTMLButtonElement>('sketches-new').click();

        expect(sketches.list()[0]?.title).toBe('Sketch, 03.09.2026');
      } finally {
        vi.useRealTimers();
      }
    });

    it('renames a sketch where its name is written, keeping it on Enter or a tap elsewhere and not on Escape', async () => {
      const { view, sketches, files, midi, clock } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5 },
            { kind: 'noteOff', atMs: 400, midi: 60 },
          ],
          beats: [],
        },
        'Sketch, 14.10.2026',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const title = element('roll-title');
      const field = element<HTMLInputElement>('roll-rename');
      const write = (name: string, key: string): void => {
        title.click();
        field.value = name;
        field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      };
      expect(title.dataset['renamable']).toBe('true');
      expect(title.title).toBe('Rename this sketch');
      expect(field.hidden).toBe(true);

      // A tap on the name puts the field in its place, the name in it to write over.
      title.click();
      expect([title.hidden, field.hidden]).toEqual([true, false]);
      expect(field.value).toBe('Sketch, 14.10.2026');
      expect(document.activeElement).toBe(field);
      field.value = '  Waltz in A  ';
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      expect([title.hidden, field.hidden]).toEqual([false, true]);
      expect(title.textContent).toBe('Waltz in A');
      expect(sketches.find(sketch.id)?.title).toBe('Waltz in A');
      expect(sketches.find(sketch.id)?.events).toHaveLength(2);

      // Opened again, the new name is the one to write over.
      title.click();
      expect(field.value).toBe('Waltz in A');
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

      // Escape leaves the name as it was, and the viewer open.
      write('Not this', 'Escape');
      expect(title.textContent).toBe('Waltz in A');
      expect(sketches.find(sketch.id)?.title).toBe('Waltz in A');
      expect(element('sheet-roll').hidden).toBe(false);
      // A name of nothing is no name.
      write('   ', 'Enter');
      expect(sketches.find(sketch.id)?.title).toBe('Waltz in A');
      // A tap elsewhere keeps what was written.
      title.click();
      field.value = 'Waltz';
      field.dispatchEvent(new FocusEvent('blur'));
      expect(sketches.find(sketch.id)?.title).toBe('Waltz');
      // The keys typed into it are letters, not the editor's.
      title.click();
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
      expect(sketches.find(sketch.id)?.events).toHaveLength(2);
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

      // The list and the file go by the new name.
      element<HTMLButtonElement>('roll-close').click();
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      expect(element('sketches-list').textContent).toContain('Waltz');
      rowButton('sketches-list', 'Save this sketch as a MIDI file').click();
      expect(files.saved.at(-1)?.fileName).toBe('Waltz.mid');
      element<HTMLButtonElement>('scores-close').click();

      // A recording is not renamed: it is what was played.
      midi.noteOn(60, clock.now());
      clock.advance(300);
      midi.noteOff(60, clock.now());
      element<HTMLButtonElement>('focus-keep').click();
      rowButton('takes-list', 'Look at this take').click();
      expect(title.dataset['renamable']).toBeUndefined();
      expect(title.hasAttribute('title')).toBe(false);
      title.click();
      expect(field.hidden).toBe(true);
    });

    it('writes a sketch on the page without keeping a copy, looks at it as the sketch, and writes it again when it changes', async () => {
      const { view, runtime, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [0, 500, 1_000, 1_500].flatMap((atMs, at) => [
            { kind: 'noteOn' as const, atMs, midi: 60 + at, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: atMs + 400, midi: 60 + at },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Waltz',
        1,
      );
      const kept = runtime.scores.list().length;
      const pencil = element<HTMLButtonElement>('focus-sketch');
      expect(pencil.hidden).toBe(true);
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Write this sketch down as a score').click();
      await waitFor(() => runtime.controller.openedExercise?.title === 'Waltz');
      const written = runtime.controller.openedExercise;
      expect(written?.tempoBpm).toBe(120);
      expect(runtime.scores.list()).toHaveLength(kept);

      // A pencil beside the pills, named, opens the sketch to be edited.
      expect(pencil.hidden).toBe(false);
      expect([pencil.title, pencil.getAttribute('aria-label')]).toEqual(['Edit this sketch', 'Edit this sketch']);
      pencil.click();
      expect(element('roll-title').textContent).toBe('Waltz');
      expect(element('roll-edit').getAttribute('aria-pressed')).toBe('true');
      element<HTMLButtonElement>('roll-close').click();

      // The viewer of the page is the sketch too, being edited.
      element<HTMLButtonElement>('focus-roll').click();
      expect(element('roll-title').textContent).toBe('Waltz');
      expect(element('roll-edit').getAttribute('aria-pressed')).toBe('true');
      expect(element('roll-velocity').hidden).toBe(false);
      // Where it begins - its key, metre and pace - is in the options, set
      // once, and not in the row of what is pressed while editing; listened
      // to, it is not there at all.
      const start = element('roll-sketch-start');
      expect(start.hidden).toBe(false);
      expect(start.closest('#sheet-roll-options')).not.toBeNull();
      for (const id of ['roll-key', 'roll-scale', 'roll-metre', 'roll-tempo']) {
        expect(start.contains(element(id)), id).toBe(true);
        expect(element('roll-velocity').contains(element(id)), id).toBe(false);
      }
      element<HTMLButtonElement>('roll-edit').click();
      expect(start.hidden).toBe(true);
      element<HTMLButtonElement>('roll-edit').click();
      expect(start.hidden).toBe(false);

      // Shut unchanged, the page stays as it was written.
      element<HTMLButtonElement>('roll-close').click();
      await Promise.resolve();
      expect(runtime.controller.openedExercise).toBe(written);

      // Changed, the page is written again from it.
      element<HTMLButtonElement>('focus-roll').click();
      const tempo = element<HTMLInputElement>('roll-tempo');
      tempo.value = '90';
      tempo.dispatchEvent(new Event('change'));
      element<HTMLButtonElement>('roll-close').click();
      await waitFor(() => runtime.controller.openedExercise !== written);
      expect(runtime.controller.openedExercise?.tempoBpm).toBe(90);
      expect(runtime.scores.list()).toHaveLength(kept);
      expect(pencil.hidden).toBe(false);
      // And looked at again, it is still the sketch.
      element<HTMLButtonElement>('focus-roll').click();
      expect(element('roll-title').textContent).toBe('Waltz');
      element<HTMLButtonElement>('roll-close').click();

      // Another score on the page is looked at as itself, and has no pencil.
      await runtime.controller.openScore(compoundBarExercise({ title: 'In six' }));
      expect(pencil.hidden).toBe(true);
      element<HTMLButtonElement>('focus-roll').click();
      expect(element('roll-title').textContent).toBe('In six');
      element<HTMLButtonElement>('roll-close').click();

      // And a page whose sketch was deleted is looked at as the score it is.
      rowButton('sketches-list', 'Write this sketch down as a score').click();
      await waitFor(() => runtime.controller.openedExercise?.title === 'Waltz');
      expect(pencil.hidden).toBe(false);
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Delete this sketch').click();
      await confirmByTyping();
      expect(sketches.find(sketch.id)).toBeNull();
      expect(pencil.hidden).toBe(true);
      element<HTMLButtonElement>('scores-close').click();
      element<HTMLButtonElement>('focus-roll').click();
      expect(element('sheet-roll').hidden).toBe(false);
      expect(element('roll-title').textContent).toBe('Waltz');
      expect(element('roll-edit').getAttribute('aria-pressed')).toBe('false');
      expect(element('roll-edit').title).toBe('Begin a sketch of this score to edit; the score stays as it is written');
    });

    it('chooses one note by a click, more by Ctrl, Cmd or Shift and a click, or by a box the mouse draws with the selection tool', async () => {
      // The notes laid out as a page lays them out, which jsdom does not: the
      // box is kept to where they are.
      const rectOf = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
        return this.classList.contains('roll__grid') ? new DOMRect(0, 0, 4_000, 3_000) : rectOf.call(this);
      };
      onTestFinished(() => {
        HTMLElement.prototype.getBoundingClientRect = rectOf;
      });
      const { view, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 60],
            [500, 62],
            [1_000, 64],
          ].flatMap(([atMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: atMs + 400, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Three',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const scrolledDown = (): number =>
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const highest = view.rollScene?.highest ?? 0;
      const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - midi + 0.5) * 13 - scrolledDown(),
      });
      const chosen = (): number[] =>
        (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => note.fromMs);
      const notes = (): number => sketches.find(sketch.id)?.noteCount ?? -1;
      const mouse = (ms: number, midi: number, keys: PointerEventInit = {}): void => {
        tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(ms, midi), ...keys });
      };
      const body = element('roll-body');
      const box = element('roll-box');
      const drag = (from: [number, number], to: [number, number], keys: PointerEventInit = {}, ending = 'pointerup'): void => {
        const init = { bubbles: true, pointerId: 41, pointerType: 'mouse', button: 0, ...keys };
        body.dispatchEvent(new PointerEvent('pointerdown', { ...init, ...at(...from) }));
        body.dispatchEvent(new PointerEvent('pointermove', { ...init, ...at(...to) }));
        expect(box.hidden).toBe(false);
        body.dispatchEvent(new PointerEvent(ending, { ...init, ...at(...to) }));
        expect(box.hidden).toBe(true);
        if (ending === 'pointerup') {
          body.dispatchEvent(new MouseEvent('click', { bubbles: true, ...keys, ...at(...to) }));
        }
      };

      // A click chooses that note alone.
      mouse(600, 62);
      expect(chosen()).toEqual([500]);
      mouse(1_100, 64);
      expect(chosen()).toEqual([1_000]);
      // With Ctrl, Shift or Cmd it adds the note, or takes it out.
      mouse(100, 60, { ctrlKey: true });
      expect(chosen()).toEqual([0, 1_000]);
      mouse(100, 60, { shiftKey: true });
      expect(chosen()).toEqual([1_000]);
      mouse(600, 62, { metaKey: true });
      expect(chosen()).toEqual([500, 1_000]);
      // And with one held, a click where there is no note writes none.
      mouse(1_800, 60, { ctrlKey: true });
      expect(notes()).toBe(3);

      // With the pencil, the mouse drawn from empty space moves the drawing, as
      // over any editor's - here towards its start, where it is already.
      const panning = { bubbles: true, pointerId: 45, pointerType: 'mouse', button: 0 };
      body.dispatchEvent(new PointerEvent('pointerdown', { ...panning, ...at(50, 70) }));
      body.dispatchEvent(new PointerEvent('pointermove', { ...panning, ...at(950, 70) }));
      expect(box.hidden).toBe(true);
      body.dispatchEvent(new PointerEvent('pointerup', { ...panning, ...at(950, 70) }));
      expect(chosen()).toEqual([500, 1_000]);

      // With the selection tool, a box from empty space, drawn as it goes,
      // chooses what it touches alone, and the click it ends with writes nothing.
      element<HTMLButtonElement>('roll-select').click();
      drag([950, 60], [50, 62]);
      expect(chosen()).toEqual([0, 500]);
      expect(notes()).toBe(3);
      // With Ctrl held, what it touches is added.
      drag([1_450, 64], [950, 64], { ctrlKey: true });
      expect(chosen()).toEqual([0, 500, 1_000]);
      // Taken off the page, it chooses nothing.
      drag([950, 60], [50, 60], {}, 'pointercancel');
      expect(chosen()).toEqual([0, 500, 1_000]);
      // Dragged past the notes, it stops at their edge: there is nothing past it to choose.
      const grid = body.querySelector<HTMLElement>('.roll__grid');
      if (grid !== null) {
        grid.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
      }
      const from = at(950, 60);
      const init = { bubbles: true, pointerId: 43, pointerType: 'mouse', button: 0 };
      body.dispatchEvent(new PointerEvent('pointerdown', { ...init, ...from }));
      body.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: 5_000, clientY: 5_000 }));
      expect([box.style.width, box.style.height]).toEqual([`${String(400 - from.clientX)}px`, `${String(300 - from.clientY)}px`]);
      body.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: -5_000, clientY: -5_000 }));
      expect([box.style.left, box.style.top, box.style.width]).toEqual(['0px', '0px', `${String(from.clientX)}px`]);
      body.dispatchEvent(new PointerEvent('pointercancel', { ...init, clientX: -5_000, clientY: -5_000 }));
      // And begun under them, on the pedal, it begins at their edge.
      body.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: 100, clientY: 310 }));
      body.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: 150, clientY: 250 }));
      expect([box.style.top, box.style.height]).toEqual(['250px', '50px']);
      body.dispatchEvent(new PointerEvent('pointercancel', { ...init, clientX: 150, clientY: 250 }));

      // A finger's tap chooses the note alone, as a click does.
      tapTheDrawing({ pointerType: 'touch', ...at(100, 60) });
      expect(chosen()).toEqual([0]);
      // A click on empty space puts the marker and lets go of the choice; two write a note.
      mouse(1_800, 60);
      expect(notes()).toBe(3);
      expect(chosen()).toEqual([]);
      mouse(1_800, 60);
      expect(notes()).toBe(4);
      const before = chosen();

      // Back to the pencil for the rest.
      element<HTMLButtonElement>('roll-select').click();

      // A finger drawn over empty space moves the drawing, as it always has,
      // and a mouse drawn along the ruler draws no box either.
      for (const [pointerType, from, to] of [
        ['touch', at(2_500, 70), at(2_300, 72)],
        ['mouse', { clientX: 50, clientY: 5 }, { clientX: 150, clientY: 5 }],
      ] as const) {
        const on = pointerType === 'mouse' ? (body.querySelector('.roll__ruler') ?? body) : body;
        const init = { bubbles: true, pointerId: 42, pointerType, button: 0 };
        on.dispatchEvent(new PointerEvent('pointerdown', { ...init, ...from }));
        on.dispatchEvent(new PointerEvent('pointermove', { ...init, ...to }));
        expect(box.hidden, pointerType).toBe(true);
        on.dispatchEvent(new PointerEvent('pointerup', { ...init, ...to }));
      }
      expect(chosen()).toEqual(before);
      expect(notes()).toBe(4);

      // Listening, the mouse chooses nothing: it puts the marker.
      element<HTMLButtonElement>('roll-edit').click();
      const listening = { bubbles: true, pointerId: 44, pointerType: 'mouse', button: 0 };
      body.dispatchEvent(new PointerEvent('pointerdown', { ...listening, ...at(950, 70) }));
      body.dispatchEvent(new PointerEvent('pointermove', { ...listening, ...at(50, 72) }));
      expect(box.hidden).toBe(true);
      body.dispatchEvent(new PointerEvent('pointerup', { ...listening, ...at(50, 72) }));
    });

    it('chooses notes on a recording to copy, by a box, Ctrl+A and Escape, and pastes them into a sketch', async () => {
      const rectOf = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
        return this.classList.contains('roll__grid') ? new DOMRect(0, 0, 4_000, 3_000) : rectOf.call(this);
      };
      onTestFinished(() => {
        HTMLElement.prototype.getBoundingClientRect = rectOf;
        Reflect.deleteProperty(window.navigator, 'clipboard');
      });
      const { view, sketches, takes, midi, clock } = createRig();
      await view.initialize();
      const written: string[] = [];
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string): Promise<void> => {
            written.push(text);
            return Promise.resolve();
          },
        },
      });
      // C, E and G, half a second apart, played freely and kept.
      clock.advance(10_000);
      for (const pitch of [60, 64, 67]) {
        midi.noteOn(pitch, clock.now());
        clock.advance(300);
        midi.noteOff(pitch, clock.now());
        clock.advance(200);
      }
      element<HTMLButtonElement>('focus-keep').click();
      expect(takes.list()[0]?.noteCount).toBe(3);
      rowButton('takes-list', 'Look at this take').click();

      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const scene = (): NonNullable<typeof view.rollScene> | null => view.rollScene;
      const began = (): number => Math.min(...(scene()?.notes ?? []).map((note) => note.fromMs));
      const scrolledDown = (): number =>
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (afterTheFirstMs: number, pitch: number): { clientX: number; clientY: number } => ({
        clientX: ((began() + afterTheFirstMs) / 1000) * zoom,
        clientY: ((scene()?.highest ?? 0) - pitch + 0.5) * 13 - scrolledDown(),
      });
      const chosen = (): number[] =>
        (scene()?.notes ?? [])
          .filter((note) => note.chosen === true)
          .map((note) => (scene()?.highest ?? 0) - note.row)
          .sort((low, high) => low - high);
      const body = element('roll-body');
      const select = element<HTMLButtonElement>('roll-select');
      const copy = element<HTMLButtonElement>('roll-copy-chosen');
      const chord = element<HTMLOutputElement>('roll-chord');
      const drag = (pointerType: string, from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }, more = {}): void => {
        const pointer = { bubbles: true, pointerId: 61, pointerType, button: 0, ...more };
        body.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, ...from }));
        body.dispatchEvent(new PointerEvent('pointermove', { ...pointer, ...to }));
        body.dispatchEvent(new PointerEvent('pointerup', { ...pointer, ...to }));
        body.dispatchEvent(new MouseEvent('click', { bubbles: true, ...to }));
      };
      const key = (init: KeyboardEventInit): KeyboardEvent => {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        document.body.dispatchEvent(event);
        return event;
      };

      // The box and the copy are there on a recording, the copy waiting for notes.
      expect([select.hidden, select.dataset['away']]).toEqual([false, undefined]);
      expect(select.getAttribute('aria-pressed')).toBe('false');
      expect(copy.hidden).toBe(false);
      expect(copy.dataset['idle']).toBe('true');
      expect(copy.title).toContain('Choose some first');
      expect(chosen()).toEqual([]);

      // Without the box asked for, a mouse's drag from empty space chooses nothing.
      drag('mouse', at(-100, 69), at(700, 59));
      expect(chosen()).toEqual([]);
      expect(element('roll-box').hidden).toBe(true);
      // Asked for, it draws one: the C and the E inside it.
      select.click();
      expect(select.getAttribute('aria-pressed')).toBe('true');
      drag('mouse', at(-100, 69), at(700, 59));
      expect(chosen()).toEqual([60, 64]);
      expect(copy.dataset['idle']).toBeUndefined();
      // With Shift, the G added; and the three are named.
      drag('mouse', at(900, 69), at(1_400, 66), { shiftKey: true });
      expect(chosen()).toEqual([60, 64, 67]);
      expect(chord.hidden ? null : chord.textContent).toBe('C');
      // Escape lets go of them, and the sheet stays.
      key({ key: 'Escape' });
      expect(chosen()).toEqual([]);
      expect(element('sheet-roll').hidden).toBe(false);
      expect(chord.hidden).toBe(true);

      // A finger draws one as well while it is asked for, and moves the drawing once it is not.
      drag('touch', at(-100, 69), at(700, 59));
      expect(chosen()).toEqual([60, 64]);
      select.click();
      expect(select.getAttribute('aria-pressed')).toBe('false');
      key({ key: 'Escape' });
      drag('touch', at(-100, 69), at(700, 59));
      expect(chosen()).toEqual([]);

      // Ctrl+A chooses every note, and Ctrl+C - or the button - copies them.
      expect(key({ key: 'a', code: 'KeyA', ctrlKey: true }).defaultPrevented).toBe(true);
      expect(chosen()).toEqual([60, 64, 67]);
      expect(key({ key: 'c', code: 'KeyC', ctrlKey: true }).defaultPrevented).toBe(true);
      copy.click();
      const copied = written.map((text) => theNotesOnTheClipboard(text)?.map(({ afterMs, lengthMs, midi: pitch }) => [afterMs, lengthMs, pitch]));
      expect(copied).toEqual([
        [
          [0, 300, 60],
          [500, 300, 64],
          [1_000, 300, 67],
        ],
        [
          [0, 300, 60],
          [500, 300, 64],
          [1_000, 300, 67],
        ],
      ]);
      // Nothing on the recording is changed by any of it.
      expect(takes.list()[0]?.noteCount).toBe(3);
      // Shown again, it is a drawing anew, with nothing chosen.
      element<HTMLButtonElement>('roll-close').click();
      rowButton('takes-list', 'Look at this take').click();
      expect(chosen()).toEqual([]);
      element<HTMLButtonElement>('roll-close').click();

      // Pasted into a sketch from its drawer, where the cursor is.
      Reflect.deleteProperty(window.navigator, 'clipboard');
      const sketch = sketches.begin(
        { events: [], beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })) },
        'Into',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      // On a sketch, the copy is its drawer's.
      expect(copy.hidden).toBe(true);
      element<HTMLButtonElement>('roll-chords-open').click();
      element<HTMLButtonElement>('roll-paste').click();
      await Promise.resolve();
      await Promise.resolve();
      expect(sketches.find(sketch.id)?.noteCount).toBe(3);
    });

    it('chooses notes with a finger by the selection tool: a box drawn from empty space, and a tap on nothing choosing nothing', async () => {
      const rectOf = HTMLElement.prototype.getBoundingClientRect;
      HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
        return this.classList.contains('roll__grid') ? new DOMRect(0, 0, 4_000, 3_000) : rectOf.call(this);
      };
      onTestFinished(() => {
        HTMLElement.prototype.getBoundingClientRect = rectOf;
      });
      const { view, sketches, clock } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 60],
            [500, 62],
            [1_000, 64],
          ].flatMap(([atMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: atMs + 400, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Three',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown = (): number =>
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - midi + 0.5) * 13 - scrolledDown(),
      });
      const chosen = (): number[] =>
        (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => note.fromMs);
      const notes = (): number => sketches.find(sketch.id)?.noteCount ?? -1;
      const body = element('roll-body');
      const box = element('roll-box');
      const select = element<HTMLButtonElement>('roll-select');
      const finger = (type: string, where: { clientX: number; clientY: number }): void => {
        body.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 51, pointerType: 'touch', ...where }));
      };

      // There while the sketch is edited, with its name, and off.
      expect([select.hidden, select.dataset['away']]).toEqual([false, undefined]);
      expect(select.getAttribute('aria-pressed')).toBe('false');
      expect(select.title).toBe('Choose notes by drawing a box around them');
      expect(select.getAttribute('aria-label')).toBe(select.title);
      // With the pencil, a finger over empty space moves the drawing - here
      // towards its start, where it already is, so it stays put for the rest.
      finger('pointerdown', at(50, 70));
      finger('pointermove', at(950, 70));
      expect(box.hidden).toBe(true);
      finger('pointerup', at(950, 70));
      expect(chosen()).toEqual([]);

      // With the selection tool it draws a box, and chooses what it touches.
      select.click();
      expect(select.getAttribute('aria-pressed')).toBe('true');
      const down = scrolledDown();
      finger('pointerdown', at(950, 60));
      finger('pointermove', at(50, 62));
      expect(box.hidden).toBe(false);
      finger('pointerup', at(50, 62));
      body.dispatchEvent(new MouseEvent('click', { bubbles: true, ...at(50, 62) }));
      expect(chosen()).toEqual([0, 500]);
      expect(scrolledDown()).toBe(down);
      expect(notes()).toBe(3);
      // A tap on nothing chooses nothing, and writes no note.
      tapTheDrawing({ pointerType: 'touch', ...at(1_800, 60) });
      expect(chosen()).toEqual([]);
      expect(notes()).toBe(3);
      clock.advance(1_000);
      // A tap on a note still chooses it.
      tapTheDrawing({ pointerType: 'touch', ...at(1_100, 64) });
      expect(chosen()).toEqual([1_000]);

      // The tool is kept while listening, and its button goes away with the others.
      element<HTMLButtonElement>('roll-edit').click();
      expect(select.dataset['away']).toBe('true');
      element<HTMLButtonElement>('roll-edit').click();
      expect(select.getAttribute('aria-pressed')).toBe('true');
      // Either tool, two taps on nothing write a note.
      tapTheDrawing({ pointerType: 'touch', ...at(1_800, 60) });
      tapTheDrawing({ pointerType: 'touch', ...at(1_800, 60) });
      expect(notes()).toBe(4);
      select.click();
      expect(select.getAttribute('aria-pressed')).toBe('false');
      tapTheDrawing({ pointerType: 'touch', ...at(3_100, 67) });
      tapTheDrawing({ pointerType: 'touch', ...at(3_100, 67) });
      expect(notes()).toBe(5);
    });

    it('makes a pinch of a second finger, whatever the first held, and forgets a finger never heard lifted', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 60],
            [500, 62],
            [1_000, 64],
          ].flatMap(([atMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: atMs + 400, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Pinched',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoomInput = element<HTMLInputElement>('roll-zoom');
      const zoom = Number(zoomInput.value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown = (): number =>
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - midi + 0.5) * 13 - scrolledDown(),
      });
      const body = element('roll-body');
      const box = element('roll-box');
      const touch = (type: string, pointerId: number, where: { clientX: number; clientY: number }, isPrimary = false): void => {
        body.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, pointerType: 'touch', isPrimary, ...where }));
      };
      const aside = (where: { clientX: number; clientY: number }, px: number) => ({ ...where, clientX: where.clientX + px });
      const zoomedBack = (): void => {
        zoomInput.value = String(zoom);
        zoomInput.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const firstPitch = (): number | undefined =>
        sketches
          .find(sketch.id)
          ?.events.find((event): event is Extract<MidiFileEvent, { kind: 'noteOn' }> => event.kind === 'noteOn' && event.atMs === 0)?.midi;
      const chosen = (): number[] =>
        (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => note.fromMs);

      // A finger moving the drawing, never heard lifted: the next first
      // finger moves it alone, and is no pinch.
      touch('pointerdown', 65, at(1_800, 70), true);
      touch('pointerdown', 66, at(1_800, 70), true);
      touch('pointermove', 66, aside(at(1_800, 70), 100));
      expect(zoomInput.value).toBe(String(zoom));
      touch('pointerup', 66, aside(at(1_800, 70), 100));
      // A finger holding a note, never heard lifted: the next first finger
      // takes hold of a note of its own.
      touch('pointerdown', 67, at(1_100, 64), true);
      touch('pointerdown', 68, at(100, 60), true);
      touch('pointermove', 68, at(100, 57));
      touch('pointerup', 68, at(100, 57));
      expect(firstPitch()).toBe(57);

      // A note held and dragged is put back as it was, and the two fingers zoom.
      touch('pointerdown', 61, at(100, 57), true);
      touch('pointermove', 61, at(100, 55));
      touch('pointerdown', 62, aside(at(100, 55), 100));
      touch('pointermove', 62, aside(at(100, 55), 200));
      expect(zoomInput.value).toBe(String(zoom * 2));
      touch('pointerup', 62, aside(at(100, 55), 200));
      touch('pointerup', 61, at(100, 55));
      expect(firstPitch()).toBe(57);
      expect(sketches.find(sketch.id)?.noteCount).toBe(3);
      zoomedBack();

      // A box being drawn goes, choosing nothing, and the two fingers zoom.
      element<HTMLButtonElement>('roll-select').click();
      const chosenBefore = chosen();
      touch('pointerdown', 63, at(1_800, 60), true);
      touch('pointermove', 63, at(1_400, 63));
      expect(box.hidden).toBe(false);
      touch('pointerdown', 64, aside(at(1_400, 63), 100));
      expect(box.hidden).toBe(true);
      touch('pointermove', 64, aside(at(1_400, 63), 200));
      expect(zoomInput.value).toBe(String(zoom * 2));
      touch('pointerup', 64, aside(at(1_400, 63), 200));
      touch('pointerup', 63, at(1_400, 63));
      expect(chosen()).toEqual(chosenBefore);
      zoomedBack();
      element<HTMLButtonElement>('roll-select').click();

      // One of a pinch lifted and another put down: a pinch of the two down.
      touch('pointerdown', 73, at(1_800, 70), true);
      touch('pointerdown', 74, aside(at(1_800, 70), 100));
      touch('pointerup', 73, at(1_800, 70));
      touch('pointerdown', 75, aside(at(1_800, 70), 200));
      touch('pointermove', 75, aside(at(1_800, 70), 300));
      expect(zoomInput.value).toBe(String(zoom * 2));
      touch('pointerup', 75, aside(at(1_800, 70), 300));
      touch('pointerup', 74, aside(at(1_800, 70), 100));
      zoomedBack();
      // And a finger never heard lifted is not one of the next touch's pinch.
      touch('pointerdown', 76, at(1_800, 70), true);
      touch('pointerdown', 77, aside(at(1_800, 70), 100), true);
      touch('pointerdown', 78, aside(at(1_800, 70), 200));
      touch('pointermove', 78, aside(at(1_800, 70), 300));
      expect(zoomInput.value).toBe(String(zoom * 2));
    });

    it('makes a pinch of a second finger where the first was drawing the pedal, and draws none', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 60],
            [1_000, 64],
          ].flatMap(([atMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: atMs + 400, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Pinched on the pedal',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoomInput = element<HTMLInputElement>('roll-zoom');
      const zoom = Number(zoomInput.value);
      const along = (ms: number): number => (ms / 1000) * zoom;
      // Asked for each time, as the drawing is drawn again under the fingers.
      const onTheLane = (type: string, pointerId: number, clientX: number, isPrimary = false): void => {
        const lane = element('roll-body').querySelector('.roll__pedal') ?? element('roll-body');
        lane.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId, pointerType: 'touch', isPrimary, clientX, clientY: 0 }));
      };

      onTheLane('pointerdown', 69, along(100), true);
      onTheLane('pointermove', 69, along(1_100));
      onTheLane('pointerdown', 70, along(1_100) + 100);
      onTheLane('pointermove', 70, along(1_100) + 200);
      expect(zoomInput.value).toBe(String(zoom * 2));
      onTheLane('pointerup', 70, along(1_100) + 200);
      onTheLane('pointerup', 69, along(1_100));
      expect(sketches.find(sketch.id)?.events.some((event) => event.kind === 'sustain')).toBe(false);
    });

    it('sounds a note of a sketch while it is held, at each pitch it is dragged to, and one written for as long as it is', async () => {
      const { view, sketches, instrument, clock } = createRig();
      await view.initialize();
      sketches.begin(
        {
          events: [
            { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.25 },
            { kind: 'noteOff', atMs: 400, midi: 60 },
            { kind: 'noteOn', atMs: 500, midi: 64, velocity: 0.75 },
            { kind: 'noteOff', atMs: 900, midi: 64 },
          ],
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Two',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - midi + 0.5) * 13 - scrolledDown,
      });
      const press = (type: string, where: { clientX: number; clientY: number }): void => {
        element('roll-body').dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 61, pointerType: 'mouse', button: 0, ...where }));
      };
      const heard = (): (number | undefined)[][] => instrument.played.map((note) => [note.midi, note.velocity, note.atMs]);
      const ended = (): (number | undefined)[][] => instrument.stopped.map((note) => [note.midi, note.atMs]);

      // Held, it sounds as loud as it was struck, and goes on sounding.
      press('pointerdown', at(100, 60));
      expect(heard()).toEqual([[60, 0.25, undefined]]);
      expect(ended()).toEqual([]);
      // Dragged up a row, the new pitch; along its row, nothing new.
      press('pointermove', { clientX: at(100, 60).clientX, clientY: at(100, 61).clientY });
      expect(heard()).toEqual([
        [60, 0.25, undefined],
        [61, 0.25, undefined],
      ]);
      expect(ended()).toEqual([[60, undefined]]);
      press('pointermove', { clientX: at(300, 60).clientX, clientY: at(100, 61).clientY });
      expect(heard()).toHaveLength(2);
      // Let go of, silent.
      press('pointerup', { clientX: at(300, 60).clientX, clientY: at(100, 61).clientY });
      expect(ended()).toEqual([
        [60, undefined],
        [61, undefined],
      ]);

      // A tap on a note sounds it, and lets it go.
      instrument.played.length = 0;
      instrument.stopped.length = 0;
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(600, 64) });
      expect(heard()).toEqual([[64, 0.75, undefined]]);
      expect(ended()).toEqual([[64, undefined]]);
      // Taken away rather than let go of, silent too.
      press('pointerdown', at(600, 64));
      press('pointercancel', at(600, 64));
      expect(ended()).toEqual([
        [64, undefined],
        [64, undefined],
      ]);

      // A note written where there was none: heard now, as loud as the flag over it says, for the beat it is long.
      instrument.played.length = 0;
      instrument.stopped.length = 0;
      const now = clock.now();
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(1_600, 67) });
      expect(heard()).toEqual([]);
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(1_600, 67) });
      expect(heard()).toEqual([[67, DYNAMIC_VELOCITY.mf, now]]);
      expect(ended()).toEqual([[67, now + 500]]);

      // A drag over empty space sounds nothing.
      instrument.played.length = 0;
      press('pointerdown', at(2_500, 70));
      press('pointermove', at(2_000, 72));
      press('pointerup', at(2_000, 72));
      expect(heard()).toEqual([]);
    });

    it('strikes each pitch once among the chosen notes heard together, as hard as the hardest of it', async () => {
      const { view, sketches, instrument } = createRig();
      await view.initialize();
      sketches.begin(
        {
          events: [
            [0, 60, 0.5],
            [500, 64, 0.5],
            [1_000, 60, 0.75],
            [1_500, 60, 0.25],
          ].flatMap(([atMs = 0, midi = 0, velocity = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity },
            { kind: 'noteOff' as const, atMs: atMs + 400, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Twice',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - midi + 0.5) * 13 - scrolledDown,
      });
      const press = (type: string, where: { clientX: number; clientY: number }): void => {
        element('roll-body').dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 62, pointerType: 'mouse', button: 0, ...where }));
      };
      const inOrder = ([one = 0]: (number | undefined)[], [other = 0]: (number | undefined)[]): number => one - other;
      const heard = (): (number | undefined)[][] => instrument.played.map((note) => [note.midi, note.velocity]).sort(inOrder);
      const ended = (): (number | undefined)[][] => instrument.stopped.map((note) => [note.midi]).sort(inOrder);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a', code: 'KeyA', ctrlKey: true }));
      instrument.played.length = 0;

      // Held, the three Cs are one C, as hard as the hardest - neither the first nor the last.
      press('pointerdown', at(100, 60));
      expect(heard()).toEqual([
        [60, 0.75],
        [64, 0.5],
      ]);
      // Taken up a row, each pitch let go of once and struck once higher.
      press('pointermove', { clientX: at(100, 60).clientX, clientY: at(100, 61).clientY });
      expect(heard()).toEqual([
        [60, 0.75],
        [61, 0.75],
        [64, 0.5],
        [65, 0.5],
      ]);
      expect(ended()).toEqual([[60], [64]]);
      press('pointerup', { clientX: at(100, 60).clientX, clientY: at(100, 61).clientY });
      expect(ended()).toEqual([[60], [61], [64], [65]]);

      // Stepped up by an arrow, the same.
      instrument.played.length = 0;
      instrument.stopped.length = 0;
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowUp' }));
      expect(heard()).toEqual([
        [62, 0.75],
        [66, 0.5],
      ]);
      expect(ended()).toEqual([[62], [66]]);
    });

    it('lights a note as it is pressed, sounds every note a press would move, and takes a note out by two taps or the right button', async () => {
      const { view, sketches, instrument, clock } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 60, 0.25],
            [500, 62, 0.5],
            [1_000, 64, 0.75],
          ].flatMap(([atMs = 0, midi = 0, velocity = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity },
            { kind: 'noteOff' as const, atMs: atMs + 400, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Three',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - midi + 0.5) * 13 - scrolledDown,
      });
      const press = (type: string, where: { clientX: number; clientY: number }, keys: PointerEventInit = {}): void => {
        element('roll-body').dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId: 71, pointerType: 'mouse', button: 0, ...where, ...keys }),
        );
      };
      const chosen = (): number[] =>
        (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => note.fromMs);
      const sounding = (): (number | undefined)[][] => instrument.played.map((note) => [note.midi, note.velocity]);
      const silenced = (): number[] => instrument.stopped.map((note) => note.midi);
      const fresh = (): void => {
        instrument.played.length = 0;
        instrument.stopped.length = 0;
      };

      // Pressed, a note is chosen alone at once, lit while it is held.
      press('pointerdown', at(100, 60));
      expect(chosen()).toEqual([0]);
      press('pointerup', at(100, 60));
      expect(chosen()).toEqual([0]);
      // With Shift, added as it is pressed, and not taken out again on letting go.
      press('pointerdown', at(600, 62), { shiftKey: true });
      expect(chosen()).toEqual([0, 500]);
      press('pointerup', at(600, 62), { shiftKey: true });
      expect(chosen()).toEqual([0, 500]);

      // Pressed among others chosen, they all stay chosen, and all sound.
      fresh();
      press('pointerdown', at(100, 60));
      expect(chosen()).toEqual([0, 500]);
      expect(sounding()).toEqual([
        [60, 0.25],
        [62, 0.5],
      ]);
      // Dragged a row up, all fall silent and sound a semitone higher.
      press('pointermove', { clientX: at(100, 60).clientX, clientY: at(100, 61).clientY });
      expect(silenced()).toEqual([60, 62]);
      expect(sounding().slice(2)).toEqual([
        [61, 0.25],
        [63, 0.5],
      ]);
      // Taken away, every one is silent and nothing moved.
      press('pointercancel', { clientX: at(100, 60).clientX, clientY: at(100, 61).clientY });
      expect(silenced()).toEqual([60, 62, 61, 63]);
      // Let go of without moving, the one pressed is chosen alone.
      press('pointerdown', at(100, 60));
      press('pointerup', at(100, 60));
      expect(chosen()).toEqual([0]);

      // Two taps on a note take it out, and only that one; put back as one change.
      const count = (): number => sketches.find(sketch.id)?.noteCount ?? -1;
      const tap = (where: { clientX: number; clientY: number }, keys: PointerEventInit = {}): void => {
        press('pointerdown', where, keys);
        press('pointerup', where, keys);
      };
      clock.advance(1_000);
      tap(at(1_100, 64));
      expect(count()).toBe(3);
      tap(at(1_100, 64));
      expect(count()).toBe(2);
      expect(view.rollScene?.notes.map((note) => note.fromMs)).toEqual([0, 500]);
      element<HTMLButtonElement>('roll-undo').click();
      expect(count()).toBe(3);
      // Two taps far apart in time, or with Shift held, are two taps.
      tap(at(1_100, 64));
      clock.advance(401);
      tap(at(1_100, 64));
      expect(count()).toBe(3);
      tap(at(1_100, 64), { shiftKey: true });
      tap(at(1_100, 64), { shiftKey: true });
      expect(count()).toBe(3);
      // The right button takes one out at once, and is no menu there.
      const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...at(1_100, 64) });
      element('roll-body').dispatchEvent(menu);
      expect(menu.defaultPrevented).toBe(true);
      expect(count()).toBe(2);
      element<HTMLButtonElement>('roll-undo').click();
      expect(count()).toBe(3);
      // Where there is no note, the menu is the browser's.
      const elsewhere = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...at(2_500, 70) });
      element('roll-body').dispatchEvent(elsewhere);
      expect(elsewhere.defaultPrevented).toBe(false);
      clock.advance(1_000);
      // Taken out of the choice as it is pressed with Shift, a note dragged is moved alone.
      press('pointerdown', at(100, 60));
      press('pointerup', at(100, 60));
      press('pointerdown', at(600, 62), { shiftKey: true });
      press('pointerup', at(600, 62), { shiftKey: true });
      expect(chosen()).toEqual([0, 500]);
      press('pointerdown', at(600, 62), { shiftKey: true });
      expect(chosen()).toEqual([0]);
      press('pointermove', { clientX: at(1_100, 62).clientX, clientY: at(600, 62).clientY }, { shiftKey: true });
      press('pointerup', { clientX: at(1_100, 62).clientX, clientY: at(600, 62).clientY }, { shiftKey: true });
      expect(
        (sketches.find(sketch.id)?.events ?? []).flatMap((event) => (event.kind === 'noteOn' ? [[event.midi, event.atMs]] : [])),
      ).toEqual([
        [60, 0],
        [62, 1_000],
        [64, 1_000],
      ]);
      element<HTMLButtonElement>('roll-undo').click();
      // Listening, two taps and the right button take nothing out.
      element<HTMLButtonElement>('roll-edit').click();
      clock.advance(1_000);
      tap(at(1_100, 64));
      tap(at(1_100, 64));
      const listening = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...at(1_100, 64) });
      element('roll-body').dispatchEvent(listening);
      expect(listening.defaultPrevented).toBe(false);
      expect(count()).toBe(3);
    });

    it('edits as an editor does: a tap puts the marker, two write a note, the right button takes one out, the middle one moves the drawing', async () => {
      const { view, sketches, instrument, clock } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 60],
            [500, 62],
          ].flatMap(([atMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: atMs + 400, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Two',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - midi + 0.5) * 13 - scrolledDown,
      });
      const body = element('roll-body');
      const count = (): number => sketches.find(sketch.id)?.noteCount ?? -1;
      const chosen = (): number[] =>
        (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => note.fromMs);
      const click = (where: { clientX: number; clientY: number }, init: PointerEventInit = {}): void => {
        tapTheDrawing({ pointerType: 'mouse', button: 0, ...where, ...init });
      };
      const aFrameLater = async (): Promise<void> =>
        new Promise((done) => {
          requestAnimationFrame(() => requestAnimationFrame(() => done()));
        });
      const along = (): number =>
        Number.parseFloat(body.querySelector<HTMLElement>('.roll__head')?.style.getPropertyValue('--roll-x') ?? '0') || 0;

      // A click where there is no note puts the marker there, on the beat, and
      // lets go of what was chosen.
      click(at(100, 60));
      expect(chosen()).toEqual([0]);
      clock.advance(1_000);
      click(at(1_480, 67));
      expect(headAt(body)).toBe('1.500');
      expect(chosen()).toEqual([]);
      expect(count()).toBe(2);
      // Two near enough each other write a note; two apart are two clicks.
      click(at(1_480, 67));
      expect(count()).toBe(3);
      element<HTMLButtonElement>('roll-undo').click();
      // And leave the marker where it was before them: a click alone moves it.
      clock.advance(1_000);
      click(at(980, 69));
      expect(headAt(body)).toBe('1.000');
      clock.advance(1_000);
      click(at(2_480, 69));
      expect(headAt(body)).toBe('2.500');
      click(at(2_480, 69));
      expect(count()).toBe(3);
      expect(headAt(body)).toBe('1.000');
      element<HTMLButtonElement>('roll-undo').click();
      clock.advance(1_000);
      click(at(1_480, 67));
      click({ clientX: at(1_480, 67).clientX + 13, clientY: at(1_480, 67).clientY });
      expect(count()).toBe(2);
      // A click on a note and one just past its end on nothing, eleven pixels
      // apart, make no pair either way.
      clock.advance(1_000);
      click(at(390, 60));
      click(at(470, 60));
      expect(count()).toBe(2);
      clock.advance(1_000);
      click(at(470, 60));
      click(at(390, 60));
      expect(count()).toBe(2);
      expect(chosen()).toEqual([0]);

      // The right button takes hold of nothing as it goes down, and sounds nothing.
      clock.advance(1_000);
      instrument.played.length = 0;
      const right = { bubbles: true, cancelable: true, pointerId: 81, pointerType: 'mouse', button: 2 };
      body.dispatchEvent(new PointerEvent('pointerdown', { ...right, ...at(600, 62) }));
      body.dispatchEvent(new PointerEvent('pointerup', { ...right, ...at(600, 62) }));
      expect(chosen()).toEqual([0]);
      expect(instrument.played).toEqual([]);

      // The middle button moves the drawing from wherever it goes down, a note
      // included, with either tool, and keeps the page from scrolling by it.
      element<HTMLButtonElement>('roll-select').click();
      const middle = { bubbles: true, cancelable: true, pointerId: 82, pointerType: 'mouse', button: 1 };
      const down = new PointerEvent('pointerdown', { ...middle, ...at(600, 62) });
      body.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      expect(chosen()).toEqual([0]);
      body.dispatchEvent(new PointerEvent('pointermove', { ...middle, clientX: at(600, 62).clientX - 200, clientY: at(600, 62).clientY }));
      body.dispatchEvent(new PointerEvent('pointerup', { ...middle, clientX: at(600, 62).clientX - 200, clientY: at(600, 62).clientY }));
      await aFrameLater();
      expect(along()).toBe(200);
      element<HTMLButtonElement>('roll-select').click();
      // And with the pencil, the left one does from empty space - stopping
      // where it is let go of, however fast it went: a mouse throws nothing.
      const left = { bubbles: true, pointerId: 83, pointerType: 'mouse', button: 0 };
      const atMoment = (type: string, clientX: number, timeStamp: number): void => {
        const event = new PointerEvent(type, { ...left, clientX, clientY: 20 });
        Object.defineProperty(event, 'timeStamp', { value: timeStamp });
        body.dispatchEvent(event);
      };
      atMoment('pointerdown', 600, 1_000);
      atMoment('pointermove', 550, 1_010);
      atMoment('pointermove', 500, 1_020);
      atMoment('pointerup', 500, 1_020);
      await aFrameLater();
      await aFrameLater();
      expect(along()).toBe(300);
      expect(count()).toBe(2);
    });

    it('edits by the keys: all chosen, let go of, moved by the grid and by pitch, undone and redone, and back to the marker', async () => {
      const { view, runtime, sketches, instrument, clock } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 60],
            [500, 62],
            [1_000, 100],
          ].flatMap(([atMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: atMs + 400, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Keys',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - midi + 0.5) * 13 - scrolledDown,
      });
      const key = (init: KeyboardEventInit, on: EventTarget = document.body): KeyboardEvent => {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        on.dispatchEvent(event);
        return event;
      };
      const struck = (): number[][] =>
        (sketches.find(sketch.id)?.events ?? []).flatMap((event) => (event.kind === 'noteOn' ? [[event.midi, event.atMs]] : []));
      const chosen = (): number[] =>
        (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => note.fromMs);
      // The note being moved: neither the one left at 60 nor the one at the top.
      const moving = (): number[] | undefined => struck().find(([midi]) => midi !== 60 && (midi ?? 0) < 90);
      const top = (): number[] | undefined => struck().find(([midi]) => (midi ?? 0) >= 90);
      const choose = (ms: number, midi: number): void => {
        clock.advance(1_000);
        tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(ms, midi) });
      };

      // Nothing chosen, an arrow is left to the page.
      expect(key({ key: 'ArrowRight' }).defaultPrevented).toBe(false);
      // Ctrl+A chooses every note, and Escape lets go of them, the sheet staying.
      expect(key({ key: 'a', code: 'KeyA', ctrlKey: true }).defaultPrevented).toBe(true);
      expect(chosen()).toEqual([0, 500, 1_000]);
      expect(key({ key: 'Escape' }).defaultPrevented).toBe(true);
      expect(chosen()).toEqual([]);
      expect(element('sheet-roll').hidden).toBe(false);

      // Across, a line of the grid at a time, and no further than its first.
      choose(600, 62);
      key({ key: 'ArrowRight' });
      expect(moving()).toEqual([62, 1_000]);
      key({ key: 'ArrowLeft' });
      key({ key: 'ArrowLeft' });
      expect(moving()).toEqual([62, 0]);
      expect(chosen()).toEqual([0]);
      const before = struck();
      key({ key: 'ArrowLeft' });
      expect(struck()).toEqual(before);
      // Up a semitone, heard there; with Shift an octave.
      instrument.played.length = 0;
      instrument.stopped.length = 0;
      const now = clock.now();
      key({ key: 'ArrowUp' });
      expect(instrument.played.map((note) => [note.midi, note.atMs])).toEqual([[63, now]]);
      expect(instrument.stopped.map((note) => [note.midi, note.atMs])).toEqual([[63, now + 300]]);
      key({ key: 'ArrowUp', shiftKey: true });
      expect(moving()).toEqual([75, 0]);
      key({ key: 'ArrowDown', shiftKey: true });
      key({ key: 'ArrowDown' });
      expect(moving()).toEqual([62, 0]);
      // Not off the keyboard: a note at 100 goes up a semitone, not an octave.
      choose(1_100, 100);
      key({ key: 'ArrowUp', shiftKey: true });
      expect(top()).toEqual([100, 1_000]);
      key({ key: 'ArrowUp' });
      expect(top()).toEqual([101, 1_000]);
      // With Alt held, or a list holding the focus, an arrow is not the editor's.
      expect(key({ key: 'ArrowUp', altKey: true }).defaultPrevented).toBe(false);
      expect(key({ key: 'ArrowUp' }, element('roll-key')).defaultPrevented).toBe(false);
      expect(key({ key: 'ArrowUp' }, element('roll-velocity-level')).defaultPrevented).toBe(false);
      expect(top()).toEqual([101, 1_000]);

      // Undone with Ctrl+Z, done again with Ctrl+Shift+Z or Ctrl+Y, until something else is done.
      key({ key: 'z', code: 'KeyZ', ctrlKey: true });
      expect(top()).toEqual([100, 1_000]);
      key({ key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true });
      expect(top()).toEqual([101, 1_000]);
      // Two back, the step down to 62 before it too; and forward again one at a time.
      key({ key: 'z', code: 'KeyZ', metaKey: true });
      key({ key: 'z', code: 'KeyZ', metaKey: true });
      expect([top(), moving()]).toEqual([
        [100, 1_000],
        [63, 0],
      ]);
      key({ key: 'y', code: 'KeyY', ctrlKey: true });
      expect([top(), moving()]).toEqual([
        [100, 1_000],
        [62, 0],
      ]);
      key({ key: 'y', code: 'KeyY', ctrlKey: true });
      expect(top()).toEqual([101, 1_000]);
      choose(1_100, 101);
      key({ key: 'ArrowDown' });
      key({ key: 'y', code: 'KeyY', ctrlKey: true });
      expect(top()).toEqual([100, 1_000]);

      // Shift held as a note is dragged, it goes exactly where the pointer takes it.
      const drag = { bubbles: true, pointerId: 91, pointerType: 'mouse', button: 0 };
      const body = element('roll-body');
      const from = at(100, 60);
      body.dispatchEvent(new PointerEvent('pointerdown', { ...drag, ...from }));
      body.dispatchEvent(new PointerEvent('pointermove', { ...drag, shiftKey: true, clientX: from.clientX + 0.15 * zoom, clientY: from.clientY }));
      body.dispatchEvent(new PointerEvent('pointerup', { ...drag, shiftKey: true, clientX: from.clientX + 0.15 * zoom, clientY: from.clientY }));
      expect(struck().find(([midi]) => midi === 60)).toEqual([60, 150]);
      // And so does its end.
      const end = at(540, 60);
      body.dispatchEvent(new PointerEvent('pointerdown', { ...drag, ...end }));
      body.dispatchEvent(new PointerEvent('pointermove', { ...drag, shiftKey: true, clientX: end.clientX + 0.13 * zoom, clientY: end.clientY }));
      body.dispatchEvent(new PointerEvent('pointerup', { ...drag, shiftKey: true, clientX: end.clientX + 0.13 * zoom, clientY: end.clientY }));
      expect(sketches.find(sketch.id)?.events.find((event) => event.kind === 'noteOff' && event.midi === 60)?.atMs).toBe(680);

      // Shift+Space goes back to the marker, a playback going stopped.
      clock.advance(1_000);
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(1_480, 70) });
      expect(headAt(body)).toBe('1.500');
      element<HTMLButtonElement>('roll-play').click();
      expect(runtime.takePlayer.playing).not.toBeNull();
      expect(element('roll-play').title).toBe('Pause (Space)');
      expect(key({ key: ' ', code: 'Space', shiftKey: true }).defaultPrevented).toBe(true);
      expect(runtime.takePlayer.playing).toBeNull();
      expect(headAt(body)).toBe('1.500');

      // On a Mac or an iPad, the titles name the command key by its sign.
      const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, 'platform');
      Object.defineProperty(Navigator.prototype, 'platform', { configurable: true, get: () => 'MacIntel' });
      try {
        key({ key: 'a', code: 'KeyA', metaKey: true });
        expect(element('roll-undo').title).toBe('Put back the last change (⌘Z; again with Shift)');
      } finally {
        if (platform !== undefined) {
          Object.defineProperty(Navigator.prototype, 'platform', platform);
        }
      }

      // Escape lets go first, and with nothing chosen shuts the sheet.
      key({ key: 'Escape' });
      expect(chosen()).toEqual([]);
      key({ key: 'Escape' });
      expect(element('sheet-roll').hidden).toBe(true);
    });

    it('writes a note in the cell of the grid it is tapped in, never on or over another of its pitch', async () => {
      const { view, sketches, clock } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            // On the third beat, and one off the grid across the fifth and sixth.
            [1_000, 1_500, 62],
            [2_250, 2_750, 64],
          ].flatMap(([atMs = 0, upAtMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: upAtMs, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Cells',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - midi + 0.5) * 13 - scrolledDown,
      });
      const twice = (ms: number, midi: number): void => {
        clock.advance(1_000);
        tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(ms, midi) });
        tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(ms, midi) });
      };
      const of = (midi: number): number[][] => {
        const events = sketches.find(sketch.id)?.events ?? [];
        return events.flatMap((event, index) => {
          if (event.kind !== 'noteOn' || event.midi !== midi) {
            return [];
          }
          const off = events.slice(index + 1).find((later) => later.kind === 'noteOff' && later.midi === midi);
          return [[event.atMs, off?.atMs ?? -1]];
        });
      };

      // Just before a note, in the cell before its beat: the cell, not the note's beat.
      twice(900, 62);
      expect(of(62)).toEqual([
        [500, 1_000],
        [1_000, 1_500],
      ]);
      // Again and again there, nothing more: the place is taken.
      twice(900, 62);
      twice(700, 62);
      expect(of(62)).toHaveLength(2);
      // In a cell another of its pitch begins partway through, cut short where that one begins.
      twice(2_100, 64);
      expect(of(64)).toEqual([
        [2_000, 2_250],
        [2_250, 2_750],
      ]);
      // In the cell that one reaches into, nothing: its start would be inside it.
      twice(2_900, 64);
      expect(of(64)).toEqual([
        [2_000, 2_250],
        [2_250, 2_750],
      ]);
      // On another pitch the same cell is free.
      twice(900, 63);
      expect(of(63)).toEqual([[500, 1_000]]);
    });

    it('copies the notes held by a drag with Ctrl, leaving them where they were, and takes one out of the choice by a tap with it; and holds none shorter than the grid', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 400, 60],
            [0, 400, 64],
            [1_000, 1_400, 67],
          ].flatMap(([atMs = 0, upAtMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: upAtMs, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Copies',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - midi + 0.5) * 13 - scrolledDown,
      });
      const body = element('roll-body');
      const pointer = (type: string, where: { clientX: number; clientY: number }, more: PointerEventInit = {}): void => {
        body.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 96, pointerType: 'mouse', button: 0, ...where, ...more }));
      };
      const drag = (from: { clientX: number; clientY: number }, to: { clientX: number; clientY: number }, more: PointerEventInit = {}): void => {
        pointer('pointerdown', from, more);
        pointer('pointermove', to, more);
        pointer('pointerup', to, more);
        body.dispatchEvent(new MouseEvent('click', { bubbles: true, ...to, ...more }));
      };
      const tap = (where: { clientX: number; clientY: number }, more: PointerEventInit = {}): void => {
        drag(where, where, more);
      };
      const notes = (): number[][] => {
        const events = sketches.find(sketch.id)?.events ?? [];
        return events
          .flatMap((event, index) => {
            if (event.kind !== 'noteOn') {
              return [];
            }
            const off = events.slice(index + 1).find((later) => later.kind === 'noteOff' && later.midi === event.midi);
            return [[event.midi, event.atMs, off?.atMs ?? -1]];
          })
          .sort(([a = 0, x = 0], [b = 0, y = 0]) => x - y || a - b);
      };
      const chosen = (): number[][] =>
        (view.rollScene?.notes ?? [])
          .filter((note) => note.chosen === true)
          .map((note) => [highest - note.row, note.fromMs])
          .sort(([a = 0, x = 0], [b = 0, y = 0]) => x - y || a - b);
      const original = notes();

      // A note not chosen, dragged with Ctrl: a copy of it goes where it is
      // dragged, on the beat, and is chosen; it stays where it was.
      drag(at(100, 60), at(1_100, 62), { ctrlKey: true });
      expect(notes()).toEqual([...original.slice(0, 2), [62, 1_000, 1_400], [67, 1_000, 1_400]]);
      expect(chosen()).toEqual([[62, 1_000]]);
      // One change, put back as one.
      element<HTMLButtonElement>('roll-undo').click();
      expect(notes()).toEqual(original);

      // Two chosen, dragged with Cmd from one of them: both copied, by as much.
      tap(at(100, 60));
      tap(at(100, 64), { shiftKey: true });
      expect(chosen()).toEqual([
        [60, 0],
        [64, 0],
      ]);
      drag(at(100, 64), at(2_100, 64), { metaKey: true });
      expect(notes()).toEqual([...original, [60, 2_000, 2_400], [64, 2_000, 2_400]]);
      expect(chosen()).toEqual([
        [60, 2_000],
        [64, 2_000],
      ]);

      // Tapped with Ctrl, one chosen is taken out of the choice, and one not
      // chosen added to it; nothing is copied.
      tap(at(2_100, 60), { ctrlKey: true });
      expect(chosen()).toEqual([[64, 2_000]]);
      tap(at(1_100, 67), { ctrlKey: true });
      expect(chosen()).toEqual([
        [67, 1_000],
        [64, 2_000],
      ]);
      expect(notes()).toHaveLength(5);

      // Its end dragged with Ctrl, a note is held longer, to the beat, not copied.
      tap(at(2_100, 64));
      drag(at(2_390, 64), at(2_890, 64), { ctrlKey: true });
      expect(notes()).toHaveLength(5);
      expect(notes().at(-1)).toEqual([64, 2_000, 3_000]);

      // Pulled back past where it begins, it ends on the next line of the
      // grid after that, and is never a sliver off it; with Shift, which puts
      // an end anywhere, as short as a note can be heard.
      drag(at(2_990, 64), at(1_500, 64));
      expect(notes().at(-1)).toEqual([64, 2_000, 2_500]);
      drag(at(2_490, 64), at(1_500, 64), { shiftKey: true });
      expect(notes().at(-1)).toEqual([64, 2_000, 2_030]);
    });

    it('moves a note neither by a drag nor by an arrow over another of its pitch', async () => {
      const { view, sketches, clock, instrument } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 400, 62],
            [1_000, 1_500, 62],
            [1_000, 1_500, 63],
          ].flatMap(([atMs = 0, upAtMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: upAtMs, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Over',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - midi + 0.5) * 13 - scrolledDown,
      });
      const body = element('roll-body');
      const pointer = (type: string, where: { clientX: number; clientY: number }): void => {
        body.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 95, pointerType: 'mouse', button: 0, ...where }));
      };
      const notes = (): number[][] => {
        const events = sketches.find(sketch.id)?.events ?? [];
        return events.flatMap((event, index) => {
          if (event.kind !== 'noteOn') {
            return [];
          }
          const off = events.slice(index + 1).find((later) => later.kind === 'noteOff' && later.midi === event.midi);
          return [[event.midi, event.atMs, off?.atMs ?? -1]];
        });
      };
      const key = (init: KeyboardEventInit): void => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
      };

      // Dragged onto the other of its pitch, it stays where it last fitted.
      pointer('pointerdown', at(100, 62));
      pointer('pointermove', at(600, 62));
      pointer('pointermove', at(1_100, 62));
      pointer('pointerup', at(1_100, 62));
      expect(notes()).toEqual([
        [62, 500, 900],
        [62, 1_000, 1_500],
        [63, 1_000, 1_500],
      ]);
      // Dragged on past it, it goes where it fits again.
      clock.advance(1_000);
      pointer('pointerdown', at(600, 62));
      pointer('pointermove', at(1_100, 62));
      pointer('pointermove', at(1_600, 62));
      pointer('pointerup', at(1_600, 62));
      expect(notes()[2]).toEqual([62, 1_500, 1_900]);
      element<HTMLButtonElement>('roll-undo').click();
      // Held longer into it, it stops short of it.
      clock.advance(1_000);
      pointer('pointerdown', at(890, 62));
      pointer('pointermove', at(990, 62));
      pointer('pointermove', at(1_390, 62));
      pointer('pointerup', at(1_390, 62));
      expect(notes()[0]).toEqual([62, 500, 1_000]);

      // Taken up a row onto 63, which holds that place, it stays, and is not heard there.
      clock.advance(1_000);
      instrument.played.length = 0;
      pointer('pointerdown', at(1_100, 62));
      pointer('pointermove', at(1_100, 63));
      pointer('pointerup', at(1_100, 63));
      expect(instrument.played.map((note) => note.midi)).toEqual([62]);
      expect(notes().filter(([, down]) => down === 1_000).sort(([one = 0], [other = 0]) => one - other)).toEqual([
        [62, 1_000, 1_500],
        [63, 1_000, 1_500],
      ]);
      clock.advance(1_000);
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(600, 62) });

      // An arrow steps over a place another of its pitch holds to the next that is free.
      key({ key: 'ArrowRight' });
      expect(notes().find(([midi, down]) => midi === 62 && down !== 1_000)).toEqual([62, 1_500, 2_000]);
      key({ key: 'ArrowLeft' });
      expect(notes().find(([midi, down]) => midi === 62 && down !== 1_000)).toEqual([62, 500, 1_000]);
      // And up past a pitch taken: from 62 at 1000 over 63, to 64.
      clock.advance(1_000);
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(1_100, 62) });
      key({ key: 'ArrowUp' });
      expect(notes().filter(([, down]) => down === 1_000).sort(([one = 0], [other = 0]) => one - other)).toEqual([
        [63, 1_000, 1_500],
        [64, 1_000, 1_500],
      ]);
    });

    it('copies the chosen notes by Ctrl and an arrow: straight after them or before, up or down, past others of their pitch', async () => {
      const { view, sketches, instrument } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 400, 60],
            [500, 1_000, 64],
            // In the way of the second copy of the 60.
            [2_000, 2_400, 60],
          ].flatMap(([atMs = 0, upAtMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: upAtMs, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Copies',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - midi + 0.5) * 13 - scrolledDown,
      });
      const inOrder = ([one = 0, a = 0]: number[], [other = 0, b = 0]: number[]): number => one - other || a - b;
      const notes = (): number[][] => {
        const events = sketches.find(sketch.id)?.events ?? [];
        return events
          .flatMap((event, index) => {
            if (event.kind !== 'noteOn') {
              return [];
            }
            const off = events.slice(index + 1).find((later) => later.kind === 'noteOff' && later.midi === event.midi);
            return [[event.atMs, event.midi, off?.atMs ?? -1]];
          })
          .sort(inOrder);
      };
      const chosen = (): number[][] =>
        (view.rollScene?.notes ?? [])
          .filter((note) => note.chosen === true)
          .map((note) => [note.fromMs, (view.rollScene?.highest ?? 0) - note.row])
          .sort(inOrder);
      const key = (init: KeyboardEventInit): KeyboardEvent => {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        document.body.dispatchEvent(event);
        return event;
      };
      const original = [
        [0, 60, 400],
        [500, 64, 1_000],
        [2_000, 60, 2_400],
      ];

      // Nothing chosen, Ctrl+D is left to the browser.
      expect(key({ key: 'd', code: 'KeyD', ctrlKey: true }).defaultPrevented).toBe(false);
      // The first two chosen, Ctrl+D copies them straight after themselves,
      // from the first one's start to the last one's end, and chooses the copies.
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(100, 60) });
      tapTheDrawing({ pointerType: 'mouse', button: 0, shiftKey: true, ...at(600, 64) });
      expect(key({ key: 'd', code: 'KeyD', ctrlKey: true }).defaultPrevented).toBe(true);
      expect(notes()).toEqual([...original, [1_000, 60, 1_400], [1_500, 64, 2_000]].sort(inOrder));
      expect(chosen()).toEqual([
        [1_000, 60],
        [1_500, 64],
      ]);
      // Again with Cmd and the right arrow: the 60 would go onto the other
      // 60, so the copies go on by as much again.
      key({ key: 'ArrowRight', metaKey: true });
      expect(chosen()).toEqual([
        [3_000, 60],
        [3_500, 64],
      ]);
      expect(notes()).toHaveLength(7);
      // Back before them every place is taken, and before the beginning there is none.
      const before = notes();
      expect(key({ key: 'ArrowLeft', ctrlKey: true }).defaultPrevented).toBe(true);
      expect(notes()).toEqual(before);

      // An octave up with Shift, heard there; a semitone down without.
      instrument.played.length = 0;
      key({ key: 'ArrowUp', ctrlKey: true, shiftKey: true });
      expect(instrument.played.map((note) => note.midi)).toEqual([72, 76]);
      expect(chosen()).toEqual([
        [3_000, 72],
        [3_500, 76],
      ]);
      key({ key: 'ArrowDown', ctrlKey: true });
      expect(chosen()).toEqual([
        [3_000, 71],
        [3_500, 75],
      ]);
      expect(notes().filter(([down = 0]) => down >= 3_000)).toEqual([
        [3_000, 60, 3_400],
        [3_000, 71, 3_400],
        [3_000, 72, 3_400],
        [3_500, 64, 4_000],
        [3_500, 75, 4_000],
        [3_500, 76, 4_000],
      ]);
      // Each copy is one change, put back as one.
      key({ key: 'z', code: 'KeyZ', ctrlKey: true });
      expect(notes()).toHaveLength(9);
    });

    it('copies and cuts the chosen notes to the clipboard by Ctrl+C and Ctrl+X, and pastes them where the head is', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 400, 60],
            [500, 1_000, 64],
          ].flatMap(([atMs = 0, upAtMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: upAtMs, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Clipboard',
        1,
      );
      const written: string[] = [];
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string): Promise<void> => {
            written.push(text);
            return Promise.resolve();
          },
        },
      });
      try {
        element<HTMLButtonElement>('focus-scores').click();
        element<HTMLButtonElement>('scores-show-sketches').click();
        rowButton('sketches-list', 'Edit this sketch').click();
        const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
        const highest = view.rollScene?.highest ?? 0;
        const scrolledDown =
          Number.parseFloat(
            element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
          ) || 0;
        const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
          clientX: (ms / 1000) * zoom,
          clientY: (highest - midi + 0.5) * 13 - scrolledDown,
        });
        const inOrder = ([one = 0, a = 0]: number[], [other = 0, b = 0]: number[]): number => one - other || a - b;
        const notes = (): number[][] => {
          const events = sketches.find(sketch.id)?.events ?? [];
          return events
            .flatMap((event, index) => {
              if (event.kind !== 'noteOn') {
                return [];
              }
              const off = events.slice(index + 1).find((later) => later.kind === 'noteOff' && later.midi === event.midi);
              return [[event.atMs, event.midi, off?.atMs ?? -1]];
            })
            .sort(inOrder);
        };
        const chosen = (): number[][] =>
          (view.rollScene?.notes ?? [])
            .filter((note) => note.chosen === true)
            .map((note) => [note.fromMs, (view.rollScene?.highest ?? 0) - note.row])
            .sort(inOrder);
        const key = (init: KeyboardEventInit): KeyboardEvent => {
          const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
          document.body.dispatchEvent(event);
          return event;
        };
        const paste = (text: string, on: Element = document.body): Event => {
          const event = new Event('paste', { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'clipboardData', {
            value: { getData: (type: string): string => (type === 'text/plain' ? text : '') },
          });
          on.dispatchEvent(event);
          return event;
        };
        const original = [
          [0, 60, 400],
          [500, 64, 1_000],
        ];

        // Nothing chosen, Ctrl+C is left to the browser.
        expect(key({ key: 'c', code: 'KeyC', ctrlKey: true }).defaultPrevented).toBe(false);
        expect(written).toEqual([]);
        // Both chosen, they are copied, and stay.
        tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(100, 60) });
        tapTheDrawing({ pointerType: 'mouse', button: 0, shiftKey: true, ...at(600, 64) });
        expect(key({ key: 'c', code: 'KeyC', metaKey: true }).defaultPrevented).toBe(true);
        expect(written.map((text) => theNotesOnTheClipboard(text))).toEqual([
          [
            { afterMs: 0, lengthMs: 400, midi: 60, velocity: 0.5 },
            { afterMs: 500, lengthMs: 500, midi: 64, velocity: 0.5 },
          ],
        ]);
        expect(notes()).toEqual(original);

        // With the head put at 3000, pasted from there, and chosen.
        tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(3_000, 50) });
        expect(paste(written[0] ?? '').defaultPrevented).toBe(true);
        expect(notes()).toEqual([...original, [3_000, 60, 3_400], [3_500, 64, 4_000]]);
        expect(chosen()).toEqual([
          [3_000, 60],
          [3_500, 64],
        ]);
        // Pasted again there, every note is over itself: nothing changes.
        expect(paste(written[0] ?? '').defaultPrevented).toBe(true);
        expect(notes()).toHaveLength(4);
        // One change, put back as one.
        key({ key: 'z', code: 'KeyZ', ctrlKey: true });
        expect(notes()).toEqual(original);

        // Other text is the browser's; so is a paste into a field, or onto a sketch not being edited.
        expect(paste('C E G').defaultPrevented).toBe(false);
        const field = document.createElement('input');
        field.type = 'text';
        document.body.append(field);
        expect(paste(written[0] ?? '', field).defaultPrevented).toBe(false);
        field.remove();
        element<HTMLButtonElement>('roll-edit').click();
        expect(paste(written[0] ?? '').defaultPrevented).toBe(false);
        element<HTMLButtonElement>('roll-edit').click();
        expect(notes()).toEqual(original);

        // Ctrl+X copies the chosen and takes them out.
        tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(600, 64) });
        expect(key({ key: 'x', code: 'KeyX', ctrlKey: true }).defaultPrevented).toBe(true);
        expect(theNotesOnTheClipboard(written.at(-1) ?? '')).toEqual([{ afterMs: 0, lengthMs: 500, midi: 64, velocity: 0.5 }]);
        expect(notes()).toEqual([[0, 60, 400]]);
        // With no clipboard to cut to, a cut takes nothing out.
        Reflect.deleteProperty(window.navigator, 'clipboard');
        tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(100, 60) });
        key({ key: 'x', code: 'KeyX', ctrlKey: true });
        expect(notes()).toEqual([[0, 60, 400]]);
      } finally {
        Reflect.deleteProperty(window.navigator, 'clipboard');
      }
    });

    it('names the chord the chosen notes make over the drawing, spelled as the sketch\'s key spells it', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      sketches.begin(
        {
          events: [
            [0, 400, 60],
            [500, 900, 64],
            [1_000, 1_400, 67],
            [1_200, 1_250, 66],
            [1_300, 1_350, 69],
            [1_500, 1_900, 58],
            [2_500, 2_900, 61],
            [2_500, 2_900, 65],
            [2_500, 2_900, 68],
          ].flatMap(([atMs = 0, upAtMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: upAtMs, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Chords',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - midi + 0.5) * 13 - scrolledDown,
      });
      const tap = (ms: number, midi: number, adding = true): void => {
        tapTheDrawing({ pointerType: 'mouse', button: 0, shiftKey: adding, ...at(ms, midi) });
      };
      const chord = element<HTMLOutputElement>('roll-chord');
      const said = (): string | null => (chord.hidden ? null : chord.textContent);

      // Nothing chosen, and one note alone, is no chord.
      expect(said()).toBeNull();
      tap(100, 60, false);
      expect(said()).toBeNull();
      // Broken over time, the notes still make their chord.
      tap(600, 64);
      expect(said()).toBeNull();
      tap(1_100, 67);
      expect(said()).toBe('C');
      expect(chord.title).toBe('The chord the chosen notes make');
      // With an F sharp passing them for a twentieth of a second, mostly that chord, and said so.
      tap(1_225, 66);
      expect(said()).toBe('≈ C');
      // And an A as short: still C, by how long each sounds - counted alike, C sixth.
      tap(1_325, 69);
      expect(said()).toBe('≈ C');
      expect(chord.title).toBe('The chord most of the chosen notes make, by how long they sound');
      key({ key: 'Escape' });
      tap(100, 60, false);
      tap(600, 64);
      tap(1_100, 67);
      // With a B flat below, a seventh over its bass.
      tap(1_600, 58);
      expect(said()).toBe('C7/B♭');
      // Let go of, gone.
      key({ key: 'Escape' });
      expect(said()).toBeNull();

      // In C, a black key is spelled as chord charts do; in a flat key, as a flat.
      tap(2_600, 61, false);
      tap(2_600, 65);
      tap(2_600, 68);
      expect(said()).toBe('C♯');
      const keyOfTheSketch = element<HTMLSelectElement>('roll-key');
      keyOfTheSketch.value = '10';
      keyOfTheSketch.dispatchEvent(new Event('change'));
      expect(said()).toBe('D♭');

      // Listening, nothing is chosen to name.
      element<HTMLButtonElement>('roll-edit').click();
      expect(said()).toBeNull();

      function key(init: KeyboardEventInit): void {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
      }
    });

    it('writes a sketch in a tonic and a scale chosen apart, its notes\' rows lit, its tonics spelt as the scale on each is', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            { kind: 'noteOn' as const, atMs: 0, midi: 62, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: 400, midi: 62 },
          ],
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Modes',
        1,
        { fifths: 7, mode: 'major' },
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const tonic = element<HTMLSelectElement>('roll-key');
      const scale = element<HTMLSelectElement>('roll-scale');
      const tonics = (): string[] => [...tonic.options].map((option) => option.textContent ?? '');
      const lit = (): number[] =>
        [...element('roll-body').querySelectorAll<HTMLElement>(".roll__key[data-in-scale='true']")].map((key) =>
          Number(key.dataset['midi']) % 12,
        );
      const choose = (pitchClass: string, name: string): void => {
        tonic.value = pitchClass;
        scale.value = name;
        scale.dispatchEvent(new Event('change'));
      };

      // Begun in C sharp major, spelt as it is, the other tonics as their major keys are.
      expect([...scale.options].map((option) => option.textContent)).toEqual([
        'major',
        'minor',
        'harmonic minor',
        'melodic minor',
        'dorian',
        'phrygian',
        'lydian',
        'mixolydian',
        'locrian',
      ]);
      expect(scale.getAttribute('aria-label')).toBe('Scale');
      expect([tonic.value, scale.value]).toEqual(['1', 'major']);
      expect(tonics()).toEqual(['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']);
      expect(new Set(lit())).toEqual(new Set([1, 3, 5, 6, 8, 10, 0]));

      // D dorian: the signature of C, the mode kept, its rows and its chords.
      choose('2', 'dorian');
      expect(sketches.find(sketch.id)?.key).toEqual({ fifths: 0, mode: 'minor', scale: 'dorian' });
      expect(new Set(lit())).toEqual(new Set([2, 4, 5, 7, 9, 11, 0]));
      expect(view.rollScene?.scaleSpans[0]?.rows.length).toBeGreaterThan(0);
      // The tonics, as each dorian is spelt.
      expect(tonics()).toEqual(['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B']);
      const drawn = (): (string | null)[] =>
        [...element('roll-chords-list').querySelectorAll('[data-chord]')].slice(0, 7).map((chord) => chord.textContent);
      element<HTMLButtonElement>('roll-chords-open').click();
      expect(drawn()).toEqual(['Dmi', 'Emii', 'FIII', 'GIV', 'Amv', 'Bdimvi°', 'CVII']);
      // Another scale with the same signature: other chords.
      choose('0', 'major');
      expect(drawn()).toEqual(['CI', 'Dmii', 'Emiii', 'FIV', 'GV', 'Amvi', 'Bdimvii°']);
      // In minor, C sharp rather than D flat; the tonic kept as the scale changes.
      choose('2', 'minor');
      expect(tonics()[1]).toBe('C♯');
      expect(sketches.find(sketch.id)?.key).toEqual({ fifths: -1, mode: 'minor' });
      choose('9', 'harmonicMinor');
      expect(sketches.find(sketch.id)?.key).toEqual({ fifths: 0, mode: 'minor', scale: 'harmonicMinor' });
      expect(new Set(lit())).toEqual(new Set([9, 11, 0, 2, 4, 5, 8]));

      // Another sketch opened says its own key in both lists.
      sketches.begin(
        { events: [], beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })) },
        'Mixolydian',
        2,
        aKeyInTheScale(-2, 'mixolydian'),
      );
      element<HTMLButtonElement>('roll-close').click();
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      expect([tonic.value, scale.value]).toEqual(['5', 'mixolydian']);
    });

    it('changes the metre and the pace from the bar the cursor is in, asked in a sheet, and marks it over the bar', async () => {
      const { view, sketches, clock } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: Array.from({ length: 16 }, (_, at) => [
            { kind: 'noteOn' as const, atMs: at * 500, midi: 60, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: at * 500 + 400, midi: 60 },
          ]).flat(),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Marked',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const mark = element<HTMLButtonElement>('roll-mark');
      const sheet = element('sheet-roll-mark');
      const metre = element<HTMLSelectElement>('roll-mark-metre');
      const tempo = element<HTMLInputElement>('roll-mark-tempo');
      const remove = element<HTMLButtonElement>('roll-mark-remove');
      const undo = element<HTMLButtonElement>('roll-undo');
      const marks = (): string[] => (view.rollScene?.marks ?? []).map((each) => `${each.after}: ${each.says}`);
      const struck = (): number[] =>
        (sketches.find(sketch.id)?.events ?? []).flatMap((event) => (event.kind === 'noteOn' ? [Math.round(event.atMs)] : []));
      // A click alone each time, and never the second of two, which writes a note.
      const cursorAt = (ms: number): void => {
        clock.advance(1_000);
        tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: (ms / 1000) * zoom, clientY: 20 });
      };
      const asked = (): void => {
        mark.click();
      };

      // There while the sketch is edited; the start marked as it is.
      expect([mark.hidden, mark.dataset['away']]).toEqual([false, undefined]);
      expect(marks()).toEqual(['1: C major 4/4 \u2669=120']);

      // Asked a moment into the third bar: from its first beat, as it is there.
      cursorAt(4_200);
      asked();
      expect(sheet.hidden).toBe(false);
      expect(element('roll-mark-title').textContent).toBe('From bar 3, until the next change');
      expect([metre.value, tempo.value]).toEqual(['4/4', '120']);
      expect(remove.hidden).toBe(true);
      // Nothing changed, nothing done.
      element<HTMLButtonElement>('roll-mark-yes').click();
      expect(sheet.hidden).toBe(true);
      expect(undo.dataset['idle']).toBe('true');

      asked();
      metre.value = '3/4';
      tempo.value = '60';
      element<HTMLButtonElement>('roll-mark-yes').click();
      expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: 3/4 \u2669=60']);
      // Before the bar the notes stay; from it each crotchet is twice as long.
      expect(struck().slice(6, 10)).toEqual([3_000, 3_500, 4_000, 5_000]);
      // One change, put back as one.
      undo.click();
      expect(marks()).toEqual(['1: C major 4/4 \u2669=120']);
      expect(struck().slice(6, 10)).toEqual([3_000, 3_500, 4_000, 4_500]);

      // The metre only, by Enter in the pace; then taken away.
      cursorAt(4_200);
      asked();
      metre.value = '3/4';
      tempo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: 3/4']);
      // The first bar's metre changed from the drawer leaves the change after it.
      const firstMetre = element<HTMLSelectElement>('roll-metre');
      firstMetre.value = '2/4';
      firstMetre.dispatchEvent(new Event('change'));
      expect(marks()).toEqual(['1: C major 2/4 \u2669=120', '5: 3/4']);
      cursorAt(4_200);
      asked();
      expect(element('roll-mark-title').textContent).toBe('From bar 5, until the next change');
      expect(remove.hidden).toBe(false);
      remove.click();
      expect(sheet.hidden).toBe(true);
      expect(marks()).toEqual(['1: C major 2/4 \u2669=120']);

      // Cancelled, nothing changes; and a pace past a metronome's is held to it.
      cursorAt(4_200);
      asked();
      tempo.value = '900';
      element<HTMLButtonElement>('roll-mark-no').click();
      expect(sheet.hidden).toBe(true);
      expect(marks()).toEqual(['1: C major 2/4 \u2669=120']);
      asked();
      tempo.value = '900';
      element<HTMLButtonElement>('roll-mark-yes').click();
      expect(marks()).toEqual(['1: C major 2/4 \u2669=120', '5: \u2669=400']);
      // A change of pace alone is taken away as well, asked on its beat - the bar's beats come quicker now.
      cursorAt(4_050);
      asked();
      expect(remove.hidden).toBe(false);
      remove.click();
      expect(marks()).toEqual(['1: C major 2/4 \u2669=120']);
    });

    it('changes the key from the bar the cursor is in, marked over the bar, its chords and its keys followed by the cursor', async () => {
      const { view, sketches, clock } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: Array.from({ length: 16 }, (_, at) => [
            { kind: 'noteOn' as const, atMs: at * 500, midi: 60, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: at * 500 + 400, midi: 60 },
          ]).flat(),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Keyed',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const tonic = element<HTMLSelectElement>('roll-mark-key');
      const scale = element<HTMLSelectElement>('roll-mark-scale');
      const remove = element<HTMLButtonElement>('roll-mark-remove');
      const marks = (): string[] => (view.rollScene?.marks ?? []).map((each) => `${each.after}: ${each.says}`);
      // A click alone each time, and never the second of two, which writes a note.
      const cursorAt = (ms: number): void => {
        clock.advance(1_000);
        tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: (ms / 1000) * zoom, clientY: 20 });
      };
      const change = (pitchClass: string, name: string): void => {
        element<HTMLButtonElement>('roll-mark').click();
        tonic.value = pitchClass;
        scale.value = name;
        element<HTMLButtonElement>('roll-mark-yes').click();
      };
      const firstChord = (): string | null =>
        element('roll-chords-list').querySelector('[data-chord]')?.textContent ?? null;
      const inScale = (midi: number): boolean =>
        element('roll-body').querySelector<HTMLElement>(`.roll__key[data-midi='${String(midi)}']`)?.dataset['inScale'] === 'true';
      element<HTMLButtonElement>('roll-chords-open').click();

      // Asked in the third bar: the key there, in both lists.
      cursorAt(4_200);
      element<HTMLButtonElement>('roll-mark').click();
      expect([tonic.value, scale.value]).toEqual(['0', 'major']);
      // Another scale in the sheet names the tonics as it spells them.
      scale.value = 'minor';
      scale.dispatchEvent(new Event('change'));
      expect(tonic.options[1]?.textContent).toBe('C\u266f');
      element<HTMLButtonElement>('roll-mark-no').click();

      change('7', 'major');
      expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: G major']);
      // Asked there again, the lists say the key the bar is in now.
      element<HTMLButtonElement>('roll-mark').click();
      expect([tonic.value, scale.value]).toEqual(['7', 'major']);
      element<HTMLButtonElement>('roll-mark-no').click();
      expect(theKeyChangesOf(sketches.find(sketch.id)?.events ?? [])).toEqual([{ atMs: 4_000, fifths: 1, scale: 'major' }]);
      expect(view.rollScene?.scaleSpans.map((span) => span.fromMs)).toEqual([Number.NEGATIVE_INFINITY, 4_000]);
      // The cursor in it: G's chords, and F sharp on the strip rather than F.
      expect(firstChord()).toBe('GI');
      expect([inScale(66), inScale(65)]).toEqual([true, false]);
      // The cursor back in the first bar: C's.
      cursorAt(1_000);
      expect(firstChord()).toBe('CI');
      expect([inScale(66), inScale(65)]).toEqual([false, true]);
      // Carried past the change by a playback, they follow it there; still short of it, they wait.
      vi.useFakeTimers();
      try {
        element<HTMLButtonElement>('roll-play').click();
        const playOn = (ms: number): void => {
          for (let gone = 0; gone < ms; gone += 100) {
            clock.advance(100);
            vi.advanceTimersByTime(100);
          }
        };
        // Nothing marked again on the strip while it stays in one key.
        const marking = new MutationObserver(() => undefined);
        marking.observe(element('roll-body'), { subtree: true, attributeFilter: ['data-in-scale'] });
        playOn(2_800);
        expect([inScale(66), inScale(65), firstChord()]).toEqual([false, true, 'CI']);
        expect(marking.takeRecords()).toEqual([]);
        marking.disconnect();
        playOn(400);
        expect([inScale(66), inScale(65), firstChord()]).toEqual([true, false, 'GI']);
        element<HTMLButtonElement>('roll-stop').click();
      } finally {
        vi.useRealTimers();
      }
      // Put back as one change.
      element<HTMLButtonElement>('roll-undo').click();
      expect(marks()).toEqual(['1: C major 4/4 \u2669=120']);

      // A change taken away where it alone changes there.
      cursorAt(4_200);
      change('7', 'major');
      cursorAt(4_200);
      element<HTMLButtonElement>('roll-mark').click();
      expect(remove.hidden).toBe(false);
      remove.click();
      expect(marks()).toEqual(['1: C major 4/4 \u2669=120']);

      // The first bar's key is the sketch's own: the drawer's lists say it, and
      // a later change to the same key changes nothing any more.
      change('7', 'major');
      cursorAt(200);
      change('7', 'major');
      expect(sketches.find(sketch.id)?.key).toEqual({ fifths: 1, mode: 'major' });
      expect([element<HTMLSelectElement>('roll-key').value, element<HTMLSelectElement>('roll-scale').value]).toEqual(['7', 'major']);
      expect(marks()).toEqual(['1: G major 4/4 \u2669=120']);
      change('2', 'dorian');
      expect(sketches.find(sketch.id)?.key).toEqual({ fifths: 0, mode: 'minor', scale: 'dorian' });
      expect(marks()).toEqual(['1: D dorian 4/4 \u2669=120']);
      // A key spelt its own way stays so where only the metre changes: C sharp, not D flat.
      sketches.changeTheKey(sketch.id, { fifths: 7, mode: 'major' });
      cursorAt(200);
      element<HTMLButtonElement>('roll-mark').click();
      element<HTMLSelectElement>('roll-mark-metre').value = '3/4';
      element<HTMLButtonElement>('roll-mark-yes').click();
      expect(sketches.find(sketch.id)?.key).toEqual({ fifths: 7, mode: 'major' });
      expect(marks()).toEqual(['1: C\u266f major 3/4 \u2669=120']);
    });

    it('changes the key and the pace from a beat inside a bar, a flag of its own there, and the metre from the bar it is in', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: Array.from({ length: 16 }, (_, at) => [
            { kind: 'noteOn' as const, atMs: at * 500, midi: 60, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: at * 500 + 400, midi: 60 },
          ]).flat(),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Beats',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const metre = element<HTMLSelectElement>('roll-mark-metre');
      const tempo = element<HTMLInputElement>('roll-mark-tempo');
      const remove = element<HTMLButtonElement>('roll-mark-remove');
      const title = element('roll-mark-title');
      const marks = (): string[] => (view.rollScene?.marks ?? []).map((each) => `${each.after}: ${each.says}`);
      const struck = (): number[] =>
        (sketches.find(sketch.id)?.events ?? []).flatMap((event) => (event.kind === 'noteOn' ? [Math.round(event.atMs)] : []));
      const askedAt = (ms: number): void => {
        tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: (ms / 1000) * zoom, clientY: 20 });
        element<HTMLButtonElement>('roll-mark').click();
      };

      // On the third bar's first beat, the key; the metre as it always was.
      askedAt(4_200);
      expect(title.textContent).toBe('From bar 3, until the next change');
      expect(metre.dataset['idle']).toBeUndefined();
      element<HTMLSelectElement>('roll-mark-key').value = '7';
      element<HTMLButtonElement>('roll-mark-yes').click();

      // On its third beat, the pace: a flag of its own in the same bar, over no bar line.
      askedAt(5_200);
      expect(title.textContent).toBe('From bar 3, beat 3, until the next change. The score shows a key changed here from the next bar.');
      expect([metre.value, tempo.value, remove.hidden]).toEqual(['4/4', '120', true]);
      expect(metre.dataset['idle']).toBe('true');
      expect(metre.title).toBe('A metre begins a bar: chosen here, it changes from the start of bar 3');
      tempo.value = '60';
      element<HTMLButtonElement>('roll-mark-yes').click();
      expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: G major', ': \u2669=60']);
      // The beats before it as they were; from it each crotchet twice as long.
      expect(struck().slice(8, 12)).toEqual([4_000, 4_500, 5_000, 6_000]);
      const flags = [...element('roll-body').querySelectorAll<HTMLElement>('.roll__mark')];
      expect(flags.map((flag) => flag.title)).toEqual([
        'Bar 1: C major 4/4 \u2669=120. Tap to choose it, and again to change it.',
        'Bar 3: G major. Tap to choose it, and again to change it.',
        'Bar 3, beat 3: \u2669=60. Tap to choose it, and again to change it.',
      ]);

      // Its key too, on the same beat: still the one flag there. Each tap a
      // little way from the last, or two would be a double tap, which writes a note.
      askedAt(5_450);
      element<HTMLSelectElement>('roll-mark-key').value = '2';
      element<HTMLButtonElement>('roll-mark-yes').click();
      expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: G major', ': D major \u2669=60']);

      // Taken away there, both go, and the bar's own change stays.
      askedAt(5_150);
      expect(remove.hidden).toBe(false);
      remove.click();
      expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: G major']);
      expect(struck().slice(8, 12)).toEqual([4_000, 4_500, 5_000, 5_500]);

      // A metre chosen inside a bar is counted from that bar's first beat.
      askedAt(5_400);
      metre.value = '3/4';
      element<HTMLButtonElement>('roll-mark-yes').click();
      expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: G major 3/4']);
    });

    it('marks a dynamic from a beat in the sheet of a flag, prints it in the sketch written down, and copies it with the flag', async () => {
      const { view, sketches, clock, runtime } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: Array.from({ length: 16 }, (_, at) => [
            { kind: 'noteOn' as const, atMs: at * 500, midi: 60, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: at * 500 + 400, midi: 60 },
          ]).flat(),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Dynamics',
        1,
      );
      const written: string[] = [];
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string): Promise<void> => {
            written.push(text);
            return Promise.resolve();
          },
          readText: (): Promise<string> => Promise.resolve(written.at(-1) ?? ''),
        },
      });
      try {
        element<HTMLButtonElement>('focus-scores').click();
        element<HTMLButtonElement>('scores-show-sketches').click();
        rowButton('sketches-list', 'Edit this sketch').click();
        const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
        const body = element('roll-body');
        const dynamic = element<HTMLSelectElement>('roll-mark-dynamic');
        const remove = element<HTMLButtonElement>('roll-mark-remove');
        const marks = (): string[] => (view.rollScene?.marks ?? []).map((each) => `${each.after}: ${each.says}`);
        const marked = (): string[] =>
          (sketches.find(sketch.id)?.events ?? []).flatMap((event) => (event.kind === 'dynamic' ? [`${String(event.atMs)} ${event.level}`] : []));
        const across = (ms: number): number =>
          (ms / 1000) * zoom - (Number.parseFloat(body.querySelector<HTMLElement>('.roll__head')?.style.getPropertyValue('--roll-x') ?? '0') || 0);
        const cursorAt = (ms: number): void => {
          clock.advance(1_000);
          tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: across(ms), clientY: 20 });
        };
        const ask = (ms: number): void => {
          cursorAt(ms);
          element<HTMLButtonElement>('roll-mark').click();
        };
        const yes = (): void => {
          element<HTMLButtonElement>('roll-mark-yes').click();
        };
        const key = (init: KeyboardEventInit): void => {
          document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
        };

        // Marked nowhere yet: the list says none, on any beat.
        ask(4_200);
        expect([dynamic.value, [...dynamic.options].map((option) => option.value)]).toEqual([
          '',
          ['', 'pp', 'p', 'mp', 'mf', 'f', 'ff'],
        ]);
        // Forte from the third bar's first beat, marked on its flag.
        dynamic.value = 'f';
        yes();
        expect(marked()).toEqual(['4000 f']);
        expect(marks()).toEqual(['1: C major 4/4 ♩=120', '3: f']);
        // Further on it is in forte, marked there by nothing to take away.
        ask(6_200);
        expect([dynamic.value, remove.hidden]).toEqual(['f', true]);
        element<HTMLButtonElement>('roll-mark-no').click();
        // On the first beat, piano, beside the sketch's own key, metre and pace.
        ask(100);
        expect([dynamic.value, remove.hidden]).toEqual(['', true]);
        dynamic.value = 'p';
        yes();
        expect(marks()).toEqual(['1: C major 4/4 ♩=120 p', '3: f']);
        // Taken away on the first beat by its button, which has nothing else to give back there.
        ask(100);
        expect(remove.hidden).toBe(false);
        remove.click();
        expect(marked()).toEqual(['4000 f']);
        // And by none in the list, on the third bar.
        ask(4_200);
        expect(remove.hidden).toBe(false);
        dynamic.value = '';
        yes();
        expect(marked()).toEqual([]);
        // Each one change, put back as one.
        key({ key: 'z', code: 'KeyZ', ctrlKey: true });
        expect(marked()).toEqual(['4000 f']);
        // Its button there gives the beat back what the beat before it is in: none.
        ask(4_200);
        remove.click();
        expect(marked()).toEqual([]);
        key({ key: 'z', code: 'KeyZ', ctrlKey: true });
        expect(marked()).toEqual(['4000 f']);

        // Copied with its flag and pasted on another beat: forte there too.
        const flag = [...body.querySelectorAll<HTMLElement>('.roll__mark')].find((each) => each.textContent === '3 f');
        const init = { bubbles: true, cancelable: true, pointerId: 82, pointerType: 'mouse', button: 0 };
        flag?.dispatchEvent(new PointerEvent('pointerdown', init));
        body.dispatchEvent(new PointerEvent('pointerup', init));
        key({ key: 'c', code: 'KeyC', ctrlKey: true });
        expect(JSON.parse(written.at(-1) ?? '{}')).toMatchObject({ change: { dynamic: 'f' } });
        // Piano in between, so forte pasted after it is a change again.
        ask(5_200);
        dynamic.value = 'p';
        yes();
        cursorAt(7_200);
        const pasted = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(pasted, 'clipboardData', {
          value: { getData: (type: string): string => (type === 'text/plain' ? (written.at(-1) ?? '') : '') },
        });
        document.body.dispatchEvent(pasted);
        expect(marked()).toEqual(['4000 f', '5000 p', '7000 f']);
        // A flag of another change, on a beat only in the dynamic before it,
        // is copied without one.
        ask(6_200);
        element<HTMLSelectElement>('roll-mark-key').value = '7';
        yes();
        const keyFlag = [...body.querySelectorAll<HTMLElement>('.roll__mark')].find((each) => each.textContent === '4 G major');
        keyFlag?.dispatchEvent(new PointerEvent('pointerdown', init));
        body.dispatchEvent(new PointerEvent('pointerup', init));
        key({ key: 'c', code: 'KeyC', ctrlKey: true });
        expect((JSON.parse(written.at(-1) ?? '{}') as { change?: object }).change).toEqual({ key: { fifths: 1, scale: 'major' } });
        key({ key: 'z', code: 'KeyZ', ctrlKey: true });

        // Written down, the page prints them on their beats.
        element<HTMLButtonElement>('roll-close').click();
        element<HTMLButtonElement>('focus-scores').click();
        element<HTMLButtonElement>('scores-show-sketches').click();
        rowButton('sketches-list', 'Write this sketch down as a score').click();
        await vi.waitFor(() => {
          expect(runtime.controller.openedExercise?.title).toBe('Dynamics');
        });
        expect(
          runtime.controller.openedExercise?.dynamicMarks.map(({ measureIndex, offsetTicks, level }) => [measureIndex, offsetTicks / Duration.QUARTER.ticks, level]),
        ).toEqual([
          [2, 0, 'f'],
          [2, 2, 'p'],
          [3, 2, 'f'],
        ]);
      } finally {
        Reflect.deleteProperty(window.navigator, 'clipboard');
      }
    });

    it('reaches a dynamic gradually from the one marked before, says so on its flag, copies it so, and prints a hairpin', async () => {
      const { view, sketches, clock, runtime } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: Array.from({ length: 16 }, (_, at) => [
            { kind: 'noteOn' as const, atMs: at * 500, midi: 60, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: at * 500 + 400, midi: 60 },
          ]).flat(),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Swelling',
        1,
      );
      const written: string[] = [];
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string): Promise<void> => {
            written.push(text);
            return Promise.resolve();
          },
          readText: (): Promise<string> => Promise.resolve(written.at(-1) ?? ''),
        },
      });
      try {
        element<HTMLButtonElement>('focus-scores').click();
        element<HTMLButtonElement>('scores-show-sketches').click();
        rowButton('sketches-list', 'Edit this sketch').click();
        const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
        const body = element('roll-body');
        const dynamic = element<HTMLSelectElement>('roll-mark-dynamic');
        const reached = element<HTMLSelectElement>('roll-mark-reached');
        const marks = (): string[] => (view.rollScene?.marks ?? []).map((each) => `${each.after}: ${each.says}`);
        const marked = (): string[] =>
          (sketches.find(sketch.id)?.events ?? []).flatMap((event) =>
            event.kind === 'dynamic' ? [`${String(event.atMs)} ${event.level}${event.gradually === true ? ' gradually' : ''}`] : [],
          );
        const across = (ms: number): number =>
          (ms / 1000) * zoom - (Number.parseFloat(body.querySelector<HTMLElement>('.roll__head')?.style.getPropertyValue('--roll-x') ?? '0') || 0);
        const ask = (ms: number): void => {
          clock.advance(1_000);
          tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: across(ms), clientY: 20 });
          element<HTMLButtonElement>('roll-mark').click();
        };
        const choose = (level: string): void => {
          dynamic.value = level;
          dynamic.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const yes = (): void => {
          element<HTMLButtonElement>('roll-mark-yes').click();
        };
        const idle = (): [boolean, string] => [reached.dataset['idle'] === 'true', reached.title];
        const key = (init: KeyboardEventInit): void => {
          document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
        };

        // Nothing marked before the first beat to come from: at once, and dimmed saying why.
        ask(100);
        expect([reached.value, [...reached.options].map((option) => option.label)]).toEqual(['', ['at once', 'gradually']]);
        expect(idle()).toEqual([true, 'Nothing is marked before this beat to come from gradually: the dynamic is reached at once']);
        choose('p');
        reached.value = 'gradually';
        yes();
        expect(marked()).toEqual(['0 p']);
        // On the third bar, in piano already: nothing to reach; forte chosen, gradually from it.
        ask(4_200);
        expect(idle()).toEqual([true, 'The music is in p already: there is nothing to reach gradually']);
        // Asked for all the same, nothing: no change, and undoing undoes the piano before it.
        reached.value = 'gradually';
        yes();
        key({ key: 'z', code: 'KeyZ', ctrlKey: true });
        expect(marked()).toEqual([]);
        ask(100);
        choose('p');
        yes();
        ask(4_200);
        choose('f');
        expect(idle()).toEqual([false, 'Whether f is reached at once here, or gradually from p']);
        reached.value = 'gradually';
        yes();
        expect(marked()).toEqual(['0 p', '4000 f gradually']);
        expect(marks()).toEqual(['1: C major 4/4 ♩=120 p', '3: < f']);
        // Asked again, the sheet says so; further on, at once, which it is only in.
        ask(4_200);
        expect([dynamic.value, reached.value]).toEqual(['f', 'gradually']);
        element<HTMLButtonElement>('roll-mark-no').click();
        ask(6_200);
        expect([dynamic.value, reached.value]).toEqual(['f', '']);
        element<HTMLButtonElement>('roll-mark-no').click();
        // Only how it is reached changed is a change, put back as one.
        ask(4_200);
        reached.value = '';
        yes();
        expect(marks()).toEqual(['1: C major 4/4 ♩=120 p', '3: f']);
        key({ key: 'z', code: 'KeyZ', ctrlKey: true });
        expect(marks()).toEqual(['1: C major 4/4 ♩=120 p', '3: < f']);

        // Copied so, and pasted after a forte: softer gradually from it.
        const flag = [...body.querySelectorAll<HTMLElement>('.roll__mark')].find((each) => each.textContent === '3 < f');
        const init = { bubbles: true, cancelable: true, pointerId: 83, pointerType: 'mouse', button: 0 };
        flag?.dispatchEvent(new PointerEvent('pointerdown', init));
        body.dispatchEvent(new PointerEvent('pointerup', init));
        key({ key: 'c', code: 'KeyC', ctrlKey: true });
        expect((JSON.parse(written.at(-1) ?? '{}') as { change?: object }).change).toEqual({ dynamic: 'f', gradually: true });
        ask(5_200);
        choose('ff');
        yes();
        clock.advance(1_000);
        tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: across(7_200), clientY: 20 });
        const pasted = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(pasted, 'clipboardData', {
          value: { getData: (type: string): string => (type === 'text/plain' ? (written.at(-1) ?? '') : '') },
        });
        document.body.dispatchEvent(pasted);
        expect(marked()).toEqual(['0 p', '4000 f gradually', '5000 ff', '7000 f gradually']);
        expect(marks()).toEqual(['1: C major 4/4 ♩=120 p', '3: < f', ': ff', ': > f']);

        // Written down, each a hairpin from the dynamic before it.
        element<HTMLButtonElement>('roll-close').click();
        element<HTMLButtonElement>('focus-scores').click();
        element<HTMLButtonElement>('scores-show-sketches').click();
        rowButton('sketches-list', 'Write this sketch down as a score').click();
        await vi.waitFor(() => {
          expect(runtime.controller.openedExercise?.title).toBe('Swelling');
        });
        expect(
          runtime.controller.openedExercise?.hairpins.map(({ measureIndex, offsetTicks, kind, untilMeasureIndex, untilOffsetTicks }) => [
            measureIndex,
            offsetTicks / Duration.QUARTER.ticks,
            kind,
            untilMeasureIndex,
            untilOffsetTicks / Duration.QUARTER.ticks,
          ]),
        ).toEqual([
          [0, 0, 'crescendo', 2, 0],
          [2, 2, 'diminuendo', 3, 2],
        ]);
      } finally {
        Reflect.deleteProperty(window.navigator, 'clipboard');
      }
    });

    it('copies and cuts a flag by the keys or its buttons, and pastes what it changes on the beat the cursor is on', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: Array.from({ length: 16 }, (_, at) => [
            { kind: 'noteOn' as const, atMs: at * 500, midi: 60, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: at * 500 + 400, midi: 60 },
          ]).flat(),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Copied',
        1,
      );
      const written: string[] = [];
      let readBack = (): Promise<string> => Promise.resolve(written.at(-1) ?? '');
      Object.defineProperty(window.navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (text: string): Promise<void> => {
            written.push(text);
            return Promise.resolve();
          },
          readText: (): Promise<string> => readBack(),
        },
      });
      try {
        element<HTMLButtonElement>('focus-scores').click();
        element<HTMLButtonElement>('scores-show-sketches').click();
        rowButton('sketches-list', 'Edit this sketch').click();
        const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
        const body = element('roll-body');
        const marks = (): string[] => (view.rollScene?.marks ?? []).map((each) => `${each.after}: ${each.says}`);
        const flag = (text: string): HTMLElement | undefined =>
          [...body.querySelectorAll<HTMLElement>('.roll__mark')].find((each) => each.textContent === text);
        const pressed = (): (string | null)[] =>
          [...body.querySelectorAll<HTMLElement>('.roll__mark')].filter((each) => each.getAttribute('aria-pressed') === 'true').map((each) => each.textContent);
        // Pressed and let go, as a real press is: a press never let go of is a
        // finger still down. Let go of over the drawing, which a flag chosen
        // has drawn afresh under the pointer.
        const pressAndLetGo = (on: Element | null | undefined): void => {
          const init = { bubbles: true, cancelable: true, pointerId: 81, pointerType: 'mouse', button: 0 };
          on?.dispatchEvent(new PointerEvent('pointerdown', init));
          body.dispatchEvent(new PointerEvent('pointerup', init));
        };
        const press = (text: string): void => {
          pressAndLetGo(flag(text));
        };
        const tool = (name: string): HTMLButtonElement | null => body.querySelector<HTMLButtonElement>(`.roll__mark-tools .roll__mark-${name}`);
        const key = (init: KeyboardEventInit): KeyboardEvent => {
          const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
          document.body.dispatchEvent(event);
          return event;
        };
        const pasteEvent = (text: string): Event => {
          const event = new Event('paste', { bubbles: true, cancelable: true });
          Object.defineProperty(event, 'clipboardData', {
            value: { getData: (type: string): string => (type === 'text/plain' ? text : '') },
          });
          document.body.dispatchEvent(event);
          return event;
        };
        // The drawing follows the cursor across, so a tap is aimed where it is scrolled to.
        const across = (ms: number): number =>
          (ms / 1000) * zoom - (Number.parseFloat(body.querySelector<HTMLElement>('.roll__head')?.style.getPropertyValue('--roll-x') ?? '0') || 0);
        const cursorAt = (ms: number): void => {
          tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: across(ms), clientY: 20 });
        };
        // And down, to the row of middle C, which every note is on.
        const onTheNoteAt = (ms: number): void => {
          const scrolledDown =
            Number.parseFloat(body.querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0') || 0;
          const highest = view.rollScene?.highest ?? 0;
          tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: across(ms), clientY: (highest - 60 + 0.5) * 13 - scrolledDown });
        };
        const chosenNotes = (): number[] => (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => note.fromMs);
        const undo = (): void => {
          key({ key: 'z', code: 'KeyZ', ctrlKey: true });
        };

        // The third bar in G major and 3/4.
        cursorAt(4_200);
        element<HTMLButtonElement>('roll-mark').click();
        element<HTMLSelectElement>('roll-mark-key').value = '7';
        element<HTMLSelectElement>('roll-mark-metre').value = '3/4';
        element<HTMLButtonElement>('roll-mark-yes').click();
        expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: G major 3/4']);

        // A note chosen, then the flag: the note let go of; and back.
        onTheNoteAt(100);
        expect(chosenNotes()).toEqual([0]);
        press('3 G major 3/4');
        expect([pressed(), chosenNotes()]).toEqual([['3 G major 3/4'], []]);
        onTheNoteAt(600);
        expect([pressed(), chosenNotes()]).toEqual([[], [500]]);

        // Ctrl+C copies what the flag changes, and nothing it does not: no pace.
        press('3 G major 3/4');
        expect(key({ key: 'c', code: 'KeyC', ctrlKey: true }).defaultPrevented).toBe(true);
        expect(written.map((text) => theChangeOnTheClipboard(text))).toEqual([
          { key: { fifths: 1, scale: 'major' }, metre: { beatsInBar: 3, beatType: 4 } },
        ]);
        expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: G major 3/4']);
        expect(tool('copy')?.title).toBe('Copy the change at bar 3, to paste where the cursor is');
        expect(tool('cut')?.title).toBe('Cut the change at bar 3, to paste where the cursor is');

        // Pasted on the second bar: the change there, the third bar's now nothing new; the pasted flag chosen.
        cursorAt(2_100);
        expect(pasteEvent(written[0] ?? '').defaultPrevented).toBe(true);
        expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '2: G major 3/4']);
        expect(pressed()).toEqual(['2 G major 3/4']);
        // One change, put back as one.
        undo();
        expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: G major 3/4']);

        // Pasted on a beat inside a bar: the key from that beat, the metre from its bar.
        cursorAt(1_000);
        pasteEvent(written[0] ?? '');
        expect(marks()).toEqual(['1: C major 3/4 \u2669=120', ': G major']);
        undo();

        // Ctrl+X copies it and takes it away. The drawer's button pastes what
        // the clipboard holds, before what was copied here.
        press('3 G major 3/4');
        expect(key({ key: 'x', code: 'KeyX', metaKey: true }).defaultPrevented).toBe(true);
        expect(marks()).toEqual(['1: C major 4/4 \u2669=120']);
        expect(theChangeOnTheClipboard(written.at(-1) ?? '')).toEqual({ key: { fifths: 1, scale: 'major' }, metre: { beatsInBar: 3, beatType: 4 } });
        readBack = (): Promise<string> => Promise.resolve(theClipboardTextOfTheChange({ key: { fifths: 2, scale: 'major' } }));
        cursorAt(6_100);
        element<HTMLButtonElement>('roll-chords-open').click();
        const pasteButton = element<HTMLButtonElement>('roll-paste');
        const pasted = async (): Promise<void> => {
          pasteButton.click();
          await Promise.resolve();
          await Promise.resolve();
        };
        await pasted();
        expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '4: D major']);

        // Its buttons: the copy copies, and the cut takes away. Copied after
        // notes were, and with something else on the clipboard, the button
        // pastes it rather than the notes.
        onTheNoteAt(1_100);
        key({ key: 'c', code: 'KeyC', ctrlKey: true });
        expect(theNotesOnTheClipboard(written.at(-1) ?? '')).toHaveLength(1);
        press('4 D major');
        pressAndLetGo(tool('copy'));
        expect(theChangeOnTheClipboard(written.at(-1) ?? '')).toEqual({ key: { fifths: 2, scale: 'major' } });
        expect(marks()).toHaveLength(2);
        pressAndLetGo(tool('cut'));
        expect(marks()).toEqual(['1: C major 4/4 \u2669=120']);
        readBack = (): Promise<string> => Promise.resolve('G major');
        cursorAt(4_100);
        const notesStruck = (): number => (sketches.find(sketch.id)?.events ?? []).filter((event) => event.kind === 'noteOn').length;
        const notesBefore = notesStruck();
        await pasted();
        expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: D major']);
        expect(notesStruck()).toBe(notesBefore);

        // Only what a flag changes is copied: a scale alone, on the signature
        // of the bar before, is still a change of key; and a pace alone.
        cursorAt(6_100);
        element<HTMLButtonElement>('roll-mark').click();
        element<HTMLSelectElement>('roll-mark-key').value = '11';
        element<HTMLSelectElement>('roll-mark-scale').value = 'minor';
        element<HTMLButtonElement>('roll-mark-yes').click();
        expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: D major', '4: B minor']);
        press('4 B minor');
        key({ key: 'c', code: 'KeyC', ctrlKey: true });
        expect(theChangeOnTheClipboard(written.at(-1) ?? '')).toEqual({ key: { fifths: 2, scale: 'minor' } });
        undo();
        cursorAt(6_200);
        element<HTMLButtonElement>('roll-mark').click();
        element<HTMLInputElement>('roll-mark-tempo').value = '90';
        element<HTMLButtonElement>('roll-mark-yes').click();
        press('4 \u2669=90');
        key({ key: 'c', code: 'KeyC', ctrlKey: true });
        expect(theChangeOnTheClipboard(written.at(-1) ?? '')).toEqual({ crotchetsPerMinute: 90 });
        undo();
        expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: D major']);

        // The first flag is copied whole, and cut never: Ctrl+X and its dimmed button leave it.
        press('1 C major 4/4 \u2669=120');
        key({ key: 'c', code: 'KeyC', ctrlKey: true });
        expect(theChangeOnTheClipboard(written.at(-1) ?? '')).toEqual({
          key: { fifths: 0, scale: 'major' },
          metre: { beatsInBar: 4, beatType: 4 },
          crotchetsPerMinute: 120,
        });
        const copies = written.length;
        key({ key: 'x', code: 'KeyX', ctrlKey: true });
        expect(tool('cut')?.dataset['idle']).toBe('true');
        pressAndLetGo(tool('cut'));
        expect([written.length, marks()]).toEqual([copies, ['1: C major 4/4 \u2669=120', '3: D major']]);

        // With no clipboard to cut to, a cut takes nothing away - but what it
        // copied here is there for the paste button, which says so.
        Reflect.deleteProperty(window.navigator, 'clipboard');
        press('3 D major');
        key({ key: 'x', code: 'KeyX', ctrlKey: true });
        expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: D major']);
        expect(pasteButton.dataset['idle']).toBeUndefined();

        // A change on the clipboard is not pasted onto a sketch only listened to.
        element<HTMLButtonElement>('roll-edit').click();
        cursorAt(6_300);
        expect(pasteEvent(written[0] ?? '').defaultPrevented).toBe(false);
        expect(marks()).toEqual(['1: C major 4/4 \u2669=120', '3: D major']);
      } finally {
        Reflect.deleteProperty(window.navigator, 'clipboard');
      }
    });

    it('shows the notes of a chord pointed at where it would write them, and writes them there', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      sketches.begin(
        {
          events: Array.from({ length: 16 }, (_, at) => [
            { kind: 'noteOn' as const, atMs: at * 500, midi: 60, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: at * 500 + 400, midi: 60 },
          ]).flat(),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Ahead',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      element<HTMLButtonElement>('roll-chords-open').click();
      const chords = (): HTMLElement[] => [...element('roll-chords-list').querySelectorAll<HTMLElement>('[data-chord]')];
      const over = (on: Element, init: PointerEventInit = {}): void => {
        on.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse', ...init }));
      };
      const out = (from: Element, to: Element | null): void => {
        from.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse', relatedTarget: to }));
      };
      const ahead = (): string[] =>
        view.rollNotesShownAhead.map((note) => `${String(note.fromMs)}-${String(note.untilMs)}:${String(note.row)}`).sort();
      const notesAt = (fromMs: number): string[] =>
        (view.rollScene?.notes ?? [])
          .filter((note) => note.fromMs === fromMs)
          .map((note) => `${String(note.fromMs)}-${String(note.untilMs)}:${String(note.row)}`)
          .sort();
      // The cursor on the fourth beat, between the notes already there.
      tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: 1.55 * zoom, clientY: 20 });

      expect(ahead()).toEqual([]);
      const first = chords()[0];
      if (first === undefined) {
        throw new Error('expected a chord in the drawer');
      }
      // Pointed at: its notes where it would write them, from the cursor's line to the next.
      over(first.querySelector('span') ?? first);
      const shown = ahead();
      expect(shown.length).toBeGreaterThan(1);
      expect(shown.every((note) => note.startsWith('1500-2000:'))).toBe(true);
      // Written: exactly those, and, still pointed at, shown where the next would go.
      const before = notesAt(1_500);
      first.click();
      expect(notesAt(1_500).filter((note) => !before.includes(note))).toEqual(shown.filter((note) => !before.includes(note)));
      expect(ahead().every((note) => note.startsWith('2000-2500:'))).toBe(true);
      // A key already sounding where it would go is not shown, as it is not written:
      // middle C sounds from two seconds.
      const cRow = (view.rollScene?.highest ?? 0) - 60;
      expect(ahead()).not.toContain(`2000-2500:${String(cRow)}`);

      // Moved onto the next chord, its notes; off them all, none.
      const second = chords()[1];
      if (second === undefined) {
        throw new Error('expected a second chord');
      }
      out(first, second);
      over(second);
      expect(ahead()).not.toEqual([]);
      expect(ahead()).not.toEqual(shown.map((note) => note.replace('1500-2000', '2000-2500')));
      out(second, element('roll-body'));
      expect(ahead()).toEqual([]);
      // Moving between the parts of one chord's button keeps it.
      over(second);
      const inside = second.querySelector('span');
      out(second, inside);
      expect(ahead()).not.toEqual([]);

      // Deleting kept chords, or put away, the drawer shows nothing ahead -
      // at once, under a pointer that has not moved.
      element<HTMLButtonElement>('roll-chords-keep').click();
      over(chords()[0] ?? first);
      expect(ahead()).not.toEqual([]);
      element<HTMLButtonElement>('roll-chords-forget').click();
      expect(ahead()).toEqual([]);
      over(chords()[0] ?? first);
      expect(ahead()).toEqual([]);
      element<HTMLButtonElement>('roll-chords-forget').click();
      over(chords()[1] ?? second);
      expect(ahead()).not.toEqual([]);
      element<HTMLButtonElement>('roll-chords-open').click();
      expect(ahead()).toEqual([]);
    });

    it('records the instrument into a sketch from the cursor after a count-in, over what is there, to the sketch\'s own beat', async () => {
      const { view, sketches, runtime, clock, metronome, midi } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ countInBars: 1 });
      const sketch = sketches.begin(
        {
          events: Array.from({ length: 16 }, (_, at) => [
            { kind: 'noteOn' as const, atMs: at * 500, midi: 60, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: at * 500 + 400, midi: 60 },
          ]).flat(),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Recorded',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const record = element<HTMLButtonElement>('roll-record');
      const player = runtime.takePlayer;
      const struck = (pitch: number): number[] =>
        (sketches.find(sketch.id)?.events ?? []).flatMap((event) => (event.kind === 'noteOn' && event.midi === pitch ? [event.atMs] : []));
      const pedal = (): number[][] =>
        (sketches.find(sketch.id)?.events ?? []).flatMap((event) => (event.kind === 'sustain' ? [[event.atMs, event.value]] : []));
      const chosen = (): number[] => (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => note.fromMs);
      element<HTMLInputElement>('roll-click').checked = true;
      // How many are listening to the instrument from here on: one while it records.
      let listening = 0;
      const subscribe = midi.subscribe.bind(midi);
      vi.spyOn(midi, 'subscribe').mockImplementation((listener) => {
        listening += 1;
        const off = subscribe(listener);
        return () => {
          listening -= 1;
          off();
        };
      });

      // There while the sketch is edited, saying how long the count-in is.
      expect([record.hidden, record.dataset['away']]).toEqual([false, undefined]);
      expect(record.title).toBe('Record into the sketch from the cursor, after 1 bar counted in');
      // The cursor on the second bar.
      tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: 2.05 * zoom, clientY: 20 });

      vi.useFakeTimers();
      try {
        metronome.clicks.length = 0;
        const pressedAt = clock.now();
        record.click();
        expect(record.getAttribute('aria-pressed')).toBe('true');
        expect(record.title).toBe('Stop recording, and write in what was played');
        // A bar counted in at the sketch's own pace, and nothing sounding yet.
        expect(metronome.clicks.map((click) => [(click.atMs ?? 0) - pressedAt, click.weight])).toEqual([
          [0, 'downbeat'],
          [500, 'beat'],
          [1_000, 'beat'],
          [1_500, 'beat'],
        ]);
        expect(player.playing).toBeNull();
        expect(listening).toBe(1);
        // Struck a little before the first beat: the first beat's. Earlier: not recorded.
        midi.noteOn(64, pressedAt + 1_000);
        midi.noteOff(64, pressedAt + 1_100);
        midi.noteOn(67, pressedAt + 1_900);
        clock.set(pressedAt + 2_000);
        vi.advanceTimersByTime(2_000);
        // Then what is written sounds from the cursor, under the playing, and the beat goes on.
        expect(player.playing).not.toBeNull();
        expect(player.positionMs).toBe(2_000);
        expect(metronome.clicks.map((click) => (click.atMs ?? 0) - pressedAt).slice(4, 5)).toEqual([2_000]);
        midi.noteOff(67, pressedAt + 2_200);
        midi.pedal(true, pressedAt + 2_300);
        // Seen the moment it is struck, before any tick.
        const live = (): string[] =>
          view.rollNotesBeingRecorded.map((note) => `${String((view.rollScene?.highest ?? 0) - note.row)}:${String(note.fromMs)}-${String(note.untilMs)}`);
        // Struck while the C written there sounds: left out, as it will be when written in.
        midi.noteOn(60, pressedAt + 2_100);
        midi.noteOff(60, pressedAt + 2_200);
        clock.set(pressedAt + 2_750);
        midi.noteOn(65, pressedAt + 2_750);
        expect(live()).toEqual(['67:1900-2200', '65:2750-2750']);
        clock.set(pressedAt + 2_000);
        for (let step = 0; step < 10; step += 1) {
          clock.advance(100);
          vi.advanceTimersByTime(80);
        }
        expect(metronome.clicks.map((click) => (click.atMs ?? 0) - pressedAt).slice(4, 7)).toEqual([2_000, 2_500, 3_000]);
        expect(headAt(element('roll-body'))).toBe('3.000');
        // Played so far, where it goes: a key still down as far as the cursor.
        expect(live()).toEqual(['67:1900-2200', '65:2750-3000']);
        // Pressed again: written in from the cursor, a key and the pedal still down let go of there.
        record.click();
        expect(live()).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
      expect(record.getAttribute('aria-pressed')).toBe('false');
      expect(player.playing).toBeNull();
      expect(listening).toBe(0);
      expect([struck(64), struck(67), struck(65)]).toEqual([[], [1_900], [2_750]]);
      expect(pedal()).toEqual([
        [2_300, 1],
        [3_000, 0],
      ]);
      expect(chosen()).toEqual([1_900, 2_750]);
      // One change, put back as one.
      element<HTMLButtonElement>('roll-undo').click();
      expect([struck(67), struck(65), pedal()]).toEqual([[], [], []]);

      // Stopped while it counts in, nothing is written; nor is anything played then.
      vi.useFakeTimers();
      try {
        record.click();
        midi.noteOn(69, clock.now() + 1_800);
        element<HTMLButtonElement>('roll-stop').click();
        expect(record.getAttribute('aria-pressed')).toBe('false');
        vi.advanceTimersByTime(3_000);
        expect(struck(69)).toEqual([]);
        expect(player.playing).toBeNull();

        // With no count-in it records at once; listened to from there, it is written in.
        runtime.controller.updateSettings({ countInBars: 0 });
        tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: 5.05 * zoom, clientY: 20 });
        metronome.clicks.length = 0;
        record.click();
        expect(record.title).toBe('Stop recording, and write in what was played');
        midi.noteOn(71, clock.now() + 10);
        clock.advance(400);
        vi.advanceTimersByTime(0);
        midi.noteOff(71, clock.now());
        element<HTMLButtonElement>('roll-edit').click();
        expect(struck(71)).toEqual([5_010]);
        expect(record.dataset['away']).toBe('true');
        element<HTMLButtonElement>('roll-edit').click();
        expect(record.title).toBe('Record into the sketch from the cursor');

        // Past what is written, the cursor goes on by itself.
        tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: 7.55 * zoom, clientY: 20 });
        record.click();
        for (let step = 0; step < 15; step += 1) {
          clock.advance(100);
          vi.advanceTimersByTime(80);
        }
        expect(headAt(element('roll-body'))).toBe('9.000');
        record.click();

        // Counted in at the sketch's pace where it goes in: a crotchet a second.
        runtime.controller.updateSettings({ countInBars: 1 });
        const tempo = element<HTMLInputElement>('roll-tempo');
        tempo.value = '60';
        tempo.dispatchEvent(new Event('change'));
        tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: 0.05 * zoom, clientY: 20 });
        metronome.clicks.length = 0;
        const slowAt = clock.now();
        record.click();
        expect(metronome.clicks.map((click) => (click.atMs ?? 0) - slowAt)).toEqual([0, 1_000, 2_000, 3_000]);
        element<HTMLButtonElement>('roll-stop').click();
      } finally {
        vi.useRealTimers();
      }
    });

    it('lays a slice of whole bars on the ruler by a press held and dragged, or a click with a key held, and takes it away by a press held on it', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      sketches.begin(
        {
          events: Array.from({ length: 16 }, (_, at) => [
            { kind: 'noteOn' as const, atMs: at * 500, midi: 60, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: at * 500 + 400, midi: 60 },
          ]).flat(),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Sliced',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const body = element('roll-body');
      const ruler = (): Element => body.querySelector('.roll__ruler') ?? body;
      const band = (): HTMLElement | null => body.querySelector<HTMLElement>('.roll__marks > .roll__slice');
      const slice = (): string | null =>
        band()?.hidden === false
          ? `${band()?.style.getPropertyValue('--roll-at') ?? ''}+${band()?.style.getPropertyValue('--roll-span') ?? ''}`
          : null;
      const clickTheRuler = (seconds: number, init: MouseEventInit = {}): void => {
        tapTheDrawing({ pointerType: 'mouse', button: 0, isPrimary: true, clientX: seconds * zoom, clientY: 4, ...init }, ruler());
      };
      const touch = (type: string, seconds: number): void => {
        ruler().dispatchEvent(
          new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 41, pointerType: 'touch', isPrimary: true, button: 0, clientX: seconds * zoom, clientY: 4 }),
        );
      };
      const head = (): string | undefined => headAt(body);

      // None to begin with.
      expect(slice()).toBeNull();
      // Ctrl or Cmd and a click: the bar clicked, the head left where it was.
      const before = head();
      clickTheRuler(2.3, { ctrlKey: true });
      expect([slice(), head()]).toEqual(['2.000+2.000', before]);
      // Alt: on to the end of the bar clicked.
      clickTheRuler(5.3, { altKey: true });
      expect(slice()).toEqual('2.000+4.000');
      // Ctrl again before it, or inside it: from there, its end kept.
      clickTheRuler(0.5, { ctrlKey: true });
      expect(slice()).toEqual('0.000+6.000');
      clickTheRuler(4.5, { metaKey: true });
      expect(slice()).toEqual('4.000+2.000');
      // Alt before its start: from that bar to the end of its own.
      clickTheRuler(0.5, { altKey: true });
      expect(slice()).toEqual('0.000+2.000');

      vi.useFakeTimers();
      try {
        // A finger held on the ruler lays the bar under it; dragged, it takes in the bars as far as it goes, either way.
        touch('pointerdown', 6.3);
        vi.advanceTimersByTime(HOLD_MS - 1);
        expect(slice()).toEqual('0.000+2.000');
        vi.advanceTimersByTime(1);
        expect(slice()).toEqual('6.000+2.000');
        touch('pointermove', 3.1);
        expect(slice()).toEqual('2.000+6.000');
        touch('pointermove', 7.9);
        expect(slice()).toEqual('6.000+2.000');
        touch('pointermove', 4.2);
        touch('pointerup', 4.2);
        // Its click is no tap on the ruler: the head stays.
        ruler().dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 4.2 * zoom, clientY: 4 }));
        expect([slice(), head()]).toEqual(['4.000+4.000', before]);
        // A tap after it is one.
        clickTheRuler(1.0);
        expect(head()).toBe('1.000');

        // A finger that wanders before it is held moves the drawing, and lays nothing.
        touch('pointerdown', 1.0);
        touch('pointermove', 1.5);
        vi.advanceTimersByTime(HOLD_MS);
        touch('pointerup', 1.5);
        expect(slice()).toEqual('4.000+4.000');

        // Held on the slice, it is taken away.
        touch('pointerdown', 5.0);
        vi.advanceTimersByTime(HOLD_MS);
        expect(slice()).toBeNull();
        touch('pointerup', 5.0);
        expect(slice()).toBeNull();
        // A tablet sends no click after a press held so long: the next tap,
        // on the ruler or among the notes, is a tap.
        tapTheDrawing({ pointerType: 'mouse', button: 0, isPrimary: true, clientX: 6.0 * zoom, clientY: 20 });
        expect(head()).toBe('6.000');
      } finally {
        vi.useRealTimers();
      }

      // Drawn again, it is where it was.
      clickTheRuler(2.2, { ctrlKey: true });
      element<HTMLInputElement>('roll-slips').dispatchEvent(new Event('change'));
      expect(slice()).toEqual('2.000+2.000');

      // A note scrolled under the ruler is not taken hold of through it: the
      // press is the ruler's, and so is the click after it.
      const row = (view.rollScene?.highest ?? 0) - 60;
      const scrolledDown =
        Number.parseFloat(body.querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0') || 0;
      const chosen = (): number => (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).length;
      tapTheDrawing({ pointerType: 'mouse', button: 0, isPrimary: true, clientX: 3.1 * zoom, clientY: (row + 0.5) * 13 - scrolledDown }, ruler());
      expect([chosen(), head()]).toEqual([0, '3.000']);
      // Nor cut through it: Alt is the slice's there, wherever the note under it would be cut.
      tapTheDrawing(
        { pointerType: 'mouse', button: 0, isPrimary: true, altKey: true, shiftKey: true, clientX: 5.2 * zoom, clientY: (row + 0.5) * 13 - scrolledDown },
        ruler(),
      );
      expect([chosen(), slice()]).toEqual([0, '2.000+4.000']);
      expect(view.rollScene?.notes).toHaveLength(16);

      // Stop takes the marker, put inside the slice, back to where the slice
      // begins, where a lap of it begins; pressed again, to the beginning.
      expect(head()).toBe('3.000');
      element<HTMLButtonElement>('roll-stop').click();
      expect(head()).toBe('2.000');
      element<HTMLButtonElement>('roll-stop').click();
      expect(head()).toBe('0.000');
      // Put outside it, the marker is where stop finds it, and it goes to the beginning.
      clickTheRuler(7.1);
      expect(head()).toBe('7.000');
      element<HTMLButtonElement>('roll-stop').click();
      expect(head()).toBe('0.000');
    });

    it('lays a slice on the picture of a run played, as on a sketch, and goes round it', async () => {
      const { view, runtime, midi, metronome } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      metronome.advanceSubdivisions(16);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const body = element('roll-body');
      const ruler = body.querySelector('.roll__ruler') ?? body;
      tapTheDrawing({ pointerType: 'mouse', button: 0, isPrimary: true, ctrlKey: true, clientX: 0.1 * zoom, clientY: 4 }, ruler);
      const band = body.querySelector<HTMLElement>('.roll__marks > .roll__slice');
      expect(band?.hidden).toBe(false);
      expect(band?.style.getPropertyValue('--roll-at')).toBe('0.000');
      tapTheDrawing({ pointerType: 'mouse', button: 0, isPrimary: true, clientX: 0.1 * zoom, clientY: 4 }, ruler);
      element<HTMLButtonElement>('roll-play').click();
      expect(runtime.takePlayer.goingRound?.fromMs).toBe(0);
      element<HTMLButtonElement>('roll-stop').click();
    });

    it('plays a slice round and round from inside it, its clicks a lap at a time, and plays on from outside it', async () => {
      const { view, sketches, runtime, clock, metronome } = createRig();
      await view.initialize();
      const one = sketches.begin(
        {
          events: Array.from({ length: 16 }, (_, at) => [
            { kind: 'noteOn' as const, atMs: at * 500, midi: 60, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: at * 500 + 400, midi: 60 },
          ]).flat(),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Round',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const body = element('roll-body');
      const ruler = (): Element => body.querySelector('.roll__ruler') ?? body;
      const clickTheRuler = (seconds: number, init: MouseEventInit = {}): void => {
        tapTheDrawing({ pointerType: 'mouse', button: 0, isPrimary: true, clientX: seconds * zoom, clientY: 4, ...init }, ruler());
      };
      const player = runtime.takePlayer;
      const round = (): string | null => (player.goingRound === null ? null : `${String(player.goingRound.fromMs)}-${String(player.goingRound.toMs)}`);
      element<HTMLInputElement>('roll-click').checked = true;

      // The second bar sliced; the head in it.
      clickTheRuler(2.2, { ctrlKey: true });
      clickTheRuler(2.5);
      vi.useFakeTimers();
      try {
        metronome.clicks.length = 0;
        const startedAt = clock.now();
        element<HTMLButtonElement>('roll-play').click();
        expect(round()).toBe('2000-4000');
        // Three laps and a half, every beat clicked once a lap and none past the slice's end.
        for (let step = 0; step < 70; step += 1) {
          clock.advance(100);
          vi.advanceTimersByTime(80);
        }
        expect(player.positionMs).toBe(3_500);
        const heard = metronome.clicks.map((click) => (click.atMs ?? 0) - startedAt).filter((atMs) => atMs < 7_000);
        expect(heard).toEqual([0, 500, 1_000, 1_500, 2_000, 2_500, 3_000, 3_500, 4_000, 4_500, 5_000, 5_500, 6_000, 6_500]);
        // The first beat of a lap is handed over before the lap begins, as its notes are.
        clock.advance(400);
        vi.advanceTimersByTime(80);
        expect(player.positionMs).toBe(3_900);
        expect(metronome.clicks.map((click) => (click.atMs ?? 0) - clock.now())).toContain(100);
        // Put outside it, behind or ahead, the playback plays on; put back inside, round again.
        clickTheRuler(6.5);
        expect(round()).toBeNull();
        clickTheRuler(0.5);
        expect(round()).toBeNull();
        metronome.clicks.length = 0;
        clickTheRuler(3.0);
        expect(round()).toBe('2000-4000');
        // Its clicks from there on, none from behind it.
        expect(metronome.clicks.map((click) => (click.atMs ?? 0) - clock.now())).toEqual([0]);
        element<HTMLButtonElement>('roll-stop').click();
        // Begun behind it, too, it plays on.
        clickTheRuler(0.5);
        element<HTMLButtonElement>('roll-play').click();
        expect(round()).toBeNull();
        element<HTMLButtonElement>('roll-stop').click();

        // From outside it, it plays on as it always has; a slice laid round the head while it plays is gone round.
        clickTheRuler(6.5);
        element<HTMLButtonElement>('roll-play').click();
        expect(round()).toBeNull();
        clickTheRuler(6.2, { ctrlKey: true });
        expect(round()).toBe('6000-8000');
        element<HTMLButtonElement>('roll-stop').click();
      } finally {
        vi.useRealTimers();
      }

      // Another drawing has none of its own, and this one keeps its own while the page is open.
      expect(one.id).toBeDefined();
      sketches.begin(
        {
          events: [
            { kind: 'noteOn', atMs: 0, midi: 62, velocity: 0.5 },
            { kind: 'noteOff', atMs: 400, midi: 62 },
          ],
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        // Called as the first is: a sketch is told apart by what it is, not by its name.
        'Round',
        2,
      );
      const edit = (which: number): void => {
        element<HTMLButtonElement>('roll-close').click();
        element<HTMLButtonElement>('focus-scores').click();
        element<HTMLButtonElement>('scores-show-sketches').click();
        element('sketches-list').querySelectorAll<HTMLButtonElement>('button[title="Edit this sketch"]')[which]?.click();
      };
      const shown = (): boolean => body.querySelector<HTMLElement>('.roll__slice')?.hidden === false;
      // The two, one after the other: one has it, the other has none.
      edit(0);
      const first = shown();
      edit(1);
      expect([first, shown()].sort()).toEqual([false, true]);
    });

    it('chooses a flag over the ruler by a tap, changes it by a second or the pencil under it, and takes it away by the bin or Delete', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      sketches.begin(
        {
          events: Array.from({ length: 16 }, (_, at) => [
            { kind: 'noteOn' as const, atMs: at * 500, midi: 60, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: at * 500 + 400, midi: 60 },
          ]).flat(),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Flagged',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const body = element('roll-body');
      const flags = (): HTMLButtonElement[] => [...body.querySelectorAll<HTMLButtonElement>('.roll__mark')];
      const pressed = (): (string | null)[] => flags().map((flag) => flag.getAttribute('aria-pressed'));
      const tools = (): HTMLElement | null => body.querySelector<HTMLElement>('.roll__mark-tools');
      const bin = (): HTMLButtonElement | null => body.querySelector<HTMLButtonElement>('.roll__mark-delete');
      const sheet = element('sheet-roll-mark');
      const key = (init: KeyboardEventInit): void => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
      };
      // A change of key at the third bar, asked from the cursor there.
      tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: 4.2 * zoom, clientY: 20 });
      element<HTMLButtonElement>('roll-mark').click();
      element<HTMLSelectElement>('roll-mark-key').value = '7';
      element<HTMLButtonElement>('roll-mark-yes').click();

      // A flag over each bar that changes, naming the bar, none chosen;
      // placed at its moment, and zoomed and scrolled as the heads are.
      expect(flags().map((flag) => flag.textContent)).toEqual(['1 C major 4/4 \u2669=120', '3 G major']);
      expect(flags().map((flag) => flag.style.getPropertyValue('--roll-at'))).toEqual(['0.000', '4.000']);
      const together = body.querySelector<HTMLElement>('.roll__marks');
      const head = body.querySelector<HTMLElement>('.roll__head-mark');
      expect(together?.style.getPropertyValue('--roll-second')).toBe(`${String(zoom)}px`);
      expect(together?.style.getPropertyValue('--roll-x')).toBe(head?.style.getPropertyValue('--roll-x'));
      expect(together?.style.getPropertyValue('--roll-x')).not.toBe('');
      expect(pressed()).toEqual(['false', 'false']);
      expect(tools()?.hidden).toBe(true);

      // Pressed with a finger: chosen as it goes down - the drawing would take
      // the pointer for a drag, and the click with it - and the click after
      // it is not a second tap.
      tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: 1.2 * zoom, clientY: 20 });
      flags()[1]?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 81, pointerType: 'touch', button: 0 }));
      expect(pressed()).toEqual(['false', 'true']);
      flags()[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      expect(sheet.hidden).toBe(true);
      expect(pressed()).toEqual(['false', 'true']);
      expect(tools()?.hidden).toBe(false);
      expect(tools()?.style.getPropertyValue('--roll-at')).toBe('4.000');
      expect(flags()[1]?.title).toBe('Bar 3: G major. Tap to choose it, and again to change it.');
      expect(bin()?.dataset['idle']).toBeUndefined();
      expect(bin()?.title).toBe('Take the change at bar 3 away');
      element<HTMLButtonElement>('roll-mark').click();
      expect(element('roll-mark-title').textContent).toBe('From bar 3, until the next change');
      element<HTMLButtonElement>('roll-mark-no').click();
      // Still chosen when the drawing is drawn again.
      element<HTMLInputElement>('roll-slips').dispatchEvent(new Event('change'));
      expect(pressed()).toEqual(['false', 'true']);
      expect(tools()?.hidden).toBe(false);
      // Tapped again: asked about in the sheet; so is the pencil.
      flags()[1]?.click();
      expect(sheet.hidden).toBe(false);
      expect(element('roll-mark-title').textContent).toBe('From bar 3, until the next change');
      element<HTMLButtonElement>('roll-mark-no').click();
      body.querySelector<HTMLButtonElement>('.roll__mark-change')?.click();
      expect(sheet.hidden).toBe(false);
      element<HTMLButtonElement>('roll-mark-no').click();

      // The bin takes it away, and nothing is chosen any more.
      bin()?.click();
      expect(flags().map((flag) => flag.textContent)).toEqual(['1 C major 4/4 \u2669=120']);
      expect(tools()?.hidden).toBe(true);
      // Put back, chosen again, and Delete takes it away; Escape lets go of it first.
      element<HTMLButtonElement>('roll-undo').click();
      flags()[1]?.click();
      key({ key: 'Escape' });
      expect(pressed()).toEqual(['false', 'false']);
      expect(element('sheet-roll').hidden).toBe(false);
      flags()[1]?.click();
      key({ key: 'Delete' });
      expect(flags()).toHaveLength(1);

      // The first bar's flag is chosen, but its bin is dimmed with the reason, and takes nothing.
      element<HTMLButtonElement>('roll-undo').click();
      flags()[0]?.click();
      expect(bin()?.dataset['idle']).toBe('true');
      expect(bin()?.title).toBe("Take this change away. The first bar's key, metre and pace are the sketch's own: change them instead.");
      bin()?.click();
      key({ key: 'Delete' });
      expect(flags()).toHaveLength(2);
      // A tap anywhere else on the drawing lets go of it.
      tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: 6.2 * zoom, clientY: 20 });
      expect(pressed()).toEqual(['false', 'false']);

      // Listening, a flag only puts the cursor on its bar.
      element<HTMLButtonElement>('roll-edit').click();
      flags()[1]?.click();
      expect(pressed()).toEqual(['false', 'false']);
      element<HTMLButtonElement>('roll-edit').click();
      element<HTMLButtonElement>('roll-mark').click();
      expect(element('roll-mark-title').textContent).toBe('From bar 3, until the next change');
      element<HTMLButtonElement>('roll-mark-no').click();

      // Taken away, a flag is chosen no more: the next Escape is the sheet's.
      flags()[1]?.click();
      bin()?.click();
      key({ key: 'Escape' });
      expect(element('sheet-roll').hidden).toBe(true);
    });

    it('offers in the sheet a metre its list does not, where the bar is in one', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      sketches.begin(
        {
          events: [
            { kind: 'noteOn' as const, atMs: 3_000, midi: 60, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: 3_400, midi: 60 },
          ],
          // Begun a second into the click: the drawing's clock begins at its first bar.
          beats: [1_000, 1_500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 7 })),
        },
        'Seven',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      expect((view.rollScene?.marks ?? []).map((mark) => [mark.atMs, mark.after, mark.says])).toEqual([[0, '1', 'C major 7/4 \u2669=120']]);
      // The cursor a moment into the second bar, three and a half seconds into the drawing.
      tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: 3.6 * zoom, clientY: 20 });
      element<HTMLButtonElement>('roll-mark').click();
      expect(element('roll-mark-title').textContent).toBe('From bar 2, until the next change');
      expect(element<HTMLSelectElement>('roll-mark-metre').value).toBe('7/4');
      // Kept as it is, nothing changes.
      element<HTMLButtonElement>('roll-mark-yes').click();
      expect(element<HTMLButtonElement>('roll-undo').dataset['idle']).toBe('true');
      expect((view.rollScene?.marks ?? []).map((mark) => mark.says)).toEqual(['C major 7/4 \u2669=120']);
    });

    it('writes a chord of the key from the drawer where the cursor is, to the next line of the grid, and moves the cursor on', async () => {
      const { view, sketches, instrument } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 400, 60],
            [500, 1_000, 64],
          ].flatMap(([atMs = 0, upAtMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: upAtMs, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Palette',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - midi + 0.5) * 13 - scrolledDown,
      });
      const inOrder = ([one = 0, a = 0]: number[], [other = 0, b = 0]: number[]): number => one - other || a - b;
      const notes = (): number[][] => {
        const events = sketches.find(sketch.id)?.events ?? [];
        return events
          .flatMap((event, index) => {
            if (event.kind !== 'noteOn') {
              return [];
            }
            const off = events.slice(index + 1).find((later) => later.kind === 'noteOff' && later.midi === event.midi);
            return [[event.atMs, event.midi, off?.atMs ?? -1, event.velocity]];
          })
          .sort(inOrder);
      };
      const chosen = (): number[][] =>
        (view.rollScene?.notes ?? [])
          .filter((note) => note.chosen === true)
          .map((note) => [note.fromMs, (view.rollScene?.highest ?? 0) - note.row])
          .sort(inOrder);
      const open = element<HTMLButtonElement>('roll-chords-open');
      const drawer = element('roll-chords');
      const chords = (): string[] =>
        [...drawer.querySelectorAll<HTMLButtonElement>('[data-chord]')].map((button) => button.textContent);
      const tapTheChord = (name: string): void => {
        [...drawer.querySelectorAll<HTMLButtonElement>('[data-chord]')]
          .find((button) => button.querySelector('.roll-chords__name')?.textContent === name)
          ?.click();
      };
      const snap = element<HTMLInputElement>('roll-snap');
      const original = [
        [0, 60, 400, 0.5],
        [500, 64, 1_000, 0.5],
      ];

      // Shut until asked for, its button there while the sketch is edited.
      expect(open.hidden).toBe(false);
      expect(open.dataset['away']).toBeUndefined();
      expect(drawer.hidden).toBe(true);
      open.click();
      expect(open.getAttribute('aria-pressed')).toBe('true');
      expect(drawer.hidden).toBe(false);
      expect(chords()).toEqual(['CI', 'Dmii', 'Emiii', 'FIV', 'GV', 'Amvi', 'Bdimvii°']);

      // Written from the cursor to the next line of the grid, as loud as the
      // flag over it says, heard, and chosen; and the cursor goes on to its end.
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(3_000, 50) });
      tapTheChord('Am');
      expect(notes()).toEqual([...original, [3_000, 69, 3_500, DYNAMIC_VELOCITY.mf], [3_000, 72, 3_500, DYNAMIC_VELOCITY.mf], [3_000, 76, 3_500, DYNAMIC_VELOCITY.mf]]);
      expect(chosen()).toEqual([
        [3_000, 69],
        [3_000, 72],
        [3_000, 76],
      ]);
      expect(instrument.played.slice(-3).map(({ midi, velocity }) => [midi, velocity])).toEqual([
        [69, DYNAMIC_VELOCITY.mf],
        [72, DYNAMIC_VELOCITY.mf],
        [76, DYNAMIC_VELOCITY.mf],
      ]);
      // The button keeps the focus it was pressed with, and the arrows are
      // still the notes': Shift takes the chord just written up an octave.
      const am = [...drawer.querySelectorAll<HTMLButtonElement>('[data-chord]')].find(
        (button) => button.querySelector('.roll-chords__name')?.textContent === 'Am',
      );
      am?.focus();
      const arrow = (init: KeyboardEventInit): boolean => {
        const pressed = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        (document.activeElement ?? document.body).dispatchEvent(pressed);
        return pressed.defaultPrevented;
      };
      expect(document.activeElement).toBe(am);
      expect(arrow({ key: 'ArrowUp', shiftKey: true })).toBe(true);
      expect(notes().slice(2).map(([, midi = 0]) => midi)).toEqual([81, 84, 88]);
      // A checkbox has no use for them either; a list does.
      element<HTMLInputElement>('roll-snap').focus();
      expect(arrow({ key: 'ArrowDown', shiftKey: true })).toBe(true);
      expect(notes().slice(2).map(([, midi = 0]) => midi)).toEqual([69, 72, 76]);
      element<HTMLSelectElement>('roll-key').focus();
      expect(arrow({ key: 'ArrowDown' })).toBe(false);
      key({ key: 'z', code: 'KeyZ', ctrlKey: true });
      key({ key: 'z', code: 'KeyZ', ctrlKey: true });
      tapTheChord('F');
      expect(notes().slice(5)).toEqual([[3_500, 65, 4_000, DYNAMIC_VELOCITY.mf], [3_500, 69, 4_000, DYNAMIC_VELOCITY.mf], [3_500, 72, 4_000, DYNAMIC_VELOCITY.mf]]);
      // Following the flags over them, as a note written by hand does.
      expect(
        (sketches.find(sketch.id)?.events ?? []).flatMap((event) => (event.kind === 'noteOn' && event.atMs >= 3_000 ? [event.loudness] : [])),
      ).toEqual(Array.from({ length: 6 }, () => ({ level: null, shade: 0 })));
      // Each one change, put back as one.
      key({ key: 'z', code: 'KeyZ', ctrlKey: true });
      expect(notes()).toHaveLength(5);
      key({ key: 'z', code: 'KeyZ', ctrlKey: true });
      expect(notes()).toEqual(original);

      // Off the grid, from where the cursor is; and with the marker put on it
      // again, from the line the cursor is after.
      snap.click();
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(3_100, 50) });
      tapTheChord('C');
      expect(notes().slice(2).map(([down = 0, , up = 0]) => [down, up])).toEqual([
        [3_100, 3_500],
        [3_100, 3_500],
        [3_100, 3_500],
      ]);
      key({ key: 'z', code: 'KeyZ', ctrlKey: true });
      // Away from the last, or it is the second of two taps, which writes a note.
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(3_100, 40) });
      snap.click();
      tapTheChord('C');
      expect(notes().slice(2).map(([down = 0, , up = 0]) => [down, up])).toEqual([
        [3_000, 3_500],
        [3_000, 3_500],
        [3_000, 3_500],
      ]);
      key({ key: 'z', code: 'KeyZ', ctrlKey: true });

      // In another key, its chords.
      const keyOfTheSketch = element<HTMLSelectElement>('roll-key');
      keyOfTheSketch.value = '7';
      element<HTMLSelectElement>('roll-scale').value = 'minor';
      keyOfTheSketch.dispatchEvent(new Event('change'));
      expect(chords()).toEqual(['Gmi', 'Adimii°', 'B♭III', 'Cmiv', 'Dmv', 'E♭VI', 'FVII']);

      // Listening, it is put away, and back with the editing.
      element<HTMLButtonElement>('roll-edit').click();
      expect(drawer.hidden).toBe(true);
      expect(open.dataset['away']).toBe('true');
      element<HTMLButtonElement>('roll-edit').click();
      expect(drawer.hidden).toBe(false);
      // Put away by its button.
      open.click();
      expect(open.getAttribute('aria-pressed')).toBe('false');
      expect(drawer.hidden).toBe(true);
      expect(notes()).toEqual(original);

      function key(init: KeyboardEventInit): void {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
      }
    });

    it('names the chords the notes make in a lane under them while the chords are open, and none once they are put away', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      // C for a bar of four beats, and A minor for the next, at half a second a beat.
      const held = (midis: readonly number[], atMs: number, upAtMs: number) =>
        midis.flatMap((midi) => [
          { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
          { kind: 'noteOff' as const, atMs: upAtMs, midi },
        ]);
      sketches.begin(
        {
          events: [...held([60, 64, 67], 0, 2_000), ...held([57, 60, 64], 2_000, 4_000)],
          beats: Array.from({ length: 8 }, (_, beat) => ({ atMs: beat * 500, beat: beat % 4, beatsInBar: 4 })),
        },
        'Lane',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const stage = (): HTMLElement | null => element('roll-body').closest<HTMLElement>('.roll-stage');
      const lane = (): string[] => (view.rollScene?.chords ?? []).map((chord) => `${String(chord.fromMs)}-${String(chord.untilMs)} ${chord.name} ${chord.numeral}`);

      expect(stage()?.dataset['chords']).toBe('false');
      expect(lane()).toEqual([]);
      element<HTMLButtonElement>('roll-chords-open').click();
      expect(stage()?.dataset['chords']).toBe('true');
      expect(lane()).toEqual(['0-2000 C I', '2000-4000 Am vi']);

      // A pointer resting on one is told what it is.
      // Asked for each time: the drawing is drawn again as notes are chosen.
      const theLane = (): HTMLCanvasElement => {
        const found = element('roll-body').querySelector<HTMLCanvasElement>('.roll__chords > .roll__paint');
        if (found === null) {
          throw new Error('No lane of chords.');
        }
        return found;
      };
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      theLane().dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 2.5 * zoom }));
      expect(theLane().title).toBe('Am (vi): the chord the notes here make');

      // Nothing on it is a note: a press there over where a note's row would
      // be, read off the grid as a point is, takes hold of none and deletes
      // none, and a second tap writes none - over a chord it is the chord's.
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const overE4 = { clientX: 1.2 * zoom, clientY: (highest - 64 + 0.5) * 13 - scrolledDown };
      const overD4 = { ...overE4, clientY: overE4.clientY + 2 * 13 };
      const notes = (): number => (sketches.list()[0]?.events ?? []).filter((event) => event.kind === 'noteOn').length;
      const chosenKeys = (): number[][] =>
        (view.rollScene?.notes ?? [])
          .filter((note) => note.chosen === true)
          .map((note) => [note.fromMs, highest - note.row])
          .sort(([a = 0, x = 0], [b = 0, y = 0]) => a - b || x - y);
      const marker = (): string | undefined =>
        element('roll-body').querySelector<HTMLElement>('.roll__place-mark')?.style.getPropertyValue('--roll-at');
      const cChosen = [
        [0, 60],
        [0, 64],
        [0, 67],
      ];
      expect(notes()).toBe(6);
      for (const over of [overE4, overD4]) {
        tapTheDrawing({ pointerType: 'mouse', button: 0, ...over }, theLane());
        tapTheDrawing({ pointerType: 'mouse', button: 0, ...over }, theLane());
        theLane().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ...over }));
        theLane().dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', ...over }));
        expect(notes()).toBe(6);
        expect(chosenKeys()).toEqual(cChosen);
        expect(element('roll-body').dataset['grip']).toBeUndefined();
      }
      // Past the last chord, the same: nothing written, the choice let go of
      // and the marker where it was tapped.
      const pastTheChords = { ...overD4, clientX: 4.5 * zoom };
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...pastTheChords }, theLane());
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...pastTheChords }, theLane());
      expect(notes()).toBe(6);
      expect(marker()).toBe('4.500');
      // And the same press on the grid is on the note.
      const grid = element('roll-body').querySelector<HTMLElement>('.roll__grid > .roll__paint');
      grid?.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse', ...overE4 }));
      expect(element('roll-body').dataset['grip']).toBe('note');

      // A tap on a chord chooses its notes, rims it, and puts the marker where it begins.
      const overAm = { clientX: 2.5 * zoom, clientY: overE4.clientY };
      tapTheDrawing({ pointerType: 'touch', button: 0, ...overAm }, theLane());
      expect(chosenKeys()).toEqual([
        [2000, 57],
        [2000, 60],
        [2000, 64],
      ]);
      expect((view.rollScene?.chords ?? []).map((chord) => chord.chosen)).toEqual([false, true]);
      expect(marker()).toBe('2.000');
      // With a key held, the other's added to them; without, chosen alone.
      tapTheDrawing({ pointerType: 'mouse', button: 0, ctrlKey: true, ...overE4 }, theLane());
      expect(chosenKeys()).toHaveLength(6);
      expect((view.rollScene?.chords ?? []).map((chord) => chord.chosen)).toEqual([true, true]);
      expect(marker()).toBe('0.000');
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...overE4 }, theLane());
      expect(chosenKeys()).toEqual(cChosen);
      // As Safari sends a tap: pressed on the lane, the click to the drawing,
      // which took the pointer as it went down - and over a note's row.
      const tapAsSafariDoes = (at: { clientX: number; clientY: number }): void => {
        theLane().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 41, pointerType: 'touch', button: 0, ...at }));
        element('roll-body').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 41, pointerType: 'touch', button: 0, ...at }));
        element('roll-body').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, ...at }));
      };
      tapAsSafariDoes({ clientX: 2.5 * zoom, clientY: overE4.clientY });
      expect(chosenKeys()).toEqual([
        [2000, 57],
        [2000, 60],
        [2000, 64],
      ]);
      expect(marker()).toBe('2.000');
      // And a tap on the grid itself is still the grid's.
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...overE4 }, element('roll-body').querySelector('.roll__grid > .roll__paint') ?? theLane());
      expect(chosenKeys()).toEqual([[0, 64]]);

      // Put away, and listening rather than editing, there is no lane.
      element<HTMLButtonElement>('roll-chords-open').click();
      expect(stage()?.dataset['chords']).toBe('false');
      expect(lane()).toEqual([]);
      element<HTMLButtonElement>('roll-chords-open').click();
      element<HTMLButtonElement>('roll-edit').click();
      expect(stage()?.dataset['chords']).toBe('false');
      expect(lane()).toEqual([]);
    });

    it('writes a chord of the drawer over the chord tapped in the lane, moving its notes as little as they can', async () => {
      const { view, sketches, instrument } = createRig();
      await view.initialize();
      const held = (midis: readonly number[], atMs: number, upAtMs: number) =>
        midis.flatMap((midi) => [
          { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
          { kind: 'noteOff' as const, atMs: upAtMs, midi },
        ]);
      // C in the left hand under a melody in the right for a bar; then G
      // in the right hand alone.
      const sketch = sketches.begin(
        {
          events: [...held([48, 52, 55], 0, 2_000), ...held([76], 0, 1_000), ...held([79], 1_000, 2_000), ...held([67, 71, 74], 2_000, 4_000), ...held([78], 3_000, 3_250)],
          beats: Array.from({ length: 8 }, (_, beat) => ({ atMs: beat * 500, beat: beat % 4, beatsInBar: 4 })),
        },
        'Over',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      element<HTMLButtonElement>('roll-chords-open').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const theLane = (): HTMLCanvasElement => {
        const found = element('roll-body').querySelector<HTMLCanvasElement>('.roll__chords > .roll__paint');
        if (found === null) {
          throw new Error('No lane of chords.');
        }
        return found;
      };
      const drawer = (name: string): HTMLButtonElement => {
        const found = [...element('roll-chords-list').querySelectorAll<HTMLButtonElement>('[data-chord]')].find(
          (button) => button.querySelector('.roll-chords__name')?.textContent === name,
        );
        if (found === undefined) {
          throw new Error(`No ${name} in the drawer.`);
        }
        return found;
      };
      const notes = (): number[][] => {
        const events = sketches.find(sketch.id)?.events ?? [];
        return events
          .flatMap((event, index) => {
            if (event.kind !== 'noteOn') {
              return [];
            }
            const off = events.slice(index + 1).find((later) => later.kind === 'noteOff' && later.midi === event.midi);
            return [[event.atMs, event.midi, off?.atMs ?? -1]];
          })
          .sort(([a = 0, x = 0], [b = 0, y = 0]) => a - b || x - y);
      };
      const lane = (): string[] => (view.rollScene?.chords ?? []).map((chord) => `${String(chord.fromMs)} ${chord.name}`);
      const original = notes();
      expect(lane()).toEqual(['0 C', '2000 G']);
      const marker = (): string | undefined =>
        element('roll-body').querySelector<HTMLElement>('.roll__place-mark')?.style.getPropertyValue('--roll-at');

      // Tapped, the drawer's buttons say they write over it; the chord it
      // already is changes nothing, and nothing is there to be put back.
      tapTheDrawing({ pointerType: 'touch', button: 0, clientX: 0.5 * zoom, clientY: 5 }, theLane());
      expect(drawer('F').title).toBe('Make the chosen C F (IV), moving its notes as little as they can');
      drawer('C').click();
      expect(notes()).toEqual(original);
      expect(element<HTMLButtonElement>('roll-undo').dataset['idle']).toBe('true');
      drawer('F').click();
      // The left hand's C E G moved to F, C and A, in their own time; the melody stays.
      expect(notes()).toEqual([
        [0, 41, 2_000],
        [0, 48, 2_000],
        [0, 57, 2_000],
        [0, 76, 1_000],
        [1_000, 79, 2_000],
        ...original.slice(5),
      ]);
      expect(instrument.played.slice(-3).map((note) => note.midi)).toEqual([41, 48, 57]);
      // And named in the lane as what it now is.
      expect(lane()).toEqual(['0 F', '2000 G']);
      expect(marker()).toBe('0.000');
      // Still the chord chosen, so another is tried over it at once.
      expect((view.rollScene?.chords ?? []).map((chord) => chord.chosen)).toEqual([true, false]);
      expect(drawer('G').title).toMatch(/^Make the chosen /);
      // One change, put back as one.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', code: 'KeyZ', ctrlKey: true }));
      expect(notes()).toEqual(original);

      // In one hand alone, every key of the chord moves.
      tapTheDrawing({ pointerType: 'touch', button: 0, clientX: 2.5 * zoom, clientY: 5 }, theLane());
      drawer('Am').click();
      // Every key of the chord: a note passing over it that is none of its tones stays.
      expect(notes().slice(5)).toEqual([
        [2_000, 69, 4_000],
        [2_000, 72, 4_000],
        [2_000, 76, 4_000],
        [3_000, 78, 3_250],
      ]);
      // Two chords chosen, it is written where the cursor is.
      tapTheDrawing({ pointerType: 'mouse', button: 0, ctrlKey: true, clientX: 0.5 * zoom, clientY: 5 }, theLane());
      expect(drawer('F').title).toMatch(/^Write F \(IV\) where the cursor is/);

      // Chosen any other way, a chord of the drawer is written where the cursor is.
      tapTheDrawing({ pointerType: 'touch', button: 0, clientX: 0.5 * zoom, clientY: 5 }, theLane());
      element<HTMLButtonElement>('roll-select').click();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a', code: 'KeyA', ctrlKey: true }));
      expect(drawer('F').title).toMatch(/^Write F \(IV\) where the cursor is/);
      const before = notes().length;
      drawer('F').click();
      expect(notes().length).toBe(before + 3);
    });

    it('sounds a chord of the drawer while it is held, slid over the others, and writes the one let go of', async () => {
      // jsdom lays nothing out, so where a pointer is says which chord it is
      // over: the chords stand fifty pixels apart down the drawer, and
      // anywhere else is off them.
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: (_x: number, y: number): Element | null =>
          element('roll-chords-list').querySelector(`[data-chord="${String(Math.floor(y / 50))}"] .roll-chords__name`) ??
          document.body,
      });
      try {
        const { view, sketches, instrument, clock } = createRig();
        await view.initialize();
        const sketch = sketches.begin(
          {
            events: [
              { kind: 'noteOn' as const, atMs: 0, midi: 60, velocity: 0.5 },
              { kind: 'noteOff' as const, atMs: 1_000, midi: 60 },
            ],
            beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
          },
          'Palette',
          1,
        );
        element<HTMLButtonElement>('focus-scores').click();
        element<HTMLButtonElement>('scores-show-sketches').click();
        rowButton('sketches-list', 'Edit this sketch').click();
        element<HTMLButtonElement>('roll-chords-open').click();
        const chord = (at: number): HTMLElement => {
          const found = element('roll-chords-list').querySelector<HTMLElement>(`[data-chord="${String(at)}"]`);
          if (found === null) {
            throw new Error(`No chord ${String(at)} in the drawer.`);
          }
          return found;
        };
        const pointer = (type: string, on: EventTarget, at: number, more: PointerEventInit = {}): void => {
          on.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientY: at * 50 + 10, ...more }));
        };
        const written = (): number[][] =>
          (sketches.find(sketch.id)?.events ?? [])
            .filter((event) => event.kind === 'noteOn')
            .map((event) => [event.atMs, event.midi])
            .slice(1);
        const heard = (): (number | undefined)[][] => instrument.played.map((note) => [note.midi, note.atMs]);
        const silenced = (): (number | undefined)[][] => instrument.stopped.map((note) => [note.midi, note.atMs]);
        const [C, , , F, , Am] = [0, 1, 2, 3, 4, 5];
        const begun = clock.now();
        instrument.played.length = 0;
        instrument.stopped.length = 0;

        // Pressed, heard whole and at once; nothing written until it is let go of.
        pointer('pointerdown', chord(Am), Am);
        expect(heard()).toEqual([
          [69, begun],
          [72, begun],
          [76, begun],
        ]);
        expect(written()).toEqual([]);
        // Slid onto another, the one before let go of and this one struck.
        clock.advance(100);
        pointer('pointermove', chord(Am), F);
        expect(silenced()).toEqual([
          [69, undefined],
          [72, undefined],
          [76, undefined],
        ]);
        expect(heard().slice(3)).toEqual([
          [65, begun + 100],
          [69, begun + 100],
          [72, begun + 100],
        ]);
        // Let go of at once, it is written there, struck nothing more, and
        // sounds on as long as it is written: to the next line of the grid.
        pointer('pointerup', chord(Am), F);
        chord(F).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
        expect(written()).toEqual([
          [0, 65],
          [0, 69],
          [0, 72],
        ]);
        expect(heard()).toHaveLength(6);
        expect(silenced().slice(3)).toEqual([
          [65, begun + 100 + 500],
          [69, begun + 100 + 500],
          [72, begun + 100 + 500],
        ]);

        // Held longer than it is written, it ends as it is let go of; and
        // heard whole, though the key the sketch already holds there is not
        // written again.
        instrument.stopped.length = 0;
        pointer('pointerdown', chord(C), C);
        expect(heard().slice(6)).toEqual([
          [60, begun + 100],
          [64, begun + 100],
          [67, begun + 100],
        ]);
        clock.advance(2_000);
        pointer('pointerup', chord(C), C);
        expect(written().slice(3)).toEqual([
          [500, 64],
          [500, 67],
        ]);
        expect(silenced()).toEqual([
          [60, begun + 2_100],
          [64, begun + 2_100],
          [67, begun + 2_100],
        ]);

        // Slid off the chords, silent, and let go of there, it writes nothing.
        instrument.stopped.length = 0;
        pointer('pointerdown', chord(C), C);
        pointer('pointermove', chord(C), -1);
        expect(silenced()).toEqual([
          [60, undefined],
          [64, undefined],
          [67, undefined],
        ]);
        pointer('pointerup', chord(C), -1);
        expect(written()).toHaveLength(5);
        expect(heard()).toHaveLength(12);

        // A mouse's right button only deletes, and is not heard.
        pointer('pointerdown', chord(C), C, { pointerType: 'mouse', button: 2 });
        expect(heard()).toHaveLength(12);

        // Taken from the finger by the browser, it is let go of and writes nothing.
        instrument.stopped.length = 0;
        pointer('pointerdown', chord(C), C);
        pointer('pointercancel', chord(C), C);
        expect(silenced().map(([midi]) => midi)).toEqual([60, 64, 67]);
        expect(written()).toHaveLength(5);

        // A second finger on the chords lets go of what the first held.
        instrument.stopped.length = 0;
        pointer('pointerdown', chord(C), C);
        pointer('pointerdown', chord(Am), Am, { pointerId: 8 });
        expect(silenced().map(([midi]) => midi)).toEqual([60, 64, 67]);
        pointer('pointerup', chord(Am), -1, { pointerId: 8 });

        // Deleting, a chord is only deleted: neither heard nor written.
        const writtenNow = written().length;
        element<HTMLButtonElement>('roll-chords-keep').click();
        element<HTMLButtonElement>('roll-chords-forget').click();
        const kept = 7;
        const before = heard().length;
        pointer('pointerdown', chord(kept), kept, { pointerType: 'mouse', button: 0 });
        pointer('pointerup', chord(kept), kept, { pointerType: 'mouse', button: 0 });
        chord(kept).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
        expect(heard()).toHaveLength(before);
        expect(written()).toHaveLength(writtenNow);
        expect(element('roll-chords-list').querySelector(`[data-chord="${String(kept)}"]`)).toBeNull();

        // Where the drawer holds more than is seen, a finger moving as it
        // comes down scrolls it: the chord it struck silenced, and nothing
        // written where it is let go of. A finger only resting unsteadily is
        // not moving yet.
        const column = element('roll-chords');
        let scrolled = 200;
        Object.defineProperty(column, 'scrollHeight', { configurable: true, value: 900 });
        Object.defineProperty(column, 'clientHeight', { configurable: true, value: 300 });
        Object.defineProperty(column, 'scrollTop', {
          configurable: true,
          get: () => scrolled,
          set: (to: number) => {
            scrolled = to;
          },
        });
        instrument.stopped.length = 0;
        const heardBefore = heard().length;
        const writtenBefore = written().length;
        pointer('pointerdown', chord(C), C);
        pointer('pointermove', chord(C), C, { clientY: 10 + 3 });
        expect([scrolled, silenced()]).toEqual([200, []]);
        pointer('pointermove', chord(C), C, { clientY: 10 + 60 });
        expect(scrolled).toBe(140);
        expect(silenced().map(([midi]) => midi)).toEqual([60, 64, 67]);
        pointer('pointermove', chord(C), C, { clientY: 10 - 50 });
        expect(scrolled).toBe(250);
        pointer('pointerup', chord(C), F);
        expect(heard()).toHaveLength(heardBefore + 3);
        expect(written()).toHaveLength(writtenBefore);
        // Resting first, it slides over them, as where there is nothing to scroll.
        pointer('pointerdown', chord(C), C);
        clock.advance(300);
        pointer('pointermove', chord(C), F);
        expect(heard().slice(-3).map(([midi]) => midi)).toEqual([65, 69, 72]);
        expect(scrolled).toBe(250);
        pointer('pointerup', chord(C), F);
        expect(written()).toHaveLength(writtenBefore + 3);
        // A mouse, which scrolls with its wheel, slides at once.
        pointer('pointerdown', chord(C), C, { pointerType: 'mouse', button: 0 });
        pointer('pointermove', chord(C), Am, { pointerType: 'mouse', button: 0 });
        expect(heard().slice(-3).map(([midi]) => midi)).toEqual([69, 72, 76]);
        pointer('pointerup', chord(C), -1, { pointerType: 'mouse', button: 0 });
      } finally {
        Reflect.deleteProperty(document, 'elementFromPoint');
      }
    });

    it('keeps the chosen notes as a chord in the drawer, writes it, and lets go of it', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [2_000, 2_400, 48],
            [2_000, 2_400, 55],
            [2_000, 2_400, 64],
            [2_500, 3_000, 60],
          ].flatMap(([atMs = 0, upAtMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: upAtMs, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Kept',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const tap = (ms: number, midi: number, adding = true): void => {
        tapTheDrawing({
          pointerType: 'mouse',
          button: 0,
          shiftKey: adding,
          clientX: (ms / 1000) * zoom,
          clientY: (highest - midi + 0.5) * 13 - scrolledDown,
        });
      };
      const written = (from: number): number[][] => {
        const events = sketches.find(sketch.id)?.events ?? [];
        return events
          .flatMap((event, index) => {
            if (event.kind !== 'noteOn' || event.atMs < from || event.atMs >= 2_000) {
              return [];
            }
            const off = events.slice(index + 1).find((later) => later.kind === 'noteOff' && later.midi === event.midi);
            return [[event.atMs, event.midi, off?.atMs ?? -1]];
          })
          .sort(([one = 0, a = 0], [other = 0, b = 0]) => one - other || a - b);
      };
      element<HTMLButtonElement>('roll-chords-open').click();
      const list = element('roll-chords-list');
      const buttons = (): HTMLButtonElement[] => [...list.querySelectorAll<HTMLButtonElement>('[data-chord]')];
      const keep = element<HTMLButtonElement>('roll-chords-keep');

      // Nothing chosen, or one note, is no chord to keep.
      expect(keep.dataset['idle']).toBe('true');
      expect(keep.title).toContain('Choose two notes or more first');
      tap(2_600, 60, false);
      expect(keep.dataset['idle']).toBe('true');
      // C over its fifth and third, kept: after the key's own, with its bass under its name.
      tap(2_100, 48, false);
      tap(2_100, 55);
      tap(2_100, 64);
      expect(keep.dataset['idle']).toBeUndefined();
      expect(keep.textContent).toBe('+');
      expect(keep.title).toBe('Keep C, the chosen notes, as a chord');
      keep.click();
      expect(sketches.keptChords()).toEqual([[48, 55, 64]]);
      expect(buttons().map((button) => button.textContent)).toEqual(['CI', 'Dmii', 'Emiii', 'FIV', 'GV', 'Amvi', 'Bdimvii°', 'CC3']);
      expect(buttons().map((button) => button.classList.contains('roll-chords__chord--kept'))).toEqual([
        false, false, false, false, false, false, false, true,
      ]);
      // The same notes chosen, it lets go of them.
      expect(keep.textContent).toBe('\u2212');
      expect(keep.title).toBe('Take C out of the chords kept');

      // A chord of the key is there already.
      buttons()[5]?.click();
      expect(written(0)).toEqual([
        [0, 69, 500],
        [0, 72, 500],
        [0, 76, 500],
      ]);
      expect(keep.dataset['idle']).toBe('true');
      expect(keep.title).toBe("Am is the key's own vi, here already.");
      keep.click();
      expect(sketches.keptChords()).toEqual([[48, 55, 64]]);

      // The one kept is written as it was kept, after it.
      buttons()[7]?.click();
      expect(written(500)).toEqual([
        [500, 48, 1_000],
        [500, 55, 1_000],
        [500, 64, 1_000],
      ]);
      // And let go of, it is gone from the drawer; the notes written stay.
      keep.click();
      expect(sketches.keptChords()).toEqual([]);
      expect(buttons()).toHaveLength(7);
      expect(keep.textContent).toBe('+');
      expect(written(500)).toHaveLength(3);
    });

    it('deletes chords kept from the drawer by its delete switch, or by the right button, and never the key\'s own', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            { kind: 'noteOn' as const, atMs: 2_000, midi: 60, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: 2_400, midi: 60 },
          ],
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Forgetting',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const open = element<HTMLButtonElement>('roll-chords-open');
      const forget = element<HTMLButtonElement>('roll-chords-forget');
      const list = element('roll-chords-list');
      const buttons = (): HTMLButtonElement[] => [...list.querySelectorAll<HTMLButtonElement>('[data-chord]')];
      const noteCount = (): number => sketches.find(sketch.id)?.noteCount ?? -1;
      const key = (init: KeyboardEventInit): void => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
      };
      /** Shut and opened again, so the drawer is drawn from the chords kept now. */
      const reopen = (): void => {
        open.click();
        open.click();
      };
      open.click();

      // Nothing kept, nothing to delete.
      expect(forget.dataset['idle']).toBe('true');
      expect(forget.title).toBe('Delete chords you kept. None is kept yet.');
      forget.click();
      expect(forget.getAttribute('aria-pressed')).toBe('false');

      sketches.keepTheChord([48, 55, 64]);
      sketches.keepTheChord([57, 60, 64, 67]);
      reopen();
      expect(forget.dataset['idle']).toBeUndefined();
      expect(forget.title).toBe('Delete chords you kept: then a tap on one deletes it');
      forget.click();
      expect(forget.getAttribute('aria-pressed')).toBe('true');
      expect(forget.title).toBe('Done deleting chords');
      expect(list.dataset['forgetting']).toBe('true');
      // The ones kept marked to be deleted, the key's own not.
      expect(buttons().map((button) => button.textContent)).toEqual([
        'CI', 'Dmii', 'Emiii', 'FIV', 'GV', 'Amvi', 'Bdimvii°', 'C×', 'Am7×',
      ]);
      expect(buttons()[7]?.title).toBe('Delete C (C3) from the chords kept');
      expect(buttons()[0]?.title).toBe("C is the key's own, and is not deleted");

      // A key's own tapped: neither deleted nor written.
      buttons()[0]?.click();
      expect(noteCount()).toBe(1);
      expect(sketches.keptChords()).toHaveLength(2);
      // One kept tapped: deleted, and nothing written.
      buttons()[7]?.click();
      expect(sketches.keptChords()).toEqual([[57, 60, 64, 67]]);
      expect(noteCount()).toBe(1);
      expect(forget.getAttribute('aria-pressed')).toBe('true');
      // Escape ends the deleting, and the sheet stays.
      key({ key: 'Escape' });
      expect(forget.getAttribute('aria-pressed')).toBe('false');
      expect(list.dataset['forgetting']).toBe('false');
      expect(element('sheet-roll').hidden).toBe(false);
      // Ended, a tap writes again.
      buttons()[7]?.click();
      expect(noteCount()).toBe(5);
      key({ key: 'z', code: 'KeyZ', ctrlKey: true });
      // The last one deleted, the deleting ends by itself.
      forget.click();
      buttons()[7]?.click();
      expect(sketches.keptChords()).toEqual([]);
      expect(forget.getAttribute('aria-pressed')).toBe('false');
      expect(forget.dataset['idle']).toBe('true');
      // Shut, the drawer opens again writing, not deleting.
      sketches.keepTheChord([48, 55, 64]);
      reopen();
      forget.click();
      reopen();
      expect(forget.getAttribute('aria-pressed')).toBe('false');

      // The right button deletes one kept at once; a finger held there does not.
      const menu = (pointerType: string, at: number): boolean => {
        const target = buttons()[at];
        target?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType }));
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
        target?.dispatchEvent(event);
        return event.defaultPrevented;
      };
      expect(menu('touch', 7)).toBe(false);
      expect(sketches.keptChords()).toHaveLength(1);
      expect(menu('mouse', 7)).toBe(true);
      expect(sketches.keptChords()).toEqual([]);
      expect(buttons()).toHaveLength(7);
      menu('mouse', 0);
      expect(buttons()).toHaveLength(7);
      expect(noteCount()).toBe(1);
    });

    it('copies and pastes the chosen notes by the drawer\'s buttons, from the notes copied here where the clipboard cannot say', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 400, 60],
            [500, 1_000, 64],
          ].flatMap(([atMs = 0, upAtMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: upAtMs, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Fingers',
        1,
      );
      Reflect.deleteProperty(window.navigator, 'clipboard');
      try {
        element<HTMLButtonElement>('focus-scores').click();
        element<HTMLButtonElement>('scores-show-sketches').click();
        rowButton('sketches-list', 'Edit this sketch').click();
        const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
        const highest = view.rollScene?.highest ?? 0;
        const scrolledDown =
          Number.parseFloat(
            element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
          ) || 0;
        const at = (ms: number, midi: number): { clientX: number; clientY: number } => ({
          clientX: (ms / 1000) * zoom,
          clientY: (highest - midi + 0.5) * 13 - scrolledDown,
        });
        const notes = (): number[][] => {
          const events = sketches.find(sketch.id)?.events ?? [];
          return events
            .flatMap((event, index) => {
              if (event.kind !== 'noteOn') {
                return [];
              }
              const off = events.slice(index + 1).find((later) => later.kind === 'noteOff' && later.midi === event.midi);
              return [[event.atMs, event.midi, off?.atMs ?? -1]];
            })
            .sort(([one = 0, a = 0], [other = 0, b = 0]) => one - other || a - b);
        };
        const original = [
          [0, 60, 400],
          [500, 64, 1_000],
        ];
        const copy = element<HTMLButtonElement>('roll-copy');
        const paste = element<HTMLButtonElement>('roll-paste');
        const pasted = async (): Promise<void> => {
          paste.click();
          await Promise.resolve();
          await Promise.resolve();
        };
        const theClipboardSays = (readText: () => Promise<string>): void => {
          Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { readText } });
        };
        const undo = (): void => {
          document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', code: 'KeyZ', ctrlKey: true }));
        };
        element<HTMLButtonElement>('roll-chords-open').click();

        // Nothing chosen, nothing to copy; nothing copied and no clipboard, nothing to paste.
        expect(copy.dataset['idle']).toBe('true');
        expect(copy.title).toContain('Choose one first');
        expect(paste.dataset['idle']).toBe('true');
        expect(paste.title).toContain('Copy notes or a change first');
        await pasted();
        expect(notes()).toEqual(original);

        // Copied here, pasted where the cursor is, and chosen.
        tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(600, 64) });
        expect(copy.dataset['idle']).toBeUndefined();
        copy.click();
        expect(paste.dataset['idle']).toBeUndefined();
        tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(3_000, 50) });
        await pasted();
        expect(notes()).toEqual([...original, [3_000, 64, 3_500]]);
        expect((view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => note.fromMs)).toEqual([3_000]);
        undo();

        // Notes on the clipboard are pasted before the ones copied here.
        theClipboardSays(() => Promise.resolve(theClipboardTextOf([{ afterMs: 0, lengthMs: 250, midi: 72, velocity: 0.5 }])));
        expect(paste.dataset['idle']).toBeUndefined();
        await pasted();
        expect(notes()).toEqual([...original, [3_000, 72, 3_250]]);
        undo();
        // Anything else there, or a clipboard that will not be read, and they are.
        for (const readText of [() => Promise.resolve('C E G'), () => Promise.reject(new Error('refused'))]) {
          theClipboardSays(readText);
          await pasted();
          expect(notes()).toEqual([...original, [3_000, 64, 3_500]]);
          undo();
        }
        expect(notes()).toEqual(original);
      } finally {
        Reflect.deleteProperty(window.navigator, 'clipboard');
      }
    });

    it('breaks the chosen chords by the drawer\'s arrows, a key a step of the grid as it is drawn', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [0, 2_000, 60],
            [0, 2_000, 64],
            [0, 2_000, 67],
            [3_000, 3_500, 72],
          ].flatMap(([atMs = 0, upAtMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: upAtMs, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Broken',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const tap = (ms: number, midi: number, adding = true): void => {
        tapTheDrawing({
          pointerType: 'mouse',
          button: 0,
          shiftKey: adding,
          clientX: (ms / 1000) * zoom,
          clientY: (highest - midi + 0.5) * 13 - scrolledDown,
        });
      };
      const notes = (): number[][] => {
        const events = sketches.find(sketch.id)?.events ?? [];
        return events
          .flatMap((event, index) => {
            if (event.kind !== 'noteOn') {
              return [];
            }
            const off = events.slice(index + 1).find((later) => later.kind === 'noteOff' && later.midi === event.midi);
            return [[event.atMs, event.midi, off?.atMs ?? -1]];
          })
          .sort(([one = 0, a = 0], [other = 0, b = 0]) => one - other || a - b);
      };
      const chosen = (): number[][] =>
        (view.rollScene?.notes ?? [])
          .filter((note) => note.chosen === true)
          .map((note) => [note.fromMs, (view.rollScene?.highest ?? 0) - note.row])
          .sort(([one = 0, a = 0], [other = 0, b = 0]) => one - other || a - b);
      const undo = (): void => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', code: 'KeyZ', ctrlKey: true }));
      };
      const up = element<HTMLButtonElement>('roll-arpeggio-up');
      const down = element<HTMLButtonElement>('roll-arpeggio-down');
      const upAndDown = element<HTMLButtonElement>('roll-arpeggio-up-and-down');
      const original = notes();
      element<HTMLButtonElement>('roll-chords-open').click();

      // No chord chosen - nothing, or keys not struck together - nothing to break.
      for (const button of [up, down, upAndDown]) {
        expect(button.dataset['idle'], button.id).toBe('true');
        expect(button.title, button.id).toContain('Choose a chord first');
      }
      tap(100, 60, false);
      tap(3_100, 72);
      expect(up.dataset['idle']).toBe('true');
      up.click();
      expect(notes()).toEqual(original);

      // The chord chosen, broken up a beat a key over its two seconds; the
      // C alone stays as it was; and what it became is chosen.
      tap(100, 64);
      tap(100, 67);
      expect(up.dataset['idle']).toBeUndefined();
      expect(up.title).toBe('Break the chosen chords up, a key a step of the grid');
      up.click();
      expect(notes()).toEqual([
        [0, 60, 500],
        [500, 64, 1_000],
        [1_000, 67, 1_500],
        [1_500, 60, 2_000],
        [3_000, 72, 3_500],
      ]);
      expect(chosen()).toEqual([
        [0, 60],
        [500, 64],
        [1_000, 67],
        [1_500, 60],
        [3_000, 72],
      ]);
      // One change, put back as one.
      undo();
      expect(notes()).toEqual(original);

      down.click();
      expect(notes().slice(0, 4).map(([, midi]) => midi)).toEqual([67, 64, 60, 67]);
      undo();
      upAndDown.click();
      expect(notes().slice(0, 4).map(([, midi]) => midi)).toEqual([60, 64, 67, 64]);
      undo();

      // On a finer grid, faster.
      const grid = element<HTMLSelectElement>('roll-grid');
      grid.value = '2';
      grid.dispatchEvent(new Event('change', { bubbles: true }));
      up.click();
      expect(notes().slice(0, 8).map(([down = 0, midi = 0]) => [down, midi])).toEqual([
        [0, 60],
        [250, 64],
        [500, 67],
        [750, 60],
        [1_000, 64],
        [1_250, 67],
        [1_500, 60],
        [1_750, 64],
      ]);
    });

    it('puts the chosen notes on the grid by the Quantize button, whether or not the marker is put on it', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            [120, 370, 60],
            [1_000, 1_200, 64],
          ].flatMap(([atMs = 0, upAtMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: upAtMs, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Loose',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const quantize = element<HTMLButtonElement>('roll-quantize');
      const notes = (): number[][] => {
        const events = sketches.find(sketch.id)?.events ?? [];
        return events.flatMap((event, index) => {
          if (event.kind !== 'noteOn') {
            return [];
          }
          const off = events.slice(index + 1).find((later) => later.kind === 'noteOff' && later.midi === event.midi);
          return [[event.midi, event.atMs, off?.atMs ?? -1]];
        });
      };
      const chosen = (): number[] =>
        (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => note.fromMs);
      const says = 'Quantize: each chosen note begun on the nearest line of the grid, as long as it was';

      // Its letter, its name and what it does in the title.
      expect(quantize.textContent).toBe('Q');
      // Nothing chosen: dimmed, saying so, and doing nothing.
      expect(quantize.dataset['idle']).toBe('true');
      expect(quantize.title).toBe(`${says}. Choose a note first.`);
      expect(quantize.getAttribute('aria-label')).toBe(quantize.title);
      quantize.click();
      expect(notes()).toEqual([
        [60, 120, 370],
        [64, 1_000, 1_200],
      ]);

      // Both chosen, with the marker put anywhere: the loose one goes onto the
      // beat, as long as it was, and both stay chosen.
      element<HTMLInputElement>('roll-snap').click();
      expect(element<HTMLInputElement>('roll-snap').checked).toBe(false);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a', code: 'KeyA', ctrlKey: true }));
      expect(quantize.dataset['idle']).toBeUndefined();
      expect(quantize.title).toBe(says);
      quantize.click();
      expect(notes()).toEqual([
        [60, 0, 250],
        [64, 1_000, 1_200],
      ]);
      expect(chosen()).toEqual([0, 1_000]);
      // Pressed again, nothing to change, and nothing more to undo for it.
      quantize.click();
      element<HTMLButtonElement>('roll-undo').click();
      expect(notes()).toEqual([
        [60, 120, 370],
        [64, 1_000, 1_200],
      ]);
      expect(element<HTMLButtonElement>('roll-undo').dataset['idle']).toBe('true');
    });

    it('strikes the chosen notes each a little harder or softer by the Humanize button, as one change', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [0, 250, 500, 750].flatMap((atMs) => [
            { kind: 'noteOn' as const, atMs, midi: 60, velocity: 64 / 127 },
            { kind: 'noteOff' as const, atMs: atMs + 200, midi: 60 },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Even',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const humanize = element<HTMLButtonElement>('roll-humanize');
      const struck = (): number[][] =>
        (sketches.find(sketch.id)?.events ?? []).flatMap((event) =>
          event.kind === 'noteOn' ? [[event.atMs, Math.round(event.velocity * 127)]] : [],
        );
      const chosen = (): number[] =>
        (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => note.fromMs);
      const says = 'Humanize: each chosen note struck up to 10 steps harder or softer, as a hand would';
      const even = [
        [0, 64],
        [250, 64],
        [500, 64],
        [750, 64],
      ];

      // Its letter, its name and what it does in the title.
      expect(humanize.textContent).toBe('H');
      // Nothing chosen: dimmed, saying so, and doing nothing.
      expect(humanize.dataset['idle']).toBe('true');
      expect(humanize.title).toBe(`${says}. Choose a note first.`);
      expect(humanize.getAttribute('aria-label')).toBe(humanize.title);
      humanize.click();
      expect(struck()).toEqual(even);

      // All chosen: each struck within ten steps of where it was, where it was, and not all alike.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'a', code: 'KeyA', ctrlKey: true }));
      expect(humanize.dataset['idle']).toBeUndefined();
      expect(humanize.title).toBe(says);
      humanize.click();
      const after = struck();
      expect(after.map(([atMs]) => atMs)).toEqual([0, 250, 500, 750]);
      for (const [, steps = 0] of after) {
        expect(Math.abs(steps - 64)).toBeLessThanOrEqual(10);
      }
      expect(new Set(after.map(([, steps]) => steps)).size).toBeGreaterThan(1);
      expect(chosen()).toEqual([0, 250, 500, 750]);
      // Put back as one.
      element<HTMLButtonElement>('roll-undo').click();
      expect(struck()).toEqual(even);
      expect(element<HTMLButtonElement>('roll-undo').dataset['idle']).toBe('true');
    });

    it('cuts a note in two with Alt and a click, on the nearest line of the grid, or exactly with Shift', async () => {
      const { view, sketches, clock } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5 },
            { kind: 'noteOff', atMs: 1_000, midi: 60 },
          ],
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Cut',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const at = (ms: number): { clientX: number; clientY: number } => ({
        clientX: (ms / 1000) * zoom,
        clientY: (highest - 60 + 0.5) * 13 - scrolledDown,
      });
      const notes = (): number[][] =>
        theKeysOfTheTake(sketches.find(sketch.id)?.events ?? []).map((key) => [key.downAtMs, key.upAtMs ?? -1]);
      const chosen = (): number[] =>
        (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => note.fromMs);
      const altClick = (ms: number, init: PointerEventInit = {}): void => {
        clock.advance(1_000);
        tapTheDrawing({ pointerType: 'mouse', button: 0, altKey: true, ...at(ms), ...init });
      };

      // On the beat nearest, both parts chosen, and the marker left where it was.
      const head = headAt(element('roll-body'));
      altClick(620);
      expect(notes()).toEqual([
        [0, 500],
        [500, 1_000],
      ]);
      expect(chosen()).toEqual([0, 500]);
      expect(headAt(element('roll-body'))).toBe(head);
      // One change, put back as one.
      element<HTMLButtonElement>('roll-undo').click();
      expect(notes()).toEqual([[0, 1_000]]);

      // Exactly where it is clicked with Shift, or with the grid let go of.
      altClick(620, { shiftKey: true });
      expect(notes()).toEqual([
        [0, 620],
        [620, 1_000],
      ]);
      element<HTMLButtonElement>('roll-undo').click();
      element<HTMLInputElement>('roll-snap').click();
      altClick(380);
      expect(notes()).toEqual([
        [0, 380],
        [380, 1_000],
      ]);
      element<HTMLButtonElement>('roll-undo').click();
      // Never a part too short to hear, and never a drag or a choice instead.
      altClick(10);
      altClick(990);
      expect([notes(), chosen()]).toEqual([[[0, 1_000]], []]);
      // Without Alt a press is a press.
      clock.advance(1_000);
      tapTheDrawing({ pointerType: 'mouse', button: 0, ...at(620) });
      expect([notes(), chosen()]).toEqual([[[0, 1_000]], [0]]);
      // A finger has no Alt to hold: its press is a press.
      altClick(620, { pointerType: 'touch' });
      expect(notes()).toEqual([[0, 1_000]]);
    });

    it('draws the pedal on its lane as notes are drawn: pressed by a drag, made longer by its end, moved, and taken out', async () => {
      const { view, sketches, clock } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5 },
            { kind: 'noteOff', atMs: 400, midi: 60 },
            { kind: 'sustain', atMs: 1_000, value: 1 },
            { kind: 'sustain', atMs: 1_500, value: 0 },
          ],
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Pedalled',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const lane = (): Element => element('roll-body').querySelector('.roll__pedal') ?? element('roll-body');
      const on = (type: string, ms: number, init: PointerEventInit = {}): void => {
        lane().dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId: 77, pointerType: 'mouse', button: 0, clientX: (ms / 1000) * zoom, clientY: 0, ...init }),
        );
      };
      const drag = (from: number, to: number, init: PointerEventInit = {}): void => {
        clock.advance(1_000);
        on('pointerdown', from, init);
        on('pointermove', to, init);
        on('pointerup', to, init);
      };
      const tap = (ms: number, init: PointerEventInit = {}): void => {
        on('pointerdown', ms, init);
        on('pointerup', ms, init);
        lane().dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: (ms / 1000) * zoom, clientY: 0 }));
      };
      const pressed = (): (number | null)[][] =>
        rollOfTheTake({ events: sketches.find(sketch.id)?.events ?? [], beats: [] }).pedal.map((span) => [span.downAtMs, span.upAtMs]);
      const undo = (): void => element<HTMLButtonElement>('roll-undo').click();
      const stage = element('roll-body').closest<HTMLElement>('.roll-stage');

      // Being edited, its lane is tall enough for a finger.
      expect(stage?.dataset['editing']).toBe('true');

      // Drawn on the empty lane, from the beat nearest to the beat nearest.
      drag(2_100, 2_900);
      expect(pressed()).toEqual([
        [1_000, 1_500],
        [2_000, 3_000],
      ]);
      undo();
      expect(pressed()).toEqual([[1_000, 1_500]]);
      // Exactly with Shift; and back, from right to left, the same.
      drag(2_900, 2_100, { shiftKey: true });
      expect(pressed()).toEqual([
        [1_000, 1_500],
        [2_100, 2_900],
      ]);
      undo();
      // Too short to be a press, nothing.
      drag(2_100, 2_110, { shiftKey: true });
      expect(pressed()).toEqual([[1_000, 1_500]]);

      // Taken by its end, longer.
      const nearTheEnd = 1_500 - (4 / zoom) * 1_000;
      drag(nearTheEnd, nearTheEnd + 600);
      expect(pressed()).toEqual([[1_000, 2_000]]);
      undo();
      // Taken in the middle, moved.
      drag(1_200, 1_700);
      expect(pressed()).toEqual([[1_500, 2_000]]);
      undo();
      expect(pressed()).toEqual([[1_000, 1_500]]);

      // Two taps on it take it out, as a note's do; and so does the right button.
      clock.advance(1_000);
      tap(1_200);
      expect(pressed()).toEqual([[1_000, 1_500]]);
      tap(1_200);
      expect(pressed()).toEqual([]);
      undo();
      lane().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 1.2 * zoom, clientY: 0 }));
      expect(pressed()).toEqual([]);
      undo();

      // A tap on the empty lane puts the marker there, and writes nothing.
      clock.advance(1_000);
      tap(2_600);
      expect(headAt(element('roll-body'))).toBe('2.500');
      expect(pressed()).toEqual([[1_000, 1_500]]);
      expect(sketches.find(sketch.id)?.noteCount).toBe(1);

      // Listening, the lane is the drawing's and draws nothing.
      element<HTMLButtonElement>('roll-edit').click();
      expect(stage?.dataset['editing']).toBe('false');
      drag(2_100, 2_900);
      expect(pressed()).toEqual([[1_000, 1_500]]);
    });

    it('copies across nothing a key still down at the end follows on from', async () => {
      const { view, sketches, clock } = createRig();
      await view.initialize();
      const sketch = sketches.begin(
        {
          events: [
            { kind: 'noteOn', atMs: 0, midi: 64, velocity: 0.5 },
            { kind: 'noteOff', atMs: 400, midi: 64 },
            { kind: 'noteOn', atMs: 500, midi: 60, velocity: 0.5 },
          ],
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Held',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const key = (init: KeyboardEventInit): void => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
      };
      const across = (): void => {
        key({ key: 'ArrowRight', ctrlKey: true });
        key({ key: 'ArrowLeft', ctrlKey: true });
      };

      // With another, the one held is over its copy wherever that goes.
      key({ key: 'a', code: 'KeyA', ctrlKey: true });
      across();
      expect(sketches.find(sketch.id)?.events).toHaveLength(3);
      // Alone, it has no length to go on from.
      clock.advance(1_000);
      tapTheDrawing({
        pointerType: 'mouse',
        button: 0,
        clientX: 0.6 * zoom,
        clientY: (highest - 60 + 0.5) * 13 - scrolledDown,
      });
      expect(view.rollScene?.notes.filter((note) => note.chosen === true).map((note) => note.fromMs)).toEqual([500]);
      across();
      expect(sketches.find(sketch.id)?.events).toHaveLength(3);
      // Up or down it is copied all the same.
      key({ key: 'ArrowUp', ctrlKey: true });
      expect(sketches.find(sketch.id)?.events).toHaveLength(4);
    });

    it('shows a sketch in a metre the list does not offer as it is', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      sketches.begin(
        {
          events: [
            { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5 },
            { kind: 'noteOff', atMs: 400, midi: 60 },
          ],
          beats: [
            { atMs: 0, beat: 0, beatsInBar: 11, beatType: 16 },
            { atMs: 125, beat: 1, beatsInBar: 11, beatType: 16 },
          ],
        },
        'In eleven',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();

      const metre = element<HTMLSelectElement>('roll-metre');
      expect(metre.value).toBe('11/16');
      expect([...metre.options].map((option) => option.value)).toEqual(['11/16', ...SKETCH_METRE_CHOICES]);
    });

    it('lists the sketches beside the scores, switched to in the title, each to be edited, read, saved or deleted', async () => {
      const { view, runtime, midi, clock, sketches, files } = createRig();
      await view.initialize();
      const scoresShown = element<HTMLButtonElement>('scores-show-scores');
      const sketchesShown = element<HTMLButtonElement>('scores-show-sketches');
      const ofTheScores = ['scores-tools', 'scores-fresh-row', 'scores-list'];
      const shown = (): boolean[] => ofTheScores.map((id) => !element(id).hidden);

      element<HTMLButtonElement>('focus-scores').click();
      expect([scoresShown.getAttribute('aria-pressed'), sketchesShown.getAttribute('aria-pressed')]).toEqual(['true', 'false']);
      expect(shown().every(Boolean)).toBe(true);
      expect([element('sketches-list').hidden, element('sketches-empty').hidden]).toEqual([true, true]);
      expect(element('sketches-new').hidden).toBe(true);

      sketchesShown.click();
      expect(element('sketches-new').hidden).toBe(false);
      expect([scoresShown.getAttribute('aria-pressed'), sketchesShown.getAttribute('aria-pressed')]).toEqual(['false', 'true']);
      expect(shown().some(Boolean)).toBe(false);
      expect([element('scores-empty').hidden, element('sketches-list').hidden, element('sketches-empty').hidden]).toEqual([
        true,
        false,
        false,
      ]);
      element<HTMLButtonElement>('scores-close').click();

      // Four notes on the beats of the assumed 120, played freely; a sketch of them.
      for (const pitch of [60, 62, 64, 65]) {
        midi.noteOn(pitch, clock.now());
        clock.advance(250);
        midi.noteOff(pitch, clock.now());
        clock.advance(250);
      }
      element<HTMLButtonElement>('focus-keep').click();
      rowButton('takes-list', 'Look at this take').click();
      element<HTMLButtonElement>('roll-edit').click();
      element<HTMLButtonElement>('roll-close').click();
      const sketch = sketches.list()[0];

      // The list it was left on is the one it opens on.
      element<HTMLButtonElement>('focus-scores').click();
      expect(sketchesShown.getAttribute('aria-pressed')).toBe('true');
      expect(element('sketches-empty').hidden).toBe(true);
      expect(element('sketches-list').textContent).toContain(`${sketch?.title ?? ''} · 4 notes`);

      rowButton('sketches-list', 'Edit this sketch').click();
      expect(element('sheet-scores').hidden).toBe(true);
      expect(element('roll-title').textContent).toBe(sketch?.title);
      expect(element('roll-edit').getAttribute('aria-pressed')).toBe('true');
      element<HTMLButtonElement>('roll-close').click();

      element<HTMLButtonElement>('focus-scores').click();
      rowButton('sketches-list', 'Save this sketch as a MIDI file').click();
      expect(files.saved[0]?.fileName).toBe(`${sketch?.title ?? ''}.mid`);
      const saved = readMidiFile(files.saved[0]?.bytes ?? new Uint8Array());
      expect([saved.beats, saved.tempoBpm]).toEqual([4, 120]);

      rowButton('sketches-list', 'Write this sketch down as a score').click();
      await waitFor(() => runtime.controller.openedExercise?.title === sketch?.title);
      expect(element('sheet-scores').hidden).toBe(true);
      const written = runtime.controller.openedExercise;
      const steps = written === null ? [] : buildTimeline(written).steps.filter((step) => step.expectedMidi.length > 0);
      expect(steps.map((step) => step.onsetTicks)).toEqual([0, 1, 2, 3].map((at) => at * Duration.QUARTER.ticks));

      element<HTMLButtonElement>('focus-scores').click();
      rowButton('sketches-list', 'Delete this sketch').click();
      // Music written by hand and kept nowhere else: the word has to be typed.
      expect(element('confirm-text').textContent).toBe(`Delete ${sketch?.title ?? ''}? Type DELETE to confirm.`);
      await confirmDeletion();
      expect(sketches.list()).toHaveLength(1);
      await confirmByTyping();
      expect(sketches.list()).toHaveLength(0);
      expect(element('sketches-empty').hidden).toBe(false);

      // One begun with nothing in it, opened to be written, in common time.
      element<HTMLButtonElement>('sketches-new').click();
      const empty = sketches.list()[0];
      expect(empty?.title).toMatch(/^Sketch, \d\d\.\d\d\.\d{4}$/);
      expect(empty?.noteCount).toBe(0);
      expect(empty?.beats.map((beat) => [beat.atMs, beat.beatsInBar])).toEqual([
        [0, 4],
        [500, 4],
      ]);
      expect(element('sheet-scores').hidden).toBe(true);
      expect(element('roll-title').textContent).toBe(empty?.title);
      expect(element('roll-edit').getAttribute('aria-pressed')).toBe('true');
      expect(view.rollScene?.bars.map((bar) => bar.atMs)).toEqual([0, 2_000, 4_000]);
      element<HTMLButtonElement>('roll-close').click();

      element<HTMLButtonElement>('focus-scores').click();
      scoresShown.click();
      expect(shown().every(Boolean)).toBe(true);
      expect([element('sketches-list').hidden, element('sketches-empty').hidden]).toEqual([true, true]);
      expect(element('sketches-new').hidden).toBe(true);
    });

    it('takes the chosen note out with Delete and puts it back with Ctrl+Z, while a sketch is edited and nothing is typed', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const played = [0, 500, 1_000].flatMap((atMs, at) => [
        { kind: 'noteOn' as const, atMs, midi: 60 + 2 * at, velocity: 0.5 },
        { kind: 'noteOff' as const, atMs: atMs + 400, midi: 60 + 2 * at },
      ]);
      const sketch = sketches.begin({ events: played, beats: [] }, 'Keys', 1);
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const scrolledDown = (): number =>
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const row = view.rollScene?.notes.find((note) => note.fromMs === 500)?.row ?? 0;
      tapTheDrawing({ clientX: 0.6 * zoom, clientY: (row + 0.5) * 13 - scrolledDown() });
      const notes = (): number => sketches.find(sketch.id)?.noteCount ?? -1;
      const press = (init: KeyboardEventInit, on: EventTarget = document.body): KeyboardEvent => {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        on.dispatchEvent(event);
        return event;
      };

      // Typed into a box, a key is the box's.
      const search = element<HTMLInputElement>('scores-search');
      expect(press({ key: 'Delete', code: 'Delete' }, search).defaultPrevented).toBe(false);
      expect(notes()).toBe(3);

      // Two chosen go together, and come back together.
      tapTheDrawing({ clientX: 0.1 * zoom, clientY: (row + 2.5) * 13 - scrolledDown(), shiftKey: true });
      press({ key: 'Delete', code: 'Delete' });
      expect(notes()).toBe(1);
      press({ key: 'z', code: 'KeyZ', ctrlKey: true });
      expect(notes()).toBe(3);
      tapTheDrawing({ clientX: 0.6 * zoom, clientY: (row + 0.5) * 13 - scrolledDown() });
      expect(press({ key: 'Delete', code: 'Delete' }).defaultPrevented).toBe(true);
      expect(notes()).toBe(2);
      // Redo is not offered, so its keys do nothing.
      press({ key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true });
      expect(notes()).toBe(2);
      expect(press({ key: 'z', code: 'KeyZ', ctrlKey: true }).defaultPrevented).toBe(true);
      expect(notes()).toBe(3);
      // On a Mac, the command key; and Backspace as well as Delete.
      tapTheDrawing({ clientX: 0.6 * zoom, clientY: (row + 0.5) * 13 - scrolledDown() });
      press({ key: 'Backspace', code: 'Backspace' });
      expect(notes()).toBe(2);
      press({ key: 'z', code: 'KeyZ', metaKey: true });
      expect(notes()).toBe(3);

      // Listening, and with the viewer shut, the keys are nobody's here.
      tapTheDrawing({ clientX: 0.6 * zoom, clientY: (row + 0.5) * 13 - scrolledDown() });
      press({ key: 'Delete', code: 'Delete' });
      expect(notes()).toBe(2);
      element<HTMLButtonElement>('roll-edit').click();
      expect(press({ key: 'z', code: 'KeyZ', ctrlKey: true }).defaultPrevented).toBe(false);
      expect(notes()).toBe(2);
      element<HTMLButtonElement>('roll-edit').click();
      element<HTMLButtonElement>('roll-close').click();
      expect(press({ key: 'z', code: 'KeyZ', ctrlKey: true }).defaultPrevented).toBe(false);
      expect(notes()).toBe(2);
    });

    it('sets how hard the chosen notes are struck by the marks a score writes, switched to from the slider in its place', async () => {
      const { view, sketches, runtime } = createRig();
      await view.initialize();
      const played = [
        [0, 60, 64],
        [500, 62, 96],
        [1_000, 64, 100],
      ].flatMap(([atMs = 0, midi = 0, level = 0]) => [
        { kind: 'noteOn' as const, atMs, midi, velocity: level / 127 },
        { kind: 'noteOff' as const, atMs: atMs + 400, midi },
      ]);
      const sketch = sketches.begin({ events: played, beats: [] }, 'Marked', 1);
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const loudness = (): number[] =>
        (sketches.find(sketch.id)?.events ?? []).flatMap((event) => (event.kind === 'noteOn' ? [Math.round(event.velocity * 127)] : []));
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const scrolledDown = (): number =>
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const tapOn = (fromMs: number): void => {
        const note = view.rollScene?.notes.find((each) => each.fromMs === fromMs);
        tapTheDrawing({ clientX: ((fromMs + 100) / 1000) * zoom, clientY: ((note?.row ?? 0) + 0.5) * 13 - scrolledDown(), shiftKey: true });
      };
      const undo = (): void => {
        document.body.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', code: 'KeyZ', ctrlKey: true }));
      };
      const as = element<HTMLButtonElement>('roll-velocity-as');
      const marks = element('roll-dynamics');
      const track = element('roll-velocity-level').closest<HTMLElement>('.roll-velocity__track');
      const said = element('roll-velocity-said');
      const mark = (level: string): HTMLButtonElement | null => marks.querySelector<HTMLButtonElement>(`[data-dynamic="${level}"]`);
      const pressed = (): (string | undefined)[] =>
        [...marks.querySelectorAll<HTMLButtonElement>('[data-dynamic]')]
          .filter((button) => button.getAttribute('aria-pressed') === 'true')
          .map((button) => button.dataset['dynamic']);

      // The slider first, the switch saying what it would show instead.
      expect(as.getAttribute('aria-checked')).toBe('false');
      expect(as.title).toBe('Set how hard by the marks a score writes, pp to ff');
      expect(as.getAttribute('aria-label')).toBe(as.title);
      expect([marks.hidden, track?.hidden, said.hidden]).toEqual([true, false, false]);
      // Switched: the marks in its place, and kept with the settings.
      as.click();
      expect(as.getAttribute('aria-checked')).toBe('true');
      expect(as.title).toBe('Set how hard by a slider, from 1 to 127');
      expect([marks.hidden, track?.hidden, said.hidden]).toEqual([false, true, true]);
      expect(runtime.controller.settings.velocityAsDynamics).toBe(true);
      // The flags' own first - the notes given back to the flags over them -
      // then a level of their own.
      expect([...marks.querySelectorAll<HTMLElement>('[data-dynamic]')].map((button) => button.dataset['dynamic'])).toEqual([
        'flag',
        'pp',
        'p',
        'mp',
        'mf',
        'f',
        'ff',
      ]);
      const dashed = (): (string | undefined)[] =>
        [...marks.querySelectorAll<HTMLElement>('[data-from-the-flags="true"]')].map((button) => button.dataset['dynamic']);

      // Nothing chosen, none pressed; each says so and does nothing.
      expect(pressed()).toEqual([]);
      expect(mark('f')?.title).toBe('Write the chosen notes f, a level of their own, at 99. Choose a note first.');
      expect(mark('f')?.getAttribute('aria-label')).toBe(mark('f')?.title);
      mark('f')?.click();
      expect(loudness()).toEqual([64, 96, 100]);
      // Two chosen, as they were played: none pressed.
      tapOn(0);
      tapOn(500);
      expect(pressed()).toEqual([]);
      expect(mark('f')?.title).toBe('Write the chosen notes f, a level of their own, at 99');
      // At f, both - the one not chosen left - and f pressed.
      mark('f')?.click();
      expect(loudness()).toEqual([99, 99, 100]);
      expect(pressed()).toEqual(['f']);
      // With the one played chosen too, they differ, and none is pressed.
      tapOn(1_000);
      expect(pressed()).toEqual([]);
      tapOn(1_000);
      expect(pressed()).toEqual(['f']);
      // At pp; pressed again, nothing more to put back.
      mark('pp')?.click();
      expect(loudness()).toEqual([25, 25, 100]);
      expect(pressed()).toEqual(['pp']);
      mark('pp')?.click();
      undo();
      expect(loudness()).toEqual([99, 99, 100]);

      // Given back to the flags: none marked yet, so mezzo-forte, which is
      // edged in dashes - the level they are at, not their own.
      expect(mark('flag')?.title).toBe('Make the chosen notes as loud as the flag over each says');
      mark('flag')?.click();
      expect(loudness()).toEqual([79, 79, 100]);
      expect([pressed(), dashed()]).toEqual([['flag'], ['mf']]);
      // A flag marking piano from the start: they follow it, the one played does not.
      element<HTMLButtonElement>('roll-mark').click();
      element<HTMLSelectElement>('roll-mark-dynamic').value = 'p';
      element<HTMLButtonElement>('roll-mark-yes').click();
      expect(loudness()).toEqual([42, 42, 100]);
      expect([pressed(), dashed()]).toEqual([['flag'], ['p']]);
      undo();
      undo();
      undo();
      expect(loudness()).toEqual([64, 96, 100]);

      // Switched back, the slider.
      as.click();
      expect([marks.hidden, track?.hidden, said.hidden]).toEqual([true, false, false]);
      expect(runtime.controller.settings.velocityAsDynamics).toBe(false);
      // Set by a number, the notes are as loud as that, and at no level.
      as.click();
      mark('mp')?.click();
      as.click();
      const level = element<HTMLInputElement>('roll-velocity-level');
      level.value = '70';
      level.dispatchEvent(new Event('change'));
      expect(loudness()).toEqual([70, 70, 100]);
      expect((sketches.find(sketch.id)?.events ?? []).some((event) => event.kind === 'noteOn' && event.loudness !== undefined)).toBe(false);
    });

    it('sets how hard the chosen notes of a sketch are struck, by as much each, in the passage row', async () => {
      const { view, sketches } = createRig();
      await view.initialize();
      const played = [
        [0, 60, 64],
        [500, 62, 96],
        [1_000, 64, 100],
      ].flatMap(([atMs = 0, midi = 0, level = 0]) => [
        { kind: 'noteOn' as const, atMs, midi, velocity: level / 127 },
        { kind: 'noteOff' as const, atMs: atMs + 400, midi },
      ]);
      const sketch = sketches.begin({ events: played, beats: [] }, 'Loud', 1);
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const row = element('roll-velocity');
      const level = element<HTMLInputElement>('roll-velocity-level');
      const said = (): string => element<HTMLOutputElement>('roll-velocity-said').value;
      const ticks = (): string[] =>
        [...element('roll-velocity-ticks').querySelectorAll<HTMLElement>('.roll-velocity__tick')].map((tick) => tick.style.left);
      const loudness = (): number[] =>
        (sketches.find(sketch.id)?.events ?? []).flatMap((event) => (event.kind === 'noteOn' ? [Math.round(event.velocity * 127)] : []));
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const scrolledDown = (): number =>
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const tapOn = (fromMs: number): void => {
        const note = view.rollScene?.notes.find((each) => each.fromMs === fromMs);
        tapTheDrawing({ clientX: ((fromMs + 100) / 1000) * zoom, clientY: ((note?.row ?? 0) + 0.5) * 13 - scrolledDown(), shiftKey: true });
      };

      // A sketch has no passage to practise: the slider is in its place.
      expect([element('roll-passage').hidden, row.hidden]).toEqual([true, false]);
      expect(row.dataset['idle']).toBe('true');
      expect(level.title).toBe('How hard the chosen notes are struck. Choose a note first.');
      expect(level.getAttribute('aria-label')).toBe(level.title);
      level.value = '100';
      level.dispatchEvent(new Event('input'));
      expect(level.value).toBe('64');
      level.dispatchEvent(new Event('change'));
      expect(loudness()).toEqual([64, 96, 100]);

      tapOn(0);
      tapOn(500);
      expect(row.dataset['idle']).toBeUndefined();
      expect(level.title).toBe('How hard the chosen notes are struck');
      // At their average, a mark for each, softest to loudest said.
      expect(level.value).toBe('80');
      // 64 halfway along 1 to 127, and 96 three quarters of the way and a little.
      expect(ticks()).toEqual(['50%', '75.4%']);
      expect(said()).toBe('64–96');
      // Let go of where it was, nothing changes, and nothing is offered to undo.
      level.dispatchEvent(new Event('change'));
      expect(element<HTMLButtonElement>('roll-undo').dataset['idle']).toBe('true');

      // Moved, they are shown by as much each, and kept only when let go of.
      level.value = '100';
      level.dispatchEvent(new Event('input'));
      expect(said()).toBe('84–116');
      expect(loudness()).toEqual([64, 96, 100]);
      level.dispatchEvent(new Event('change'));
      expect(loudness()).toEqual([84, 116, 100]);
      // No louder than a note can be, nor softer.
      level.value = '127';
      level.dispatchEvent(new Event('change'));
      expect(loudness()).toEqual([111, 127, 100]);
      // From their average of 119 down to 1 is 118 softer: the softer stops at 1.
      level.value = '1';
      level.dispatchEvent(new Event('change'));
      expect(loudness()).toEqual([1, 9, 100]);
      element<HTMLButtonElement>('roll-undo').click();
      element<HTMLButtonElement>('roll-undo').click();
      element<HTMLButtonElement>('roll-undo').click();
      expect(loudness()).toEqual([64, 96, 100]);

      // Listening, it is put away; a recording keeps its passage row.
      element<HTMLButtonElement>('roll-edit').click();
      expect(row.hidden).toBe(true);
      element<HTMLButtonElement>('roll-close').click();
    });

    it('gives the chosen notes of a sketch to a hand, so they are written on its staff', async () => {
      const { view, runtime, sketches, files } = createRig();
      await view.initialize();
      const played = [
        [0, 72],
        [500, 76],
      ].flatMap(([atMs = 0, midi = 0]) => [
        { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
        { kind: 'noteOff' as const, atMs: atMs + 400, midi },
      ]);
      const sketch = sketches.begin({ events: played, beats: [] }, 'Crossed', 1);
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const hands = element('roll-hands');
      const [left, pitch, right] = ['roll-hand-left', 'roll-hand-pitch', 'roll-hand-right'].map((id) => element<HTMLButtonElement>(id));
      const pressed = (): string[] => [left, pitch, right].map((button) => button?.getAttribute('aria-pressed') ?? '');
      const handsOf = (): (string | undefined)[] =>
        (sketches.find(sketch.id)?.events ?? []).flatMap((event) => (event.kind === 'noteOn' ? [event.hand] : []));
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const scrolledDown = (): number =>
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      const tapOn = (fromMs: number): void => {
        const note = view.rollScene?.notes.find((each) => each.fromMs === fromMs);
        tapTheDrawing({ clientX: ((fromMs + 100) / 1000) * zoom, clientY: ((note?.row ?? 0) + 0.5) * 13 - scrolledDown(), shiftKey: true });
      };

      // Nothing chosen: dimmed, saying so, and doing nothing.
      expect(hands.dataset['idle']).toBe('true');
      expect(left?.title).toBe('Left hand: the chosen notes on the lower staff. Choose a note first.');
      expect(left?.getAttribute('aria-label')).toBe(left?.title);
      left?.click();
      expect(handsOf()).toEqual([undefined, undefined]);
      expect(element<HTMLButtonElement>('roll-undo').dataset['idle']).toBe('true');

      tapOn(0);
      tapOn(500);
      expect(hands.dataset['idle']).toBeUndefined();
      expect(pitch?.title).toBe('By pitch: below middle C the left hand, from it the right.');
      expect(pressed()).toEqual(['false', 'true', 'false']);
      left?.click();
      expect(handsOf()).toEqual(['left', 'left']);
      expect(pressed()).toEqual(['true', 'false', 'false']);
      expect(view.rollScene?.notes.map((note) => note.shade)).toEqual(['left', 'left']);
      // Pressed again, nothing to change, and nothing to undo for it.
      left?.click();
      element<HTMLButtonElement>('roll-undo').click();
      expect(handsOf()).toEqual([undefined, undefined]);
      // Put back, the two are still chosen, for another hand.
      expect(pressed()).toEqual(['false', 'true', 'false']);
      left?.click();

      // One of them back to its pitch: the two differ, and neither is pressed.
      tapOn(0);
      pitch?.click();
      expect(handsOf()).toEqual(['left', undefined]);
      tapOn(0);
      expect(pressed()).toEqual(['false', 'false', 'false']);
      right?.click();
      expect(handsOf()).toEqual(['right', 'right']);
      left?.click();
      element<HTMLButtonElement>('roll-close').click();

      // Saved, a track for each hand; written down, on the lower staff.
      element<HTMLButtonElement>('focus-scores').click();
      rowButton('sketches-list', 'Save this sketch as a MIDI file').click();
      expect(readMidiFile(files.saved[0]?.bytes ?? new Uint8Array()).trackNames).toEqual(['Right hand', 'Left hand']);
      rowButton('sketches-list', 'Write this sketch down as a score').click();
      await waitFor(() => runtime.controller.openedExercise?.title === 'Crossed');
      const written = runtime.controller.openedExercise;
      const staves = written === null ? [] : buildTimeline(written).steps.flatMap((step) => step.notes.map((note) => note.staffNumber));
      expect(staves).toEqual([2, 2]);
    });

    it('goes back to the marker when a playback of the drawing runs out, wherever it was last held', async () => {
      const { view, sketches, runtime, clock } = createRig();
      await view.initialize();
      sketches.begin(
        {
          events: [
            [0, 400, 60],
            [500, 900, 64],
          ].flatMap(([atMs = 0, upAtMs = 0, midi = 0]) => [
            { kind: 'noteOn' as const, atMs, midi, velocity: 0.5 },
            { kind: 'noteOff' as const, atMs: upAtMs, midi },
          ]),
          beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
        },
        'Runs out',
        1,
      );
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      rowButton('sketches-list', 'Edit this sketch').click();
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const body = element('roll-body');
      tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: 0.5 * zoom, clientY: 5 });
      expect(headAt(body)).toBe('0.500');
      vi.useFakeTimers();
      try {
        const play = element<HTMLButtonElement>('roll-play');
        const goOn = (ms: number): void => {
          for (let spent = 0; spent < ms; spent += 50) {
            clock.advance(50);
            vi.advanceTimersByTime(50);
          }
        };
        // Held a little way on, and played on from there.
        play.click();
        goOn(200);
        play.click();
        expect(runtime.takePlayer.playing).toBeNull();
        expect(Number(headAt(body))).toBeGreaterThan(0.6);
        play.click();
        goOn(5_000);

        expect(runtime.takePlayer.playing).toBeNull();
        expect(headAt(body)).toBe('0.500');
        expect(play.title).toBe('Play (Space)');
      } finally {
        vi.useRealTimers();
      }
    });

    it('writes nothing over the drawing on a frame that moves only the head', async () => {
      // Every write to the page makes it lay itself out again, the drawing and
      // its notes included. The play icon set again on every frame of a
      // playback cost a whole layout each: at five thousand notes, most of a
      // quarter of a second a frame.
      const { view, runtime, midi, clock } = createRig();
      await view.initialize();
      await runtime.controller.openScore(longExercise({ bars: 4, tempoBpm: 60 }));
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      const drawn = element('roll-body').querySelector<HTMLElement>('.roll');
      vi.useFakeTimers();
      try {
        element<HTMLButtonElement>('roll-play').click();
        clock.advance(20);
        vi.advanceTimersByTime(100);
        // No row of squares counts the bar out over it any more.
        expect(document.getElementById('roll-beats')).toBeNull();
        const watch = new MutationObserver(() => undefined);
        watch.observe(element('roll-play'), { childList: true, attributes: true, subtree: true });

        // Well inside the first click of a bar at sixty.
        clock.advance(20);
        vi.advanceTimersByTime(100);

        expect(headAt(drawn)).not.toBe('0.000');
        expect(watch.takeRecords()).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('puts the whole run on one line under the drawing', async () => {
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      expect(element('roll-map').querySelector('.roll-map__marks')).not.toBeNull();
      // jsdom lays nothing out, so there is no window to draw and the box says
      // so by staying away rather than by claiming the whole strip.
      expect(element('roll-map-window').hidden).toBe(true);
    });

    it('stands the marker on the map as well as in the drawing', async () => {
      // The map is where a place is looked for; leaving off the one place the
      // reader has already chosen sent them back to the drawing to see where
      // they were. His: "можеш до мінімапу додати позицію курсору".
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      // A run opens with the marker at its beginning, which is the left edge.
      // Moved rather than placed, so that following a playback costs no layout.
      expect(element('roll-map-head').style.transform).toBe('translateX(0.000%)');
      expect(element('roll-map-head').style.left).toBe('');
    });

    it('keeps the map in one column with the drawing, which the sheet does not space', async () => {
      // The map is the drawing's bottom edge, as the pitch map is its right
      // one; as a row of the sheet it had the sheet's gap above it. His: "між
      // MIDI viewer та горизонтальним minimap є gap який хочеться прибрати".
      const column = element('roll-map').parentElement;

      expect(column?.classList.contains('roll-frame')).toBe(true);
      expect(document.querySelector('.roll-stage')?.parentElement).toBe(column);
    });

    describe('shown again on the notes', () => {
      // His: "See replay щоб перейти у ноти та побачити гру на самих нотах, та
      // будуть ті самі кнопки будто я би почав гру".

      /** Two steps played in the frame that waits, a second apart, and stopped. */
      async function aRunPlayed(title?: string): Promise<ReturnType<typeof createRig>> {
        const rig = createRig();
        await rig.view.initialize();
        if (title !== undefined) {
          await rig.runtime.controller.openScore(twoBarExercise({ tempoBpm: 60, title }));
        }
        element<HTMLButtonElement>('focus-play').click();
        for (const _ of [1, 2]) {
          rig.clock.advance(1_000);
          for (const midi of rig.runtime.controller.session?.currentStep?.expectedMidi ?? []) {
            rig.midi.noteOn(midi, rig.clock.now());
          }
        }
        element<HTMLButtonElement>('focus-stop').click();
        return rig;
      }

      /**
       * Files the run just played as a reading, as the app does when a run
       * ends: the rig's controller keeps no history of its own.
       */
      const keepTheReading = (
        { runtime }: ReturnType<typeof createRig>,
        modes?: readonly string[],
      ): void => {
        const roll = runtime.controller.lastRoll;
        if (roll === null) {
          throw new Error('expected a run to have been written down');
        }
        runtime.history.record(runtime.controller.practiceKey(), {
          atMs: Date.now(),
          overall: 0.8,
          grade: 'B',
          completed: false,
          modeId: runtime.controller.settings.modeId,
          ...(modes === undefined ? {} : { modes }),
          roll,
        });
      };

      /** The marks in the page's corner, the frame first. */
      const cornerMarks = (): string[] =>
        [...element('score-modes').querySelectorAll('[data-mode]')].map(
          (mark) => mark.getAttribute('data-mode') ?? '',
        );

      const openTheReading = (): void => {
        element<HTMLButtonElement>('focus-readings').click();
        element('readings-list').querySelector('button')?.dispatchEvent(
          new MouseEvent('click', { bubbles: true }),
        );
      };

      it('plays the run on the notes from beside the picture of it, with the run’s own buttons', async () => {
        const { runtime, renderer, clock } = await aRunPlayed();
        const left = renderer.played.length;
        expect(left).toBeGreaterThan(0);

        vi.useFakeTimers();
        try {
          element<HTMLButtonElement>('run-replay').click();

          expect(runtime.controller.replaying).toBe(true);
          expect(element('score-verdict').hidden).toBe(true);
          expect(renderer.played).toEqual([]);
          // Going at once, as pressing the button asked. His: "коли я починаю
          // "see replay" - я думаю що варто запускати replay автоматично".
          expect(element('focus-play').getAttribute('aria-label')).toBe('Pause');
          // Up to just past the first chord, a second in: its marks, and no more.
          clock.advance(1_100);
          vi.advanceTimersByTime(100);
          const first = renderer.played.length;
          expect(first).toBeGreaterThan(0);
          expect(renderer.played.every((mark) => mark.stepIndex === renderer.played[0]?.stepIndex)).toBe(true);

          clock.advance(1_000);
          vi.advanceTimersByTime(100);
          expect(renderer.played.length).toBeGreaterThan(first);

          element<HTMLButtonElement>('focus-play').click();
          expect(element('focus-play').getAttribute('aria-label')).toBe('Resume');
        } finally {
          vi.useRealTimers();
        }

        element<HTMLButtonElement>('focus-stop').click();

        expect(runtime.controller.replaying).toBe(false);
        expect(renderer.played).toHaveLength(left);
      });

      it('puts the keyboard under the music while it is shown, lit with the keys down and the pedal', async () => {
        // His: "чи можна також малювати клавіатуру щоб візуалізовувати мої
        // натискання та десь мати індикатор педалі?".
        const rig = createRig();
        await rig.view.initialize();
        element<HTMLButtonElement>('focus-play').click();
        rig.clock.advance(1_000);
        rig.midi.pedal(true, rig.clock.now());
        for (const midi of rig.runtime.controller.session?.currentStep?.expectedMidi ?? []) {
          rig.midi.noteOn(midi, rig.clock.now());
        }
        element<HTMLButtonElement>('focus-stop').click();
        const keys = element('replay-keys');
        expect(keys.hidden).toBe(true);

        vi.useFakeTimers();
        try {
          element<HTMLButtonElement>('run-replay').click();

          expect(keys.hidden).toBe(false);
          expect(document.body.dataset['replaying']).toBe('true');
          expect(keys.querySelectorAll('[data-midi]')).toHaveLength(88);
          expect(keys.querySelector('[data-shade]')).toBeNull();

          rig.clock.advance(1_100);
          vi.advanceTimersByTime(100);

          const lit = [...keys.querySelectorAll<HTMLElement>('[data-shade]')].map((key) => Number(key.dataset['midi']));
          expect(lit.sort()).toEqual([...(rig.runtime.controller.lastRoll?.presses.map((press) => press.midi) ?? [])].sort());
          expect(keys.querySelector<HTMLElement>('.replay-keys__pedal')?.dataset['down']).toBe('true');
          // And down past its mark from there on, never having been let up.
          expect(rig.view.fallingPedal.map((press) => [press.lift, press.foot > 1])).toEqual([
            [Number.NEGATIVE_INFINITY, true],
          ]);
        } finally {
          vi.useRealTimers();
        }

        element<HTMLButtonElement>('focus-stop').click();

        expect(keys.hidden).toBe(true);
        expect(document.body.dataset['replaying']).toBeUndefined();
        expect(keys.querySelector('[data-shade]')).toBeNull();
      });

      it('goes round the falling notes, the keyboard alone and the score alone with the keyboard button', async () => {
        const { runtime } = await aRunPlayed();
        const toggle = element<HTMLButtonElement>('focus-keyboard');
        const keys = element('replay-keys');

        element<HTMLButtonElement>('run-replay').click();
        expect(keys.hidden).toBe(false);
        expect(keys.dataset['shows']).toBe('falling-notes');
        expect(document.body.dataset['keysHidden']).toBeUndefined();
        expect(document.body.dataset['notesFalling']).toBe('true');

        toggle.click();
        expect(runtime.controller.settings.keysShown).toBe('keys');
        expect(keys.hidden).toBe(false);
        expect(keys.dataset['shows']).toBe('keys');

        toggle.click();
        expect(runtime.controller.settings.keysShown).toBe('none');
        expect(keys.hidden).toBe(true);
        expect(document.body.dataset['keysHidden']).toBe('true');

        toggle.click();
        expect(runtime.controller.settings.keysShown).toBe('falling-notes');
        expect(keys.hidden).toBe(false);
        expect(document.body.dataset['keysHidden']).toBeUndefined();

        element<HTMLButtonElement>('focus-stop').click();
        expect(keys.hidden).toBe(true);
      });

      it('drops the run’s presses onto the keys in the colours they were judged, as slowly as it is played', async () => {
        const { view, runtime } = await aRunPlayed('Falling');
        const roll = runtime.controller.lastRoll;
        if (roll === null) {
          throw new Error('expected a run to have been written down');
        }
        const presses = roll.presses;
        // The run's own nought, which a replay begins at.
        const began = rollBeganAtMs(roll);
        expect(new Set(presses.map((press) => press.downAtMs - began))).toEqual(new Set([1_000, 2_000]));

        element<HTMLButtonElement>('run-replay').click();

        // At its own speed, both chords of the run are within the lane's three
        // seconds, the second a second further up it - each in the colour its
        // key is lit in once it is down.
        const scene = view.fallingScene;
        expect(scene.map((bar) => bar.midi).sort()).toEqual(presses.map((press) => press.midi).sort());
        for (const bar of scene) {
          const press = presses.find((one) => one.midi === bar.midi);
          const downAt = (press?.downAtMs ?? Number.NaN) - began;
          expect(bar.bottom, String(bar.midi)).toBeCloseTo(1 - downAt / 3_000, 6);
          expect(bar.shade, String(bar.midi)).toBe(runtime.controller.replayKeysAt(downAt)?.keys.get(bar.midi));
        }

        // At half speed a second of the run takes two of the screen's, and only
        // the first chord is within the lane's three.
        element<HTMLButtonElement>('focus-play').click();
        element<HTMLSelectElement>('roll-speed').value = '50';
        element<HTMLButtonElement>('focus-play').click();

        const first = presses.filter((press) => press.downAtMs - began === 1_000).map((press) => press.midi);
        expect(view.fallingScene.map((bar) => bar.midi).sort()).toEqual(first.sort());

        element<HTMLButtonElement>('focus-stop').click();
      });

      it('rules a run that kept its beats where it reached the lines', async () => {
        const { view, runtime, metronome, midi, clock } = createRig();
        await view.initialize();
        await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60, title: 'Ruled' }));
        runtime.controller.updateSettings({ modeId: 'mode.flow', countInBars: 0, rhythmRuler: 'eighth' });
        element<HTMLButtonElement>('focus-play').click();
        metronome.advanceSubdivisions(1);
        clock.advance(30);
        midi.noteOn(MIDI.C3, clock.now());
        midi.noteOn(MIDI.C4, clock.now());
        metronome.advanceSubdivisions(1);
        midi.noteOn(MIDI.D4, clock.now());
        metronome.advanceSubdivisions(1);
        element<HTMLButtonElement>('focus-stop').click();

        element<HTMLButtonElement>('run-replay').click();

        expect(view.fallingRuling.map((line) => line.weight)).toContain('beat');
        expect(view.fallingRuling).toEqual(
          theFallingRuling(
            runtime.controller.replayRulingBetween(0, 3_000),
            0,
            3_000,
          ),
        );

        element<HTMLButtonElement>('focus-stop').click();
      });

      it('drops the run’s bar lines where it reached them', async () => {
        const { view, runtime } = await aRunPlayed('Bar lines');
        element<HTMLButtonElement>('run-replay').click();

        const reached = runtime.controller.replayMomentOfBar(0);
        expect(reached).not.toBeNull();
        expect(view.fallingBarLines.map((line) => [line.label, Number(line.at.toFixed(3))])).toEqual([
          ['1', Number((1 - (reached ?? 0) / 3_000).toFixed(3))],
        ]);

        element<HTMLButtonElement>('focus-stop').click();
      });

      it('plays a replay on from a bar held, and leaves the next run’s place and passage alone', async () => {
        const rig = await aRunPlayed('Seek');
        const { runtime } = rig;
        const player = runtime.takePlayer;
        const play = element<HTMLButtonElement>('focus-play');
        vi.useFakeTimers();
        try {
          element<HTMLButtonElement>('run-replay').click();
          rig.clock.advance(1_500);
          vi.advanceTimersByTime(100);
          const reached = runtime.controller.replayMomentOfBar(0);
          expect(reached).not.toBeNull();
          expect(reached).not.toBe(player.positionMs);

          // Held twice: once on its own is the place the next run starts,
          // twice the near end of its passage - neither of them, here.
          rig.renderer.holdBar(0);
          rig.renderer.holdBar(0);
          expect(player.positionMs).toBe(reached);
          expect(play.getAttribute('aria-label')).toBe('Pause');
          expect(runtime.controller.settings.rangeFromBar).toBeNull();
          expect(runtime.controller.settings.rangeToBar).toBeNull();

          // Held, it stays held, and goes on from the bar when it is let go.
          rig.clock.advance(700);
          vi.advanceTimersByTime(100);
          play.click();
          rig.renderer.holdBar(0);
          expect(player.playing).toBeNull();
          // Held at its very start it is ready rather than held part way.
          expect(play.getAttribute('aria-label')).toBe((reached ?? 0) > 0 ? 'Resume' : 'Start');

          // A bar the run never got to says so, and moves nothing.
          rig.renderer.holdBar(1);
          expect(element('result').textContent).toBe('The run did not get to bar 2.');

          play.click();
          expect(player.positionMs).toBe(reached);
        } finally {
          vi.useRealTimers();
        }

        element<HTMLButtonElement>('focus-stop').click();
      });

      it('says where a replay stands on a slider over the keys, and goes to where it is dragged', async () => {
        const rig = await aRunPlayed('Slider');
        const { runtime, renderer } = rig;
        const player = runtime.takePlayer;
        const play = element<HTMLButtonElement>('focus-play');
        const bar = element('replay-on-keys');
        const scrub = element<HTMLInputElement>('replay-scrub');
        expect(bar.hidden).toBe(true);
        vi.useFakeTimers();
        try {
          element<HTMLButtonElement>('run-replay').click();
          expect(bar.hidden).toBe(false);
          const lengthMs = player.durationMs;
          expect(lengthMs).toBeGreaterThan(1_000);
          expect(element('replay-duration').textContent).toBe(clockTime(lengthMs));

          rig.clock.advance(1_000);
          vi.advanceTimersByTime(100);
          expect(Number(scrub.value)).toBe(Math.round((player.positionMs / lengthMs) * 1_000));

          // Dragged while it plays: it plays on from there.
          scrub.value = '0';
          scrub.dispatchEvent(new Event('input'));
          expect(player.positionMs).toBe(0);
          expect(play.getAttribute('aria-label')).toBe('Pause');
          const marksAtTheStart = renderer.played.length;

          // Held and dragged, it stays held there.
          play.click();
          scrub.value = '500';
          scrub.dispatchEvent(new Event('input'));
          expect(play.getAttribute('aria-label')).toBe('Resume');
          expect(player.playing).toBeNull();
          expect(element('replay-position').textContent).toBe(clockTime(lengthMs / 2));

          // Dragged to its end: the page has every mark the run made.
          scrub.value = '1000';
          scrub.dispatchEvent(new Event('input'));
          expect(element('replay-position').textContent).toBe(clockTime(lengthMs));
          expect(renderer.played.length).toBeGreaterThan(marksAtTheStart);
          // And back again, the marks made later come off.
          scrub.value = '0';
          scrub.dispatchEvent(new Event('input'));
          expect(renderer.played.length).toBe(marksAtTheStart);
        } finally {
          vi.useRealTimers();
        }

        element<HTMLButtonElement>('focus-stop').click();
        expect(bar.hidden).toBe(true);
      });

      it('leaves nothing going behind it when the page is put away', async () => {
        const { view } = await aRunPlayed();
        vi.useFakeTimers();
        try {
          element<HTMLButtonElement>('run-replay').click();
          expect(vi.getTimerCount()).toBeGreaterThan(0);

          view.dispose();

          expect(vi.getTimerCount()).toBe(0);
        } finally {
          vi.useRealTimers();
        }
      });

      it('folds the bar away to the run’s buttons while it is shown, held or going', async () => {
        // His: "я очікував побачити 3 кнопки посеред екрану як у грі коли
        // стартуєш грати". Stop among them: the stylesheet shows it only on a
        // bar folded away, so a replay under the whole bar had no Stop at all.
        const { clock } = await aRunPlayed();
        vi.useFakeTimers();
        try {
          element<HTMLButtonElement>('run-replay').click();

          expect(element('focus-bar').dataset['playing']).toBe('true');
          expect(document.body.dataset['playing']).toBe('true');
          expect(element<HTMLButtonElement>('focus-stop').disabled).toBe(false);

          clock.advance(500);
          vi.advanceTimersByTime(100);
          element<HTMLButtonElement>('focus-play').click();

          expect(element('focus-play').getAttribute('aria-label')).toBe('Resume');
          expect(element('focus-bar').dataset['playing']).toBe('true');

          element<HTMLButtonElement>('focus-stop').click();

          expect(element('focus-bar').dataset['playing']).toBe('false');
          expect(document.body.dataset['playing']).toBe('false');
        } finally {
          vi.useRealTimers();
        }
      });

      it('plays itself again from the top on Play it again, and begins no run', async () => {
        const { runtime, renderer, clock } = await aRunPlayed();
        vi.useFakeTimers();
        try {
          element<HTMLButtonElement>('run-replay').click();
          clock.advance(2_100);
          vi.advanceTimersByTime(100);
          expect(renderer.played.length).toBeGreaterThan(0);
          const before = runtime.controller.session;

          element<HTMLButtonElement>('focus-replay').click();

          expect(runtime.controller.replaying).toBe(true);
          expect(runtime.controller.session).toBe(before);
          expect(renderer.played).toEqual([]);
          expect(element('focus-play').getAttribute('aria-label')).toBe('Pause');

          clock.advance(1_100);
          vi.advanceTimersByTime(100);

          expect(renderer.played.length).toBeGreaterThan(0);
        } finally {
          vi.useRealTimers();
        }
      });

      it('ends by itself once it has played out, and gives the page back', async () => {
        const { runtime, renderer, clock } = await aRunPlayed();
        const left = renderer.played.length;
        vi.useFakeTimers();
        try {
          element<HTMLButtonElement>('run-replay').click();

          clock.advance(60_000);
          vi.advanceTimersByTime(100);

          expect(runtime.controller.replaying).toBe(false);
          expect(element('replay-keys').hidden).toBe(true);
          expect(element('focus-bar').dataset['playing']).toBe('false');
          expect(renderer.played).toHaveLength(left);
        } finally {
          vi.useRealTimers();
        }
      });

      it('keeps its speed in the row on a narrow screen, where the drawer is shut', async () => {
        // A phone keeps the speed in the drawer, which goes with the rest of the
        // bar while a replay is shown - and how fast to watch is its question.
        Object.defineProperty(window, 'matchMedia', {
          configurable: true,
          value: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
        });
        try {
          await aRunPlayed();
          const speed = element('focus-speed');
          expect(speed.parentElement).toBe(element('focus-drawer'));

          element<HTMLButtonElement>('run-replay').click();

          expect(speed.parentElement).toBe(element('focus-row'));

          element<HTMLButtonElement>('focus-stop').click();

          expect(speed.parentElement).toBe(element('focus-drawer'));
        } finally {
          Reflect.deleteProperty(window, 'matchMedia');
        }
      });

      it('takes the keyboard away with the replay, whatever ended it', async () => {
        // Another piece opened ends one too, and the keyboard stayed up with
        // Stop greyed out. His: "як я вмикаю replay - то нема шляху позбутися
        // намальованого піаніно".
        const { runtime } = await aRunPlayed();
        element<HTMLButtonElement>('run-replay').click();
        expect(element('replay-keys').hidden).toBe(false);

        await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60, title: 'Another' }));

        expect(element('replay-keys').hidden).toBe(true);
        expect(document.body.dataset['replaying']).toBeUndefined();
      });

      it('sets how fast it is played back with the tempo buttons, and gives them back after', async () => {
        const { runtime } = await aRunPlayed();
        element<HTMLButtonElement>('run-replay').click();
        expect(element<HTMLOutputElement>('focus-tempo').value).toBe('100%');

        element<HTMLButtonElement>('focus-slower').click();

        expect(element<HTMLOutputElement>('focus-tempo').value).toBe('75%');
        expect(element<HTMLSelectElement>('roll-speed').value).toBe('75');
        expect(runtime.controller.tempoPercent).toBe(100);

        element<HTMLButtonElement>('focus-stop').click();

        expect(element<HTMLOutputElement>('focus-tempo').value).toBe(
          `${String(runtime.controller.tempoPercent)}%`,
        );
      });

      it('says in the corner what the run was played with while it is shown, not what is chosen now', async () => {
        const rig = createRig();
        await rig.view.initialize();
        rig.runtime.controller.updateSettings({ modeId: WAIT_MODE_ID, cursorWhileRunning: false });
        element<HTMLButtonElement>('focus-play').click();
        for (const _ of [1, 2]) {
          rig.clock.advance(1_000);
          for (const midi of rig.runtime.controller.session?.currentStep?.expectedMidi ?? []) {
            rig.midi.noteOn(midi, rig.clock.now());
          }
        }
        element<HTMLButtonElement>('focus-stop').click();
        // Chosen afresh after the run.
        rig.runtime.controller.updateSettings({ modeId: BAR_MODE_ID, cursorWhileRunning: true });
        element<HTMLButtonElement>('focus-modes').click();
        element<HTMLButtonElement>('modes-close').click();
        expect(cornerMarks()).toEqual(['bar']);

        vi.useFakeTimers();
        try {
          element<HTMLButtonElement>('run-replay').click();

          expect(cornerMarks()).toEqual(['wait', 'cursor']);
          // Start plays the run shown again, and says so rather than the frame.
          expect(document.body.dataset['replaying']).toBe('true');
          expect(element('focus-play-replay').closest('#focus-play')).not.toBeNull();

          element<HTMLButtonElement>('focus-stop').click();
        } finally {
          vi.useRealTimers();
        }

        expect(rig.runtime.controller.replaying).toBe(false);
        expect(cornerMarks()).toEqual(['bar']);
      });

      it('says in the corner what a kept reading was played with', async () => {
        const rig = await aRunPlayed('Kept');
        const { runtime } = rig;
        runtime.controller.updateSettings({ modeId: WAIT_MODE_ID });
        keepTheReading(rig, ['blind']);
        runtime.controller.updateSettings({ modeId: BAR_MODE_ID });
        openTheReading();

        element<HTMLButtonElement>('reading-replay').click();
        await vi.waitFor(() => {
          expect(runtime.controller.replaying).toBe(true);
        });

        expect(cornerMarks()).toEqual(['wait', 'blind']);
      });

      it('shows a kept reading of the piece that is open', async () => {
        const rig = await aRunPlayed('Kept');
        const { runtime } = rig;
        keepTheReading(rig);
        openTheReading();

        expect(element('reading-replay').hidden).toBe(false);

        element<HTMLButtonElement>('reading-replay').click();
        await vi.waitFor(() => {
          expect(runtime.controller.replaying).toBe(true);
        });
        expect(element('sheet-reading').hidden).toBe(true);
      });

      it('opens the piece a kept reading was of, and shows it there', async () => {
        const rig = await aRunPlayed('Kept');
        const { runtime } = rig;
        keepTheReading(rig);
        await runtime.scores.keep(twoBarExercise({ tempoBpm: 60, title: 'Kept' }), 1_000);
        await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60, title: 'Another' }));
        openTheReading();

        element<HTMLButtonElement>('reading-replay').click();

        await vi.waitFor(() => {
          expect(runtime.controller.replaying).toBe(true);
        });
        expect(runtime.controller.pieceKey).toBe('score:Kept');
      });

      it('offers none for a piece that is not on this device', async () => {
        const kept = await aRunPlayed('Kept');
        keepTheReading(kept);
        await kept.runtime.controller.openScore(twoBarExercise({ tempoBpm: 60, title: 'Another' }));
        openTheReading();

        expect(element('reading-roll').hidden).toBe(false);
        expect(element('reading-replay').hidden).toBe(true);
      });

      it('offers none for a reading of a level, which is generated afresh', async () => {
        const rig = await aRunPlayed();
        keepTheReading(rig);
        openTheReading();

        expect(element('reading-roll').hidden).toBe(false);
        expect(element('reading-replay').hidden).toBe(true);
      });
    });

    it('moves the marker on the map with the head, however late the run was played', async () => {
      // The map places everything on the clock the run was played by, and the
      // head counts from the run's own nought: a run played a minute into the
      // session had its head read as a minute before it began, and held at the
      // left edge. His: "курсор на ньому не оновлюється, а завжди стоїть на
      // самому початку".
      const { view, runtime, midi, clock } = createRig();
      await view.initialize();
      clock.advance(60_000);
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, clock.now());
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      const roll = runtime.controller.lastRoll;
      if (roll === null) {
        throw new Error('expected a run to have been written down');
      }
      expect(rollBeganAtMs(roll)).toBeGreaterThan(50_000);

      vi.useFakeTimers();
      try {
        element<HTMLButtonElement>('roll-play').click();
        clock.advance(400);
        vi.advanceTimersByTime(100);
      } finally {
        vi.useRealTimers();
      }

      const share = 400 / (rollEndedAtMs(roll) - rollBeganAtMs(roll));
      expect(element('roll-map-head').style.transform).toBe(
        `translateX(${(share * 100).toFixed(3)}%)`,
      );
      element<HTMLButtonElement>('roll-stop').click();
    });

    it('chooses a passage out of the picture, and goes to it', async () => {
      // The stretch that went wrong is visible in the drawing and nowhere else,
      // so reaching it afterwards meant finding it again on the page by eye.
      // His: "додати можливість ставити слайс прямо з MIDI viewer, та кнопку
      // apply and jump to the slice".
      const { view, runtime, midi, renderer } = createRig();
      await view.initialize();
      await runtime.controller.openScore(longExercise({ bars: 6, tempoBpm: 60 }));
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      // Nothing chosen yet, so there is nowhere to be sent.
      expect(element('roll-passage-what').textContent).toBe('The whole piece');
      expect(element<HTMLButtonElement>('roll-practise').disabled).toBe(true);

      // The marker stands at the run's own beginning, so this makes the first
      // bar the whole of the passage. jsdom lays nothing out, so the marker
      // cannot be moved by tapping here; where a moment of a run falls in the
      // music is asked of `theMusicsPlaceAt`, which is tested on its own.
      element<HTMLButtonElement>('roll-to').click();

      expect(runtime.controller.settings.rangeFromBar).toBe(1);
      expect(runtime.controller.settings.rangeToBar).toBe(1);
      expect(element('roll-passage-what').textContent).toContain('Bars 1');
      const practise = element<HTMLButtonElement>('roll-practise');
      expect(practise.disabled).toBe(false);

      // The markers on the score stand round the passage that was just chosen,
      // and they stand there *now*. Chosen here and nowhere else, the page went
      // on showing the passage it had before until something else happened to
      // redraw it. His: "слайси ставляться з MIDI editor - але одразу не
      // перемальовуються... коли натискаю Practise this".
      expect(renderer.shownPassage?.toMeasureIndex).toBe(0);

      // Where the marker is left by a run that reached its end: on the last
      // thing played, which is the far side of the piece from the passage.
      renderer.cursor.moveTo(4);

      practise.click();

      // The picture is put away and the marker has come back to the passage.
      expect(element('sheet-roll').hidden).toBe(true);
      expect(renderer.cursor.position).toBe(0);
    });

    it('offers the picture of a run, and draws it on being asked', async () => {
      // His: "додати кнопку в кінці у статистиці щоб відчинити цей діалог з
      // MIDI viewer". The report is read at a glance; a grid of every note
      // played is the opposite of one, so it waits behind a button.
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();

      const open = element<HTMLButtonElement>('run-roll-open');
      expect(element('sheet-roll').hidden).toBe(true);

      open.click();

      expect(element('sheet-roll').hidden).toBe(false);
      const drawn = element('roll-body').querySelector('.roll');
      expect(drawn).not.toBeNull();
      expect(view.rollScene?.notes.length).toBeGreaterThan(0);
    });

    it('opens the score itself in the MIDI viewer when focus-roll is pressed', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      expect(element('sheet-roll').hidden).toBe(true);
      element<HTMLButtonElement>('focus-roll').click();

      expect(element('sheet-roll').hidden).toBe(false);
      expect(element('roll-title').textContent).toBe(
        runtime.controller.currentExercise?.title ?? 'The score',
      );
      expect(element('roll-keep').hidden).toBe(true);
      expect(element<HTMLButtonElement>('roll-from').disabled).toBe(false);
      expect(element<HTMLButtonElement>('roll-to').disabled).toBe(false);
      expect(element<HTMLInputElement>('roll-ghosts').disabled).toBe(false);
      expect(element<HTMLInputElement>('roll-slips').disabled).toBe(false);
      expect(view.rollScene?.notes.length).toBeGreaterThan(0);
      expect(view.rollScene?.ghosts.length).toBe(view.rollScene?.notes.length);
      const notes = view.rollScene?.notes ?? [];
      const ghosts = view.rollScene?.ghosts ?? [];
      for (let i = 0; i < notes.length; i++) {
        expect(ghosts[i]?.row).toBe(notes[i]?.row);
        expect(ghosts[i]?.fromMs).toBeCloseTo(notes[i]?.fromMs ?? 0, 1);
        expect(ghosts[i]?.untilMs).toBeCloseTo(notes[i]?.untilMs ?? 0, 1);
      }
    });

    it('outlines a unison once under the score, as it is drawn once', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      await runtime.controller.openScore(unisonInTwoVoices({ tempoBpm: 60 }));

      element<HTMLButtonElement>('focus-roll').click();

      expect(view.rollScene?.ghosts.length).toBe(view.rollScene?.notes.length);
    });

    it('allows choosing a passage and practising it from the score roll', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      element<HTMLButtonElement>('focus-roll').click();
      expect(element('sheet-roll').hidden).toBe(false);

      const from = element<HTMLButtonElement>('roll-from');
      const to = element<HTMLButtonElement>('roll-to');
      const practise = element<HTMLButtonElement>('roll-practise');

      expect(practise.disabled).toBe(true);

      from.click();
      to.click();

      expect(practise.disabled).toBe(false);
      practise.click();

      expect(element('sheet-roll').hidden).toBe(true);
      expect(runtime.controller.settings.rangeFromBar).not.toBeNull();
    });

    it('sounds the run the drawing is of, and follows it with a head', async () => {
      // Through the player that already plays a recording back: a run written
      // down is one, pedal and all.
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      element<HTMLButtonElement>('roll-play').click();

      const drawn = element('roll-body').querySelector<HTMLElement>('.roll');
      expect(runtime.takePlayer.playing).not.toBeNull();
      expect(drawn?.classList.contains('roll--sounding')).toBe(true);
      expect(drawn?.querySelector('.roll__head')).not.toBeNull();

      element<HTMLButtonElement>('roll-play').click();

      expect(runtime.takePlayer.playing).toBeNull();
      expect(drawn?.classList.contains('roll--sounding')).toBe(false);
    });

    it('walks the head along as the run sounds', async () => {
      // The head is moved by one custom property rather than redrawn, so this
      // is the only place the number it carries can be checked against where
      // the sound has actually got to.
      const { view, runtime, midi, metronome, clock } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      // Long enough that there is a performance to walk over at all.
      metronome.advanceSubdivisions(8);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const drawn = element('roll-body').querySelector<HTMLElement>('.roll');
      vi.useFakeTimers();
      try {
        element<HTMLButtonElement>('roll-play').click();
        expect(headAt(drawn)).toBe('0.000');

        clock.advance(400);
        vi.advanceTimersByTime(100);

        expect(headAt(drawn)).toBe('0.400');
        // Its cap on the ruler with it, and nothing else told: written on the
        // drawing, every note in it inherited the number and was restyled on
        // every frame - 228 ms a frame at five thousand notes.
        expect(drawn?.querySelector<HTMLElement>('.roll__head-mark')?.style.getPropertyValue('--roll-at')).toBe('0.400');
        expect(drawn?.style.getPropertyValue('--roll-at')).toBe('');
      } finally {
        vi.useRealTimers();
      }
    });

    /**
     * Lends the drawing a width, a place for its head and a scroller that
     * remembers what it was set to. jsdom lays nothing out, and where the
     * scroller stands is the whole of what this mode does.
     */
    function lendTheDrawingAScroller(): {
      readonly scrolledTo: () => number;
      readonly headPx: () => number;
      readonly giveBack: () => void;
    } {
      const had = ['clientWidth', 'clientHeight'].map(
        (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
      );
      // A view of 360 along and 200 down.
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains('roll__grid') ? 360 : 0;
        },
      });
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
        configurable: true,
        get(this: HTMLElement) {
          return this.classList.contains('roll__grid') ? 200 : 0;
        },
      });
      const drawn = (): HTMLElement | null => element('roll-body').querySelector<HTMLElement>('.roll');
      return {
        // Where the view stands, as the head is told it.
        scrolledTo: () =>
          Number.parseFloat(
            drawn()?.querySelector<HTMLElement>('.roll__head')?.style.getPropertyValue('--roll-x') ?? '0',
          ),
        headPx: () => Number(headAt(drawn())) * Number(element<HTMLInputElement>('roll-zoom').value),
        giveBack: () => {
          for (const [name, descriptor] of had) {
            if (descriptor === undefined) {
              delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
              continue;
            }
            Object.defineProperty(HTMLElement.prototype, name, descriptor);
          }
        },
      };
    }

    /**
     * A run played to a pulse long enough to scroll along, with the picture of
     * it open, drawn at six hundred to the second, and the head put down a
     * thousand pixels in: somewhere a playback can be followed to.
     */
    async function aLongRunWithTheHeadFarIn(): Promise<ReturnType<typeof createRig>> {
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
      element<HTMLButtonElement>('focus-play').click();
      const step = rig.runtime.controller.session?.currentStep;
      rig.midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      rig.metronome.advanceSubdivisions(48);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      putTheHeadFarIn();
      return rig;
    }

    function putTheHeadFarIn(): void {
      // Exactly where it is put, and not on the nearest beat.
      const snap = element<HTMLInputElement>('roll-snap');
      snap.checked = false;
      snap.dispatchEvent(new Event('change', { bubbles: true }));
      const zoom = element<HTMLInputElement>('roll-zoom');
      zoom.value = '600';
      zoom.dispatchEvent(new Event('input', { bubbles: true }));
      const grid = element('roll-body').querySelector<HTMLElement>('.roll__grid');
      if (grid === null) {
        throw new Error('expected a grid to tap');
      }
      grid.getBoundingClientRect = () => new DOMRect(0, 0, 360, 200);
      grid.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1000 }));
    }

    const aFrameOf = async (): Promise<void> =>
      new Promise((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()));
      });

    /** A run with something in it, with the picture of it open. */
    async function aRunToLookAt(): Promise<ReturnType<typeof createRig>> {
      const rig = createRig();
      await rig.view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = rig.runtime.controller.session?.currentStep;
      rig.midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      rig.metronome.advanceSubdivisions(8);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      return rig;
    }

    it('runs the music past a standing cursor when it is asked to, instead of nudging the view', async () => {
      const lent = lendTheDrawingAScroller();
      try {
        const rig = await aLongRunWithTheHeadFarIn();
        rig.runtime.controller.updateSettings({ rollScrollPlayback: true });

        element<HTMLButtonElement>('roll-play').click();
        await aFrameOf();

        // The head stands 15% of the way across the 360 pixels of music, and
        // the music is scrolled under it, rather than the view being nudged
        // when the head nears its edge, which at speed is a series of jumps.
        expect(lent.headPx()).toBeGreaterThan(500);
        expect(lent.scrolledTo()).toBe(Math.round(lent.headPx() - 360 * 0.15));
      } finally {
        lent.giveBack();
      }
    });

    it('nudges the view instead where it has not been asked to', async () => {
      const lent = lendTheDrawingAScroller();
      try {
        const rig = await aLongRunWithTheHeadFarIn();
        expect(rig.runtime.controller.settings.rollScrollPlayback).toBe(false);

        element<HTMLButtonElement>('roll-play').click();
        await aFrameOf();

        // Past the front three quarters of the view, so put a quarter of the
        // way in.
        expect(lent.headPx()).toBeGreaterThan(270);
        // To the pixel, the head's place being said to a thousandth of a second.
        expect(lent.scrolledTo()).toBeCloseTo(lent.headPx() - 360 * 0.25, 0);
      } finally {
        lent.giveBack();
      }
    });

    it.each([true, false])(
      'plays on when a hand is on the drawing (music running past the cursor: %s)',
      async (runsPast) => {
        // His: "ми ставимо на паузу MIDI viewer коли я роблю скрол - я думаю
        // що не варто це робити". A scroll is looking, not stopping.
        const lent = lendTheDrawingAScroller();
        const rig = await aRunToLookAt();
        try {
          rig.runtime.controller.updateSettings({ rollScrollPlayback: runsPast });
          element<HTMLButtonElement>('roll-play').click();

          const body = element('roll-body');
          body.dispatchEvent(new Event('wheel', { bubbles: true }));
          body.dispatchEvent(
            new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 5, clientY: 50 }),
          );

          expect(rig.runtime.takePlayer.playing).not.toBeNull();
        } finally {
          lent.giveBack();
        }
      },
    );

    it('remembers whether the music runs past the cursor', async () => {
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();
      const box = element<HTMLInputElement>('roll-scroll-playback');
      expect(box.checked).toBe(false);

      box.checked = true;
      box.dispatchEvent(new Event('change'));
      expect(first.runtime.controller.settings.rollScrollPlayback).toBe(true);

      // A fresh page, as a reload is: without it the box is still the one that
      // was just ticked, and says so whether or not anything remembered it.
      mountRealMarkup();
      const next = createRig(undefined, store);
      await next.view.initialize();

      expect(element<HTMLInputElement>('roll-scroll-playback').checked).toBe(true);
      expect(next.runtime.controller.settings.rollScrollPlayback).toBe(true);
    });

    it('stands the cursor as far in as it is asked to, and moves it there at once', async () => {
      const lent = lendTheDrawingAScroller();
      try {
        const rig = await aLongRunWithTheHeadFarIn();
        rig.runtime.controller.updateSettings({ rollScrollPlayback: true });
        element<HTMLButtonElement>('roll-play').click();
        await aFrameOf();
        expect(lent.scrolledTo()).toBe(Math.round(lent.headPx() - 360 * 0.15));

        const slider = element<HTMLInputElement>('roll-head-at');
        slider.value = '50';
        slider.dispatchEvent(new Event('input'));
        await aFrameOf();

        // Half of the 360 pixels of music, while it plays rather than from
        // the next time it is started.
        expect(lent.scrolledTo()).toBe(Math.round(lent.headPx() - 180));
        expect(element<HTMLOutputElement>('roll-head-at-value').value).toBe('50');
      } finally {
        lent.giveBack();
      }
    });

    it('greys out where the cursor stands while it walks instead', async () => {
      const { view } = createRig();
      await view.initialize();
      const box = element<HTMLInputElement>('roll-scroll-playback');
      const slider = element<HTMLInputElement>('roll-head-at');
      expect(slider.disabled).toBe(true);

      box.checked = true;
      box.dispatchEvent(new Event('change'));
      expect(slider.disabled).toBe(false);

      box.checked = false;
      box.dispatchEvent(new Event('change'));
      expect(slider.disabled).toBe(true);
    });

    it('remembers where the cursor stands', async () => {
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();
      const slider = element<HTMLInputElement>('roll-head-at');
      slider.value = '35';
      slider.dispatchEvent(new Event('input'));

      mountRealMarkup();
      const next = createRig(undefined, store);
      await next.view.initialize();

      expect(next.runtime.controller.settings.rollHeadAtPercent).toBe(35);
      expect(element<HTMLInputElement>('roll-head-at').value).toBe('35');
      expect(element<HTMLOutputElement>('roll-head-at-value').value).toBe('35');
    });

    it('sounds the beat the run was measured against, where it is asked for', async () => {
      // Seeing how far off the beat a note was is one thing; hearing it is the
      // sense that does the work at the keyboard.
      const { view, runtime, midi, metronome, clock } = createRig();
      await view.initialize();
      // A frame the pulse carries, so there is a beat in the roll at all: in
      // Wait mode the music holds still for the reader and no pulse runs.
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      metronome.advanceSubdivisions(8);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      metronome.clicks.length = 0;

      const played = runtime.controller.lastRoll;
      const marking = played === null ? [] : beatsWorthMarking(played);
      const began = played === null ? 0 : rollBeganAtMs(played);

      vi.useFakeTimers();
      try {
        // Asked for at a moment on the page's own clock, not at the moment it
        // fell in the run: the two clocks share nothing but a duration. The
        // first beat, at the start, handed over as the playback starts - as
        // its notes are - so it falls with them: left for the first tick, it
        // was placed a tick behind the sound, and heard late.
        const startedAt = clock.now();
        element<HTMLButtonElement>('roll-play').click();
        expect(metronome.clicks[0]?.atMs).toBe(startedAt + ((marking[0]?.atMs ?? 0) - began));
        expect(metronome.clicks[0]?.atMs).toBe(startedAt);
        expect(metronome.clicks[0]?.weight).toBe('downbeat');
        clock.advance(200);
        vi.advanceTimersByTime(100);

        // And every beat of the run exactly once, however many windows it took.
        for (let guard = 0; guard < 50 && runtime.takePlayer.playing !== null; guard += 1) {
          clock.advance(200);
          vi.advanceTimersByTime(100);
        }
      } finally {
        vi.useRealTimers();
      }

      expect(marking.length).toBeGreaterThan(1);
      expect(metronome.clicks).toHaveLength(marking.length);
      for (const asked of metronome.clicks) {
        expect(asked.weight).not.toBe('division');
      }
    });

    it('hands the beat over at once wherever a playback starts or moves, on the picture and on the notes, so the first is not late', async () => {
      const { view, runtime, midi, metronome, clock } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      metronome.advanceSubdivisions(8);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      const tapTheFirstBeat = (): void => {
        const grid = element('roll-body').querySelector<HTMLElement>('.roll__grid');
        if (grid === null) {
          throw new Error('expected a grid to tap');
        }
        grid.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0,
          width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
        grid.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1 }));
      };
      const change = (id: string, value: string): void => {
        const select = element<HTMLSelectElement>(id);
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      };
      // Each time, the beat the head stands on is asked for there and then,
      // before any tick of the page's timer.
      const theBeatIsAskedForNow = (what: string): void => {
        expect(metronome.clicks[0]?.atMs, what).toBe(clock.now());
        metronome.clicks.length = 0;
      };

      vi.useFakeTimers();
      try {
        metronome.clicks.length = 0;
        element<HTMLButtonElement>('roll-play').click();
        theBeatIsAskedForNow('started');
        clock.advance(600);
        vi.advanceTimersByTime(600);
        metronome.clicks.length = 0;
        // Moved back to the first beat while it sounds.
        tapTheFirstBeat();
        theBeatIsAskedForNow('moved');
        change('roll-speed', '75');
        theBeatIsAskedForNow('slowed');
        change('roll-grid', '2');
        theBeatIsAskedForNow('counted finer');
        element<HTMLButtonElement>('roll-stop').click();
        element<HTMLButtonElement>('roll-stop').click();
        // Silent, a change asks for no beat.
        change('roll-grid', '1');
        change('roll-speed', '100');
        expect(metronome.clicks).toEqual([]);
        element<HTMLButtonElement>('roll-close').click();

        // On the notes, from the beginning, and at another speed.
        element<HTMLButtonElement>('run-replay').click();
        expect(runtime.controller.replaying).toBe(true);
        theBeatIsAskedForNow('shown again');
        element<HTMLButtonElement>('focus-slower').click();
        expect(element<HTMLSelectElement>('roll-speed').value).not.toBe('100');
        theBeatIsAskedForNow('shown again slower');
      } finally {
        vi.useRealTimers();
      }
    });

    it('leaves the beat out of a playback that was not asked to have one', async () => {
      const { view, runtime, midi, metronome, clock } = createRig();
      await view.initialize();
      // A frame the pulse carries, so there is a beat in the roll at all: in
      // Wait mode the music holds still for the reader and no pulse runs.
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      metronome.advanceSubdivisions(8);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      element<HTMLInputElement>('roll-click').checked = false;
      metronome.clicks.length = 0;

      vi.useFakeTimers();
      try {
        element<HTMLButtonElement>('roll-play').click();
        clock.advance(200);
        vi.advanceTimersByTime(100);
      } finally {
        vi.useRealTimers();
      }

      expect(metronome.clicks).toEqual([]);
    });

    it('takes back the clicks it handed over whenever the sound stops or moves', async () => {
      // They go out a little ahead of the head, as the notes do, and the notes
      // are taken back whenever the playback stops or moves. Left, a pause was
      // followed by a click. His: "коли ставлю playback на паузу за пів біту,
      // то курсор зупиняється одразу, а playback після пів біту потім ще
      // зіграє ноту".
      const { view, runtime, midi, metronome, clock } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      metronome.advanceSubdivisions(16);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      // Found afresh each time: a finer grid draws the run again.
      const tap = (): void => {
        const grid = element('roll-body').querySelector<HTMLElement>('.roll__grid');
        if (grid === null) {
          throw new Error('expected a grid to tap');
        }
        grid.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0,
          width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
        grid.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10 }));
      };
      const change = (id: string, value: string): void => {
        const select = element<HTMLSelectElement>(id);
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const play = (): void => {
        element<HTMLButtonElement>('roll-play').click();
        clock.advance(100);
        vi.advanceTimersByTime(100);
      };

      vi.useFakeTimers();
      try {
        // Nothing of the drawing's is out while it is silent, and the one-off
        // clicks are also how the mode with no pulse places its beats.
        tap();
        change('roll-speed', '75');
        change('roll-grid', '2');
        element<HTMLButtonElement>('roll-stop').click();
        expect(metronome.clicksTakenBack).toBe(0);

        play();
        element<HTMLButtonElement>('roll-play').click();
        expect(metronome.clicksTakenBack, 'held').toBe(1);

        play();
        tap();
        expect(metronome.clicksTakenBack, 'moved').toBe(2);
        change('roll-speed', '50');
        expect(metronome.clicksTakenBack, 'slowed').toBe(3);
        change('roll-grid', '4');
        expect(metronome.clicksTakenBack, 'counted finer').toBe(4);
        element<HTMLButtonElement>('roll-stop').click();
        expect(metronome.clicksTakenBack, 'stopped').toBe(5);
      } finally {
        vi.useRealTimers();
      }
    });

    it('holds a playback where it is, and stops it back to the beginning', async () => {
      // Pausing and stopping are different questions: a reader working out what
      // happened in one bar plays it, holds it, looks, and plays on from there.
      const { view, runtime, midi, metronome, clock } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      metronome.advanceSubdivisions(8);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      const drawn = element('roll-body').querySelector<HTMLElement>('.roll');
      expect(element<HTMLButtonElement>('roll-stop').dataset['idle']).toBe('true');

      vi.useFakeTimers();
      try {
        element<HTMLButtonElement>('roll-play').click();
        clock.advance(300);
        vi.advanceTimersByTime(100);
        // Held: the sound stops and the head stays where it stopped.
        element<HTMLButtonElement>('roll-play').click();
      } finally {
        vi.useRealTimers();
      }

      expect(runtime.takePlayer.playing).toBeNull();
      expect(headAt(drawn)).toBe('0.300');
      expect(element<HTMLButtonElement>('roll-stop').dataset['idle']).toBeUndefined();
      expect(element('roll-play').getAttribute('aria-label')).toBe('Play (Space)');

      element<HTMLButtonElement>('roll-stop').click();

      // Stopped: back to the beginning, which is what stopping means.
      expect(headAt(drawn)).toBe('0.000');
      expect(element<HTMLButtonElement>('roll-stop').dataset['idle']).toBe('true');
    });

    it('goes back to where the marker was put, and pressed there, back to the beginning with the marker', async () => {
      const { view, runtime, midi, clock } = createRig();
      await view.initialize();
      // A recording two seconds long, played freely.
      for (const pitch of [60, 64, 67, 72]) {
        midi.noteOn(pitch, clock.now());
        clock.advance(400);
        midi.noteOff(pitch, clock.now());
        clock.advance(100);
      }
      element<HTMLButtonElement>('focus-keep').click();
      rowButton('takes-list', 'Look at this take').click();
      const drawn = element('roll-body');
      const back = element<HTMLButtonElement>('roll-stop');
      const place = (): string | undefined =>
        drawn.querySelector<HTMLElement>('.roll__place-mark')?.style.getPropertyValue('--roll-at');
      const icon = (): string | null => element('roll-stop-icon').getAttribute('d');
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      expect(back.dataset['idle']).toBe('true');
      expect(back.title).toBe('Back to the beginning. It is there already.');
      expect(back.getAttribute('aria-label')).toBe(back.title);

      // Put at 0.6 s: marked there, and the button would take it to the beginning.
      drawn.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0.6 * zoom, clientY: 1_000 }));
      expect([headAt(drawn), place()]).toEqual(['0.600', '0.600']);
      expect(back.dataset['idle']).toBeUndefined();
      expect(back.title).toBe('Back to the beginning, and the marker with it');
      const stop = icon();
      // Another drawing opened is put nowhere yet.
      element<HTMLButtonElement>('focus-takes').click();
      rowButton('takes-list', 'Look at this take').click();
      expect([headAt(drawn), place()]).toEqual(['0.000', '0.000']);
      drawn.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0.6 * zoom, clientY: 1_000 }));

      vi.useFakeTimers();
      try {
        element<HTMLButtonElement>('roll-play').click();
        clock.advance(500);
        vi.advanceTimersByTime(100);
        // Playing, it goes back to the marker; the marker stays where it was put.
        expect(back.title).toBe('Back to where the marker was put (Shift+Space)');
        expect(icon()).not.toBe(stop);
        back.click();
      } finally {
        vi.useRealTimers();
      }
      expect(runtime.takePlayer.playing).toBeNull();
      expect([headAt(drawn), place()]).toEqual(['0.600', '0.600']);
      expect(icon()).toBe(stop);

      // Held elsewhere, the same.
      vi.useFakeTimers();
      try {
        element<HTMLButtonElement>('roll-play').click();
        clock.advance(300);
        vi.advanceTimersByTime(100);
        element<HTMLButtonElement>('roll-play').click();
      } finally {
        vi.useRealTimers();
      }
      expect(headAt(drawn)).toBe('0.900');
      expect(back.title).toBe('Back to where the marker was put (Shift+Space)');
      back.click();
      expect(headAt(drawn)).toBe('0.600');

      // And there already, back to the beginning, the marker with it.
      back.click();
      expect([headAt(drawn), place()]).toEqual(['0.000', '0.000']);
      expect(back.dataset['idle']).toBe('true');
    });

    it('tells a pointer resting on a note what it was, painted as it is', async () => {
      // Each mark drawn as an element carried a title of its own; painted, the
      // canvas has one, changed to say whatever the pointer is over. His: "а чи
      // неможливо буде hover робити на canvas?".
      const { view, runtime, midi, metronome } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      metronome.advanceSubdivisions(16);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const grid = element('roll-body').querySelector<HTMLElement>('.roll__grid > .roll__paint');
      const note = view.rollScene?.notes[0];
      if (grid === null || note === undefined) {
        throw new Error('expected a painted note to point at');
      }
      // jsdom lays nothing out: the grid stands at the page's corner, a second
      // is the zoom's hundred and forty pixels, and a row the thirteen asked for.
      const rest = (atMs: number, row: number): void => {
        grid.dispatchEvent(
          new PointerEvent('pointermove', {
            bubbles: true,
            clientX: (atMs / 1000) * 140,
            clientY: row * 13 + 6,
          }),
        );
      };

      rest(note.fromMs + 5, note.row);
      expect(grid.title).toBe(note.says);

      // And nothing, where there is nothing to say.
      rest(note.fromMs + 5, note.row + 3);
      expect(grid.title).toBe('');
    });

    it('paints the three canvases in the frame after a scroll or a zoom, once however many ask', async () => {
      // One place for the view, and the drawing, the head and the keys all put
      // where it says in one frame: painted as the page scrolled, the notes
      // went behind the head in jerks. His: "скрол йде з ривками, але курсор
      // скролиться нормально".
      const painted: string[] = [];
      const sizes: Record<string, (node: HTMLElement) => number> = {
        clientWidth: (node) => (node.classList.contains('roll__grid') ? 300 : 0),
        clientHeight: (node) =>
          node.classList.contains('roll__grid')
            ? 150
            : node.classList.contains('roll__ruler')
              ? 19
              : node.classList.contains('roll__pedal')
                ? 15
                : 0,
      };
      const lent = Object.keys(sizes).map(
        (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
      );
      for (const [name, size] of Object.entries(sizes)) {
        Object.defineProperty(HTMLElement.prototype, name, {
          configurable: true,
          get(this: HTMLElement) {
            return size(this);
          },
        });
      }
      const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
        this: HTMLCanvasElement,
      ) {
        const lane = this.parentElement?.className ?? '';
        // A canvas that takes every stroke and keeps only that it was cleared,
        // which a painting does once.
        return new Proxy(
          {},
          {
            get: (_target, name) => (name === 'clearRect' ? () => painted.push(lane) : () => undefined),
            set: () => true,
          },
        ) as unknown as RenderingContext;
      });
      const frame = (): Promise<void> =>
        new Promise((done) => {
          requestAnimationFrame(() => done());
        });
      try {
        const { view, runtime, midi, metronome } = createRig();
        await view.initialize();
        runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
        element<HTMLButtonElement>('focus-play').click();
        const step = runtime.controller.session?.currentStep;
        midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
        metronome.advanceSubdivisions(48);
        element<HTMLButtonElement>('focus-stop').click();
        element<HTMLButtonElement>('run-roll-open').click();
        await frame();
        const each = ['roll__grid', 'roll__pedal', 'roll__ruler'];
        expect([...new Set(painted)].sort()).toEqual(each);

        painted.length = 0;
        for (let turn = 0; turn < 5; turn += 1) {
          element('roll-body').dispatchEvent(
            new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: 10 }),
          );
        }
        // Not until the frame, and then once.
        expect(painted).toEqual([]);
        await frame();
        expect([...painted].sort()).toEqual(each);

        painted.length = 0;
        const zoom = element<HTMLInputElement>('roll-zoom');
        for (const asked of ['200', '210']) {
          zoom.value = asked;
          zoom.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await frame();
        expect([...painted].sort()).toEqual(each);
      } finally {
        context.mockRestore();
        for (const [name, descriptor] of lent) {
          if (descriptor === undefined) {
            delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
          } else {
            Object.defineProperty(HTMLElement.prototype, name, descriptor);
          }
        }
      }
    });

    it('paints the notes being recorded on the drawing as they are played, and none once written in', async () => {
      const sizes: Record<string, (node: HTMLElement) => number> = {
        clientWidth: (node) => (node.classList.contains('roll__grid') ? 900 : 0),
        clientHeight: (node) =>
          node.classList.contains('roll__grid')
            ? 600
            : node.classList.contains('roll__ruler')
              ? 19
              : node.classList.contains('roll__pedal')
                ? 15
                : 0,
      };
      const lent = Object.keys(sizes).map(
        (name) => [name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)] as const,
      );
      for (const [name, size] of Object.entries(sizes)) {
        Object.defineProperty(HTMLElement.prototype, name, {
          configurable: true,
          get(this: HTMLElement) {
            return size(this);
          },
        });
      }
      // The grid's canvas writes down what is painted on it; the others paint nothing.
      const grid = new Recorder();
      const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
        this: HTMLCanvasElement,
      ) {
        return (this.parentElement?.classList.contains('roll__grid') === true
          ? grid
          : new Proxy({}, { get: () => () => undefined, set: () => true })) as unknown as RenderingContext;
      });
      try {
        const { view, sketches, runtime, clock, midi } = createRig();
        await view.initialize();
        runtime.controller.updateSettings({ countInBars: 0 });
        sketches.begin(
          {
            events: [
              { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5 },
              { kind: 'noteOff', atMs: 400, midi: 60 },
            ],
            beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
          },
          'Seen',
          1,
        );
        element<HTMLButtonElement>('focus-scores').click();
        element<HTMLButtonElement>('scores-show-sketches').click();
        rowButton('sketches-list', 'Edit this sketch').click();
        // How faint the notes painted are: a soft note is painted faint, and so is one being recorded.
        const faint = (): number[] =>
          [...new Set(grid.marks.filter((mark) => mark.how === 'fill' && mark.alpha > 0 && mark.alpha < 1).map((mark) => mark.alpha))];
        const painted = async (): Promise<number[]> => {
          grid.marks.length = 0;
          element<HTMLInputElement>('roll-zoom').dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise<void>((done) => {
            requestAnimationFrame(() => done());
          });
          return faint();
        };
        element<HTMLButtonElement>('roll-record').click();
        const before = await painted();
        grid.marks.length = 0;
        midi.noteOn(62, clock.now());
        // The one played, painted the moment it is struck, fainter than any written.
        const struck = faint().filter((alpha) => !before.includes(alpha));
        expect(struck).toHaveLength(1);
        element<HTMLButtonElement>('roll-record').click();
        // Written in, it is a note like the rest, and nothing is painted as being recorded.
        expect(await painted()).not.toContain(struck[0]);
      } finally {
        context.mockRestore();
        for (const [name, descriptor] of lent) {
          if (descriptor === undefined) {
            delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
          } else {
            Object.defineProperty(HTMLElement.prototype, name, descriptor);
          }
        }
      }
    });

    it('puts the head on the beat nearest where the grid was tapped', async () => {
      // The grid is the one thing in the sheet worth pointing at, and pointing
      // at a moment is how anybody looks at a recording. Where the tap lands
      // between two beats it takes the nearer, which is what the reader meant:
      // a beat is the thing worth pointing at, and a finger is a wide thing.
      const { view, runtime, midi, metronome } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      metronome.advanceSubdivisions(16);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const drawn = element('roll-body').querySelector<HTMLElement>('.roll');
      const grid = drawn?.querySelector<HTMLElement>('.roll__grid');
      if (grid === null || grid === undefined) {
        throw new Error('expected a grid to tap');
      }
      // jsdom lays nothing out, so the one measurement the view takes is given.
      grid.getBoundingClientRect = () => ({ left: 20, top: 0, right: 0, bottom: 0,
        width: 0, height: 0, x: 20, y: 0, toJSON: () => ({}) }) as DOMRect;

      // The zoom says a hundred and forty pixels to the second, so a hundred
      // and sixty-eight pixels in is a fifth of a second past the first beat.
      grid.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 188 }));

      expect(headAt(drawn)).toBe('1.000');
    });

    it('plays from where the head was put, and moves the sound when it is moved again', async () => {
      // Which is the point of being able to place it: a bar is worked out by
      // hearing it, and hearing it again, from the same place.
      const { view, runtime, midi, metronome } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      metronome.advanceSubdivisions(16);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const drawn = element('roll-body').querySelector<HTMLElement>('.roll');
      const grid = drawn?.querySelector<HTMLElement>('.roll__grid');
      if (grid === null || grid === undefined) {
        throw new Error('expected a grid to tap');
      }
      grid.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0,
        width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

      // The run's own beats, which is where a tap lands: pointed at rather than
      // calculated, so the test says nothing about the tempo of the material.
      const played = runtime.controller.lastRoll;
      if (played === null) {
        throw new Error('expected a run to have been written down');
      }
      const began = rollBeganAtMs(played);
      const beats = theMusicsBeats(played).map((beat) => beat.atMs - began);
      expect(beats.length).toBeGreaterThan(2);
      const second = beats[1] ?? 0;
      const third = beats[2] ?? 0;

      // Tapped a little past each beat rather than on it, because landing on
      // the beat is the claim: a finger does not hit a moment, it hits near one.
      const nudge = (third - second) / 10;
      const tapAt = (ms: number): void => {
        grid.dispatchEvent(
          new MouseEvent('click', { bubbles: true, clientX: ((ms + nudge) / 1000) * 140 }),
        );
      };

      tapAt(second);
      element<HTMLButtonElement>('roll-play').click();

      expect(runtime.takePlayer.positionMs).toBe(second);

      // And moved again while it is sounding, the sound goes with it.
      tapAt(third);

      expect(runtime.takePlayer.positionMs).toBe(third);
      expect(runtime.takePlayer.playing).not.toBeNull();

      element<HTMLButtonElement>('roll-stop').click();
    });

    it('names the bars of the drawing as the page numbers them', async () => {
      // Read off the printed bar lines, so a piece that does not begin at bar
      // one is not renumbered - and so a beat inside a bar, which is not a bar,
      // gets no name at all.
      const { view, runtime, midi, metronome } = createRig();
      await view.initialize();
      await runtime.controller.openScore({
        ...twoBarExercise({ tempoBpm: 60 }),
        firstBarNumber: 5,
      });
      // After the score: opening one settles the settings from what it asks for.
      // No repeat, because a lap nothing was played in has no picture to offer.
      runtime.controller.updateSettings({
        modeId: FLOW_MODE_ID,
        countInBars: 0,
        repeatRange: false,
      });
      element<HTMLButtonElement>('focus-play').click();
      // One tick to leave the count behind, which a run passes through even
      // when there is nothing to count.
      metronome.advanceSubdivisions(1);
      for (let guard = 0; guard < 40 && runtime.controller.session?.status === 'running'; guard += 1) {
        for (const note of runtime.controller.session?.currentStep?.expectedMidi ?? []) {
          midi.noteOn(note, 0);
        }
        metronome.advanceSubdivisions(1);
      }
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const named = (view.rollScene?.bars ?? []).map((bar) => bar.name);
      const beats = view.rollScene?.lines.length ?? 0;
      // Named as the page names them, which is from five rather than from one.
      expect(named[0]).toBe('5');
      // And only the bar lines: a beat inside a bar is not a bar.
      expect(named.length).toBeGreaterThan(0);
      expect(named.length).toBeLessThan(beats);
    });

    it('takes the run slower when it is asked to, clicks and all', async () => {
      // His: "чи можна додати speed щоб перевидитись мою гру повільніше?" - and
      // a MIDI performance slowed is the same performance with wider gaps, so
      // the beat has to stretch with it or the picture and the ear part company.
      const { view, runtime, midi, metronome, clock } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      metronome.advanceSubdivisions(16);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const speed = element<HTMLSelectElement>('roll-speed');
      speed.value = '50';
      speed.dispatchEvent(new Event('change', { bubbles: true }));
      expect(runtime.takePlayer.speed).toBe(0.5);

      const played = runtime.controller.lastRoll;
      const marking = played === null ? [] : beatsWorthMarking(played);
      const began = played === null ? 0 : rollBeganAtMs(played);
      metronome.clicks.length = 0;

      vi.useFakeTimers();
      try {
        element<HTMLButtonElement>('roll-play').click();
        clock.advance(200);
        vi.advanceTimersByTime(100);
      } finally {
        vi.useRealTimers();
      }

      // Two hundred milliseconds of room is a hundred of the run.
      expect(runtime.takePlayer.positionMs).toBe(100);
      // And a beat a hundred milliseconds further into the run is two hundred
      // milliseconds of room away, not one.
      const at = runtime.takePlayer.positionMs;
      expect(metronome.clicks[0]?.atMs).toBe(
        clock.now() + ((marking[0]?.atMs ?? 0) - began - at) / 0.5,
      );

      element<HTMLButtonElement>('roll-stop').click();
    });

    it('keeps the picture speed out of the shelf, and its own across playbacks', async () => {
      // One player, two places asking it for something. The shelf offers no
      // speed of its own, so a take played after the picture was slowed would
      // come out slow with nothing on screen to explain it.
      const rig = createRig();
      await rig.view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = rig.runtime.controller.session?.currentStep;
      rig.midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      // Something on the shelf to play, kept so the row stays put.
      rig.midi.noteOn(60, rig.clock.now());
      rig.clock.advance(200);
      rig.midi.noteOff(60, rig.clock.now());
      element<HTMLButtonElement>('focus-keep').click();

      element<HTMLButtonElement>('run-roll-open').click();
      const speed = element<HTMLSelectElement>('roll-speed');
      speed.value = '50';
      speed.dispatchEvent(new Event('change', { bubbles: true }));
      expect(rig.runtime.takePlayer.speed).toBe(0.5);

      rowButton('takes-list', 'Play this take').click();

      expect(rig.runtime.takePlayer.speed).toBe(1);

      // And the picture remembers what it was asked for.
      element<HTMLButtonElement>('roll-play').click();

      expect(rig.runtime.takePlayer.speed).toBe(0.5);
      element<HTMLButtonElement>('roll-stop').click();
    });

    it('draws and clicks what falls between the beats, when asked', async () => {
      // His: "чи можеш додати фічу щоб малювати не тільки основні долі, а й
      // 8мі/16ті? Та щоб метроном теж клікав у них?" - one switch for both,
      // because a line the eye sees and a click the ear hears have to be the
      // same grid.
      const { view, runtime, midi, metronome, clock } = createRig();
      await view.initialize();
      // Any material at all now: the cutting is asked for rather than read off
      // what the pulse happened to tick.
      await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
      element<HTMLButtonElement>('focus-play').click();
      metronome.advanceSubdivisions(1);
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      metronome.advanceSubdivisions(16);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const lines = (): number => view.rollScene?.lines.length ?? 0;
      const divisions = (): number =>
        (view.rollScene?.lines ?? []).filter((line) => line.kind === 'division').length;
      const beatsOnly = lines();
      expect(divisions()).toBe(0);

      const grid = element<HTMLSelectElement>('roll-grid');
      grid.value = '4';
      grid.dispatchEvent(new Event('change', { bubbles: true }));

      // More lines, and the new ones are drawn as what they are.
      expect(lines()).toBeGreaterThan(beatsOnly);
      expect(divisions()).toBeGreaterThan(0);

      // And the metronome is on the same grid: the finer clicks sound too.
      metronome.clicks.length = 0;
      vi.useFakeTimers();
      try {
        element<HTMLButtonElement>('roll-play').click();
        clock.advance(400);
        vi.advanceTimersByTime(100);
      } finally {
        vi.useRealTimers();
      }

      expect(metronome.clicks.some((asked) => asked.weight === 'division')).toBe(true);
      element<HTMLButtonElement>('roll-stop').click();

      // And the coarsest reading is fewer lines than the beats, not more: on a
      // long run that is the only one that can be read at a glance.
      grid.value = 'bars';
      grid.dispatchEvent(new Event('change', { bubbles: true }));

      expect(lines()).toBeLessThan(beatsOnly);
    });

    it('zooms the drawing with two fingers, and moves the slider with them', async () => {
      // His: "zoom слайдер маленький, та не дуже зручно їм користуватись". The
      // slider stays - there is no pinch on a desktop - but it follows, because
      // two controls disagreeing about one answer is the fault we keep removing.
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const body = element('roll-body');
      const drawn = body.querySelector<HTMLElement>('.roll');
      const finger = (
        type: string,
        pointerId: number,
        clientX: number,
      ): void => {
        body.dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId, clientX, clientY: 0 }),
        );
      };

      finger('pointerdown', 1, 0);
      finger('pointerdown', 2, 100);
      // Twice as far apart, so twice as close a drawing.
      finger('pointermove', 2, 200);

      expect(element<HTMLInputElement>('roll-zoom').value).toBe('280');
      // And the head's two marks told, which are what it places.
      for (const mark of drawn?.querySelectorAll<HTMLElement>('.roll__head, .roll__head-mark') ?? []) {
        expect(mark.style.getPropertyValue('--roll-second')).toBe('280px');
      }

      // And the fingers coming up is not a tap: the head stays where it was.
      const at = headAt(drawn);
      finger('pointerup', 2, 200);
      finger('pointerup', 1, 0);
      body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 400 }));

      expect(headAt(drawn)).toBe(at);
    });

    it('shortens the rows when the fingers pinch down the page', async () => {
      // Sixty rows of pitch at thirteen pixels each is most of a tall screen
      // before a note is drawn. There is no slider for it: the gesture is the
      // whole of how it is asked for. His: "зробити vertical pinch щоб все
      // зробити менше по висоті".
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const body = element('roll-body');
      const drawn = body.querySelector<HTMLElement>('.roll');
      const finger = (type: string, pointerId: number, clientY: number): void => {
        body.dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId, clientX: 0, clientY }),
        );
      };

      expect(drawn?.style.getPropertyValue('--roll-row-asked')).toBe('13px');

      finger('pointerdown', 1, 0);
      finger('pointerdown', 2, 200);
      // Half as far apart down the page, so half as tall a row.
      finger('pointermove', 2, 100);

      // Asked, and the stylesheet decides how much of it the room allows: a
      // row written straight over its own floor would take the floor away.
      expect(drawn?.style.getPropertyValue('--roll-row-asked')).toBe('7px');
      expect(drawn?.style.getPropertyValue('--roll-row')).toBe('');
      // And the width is left alone: the fingers were never apart across.
      expect(element<HTMLInputElement>('roll-zoom').value).toBe('140');
    });

    it('stretches the rows from the height they stand at, not the one last asked for', async () => {
      // Pinched down past the room they have, the rows stay filling it and the
      // row asked for is smaller than the one on the screen. Scaled from that,
      // a pinch up would move nothing until it had made up the difference.
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const body = element('roll-body');
      const drawn = body.querySelector<HTMLElement>('.roll');
      for (const key of body.querySelectorAll<HTMLElement>('.roll__key')) {
        key.getBoundingClientRect = () => new DOMRect(0, 0, 44, 18);
      }
      const finger = (type: string, pointerId: number, clientY: number): void => {
        body.dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId, clientX: 0, clientY }),
        );
      };

      finger('pointerdown', 1, 0);
      finger('pointerdown', 2, 100);
      finger('pointermove', 2, 200);

      // Twice the eighteen pixels it stands at, not twice the thirteen asked.
      expect(drawn?.style.getPropertyValue('--roll-row-asked')).toBe('36px');
    });

    it('takes two fingers and no more, and lets go when one lifts', async () => {
      // A third finger on the drawing is a hand resting, not a wider pinch; and
      // one finger left behind is a scroll, not half a pinch.
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const body = element('roll-body');
      const zoom = element<HTMLInputElement>('roll-zoom');
      const finger = (type: string, pointerId: number, clientX: number): void => {
        body.dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId, clientX, clientY: 0 }),
        );
      };
      const wasAt = zoom.value;

      finger('pointerdown', 1, 0);
      finger('pointerdown', 2, 100);
      finger('pointerdown', 3, 300);
      // Moving one of the *first* two, which is the move that would zoom if a
      // third finger were being ignored rather than answered.
      finger('pointermove', 2, 400);

      expect(zoom.value).toBe(wasAt);

      // Down to two again, so a pinch from here is measured from here.
      finger('pointerup', 3, 300);
      finger('pointermove', 2, 800);
      expect(zoom.value).toBe('280');

      // And one lifted leaves nothing to pinch with.
      finger('pointerup', 2, 200);
      finger('pointermove', 1, 900);

      expect(zoom.value).toBe('280');
    });

    it('keeps the picture options in a sheet of their own', async () => {
      // Five controls beside a transport is a row that breaks on a phone held
      // upright, which is the device the rest of this interface was rebuilt
      // around. His: "може варто це винести як діалог?".
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      expect(element('sheet-roll-options').hidden).toBe(true);

      element<HTMLButtonElement>('roll-options').click();
      expect(element('sheet-roll-options').hidden).toBe(false);

      element<HTMLButtonElement>('roll-options-close').click();
      expect(element('sheet-roll-options').hidden).toBe(true);

      // And the dimmed area outside the panel closes it too, which a thumb finds
      // without aiming.
      element<HTMLButtonElement>('roll-options').click();
      tapOutside(element('sheet-roll-options'));

      expect(element('sheet-roll-options').hidden).toBe(true);

      // And they go away with the picture they are about.
      element<HTMLButtonElement>('roll-options').click();
      element<HTMLButtonElement>('roll-close').click();

      expect(element('sheet-roll-options').hidden).toBe(true);
      expect(element('sheet-roll').hidden).toBe(true);
    });

    it('points exactly where the reader turns the snapping off', async () => {
      const { view, runtime, midi, metronome } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      metronome.advanceSubdivisions(16);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const drawn = element('roll-body').querySelector<HTMLElement>('.roll');
      const gridEl = drawn?.querySelector<HTMLElement>('.roll__grid');
      if (gridEl === null || gridEl === undefined) {
        throw new Error('expected a grid to tap');
      }
      gridEl.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0,
        width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

      element<HTMLInputElement>('roll-snap').checked = false;
      // Seventy pixels at a hundred and forty to the second is half a second,
      // which is not where any beat of this run falls.
      gridEl.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 70 }));

      expect(headAt(drawn)).toBe('0.500');
    });

    it('shows the notes that were asked for, when they are asked for', async () => {
      // Including the ones the run never got, which are the ones worth seeing:
      // a note nobody played has nothing to colour.
      const { view, runtime, midi, metronome } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      metronome.advanceSubdivisions(16);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      // Shown from the start, because he keeps them on: "я думаю що ghost ноти
      // варто мати включеними постійно".
      expect(view.rollScene?.ghosts.length).toBeGreaterThan(0);

      const ghosts = element<HTMLInputElement>('roll-ghosts');
      ghosts.checked = false;
      ghosts.dispatchEvent(new Event('change', { bubbles: true }));

      expect(view.rollScene?.ghosts).toHaveLength(0);
    });

    it('sections every slowdown, including the ones between the clicks', async () => {
      // The fault he found in the first attempt at this. A waiting run's beats
      // are the clicks he asked for, so an entry that falls between two of them
      // has no beat to be recorded twice - and with the section drawn off that
      // pair, three entries in four on sixteenths had no section and got a band
      // on the note's own row instead, one row tall and in the wait's own
      // yellow. His: "чому ти до сих пір малюєш жовті ноти замість жовтих
      // секцій".
      const { view, runtime, midi, clock } = createRig();
      await view.initialize();
      await runtime.controller.openScore(beamedSixteenths({ tempoBpm: 60 }));
      runtime.controller.updateSettings({
        modeId: new WaitMode().id,
        clickWhen: 'with-me',
        countInBars: 0,
        repeatRange: false,
      });
      element<HTMLButtonElement>('focus-play').click();

      // A written sixteenth is a quarter of a second here. He takes seven
      // tenths over every one of them, so each is four hundred and fifty
      // milliseconds of the music standing still.
      let at = 1_000;
      for (let guard = 0; guard < 20 && runtime.controller.session?.status === 'running'; guard += 1) {
        at += 700;
        clock.set(at);
        for (const note of runtime.controller.session?.currentStep?.expectedMidi ?? []) {
          midi.noteOn(note, clock.now());
        }
      }
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const said = (view.rollScene?.waits ?? []).map((band) => band.says);
      // One for every entry, and not one for every fourth: the click marks the
      // beat, and he was reading sixteenths.
      expect(said.filter((title) => title === 'The music waited 450 ms').length).toBeGreaterThan(3);
      // And nothing on a note's own row, which is the mark he never asked for.
      expect(view.rollScene?.slips).toHaveLength(0);
    });

    it('sections a note waited for, and reddens nothing a reader simply took faster', async () => {
      // The grid of a waiting run is even, and what is not even about the
      // reading goes into the picture as a section the music stood still for -
      // the same mark and the same meaning as the wait at a bar line's gate.
      // Coming in early has no section to draw, there being no time there at
      // all, so the line he came in on says it instead. His: "прохав щоб сітка
      // виглядала рівно - а там де нерівності із-за гравця - кожен такий
      // slowdown замальовувати жовтою секцією just like у wait for bars".
      const { view, runtime, midi, clock } = createRig();
      await view.initialize();
      await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
      runtime.controller.updateSettings({
        modeId: new WaitMode().id,
        clickWhen: 'with-me',
        countInBars: 0,
        repeatRange: false,
      });
      element<HTMLButtonElement>('focus-play').click();

      // A written quarter is a second here. The second step is dawdled over and
      // the third is snatched at.
      const gaps = [0, 1_800, 400, 1_000, 1_000, 1_000, 1_000, 1_000];
      let at = 5_000;
      for (let guard = 0; guard < gaps.length && runtime.controller.session?.status === 'running'; guard += 1) {
        at += gaps[guard] ?? 1_000;
        clock.set(at);
        for (const note of runtime.controller.session?.currentStep?.expectedMidi ?? []) {
          midi.noteOn(note, clock.now());
        }
      }
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      // Eight tenths late where he waited, six tenths early where he did not.
      const waits = (view.rollScene?.waits ?? []).map((band) => band.says);
      expect(waits).toContain('The music waited 800 ms');
      // And the five seconds he took to reach the first note at all: the music
      // was ready the moment the run began, which is the section that used not
      // to be in the picture because nothing had written that beat down.
      expect(waits).toContain('The music waited 5000 ms');
      // And nothing red, though he took the third note six tenths of a second
      // sooner than the written distance. In a frame that waits the reader is
      // the clock: a faster pace is not a fault, and there is no tempo there to
      // be judged against. Coming in early means going past a beat the run had
      // counted out, and between two entries a beat apart it counts none. Left
      // as it was, reading quarters at speed turned every line red, which he
      // read as the grid having gone: "тепер лінії взагалі зникли".
      expect(view.rollScene?.rushes).toHaveLength(0);

      // And the notes asked for keep their written lengths, whatever the reader
      // did about arriving at them: a quarter here is a second, a half is two.
      const outlines = (view.rollScene?.ghosts ?? []).map((outline) => outline.untilMs - outline.fromMs);
      expect(outlines.length).toBeGreaterThan(1);
      for (const lasts of outlines) {
        expect(lasts).toBeGreaterThan(0);
      }
      expect(outlines.map((lasts) => Math.round(lasts))).toContain(1000);
    });

    it('gives a note no band of its own in a frame that waits', async () => {
      // The band says how far off the beat one note came, which is the only
      // mark there is for it under a pulse. Where the music waits, that same gap
      // is the music standing still and is drawn full height as a section - and
      // a band as well is the gap drawn twice, the second time as one row of
      // yellow on the note's own line. Which is a yellow note, and is what he
      // was still seeing: "чому ти до сих пір малюєш жовті ноти замість жовтих
      // секцій". A chord that went down in pieces still shows as one: the
      // presses are drawn where they were struck, and their edges are staggered.
      const { view, runtime, midi, clock } = createRig();
      await view.initialize();
      await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
      runtime.controller.updateSettings({
        modeId: new WaitMode().id,
        clickWhen: 'with-me',
        countInBars: 0,
        repeatRange: false,
      });
      element<HTMLButtonElement>('focus-play').click();

      // The first chord in pieces, then the rest of the bar together: a run has
      // to reach two places in the music before anything between them can be
      // put anywhere at all.
      let at = 5_000;
      const first = [...(runtime.controller.session?.currentStep?.expectedMidi ?? [])];
      expect(first.length).toBeGreaterThan(1);
      first.forEach((note, index) => {
        clock.set(at + index * 150);
        midi.noteOn(note, clock.now());
      });
      for (let guard = 0; guard < 12 && runtime.controller.session?.status === 'running'; guard += 1) {
        at += 1_000;
        clock.set(at);
        for (const note of runtime.controller.session?.currentStep?.expectedMidi ?? []) {
          midi.noteOn(note, clock.now());
        }
      }
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      expect(view.rollScene?.ghosts.length).toBeGreaterThan(0);
      expect(view.rollScene?.slips).toHaveLength(0);
      // And the chord is still legibly in pieces: two notes, struck a hundred
      // and fifty milliseconds apart, drawn where they were struck.
      const struck = (view.rollScene?.notes ?? []).map((note) => note.fromMs).slice(0, 2);
      expect(struck[0]).not.toBe(struck[1]);
    });

    it('bands every note of a run played behind the beat', async () => {
      // Which is also where the pairing shows: each note asked for is measured
      // against the press that answered *it*. Paired by pitch, a press would be
      // measured against whichever reading of that note came first, and most
      // notes would find no press at all and be banded not at all.
      const { view, runtime, midi, metronome, clock } = createRig();
      await view.initialize();
      // Known material, because the claim counts bands: generated notes differ
      // from run to run, and a count off that is a test that passes by luck.
      await runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
      runtime.controller.updateSettings({
        modeId: FLOW_MODE_ID,
        countInBars: 0,
        repeatRange: false,
      });
      element<HTMLButtonElement>('focus-play').click();
      metronome.advanceSubdivisions(1);
      for (let guard = 0; guard < 60 && runtime.controller.session?.status === 'running'; guard += 1) {
        // A tenth of a second behind each beat, every time.
        clock.advance(100);
        for (const note of runtime.controller.session?.currentStep?.expectedMidi ?? []) {
          midi.noteOn(note, clock.now());
        }
        metronome.advanceSubdivisions(1);
      }
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const bands = view.rollScene?.slips ?? [];
      expect(bands.length).toBeGreaterThan(1);
      for (const band of bands) {
        expect(band.kind).toBe('late');
      }

      // And they can be put away, for the question they are in the way of.
      const slips = element<HTMLInputElement>('roll-slips');
      slips.checked = false;
      slips.dispatchEvent(new Event('change', { bubbles: true }));

      expect(view.rollScene?.slips).toHaveLength(0);
      expect(view.rollScene?.notes.length).toBeGreaterThan(0);
    });

    it('stops the run sounding when its drawing is put away', async () => {
      // A sheet closed on a playback that goes on playing is a note the reader
      // cannot get at to stop.
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      element<HTMLButtonElement>('roll-play').click();

      element<HTMLButtonElement>('roll-close').click();

      expect(runtime.takePlayer.playing).toBeNull();
      expect(element('sheet-roll').hidden).toBe(true);
    });

    it('says nothing about a run nothing was played in', async () => {
      // A grid with no notes on it is a picture of nothing, and a button that
      // opens one is a button that lies about having something to show.
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      element<HTMLButtonElement>('focus-stop').click();

      expect(element('result').querySelector('#run-roll-open')).toBeNull();
    });

    it('zooms the head with the drawing', async () => {
      // The drawing is painted at the zoom; the head is placed by it.
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const zoom = element<HTMLInputElement>('roll-zoom');
      zoom.value = '320';
      zoom.dispatchEvent(new Event('input', { bubbles: true }));

      const drawn = element('roll-body').querySelector<HTMLElement>('.roll');
      for (const mark of drawn?.querySelectorAll<HTMLElement>('.roll__head, .roll__head-mark') ?? []) {
        expect(mark.style.getPropertyValue('--roll-second')).toBe('320px');
      }
      expect(drawn?.querySelectorAll('.roll__head, .roll__head-mark')).toHaveLength(2);
    });

    it('offers the last reading once it is no longer on screen', async () => {
      // His: "я можу поставити на repeat випадково, та в кінці діалог зявляється
      // та дуже швидко зникає - тому я пропустив всю статистику". Starting a run
      // is what puts the verdict away, and with repeat on that happens in the
      // same frame it went up - so there has to be a way back to it.
      const { view } = createRig();
      await view.initialize();
      expect(element('score-reading').hidden).toBe(true);

      // A run put the verdict away, and there is still no reading behind it -
      // so there is nothing to offer a way back to.
      element<HTMLButtonElement>('focus-play').click();
      expect(element('score-reading').hidden).toBe(true);

      element<HTMLButtonElement>('focus-stop').click();

      // On screen, so the button for it would be a button for what is already
      // being looked at.
      expect(element('score-verdict').hidden).toBe(false);
      expect(element('score-reading').hidden).toBe(true);

      element<HTMLButtonElement>('focus-play').click();

      // Not over music that is playing: the page should be the page, and a
      // button for something the reader is not looking at is in the way. His:
      // "коли гра почалась - можеш і пілюлю з last run теж ховати?".
      expect(element('score-verdict').hidden).toBe(true);
      expect(element('score-reading').hidden).toBe(true);

      // Stopped, and the verdict put away by hand: now it is the only way back.
      element<HTMLButtonElement>('focus-stop').click();
      element('score-verdict').dispatchEvent(new Event('click', { bubbles: true }));

      expect(element('score-verdict').hidden).toBe(true);
      expect(element('score-reading').hidden).toBe(false);
    });

    it('puts the last reading back whole, strip and all', async () => {
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('focus-play').click();
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('focus-play').click();
      // The panel is where messages go too, so what is in it may be anything.
      expect(element('score-verdict').hidden).toBe(true);

      const before = element('result').querySelector('.run-strip');

      element<HTMLButtonElement>('score-reading').click();

      expect(element('score-verdict').hidden).toBe(false);
      expect(element('result').textContent).toContain('Overall');
      // Built again rather than merely shown again: the panel holds messages
      // too, so what is in it may be anything by the time the reader asks.
      const after = element('result').querySelector('.run-strip');
      expect(after).not.toBeNull();
      expect(after).not.toBe(before);
    });

    it('draws the run as a strip of bars before it explains itself in numbers', async () => {
      // His: "цифрами іноді мій мозок просто йде у loading". A row of numbers
      // answers "how well"; the strip answers "where", and answers it without
      // being read. It stands first in the card for the same reason.
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      element<HTMLButtonElement>('focus-stop').click();

      const strip = element('result').querySelector('.run-strip');
      const cells = [...(strip?.querySelectorAll('.run-strip__bar') ?? [])];

      expect(strip).not.toBeNull();
      expect(element('result').firstElementChild).toBe(strip);
      // One cell per bar of the run, and each says what it was in a word.
      expect(cells.length).toBeGreaterThan(1);
      for (const cell of cells) {
        expect(cell.getAttribute('title')).toMatch(/^Bar \d+/);
        expect(['clean', 'wrong', 'unread']).toContain(cell.getAttribute('data-state'));
      }
    });

    it('draws where the presses landed, after a run that kept the beat', async () => {
      // Two numbers cannot show a shape: ten presses early and ten late have
      // the same average as a reading dead on the beat every time. His: "hit
      // error bar як в osu".
      const { view, runtime, midi, metronome, clock } = createRig();
      await view.initialize();
      // A frame that keeps the beat, which is the only kind this can be read
      // in: the rig's own is one that waits.
      runtime.controller.updateSettings({
        modeId: FLOW_MODE_ID,
        matchToleranceMs: 250,
        countInBars: 0,
      });
      element<HTMLButtonElement>('focus-play').click();
      // Each press nudged off the beat it belongs to, so the marks land in
      // different places: the shape is the whole of what the strip is for.
      // Through the count-in, which this frame has whatever the setting says.
      for (let guard = 0; guard < 64 && runtime.controller.session?.status === 'counting-in'; guard += 1) {
        metronome.advanceSubdivisions(1);
      }
      for (const off of [40, -30, 80, -10, 120, 0]) {
        const step = runtime.controller.session?.currentStep;
        if (step === null || step === undefined) {
          break;
        }
        clock.advance(off);
        midi.playChord([...step.expectedMidi]);
        clock.advance(-off);
        metronome.advanceSubdivisions(4);
      }
      element<HTMLButtonElement>('focus-stop').click();

      const bar = element('result').querySelector('#run-hits');
      const ticks = bar?.querySelectorAll('.hit-bar__tick') ?? [];

      expect(bar).not.toBeNull();
      expect(ticks.length).toBeGreaterThanOrEqual(4);
      // In the colours of their notes, with the window they had to land in.
      expect([...ticks].every((tick) => ['perfect', 'good'].includes((tick as HTMLElement).dataset['tier'] ?? ''))).toBe(true);
      expect(bar?.querySelector('.hit-bar__perfect')).not.toBeNull();
      expect(bar?.textContent).toMatch(/\d+ perfect · \d+ good/);
      // The edges are the window the run was judged in, not a number of this
      // drawing's own: widen the tolerance and the strip means the same thing
      // about a looser reading.
      expect(bar?.textContent).toContain('250 ms early');
      expect(bar?.textContent).toContain('250 ms late');
    });

    it('leaves where the presses landed off a frame that waits', async () => {
      // There a "deviation" is how long they took to arrive and not how far off
      // they were - the same confusion that emptied two axes of the shape
      // beside it - and a row of arrival times against a tolerance would draw a
      // patient reading as a wild one, every mark pinned against the late edge.
      const { view, runtime, midi } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({
        modeId: new WaitMode().id,
        matchToleranceMs: 250,
        countInBars: 0,
        clickOn: false,
      });
      element<HTMLButtonElement>('focus-play').click();
      for (let played = 0; played < 6; played += 1) {
        const step = runtime.controller.session?.currentStep;
        if (step === null || step === undefined) {
          break;
        }
        for (const note of step.expectedMidi) {
          midi.noteOn(note, played * 600);
        }
      }
      element<HTMLButtonElement>('focus-stop').click();

      expect(element('result').querySelector('#run-hits')).toBeNull();
      // And the run did happen, so this is not an empty report saying nothing.
      expect(element('result').querySelector('.run-strip')).not.toBeNull();
    });

    it('puts up no verdict for a run stopped while it was being counted in', async () => {
      // Nothing was played, so there is nothing to grade - a verdict there
      // would be a grade for keys never touched.
      const { view, runtime, metronome } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ countInBars: 1, modeId: FLOW_MODE_ID });
      await runtime.controller.reloadExercise();

      element<HTMLButtonElement>('focus-play').click();
      metronome.advanceBeats(1);
      expect(element('score-count').hidden).toBe(false);
      element<HTMLButtonElement>('focus-stop').click();

      expect(element('score-verdict').hidden).toBe(true);
      expect(element('result').textContent).toBe('');
    });

    it('says how many bar lines the music waited at, where there are any', async () => {
      // His, and it is the measure of when to leave the mode for Flow: not how
      // many notes were right but how many times the music had to stop. Said
      // as a fraction of the bars read, because three in four bars and three
      // in forty are opposite readings - and said at nought too, since that is
      // the reading worth arriving at.
      const { view, runtime, metronome } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      frameButton('bar').click();
      await Promise.resolve();
      expect(runtime.controller.settings.modeId).toBe(BAR_MODE_ID);

      element<HTMLButtonElement>('sheet-modes').dispatchEvent(
        new Event('click', { bubbles: true }),
      );
      element<HTMLButtonElement>('focus-play').click();
      // The music begins on the pulse's first tick; stopped before it, the
      // run would have nothing to report.
      metronome.advanceBeats(1);
      element<HTMLButtonElement>('focus-stop').click();

      expect(element('result').textContent).toContain('Bars it waited at');
      // A fraction, because the number alone says nothing: three in four bars
      // and three in forty are opposite readings.
      expect(element('result').textContent).toMatch(/Bars it waited at\s*\d+ of \d+/);
    });

    it('says how many notes the music waited at, where every note waits', async () => {
      // The bar line's number, a note at a time, and a fraction for the same
      // reason: of the notes the reader was asked for.
      const { view, runtime, metronome } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      frameButton('note').click();
      await Promise.resolve();
      expect(runtime.controller.settings.modeId).toBe(NOTE_MODE_ID);

      element<HTMLButtonElement>('sheet-modes').dispatchEvent(
        new Event('click', { bubbles: true }),
      );
      element<HTMLButtonElement>('focus-play').click();
      metronome.advanceBeats(1);
      element<HTMLButtonElement>('focus-stop').click();

      expect(element('result').textContent).toMatch(/Notes it waited at\s*\d+ of \d+/);
      expect(element('result').textContent).not.toContain('Bars it waited at');
    });

    it('offers each frame as a button of its own, one lit at a time', async () => {
      // His, after the mods of a rhythm game: a button for each frame, first in
      // the squares' own row and dressed as they are, and one of them lit at
      // most. Flowing in time has no button - it is what none lit means.
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      const buttons = [...element('modes-grid').querySelectorAll<HTMLButtonElement>('button[data-frame]')];
      expect(buttons.map((button) => button.dataset['frame'])).toEqual(['bar', 'note', 'wait', 'listen', 'free']);
      expect(element('modes-grid').firstElementChild).toBe(buttons[0]);
      expect(buttons.every((button) => button.classList.contains('mode-card'))).toBe(true);
      const lit = (): string[] =>
        buttons
          .filter((button) => button.getAttribute('aria-pressed') === 'true')
          .map((button) => button.dataset['frame'] ?? '');
      // Each says what it is, drawn and in words.
      expect(frameButton('bar').querySelector('.frame__what')?.textContent).toContain('bar line');
      expect(frameButton('note').querySelector('.frame__name')?.textContent).toBe('Wait each note');
      expect(frameButton('listen').querySelector('.frame__what')?.textContent).toContain('machine');
      expect(frameButton('free').querySelector('.frame__name')?.textContent).toBe('Free play');
      expect(new Set(buttons.map((button) => button.querySelector('path')?.getAttribute('d'))).size).toBe(5);
      // The rig starts where it waits.
      expect(lit()).toEqual(['wait']);

      frameButton('listen').click();

      expect(runtime.controller.settings.modeId).toBe(LISTEN_MODE_ID);
      expect(lit()).toEqual(['listen']);

      // Pressed again, it goes out, and the run flows in time.
      frameButton('listen').click();

      expect(runtime.controller.settings.modeId).toBe(FLOW_MODE_ID);
      expect(lit()).toEqual([]);

      frameButton('bar').click();
      frameButton('note').click();

      expect(runtime.controller.settings.modeId).toBe(NOTE_MODE_ID);
      expect(lit()).toEqual(['note']);
    });

    it('puts out what a frame cannot go with, and a frame what a square cannot', async () => {
      // Each button knows what it cannot go with, and whichever is pressed
      // last wins: nothing is refused, the other simply goes out.
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      const square = (mode: string): HTMLButtonElement =>
        element('modes-grid').querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`) as HTMLButtonElement;

      // Listening asks nothing of the reader, so nothing that makes the
      // reading harder has anything to act on.
      square('survival').click();
      square('cursor').click();
      frameButton('listen').click();

      expect(runtime.controller.settings.modeId).toBe(LISTEN_MODE_ID);
      expect(runtime.controller.settings.survival).toBe(false);
      expect(square('cursor').getAttribute('aria-pressed')).toBe('false');

      square('blind').click();

      expect(runtime.controller.settings.modeId).toBe(FLOW_MODE_ID);
      expect(square('blind').getAttribute('aria-pressed')).toBe('true');

      // Rhythm only asks for the time the frame that waits for the reader
      // never keeps.
      square('rhythm').click();
      frameButton('wait').click();

      expect(runtime.controller.settings.modeId).toBe(WAIT_MODE_ID);
      expect(runtime.controller.settings.rhythmOnly).toBe(false);
      // The blind square goes with waiting, and stays.
      expect(square('blind').getAttribute('aria-pressed')).toBe('true');

      // Asked for again, the frame that keeps time comes back with it.
      square('rhythm').click();

      expect(runtime.controller.settings.rhythmOnly).toBe(true);
      expect(runtime.controller.settings.modeId).toBe(FLOW_MODE_ID);
    });

    it('offers a third frame, in which the machine plays and nothing is judged', async () => {
      // His: not a playback beside the modes but a mode of its own - the one
      // where you sit back and watch the machine play. Start is what plays
      // it; there is no second transport.
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      frameButton('listen').click();

      expect(runtime.controller.machinePlays).toBe(true);
      expect(frameButton('listen').getAttribute('aria-pressed')).toBe('true');

      element<HTMLButtonElement>('focus-play').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Start played it rather than beginning a run nobody asked for.
      expect(runtime.controller.isListening).toBe(true);
      expect(runtime.controller.session?.status).not.toBe('running');
    });

    it('puts the bar into playing chrome for a performance too', async () => {
      // A performance is not a session, so the bar kept all its chrome over
      // music that was going - and Stop, which now stands only while there
      // is something to stop, would have gone missing exactly where it is
      // needed. jsdom applies no stylesheet; the attribute is what it reads.
      const { view, runtime } = createRig();
      await view.initialize();
      expect(element('focus-bar').getAttribute('data-playing')).toBe('false');

      await pressListen(runtime.controller);

      expect(runtime.controller.isListening).toBe(true);
      expect(element('focus-bar').getAttribute('data-playing')).toBe('true');

      element<HTMLButtonElement>('focus-stop').click();

      expect(runtime.controller.isListening).toBe(false);
      expect(element('focus-bar').getAttribute('data-playing')).toBe('false');
    });

    it('marks the Start button with what it will start', async () => {
      // The reader presses Start without looking. What it will start is the
      // one thing it may need to say, and only where the answer is not the
      // plain one - the run they get without asking for anything, which is
      // the frame the app opens in. The badge is that frame's own mark, the
      // same one the page's corner carries, said where the finger is.
      const { view, runtime } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID });
      element<HTMLButtonElement>('focus-modes').click();
      expect(element('focus-play-frame').hidden).toBe(true);

      runtime.controller.updateSettings({ modeId: LISTEN_MODE_ID });
      element<HTMLButtonElement>('focus-modes').click();

      expect(element('focus-play-frame').hidden).toBe(false);
      expect(element('focus-play-frame').querySelector('svg')).not.toBeNull();
      // On the button itself, so it travels with it into fullscreen.
      expect(element('focus-play').contains(element('focus-play-frame'))).toBe(true);

      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID });
      element<HTMLButtonElement>('focus-modes').click();

      expect(element('focus-play-frame').hidden).toBe(true);
    });

    it('says on the page itself that something is playing', async () => {
      // The corner that names the modes is at the other end of the layout
      // from the bar, so the page carries the state too - the stylesheet
      // takes the marks back from there while the music is going.
      const { view } = createRig();
      await view.initialize();
      expect(document.body.dataset['playing']).toBe('false');

      element<HTMLButtonElement>('focus-play').click();

      expect(document.body.dataset['playing']).toBe('true');

      element<HTMLButtonElement>('focus-stop').click();

      expect(document.body.dataset['playing']).toBe('false');
    });

    it('says in the corner when the frame is not the plain one', async () => {
      // Start means something different in each frame, and a reader can be
      // left in one. Unsaid, they could sit down to practise and have the
      // machine play at them. The frame the app opens in is the run nobody
      // has to be told about; the corner is for the other two.
      const { view, runtime } = createRig();
      await view.initialize();
      const marks = (): string[] =>
        [...element('score-modes').querySelectorAll('[data-mode]')].map(
          (mark) => mark.getAttribute('data-mode') ?? '',
        );
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID });
      element<HTMLButtonElement>('focus-modes').click();
      expect(element('score-modes').hidden).toBe(true);

      runtime.controller.updateSettings({ modeId: LISTEN_MODE_ID });
      element<HTMLButtonElement>('focus-modes').click();

      expect(marks()).toEqual(['listen']);
      expect(element('score-modes').hidden).toBe(false);

      // And the frame leads whatever else is on.
      runtime.controller.updateSettings({ modeId: BAR_MODE_ID });
      (element('modes-grid').querySelector('[data-mode="blind"]') as HTMLButtonElement).click();

      expect(marks()).toEqual(['bar', 'blind']);

      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID });
      element<HTMLButtonElement>('focus-modes').click();

      expect(marks()).toEqual(['blind']);
    });

    it('turns a mode on from the squares in front of the reader', async () => {
      // His shape and his reasons: four lines apart in a drawer are four
      // things to remember, and four squares are a state you can see. Each
      // square is the setting it names - there is one answer to "am I playing
      // survival", and this is another way of reading and writing it.
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      expect(element('sheet-modes').hidden).toBe(false);
      const survival = element('modes-grid').querySelector('[data-mode="survival"]');

      (survival as HTMLButtonElement).click();

      expect(runtime.controller.settings.survival).toBe(true);
      expect(survival?.getAttribute('aria-pressed')).toBe('true');

      (survival as HTMLButtonElement).click();

      expect(runtime.controller.settings.survival).toBe(false);
    });

    it('turns off whatever a square empties, either way round', async () => {
      // His: both squares answer. "One wrong note ends the run" says nothing
      // while "any note counts", so each of the two turns the other off -
      // which the reader watches happen, rather than pressing a square that
      // refuses and explains itself.
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      const square = (mode: string): HTMLButtonElement =>
        element('modes-grid').querySelector(`[data-mode="${mode}"]`) as HTMLButtonElement;

      square('strict').click();

      expect(runtime.controller.settings.stopAtAMistake).toBe(true);

      square('rhythm').click();

      expect(runtime.controller.settings.rhythmOnly).toBe(true);
      expect(runtime.controller.settings.stopAtAMistake).toBe(false);
      expect(square('strict').getAttribute('aria-pressed')).toBe('false');

      // And back the other way, which is the half that used to refuse.
      square('strict').click();

      expect(runtime.controller.settings.stopAtAMistake).toBe(true);
      expect(runtime.controller.settings.rhythmOnly).toBe(false);
      expect(square('rhythm').getAttribute('aria-pressed')).toBe('false');
      expect(square('strict').getAttribute('aria-pressed')).toBe('true');
    });

    it('takes the marker away as a square, reading the setting backwards', async () => {
      // The fifth square, and the one where the square and the setting point
      // opposite ways: the square is the challenge and the setting is the
      // comfort, so pressing it turns the cursor *off*. It owns the cursor
      // for the reader's own run and nothing else - the one while the
      // machine plays is not a challenge, it is a convenience.
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      const square = element('modes-grid').querySelector('[data-mode="cursor"]') as HTMLButtonElement;
      expect(square.getAttribute('aria-pressed')).toBe('false');

      square.click();

      expect(runtime.controller.settings.cursorWhileRunning).toBe(false);
      expect(square.getAttribute('aria-pressed')).toBe('true');
      // Untouched, both of them.
      expect(runtime.controller.settings.cursorWhileListening).toBe(true);
      expect(runtime.controller.settings.cursorAtRest).toBe(true);

      square.click();

      expect(runtime.controller.settings.cursorWhileRunning).toBe(true);
      expect(square.getAttribute('aria-pressed')).toBe('false');
    });

    it('reads the squares back from the settings, however they were set', async () => {
      // One answer, two ways of asking it: a mode set from the drawer has to
      // show on the square, or the two would disagree about the same thing.
      const { view, runtime } = createRig();
      await view.initialize();
      const blind = element('modes-grid').querySelector('[data-mode="blind"]');
      expect(blind?.getAttribute('aria-pressed')).toBe('false');

      // Set from the drawer, where the same thing is called "notes disappear".
      const veil = element<HTMLSelectElement>('read-ahead');
      veil.value = '1';
      veil.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.readAheadSteps).toBe(1);
      expect(blind?.getAttribute('aria-pressed')).toBe('true');
    });

    it('lets the reader say whether beating the other hand counts', async () => {
      // His: late is allowed, early is not - but a penalty nobody asked for
      // is a surprise, so it is a switch, and it sits with the hand it is
      // about. Inert without that hand, which is the controller's rule and
      // not this one's.
      const { view, runtime } = createRig();
      await view.initialize();
      const rushing = element<HTMLInputElement>('rushing-counts');
      expect(rushing.checked).toBe(true);

      rushing.checked = false;
      rushing.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.rushingCounts).toBe(false);

      rushing.checked = true;
      rushing.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.rushingCounts).toBe(true);
    });

    it('empties what describes material the program writes, once a score is on the stand', async () => {
      // Which of the two is being read is a fact rather than a mode, so
      // nobody declares it: open a score and the settings that write
      // exercises have nothing to describe. This is what a separate window
      // for each would have been for, without the window.
      const rig = createRig();
      await rig.view.initialize();
      const carrier = (id: string): HTMLElement =>
        element(id).closest('label, .control-group') as HTMLElement;
      expect(carrier('preset').dataset['idle']).toBeUndefined();

      const kept = await rig.runtime.scores.keep(longExercise({ bars: 8 }), 1_000);
      await rig.runtime.controller.openScore((await rig.runtime.scores.open(kept.id)) as never);
      element<HTMLButtonElement>('focus-settings').click();

      for (const id of ['preset', 'rhythm', 'key', 'time-signature', 'measures']) {
        expect(carrier(id).dataset['idle']).toBe('true');
      }
      expect(carrier('preset').getAttribute('title')).toContain('on the stand');
    });

    it('dims a control that another setting has emptied', async () => {
      // His: dim what is incompatible. A switch standing at full strength
      // while it does nothing whatever it is set to is the program offering
      // the reader a choice with no content in it.
      const { view } = createRig();
      await view.initialize();
      const carrier = (id: string): HTMLElement =>
        element(id).closest('label, .control-group') as HTMLElement;

      // Both hands are being read, so there is no other one to hear - and
      // nothing of it to be ahead of either.
      expect(carrier('hear-other-hand').dataset['idle']).toBe('true');
      expect(carrier('hear-other-hand').getAttribute('title')).toContain('no other one');
      expect(carrier('rushing-counts').dataset['idle']).toBe('true');

      element<HTMLButtonElement>('focus-hands').click();

      expect(carrier('hear-other-hand').dataset['idle']).toBeUndefined();
      expect(carrier('hear-other-hand').hasAttribute('title')).toBe(false);
      // One question at a time: a hand has been chosen, but the other one is
      // still silent, so there is still nothing to be early against.
      expect(carrier('rushing-counts').dataset['idle']).toBe('true');

      const hear = element<HTMLInputElement>('hear-other-hand');
      hear.checked = true;
      hear.dispatchEvent(new Event('change'));

      expect(carrier('rushing-counts').dataset['idle']).toBeUndefined();
    });

    it('asks each mode in one place: its square, and no box in the settings', async () => {
      // A square and a box were two editors of one setting, and the box had
      // to be taught the squares' rules so it could not make a pair they
      // would not. The squares alone now.
      const { view } = createRig();
      await view.initialize();

      // Nor the size of the keyboard: an exercise is written for the range its
      // level asks, and whether the instrument has those keys is the reader's
      // to know.
      for (const id of ['survival', 'rhythm-only', 'stop-at-mistake', 'cursor-running', 'keyboard']) {
        expect({ id, there: document.getElementById(id) !== null }).toEqual({ id, there: false });
      }
      for (const mode of ['survival', 'rhythm', 'strict', 'cursor']) {
        expect(element('modes-grid').querySelector(`[data-mode="${mode}"]`)).not.toBeNull();
      }
    });

    it('says in the corner which modes are on, with the sheet shut', async () => {
      // His: the sheet that sets them is closed by the time the reader is at
      // the keys, and a mode turned on three pieces ago is otherwise
      // invisible until it does something.
      const { view, runtime } = createRig();
      await view.initialize();
      // In the plain frame, which the corner says nothing about, so what it
      // shows here is the squares alone.
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID });
      element<HTMLButtonElement>('focus-modes').click();
      expect(element('score-modes').hidden).toBe(true);

      // Set from the drawer rather than from the square, because the corner
      // answers the setting and not the button that happened to write it.
      const veil = element<HTMLSelectElement>('read-ahead');
      veil.value = '1';
      veil.dispatchEvent(new Event('change'));

      const marks = () => [...element('score-modes').querySelectorAll('[data-mode]')];
      expect(element('score-modes').hidden).toBe(false);
      expect(marks().map((mark) => mark.getAttribute('data-mode'))).toEqual(['blind']);
      // The square's own drawing, cloned - not a second one kept in here,
      // which would be a second answer to the same question.
      expect(marks()[0]?.querySelector('svg')).not.toBeNull();
      expect(marks()[0]?.getAttribute('title')).toBe('Blind');
      expect(element('score-modes').getAttribute('aria-label')).toContain('Blind');

      element<HTMLButtonElement>('focus-modes').click();
      (element('modes-grid').querySelector('[data-mode="survival"]') as HTMLButtonElement).click();

      expect(marks().map((mark) => mark.getAttribute('data-mode'))).toEqual([
        'survival',
        'blind',
      ]);

      // And nothing on is nothing said, rather than an empty strip of
      // furniture standing over the music.
      (element('modes-grid').querySelector('[data-mode="survival"]') as HTMLButtonElement).click();
      veil.value = 'off';
      veil.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.readAheadSteps).toBeNull();
      expect(element('score-modes').hidden).toBe(true);
    });

    it('sorts the settings into sections, losing no control on the way', async () => {
      // Forty-six controls in one scrolling column is a list nobody reads. The
      // sorting is the stylesheet's, so the guard is this: every control in
      // the sheet sits under something that names a pane, and every pane the
      // tabs offer has something in it. A control added and not sorted is
      // then a control nobody can reach, and this says so.
      const { view } = createRig();
      await view.initialize();
      const sheet = element('sheet-settings');
      const tabs = [...element('settings-sections').querySelectorAll('button[data-chooses]')];
      const panes = tabs.map((tab) => tab.getAttribute('data-chooses') ?? '');

      expect(panes.length).toBeGreaterThan(1);
      // A tab says which pane it chooses, which is not the claim to be one.
      // Saying `data-pane` cost it twice: the stylesheet's "show this pane"
      // reached the chosen tab and laid it out as a pane - the mark on one
      // line and the name under it - and the check below had the tab as its
      // own witness that a pane held anything at all.
      expect(element('settings-sections').querySelectorAll('[data-pane]')).toHaveLength(0);
      // Each one drawn as well as named: a rail of eight words is a list to
      // read, and a rail of eight marks is one to recognise.
      for (const tab of tabs) {
        expect(tab.querySelector('svg')).not.toBeNull();
        expect(tab.textContent?.trim()).not.toBe('');
      }
      for (const pane of panes) {
        // `~=`, because one box belongs to four panes at once.
        expect(sheet.querySelectorAll(`[data-pane~="${pane}"]`).length).toBeGreaterThan(0);
      }

      // And every box in the grid names a pane, or it is a cell in all of
      // them. The shared box of checkboxes named none, so Practice - whose own
      // group comes after it - began a third of the way in from the left, and
      // three other sections carried an empty column nobody could see.
      const grid = sheet.querySelector('.settings-body > .controls');
      const unnamed = [...(grid?.children ?? [])]
        .filter((child) => !child.hasAttribute('data-pane'))
        .map((child) => child.className);

      expect(unnamed).toEqual([]);

      // A box several panes share holds something for each it names, or it
      // is an empty cell holding a column open in the one it holds nothing for.
      const emptyFor = [...(grid?.children ?? [])].flatMap((child) => {
        const named = (child.getAttribute('data-pane') ?? '').trim().split(/\s+/);
        return named.length < 2
          ? []
          : named
              .filter((pane) => child.querySelector(`[data-pane~="${pane}"]`) === null)
              .map((pane) => `${child.className} / ${pane}`);
      });

      expect(emptyFor).toEqual([]);

      // The search stands in the sheet's head, over every pane and always in
      // view: the one control that belongs to no pane because it is for all.
      const orphans = [...sheet.querySelectorAll('input, select')]
        .filter(
          (control) =>
            control.closest('[data-pane]') === null && control.closest('.sheet__head') === null,
        )
        .map((control) => control.id);

      expect(orphans).toEqual([]);

      // And no control sits in a box belonging to another section. A box is
      // drawn only while its own section is the one showing, and it takes
      // whatever is inside it with it: the computer keyboard checkbox, marked
      // for the instrument section, sat in the practice one and so was drawn
      // on no tab at all.
      const shutAway = [...sheet.querySelectorAll<HTMLElement>('input, select')]
        .filter((control) => {
          const boxes: string[][] = [];
          for (let box = control.parentElement; box !== null && box !== sheet; box = box.parentElement) {
            const sections = box.getAttribute('data-pane');
            if (sections !== null) {
              boxes.push(sections.trim().split(/\s+/));
            }
          }
          const shared = boxes.reduce((left, right) => left.filter((name) => right.includes(name)), [
            ...(boxes[0] ?? []),
          ]);
          return boxes.length > 1 && shared.length === 0;
        })
        .map((control) => control.id);

      expect(shutAway).toEqual([]);
    });

    it('keeps each setting in the section its question belongs to, the most changed first', () => {
      // Page once held sixteen settings on four subjects - how the page is
      // drawn, what it does while the reader plays, the playback, and what
      // opens - and a reader looking for one read past the other fifteen.
      const sheet = element('sheet-settings');
      const tabs = [...element('settings-sections').querySelectorAll('button[data-chooses]')];
      const inPane = (pane: string): string[] =>
        [...sheet.querySelectorAll<HTMLElement>(`[data-pane~="${pane}"] input, [data-pane~="${pane}"] select`)]
          .filter((control) => control.id !== '' && control.getAttribute('type') !== 'file')
          .map((control) => control.id);

      expect(tabs.map((tab) => [tab.getAttribute('data-chooses'), tab.textContent?.trim()])).toEqual([
        ['instrument', 'Instrument'],
        ['appearance', 'Appearance'],
        ['reading', 'Reading'],
        ['judging', 'Judging'],
        ['sound', 'Sound & playback'],
        ['practice', 'Practice'],
        ['library', 'Library'],
        ['developers', 'For developers'],
      ]);
      expect(inPane('instrument')).toEqual(['midi-input', 'computer-keyboard', 'latency']);
      expect(inPane('appearance')).toEqual([
        'theme',
        'dark-system-theme',
        'zoom',
        'paged-score',
        'repeat-numbers',
        'page-turns',
        'rhythm-ruler',
        'ruler-strength',
        'ruler-cursor',
      ]);
      // The ruler's three questions in one box, read as one thing.
      const ruler = element('rhythm-ruler').closest('.control-group');
      expect(element('ruler-strength').closest('.control-group')).toBe(ruler);
      expect(element('ruler-cursor').closest('.control-group')).toBe(ruler);
      expect(inPane('reading')).toEqual(['show-played', 'read-ahead', 'preview', 'cursor-rest', 'dim-unplayed']);
      expect(inPane('judging')).toEqual([
        'tolerance',
        'playing-ahead',
        'pitch-class',
        'immediate-start',
        'hear-other-hand',
        'rushing-counts',
      ]);
      expect(inPane('sound')).toEqual([
        'instrument-volume',
        'sound-metronome-volume',
        'sample-loading',
        'audio-feedback',
        'cursor-listening',
        'show-playback-notes',
        'mark-listening',
      ]);
      expect(inPane('practice')).toEqual(['what-opens', 'rest-every-settings']);
      expect(inPane('library')).toEqual(['offer-to-sync']);
      expect(element('storage-legend').closest('[data-pane]')?.getAttribute('data-pane')).toBe('library');
      expect(inPane('developers')).toEqual(['trace-the-start']);

      // One pane to a group: a group in two had to hide half of itself in each.
      const shared = [...sheet.querySelectorAll('[data-pane]')]
        .map((group) => group.getAttribute('data-pane') ?? '')
        .filter((panes) => panes.trim().split(/\s+/).length > 1);
      expect(shared).toEqual([]);
    });

    it('draws every checkbox as a choice, never as the heading of a group', () => {
      // A label that is a group's own child is set as its heading, in
      // capitals; a checkbox's label stood there in Library and For
      // developers, and read as a title over nothing.
      const sheet = element('sheet-settings');
      const headings = [...sheet.querySelectorAll('input[type="checkbox"]')]
        .filter((box) => box.closest('.control-group--checks') === null)
        .map((box) => box.id);

      expect(sheet.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(10);
      expect(headings).toEqual([]);
    });

    it('shows one section at a time, and says which', async () => {
      const { view } = createRig();
      await view.initialize();
      const panel = element('sheet-settings').querySelector('.sheet__panel');
      const tabs = [...element('settings-sections').querySelectorAll('button[data-chooses]')];
      const first = tabs[0];
      const second = tabs[1];

      expect(panel?.getAttribute('data-showing')).toBe(first?.getAttribute('data-chooses'));
      expect(first?.getAttribute('aria-pressed')).toBe('true');

      (second as HTMLButtonElement).click();

      expect(panel?.getAttribute('data-showing')).toBe(second?.getAttribute('data-chooses'));
      expect(first?.getAttribute('aria-pressed')).toBe('false');
      expect(second?.getAttribute('aria-pressed')).toBe('true');
    });

    it('opens the metronome the pill opens, rather than a copy of it', async () => {
      // Two sets of the same controls are two editors of one setting, and
      // they disagree the moment one of them is wired up wrong.
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-settings').click();

      element<HTMLButtonElement>('settings-metronome').click();

      expect(element('sheet-metronome').hidden).toBe(false);
      // One panel: the controls exist once in the document.
      expect(document.querySelectorAll('#count-in')).toHaveLength(1);
    });

    it('opens the metronome over the settings, and closing it goes back to them', async () => {
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-settings').click();

      element<HTMLButtonElement>('settings-metronome').click();

      // Drawn above the settings, which stay where they were underneath.
      expect(element('sheet-settings').hidden).toBe(false);
      expect(Number(element('sheet-metronome').dataset['over'])).toBeGreaterThan(
        Number(element('sheet-settings').dataset['over'] ?? '1'),
      );

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(element('sheet-metronome').hidden).toBe(true);
      expect(element('sheet-settings').hidden).toBe(false);
    });

    it('says whether there is a network, by the control it decides', async () => {
      // The application itself is on the device - a worker keeps it there -
      // so the only thing a lost network costs is a recording not yet
      // fetched. Said by the control that asks for them, and read once at the
      // start as well: a page opened with no network has had no event to hear
      // and would sit there claiming to be online.
      const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      const { view } = createRig();
      await view.initialize();

      expect(element('network-state').dataset['online']).toBe('false');
      expect(element('network-state').textContent).toContain('Offline');

      online.mockReturnValue(true);
      window.dispatchEvent(new Event('online'));

      expect(element('network-state').dataset['online']).toBe('true');
      expect(element('network-state').textContent).toContain('Online');
      online.mockRestore();
    });

    it('leaves nothing but the page, and one way back', async () => {
      // His: sometimes he wants to look at the music with nothing standing
      // over it. The row empties the way it does mid-run and by the same
      // rule - what stays is named - so the way out is the one thing left.
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-scores').click();
      expect(element('sheet-scores').hidden).toBe(false);

      element<HTMLButtonElement>('focus-bare').click();

      expect(document.body.dataset['bare']).toBe('true');
      expect(element('focus-bare').getAttribute('aria-pressed')).toBe('true');
      // A panel left standing would be the one thing on screen, which is the
      // opposite of what was asked for.
      expect(element('sheet-scores').hidden).toBe(true);
      expect(element('focus-bar').dataset['open']).not.toBe('true');

      element<HTMLButtonElement>('focus-bare').click();

      expect(document.body.dataset['bare']).toBe('false');
    });

    it('puts it off by the number on the button that was pressed', async () => {
      // His: "later" is not one answer but a length, so the card says three
      // of them. The number on the button is what the reader is choosing, and
      // it has to be what they get.
      const { view, runtime, midi } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ restEveryMinutes: 30 });
      const said: number[] = [];
      runtime.controller.events.on('restDue', ({ sittingMs }) => {
        said.push(sittingMs);
      });
      for (let at = 0; at <= 31 * 60_000; at += 60_000) {
        midi.noteOn(60, at);
      }
      expect(said).toHaveLength(1);

      element<HTMLButtonElement>('rest-snooze-1').click();

      expect(element('score-rest').hidden).toBe(true);
      midi.noteOn(60, 31.5 * 60_000);
      expect(said).toHaveLength(1);
      midi.noteOn(60, 32.5 * 60_000);
      expect(said).toHaveLength(2);
    });

    it('lets the reader put it off without losing the hour they have played', async () => {
      const { view, runtime, midi } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ restEveryMinutes: 30 });
      for (let at = 0; at <= 31 * 60_000; at += 60_000) {
        midi.noteOn(60, at);
      }

      element<HTMLButtonElement>('rest-later').click();

      expect(element('score-rest').hidden).toBe(true);
      expect(runtime.controller.sittingMs).toBeGreaterThanOrEqual(30 * 60_000);
    });

    it('says the page is being drawn while it is being drawn', async () => {
      // Engraving a long score is seconds - more of them since the bars can
      // be ruled - and the page it replaces stays on screen while it works.
      // Without this the reader has asked for something and nothing whatever
      // has happened.
      const { view, runtime } = createRig();
      await view.initialize();
      expect(element('score-engraving').hidden).toBe(true);

      const seen: boolean[] = [];
      runtime.controller.events.on('engraving', ({ busy }) => {
        seen.push(busy);
        if (busy) {
          expect(element('score-engraving').hidden).toBe(false);
          expect(element('score-card').hidden).toBe(false);
        }
      });
      await runtime.controller.openScore(twoBarExercise({ title: 'Something New' }));

      // Said on the way in and taken back on the way out.
      expect(seen).toEqual([true, false]);
      expect(element('score-engraving').hidden).toBe(true);
    });

    it('takes the number away when the run is stopped mid-count', async () => {
      // Reported from the page: Start and then Stop straight away left the
      // number standing in the middle of the score with nothing counting it
      // down. It was told to go by the first step of the music, and a run
      // stopped during the count-in never reaches one.
      const { view, runtime, metronome } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ countInBars: 1, modeId: FLOW_MODE_ID });
      await runtime.controller.reloadExercise();
      runtime.controller.start();
      metronome.advanceBeats(1);
      expect(element('score-count').hidden).toBe(false);

      element<HTMLButtonElement>('focus-stop').click();

      expect(element('score-count').hidden).toBe(true);
    });

    it('counts the look down there too, being the same question', async () => {
      // "How long until I have to play" is one question, so it is answered in
      // one place - not in the middle for the count-in and in a pill for the
      // look that comes before it.
      vi.useFakeTimers();
      try {
        const { view, runtime } = createRig();
        await view.initialize();
        runtime.controller.updateSettings({ previewSeconds: 3 });

        element<HTMLButtonElement>('focus-play').click();
        expect(element('score-count').textContent).toBe('3');

        vi.advanceTimersByTime(3000);
        // And it goes when the look does, rather than hanging over the run.
        expect(element('score-count').hidden).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('getting out of the way while the music is going', () => {
    it('says so on the bar, and stops saying it when the run stops', async () => {
      const { view } = createRig();
      await view.initialize();
      expect(element('focus-bar').dataset['playing']).toBe('false');

      element<HTMLButtonElement>('focus-play').click();
      expect(element('focus-bar').dataset['playing']).toBe('true');

      element<HTMLButtonElement>('focus-stop').click();
      expect(element('focus-bar').dataset['playing']).toBe('false');
    });

    it('keeps out of the way through a pause', async () => {
      // A pause is a place held inside a reading, and the reading is still
      // what is happening. Stopping is what says it is over, which is the
      // whole difference between the two buttons left on the page.
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();

      element<HTMLButtonElement>('focus-play').click();

      expect(runtime.controller.session?.status).toBe('paused');
      expect(element('focus-bar').dataset['playing']).toBe('true');
    });

    it('goes for the look as well, that being reading too', async () => {
      vi.useFakeTimers();
      try {
        const { view, runtime } = createRig();
        await view.initialize();
        runtime.controller.updateSettings({ previewSeconds: 3 });

        element<HTMLButtonElement>('focus-play').click();
        // No session yet - the look has no status to change, so it has to say
        // this for itself.
        expect(runtime.controller.session).toBeNull();
        expect(element('focus-bar').dataset['playing']).toBe('true');

        vi.advanceTimersByTime(3000);
        expect(element('focus-bar').dataset['playing']).toBe('true');
      } finally {
        vi.useRealTimers();
      }
    });

    it('shuts the drawer rather than only hiding it', async () => {
      // Hidden, it would come back open when the music stopped - a drawer the
      // reader never opened, over the score they had just been graded on.
      const { view } = createRig();
      await view.initialize();
      view.setDrawerOpen(true);
      expect(element('focus-bar').dataset['open']).toBe('true');

      element<HTMLButtonElement>('focus-play').click();
      element<HTMLButtonElement>('focus-stop').click();

      expect(element('focus-bar').dataset['open']).toBe('false');
    });

    it('leaves a stop that stops the look it is left alone with', async () => {
      // The complaint this answers: with the interface down to two buttons,
      // Stop did nothing. It was wired to the session, and a look is not a
      // session - so the one phase where the reader has no other control was
      // the one phase they could not leave.
      vi.useFakeTimers();
      try {
        const { view, runtime } = createRig();
        await view.initialize();
        runtime.controller.updateSettings({ previewSeconds: 10 });

        element<HTMLButtonElement>('focus-play').click();
        expect(view.isPreviewing).toBe(true);
        expect(element<HTMLButtonElement>('focus-stop').disabled).toBe(false);

        element<HTMLButtonElement>('focus-stop').click();

        expect(view.isPreviewing).toBe(false);
        expect(runtime.controller.session).toBeNull();
        expect(element('focus-bar').dataset['playing']).toBe('false');
        // And the look does not go on to start a run behind the reader's back.
        vi.advanceTimersByTime(20_000);
        expect(runtime.controller.session).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops a performance too, that also being something playing', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      await pressListen(runtime.controller);
      expect(runtime.controller.isListening).toBe(true);

      element<HTMLButtonElement>('focus-stop').click();

      expect(runtime.controller.isListening).toBe(false);
      expect(element('focus-play').getAttribute('aria-label')).toBe('Start');
    });

    it('offers starting-by-playing in the drawer and in the settings', async () => {
      // One setting with two editors, the way the tempo has a slider at the
      // desk and a percentage in fullscreen. In the drawer above all: the
      // whole point of the setting is not having to reach for the tablet, so
      // burying it two taps deep would be its own joke.
      const { view, runtime } = createRig();
      await view.initialize();
      const box = element<HTMLInputElement>('immediate-start');
      expect(runtime.controller.settings.immediateStart).toBe(false);

      box.checked = true;
      box.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.immediateStart).toBe(true);

      box.checked = false;
      box.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.immediateStart).toBe(false);
    });

    it('lets the reader turn the dimming off, and back on', async () => {
      const rig = createRig();
      await rig.view.initialize();
      expect(rig.renderer.reading).not.toBeNull();

      const box = element<HTMLInputElement>('dim-unplayed');
      expect(box.checked).toBe(true);
      box.checked = false;
      box.dispatchEvent(new Event('change'));

      expect(rig.runtime.controller.settings.dimUnplayed).toBe(false);
      expect(rig.renderer.reading).toBeNull();

      box.checked = true;
      box.dispatchEvent(new Event('change'));
      expect(rig.renderer.reading).not.toBeNull();
    });

    describe('the hand switches beside the staves', () => {
      it('turns off the hand whose staff was pressed', async () => {
        // The switch sits on the staff it governs, so there is no icon to
        // decode: press the upper one and the upper staff stops being asked
        // for.
        const rig = createRig();
        await rig.view.initialize();
        expect(rig.runtime.controller.settings.handStaff).toBeNull();
        expect(rig.renderer.handsPlaying).toEqual([1, 2]);

        rig.renderer.toggleHand(1);

        expect(rig.runtime.controller.settings.handStaff).toBe(2);
        expect(rig.renderer.handsPlaying).toEqual([2]);
      });

      it('turns it back on again', async () => {
        const rig = createRig();
        await rig.view.initialize();
        rig.renderer.toggleHand(1);

        rig.renderer.toggleHand(1);

        expect(rig.runtime.controller.settings.handStaff).toBeNull();
        expect(rig.renderer.handsPlaying).toEqual([1, 2]);
      });

      it('reads turning off the last hand as putting them both back', async () => {
        // A run that asks for nothing is not a thing anyone means, and a
        // switch that silently refuses is a switch that sometimes does
        // nothing with no way of saying why.
        const rig = createRig();
        await rig.view.initialize();
        rig.renderer.toggleHand(1);
        expect(rig.runtime.controller.settings.handStaff).toBe(2);

        rig.renderer.toggleHand(2);

        expect(rig.runtime.controller.settings.handStaff).toBeNull();
      });

      it('goes away with the rest of the furniture on a tap', async () => {
        // A touch on the music puts the markers away, and these stand in the
        // margin of every system on the page: a reader who has cleared the
        // page has cleared it.
        const rig = createRig();
        await rig.view.initialize();
        expect(rig.renderer.handsPlaying).toEqual([1, 2]);

        rig.renderer.tapScore();
        expect(rig.renderer.handsPlaying).toEqual([]);

        rig.renderer.tapScore();
        expect(rig.renderer.handsPlaying).toEqual([1, 2]);
      });

      it('comes back saying what it said before it went', async () => {
        const rig = createRig();
        await rig.view.initialize();
        rig.renderer.toggleHand(1);
        rig.renderer.tapScore();

        rig.renderer.tapScore();

        expect(rig.renderer.handsPlaying).toEqual([2]);
      });

      it('is the same setting the drawer’s button cycles', async () => {
        // One setting with two editors, as the tempo has: they cannot come to
        // hold different answers.
        const rig = createRig();
        await rig.view.initialize();

        element<HTMLButtonElement>('focus-hands').click();

        expect(rig.runtime.controller.settings.handStaff).toBe(2);
        expect(rig.renderer.handsPlaying).toEqual([2]);
      });
    });

    it('leaves exactly the buttons a reader needs mid-piece', () => {
      // Marked on the markup rather than counted in script: the stylesheet
      // hides everything in the row without the mark, so this is the list.
      // In the order a thumb finds them: hold it, take it from the top, end
      // it.
      const row = element('focus-row');
      const kept = [...row.children].filter((child) => child.hasAttribute('data-mid-run'));

      expect(kept.map((child) => child.id)).toEqual([
        'focus-play',
        'focus-replay',
        'focus-stop',
        'focus-keyboard',
      ]);
    });

    it('takes the run from the top in one press', async () => {
      // Stop and start, without the stop and the start. A passage gone wrong
      // in its second bar is a passage to begin again, and doing that by hand
      // meant finding two buttons and pressing them in order.
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const going = runtime.controller.session;
      expect(going?.status).toBe('running');

      element<HTMLButtonElement>('focus-replay').click();

      const again = runtime.controller.session;
      expect(again?.status).toBe('running');
      // A reading of its own, and the one that was going is over.
      expect(again).not.toBe(going);
      expect(going?.status).toBe('aborted');
    });
  });

  it('pushes control changes into the settings', async () => {
    const { view, runtime } = createRig();
    await view.initialize();

    const tolerance = element<HTMLInputElement>('tolerance');
    tolerance.value = '120';
    tolerance.dispatchEvent(new Event('input'));
    expect(runtime.controller.settings.matchToleranceMs).toBe(120);

    const octaves = element<HTMLInputElement>('pitch-class');
    octaves.checked = true;
    octaves.dispatchEvent(new Event('change'));
    expect(runtime.controller.settings.pitchClassOnly).toBe(true);

    // The frame is not a control at the desk any more: it is the button in
    // the Modes sheet, and what it says of itself is said there.
    frameButton('listen').click();
    expect(runtime.controller.settings.modeId).toBe(LISTEN_MODE_ID);
    expect(frameButton('listen').querySelector('.frame__what')?.textContent).toContain('machine');
  });

  describe('the sheet of what a fresh exercise is made of', () => {
    it('opens from beside the button that makes one, over the scores', async () => {
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-scores').click();

      element<HTMLButtonElement>('scores-exercise').click();

      const sheet = element('sheet-exercise');
      expect(sheet.hidden).toBe(false);
      // Over the scores, so shutting it goes back to them.
      expect(element('sheet-scores').hidden).toBe(false);
      expect(Number(sheet.dataset['over'])).toBeGreaterThan(Number(element('sheet-scores').dataset['over']));
      // Beside the button, in one row with it.
      expect(element('scores-exercise').parentElement).toBe(element('scores-fresh').parentElement);
    });

    it('holds everything a fresh exercise is made of, and the settings no longer do', () => {
      const sheet = element('sheet-exercise');
      for (const id of ['grades', 'ladder-up', 'measures', 'tempo', 'preset', 'rhythm', 'key', 'time-signature']) {
        expect({ id, here: sheet.contains(element(id)) }).toEqual({ id, here: true });
      }
      // What steps off the route is folded away under the rest.
      for (const id of ['preset', 'rhythm', 'key', 'time-signature']) {
        expect({ id, folded: element(id).closest('details') !== null }).toEqual({ id, folded: true });
      }
      const settings = element('sheet-settings');
      expect(settings.querySelector('[data-chooses="exercise"]')).toBeNull();
      expect(settings.querySelector('[data-pane~="exercise"]')).toBeNull();
      // And the judging log is for finding out why, with the timings, not
      // beside the backup a reader saves their scores with.
      for (const id of ['copy-judging', 'save-judging']) {
        expect({ id, pane: element(id).closest('[data-pane]')?.getAttribute('data-pane') }).toEqual({
          id,
          pane: 'developers',
        });
      }
    });

    it('offers each grade, lights the one being read, and puts a reader on its first rung', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      const grades = [...element('grades').querySelectorAll<HTMLButtonElement>('.grades__grade')];
      expect(grades.map((button) => button.textContent)).toEqual(['Initial', '1', '2', '3', '4', '5']);
      expect(grades.map((button) => button.getAttribute('aria-label'))).toContain('Grade 3');
      // Off the route, nothing is lit and nothing is said of a grade.
      expect(grades.filter((button) => button.getAttribute('aria-pressed') === 'true')).toEqual([]);
      expect(element('grade-new').textContent).toBe('');

      const before = runtime.controller.currentExercise;
      grades[3]?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runtime.controller.ladderStep?.id).toBe('grade-3.wide');
      expect(grades.map((button) => button.getAttribute('aria-pressed'))).toEqual([
        'false',
        'false',
        'false',
        'true',
        'false',
        'false',
      ]);
      expect(element('grade-new').textContent).toContain('New at Grade 3');
      expect(element<HTMLSelectElement>('preset').value).toBe('wide-grand-staff');
      // A grade chosen is a page to read now.
      expect(runtime.controller.currentExercise).not.toBe(before);

      // A rhythm chosen by hand leaves the route, and the grade with it.
      const rhythm = element<HTMLSelectElement>('rhythm');
      rhythm.value = 'triplets';
      rhythm.dispatchEvent(new Event('change'));
      await Promise.resolve();
      expect(grades.filter((button) => button.getAttribute('aria-pressed') === 'true')).toEqual([]);
      expect(element('grade-new').textContent).toBe('');
      expect(element('grade-not-yet').textContent).toBe('');
    });
  });

  describe('the readings in a row at a rung', () => {
    /** Puts the reader on a rung, with a page from it on the stand. */
    async function onARung(rig: ReturnType<typeof createRig>): Promise<void> {
      await rig.view.initialize();
      rig.runtime.controller.updateSettings({ modeId: 'mode.wait', countInBars: 0 });
      rig.runtime.controller.selectLadderStep('grade-1.three');
      element<HTMLButtonElement>('ladder-up').click();
      element<HTMLButtonElement>('ladder-down').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    /** Plays every step of the page as written, to the end. */
    function readItCleanly(rig: ReturnType<typeof createRig>): void {
      element<HTMLButtonElement>('focus-play').click();
      const session = rig.runtime.controller.session;
      for (let guard = 400; session?.status === 'running' && guard > 0; guard -= 1) {
        const step = session.currentStep;
        if (step === null) {
          break;
        }
        for (const midi of step.expectedMidi) {
          rig.midi.noteOn(midi, rig.clock.now());
        }
      }
    }

    /** The marks of a track as `.` for each place and `|` where the reader is. */
    function marksIn(within: HTMLElement): string {
      return [...within.querySelectorAll('.ladder-track__mark')]
        .map((mark) => (mark.classList.contains('ladder-track__mark--here') ? '|' : '.'))
        .join('');
    }

    /** The rungs a track names at its two ends. */
    function endsIn(within: HTMLElement): (string | null)[] {
      return [...within.querySelectorAll('.ladder-track__end')].map((end) => end.textContent);
    }

    /** What the page was told to print after its title, marks as in `marksIn`. */
    function printedAfterTheTitle(rig: ReturnType<typeof createRig>): string | null {
      const rung = rig.renderer.rung;
      return rung === null ? null : `${rung.label} ${rung.marks.map((mark) => (mark.here ? '|' : '.')).join('')}`;
    }

    it('prints the rung after the title only while a generated page is on it', async () => {
      const rig = createRig();
      await rig.view.initialize();
      // Off the route, which is where a first visit begins.
      expect(rig.renderer.rung).toBeNull();

      await onARung(rig);
      expect(printedAfterTheTitle(rig)).toBe('Grade 1 · b ..|..');
      // And the sheet that sets it, under the arrows.
      expect(marksIn(element('ladder-track'))).toBe('..|..');

      // A score is not on the ladder.
      await rig.runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
      expect(rig.renderer.rung).toBeNull();
    });

    it('names the rungs either side under the arrows, so a step by hand shows', async () => {
      // Arriving at a rung starts its readings afresh, so on their own the
      // marks look the same on every rung.
      const rig = createRig();
      await onARung(rig);
      expect(endsIn(element('ladder-track'))).toEqual(['Grade 1 · a', 'Grade 1 · c']);

      element<HTMLButtonElement>('ladder-up').click();

      expect(endsIn(element('ladder-track'))[0]).toBe('Grade 1 · b');
      expect(printedAfterTheTitle(rig)).toBe('Grade 1 · c ..|..');
    });

    it('moves the mark for a clean reading, and draws the track under the verdict', async () => {
      const rig = createRig();
      await onARung(rig);

      readItCleanly(rig);

      expect(rig.runtime.controller.settings.ladderStreak).toBe(1);
      expect(printedAfterTheTitle(rig)).toBe('Grade 1 · b ...|.');
      const track = element('result').querySelector<HTMLElement>('.ladder-track');
      expect(track).not.toBeNull();
      expect(marksIn(track ?? element('result'))).toBe('...|.');
      // Under the verdict, the two rungs either way are named.
      expect(endsIn(track ?? element('result'))).toEqual(['Grade 1 · a', 'Grade 1 · c']);
    });

    it('draws no track under the verdict on a score', async () => {
      const rig = createRig();
      await onARung(rig);
      await rig.runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));

      readItCleanly(rig);

      expect(element('score-verdict').hidden).toBe(false);
      expect(element('result').querySelector('.ladder-track')).toBeNull();
    });
  });

  describe('the ladder arrows', () => {
    it('starts at the first rung and names it', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      element<HTMLButtonElement>('ladder-up').click();
      await Promise.resolve();

      expect(runtime.controller.ladderStep?.label).toBe('Initial · a');
      expect(element('ladder-step').textContent).toBe('Initial · a, 1 of 27');
      expect(element('ladder-description').textContent).toContain('five fingers from C');
      // What the grade adds, and what a test at it has that is not written yet.
      expect(element('grade-new').textContent).toContain('New at Initial: each hand alone');
      expect(element('grade-not-yet').textContent).toBe('Not written here yet: legato phrases under a slur.');
      // Nowhere below the bottom to go.
      expect(element<HTMLButtonElement>('ladder-down').disabled).toBe(true);
    });

    it('says where a rung draws its key and metre, and takes it back on a rung that does not', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      const key = element<HTMLSelectElement>('key');
      const time = element<HTMLSelectElement>('time-signature');

      runtime.controller.selectLadderStep('grade-1.keys');
      element<HTMLButtonElement>('ladder-up').click();
      element<HTMLButtonElement>('ladder-down').click();
      await Promise.resolve();
      expect(key.value).toBe('drawn');
      expect(key.selectedOptions[0]?.textContent).toBe('Drawn each time: G major, F major, A minor');
      // The new keys only: the metre is the route's own.
      expect(time.value).toBe('3/4');
      expect(time.querySelector('option[value="drawn"]')).toBeNull();

      element<HTMLButtonElement>('ladder-up').click();
      await Promise.resolve();
      expect(key.selectedOptions[0]?.textContent).toBe('Drawn each time from 5 keys');
      expect(time.selectedOptions[0]?.textContent).toBe('Drawn each time: 4/4, 3/4, 2/4');

      // Choosing the drawn answer again is staying where the route put you.
      key.dispatchEvent(new Event('change'));
      expect(runtime.controller.ladderStep?.id).toBe('grade-1.all');

      // The material too, where the rung draws it.
      const preset = element<HTMLSelectElement>('preset');
      expect(preset.querySelector('option[value="drawn"]')).toBeNull();
      runtime.controller.selectLadderStep('grade-5.all');
      element<HTMLButtonElement>('ladder-down').click();
      element<HTMLButtonElement>('ladder-up').click();
      await Promise.resolve();
      expect(preset.selectedOptions[0]?.textContent).toBe(
        'Drawn each time: Melody over intervals, Broken chords in both hands, Sequences',
      );
      preset.dispatchEvent(new Event('change'));
      expect(runtime.controller.ladderStep?.id).toBe('grade-5.all');
      runtime.controller.selectLadderStep('grade-1.all');
      element<HTMLButtonElement>('ladder-down').click();
      element<HTMLButtonElement>('ladder-up').click();
      await Promise.resolve();
      expect(preset.querySelector('option[value="drawn"]')).toBeNull();

      // And a rung of one key says that key, with nothing drawn left behind.
      element<HTMLButtonElement>('ladder-down').click();
      element<HTMLButtonElement>('ladder-down').click();
      await Promise.resolve();
      expect(key.value).toBe('0:major');
      expect(key.querySelectorAll('option[value="drawn"]')).toHaveLength(0);
      expect(time.querySelectorAll('option[value="drawn"]')).toHaveLength(0);
    });

    it('brings the selectors with it', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      element<HTMLButtonElement>('ladder-up').click();
      await Promise.resolve();
      element<HTMLButtonElement>('ladder-up').click();
      await Promise.resolve();

      expect(runtime.controller.ladderStep?.label).toBe('Initial · b');
      // The rung is what is being practised, so the controls have to agree.
      expect(element<HTMLSelectElement>('rhythm').value).toBe('calm');
      expect(element<HTMLSelectElement>('preset').value).toBe('left-hand-five');
    });

    it('says plainly when the reader has left the route', async () => {
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('ladder-up').click();
      await Promise.resolve();

      const rhythm = element<HTMLSelectElement>('rhythm');
      rhythm.value = 'triplets';
      rhythm.dispatchEvent(new Event('change'));
      await Promise.resolve();

      expect(element('ladder-step').textContent).toBe('Off the ladder');
      expect(element('ladder-description').textContent).toContain('by hand');
      // Both arrows stay live: leaving is not a trap.
      expect(element<HTMLButtonElement>('ladder-down').disabled).toBe(false);
      expect(element<HTMLButtonElement>('ladder-up').disabled).toBe(false);
    });
  });

  it('empties the bar boxes when a new exercise is asked for', async () => {
    const { view, runtime } = createRig();
    await view.initialize();

    const from = element<HTMLInputElement>('focus-from');
    const to = element<HTMLInputElement>('focus-to');
    from.value = '2';
    from.dispatchEvent(new Event('change'));
    to.value = '3';
    to.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(runtime.controller.settings.rangeFromBar).toBe(2);

    element<HTMLButtonElement>('scores-fresh').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The boxes have to follow the setting, or they would name a passage of
    // the last piece over the top of a new one.
    expect(runtime.controller.settings.rangeFromBar).toBeNull();
    expect(element<HTMLInputElement>('focus-from').value).toBe('');
    expect(element<HTMLInputElement>('focus-to').value).toBe('');
  });

  it('opens a visit with the bar boxes saying what the settings say', async () => {
    // Reported from the page: the boxes came back on the next visit still
    // naming bars of a piece nobody had opened. The setting itself was put
    // back - the material a visit opens with is not the piece those bars
    // were chosen in - but the boxes were drawn from the settings before
    // that material was loaded, so they showed the old numbers over the new
    // music, and the next thing the reader touched wrote them back.
    const store = new InMemorySettingsStore();
    const first = createRig(undefined, store);
    await first.view.initialize();
    const from = element<HTMLInputElement>('focus-from');
    from.value = '2';
    from.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(first.runtime.controller.settings.rangeFromBar).toBe(2);

    mountRealMarkup();
    const second = createRig(undefined, store);
    await second.view.initialize();

    expect(second.runtime.controller.settings.rangeFromBar).toBeNull();
    expect(element<HTMLInputElement>('focus-from').value).toBe('');
    expect(element<HTMLInputElement>('focus-to').value).toBe('');
  });

  describe('how hard a piece is said to be', () => {
    async function shelved(rig: Rig, titles: readonly string[]): Promise<void> {
      let at = 1_000;
      for (const title of titles) {
        await rig.runtime.scores.keep(twoBarExercise({ title }), at);
        at += 1_000;
      }
      await rig.view.initialize();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    function rowTitles(): readonly string[] {
      return [...element('scores-list').querySelectorAll('.takes__name')].map(
        (name) => name.getAttribute('title') ?? '',
      );
    }

    function marks(): readonly string[] {
      return [...element('scores-list').querySelectorAll('.scores__stars')].map(
        (mark) => mark.textContent ?? '',
      );
    }

    it('asks the reader, and keeps what they say on the row', async () => {
      // His: "кнопка щоб редагувати складність знаходиться у списку на кожному
      // itemі", and the number is his - "від 1 до 10 зірочок... 2.2 2.3 2.7".
      const rig = createRig();
      await shelved(rig, ['City of Tears']);
      expect(marks()).toEqual(['']);

      rowButton('scores-list', 'How hard is this score?').click();
      element<HTMLInputElement>('stars-value').value = '2.7';
      element<HTMLButtonElement>('stars-yes').click();
      await waitFor(() => rig.runtime.scores.theStarsFor('City of Tears') === 2.7);

      expect(marks()).toEqual(['★ 2.7']);
      expect(element('sheet-stars').hidden).toBe(true);
    });

    it('wears the colour of the star it falls in', async () => {
      // The page says which rung, and the sheet says what colour that is. His:
      // "чи можливо зірочку підсвічувати різними кольорами для кожного рівня?".
      const rig = createRig();
      await shelved(rig, ['Gentle', 'Brutal', 'Unjudged']);
      const idOf = (title: string): string =>
        rig.runtime.scores.list().find((score) => score.title === title)?.id ?? '';
      await rig.runtime.scores.keepTheStars(idOf('Gentle'), 2.7, 1_000);
      await rig.runtime.scores.keepTheStars(idOf('Brutal'), 9.4, 1_000);

      element<HTMLButtonElement>('focus-scores').click();
      const bands = [...element('scores-list').querySelectorAll('.scores__stars')].map(
        (mark) => mark.getAttribute('data-band'),
      );

      // Newest first, which is the order they were shelved in reverse.
      expect(bands).toEqual([null, '9', '2']);
    });

    it('takes the mark off again, which is not marking it easy', async () => {
      const rig = createRig();
      await shelved(rig, ['City of Tears']);
      const kept = rig.runtime.scores.list()[0];
      await rig.runtime.scores.keepTheStars(kept?.id ?? '', 9.4, 1_000);

      rowButton('scores-list', 'How hard is this score?').click();
      element<HTMLButtonElement>('stars-none').click();
      await waitFor(() => rig.runtime.scores.theStarsFor('City of Tears') === null);

      expect(marks()).toEqual(['']);
    });

    it('leaves the mark alone when the reader backs out', async () => {
      // Which is the whole difference between Cancel and Unrated. Two ways out
      // of a dialog that both do nothing would be one too many.
      const rig = createRig();
      await shelved(rig, ['City of Tears']);
      const kept = rig.runtime.scores.list()[0];
      await rig.runtime.scores.keepTheStars(kept?.id ?? '', 9.4, 1_000);

      rowButton('scores-list', 'How hard is this score?').click();
      element<HTMLInputElement>('stars-value').value = '1';
      element<HTMLButtonElement>('stars-no').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(rig.runtime.scores.theStarsFor('City of Tears')).toBe(9.4);
      expect(element('sheet-stars').hidden).toBe(true);
    });

    it('treats Set over an empty box as nothing to say, not as unrated', async () => {
      // Unrated is a button of its own. Emptying the box and pressing Set is a
      // reader who has not decided, and the mark they had stands.
      const rig = createRig();
      await shelved(rig, ['City of Tears']);
      const kept = rig.runtime.scores.list()[0];
      await rig.runtime.scores.keepTheStars(kept?.id ?? '', 9.4, 1_000);

      rowButton('scores-list', 'How hard is this score?').click();
      element<HTMLInputElement>('stars-value').value = '';
      element<HTMLButtonElement>('stars-yes').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(rig.runtime.scores.theStarsFor('City of Tears')).toBe(9.4);
      expect(element('sheet-stars').hidden).toBe(true);
    });

    it('opens the box on the mark the piece already has', async () => {
      const rig = createRig();
      await shelved(rig, ['City of Tears']);
      const kept = rig.runtime.scores.list()[0];
      await rig.runtime.scores.keepTheStars(kept?.id ?? '', 9.4, 1_000);

      rowButton('scores-list', 'How hard is this score?').click();

      expect(element<HTMLInputElement>('stars-value').value).toBe('9.4');
    });

    it('orders the shelf by what the reader said, and remembers the order', async () => {
      // His: "мати можливість сортувати за складністю, та цей фільтр має
      // запамятовуватись".
      const rig = createRig();
      await shelved(rig, ['Gentle', 'Brutal']);
      const gentle = rig.runtime.scores.list().find((score) => score.title === 'Gentle');
      const brutal = rig.runtime.scores.list().find((score) => score.title === 'Brutal');
      await rig.runtime.scores.keepTheStars(gentle?.id ?? '', 2.2, 1_000);
      await rig.runtime.scores.keepTheStars(brutal?.id ?? '', 9.4, 1_000);

      const order = element<HTMLSelectElement>('scores-order');
      order.value = 'easiest';
      order.dispatchEvent(new Event('change', { bubbles: true }));

      expect(rowTitles()).toEqual(['Gentle', 'Brutal']);
      expect(rig.runtime.controller.settings.scoreOrder).toBe('easiest');

      order.value = 'hardest';
      order.dispatchEvent(new Event('change', { bubbles: true }));

      expect(rowTitles()).toEqual(['Brutal', 'Gentle']);
      expect(rig.runtime.controller.settings.scoreOrder).toBe('hardest');
    });

    it('opens the shelf in the order it was left in', async () => {
      // The point of remembering it: a shelf that went back to "recent" every
      // evening is a control nobody uses twice.
      const rig = createRig();
      rig.runtime.controller.updateSettings({ scoreOrder: 'hardest' });
      await shelved(rig, ['Gentle', 'Brutal']);
      const gentle = rig.runtime.scores.list().find((score) => score.title === 'Gentle');
      const brutal = rig.runtime.scores.list().find((score) => score.title === 'Brutal');
      await rig.runtime.scores.keepTheStars(gentle?.id ?? '', 2.2, 1_000);
      await rig.runtime.scores.keepTheStars(brutal?.id ?? '', 9.4, 1_000);

      element<HTMLButtonElement>('focus-scores').click();

      expect(element<HTMLSelectElement>('scores-order').value).toBe('hardest');
      expect(rowTitles()).toEqual(['Brutal', 'Gentle']);
    });
  });

  describe('the click a piece asks for', () => {
    /** The Open button on the row for one title. */
    function openRow(title: string): HTMLButtonElement {
      const rows = [...element('scores-list').querySelectorAll('li')];
      const row = rows.find(
        (each) => each.querySelector('.takes__name')?.getAttribute('title') === title,
      );
      const open = [...(row?.querySelectorAll('button') ?? [])].find(
        (button) => button.textContent === 'Open',
      );
      if (!(open instanceof HTMLButtonElement)) {
        throw new Error(`no Open button for ${title}`);
      }
      return open;
    }

    async function shelved(rig: Rig, titles: readonly string[]): Promise<void> {
      let at = 1_000;
      for (const title of titles) {
        await rig.runtime.scores.keep(twoBarExercise({ title }), at);
        at += 1_000;
      }
      await rig.view.initialize();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('shuts the shelf the moment a score is asked for', async () => {
      // Engraving a long score takes the thread for seconds and nothing can be
      // drawn or pressed while it does, so the shelf stayed up over music the
      // reader had already asked for until the browser offered to kill the
      // page. His: "у scores кнопку open мабуть зробити асинхронною, зачиняти
      // сам діалог, та показувати loading".
      const rig = createRig();
      await shelved(rig, ['Choral Chambers']);
      element<HTMLButtonElement>('focus-scores').click();
      expect(element('sheet-scores').hidden).toBe(false);

      openRow('Choral Chambers').click();

      // Shut before the waiting starts, not after it ends.
      expect(element('sheet-scores').hidden).toBe(true);
      await waitFor(() => rig.runtime.controller.openedExercise?.title === 'Choral Chambers');
    });

    it('puts back the click the piece was last read with', async () => {
      // His: "choral chambers has two clicks in a base metronome setting, and I
      // need to choose to hear more clicks, and when I switch to another song -
      // I don't want to hear that many ticks - and I need to switch again".
      const rig = createRig();
      await shelved(rig, ['Choral Chambers']);
      const kept = rig.runtime.scores.list().find((score) => score.title === 'Choral Chambers');
      await rig.runtime.scores.keepTheClick(kept?.id ?? '', 'subdivision', 1_000);
      rig.runtime.controller.updateSettings({ clickPattern: 'pulse' });

      openRow('Choral Chambers').click();
      await waitFor(() => rig.runtime.controller.openedExercise?.title === 'Choral Chambers');

      expect(rig.runtime.controller.settings.clickPattern).toBe('subdivision');
      // And the control says so, rather than the setting and the page
      // disagreeing until something else redraws it.
      expect(element<HTMLSelectElement>('click').value).toBe('subdivision');
    });

    it('leaves the click alone for a piece nobody has chosen for', async () => {
      // Nothing remembered is the instruction to leave the reader's own setting
      // where it is. A default here would have every score ever imported
      // quietly override it.
      const rig = createRig();
      await shelved(rig, ['Something Borrowed']);
      rig.runtime.controller.updateSettings({ clickPattern: 'division' });

      openRow('Something Borrowed').click();
      await waitFor(() => rig.runtime.controller.openedExercise?.title === 'Something Borrowed');

      expect(rig.runtime.controller.settings.clickPattern).toBe('division');
    });

    it('gives the piece the click chosen while it is open', async () => {
      const rig = createRig();
      await shelved(rig, ['Choral Chambers']);
      openRow('Choral Chambers').click();
      await waitFor(() => rig.runtime.controller.openedExercise?.title === 'Choral Chambers');

      const control = element<HTMLSelectElement>('click');
      control.value = 'subdivision';
      control.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => rig.runtime.scores.theClickFor('Choral Chambers') === 'subdivision');

      expect(rig.runtime.scores.theClickFor('Choral Chambers')).toBe('subdivision');
    });

    it('keeps one piece out of another', async () => {
      // The whole complaint: two pieces wanting different clicks, and switching
      // between them meaning a trip to the settings each way.
      const rig = createRig();
      await shelved(rig, ['Choral Chambers', 'City of Tears']);
      openRow('Choral Chambers').click();
      await waitFor(() => rig.runtime.controller.openedExercise?.title === 'Choral Chambers');
      const control = element<HTMLSelectElement>('click');
      control.value = 'subdivision';
      control.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => rig.runtime.scores.theClickFor('Choral Chambers') === 'subdivision');

      openRow('City of Tears').click();
      await waitFor(() => rig.runtime.controller.openedExercise?.title === 'City of Tears');
      control.value = 'downbeat';
      control.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => rig.runtime.scores.theClickFor('City of Tears') === 'downbeat');

      openRow('Choral Chambers').click();
      await waitFor(() => rig.runtime.controller.openedExercise?.title === 'Choral Chambers');

      expect(rig.runtime.controller.settings.clickPattern).toBe('subdivision');
    });

    it('writes it to the piece being read, not to the top of the shelf', async () => {
      // The list is ordered by what was opened last, so for most of a session
      // the piece being read *is* the first row - and a version that wrote to
      // the first row would pass every test above. Here it is opened without
      // the shelf being told, so the two come apart.
      const rig = createRig();
      await shelved(rig, ['Choral Chambers', 'City of Tears']);
      expect(rig.runtime.scores.list()[0]?.title).toBe('City of Tears');
      const older = await rig.runtime.scores.open(
        rig.runtime.scores.list().find((score) => score.title === 'Choral Chambers')?.id ?? '',
      );
      await rig.runtime.controller.openScore(older ?? twoBarExercise());

      const control = element<HTMLSelectElement>('click');
      control.value = 'subdivision';
      control.dispatchEvent(new Event('change', { bubbles: true }));
      await waitFor(() => rig.runtime.scores.theClickFor('Choral Chambers') === 'subdivision');

      expect(rig.runtime.scores.theClickFor('City of Tears')).toBeNull();
    });

    it('remembers nothing for a piece that was never kept', async () => {
      // A generated exercise is not a piece anybody comes back to.
      const { view, runtime } = createRig();
      await view.initialize();
      expect(runtime.controller.openedExercise).toBeNull();

      const control = element<HTMLSelectElement>('click');
      control.value = 'subdivision';
      control.dispatchEvent(new Event('change', { bubbles: true }));

      expect(runtime.controller.settings.clickPattern).toBe('subdivision');
      expect(runtime.scores.list()).toEqual([]);
    });
  });

  describe('the scores kept between visits', () => {
    async function keepOne(rig: Rig, title = 'Something Borrowed'): Promise<void> {
      await rig.runtime.scores.keep(twoBarExercise({ title }), 1_000);
      await rig.view.initialize();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('says nothing when the library is empty', async () => {
      const { view } = createRig();
      await view.initialize();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(element('scores-empty').hidden).toBe(false);
    });

    it('lists what an earlier visit kept', async () => {
      const rig = createRig();
      await keepOne(rig);

      expect(element('scores-list').childElementCount).toBe(1);
      expect(element('scores-list').textContent).toContain('Something Borrowed');
      expect(element('scores-list').textContent).toContain('2 bars');
    });

    it('narrows the list to what was typed', async () => {
      // Thirty-odd arrangements is past the point where a list is read; and
      // what a reader remembers of a name is rarely its first word, so the
      // words are matched in any order.
      const rig = createRig();
      await keepOne(rig, 'Hollow Knight - City of Tears');
      await keepOne(rig, 'Clair de Lune');

      const search = element<HTMLInputElement>('scores-search');
      search.value = 'tears city';
      search.dispatchEvent(new Event('input'));

      expect(element('scores-list').childElementCount).toBe(1);
      expect(element('scores-list').textContent).toContain('City of Tears');

      search.value = 'nocturne';
      search.dispatchEvent(new Event('input'));

      // Said in the reader's own words rather than as "nothing kept yet",
      // which would be a lie about a library that has two scores in it.
      expect(element('scores-list').childElementCount).toBe(0);
      expect(element('scores-empty').hidden).toBe(false);
      expect(element('scores-empty').textContent).toContain('nocturne');
    });

    it('forgets what was typed when the sheet is raised again', async () => {
      const rig = createRig();
      await keepOne(rig, 'Clair de Lune');
      const search = element<HTMLInputElement>('scores-search');
      search.value = 'nothing like this';
      search.dispatchEvent(new Event('input'));
      expect(element('scores-list').childElementCount).toBe(0);

      element<HTMLButtonElement>('focus-scores').click();

      // A search left over from yesterday reads as a library that has lost
      // most of its scores.
      expect(search.value).toBe('');
      expect(element('scores-list').childElementCount).toBe(1);
    });

    it('says how long ago each one was read', async () => {
      // The list is ordered by that and by nothing else, and an order nobody
      // can see the reason for is read as no order at all.
      const rig = createRig();
      await keepOne(rig, 'Read Yesterday');
      await rig.runtime.scores.markRead('Read Yesterday', Date.now() - 86_400_000);

      element<HTMLButtonElement>('focus-scores').click();

      expect(element('scores-list').textContent).toContain('yesterday');
    });

    it('generates a new exercise unless it is told otherwise', async () => {
      const rig = createRig();
      await rig.runtime.scores.keep(twoBarExercise({ title: 'Kept Piece' }), 1_000);

      await rig.view.initialize();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // What opening this has always done, and still the default: the
      // library lives in a database that answers later than the page draws.
      expect(rig.runtime.controller.openedExercise).toBeNull();
    });

    it('puts back the piece that was being worked on', async () => {
      const rig = createRig();
      await rig.runtime.scores.keep(twoBarExercise({ title: 'Imported Later' }), 2_000);
      await rig.runtime.scores.keep(twoBarExercise({ title: 'Read Later' }), 1_000);
      await rig.runtime.scores.markRead('Read Later', 3_000);
      rig.runtime.controller.updateSettings({ whatOpens: 'last' });

      await rig.view.initialize();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The one he read last, not the one that arrived last.
      expect(rig.runtime.controller.openedExercise?.title).toBe('Read Later');
    });

    it('puts back the sketch worked on last, written down, and a new exercise where there is none', async () => {
      const played = {
        events: [
          { kind: 'noteOn' as const, atMs: 0, midi: 60, velocity: 0.5 },
          { kind: 'noteOff' as const, atMs: 400, midi: 60 },
        ],
        beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
      };
      const rig = createRig();
      await rig.runtime.scores.keep(twoBarExercise({ title: 'Read Later' }), 1_000);
      await rig.runtime.scores.markRead('Read Later', 3_000);
      const older = rig.sketches.begin(played, 'Older idea', 1);
      const idea = rig.sketches.begin(played, 'My idea', 2);
      rig.sketches.opened(older.id);
      rig.sketches.opened(idea.id);
      rig.runtime.controller.updateSettings({ whatOpens: 'lastSketch' });

      await rig.view.initialize();
      await waitFor(() => rig.runtime.controller.openedExercise?.title === 'My idea');
      // Open in the editor, over it written down.
      expect(element('sheet-roll').hidden).toBe(false);
      expect(element('roll-title').textContent).toBe('My idea');
      expect(element('roll-edit').getAttribute('aria-pressed')).toBe('true');
      element<HTMLButtonElement>('roll-close').click();
      expect(rig.runtime.controller.openedExercise?.title).toBe('My idea');
      const options = [...element<HTMLSelectElement>('what-opens').options].map((option) => [option.value, option.textContent]);
      expect(options.slice(-2)).toEqual([
        ['lastSketch', 'The sketch I worked on last'],
        ['lastOfAll', 'Whatever I had open last'],
      ]);
      expect(element<HTMLSelectElement>('what-opens').value).toBe('lastSketch');
      // And none opened, a new exercise.
      mountRealMarkup();
      const empty = createRig();
      empty.sketches.begin(played, 'Never opened', 1);
      empty.runtime.controller.updateSettings({ whatOpens: 'lastSketch' });
      await empty.view.initialize();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(empty.runtime.controller.openedExercise).toBeNull();
    });

    it('puts back whatever was open last, the score read or the sketch worked on', async () => {
      const played = {
        events: [
          { kind: 'noteOn' as const, atMs: 0, midi: 60, velocity: 0.5 },
          { kind: 'noteOff' as const, atMs: 400, midi: 60 },
        ],
        beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
      };
      // The sketch opened after the score was read.
      const rig = createRig();
      await rig.runtime.scores.keep(twoBarExercise({ title: 'Read Earlier' }), 1_000);
      await rig.runtime.scores.markRead('Read Earlier', Date.now() - 60_000);
      rig.sketches.opened(rig.sketches.begin(played, 'Worked on since', 1).id);
      rig.runtime.controller.updateSettings({ whatOpens: 'lastOfAll' });
      await rig.view.initialize();
      await waitFor(() => rig.runtime.controller.openedExercise?.title === 'Worked on since');

      // The score read after the sketch was opened.
      mountRealMarkup();
      const later = createRig();
      later.sketches.opened(later.sketches.begin(played, 'Opened earlier', 1).id);
      await later.runtime.scores.keep(twoBarExercise({ title: 'Read Since' }), 1_000);
      await later.runtime.scores.markRead('Read Since', Date.now() + 60_000);
      later.runtime.controller.updateSettings({ whatOpens: 'lastOfAll' });
      await later.view.initialize();
      await waitFor(() => later.runtime.controller.openedExercise?.title === 'Read Since');
      // A score is read on the page: no editor over it.
      expect(element('sheet-roll').hidden).toBe(true);

      // Only a score, it; only a sketch, it.
      mountRealMarkup();
      const scoreOnly = createRig();
      await scoreOnly.runtime.scores.keep(twoBarExercise({ title: 'Only Read' }), 1_000);
      await scoreOnly.runtime.scores.markRead('Only Read', 3_000);
      scoreOnly.runtime.controller.updateSettings({ whatOpens: 'lastOfAll' });
      await scoreOnly.view.initialize();
      await waitFor(() => scoreOnly.runtime.controller.openedExercise?.title === 'Only Read');
      mountRealMarkup();
      const sketchOnly = createRig();
      sketchOnly.sketches.opened(sketchOnly.sketches.begin(played, 'Only Sketched', 1).id);
      sketchOnly.runtime.controller.updateSettings({ whatOpens: 'lastOfAll' });
      await sketchOnly.view.initialize();
      await waitFor(() => sketchOnly.runtime.controller.openedExercise?.title === 'Only Sketched');
      expect(element('roll-title').textContent).toBe('Only Sketched');
    });

    it('counts a sketch opened in the editor or written down as the one worked on last', async () => {
      const rig = createRig();
      await rig.view.initialize();
      const played = {
        events: [
          { kind: 'noteOn' as const, atMs: 0, midi: 60, velocity: 0.5 },
          { kind: 'noteOff' as const, atMs: 400, midi: 60 },
        ],
        beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
      };
      const edited = rig.sketches.begin(played, 'Edited', 1);
      const written = rig.sketches.begin(played, 'Written', 2);
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      const row = (title: string): HTMLLIElement | undefined =>
        [...element('sketches-list').querySelectorAll('li')].find((each) => each.textContent?.includes(title) === true);
      row('Edited')?.querySelector<HTMLButtonElement>('button[title="Edit this sketch"]')?.click();
      expect(rig.sketches.openedLast?.sketch.id).toBe(edited.id);
      element<HTMLButtonElement>('roll-close').click();
      element<HTMLButtonElement>('focus-scores').click();
      element<HTMLButtonElement>('scores-show-sketches').click();
      row('Written')?.querySelector<HTMLButtonElement>('button[title="Write this sketch down as a score"]')?.click();
      expect(rig.sketches.openedLast?.sketch.id).toBe(written.id);
    });

    it('offers one of the kept scores at random', async () => {
      const rig = createRig();
      await rig.runtime.scores.keep(twoBarExercise({ title: 'One' }), 1_000);
      await rig.runtime.scores.keep(twoBarExercise({ title: 'Two' }), 2_000);
      rig.runtime.controller.updateSettings({ whatOpens: 'random' });

      await rig.view.initialize();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(['One', 'Two']).toContain(rig.runtime.controller.openedExercise?.title);
    });

    it('does not count its own choice as a reading', async () => {
      // Otherwise the random piece would push itself to the top of the
      // library on every visit, and the piece actually being worked on would
      // be somewhere down the list by the end of the week.
      const rig = createRig();
      await rig.runtime.scores.keep(twoBarExercise({ title: 'Older' }), 1_000);
      await rig.runtime.scores.keep(twoBarExercise({ title: 'Newer' }), 2_000);
      await rig.runtime.scores.markRead('Older', 3_000);
      rig.runtime.controller.updateSettings({ whatOpens: 'random' });
      // Every stamp, and not merely the order: whichever of the two is
      // offered, none of them may move - and an order alone would pass by
      // luck on every run where the piece chosen was at the top already.
      const stamps = (): string[] =>
        rig.runtime.scores.list().map((score) => `${score.title} ${score.openedAtMs}`);
      const before = stamps();

      await rig.view.initialize();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(stamps()).toEqual(before);
      expect(before).toEqual(['Older 3000', 'Newer 2000']);
    });

    it('falls back to an exercise when there is nothing kept', async () => {
      const rig = createRig();
      rig.runtime.controller.updateSettings({ whatOpens: 'random' });

      await rig.view.initialize();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // There has to be something to read a moment from now, which is the
      // whole point of asking for a piece on opening.
      expect(rig.runtime.controller.openedExercise).toBeNull();
      expect(rig.runtime.controller.currentExercise).not.toBeNull();
    });

    it('counts playing a score as reading it', async () => {
      // The only way a score the program chose by itself can ever become the
      // piece being worked on.
      const rig = createRig();
      await rig.runtime.scores.keep(twoBarExercise({ title: 'Older' }), 1_000);
      await rig.runtime.scores.keep(twoBarExercise({ title: 'Newer' }), 2_000);
      await rig.runtime.scores.markRead('Older', 3_000);
      rig.runtime.controller.updateSettings({ whatOpens: 'random' });
      await rig.view.initialize();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const opened = rig.runtime.controller.openedExercise?.title;
      const stampFor = (title: string | undefined): number =>
        rig.runtime.scores.list().find((score) => score.title === title)?.openedAtMs ?? 0;
      const before = stampFor(opened);

      rig.runtime.controller.start();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The stamp and not the order: whichever of the two was offered, it is
      // read *now*, and a test that watched the order would pass by luck
      // whenever the piece chosen happened to be at the top already.
      expect(stampFor(opened)).toBeGreaterThan(before);
      expect(rig.runtime.scores.list()[0]?.title).toBe(opened);
    });

    it('shuts a rename with Escape, cancelling rather than applying', async () => {
      // A rename is a promise the page is holding. Hidden and not answered, the
      // await behind it never returns - which is what a list of sheets that
      // merely hid them would have done.
      const rig = createRig();
      await keepOne(rig, 'Imported score');
      rowButton('scores-list', 'Rename this score').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(element('sheet-rename').hidden).toBe(false);

      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(element('sheet-rename').hidden).toBe(true);
      // Unchanged: cancelling is not renaming to nothing, and it is not
      // renaming to the name that was already in the box either.
      expect(rig.runtime.scores.list()[0]?.title).toBe('Imported score');
    });

    it('gives a score the name the reader calls it by', async () => {
      // MuseScore arrangements arrive called things nobody says out loud.
      const rig = createRig();
      await keepOne(rig, 'Imported score');

      rowButton('scores-list', 'Rename this score').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(element('sheet-rename').hidden).toBe(false);
      // The name it has now, ready to be edited rather than retyped.
      expect(element<HTMLInputElement>('rename-name').value).toBe('Imported score');

      element<HTMLInputElement>('rename-name').value = 'Merry Christmas Mr Lawrence';
      element<HTMLButtonElement>('rename-yes').click();
      await waitFor(() => element('scores-list').textContent?.includes('Merry Christmas') === true);

      expect(element('sheet-rename').hidden).toBe(true);
      expect(rig.runtime.scores.list()[0]?.title).toBe('Merry Christmas Mr Lawrence');
    });

    it('will not leave a score with no name at all', async () => {
      const rig = createRig();
      await keepOne(rig, 'Named');

      rowButton('scores-list', 'Rename this score').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      element<HTMLInputElement>('rename-name').value = '   ';
      element<HTMLButtonElement>('rename-yes').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Still asking, and saying why - a score with no name cannot be looked
      // for, and there is nothing sensible to fall back to.
      expect(element('sheet-rename').hidden).toBe(false);
      expect(element('rename-problem').hidden).toBe(false);
      expect(rig.runtime.scores.list()[0]?.title).toBe('Named');
    });

    it('refuses a name that would write over another score', async () => {
      const rig = createRig();
      await keepOne(rig, 'One');
      await keepOne(rig, 'Two');

      rowButton('scores-list', 'Rename this score').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      element<HTMLInputElement>('rename-name').value = 'One';
      element<HTMLButtonElement>('rename-yes').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // The title is the library's idea of identity, so obeying would delete
      // the other piece rather than rename this one.
      expect(rig.runtime.scores.list().map((score) => score.title).sort()).toEqual(['One', 'Two']);
    });

    it('adds a score from the sheet, through the one picker there is', async () => {
      const { view } = createRig();
      await view.initialize();
      const picker = element<HTMLInputElement>('score-file');
      let opened = 0;
      picker.addEventListener('click', () => {
        opened += 1;
      });

      element<HTMLButtonElement>('scores-add').click();

      // One way in, so a score opened from here is read and reported on
      // exactly as any other score is.
      expect(opened).toBe(1);
    });

    it('opens one without going back to the disk', async () => {
      const rig = createRig();
      await keepOne(rig);

      const open = element('scores-list').querySelector('button');
      (open as HTMLButtonElement | null)?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Which is the whole point: the file is chosen once and the piece is
      // afterwards simply there.
      expect(rig.runtime.controller.openedExercise?.title).toBe('Something Borrowed');
    });

    it('forgets one from its row', async () => {
      const rig = createRig();
      await keepOne(rig);

      rowButton('scores-list', 'Forget this score').click();
      await confirmDeletion();

      expect(rig.runtime.scores.isEmpty).toBe(true);
    });

    it('asks before forgetting one, because the row is a thumb wide', async () => {
      const rig = createRig();
      await keepOne(rig);

      rowButton('scores-list', 'Forget this score').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(element('sheet-confirm').hidden).toBe(false);

      element<HTMLButtonElement>('confirm-no').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(element('sheet-confirm').hidden).toBe(true);
      expect(rig.runtime.scores.isEmpty).toBe(false);
    });

    it('empties the shelf when the word is typed', async () => {
      const rig = createRig();
      await keepOne(rig);

      element<HTMLButtonElement>('scores-clear').click();
      await confirmByTyping();

      expect(rig.runtime.scores.isEmpty).toBe(true);
    });

    it('will not empty the shelf for a button press alone', async () => {
      // A row is one score and a mis-tap costs a file that is still on the
      // disk; this is the whole library, a thumb's width from that row.
      const rig = createRig();
      await keepOne(rig);

      element<HTMLButtonElement>('scores-clear').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(element<HTMLButtonElement>('confirm-yes').disabled).toBe(true);
      expect(element('confirm-typed').hidden).toBe(false);
      element<HTMLButtonElement>('confirm-yes').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(element('sheet-confirm').hidden).toBe(false);
      expect(rig.runtime.scores.isEmpty).toBe(false);
    });

    it('will not take a word that is not the word', async () => {
      const rig = createRig();
      await keepOne(rig);

      element<HTMLButtonElement>('scores-clear').click();
      await confirmByTyping('yes');

      expect(rig.runtime.scores.isEmpty).toBe(false);
    });

    it('says how much is about to go, and keeps the row question simple', async () => {
      const rig = createRig();
      await keepOne(rig, 'One');
      await keepOne(rig, 'Two');

      element<HTMLButtonElement>('scores-clear').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(element('confirm-text').textContent).toContain('2 kept scores');
      element<HTMLButtonElement>('confirm-no').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // One row is still one question with two buttons: what is lost there
      // is a row, and the file it came from is still on the disk.
      rowButton('scores-list', 'Forget this score').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(element('confirm-typed').hidden).toBe(true);
      expect(element<HTMLButtonElement>('confirm-yes').disabled).toBe(false);
    });
  });

  describe('how long today has had', () => {
    it('counts the time the page is in front of the reader', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 6, 10, 0, 0));
      try {
        const rig = createRig();
        await rig.view.initialize();

        await vi.advanceTimersByTimeAsync(60_000);

        // Wall clock, and only while the page is on screen: this is the
        // question "have I practised today", not the one the rest reminder
        // asks about hands.
        expect(rig.runtime.timeToday.msOn(Date.now())).toBeGreaterThanOrEqual(55_000);
        expect(element('score-today').hidden).toBe(false);
        expect(element('score-today').textContent).toContain('1 min');
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows the week, and the run of days, beside it', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 6, 10, 0, 0));
      try {
        const rig = createRig();
        // Two days already behind him, so today makes three.
        rig.runtime.timeToday.add(new Date(2026, 8, 4, 10).getTime(), 20 * 60_000);
        rig.runtime.timeToday.add(new Date(2026, 8, 5, 10).getTime(), 20 * 60_000);
        await rig.view.initialize();

        await vi.advanceTimersByTimeAsync(70_000);

        expect(element('score-today').textContent).toContain('3 days in a row');
        const marks = element('score-week').querySelectorAll('span');
        expect(marks).toHaveLength(7);
        // The gaps say as much as the days: nothing before the fourth.
        expect(
          [...marks].map((mark) => mark.classList.contains('score__week-day--played')),
        ).toEqual([false, false, false, false, true, true, true]);
        expect([...marks].at(-1)?.classList.contains('score__week-day--today')).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('says nothing about a run of one day', async () => {
      // Everybody who has ever opened this has a day, and a number that can
      // only say "1" says nothing at all.
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 6, 10, 0, 0));
      try {
        const rig = createRig();
        await rig.view.initialize();

        await vi.advanceTimersByTimeAsync(70_000);

        expect(element('score-today').textContent).toContain('1 min');
        expect(element('score-today').textContent).not.toContain('in a row');
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops while the page is away, and starts again on the way back', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 6, 10, 0, 0));
      const visibility = vi.spyOn(document, 'visibilityState', 'get');
      try {
        const rig = createRig();
        await rig.view.initialize();
        await vi.advanceTimersByTimeAsync(30_000);
        const counted = rig.runtime.timeToday.msOn(Date.now());

        visibility.mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(10 * 60_000);

        // Ten minutes in another app is not ten minutes of practice.
        expect(rig.runtime.timeToday.msOn(Date.now())).toBeLessThanOrEqual(counted + 1_000);

        visibility.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(60_000);

        expect(rig.runtime.timeToday.msOn(Date.now())).toBeGreaterThan(counted + 50_000);
      } finally {
        visibility.mockRestore();
        vi.useRealTimers();
      }
    });

    it('does not count a machine that went to sleep with the page open', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 6, 10, 0, 0));
      try {
        const rig = createRig();
        await rig.view.initialize();

        // One tick, but three hours between two readings of the clock.
        vi.setSystemTime(new Date(2026, 8, 6, 13, 0, 0));
        await vi.advanceTimersByTimeAsync(5_000);

        expect(rig.runtime.timeToday.msOn(Date.now())).toBeLessThan(60_000);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('counting in', () => {
    /**
     * A Flow run played by nobody, from Start to the end of the music.
     *
     * Counted by the beats the count-in announces rather than by the status:
     * a run always passes through `counting-in`, even with nought bars of it,
     * because the pulse has to be established before the music. What the
     * setting changes is whether anything is counted there.
     */
    async function beatsCountedOnTheNextLap(rig: Rig, countInRun: 'once' | 'every'): Promise<number> {
      rig.runtime.controller.updateSettings({
        modeId: FLOW_MODE_ID,
        countInBars: 1,
        repeatRange: true,
        countInRun,
      });
      rig.runtime.controller.start();
      rig.metronome.advanceSubdivisions(200);
      let counted = 0;
      rig.runtime.controller.events.on('sessionCreated', ({ session }) => {
        session.events.on('countIn', () => {
          counted += 1;
        });
      });
      // The lap the view starts for us, and a few ticks for it to count in.
      await new Promise((resolve) => setTimeout(resolve, 0));
      rig.metronome.advanceSubdivisions(8);
      return counted;
    }

    it('counts every time round, which is what a repeat has always done', async () => {
      const rig = createRig();
      await rig.view.initialize();

      expect(await beatsCountedOnTheNextLap(rig, 'every')).toBeGreaterThan(0);
    });

    it('counts only the first time, when asked', async () => {
      // Drilling a passage wants counting every time; playing it through
      // wants counting once and then no interruption.
      const rig = createRig();
      await rig.view.initialize();

      expect(await beatsCountedOnTheNextLap(rig, 'once')).toBe(0);
    });
  });

  describe('the places marked out in a piece', () => {
    it('keeps the passage under the score it belongs to, and goes back to it', async () => {
      // His line 47: a piece is learned in places, and setting the same two
      // bar numbers by hand every evening is the part that is not practice.
      const rig = createRig();
      await rig.view.initialize();
      const kept = await rig.runtime.scores.keep(longExercise({ bars: 8 }), 1_000);
      const exercise = await rig.runtime.scores.open(kept.id);
      await rig.runtime.controller.openScore(exercise as never);
      rig.runtime.controller.updateSettings({ rangeFromBar: 5, rangeToBar: 8 });

      element<HTMLInputElement>('passage-name').value = 'The left-hand run';
      element<HTMLButtonElement>('passage-save').click();
      await waitFor(() => element('passage-list').childElementCount > 0);

      expect(element('passage-list').textContent).toContain('The left-hand run');
      expect(element('passage-list').textContent).toContain('bars 5-8');

      // Somewhere else entirely, and then back with one tap.
      rig.runtime.controller.updateSettings({ rangeFromBar: 1, rangeToBar: 2 });
      rowButton('passage-list', 'Practise bars 5-8').click();

      expect(rig.runtime.controller.settings.rangeFromBar).toBe(5);
      expect(rig.runtime.controller.settings.rangeToBar).toBe(8);
    });

    it('names it by its bars where the reader did not', async () => {
      const rig = createRig();
      await rig.view.initialize();
      const kept = await rig.runtime.scores.keep(longExercise({ bars: 8 }), 1_000);
      await rig.runtime.controller.openScore((await rig.runtime.scores.open(kept.id)) as never);
      rig.runtime.controller.updateSettings({ rangeFromBar: 3, rangeToBar: 4 });

      element<HTMLButtonElement>('passage-save').click();
      await waitFor(() => element('passage-list').childElementCount > 0);

      expect(element('passage-list').textContent).toContain('Bars 3-4');
    });

    it('is reached from the drawer, beside the numbers it is about', async () => {
      // His: a list of places down the settings sheet is nowhere near where a
      // place is chosen. A passage is picked out with a long press on the
      // page and two numbers in the drawer, and this belongs in that reach.
      const rig = createRig();
      await rig.view.initialize();
      expect(element('sheet-places').hidden).toBe(true);

      element<HTMLButtonElement>('focus-places').click();

      expect(element('sheet-places').hidden).toBe(false);
      expect(element('sheet-places').contains(element('passage-list'))).toBe(true);
      // And nowhere else: two lists of one thing would disagree the first
      // time either was used.
      expect(element('sheet-settings').contains(element('passage-list'))).toBe(false);

      // It closes the way every other sheet does.
      tapOutside(element('sheet-places'));

      expect(element('sheet-places').hidden).toBe(true);
    });

    it('says which of the places the reader is in', async () => {
      // Without it the list is a set of places with no answer to "where am
      // I", and the two bar numbers in the drawer are the only thing that
      // knows - which is what the list exists to save the reader reading.
      const rig = createRig();
      await rig.view.initialize();
      const kept = await rig.runtime.scores.keep(longExercise({ bars: 8 }), 1_000);
      await rig.runtime.controller.openScore((await rig.runtime.scores.open(kept.id)) as never);
      rig.runtime.controller.updateSettings({ rangeFromBar: 5, rangeToBar: 8 });
      element<HTMLButtonElement>('passage-save').click();
      await waitFor(() => element('passage-list').childElementCount > 0);
      const row = (): HTMLButtonElement => rowButton('passage-list', 'Practise bars 5-8');

      expect(row().getAttribute('aria-pressed')).toBe('true');
      // And it is the row itself that is pressed, which is what the
      // stylesheet marks and what a thumb aims at.
      expect(row().classList.contains('places__go')).toBe(true);

      rig.runtime.controller.updateSettings({ rangeFromBar: 1, rangeToBar: 2 });
      element<HTMLButtonElement>('focus-places').click();

      expect(row().getAttribute('aria-pressed')).toBe('false');

      row().click();

      expect(row().getAttribute('aria-pressed')).toBe('true');
    });

    it('goes to where the place begins, not only to its two numbers', async () => {
      // His: picking one should jump to where it starts. The numbers alone
      // leave the page wherever it was, which on a long piece is nowhere
      // near - and a passage the reader cannot see is one they have to go
      // and find.
      const rig = createRig();
      await rig.view.initialize();
      const kept = await rig.runtime.scores.keep(longExercise({ bars: 8 }), 1_000);
      await rig.runtime.controller.openScore((await rig.runtime.scores.open(kept.id)) as never);
      rig.runtime.controller.updateSettings({ rangeFromBar: 5, rangeToBar: 8 });
      element<HTMLButtonElement>('passage-save').click();
      await waitFor(() => element('passage-list').childElementCount > 0);
      rig.runtime.controller.updateSettings({ rangeFromBar: null, rangeToBar: null });
      rig.renderer.cursor.moves.length = 0;
      element<HTMLButtonElement>('focus-places').click();

      rowButton('passage-list', 'Practise bars 5-8').click();

      // Four crotchets to the bar, so bar five begins at the seventeenth
      // step - and the marker is what carries the page with it.
      expect(rig.renderer.cursor.moves.at(-1)).toBe(16);
      // And the sheet gets out of the way, since the point of the tap was to
      // be somewhere.
      expect(element('sheet-places').hidden).toBe(true);
    });

    it('has nothing to offer while the material is generated', async () => {
      // An exercise is generated afresh every time, so "bars 5 to 8" of one
      // says nothing about the next.
      const rig = createRig();
      await rig.view.initialize();

      expect(element<HTMLButtonElement>('passage-save').disabled).toBe(true);
      expect(element('passage-empty').textContent).toContain('Open one of your scores');
    });
  });

  describe('the readings that have been played', () => {
    it('lists them, newest first, with how they were played', async () => {
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record('score:Clair de Lune bars:5-8', {
        atMs: Date.now(),
        overall: 0.82,
        grade: 'B',
        completed: true,
        tempoPercent: 70,
        hand: 2,
      });

      element<HTMLButtonElement>('focus-readings').click();

      expect(element('sheet-readings').hidden).toBe(false);
      const row = element('readings-list').textContent ?? '';
      expect(row).toContain('Clair de Lune');
      expect(row).toContain('bars 5-8');
      expect(row).toContain('82% B');
      // The score alone says little: at seventy with the left hand is a
      // different afternoon's work from full speed with both. The hand is a
      // mark rather than a word, and says which in full when it is pointed at.
      expect(row).toContain('70% speed');
      const hand = element('readings-list').querySelector('.pill--hand');
      expect(hand?.textContent).toBe('LH');
      expect(hand?.getAttribute('title')).toBe('Left hand alone');
      // And the row is the way in, rather than a button at the end of it.
      expect(
        element('readings-list')
          .querySelector('button')
          ?.getAttribute('aria-label'),
      ).toContain('Clair de Lune');
    });

    it('says what became of the notes, as four numbers in the colours of the page', async () => {
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record('score:Clair de Lune', {
        atMs: Date.now(),
        overall: 0.82,
        grade: 'B',
        completed: true,
        notes: { perfect: 312, good: 40, missed: 5, wrong: 3 },
      });
      rig.runtime.history.record('score:Arabesque', {
        atMs: Date.now() - 60_000,
        overall: 0.7,
        grade: 'C',
        completed: true,
      });

      element<HTMLButtonElement>('focus-readings').click();

      const [counted, older] = [...element('readings-list').querySelectorAll('.readings__row')];
      const counts = [...(counted?.querySelectorAll('.readings__count') ?? [])] as HTMLElement[];
      expect(counts.map((each) => [each.dataset['kind'], each.textContent])).toEqual([
        ['perfect', '312'],
        ['good', '40'],
        ['missed', '5'],
        ['wrong', '3'],
      ]);
      // In words where it is pointed at.
      expect(counted?.querySelector('.readings__notes')?.getAttribute('title')).toBe(
        '312 perfect · 40 good · 5 missed · 3 wrong',
      );
      // A reading kept before notes were counted says nothing rather than noughts.
      expect(older?.querySelector('.readings__notes')).toBeNull();
    });

    it('wears what was true of the run: the passage, how hard the piece is, where it stopped', async () => {
      const rig = createRig();
      await rig.view.initialize();
      await rig.runtime.scores.keep(twoBarExercise({ title: 'Clair de Lune' }), 1_000);
      const kept = rig.runtime.scores.list()[0];
      await rig.runtime.scores.keepTheStars(kept?.id ?? '', 4.5, Date.now());
      rig.runtime.history.record('score:Clair de Lune', {
        atMs: Date.now(),
        overall: 0.4,
        grade: 'D',
        completed: false,
        stoppedAtBar: 12,
      });

      element<HTMLButtonElement>('focus-readings').click();

      const row = element('readings-list');
      // The whole piece was asked for, even though it was not reached: what
      // was read and how far it got are different questions.
      expect(row.querySelector('.pill--slice')?.textContent).toBe('whole piece');
      expect(row.querySelector('.pill--stopped')?.textContent).toBe('stopped at bar 12');
      expect(row.querySelector('.scores__stars')?.textContent).toBe('★ 4.5');
      expect(row.querySelector('.scores__stars')?.getAttribute('data-band')).not.toBeNull();
    });

    it('lists only the readings played through when asked, and says where one picked up partway began', async () => {
      const rig = createRig();
      await rig.view.initialize();
      const read = (title: string, how: Partial<PracticeAttempt>): void => {
        rig.runtime.history.record(`score:${title}`, {
          atMs: Date.now(),
          overall: 0.8,
          grade: 'B',
          completed: true,
          startedAtBar: null,
          ...how,
        });
      };
      read('Through', {});
      read('Picked up', { startedAtBar: 30 });
      read('Stopped', { completed: false, stoppedAtBar: 4 });
      element<HTMLButtonElement>('focus-readings').click();
      const names = (): (string | null)[] =>
        [...element('readings-list').querySelectorAll('.readings__name')].map((name) => name.textContent);

      // Reaching the end from bar thirty is not the whole piece.
      const pickedUp = [...element('readings-list').querySelectorAll('li')].find((row) =>
        row.textContent?.includes('Picked up'),
      );
      expect(pickedUp?.querySelector('.pill--slice')?.textContent).toBe('from bar 30');
      expect(names()).toHaveLength(3);

      const through = element<HTMLInputElement>('readings-through');
      through.checked = true;
      through.dispatchEvent(new Event('change'));
      expect(names()).toEqual(['Through']);

      for (const id of ['readings-best', 'readings-this-piece']) {
        const box = element<HTMLInputElement>(id);
        box.checked = true;
        box.dispatchEvent(new Event('change'));
      }
      expect(element('readings-empty').hidden).toBe(false);
      expect(element('readings-empty').textContent).toContain('played through');
    });

    it('wears the squares it was played under, drawn as the squares themselves are', async () => {
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record('score:A', {
        atMs: Date.now(),
        overall: 0.9,
        grade: 'A',
        completed: true,
        modeId: WAIT_MODE_ID,
        modes: ['survival', 'blind'],
      });

      element<HTMLButtonElement>('focus-readings').click();

      const worn = [...element('readings-list').querySelectorAll('.readings__mode')];
      expect(worn.map((badge) => badge.getAttribute('data-mode'))).toEqual([
        'wait',
        'survival',
        'blind',
      ]);
      // Each carries the square's own icon rather than one drawn again here.
      expect(worn.every((badge) => badge.querySelector('svg') !== null)).toBe(true);
      expect(worn[1]?.getAttribute('title')).toBe('Survival');
    });

    it('says nothing about the plain way of playing', async () => {
      // Both hands, full speed, the frame the app opens in: marks for those
      // would be on every row and would say nothing about any of them.
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record('score:A', {
        atMs: Date.now(),
        overall: 0.9,
        grade: 'A',
        completed: true,
        tempoPercent: 100,
        hand: null,
        modeId: FLOW_MODE_ID,
        modes: [],
      });

      element<HTMLButtonElement>('focus-readings').click();

      const row = element('readings-list');
      expect(row.querySelector('.pill--hand')).toBeNull();
      expect(row.querySelector('.readings__mode')).toBeNull();
      expect(row.querySelector('.pill--stopped')).toBeNull();
      expect(row.textContent).not.toContain('speed');
    });

    it('gives the letter its own colour, on the row and at the head of the sheet', async () => {
      // His: "літери A/B/C мали свій особистий колір". The colour is the
      // stylesheet's; what this says is that both places hand it the letter.
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record('score:A', {
        atMs: Date.now(),
        overall: 0.55,
        grade: 'C',
        completed: true,
      });
      element<HTMLButtonElement>('focus-readings').click();

      expect(
        element('readings-list').querySelector('.pill--grade')?.getAttribute('data-grade'),
      ).toBe('C');

      element('readings-list').querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );

      expect(
        element('reading-what').querySelector('.result__grade')?.getAttribute('data-grade'),
      ).toBe('C');
    });

    it('opens a sheet wearing the same marks as the row it came from', async () => {
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record('score:A bars:2-6', {
        atMs: Date.now(),
        overall: 0.9,
        grade: 'A',
        completed: true,
        hand: 1,
        modeId: WAIT_MODE_ID,
      });
      element<HTMLButtonElement>('focus-readings').click();

      element('readings-list').querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );

      const marks = element('reading-what').querySelector('.reading__marks');
      expect(marks?.querySelector('.pill--slice')?.textContent).toBe('bars 2-6');
      expect(marks?.querySelector('.pill--hand')?.textContent).toBe('RH');
      expect(marks?.querySelector('.readings__mode')?.getAttribute('data-mode')).toBe('wait');
      expect(element('reading-what').querySelector('.result__grade')?.textContent).toContain('A');
    });

    it('shows the best ones when asked, the stopped ones below', async () => {
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record('score:Stopped', {
        atMs: Date.now(),
        overall: 1,
        grade: 'A',
        completed: false,
      });
      rig.runtime.history.record('score:Finished', {
        atMs: Date.now(),
        overall: 0.8,
        grade: 'B',
        completed: true,
      });
      element<HTMLButtonElement>('focus-readings').click();

      const best = element<HTMLInputElement>('readings-best');
      best.checked = true;
      best.dispatchEvent(new Event('change'));

      const names = [...element('readings-list').querySelectorAll('.readings__name')].map(
        (name) => name.textContent,
      );
      expect(names).toEqual(['Finished', 'Stopped']);
    });

    it('shows the best of this piece when none of it was finished', async () => {
      // His: with "this piece" and "best first" both ticked the list was empty,
      // because nothing of the piece had been played to the end.
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record(rig.runtime.controller.pieceKey, {
        atMs: Date.now(),
        overall: 0.4,
        grade: 'D',
        completed: false,
        stoppedAtBar: 3,
      });
      element<HTMLButtonElement>('focus-readings').click();

      for (const id of ['readings-this-piece', 'readings-best']) {
        const box = element<HTMLInputElement>(id);
        box.checked = true;
        box.dispatchEvent(new Event('change'));
      }

      expect(element('readings-list').querySelectorAll('li')).toHaveLength(1);
      expect(element('readings-empty').hidden).toBe(true);
    });

    it('says the best of nothing is nothing read, not nothing finished', async () => {
      // Stopped readings are among the best now, so an empty best is an empty
      // history - and the old line would send the reader off to finish one.
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-readings').click();

      const best = element<HTMLInputElement>('readings-best');
      best.checked = true;
      best.dispatchEvent(new Event('change'));

      expect(element('readings-empty').hidden).toBe(false);
      expect(element('readings-empty').textContent).toContain('Nothing read yet');
    });

    it('puts the hardest pieces first among the best, passages by their piece', async () => {
      const rig = createRig();
      await rig.view.initialize();
      await rig.runtime.scores.keep(twoBarExercise({ title: 'Easy' }), 1_000);
      await rig.runtime.scores.keep(twoBarExercise({ title: 'Hard' }), 2_000);
      for (const kept of rig.runtime.scores.list()) {
        await rig.runtime.scores.keepTheStars(kept.id, kept.title === 'Hard' ? 8 : 2, 3_000);
      }
      rig.runtime.history.record('score:Easy', {
        atMs: Date.now(),
        overall: 0.95,
        grade: 'A',
        completed: true,
      });
      rig.runtime.history.record('score:Hard bars:3-6', {
        atMs: Date.now(),
        overall: 0.6,
        grade: 'C',
        completed: true,
      });
      element<HTMLButtonElement>('focus-readings').click();

      const best = element<HTMLInputElement>('readings-best');
      best.checked = true;
      best.dispatchEvent(new Event('change'));

      const names = [...element('readings-list').querySelectorAll('.readings__name')].map(
        (name) => name.textContent,
      );
      expect(names).toEqual(['Hard', 'Easy']);
    });

    /** A reading as a run records one, with the picture and roll it kept. */
    function readingKept(how: Partial<PracticeAttempt> = {}): PracticeAttempt {
      return {
        atMs: Date.now(),
        overall: 0.82,
        grade: 'B',
        completed: true,
        picture: {
          bars: 'cw.',
          waitedAtBars: [1],
          axes: [
            { name: 'Accuracy', of: 0.9, said: '9 of 10' },
            { name: 'Timing', of: 0.8, said: '20 ms' },
            { name: 'Evenness', of: 0.7, said: 'steady' },
          ],
          deviationsMs: [-20, -5, 0, 5, 20, 30],
          pressesJudged: 60,
          toleranceMs: 120,
          totals: {
            steps: 10,
            playableSteps: 12,
            correct: 9,
            incorrect: 1,
            missed: 0,
            skipped: 2,
            expectedNotes: 20,
            correctNotes: 18,
            perfectNotes: 15,
            goodNotes: 3,
            wrongNotes: 2,
            barsWaitedFor: 1,
          },
          meanDeviationMs: -4,
          meanAbsoluteDeviationMs: 13,
          deviationSpreadMs: 17,
          stoppedAtBar: null,
        },
        ...how,
      };
    }

    it('opens one reading over the list, drawn as the report after a run is', async () => {
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record('score:Clair de Lune', readingKept());
      element<HTMLButtonElement>('focus-readings').click();

      element('readings-list').querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );

      expect(element('sheet-reading').hidden).toBe(false);
      expect(element('reading-title').textContent).toContain('Clair de Lune');
      const what = element('reading-what');
      // The bars as they read, one cell each, the second of them waited at.
      const bars = [...what.querySelectorAll('.run-strip__bar')];
      expect(bars.map((bar) => bar.getAttribute('data-state'))).toEqual(['clean', 'wrong', 'unread']);
      expect(bars[1]?.getAttribute('data-waited')).toBe('true');
      // The shape of the playing, and the numbers under it.
      expect(what.querySelector('.profile-figure')).not.toBeNull();
      expect(what.textContent).toContain('18/20');
      expect(what.textContent).toContain('13 ms');
    });

    it('says how often the music waited, the way the reading was played', async () => {
      // A bar line's gate counts bars, a gate at every note counts notes - of
      // the notes asked for - and a frame with no gate says nothing about it.
      const said = async (modeId: string): Promise<string> => {
        const rig = createRig();
        await rig.view.initialize();
        rig.runtime.history.record('score:Gated', readingKept({ modeId }));
        element<HTMLButtonElement>('focus-readings').click();
        element('readings-list').querySelector('button')?.dispatchEvent(
          new MouseEvent('click', { bubbles: true }),
        );
        return element('reading-what').textContent ?? '';
      };

      expect(await said(NOTE_MODE_ID)).toMatch(/Notes it waited at\s*1 of 12/);
      expect(await said(BAR_MODE_ID)).toMatch(/Bars it waited at\s*1 of 3/);
      expect(await said(FLOW_MODE_ID)).not.toMatch(/waited at/);
    });

    it('says when only some of the presses are drawn, rather than letting them be counted', async () => {
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record('score:Long', readingKept());
      element<HTMLButtonElement>('focus-readings').click();

      element('readings-list').querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );

      expect(element('reading-what').textContent).toContain('6 of the 60 presses drawn');
    });

    it('says so where a reading has given its picture up, rather than drawing an empty frame', async () => {
      const rig = createRig();
      await rig.view.initialize();
      const { picture: _picture, ...bare } = readingKept();
      rig.runtime.history.record('score:Old', bare);
      element<HTMLButtonElement>('focus-readings').click();

      element('readings-list').querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );

      expect(element('reading-what').textContent).toContain('given up to make room');
      expect(element('reading-what').querySelector('.run-strip')).toBeNull();
    });

    it('opens the picture of what a reading played, titled with the reading', async () => {
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record(
        'score:Clair de Lune',
        readingKept({
          roll: {
            presses: [{
              midi: 60,
              downAtMs: 0,
              upAtMs: 500,
              velocity: 0.6,
              verdict: null,
              stepIndex: null,
              deviationMs: null,
            }],
            beats: [],
            pedal: [],
            rushes: [],
            truncated: false,
          },
        }),
      );
      element<HTMLButtonElement>('focus-readings').click();
      element('readings-list').querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );

      expect(element('reading-roll').hidden).toBe(false);
      element<HTMLButtonElement>('reading-roll').click();

      expect(element('sheet-roll').hidden).toBe(false);
      // The reading stays open underneath, and the picture stands over it:
      // nothing shuts until the reader shuts it.
      expect(element('sheet-reading').hidden).toBe(false);
      expect(Number(element('sheet-roll').dataset['over'])).toBeGreaterThan(
        Number(element('sheet-reading').dataset['over']),
      );
      expect(element('roll-title').textContent).toContain('Clair de Lune');
      // Not of the score in front of the reader, so there is nothing in it to
      // keep or to practise.
      expect(element<HTMLButtonElement>('roll-practise').disabled).toBe(true);
      expect(element('roll-keep').hidden).toBe(true);
    });

    /** A roll of one judged press on the first step, over a bar of four beats. */
    function aRollOnTheFirstStep(): RunRoll {
      return {
        presses: [{
          midi: 60,
          downAtMs: 0,
          upAtMs: 500,
          velocity: 0.6,
          verdict: 'correct',
          stepIndex: 0,
          deviationMs: 0,
        }],
        beats: [0, 1, 2, 3, 4].map((beat) => ({
          atMs: beat * 1_000,
          weight: beat % 4 === 0 ? ('downbeat' as const) : ('beat' as const),
          positionTicks: beat * Duration.QUARTER.ticks,
        })),
        pedal: [],
        rushes: [],
        truncated: false,
      };
    }

    it('draws none of the open score’s notes under a reading of another piece', async () => {
      // They were drawn from whatever was open, so a reading of Clair de Lune
      // looked at over another piece had that piece's notes as its outlines.
      const rig = createRig();
      await rig.view.initialize();
      await rig.runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
      rig.runtime.history.record('score:Clair de Lune', readingKept({ roll: aRollOnTheFirstStep() }));
      element<HTMLButtonElement>('focus-readings').click();
      element('readings-list').querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );

      element<HTMLButtonElement>('reading-roll').click();

      expect(rig.view.rollScene?.notes.length).toBeGreaterThan(0);
      expect(rig.view.rollScene?.ghosts).toHaveLength(0);
    });

    it('draws the notes asked for under a reading of the score that is open', async () => {
      const rig = createRig();
      await rig.view.initialize();
      await rig.runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
      rig.runtime.history.record(rig.runtime.controller.pieceKey, readingKept({ roll: aRollOnTheFirstStep() }));
      element<HTMLButtonElement>('focus-readings').click();
      element('readings-list').querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );

      element<HTMLButtonElement>('reading-roll').click();

      expect(rig.view.rollScene?.ghosts.length).toBeGreaterThan(0);
    });

    it('draws none under a reading of a generated exercise, which is another one each time', async () => {
      // Filed under the level it came from, which is the level open now - and
      // still not the notes it was played on.
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record(rig.runtime.controller.pieceKey, readingKept({ roll: aRollOnTheFirstStep() }));
      element<HTMLButtonElement>('focus-readings').click();
      element('readings-list').querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );

      element<HTMLButtonElement>('reading-roll').click();

      expect(rig.view.rollScene?.ghosts).toHaveLength(0);
    });

    it('draws none under a reading the open score no longer fits, being changed since', async () => {
      const rig = createRig();
      await rig.view.initialize();
      await rig.runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
      const fitted = aRollOnTheFirstStep();
      const press = fitted.presses[0];
      if (press === undefined) {
        throw new Error('No press in the roll.');
      }
      // A step the two bars do not have.
      const roll = { ...fitted, presses: [{ ...press, stepIndex: 99 }] };
      rig.runtime.history.record(rig.runtime.controller.pieceKey, readingKept({ roll }));
      element<HTMLButtonElement>('focus-readings').click();
      element('readings-list').querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );

      element<HTMLButtonElement>('reading-roll').click();

      expect(rig.view.rollScene?.ghosts).toHaveLength(0);
    });

    it('offers no picture of a reading that has none', async () => {
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record('score:Old', readingKept());
      element<HTMLButtonElement>('focus-readings').click();

      element('readings-list').querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );

      expect(element('reading-roll').hidden).toBe(true);
    });

    it('forgets one reading when the reader says so, and leaves the rest', async () => {
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.history.record('score:A', readingKept({ atMs: 1_000 }));
      rig.runtime.history.record('score:A', readingKept({ atMs: 2_000 }));
      element<HTMLButtonElement>('focus-readings').click();
      element('readings-list').querySelector('button')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );

      element<HTMLButtonElement>('reading-delete').click();
      await confirmDeletion();
      await waitFor(() => element('sheet-reading').hidden === true);

      expect(rig.runtime.history.lastReadings().map((reading) => reading.atMs)).toEqual([1_000]);
      expect(element('readings-list').querySelectorAll('li')).toHaveLength(1);
    });

    it('narrows the list to the piece in front of the reader when asked', async () => {
      const rig = createRig();
      await rig.view.initialize();
      const here = rig.runtime.controller.pieceKey;
      rig.runtime.history.record(here, readingKept({ atMs: 1_000 }));
      rig.runtime.history.record('score:Somewhere else', readingKept({ atMs: 2_000 }));
      element<HTMLButtonElement>('focus-readings').click();
      expect(element('readings-list').textContent).toContain('Somewhere else');

      const thisPiece = element<HTMLInputElement>('readings-this-piece');
      thisPiece.checked = true;
      thisPiece.dispatchEvent(new Event('change'));

      expect(element('readings-list').textContent).not.toContain('Somewhere else');
      expect(element('readings-list').querySelectorAll('li')).toHaveLength(1);
    });
  });

  describe('learning a piece a section at a time', () => {
    it('says what to play, and sets it', async () => {
      const rig = createRig();
      await rig.view.initialize();
      await rig.runtime.controller.openScore(longExercise({ bars: 8 }));
      // Started from the sheet of the ways to go about a run, not the settings.
      element<HTMLButtonElement>('focus-modes').click();
      expect(element('drill-start').closest('.sheet')?.id).toBe('sheet-modes');

      element<HTMLInputElement>('drill-bars').value = '4';
      element<HTMLButtonElement>('drill-start').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Said at the top, out of the music, and not in the middle of it.
      const pill = element<HTMLButtonElement>('drill-pill');
      expect(pill.hidden).toBe(false);
      expect(pill.textContent).toContain('Plan 1/');
      expect(pill.textContent).toContain('Bars 1-4');
      expect(element('score-card').hidden).toBe(true);
      // The ordinary passage, not a private one: the drawer says it too.
      expect(element<HTMLInputElement>('focus-to').value).toBe('4');
      // And it gets out of the way so the reader can play.
      expect(element('sheet-modes').hidden).toBe(true);
    });

    it('stays at the top through a run, and opens the whole plan when pressed', async () => {
      const rig = createRig();
      await rig.view.initialize();
      await rig.runtime.controller.openScore(longExercise({ bars: 8 }));
      element<HTMLButtonElement>('drill-start').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      element<HTMLButtonElement>('focus-play').click();
      expect(element('drill-pill').hidden).toBe(false);
      element<HTMLButtonElement>('focus-stop').click();

      element<HTMLButtonElement>('drill-pill').click();

      expect(element('sheet-drill').hidden).toBe(false);
      const steps = [...element('drill-steps').querySelectorAll('li')];
      expect(steps).toHaveLength(rig.runtime.controller.drillProgress.of);
      expect(steps.map((step) => step.dataset['state'])).toEqual([
        'now',
        ...steps.slice(1).map(() => 'later'),
      ]);
      expect(steps[0]?.textContent).toBe(element('drill-pill').textContent?.replace(/^Plan 1\/\d+ · /, ''));
    });

    it('marks the steps played through, and says when the whole plan is', async () => {
      const rig = createRig();
      await rig.view.initialize();
      await rig.runtime.controller.openScore(longExercise({ bars: 8 }));
      element<HTMLButtonElement>('drill-start').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const { of } = rig.runtime.controller.drillProgress;
      expect(of).toBeGreaterThan(2);

      for (let step = 0; step < of; step += 1) {
        const session = rig.runtime.controller.start();
        for (let guard = 0; guard < 500 && session?.status === 'running'; guard += 1) {
          for (const note of session.currentStep?.expectedMidi ?? []) {
            rig.midi.noteOn(note, rig.clock.now());
          }
        }
        if (step === 0) {
          element<HTMLButtonElement>('drill-pill').click();
          const states = [...element('drill-steps').querySelectorAll('li')].map((li) => li.dataset['state']);
          expect(states.slice(0, 2)).toEqual(['done', 'now']);
          element<HTMLButtonElement>('drill-close').click();
        }
      }

      // Said, and kept until put away.
      expect(element('drill-pill').hidden).toBe(false);
      expect(element('drill-pill').textContent).toContain('Plan done');
      element<HTMLButtonElement>('drill-pill').click();
      expect(element('drill-stop').textContent).toBe('Done');
      element<HTMLButtonElement>('drill-stop').click();
      expect(element('drill-pill').hidden).toBe(true);
      expect(element('sheet-drill').hidden).toBe(true);
    });

    it('goes back to a step played through, from the plan', async () => {
      const rig = createRig();
      await rig.view.initialize();
      await rig.runtime.controller.openScore(longExercise({ bars: 8 }));
      element<HTMLButtonElement>('drill-start').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const session = rig.runtime.controller.start();
      for (let guard = 0; guard < 500 && session?.status === 'running'; guard += 1) {
        for (const note of session.currentStep?.expectedMidi ?? []) {
          rig.midi.noteOn(note, rig.clock.now());
        }
      }
      expect(element('drill-pill').textContent).toContain('Plan 2/');
      element<HTMLButtonElement>('drill-pill').click();
      // The step ahead is not one to press.
      expect(element('drill-steps').querySelectorAll('button')).toHaveLength(1);

      element('drill-steps').querySelector<HTMLButtonElement>('button')?.click();

      expect(rig.runtime.controller.drillProgress.at).toBe(0);
      expect(element('drill-pill').textContent).toContain('Plan 1/');
      expect(element<HTMLInputElement>('focus-to').value).toBe('4');
      expect(element('sheet-drill').hidden).toBe(true);
    });

    it('takes the plan up again when the piece is opened on another visit', async () => {
      const drillStore = new InMemorySettingsStore();
      const first = createRig(undefined, undefined, undefined, drillStore);
      await first.view.initialize();
      await first.runtime.controller.openScore(longExercise({ bars: 8, title: 'Berceuse' }));
      element<HTMLButtonElement>('drill-start').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const session = first.runtime.controller.start();
      for (let guard = 0; guard < 500 && session?.status === 'running'; guard += 1) {
        for (const note of session.currentStep?.expectedMidi ?? []) {
          first.midi.noteOn(note, first.clock.now());
        }
      }

      mountRealMarkup();
      const second = createRig(undefined, undefined, undefined, drillStore);
      await second.view.initialize();
      await second.runtime.controller.openScore(longExercise({ bars: 8, title: 'Berceuse' }));

      expect(element('drill-pill').hidden).toBe(false);
      expect(element('drill-pill').textContent).toContain('Plan 2/3');
      expect(element<HTMLInputElement>('focus-from').value).toBe('5');
      // And the sheet it is started from says where this piece is in it.
      expect(element('drill-description').textContent).toContain('step 2 of 3');
      expect(element('drill-start').textContent).toBe('Start over');
    });

    it('puts the plan away when asked', async () => {
      const rig = createRig();
      await rig.view.initialize();
      await rig.runtime.controller.openScore(longExercise({ bars: 8 }));
      element<HTMLButtonElement>('drill-start').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      element<HTMLButtonElement>('drill-pill').click();
      element<HTMLButtonElement>('drill-stop').click();
      // Where it had got to goes with it, so it is asked first, and said so.
      expect(element('sheet-confirm').hidden).toBe(false);
      expect(element('confirm-yes').textContent).toBe('Stop the plan');
      element<HTMLButtonElement>('confirm-no').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rig.runtime.controller.drillTask).not.toBeNull();

      element<HTMLButtonElement>('drill-stop').click();
      element<HTMLButtonElement>('confirm-yes').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(element('drill-pill').hidden).toBe(true);
      expect(element('sheet-drill').hidden).toBe(true);
      expect(rig.runtime.controller.drillTask).toBeNull();
    });
  });

  describe('the bar in a mode that waits', () => {
    /**
     * Time passing for both clocks at once.
     *
     * The page owns the timer that drives the drain; the moment it drains
     * *to* is read off the application's own clock, which in here is manual.
     * A test that moved only one of them would prove nothing about either.
     */
    async function waitFor(rig: Rig, ms: number): Promise<void> {
      for (let at = 0; at < ms; at += 100) {
        rig.clock.advance(100);
        await vi.advanceTimersByTimeAsync(100);
      }
    }

    it('falls while the page waits', async () => {
      // The application layer owns no timer - the whole practice loop runs
      // headlessly on a manual clock - so the page has to drive this one.
      vi.useFakeTimers();
      try {
        const rig = createRig();
        await rig.view.initialize();
        rig.runtime.controller.updateSettings({ survival: true });
        rig.runtime.controller.start();
        const drained: number[] = [];
        rig.runtime.controller.events.on('healthChanged', ({ health }) => drained.push(health));

        await waitFor(rig, 1_000);

        expect(drained.length).toBeGreaterThan(1);
        expect(rig.runtime.controller.health).toBeLessThan(1);
        expect(element('focus-health').hidden).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops falling once the run is over', async () => {
      vi.useFakeTimers();
      try {
        const rig = createRig();
        await rig.view.initialize();
        rig.runtime.controller.updateSettings({ survival: true });
        const session = rig.runtime.controller.start();
        await waitFor(rig, 500);
        session?.abort();
        const health = rig.runtime.controller.health;
        expect(health).toBeLessThan(1);

        await waitFor(rig, 3_000);

        expect(rig.runtime.controller.health).toBe(health);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('turning the pages', () => {
    /** Through the controls themselves: the wiring is the thing being tested. */
    async function readAsPages(turns: string): Promise<void> {
      const select = element<HTMLSelectElement>('page-turns');
      select.value = turns;
      select.dispatchEvent(new Event('change'));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('leaves the turning to the reader when asked to', async () => {
      // For a piece already learned: looking up to find that the page has
      // turned itself is worse than not looking up at all.
      const rig = createRig();
      await rig.view.initialize();

      await readAsPages('manual');

      expect(rig.renderer.pagesFollowTheMusic).toBe(false);
      expect(element('score-pages').hidden).toBe(false);
      expect(element('score-page-at').textContent).toBe('1 / 2');
      // Nowhere to go back to from the first page.
      expect(element<HTMLButtonElement>('score-page-back').disabled).toBe(true);
    });

    it('turns a page from the arrows under the score', async () => {
      const rig = createRig();
      await rig.view.initialize();
      await readAsPages('manual');

      element<HTMLButtonElement>('score-page-on').click();

      expect(rig.renderer.pages.at).toBe(1);
      expect(element('score-page-at').textContent).toBe('2 / 2');
      // And the far end is the far end.
      expect(element<HTMLButtonElement>('score-page-on').disabled).toBe(true);
    });

    it('follows the music, and shows nothing early, when told to turn quietly', async () => {
      const rig = createRig();
      await rig.view.initialize();

      await readAsPages('automatic');

      expect(rig.renderer.pagesFollowTheMusic).toBe(true);
      expect(rig.renderer.nextPagePreview).toBe(false);
      // Arrows would be furniture: nothing is waiting to be turned by hand.
      expect(element('score-pages').hidden).toBe(true);
    });

    it('says nothing about page turns while the score is one long strip', async () => {
      const rig = createRig();
      await rig.view.initialize();
      await readAsPages('manual');

      // Back to scrolling, which is now the thing a reader has to ask for.
      const box = element<HTMLInputElement>('paged-score');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Disabled rather than hidden - a control that disappears is one the
      // reader goes looking for - and no arrows over a score that scrolls.
      expect(element<HTMLSelectElement>('page-turns').disabled).toBe(true);
      expect(element('score-pages').hidden).toBe(true);
    });
  });

  describe('keeping a take', () => {
    function playSomething(rig: Rig): void {
      rig.midi.noteOn(60, rig.clock.now());
      rig.clock.advance(200);
      rig.midi.noteOff(60, rig.clock.now());
    }

    it('offers nothing until something has been played', async () => {
      const { view } = createRig();
      await view.initialize();

      expect(element<HTMLButtonElement>('focus-keep').disabled).toBe(true);
      expect(element<HTMLButtonElement>('focus-keep').disabled).toBe(true);
    });

    it('stays asleep when only the pedal moves', async () => {
      // The button said a recording was running because something had arrived,
      // not because anything had been played. His: "the recording is being
      // triggered by a pedal".
      const rig = createRig();
      await rig.view.initialize();
      rig.midi.pedal(true, rig.clock.now());
      rig.clock.advance(200);
      rig.midi.pedal(false, rig.clock.now());

      const button = element<HTMLButtonElement>('focus-keep');
      expect(button.disabled).toBe(true);
      expect(button.textContent?.trim()).toBe('Keep');
    });

    it('wakes up as soon as the keyboard is touched', async () => {
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);

      const button = element<HTMLButtonElement>('focus-keep');
      expect(button.disabled).toBe(false);
      // Says what it is offering, so a take cut at the wrong pause shows.
      expect(button.textContent).toContain('0:00');
    });

    it('shows whether the next key would go on with this take or start a new one', async () => {
      // The complaint this answers: waiting for the recorder to let go of one
      // take before starting the next meant counting a silence nobody could
      // see, and learning by feel how long it was.
      const rig = createRig();
      await rig.view.initialize();
      const keep = element<HTMLButtonElement>('focus-keep');

      vi.useFakeTimers();
      try {
        playSomething(rig);
        expect(keep.dataset['recording']).toBe('true');

        // Nothing more is played; the page counts the silence out on its own,
        // which is the whole point - there is nothing else to notice.
        rig.clock.advance(rig.recorder.silenceMs + 1);
        vi.advanceTimersByTime(rig.recorder.silenceMs + 100);

        expect(keep.dataset['recording']).toBe('false');
        // Still there to be kept: sealed is not gone.
        expect(keep.disabled).toBe(false);
        expect(keep.title).toContain('starts a new take');

        playSomething(rig);
        expect(keep.dataset['recording']).toBe('true');
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the counter running through a pause instead of jumping', async () => {
      // Read from the clock rather than from the last thing that arrived, so
      // a moment's thought does not look like a fault in the recording.
      const rig = createRig();
      await rig.view.initialize();
      const desk = element<HTMLButtonElement>('focus-keep');

      vi.useFakeTimers();
      try {
        playSomething(rig);
        expect(desk.textContent).toContain('0:00');

        rig.clock.advance(2_000);
        vi.advanceTimersByTime(600);

        expect(desk.textContent).toContain('0:02');
      } finally {
        vi.useRealTimers();
      }
    });

    it('captures without being asked to start', async () => {
      const rig = createRig();
      await rig.view.initialize();
      // Nothing was pressed before playing: an idea is noticed afterwards.
      playSomething(rig);

      element<HTMLButtonElement>('focus-keep').click();

      expect(rig.takes.list()).toHaveLength(1);
      expect(element('takes-list').childElementCount).toBe(1);
    });

    it('files what was played even when nothing was pressed', async () => {
      // The complaint this answers: an idea is noticed after it is played, and
      // a reader who touched the keys again before reaching for the button
      // lost the one before it with nothing to say so.
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);
      expect(rig.takes.list()).toHaveLength(0);

      // Long enough to end the take; the next note is what notices.
      rig.clock.advance(10_000);
      playSomething(rig);

      expect(rig.takes.list()).toHaveLength(1);
      expect(rig.takes.list()[0]?.shelf).toBe('recent');
    });

    it('files a take on the list as the silence ends it, and keeps that one from the button', async () => {
      // Filed only when the next key was pressed, the last idea of a sitting
      // was lost when the page was closed or reloaded before it.
      const rig = createRig();
      await rig.view.initialize();
      const keep = element<HTMLButtonElement>('focus-keep');

      vi.useFakeTimers();
      try {
        playSomething(rig);
        rig.clock.advance(rig.recorder.silenceMs + 1);
        vi.advanceTimersByTime(rig.recorder.silenceMs + 100);
      } finally {
        vi.useRealTimers();
      }

      expect(rig.takes.list().map((take) => take.shelf)).toEqual(['recent']);
      expect(element('takes-list').childElementCount).toBe(1);
      // Still on offer, with how long it was.
      expect(keep.disabled).toBe(false);
      expect(keep.textContent).toContain('0:00');
      expect(keep.title).toContain('Already among the takes');

      keep.click();

      expect(rig.takes.list().map((take) => take.shelf)).toEqual(['kept']);
      expect(keep.disabled).toBe(true);
    });

    it('moves one off the shelf that gets tidied', async () => {
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);
      rig.clock.advance(10_000);
      playSomething(rig);
      expect(rig.takes.list()[0]?.shelf).toBe('recent');

      rowButton('takes-list', 'Keep this one for good, out of reach of the tidying.').click();

      expect(rig.takes.list()[0]?.shelf).toBe('kept');
    });

    it('plays a kept take back, and says where in it we are', async () => {
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);
      element<HTMLButtonElement>('focus-keep').click();
      expect(element('take-transport').hidden).toBe(true);

      rowButton('takes-list', 'Play this take').click();

      expect(element('take-transport').hidden).toBe(false);
      expect(rig.instrument.played.map((note) => note.midi)).toContain(60);
      expect(element<HTMLButtonElement>('take-play').title).toBe('Pause');
    });

    it('moves the take to where the slider was dragged', async () => {
      const rig = createRig();
      await rig.view.initialize();
      rig.midi.noteOn(60, rig.clock.now());
      rig.clock.advance(2_000);
      rig.midi.noteOff(60, rig.clock.now());
      element<HTMLButtonElement>('focus-keep').click();
      rowButton('takes-list', 'Play this take').click();

      const scrub = element<HTMLInputElement>('take-scrub');
      scrub.value = '500';
      scrub.dispatchEvent(new Event('input'));

      expect(rig.runtime.takePlayer.positionMs).toBe(1_000);
      expect(element('take-position').textContent).toBe('0:01');
    });

    it('watches a take on the keys over the page, its transport with it, and gives the list it back', async () => {
      // Play beside it is listening alone; this shuts the list, puts the keys
      // up with the notes falling onto them, and the slider moves the picture.
      const rig = createRig();
      await rig.view.initialize();
      const at = rig.clock.now();
      rig.midi.noteOn(60, at);
      rig.clock.advance(1_000);
      rig.midi.noteOff(60, rig.clock.now());
      rig.midi.noteOn(64, rig.clock.now());
      rig.clock.advance(1_000);
      rig.midi.noteOff(64, rig.clock.now());
      element<HTMLButtonElement>('focus-keep').click();
      element<HTMLButtonElement>('focus-takes').click();
      rowButton('takes-list', 'Play this take').click();
      // Held in the list first: watching it is asking to see it played.
      element<HTMLButtonElement>('take-play').click();
      expect(rig.runtime.takePlayer.playing).toBeNull();
      const transport = element('take-transport');
      const keys = element('replay-keys');
      expect(keys.hidden).toBe(true);

      element<HTMLButtonElement>('take-on-the-keys').click();

      expect(element('sheet-takes').hidden).toBe(true);
      expect(document.body.dataset['takeOnKeys']).toBe('true');
      expect(transport.parentElement).toBe(element('take-on-keys'));
      expect(element('take-on-keys').hidden).toBe(false);
      expect(keys.hidden).toBe(false);
      // Played from where the list had it, and lit as heard.
      expect(rig.runtime.takePlayer.playing).not.toBeNull();
      const lit = (): (string | undefined)[][] =>
        [...keys.querySelectorAll<HTMLElement>('[data-shade]')].map((key) => [key.dataset['midi'], key.dataset['shade']]);
      expect(lit()).toEqual([['60', 'heard']]);
      // Three seconds of the take falling: middle C on its key, the E a second off.
      const scene = (): (string | number)[][] =>
        rig.view.fallingScene.map((bar) => [bar.midi, bar.shade, Number(bar.top.toFixed(3)), Number(bar.bottom.toFixed(3))]);
      expect(scene()).toEqual([
        [60, 'heard', 0.667, 1],
        [64, 'heard', 0.333, 0.667],
      ]);

      // Held and dragged to a moment, the keys and the notes stand there.
      element<HTMLButtonElement>('take-play').click();
      const scrub = element<HTMLInputElement>('take-scrub');
      scrub.value = '750';
      scrub.dispatchEvent(new Event('input'));
      expect(lit()).toEqual([['64', 'heard']]);
      expect(scene()).toEqual([[64, 'heard', 0.833, 1]]);

      // Ended on the page, playing: the sound stops, the keys go, the list has its transport.
      element<HTMLButtonElement>('take-play').click();
      expect(rig.runtime.takePlayer.playing).not.toBeNull();
      element<HTMLButtonElement>('take-off-the-keys').click();
      expect(document.body.dataset['takeOnKeys']).toBeUndefined();
      expect(element('take-on-keys').hidden).toBe(true);
      expect(transport.parentElement).toBe(element('sheet-takes').querySelector('.sheet__panel'));
      expect(keys.hidden).toBe(true);
      expect(lit()).toEqual([]);
      expect(rig.runtime.takePlayer.playing).toBeNull();
    });

    it('lights the keys under a take or a run shown again in the frame that draws them, not the timer that sounds them', async () => {
      // The timer hands notes to the instrument every eighty milliseconds; a
      // key lit there went down that much after its note was heard.
      const frames = new Map<number, FrameRequestCallback>();
      let asked = 0;
      const ask = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        asked += 1;
        frames.set(asked, callback);
        return asked;
      });
      const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
        frames.delete(id);
      });
      const runTheFrames = (): void => {
        const due = [...frames.values()];
        frames.clear();
        for (const frame of due) {
          frame(0);
        }
      };
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        const rig = createRig();
        await rig.view.initialize();
        const keys = element('replay-keys');
        const lit = (): string[] =>
          [...keys.querySelectorAll<HTMLElement>('[data-shade]')].map((key) => key.dataset['midi'] ?? '');
        rig.midi.noteOn(60, rig.clock.now());
        rig.clock.advance(1_000);
        rig.midi.noteOff(60, rig.clock.now());
        rig.midi.noteOn(64, rig.clock.now());
        rig.clock.advance(1_000);
        rig.midi.noteOff(64, rig.clock.now());
        element<HTMLButtonElement>('focus-keep').click();
        element<HTMLButtonElement>('focus-takes').click();
        rowButton('takes-list', 'Play this take').click();
        element<HTMLButtonElement>('take-play').click();
        element<HTMLButtonElement>('take-on-the-keys').click();
        expect(lit()).toEqual(['60']);

        // The E heard, and no timer woken since: the next frame lights it.
        rig.clock.advance(1_010);
        expect(lit()).toEqual(['60']);
        runTheFrames();
        expect(lit()).toEqual(['64']);

        // Held, the frames stop; the keys stand where it was held.
        element<HTMLButtonElement>('take-play').click();
        runTheFrames();
        expect(frames.size).toBe(0);
        element<HTMLButtonElement>('take-off-the-keys').click();

        // A run shown again, the same: lit in the frame, as the run pressed them.
        rig.runtime.controller.updateSettings({ modeId: WAIT_MODE_ID });
        element<HTMLButtonElement>('focus-play').click();
        for (const _ of [1, 2]) {
          rig.clock.advance(1_000);
          for (const midi of rig.runtime.controller.session?.currentStep?.expectedMidi ?? []) {
            rig.midi.noteOn(midi, rig.clock.now());
          }
        }
        element<HTMLButtonElement>('focus-stop').click();
        element<HTMLButtonElement>('run-replay').click();
        const player = rig.runtime.takePlayer;
        const pressedAt = (): string[] =>
          [...(rig.runtime.controller.replayKeysAt(player.positionMs)?.keys.keys() ?? [])].map(String).sort();
        const before = lit().sort();
        let steps = 0;
        while (JSON.stringify(pressedAt()) === JSON.stringify(before) && steps < 100) {
          rig.clock.advance(20);
          steps += 1;
        }
        expect(steps).toBeLessThan(100);
        expect(lit().sort()).toEqual(before);
        runTheFrames();
        expect(lit().sort()).toEqual(pressedAt());
      } finally {
        vi.useRealTimers();
        ask.mockRestore();
        cancel.mockRestore();
      }
    });

    it('puts the slider away and back from under the pedal, and away with the keys too', async () => {
      const rig = createRig();
      await rig.view.initialize();
      const toggle = element('replay-keys').querySelector<HTMLButtonElement>('.replay-keys__slider-toggle');
      if (toggle === null) {
        throw new Error('No switch under the pedal.');
      }
      // Nothing to slide through, nothing said.
      expect(document.body.dataset['slider']).toBeUndefined();

      playSomething(rig);
      element<HTMLButtonElement>('focus-keep').click();
      element<HTMLButtonElement>('focus-takes').click();
      rowButton('takes-list', 'Play this take').click();
      element<HTMLButtonElement>('take-on-the-keys').click();
      expect(document.body.dataset['slider']).toBe('shown');
      expect(toggle.getAttribute('aria-pressed')).toBe('true');

      toggle.click();
      expect(rig.runtime.controller.settings.sliderShown).toBe(false);
      expect(document.body.dataset['slider']).toBe('put-away');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      expect(toggle.title).toBe('Show the slider under the keys');

      // With the keys put away it stays away, and the score is all there is.
      const keys = element<HTMLButtonElement>('focus-keyboard');
      const shows = (): string => rig.runtime.controller.settings.keysShown;
      while (shows() !== 'none') {
        keys.click();
      }
      expect(element('replay-keys').hidden).toBe(true);
      expect(document.body.dataset['slider']).toBe('put-away');
      // Shown, it is shown there as well.
      rig.runtime.controller.updateSettings({ sliderShown: true });
      keys.click();
      keys.click();
      keys.click();
      expect([shows(), document.body.dataset['slider']]).toEqual(['none', 'shown']);
      while (shows() !== 'falling-notes') {
        keys.click();
      }
      toggle.click();
      expect(document.body.dataset['slider']).toBe('put-away');
      toggle.click();
      expect(document.body.dataset['slider']).toBe('shown');

      element<HTMLButtonElement>('take-off-the-keys').click();
      expect(document.body.dataset['slider']).toBeUndefined();

      // A playback of the score the same: put away, and then the keys, and
      // nothing is left under the music.
      await pressListen(rig.runtime.controller);
      expect([element('listen-on-keys').hidden, document.body.dataset['slider']]).toEqual([false, 'shown']);
      toggle.click();
      while (shows() !== 'none') {
        keys.click();
      }
      expect([element('replay-keys').hidden, document.body.dataset['slider']]).toEqual([true, 'put-away']);
    });

    it('takes the transport back to the list when the list is opened again, playing on', async () => {
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);
      element<HTMLButtonElement>('focus-keep').click();
      element<HTMLButtonElement>('focus-takes').click();
      rowButton('takes-list', 'Play this take').click();
      element<HTMLButtonElement>('take-on-the-keys').click();

      element<HTMLButtonElement>('focus-takes').click();

      expect(element('sheet-takes').hidden).toBe(false);
      expect(document.body.dataset['takeOnKeys']).toBeUndefined();
      expect(element('take-transport').parentElement).toBe(element('sheet-takes').querySelector('.sheet__panel'));
      expect(element('replay-keys').hidden).toBe(true);
      expect(rig.runtime.takePlayer.playing).not.toBeNull();
    });

    it('starts a finished take again from the top', async () => {
      // Pressing play on a take already at its end plays the nothing that is
      // left of it, so the reader had to drag the slider back by hand before
      // the button would do anything at all.
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);
      element<HTMLButtonElement>('focus-keep').click();
      rowButton('takes-list', 'Play this take').click();

      // Played out, and stopped by the follower.
      rig.clock.advance(60_000);
      rig.runtime.takePlayer.pause();
      expect(rig.runtime.takePlayer.positionMs).toBe(rig.runtime.takePlayer.durationMs);

      const before = rig.instrument.played.length;
      element<HTMLButtonElement>('take-play').click();

      expect(rig.runtime.takePlayer.positionMs).toBe(0);
      expect(rig.instrument.played.length).toBeGreaterThan(before);
    });

    it('carries everything off the device and back onto it', async () => {
      // Installing the page to a Home Screen gives it a store of its own,
      // separate from the tab it was installed from - so the reader opened
      // the app and found their levels, scores and takes gone. Not lost;
      // somewhere the new window cannot reach.
      const rig = createRig();
      await rig.view.initialize();
      const tempo = element<HTMLInputElement>('tempo');
      tempo.value = '84';
      tempo.dispatchEvent(new Event('change'));
      await new Promise((resolve) => setTimeout(resolve, 0));

      element<HTMLButtonElement>('save-backup').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const [file] = rig.files.saved;
      expect(file?.fileName).toMatch(/^sight-reading-\d{8}-\d{4}\.json$/);
      expect(file?.mimeType).toBe('application/json');
      const document = JSON.parse(new TextDecoder().decode(file?.bytes)) as {
        kind: string;
        stores: Record<string, unknown>;
      };
      expect(document.kind).toBe('sight-reading-practice.backup');
      expect(Object.keys(document.stores)).toContain('settings');
    });

    it('stops the sound when the list is shut on it', async () => {
      // A take going on playing behind a closed list is a sound with nothing
      // on the page to stop it.
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);
      element<HTMLButtonElement>('focus-keep').click();
      rowButton('takes-list', 'Play this take').click();
      expect(rig.runtime.takePlayer.playing).not.toBeNull();

      element<HTMLButtonElement>('takes-close').click();

      expect(rig.runtime.takePlayer.playing).toBeNull();
    });

    it('takes a take back off the shelf that never gets tidied', async () => {
      // A reader who starred one by mistake has to be able to say so, and the
      // star did nothing once it was on.
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);
      element<HTMLButtonElement>('focus-keep').click();
      expect(rig.takes.list()[0]?.shelf).toBe('kept');

      rowButton('takes-list', 'Kept for good. Press to let the tidying reach it again.').click();

      expect(rig.takes.list()[0]?.shelf).toBe('recent');
      // Putting it back is not deleting it.
      expect(rig.takes.list()).toHaveLength(1);
    });

    it('shows only what was kept for good, when asked to', async () => {
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);
      rig.clock.advance(10_000);
      playSomething(rig);
      element<HTMLButtonElement>('focus-keep').click();
      expect(element('takes-list').childElementCount).toBe(2);

      const filter = element<HTMLInputElement>('takes-kept-only');
      filter.checked = true;
      filter.dispatchEvent(new Event('change'));

      expect(element('takes-list').childElementCount).toBe(1);
    });

    it('will not keep the same playing twice', async () => {
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);

      element<HTMLButtonElement>('focus-keep').click();
      element<HTMLButtonElement>('focus-keep').click();

      expect(rig.takes.list()).toHaveLength(1);
      expect(element<HTMLButtonElement>('focus-keep').disabled).toBe(true);
    });

    it('writes a MIDI file from the row', async () => {
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);
      element<HTMLButtonElement>('focus-keep').click();

      rowButton('takes-list', 'Save this take as a MIDI file').click();

      expect(rig.files.saved).toHaveLength(1);
      const [file] = rig.files.saved;
      expect(file?.fileName).toMatch(/^take-\d{8}-\d{6}\.mid$/);
      expect(file?.mimeType).toBe('audio/midi');
      // A real header, not an empty blob with a hopeful name.
      expect([...(file?.bytes ?? []).slice(0, 4)]).toEqual([0x4d, 0x54, 0x68, 0x64]);
    });

    it('deletes one from its row', async () => {
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);
      element<HTMLButtonElement>('focus-keep').click();

      rowButton('takes-list', 'Delete this take').click();
      await confirmDeletion();

      expect(rig.takes.list()).toHaveLength(0);
    });

    it('empties the whole list when asked', async () => {
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);
      element<HTMLButtonElement>('focus-keep').click();
      rig.clock.advance(10_000);
      playSomething(rig);
      element<HTMLButtonElement>('focus-keep').click();
      expect(rig.takes.list()).toHaveLength(2);

      element<HTMLButtonElement>('takes-clear').click();
      await confirmByTyping();

      expect(rig.takes.list()).toHaveLength(0);
    });

    it('keeps capturing while the monitor is muted', async () => {
      const rig = createRig();
      await rig.view.initialize();
      const monitor = element<HTMLInputElement>('audio-feedback');
      monitor.checked = false;
      monitor.dispatchEvent(new Event('change'));

      playSomething(rig);

      // Silencing what you hear is not a decision to stop capturing.
      expect(element<HTMLButtonElement>('focus-keep').disabled).toBe(false);
    });
  });

  describe('a knob on the keyboard', () => {
    function turn(rig: Rig, controller: number, count = 3): void {
      for (let at = 0; at < count; at += 1) {
        rig.midi.control(controller, 0.2 + at / 10);
      }
    }

    it('offers to learn one, and says nothing is bound', async () => {
      const { view } = createRig();
      await view.initialize();

      expect(element('learn-knob').textContent?.trim()).toBe('Use a knob');
      expect(element('knob-status').textContent).toContain('Teach the app');
    });

    it('learns the knob the reader turns', async () => {
      const rig = createRig();
      await rig.view.initialize();

      element<HTMLButtonElement>('learn-knob').click();
      expect(element('knob-status').textContent).toContain('Turn the knob');

      turn(rig, 11);

      expect(rig.runtime.volumeKnob.controller).toBe(11);
      expect(element('knob-status').textContent).toContain('CC 11');
    });

    it('shows what is arriving, even from the wrong control', async () => {
      const rig = createRig();
      await rig.view.initialize();
      element<HTMLButtonElement>('learn-knob').click();

      rig.midi.control(1, 0.42);

      // A screen that only waits cannot tell the reader whether their knob
      // sends anything at all.
      expect(element('knob-status').textContent).toContain('CC 1');
      expect(element('knob-status').textContent).toContain('42%');
      expect(rig.runtime.volumeKnob.controller).toBeNull();
    });

    it('drives the slider rather than a hidden second volume', async () => {
      const rig = createRig();
      await rig.view.initialize();
      element<HTMLButtonElement>('learn-knob').click();
      turn(rig, 7);

      rig.midi.control(7, 0.25);

      // Written through the slider, so the two can never disagree about how
      // loud the piano is.
      expect(element<HTMLInputElement>('instrument-volume').value).toBe('25');
      expect(rig.instrumentVolume.volume).toBeCloseTo(0.25, 5);
    });

    it('remembers the knob for the next visit', async () => {
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();
      element<HTMLButtonElement>('learn-knob').click();
      turn(first, 7);

      mountRealMarkup();
      const second = createRig(undefined, store);
      second.runtime.volumeKnob.bindTo(second.settings.currentAudio.volumeController);
      await second.view.initialize();

      expect(second.runtime.volumeKnob.controller).toBe(7);
      expect(element('knob-status').textContent).toContain('CC 7');
    });

    it('gives it back when asked', async () => {
      const rig = createRig();
      await rig.view.initialize();
      element<HTMLButtonElement>('learn-knob').click();
      turn(rig, 7);

      element<HTMLButtonElement>('learn-knob').click();

      expect(rig.runtime.volumeKnob.controller).toBeNull();
      expect(rig.settings.currentAudio.volumeController).toBeNull();
      expect(element('learn-knob').textContent?.trim()).toBe('Use a knob');
    });

    it("drives the metronome's slider with a knob of its own, leaving the notes' alone", async () => {
      const rig = createRig();
      await rig.view.initialize();
      element<HTMLButtonElement>('learn-knob').click();
      turn(rig, 7);
      element<HTMLButtonElement>('learn-metronome-knob').click();
      turn(rig, 11);
      expect(element('metronome-knob-status').textContent).toContain('CC 11');
      const notes = element<HTMLInputElement>('instrument-volume').value;

      rig.midi.control(11, 0.25);

      expect(element<HTMLInputElement>('metronome-volume').value).toBe('25');
      expect(element<HTMLInputElement>('sound-metronome-volume').value).toBe('25');
      expect(rig.metronomeVolume.volume).toBeCloseTo(0.25, 5);
      expect(element<HTMLInputElement>('instrument-volume').value).toBe(notes);
      expect(rig.settings.currentAudio.metronomeController).toBe(11);
      expect(rig.settings.currentAudio.volumeController).toBe(7);
    });

    it('turns both loudnesses with one knob when both were taught it', async () => {
      const rig = createRig();
      await rig.view.initialize();
      element<HTMLButtonElement>('learn-knob').click();
      turn(rig, 7);
      element<HTMLButtonElement>('learn-metronome-knob').click();
      turn(rig, 7);

      rig.midi.control(7, 0.3);

      expect(rig.instrumentVolume.volume).toBeCloseTo(0.3, 5);
      expect(rig.metronomeVolume.volume).toBeCloseTo(0.3, 5);
    });

    it('teaches one knob at a time', async () => {
      const rig = createRig();
      await rig.view.initialize();
      element<HTMLButtonElement>('learn-knob').click();
      element<HTMLButtonElement>('learn-metronome-knob').click();

      turn(rig, 11);

      // The turn was taken for the metronome, the last asked: the notes'
      // knob stopped listening when the metronome's started.
      expect(rig.runtime.metronomeKnob.controller).toBe(11);
      expect(rig.runtime.volumeKnob.controller).toBeNull();
      expect(element('learn-knob').textContent?.trim()).toBe('Use a knob');
    });

    it("remembers the metronome's knob for the next visit, and gives it back when asked", async () => {
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();
      element<HTMLButtonElement>('learn-metronome-knob').click();
      turn(first, 9);

      mountRealMarkup();
      const second = createRig(undefined, store);
      second.runtime.metronomeKnob.bindTo(second.settings.currentAudio.metronomeController);
      await second.view.initialize();
      expect(element('metronome-knob-status').textContent).toContain("CC 9 sets the metronome's volume");

      element<HTMLButtonElement>('learn-metronome-knob').click();

      expect(second.runtime.metronomeKnob.controller).toBeNull();
      expect(second.settings.currentAudio.metronomeController).toBeNull();
      expect(element('learn-metronome-knob').textContent?.trim()).toBe('Use a knob');
    });
  });

  describe('dragging the markers to choose a passage', () => {
    it('narrows to the bars they were dragged around, and says so', async () => {
      const { view, runtime, renderer } = createRig();
      await view.initialize();
      // The markers stand around the whole of what is engraved, which is what
      // a reader takes hold of.
      expect(renderer.shownPassage).toEqual({
        fromMeasureIndex: 0,
        toMeasureIndex: 3,
        repeating: false,
        movable: true,
      });

      renderer.dragPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runtime.controller.settings.rangeFromBar).toBe(2);
      expect(runtime.controller.settings.rangeToBar).toBe(3);
      // The boxes are the same value seen at the desk, so they follow.
      expect(element<HTMLInputElement>('focus-from').value).toBe('2');
    });

    it('writes which bars are on the page into the judging log', async () => {
      // Every fault in "which bar is this" looks the same from outside, like
      // a page that started counting at one, so the answer is written down.
      const rig = createRig();
      await rig.view.initialize();
      rig.renderer.dragPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });
      await new Promise((resolve) => setTimeout(resolve, 0));

      element<HTMLButtonElement>('save-judging').click();

      const written = rig.files.saved.at(-1);
      const text = new TextDecoder().decode(written?.bytes);
      expect(text).toContain('passage: 2..3');
      // The page still holds the whole piece, whatever the passage is.
      expect(text).toContain('page 1-4');
    });

    it('starts the next run where a finger was held', async () => {
      // Pointing at a bar, which is what a long press is for. Whole bars,
      // because a run beginning halfway through one would be counted in to a
      // beat that is not the first and the reader would be waiting for a
      // downbeat that never came.
      const rig = createRig();
      await rig.view.initialize();
      const later = rig.runtime.controller.currentTimeline?.steps.find(
        (step) => step.measureIndex === 2,
      );

      rig.renderer.holdBar(2);

      expect(rig.runtime.controller.beginsAt).toBe(later?.index);
      // And the run actually begins there rather than at the top.
      rig.runtime.controller.updateSettings({ countInBars: 0 });
      rig.runtime.controller.start();
      expect(rig.runtime.controller.session?.currentStep?.measureIndex).toBe(2);
    });

    describe('filling in the marks one hold at a time', () => {
      /**
       * The whole ladder, in the order a reader climbs it.
       *
       * Which mark a hold places is read off the page rather than counted:
       * the next one missing. Said by *where in the bar* the finger landed
       * instead - near the line against the middle - a third of the misses
       * would place the wrong mark, a bar being a couple of centimetres and
       * a fingertip being one.
       */
      it('goes place, then near end, then far end, all on the one bar', async () => {
        // Read off the bar under the finger rather than out of a count of
        // holds: what the next one does is decided by what is already
        // standing *there*, so a reader can see it by looking.
        const rig = createRig();
        await rig.view.initialize();
        const { controller } = rig.runtime;

        rig.renderer.holdBar(1);
        expect(controller.beginsAt).toBeGreaterThan(0);
        expect(controller.settings.rangeFromBar).toBeNull();

        // The place is on this bar, so this is the near end.
        rig.renderer.holdBar(1);
        expect(controller.settings.rangeFromBar).toBe(2);
        expect(controller.settings.rangeToBar).toBeNull();

        // The near end is on this bar, so this is the far end: one bar.
        rig.renderer.holdBar(1);
        expect(controller.settings.rangeToBar).toBe(2);
      });

      it('lands on the bar held even where the piece has been read twice', async () => {
        // His, measured on City of Tears. A repeat is written out, so the
        // page says "3" twice and the fifth bar played is the second of them.
        // Held as the number printed on it and turned back into a place by
        // subtracting the first bar's number, a hold landed as many bars
        // early as the piece had re-read - the thirty-eighth bar put the
        // marker on the thirty-second.
        const rig = createRig();
        await rig.view.initialize();
        await rig.runtime.controller.openScore({
          ...longExercise({ bars: 8 }),
          barLabels: [1, 2, 3, 4, 3, 4, 5, 6].map((number, at) => ({
            number,
            repeated: at === 4 || at === 5,
          })),
        });
        // The seventh bar played, which the page calls 5.
        expect(rig.runtime.controller.barNumber(6)).toBe(5);

        rig.renderer.holdBar(6);
        rig.renderer.holdBar(6);

        expect(rig.runtime.controller.settings.rangeFromBar).toBe(7);
        expect(rig.renderer.shownPassage?.fromMeasureIndex).toBe(6);
      });

      it('takes in everything up to a hold further into the passage', async () => {
        // The near end standing and a hold beyond it is the reader saying
        // where the passage ends, which is how a passage of more than one bar
        // is asked for without dragging anything.
        const rig = createRig();
        await rig.view.initialize();
        const { controller } = rig.runtime;
        rig.renderer.holdBar(0);
        rig.renderer.holdBar(0);
        expect(controller.settings.rangeFromBar).toBe(1);

        rig.renderer.holdBar(1);

        expect(controller.settings.rangeFromBar).toBe(1);
        expect(controller.settings.rangeToBar).toBe(2);
      });

      it('starts again somewhere new when the hold is outside the passage', async () => {
        // A bar outside what is being practised is a reader beginning
        // somewhere else. The passage goes rather than being stretched to
        // reach a bar they never said belonged to it.
        const rig = createRig();
        await rig.view.initialize();
        const { controller } = rig.runtime;
        rig.renderer.holdBar(1);
        rig.renderer.holdBar(1);
        rig.renderer.holdBar(1);
        expect(controller.settings.rangeFromBar).toBe(2);
        expect(controller.settings.rangeToBar).toBe(2);

        rig.renderer.holdBar(0);

        expect(controller.settings.rangeFromBar).toBeNull();
        expect(controller.settings.rangeToBar).toBeNull();
        expect(controller.currentTimeline?.at(controller.beginsAt)?.measureIndex).toBe(0);
      });

      it('does not take the near end from a bar the place is not on', async () => {
        // The place is what says where the near end may go, so a hold on some
        // other bar is a fresh start rather than a passage opening there.
        const rig = createRig();
        await rig.view.initialize();
        const { controller } = rig.runtime;
        rig.renderer.holdBar(0);
        expect(controller.settings.rangeFromBar).toBeNull();

        rig.renderer.holdBar(1);

        expect(controller.settings.rangeFromBar).toBeNull();
        expect(controller.currentTimeline?.at(controller.beginsAt)?.measureIndex).toBe(1);
      });

      it('shuts the passage onto one bar when a marker is held', async () => {
        // The fast way to say "this bar and no more", read off the marker the
        // finger is on rather than from a count.
        const rig = createRig();
        await rig.view.initialize();
        const { controller } = rig.runtime;
        rig.renderer.holdBar(1);
        rig.renderer.holdBar(1);
        rig.renderer.holdBar(3);

        rig.renderer.holdMarker('from');

        expect(controller.settings.rangeFromBar).toBe(2);
        expect(controller.settings.rangeToBar).toBe(2);
      });

      it('shuts it onto the far marker’s bar from the other end', async () => {
        const rig = createRig();
        await rig.view.initialize();
        const { controller } = rig.runtime;
        rig.renderer.holdBar(1);
        rig.renderer.holdBar(1);
        rig.renderer.holdBar(3);

        rig.renderer.holdMarker('to');

        expect(controller.settings.rangeFromBar).toBe(4);
        expect(controller.settings.rangeToBar).toBe(4);
      });

      it('changes nothing while a run is being graded', async () => {
        // What is being practised is settled before a run, not during one:
        // a passage moved halfway through makes the report a report of
        // nothing in particular.
        const rig = createRig();
        await rig.view.initialize();
        rig.renderer.holdBar(1);
        rig.renderer.holdBar(1);
        const before = rig.runtime.controller.settings.rangeFromBar;
        rig.runtime.controller.updateSettings({ countInBars: 0 });
        element<HTMLButtonElement>('focus-play').click();

        rig.renderer.holdBar(3);
        rig.renderer.holdMarker('from');

        expect(rig.runtime.controller.settings.rangeFromBar).toBe(before);
        expect(rig.runtime.controller.settings.rangeToBar).toBeNull();
      });

      it('shows the markers it has just placed', async () => {
        // Placing one and leaving it invisible would be the reader wondering
        // whether the hold registered at all.
        const rig = createRig();
        await rig.view.initialize();
        rig.renderer.tapScore();
        expect(rig.renderer.shownPassage).toBeNull();

        rig.renderer.holdBar(1);
        rig.renderer.holdBar(1);

        expect(rig.renderer.shownPassage).not.toBeNull();
      });
    });

    it('takes the place back to the top from the transport bar', async () => {
      // A place can be set anywhere by holding a finger on a bar, so the way
      // back must not be "find bar one and hold a finger on that".
      const rig = createRig();
      await rig.view.initialize();
      rig.renderer.holdBar(2);
      expect(rig.runtime.controller.beginsAt).toBeGreaterThan(0);

      element<HTMLButtonElement>('focus-rewind').click();

      expect(rig.runtime.controller.beginsAt).toBe(0);
      expect(rig.renderer.cursor.position).toBe(0);
    });

    it('marks the bar the music will start from', async () => {
      // The cursor says where the music *is*, and between runs it sits at
      // the top saying nothing useful. A reader who has moved their place
      // has to be able to see that they have, by looking at the page.
      const rig = createRig();
      await rig.view.initialize();
      expect(rig.renderer.startMeasure).toBeNull();
      rig.renderer.holdBar(2);

      expect(rig.renderer.startMeasure).toBe(2);

      // And it goes away with the markers, because a reader who has put the
      // furniture away has put all of it away.
      rig.renderer.tapScore();
      expect(rig.renderer.startMeasure).toBeNull();
    });

    it('takes the mark away when the place goes back to the top', async () => {
      // From the top is where a piece starts anyway, so a mark saying so on
      // every page would be furniture.
      const rig = createRig();
      await rig.view.initialize();
      rig.renderer.holdBar(2);
      expect(rig.renderer.startMeasure).toBe(2);

      element<HTMLButtonElement>('focus-rewind').click();

      expect(rig.renderer.startMeasure).toBeNull();
    });

    it('takes the place back to the passage, not to the top of the piece', async () => {
      // A reader who has bracketed bars 2 to 3 is working on bars 2 to 3,
      // and "the beginning" means the beginning of that. MuseScore
      // disagrees with itself here - its rewind goes to the top of the score
      // while its playback starts at the selection - and that is the
      // disagreement being avoided.
      const rig = createRig();
      await rig.view.initialize();
      rig.renderer.dragPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const passageStart = rig.runtime.controller.currentTimeline?.steps.find(
        (step) => step.measureIndex === 1,
      );

      element<HTMLButtonElement>('focus-rewind').click();

      expect(rig.renderer.cursor.position).toBe(passageStart?.index);
      expect(rig.renderer.cursor.position).toBeGreaterThan(0);
      expect(rig.runtime.controller.beginsAt).toBe(0);
    });

    it('leaves a finished run where it finished', async () => {
      // The reader has just played to the end; putting the marker somewhere
      // else answers a question they did not ask, and on a paged score it
      // takes the page out from under the last thing they played.
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.controller.updateSettings({ countInBars: 0, modeId: 'mode.flow' });
      rig.runtime.controller.start();
      rig.metronome.advanceBeats(40);
      expect(rig.runtime.controller.session?.status).toBe('completed');

      expect(rig.renderer.cursor.position).toBeGreaterThan(0);
    });

    it('stops a run before taking the place back', async () => {
      // Otherwise the marker would go to bar one while the music went on
      // playing from wherever it had got to.
      const rig = createRig();
      await rig.view.initialize();
      element<HTMLButtonElement>('focus-play').click();

      element<HTMLButtonElement>('focus-rewind').click();

      expect(rig.runtime.controller.session?.status).not.toBe('running');
      expect(rig.runtime.controller.beginsAt).toBe(0);
    });

    it('leaves the place alone while a run is going', async () => {
      const rig = createRig();
      await rig.view.initialize();
      element<HTMLButtonElement>('focus-play').click();

      rig.renderer.holdBar(2);

      expect(rig.runtime.controller.beginsAt).toBe(0);
    });

    it('puts the markers away on a touch, and brings them back', async () => {
      // Two lines across the staves, wanted while a passage is being chosen
      // and furniture in front of the notes the rest of the time.
      const { view, renderer } = createRig();
      await view.initialize();
      expect(renderer.shownPassage).not.toBeNull();

      renderer.tapScore();
      expect(renderer.shownPassage).toBeNull();

      renderer.tapScore();
      expect(renderer.shownPassage).not.toBeNull();
    });

    it('leaves them away across a new engraving', async () => {
      // Otherwise every zoom, tempo change or new exercise would put back
      // what the reader had just dismissed.
      const { view, renderer } = createRig();
      await view.initialize();
      renderer.tapScore();

      element<HTMLButtonElement>('scores-fresh').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(renderer.shownPassage).toBeNull();
    });

    it('reads the markers against the whole piece, drag after drag', async () => {
      // The music is not cut down any more, so a bar's place on the page does
      // not move when a passage is chosen: the second drag means the bars it
      // names, exactly as the first did.
      const { view, runtime, renderer } = createRig();
      await view.initialize();
      renderer.dragPassage({ fromMeasureIndex: 1, toMeasureIndex: 3 });
      await new Promise((resolve) => setTimeout(resolve, 0));

      renderer.dragPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runtime.controller.settings.rangeFromBar).toBe(2);
      expect(runtime.controller.settings.rangeToBar).toBe(3);
    });

    it('widens as readily as it narrows, because the bars are all still there', async () => {
      // The music is no longer cut down to the passage, so widening is a
      // plain drag: the bars on both sides are on the page to drag to.
      const { view, runtime, renderer } = createRig();
      await view.initialize();
      renderer.dragPassage({ fromMeasureIndex: 2, toMeasureIndex: 3 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(runtime.controller.settings.rangeFromBar).toBe(3);

      renderer.dragPassage({ fromMeasureIndex: 1, toMeasureIndex: 3 });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runtime.controller.settings.rangeFromBar).toBe(2);
      expect(runtime.controller.settings.rangeToBar).toBe(4);

      // And pulled right back out to both ends it is the whole piece again,
      // which is one state and not a range that happens to cover everything.
      renderer.dragPassage({ fromMeasureIndex: 0, toMeasureIndex: 3 });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runtime.controller.settings.rangeFromBar).toBeNull();
    });

    it('cannot be taken hold of while a run is going', async () => {
      // A run is graded, and a passage moved halfway through makes the report
      // a report of nothing in particular: some of it judged against one
      // stretch and the rest against another the reader never agreed to. The
      // markers used to move under the finger and then jump back, which said
      // the page had changed its mind.
      const { view, runtime, renderer } = createRig();
      await view.initialize();

      expect(renderer.shownPassage?.movable).toBe(true);
      expect(element<HTMLInputElement>('focus-from').disabled).toBe(false);

      element<HTMLButtonElement>('focus-play').click();

      // Still drawn - it says what is being read, which is worth seeing while
      // reading it - and no longer a handle.
      expect(renderer.shownPassage).toEqual({
        fromMeasureIndex: 0,
        toMeasureIndex: 3,
        repeating: false,
        movable: false,
      });
      expect(element<HTMLInputElement>('focus-from').disabled).toBe(true);
      expect(element<HTMLInputElement>('focus-to').disabled).toBe(true);
      expect(runtime.controller.settings.rangeFromBar).toBeNull();
    });

    it('is a handle again once the run is over', async () => {
      const { view, renderer } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      expect(renderer.shownPassage?.movable).toBe(false);

      element<HTMLButtonElement>('focus-stop').click();

      expect(renderer.shownPassage?.movable).toBe(true);
      expect(element<HTMLInputElement>('focus-from').disabled).toBe(false);
    });

    it('does not re-engrave for choosing a passage at all', async () => {
      // A passage used to cut the music down, so choosing one meant laying
      // the piece out again. Now it only says where the run begins and ends,
      // and the notes on the page are the same notes - so engraving them
      // again would blank the staves and put the reader back on page one.
      const { view, renderer } = createRig();
      await view.initialize();
      const before = renderer.loadCount;

      renderer.dragPassage({ fromMeasureIndex: 1, toMeasureIndex: 2 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      renderer.dragPassage({ fromMeasureIndex: 0, toMeasureIndex: 3 });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(renderer.loadCount).toBe(before);
    });
  });

  it('hides the score cursor from the checkbox', async () => {
    const { view, runtime, renderer } = createRig();
    await view.initialize();
    expect(renderer.cursor.visible).toBe(true);

    const toggle = element<HTMLInputElement>('cursor-rest');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));

    expect(runtime.controller.settings.cursorAtRest).toBe(false);
    expect(renderer.cursor.visible).toBe(false);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(renderer.cursor.visible).toBe(true);
  });

  describe('repeating a passage', () => {
    it('plays it round again when a playback reaches its end', async () => {
      // A repeat sign on the page means the music repeats, whoever is
      // playing it - and hearing a hard passage over and over is most of
      // what listening to one is for.
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.controller.updateSettings({ repeatRange: true });

      await pressListen(rig.runtime.controller);
      expect(rig.runtime.controller.isListening).toBe(true);

      // Past the end of the four bars the preset writes.
      rig.metronome.advanceBeats(20);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(rig.runtime.controller.isListening).toBe(true);
    });

    it('leaves a playback the reader stopped alone', async () => {
      // Pressing the button to stop is not the music reaching its end.
      const rig = createRig();
      await rig.view.initialize();
      rig.runtime.controller.updateSettings({ repeatRange: true });
      await pressListen(rig.runtime.controller);

      await pressListen(rig.runtime.controller);

      expect(rig.runtime.controller.isListening).toBe(false);
    });
  });

  describe('the arrow keys', () => {
    function pressArrow(key: 'ArrowLeft' | 'ArrowRight', target: Element = document.body): boolean {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    }

    it('turns the pages at a desk, where there is no swipe', async () => {
      const rig = createRig();
      await rig.view.initialize();
      rig.renderer.pageCount = 3;

      expect(pressArrow('ArrowRight')).toBe(true);
      expect(rig.renderer.pages.at).toBe(1);

      pressArrow('ArrowRight');
      pressArrow('ArrowLeft');
      expect(rig.renderer.pages.at).toBe(1);
    });

    it('leaves the arrows alone when there are no pages to turn', async () => {
      // A scrolling score still scrolls with them, which is what a reader
      // who never asked for pages expects them to do.
      const rig = createRig();
      await rig.view.initialize();
      const box = element<HTMLInputElement>('paged-score');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      rig.renderer.pageCount = 3;

      pressArrow('ArrowRight');

      expect(rig.renderer.isPaged).toBe(false);
      expect(rig.renderer.pages.count).toBe(0);
      expect(rig.renderer.pages.at).toBe(0);
    });

    it('leaves them to a control that has the focus', async () => {
      // An arrow belongs to a slider or a select entirely.
      const rig = createRig();
      await rig.view.initialize();
      rig.renderer.pageCount = 3;
      const tempo = element<HTMLInputElement>('tempo');
      tempo.focus();

      expect(pressArrow('ArrowRight', tempo)).toBe(false);
      expect(rig.renderer.pages.at).toBe(0);
    });
  });

  describe('the space bar', () => {
    function pressSpace(target: Element = document.body): boolean {
      const event = new KeyboardEvent('keydown', {
        code: 'Space',
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    }

    it('starts, pauses and resumes a run', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      pressSpace();
      expect(runtime.controller.session?.status).toBe('running');

      pressSpace();
      expect(runtime.controller.session?.status).toBe('paused');

      pressSpace();
      expect(runtime.controller.session?.status).toBe('running');
    });

    it('stops the page scrolling away underneath', async () => {
      const { view } = createRig();
      await view.initialize();

      // The browser's own use of space is what made this necessary.
      expect(pressSpace()).toBe(true);
    });

    it('leaves the controls alone while one of them has focus', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      const box = element<HTMLInputElement>('measures-value');
      box.focus();
      const prevented = pressSpace(box);

      expect(prevented).toBe(false);
      expect(runtime.controller.session).toBeNull();
    });

    it('leaves a button the keyboard reached to do its own job', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      // Reached by Tab, after a press somewhere else.
      const button = element<HTMLButtonElement>('focus-bare');
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true }));
      button.focus();
      expect(pressSpace(button)).toBe(false);

      // Space on a button is how a button is pressed; it must not also start.
      expect(runtime.controller.session).toBeNull();
      expect(document.activeElement).toBe(button);
    });

    it('takes the space bar from a control the pointer pressed, which keeps the focus without asking for it', async () => {
      const { view, runtime, renderer } = createRig();
      await view.initialize();
      /** Pressed by the pointer: the browser leaves the focus on it. */
      const pressedByThePointer = (control: HTMLElement): void => {
        control.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        control.focus();
      };

      // The run starts, and pauses at the next, the focus let go of each time.
      for (const [id, status] of [
        ['focus-bare', 'running'],
        ['metronome-on', 'paused'],
      ] as const) {
        const button = element<HTMLButtonElement>(id);
        pressedByThePointer(button);
        expect(pressSpace(button), id).toBe(true);
        expect(document.activeElement, id).not.toBe(button);
        expect(runtime.controller.session?.status, id).toBe(status);
      }
      // A box ticked and a list chosen from, the same.
      const ticked = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const list = document.querySelector<HTMLSelectElement>('select');
      for (const control of [ticked, list]) {
        if (control === null) {
          throw new Error('expected the control');
        }
        pressedByThePointer(control);
        expect(pressSpace(control), control.id).toBe(true);
        expect(document.activeElement, control.id).not.toBe(control);
      }
      // A field typed into never, however its focus came.
      const typed = element<HTMLInputElement>('measures-value');
      pressedByThePointer(typed);
      expect(pressSpace(typed)).toBe(false);
      expect(document.activeElement).toBe(typed);

      // Only the space bar: the arrows are left to a slider the pointer
      // dragged, which they move, and turn no page.
      renderer.pageCount = 3;
      const slider = element<HTMLInputElement>('tempo');
      pressedByThePointer(slider);
      const arrow = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
      slider.dispatchEvent(arrow);
      expect(arrow.defaultPrevented).toBe(false);
      expect(renderer.pages.at).toBe(0);
      expect(document.activeElement).toBe(slider);
    });

    function pressHeldSpace(target: Element = document.body): boolean {
      const event = new KeyboardEvent('keydown', {
        code: 'Space',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    }

    it('never starts a run when it is held down', async () => {
      // Held, it is the square button beside the round one, and the square one
      // has never started anything.
      const { view, runtime } = createRig();
      await view.initialize();

      pressHeldSpace();

      expect(runtime.controller.session).toBeNull();
    });

    it('stops a run that is going, when it is held down', async () => {
      // His: "ctrl+space шорткат для нот щоб зупиняти гру коли гра у прогресі".
      //
      // Stopping and rewinding both end a run, so the place is what tells them
      // apart: a reader who set one and played from it is stopping, not asking
      // to be sent back to bar one.
      const rig = createRig();
      await rig.view.initialize();
      rig.renderer.holdBar(2);
      const from = rig.runtime.controller.beginsAt;
      expect(from).toBeGreaterThan(0);
      pressSpace();
      expect(rig.runtime.controller.session?.status).toBe('running');

      expect(pressHeldSpace()).toBe(true);

      expect(element<HTMLButtonElement>('focus-stop').disabled).toBe(true);
      expect(element('score-verdict').hidden).toBe(false);
      expect(rig.runtime.controller.beginsAt).toBe(from);
    });

    it('takes the place back to the top when there is nothing to stop', async () => {
      // One key for "put me back": the two are never both on offer, so a reader
      // reaching for the keyboard mid-run does not have to pick. His: "та
      // rewind коли гра не у прогресі".
      const rig = createRig();
      await rig.view.initialize();
      rig.renderer.holdBar(2);
      expect(rig.runtime.controller.beginsAt).toBeGreaterThan(0);

      pressHeldSpace();

      expect(rig.runtime.controller.beginsAt).toBe(0);
      expect(rig.renderer.cursor.position).toBe(0);
    });

    it('leaves a held alt to whatever the browser does with it', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      const event = new KeyboardEvent('keydown', {
        code: 'Space',
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);

      expect(runtime.controller.session).toBeNull();
      expect(event.defaultPrevented).toBe(false);
    });

    it('stops the picture of a run rather than holding it', async () => {
      // The same pair over the drawing: the plain key plays and holds, the held
      // one is that sheet's own Stop. His: "у MIDI viewer це має бути stop
      // кнопка".
      const { view, runtime, midi, clock } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();
      pressSpace();
      clock.advance(300);
      expect(runtime.takePlayer.positionMs).toBeGreaterThan(0);

      pressHeldSpace();

      expect(runtime.takePlayer.playing).toBeNull();
      // Back at the beginning, which is the whole difference from holding it:
      // Stop has nothing left to do and says so.
      expect(element<HTMLButtonElement>('roll-stop').dataset['idle']).toBe('true');

      // With the marker put further on, as the square button does: back to the
      // marker first, and pressed again, to the beginning with the marker.
      const drawn = element('roll-body');
      // Exactly where tapped, rather than on the nearest beat of so short a run.
      element<HTMLInputElement>('roll-snap').checked = false;
      tapTheDrawing({ pointerType: 'mouse', button: 0, clientX: 0.2 * Number(element<HTMLInputElement>('roll-zoom').value), clientY: 5 });
      const marker = headAt(drawn);
      expect(Number(marker)).toBeGreaterThan(0);
      pressSpace();
      clock.advance(300);
      pressHeldSpace();
      expect(runtime.takePlayer.playing).toBeNull();
      expect(headAt(drawn)).toBe(marker);
      expect(element<HTMLButtonElement>('roll-stop').dataset['idle']).toBeUndefined();
      pressHeldSpace();
      expect(headAt(drawn)).toBe('0.000');
      expect(element<HTMLButtonElement>('roll-stop').dataset['idle']).toBe('true');
    });

    it('agrees with the pill about what play means', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      element<HTMLButtonElement>('focus-play').click();
      expect(runtime.controller.session?.status).toBe('running');

      pressSpace();
      expect(runtime.controller.session?.status).toBe('paused');
      expect(element('focus-play').getAttribute('aria-label')).toBe('Resume');
    });

    it('lets go when the view does', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      view.dispose();
      pressSpace();

      expect(runtime.controller.session).toBeNull();
    });
  });

  describe('the settings sheet', () => {
    it('is shut until it is asked for, from either place', async () => {
      const { view } = createRig();
      await view.initialize();
      const sheet = element('sheet-settings');
      expect(sheet.hidden).toBe(true);

      element<HTMLButtonElement>('focus-settings').click();
      expect(sheet.hidden).toBe(false);

      element<HTMLButtonElement>('settings-close').click();
      expect(sheet.hidden).toBe(true);

      // And from the drawer, which is where the reader actually is.
      element<HTMLButtonElement>('focus-settings').click();
      expect(sheet.hidden).toBe(false);
    });

    it('opens onto what the settings actually are', async () => {
      // A run can have moved them: the ladder does, and so does opening a
      // score. A sheet showing the values it was built with would be lying.
      const { view, runtime } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ measures: 7 });

      element<HTMLButtonElement>('focus-settings').click();

      expect(element<HTMLInputElement>('measures-value').value).toBe('7');
    });

    it('shuts on a tap outside it', async () => {
      const { view } = createRig();
      await view.initialize();
      const sheet = element('sheet-settings');
      element<HTMLButtonElement>('focus-settings').click();

      tapOutside(sheet);

      expect(sheet.hidden).toBe(true);
    });
  });

  describe('layout and score settings', () => {
    it('sets the bar count by typing as well as by dragging', async () => {
      const { view, runtime, renderer } = createRig();
      await view.initialize();
      const loadsBefore = renderer.loadCount;

      const box = element<HTMLInputElement>('measures-value');
      box.value = '24';
      box.dispatchEvent(new Event('change'));
      await Promise.resolve();
      await Promise.resolve();

      expect(runtime.controller.settings.measures).toBe(24);
      expect(element<HTMLInputElement>('measures').value).toBe('24');
      expect(renderer.loadCount).toBe(loadsBefore + 1);
    });

    it('keeps the slider and the box in step', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      const slider = element<HTMLInputElement>('measures');
      slider.value = '12';
      slider.dispatchEvent(new Event('input'));
      expect(element<HTMLInputElement>('measures-value').value).toBe('12');

      slider.dispatchEvent(new Event('change'));
      expect(runtime.controller.settings.measures).toBe(12);
    });

    it('refuses a typed value the generator could not use', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      const box = element<HTMLInputElement>('measures-value');

      box.value = '900';
      box.dispatchEvent(new Event('change'));
      expect(runtime.controller.settings.measures).toBe(32);
      expect(box.value).toBe('32');

      box.value = '0';
      box.dispatchEvent(new Event('change'));
      expect(runtime.controller.settings.measures).toBe(1);

      box.value = '';
      box.dispatchEvent(new Event('change'));
      // Nonsense leaves the setting where it was, and the box is put back.
      expect(runtime.controller.settings.measures).toBe(1);
      expect(box.value).toBe('1');
    });

    it('gives the engraver a container of its own', () => {
      // A page is laid out as wide as the container's clientWidth, which
      // counts its padding. Drawing into the framed element would make the
      // page wider than the space it has, and put a horizontal scrollbar
      // under it.
      const surface = document.getElementById('score-surface');
      expect(surface).not.toBeNull();
      expect(surface?.id).not.toBe('score');
      expect(surface?.children).toHaveLength(0);
      // Inside the box that scrolls, which is inside the framed one. The
      // cover sits over the frame instead, so it cannot drift with the
      // scroll or miss the border at the corners.
      expect(surface?.parentElement?.id).toBe('score-scroll');
      expect(surface?.parentElement?.parentElement?.id).toBe('score');
      expect(document.getElementById('score-cover')?.parentElement?.id).toBe('score');
    });

    it('resizes the notes on release, not on every drag step', async () => {
      const { view, runtime, renderer } = createRig();
      await view.initialize();

      const zoom = element<HTMLInputElement>('zoom');
      zoom.value = '150';
      zoom.dispatchEvent(new Event('input'));

      expect(element<HTMLOutputElement>('zoom-value').value).toBe('150');
      expect(renderer.zoom).toBe(0.85);

      zoom.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.zoom).toBe(1.5);
      expect(renderer.zoom).toBe(1.5);
    });

    it('keeps the screen up while there is a run, and lets it go after', async () => {
      // His: a tablet on a music stand is looked at and not touched. A piece
      // played through sends every note as MIDI and nothing at all to the
      // screen, so the device decides nobody is there and turns the page off
      // mid-bar. A pause counts - a reader who has stopped to work something
      // out is still at the keyboard.
      const { view, runtime, screenWake } = createRig();
      await view.initialize();
      expect(screenWake.held).toBe(false);

      element<HTMLButtonElement>('focus-play').click();
      expect(screenWake.held).toBe(true);

      element<HTMLButtonElement>('focus-play').click();
      expect(runtime.controller.session?.status).toBe('paused');
      expect(screenWake.held).toBe(true);

      element<HTMLButtonElement>('focus-stop').click();

      expect(screenWake.held).toBe(false);
    });

    it('says in the corner when it is listening for the first notes', async () => {
      // His: a run can begin by playing, and until it does there is nothing on
      // the page to say so - a reader who has just opened the app cannot tell
      // whether it is waiting for them or ignoring them. A state, not an
      // instruction, so it goes the moment it stops being true.
      const { view, runtime, audioWaking } = createRig();
      await view.initialize();
      expect(element('score-listening').hidden).toBe(true);

      runtime.controller.updateSettings({ immediateStart: true });

      expect(element('score-listening').hidden).toBe(false);
      // And what it says depends on whether the device can answer at once.
      expect(element('score-listening-text').textContent).toBe('Play to start');

      // Asleep, it asks for the one thing only a person can give - and it is
      // itself the thing to press, because a browser will start audio inside a
      // gesture it believes in and the page cannot manufacture one.
      //
      // Asked only where a run begun now would wait on the device. A frame
      // that keeps time waits for the pulse's first tick and a sleeping device
      // never gives one; that is flow, and the bar line with it.
      audioWaking.asleep();
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID });
      expect(element('score-listening-text').textContent).toBe('Tap once, then play');

      // And not where nothing would wait on it: the cursor waiting for the
      // reader, with no count in front of it and no click. Asking that reader
      // to tap the screen is asking for nothing.
      runtime.controller.updateSettings({
        modeId: new WaitMode().id,
        countInBars: 0,
        clickOn: false,
      });
      expect(element('score-listening-text').textContent).toBe('Play to start');
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID });

      element<HTMLButtonElement>('score-listening').click();

      // Woken, and saying so without anything else on the page changing.
      expect(element('score-listening-text').textContent).toBe('Play to start');

      element<HTMLButtonElement>('focus-play').click();

      // Nothing to listen for while a run is going.
      expect(element('score-listening').hidden).toBe(true);

      element<HTMLButtonElement>('focus-stop').click();

      expect(element('score-listening').hidden).toBe(false);
    });

    it('says in the corner that playing starts nothing where Listen is chosen', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ immediateStart: true });
      expect(element('score-listening').dataset['refused']).toBeUndefined();

      runtime.controller.updateSettings({ modeId: LISTEN_MODE_ID });

      const pill = element('score-listening');
      expect(pill.hidden).toBe(false);
      expect(pill.dataset['refused']).toBe('true');
      expect(element('score-listening-text').textContent).toBe('Listening');
      expect(pill.title).toContain('playing starts nothing');

      // Gone while the machine plays, as the listening goes during a run.
      element<HTMLButtonElement>('focus-play').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(runtime.controller.isListening).toBe(true);
      expect(pill.hidden).toBe(true);
      element<HTMLButtonElement>('focus-stop').click();
      expect(pill.hidden).toBe(false);

      // Back in a frame a run is played in, it is listening again.
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID });
      expect(pill.dataset['refused']).toBeUndefined();
      expect(pill.hasAttribute('title')).toBe(false);
      expect(element('score-listening-text').textContent).not.toBe('Listening');

      // And nothing at all said of it where the reader did not ask to start by playing.
      runtime.controller.updateSettings({ modeId: LISTEN_MODE_ID, immediateStart: false });
      expect(pill.hidden).toBe(true);
    });

    it('asks for the keyboard before it asks for the music', async () => {
      // The music is the slow half - a database, then an engraving - and the
      // keyboard waits on neither. Asked for afterwards, the instrument was
      // deaf for as long as the page took to draw, which is exactly when a
      // reader with their hands already on the keys plays the first chord.
      const order: string[] = [];
      const rig = createRig();
      const realConnect = rig.runtime.webMidi.connect.bind(rig.runtime.webMidi);
      rig.runtime.webMidi.connect = async () => {
        order.push('keyboard');
        return realConnect();
      };
      rig.runtime.controller.events.on('exerciseLoaded', () => order.push('music'));

      await rig.view.initialize();

      expect(order[0]).toBe('keyboard');
      expect(order).toContain('music');
    });

    it('waits for the opening chord on a page that has only just opened', async () => {
      // His: "старт гри по нотам працює, але не при старті сторінки якось".
      // The watch is armed wherever the answer to "is there music on the page
      // with nothing happening to it" can change - and the first time it can
      // change is the page opening with music already on it.
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();
      const box = element<HTMLInputElement>('immediate-start');
      box.checked = true;
      box.dispatchEvent(new Event('change'));

      mountRealMarkup();
      const second = createRig(undefined, store);
      await second.view.initialize();
      expect(second.runtime.controller.settings.immediateStart).toBe(true);
      expect(second.runtime.controller.session).toBeNull();

      const opening = second.runtime.controller.currentTimeline?.at(0)?.expectedMidi ?? [];
      expect(opening.length).toBeGreaterThan(0);
      for (const note of opening) {
        second.midi.noteOn(note, second.clock.now());
      }

      expect(second.runtime.controller.session).not.toBeNull();
    });

    it('remembers the input switches, which used to reset every reload', async () => {
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();
      expect(first.runtime.computerKeyboard.isEnabled).toBe(true);

      const keyboard = element<HTMLInputElement>('computer-keyboard');
      keyboard.checked = false;
      keyboard.dispatchEvent(new Event('change'));
      const monitor = element<HTMLInputElement>('audio-feedback');
      monitor.checked = false;
      monitor.dispatchEvent(new Event('change'));

      mountRealMarkup();
      const second = createRig(undefined, store);
      await second.view.initialize();

      // Both were view state and nothing else, so every reload turned the
      // computer keyboard back on underneath the reader.
      expect(element<HTMLInputElement>('computer-keyboard').checked).toBe(false);
      expect(element<HTMLInputElement>('audio-feedback').checked).toBe(false);
      expect(second.runtime.computerKeyboard.isEnabled).toBe(false);
    });

    it('chooses when the played notes appear', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      const select = element<HTMLSelectElement>('show-played');
      select.value = 'hidden';
      select.dispatchEvent(new Event('change'));
      expect(runtime.controller.settings.playedNotes).toBe('hidden');

      select.value = 'at-end';
      select.dispatchEvent(new Event('change'));
      expect(runtime.controller.settings.playedNotes).toBe('at-end');
      expect(element('show-played-description').textContent).toContain('when you stop');
    });

    it('sets where the notes disappear, and remembers it', async () => {
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();
      expect(first.runtime.controller.settings.readAheadSteps).toBeNull();

      const select = element<HTMLSelectElement>('read-ahead');
      select.value = '1';
      select.dispatchEvent(new Event('change'));
      expect(first.runtime.controller.settings.readAheadSteps).toBe(1);
      expect(element('read-ahead-description').textContent).toContain('under your fingers');

      mountRealMarkup();
      const second = createRig(undefined, store);
      await second.view.initialize();

      expect(element<HTMLSelectElement>('read-ahead').value).toBe('1');
      expect(second.runtime.controller.settings.readAheadSteps).toBe(1);
    });

    it('keeps "never" apart from "once I have played them"', async () => {
      // Both are the quiet end of one scale, and 0 is not off.
      const { view, runtime } = createRig();
      await view.initialize();

      const select = element<HTMLSelectElement>('read-ahead');
      select.value = '0';
      select.dispatchEvent(new Event('change'));
      expect(runtime.controller.settings.readAheadSteps).toBe(0);

      select.value = 'off';
      select.dispatchEvent(new Event('change'));
      expect(runtime.controller.settings.readAheadSteps).toBeNull();
    });

    it('remembers the note size on this device', async () => {
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();
      const zoom = element<HTMLInputElement>('zoom');
      zoom.value = '120';
      zoom.dispatchEvent(new Event('change'));
      await Promise.resolve();

      mountRealMarkup();
      const second = createRig(undefined, store);
      await second.view.initialize();

      expect(second.runtime.controller.settings.zoom).toBe(1.2);
      expect(element<HTMLInputElement>('zoom').value).toBe('120');
    });
  });

  describe('volume and remembered settings', () => {
    it('sends both sliders to their sound sources', async () => {
      const rig = createRig();
      await rig.view.initialize();

      const metronome = element<HTMLInputElement>('metronome-volume');
      metronome.value = '30';
      metronome.dispatchEvent(new Event('input'));

      const instrument = element<HTMLInputElement>('instrument-volume');
      instrument.value = '0';
      instrument.dispatchEvent(new Event('input'));

      expect(rig.metronomeVolume.volume).toBeCloseTo(0.3, 10);
      expect(rig.instrumentVolume.volume).toBe(0);
      expect(element<HTMLOutputElement>('metronome-volume-value').value).toBe('30');
      expect(element<HTMLOutputElement>('instrument-volume-value').value).toBe('0');
    });

    it('keeps both metronome sliders on one loudness, whichever is moved', async () => {
      // One in the metronome's sheet and one beside the notes' in Sound.
      const rig = createRig();
      await rig.view.initialize();
      const inTheSheet = element<HTMLInputElement>('metronome-volume');
      const inSound = element<HTMLInputElement>('sound-metronome-volume');
      expect(inSound.closest('[data-pane~="sound"]')).not.toBeNull();
      expect(element('instrument-volume').closest('[data-pane~="sound"]')).not.toBeNull();

      inSound.value = '35';
      inSound.dispatchEvent(new Event('input'));

      expect(rig.metronomeVolume.volume).toBeCloseTo(0.35, 10);
      expect(rig.settings.currentAudio.metronomeVolume).toBeCloseTo(0.35, 10);
      expect(inTheSheet.value).toBe('35');
      expect(element<HTMLOutputElement>('metronome-volume-value').value).toBe('35');

      inTheSheet.value = '80';
      inTheSheet.dispatchEvent(new Event('input'));

      expect(rig.metronomeVolume.volume).toBeCloseTo(0.8, 10);
      expect(inSound.value).toBe('80');
      expect(element<HTMLOutputElement>('sound-metronome-volume-value').value).toBe('80');
    });

    it('draws the metronome slider in Sound from what was saved', async () => {
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();
      const slider = element<HTMLInputElement>('metronome-volume');
      slider.value = '15';
      slider.dispatchEvent(new Event('input'));

      mountRealMarkup();
      const second = createRig(undefined, store);
      await second.view.initialize();

      expect(element<HTMLInputElement>('sound-metronome-volume').value).toBe('15');
      expect(element<HTMLOutputElement>('sound-metronome-volume-value').value).toBe('15');
    });

    it('brings the sliders back where they were left', async () => {
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();
      const slider = element<HTMLInputElement>('metronome-volume');
      slider.value = '15';
      slider.dispatchEvent(new Event('input'));

      mountRealMarkup();
      const second = createRig(undefined, store);
      await second.view.initialize();

      expect(element<HTMLInputElement>('metronome-volume').value).toBe('15');
      expect(second.metronomeVolume.volume).toBeCloseTo(0.15, 10);
    });

    it('brings the practice settings back too', async () => {
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();

      const tempo = element<HTMLInputElement>('tempo');
      tempo.value = '128';
      tempo.dispatchEvent(new Event('change'));
      const cursor = element<HTMLInputElement>('cursor-rest');
      cursor.checked = false;
      cursor.dispatchEvent(new Event('change'));
      await Promise.resolve();

      mountRealMarkup();
      const second = createRig(undefined, store);
      await second.view.initialize();

      expect(second.runtime.controller.tempoBpm).toBe(128);
      expect(second.runtime.controller.settings.cursorAtRest).toBe(false);
      expect(element<HTMLInputElement>('tempo').value).toBe('128');
      expect(element<HTMLInputElement>('cursor-rest').checked).toBe(false);
    });

    it('chooses when the piano samples are fetched, and remembers it', async () => {
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();
      expect(first.samples.loading).toBe('lazy');

      const select = element<HTMLSelectElement>('sample-loading');
      select.value = 'off';
      select.dispatchEvent(new Event('change'));

      expect(first.samples.loading).toBe('off');
      expect(element('sample-loading-hint').textContent).toContain('no download');

      mountRealMarkup();
      const second = createRig(undefined, store);
      await second.view.initialize();

      expect(element<HTMLSelectElement>('sample-loading').value).toBe('off');
      expect(second.samples.loading).toBe('off');
    });

    it('keeps the volumes when the sample mode changes', async () => {
      const rig = createRig();
      await rig.view.initialize();
      const slider = element<HTMLInputElement>('metronome-volume');
      slider.value = '20';
      slider.dispatchEvent(new Event('input'));

      const select = element<HTMLSelectElement>('sample-loading');
      select.value = 'eager';
      select.dispatchEvent(new Event('change'));

      expect(rig.settings.currentAudio.metronomeVolume).toBeCloseTo(0.2, 10);
      expect(rig.settings.currentAudio.sampleLoading).toBe('eager');
    });

    it('starts from the defaults when the device has nothing stored', async () => {
      const rig = createRig();
      await rig.view.initialize();

      expect(element<HTMLInputElement>('metronome-volume').value).toBe('60');
      expect(rig.metronomeVolume.volume).toBeCloseTo(0.6, 10);
    });
  });

  it('holds the pedal indicator still, whatever the pedal does', async () => {
    const rig = createRig();
    await rig.view.initialize();
    const pill = element('pedal-status');
    // Present from the first paint, so the header's wrap is decided once. It
    // used to be revealed on the first press, which widened the cluster and
    // dropped it below the title in the middle of playing.
    expect(pill.hidden).toBe(false);
    const shape = (): string => `${pill.textContent}|${pill.className}|${pill.hidden}`;
    const before = shape();

    rig.midi.pedal(true);
    // While it is *held*, not merely after: a class swapped down and back
    // would look unchanged from the far side of the press.
    const held = shape();
    rig.midi.pedal(false);

    expect(held).toBe(before);
    expect(shape()).toBe(before);
  });

  it('shows the pedal even with the monitor turned off', async () => {
    // Reported from the page: the light never came on. It was being lit
    // inside the handler that sounds his notes, *after* the check for whether
    // to sound them - and a reader whose keyboard has its own sound turns
    // that off, which is the whole point of the setting. That the pedal was
    // heard is not part of hearing the notes.
    const rig = createRig();
    await rig.view.initialize();
    const monitor = element<HTMLInputElement>('audio-feedback');
    monitor.checked = false;
    monitor.dispatchEvent(new Event('change'));

    rig.midi.pedal(true);

    expect(element('pedal-status').dataset['down']).toBe('true');
    // The dampers of the instrument *we* sound are a different question, and
    // they rightly follow the monitor.
    expect(rig.sustain.sustained).toBe(false);
  });

  it('sends the sustain pedal to the instrument and shows it', async () => {
    const rig = createRig();
    await rig.view.initialize();

    rig.midi.pedal(true);

    expect(rig.sustain.sustained).toBe(true);
    expect(element('pedal-status').dataset['down']).toBe('true');
    expect(element('pedal-status').getAttribute('aria-label')).toContain('down');
    const held = element('pedal-status').textContent;

    rig.midi.pedal(false);

    expect(rig.sustain.sustained).toBe(false);
    expect(element('pedal-status').dataset['down']).toBe('false');
    // The label is the same either way. It used to gain a word while the
    // pedal was held, and the header wraps: every press dropped the row
    // beneath it, several times a minute.
    expect(element('pedal-status').textContent).toBe(held);
  });

  it('reports the MIDI connection state', async () => {
    const { view, midi } = createRig();
    await view.initialize();
    await midi.connect();

    expect(element('midi-status').textContent).toBe('MIDI: connected');
    expect(element<HTMLSelectElement>('midi-input').options.length).toBeGreaterThan(1);
  });

  it('explains a browser that has no Web MIDI at all', async () => {
    const { view } = createRig(new WebMidiAdapter(null, new ManualClock()));
    await view.initialize();
    await Promise.resolve();

    expect(element('midi-status').textContent).toBe('MIDI: unsupported browser');
    const hint = element('midi-hint');
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain('Web MIDI Browser');
  });

  it('keeps the hint out of the way when MIDI works', async () => {
    const { view, midi } = createRig();
    await view.initialize();
    await midi.connect();

    expect(element('midi-hint').hidden).toBe(true);
  });

  describe('fullscreen', () => {
    it('is the page, rather than somewhere the reader goes', async () => {
      // It used to be a mode with a desk layout of toolbars and a side panel
      // underneath it. Two layouts meant every control had two homes and the
      // reader was only ever in one of them, so the desk is gone.
      const { view } = createRig();
      await view.initialize();

      expect(element('focus-bar').hidden).toBe(false);
      expect(document.querySelector('.toolbar')).toBeNull();
      expect(document.querySelector('.panel')).toBeNull();
      expect(document.querySelector('.app-header')).toBeNull();
    });

    it('starts and pauses the run from the pill', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      element<HTMLButtonElement>('focus-play').click();
      expect(runtime.controller.session?.status).toBe('running');
      expect(element('focus-play').getAttribute('aria-label')).toBe('Pause');
      expect(element<HTMLButtonElement>('focus-stop').disabled).toBe(false);

      element<HTMLButtonElement>('focus-play').click();
      expect(runtime.controller.session?.status).toBe('paused');
      expect(element('focus-play').getAttribute('aria-label')).toBe('Resume');

      element<HTMLButtonElement>('focus-play').click();
      expect(runtime.controller.session?.status).toBe('running');

      element<HTMLButtonElement>('focus-stop').click();
      expect(runtime.controller.session?.status).toBe('aborted');
    });

    /** Through the settings control, so the view hears about it as it would. */
    function setClickWhen(value: string): void {
      const select = element<HTMLSelectElement>('dropout');
      select.value = value;
      select.dispatchEvent(new Event('change'));
    }

    it('turns the passage round again from the drawer', async () => {
      // A passage learned by heart is learned by playing it over, and
      // reaching for Start between each time is the one part of that which
      // is not practice.
      const { view, runtime } = createRig();
      await view.initialize();

      const repeat = element<HTMLButtonElement>('focus-repeat');
      expect(repeat.getAttribute('aria-pressed')).toBe('false');

      repeat.click();

      expect(runtime.controller.settings.repeatRange).toBe(true);
      expect(repeat.getAttribute('aria-pressed')).toBe('true');
    });

    it('starts the passage again when it ends, without being asked', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-repeat').click();

      const first = runtime.controller.start();
      first?.abort();
      // Aborting is not finishing; only a run that reached the end comes back.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(runtime.controller.session).toBe(first);
    });

    it('keeps saying a performance is playing when it comes round again', async () => {
      // The complaint this answers: on repeat, Stop went grey and the button
      // went back to offering Listen over a performance that was playing. A
      // repeat starts the next round from inside the last one's `finished`,
      // which the button that starts most of them knows nothing about.
      const { view, runtime, metronome } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-repeat').click();
      await pressListen(runtime.controller);
      expect(runtime.controller.isListening).toBe(true);

      // Round it goes: past the end of the piece and into the next reading.
      metronome.advanceSubdivisions(40);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runtime.controller.isListening).toBe(true);
      expect(element('focus-play').getAttribute('aria-label')).toBe('Pause');
      expect(element<HTMLButtonElement>('focus-stop').disabled).toBe(false);
    });

    it('raises the kept lists without leaving the stand', async () => {
      // Leaving fullscreen to look at a list and coming back is a re-engraving
      // each way, which on a long piece is most of a second twice over.
      const { view } = createRig();
      await view.initialize();
      expect(element('sheet-takes').hidden).toBe(true);

      element<HTMLButtonElement>('focus-takes').click();
      expect(element('sheet-takes').hidden).toBe(false);

      element<HTMLButtonElement>('takes-close').click();
      expect(element('sheet-takes').hidden).toBe(true);

      element<HTMLButtonElement>('focus-scores').click();
      expect(element('sheet-scores').hidden).toBe(false);
      // The dimmed area outside the panel is the way out a thumb finds
      // without aiming.
      tapOutside(element('sheet-scores'));
      expect(element('sheet-scores').hidden).toBe(true);
    });

    it('keeps a take from the bar, and hides its clock when asked', async () => {
      const rig = createRig();
      await rig.view.initialize();
      rig.midi.noteOn(60, rig.clock.now());
      rig.clock.advance(200);
      rig.midi.noteOff(60, rig.clock.now());

      const keep = element<HTMLButtonElement>('focus-keep');
      expect(keep.disabled).toBe(false);
      expect(element('focus-keep-text').textContent).toBe('0:00');

      keep.click();
      expect(rig.takes.list()).toHaveLength(1);

      // A clock ticking in the corner is a thing to watch instead of the music.
      const eye = element<HTMLButtonElement>('focus-record-eye');
      expect(element('focus-record').dataset['open']).toBe('false');
      eye.click();
      expect(element('focus-record').dataset['open']).toBe('true');
      expect(eye.getAttribute('aria-expanded')).toBe('true');
    });

    /** Opens everything about the click, as its button does. */
    function openTheMetronome(): void {
      element<HTMLButtonElement>('focus-metronome').click();
    }

    it('puts everything about the click behind one button', async () => {
      // It was in three places: two cycle buttons under the drawer handle and
      // two sliders down the settings sheet, so "quieter, and give me two
      // bars of count-in" meant both of them and a scroll.
      const { view } = createRig();
      await view.initialize();
      expect(element('sheet-metronome').hidden).toBe(true);

      openTheMetronome();

      expect(element('sheet-metronome').hidden).toBe(false);
      for (const id of ['dropout', 'click', 'count-in', 'metronome-volume']) {
        expect(element(id).closest('#sheet-metronome')).not.toBeNull();
      }
      // And none of them is left in the settings sheet to disagree with.
      for (const id of ['dropout', 'click', 'count-in', 'metronome-volume']) {
        expect(element(id).closest('#sheet-settings')).toBeNull();
      }
    });

    it('opens the same sheet from the desk', async () => {
      // One sheet raised from two places, the way the lists are: in
      // fullscreen the desk panel is not on the page at all.
      const { view } = createRig();
      await view.initialize();

      openTheMetronome();
      expect(element('sheet-metronome').hidden).toBe(false);

      element<HTMLButtonElement>('metronome-close').click();
      expect(element('sheet-metronome').hidden).toBe(true);
    });

    it('says what the metronome is set to without being opened', async () => {
      // A reader glancing at the row wants to know whether the click is on at
      // all, and that answer is one short line rather than a sheet.
      const { view, runtime } = createRig();
      await view.initialize();
      // On, as the app starts it; the rig keeps the click off.
      runtime.controller.updateSettings({ clickOn: true });
      setClickWhen('always');
      const button = element<HTMLButtonElement>('focus-metronome');

      expect(button.dataset['click']).toBe('on');
      expect(button.title).toContain('all the way through');

      openTheMetronome();
      element<HTMLButtonElement>('metronome-on').click();
      expect(button.dataset['click']).toBe('off');
      expect(button.title).toContain('off');
      element<HTMLButtonElement>('metronome-on').click();

      // Lit whenever the click is on, however much of the run it sounds for:
      // when is said in words.
      setClickWhen('count-in-only');
      expect(button.dataset['click']).toBe('on');
      expect(button.title).toContain('count-in');
      setClickWhen('cycle-2');
      expect(button.dataset['click']).toBe('on');
    });

    it('turns the click off and on with the switch at the top of its sheet, keeping when it was to sound', async () => {
      // A tap that turned it off, with a hold for the rest, could not be
      // guessed: nothing on a button says it can be held. The button opens the
      // sheet, and the switch at the head of it says what it does by being one.
      const { view, runtime } = createRig();
      await view.initialize();
      // On, as the app starts it; the rig keeps the click off.
      runtime.controller.updateSettings({ clickOn: true });
      setClickWhen('count-in-only');
      const on = element<HTMLButtonElement>('metronome-on');

      openTheMetronome();

      expect(element('sheet-metronome').hidden).toBe(false);
      expect(runtime.controller.settings.clickOn).toBe(true);
      expect(on.getAttribute('aria-checked')).toBe('true');
      // At the top, over everything about how it sounds.
      expect(on.closest('.controls')?.firstElementChild?.contains(on)).toBe(true);

      on.click();

      expect(runtime.controller.settings.clickOn).toBe(false);
      expect(on.getAttribute('aria-checked')).toBe('false');

      on.click();

      expect(runtime.controller.settings.clickOn).toBe(true);
      expect(on.getAttribute('aria-checked')).toBe('true');
      expect(runtime.controller.settings.clickWhen).toBe('count-in-only');
    });

    /** Holds a finger on the metronome's button long enough to be a hold, and lets go. */
    function holdTheMetronome(): void {
      const button = element<HTMLButtonElement>('focus-metronome');
      vi.useFakeTimers();
      try {
        button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        vi.advanceTimersByTime(HOLD_MS);
        // The finger lets go, and the click that makes is the hold's.
        button.dispatchEvent(new Event('pointerup', { bubbles: true }));
        button.click();
      } finally {
        vi.useRealTimers();
      }
    }

    it('writes a take played to the click down in its bars, and one played without in common time at 120', async () => {
      const { view, runtime, metronome, clock, midi, takes, files, sketches } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      frameButton('free').click();
      element<HTMLButtonElement>('free-beats-fewer').click();
      holdTheMetronome();
      // Bars of three at the click's 100 bpm, a note struck on each beat.
      for (const pitch of [60, 62, 64, 65]) {
        metronome.advanceBeats(1);
        midi.noteOn(pitch, clock.now());
        clock.advance(300);
        midi.noteOff(pitch, clock.now());
      }
      holdTheMetronome();
      expect(metronome.isRunning).toBe(false);
      element<HTMLButtonElement>('focus-keep').click();
      // Looked at, it is drawn in the same bars, counted from its first.
      rowButton('takes-list', 'Look at this take').click();
      expect(view.rollScene?.bars).toEqual([
        { atMs: 0, name: '1' },
        { atMs: 1_800, name: '2' },
      ]);
      element<HTMLButtonElement>('focus-takes').click();
      expect(element('sheet-takes').hidden).toBe(false);

      const write = 'Write this take down as a score, in the bars of the click it was played to';
      rowButton('takes-list', write).click();
      await waitFor(() => runtime.controller.openedExercise?.title.startsWith('Take ') === true);

      const exercise = runtime.controller.openedExercise;
      expect(exercise?.timeSignature.toString()).toBe('3/4');
      const steps = exercise === null ? [] : buildTimeline(exercise).steps.filter((step) => step.expectedMidi.length > 0);
      expect(steps.map((step) => step.expectedMidi)).toEqual([[60], [62], [64], [65]]);
      expect(steps.map((step) => step.onsetTicks)).toEqual([0, 1, 2, 3].map((at) => at * Duration.QUARTER.ticks));
      // Not among the scores, the take being what is kept; the takes out of its way.
      expect(runtime.scores.list().map((score) => score.title)).not.toContain(exercise?.title);
      expect(element('sheet-takes').hidden).toBe(true);
      // The pencil beside the pills begins a sketch of it, opened to be
      // edited, in the bars of the page.
      const pencil = element<HTMLButtonElement>('focus-sketch');
      expect(pencil.hidden).toBe(false);
      expect(pencil.title).toBe('Begin a sketch of this recording to edit; the recording stays as it was played');
      expect(pencil.getAttribute('aria-label')).toBe(pencil.title);
      pencil.click();
      expect(sketches.list()).toHaveLength(1);
      expect(element('sheet-roll').hidden).toBe(false);
      expect(element('roll-edit').getAttribute('aria-pressed')).toBe('true');
      expect(view.rollScene?.bars.slice(0, 2)).toEqual([
        { atMs: 0, name: '1' },
        { atMs: 1_800, name: '2' },
      ]);
      // From then on the page is the sketch's: the pencil edits it, and the
      // page unchanged is not written again.
      element<HTMLButtonElement>('roll-close').click();
      expect(pencil.hidden).toBe(false);
      expect(pencil.title).toBe('Edit this sketch');
      expect(pencil.getAttribute('aria-label')).toBe(pencil.title);
      expect(runtime.controller.openedExercise).toBe(exercise);
      pencil.click();
      expect(sketches.list()).toHaveLength(1);
      element<HTMLButtonElement>('roll-close').click();
      // And saved as a file, in the same bars at the click's tempo.
      rowButton('takes-list', 'Save this take as a MIDI file').click();
      const saved = readMidiFile(files.saved[0]?.bytes ?? new Uint8Array());
      expect([saved.beats, saved.tempoBpm]).toEqual([3, 100]);
      expect(saved.notes.map((note) => note.startTicks)).toEqual([0, 1, 2, 3].map((at) => at * saved.division));

      // Played with the click stopped: written in common time at 120 from its
      // first note, the bars a sketch of it begins in, and saved so.
      clock.advance(10_000);
      for (const pitch of [67, 69]) {
        midi.noteOn(pitch, clock.now());
        clock.advance(500);
        midi.noteOff(pitch, clock.now());
      }
      element<HTMLButtonElement>('focus-keep').click();
      expect(takes.list()).toHaveLength(2);
      const without = element('takes-list').querySelectorAll<HTMLButtonElement>('button.takes__score')[0];
      expect(without?.dataset['idle']).toBeUndefined();
      expect(without?.title).toBe(
        'Write this take down as a score, in common time at 120 from its first note: it was played without the click',
      );
      expect(without?.getAttribute('aria-label')).toBe(without?.title);
      const opened = runtime.controller.openedExercise;
      without?.click();
      await waitFor(() => runtime.controller.openedExercise !== opened);
      const free = runtime.controller.openedExercise;
      expect([free?.timeSignature.toString(), free?.tempoBpm]).toEqual(['4/4', 120]);
      const freeSteps = free === null ? [] : buildTimeline(free).steps.filter((step) => step.expectedMidi.length > 0);
      expect(freeSteps.map((step) => [step.expectedMidi, step.onsetTicks])).toEqual([
        [[67], 0],
        [[69], Duration.QUARTER.ticks],
      ]);
      element<HTMLButtonElement>('focus-takes').click();
      element('takes-list').querySelectorAll<HTMLButtonElement>('button[title="Save this take as a MIDI file"]')[0]?.click();
      const freeFile = readMidiFile(files.saved.at(-1)?.bytes ?? new Uint8Array());
      expect([freeFile.beats, freeFile.beatType, freeFile.tempoBpm]).toEqual([4, 4, 120]);
      expect(freeFile.notes.map((note) => note.startTicks)).toEqual([0, freeFile.division]);
      // Another take's page is that take's, to begin a sketch of; deleted, the pencil goes.
      expect([pencil.hidden, pencil.title]).toEqual([false, 'Begin a sketch of this recording to edit; the recording stays as it was played']);
      rowButton('takes-list', 'Delete this take').click();
      await confirmDeletion();
      expect(takes.list()).toHaveLength(1);
      expect(pencil.hidden).toBe(true);
      // Another score opened over a take's page, the page is no take's.
      rowButton('takes-list', write).click();
      await waitFor(() => !pencil.hidden);
      const writtenAgain = runtime.controller.openedExercise;
      await runtime.scores.keep(twoBarExercise({ title: 'Kept' }), 1_000);
      element<HTMLButtonElement>('focus-scores').click();
      [...element('scores-list').querySelectorAll('button')].find((button) => button.textContent === 'Open')?.click();
      await waitFor(() => runtime.controller.openedExercise !== writtenAgain);
      expect(pencil.hidden).toBe(true);
    });

    it('moves a note of a sketch where it is dragged from, onto the beat', async () => {
      const { view, metronome, clock, midi, sketches } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      frameButton('free').click();
      element<HTMLButtonElement>('free-beats-fewer').click();
      holdTheMetronome();
      // A note on each of three beats of the click's 100 bpm, 600 ms apart.
      for (const pitch of [60, 62, 64]) {
        metronome.advanceBeats(1);
        midi.noteOn(pitch, clock.now());
        clock.advance(300);
        midi.noteOff(pitch, clock.now());
      }
      holdTheMetronome();
      element<HTMLButtonElement>('focus-keep').click();
      rowButton('takes-list', 'Look at this take').click();
      element<HTMLButtonElement>('roll-edit').click();
      const id = sketches.list()[0]?.id ?? '';
      const struck = (): number[][] =>
        (sketches.find(id)?.events ?? []).flatMap((event) => (event.kind === 'noteOn' ? [[event.midi, event.atMs]] : []));
      const before = struck();
      expect(before.map(([pitch]) => pitch)).toEqual([60, 62, 64]);

      // On the grid that stands at the drawing's corner, a row thirteen pixels.
      const zoom = Number(element<HTMLInputElement>('roll-zoom').value);
      const highest = view.rollScene?.highest ?? 0;
      // Editing, every key has its row, and the drawing is scrolled down to the notes.
      const scrolledDown =
        Number.parseFloat(
          element('roll-body').querySelector<HTMLElement>('.roll__keys-strip')?.style.getPropertyValue('--roll-y') ?? '0',
        ) || 0;
      expect(highest).toBe(108);
      expect(scrolledDown).toBeGreaterThan(0);
      const onNote = (fromMs: number, pitch: number): { x: number; y: number } => ({
        x: ((fromMs + 100) / 1000) * zoom,
        y: (highest - pitch + 0.5) * 13 - scrolledDown,
      });
      const point = (type: string, at: { x: number; y: number }, pointerType = 'touch'): void => {
        element('roll-body').dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId: 3, pointerType, clientX: at.x, clientY: at.y }),
        );
      };
      const click = (at: { x: number; y: number }): void => {
        element('roll-body').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: at.x, clientY: at.y }));
      };
      const tap = (at: { x: number; y: number }): void => {
        // Apart in time, so two in a row on one note are not taken for a double tap.
        clock.advance(1_000);
        point('pointerdown', at);
        point('pointerup', at);
        click(at);
      };
      const chosen = (): number[][] =>
        (view.rollScene?.notes ?? []).filter((note) => note.chosen === true).map((note) => [highest - note.row, note.fromMs]);
      const second = onNote(600, 62);
      // Seven tenths of a beat on, and a row up.
      const dragged = { x: second.x + 0.7 * 0.6 * zoom, y: second.y - 13 };

      tap(second);
      expect(chosen()).toEqual([[62, 600]]);
      // A finger that wavers a little on it is still tapping, and moves nothing.
      const wavered = { x: second.x + 3, y: second.y + 2 };
      clock.advance(1_000);
      point('pointerdown', second);
      point('pointermove', wavered);
      point('pointerup', wavered);
      click(wavered);
      // A tap, so the note is chosen alone, as it was; moved, nothing.
      expect(element<HTMLButtonElement>('roll-undo').dataset['idle']).toBe('true');
      expect(chosen()).toEqual([[62, 600]]);
      tap(second);
      expect(chosen()).toEqual([[62, 600]]);
      point('pointerdown', second);
      point('pointermove', dragged);
      // Shown where it is going before it is let go of, and kept nowhere yet.
      expect(chosen()).toEqual([[63, 1_200]]);
      expect(struck()).toEqual(before);
      point('pointerup', dragged);
      // The click a finger makes letting go is not a tap on the drawing.
      click(dragged);
      expect(struck()).toEqual([before[0], [63, (before[1]?.[1] ?? 0) + 600], before[2]]);
      expect(chosen()).toEqual([[63, 1_200]]);
      expect(element<HTMLButtonElement>('roll-undo').dataset['idle']).toBeUndefined();
      element<HTMLButtonElement>('roll-undo').click();
      expect(struck()).toEqual(before);

      // Off the grid where the marker is put exactly, with the mouse as well -
      // which the drawing keeps hold of past its edge until it lets go.
      const captured: number[] = [];
      element('roll-body').setPointerCapture = (pointerId: number) => {
        captured.push(pointerId);
      };
      element<HTMLInputElement>('roll-snap').click();
      tap(second);
      captured.length = 0;
      point('pointerdown', second, 'mouse');
      expect(captured).toEqual([3]);
      point('pointermove', { x: second.x + 0.15 * zoom, y: second.y }, 'mouse');
      point('pointerup', { x: second.x + 0.15 * zoom, y: second.y }, 'mouse');
      expect(struck()[1]).toEqual([62, (before[1]?.[1] ?? 0) + 150]);
      // The right button is the menu's, and the drawing takes no hold of it.
      for (const type of ['pointerdown', 'pointerup']) {
        element('roll-body').dispatchEvent(
          new PointerEvent(type, { bubbles: true, pointerId: 4, pointerType: 'mouse', button: 2, clientX: second.x, clientY: second.y }),
        );
      }
      expect(captured).toEqual([3]);

      // Taken away rather than let go of: nothing changes.
      const now = struck();
      // The first chosen as well, with Shift.
      tapTheDrawing({ pointerType: 'touch', shiftKey: true, clientX: onNote(0, 60).x, clientY: onNote(0, 60).y });
      point('pointerdown', onNote(0, 60));
      point('pointermove', { x: onNote(0, 60).x + 0.3 * zoom, y: onNote(0, 60).y });
      point('pointercancel', { x: onNote(0, 60).x + 0.3 * zoom, y: onNote(0, 60).y });
      expect(struck()).toEqual(now);
      expect(chosen()).toEqual([
        [60, 0],
        [62, 750],
      ]);

      // The chosen are dragged together, by as much as the one taken hold of.
      point('pointerdown', onNote(0, 60));
      point('pointermove', { x: onNote(0, 60).x + 0.3 * zoom, y: onNote(0, 60).y - 13 });
      point('pointerup', { x: onNote(0, 60).x + 0.3 * zoom, y: onNote(0, 60).y - 13 });
      expect(struck()).toEqual([[61, 300], [63, (now[1]?.[1] ?? 0) + 300], now[2]]);
      expect(chosen()).toEqual([
        [61, 300],
        [63, 1_050],
      ]);
      element<HTMLButtonElement>('roll-undo').click();
      expect(struck()).toEqual(now);
      // Put back where they were, still in hand.
      expect(chosen()).toEqual([
        [60, 0],
        [62, 750],
      ]);
      // Taken far above the keyboard, the highest of them stops on its top key.
      tap(onNote(0, 60));
      tapTheDrawing({ pointerType: 'touch', shiftKey: true, clientX: onNote(750, 62).x, clientY: onNote(750, 62).y });
      point('pointerdown', onNote(0, 60));
      point('pointermove', { x: onNote(0, 60).x, y: onNote(0, 60).y - 80 * 13 });
      point('pointerup', { x: onNote(0, 60).x, y: onNote(0, 60).y - 80 * 13 });
      expect(struck().slice(0, 2)).toEqual([
        [106, 0],
        [108, now[1]?.[1] ?? 0],
      ]);
      element<HTMLButtonElement>('roll-undo').click();
      expect(struck()).toEqual(now);
      // And far below it, the lowest on its bottom key.
      tap(onNote(0, 60));
      tapTheDrawing({ pointerType: 'touch', shiftKey: true, clientX: onNote(750, 62).x, clientY: onNote(750, 62).y });
      point('pointerdown', onNote(0, 60));
      point('pointermove', { x: onNote(0, 60).x, y: onNote(0, 60).y + 80 * 13 });
      point('pointerup', { x: onNote(0, 60).x, y: onNote(0, 60).y + 80 * 13 });
      expect(struck().slice(0, 2)).toEqual([
        [21, 0],
        [23, now[1]?.[1] ?? 0],
      ]);
      element<HTMLButtonElement>('roll-undo').click();
      expect(struck()).toEqual(now);

      // Not chosen: taken hold of and chosen alone as it is pressed, so it is
      // lit while held, and moved alone in the same gesture - exactly, the
      // grid being off.
      tap(onNote(750, 62));
      const third = onNote(1_200, 64);
      point('pointerdown', third);
      expect(chosen()).toEqual([[64, 1_200]]);
      point('pointermove', { x: third.x + 0.7 * 0.6 * zoom, y: third.y - 13 });
      point('pointerup', { x: third.x + 0.7 * 0.6 * zoom, y: third.y - 13 });
      expect(struck()).toEqual([...now.slice(0, 2), [65, (now[2]?.[1] ?? 0) + 420]]);
      expect(chosen()).toEqual([[65, 1_620]]);
      // Pressed and let go of without moving, a note is a tap: chosen alone.
      const first = onNote(0, 60);
      point('pointerdown', first);
      point('pointerup', first);
      click(first);
      expect(chosen()).toEqual([[60, 0]]);
      // With Shift, another is added, and taken out again.
      const moved = onNote(1_620, 65);
      tapTheDrawing({ pointerType: 'touch', shiftKey: true, clientX: moved.x, clientY: moved.y });
      expect(chosen()).toEqual([
        [60, 0],
        [65, 1_620],
      ]);
      tapTheDrawing({ pointerType: 'touch', shiftKey: true, clientX: moved.x, clientY: moved.y });
      expect(chosen()).toEqual([[60, 0]]);

      // Its end taken hold of, in its last few pixels, it is held longer, to
      // the nearest beat; and shorter, never to nothing.
      element<HTMLInputElement>('roll-snap').click();
      const held = (): number | undefined =>
        sketches.find(id)?.events.find((event) => event.kind === 'noteOff' && event.midi === 60)?.atMs;
      expect(held()).toBe(300);
      const end = { x: (280 / 1000) * zoom, y: first.y };
      const mouse = (type: string, at: { x: number; y: number }): void => {
        point(type, at, 'mouse');
      };
      mouse('pointermove', first);
      expect(element('roll-body').dataset['grip']).toBe('note');
      mouse('pointermove', end);
      expect(element('roll-body').dataset['grip']).toBe('end');
      mouse('pointermove', { x: first.x, y: first.y - 13 });
      expect(element('roll-body').dataset['grip']).toBeUndefined();
      // Two chosen, both by as much.
      tapTheDrawing({ pointerType: 'touch', shiftKey: true, clientX: onNote(750, 62).x, clientY: onNote(750, 62).y });
      const heldToo = (): number | undefined =>
        sketches.find(id)?.events.find((event) => event.kind === 'noteOff' && event.midi === 62)?.atMs;
      expect(heldToo()).toBe(1_050);
      mouse('pointerdown', end);
      mouse('pointermove', { x: end.x + 0.25 * zoom, y: end.y + 13 });
      mouse('pointerup', { x: end.x + 0.25 * zoom, y: end.y + 13 });
      expect([held(), heldToo()]).toEqual([600, 1_350]);
      expect(chosen()).toEqual([
        [60, 0],
        [62, 750],
      ]);
      const longer = { x: (580 / 1000) * zoom, y: first.y };
      element<HTMLInputElement>('roll-snap').click();
      mouse('pointerdown', longer);
      mouse('pointermove', { x: 0, y: longer.y });
      mouse('pointerup', { x: 0, y: longer.y });
      expect([held(), heldToo()]).toEqual([30, 780]);
      element<HTMLButtonElement>('roll-undo').click();
      expect([held(), heldToo()]).toEqual([600, 1_350]);
    });

    it('says so in the middle of the page when a take played to the click cannot be written down', async () => {
      const { view, runtime, metronome, clock, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      frameButton('free').click();
      holdTheMetronome();
      // Struck and let go at once on two beats: too short for any value to write.
      for (const pitch of [60, 62]) {
        metronome.advanceBeats(1);
        midi.noteOn(pitch, clock.now());
        midi.noteOff(pitch, clock.now() + 1);
      }
      element<HTMLButtonElement>('focus-keep').click();
      const opened = runtime.controller.openedExercise;

      rowButton('takes-list', 'Write this take down as a score, in the bars of the click it was played to').click();
      await waitFor(() => element('result').textContent.startsWith('Could not write'));

      expect(element('result').textContent).toContain('too short to write down');
      expect(runtime.controller.openedExercise).toBe(opened);
    });

    it('turns the click off and on when its button is held, and opens the sheet on a tap', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      // On, as the app starts it; the rig keeps the click off.
      runtime.controller.updateSettings({ clickOn: true });
      setClickWhen('always');
      const button = element<HTMLButtonElement>('focus-metronome');
      expect(button.title).toContain('Tap for its settings, hold to turn it off.');

      // Not yet a hold a moment short of one.
      vi.useFakeTimers();
      try {
        button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        vi.advanceTimersByTime(HOLD_MS - 1);
        expect(runtime.controller.settings.clickOn).toBe(true);
        button.dispatchEvent(new Event('pointerup', { bubbles: true }));
        vi.advanceTimersByTime(HOLD_MS);
        expect(runtime.controller.settings.clickOn).toBe(true);
      } finally {
        vi.useRealTimers();
      }
      // Let go that soon, it was a tap.
      button.click();
      expect(element('sheet-metronome').hidden).toBe(false);
      element<HTMLButtonElement>('metronome-close').click();

      holdTheMetronome();

      expect(runtime.controller.settings.clickOn).toBe(false);
      expect(element('sheet-metronome').hidden).toBe(true);
      expect(button.dataset['click']).toBe('off');
      expect(button.title).toContain('hold to turn it on.');

      holdTheMetronome();

      expect(runtime.controller.settings.clickOn).toBe(true);
      expect(element('sheet-metronome').hidden).toBe(true);
    });

    it('lays the bar of the click in free play out in dots, a tap on one turning it round', async () => {
      const { view, runtime, metronome, clock } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      frameButton('free').click();
      // The tap as it is set at first, which is the same choice for runs: it
      // opens the sheet, and a hold starts the click.
      expect(element('focus-metronome').title).toContain('Tap for its settings, hold to start it.');
      element<HTMLButtonElement>('focus-metronome').click();
      expect(element('sheet-metronome').hidden).toBe(false);
      expect(metronome.isRunning).toBe(false);
      element<HTMLButtonElement>('metronome-close').click();
      holdTheMetronome();
      expect(metronome.isRunning).toBe(true);
      expect(element('sheet-metronome').hidden).toBe(true);
      element<HTMLButtonElement>('focus-metronome').click();
      const dots = (): HTMLElement[] => [...element('free-beats-dots').querySelectorAll<HTMLElement>('.free-beats__dot')];

      expect(dots().map((dot) => dot.dataset['sound'])).toEqual(['accent', 'beat', 'beat', 'beat']);
      expect(element<HTMLOutputElement>('free-beats-count').value).toBe('4');
      expect(dots()[1]?.title).toBe('Beat 2: plain. Tap to leave it out.');

      dots()[1]?.click();
      expect(dots()[1]?.dataset['sound']).toBe('silent');
      expect(dots()[1]?.getAttribute('aria-label')).toBe('Beat 2: left out. Tap to mark it.');
      expect(metronome.currentConfig.beatsOfTheBar).toEqual(['accent', 'silent', 'beat', 'beat']);

      element<HTMLButtonElement>('free-beats-fewer').click();
      expect(dots()).toHaveLength(3);
      expect(element<HTMLOutputElement>('free-beats-count').value).toBe('3');
      element<HTMLButtonElement>('free-beats-more').click();
      element<HTMLButtonElement>('free-beats-more').click();
      expect(runtime.controller.settings.freePlayBeats).toEqual(['accent', 'silent', 'beat', 'beat', 'beat']);
      expect(element('focus-metronome').title).toContain('5 beats a bar');

      // Each beat's dot lit on the first frame at its moment, the one left
      // out as well, and none once the click stops. Frames are run by hand.
      const frames: FrameRequestCallback[] = [];
      const ask = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
      const runTheFrames = (): void => {
        for (const frame of frames.splice(0)) {
          frame(0);
        }
      };
      const lit = (): number[] => dots().flatMap((dot, at) => (dot.dataset['now'] === 'true' ? [at] : []));
      try {
        expect(lit()).toEqual([]);
        metronome.advanceSubdivisions(1);
        runTheFrames();
        expect(lit()).toEqual([0]);
        // Placed ahead of being heard, as the device places it: not lit early.
        const [second] = metronome.placeAhead(1);
        runTheFrames();
        expect(lit()).toEqual([0]);
        clock.set((second?.scheduledTimeMs ?? 0) - 1);
        runTheFrames();
        expect(lit()).toEqual([0]);
        clock.set(second?.scheduledTimeMs ?? 0);
        runTheFrames();
        expect(lit()).toEqual([1]);
        // Nothing more coming, the frames stop being asked for.
        expect(frames).toHaveLength(0);
        // Heard, it is not lit a second time.
        metronome.advanceSubdivisions(1);
        runTheFrames();
        expect(lit()).toEqual([1]);
        // Drawn again, the dots keep the beat.
        element<HTMLButtonElement>('free-beats-more').click();
        expect(lit()).toEqual([1]);
        metronome.advanceSubdivisions(5);
        runTheFrames();
        expect(lit()).toEqual([0]);
      } finally {
        ask.mockRestore();
      }
      // Each beat heard ruled across the lane, rising as time goes: the one
      // just heard, the first of a bar, a bar line at the keys, and the beats
      // before it higher up.
      expect(view.fallingBarLines.at(-1)).toEqual({ label: '', at: 1 });
      // And the lane moving to carry them, though nothing has been played.
      expect(document.body.dataset['notesFalling']).toBe('true');
      expect(view.fallingRuling.length).toBeGreaterThan(0);
      expect(view.fallingRuling.every((line) => line.weight === 'beat' && line.at < 1)).toBe(true);
      clock.advance(1_000);
      expect(view.fallingBarLines.at(-1)?.at).toBeLessThan(1);
      element<HTMLButtonElement>('metronome-on').click();
      expect(metronome.isRunning).toBe(false);
      expect(lit()).toEqual([]);

      // The tempo tapped: on the finger going down, the click of letting go
      // not a tap of its own, and the keyboard's press a tap.
      const tap = element<HTMLButtonElement>('free-tap');
      tap.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      tap.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      clock.advance(500);
      tap.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      tap.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      expect(runtime.controller.settings.freePlayBpm).toBe(120);
      expect(element<HTMLOutputElement>('focus-tempo').value).toBe('120');
      clock.advance(1_000);
      tap.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
      expect(runtime.controller.settings.freePlayBpm).toBe(80);

      // The bar and the tempo of the score on the page, said before they are taken.
      runtime.controller.setTempoBpm(72);
      element<HTMLButtonElement>('free-beats-fewer').click();
      const fromScore = element<HTMLButtonElement>('free-from-score');
      const piece = runtime.controller.theFreeClickOfThePiece();
      expect(piece?.bpm).toBe(72);
      expect(fromScore.title).toBe(`Beat as the score on the page does: ${String(piece?.beats.length)} beats a bar at 72`);
      expect(fromScore.getAttribute('aria-label')).toBe(fromScore.title);
      fromScore.click();
      expect(runtime.controller.settings.freePlayBpm).toBe(72);
      expect(element<HTMLOutputElement>('focus-tempo').value).toBe('72');
      expect(element<HTMLOutputElement>('free-beats-count').value).toBe(String(piece?.beats.length));
      expect(runtime.controller.settings.freePlayBeats).toEqual(piece?.beats);
    });

    it('starts and stops the click in free play on a tap, at a tempo of its own the speed buttons set', async () => {
      const { view, runtime, metronome } = createRig();
      await view.initialize();
      // A tap set to turn the metronome off and on, which in free play is
      // starting and stopping the click.
      runtime.controller.updateSettings({ metronomeTap: 'turns-it-off-and-on' });
      element<HTMLButtonElement>('focus-modes').click();
      frameButton('free').click();
      const button = element<HTMLButtonElement>('focus-metronome');
      const tempo = element<HTMLOutputElement>('focus-tempo');
      const percent = runtime.controller.tempoPercent;
      const clickOn = runtime.controller.settings.clickOn;

      expect(tempo.value).toBe('100');
      // A crotchet drawn before the number, so it reads as a tempo.
      expect(tempo.querySelector('svg.focus-bar__note')).not.toBeNull();
      expect(button.title).toContain('Tap to start it, hold for its settings.');
      button.click();
      expect(metronome.isRunning).toBe(true);
      expect(metronome.currentConfig.bpm).toBe(100);
      expect(element('sheet-metronome').hidden).toBe(true);
      expect(button.dataset['click']).toBe('on');
      expect(button.title).toContain('Tap to stop it');

      // Faster from the next beat, and the piece's own speed left alone.
      element<HTMLButtonElement>('focus-faster').click();
      expect(metronome.currentConfig.bpm).toBe(101);
      expect(tempo.value).toBe('101');
      expect(tempo.title).toBe('The metronome: 101 bpm');
      element<HTMLButtonElement>('focus-slower').click();
      element<HTMLButtonElement>('focus-slower').click();
      expect(runtime.controller.settings.freePlayBpm).toBe(99);
      expect(runtime.controller.tempoPercent).toBe(percent);

      // Held, a bpm a step and the steps closing up; let go, it stops, and
      // the click of letting go is not one more.
      const faster = element<HTMLButtonElement>('focus-faster');
      let reached = 0;
      vi.useFakeTimers();
      try {
        faster.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        vi.advanceTimersByTime(HOLD_MS - 1);
        expect(runtime.controller.settings.freePlayBpm).toBe(99);
        vi.advanceTimersByTime(1);
        expect(runtime.controller.settings.freePlayBpm).toBe(100);
        // The next after 150 ms, then 138, then 126.
        vi.advanceTimersByTime(150);
        expect(runtime.controller.settings.freePlayBpm).toBe(101);
        vi.advanceTimersByTime(137);
        expect(runtime.controller.settings.freePlayBpm).toBe(101);
        vi.advanceTimersByTime(1);
        expect(runtime.controller.settings.freePlayBpm).toBe(102);
        vi.advanceTimersByTime(126);
        expect(runtime.controller.settings.freePlayBpm).toBe(103);
        // Seconds later, thirty milliseconds a step.
        vi.advanceTimersByTime(3_000);
        reached = runtime.controller.settings.freePlayBpm;
        expect(reached).toBeGreaterThan(160);
        faster.dispatchEvent(new Event('pointerup', { bubbles: true }));
        faster.click();
        vi.advanceTimersByTime(1_000);
        expect(runtime.controller.settings.freePlayBpm).toBe(reached);
      } finally {
        vi.useRealTimers();
      }
      faster.click();
      expect(runtime.controller.settings.freePlayBpm).toBe(reached + 1);

      // Held, it opens the sheet and leaves the click going - and the switch
      // at its head stops and starts it, saying which.
      holdTheMetronome();
      expect(element('sheet-metronome').hidden).toBe(false);
      expect(metronome.isRunning).toBe(true);
      const on = element<HTMLButtonElement>('metronome-on');
      expect(on.getAttribute('aria-checked')).toBe('true');
      on.click();
      expect(metronome.isRunning).toBe(false);
      expect(on.getAttribute('aria-checked')).toBe('false');
      expect(runtime.controller.settings.clickOn).toBe(clickOn);
      on.click();
      expect(metronome.isRunning).toBe(true);
      element<HTMLButtonElement>('metronome-close').click();

      button.click();
      expect(metronome.isRunning).toBe(false);
      expect(button.dataset['click']).toBe('off');

      // Out of free play it goes with the keys, and the button is the run's
      // again: a tap turns the runs' click off and on.
      button.click();
      frameButton('free').click();
      expect(metronome.isRunning).toBe(false);
      expect(runtime.controller.clicksFreely).toBe(false);
      expect(tempo.value).toBe(`${String(percent)}%`);
      button.click();
      expect(runtime.controller.settings.clickOn).toBe(!clickOn);
      expect(metronome.isRunning).toBe(false);
      holdTheMetronome();
      expect(element('sheet-metronome').hidden).toBe(false);

      // Outside free play a held button is a tap, and the piece's speed moves
      // by its own step once.
      element<HTMLButtonElement>('metronome-close').click();
      vi.useFakeTimers();
      try {
        faster.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        vi.advanceTimersByTime(2_000);
        expect(runtime.controller.tempoPercent).toBe(percent);
        faster.dispatchEvent(new Event('pointerup', { bubbles: true }));
        faster.click();
        expect(runtime.controller.tempoPercent).toBe(percent + TEMPO_STEP_PERCENT);
      } finally {
        vi.useRealTimers();
      }
    });

    it('swaps what a tap and a hold do at the foot of its sheet', async () => {
      // A reader who has set the click once and only turns it off and on can
      // have that on the tap; the sheet is then a hold, or a right click, away.
      const { view, runtime } = createRig();
      await view.initialize();
      // On, as the app starts it; the rig keeps the click off.
      runtime.controller.updateSettings({ clickOn: true });
      const button = element<HTMLButtonElement>('focus-metronome');
      const tap = element<HTMLSelectElement>('metronome-tap');
      // Folded under the rest of the sheet, and opening it as it stands.
      expect(tap.closest('#sheet-metronome details.sheet__more')).not.toBeNull();
      expect(tap.value).toBe('opens-its-sheet');

      openTheMetronome();
      tap.value = 'turns-it-off-and-on';
      tap.dispatchEvent(new Event('change'));
      element<HTMLButtonElement>('metronome-close').click();

      expect(runtime.controller.settings.metronomeTap).toBe('turns-it-off-and-on');
      expect(element('metronome-tap-description').textContent).toContain('opens this sheet');
      expect(button.title).toContain('Tap to turn it off, hold for its settings.');

      button.click();

      expect(runtime.controller.settings.clickOn).toBe(false);
      expect(element('sheet-metronome').hidden).toBe(true);

      holdTheMetronome();

      expect(element('sheet-metronome').hidden).toBe(false);
      expect(runtime.controller.settings.clickOn).toBe(false);
      element<HTMLButtonElement>('metronome-close').click();

      button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

      expect(element('sheet-metronome').hidden).toBe(false);
      expect(runtime.controller.settings.clickOn).toBe(false);
    });

    it('asks whose notes only once the click is on the notes, shown rather than dimmed', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      const group = element('click-notes-group');
      const click = element<HTMLSelectElement>('click');
      const whose = element<HTMLSelectElement>('click-notes');
      openTheMetronome();
      expect(group.hidden).toBe(true);
      expect(whose.closest('#sheet-metronome')).not.toBeNull();

      click.value = 'notes';
      click.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.clickPattern).toBe('notes');
      expect(group.hidden).toBe(false);
      expect(group.dataset['idle']).toBeUndefined();
      expect([...whose.options].map((option) => option.value)).toEqual(['my-hand', 'both-hands']);
      expect(whose.value).toBe('my-hand');

      whose.value = 'both-hands';
      whose.dispatchEvent(new Event('change'));
      expect(runtime.controller.settings.clickNotesOf).toBe('both-hands');

      click.value = 'pulse';
      click.dispatchEvent(new Event('change'));
      expect(group.hidden).toBe(true);
      // Kept for when it is asked again.
      expect(runtime.controller.settings.clickNotesOf).toBe('both-hands');

      // And says what it is set to, however it was set.
      runtime.controller.updateSettings({ clickNotesOf: 'my-hand' });
      openTheMetronome();
      expect(whose.value).toBe('my-hand');
    });

    it('dims when the click sounds while it is off, and says why', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      // On, as the app starts it; the rig keeps the click off.
      runtime.controller.updateSettings({ clickOn: true });
      const carrier = element('dropout').closest<HTMLElement>('.control-group');

      openTheMetronome();
      element<HTMLButtonElement>('metronome-on').click();

      expect(carrier?.dataset['idle']).toBe('true');
      expect(carrier?.title).toContain('switch at the top');
      // Never among the answers: off is the switch's.
      expect([...element<HTMLSelectElement>('dropout').options].map((option) => option.value)).not.toContain('never');
    });

    it('names the pattern on the same button, that being the same subject', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      // On, as the app starts it; the rig keeps the click off.
      runtime.controller.updateSettings({ clickOn: true });
      const select = element<HTMLSelectElement>('click');
      select.value = 'downbeat';
      select.dispatchEvent(new Event('change'));

      expect(element('focus-metronome').title).toContain('first beat of the bar');
    });

    describe('saying which bars are being read', () => {
      it('writes the passage into the drawer and marks the handle', async () => {
        // Fullscreen has no panel, so without this a hundred-bar piece cut
        // down to two looks exactly like a two-bar piece - and the handle is
        // what says so while the drawer is shut, which is most of the time.
        const { view, runtime } = createRig();
        await view.initialize();
        expect(element('focus-handle').dataset['passage']).toBe('false');
        expect(element<HTMLButtonElement>('focus-whole').disabled).toBe(true);

        const from = element<HTMLInputElement>('focus-from');
        from.value = '2';
        from.dispatchEvent(new Event('change'));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(element<HTMLInputElement>('focus-from').value).toBe('2');
        expect(element('focus-handle').dataset['passage']).toBe('true');
        expect(element<HTMLButtonElement>('focus-whole').disabled).toBe(false);
        expect(runtime.controller.settings.rangeFromBar).toBe(2);
      });

      it('takes the passage from the drawer and puts it in the panel too', async () => {
        // One setting, two pairs of boxes: the panel is out of reach in
        // fullscreen, and boxes that could disagree would be two settings.
        const { view, runtime } = createRig();
        await view.initialize();

        const from = element<HTMLInputElement>('focus-from');
        from.value = '2';
        from.dispatchEvent(new Event('change'));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(runtime.controller.settings.rangeFromBar).toBe(2);
        expect(element<HTMLInputElement>('focus-from').value).toBe('2');
      });

      it('does not spell out the place a cursor is already standing on', async () => {
        // "bar 12 · beat 2.5" changed several times a second on music of any
        // density, and its width changed with it: what it produced was a
        // smear, not a number anyone could read. The cursor is on the note
        // and the bar numbers are printed - the answer is in front of the
        // reader, more exactly than a line of text could give it.
        //
        // That it counted by the score's own numbering rather than from one
        // again is still the rule, and still tested: see `barNumber` in
        // tests/application/practice-controller.test.ts.
        const { view } = createRig();
        await view.initialize();
        const from = element<HTMLInputElement>('focus-from');
        from.value = '2';
        from.dispatchEvent(new Event('change'));
        await new Promise((resolve) => setTimeout(resolve, 0));

        element<HTMLButtonElement>('focus-play').click();

        expect(document.getElementById('position')).toBeNull();
      });

      it('gives the whole piece back', async () => {
        const { view, runtime } = createRig();
        await view.initialize();
        const from = element<HTMLInputElement>('focus-from');
        from.value = '2';
        from.dispatchEvent(new Event('change'));
        await new Promise((resolve) => setTimeout(resolve, 0));

        element<HTMLButtonElement>('focus-whole').click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(runtime.controller.settings.rangeFromBar).toBeNull();
        expect(element<HTMLInputElement>('focus-from').value).toBe('');
        expect(element<HTMLInputElement>('focus-from').value).toBe('');
        expect(element('focus-handle').dataset['passage']).toBe('false');
      });
    });

    it('keeps the transport on one row and the settings underneath', async () => {
      const { view } = createRig();
      await view.initialize();

      // Icons small enough that the whole transport fits a single line; the
      // drawer is for what you change rather than what you press mid-run.
      const row = element('focus-play').parentElement;
      expect(row?.className).toContain('focus-bar__row');
      for (const id of ['focus-stop', 'focus-metronome', 'focus-repeat']) {
        expect(element(id).parentElement).toBe(row);
        // Named for a screen reader, since the label is a picture now.
        expect(element(id).getAttribute('aria-label')).toBeTruthy();
      }
      // Asking for a fresh exercise is not in here at all any more: it is
      // an answer to "what goes on the stand", so it stands with the scores
      // - and it closes that sheet behind itself, the way choosing one does.
      expect(element('scores-fresh').closest('#sheet-scores')).not.toBeNull();
      element<HTMLButtonElement>('focus-scores').click();
      expect(element('sheet-scores').hidden).toBe(false);

      element<HTMLButtonElement>('scores-fresh').click();

      expect(element('sheet-scores').hidden).toBe(true);
      expect(element('focus-hands').parentElement?.id).toBe('focus-drawer');
      expect(element('focus-zoom').closest('#focus-drawer')).not.toBeNull();
    });

    it('cycles which hand through all three answers from one button', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      const hands = element<HTMLButtonElement>('focus-hands');
      const dimmed = (id: string): string => element(id).dataset['reading'] ?? '';

      expect(runtime.controller.settings.handStaff).toBeNull();
      expect(dimmed('focus-hand-left')).toBe('true');
      expect(dimmed('focus-hand-right')).toBe('true');

      hands.click();
      expect(runtime.controller.settings.handStaff).toBe(2);
      // The hand that is not being read fades, so the control shows its own
      // state rather than naming it.
      expect(dimmed('focus-hand-right')).toBe('false');
      expect(hands.getAttribute('aria-label')).toContain('Left');

      hands.click();
      expect(runtime.controller.settings.handStaff).toBe(1);
      expect(dimmed('focus-hand-left')).toBe('false');

      hands.click();
      expect(runtime.controller.settings.handStaff).toBeNull();
    });

    it('shows the falling bar once the run it belongs to has begun', async () => {
      // His: only after Start. Choosing survival is a decision about the next
      // run; the falling bar is that run happening, and a full bar standing
      // over a page nobody is reading yet is the program showing its working.
      const { view, runtime } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID });

      element<HTMLButtonElement>('focus-modes').click();
      (element('modes-grid').querySelector('[data-mode="survival"]') as HTMLButtonElement).click();

      expect(runtime.controller.settings.survival).toBe(true);
      expect(element('focus-health').hidden).toBe(true);

      element<HTMLButtonElement>('focus-play').click();

      expect(element('focus-health').hidden).toBe(false);

      element<HTMLButtonElement>('focus-stop').click();

      expect(element('focus-health').hidden).toBe(true);
    });

    it('keeps what you open out of the row and drawer you press', async () => {
      // His: pills of their own beside the bar. The row and the drawer are
      // what a reader reaches for with their hands on the keys; these raise
      // a sheet over the page and are chosen between runs.
      const { view } = createRig();
      await view.initialize();
      const aside = element('focus-aside');

      // Standing, and not merely present: hidden, it is four things the
      // reader can no longer reach at all.
      expect(aside.hidden).toBe(false);
      for (const id of ['focus-scores', 'focus-modes', 'focus-readings', 'focus-settings']) {
        expect(aside.contains(element(id))).toBe(true);
      }
      // What was kept goes under the eye that reveals it, on the other side.
      expect(element('focus-record').contains(element('focus-takes'))).toBe(true);
      // Both held in one box, which on a phone is the row they share.
      expect(aside.parentElement).toBe(element('focus-opens'));
      expect(element('focus-record').parentElement).toBe(element('focus-opens'));
      for (const id of ['focus-scores', 'focus-takes', 'focus-settings', 'focus-readings']) {
        expect(element('focus-row').contains(element(id))).toBe(false);
        expect(element('focus-drawer').contains(element(id))).toBe(false);
        // Moved and still standing: a button carried somewhere the reader
        // cannot see it has been taken away rather than moved.
        expect(element(id).hidden).toBe(false);
      }
      // And what the modes sheet now owns is gone from the bar entirely.
      expect(document.getElementById('focus-wait')).toBeNull();
      expect(document.getElementById('focus-survival')).toBeNull();
    });

    it('shows and hides the cursor from the desk', async () => {
      // It had a button in the drawer that moved whichever of the three
      // applied at that moment, which is how it came to overwrite the square
      // the reader had just set. Each of the three is asked for by name now.
      const { view, runtime, renderer } = createRig();
      await view.initialize();
      const box = element<HTMLInputElement>('cursor-rest');
      expect(box.checked).toBe(true);

      box.checked = false;
      box.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.cursorAtRest).toBe(false);
      expect(renderer.cursor.visible).toBe(false);
      // And the square, which owns a different one of the three, is untouched.
      expect(runtime.controller.settings.cursorWhileRunning).toBe(true);

      box.checked = true;
      box.dispatchEvent(new Event('change'));

      expect(renderer.cursor.visible).toBe(true);
    });

    it('says which rung the route has reached, where the material is chosen', async () => {
      // The ladder is the half of this program that is actually sight-reading
      // - music nobody has seen before - and from the sheet that asks what to
      // put on the stand it was invisible, which is most of why it goes
      // unused. Said beside the one row that puts fresh material there.
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-scores').click();

      // Settings chosen by hand are said plainly, which is where the rig
      // starts and where a reader who set the level themselves stands.
      expect(element('scores-rung').textContent).toContain('Off the ladder');

      // On to the route the way a reader gets there: the arrows.
      element<HTMLButtonElement>('ladder-up').click();
      element<HTMLButtonElement>('focus-scores').click();

      const said = element('scores-rung').textContent ?? '';
      expect(said).toContain(runtime.controller.ladderStep?.label ?? 'nothing');
      expect(said).toContain('five fingers from C');
    });

    it('puts away what a repeat says it was called, keeping where it is', async () => {
      // His: knowing a bar is being read again is worth having and worth
      // putting away. What goes is the writer own number and the turning
      // arrow; the number in the corner stays, being where in the playing
      // this bar is and what everything else counts by. Said on the page
      // rather than drawn again - a checkbox must not cost a re-engraving.
      const { view, runtime } = createRig();
      await view.initialize();
      const box = element<HTMLInputElement>('repeat-numbers');
      expect(box.checked).toBe(true);
      expect(document.body.dataset['repeats']).toBe('shown');

      box.checked = false;
      box.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.showRepeatNumbers).toBe(false);
      expect(document.body.dataset['repeats']).toBe('hidden');

      box.checked = true;
      box.dispatchEvent(new Event('change'));

      expect(document.body.dataset['repeats']).toBe('shown');
    });

    it('reads the score as pages unless the reader says otherwise', async () => {
      // A score is a thing with pages, so that is what the app opens with -
      // and the switch is at the desk, being set once and left alone rather
      // than pressed with hands on the keys.
      const { view, runtime, renderer } = createRig();
      await view.initialize();
      const box = element<HTMLInputElement>('paged-score');
      expect(box.checked).toBe(true);
      expect(renderer.isPaged).toBe(true);

      box.checked = false;
      box.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.pagedScore).toBe(false);
      expect(renderer.isPaged).toBe(false);

      box.checked = true;
      box.dispatchEvent(new Event('change'));

      expect(renderer.isPaged).toBe(true);

      // And it shows what the settings say, however they were changed: the
      // sheet is opened onto whatever the run has left behind.
      runtime.controller.updateSettings({ pagedScore: false });
      element<HTMLButtonElement>('focus-settings').click();

      expect(box.checked).toBe(false);
    });

    it('turns the page when the music leaves it, and not on every beat', async () => {
      // A page turn is for looking at one thing until it is finished with.
      // Scrolling a little every beat is the behaviour it exists to replace.
      const rig = createRig();
      await rig.view.initialize();
      // Flow mode, because it is the metronome that moves the music there -
      // in Wait mode the page waits for the reader and never leaves the bar.
      rig.runtime.controller.updateSettings({ countInBars: 0, modeId: 'mode.flow' });
      rig.runtime.controller.start();

      rig.renderer.shownMeasures.length = 0;
      rig.renderer.barsPerPage = 2;
      // Three bars of 4/4, which is past the end of a page holding two.
      rig.metronome.advanceBeats(12);

      // The renderer is told where the music is on every notated beat and
      // decides for itself whether that is still on the page being read.
      expect(new Set(rig.renderer.shownMeasures)).toEqual(new Set([0, 1, 2]));
      expect(rig.renderer.pages.at).toBe(1);
    });

    it('asks at the desk when the notes are coloured', async () => {
      // Four answers - as I play, wrong ones while held, when the run ends,
      // never - so one control with four of them rather than a button that
      // cycled. The drawer's copy is gone; this is the whole of it now.
      const { view, runtime } = createRig();
      await view.initialize();
      const select = element<HTMLSelectElement>('show-played');

      select.value = 'at-end';
      select.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.playedNotes).toBe('at-end');

      select.value = 'hidden';
      select.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.playedNotes).toBe('hidden');
    });

    it('sizes the notes from the drawer', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      const before = runtime.controller.settings.zoom;

      element<HTMLButtonElement>('focus-bigger').click();

      expect(runtime.controller.settings.zoom).toBeGreaterThan(before);
      expect(element('focus-zoom').textContent).toBe(
        `${Math.round(runtime.controller.settings.zoom * 100)}%`,
      );
      // The desk slider is the same value seen another way.
      expect(element<HTMLInputElement>('zoom').value).toBe(
        String(Math.round(runtime.controller.settings.zoom * 100)),
      );
    });

    it('opens and closes the drawer from its handle', async () => {
      const { view } = createRig();
      await view.initialize();

      expect(element('focus-bar').dataset['open']).toBe('false');
      expect(element('focus-handle').getAttribute('aria-expanded')).toBe('false');

      element<HTMLButtonElement>('focus-handle').click();

      expect(element('focus-bar').dataset['open']).toBe('true');
      expect(element('focus-handle').getAttribute('aria-expanded')).toBe('true');

      element<HTMLButtonElement>('focus-handle').click();
      expect(element('focus-bar').dataset['open']).toBe('false');
    });

    it('opens on a drag up and closes on a drag down', async () => {
      const { view } = createRig();
      await view.initialize();

      view.handleDragged(-60);
      expect(view.isDrawerOpen).toBe(true);

      view.handleDragged(60);
      expect(view.isDrawerOpen).toBe(false);
    });

    it('treats a small movement as a tap, not a drag', async () => {
      const { view } = createRig();
      await view.initialize();
      view.setDrawerOpen(true);

      // A thumb never lands perfectly still; a few pixels must not decide
      // the opposite of what the tap meant.
      view.handleDragged(-4);
      view.handleDragged(4);

      expect(view.isDrawerOpen).toBe(true);
    });

    it('says which of the three the one button is', async () => {
      const { view } = createRig();
      await view.initialize();
      const icon = (): string => element('focus-play-icon').getAttribute('d') ?? '';

      expect(element('focus-play').getAttribute('aria-label')).toBe('Start');
      const idle = icon();

      element<HTMLButtonElement>('focus-play').click();

      // An icon for the eye and a name for everything else; one button for
      // all three states, as a transport has.
      expect(element('focus-play').getAttribute('aria-label')).toBe('Pause');
      expect(icon()).not.toBe(idle);
    });

    it('changes the pace without leaving the stand', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      expect(element('focus-tempo').textContent).toBe('100%');

      element<HTMLButtonElement>('focus-slower').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runtime.controller.tempoPercent).toBe(95);
      expect(element('focus-tempo').textContent).toBe('95%');
      // The desk slider is the same value seen another way, so it follows.
      expect(element<HTMLInputElement>('tempo').value).toBe(
        String(runtime.controller.tempoBpm),
      );
    });

    it('re-engraves once the pressing stops, not on every press', async () => {
      const { view, renderer } = createRig();
      await view.initialize();
      const before = renderer.loadCount;

      for (let press = 0; press < 4; press += 1) {
        element<HTMLButtonElement>('focus-faster').click();
      }

      // Re-engraving a long piece is most of a second, and doing it under
      // every press swallowed the next one. The reading is immediate; the
      // page is not, and that is the whole point.
      expect(element('focus-tempo').textContent).toBe('120%');
      expect(renderer.loadCount).toBe(before);

      // Waited for rather than slept through: a fixed pause is a race with
      // whatever else the machine is doing, and it is the machine that
      // decides how long these four presses took.
      await waitFor(() => renderer.loadCount > before);

      // The mark is printed on the page; leaving it saying 88 while the run
      // goes at 92 is a page that lies about itself. Once, not four times.
      expect(renderer.loadCount).toBe(before + 1);
    });

    it('gives the grade in the middle of the page, there being no panel', async () => {
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-play').click();

      const session = runtime.controller.session;
      let guard = 400;
      while (session?.status === 'running' && guard > 0) {
        guard -= 1;
        const step = session.currentStep;
        if (step === null) {
          break;
        }
        for (const note of step.expectedMidi) {
          midi.noteOn(note, 0);
        }
      }

      expect(session?.status).toBe('completed');
      // The whole report, in the middle of the page. There is no side panel
      // to put it in and the pill that used to carry two words of it is gone.
      expect(element('score-verdict').hidden).toBe(false);
      expect(element('result').textContent).toMatch(/[A-F]/);
      expect(element('result').textContent).toContain('Overall');
    });

    it('loads a new exercise from the pill', async () => {
      const { view, renderer } = createRig();
      await view.initialize();

      element<HTMLButtonElement>('scores-fresh').click();
      await Promise.resolve();
      await Promise.resolve();

      expect(renderer.loadCount).toBe(2);
    });

  });

  it('detaches its listeners on dispose', async () => {
    const { view, runtime } = createRig();
    await view.initialize();

    view.dispose();
    element<HTMLButtonElement>('focus-play').click();

    expect(runtime.controller.session).toBeNull();
  });
});

describe('the middle of a run, rather than its average', () => {
  it('ignores a handful of readings that were a second out', () => {
    // Exactly what happened: the opening presses of a run arrived before the
    // relay's clock had been measured and were a whole second wrong.
    // Averaged with the rest they gave three hundred and seventy against a
    // truth of a hundred and twenty.
    const run = [1149, 1144, 1133, 1122, 128, 120, 119, 122, 104, 124, 153, 129, 122, 96, 109, 68];

    expect(Math.round(middle(run))).toBe(123);
    const average = run.reduce((sum, each) => sum + each, 0) / run.length;
    expect(Math.round(average)).toBe(371);
  });

  it('measures the scatter the same way, so a few wild ones cannot hide it', () => {
    const steady = [118, 120, 122, 119, 121, 123, 117, 120];
    const withWildOnes = [...steady, 1149, 1144];

    // A standard deviation would be hundreds here; this stays near the truth.
    expect(spreadAround(withWildOnes)).toBeLessThan(20);
    expect(isRealTendency(middle(withWildOnes), spreadAround(withWildOnes), 10)).toBe(true);
  });

  it('is the plain middle when nothing is wild', () => {
    expect(middle([1, 2, 3])).toBe(2);
    expect(middle([1, 2, 3, 4])).toBe(2.5);
    expect(middle([])).toBe(0);
  });
});

describe('telling a tendency from a scatter', () => {
  it('calls a steady offset real, however wide the presses were spread', () => {
    // The rule this replaces asked for the scatter to be smaller than the
    // average, which is far too strict for reading at sight: a tenth of a
    // second either side is a good performance, and it hid a real ninety
    // milliseconds of delay behind ordinary human unevenness.
    expect(isRealTendency(90, 95, 16)).toBe(true);
  });

  it('is surer of an average the more presses went into it', () => {
    // The whole reason a run is worth more than one press.
    expect(isRealTendency(30, 90, 4)).toBe(false);
    expect(isRealTendency(30, 90, 64)).toBe(true);
  });

  it('will not call nothing something', () => {
    expect(isRealTendency(2, 90, 32)).toBe(false);
    expect(isRealTendency(90, 95, 1)).toBe(false);
  });

  it('answers a run that was simply on time with a no', () => {
    expect(isRealTendency(0, 40, 32)).toBe(false);
  });
});

describe('describeTendency', () => {
  it('names a systematic lean, which the absolute average hides', () => {
    // Scatter either side of the beat averages to nothing signed; a run that
    // sits consistently ahead of it does not, and that is the difference
    // between a precision problem and a habit.
    expect(describeTendency(-45)).toBe('45 ms early');
    expect(describeTendency(60)).toBe('60 ms late');
  });

  it('does not make a habit out of being human', () => {
    expect(describeTendency(0)).toBe('even');
    expect(describeTendency(-14)).toBe('even');
    expect(describeTendency(14)).toBe('even');
  });
});

describe('pacing the survival bar', () => {
  beforeEach(() => {
    mountRealMarkup();
  });

  it('takes its pace from the gap between pulses', () => {
    expect(healthGlideMs(120, 1_500, 1_000)).toBe(500);
  });

  it('keeps the last pace when there is nothing to measure yet', () => {
    expect(healthGlideMs(400, 1_000, null)).toBe(400);
  });

  it('never glides so briefly that it reads as a jump', () => {
    expect(healthGlideMs(500, 1_010, 1_000)).toBe(120);
  });

  it('is not re-timed by a step landing in the same turn as a pulse', () => {
    // The reported fault. A pulse fires and the bar starts a glide; the step
    // it just passed settles in the same turn. Timed from "just now" that
    // second write is a snap, and it overwrites the glide - so the bar was
    // smooth until steps began completing and jumped ever after.
    //
    // The pace is a property of the pulse, so a settlement cannot touch it:
    // there is no call to make here, which is the point.
    const paceFromPulses = healthGlideMs(120, 1_500, 1_000);

    expect(paceFromPulses).toBe(500);
    // And the next pulse measures from the pulse before it, not from the step.
    expect(healthGlideMs(paceFromPulses, 2_000, 1_500)).toBe(500);
  });

  it('keeps gliding once steps start completing', async () => {
    // The reported fault, end to end. A pulse fires and the bar starts a
    // glide; the step it just passed settles in the same turn. Re-timed from
    // "just now", that second write is a snap that overwrites the glide - so
    // the bar was smooth until steps began completing and jumped ever after.
    const rig = createRig();
    await rig.view.initialize();
    rig.runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, survival: true });
    const glide = (): string => element('focus-health-fill').style.transitionDuration;

    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      rig.runtime.controller.start();

      vi.setSystemTime(2_000);
      rig.metronome.advanceSubdivisions(1);
      vi.setSystemTime(3_000);
      rig.metronome.advanceSubdivisions(1);
      expect(glide()).toBe('1000ms');

      // By here the cursor has passed steps, so settlements arrive in the
      // same turn as the pulses. The pace is the pulse's business either way.
      for (let at = 4; at <= 8; at += 1) {
        vi.setSystemTime(at * 1_000);
        rig.metronome.advanceSubdivisions(1);
      }

      expect(glide()).toBe('1000ms');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never waits so long that the bar looks frozen', () => {
    // A pulse once every four seconds is a piece slow enough that a faithful
    // glide would look like nothing happening at all.
    expect(healthGlideMs(120, 5_000, 1_000)).toBe(2_000);
  });
});

describe('measuring how long a press takes to arrive', () => {
  // Its own mount: this block sits outside the one the rest of the file
  // shares, and a rig with no page under it fails on the first element.
  beforeEach(() => {
    mountRealMarkup();
  });

  it('loads a piece with nothing in it but the beat', async () => {
    // One note, on every beat, one hand: whatever is left between the click
    // and the press is the journey, because the reader has been given
    // nothing else to get wrong.
    const rig = createRig();
    await rig.view.initialize();

    element<HTMLButtonElement>('latency-test').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const exercise = rig.runtime.controller.currentExercise;
    expect(exercise?.title).toBe('Measuring the delay');
    expect(exercise?.staves).toHaveLength(1);
    const pitches = (exercise?.staves[0]?.measures ?? []).flatMap((measure) =>
      measure.entries.flatMap((entry) => (entry.kind === 'note' ? entry.pitches : [])),
    );
    expect(pitches).toHaveLength(16);
    expect(new Set(pitches.map((pitch) => pitch.toString()))).toEqual(new Set(['C4']));
  });

  it('sets what the measurement needs, and says that it did', async () => {
    // They are the reader's settings and they will find them changed.
    const rig = createRig();
    await rig.view.initialize();
    rig.runtime.controller.updateSettings({
      modeId: new WaitMode().id,
      clickOn: false,
      countInBars: 0,
    });

    element<HTMLButtonElement>('latency-test').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rig.runtime.controller.settings.modeId).toBe(FLOW_MODE_ID);
    expect(rig.runtime.controller.settings.clickWhen).toBe('always');
    expect(rig.runtime.controller.settings.countInBars).toBeGreaterThan(0);
    expect(element('latency-description').textContent).toContain('every click');
  });

  it('offers what the calibration run measured, and applies it', async () => {
    // The reader's own path: press the test button, play the piece a little
    // behind the beat, and ask for the number back.
    const rig = createRig();
    await rig.view.initialize();
    // Repeat left on, which is a thing a reader does and a thing that used to
    // take the measurement away: the finished run was replaced by a fresh one
    // before they could press the button, and the button then did nothing.
    rig.runtime.controller.updateSettings({ repeatRange: true });
    element<HTMLButtonElement>('latency-test').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const session = rig.runtime.controller.start();
    expect(session).not.toBeNull();
    // One bar of count-in at 80 bpm, one tick to the beat.
    rig.metronome.advanceSubdivisions(4);

    for (let beat = 0; beat < 16; beat += 1) {
      rig.metronome.advanceSubdivisions(1);
      rig.clock.set(rig.clock.now() + 120);
      rig.midi.noteOn(60, rig.clock.now());
      rig.clock.set(rig.clock.now() - 120);
    }
    rig.metronome.advanceSubdivisions(2);

    expect(session?.status).toBe('completed');
    expect(session?.report?.timing.deviations.length).toBeGreaterThanOrEqual(8);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const button = element<HTMLButtonElement>('latency-measure');
    expect(button.disabled).toBe(false);

    button.click();

    expect(rig.runtime.controller.settings.inputLatencyMs).toBe(120);
  });

  it('settles in one press, because what is measured is what is left over', async () => {
    // A run measures the residue after the delay already set, so the two add.
    // Replacing one with the other threw the answer away each time it was
    // found: pressing repeatedly went 0, 120, -100, 105, -90, 95, converging
    // by the reader's patience rather than by arithmetic.
    const rig = createRig();
    await rig.view.initialize();
    rig.runtime.controller.updateSettings({ inputLatencyMs: 80 });
    element<HTMLButtonElement>('latency-test').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const session = rig.runtime.controller.start();
    rig.metronome.advanceSubdivisions(4);
    for (let beat = 0; beat < 16; beat += 1) {
      rig.metronome.advanceSubdivisions(1);
      // A hundred and twenty milliseconds late on the wall clock, of which
      // eighty is already being taken off, so forty is left over.
      rig.clock.set(rig.clock.now() + 120);
      rig.midi.noteOn(60, rig.clock.now());
      rig.clock.set(rig.clock.now() - 120);
    }
    rig.metronome.advanceSubdivisions(2);
    expect(session?.status).toBe('completed');
    expect(element('latency-measure').textContent).toContain('120 ms');

    element<HTMLButtonElement>('latency-measure').click();

    // The whole of it in one press, not the leftover in place of the whole.
    expect(rig.runtime.controller.settings.inputLatencyMs).toBe(120);
  });

  it('remembers the delay across a visit, which is the point of measuring it', async () => {
    const store = new InMemorySettingsStore();
    const first = createRig(undefined, store);
    await first.view.initialize();
    first.runtime.controller.updateSettings({ inputLatencyMs: 300 });
    await Promise.resolve();

    mountRealMarkup();
    const second = createRig(undefined, store);
    await second.view.initialize();

    expect(second.runtime.controller.settings.inputLatencyMs).toBe(300);
    expect(element<HTMLInputElement>('latency').value).toBe('300');
  });

  it('judges a press by the delay a previous visit measured', async () => {
    // The whole point of keeping it: the number is no use unless the run that
    // comes after the reload is the one it corrects.
    const store = new InMemorySettingsStore();
    const first = createRig(undefined, store);
    await first.view.initialize();
    const slider = element<HTMLInputElement>('latency');
    slider.value = '300';
    slider.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    mountRealMarkup();
    const rig = createRig(undefined, store);
    await rig.view.initialize();
    rig.runtime.controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
    const session = rig.runtime.controller.start();
    const judged: (number | null)[] = [];
    session?.events.on('noteJudged', (event) => judged.push(event.deviationMs));
    rig.metronome.advanceSubdivisions(1);
    const due = session?.currentStep?.expectedMidi ?? [];
    expect(due.length).toBeGreaterThan(0);

    // Played three hundred milliseconds after the beat, which is exactly how
    // long this reader's keyboard takes to be heard about.
    rig.clock.set(rig.clock.now() + 300);
    for (const midi of due) {
      rig.midi.noteOn(midi, rig.clock.now());
    }

    expect(rig.runtime.controller.settings.inputLatencyMs).toBe(300);
    // Judged as dead on the beat, which is where the key actually went down.
    expect(judged[0]).toBe(0);
  });

  it('holds a delay past the old ceiling, since a relay can cost that much', async () => {
    // Three hundred was the first ceiling and a reader measured exactly that,
    // which is what a ceiling looks like from underneath.
    const store = new InMemorySettingsStore();
    const first = createRig(undefined, store);
    await first.view.initialize();
    first.runtime.controller.updateSettings({ inputLatencyMs: 480 });
    await Promise.resolve();

    mountRealMarkup();
    const second = createRig(undefined, store);
    await second.view.initialize();

    expect(second.runtime.controller.settings.inputLatencyMs).toBe(480);
  });
});

describe('what the device keeps', () => {
  beforeEach(() => {
    mountRealMarkup();
  });

  it('weighs what is kept when its pane is opened, and not before', async () => {
    // Settings -> Storage. His, of iOS: a bar of what is kept, and a legend
    // under it. Whether there is room and what is taking it is a question the
    // reader asks; the page does not ask it for them.
    const { view } = createRig();
    await view.initialize();
    const legend = element<HTMLUListElement>('storage-legend');
    element<HTMLButtonElement>('focus-settings').click();
    expect(legend.children).toHaveLength(0);

    document.querySelector<HTMLButtonElement>('button[data-chooses="library"]')?.click();
    await waitFor(() => legend.children.length > 0);

    expect(element('storage-total').textContent).toBe('42.0 MB / 100 GB');
    // Biggest first, the rest of the total as a part of its own, and the
    // room left closing the bar.
    expect([...legend.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Piano sound20.0 MB',
      'Scores12.0 MB · 98',
      'Other10.0 MB',
      'Free100.0 GB',
    ]);
    const bar = [...element('storage-bar').children] as HTMLElement[];
    expect(bar.map((part) => part.dataset['kind'])).toEqual(['sound', 'scores', 'other', 'free']);
    expect(parseFloat(bar[0]?.style.width ?? '')).toBeCloseTo((20 / (100 * 1024)) * 100, 6);
    expect(element('storage-kept').textContent).toContain('Home Screen');
  });
});

describe('the theme', () => {
  const root = document.documentElement;
  /** What the page says of the theme, on the root the stylesheet reads. */
  const said = (): { theme: string | undefined; darkSystem: string | undefined } => ({
    theme: root.dataset['theme'],
    darkSystem: root.dataset['darkSystem'],
  });
  const choose = (id: string, value: string): void => {
    const select = element<HTMLSelectElement>(id);
    select.value = value;
    select.dispatchEvent(new Event('change'));
  };

  beforeEach(() => {
    mountRealMarkup();
    delete root.dataset['theme'];
    delete root.dataset['darkSystem'];
    window.localStorage.clear();
  });

  it("offers four themes in the appearance settings, the system's first", async () => {
    const { view } = createRig();
    await view.initialize();
    const select = element<HTMLSelectElement>('theme');

    expect(select.closest('[data-pane~="appearance"]')).not.toBeNull();
    expect([...select.options].map((option) => option.value)).toEqual([...THEMES]);
    expect(THEMES).toEqual(['system', 'light', 'light-dark-dialogs', 'dark']);
    expect(select.value).toBe('system');
    expect(said()).toEqual({ theme: 'system', darkSystem: 'dark' });
  });

  it('says what System becomes while the system is dark, from the two with dark dialogs', async () => {
    const { view, runtime } = createRig();
    await view.initialize();
    const select = element<HTMLSelectElement>('dark-system-theme');

    expect(select.closest('[data-pane~="appearance"]')).not.toBeNull();
    expect([...select.options].map((option) => option.value)).toEqual(['dark', 'light-dark-dialogs']);
    // Named as the night, and saying underneath what decides it.
    expect(document.querySelector('label[for="dark-system-theme"]')?.textContent).toBe('Night theme');
    expect(select.closest('.control-group')?.querySelector('.hint')?.textContent).toContain('system is dark');

    choose('dark-system-theme', 'light-dark-dialogs');

    expect(runtime.controller.settings.darkSystemTheme).toBe('light-dark-dialogs');
    expect(said().darkSystem).toBe('light-dark-dialogs');
  });

  it('dims what System becomes while the theme is not System, and says why', async () => {
    const { view } = createRig();
    await view.initialize();
    const carrier = element('dark-system-theme').closest<HTMLElement>('.control-group');

    expect(carrier?.dataset['idle']).toBeUndefined();

    choose('theme', 'light');

    expect(carrier?.dataset['idle']).toBe('true');
    expect(carrier?.title).toContain('System');
    // Dimmed and not disabled: an answer may be given before it is used.
    expect(element<HTMLSelectElement>('dark-system-theme').disabled).toBe(false);

    choose('theme', 'system');
    expect(carrier?.dataset['idle']).toBeUndefined();
  });

  it('says each theme chosen on the root', async () => {
    const { view, runtime } = createRig();
    await view.initialize();

    for (const theme of THEMES) {
      choose('theme', theme);

      expect(runtime.controller.settings.theme).toBe(theme);
      expect(said().theme).toBe(theme);
    }
  });

  it('puts the theme chosen back when the page opens again', async () => {
    const store = new InMemorySettingsStore();
    const first = createRig(undefined, store);
    await first.view.initialize();
    choose('theme', 'light-dark-dialogs');
    choose('dark-system-theme', 'light-dark-dialogs');

    mountRealMarkup();
    delete root.dataset['theme'];
    delete root.dataset['darkSystem'];
    const second = createRig(undefined, store);
    await second.view.initialize();

    expect(said()).toEqual({ theme: 'light-dark-dialogs', darkSystem: 'light-dark-dialogs' });
    expect(element<HTMLSelectElement>('theme').value).toBe('light-dark-dialogs');
  });

  it('is said before the first paint exactly as the program says it, for every choice', async () => {
    // The script in the head copies the two choices from where the settings
    // are kept, before the program has read them. Run against what the
    // program itself wrote, it must leave the root as the program would.
    const script = /<script id="theme-before-paint">([\s\S]*?)<\/script>/.exec(INDEX_HTML)?.[1] ?? '';
    expect(script).not.toBe('');
    const runTheScript = new Function(script) as () => void;

    for (const theme of THEMES) {
      for (const darkSystem of DARK_SYSTEM_THEMES) {
        mountRealMarkup();
        window.localStorage.clear();
        const store = new InMemorySettingsStore();
        const { view } = createRig(undefined, store);
        await view.initialize();
        choose('theme', theme);
        choose('dark-system-theme', darkSystem);
        view.dispose();
        const byTheProgram = said();
        // Kept where the browser keeps it, by the store the program uses there.
        new LocalStorageSettingsStore(window.localStorage, DEFAULT_STORAGE_KEY).write(store.read());

        delete root.dataset['theme'];
        delete root.dataset['darkSystem'];
        runTheScript();

        expect(said(), `${theme} / ${darkSystem}`).toEqual(byTheProgram);
      }
    }
  });

  it('leaves the system its theme when nothing readable is kept', () => {
    const script = /<script id="theme-before-paint">([\s\S]*?)<\/script>/.exec(INDEX_HTML)?.[1] ?? '';
    const runTheScript = new Function(script) as () => void;

    for (const kept of [null, '{not json', JSON.stringify({ practice: { theme: 'sepia', darkSystemTheme: 'light' } })]) {
      window.localStorage.clear();
      if (kept !== null) {
        window.localStorage.setItem(DEFAULT_STORAGE_KEY, kept);
      }
      runTheScript();

      expect(said(), String(kept)).toEqual({ theme: undefined, darkSystem: undefined });
    }
  });
});

describe('a key in rhythm only', () => {
  beforeEach(() => {
    mountRealMarkup();
  });

  it('sounds as itself, the written notes being nobody else to sound', async () => {
    // A run could once sound the notes written at the beat in place of the
    // key tapped; that is gone, and the key is heard as on any other run.
    const rig = createRig();
    await rig.view.initialize();
    await rig.runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    rig.runtime.controller.updateSettings({ rhythmOnly: true, hearTheOtherHand: false });
    rig.runtime.controller.start();

    rig.midi.noteOn(MIDI.G4);

    const heard = rig.instrument.played.map((note) => note.midi);
    expect(heard).toEqual([MIDI.G4]);
  });
});

describe('the library on Google Drive', () => {
  beforeEach(() => {
    mountRealMarkup();
  });

  it('fetches what signing in needs when the library pane opens, not on the press', async () => {
    // Google's window opens only in answer to a press, and a press that has
    // to fetch Google's library first has lost the press by the time it asks.
    const rig = createRig();
    await rig.view.initialize();

    document.querySelector<HTMLButtonElement>('button[data-chooses="library"]')?.click();

    expect(rig.drive.prepared).toBe(1);
  });

  it('syncs from the button, and brings a score only the drive has when asked', async () => {
    // His: a new device connects the drive and takes the scores from it.
    const rig = createRig();
    await rig.view.initialize();
    await rig.drive.write('City of Tears.musicxml', '<score/>', null);
    await rig.drive.write(
      'library.json',
      JSON.stringify({
        version: 1,
        scores: [
          {
            id: 'score:City of Tears',
            title: 'City of Tears',
            bars: 8,
            savedAtMs: 1_000,
            openedAtMs: 1_000,
            markedAtMs: 2_000,
            passages: [],
            stars: 4,
            file: 'City of Tears.musicxml',
          },
        ],
      }),
      null,
    );

    element<HTMLButtonElement>('drive-sync').click();
    await waitFor(() => element('drive-status').textContent?.startsWith('Synced') === true);

    const only = element<HTMLUListElement>('drive-only');
    expect(only.hidden).toBe(false);
    expect(only.textContent).toContain('City of Tears');
    expect(await rig.scoreStore.read('score:City of Tears')).toBeNull();

    only.querySelector<HTMLButtonElement>('button')?.click();
    await waitFor(() => only.hidden === true);

    expect((await rig.scoreStore.read('score:City of Tears'))?.stars).toBe(4);
  });

  it('offers a score only the drive has by two icons, and takes it off the drive when the word is typed', async () => {
    const rig = createRig();
    await rig.view.initialize();
    const offeredScore = (title: string, at: number) => ({
      id: `score:${title}`,
      title,
      bars: 8,
      savedAtMs: 1_000,
      openedAtMs: 1_000 + at,
      markedAtMs: 2_000,
      passages: [],
      file: `${title}.musicxml`,
    });
    await rig.drive.write('City of Tears.musicxml', '<score/>', null);
    await rig.drive.write('Clair de Lune.musicxml', '<score/>', null);
    await rig.drive.write(
      'library.json',
      JSON.stringify({ version: 1, scores: [offeredScore('City of Tears', 0), offeredScore('Clair de Lune', 1)] }),
      null,
    );
    element<HTMLButtonElement>('drive-sync').click();
    await waitFor(() => element('drive-status').textContent?.startsWith('Synced') === true);
    const only = element<HTMLUListElement>('drive-only');
    const rowOf = (title: string): HTMLLIElement | undefined =>
      [...only.querySelectorAll('li')].find((row) => row.textContent?.includes(title) === true);
    const buttonsOf = (title: string): HTMLButtonElement[] => [...(rowOf(title)?.querySelectorAll('button') ?? [])];

    // Two icons and no words, each saying what it does in its title and to a screen reader.
    expect(buttonsOf('City of Tears').map((button) => [button.title, button.getAttribute('aria-label'), button.textContent])).toEqual([
      ['Bring here', 'Bring City of Tears here', ''],
      ['Delete from the drive', 'Delete City of Tears from the drive', ''],
    ]);
    expect(buttonsOf('City of Tears').every((button) => button.querySelector('svg path') !== null)).toBe(true);

    // Asked for in words; cancelled, it stays.
    buttonsOf('City of Tears')[1]?.click();
    expect(element('confirm-text').textContent).toBe(
      'Delete City of Tears from the drive? A device that still has it will send it back at its next sync. Type DELETE to confirm.',
    );
    element<HTMLButtonElement>('confirm-no').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rig.drive.files.has('City of Tears.musicxml')).toBe(true);
    // Typed, it goes: off the drive's list, its document into the bin, and off the list here.
    buttonsOf('City of Tears')[1]?.click();
    await confirmByTyping();
    await waitFor(() => rowOf('City of Tears') === undefined);
    expect(rig.drive.files.has('City of Tears.musicxml')).toBe(false);
    expect(rig.drive.files.get('library.json')?.content).not.toContain('City of Tears');
    expect(only.hidden).toBe(false);
    expect(await rig.scoreStore.read('score:City of Tears')).toBeNull();

    // Refused by the drive, it says so, and both can be pressed again.
    const write = rig.drive.write.bind(rig.drive);
    rig.drive.write = () => Promise.reject(new Error('The drive refused it.'));
    buttonsOf('Clair de Lune')[1]?.click();
    await confirmByTyping();
    await waitFor(() => element('drive-status').textContent === 'The drive refused it.');
    expect(buttonsOf('Clair de Lune').map((button) => button.disabled)).toEqual([false, false]);
    rig.drive.write = write;
    // The last gone, the list goes.
    buttonsOf('Clair de Lune')[1]?.click();
    await confirmByTyping();
    await waitFor(() => only.hidden === true);
  });

  it('offers from the button the sketches only the drive has, brings one here when asked, and leaves the one open as it is', async () => {
    const rig = createRig();
    await rig.view.initialize();
    // Another device, on the same drive.
    const other = new SketchLibrary(new InMemorySettingsStore(), () => 1);
    const otherSync = new SketchSync({ drive: rig.drive, sketches: other });
    const played = [
      { kind: 'noteOn' as const, atMs: 0, midi: 60, velocity: 0.5 },
      { kind: 'noteOff' as const, atMs: 400, midi: 60 },
    ];
    const beats = [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 }));
    const theirs = other.begin({ events: played, beats }, 'From the iPad', 5);
    await otherSync.sync(null);
    const offered = element<HTMLUListElement>('drive-only-sketches');
    const said = element('drive-only-sketches-said');
    expect([offered.hidden, said.hidden]).toEqual([true, true]);

    element<HTMLButtonElement>('drive-sync').click();
    await waitFor(() => element('drive-status').textContent?.startsWith('Synced') === true);
    expect(element('drive-status').textContent).toContain('Sketches sent 0, brought here 0.');
    expect([offered.hidden, said.hidden]).toEqual([false, false]);
    expect(offered.textContent).toContain('From the iPad · 1 notes');
    expect(rig.sketches.list()).toEqual([]);

    // Brought when asked, into the list of sketches open on the page.
    element<HTMLButtonElement>('focus-scores').click();
    element<HTMLButtonElement>('scores-show-sketches').click();
    offered.querySelector<HTMLButtonElement>('button')?.click();
    await waitFor(() => offered.hidden === true);
    expect(said.hidden).toBe(true);
    expect(element('sketches-list').textContent).toContain('From the iPad');

    // Renamed on the other device while it is open here: left as it is.
    other.rename(theirs.id, 'Renamed on the iPad');
    await otherSync.sync(null);
    rowButton('sketches-list', 'Edit this sketch').click();
    element('drive-status').textContent = '';
    element<HTMLButtonElement>('drive-sync').click();
    await waitFor(() => element('drive-status').textContent?.startsWith('Synced') === true);
    expect(rig.sketches.find(theirs.id)?.title).toBe('From the iPad');
    // Shut, it is open no longer, and is taken.
    element<HTMLButtonElement>('roll-close').click();
    element('drive-status').textContent = '';
    element<HTMLButtonElement>('drive-sync').click();
    await waitFor(() => element('drive-status').textContent?.startsWith('Synced') === true);
    expect(element('drive-status').textContent).toContain('Sketches sent 0, brought here 1.');
    expect(rig.sketches.find(theirs.id)?.title).toBe('Renamed on the iPad');
    expect(element('sketches-list').textContent).toContain('Renamed on the iPad');
  });

  it('takes a sketch offered off the drive when the word is typed, and says so where it cannot', async () => {
    const rig = createRig();
    await rig.view.initialize();
    const other = new SketchLibrary(new InMemorySettingsStore(), () => 1);
    const played = [
      { kind: 'noteOn' as const, atMs: 0, midi: 60, velocity: 0.5 },
      { kind: 'noteOff' as const, atMs: 400, midi: 60 },
    ];
    const beats = [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 }));
    other.begin({ events: played, beats }, 'Unwanted', 5);
    other.begin({ events: played, beats }, 'Wanted', 4);
    await new SketchSync({ drive: rig.drive, sketches: other }).sync(null);
    element<HTMLButtonElement>('drive-sync').click();
    await waitFor(() => element('drive-status').textContent?.startsWith('Synced') === true);
    const offered = element<HTMLUListElement>('drive-only-sketches');
    const rowOf = (title: string): HTMLLIElement | undefined =>
      [...offered.querySelectorAll('li')].find((row) => row.textContent?.includes(title) === true);
    const removeOf = (title: string): HTMLButtonElement | null | undefined =>
      [...(rowOf(title)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
        (button) => button.title === 'Delete from the drive',
      );
    const onTheDrive = async (): Promise<string[]> =>
      [...(await new SketchSync({ drive: rig.drive, sketches: new SketchLibrary(new InMemorySettingsStore(), () => 1) }).sync(null)).onlyOnTheDrive].map(
        ({ title }) => title,
      );

    // Asked for in words, and refused without them.
    removeOf('Unwanted')?.click();
    expect(element('confirm-text').textContent).toBe(
      'Delete Unwanted from the drive? A device that still has it will send it back at its next sync. Type DELETE to confirm.',
    );
    await confirmDeletion();
    expect(await onTheDrive()).toEqual(['Unwanted', 'Wanted']);
    // Cancelled, it stays.
    element<HTMLButtonElement>('confirm-no').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(removeOf('Unwanted')?.disabled).toBe(false);
    expect(await onTheDrive()).toEqual(['Unwanted', 'Wanted']);
    removeOf('Unwanted')?.click();
    await confirmByTyping();
    await waitFor(() => rowOf('Unwanted') === undefined);
    expect(await onTheDrive()).toEqual(['Wanted']);
    expect(offered.hidden).toBe(false);
    // Refused by the drive, it says so and can be asked again.
    const write = rig.drive.write.bind(rig.drive);
    rig.drive.write = () => Promise.reject(new Error('The drive refused it.'));
    removeOf('Wanted')?.click();
    await confirmByTyping();
    await waitFor(() => element('drive-status').textContent === 'The drive refused it.');
    expect(removeOf('Wanted')?.disabled).toBe(false);
    expect(rowOf('Wanted')?.querySelector<HTMLButtonElement>('button')?.disabled).toBe(false);
    rig.drive.write = write;
    // The last gone, the list and its line go.
    removeOf('Wanted')?.click();
    await confirmByTyping();
    await waitFor(() => offered.hidden === true);
    expect(element('drive-only-sketches-said').hidden).toBe(true);
    expect(await onTheDrive()).toEqual([]);
    expect(rig.sketches.list()).toEqual([]);
  });

  it('says so where a sketch offered is no longer on the drive when it is asked for', async () => {
    const rig = createRig();
    await rig.view.initialize();
    const other = new SketchLibrary(new InMemorySettingsStore(), () => 1);
    other.begin(
      {
        events: [
          { kind: 'noteOn' as const, atMs: 0, midi: 60, velocity: 0.5 },
          { kind: 'noteOff' as const, atMs: 400, midi: 60 },
        ],
        beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
      },
      'Fleeting',
      5,
    );
    await new SketchSync({ drive: rig.drive, sketches: other }).sync(null);
    element<HTMLButtonElement>('drive-sync').click();
    await waitFor(() => element('drive-status').textContent?.startsWith('Synced') === true);

    await rig.drive.write('sketches.json', JSON.stringify({ version: 1, sketches: [] }), null);
    const bring = element('drive-only-sketches').querySelector<HTMLButtonElement>('button');
    bring?.click();
    await waitFor(() => element('drive-status').textContent === 'That sketch is no longer on the drive.');
    expect(bring?.disabled).toBe(false);
    expect(element('drive-only-sketches').hidden).toBe(false);
    expect(rig.sketches.list()).toEqual([]);
  });

  it('says where a sync kept a copy of a sketch changed on two devices at once, and says nothing of copies where none was kept', async () => {
    const rig = createRig();
    await rig.view.initialize();
    const other = new SketchLibrary(new InMemorySettingsStore(), () => 1);
    const otherSync = new SketchSync({ drive: rig.drive, sketches: other });
    const played = [
      { kind: 'noteOn' as const, atMs: 0, midi: 60, velocity: 0.5 },
      { kind: 'noteOff' as const, atMs: 400, midi: 60 },
    ];
    const beats = [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 }));
    const both = other.begin({ events: played, beats }, 'Both', 6);
    await otherSync.sync(null);
    await rig.runtime.sketchSync.bringHere(both.id);
    element<HTMLButtonElement>('drive-sync').click();
    await waitFor(() => element('drive-status').textContent?.startsWith('Synced') === true);
    expect(element('drive-status').textContent).not.toContain('copy');

    other.rename(both.id, 'Both, there');
    await otherSync.sync(null);
    rig.sketches.rename(both.id, 'Both, here');
    element('drive-status').textContent = '';
    element<HTMLButtonElement>('drive-sync').click();
    await waitFor(() => element('drive-status').textContent?.startsWith('Synced') === true);

    expect(element('drive-status').textContent).toContain(
      'Sketches sent 1, brought here 1; 1 changed on two devices at once, kept here as a conflicting copy beside the other.',
    );
    expect(rig.sketches.list().map((sketch) => sketch.title).sort()).toEqual([
      'Both, here (conflicting copy)',
      'Both, there',
    ]);
  });

  it('shows in the open drawer the chords a sync brought from another device', async () => {
    const rig = createRig();
    await rig.view.initialize();
    rig.sketches.begin(
      {
        events: [
          { kind: 'noteOn' as const, atMs: 2_000, midi: 60, velocity: 0.5 },
          { kind: 'noteOff' as const, atMs: 2_400, midi: 60 },
        ],
        beats: [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 })),
      },
      'Synced chords',
      1,
    );
    element<HTMLButtonElement>('focus-scores').click();
    element<HTMLButtonElement>('scores-show-sketches').click();
    rowButton('sketches-list', 'Edit this sketch').click();
    element<HTMLButtonElement>('roll-chords-open').click();
    const names = (): string[] =>
      [...element('roll-chords-list').querySelectorAll('.roll-chords__chord--kept .roll-chords__name')].map(
        (name) => name.textContent ?? '',
      );
    expect(names()).toEqual([]);

    const other = new SketchLibrary(new InMemorySettingsStore(), () => 1);
    other.keepTheChord([57, 60, 64]);
    await new SketchSync({ drive: rig.drive, sketches: other }).sync(null);
    element<HTMLButtonElement>('drive-sync').click();
    await waitFor(() => element('drive-status').textContent?.startsWith('Synced') === true);
    expect(names()).toEqual(['Am']);
  });

  it('says what went wrong rather than nothing', async () => {
    const rig = createRig();
    await rig.view.initialize();
    rig.drive.connect = () => Promise.reject(new Error('Google could not be reached.'));

    element<HTMLButtonElement>('drive-sync').click();
    await waitFor(() => element('drive-status').textContent === 'Google could not be reached.');

    expect(element<HTMLButtonElement>('drive-sync').disabled).toBe(false);
  });

  it('offers a sign-in by code only where the build has the client for it', async () => {
    const without = createRig();
    await without.view.initialize();
    expect(element('drive-code').hidden).toBe(true);

    const rig = createRig();
    rig.drive.available = true;
    await rig.view.initialize();
    expect(element('drive-code').hidden).toBe(false);
  });

  it('shows the code while it waits, and syncs once it is entered', async () => {
    const rig = createRig();
    rig.drive.available = true;
    let entered = (): void => undefined;
    rig.drive.signInWithCode = (show) => {
      show({ code: 'ABCD-EFGH', url: 'https://www.google.com/device' });
      return new Promise<void>((done) => {
        entered = done;
      });
    };
    await rig.view.initialize();

    element<HTMLButtonElement>('drive-code').click();
    await waitFor(() => element('drive-status').textContent?.includes('ABCD-EFGH') === true);
    expect(element('drive-status').textContent).toContain('https://www.google.com/device');
    expect(element<HTMLButtonElement>('drive-code').disabled).toBe(true);

    entered();
    await waitFor(() => element('drive-status').textContent?.startsWith('Synced') === true);
    expect(element<HTMLButtonElement>('drive-code').disabled).toBe(false);
  });

  it('says why a sign-in by code did not happen, and syncs nothing', async () => {
    const rig = createRig();
    rig.drive.available = true;
    let connected = 0;
    rig.drive.connect = () => {
      connected += 1;
      return Promise.resolve();
    };
    rig.drive.signInWithCode = () => Promise.reject(new Error('The sign-in was refused on the other device.'));
    await rig.view.initialize();

    element<HTMLButtonElement>('drive-code').click();
    await waitFor(
      () => element('drive-status').textContent === 'The sign-in was refused on the other device.',
    );

    expect(connected).toBe(0);
    expect(element<HTMLButtonElement>('drive-code').disabled).toBe(false);
  });
});

describe('a Sync button by the clock', () => {
  beforeEach(() => {
    mountRealMarkup();
  });

  it('stays away unless asked, whatever there is to send', async () => {
    const rig = createRig();
    await rig.view.initialize();
    await rig.runtime.scores.keep(twoBarExercise({ title: 'Clair de Lune' }), Date.now());

    rig.runtime.controller.updateSettings({ offerToSync: false });

    expect(element<HTMLButtonElement>('score-sync').hidden).toBe(true);
  });

  it('stands by the clock when asked and something is new, and goes once synced', async () => {
    // His: a button beside the clock when there is something to sync, and
    // only if he has turned it on.
    const rig = createRig();
    await rig.view.initialize();
    await rig.runtime.scores.keep(twoBarExercise({ title: 'Clair de Lune' }), Date.now());

    rig.runtime.controller.updateSettings({ offerToSync: true });
    const button = element<HTMLButtonElement>('score-sync');
    expect(button.hidden).toBe(false);

    button.click();
    await waitFor(() => button.hidden === true);

    expect(rig.drive.files.has('Clair de Lune.musicxml')).toBe(true);
  });

  it('keeps the button up and says so when the sync fails', async () => {
    const rig = createRig();
    await rig.view.initialize();
    await rig.runtime.scores.keep(twoBarExercise({ title: 'Clair de Lune' }), Date.now());
    rig.runtime.controller.updateSettings({ offerToSync: true });
    rig.drive.connect = () => Promise.reject(new Error('Google could not be reached.'));

    element<HTMLButtonElement>('score-sync').click();
    await waitFor(() => element('score-sync-text').textContent === 'Sync failed');

    expect(element<HTMLButtonElement>('score-sync').hidden).toBe(false);
    expect(element<HTMLButtonElement>('score-sync').title).toBe('Google could not be reached.');
  });
});

describe('the Sync button pressing itself', () => {
  beforeEach(() => {
    mountRealMarkup();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A rig signed in to its drive, with a score kept and the button asked for. */
  async function signedInWithAScoreToSend(): Promise<ReturnType<typeof createRig>> {
    const rig = createRig();
    rig.drive.signedIn = true;
    await rig.view.initialize();
    await rig.runtime.scores.keep(twoBarExercise({ title: 'Clair de Lune' }), Date.now());
    rig.runtime.controller.updateSettings({ offerToSync: true });
    return rig;
  }

  it('presses itself half a minute after the last change', async () => {
    // His: "я хочу щоб ця кнопка сама натискалася 30 секунд".
    const rig = await signedInWithAScoreToSend();
    const button = element<HTMLButtonElement>('score-sync');
    expect(button.hidden).toBe(false);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(rig.drive.files.has('Clair de Lune.musicxml')).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => {
      expect(rig.drive.files.has('Clair de Lune.musicxml')).toBe(true);
    });
    expect(button.hidden).toBe(true);
  });

  it('waits for half a minute of quiet, so a run of changes goes together', async () => {
    const rig = await signedInWithAScoreToSend();

    await vi.advanceTimersByTimeAsync(20_000);
    rig.runtime.controller.updateSettings({ previewSeconds: 3 });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(rig.drive.files.has('Clair de Lune.musicxml')).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => {
      expect(rig.drive.files.has('Clair de Lune.musicxml')).toBe(true);
    });
  });

  it('says it is syncing on the button while it does, and how far it has got', async () => {
    const rig = await signedInWithAScoreToSend();
    let answer: (files: readonly CloudFile[]) => void = () => undefined;
    const list = rig.drive.list.bind(rig.drive);
    rig.drive.list = () =>
      new Promise((resolve) => {
        answer = resolve;
      });
    let written: () => void = () => undefined;
    const write = rig.drive.write.bind(rig.drive);
    rig.drive.write = (name, content, replacing) =>
      new Promise((resolve) => {
        written = () => {
          rig.drive.write = write;
          resolve(write(name, content, replacing));
        };
      });

    await vi.advanceTimersByTimeAsync(31_000);

    const button = element<HTMLButtonElement>('score-sync');
    expect(button.hidden).toBe(false);
    expect(element('score-sync-text').textContent).toBe('Syncing…');
    expect(button.dataset['sync']).toBe('syncing');
    // Before the drive has said what it holds, there is no knowing how much there is to do.
    expect(button.dataset['syncMeasured']).toBe('false');
    expect(button.style.getPropertyValue('--sync-share')).toBe('');
    expect(element('drive-status').textContent).toBe('Syncing…');

    // An empty folder: the score to send, the list written and the folder
    // listed again, and the settings and the sketches as much as they can
    // ask - one of twelve answered.
    rig.drive.list = list;
    answer([]);
    await vi.waitFor(() => {
      expect(button.dataset['syncMeasured']).toBe('true');
    });
    expect(button.style.getPropertyValue('--sync-share')).toBe((1 / 12).toFixed(3));
    expect(element('drive-status').textContent).toBe('Syncing… 8%');

    written();
    await vi.waitFor(() => {
      expect(element('drive-status').textContent).toMatch(/^Synced\./);
    });
    // Done, the edge is the button's own again.
    expect(button.dataset['syncMeasured']).toBeUndefined();
    expect(button.style.getPropertyValue('--sync-share')).toBe('');
  });

  it('waits for a press, and says so, where Google would have to be asked', async () => {
    // Signing in opens Google's window, and a browser allows that only in
    // answer to a press. His: "якось помітити кнопку що auto sync не працює".
    const rig = await signedInWithAScoreToSend();
    rig.drive.signedIn = false;
    rig.runtime.controller.updateSettings({ previewSeconds: 3 });

    await vi.advanceTimersByTimeAsync(60_000);

    const button = element<HTMLButtonElement>('score-sync');
    expect(rig.drive.files.has('Clair de Lune.musicxml')).toBe(false);
    expect(button.hidden).toBe(false);
    expect(button.dataset['sync']).toBe('by-hand');
    expect(element('score-sync-text').textContent).toBe('Tap to sync');
  });

  it('does not try again on a change it failed on, and does on the next', async () => {
    const rig = await signedInWithAScoreToSend();
    let tries = 0;
    rig.drive.connect = () => {
      tries += 1;
      return Promise.reject(new Error('Google could not be reached.'));
    };

    await vi.advanceTimersByTimeAsync(31_000);
    await vi.waitFor(() => {
      expect(element('score-sync-text').textContent).toBe('Sync failed');
    });
    expect(tries).toBe(1);
    expect(element<HTMLButtonElement>('score-sync').dataset['sync']).toBe('by-hand');

    await vi.advanceTimersByTimeAsync(120_000);
    expect(tries).toBe(1);

    rig.runtime.controller.updateSettings({ previewSeconds: 3 });
    await vi.advanceTimersByTimeAsync(29_000);
    expect(tries).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(tries).toBe(2);
  });

  it('does not press itself where the button was not asked for', async () => {
    const rig = await signedInWithAScoreToSend();
    rig.runtime.controller.updateSettings({ offerToSync: false });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(rig.drive.files.has('Clair de Lune.musicxml')).toBe(false);
  });

  it('does not press itself in a run begun since it was set', async () => {
    // Set when the button stood by the clock, and due after a run has begun:
    // whether it may is asked when it goes off, not when it was set.
    const rig = await signedInWithAScoreToSend();
    await vi.advanceTimersByTimeAsync(2_000);
    // Any change the drive has not had, and not one that holds a run back.
    rig.runtime.controller.updateSettings({
      dimUnplayed: !rig.runtime.controller.settings.dimUnplayed,
    });
    await vi.advanceTimersByTimeAsync(29_000);
    element<HTMLButtonElement>('focus-play').click();
    expect(rig.runtime.controller.session).not.toBeNull();

    await vi.advanceTimersByTimeAsync(2_000);

    expect(rig.drive.files.has('Clair de Lune.musicxml')).toBe(false);
  });

  it('waits for a run to end, and then presses', async () => {
    // The corner's rule: over the music is not where anything but the music
    // belongs, and a sync is work the run would share the device with.
    const rig = await signedInWithAScoreToSend();
    element<HTMLButtonElement>('focus-play').click();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(rig.drive.files.has('Clair de Lune.musicxml')).toBe(false);

    element<HTMLButtonElement>('focus-stop').click();
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => {
      expect(rig.drive.files.has('Clair de Lune.musicxml')).toBe(true);
    });
  });
});

describe('the timings the last visit kept', () => {
  beforeEach(() => {
    mountRealMarkup();
  });

  it('shows them for developers the next time the page opens', async () => {
    // The last line is the last stage the page lived to reach.
    const rig = createRig();
    rig.trail.kept = ['[timing] +   0 ms   score asked for', '[timing] + 900 ms   engraver: file read'];

    await rig.view.initialize();

    expect(element('timing-trail').hidden).toBe(false);
    expect(element('timing-trail-lines').textContent).toBe(
      '[timing] +   0 ms   score asked for\n[timing] + 900 ms   engraver: file read',
    );
  });

  it('shows nothing where nothing was kept', async () => {
    const rig = createRig();
    await rig.view.initialize();

    expect(element('timing-trail').hidden).toBe(true);
  });

  it('keeps the timings while they are asked for, and not otherwise', async () => {
    const rig = createRig();
    await rig.view.initialize();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const box = element<HTMLInputElement>('trace-the-start');
    const tick = (on: boolean): void => {
      box.checked = on;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    };
    try {
      timeTheStart('score asked for');
      expect(rig.trail.kept).toEqual([]);

      tick(true);
      timeTheStart('score asked for');
      expect(rig.trail.kept.at(-1) ?? '').toContain('score asked for');

      tick(false);
      rig.trail.kept = [];
      timeTheStart('score asked for');
      expect(rig.trail.kept).toEqual([]);
    } finally {
      tick(false);
      vi.restoreAllMocks();
    }
  });
});

describe('searching the settings', () => {
  beforeEach(() => {
    mountRealMarkup();
  });

  function search(words: string): void {
    const input = element<HTMLInputElement>('settings-search');
    input.value = words;
    input.dispatchEvent(new Event('input'));
  }

  function press(shiftKey = false): void {
    element('settings-search').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey, bubbles: true }),
    );
  }

  const showing = (): string | undefined =>
    document.querySelector<HTMLElement>('#sheet-settings .sheet__panel')?.dataset['showing'];

  const count = (): string => element<HTMLOutputElement>('settings-search-count').value;

  it('goes to where the words are, opening the pane they are in', async () => {
    // His: search the settings and show where the words are. Usually in a
    // pane other than the one being looked at.
    const rig = createRig();
    await rig.view.initialize();
    expect(showing()).not.toBe('sound');

    search('piano samples');

    expect(count()).toBe('1 / 1');
    expect(showing()).toBe('sound');
  });

  it('goes on with Enter and back with Shift+Enter, round from the end', async () => {
    const rig = createRig();
    await rig.view.initialize();

    // Three or more, or a step back and a step on land in the same place.
    search('page');
    const total = Number(count().split(' / ')[1]);
    expect(total).toBeGreaterThan(2);

    press();
    expect(count()).toBe(`2 / ${String(total)}`);
    press(true);
    expect(count()).toBe(`1 / ${String(total)}`);
    press(true);
    expect(count()).toBe(`${String(total)} / ${String(total)}`);
  });

  it('says so where nothing matches, and nothing where nothing is typed', async () => {
    const rig = createRig();
    await rig.view.initialize();

    search('zzzz');
    expect(count()).toBe('None');

    search('');
    expect(count()).toBe('');
  });

  it('marks the findings, the one gone to more strongly, where the browser can', async () => {
    const highlights = new Map<string, { ranges: Range[] }>();
    const view = window as unknown as { CSS: unknown; Highlight: unknown };
    const hadCss = view.CSS;
    view.CSS = { highlights };
    view.Highlight = class {
      readonly ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    };
    try {
      const rig = createRig();
      await rig.view.initialize();

      search('cursor');

      const total = Number(count().split(' / ')[1]);
      expect(total).toBeGreaterThan(1);
      expect(highlights.get('settings-found')?.ranges).toHaveLength(total);
      expect(highlights.get('settings-found-here')?.ranges[0]?.toString().toLowerCase()).toBe('cursor');
    } finally {
      view.CSS = hadCss;
    }
  });
});

// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import type { CloudFile, ICloudDrive } from '../../src/application/ports/ICloudDrive.js';
import { LibrarySync } from '../../src/application/LibrarySync.js';
import { SettingsSync } from '../../src/application/SettingsSync.js';
import { DriveSync } from '../../src/application/DriveSync.js';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PracticeController } from '../../src/application/PracticeController.js';
import { FLOW_MODE_ID, FlowMode } from '../../src/application/modes/FlowMode.js';
import { PracticeModeRegistry } from '../../src/application/modes/PracticeModeRegistry.js';
import { BarMode, BAR_MODE_ID } from '../../src/application/modes/BarMode.js';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import { CLICK_WHEN } from '../../src/application/ports/IMetronome.js';
import { LISTEN_MODE_ID, knownFrameIds } from '../../src/application/modes/ListenFrame.js';
import type { AppRuntime } from '../../src/composition/createApp.js';
import { ExercisePresetRegistry } from '../../src/domain/generation/ExercisePresetRegistry.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';
import { PracticeLadder } from '../../src/application/ladder/PracticeLadder.js';
import { PerformanceRecorder } from '../../src/application/PerformanceRecorder.js';
import { ControlBinding } from '../../src/application/ControlBinding.js';
import { TakeLibrary } from '../../src/application/TakeLibrary.js';
import { TakePlayer } from '../../src/application/TakePlayer.js';
import { BackupService } from '../../src/application/Backup.js';
import { ScoreLibrary } from '../../src/application/ScoreLibrary.js';
import { InMemoryScoreStore } from '../../src/application/ports/IScoreStore.js';
import { TimeToday } from '../../src/application/TimeToday.js';
import { PracticeHistory } from '../../src/application/PracticeHistory.js';
import {
  beatsWorthMarking,
  rollBeganAtMs,
  theMusicsBeats,
} from '../../src/application/session/RunRoll.js';
import { RecordingFileSink } from '../../src/application/ports/IFileSink.js';
import { BUILT_IN_LADDER } from '../../src/application/ladder/ladderSteps.js';

import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import {
  AccuracyScoringStrategy,
  ContinuityScoringStrategy,
  TimingWeightedScoringStrategy,
} from '../../src/domain/scoring/strategies.js';
import { ScoringStrategyRegistry } from '../../src/domain/scoring/ScoringStrategyRegistry.js';
import { DomScoreImporter } from '../../src/infrastructure/notation/DomScoreImporter.js';
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
  longExercise,
  offBeatAfterALongNote,
  oneHandWalksUnderAHeldNote,
  p,
  twoBarExercise,
} from '../support/fixtures.js';

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
  readonly takes: TakeLibrary;
  readonly scores: ScoreLibrary;
  readonly scoreStore: InMemoryScoreStore;
  readonly files: RecordingFileSink;
  readonly drive: FolderDrive;
}

/** A drive folder held in memory, standing in for Google's. */
class FolderDrive implements ICloudDrive {
  readonly files = new Map<string, { id: string; content: string }>();
  prepared = 0;
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

  write(name: string, content: string, replacing: string | null): Promise<CloudFile> {
    const id = replacing ?? `file-${String((this.made += 1))}`;
    this.files.set(name, { id, content });
    return Promise.resolve({ id, name });
  }
}

function createRig(
  webMidiOverride?: AppRuntime['webMidi'],
  store: InMemorySettingsStore = new InMemorySettingsStore(),
  scoreStore: InMemoryScoreStore = new InMemoryScoreStore(),
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
  ]);
  const rhythms = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);
  const instrument = new RecordingPitchPlayer();
  const screenWake = new CountingScreenWake();
  // Awake unless a test says otherwise, which is what a desk browser is.
  const audioWaking = new TestAudioWaking();
  const ladder = new PracticeLadder(BUILT_IN_LADDER);
  const recorder = new PerformanceRecorder(clock);
  recorder.listenTo(midi);
  const volumeKnob = new ControlBinding();
  volumeKnob.listenTo(midi);
  const takes = new TakeLibrary(new InMemorySettingsStore());
  const files = new RecordingFileSink();
  const importer = new DomScoreImporter();
  const serializer = new MusicXmlSerializer();
  const scores = new ScoreLibrary({
    store: scoreStore,
    serializer,
    importer,
    keeper: { askToKeep: () => Promise.resolve(null) },
  });
  const scorings = new ScoringStrategyRegistry().registerAll([
    new AccuracyScoringStrategy(),
    new TimingWeightedScoringStrategy(),
    new ContinuityScoringStrategy(),
  ]);

  const settings = new SettingsRepository(store, {
    presetIds: presets.list().map((preset) => preset.id),
    modeIds: knownFrameIds(modes.list().map((mode) => mode.id)),
    rhythmProfileIds: rhythms.list().map((profile) => profile.id),
    scoringIds: scorings.list().map((strategy) => strategy.id),
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
    initialSettings: {
      countInBars: 0,
      clickWhen: 'never',
      matchToleranceMs: Number.POSITIVE_INFINITY,
      ...restored.practice,
    },
  });
  controller.events.on('settingsChanged', ({ settings: current }) => {
    settings.savePractice(current, Date.now());
  });

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
        databaseBytes: 30 * 1024 * 1024,
        persisted: false,
        shelves: [
          { name: 'settings', characters: 3_000 },
          { name: 'takes', characters: 1_200_000 },
        ],
      }),
  };

  const drive = new FolderDrive();
  const librarySync = new LibrarySync({ drive, store: scoreStore, reload: () => scores.load() });
  const driveSync = new DriveSync({
    library: librarySync,
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
    backup,
    storage,
    cloudDrive: drive,
    librarySync,
    driveSync,
    volumeKnob,
    takes,
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
    // The same object the session sounds through, as in `createApp`: one
    // instrument stands behind the reader's keys, the playback and the rest's
    // chime, and splitting it here hid a note that was left ringing.
    pitchPlayer: instrument,
    screenWake,
    audio: audioWaking,
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
    takes,
    scores,
    scoreStore,
    drive,
    files,
  };
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`#${id} is missing from index.html`);
  }
  return found as T;
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
    expect(element<HTMLSelectElement>('click').options).toHaveLength(4);
    expect(element('click-description').textContent).not.toBe('');
    // The list rather than a number kept by hand: a count written out here goes
    // stale the first time a choice is added, quietly checking less.
    expect(element<HTMLSelectElement>('dropout').options).toHaveLength(CLICK_WHEN.length);
    expect(element('dropout-description').textContent).not.toBe('');

    // Each choice says what it does, and none of them falls through to a
    // sentence meant for another: "with me" used to be described as a cycle
    // and came out promising to leave the reader alone for nought bars.
    for (const choice of CLICK_WHEN) {
      const dropout = element<HTMLSelectElement>('dropout');
      dropout.value = choice;
      dropout.dispatchEvent(new Event('change'));
      const said = element('dropout-description').textContent ?? '';
      expect(said, choice).not.toBe('');
      expect(said, choice).not.toContain('0 bar');
    }
    expect(element<HTMLSelectElement>('scoring').options).toHaveLength(3);
    expect(element('scoring-description').textContent).not.toBe('');
  });

  it('loads and renders an exercise on start-up', async () => {
    const { view, renderer } = createRig();
    await view.initialize();

    expect(renderer.loadCount).toBe(1);
    // Which piece it is is printed in the corner of the page itself now,
    // beside the page number - see tests/infrastructure/osmd-page-turns.
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

  it('follows the mode with a grading, and lets it be overridden', async () => {
    const { view, runtime } = createRig();
    await view.initialize();

    // From the one place the frame is chosen now: the button in the Modes
    // sheet, pressed until it says the one wanted.
    // The rig starts where it waits, and the ring goes on to listening and
    // then to flowing.
    const cycle = element<HTMLButtonElement>('frame-cycle');
    cycle.click();
    cycle.click();
    await Promise.resolve();

    expect(runtime.controller.settings.modeId).toBe(FLOW_MODE_ID);
    expect(runtime.controller.settings.scoringId).toBe('scoring.timing-weighted');
    expect(element<HTMLSelectElement>('scoring').value).toBe('scoring.timing-weighted');

    const scoring = element<HTMLSelectElement>('scoring');
    scoring.value = 'scoring.continuity';
    scoring.dispatchEvent(new Event('change'));
    await Promise.resolve();

    expect(runtime.controller.settings.scoringId).toBe('scoring.continuity');
    expect(element('scoring-description').textContent).toContain('without the music leaving you');
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

    it('closes the modes on a tap outside them, like every other sheet', async () => {
      // It was bound its own opening and its own ×, which made it the one
      // sheet a tap on the dimmed ground did not close.
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      expect(element('sheet-modes').hidden).toBe(false);

      element('sheet-modes').dispatchEvent(new Event('click', { bubbles: true }));

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
          clickWhen: 'never',
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
        name: 'clientWidth' | 'scrollWidth',
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
      // The column of key names keeps its own width, because the drawing is
      // measured as music with that column taken off both ends.
      const giveBack = [
        lent('clientWidth', (node) => (node.classList.contains('roll__keys') ? 44 : 400)),
        lent('scrollWidth', () => 2_000),
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
     * Lends the drawing a size, because jsdom lays nothing out.
     *
     * Every number the map is drawn from is a measurement of the drawing, so
     * without one there is no window to move and the box hides itself.
     */
    function lendTheDrawingASize(scrolledTo: () => number): () => void {
      const sizes: Record<string, (node: HTMLElement) => number> = {
        clientWidth: (node) => (node.classList.contains('roll__keys') ? 44 : 400),
        scrollWidth: () => 2_000,
        scrollLeft: () => scrolledTo(),
      };
      const giveBack: (() => void)[] = [];
      for (const [name, width] of Object.entries(sizes)) {
        const had = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
        Object.defineProperty(HTMLElement.prototype, name, {
          configurable: true,
          get(this: HTMLElement) {
            return width(this);
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

    function theDrawing(): HTMLElement {
      const drawn = element('roll-body').firstElementChild;
      if (!(drawn instanceof HTMLElement)) {
        throw new Error('the run was not drawn');
      }
      return drawn;
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
      let scrolledTo = 0;
      const giveBack = lendTheDrawingASize(() => scrolledTo);
      try {
        await openThePictureOfARun();
        const box = element('roll-map-window');
        const wide = box.style.width;
        const at = box.style.transform;
        expect(wide).not.toBe('');

        scrolledTo = 800;
        theDrawing().dispatchEvent(new Event('scroll'));
        await aFrame();

        // Four hundred wide on two thousand of run, less the forty-four the
        // column of key names keeps: a window of 356 on 1956, which is 18.2 per
        // cent of the map. Scrolled to 800 it stands 800/356 of its own widths
        // along - because a transform's per cent is of the element being moved,
        // and the share it is given is of the map.
        expect(wide).toBe('18.2%');
        expect(at).toBe('translateX(0.000%)');
        expect(box.style.transform).toBe('translateX(224.719%)');
        expect(box.style.left).toBe('');
        // The width is a width, and a scroll does not change it.
        expect(box.style.width).toBe(wide);
      } finally {
        giveBack();
      }
    });

    it('redraws the box at most once a frame, however much is scrolled', async () => {
      // A scroll fires many times between two frames, and every one of them
      // used to redraw the box. The extra ones are thrown away unseen.
      let scrolledTo = 0;
      const giveBack = lendTheDrawingASize(() => scrolledTo);
      try {
        await openThePictureOfARun();
        const box = element('roll-map-window');
        const at = box.style.transform;
        const drawn = theDrawing();
        const frames = vi.spyOn(window, 'requestAnimationFrame');

        for (const to of [200, 400, 800]) {
          scrolledTo = to;
          drawn.dispatchEvent(new Event('scroll'));
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

      element('sheet-roll').dispatchEvent(new Event('click', { bubbles: true }));

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
        clickWhen: 'never',
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
      const drawn = element('roll-body').querySelector('.roll');
      expect(drawn?.querySelectorAll('.roll__note').length).toBeGreaterThan(0);
      // No grid: nothing was keeping the time of free playing.
      expect(drawn?.querySelectorAll('.roll__line')).toHaveLength(0);
      // And nothing a recording cannot answer is on offer.
      expect(element('roll-keep').hidden).toBe(true);
      expect(element<HTMLButtonElement>('roll-from').disabled).toBe(true);
      expect(element<HTMLButtonElement>('roll-practise').disabled).toBe(true);
    });


    it('counts the bar out over the drawing, and can be put away', async () => {
      // A row of squares saying where written time has got to, over a picture
      // of where the reader actually got to. His: "квадратики які
      // репрезентують кліки метроному", and floating: "може варто їх додати
      // щоб вони були у float стейті прям на viewer десь зверху".
      const { view, runtime, midi } = createRig();
      await view.initialize();
      await runtime.controller.openScore(longExercise({ bars: 4, tempoBpm: 60 }));
      element<HTMLButtonElement>('focus-play').click();
      const step = runtime.controller.session?.currentStep;
      midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
      element<HTMLButtonElement>('focus-stop').click();
      element<HTMLButtonElement>('run-roll-open').click();

      const squares = element('roll-beats');
      expect(squares.hidden).toBe(false);
      // Four to a bar of four, and the downbeat is one of them.
      expect(squares.children.length).toBe(4);
      expect(squares.querySelectorAll('.roll-beats__on')).toHaveLength(1);

      // And out of the way for a reader it is in the way of.
      const shown = element<HTMLInputElement>('roll-beats-shown');
      shown.checked = false;
      shown.dispatchEvent(new Event('change'));

      expect(squares.hidden).toBe(true);
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
      expect(drawn?.querySelectorAll('.roll__note').length).toBeGreaterThan(0);
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
        expect(drawn?.style.getPropertyValue('--roll-at')).toBe('0.000');

        clock.advance(400);
        vi.advanceTimersByTime(100);

        expect(drawn?.style.getPropertyValue('--roll-at')).toBe('0.400');
      } finally {
        vi.useRealTimers();
      }
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
        element<HTMLButtonElement>('roll-play').click();
        clock.advance(200);
        vi.advanceTimersByTime(100);

        // Asked for at a moment on the page's own clock, not at the moment it
        // fell in the run: the two clocks share nothing but a duration. The
        // first beat of the run is already behind the sound by now, and saying
        // so is what lets the metronome place it at once rather than late.
        const at = runtime.takePlayer.positionMs;
        expect(metronome.clicks[0]?.atMs).toBe(clock.now() + ((marking[0]?.atMs ?? 0) - began - at));
        expect(metronome.clicks[0]?.weight).toBe('downbeat');

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
      expect(element<HTMLButtonElement>('roll-stop').disabled).toBe(true);

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
      expect(drawn?.style.getPropertyValue('--roll-at')).toBe('0.300');
      expect(element<HTMLButtonElement>('roll-stop').disabled).toBe(false);
      expect(element('roll-play').getAttribute('aria-label')).toBe('Play');

      element<HTMLButtonElement>('roll-stop').click();

      // Stopped: back to the beginning, which is what stopping means.
      expect(drawn?.style.getPropertyValue('--roll-at')).toBe('0.000');
      expect(element<HTMLButtonElement>('roll-stop').disabled).toBe(true);
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

      expect(drawn?.style.getPropertyValue('--roll-at')).toBe('1.000');
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

      const named = [...element('roll-body').querySelectorAll('.roll__bar')].map(
        (mark) => mark.textContent,
      );
      const beats = element('roll-body').querySelectorAll('.roll__line').length;
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

      const lines = (): number =>
        element('roll-body').querySelectorAll('.roll__line').length;
      const beatsOnly = lines();
      expect(element('roll-body').querySelectorAll('.roll__line--division')).toHaveLength(0);

      const grid = element<HTMLSelectElement>('roll-grid');
      grid.value = '4';
      grid.dispatchEvent(new Event('change', { bubbles: true }));

      // More lines, and the new ones are drawn as what they are.
      expect(lines()).toBeGreaterThan(beatsOnly);
      expect(
        element('roll-body').querySelectorAll('.roll__line--division').length,
      ).toBeGreaterThan(0);

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
      expect(drawn?.style.getPropertyValue('--roll-second')).toBe('280px');

      // And the fingers coming up is not a tap: the head stays where it was.
      const at = drawn?.style.getPropertyValue('--roll-at');
      finger('pointerup', 2, 200);
      finger('pointerup', 1, 0);
      body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 400 }));

      expect(drawn?.style.getPropertyValue('--roll-at')).toBe(at);
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

      expect(drawn?.style.getPropertyValue('--roll-row')).toBe('13px');

      finger('pointerdown', 1, 0);
      finger('pointerdown', 2, 200);
      // Half as far apart down the page, so half as tall a row.
      finger('pointermove', 2, 100);

      expect(drawn?.style.getPropertyValue('--roll-row')).toBe('7px');
      // And the width is left alone: the fingers were never apart across.
      expect(element<HTMLInputElement>('roll-zoom').value).toBe('140');
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
      element('sheet-roll-options').dispatchEvent(new Event('click', { bubbles: true }));

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

      expect(drawn?.style.getPropertyValue('--roll-at')).toBe('0.500');
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
      expect(
        element('roll-body').querySelectorAll('.roll__ghost').length,
      ).toBeGreaterThan(0);

      const ghosts = element<HTMLInputElement>('roll-ghosts');
      ghosts.checked = false;
      ghosts.dispatchEvent(new Event('change', { bubbles: true }));

      expect(element('roll-body').querySelectorAll('.roll__ghost')).toHaveLength(0);
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

      const body = element('roll-body');
      const said = [...body.querySelectorAll<HTMLElement>('.roll__wait')].map(
        (band) => band.title,
      );
      // One for every entry, and not one for every fourth: the click marks the
      // beat, and he was reading sixteenths.
      expect(said.filter((title) => title === 'The music waited 450 ms').length).toBeGreaterThan(3);
      // And nothing on a note's own row, which is the mark he never asked for.
      expect(body.querySelectorAll('.roll__slip')).toHaveLength(0);
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
      const waits = [...element('roll-body').querySelectorAll<HTMLElement>('.roll__wait')].map(
        (band) => band.title,
      );
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
      expect(element('roll-body').querySelectorAll('.roll__line--rushed')).toHaveLength(0);

      // And the notes asked for keep their written lengths, whatever the reader
      // did about arriving at them: a quarter here is a second, a half is two.
      const outlines = [...element('roll-body').querySelectorAll<HTMLElement>('.roll__ghost')];
      expect(outlines.length).toBeGreaterThan(1);
      for (const outline of outlines) {
        expect(outline.style.width).not.toBe('calc(var(--roll-second) * 0.0000)');
      }
      expect(outlines.map((outline) => outline.style.width)).toContain(
        'calc(var(--roll-second) * 1.0000)',
      );
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

      expect(element('roll-body').querySelectorAll('.roll__ghost').length).toBeGreaterThan(0);
      expect(element('roll-body').querySelectorAll('.roll__slip')).toHaveLength(0);
      // And the chord is still legibly in pieces: two notes, struck a hundred
      // and fifty milliseconds apart, drawn where they were struck.
      const struck = [...element('roll-body').querySelectorAll<HTMLElement>('.roll__note')]
        .map((note) => note.style.left)
        .slice(0, 2);
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

      const bands = [...element('roll-body').querySelectorAll('.roll__slip')];
      expect(bands.length).toBeGreaterThan(1);
      for (const band of bands) {
        expect(band.className).toBe('roll__slip roll__slip--late');
      }

      // And they can be put away, for the question they are in the way of.
      const slips = element<HTMLInputElement>('roll-slips');
      slips.checked = false;
      slips.dispatchEvent(new Event('change', { bubbles: true }));

      expect(element('roll-body').querySelectorAll('.roll__slip')).toHaveLength(0);
      expect(
        element('roll-body').querySelectorAll('.roll__note').length,
      ).toBeGreaterThan(0);
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

    it('zooms the drawing by the one property it is laid out in', async () => {
      // Which is why zooming is a property changing rather than a redraw: the
      // browser moves every note, line and label from the same numbers.
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
      expect(drawn?.style.getPropertyValue('--roll-second')).toBe('320px');
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
        clickWhen: 'never',
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

    it('says how many bar lines the music waited at, where there are any', async () => {
      // His, and it is the measure of when to leave the mode for Flow: not how
      // many notes were right but how many times the music had to stop. Said
      // as a fraction of the bars read, because three in four bars and three
      // in forty are opposite readings - and said at nought too, since that is
      // the reading worth arriving at.
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      const cycle = element<HTMLButtonElement>('frame-cycle');
      // Waiting is where the rig starts; the bar line is two along.
      cycle.click();
      cycle.click();
      cycle.click();
      await Promise.resolve();
      expect(runtime.controller.settings.modeId).toBe(BAR_MODE_ID);

      element<HTMLButtonElement>('sheet-modes').dispatchEvent(
        new Event('click', { bubbles: true }),
      );
      element<HTMLButtonElement>('focus-play').click();
      element<HTMLButtonElement>('focus-stop').click();

      expect(element('result').textContent).toContain('Bars it waited at');
      // A fraction, because the number alone says nothing: three in four bars
      // and three in forty are opposite readings.
      expect(element('result').textContent).toMatch(/Bars it waited at\s*\d+ of \d+/);
    });

    it('walks one button through the four kinds of run', async () => {
      // His shape: one button pressed until it says the one you want, above
      // the squares rather than among them - the squares are all "make it
      // harder" and this is the frame they sit inside. What it says and what
      // it is drawn as change with it, and so does the sentence underneath,
      // which is the half that says what the choice means.
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      const cycle = element<HTMLButtonElement>('frame-cycle');
      // First in the squares' own row, and dressed as one of them, so it
      // stands level with the rest rather than in a strip of its own.
      expect(element('modes-grid').firstElementChild).toBe(cycle);
      expect(cycle.classList.contains('mode-card')).toBe(true);
      const drawn = (): string => element('frame-icon').getAttribute('d') ?? '';
      expect(cycle.dataset['frame']).toBe('wait');
      // Lit like a square, and for the same reason: this is not the plain
      // run the app opens with. Flowing in time is, so that is where it
      // rests - which is the one thing it means differently from the four.
      expect(cycle.getAttribute('aria-pressed')).toBe('true');
      const waiting = drawn();

      cycle.click();

      expect(runtime.controller.settings.modeId).toBe(LISTEN_MODE_ID);
      expect(cycle.dataset['frame']).toBe('listen');
      expect(element('frame-name').textContent).toContain('Listen');
      expect(element('frame-what').textContent).toContain('machine');
      expect(drawn()).not.toBe(waiting);
      // Two presses running can both leave it lit, and both are felt: the
      // turn is played again rather than transitioned from a state to
      // itself, which is no movement at all.
      expect(cycle.dataset['turning']).toBe('true');

      // On to the frame the app opens in, which is the button going out:
      // nothing to play there, since going out is the square's own way down.
      cycle.click();

      expect(runtime.controller.settings.modeId).toBe(FLOW_MODE_ID);
      expect(cycle.getAttribute('aria-pressed')).toBe('false');
      expect(cycle.dataset['turning']).toBeUndefined();

      // On to the one between the two, which is his ladder: the ring runs
      // from the frame that gives no help at all to the one that asks for
      // nothing, so the bar line - one place a bar to be found again - sits
      // between flowing and waiting.
      cycle.click();

      expect(runtime.controller.settings.modeId).toBe(BAR_MODE_ID);
      expect(cycle.dataset['frame']).toBe('bar');
      expect(element('frame-what').textContent).toContain('bar line');
      expect(cycle.getAttribute('aria-pressed')).toBe('true');

      // And round again, rather than stopping at the end of the list.
      cycle.click();

      expect(runtime.controller.settings.modeId).toBe(new WaitMode().id);
      expect(drawn()).toBe(waiting);
    });

    it('offers a third frame, in which the machine plays and nothing is judged', async () => {
      // His: not a playback beside the modes but a mode of its own - the one
      // where you sit back and watch the machine play. Start is what plays
      // it; there is no second transport.
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus-modes').click();
      const cycle = element<HTMLButtonElement>('frame-cycle');

      // Waiting is where the rig starts, and listening is the next along.
      cycle.click();

      expect(runtime.controller.machinePlays).toBe(true);
      expect(cycle.dataset['frame']).toBe('listen');

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
      (element('modes-grid').querySelector('[data-mode="blind"]') as HTMLButtonElement).click();

      expect(marks()).toEqual(['listen', 'blind']);

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
      expect(element<HTMLInputElement>('cursor-running').checked).toBe(false);
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
      // And what is about the reading rather than the material stays.
      expect(carrier('scoring').dataset['idle']).toBeUndefined();
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

      // And the two settings Survival owns, which say nothing while the bar
      // is not falling. Set from the drawer, so the drawer has to read the
      // settings again afterwards - it did not, and everything downstream of
      // one switch went on saying what it had said before.
      expect(carrier('survival-refill').dataset['idle']).toBe('true');
      const survival = element<HTMLInputElement>('survival');
      survival.checked = true;
      survival.dispatchEvent(new Event('change'));

      expect(carrier('survival-refill').dataset['idle']).toBeUndefined();
      expect(carrier('survival-punish').dataset['idle']).toBeUndefined();
    });

    it('gives the drawer the rule the squares follow', async () => {
      // One question with two editors. The squares will not let the pair
      // stand together; the drawer must not be a way round that, or the
      // reader ends with a state the squares say is impossible.
      const { view, runtime } = createRig();
      await view.initialize();
      const tick = (id: string, on: boolean): void => {
        const box = element<HTMLInputElement>(id);
        box.checked = on;
        box.dispatchEvent(new Event('change'));
      };
      tick('stop-at-mistake', true);
      expect(runtime.controller.settings.stopAtAMistake).toBe(true);

      tick('rhythm-only', true);

      expect(runtime.controller.settings.rhythmOnly).toBe(true);
      expect(runtime.controller.settings.stopAtAMistake).toBe(false);
      expect(element<HTMLInputElement>('stop-at-mistake').checked).toBe(false);

      tick('stop-at-mistake', true);

      expect(runtime.controller.settings.rhythmOnly).toBe(false);
      expect(element<HTMLInputElement>('rhythm-only').checked).toBe(false);
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

      // The search stands in the sheet's head, over every pane and always in
      // view: the one control that belongs to no pane because it is for all.
      const orphans = [...sheet.querySelectorAll('input, select')]
        .filter(
          (control) =>
            control.closest('[data-pane]') === null && control.closest('.sheet__head') === null,
        )
        .map((control) => control.id);

      expect(orphans).toEqual([]);
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
      expect(element('sheet-settings').hidden).toBe(true);
      // One panel: the controls exist once in the document.
      expect(document.querySelectorAll('#count-in')).toHaveLength(1);
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
    element<HTMLButtonElement>('frame-cycle').click();
    expect(runtime.controller.settings.modeId).toBe(LISTEN_MODE_ID);
    expect(element('frame-what').textContent).toContain('machine');
  });

  describe('the ladder arrows', () => {
    it('starts at the first rung and names it', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      element<HTMLButtonElement>('ladder-up').click();
      await Promise.resolve();

      expect(runtime.controller.ladderStep?.label).toBe('1a');
      expect(element('ladder-step').textContent).toContain('1a');
      expect(element('ladder-step').textContent).toContain('1 of');
      expect(element('ladder-description').textContent).toContain('Five-finger');
      // Nowhere below the bottom to go.
      expect(element<HTMLButtonElement>('ladder-down').disabled).toBe(true);
    });

    it('brings the selectors with it', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      element<HTMLButtonElement>('ladder-up').click();
      await Promise.resolve();
      element<HTMLButtonElement>('ladder-up').click();
      await Promise.resolve();

      expect(runtime.controller.ladderStep?.label).toBe('1b');
      // The rung is what is being practised, so the controls have to agree.
      expect(element<HTMLSelectElement>('rhythm').value).toBe('flowing');
      expect(element<HTMLSelectElement>('preset').value).toBe('five-finger-c');
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
      element('sheet-places').dispatchEvent(new Event('click', { bubbles: true }));

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
      // different afternoon's work from full speed with both.
      expect(row).toContain('70%');
      expect(row).toContain('left hand');
    });

    it('shows the best ones when asked, and only finished ones', async () => {
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

      const rows = element('readings-list').textContent ?? '';
      expect(rows).toContain('Finished');
      expect(rows).not.toContain('Stopped');
    });
  });

  describe('learning a piece a section at a time', () => {
    it('says what to play, and sets it', async () => {
      const rig = createRig();
      await rig.view.initialize();
      await rig.runtime.controller.openScore(longExercise({ bars: 8 }));

      element<HTMLInputElement>('drill-bars').value = '4';
      element<HTMLButtonElement>('drill-start').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(element('score-drill').hidden).toBe(false);
      expect(element('drill-where').textContent).toContain('Step 1 of');
      expect(element('drill-what').textContent).toContain('Bars 1-4');
      // The ordinary passage, not a private one: the drawer says it too.
      expect(element<HTMLInputElement>('focus-to').value).toBe('4');
      // And it gets out of the way so the reader can play.
      expect(element('sheet-settings').hidden).toBe(true);
    });

    it('puts the plan away when asked', async () => {
      const rig = createRig();
      await rig.view.initialize();
      await rig.runtime.controller.openScore(longExercise({ bars: 8 }));
      element<HTMLButtonElement>('drill-start').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      element<HTMLButtonElement>('drill-stop').click();

      expect(element('score-drill').hidden).toBe(true);
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

    it('leaves a focused button to do its own job', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      const button = element<HTMLButtonElement>('focus-bare');
      button.focus();
      pressSpace(button);

      // Space on a button is how a button is pressed; it must not also start.
      expect(runtime.controller.session).toBeNull();
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
      expect(element<HTMLButtonElement>('roll-stop').disabled).toBe(true);
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

      sheet.dispatchEvent(new MouseEvent('click', { bubbles: true }));

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
      // OSMD sizes the sheet from container.offsetWidth, which counts padding
      // and border. Drawing into the framed element would make the sheet wider
      // than the space it has, and put a horizontal scrollbar under it.
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
        clickWhen: 'never',
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
      element('sheet-scores').dispatchEvent(new Event('click'));
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

    it('puts everything about the click behind one button', async () => {
      // It was in three places: two cycle buttons under the drawer handle and
      // two sliders down the settings sheet, so "quieter, and give me two
      // bars of count-in" meant both of them and a scroll.
      const { view } = createRig();
      await view.initialize();
      expect(element('sheet-metronome').hidden).toBe(true);

      element<HTMLButtonElement>('focus-metronome').click();

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

      element<HTMLButtonElement>('focus-metronome').click();
      expect(element('sheet-metronome').hidden).toBe(false);

      element<HTMLButtonElement>('metronome-close').click();
      expect(element('sheet-metronome').hidden).toBe(true);
    });

    it('says what the metronome is set to without being opened', async () => {
      // A reader glancing at the row wants to know whether the click is on at
      // all, and that answer is one short line rather than a sheet.
      const { view } = createRig();
      await view.initialize();
      setClickWhen('always');
      const button = element<HTMLButtonElement>('focus-metronome');

      expect(button.dataset['click']).toBe('always');
      expect(button.title).toContain('all the way through');

      setClickWhen('never');
      expect(button.dataset['click']).toBe('never');
      expect(button.title).toContain('never');

      // A cycle - a bar on, a bar off - has no picture of its own, so it is
      // shown as sounding, which is what it mostly is.
      setClickWhen('cycle-2');
      expect(button.dataset['click']).toBe('always');
    });

    it('names the pattern on the same button, that being the same subject', async () => {
      const { view } = createRig();
      await view.initialize();
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
      // The switch at the desk is the same value seen from the stand.
      expect(element<HTMLInputElement>('survival').checked).toBe(true);
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
      expect(said).toContain('Five-finger');
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
      clickWhen: 'never',
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

  it('lists what the browser says when asked, and not before', async () => {
    // Settings -> For developers. Whether there is room and whether it will be
    // kept is a question the reader asks; the page does not ask it for them.
    const { view } = createRig();
    await view.initialize();
    const report = element<HTMLUListElement>('storage-report');
    expect(report.hidden).toBe(true);

    element<HTMLButtonElement>('measure-storage').click();
    await waitFor(() => !report.hidden);

    const lines = [...report.querySelectorAll('li')].map((line) => line.textContent);
    expect(lines).toContain('Kept from being cleared: no');
    expect(lines.some((line) => line?.includes('takes 1.1 MB'))).toBe(true);
  });
});

describe('a key that stands for the music', () => {
  beforeEach(() => {
    mountRealMarkup();
  });

  async function tapping(soundsTheMusic: boolean): Promise<Rig> {
    const rig = createRig();
    await rig.view.initialize();
    await rig.runtime.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    rig.runtime.controller.updateSettings({
      rhythmOnly: true,
      rhythmSoundsTheMusic: soundsTheMusic,
      hearTheOtherHand: false,
    });
    rig.runtime.controller.start();
    return rig;
  }

  it('does not sound the key pressed while the run sounds the written notes', async () => {
    // Rhythm only, asked to play the music: the key is a tap, and the page
    // sounding it as well would be a wrong note over every right one.
    const rig = await tapping(true);

    rig.midi.noteOn(MIDI.G4);

    const heard = rig.instrument.played.map((note) => note.midi);
    expect(heard).not.toContain(MIDI.G4);
    expect(heard).toContain(MIDI.C4);
  });

  it('sounds the key as it always did otherwise', async () => {
    const rig = await tapping(false);

    rig.midi.noteOn(MIDI.G4);

    expect(rig.instrument.played.map((note) => note.midi)).toContain(MIDI.G4);
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

  it('says what went wrong rather than nothing', async () => {
    const rig = createRig();
    await rig.view.initialize();
    rig.drive.connect = () => Promise.reject(new Error('Google could not be reached.'));

    element<HTMLButtonElement>('drive-sync').click();
    await waitFor(() => element('drive-status').textContent === 'Google could not be reached.');

    expect(element<HTMLButtonElement>('drive-sync').disabled).toBe(false);
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
    expect(showing()).not.toBe('modes');

    search('keep the bar up');

    expect(count()).toBe('1 / 1');
    expect(showing()).toBe('modes');
  });

  it('goes on with Enter and back with Shift+Enter, round from the end', async () => {
    const rig = createRig();
    await rig.view.initialize();

    // Three or more, or a step back and a step on land in the same place.
    search('cursor');
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

      search('rhythm only');

      const total = Number(count().split(' / ')[1]);
      expect(highlights.get('settings-found')?.ranges).toHaveLength(total);
      expect(highlights.get('settings-found-here')?.ranges[0]?.toString().toLowerCase()).toBe(
        'rhythm only',
      );
    } finally {
      view.CSS = hadCss;
    }
  });
});

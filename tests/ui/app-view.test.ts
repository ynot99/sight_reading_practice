// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PracticeController } from '../../src/application/PracticeController.js';
import { FLOW_MODE_ID, FlowMode } from '../../src/application/modes/FlowMode.js';
import { PracticeModeRegistry } from '../../src/application/modes/PracticeModeRegistry.js';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import { SilentPitchPlayer } from '../../src/application/ports/IPitchPlayer.js';
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
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import { SettingsRepository } from '../../src/application/SettingsRepository.js';
import type { IVolumeControl } from '../../src/application/ports/IVolumeControl.js';
import type { SampleLoading } from '../../src/application/ports/IPitchPlayer.js';
import { WebMidiAdapter } from '../../src/infrastructure/midi/WebMidiAdapter.js';
import { AppView, describeTendency, healthGlideMs, isRealTendency } from '../../src/ui/AppView.js';
import { twoBarExercise } from '../support/fixtures.js';
import { midiToLabel } from '../../src/domain/model/Pitch.js';

// Resolved from the project root: in a jsdom environment `import.meta.url` is
// served over http, so it cannot be turned into a file path.
const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

/** Installs the real markup, so a renamed id fails this test rather than production. */
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
  const modes = new PracticeModeRegistry().registerAll([new WaitMode(), new FlowMode()]);
  const rhythms = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);
  const instrument = new RecordingPitchPlayer();
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
  });
  const scorings = new ScoringStrategyRegistry().registerAll([
    new AccuracyScoringStrategy(),
    new TimingWeightedScoringStrategy(),
    new ContinuityScoringStrategy(),
  ]);

  const settings = new SettingsRepository(store, {
    presetIds: presets.list().map((preset) => preset.id),
    modeIds: modes.list().map((mode) => mode.id),
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
    settings.savePractice(current);
  });

  const takePlayer = new TakePlayer({ instrument, clock });
  const backup = new BackupService({
    stores: new Map([['settings', store]]),
    scoreStore,
    clock,
  });

  const runtime: AppRuntime = {
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
    pitchPlayer: new SilentPitchPlayer(),
    sustain,
    samples,
    renderer,
    settings,
    metronomeVolume,
    instrumentVolume,
    dispose: () => undefined,
  };

  return {
    runtime,
    view: new AppView(runtime, document),
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
    expect(element<HTMLSelectElement>('mode').options).toHaveLength(2);
    expect(element<HTMLSelectElement>('key').options.length).toBeGreaterThan(5);
    expect(element('preset-description').textContent).not.toBe('');
    expect(element('rhythm-description').textContent).not.toBe('');
    expect(element<HTMLSelectElement>('click').options).toHaveLength(4);
    expect(element('click-description').textContent).not.toBe('');
    expect(element<HTMLSelectElement>('dropout').options).toHaveLength(6);
    expect(element('dropout-description').textContent).not.toBe('');
    expect(element('mode-description').textContent).toContain('waits');
    expect(element<HTMLSelectElement>('scoring').options).toHaveLength(3);
    expect(element('scoring-description').textContent).not.toBe('');
  });

  it('loads and renders an exercise on start-up', async () => {
    const { view, renderer } = createRig();
    await view.initialize();

    expect(renderer.loadCount).toBe(1);
    expect(element('exercise-title').textContent).toContain('seed');
    expect(element<HTMLProgressElement>('progress').max).toBeGreaterThan(1);
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

    const mode = element<HTMLSelectElement>('mode');
    mode.value = FLOW_MODE_ID;
    mode.dispatchEvent(new Event('change'));
    await Promise.resolve();

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

      element<HTMLButtonElement>('start').click();

      // Nothing is running yet: the look is the point, and it ends by itself.
      expect(runtime.controller.session).toBeNull();
      expect(element('session-status').textContent).toContain('Look at it');

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

        element<HTMLButtonElement>('start').click();

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
      element<HTMLButtonElement>('start').click();
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
        element<HTMLButtonElement>('start').click();
        vi.advanceTimersByTime(2000);
        runtime.controller.session?.abort();

        expect(element('score-cover').hidden).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it('hands it over to hear it played', async () => {
      const { view } = createRig();
      await view.initialize();
      setPreview(6);

      element<HTMLButtonElement>('listen').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

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
      element<HTMLButtonElement>('start').click();

      element<HTMLButtonElement>('stop').click();
      vi.advanceTimersByTime(20_000);

      // Stopping during the look means seen enough, not start in ten seconds.
      expect(runtime.controller.session).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('plays the exercise back, and stops when asked', async () => {
    const { view, runtime } = createRig();
    await view.initialize();

    // The recordings are awaited before a note sounds, so the click resolves a
    // moment later than it is made.
    element<HTMLButtonElement>('listen').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.controller.isListening).toBe(true);
    expect(element('listen').textContent).toBe('Stop listening');

    element<HTMLButtonElement>('listen').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.controller.isListening).toBe(false);
    expect(element('listen').textContent).toBe('Listen');
  });

  it('sounds only the hand that was chosen', async () => {
    const { view, instrument, metronome } = createRig();
    await view.initialize();

    const hand = element<HTMLSelectElement>('listen-hand');
    hand.value = '2';
    hand.dispatchEvent(new Event('change'));
    element<HTMLButtonElement>('listen').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    metronome.advanceSubdivisions(8);

    // The bass staff of the fixture holds C3 and the chord under it; the
    // treble's C4 and the melody above it must stay silent.
    const sounded = new Set(instrument.played.map((note) => note.midi));
    expect(sounded.size).toBeGreaterThan(0);
    expect([...sounded].every((midi) => midi < 60)).toBe(true);
  });

  it('asks for only the chosen hand in a run too', async () => {
    // The same question asked twice: which hand am I working on. The page
    // still shows both, and the cursor still visits every step.
    const { view, runtime } = createRig();
    await view.initialize();

    const hand = element<HTMLSelectElement>('listen-hand');
    hand.value = '2';
    hand.dispatchEvent(new Event('change'));
    element<HTMLButtonElement>('start').click();

    expect(runtime.controller.settings.handStaff).toBe(2);

    const step = runtime.controller.session?.currentStep;
    const bass = new Set(
      (step?.notes ?? []).filter((note) => note.staffNumber === 2).map((note) => note.midi),
    );
    const shown = element('expected').textContent ?? '';
    // Whatever the step holds, the panel names the left hand and only it.
    expect(shown).not.toBe('—');
    for (const note of step?.notes ?? []) {
      const named = midiToLabel(note.midi);
      expect({ note: named, shown: shown.includes(named) }).toEqual({
        note: named,
        shown: bass.has(note.midi),
      });
    }
  });

  it('gives up the pulse when a run starts', async () => {
    // Listening and practising share the metronome and the cursor, so one has
    // to yield rather than both driving.
    const { view, runtime } = createRig();
    await view.initialize();
    element<HTMLButtonElement>('listen').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.controller.isListening).toBe(true);

    element<HTMLButtonElement>('start').click();

    expect(runtime.controller.isListening).toBe(false);
    expect(element('listen').textContent).toBe('Listen');
  });

  it('narrows practice to a passage, and says which', async () => {
    const { view, runtime } = createRig();
    await view.initialize();
    const wholePiece = runtime.controller.currentTimeline?.length ?? 0;

    const from = element<HTMLInputElement>('range-from');
    from.value = '2';
    from.dispatchEvent(new Event('change'));
    const to = element<HTMLInputElement>('range-to');
    to.value = '2';
    to.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.controller.settings.rangeFromBar).toBe(2);
    // One bar of the piece is a shorter exercise than the piece.
    expect(runtime.controller.currentTimeline?.length ?? 0).toBeLessThan(wholePiece);
    expect(element('exercise-title').textContent).toContain('bars 2');
  });

  it('opens a MusicXML file and says what it lost', async () => {
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
    expect(element('import-notice').hidden).toBe(false);
    expect(element('import-notice').textContent).toContain('Borrowed');
  });

  it('explains a file it cannot read instead of going quiet', async () => {
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
    expect(element('import-notice').textContent).toContain('Could not open');
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
    const { view, runtime, midi } = createRig();
    await view.initialize();

    element<HTMLButtonElement>('start').click();

    const session = runtime.controller.session;
    expect(session?.status).toBe('running');
    expect(element('session-status').textContent).toBe('Playing');
    expect(element<HTMLButtonElement>('start').disabled).toBe(true);
    expect(element<HTMLButtonElement>('stop').disabled).toBe(false);
    expect(element('expected').textContent).not.toBe('—');

    const step = session?.currentStep;
    if (step === undefined || step === null) {
      throw new Error('expected a first step');
    }
    midi.noteOn(step.expectedMidi[0] ?? 60, 0);
    expect(element('log').childElementCount).toBeGreaterThan(0);
  });

  it('toggles the pause button between pause and resume', async () => {
    const { view, runtime } = createRig();
    await view.initialize();
    element<HTMLButtonElement>('start').click();

    element<HTMLButtonElement>('pause').click();
    expect(runtime.controller.session?.status).toBe('paused');
    expect(element<HTMLButtonElement>('pause').textContent).toBe('Resume');

    element<HTMLButtonElement>('pause').click();
    expect(runtime.controller.session?.status).toBe('running');
    expect(element<HTMLButtonElement>('pause').textContent).toBe('Pause');
  });

  it('shows the final report when a run is stopped', async () => {
    const { view } = createRig();
    await view.initialize();
    element<HTMLButtonElement>('start').click();

    element<HTMLButtonElement>('stop').click();

    const result = element('result');
    expect(result.hidden).toBe(false);
    expect(result.textContent).toContain('Overall');
    expect(element('session-status').textContent).toBe('Stopped');
  });

  it('reports which way a run leaned, not only how far off it was', async () => {
    const { view } = createRig();
    await view.initialize();
    element<HTMLButtonElement>('start').click();
    element<HTMLButtonElement>('stop').click();

    expect(element('result').textContent).toContain('Tendency');
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

    const mode = element<HTMLSelectElement>('mode');
    mode.value = FLOW_MODE_ID;
    mode.dispatchEvent(new Event('change'));
    expect(runtime.controller.settings.modeId).toBe(FLOW_MODE_ID);
    expect(element('mode-description').textContent).toContain('with the beat');
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

    const from = element<HTMLInputElement>('range-from');
    const to = element<HTMLInputElement>('range-to');
    from.value = '2';
    from.dispatchEvent(new Event('change'));
    to.value = '3';
    to.dispatchEvent(new Event('change'));
    await Promise.resolve();
    expect(runtime.controller.settings.rangeFromBar).toBe(2);

    element<HTMLButtonElement>('new-exercise').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The boxes have to follow the setting, or they would name a passage of
    // the last piece over the top of a new one.
    expect(runtime.controller.settings.rangeFromBar).toBeNull();
    expect(element<HTMLInputElement>('range-from').value).toBe('');
    expect(element<HTMLInputElement>('range-to').value).toBe('');
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

      // The opener names the count, since the list itself is behind it now.
      expect(element('open-scores').textContent).toBe('Scores');
      expect(element('scores-empty').hidden).toBe(false);
    });

    it('lists what an earlier visit kept', async () => {
      const rig = createRig();
      await keepOne(rig);

      expect(element('open-scores').textContent).toBe('Scores (1)');
      expect(element('scores-list').childElementCount).toBe(1);
      expect(element('scores-list').textContent).toContain('Something Borrowed');
      expect(element('scores-list').textContent).toContain('2 bars');
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
      expect(element('open-scores').textContent).toBe('Scores');
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

    it('empties the shelf when asked', async () => {
      const rig = createRig();
      await keepOne(rig);

      element<HTMLButtonElement>('scores-clear').click();
      await confirmDeletion();

      expect(rig.runtime.scores.isEmpty).toBe(true);
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

      expect(element<HTMLButtonElement>('keep-take').disabled).toBe(true);
      expect(element<HTMLButtonElement>('focus-keep').disabled).toBe(true);
      expect(element('open-takes').textContent).toBe('Takes');
    });

    it('wakes up as soon as the keyboard is touched', async () => {
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);

      const button = element<HTMLButtonElement>('keep-take');
      expect(button.disabled).toBe(false);
      // Says what it is offering, so a take cut at the wrong pause shows.
      expect(button.textContent).toContain('0:00');
    });

    it('captures without being asked to start', async () => {
      const rig = createRig();
      await rig.view.initialize();
      // Nothing was pressed before playing: an idea is noticed afterwards.
      playSomething(rig);

      element<HTMLButtonElement>('keep-take').click();

      expect(rig.takes.list()).toHaveLength(1);
      expect(element('open-takes').textContent).toBe('Takes (1)');
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
      expect(element('open-takes').textContent).toBe('Takes (1)');
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
      element<HTMLButtonElement>('keep-take').click();
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
      element<HTMLButtonElement>('keep-take').click();
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
      element<HTMLButtonElement>('keep-take').click();
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
      element<HTMLButtonElement>('keep-take').click();
      rowButton('takes-list', 'Play this take').click();
      expect(rig.runtime.takePlayer.playing).not.toBeNull();

      element<HTMLButtonElement>('takes-close').click();

      expect(rig.runtime.takePlayer.playing).toBeNull();
    });

    it('will not keep the same playing twice', async () => {
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);

      element<HTMLButtonElement>('keep-take').click();
      element<HTMLButtonElement>('keep-take').click();

      expect(rig.takes.list()).toHaveLength(1);
      expect(element<HTMLButtonElement>('keep-take').disabled).toBe(true);
    });

    it('writes a MIDI file from the row', async () => {
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);
      element<HTMLButtonElement>('keep-take').click();

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
      element<HTMLButtonElement>('keep-take').click();

      rowButton('takes-list', 'Delete this take').click();
      await confirmDeletion();

      expect(rig.takes.list()).toHaveLength(0);
      expect(element('open-takes').textContent).toBe('Takes');
    });

    it('empties the whole list when asked', async () => {
      const rig = createRig();
      await rig.view.initialize();
      playSomething(rig);
      element<HTMLButtonElement>('keep-take').click();
      rig.clock.advance(10_000);
      playSomething(rig);
      element<HTMLButtonElement>('keep-take').click();
      expect(rig.takes.list()).toHaveLength(2);

      element<HTMLButtonElement>('takes-clear').click();
      await confirmDeletion();

      expect(rig.takes.list()).toHaveLength(0);
      expect(element('open-takes').textContent).toBe('Takes');
    });

    it('keeps capturing while the monitor is muted', async () => {
      const rig = createRig();
      await rig.view.initialize();
      const monitor = element<HTMLInputElement>('audio-feedback');
      monitor.checked = false;
      monitor.dispatchEvent(new Event('change'));

      playSomething(rig);

      // Silencing what you hear is not a decision to stop capturing.
      expect(element<HTMLButtonElement>('keep-take').disabled).toBe(false);
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

  describe('touching a note to choose a passage', () => {
    it('narrows to the touched bar and says so', async () => {
      const { view, runtime, renderer } = createRig();
      await view.initialize();
      const step = runtime.controller.currentTimeline?.steps.find(
        (each) => each.measureIndex === 1,
      );
      if (step === undefined) {
        throw new Error('expected a second bar');
      }

      renderer.tapStep(step.index);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runtime.controller.settings.rangeFromBar).toBe(2);
      // The boxes are the same value seen at the desk, so they follow.
      expect(element<HTMLInputElement>('range-from').value).toBe('2');
      expect(element('import-notice').textContent).toContain('from bar 2');
    });

    it('says which bars it chose in fullscreen, where the notice is hidden', async () => {
      // Touching a note is a fullscreen gesture above all - the bar boxes are
      // out of reach at the stand. The answer went to a line of the page that
      // fullscreen hides, so the gesture appeared to do nothing at all.
      const { view, renderer } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();

      renderer.tapStep(1);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(element('focus-notice').textContent).toContain('bar');
    });

    it('leaves the page alone while a run is going', async () => {
      const { view, runtime, renderer } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('start').click();

      renderer.tapStep(1);
      await new Promise((resolve) => setTimeout(resolve, 0));

      // A stray touch mid-piece never meant "re-engrave under me".
      expect(runtime.controller.settings.rangeFromBar).toBeNull();
    });
  });

  it('hides the score cursor from the checkbox', async () => {
    const { view, runtime, renderer } = createRig();
    await view.initialize();
    expect(renderer.cursor.visible).toBe(true);

    const toggle = element<HTMLInputElement>('show-cursor');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));

    expect(runtime.controller.settings.showCursor).toBe(false);
    expect(renderer.cursor.visible).toBe(false);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(renderer.cursor.visible).toBe(true);
  });

  describe('blind mode', () => {
    function setBlind(on: boolean): void {
      const toggle = element<HTMLInputElement>('blind-mode');
      toggle.checked = on;
      toggle.dispatchEvent(new Event('change'));
    }

    it('takes the answer off the panel while the run is under way', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('start').click();

      // The panel is spelling the step out, which is the crutch being removed.
      const named = element('expected').textContent ?? '';
      expect(named).not.toBe('—');
      expect(named).not.toBe('');

      setBlind(true);

      expect(runtime.controller.settings.blindMode).toBe(true);
      expect(element('expected').textContent).toBe('');
      expect(element('expected-row').hidden).toBe(true);
    });

    it('gives the notes back without waiting for the next step', async () => {
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('start').click();
      const named = element('expected').textContent ?? '';

      setBlind(true);
      expect(element('expected').textContent).toBe('');
      // Wait mode holds still until the reader plays, so a panel that only
      // refills on the next step would stay blank exactly when it is needed.
      setBlind(false);

      expect(element('expected').textContent).toBe(named);
      expect(element('expected-row').hidden).toBe(false);
    });

    it('still says where in the piece the reader is', async () => {
      const { view } = createRig();
      await view.initialize();
      setBlind(true);
      element<HTMLButtonElement>('start').click();

      // Orientation is not an answer: bar and beat stay.
      expect(element('position').textContent).toMatch(/^bar 1 · beat /);
      expect(element('focus-notice').textContent).toMatch(/^bar 1 · beat /);
    });

    /**
     * Plays the run forward until a step holds more than one note.
     *
     * Which step that is depends on the seed, so it is found rather than
     * assumed; the level always contains one, and Wait mode moves on only
     * when a step has been played in full.
     */
    function advanceToChord(rig: Rig): readonly number[] {
      for (let pressed = 0; pressed < 64; pressed += 1) {
        const step = rig.runtime.controller.session?.currentStep;
        if (step === null || step === undefined) {
          throw new Error('the run ended before a chord was reached');
        }
        if (step.expectedMidi.length > 1) {
          return step.expectedMidi;
        }
        for (const midi of step.expectedMidi) {
          rig.midi.noteOn(midi, pressed);
        }
      }
      throw new Error('no chord in this exercise');
    }

    it('stops the note log naming the rest of the chord', async () => {
      // A press that leaves a chord unfinished is the log's other answer key:
      // "still: E4 G4" is the same help the panel was just made to withhold.
      const seeing = createRig();
      await seeing.view.initialize();
      element<HTMLButtonElement>('start').click();
      const chord = advanceToChord(seeing);
      seeing.midi.noteOn(chord[0] ?? 60, 100);
      expect(element('log').firstElementChild?.textContent).toContain('still:');

      mountRealMarkup();
      const blind = createRig();
      await blind.view.initialize();
      setBlind(true);
      element<HTMLButtonElement>('start').click();
      const hidden = advanceToChord(blind);
      blind.midi.noteOn(hidden[0] ?? 60, 100);

      const entry = element('log').firstElementChild?.textContent ?? '';
      expect(entry).not.toContain('still:');
      // What the reader themselves played is not a hint, and stays.
      expect(entry).toContain(midiToLabel(hidden[0] ?? 60));
    });

    it('is remembered on the next visit', async () => {
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();
      setBlind(true);

      mountRealMarkup();
      const second = createRig(undefined, store);
      await second.view.initialize();

      expect(second.runtime.controller.settings.blindMode).toBe(true);
      expect(element<HTMLInputElement>('blind-mode').checked).toBe(true);
      // Restored settings have to reach the panel, not only the checkbox.
      expect(element('expected-row').hidden).toBe(true);
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

      const button = element<HTMLButtonElement>('new-exercise');
      button.focus();
      pressSpace(button);

      // Space on a button is how a button is pressed; it must not also start.
      expect(runtime.controller.session).toBeNull();
    });

    it('ignores a shortcut that happens to include space', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      const event = new KeyboardEvent('keydown', {
        code: 'Space',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(event);

      expect(runtime.controller.session).toBeNull();
      expect(event.defaultPrevented).toBe(false);
    });

    it('agrees with the pill about what play means', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();

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

  describe('the note log', () => {
    async function playNotes(rig: Rig, count: number): Promise<number[]> {
      await rig.view.initialize();
      element<HTMLButtonElement>('start').click();
      const played: number[] = [];
      for (let index = 0; index < count; index += 1) {
        const midi = 60 + index;
        rig.midi.noteOn(midi, index);
        played.push(midi);
      }
      return played;
    }

    it('puts the newest note at the top', async () => {
      const rig = createRig();
      await playNotes(rig, 3);

      const log = element('log');
      // Played C4, C#4, D4 - the most recent is the one the reader should not
      // have to hunt for.
      expect(log.firstElementChild?.textContent).toContain('D4');
      expect(log.lastElementChild?.textContent).toContain('C4');
    });

    it('keeps the view on the newest entry', async () => {
      const rig = createRig();
      const log = element('log');
      log.scrollTop = 0;

      await playNotes(rig, 5);

      expect(log.scrollTop).toBe(0);
    });

    it('leaves the reader alone when they have scrolled away', async () => {
      const rig = createRig();
      await playNotes(rig, 3);
      const log = element('log');

      log.scrollTop = 120;
      rig.midi.noteOn(72, 99);

      expect(log.scrollTop).toBe(120);
    });

    it('drops the oldest entries rather than growing without end', async () => {
      const rig = createRig();
      await playNotes(rig, 45);

      const log = element('log');
      expect(log.childElementCount).toBe(40);
      // The first five presses fell off the far end.
      expect(log.textContent).not.toContain('C4 ');
    });

    it('starts empty on a new run', async () => {
      const rig = createRig();
      await playNotes(rig, 3);
      expect(element('log').childElementCount).toBeGreaterThan(0);

      // Start is disabled while a run is going, so stop it first.
      element<HTMLButtonElement>('stop').click();
      element<HTMLButtonElement>('start').click();

      expect(element('log').childElementCount).toBe(0);
    });
  });

  describe('layout and score settings', () => {
    it('keeps the run controls in the toolbar, out of the settings', async () => {
      const { view } = createRig();
      await view.initialize();

      const toolbar = document.querySelector('.toolbar');
      const controls = document.querySelector('.controls');
      expect(toolbar).not.toBeNull();
      for (const id of ['start', 'pause', 'stop', 'new-exercise', 'focus']) {
        expect(toolbar?.contains(element(id))).toBe(true);
        expect(controls?.contains(element(id))).toBe(false);
      }
    });

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
      const cursor = element<HTMLInputElement>('show-cursor');
      cursor.checked = false;
      cursor.dispatchEvent(new Event('change'));
      await Promise.resolve();

      mountRealMarkup();
      const second = createRig(undefined, store);
      await second.view.initialize();

      expect(second.runtime.controller.settings.tempoBpm).toBe(128);
      expect(second.runtime.controller.settings.showCursor).toBe(false);
      expect(element<HTMLInputElement>('tempo').value).toBe('128');
      expect(element<HTMLInputElement>('show-cursor').checked).toBe(false);
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
    it('hides the page furniture and shows the pill', async () => {
      const { view, renderer } = createRig();
      await view.initialize();
      const rendersBefore = renderer.refreshCount;

      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();

      expect(element('app').classList.contains('is-focus')).toBe(true);
      expect(element('focus-bar').hidden).toBe(false);
      expect(element<HTMLButtonElement>('focus').textContent).toBe('Exit fullscreen');
      // The score has the whole width now, so it has to be laid out again.
      expect(renderer.refreshCount).toBeGreaterThan(rendersBefore);
    });

    it('starts and pauses the run from the pill', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();

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

    it('opens straight into fullscreen when the reader asked it to', async () => {
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();
      const startFocus = element<HTMLInputElement>('start-focus');
      startFocus.checked = true;
      startFocus.dispatchEvent(new Event('change'));
      await Promise.resolve();
      expect(element('app').classList.contains('is-focus')).toBe(false);

      mountRealMarkup();
      const second = createRig(undefined, store);
      await second.view.initialize();

      expect(element('app').classList.contains('is-focus')).toBe(true);
      expect(element('focus-bar').hidden).toBe(false);
    });

    it('raises the kept lists without leaving the stand', async () => {
      // Leaving fullscreen to look at a list and coming back is a re-engraving
      // each way, which on a long piece is most of a second twice over.
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();
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
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();
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

    it('cycles the click through the three answers a thumb wants', async () => {
      const { runtime, view } = createRig();
      await view.initialize();
      setClickWhen('always');

      const button = element<HTMLButtonElement>('focus-click');
      expect(button.dataset['click']).toBe('always');

      button.click();
      expect(runtime.controller.settings.clickWhen).toBe('count-in-only');
      // The name as well as the picture: three states cannot be guessed at.
      expect(button.title).toBe('Metronome: only the count-in');

      button.click();
      expect(runtime.controller.settings.clickWhen).toBe('never');
      expect(button.dataset['click']).toBe('never');

      button.click();
      expect(runtime.controller.settings.clickWhen).toBe('always');
    });

    it('cycles how much of the pulse is clicked', async () => {
      // A different question from when the click sounds at all: two clicks a
      // bar is a metre, not a volume, and a piece that gives only those is
      // exactly when a reader wants more of them.
      const { runtime, view } = createRig();
      await view.initialize();
      const select = element<HTMLSelectElement>('click');
      select.value = 'downbeat';
      select.dispatchEvent(new Event('change'));

      const button = element<HTMLButtonElement>('focus-pattern');
      button.click();

      expect(runtime.controller.settings.clickPattern).toBe('pulse');
      expect(button.dataset['pattern']).toBe('pulse');
      expect(button.title).toBe('Click: every beat');

      button.click();
      expect(runtime.controller.settings.clickPattern).toBe('division');
    });

    it('leaves the cycles to the settings, and steps out of one', async () => {
      // A bar on and a bar off is chosen deliberately before a run. The button
      // shows it as sounding, which is what its next press makes true.
      const { runtime, view } = createRig();
      await view.initialize();
      setClickWhen('cycle-2');

      const button = element<HTMLButtonElement>('focus-click');
      expect(button.dataset['click']).toBe('always');

      button.click();

      expect(runtime.controller.settings.clickWhen).toBe('always');
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

        const from = element<HTMLInputElement>('range-from');
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
        expect(element<HTMLInputElement>('range-from').value).toBe('2');
      });

      it('counts by the score\'s own bar numbers, not from one again', async () => {
        // The complaint this answers: a passage is a score in its own right by
        // the time it reaches the page, so the reader was told they were at
        // bar 1 of a piece whose bar 1 they had cut away.
        const { view } = createRig();
        await view.initialize();
        const from = element<HTMLInputElement>('focus-from');
        from.value = '2';
        from.dispatchEvent(new Event('change'));
        await new Promise((resolve) => setTimeout(resolve, 0));

        element<HTMLButtonElement>('start').click();

        expect(element('focus-notice').textContent).toMatch(/^bar 2 · beat /);
        expect(element('position').textContent).toMatch(/^bar 2 · beat /);
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
        expect(element<HTMLInputElement>('range-from').value).toBe('');
        expect(element('focus-handle').dataset['passage']).toBe('false');
      });
    });

    it('keeps the transport on one row and the settings underneath', async () => {
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();

      // Icons small enough that the whole transport fits a single line; the
      // drawer is for what you change rather than what you press mid-run.
      const row = element('focus-play').parentElement;
      expect(row?.className).toContain('focus-bar__row');
      for (const id of ['focus-stop', 'focus-listen', 'focus-next', 'focus-exit']) {
        expect(element(id).parentElement).toBe(row);
        // Named for a screen reader, since the label is a picture now.
        expect(element(id).getAttribute('aria-label')).toBeTruthy();
      }
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

    it('turns survival on from the drawer, and shows that it is on', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ modeId: FLOW_MODE_ID });
      const toggle = element<HTMLButtonElement>('focus-survival');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      expect(element('focus-health').hidden).toBe(true);

      toggle.click();

      expect(runtime.controller.settings.survival).toBe(true);
      // Pressed is the state rather than a second label beside it.
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      expect(element('focus-health').hidden).toBe(false);
      // The switch in the settings footer is the same value seen elsewhere.
      expect(element<HTMLInputElement>('survival').checked).toBe(true);
    });

    it('switches between waiting and flowing from the drawer', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      const toggle = element<HTMLButtonElement>('focus-wait');
      // The rig starts in Wait mode, which the switch has to show.
      expect(toggle.getAttribute('aria-pressed')).toBe('true');

      toggle.click();

      expect(runtime.controller.settings.modeId).toBe(FLOW_MODE_ID);
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      // The selector at the desk is the same value seen from the stand.
      expect(element<HTMLSelectElement>('mode').value).toBe(FLOW_MODE_ID);

      toggle.click();
      expect(runtime.controller.settings.modeId).toBe(new WaitMode().id);
    });

    it('shows and hides the cursor from the drawer', async () => {
      const { view, runtime, renderer } = createRig();
      await view.initialize();
      const toggle = element<HTMLButtonElement>('focus-cursor');
      expect(toggle.getAttribute('aria-pressed')).toBe('true');

      toggle.click();

      expect(runtime.controller.settings.showCursor).toBe(false);
      expect(renderer.cursor.visible).toBe(false);
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      // The checkbox at the desk is the same value seen elsewhere.
      expect(element<HTMLInputElement>('show-cursor').checked).toBe(false);

      toggle.click();
      expect(renderer.cursor.visible).toBe(true);
    });

    it('shows and hides the played notes from the drawer', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      const toggle = element<HTMLButtonElement>('focus-marks');
      expect(toggle.getAttribute('aria-pressed')).toBe('true');

      toggle.click();

      expect(runtime.controller.settings.playedNotes).toBe('hidden');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');

      toggle.click();
      expect(runtime.controller.settings.playedNotes).toBe('live');
    });

    it('reads as on for marks that are merely being held back', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      const select = element<HTMLSelectElement>('show-played');
      select.value = 'at-end';
      select.dispatchEvent(new Event('change'));

      // Waiting for the run to end is still showing them, so a switch that
      // read "off" here would be lying about the setting behind it - and the
      // switch has to hear about a change made from the desk at all.
      expect(runtime.controller.settings.playedNotes).toBe('at-end');
      expect(element('focus-marks').getAttribute('aria-pressed')).toBe('true');

      element<HTMLButtonElement>('focus-marks').click();

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

    it('says the count-in and the verdict on a pill of its own', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      runtime.controller.updateSettings({ countInBars: 1, modeId: FLOW_MODE_ID });
      await runtime.controller.reloadExercise();
      expect(element('focus-notice').textContent).not.toContain('Counting in');

      runtime.controller.start();

      // The widest thing the transport ever says, kept out of the row a thumb
      // is aiming at: absolutely positioned beside the bar, its width cannot
      // move the buttons nor shift the bar off centre.
      expect(element('focus-notice').textContent).toContain('Counting in');
      expect(element('focus-notice').parentElement?.id).toBe('focus-bar');
    });

    it('opens and closes the drawer from its handle', async () => {
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();

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
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();
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
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();
      expect(element('focus-tempo').textContent).toBe('100%');

      element<HTMLButtonElement>('focus-slower').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runtime.controller.tempoPercent).toBe(95);
      expect(element('focus-tempo').textContent).toBe('95%');
      // The desk slider is the same value seen another way, so it follows.
      expect(element<HTMLInputElement>('tempo').value).toBe(
        String(runtime.controller.settings.tempoBpm),
      );
    });

    it('re-engraves once the pressing stops, not on every press', async () => {
      const { view, renderer } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();
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

    it('hears the exercise without leaving fullscreen', async () => {
      const { view, runtime } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();

      element<HTMLButtonElement>('focus-listen').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runtime.controller.isListening).toBe(true);
      // Both bars say the same thing, so leaving fullscreen mid-playback
      // cannot show a button that disagrees with the one just pressed. The
      // fullscreen one says it in its name: writing the label into the button
      // would throw the icon away, which is what it used to do.
      const speaking = element('focus-listen-icon').getAttribute('d');
      expect(element('focus-listen').getAttribute('aria-label')).toBe('Stop listening');
      expect(element('listen').textContent).toBe('Stop listening');
      expect(element('focus-listen').querySelector('svg')).not.toBeNull();

      element<HTMLButtonElement>('focus-listen').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runtime.controller.isListening).toBe(false);
      expect(element('focus-listen').getAttribute('aria-label')).toBe('Listen');
      expect(element('focus-listen-icon').getAttribute('d')).not.toBe(speaking);
    });

    it('shows where you are, then the grade, without the side panel', async () => {
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();
      element<HTMLButtonElement>('focus-play').click();

      expect(element('focus-notice').textContent).toContain('bar 1');

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
      // The verdict goes to the pill beside the bar, where its width is
      // nobody's business; the status says only where the run got to.
      expect(element('focus-notice').textContent).toMatch(/^[A-F] · \d+%$/);
    });

    it('loads a new exercise from the pill', async () => {
      const { view, renderer } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();

      element<HTMLButtonElement>('focus-next').click();
      await Promise.resolve();
      await Promise.resolve();

      expect(renderer.loadCount).toBe(2);
    });

    it('comes back out again', async () => {
      const { view } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();

      element<HTMLButtonElement>('focus-exit').click();
      await Promise.resolve();

      expect(element('app').classList.contains('is-focus')).toBe(false);
      expect(element('focus-bar').hidden).toBe(true);
      expect(element<HTMLButtonElement>('focus').textContent).toBe('Fullscreen');
    });
  });

  it('detaches its listeners on dispose', async () => {
    const { view, runtime } = createRig();
    await view.initialize();

    view.dispose();
    element<HTMLButtonElement>('start').click();

    expect(runtime.controller.session).toBeNull();
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

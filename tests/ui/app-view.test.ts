// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
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

import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import {
  AccuracyScoringStrategy,
  ContinuityScoringStrategy,
  TimingWeightedScoringStrategy,
} from '../../src/domain/scoring/strategies.js';
import { ScoringStrategyRegistry } from '../../src/domain/scoring/ScoringStrategyRegistry.js';
import { DomMusicXmlImporter } from '../../src/infrastructure/notation/DomMusicXmlImporter.js';
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
import { AppView, describeTendency } from '../../src/ui/AppView.js';
import { twoBarExercise } from '../support/fixtures.js';

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
  readonly midi: MockMidiAdapter;
  readonly renderer: FakeScoreRenderer;
  readonly clock: ManualClock;
  readonly store: InMemorySettingsStore;
  readonly settings: SettingsRepository;
  readonly metronomeVolume: FakeVolume;
  readonly instrumentVolume: FakeVolume;
  readonly sustain: FakeSustain;
  readonly samples: FakeSampleLibrary;
}

function createRig(
  webMidiOverride?: AppRuntime['webMidi'],
  store: InMemorySettingsStore = new InMemorySettingsStore(),
): Rig {
  const clock = new ManualClock();
  const midi = new MockMidiAdapter({ clock });
  const metronome = new ManualMetronome(clock);
  const renderer = new FakeScoreRenderer();
  const presets = new ExercisePresetRegistry().registerAll(BUILT_IN_PRESETS);
  const modes = new PracticeModeRegistry().registerAll([new WaitMode(), new FlowMode()]);
  const rhythms = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);
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
    serializer: new MusicXmlSerializer(),
    renderer,
    cursor: renderer.cursor,
    overlay: renderer,
    fade: renderer,
    zoom: renderer,
    midi,
    metronome,
    instrument: new RecordingPitchPlayer(),
    clock,
    scorings,
    initialSettings: {
      countInBars: 0,
      metronomeMuted: true,
      matchToleranceMs: Number.POSITIVE_INFINITY,
      ...restored.practice,
    },
  });
  controller.events.on('settingsChanged', ({ settings: current }) => {
    settings.savePractice(current);
  });

  const runtime: AppRuntime = {
    controller,
    presets,
    rhythms,
    importer: new DomMusicXmlImporter(),
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
    midi,
    renderer,
    clock,
    store,
    settings,
    metronomeVolume,
    instrumentVolume,
    sustain,
    samples,
  };
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`#${id} is missing from index.html`);
  }
  return found as T;
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
    expect(element<HTMLSelectElement>('dropout').options).toHaveLength(4);
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
    select.value = '2';
    select.dispatchEvent(new Event('change'));
    await Promise.resolve();

    expect(runtime.controller.settings.dropoutBars).toBe(2);
    expect(element('dropout-description').textContent).toContain('2 bars');
    expect(renderer.loadCount).toBe(before);
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
      expect(element<HTMLButtonElement>('focus-play').textContent).toBe('Resume');
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
      expect(surface?.parentElement?.classList.contains('score')).toBe(true);
      expect(surface?.children).toHaveLength(0);
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

    it('turns the played-note overlay off from the checkbox', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      const toggle = element<HTMLInputElement>('show-played');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.showPlayedNotes).toBe(false);
    });

    it('turns fading on from the checkbox, and remembers it', async () => {
      const store = new InMemorySettingsStore();
      const first = createRig(undefined, store);
      await first.view.initialize();
      expect(first.runtime.controller.settings.fadePassedNotes).toBe(false);

      const toggle = element<HTMLInputElement>('fade-passed');
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));
      expect(first.runtime.controller.settings.fadePassedNotes).toBe(true);

      mountRealMarkup();
      const second = createRig(undefined, store);
      await second.view.initialize();

      expect(element<HTMLInputElement>('fade-passed').checked).toBe(true);
      expect(second.runtime.controller.settings.fadePassedNotes).toBe(true);
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

  it('sends the sustain pedal to the instrument and shows it', async () => {
    const rig = createRig();
    await rig.view.initialize();

    rig.midi.pedal(true);

    expect(rig.sustain.sustained).toBe(true);
    expect(element('pedal-status').hidden).toBe(false);
    expect(element('pedal-status').textContent).toContain('down');

    rig.midi.pedal(false);

    expect(rig.sustain.sustained).toBe(false);
    expect(element('pedal-status').textContent).toBe('Ped.');
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
      expect(element<HTMLButtonElement>('focus-play').textContent).toBe('Pause');
      expect(element<HTMLButtonElement>('focus-stop').disabled).toBe(false);

      element<HTMLButtonElement>('focus-play').click();
      expect(runtime.controller.session?.status).toBe('paused');
      expect(element<HTMLButtonElement>('focus-play').textContent).toBe('Resume');

      element<HTMLButtonElement>('focus-play').click();
      expect(runtime.controller.session?.status).toBe('running');

      element<HTMLButtonElement>('focus-stop').click();
      expect(runtime.controller.session?.status).toBe('aborted');
    });

    it('shows where you are, then the grade, without the side panel', async () => {
      const { view, runtime, midi } = createRig();
      await view.initialize();
      element<HTMLButtonElement>('focus').click();
      await Promise.resolve();
      element<HTMLButtonElement>('focus-play').click();

      expect(element('focus-status').textContent).toContain('bar 1');

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
      expect(element('focus-status').textContent).toMatch(/^[A-F] · \d+%$/);
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

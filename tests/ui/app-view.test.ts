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
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import {
  AccuracyScoringStrategy,
  TimingWeightedScoringStrategy,
} from '../../src/domain/scoring/strategies.js';
import type { KeyboardTarget } from '../../src/infrastructure/midi/ComputerKeyboardMidiSource.js';
import { ComputerKeyboardMidiSource } from '../../src/infrastructure/midi/ComputerKeyboardMidiSource.js';
import { FakeScoreRenderer } from '../../src/infrastructure/testing/FakeScoreRenderer.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { ManualMetronome } from '../../src/infrastructure/testing/ManualMetronome.js';
import { MockMidiAdapter } from '../../src/infrastructure/testing/MockMidiAdapter.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import { SettingsRepository } from '../../src/application/SettingsRepository.js';
import type { IVolumeControl } from '../../src/application/ports/IVolumeControl.js';
import { WebMidiAdapter } from '../../src/infrastructure/midi/WebMidiAdapter.js';
import { AppView } from '../../src/ui/AppView.js';

// Resolved from the project root: in a jsdom environment `import.meta.url` is
// served over http, so it cannot be turned into a file path.
const INDEX_HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

/** Installs the real markup, so a renamed id fails this test rather than production. */
function mountRealMarkup(): void {
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(INDEX_HTML)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
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
  const accuracy = new AccuracyScoringStrategy();
  const timing = new TimingWeightedScoringStrategy();

  const settings = new SettingsRepository(store, {
    presetIds: presets.list().map((preset) => preset.id),
    modeIds: modes.list().map((mode) => mode.id),
  });
  const restored = settings.load();
  const metronomeVolume = new FakeVolume();
  const instrumentVolume = new FakeVolume();

  const controller = new PracticeController({
    presets,
    modes,
    serializer: new MusicXmlSerializer(),
    renderer,
    cursor: renderer.cursor,
    highlighter: renderer,
    zoom: renderer,
    midi,
    metronome,
    clock,
    scoringFor: (modeId) => (modeId === FLOW_MODE_ID ? timing : accuracy),
    initialSettings: {
      countInBeats: 0,
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
    modes,
    webMidi: webMidiOverride ?? midi,
    bridge: null,
    computerKeyboard: new ComputerKeyboardMidiSource(
      document as unknown as KeyboardTarget,
      clock,
    ),
    pitchPlayer: new SilentPitchPlayer(),
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
    expect(element<HTMLSelectElement>('mode').options).toHaveLength(2);
    expect(element<HTMLSelectElement>('key').options.length).toBeGreaterThan(5);
    expect(element('preset-description').textContent).not.toBe('');
    expect(element('mode-description').textContent).toContain('waits');
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

    it('turns note colouring off from the checkbox', async () => {
      const { view, runtime } = createRig();
      await view.initialize();

      const toggle = element<HTMLInputElement>('highlight-notes');
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change'));

      expect(runtime.controller.settings.highlightNotes).toBe(false);
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

    it('starts from the defaults when the device has nothing stored', async () => {
      const rig = createRig();
      await rig.view.initialize();

      expect(element<HTMLInputElement>('metronome-volume').value).toBe('60');
      expect(rig.metronomeVolume.volume).toBeCloseTo(0.6, 10);
    });
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

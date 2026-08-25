import { describe, expect, it, vi } from 'vitest';
import { PracticeController } from '../../src/application/PracticeController.js';
import { FLOW_MODE_ID, FlowMode } from '../../src/application/modes/FlowMode.js';
import { PracticeModeRegistry } from '../../src/application/modes/PracticeModeRegistry.js';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import { ExercisePresetRegistry } from '../../src/domain/generation/ExercisePresetRegistry.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { AccuracyScoringStrategy, TimingWeightedScoringStrategy } from '../../src/domain/scoring/strategies.js';
import { FakeScoreRenderer } from '../../src/infrastructure/testing/FakeScoreRenderer.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { ManualMetronome } from '../../src/infrastructure/testing/ManualMetronome.js';
import { MockMidiAdapter } from '../../src/infrastructure/testing/MockMidiAdapter.js';

/** Strips the printed tempo so two renderings can be compared note for note. */
function withoutTempoMark(xml: string): string {
  return xml
    .split(/\r?\n/)
    .filter((line) => !line.includes('per-minute') && !line.includes('<sound'))
    .join(' ');
}

function createController(): {
  controller: PracticeController;
  renderer: FakeScoreRenderer;
  midi: MockMidiAdapter;
  metronome: ManualMetronome;
  clock: ManualClock;
} {
  const clock = new ManualClock();
  const midi = new MockMidiAdapter({ clock });
  const metronome = new ManualMetronome(clock);
  const renderer = new FakeScoreRenderer();
  const accuracy = new AccuracyScoringStrategy();
  const timing = new TimingWeightedScoringStrategy();

  const controller = new PracticeController({
    presets: new ExercisePresetRegistry().registerAll(BUILT_IN_PRESETS),
    modes: new PracticeModeRegistry().registerAll([new WaitMode(), new FlowMode()]),
    serializer: new MusicXmlSerializer(),
    renderer,
    cursor: renderer.cursor,
    midi,
    metronome,
    clock,
    scoringFor: (modeId) => (modeId === FLOW_MODE_ID ? timing : accuracy),
    initialSettings: {
      countInBeats: 0,
      metronomeMuted: true,
      matchToleranceMs: Number.POSITIVE_INFINITY,
    },
  });

  return { controller, renderer, midi, metronome, clock };
}

describe('PracticeController', () => {
  it('adopts the first registered preset and mode as its defaults', () => {
    const { controller } = createController();
    const [firstPreset] = BUILT_IN_PRESETS;

    expect(controller.settings.presetId).toBe(firstPreset?.id);
    expect(controller.settings.modeId).toBe(new WaitMode().id);
    expect(controller.settings.tempoBpm).toBe(firstPreset?.defaults.tempoBpm);
  });

  it('generates, serialises and renders an exercise', async () => {
    const { controller, renderer } = createController();
    const loaded = vi.fn();
    controller.events.on('exerciseLoaded', loaded);

    const exercise = await controller.loadNewExercise();

    expect(renderer.loadCount).toBe(1);
    expect(renderer.loadedXml).toContain('<score-partwise');
    expect(renderer.cursor.resetCount).toBeGreaterThan(0);
    expect(renderer.cursor.visible).toBe(true);
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(controller.currentExercise).toBe(exercise);
    expect(controller.currentTimeline?.length).toBeGreaterThan(0);
  });

  it('reproduces the same music when only the tempo changes', async () => {
    const { controller, renderer } = createController();
    await controller.loadNewExercise();
    const original = renderer.loadedXml ?? '';

    controller.updateSettings({ tempoBpm: 96 });
    await controller.reloadExercise();

    expect(renderer.loadedXml).not.toBe(original);
    expect(renderer.loadedXml).toContain('<per-minute>96</per-minute>');
    // Same seed, so the notes are untouched: only the tempo mark differs.
    expect(withoutTempoMark(renderer.loadedXml ?? '')).toBe(withoutTempoMark(original));
  });

  it('produces different music on each new exercise', async () => {
    const { controller, renderer } = createController();
    await controller.loadNewExercise();
    const first = renderer.loadedXml;

    await controller.loadNewExercise();

    expect(renderer.loadedXml).not.toBe(first);
    expect(renderer.loadCount).toBe(2);
  });

  it('adopts a preset’s defaults when the level changes', () => {
    const { controller } = createController();
    const target = BUILT_IN_PRESETS[3];
    if (target === undefined) {
      throw new Error('expected several presets');
    }

    const settings = controller.updateSettings({ presetId: target.id });

    expect(settings.key.equals(target.defaults.key)).toBe(true);
    expect(settings.tempoBpm).toBe(target.defaults.tempoBpm);
    expect(settings.measures).toBe(target.defaults.measures);
  });

  it('lets an explicit override win over the preset defaults', () => {
    const { controller } = createController();
    const target = BUILT_IN_PRESETS[3];
    if (target === undefined) {
      throw new Error('expected several presets');
    }

    const settings = controller.updateSettings({
      presetId: target.id,
      key: KeySignature.major(-2),
      measures: 7,
    });

    expect(settings.key.fifths).toBe(-2);
    expect(settings.measures).toBe(7);
  });

  it('honours requested settings when generating', async () => {
    const { controller } = createController();
    controller.updateSettings({
      measures: 3,
      timeSignature: new TimeSignature(3, 4),
      key: KeySignature.major(-1),
      tempoBpm: 84,
    });

    const exercise = await controller.loadNewExercise();

    expect(exercise.staves[0]?.measures).toHaveLength(3);
    expect(exercise.timeSignature.toString()).toBe('3/4');
    expect(exercise.key.name).toBe('F major');
    expect(exercise.tempoBpm).toBe(84);
  });

  it('refuses to start before an exercise is loaded', () => {
    const { controller } = createController();
    const onError = vi.fn();
    controller.events.on('error', onError);

    expect(controller.start()).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('creates a session and drives the cursor from it', async () => {
    const { controller, renderer, midi } = createController();
    await controller.loadNewExercise();
    const created = vi.fn();
    controller.events.on('sessionCreated', created);

    const session = controller.start();

    expect(created).toHaveBeenCalledTimes(1);
    expect(session).not.toBeNull();
    expect(session?.status).toBe('running');
    expect(renderer.cursor.moves).toEqual([0]);

    const step = session?.currentStep;
    if (step === undefined || step === null) {
      throw new Error('expected a first step');
    }
    for (const midiNote of step.expectedMidi) {
      midi.noteOn(midiNote, 0);
    }

    expect(renderer.cursor.moves.length).toBeGreaterThan(1);
    expect(renderer.cursor.moves[1]).toBe(1);
  });

  it('resets the cursor when a run ends', async () => {
    const { controller, renderer } = createController();
    await controller.loadNewExercise();
    controller.start();
    const resetsBefore = renderer.cursor.resetCount;

    controller.stop();

    expect(controller.session?.status).toBe('aborted');
    expect(renderer.cursor.resetCount).toBeGreaterThan(resetsBefore);
  });

  it('replaces the previous session when a new run starts', async () => {
    const { controller } = createController();
    await controller.loadNewExercise();

    const first = controller.start();
    const second = controller.start();

    expect(second).not.toBe(first);
    expect(first?.status).toBe('running');
    expect(controller.session).toBe(second);
  });

  it('tears the session down when a new exercise is loaded', async () => {
    const { controller } = createController();
    await controller.loadNewExercise();
    controller.start();

    await controller.loadNewExercise();

    expect(controller.session).toBeNull();
  });

  it('passes the practice settings through to the session', async () => {
    const { controller, metronome } = createController();
    controller.updateSettings({ modeId: FLOW_MODE_ID, countInBeats: 2, metronomeMuted: true });
    await controller.loadNewExercise();

    const session = controller.start();

    expect(session?.status).toBe('counting-in');
    expect(metronome.isRunning).toBe(true);
    expect(metronome.currentConfig.muted).toBe(true);
    expect(metronome.currentConfig.bpm).toBe(controller.settings.tempoBpm);
  });

  it('clears everything on dispose', async () => {
    const { controller, renderer } = createController();
    await controller.loadNewExercise();
    controller.start();

    controller.dispose();

    expect(controller.session).toBeNull();
    expect(renderer.clearCount).toBe(1);
  });
});

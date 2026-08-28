import { describe, expect, it, vi } from 'vitest';
import {
  PracticeController,
  type PracticeControllerDependencies,
  type PracticeSettings,
} from '../../src/application/PracticeController.js';
import { FLOW_MODE_ID, FlowMode } from '../../src/application/modes/FlowMode.js';
import { PracticeModeRegistry } from '../../src/application/modes/PracticeModeRegistry.js';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import { ExercisePresetRegistry } from '../../src/domain/generation/ExercisePresetRegistry.js';
import type { ExerciseRequest } from '../../src/domain/generation/IExerciseGenerator.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';

import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import {
  AccuracyScoringStrategy,
  ContinuityScoringStrategy,
  TimingWeightedScoringStrategy,
} from '../../src/domain/scoring/strategies.js';
import { ScoringStrategyRegistry } from '../../src/domain/scoring/ScoringStrategyRegistry.js';
import { FakeScoreRenderer } from '../../src/infrastructure/testing/FakeScoreRenderer.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { ManualMetronome } from '../../src/infrastructure/testing/ManualMetronome.js';
import { MockMidiAdapter } from '../../src/infrastructure/testing/MockMidiAdapter.js';
import { DomainError } from '../../src/shared/errors.js';
import { tiedExercise, twoBarExercise } from '../support/fixtures.js';

/** Strips the printed tempo so two renderings can be compared note for note. */
function withoutTempoMark(xml: string): string {
  return xml
    .split(/\r?\n/)
    .filter((line) => !line.includes('per-minute') && !line.includes('<sound'))
    .join(' ');
}

/**
 * @param fixedExercise Serve one known exercise instead of generating.
 *
 * Generated material is random by design, so any test that asserts *which*
 * step is which has to pin it down - otherwise a bar that happens to start
 * with a rest makes the test fail once in a while.
 */
function createController(
  fixedExercise = false,
  providerFor?: PracticeControllerDependencies['providerFor'],
  extraSettings: Partial<PracticeSettings> = {},
): {
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

  const controller = new PracticeController({
    presets: new ExercisePresetRegistry().registerAll(BUILT_IN_PRESETS),
    rhythms: new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES),
    modes: new PracticeModeRegistry().registerAll([new WaitMode(), new FlowMode()]),
    serializer: new MusicXmlSerializer(),
    renderer,
    cursor: renderer.cursor,
    overlay: renderer,
    fade: renderer,
    zoom: renderer,
    midi,
    metronome,
    clock,
    scorings: new ScoringStrategyRegistry().registerAll([
      new AccuracyScoringStrategy(),
      new TimingWeightedScoringStrategy(),
      new ContinuityScoringStrategy(),
    ]),
    ...(fixedExercise
      ? { providerFor: () => ({ provide: () => Promise.resolve(twoBarExercise()) }) }
      : {}),
    ...(providerFor === undefined ? {} : { providerFor }),
    initialSettings: {
      countInBars: 0,
      metronomeMuted: true,
      matchToleranceMs: Number.POSITIVE_INFINITY,
      ...extraSettings,
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

  it('adopts the grading a mode is usually judged by', () => {
    const { controller } = createController();
    expect(controller.settings.modeId).toBe(new WaitMode().id);
    expect(controller.settings.scoringId).toBe('scoring.accuracy');

    const settings = controller.updateSettings({ modeId: FLOW_MODE_ID });
    expect(settings.scoringId).toBe('scoring.timing-weighted');
  });

  it('lets the reader grade a mode however they like', () => {
    const { controller } = createController();

    // Named in the same breath as the mode, so it is not a default to adopt.
    const together = controller.updateSettings({
      modeId: FLOW_MODE_ID,
      scoringId: 'scoring.continuity',
    });
    expect(together.scoringId).toBe('scoring.continuity');

    // And chosen on its own, it simply stays.
    const alone = controller.updateSettings({ scoringId: 'scoring.accuracy' });
    expect(alone.scoringId).toBe('scoring.accuracy');
    expect(alone.modeId).toBe(FLOW_MODE_ID);
  });

  it('takes its grading from the restored mode, not from mode one', () => {
    const { controller } = createController(false, undefined, { modeId: FLOW_MODE_ID });
    expect(controller.settings.scoringId).toBe('scoring.timing-weighted');
  });

  it('adopts a preset’s rhythm profile with its other defaults', () => {
    const { controller } = createController();
    // A different preset from the one the controller opened on, or the
    // adopt-the-defaults branch never runs.
    const target = BUILT_IN_PRESETS[2];
    if (target === undefined || target.id === controller.settings.presetId) {
      throw new Error('expected several presets');
    }

    controller.updateSettings({ rhythmProfileId: 'sixteenths' });
    const settings = controller.updateSettings({ presetId: target.id });

    expect(settings.rhythmProfileId).toBe(target.defaults.rhythmProfileId);
  });

  it('keeps an explicitly chosen rhythm when the level changes with it', () => {
    const { controller } = createController();
    const target = BUILT_IN_PRESETS[3];
    if (target === undefined) {
      throw new Error('expected several presets');
    }

    const settings = controller.updateSettings({
      presetId: target.id,
      rhythmProfileId: 'sixteenths',
    });

    expect(settings.rhythmProfileId).toBe('sixteenths');
  });

  it('defaults a missing rhythm to the restored level, not to level one', () => {
    const target = BUILT_IN_PRESETS[5];
    if (target === undefined) {
      throw new Error('expected several presets');
    }
    // What settings stored before the rhythm axis existed look like: a preset
    // id and nothing to say which rhythm goes with it.
    const { controller } = createController(false, undefined, { presetId: target.id });

    expect(controller.settings.presetId).toBe(target.id);
    expect(controller.settings.rhythmProfileId).toBe(target.defaults.rhythmProfileId);
    expect(controller.settings.tempoBpm).toBe(target.defaults.tempoBpm);
  });

  it('hands the chosen rhythm profile to the generator', async () => {
    const requests: ExerciseRequest[] = [];
    const { controller } = createController(false, (generator) => ({
      provide: (request) => {
        requests.push(request);
        return Promise.resolve(generator.generate(request));
      },
    }));

    controller.updateSettings({ rhythmProfileId: 'sixteenths' });
    await controller.loadNewExercise();

    expect(requests.at(-1)?.rhythm.id).toBe('sixteenths');
  });

  it('refuses a rhythm profile nobody registered', () => {
    const { controller } = createController();
    controller.updateSettings({ rhythmProfileId: 'no-such-profile' });

    return expect(controller.loadNewExercise()).rejects.toThrow(DomainError);
  });

  it('practises a score that came from outside', async () => {
    const { controller, renderer } = createController();
    const opened = tiedExercise({ title: 'Something Borrowed' });

    const loaded = await controller.openScore(opened);

    expect(loaded).toBe(opened);
    expect(controller.currentExercise).toBe(opened);
    expect(controller.openedExercise).toBe(opened);
    expect(renderer.loadedXml).toContain('Something Borrowed');
    // The timeline is derived from it like any other exercise, which is the
    // whole reason an import has to become one.
    expect(controller.currentTimeline?.length).toBe(4);
  });

  it('keeps the opened score until something says otherwise', async () => {
    const { controller } = createController();
    await controller.openScore(tiedExercise());

    await controller.reloadExercise();
    expect(controller.openedExercise).not.toBeNull();

    // Asking for a new exercise is asking the generator for one.
    await controller.loadNewExercise();
    expect(controller.openedExercise).toBeNull();
  });

  it('goes back to generating when the material settings change', async () => {
    const { controller } = createController();
    await controller.openScore(tiedExercise());

    const target = BUILT_IN_PRESETS[2];
    if (target === undefined) {
      throw new Error('expected several presets');
    }
    controller.updateSettings({ presetId: target.id });

    expect(controller.openedExercise).toBeNull();
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
    const { controller, renderer, midi } = createController(true);
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
    controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 1, metronomeMuted: true });
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

describe('what you played, drawn over the score', () => {
  it('is told the key and the clefs, so a press can be spelled and placed', async () => {
    const { controller, renderer } = createController(true);
    await controller.loadNewExercise();

    expect(renderer.overlayContext?.keyAt(0).name).toBe('C major');
    expect(renderer.overlayContext?.clefAt(1, 0)).toBe('treble');
    expect(renderer.overlayContext?.clefAt(2, 0)).toBe('bass');
  });

  it('follows a staff that changes clef partway through', async () => {
    // A left hand climbing into the treble is written in the treble clef, and
    // a mark's ledger lines are counted from the clef it actually sits under.
    const { controller, renderer } = createController();
    const base = tiedExercise();
    const [treble, bass] = base.staves;
    if (treble === undefined || bass === undefined) {
      throw new Error('expected two staves');
    }
    await controller.openScore({
      ...base,
      staves: [treble, { ...bass, clefChanges: [{ measureIndex: 1, clef: 'treble' as const }] }],
    });

    const lastStep = (controller.currentTimeline?.length ?? 1) - 1;
    expect(renderer.overlayContext?.clefAt(2, 0)).toBe('bass');
    expect(renderer.overlayContext?.clefAt(2, lastStep)).toBe('treble');
  });

  it('draws the notes that belonged there as correct', async () => {
    const { controller, renderer, midi } = createController(true);
    await controller.loadNewExercise();
    const session = controller.start();
    const step = session?.currentStep;
    if (step === undefined || step === null) {
      throw new Error('expected a first step');
    }

    for (const note of step.expectedMidi) {
      midi.noteOn(note, 0);
    }

    expect(renderer.played).toEqual(
      step.expectedMidi.map((midiNote) => ({
        stepIndex: 0,
        midi: midiNote,
        correct: true,
        offset: 0,
      })),
    );
  });

  it('draws a wrong press at the pitch that was actually struck', async () => {
    const { controller, renderer, midi } = createController(true);
    await controller.loadNewExercise();
    const session = controller.start();
    const step = session?.currentStep;
    if (step === undefined || step === null) {
      throw new Error('expected a first step');
    }
    const wrong = (step.expectedMidi[0] ?? 60) + 1;

    midi.noteOn(wrong, 0);

    // Not "something was wrong here" - the note he actually hit.
    expect(renderer.played).toEqual([{ stepIndex: 0, midi: wrong, correct: false, offset: 0 }]);
  });

  it('draws a mistimed press just before the note it was reaching for', async () => {
    // The complaint this exists for: a press too early to count for the beat
    // it was aimed at is judged against the beat before, which used to put the
    // mark a whole note to the left of where it felt like it had been played.
    const { controller, renderer, midi, clock, metronome } = createController(true);
    controller.updateSettings({ modeId: FLOW_MODE_ID });
    await controller.loadNewExercise();
    const session = controller.start();
    // Flow mode runs on the pulse, so the music starts on the first tick.
    metronome.advanceSubdivisions(1);
    const wrong = (session?.currentStep?.expectedMidi[0] ?? 60) + 1;

    // Seven tenths of the way through a one-second step at 60 bpm.
    clock.set(700);
    midi.noteOn(wrong, 700);

    expect(renderer.played).toEqual([
      { stepIndex: 0, midi: wrong, correct: false, offset: 0.7 },
    ]);
  });

  it('leaves marks on their notes when nothing is keeping time', async () => {
    // Wait mode holds still until the reader plays, so a slow answer is not
    // lateness and must not be drawn as though it were.
    const { controller, renderer, midi, clock } = createController(true);
    await controller.loadNewExercise();
    const session = controller.start();
    const expected = session?.currentStep?.expectedMidi[0] ?? 60;

    clock.set(900);
    midi.noteOn(expected, 900);

    expect(renderer.played).toEqual([{ stepIndex: 0, midi: expected, correct: true, offset: 0 }]);
  });

  it('does not draw the same note twice for one press', async () => {
    const { controller, renderer, midi } = createController(true);
    await controller.loadNewExercise();
    const session = controller.start();
    const step = session?.currentStep;
    if (step === undefined || step === null) {
      throw new Error('expected a first step');
    }
    const note = step.expectedMidi[0] ?? 60;

    midi.noteOn(note, 0);
    midi.noteOn(note, 10);

    expect(renderer.played).toHaveLength(1);
  });

  it('stays out of the way when the reader turns it off', async () => {
    const { controller, renderer, midi } = createController(true);
    controller.updateSettings({ showPlayedNotes: false });
    await controller.loadNewExercise();
    const session = controller.start();
    const step = session?.currentStep;
    if (step === undefined || step === null) {
      throw new Error('expected a first step');
    }

    for (const note of step.expectedMidi) {
      midi.noteOn(note, 0);
    }

    expect(renderer.played).toHaveLength(0);
  });

  it('wipes the page when the run restarts or the music changes', async () => {
    const { controller, renderer, midi } = createController(true);
    await controller.loadNewExercise();
    const session = controller.start();
    const step = session?.currentStep;
    if (step === undefined || step === null) {
      throw new Error('expected a first step');
    }
    midi.noteOn(step.expectedMidi[0] ?? 60, 0);
    expect(renderer.played.length).toBeGreaterThan(0);

    controller.start();
    expect(renderer.played).toHaveLength(0);

    await controller.loadNewExercise();
    expect(renderer.played).toHaveLength(0);
  });

  it('clears the page when the setting is switched off mid-run', async () => {
    const { controller, renderer, midi } = createController(true);
    await controller.loadNewExercise();
    const session = controller.start();
    const step = session?.currentStep;
    if (step === undefined || step === null) {
      throw new Error('expected a first step');
    }
    midi.noteOn(step.expectedMidi[0] ?? 60, 0);

    controller.updateSettings({ showPlayedNotes: false });

    expect(renderer.played).toHaveLength(0);
  });
});

describe('notes fading behind the reader', () => {
  async function playFirstStep(): Promise<ReturnType<typeof createController>> {
    const rig = createController(true);
    rig.controller.updateSettings({ fadePassedNotes: true });
    await rig.controller.loadNewExercise();
    const session = rig.controller.start();
    const step = session?.currentStep;
    if (step === undefined || step === null) {
      throw new Error('expected a first step');
    }
    for (const note of step.expectedMidi) {
      rig.midi.noteOn(note, 0);
    }
    return rig;
  }

  it('dims a step the moment it is done with', async () => {
    const { renderer } = await playFirstStep();
    expect(renderer.faded.has(0)).toBe(true);
  });

  it('dims a step that went by unplayed just the same', async () => {
    const rig = createController(true);
    rig.controller.updateSettings({ fadePassedNotes: true });
    await rig.controller.loadNewExercise();
    const session = rig.controller.start();

    // Nothing is played; the run is simply abandoned at the first step.
    session?.abort();

    // The page empties as the music passes, however it was played.
    expect(rig.renderer.faded.size).toBe(0);
  });

  it('leaves the page alone unless asked', async () => {
    const rig = createController(true);
    await rig.controller.loadNewExercise();
    const session = rig.controller.start();
    const step = session?.currentStep;
    if (step === undefined || step === null) {
      throw new Error('expected a first step');
    }
    for (const note of step.expectedMidi) {
      rig.midi.noteOn(note, 0);
    }

    expect(rig.renderer.faded.size).toBe(0);
  });

  it('brings the notes back when the setting is switched off', async () => {
    const rig = await playFirstStep();

    rig.controller.updateSettings({ fadePassedNotes: false });

    expect(rig.renderer.faded.size).toBe(0);
  });

  it('starts from a full page on every run and every exercise', async () => {
    const rig = await playFirstStep();
    expect(rig.renderer.faded.size).toBeGreaterThan(0);

    rig.controller.start();
    expect(rig.renderer.faded.size).toBe(0);

    rig.renderer.fadePassed(0);
    await rig.controller.loadNewExercise();
    expect(rig.renderer.faded.size).toBe(0);
  });
});

describe('note size', () => {
  it('re-engraves at the new size', async () => {
    const { controller, renderer } = createController();
    await controller.loadNewExercise();

    controller.updateSettings({ zoom: 1.5 });

    expect(renderer.zoom).toBe(1.5);
    expect(renderer.refreshCount).toBe(1);
  });

  it('does not re-engrave when the size has not moved', async () => {
    const { controller, renderer } = createController();
    await controller.loadNewExercise();
    controller.updateSettings({ zoom: 1.5 });

    controller.updateSettings({ zoom: 1.5 });

    expect(renderer.refreshCount).toBe(1);
  });
});

describe('cursor visibility', () => {
  it('shows the cursor by default', async () => {
    const { controller, renderer } = createController();
    expect(controller.settings.showCursor).toBe(true);

    await controller.loadNewExercise();

    expect(renderer.cursor.visible).toBe(true);
  });

  it('hides the cursor as soon as the setting is turned off', async () => {
    const { controller, renderer } = createController();
    await controller.loadNewExercise();

    controller.updateSettings({ showCursor: false });

    expect(renderer.cursor.visible).toBe(false);
  });

  it('keeps it hidden across a new exercise', async () => {
    const { controller, renderer } = createController();
    controller.updateSettings({ showCursor: false });

    await controller.loadNewExercise();
    await controller.loadNewExercise();

    expect(renderer.cursor.visible).toBe(false);
  });

  it('still follows the music while hidden', async () => {
    const { controller, renderer, midi } = createController(true);
    controller.updateSettings({ showCursor: false });
    await controller.loadNewExercise();

    const session = controller.start();
    const step = session?.currentStep;
    if (step === undefined || step === null) {
      throw new Error('expected a first step');
    }
    for (const midiNote of step.expectedMidi) {
      midi.noteOn(midiNote, 0);
    }

    // The position keeps advancing; only the marker is invisible.
    expect(renderer.cursor.moves).toEqual([0, 1]);
    expect(renderer.cursor.visible).toBe(false);
  });

  it('brings it back when the setting is turned on again', async () => {
    const { controller, renderer } = createController();
    await controller.loadNewExercise();
    controller.updateSettings({ showCursor: false });

    controller.updateSettings({ showCursor: true });

    expect(renderer.cursor.visible).toBe(true);
  });

  it('puts the cursor back after the score is re-engraved', async () => {
    const { controller, renderer, midi } = createController(true);
    await controller.loadNewExercise();
    const session = controller.start();
    const step = session?.currentStep;
    if (step === undefined || step === null) {
      throw new Error('expected a first step');
    }
    for (const note of step.expectedMidi) {
      midi.noteOn(note, 0);
    }
    expect(renderer.cursor.position).toBe(1);

    // Going fullscreen changes the width; the engraver rewinds when it
    // re-renders, so the position has to be restored.
    controller.refreshScore();

    expect(renderer.refreshCount).toBe(1);
    expect(renderer.cursor.position).toBe(1);
  });

  it('does not force a cursor move when nothing is running', async () => {
    const { controller, renderer } = createController();
    await controller.loadNewExercise();
    const movesBefore = renderer.cursor.moves.length;

    controller.refreshScore();

    expect(renderer.cursor.moves).toHaveLength(movesBefore);
    expect(renderer.cursor.visible).toBe(true);
  });

  it('leaves visibility alone when other settings change', async () => {
    const { controller, renderer } = createController();
    await controller.loadNewExercise();
    controller.updateSettings({ showCursor: false });

    controller.updateSettings({ tempoBpm: 90 });

    expect(renderer.cursor.visible).toBe(false);
  });
});

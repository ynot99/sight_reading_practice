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
import { PracticeLadder } from '../../src/application/ladder/PracticeLadder.js';
import { BUILT_IN_LADDER } from '../../src/application/ladder/ladderSteps.js';
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
import { RecordingPitchPlayer } from '../../src/infrastructure/testing/RecordingPitchPlayer.js';
import { PracticeHistory } from '../../src/application/PracticeHistory.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import { DomainError } from '../../src/shared/errors.js';
import { beamedSixteenths, tiedExercise, twoBarExercise } from '../support/fixtures.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';

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
  history?: PracticeHistory,
  health?: PracticeControllerDependencies['health'],
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
    instrument: new RecordingPitchPlayer(),
    ...(history === undefined ? {} : { history }),
    clock,
    scorings: new ScoringStrategyRegistry().registerAll([
      new AccuracyScoringStrategy(),
      new TimingWeightedScoringStrategy(),
      new ContinuityScoringStrategy(),
    ]),
    ladder: new PracticeLadder(BUILT_IN_LADDER),
    ...(health === undefined ? {} : { health }),
    ...(fixedExercise
      ? { providerFor: () => ({ provide: () => Promise.resolve(twoBarExercise()) }) }
      : {}),
    ...(providerFor === undefined ? {} : { providerFor }),
    initialSettings: {
      countInBars: 0,
      clickWhen: 'never',
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

    expect(loaded.title).toBe('Something Borrowed');
    expect(controller.openedExercise).toBe(opened);
    // The file's own tempo is adopted, so the slider shows the truth about it.
    expect(controller.settings.tempoBpm).toBe(opened.tempoBpm);
    expect(loaded.tempoBpm).toBe(opened.tempoBpm);
    expect(renderer.loadedXml).toContain('Something Borrowed');
    // The timeline is derived from it like any other exercise, which is the
    // whole reason an import has to become one.
    expect(controller.currentTimeline?.length).toBe(4);
  });

  it('lets the reader slow an opened score down', async () => {
    const { controller, renderer } = createController();
    await controller.openScore(tiedExercise({ tempoBpm: 120 }));
    expect(controller.settings.tempoBpm).toBe(120);

    controller.updateSettings({ tempoBpm: 60 });
    await controller.reloadExercise();

    // Same notes, read at half the speed the file asked for.
    expect(controller.currentExercise?.tempoBpm).toBe(60);
    expect(controller.openedExercise?.tempoBpm).toBe(120);
    expect(renderer.loadedXml).toContain('<per-minute>60</per-minute>');
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

  it('puts a drilled passage back onto the whole piece', async () => {
    // Reported bars are counted from whatever was being practised. Drilling a
    // second time inside a passage must not walk backwards through the score.
    const { controller } = createController(true);
    // The range is narrowed *after* the page is loaded: asking for new
    // material is what clears one, so setting it first would be undone.
    await controller.loadNewExercise();
    controller.updateSettings({ rangeFromBar: 20, rangeToBar: 27 });
    await controller.reloadExercise();
    const session = controller.start();
    if (session === null) {
      throw new Error('expected a session');
    }
    session.abort();

    const passage = controller.drillWorstPassage(2);
    if (passage === null) {
      // A clean run leaves nothing to drill, which is its own answer.
      expect(controller.settings.rangeFromBar).toBe(20);
      return;
    }
    expect(passage.fromBar).toBeGreaterThanOrEqual(20);
    expect(controller.settings.rangeFromBar).toBe(passage.fromBar);
  });

  it('forgets the practised bars when new material is asked for', async () => {
    const { controller } = createController();
    await controller.loadNewExercise();
    controller.updateSettings({ rangeFromBar: 12, rangeToBar: 16 });

    await controller.loadNewExercise();

    // Bars 12-16 of the piece just closed mean nothing in the one opening,
    // and applying them silently hands back a passage of something the reader
    // never asked to narrow.
    expect(controller.settings.rangeFromBar).toBeNull();
    expect(controller.settings.rangeToBar).toBeNull();
  });

  it('keeps them when the same material is drawn again', async () => {
    const { controller } = createController();
    await controller.loadNewExercise();
    controller.updateSettings({ rangeFromBar: 3, rangeToBar: 4 });

    await controller.reloadExercise();

    // Re-engraving what is already there is not asking for a new piece; the
    // drill and the range boxes both depend on the passage surviving it.
    expect(controller.settings.rangeFromBar).toBe(3);
    expect(controller.settings.rangeToBar).toBe(4);
  });

  it('says so once, rather than on every fresh page', async () => {
    const { controller } = createController();
    const changed = vi.fn();
    await controller.loadNewExercise();
    controller.events.on('settingsChanged', changed);

    await controller.loadNewExercise();

    // Nothing was narrowed, so nothing was cleared: an event here would save
    // the same settings and redraw the panel for no reason.
    expect(changed).not.toHaveBeenCalled();
  });

  it('names the passage the way a reader would', async () => {
    const { controller } = createController();
    // Generated material has no lasting identity, so the level stands in: the
    // question is whether *this level* is getting easier.
    expect(controller.practiceKey()).toContain('level:');

    await controller.openScore(tiedExercise({ title: 'Something Borrowed' }));
    expect(controller.practiceKey()).toContain('score:Something Borrowed');

    controller.updateSettings({ rangeFromBar: 2, rangeToBar: 4 });
    expect(controller.practiceKey()).toContain('bars:2-4');
  });

  it('remembers how a reading went, and compares it with the last', async () => {
    const history = new PracticeHistory(new InMemorySettingsStore());
    const { controller } = createController(true, undefined, {}, history);
    await controller.loadNewExercise();
    expect(controller.passageHistory()).toBeNull();

    for (let run = 0; run < 2; run += 1) {
      const session = controller.start();
      session?.abort();
    }

    const summary = controller.passageHistory();
    expect(summary?.attempts).toBe(2);
    expect(summary?.previous).not.toBeNull();
  });

  it('has nothing to drill without a run behind it', () => {
    const { controller } = createController();
    expect(controller.drillWorstPassage()).toBeNull();
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
    controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 1, clickWhen: 'never' });
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

  describe('holding the marks back until the run ends', () => {
    async function playAllOf(rig: ReturnType<typeof createController>) {
      const session = rig.controller.start();
      let guard = 200;
      while (session?.status === 'running' && guard > 0) {
        guard -= 1;
        const step = session.currentStep;
        if (step === null) {
          break;
        }
        for (const midi of step.expectedMidi) {
          rig.midi.noteOn(midi, 0);
        }
      }
      return session;
    }

    it('draws nothing while the reader is still reading', async () => {
      const rig = createController(true);
      rig.controller.updateSettings({ playedNotes: 'at-end' });
      await rig.controller.loadNewExercise();
      const session = rig.controller.start();
      const note = session?.currentStep?.expectedMidi[0] ?? 60;

      rig.midi.noteOn(note, 0);

      // Reading is the task, and a mark appearing under the eyes is an answer
      // to a question the reader has already answered.
      expect(rig.renderer.played).toHaveLength(0);
    });

    it('puts the whole reading up at once when it ends', async () => {
      const rig = createController(true);
      rig.controller.updateSettings({ playedNotes: 'at-end' });
      await rig.controller.loadNewExercise();

      await playAllOf(rig);

      expect(rig.renderer.played.length).toBeGreaterThan(0);
    });

    it('shows them for a run that was stopped, too', async () => {
      const rig = createController(true);
      rig.controller.updateSettings({ playedNotes: 'at-end' });
      await rig.controller.loadNewExercise();
      const session = rig.controller.start();
      rig.midi.noteOn(session?.currentStep?.expectedMidi[0] ?? 60, 0);

      session?.abort();

      // Stopping is a decision to look at what happened; a blank page gives
      // the reader nothing for it.
      expect(rig.renderer.played).toHaveLength(1);
    });

    it('draws exactly what a live run would have drawn', async () => {
      async function marksWith(playedNotes: 'live' | 'at-end') {
        const rig = createController(true);
        rig.controller.updateSettings({ playedNotes });
        await rig.controller.loadNewExercise();
        const session = rig.controller.start();
        const step = session?.currentStep;
        rig.midi.noteOn(step?.expectedMidi[0] ?? 60, 0);
        rig.midi.noteOn(21, 5);
        session?.abort();
        return rig.renderer.played;
      }

      // Only *when* they are drawn changes. In particular the offset is a
      // fraction of the gap to the neighbouring note, and is measured while
      // the session still knows the tempo rather than at the end.
      expect(await marksWith('at-end')).toEqual(await marksWith('live'));
    });

    it('starts each run with a clean page', async () => {
      const rig = createController(true);
      rig.controller.updateSettings({ playedNotes: 'at-end' });
      await rig.controller.loadNewExercise();
      const first = rig.controller.start();
      rig.midi.noteOn(first?.currentStep?.expectedMidi[0] ?? 60, 0);
      first?.abort();
      expect(rig.renderer.played).toHaveLength(1);

      rig.controller.start();

      // The marks held from the last reading must not arrive on this one.
      expect(rig.renderer.played).toHaveLength(0);
    });

    it('clears the page when the reader moves the marks off live', async () => {
      const rig = createController(true);
      await rig.controller.loadNewExercise();
      const session = rig.controller.start();
      rig.midi.noteOn(session?.currentStep?.expectedMidi[0] ?? 60, 0);
      expect(rig.renderer.played).toHaveLength(1);

      rig.controller.updateSettings({ playedNotes: 'at-end' });

      expect(rig.renderer.played).toHaveLength(0);
    });
  });

  it('stays out of the way when the reader turns it off', async () => {
    const { controller, renderer, midi } = createController(true);
    controller.updateSettings({ playedNotes: 'hidden' });
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

    controller.updateSettings({ playedNotes: 'hidden' });

    expect(renderer.played).toHaveLength(0);
  });
});

describe('notes fading behind the reader', () => {
  async function playFirstStep(): Promise<ReturnType<typeof createController>> {
    const rig = createController(true);
    rig.controller.updateSettings({ readAheadSteps: 0 });
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
    rig.controller.updateSettings({ readAheadSteps: 0 });
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

    rig.controller.updateSettings({ readAheadSteps: null });

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

describe('the veil moved in front of the reader', () => {
  async function startWith(readAheadSteps: number | null) {
    const rig = createController(true);
    rig.controller.updateSettings({ readAheadSteps });
    await rig.controller.loadNewExercise();
    rig.controller.start();
    return rig;
  }

  it('leaves the step under the fingers alone when it is only tidying', async () => {
    const { renderer } = await startWith(0);

    // The distinction the whole setting turns on: dimming what is done never
    // takes the note being played, so nothing is demanded of the reader.
    expect(renderer.faded.has(0)).toBe(false);
  });

  it('takes the step being played, so it has to have been read already', async () => {
    const { renderer } = await startWith(1);

    expect(renderer.faded.has(0)).toBe(true);
    expect(renderer.faded.has(1)).toBe(false);
  });

  it('takes the one after it as well at two steps', async () => {
    const { renderer } = await startWith(2);

    expect(renderer.faded.has(0)).toBe(true);
    expect(renderer.faded.has(1)).toBe(true);
    expect(renderer.faded.has(2)).toBe(false);
  });

  it('keeps the veil ahead as the cursor moves', async () => {
    const rig = await startWith(1);
    const session = rig.controller.session;
    const step = session?.currentStep;
    if (step === undefined || step === null) {
      throw new Error('expected a first step');
    }
    for (const note of step.expectedMidi) {
      rig.midi.noteOn(note, 0);
    }

    // The second step is now the one being played, and now the one gone.
    expect(rig.renderer.faded.has(1)).toBe(true);
    expect(rig.renderer.faded.has(2)).toBe(false);
  });

  it('gives the notes back when the veil is moved nearer mid-run', async () => {
    const rig = await startWith(2);
    expect(rig.renderer.faded.has(1)).toBe(true);

    rig.controller.updateSettings({ readAheadSteps: 0 });

    // Moving it away must take more; moving it nearer has to give back, or
    // the reader can only ever make the page emptier.
    expect(rig.renderer.faded.has(0)).toBe(false);
    expect(rig.renderer.faded.has(1)).toBe(false);
  });

  it('hides nothing at all when it is switched off', async () => {
    const { renderer } = await startWith(null);
    expect(renderer.faded.size).toBe(0);
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

  it('shows it for a playback and then puts it back as it was', async () => {
    const { controller, renderer } = createController(true);
    controller.updateSettings({ showCursor: false });
    await controller.loadNewExercise();

    controller.listen();
    // Following along is most of the value of hearing it played.
    expect(renderer.cursor.visible).toBe(true);

    controller.stopListening();

    // A performance is not a decision about the reader's own settings; one
    // listen must not undo the aid they turned off.
    expect(renderer.cursor.visible).toBe(false);
  });

  it('keeps it through a re-engraving while the exercise plays itself', async () => {
    const { controller, renderer } = createController(true);
    controller.updateSettings({ showCursor: false });
    await controller.loadNewExercise();
    controller.listen();
    expect(renderer.cursor.visible).toBe(true);

    // Which is what changing the tempo from the stand does, and it used to
    // take the marker away in the middle of the performance.
    await controller.reloadExercise();

    expect(renderer.cursor.visible).toBe(true);

    controller.stopListening();
    expect(renderer.cursor.visible).toBe(false);
  });

  it('leaves the cursor alone when there was nothing to stop', async () => {
    const { controller, renderer } = createController(true);
    await controller.loadNewExercise();
    controller.updateSettings({ showCursor: false });

    controller.stopListening();

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

describe('climbing the ladder', () => {
  /** Plays every step of the fixed exercise correctly, to the end. */
  function readCleanly(rig: ReturnType<typeof createController>): void {
    const session = rig.controller.start();
    let guard = 200;
    while (session?.status === 'running' && guard > 0) {
      guard -= 1;
      const step = session.currentStep;
      if (step === null) {
        break;
      }
      for (const midi of step.expectedMidi) {
        rig.midi.noteOn(midi, 0);
      }
    }
  }

  /**
   * Reads the whole exercise, but fumbles two extra notes at every step.
   *
   * The run has to *finish* to be evidence: an abandoned one is not a reading
   * at all, and under accuracy grading it scores a flat 100%.
   */
  function readBadly(rig: ReturnType<typeof createController>): void {
    const session = rig.controller.start();
    let guard = 200;
    while (session?.status === 'running' && guard > 0) {
      guard -= 1;
      const step = session.currentStep;
      if (step === null) {
        break;
      }
      rig.midi.noteOn(21, 0);
      rig.midi.noteOn(22, 0);
      for (const midi of step.expectedMidi) {
        rig.midi.noteOn(midi, 0);
      }
    }
  }

  async function onTheLadder(stepId = 'rung.2b') {
    const rig = createController(true);
    rig.controller.selectLadderStep(stepId);
    await rig.controller.loadNewExercise();
    return rig;
  }

  it('adopts everything a rung stands for', async () => {
    const rig = await onTheLadder('rung.8b');

    expect(rig.controller.settings.presetId).toBe('sequences');
    expect(rig.controller.settings.rhythmProfileId).toBe('syncopated');
    expect(rig.controller.ladderStep?.label).toBe('8b');
  });

  it('moves up after two clean readings, and not after one', async () => {
    const rig = await onTheLadder();

    readCleanly(rig);
    expect(rig.controller.ladderStep?.id).toBe('rung.2b');

    readCleanly(rig);
    expect(rig.controller.ladderStep?.id).toBe('rung.2c');
  });

  it('moves down after two readings that came apart', async () => {
    const rig = await onTheLadder();

    readBadly(rig);
    expect(rig.controller.ladderStep?.id).toBe('rung.2b');

    readBadly(rig);
    expect(rig.controller.ladderStep?.id).toBe('rung.2a');
  });

  it('ignores a run that was stopped, however it was scored', async () => {
    const rig = await onTheLadder();

    // Accuracy grades the notes that fell due, so a run abandoned at the
    // first step is a flawless 100%. Twice would be a promotion earned by
    // pressing Stop.
    rig.controller.start()?.abort();
    rig.controller.start()?.abort();

    expect(rig.controller.ladderStep?.id).toBe('rung.2b');
  });

  it('starts the count again on arriving, so it cannot bounce', async () => {
    const rig = await onTheLadder();
    readCleanly(rig);
    readCleanly(rig);
    expect(rig.controller.ladderStep?.id).toBe('rung.2c');

    // Two clean readings got the reader here. Falling straight back must not
    // hand those same two readings back as a reason to climb again.
    readBadly(rig);
    readBadly(rig);
    expect(rig.controller.ladderStep?.id).toBe('rung.2b');

    readBadly(rig);
    expect(rig.controller.ladderStep?.id).toBe('rung.2b');
  });

  it('says so when it moves', async () => {
    const rig = await onTheLadder();
    const moved = vi.fn();
    rig.controller.events.on('ladderMoved', moved);

    readCleanly(rig);
    readCleanly(rig);

    expect(moved).toHaveBeenCalledTimes(1);
    expect(moved.mock.calls[0]?.[0]).toMatchObject({ direction: 'up' });
  });

  it('stays at the ends instead of falling off them', async () => {
    const top = await onTheLadder('rung.8d');
    readCleanly(top);
    readCleanly(top);
    expect(top.controller.ladderStep?.id).toBe('rung.8d');

    const bottom = await onTheLadder('rung.1a');
    readBadly(bottom);
    readBadly(bottom);
    expect(bottom.controller.ladderStep?.id).toBe('rung.1a');
  });

  it('does not count a passage being drilled', async () => {
    const rig = await onTheLadder();
    rig.controller.updateSettings({ rangeFromBar: 1, rangeToBar: 2 });
    await rig.controller.reloadExercise();

    readCleanly(rig);
    readCleanly(rig);

    // Reading the same two bars until they are right is practice, but it is
    // not evidence about the next unseen page.
    expect(rig.controller.ladderStep?.id).toBe('rung.2b');
  });

  it('does not count a run that repeats itself', async () => {
    const rig = await onTheLadder();
    rig.controller.updateSettings({ repeatRange: true });

    readCleanly(rig);
    readCleanly(rig);

    expect(rig.controller.ladderStep?.id).toBe('rung.2b');
  });

  it('steps off the ladder when the axes are set by hand', async () => {
    const rig = await onTheLadder();

    rig.controller.updateSettings({ rhythmProfileId: 'triplets' });

    expect(rig.controller.ladderStep).toBeNull();
    expect(rig.controller.settings.ladderStepId).toBeNull();
  });

  it('stays on it when only the tempo or the bar count moves', async () => {
    const rig = await onTheLadder();

    rig.controller.updateSettings({ tempoBpm: 48, measures: 8 });

    // Slowing a rung down is how it is meant to be met, not a way off it.
    expect(rig.controller.ladderStep?.id).toBe('rung.2b');
  });

  it('never moves a reader who is off the ladder', async () => {
    const rig = createController(true);
    await rig.controller.loadNewExercise();
    expect(rig.controller.ladderStep).toBeNull();

    readCleanly(rig);
    readCleanly(rig);

    expect(rig.controller.ladderStep).toBeNull();
  });

  it('puts a reader who left back on at the rung, not past it', async () => {
    const rig = createController(true);
    await rig.controller.loadNewExercise();

    const step = rig.controller.moveLadder(1);

    expect(step?.id).toBe('rung.1a');
  });
});

describe('the pace, as a share of the written tempo', () => {
  it('starts at what the music says', async () => {
    const { controller } = createController();
    await controller.loadNewExercise();

    expect(controller.tempoPercent).toBe(100);
    expect(controller.settings.tempoBpm).toBe(controller.baseTempoBpm);
  });

  it('moves in whole steps of the written tempo', () => {
    const { controller } = createController();
    const base = controller.baseTempoBpm;

    expect(controller.nudgeTempoPercent(-5)).toBe(95);
    expect(controller.settings.tempoBpm).toBe(Math.round(base * 0.95));

    controller.nudgeTempoPercent(-5);
    expect(controller.tempoPercent).toBe(90);
  });

  it('stays on the grid however the tempo was reached', () => {
    const { controller } = createController();
    // Set by hand from the slider, to something no step would land on.
    controller.updateSettings({ tempoBpm: Math.round(controller.baseTempoBpm * 0.83) });

    expect(controller.nudgeTempoPercent(-5)).toBe(80);
  });

  it('is a share of the piece, not a number of beats', async () => {
    const { controller } = createController(true);
    await controller.loadNewExercise();
    const generated = controller.baseTempoBpm;
    controller.nudgeTempoPercent(-20);
    expect(controller.tempoPercent).toBe(80);

    // A file brings its own tempo, and 80% has to mean 80% of that one -
    // "a bit slower" is the same gesture at 60 and at 132.
    await controller.openScore(twoBarExercise({ tempoBpm: 132 }));

    expect(controller.baseTempoBpm).toBe(132);
    expect(controller.baseTempoBpm).not.toBe(generated);
    expect(controller.nudgeTempoPercent(-20)).toBe(80);
    expect(controller.settings.tempoBpm).toBe(Math.round(132 * 0.8));
  });

  it('will not run away in either direction', () => {
    const { controller } = createController();
    for (let press = 0; press < 60; press += 1) {
      controller.nudgeTempoPercent(-5);
    }
    expect(controller.tempoPercent).toBeGreaterThanOrEqual(25);

    for (let press = 0; press < 80; press += 1) {
      controller.nudgeTempoPercent(5);
    }
    expect(controller.tempoPercent).toBeLessThanOrEqual(200);
  });
});

describe('surviving a piece you already know', () => {
  async function survivalRun(
    overrides: Partial<PracticeSettings> = {},
    health?: PracticeControllerDependencies['health'],
  ) {
    const rig = createController(
      true,
      undefined,
      { modeId: FLOW_MODE_ID, survival: true, ...overrides },
      undefined,
      health,
    );
    await rig.controller.loadNewExercise();
    const readings: number[] = [];
    rig.controller.events.on('healthChanged', ({ health: value }) => readings.push(value));
    return { ...rig, readings };
  }

  it('says nothing in Wait mode, where nothing moves without you', async () => {
    const rig = await survivalRun({ modeId: undefined });
    rig.controller.updateSettings({ modeId: new WaitMode().id });

    expect(rig.controller.survivalRuns).toBe(false);
  });

  it('drains as the music goes by', async () => {
    const rig = await survivalRun();
    rig.controller.start();

    rig.metronome.advanceSubdivisions(8);

    expect(rig.controller.health).toBeLessThan(1);
    expect(rig.readings.length).toBeGreaterThan(1);
  });

  it('falls at the same rate per beat however busy the music is', async () => {
    // The pulse ticks at the resolution the shortest note needs, so a piece
    // of sixteenths ticks four times as often as one of quarters. Draining
    // per tick would make busy music four times as harsh for no reason a
    // player could name; per beat, a beat of music costs a beat's worth.
    //
    // Only the drain: the penalties for missing are left out because busy
    // music genuinely *is* harder - there are more notes to miss - and that
    // is the design rather than the thing under test.
    async function drainOverWholePiece(exercise: Exercise) {
      const rig = createController(
        false,
        () => ({ provide: () => Promise.resolve(exercise) }),
        { modeId: FLOW_MODE_ID, survival: true },
        undefined,
        { rewardPerStep: 0, missPenalty: 0, wrongPenalty: 0 },
      );
      await rig.controller.loadNewExercise();
      rig.controller.start();
      // Generously past the end; the pulse stops when the music does.
      rig.metronome.advanceSubdivisions(400);
      return 1 - rig.controller.health;
    }

    // A bar of 2/4 in sixteenths is two beats; two bars of 4/4 in quarters
    // are eight. The sixteenths tick four times as often, and must still cost
    // a quarter as much.
    expect(await drainOverWholePiece(beamedSixteenths())).toBeCloseTo(2 * 0.035, 3);
    expect(await drainOverWholePiece(twoBarExercise())).toBeCloseTo(8 * 0.035, 3);
  });

  it('falls at the same rate per bar however slow the piece is', async () => {
    // Measured in beats rather than seconds, so the tempo does not decide how
    // hard the game is - which is the whole reason a slow melody is playable.
    const slow = await survivalRun();
    slow.controller.updateSettings({ tempoBpm: 40 });
    await slow.controller.reloadExercise();
    slow.controller.start();
    slow.metronome.advanceSubdivisions(8);

    const fast = await survivalRun();
    fast.controller.updateSettings({ tempoBpm: 160 });
    await fast.controller.reloadExercise();
    fast.controller.start();
    fast.metronome.advanceSubdivisions(8);

    expect(slow.controller.health).toBeCloseTo(fast.controller.health, 10);
  });

  it('climbs while the reader keeps up', async () => {
    // The same music twice, played and unplayed: only the playing differs, so
    // only the playing can explain the gap.
    async function healthAfter(play: boolean): Promise<number> {
      const rig = await survivalRun();
      const session = rig.controller.start();
      for (let at = 0; at < 8; at += 1) {
        if (play) {
          for (const midi of session?.currentStep?.expectedMidi ?? []) {
            rig.midi.noteOn(midi, rig.clock.now());
          }
        }
        rig.metronome.advanceSubdivisions(1);
      }
      return rig.controller.health;
    }

    expect(await healthAfter(true)).toBeGreaterThan(await healthAfter(false));
  });

  it('ends the run when the bar empties', async () => {
    // A drain the two-bar fixture cannot outlast, so the bar empties before
    // the music runs out and it is the bar that stops the run.
    const rig = await survivalRun({}, { drainPerBeat: 0.5 });
    const session = rig.controller.start();

    // Nothing played at all: every step is one the music took away.
    rig.metronome.advanceSubdivisions(8);

    expect(rig.controller.health).toBe(0);
    expect(session?.status).toBe('aborted');
  });

  it('reports the run as unfinished, because it was', async () => {
    const rig = await survivalRun({}, { drainPerBeat: 0.5 });
    const session = rig.controller.start();
    rig.metronome.advanceSubdivisions(8);

    // The one lie this feature could tell would be a report saying the reader
    // reached the end.
    expect(session?.report?.completed).toBe(false);
  });

  it('starts each run with a full bar', async () => {
    const rig = await survivalRun();
    rig.controller.start();
    rig.metronome.advanceSubdivisions(6);
    expect(rig.controller.health).toBeLessThan(1);

    rig.controller.start();

    expect(rig.controller.health).toBe(1);
  });

  it('leaves the bar alone when it is switched off', async () => {
    const rig = await survivalRun({ survival: false });
    rig.controller.start();
    rig.metronome.advanceSubdivisions(20);

    expect(rig.controller.health).toBe(1);
    expect(rig.readings).toEqual([]);
  });
});

describe('pausing before the music has begun', () => {
  it('takes a pause during the count-in, rather than ignoring it', async () => {
    const { controller } = createController(true, undefined, {
      modeId: FLOW_MODE_ID,
      countInBars: 1,
    });
    await controller.loadNewExercise();
    const session = controller.start();
    expect(session?.status).toBe('counting-in');

    controller.pause();

    // The button is right there and says Pause; refusing silently was the
    // control lying about what it does.
    expect(session?.status).toBe('paused');
  });

  it('gives the whole count back on resuming', async () => {
    const rig = createController(true, undefined, {
      modeId: FLOW_MODE_ID,
      countInBars: 1,
    });
    await rig.controller.loadNewExercise();
    const session = rig.controller.start();
    rig.metronome.advanceSubdivisions(2);
    rig.controller.pause();

    rig.controller.resume();

    // Back to the count and to the whole of it: half a count-in gives the
    // reader no tempo, which is the only thing it is for.
    expect(session?.status).toBe('counting-in');
  });

  it('resumes into the music when the pause came after the count', async () => {
    const rig = createController(true, undefined, {
      modeId: FLOW_MODE_ID,
      countInBars: 0,
    });
    await rig.controller.loadNewExercise();
    const session = rig.controller.start();
    rig.metronome.advanceSubdivisions(2);
    expect(session?.status).toBe('running');

    rig.controller.pause();
    rig.controller.resume();

    expect(session?.status).toBe('running');
  });
});

describe('starting from the top of the page', () => {
  it('brings the page back before the run begins', async () => {
    const { controller, renderer } = createController(true);
    await controller.loadNewExercise();
    const before = renderer.scrollToStartCount;

    controller.start();

    // A long piece is scrolled through as it is read and stays where it was
    // left; the cursor goes to bar one and the reader was looking at bar 40.
    expect(renderer.scrollToStartCount).toBe(before + 1);
  });
});

describe('choosing a passage by touching a note', () => {
  async function opened() {
    const rig = createController();
    await rig.controller.openScore(twoBarExercise({ title: 'Two Bars' }));
    return rig;
  }

  function stepInBar(rig: Awaited<ReturnType<typeof opened>>, bar: number): number {
    const found = rig.controller.currentTimeline?.steps.find(
      (step) => step.measureIndex === bar - 1,
    );
    if (found === undefined) {
      throw new Error(`no step in bar ${bar}`);
    }
    return found.index;
  }

  it('starts the passage at the touched note’s bar, open at the end', async () => {
    const rig = await opened();

    expect(rig.controller.chooseFromStep(stepInBar(rig, 2))).toEqual({
      fromBar: 2,
      toBar: null,
    });
    // One touch means "from here on"; saying which bar is last would be
    // counting bars nobody asked about.
    expect(rig.controller.settings.rangeFromBar).toBe(2);
    expect(rig.controller.settings.rangeToBar).toBeNull();
  });

  it('closes the passage on a touch further into the piece', async () => {
    const rig = await opened();
    rig.controller.chooseFromStep(stepInBar(rig, 1));
    await rig.controller.reloadExercise();

    // Bars are reported against what is on screen, which is now a passage of
    // its own, so they have to be put back onto the whole piece first.
    const second = rig.controller.chooseFromStep(stepInBar(rig, 2));

    expect(second).toEqual({ fromBar: 1, toBar: 2 });
    expect(rig.controller.settings.rangeToBar).toBe(2);
  });

  it('gives the whole piece back on touching the first note again', async () => {
    const rig = await opened();
    rig.controller.chooseFromStep(stepInBar(rig, 2));
    await rig.controller.reloadExercise();

    // The page is now that passage, so its first bar is the one that opened
    // it - touching there is the way back.
    const cleared = rig.controller.chooseFromStep(stepInBar(rig, 1));

    expect(cleared).toEqual({ fromBar: null, toBar: null });
    expect(rig.controller.settings.rangeFromBar).toBeNull();
  });

  it('starts over rather than growing backwards', async () => {
    const rig = await opened();
    rig.controller.chooseFromStep(stepInBar(rig, 2));
    await rig.controller.reloadExercise();
    rig.controller.updateSettings({ rangeToBar: 2 });

    // A touch when the passage is already closed begins a new one, which is
    // the only reading that does not need a rule the reader has to remember.
    expect(rig.controller.chooseFromStep(stepInBar(rig, 1))).toEqual({
      fromBar: 2,
      toBar: null,
    });
  });

  it('ignores a touch on nothing', async () => {
    const rig = await opened();
    rig.controller.chooseFromStep(9_999);

    expect(rig.controller.settings.rangeFromBar).toBeNull();
  });
});

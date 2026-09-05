import { DOMParser } from '@xmldom/xmldom';
import { describe, expect, it, vi } from 'vitest';
import { PracticeController } from '../../src/application/PracticeController.js';
import { FLOW_MODE_ID, FlowMode } from '../../src/application/modes/FlowMode.js';
import { PracticeModeRegistry } from '../../src/application/modes/PracticeModeRegistry.js';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import type { PracticeSession } from '../../src/application/session/PracticeSession.js';
import { ExercisePresetRegistry } from '../../src/domain/generation/ExercisePresetRegistry.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';

import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import type { PerformanceReport } from '../../src/domain/scoring/PerformanceReport.js';
import type { SessionScore } from '../../src/domain/scoring/IScoringStrategy.js';
import { ScoringStrategyRegistry } from '../../src/domain/scoring/ScoringStrategyRegistry.js';
import {
  AccuracyScoringStrategy,
  ContinuityScoringStrategy,
  TimingWeightedScoringStrategy,
} from '../../src/domain/scoring/strategies.js';
import { FakeScoreRenderer } from '../../src/infrastructure/testing/FakeScoreRenderer.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { ManualMetronome } from '../../src/infrastructure/testing/ManualMetronome.js';
import { MockMidiAdapter } from '../../src/infrastructure/testing/MockMidiAdapter.js';
import { RecordingPitchPlayer } from '../../src/infrastructure/testing/RecordingPitchPlayer.js';

interface Rig {
  readonly controller: PracticeController;
  readonly renderer: FakeScoreRenderer;
  readonly midi: MockMidiAdapter;
  readonly metronome: ManualMetronome;
  readonly clock: ManualClock;
}

function createRig(initial: Parameters<PracticeController['updateSettings']>[0] = {}): Rig {
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
    stuck: renderer,
    ruler: renderer,
    zoom: renderer,
    midi,
    metronome,
    instrument: new RecordingPitchPlayer(),
    clock,
    scorings: new ScoringStrategyRegistry().registerAll([
      new AccuracyScoringStrategy(),
      new TimingWeightedScoringStrategy(),
      new ContinuityScoringStrategy(),
    ]),
    initialSettings: {
      presetId: 'melody-and-intervals',
      measures: 4,
      countInBars: 0,
      clickWhen: 'never',
      matchToleranceMs: Number.POSITIVE_INFINITY,
      ...initial,
    },
  });

  // A quarter note is exactly 1000 ms, so the timing assertions below can
  // compare exact numbers instead of chasing floating-point dust. Said in
  // beats rather than as a share of this preset's written tempo, because it
  // is the beats the assertions are about.
  controller.setTempoBpm(60);

  return { controller, renderer, midi, metronome, clock };
}

function captureResult(session: PracticeSession): {
  report: PerformanceReport | null;
  score: SessionScore | null;
} {
  const captured: { report: PerformanceReport | null; score: SessionScore | null } = {
    report: null,
    score: null,
  };
  session.events.on('finished', (event) => {
    captured.report = event.report;
    captured.score = event.score;
  });
  return captured;
}

describe('end-to-end practice loop', () => {
  it('renders exactly the notes the matcher will ask for', async () => {
    const { controller, renderer } = createRig();
    await controller.loadNewExercise();

    const timeline = controller.currentTimeline;
    if (timeline === null) {
      throw new Error('expected a timeline');
    }

    const document = new DOMParser().parseFromString(renderer.loadedXml ?? '', 'text/xml');
    const noteElements = document.getElementsByTagName('note');
    let soundingNotes = 0;
    for (let index = 0; index < noteElements.length; index += 1) {
      const note = noteElements.item(index);
      if (note !== null && note.getElementsByTagName('rest').length === 0) {
        soundingNotes += 1;
      }
    }

    const timelineNotes = timeline.steps.reduce((total, step) => total + step.notes.length, 0);
    expect(soundingNotes).toBe(timelineNotes);
    expect(document.getElementsByTagName('measure')).toHaveLength(4);
  });

  it('plays a generated exercise cleanly in Wait mode', async () => {
    const { controller, renderer, midi, clock } = createRig();
    await controller.loadNewExercise();

    const session = controller.start();
    if (session === null) {
      throw new Error('expected a session');
    }
    const captured = captureResult(session);
    const timeline = controller.currentTimeline;
    if (timeline === null) {
      throw new Error('expected a timeline');
    }

    let guard = timeline.length * 4;
    while (session.status === 'running' && guard > 0) {
      guard -= 1;
      const step = session.currentStep;
      if (step === null) {
        break;
      }
      clock.advance(400);
      midi.playChord(step.expectedMidi, clock.now(), 12);
    }

    expect(session.status).toBe('completed');
    expect(captured.report?.totals.correctNotes).toBe(timeline.noteCount);
    expect(captured.report?.totals.wrongNotes).toBe(0);
    expect(captured.score?.accuracy).toBe(1);
    expect(captured.score?.grade).toBe('A');

    // The cursor visited every position in order.
    expect(renderer.cursor.moves).toEqual(timeline.steps.map((step) => step.index));
  });

  it('records mistakes without derailing the run', async () => {
    const { controller, midi, clock } = createRig();
    await controller.loadNewExercise();

    const session = controller.start();
    if (session === null) {
      throw new Error('expected a session');
    }
    const captured = captureResult(session);
    const timeline = controller.currentTimeline;
    if (timeline === null) {
      throw new Error('expected a timeline');
    }

    let stepsPlayed = 0;
    let guard = timeline.length * 4;
    while (session.status === 'running' && guard > 0) {
      guard -= 1;
      const step = session.currentStep;
      if (step === null) {
        break;
      }
      clock.advance(400);
      if (stepsPlayed === 1) {
        // A clumsy semitone slip before finding the right key.
        midi.noteOn((step.expectedMidi[0] ?? 60) + 1, clock.now());
      }
      midi.playChord(step.expectedMidi, clock.now() + 10, 8);
      stepsPlayed += 1;
    }

    expect(session.status).toBe('completed');
    expect(captured.report?.totals.wrongNotes).toBe(1);
    expect(captured.report?.totals.incorrect).toBe(1);
    expect(captured.report?.totals.correctNotes).toBe(timeline.noteCount);
    expect(captured.score?.accuracy).toBeLessThan(1);
    expect(captured.score?.accuracy).toBeGreaterThan(0.8);
  });

  it('plays a generated exercise in time in Flow mode', async () => {
    const { controller, midi, metronome } = createRig({
      modeId: FLOW_MODE_ID,
      countInBars: 1,
      matchToleranceMs: 250,
    });
    await controller.loadNewExercise();

    const session = controller.start();
    if (session === null) {
      throw new Error('expected a session');
    }
    const captured = captureResult(session);
    const timeline = controller.currentTimeline;
    if (timeline === null) {
      throw new Error('expected a timeline');
    }

    // One bar of count-in shifts every musical position by a whole bar.
    const offset = timeline.exercise.timeSignature.ticksPerMeasure;

    for (const step of timeline.playableSteps) {
      metronome.advanceToTicks(offset + step.onsetTicks);
      midi.playChord(step.expectedMidi);
    }
    metronome.advanceToTicks(offset + timeline.totalTicks);

    expect(session.status).toBe('completed');
    expect(captured.report?.totals.correctNotes).toBe(timeline.noteCount);
    expect(captured.report?.timing.meanAbsoluteDeviationMs).toBe(0);
    expect(captured.score?.timing).toBe(1);
    expect(captured.score?.grade).toBe('A');
  });

  it('penalises a run that is consistently behind the beat', async () => {
    const { controller, midi, metronome, clock } = createRig({
      modeId: FLOW_MODE_ID,
      countInBars: 1,
      matchToleranceMs: 400,
    });
    await controller.loadNewExercise();

    const session = controller.start();
    if (session === null) {
      throw new Error('expected a session');
    }
    const captured = captureResult(session);
    const timeline = controller.currentTimeline;
    if (timeline === null) {
      throw new Error('expected a timeline');
    }

    const offset = timeline.exercise.timeSignature.ticksPerMeasure;
    for (const step of timeline.playableSteps) {
      metronome.advanceToTicks(offset + step.onsetTicks);
      midi.playChord(step.expectedMidi, clock.now() + 180);
    }
    metronome.advanceToTicks(offset + timeline.totalTicks);

    expect(captured.report?.totals.correctNotes).toBe(timeline.noteCount);
    expect(captured.report?.timing.meanAbsoluteDeviationMs).toBe(180);
    expect(captured.score?.accuracy).toBe(1);
    expect(captured.score?.timing).toBeLessThan(1);
    expect(captured.score?.overall).toBeLessThan(1);
  });

  it('keeps the whole loop free of hardware, DOM and wall-clock time', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const { controller, midi, clock } = createRig();
    await controller.loadNewExercise();
    const session = controller.start();
    if (session === null) {
      throw new Error('expected a session');
    }

    let guard = 200;
    while (session.status === 'running' && guard > 0) {
      guard -= 1;
      const step = session.currentStep;
      if (step === null) {
        break;
      }
      clock.advance(100);
      midi.playChord(step.expectedMidi, clock.now());
    }

    expect(session.status).toBe('completed');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

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
import { bar, beamedSixteenths, longExercise, p, tiedExercise, twoBarExercise } from '../support/fixtures.js';
import { measureCount } from '../../src/domain/model/Exercise.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry } from '../../src/domain/model/Exercise.js';
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
    expect(controller.settings.tempoPercent).toBe(100);
    expect(controller.tempoBpm).toBe(firstPreset?.defaults.tempoBpm);
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

    controller.setTempoBpm(96);
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
    // The percentage is the reader's and stays theirs; what it is a
    // percentage *of* is the new preset's.
    expect(controller.tempoBpm).toBe(target.defaults.tempoBpm);
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
    expect(controller.tempoBpm).toBe(target.defaults.tempoBpm);
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
    // The file's own tempo is what 100% means, so at 100% it is read as
    // written and the slider shows the truth about it.
    expect(controller.tempoBpm).toBe(opened.tempoBpm);
    expect(loaded.tempoBpm).toBe(opened.tempoBpm);
    expect(renderer.loadedXml).toContain('Something Borrowed');
    // The timeline is derived from it like any other exercise, which is the
    // whole reason an import has to become one.
    expect(controller.currentTimeline?.length).toBe(4);
  });

  it('lets the reader slow an opened score down', async () => {
    const { controller, renderer } = createController();
    await controller.openScore(tiedExercise({ tempoBpm: 120 }));
    expect(controller.tempoBpm).toBe(120);

    controller.setTempoBpm(60);
    await controller.reloadExercise();

    // Same notes, read at half the speed the file asked for.
    expect(controller.currentExercise?.tempoBpm).toBe(60);
    expect(controller.openedExercise?.tempoBpm).toBe(120);
    // And the page still says what the writer wrote. A printed score states
    // the tempo it was written at and says nothing about how fast anyone is
    // playing it today; what the run is actually taken at is the transport's
    // to say, and it says it.
    expect(renderer.loadedXml).toContain('<per-minute>120</per-minute>');
  });

  it('beats a written tempo change at the reader’s share of it too', async () => {
    // The whole way through, not only in the settings: a Più mosso left at
    // its own beats would be the piece speeding up to somewhere they never
    // asked for, and the metronome is what they would hear it in.
    const { controller, metronome } = createController();
    await controller.openScore({
      ...twoBarExercise({ tempoBpm: 100 }),
      tempoChanges: [{ measureIndex: 1, offsetTicks: 0, tempoBpm: 200 }],
    });
    controller.nudgeTempoPercent(-50);
    await controller.reloadExercise();
    controller.start();

    expect(metronome.currentConfig.bpm).toBe(50);
    expect(metronome.currentConfig.tempos).toEqual([
      { startTicks: 0, bpm: 50 },
      { startTicks: Duration.WHOLE.ticks, bpm: 100 },
    ]);
  });

  it('does not engrave the page again for a change of speed', async () => {
    // Engraving is two and a half seconds on a long score against thirty
    // milliseconds to write the file. Redrawing for a tempo nudge spent
    // nearly all of it on notes nobody had touched, and swallowed the next
    // press while it did.
    const { controller, renderer } = createController();
    await controller.openScore(tiedExercise({ tempoBpm: 120 }));
    const drawn = renderer.loadCount;

    controller.setTempoBpm(60);
    await controller.reloadExercise();
    controller.setTempoBpm(90);
    await controller.reloadExercise();

    expect(renderer.loadCount).toBe(drawn);
    // The run does follow, which is the half that has to keep working.
    expect(controller.currentExercise?.tempoBpm).toBe(90);
  });

  it('leaves the marker where the reader put it for a change of speed', async () => {
    // Reported from the page: nudging the percentage while reading page five
    // put the marker on the first bar of *that* page. It had been sent back
    // to the top of the piece, and the engraver draws one marker for the
    // whole score in the coordinates of its own page - so bar one of page one
    // is drawn at the top of whichever page is up. The music did not change,
    // so nothing the reader knows about the page changed either.
    const { controller, renderer } = createController();
    await controller.openScore(longExercise({ bars: 8 }));
    const at = controller.beginAtBar(5);
    expect(at).toBeGreaterThan(0);
    const puttingBack = renderer.cursor.resetCount;

    controller.nudgeTempoPercent(-20);
    await controller.reloadExercise();

    expect(renderer.cursor.position).toBe(at);
    expect(controller.beginsAt).toBe(at);
    expect(renderer.cursor.resetCount).toBe(puttingBack);
  });

  it('does put the marker back when the music itself changes', async () => {
    // The other half of the same rule: a place in the piece just closed means
    // nothing in the one being opened.
    const { controller, renderer } = createController();
    await controller.openScore(longExercise({ bars: 8 }));
    controller.beginAtBar(5);

    await controller.openScore(tiedExercise());

    expect(renderer.cursor.position).toBe(0);
    expect(controller.beginsAt).toBe(0);
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

  it('does not carry a slow piece’s beats onto generated material', async () => {
    // 100% means the tempo the material declares, and a file declares its
    // own. The bpm used to be carried straight across, so 80% of a slow piece
    // came back as some number well past full speed on the next one. Now the
    // piece is left behind and the speed it was being read at goes with it.
    const { controller } = createController();
    await controller.openScore({ ...twoBarExercise(), tempoBpm: 40 });
    controller.nudgeTempoPercent(-20);
    expect(controller.tempoPercent).toBe(80);

    await controller.loadNewExercise();

    expect(controller.tempoPercent).toBe(100);
    expect(controller.tempoBpm).toBe(controller.baseTempoBpm);
    expect(controller.tempoBpm).not.toBe(32);
  });

  it('takes a written tempo change at the same share as the rest', async () => {
    // The reader set one number and meant one thing by it: the whole piece at
    // this share of its written speed. A Più mosso left at its own beats would
    // be the piece speeding up to somewhere they never asked for.
    const { controller } = createController();
    await controller.openScore({
      ...twoBarExercise({ tempoBpm: 100 }),
      tempoChanges: [{ measureIndex: 1, offsetTicks: 0, tempoBpm: 200 }],
    });
    controller.nudgeTempoPercent(-50);
    await controller.reloadExercise();

    expect(controller.tempoPercent).toBe(50);
    expect(controller.tempoBpm).toBe(50);
    expect(controller.currentExercise?.tempoChanges).toEqual([
      { measureIndex: 1, offsetTicks: 0, tempoBpm: 100 },
    ]);
  });

  it('draws a note taken early as right, and as displaced', async () => {
    // The whole chain, which is where it was broken: an early press has to
    // reach the page as *correct* before the paler green it is drawn in can
    // mean anything. Called a wrong note it went to the page in red, and the
    // reader was told they had played something they had not.
    const { controller, renderer, midi, metronome, clock } = createController(true, undefined, {
      modeId: FLOW_MODE_ID,
      countInBars: 0,
      matchToleranceMs: 250,
    });
    await controller.loadNewExercise();
    controller.start();
    // The music starts here; the first beat is open and the second is not.
    metronome.advanceSubdivisions(1);
    const secondBeat = controller.currentTimeline?.at(1)?.expectedMidi ?? [];
    expect(secondBeat.length).toBeGreaterThan(0);

    // Its note, taken three tenths of a second before it is due - nearer to
    // its own beat than to the one still open.
    clock.set(clock.now() + 700);
    for (const midiNote of secondBeat) {
      midi.noteOn(midiNote, clock.now());
    }
    metronome.advanceSubdivisions(1);

    const early = renderer.played.at(-1);
    expect(early?.midi).toBe(secondBeat[0]);
    expect(early?.correct).toBe(true);
    // Displaced is what makes it paler: the offset is the only thing the
    // drawing reads, so the colour and the position can never disagree.
    expect(early?.offset).toBeLessThan(0);
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

  it('forgets them when another piece is opened', async () => {
    const { controller } = createController();
    await controller.openScore(longExercise({ bars: 8, title: 'Eight Bars' }));
    controller.choosePassage(3, 5);

    await controller.openScore(longExercise({ bars: 8, title: 'Something Else' }));

    // The markers were dragged around bars of the piece just closed. Left
    // where they were, they would narrow music the reader has not even read
    // yet - and on a shorter piece they would point past the last bar.
    expect(controller.settings.rangeFromBar).toBeNull();
    expect(controller.settings.rangeToBar).toBeNull();
  });

  it('keeps them when the same piece is opened again', async () => {
    const { controller } = createController();
    await controller.openScore(longExercise({ bars: 8, title: 'Eight Bars' }));
    controller.choosePassage(3, 5);

    // A second read of the same file - what the library hands back, and what
    // an edit in MuseScore comes back as. The bars still mean what they said.
    await controller.openScore(longExercise({ bars: 8, title: 'Eight Bars' }));

    expect(controller.settings.rangeFromBar).toBe(3);
    expect(controller.settings.rangeToBar).toBe(5);
  });

  it('forgets them when a score replaces generated material', async () => {
    const { controller } = createController();
    await controller.loadNewExercise();
    controller.updateSettings({ rangeFromBar: 2, rangeToBar: 3 });

    await controller.openScore(longExercise({ bars: 8, title: 'Eight Bars' }));

    expect(controller.settings.rangeFromBar).toBeNull();
    expect(controller.settings.rangeToBar).toBeNull();
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
    });
    controller.setTempoBpm(84);

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

    expect(renderer.cursor.moves.at(-1)).toBe(1);
  });

  it('puts the marker back at the beginning when a run is stopped', async () => {
    // At the beginning of what is being practised, and said as a move rather
    // than as a reset: a reset is bookkeeping and the page does not follow
    // one, which left a reader who stopped on page three with the marker at
    // bar one and page three still in front of them.
    const { controller, renderer } = createController();
    await controller.loadNewExercise();
    controller.start();
    renderer.cursor.moveTo(3);

    controller.stop();

    expect(controller.session?.status).toBe('aborted');
    expect(renderer.cursor.position).toBe(0);
    expect(renderer.cursor.moves.at(-1)).toBe(0);
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
    expect(metronome.currentConfig.bpm).toBe(controller.tempoBpm);
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

  it('is back at the first note before the count-in is heard', async () => {
    // The count-in exists to prepare the reader for the first bar, and the
    // cursor used to sit wherever the last run abandoned it for the whole of
    // it - so they spent it looking at the wrong end of the piece.
    const { controller, renderer, metronome } = createController(true, undefined, {
      modeId: FLOW_MODE_ID,
      countInBars: 1,
    });
    await controller.loadNewExercise();

    // A run carried some way in, then paused: nothing has put the cursor back.
    controller.start();
    metronome.advanceSubdivisions(6);
    controller.pause();
    expect(renderer.cursor.position).toBeGreaterThan(0);

    const session = controller.start();

    expect(session?.status).toBe('counting-in');
    expect(renderer.cursor.position).toBe(0);
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

  it('ends a performance when the music it was of is replaced', async () => {
    // Left running, it went on playing the notes of the piece before this one
    // over a page already engraved with the new one - and drove the marker
    // across that page while it did.
    const { controller } = createController(true);
    await controller.loadNewExercise();
    controller.listen();
    expect(controller.isListening).toBe(true);

    await controller.openScore(twoBarExercise({ title: 'Something Else' }));

    expect(controller.isListening).toBe(false);
  });

  it('ends it for a fresh generated exercise too', async () => {
    const { controller } = createController(true);
    await controller.openScore(twoBarExercise({ title: 'On The Stand' }));
    controller.listen();
    expect(controller.isListening).toBe(true);

    await controller.loadNewExercise();

    expect(controller.isListening).toBe(false);
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

    controller.setTempoBpm(90);

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

    rig.controller.setTempoBpm(48);
    rig.controller.updateSettings({ measures: 8 });

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
    expect(controller.tempoBpm).toBe(controller.baseTempoBpm);
  });

  it('moves in whole steps of the written tempo', () => {
    const { controller } = createController();
    const base = controller.baseTempoBpm;

    expect(controller.nudgeTempoPercent(-5)).toBe(95);
    expect(controller.tempoBpm).toBe(Math.round(base * 0.95));

    controller.nudgeTempoPercent(-5);
    expect(controller.tempoPercent).toBe(90);
  });

  it('stays on the grid however the tempo was reached', () => {
    const { controller } = createController();
    // Set by hand from the slider, to something no step would land on.
    controller.setTempoBpm(Math.round(controller.baseTempoBpm * 0.83));

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
    // And it opens at what it is written at. A share is a share *of*
    // something, and eighty per cent of the exercise just closed says
    // nothing whatever about this piece.
    expect(controller.tempoPercent).toBe(100);
    expect(controller.tempoBpm).toBe(132);
  });

  it('opens a different piece at its own written speed', async () => {
    // His report: the percentage stayed put while the piece under it changed,
    // so a score opened after an hour of slow practice began at six tenths of
    // a tempo nobody had looked at yet.
    const { controller } = createController();
    await controller.openScore({ ...twoBarExercise({ tempoBpm: 100 }), title: 'One' });
    controller.nudgeTempoPercent(-40);
    expect(controller.tempoPercent).toBe(60);

    await controller.openScore({ ...tiedExercise({ tempoBpm: 90 }), title: 'Another' });

    expect(controller.tempoPercent).toBe(100);
    expect(controller.tempoBpm).toBe(90);
  });

  it('keeps the speed when the same piece is opened again', async () => {
    // Which is what the library does when a file is read back after being
    // edited in MuseScore: the piece the reader was working on, at the speed
    // they were working on it. Identity is the title, as it is for the
    // passage.
    const { controller } = createController();
    await controller.openScore({ ...twoBarExercise(), title: 'One' });
    controller.nudgeTempoPercent(-40);

    await controller.openScore({ ...twoBarExercise(), title: 'One' });

    expect(controller.tempoPercent).toBe(60);
  });

  it('leaves a piece behind at the speed it was being read', async () => {
    const { controller } = createController();
    await controller.openScore(twoBarExercise());
    controller.nudgeTempoPercent(-40);

    await controller.loadNewExercise();

    expect(controller.tempoPercent).toBe(100);
  });

  it('keeps it between one generated exercise and the next', async () => {
    // The same stand with different notes on it.
    const { controller } = createController();
    controller.nudgeTempoPercent(-20);

    await controller.loadNewExercise();

    expect(controller.tempoPercent).toBe(80);
  });

  it('does not carry an opened score off the stand and onto the next visit', async () => {
    // The report: the page was opened and the tempo already read past 100%,
    // with nobody having touched it. A file's tempo used to be written into
    // the settings - the calibration piece is a file, and so is every score
    // - and the next visit, with nothing on the stand, read those beats
    // against the preset's own written tempo. A percentage means the same
    // thing whatever is in front of the reader, so there is nothing left to
    // read wrongly.
    const first = createController();
    await first.controller.openScore(twoBarExercise({ tempoBpm: 80 }));
    expect(first.controller.tempoBpm).toBe(80);
    expect(first.controller.tempoPercent).toBe(100);

    const next = createController(false, undefined, first.controller.settings);

    expect(next.controller.tempoPercent).toBe(100);
    expect(next.controller.tempoBpm).toBe(next.controller.baseTempoBpm);
  });

  it('keeps the share the reader chose across the visit, not the beats', async () => {
    // Generated material either side, which is the same stand: what is kept
    // is the percentage, and it is read against whatever the next visit puts
    // in front of the reader.
    const first = createController();
    first.controller.nudgeTempoPercent(-20);
    await first.controller.loadNewExercise();

    const next = createController(false, undefined, first.controller.settings);

    expect(next.controller.tempoPercent).toBe(80);
    expect(next.controller.tempoBpm).toBe(Math.round(next.controller.baseTempoBpm * 0.8));
  });

  it('honours a tempo given in beats, even past what the buttons reach', () => {
    // The box promises a range of beats and has to keep that promise. The
    // quarter-to-double bound belongs to the buttons, where a runaway press
    // could actually happen.
    const { controller } = createController();
    const base = controller.baseTempoBpm;

    controller.setTempoBpm(base * 3);

    expect(controller.tempoBpm).toBe(base * 3);
    expect(controller.tempoPercent).toBe(300);
    // And the buttons take it back inside their own bounds at the first press.
    expect(controller.nudgeTempoPercent(5)).toBe(200);
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
        { rewardPerBeat: 0, missPenalty: 0, wrongPenalty: 0 },
      );
      await rig.controller.loadNewExercise();
      rig.controller.start();
      // Generously past the end; the pulse stops when the music does.
      rig.metronome.advanceSubdivisions(400);
      return 1 - rig.controller.health;
    }

    // A bar of 2/4 in sixteenths is two beats and every one of them is played.
    expect(await drainOverWholePiece(beamedSixteenths())).toBeCloseTo(2 * 0.035, 3);
    // Two bars of 4/4 are eight beats, of which the last two ask for nothing:
    // the second bar's whole note is being held over a rest in the bass, and
    // time the reader cannot be asked anything at costs them nothing.
    expect(await drainOverWholePiece(twoBarExercise())).toBeCloseTo(6 * 0.035, 3);
  });

  it('counts the beat the music is written in, not the one the settings say', async () => {
    // An opened score keeps the metre it was written in while the settings go
    // on saying whatever the generator was last asked for. Read from the
    // settings, a bar of 6/8 was counted as three beats instead of two, and
    // the bar fell half as fast again as it should for the whole piece.
    const sixEight: Exercise = {
      ...twoBarExercise(),
      timeSignature: new TimeSignature(6, 8),
      staves: [
        {
          staffNumber: 1,
          voice: 1,
          clef: 'treble',
          clefChanges: [],
          measures: [
            bar(
              ...['C4', 'D4', 'E4', 'F4', 'G4', 'A4'].map((name) =>
                noteEntry(p(name), Duration.EIGHTH),
              ),
            ),
          ],
        },
      ],
    };

    const rig = createController(
      false,
      () => ({ provide: () => Promise.resolve(sixEight) }),
      // The settings disagree with the file, which is the ordinary case.
      { modeId: FLOW_MODE_ID, survival: true, timeSignature: new TimeSignature(4, 4) },
      undefined,
      { rewardPerBeat: 0, missPenalty: 0, wrongPenalty: 0 },
    );
    await rig.controller.loadNewExercise();
    rig.controller.start();
    rig.metronome.advanceSubdivisions(400);

    // Two dotted quarters, because that is what a bar of 6/8 is felt as.
    expect(1 - rig.controller.health).toBeCloseTo(2 * 0.035, 3);
  });

  it('falls at the same rate per bar however slow the piece is', async () => {
    // Measured in beats rather than seconds, so the tempo does not decide how
    // hard the game is - which is the whole reason a slow melody is playable.
    const slow = await survivalRun();
    slow.controller.setTempoBpm(40);
    await slow.controller.reloadExercise();
    slow.controller.start();
    slow.metronome.advanceSubdivisions(8);

    const fast = await survivalRun();
    fast.controller.setTempoBpm(160);
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

  it('does not charge a hand for the bars that belong to the other one', async () => {
    // The complaint this answers: practising one hand, whole stretches ask
    // nothing of it, and the bar used to fall straight through them with no
    // note in reach to earn anything back. Whether the reader survived was
    // then decided by how many notes their hand happened to have, which is a
    // property of the music and not of the playing.
    //
    // Staff 2 is the left hand. It has two notes across eight beats here.
    // Played
    // perfectly, that has to be enough - and a perfect run must never fall.
    async function healthAfterAPerfectRunOf(handStaff: number | null): Promise<number> {
      const rig = await survivalRun({ handStaff });
      let due: readonly number[] = [];
      rig.controller.events.on('sessionCreated', ({ session }) => {
        // What *this run* asks for here, which practising one hand narrows.
        session.events.on('stepEntered', ({ expectedMidi }) => {
          due = expectedMidi;
        });
      });
      const session = rig.controller.start();

      for (let at = 0; at < 40; at += 1) {
        for (const midi of due) {
          rig.midi.noteOn(midi, rig.clock.now());
        }
        due = [];
        rig.metronome.advanceSubdivisions(1);
      }
      expect(session?.status).toBe('completed');
      return rig.controller.health;
    }

    expect(await healthAfterAPerfectRunOf(2)).toBe(1);
    // And not because one hand is special: reading both is the same rule.
    expect(await healthAfterAPerfectRunOf(null)).toBe(1);
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

describe('choosing a passage with the markers', () => {
  /** Eight bars, numbered from one, so a slice has room on both sides. */
  async function opened(bars = 8) {
    const rig = createController();
    await rig.controller.openScore(longExercise({ bars, title: 'Eight Bars' }));
    return rig;
  }

  it('takes the bars the markers were dragged around', async () => {
    const rig = await opened();

    expect(rig.controller.choosePassage(3, 5)).toEqual({ fromBar: 3, toBar: 5 });
    expect(rig.controller.settings.rangeFromBar).toBe(3);
    expect(rig.controller.settings.rangeToBar).toBe(5);
  });

  it('narrows a passage that is already a passage', async () => {
    // The engraving *is* the passage once one is chosen, so the caller works
    // in the piece's own bar numbers and these come through unchanged.
    const rig = await opened();
    rig.controller.choosePassage(3, 6);
    await rig.controller.reloadExercise();

    expect(rig.controller.choosePassage(4, 5)).toEqual({ fromBar: 4, toBar: 5 });
  });

  it('widens back past what is on the page', async () => {
    // The bars outside a passage are not engraved at all, so a marker
    // dragged off the edge asks for bars nothing on the page can measure.
    // This is the only place that knows how far out they go.
    const rig = await opened();
    rig.controller.choosePassage(4, 5);
    await rig.controller.reloadExercise();

    expect(rig.controller.choosePassage(2, 5)).toEqual({ fromBar: 2, toBar: 5 });
  });

  it('stops at the ends of the piece however far the drag went', async () => {
    const rig = await opened();

    expect(rig.controller.choosePassage(-40, 900)).toEqual({ fromBar: null, toBar: null });
    expect(rig.controller.choosePassage(-40, 3)).toEqual({ fromBar: 1, toBar: 3 });
  });

  it('is the whole piece again once both markers are back at the ends', async () => {
    // "The whole piece" stays one state rather than two that have to be kept
    // in step: pulled back out to both ends, there is no range at all.
    const rig = await opened();
    rig.controller.choosePassage(3, 5);

    expect(rig.controller.choosePassage(1, 8)).toEqual({ fromBar: null, toBar: null });
    expect(rig.controller.settings.rangeFromBar).toBeNull();
    expect(rig.controller.settings.rangeToBar).toBeNull();
  });

  it('will not let the markers cross', async () => {
    const rig = await opened();

    expect(rig.controller.choosePassage(6, 2)).toEqual({ fromBar: 6, toBar: 6 });
  });

  it('practises the bars it was asked for on a score that starts at bar 40', async () => {
    // A range is in the score's own bar numbers - what the reader reads off
    // the page - and the run has to begin and end on those bars whatever the
    // piece calls its first one. The music itself is left whole.
    const rig = createController();
    await rig.controller.openScore({ ...longExercise({ bars: 8 }), firstBarNumber: 40 });

    rig.controller.choosePassage(42, 44);
    const loaded = await rig.controller.reloadExercise();

    // The page still holds the whole piece, numbered as the score numbers it.
    expect(loaded.firstBarNumber).toBe(40);
    expect(measureCount(loaded)).toBe(8);
    expect(rig.controller.barNumber(0)).toBe(40);

    rig.controller.updateSettings({ countInBars: 0 });
    const session = rig.controller.start();
    expect(session?.currentStep?.measureIndex).toBe(2);
  });

  it('counts from the bar numbers the score itself carries', async () => {
    // A score that starts at bar 40 - which is what a slice carried out of a
    // longer piece looks like - must not have its passage measured from one.
    const rig = createController();
    await rig.controller.openScore({ ...longExercise({ bars: 4 }), firstBarNumber: 40 });

    expect(rig.controller.pieceBarRange).toEqual({ firstBar: 40, lastBar: 43 });
    expect(rig.controller.choosePassage(41, 42)).toEqual({ fromBar: 41, toBar: 42 });
    expect(rig.controller.choosePassage(1, 900)).toEqual({ fromBar: null, toBar: null });
  });
});

describe('what was decided about each press', () => {
  it('is written down, including when no mark was drawn and why', async () => {
    // Every fault here has been invisible from outside: a mark in the wrong
    // colour, in the wrong place, or missing altogether all look the same on
    // a page - like nothing happening. Guessing from a description of that
    // costs more than writing the decisions down.
    const { controller, midi, metronome, clock } = createController(true, undefined, {
      modeId: FLOW_MODE_ID,
      countInBars: 0,
      playedNotes: 'hidden',
    });
    await controller.loadNewExercise();
    const session = controller.start();
    metronome.advanceSubdivisions(1);

    for (const midiNote of session?.currentStep?.expectedMidi ?? []) {
      midi.noteOn(midiNote, clock.now());
    }

    const log = controller.judgingLog;
    expect(log.length).toBeGreaterThan(0);
    expect(log[0]?.drawn).toBe(false);
    expect(log[0]?.why).toBe('marks are turned off');
    expect(log[0]?.stepIndex).toBe(0);
  });

  it('says a mark was drawn when one was', async () => {
    const { controller, midi, metronome, clock } = createController(true, undefined, {
      modeId: FLOW_MODE_ID,
      countInBars: 0,
    });
    await controller.loadNewExercise();
    const session = controller.start();
    metronome.advanceSubdivisions(1);
    for (const midiNote of session?.currentStep?.expectedMidi ?? []) {
      midi.noteOn(midiNote, clock.now());
    }

    expect(controller.judgingLog.every((press) => press.drawn)).toBe(true);
    expect(controller.judgingLog[0]?.verdict).toBe('correct');
  });

  it('keeps a bounded ring rather than a session-long history', async () => {
    const { controller, midi, metronome, clock } = createController(true, undefined, {
      modeId: FLOW_MODE_ID,
      countInBars: 0,
    });
    await controller.loadNewExercise();
    controller.start();
    metronome.advanceSubdivisions(1);
    for (let press = 0; press < 400; press += 1) {
      midi.noteOn(60 + (press % 12), clock.now());
    }

    expect(controller.judgingLog.length).toBeLessThanOrEqual(300);
  });
});

describe('the last run that reached an end', () => {
  it('outlives the session, so what it measured can still be acted on', async () => {
    // The live session is replaced the moment anything starts another run,
    // and with repeat left on the replacement arrives before the reader can
    // look at what the last one measured.
    const { controller, midi, metronome, clock } = createController(true, undefined, {
      modeId: FLOW_MODE_ID,
      countInBars: 0,
    });
    await controller.loadNewExercise();
    const first = controller.start();
    metronome.advanceSubdivisions(1);
    for (const midiNote of first?.currentStep?.expectedMidi ?? []) {
      midi.noteOn(midiNote, clock.now());
    }
    first?.abort();
    const measured = controller.lastReport;
    expect(measured).not.toBeNull();

    controller.start();

    // A fresh session has measured nothing; the run before it still has.
    expect(controller.session?.report).toBeNull();
    expect(controller.lastReport).toBe(measured);
  });

  describe('dimming what the run will not ask for', () => {
    it('says the whole piece and both hands when nothing is narrowed', async () => {
      const { controller, renderer } = createController(true);
      await controller.loadNewExercise();

      // Every step, and no hand singled out: there is nothing to dim, and
      // saying so is not the same as being switched off.
      expect(renderer.reading).toEqual({
        staves: [],
        from: 0,
        to: (controller.currentTimeline?.length ?? 0) - 1,
      });
    });

    it('names the hand being read when one is', async () => {
      const { controller, renderer } = createController(true);
      await controller.loadNewExercise();

      controller.updateSettings({ handStaff: 2 });

      expect(renderer.reading?.staves).toEqual([2]);
    });

    it('narrows to the passage when one is chosen', async () => {
      const { controller, renderer } = createController(true);
      await controller.loadNewExercise();
      const whole = renderer.reading;

      // The fixture is two bars, so each end has to be narrowed on its own.
      controller.updateSettings({ rangeToBar: 1 });
      expect(renderer.reading?.to).toBeLessThan(whole?.to ?? Infinity);

      controller.updateSettings({ rangeFromBar: 2, rangeToBar: null });
      expect(renderer.reading?.from).toBeGreaterThan(whole?.from ?? 0);
    });

    it('says nothing at all when the reader has turned it off', async () => {
      // Off means off: a page that dims nothing is what was asked for, and
      // the renderer is told that rather than being told a reading it should
      // then ignore.
      const { controller, renderer } = createController(true);
      await controller.loadNewExercise();
      expect(renderer.reading).not.toBeNull();

      controller.updateSettings({ dimUnplayed: false });

      expect(renderer.reading).toBeNull();
    });

    it('starts saying it again when it is turned back on', async () => {
      const { controller, renderer } = createController(true);
      await controller.loadNewExercise();
      controller.updateSettings({ dimUnplayed: false, handStaff: 1 });

      controller.updateSettings({ dimUnplayed: true });

      expect(renderer.reading?.staves).toEqual([1]);
    });
  });

  describe('starting by playing the opening', () => {
    /** The notes the run would ask for first. */
    function opening(controller: PracticeController): readonly number[] {
      return controller.currentTimeline?.at(0)?.expectedMidi ?? [];
    }

    it('starts the run when the opening chord is played', async () => {
      // The reader's hands are already on the keys; reaching for the tablet
      // to begin, and reaching back, is most of what starting costs.
      const { controller, midi, clock } = createController(true, undefined, {
        immediateStart: true,
        modeId: FLOW_MODE_ID,
      });
      await controller.loadNewExercise();
      expect(controller.session).toBeNull();

      for (const midiNote of opening(controller)) {
        midi.noteOn(midiNote, clock.now());
      }

      expect(controller.session).not.toBeNull();
    });

    it('waits, and does not punish, while the wrong notes are played', async () => {
      // Nothing is being graded yet, so a wrong note is not a mistake - it is
      // simply not the thing being waited for.
      const { controller, midi, clock } = createController(true, undefined, {
        immediateStart: true,
        modeId: FLOW_MODE_ID,
      });
      await controller.loadNewExercise();
      const wanted = new Set(opening(controller));

      for (const stray of [40, 41, 42]) {
        if (!wanted.has(stray)) {
          midi.noteOn(stray, clock.now());
        }
      }

      expect(controller.session).toBeNull();
      expect(controller.lastReport).toBeNull();
    });

    it('counts the chord that started it as played, not as owed', async () => {
      // Otherwise the reader plays the first chord to begin and is then asked
      // for it again, which is the feature undoing itself. Wait mode is the
      // one that can be asked plainly: the music holds still until the notes
      // are played, so being past the first step is proof it was credited.
      const { controller, midi, clock } = createController(true, undefined, {
        immediateStart: true,
      });
      await controller.loadNewExercise();

      for (const midiNote of opening(controller)) {
        midi.noteOn(midiNote, clock.now());
      }

      expect(controller.session?.status).toBe('running');
      expect(controller.session?.currentStep?.index).toBe(1);
    });

    it('does nothing at all while the setting is off', async () => {
      const { controller, midi, clock } = createController(true, undefined, {
        modeId: FLOW_MODE_ID,
      });
      await controller.loadNewExercise();

      for (const midiNote of opening(controller)) {
        midi.noteOn(midiNote, clock.now());
      }

      expect(controller.session).toBeNull();
    });

    it('stands down while something is already playing', async () => {
      // A performance is happening to the music, so a press is a press.
      const { controller, midi, clock } = createController(true, undefined, {
        immediateStart: true,
        modeId: FLOW_MODE_ID,
      });
      await controller.loadNewExercise();
      controller.listen();

      for (const midiNote of opening(controller)) {
        midi.noteOn(midiNote, clock.now());
      }

      expect(controller.session).toBeNull();
      expect(controller.isListening).toBe(true);
    });

    it('waits for the chord the run would ask for, not the piece’s first', async () => {
      // A place put somewhere else, or a passage chosen, moves what the run
      // begins with - so it moves what starts it.
      const { controller, midi, clock } = createController(true, undefined, {
        immediateStart: true,
        modeId: FLOW_MODE_ID,
      });
      await controller.loadNewExercise();
      const later = controller.currentTimeline?.steps.find((step) => step.measureIndex === 1);
      controller.beginAtBar(1);

      // The piece's own opening no longer starts anything.
      for (const midiNote of opening(controller)) {
        midi.noteOn(midiNote, clock.now());
      }
      expect(controller.session).toBeNull();

      for (const midiNote of later?.expectedMidi ?? []) {
        midi.noteOn(midiNote, clock.now());
      }
      expect(controller.session).not.toBeNull();
    });

    it('listens again once the run it started is over', async () => {
      const { controller, midi, clock } = createController(true, undefined, {
        immediateStart: true,
        modeId: FLOW_MODE_ID,
      });
      await controller.loadNewExercise();
      for (const midiNote of opening(controller)) {
        midi.noteOn(midiNote, clock.now());
      }
      const first = controller.session;
      expect(first).not.toBeNull();

      controller.stop();
      controller.beginAtTheStart();
      for (const midiNote of opening(controller)) {
        midi.noteOn(midiNote, clock.now());
      }

      expect(controller.session).not.toBeNull();
      expect(controller.session).not.toBe(first);
    });
  });

  it('outlives the material too, since a run is about the hands', async () => {
    const { controller, midi, metronome, clock } = createController(true, undefined, {
      modeId: FLOW_MODE_ID,
      countInBars: 0,
    });
    await controller.loadNewExercise();
    const session = controller.start();
    metronome.advanceSubdivisions(1);
    for (const midiNote of session?.currentStep?.expectedMidi ?? []) {
      midi.noteOn(midiNote, clock.now());
    }
    session?.abort();

    await controller.loadNewExercise();

    expect(controller.lastReport).not.toBeNull();
  });
});

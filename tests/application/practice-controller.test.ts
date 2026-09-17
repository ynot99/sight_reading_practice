import { describe, expect, it, vi } from 'vitest';
import {
  PracticeController,
  type PracticeControllerDependencies,
  type PracticeSettings,
} from '../../src/application/PracticeController.js';
import { FLOW_MODE_ID, FlowMode } from '../../src/application/modes/FlowMode.js';
import { PracticeModeRegistry } from '../../src/application/modes/PracticeModeRegistry.js';
import { BarMode, BAR_MODE_ID } from '../../src/application/modes/BarMode.js';
import { WaitMode } from '../../src/application/modes/WaitMode.js';
import { LISTEN_MODE_ID } from '../../src/application/modes/ListenFrame.js';
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
import { rollBeganAtMs } from '../../src/application/session/RunRoll.js';
import { PracticeHistory } from '../../src/application/PracticeHistory.js';
import { InMemorySettingsStore } from '../../src/application/ports/ISettingsStore.js';
import { DomainError } from '../../src/shared/errors.js';
import {
  MIDI,
  bar,
  beamedSixteenths,
  compoundBarExercise,
  longExercise,
  offBeatAfterALongNote,
  p,
  tiedExercise,
  twoBarExercise,
} from '../support/fixtures.js';
import { measureCount } from '../../src/domain/model/Exercise.js';
import { emptyRoll, theWaits } from '../../src/application/session/RunRoll.js';
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
  instrument: RecordingPitchPlayer;
} {
  const clock = new ManualClock();
  const midi = new MockMidiAdapter({ clock });
  const metronome = new ManualMetronome(clock);
  const renderer = new FakeScoreRenderer();
  const instrument = new RecordingPitchPlayer();

  const controller = new PracticeController({
    presets: new ExercisePresetRegistry().registerAll(BUILT_IN_PRESETS),
    rhythms: new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES),
    modes: new PracticeModeRegistry().registerAll([new WaitMode(), new FlowMode(), new BarMode()]),
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
    instrument,
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

  return { controller, renderer, midi, metronome, clock, instrument };
}

/**
 * Plays a run from where it stands to the end of it.
 *
 * Wait mode moves only when the reader does, so a whole passage is played by
 * asking each step what it wants and giving it that. Bounded, because a test
 * that cannot finish is worse than one that fails.
 */
function playItThrough(controller: PracticeController, midi: MockMidiAdapter): void {
  const session = controller.start();
  if (session === null) {
    throw new Error('expected a run');
  }
  for (let guard = 0; guard < 500 && session.status === 'running'; guard += 1) {
    const step = session.currentStep;
    if (step === null) {
      break;
    }
    for (const note of step.expectedMidi) {
      midi.noteOn(note, 0);
    }
  }
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

  it('offers a run to listen to before it begins, and to draw after', async () => {
    // What a run does first cannot be moved any earlier than it is: on a frame
    // that runs no pulse it is a click placed at the moment of the press, a
    // moment already gone. So nothing that draws may stand in front of it, and
    // the two moments are announced separately to keep them apart.
    const { controller } = createController(true);
    await controller.loadNewExercise();
    const when: { readonly event: string; readonly status: string | undefined }[] = [];
    controller.events.on('sessionBuilt', ({ session }) => {
      when.push({ event: 'built', status: session.status });
    });
    controller.events.on('sessionCreated', ({ session }) => {
      when.push({ event: 'created', status: session.status });
    });

    controller.start();

    expect(when.map((each) => each.event)).toEqual(['built', 'created']);
    // Bound while it is still idle, so nothing it does is missed; drawn once it
    // is under way, so the drawing is behind the run rather than in front of it.
    expect(when[0]?.status).toBe('idle');
    expect(when[1]?.status).not.toBe('idle');
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

  it('carries a renamed piece through the history, and only that piece', async () => {
    // Renaming a score is not starting it again. The keys are built here -
    // the title, and then the passage's bars - so what belongs to a piece is
    // decided here too: titles have spaces in them, and "Old" is the
    // beginning of "Old Man" on any reading a store could invent by itself.
    const history = new PracticeHistory(new InMemorySettingsStore());
    const { controller } = createController(true, undefined, {}, history);
    history.record('score:Old', { atMs: 1, overall: 0.8, grade: 'B', completed: true });
    history.record('score:Old bars:5-8', { atMs: 2, overall: 0.6, grade: 'C', completed: true });
    history.record('score:Old Man bars:1-4', { atMs: 3, overall: 0.4, grade: 'D', completed: true });

    controller.followTheRename('Old', 'New');

    expect(history.summary('score:New')?.last).toBeCloseTo(0.8);
    expect(history.summary('score:New bars:5-8')?.last).toBeCloseTo(0.6);
    expect(history.summary('score:Old')).toBeNull();
    expect(history.summary('score:Old Man bars:1-4')?.last).toBeCloseTo(0.4);
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
      staves: [treble, { ...bass, clefChanges: [{ measureIndex: 1, offsetTicks: 0, clef: 'treble' as const }] }],
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

    // Settled, the whole beat having been played: right notes are drawn
    // palely until the chord they belong to is complete.
    expect(renderer.played).toEqual(
      step.expectedMidi.map((midiNote) => ({
        stepIndex: 0,
        midi: midiNote,
        correct: true,
        offset: 0,
        settled: true,
      })),
    );
  });

  it('reddens the marker as the misses pile up on one step', async () => {
    // His idea, and the reason for it: practising with every colour off is
    // reading blind on purpose, but blind he cannot tell *where* he came
    // unstuck - only that he did. The marker is standing on the place.
    const { controller, renderer, midi } = createController(true, undefined, {
      playedNotes: 'hidden',
      cursorWhileRunning: false, cursorWhileListening: false, cursorAtRest: false,
    });
    await controller.loadNewExercise();
    const session = controller.start();
    const wrong = (session?.currentStep?.expectedMidi[0] ?? 60) + 1;
    expect(renderer.trouble).toBe(0);

    midi.noteOn(wrong, 0);
    expect(renderer.trouble).toBe(1);
    // And it comes back even though he put it away: for exactly as long as
    // there is something to say, and nothing is added to the page to say it.
    expect(renderer.cursor.visible).toBe(true);

    midi.noteOn(wrong + 2, 0);
    expect(renderer.trouble).toBe(2);
  });

  it('forgets the trouble when the music moves on', async () => {
    const { controller, renderer, midi } = createController(true, undefined, {
      cursorWhileRunning: false, cursorWhileListening: false, cursorAtRest: false,
    });
    await controller.loadNewExercise();
    const session = controller.start();
    const step = session?.currentStep;
    midi.noteOn((step?.expectedMidi[0] ?? 60) + 1, 0);
    expect(renderer.trouble).toBe(1);

    for (const midiNote of step?.expectedMidi ?? []) {
      midi.noteOn(midiNote, 0);
    }

    expect(renderer.trouble).toBe(0);
    // And the marker goes back where the reader had put it.
    expect(renderer.cursor.visible).toBe(false);
  });

  it('forgets the trouble when the run is over', async () => {
    // Reported from the page: the marker stayed red after the run finished.
    // It says "you are stuck here, now", and a run that is over has neither -
    // what is left of it is the report and the marks. Both ways a run can end
    // come through the same place, so stopping one clears it too.
    const { controller, renderer, midi } = createController(true, undefined, {
      cursorWhileRunning: false, cursorWhileListening: false, cursorAtRest: false,
    });
    await controller.openScore(twoBarExercise());
    // A passage of one bar, so that the step he misses is the *last* one the
    // run has: every step entered clears the trouble on the one before it, so
    // the only trouble a finished run can leave behind is on the step nothing
    // follows.
    controller.updateSettings({ rangeFromBar: 1, rangeToBar: 1 });
    const steps = controller.currentTimeline?.steps ?? [];
    const inBar = steps.filter((step) => step.measureIndex === 0);
    const last = inBar[inBar.length - 1]?.index ?? 0;
    expect((steps[last]?.expectedMidi ?? []).length).toBeGreaterThan(0);
    controller.start();

    // Up to the last step, playing it right. Every step entered clears the
    // trouble on the one before it - so the only trouble a finished run can
    // leave behind is the trouble on its *last* step, which nothing enters a
    // step after.
    for (let guard = 0; guard < 64; guard += 1) {
      const step = controller.session?.currentStep;
      if (step === null || step === undefined || step.index >= last) {
        break;
      }
      for (const midiNote of step.expectedMidi) {
        midi.noteOn(midiNote, 0);
      }
    }
    expect(controller.session?.currentStep?.index).toBe(last);

    const wanted = controller.session?.currentStep?.expectedMidi ?? [];
    midi.noteOn((wanted[0] ?? 60) + 1, 0);
    expect(renderer.trouble).toBe(1);

    for (const midiNote of wanted) {
      midi.noteOn(midiNote, 0);
    }

    expect(controller.session?.status).toBe('completed');
    expect(renderer.trouble).toBe(0);
    // And the marker goes back to being put away, as the reader had it.
    expect(renderer.cursor.visible).toBe(false);
  });

  it('says nothing in a mode that walks on without the reader', async () => {
    // Under the pulse the marker has moved on by the next beat, so reddening
    // it would be a flash rather than a place - and a reader who hid the
    // marker would have it blink back at them on every slip.
    const { controller, renderer, midi, metronome } = createController(true, undefined, {
      modeId: FLOW_MODE_ID,
      cursorWhileRunning: false, cursorWhileListening: false, cursorAtRest: false,
    });
    await controller.loadNewExercise();
    const session = controller.start();
    metronome.advanceSubdivisions(1);

    midi.noteOn((session?.currentStep?.expectedMidi[0] ?? 60) + 1, 0);

    expect(renderer.trouble).toBe(0);
    expect(renderer.cursor.visible).toBe(false);
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
    expect(renderer.played).toEqual([{ stepIndex: 0, midi: wrong, correct: false, offset: 0, settled: false }]);
  });

  it('settles the marks of a chord only once the whole of it is found', async () => {
    // His line 49: light green until every note of the beat is right, then
    // the ordinary green. A chord half found is not a chord, and a reader
    // should see which of the two they are looking at without counting.
    const { controller, renderer, midi } = createController(true);
    await controller.loadNewExercise();
    const session = controller.start();
    const chord = session?.currentStep?.expectedMidi ?? [];
    expect(chord.length).toBeGreaterThan(1);

    midi.noteOn(chord[0] ?? 60, 0);
    expect(renderer.played.map((mark) => mark.settled)).toEqual([false]);
    expect(renderer.settled).toEqual([]);

    for (const note of chord.slice(1)) {
      midi.noteOn(note, 0);
    }

    expect(renderer.settled).toContain(0);
    expect(renderer.played.every((mark) => mark.settled === true)).toBe(true);
  });

  it('gives the speed back a little at a time for a clean reading', async () => {
    // Never above what the reader asked for, and in smaller steps than it
    // took away: getting through something at 70 does not prove 90.
    const { controller, midi, metronome, clock } = createController(true);
    controller.updateSettings({
      modeId: FLOW_MODE_ID,
      easeTheTempo: true,
      countInBars: 0,
      // Any note satisfies a step, so what is being tested is the rule about
      // speed rather than this test's ability to play in time.
      rhythmOnly: true,
    });
    await controller.openScore(longExercise({ bars: 4, tempoBpm: 60 }));
    controller.updateSettings({ tempoPercent: 80 });
    // Two readings that came apart, so there is something to give back.
    for (let run = 0; run < 2; run += 1) {
      controller.start();
      metronome.advanceSubdivisions(80);
    }
    expect(controller.settings.tempoPercent).toBe(60);

    // A run played as written, note by note, on the pulse.
    const session = controller.start();
    metronome.advanceSubdivisions(1);
    for (let guard = 0; guard < 100 && session?.status === 'running'; guard += 1) {
      for (const note of session?.currentStep?.expectedMidi ?? []) {
        midi.noteOn(note, clock.now());
      }
      // One tick is one beat here, and one beat is one step: four would
      // walk past three of them and call them missed.
      metronome.advanceSubdivisions(1);
    }

    // Five back, not the twenty it took: one clean reading at sixty does not
    // prove eighty. The eighty he asked for is the ceiling, not the target
    // of a single run.
    expect(controller.settings.tempoPercent).toBe(65);
  });

  it('takes some speed away when a reading comes apart', async () => {
    const { controller, metronome } = createController(true);
    controller.updateSettings({ modeId: FLOW_MODE_ID, easeTheTempo: true, countInBars: 0 });
    await controller.openScore(longExercise({ bars: 4, tempoBpm: 60 }));

    // Nothing played at all: the music goes past and every step is missed.
    controller.start();
    metronome.advanceSubdivisions(80);

    expect(controller.settings.tempoPercent).toBe(90);
  });

  it('stops taking it away at half the written tempo', async () => {
    const { controller, metronome } = createController(true);
    controller.updateSettings({ modeId: FLOW_MODE_ID, easeTheTempo: true, countInBars: 0 });
    await controller.openScore(longExercise({ bars: 4, tempoBpm: 60 }));

    for (let run = 0; run < 8; run += 1) {
      controller.start();
      metronome.advanceSubdivisions(80);
    }

    // Below half, a piece stops being the piece.
    expect(controller.settings.tempoPercent).toBe(50);
  });

  it('says nothing about the speed where the music waits for the reader', async () => {
    // There is no speed to be behind in Wait mode, so a reading that came
    // apart there is not evidence about the tempo. A long reading, and a
    // properly bad one - a wrong note on every step - so that nothing but
    // the mode is keeping the speed where it is.
    const { controller, midi } = createController(true);
    controller.updateSettings({ easeTheTempo: true });
    await controller.openScore(longExercise({ bars: 4, tempoBpm: 60 }));
    const session = controller.start();

    for (let guard = 0; guard < 12 && session?.status === 'running'; guard += 1) {
      const step = session?.currentStep;
      if (step === null || step === undefined) {
        break;
      }
      midi.noteOn((step.expectedMidi[0] ?? 60) + 1, 0);
      for (const note of step.expectedMidi) {
        midi.noteOn(note, 0);
      }
    }
    session?.abort();

    const report = controller.lastReport;
    expect((report?.totals.incorrect ?? 0) + (report?.totals.correct ?? 0)).toBeGreaterThanOrEqual(
      6,
    );
    expect(report?.totals.incorrect ?? 0).toBeGreaterThan(0);
    expect(controller.settings.tempoPercent).toBe(100);
  });

  it('is not moved by a run that barely started', async () => {
    // With "one wrong note ends the run" every failure is two notes long,
    // and two notes are not evidence about a tempo.
    const { controller, metronome } = createController(true);
    controller.updateSettings({ modeId: FLOW_MODE_ID, easeTheTempo: true, countInBars: 0 });
    await controller.openScore(longExercise({ bars: 4, tempoBpm: 60 }));

    const session = controller.start();
    metronome.advanceSubdivisions(2);
    session?.abort();

    expect(controller.settings.tempoPercent).toBe(100);
  });

  it('leaves the speed alone unless it was asked to', async () => {
    const { controller, metronome } = createController(true);
    controller.updateSettings({ modeId: FLOW_MODE_ID, countInBars: 0 });
    await controller.openScore(longExercise({ bars: 4, tempoBpm: 60 }));

    controller.start();
    metronome.advanceSubdivisions(80);

    expect(controller.settings.tempoPercent).toBe(100);
  });

  it('never hands back more speed than the plan is asking for', async () => {
    // The plan sets the speed for each of its steps, and the easing must not
    // climb out of it: what the plan asked for is what the reader asked for.
    const { controller, midi, metronome, clock } = createController(true);
    controller.updateSettings({
      modeId: FLOW_MODE_ID,
      easeTheTempo: true,
      countInBars: 0,
      rhythmOnly: true,
    });
    await controller.openScore(longExercise({ bars: 8, tempoBpm: 60 }));
    controller.startTheDrill(4);
    expect(controller.settings.tempoPercent).toBe(70);

    // One reading that came apart, then one played through.
    controller.start();
    metronome.advanceSubdivisions(80);
    expect(controller.settings.tempoPercent).toBe(60);

    const session = controller.start();
    metronome.advanceSubdivisions(1);
    for (let guard = 0; guard < 100 && session?.status === 'running'; guard += 1) {
      for (const note of session?.currentStep?.expectedMidi ?? []) {
        midi.noteOn(note, clock.now());
      }
      metronome.advanceSubdivisions(1);
    }

    // The plan moved on and set its own speed for the next step; the easing
    // did not carry sixty-five into it.
    expect(controller.settings.tempoPercent).toBe(70);
  });

  it('says a session was discarded only where nothing takes its place', async () => {
    // The announcement is how the page knows to stop offering a run what it
    // offers a run, so it has to arrive every time that is true - and only
    // then. Starting is not one of those times: the last run is being
    // replaced rather than let go of, and saying so put a repaint of the idle
    // transport in front of the downbeat.
    const { controller } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    const discarded = vi.fn();
    controller.events.on('sessionDiscarded', discarded);

    controller.start();
    // Stopping keeps the session: the report of the run stays to be read.
    controller.stop();
    expect(discarded).not.toHaveBeenCalled();

    // And the next run takes the last one's place rather than discarding it.
    controller.start();
    expect(discarded).not.toHaveBeenCalled();

    // A playback does take the session away, with nothing following it.
    controller.listen();
    expect(discarded).toHaveBeenCalledTimes(1);
  });

  it('counts a playback in when it is asked to, and not otherwise', async () => {
    // His line 84: a performance that begins on the first tick can be
    // listened to, but it cannot be played along with.
    const { controller, metronome, instrument } = createController(true);
    controller.updateSettings({ countInBars: 1, countInPlayback: 'never' });
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));

    controller.listen();
    metronome.advanceSubdivisions(1);
    expect(instrument.played.length).toBeGreaterThan(0);

    controller.stopListening();
    instrument.played.length = 0;
    controller.updateSettings({ countInPlayback: 'once' });

    controller.listen();
    metronome.advanceSubdivisions(4);

    // A bar of counting, and no music in it.
    expect(instrument.played).toEqual([]);
    metronome.advanceSubdivisions(1);
    expect(instrument.played.length).toBeGreaterThan(0);
  });

  it('does not go round inside the player when every lap is counted in', async () => {
    // A count-in between laps is a break by definition, and the player's
    // repeat exists precisely to leave no gap. So the page starts each lap.
    const { controller } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));

    controller.updateSettings({ countInBars: 1, repeatRange: true, countInPlayback: 'every' });
    expect(controller.countsInEveryLap).toBe(true);

    controller.updateSettings({ countInPlayback: 'once' });
    expect(controller.countsInEveryLap).toBe(false);

    // And nought bars is no count-in, whatever the answer says.
    controller.updateSettings({ countInBars: 0, countInPlayback: 'every' });
    expect(controller.countsInEveryLap).toBe(false);
  });

  it('sets the passage, the hand and the speed the drill asks for', async () => {
    // His line 93. Nothing here is new machinery - a section is the passage
    // this trainer has always had - so what it does is set the same settings
    // a reader would have set by hand.
    const { controller } = createController(true);
    await controller.openScore(longExercise({ bars: 8 }));

    const task = controller.startTheDrill(4);

    expect(task).toEqual({
      fromBar: 1,
      toBar: 4,
      hand: null,
      tempoPercent: 70,
      stage: 'section',
    });
    expect(controller.settings.rangeFromBar).toBe(1);
    expect(controller.settings.rangeToBar).toBe(4);
    expect(controller.settings.tempoPercent).toBe(70);
  });

  it('asks again for a passage that was not finished', async () => {
    // "Until it is learned perfectly": a run that fell apart is the same
    // bars again, not the next ones.
    const { controller } = createController(true);
    await controller.openScore(longExercise({ bars: 8 }));
    controller.startTheDrill(4);

    controller.start()?.abort();

    expect(controller.drillProgress.at).toBe(0);
    expect(controller.drillTask?.toBar).toBe(4);
  });

  it('moves on when the passage was played through', async () => {
    const { controller, midi } = createController(true);
    await controller.openScore(longExercise({ bars: 8 }));
    controller.startTheDrill(4);
    const said: (number | null)[] = [];
    controller.events.on('drillChanged', ({ task }) => said.push(task?.fromBar ?? null));

    playItThrough(controller, midi);

    expect(controller.drillProgress.at).toBe(1);
    expect(said).toEqual([5]);
    // And the settings followed it: the next section is what is in front of
    // the reader now.
    expect(controller.settings.rangeFromBar).toBe(5);
    expect(controller.settings.rangeToBar).toBe(8);
  });

  it('says when the whole plan has been played', async () => {
    const { controller, midi } = createController(true);
    await controller.openScore(longExercise({ bars: 4 }));
    controller.startTheDrill(4);
    const of = controller.drillProgress.of;
    expect(of).toBe(1);
    let finished = false;
    controller.events.on('drillChanged', ({ task, at }) => {
      finished = task === null && at === of;
    });

    playItThrough(controller, midi);

    expect(finished).toBe(true);
    expect(controller.drillTask).toBeNull();
  });

  it('is put away without disturbing what it set', async () => {
    const { controller } = createController(true);
    await controller.openScore(longExercise({ bars: 8 }));
    controller.startTheDrill(4);

    controller.stopTheDrill();

    expect(controller.drillTask).toBeNull();
    // The passage stays where the drill left it: taking the plan away is not
    // a reason to move the reader somewhere they did not ask to be.
    expect(controller.settings.rangeToBar).toBe(4);
  });

  it('ends the run at the first wrong note, when asked to', async () => {
    // His line 112: counting a rhythm is worth nothing if a slip can be
    // played over. And it does not start again by itself - a run nobody
    // decided to make is not a reading.
    const { controller, midi, renderer } = createController(true);
    controller.updateSettings({ stopAtAMistake: true });
    await controller.loadNewExercise();
    const session = controller.start();
    const wrong = (session?.currentStep?.expectedMidi[0] ?? 60) + 1;

    midi.noteOn(wrong, 0);

    expect(session?.status).toBe('aborted');
    // And the note that ended it is on the page, not swallowed by the
    // stopping: a reader has to be able to see what they hit.
    expect(renderer.played.map((mark) => mark.midi)).toEqual([wrong]);
  });

  it('plays on through a slip while nobody asked for that', async () => {
    const { controller, midi } = createController(true);
    await controller.loadNewExercise();
    const session = controller.start();
    const wrong = (session?.currentStep?.expectedMidi[0] ?? 60) + 1;

    midi.noteOn(wrong, 0);

    expect(session?.status).toBe('running');
  });

  it('lends a wrong mark to the page for as long as the key is down', async () => {
    // His line 48: hunting for an accidental leaves a wrong note behind on
    // every try, and by the tenth the note being hunted for is underneath
    // them. So a wrong one lasts as long as the key does.
    const { controller, renderer, midi } = createController(true);
    controller.updateSettings({ playedNotes: 'while-held' });
    await controller.loadNewExercise();
    const session = controller.start();
    const expected = session?.currentStep?.expectedMidi[0] ?? 60;
    const wrong = expected + 1;

    midi.noteOn(wrong, 0);
    expect(renderer.played).toEqual([{ stepIndex: 0, midi: wrong, correct: false, offset: 0, settled: false }]);

    midi.noteOff(wrong, 100);
    expect(renderer.played).toEqual([]);
  });

  it('keeps a right note on the page when its key comes up', async () => {
    // Only the red is lent. What was played correctly is the reading itself,
    // and a page that emptied as the fingers left it would show nothing at
    // all by the end of a bar.
    const { controller, renderer, midi } = createController(true);
    controller.updateSettings({ playedNotes: 'while-held' });
    await controller.loadNewExercise();
    const session = controller.start();
    const expected = session?.currentStep?.expectedMidi[0] ?? 60;

    midi.noteOn(expected, 0);
    midi.noteOff(expected, 100);

    expect(renderer.played.map((mark) => mark.midi)).toEqual([expected]);
  });

  it('gives every wrong mark back when the run ends', async () => {
    // The other half of his line 48: at the end they are worth reading, and
    // that is exactly when a reader asks where they kept going wrong.
    const { controller, renderer, midi } = createController(true);
    controller.updateSettings({ playedNotes: 'while-held' });
    await controller.loadNewExercise();
    const session = controller.start();
    const wrong = (session?.currentStep?.expectedMidi[0] ?? 60) + 1;

    midi.noteOn(wrong, 0);
    midi.noteOff(wrong, 100);
    expect(renderer.played).toEqual([]);

    session?.abort();

    expect(renderer.played).toEqual([{ stepIndex: 0, midi: wrong, correct: false, offset: 0, settled: false }]);
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
      { stepIndex: 0, midi: wrong, correct: false, offset: 0.7, settled: false },
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

    expect(renderer.played).toEqual([
      // Pale, the rest of the chord not having been found yet.
      { stepIndex: 0, midi: expected, correct: true, offset: 0, settled: false },
    ]);
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

describe('hearing the hand you are not reading', () => {
  /** The pitches the trainer sounded of its own accord, in the order asked for. */
  function sounded(instrument: RecordingPitchPlayer): number[] {
    return instrument.played.map((note) => note.midi);
  }

  /** Reading the treble against a bass that holds a whole note under it. */
  async function readingTheTreble(): Promise<ReturnType<typeof createController>> {
    const rig = createController(true);
    await rig.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    rig.controller.updateSettings({ handStaff: 1, hearTheOtherHand: true });
    return rig;
  }

  it('leaves a frame that keeps time out of the waiting frame\u2019s machinery', async () => {
    // His, of the work on the waiting frame's picture: "Треба зробити це
    // separate щоб якщо ми фіксимо wait for notes режим - то це не пошкодить
    // іншим режимам". It already is, and this is the seam that makes it so: a
    // frame with a pulse never reaches the placing of clicks at all, so nothing
    // there is owed from the entry before it, nothing is taken back for being
    // overtaken, and no waiting is written down outright. The section a gated
    // bar draws still comes from the pair of beats its gate leaves, which is
    // where it came from before any of this.
    const { controller, midi, metronome, clock } = await readingTheTreble();
    controller.updateSettings({ modeId: BAR_MODE_ID, countInBars: 0 });
    const session = controller.start();
    metronome.advanceSubdivisions(1);
    midi.noteOn(MIDI.C4, clock.now());
    // To the bar line, and then seven tenths of a second of not giving it.
    metronome.advanceToTicks(4 * Duration.QUARTER.ticks);
    clock.advance(700);
    midi.noteOn(MIDI.G4, clock.now());

    const played = session?.roll ?? emptyRoll();
    expect(played.rushes).toEqual([]);
    // And the gate's own pair is still there, still saying how long it waited.
    expect(theWaits(played).length).toBeGreaterThan(0);
  });

  it('holds the other hand at a bar line until the reader gives the beat', async () => {
    // His: "ліва рука на старті бару грається одразу не чекаючи на мене".
    // Under a pulse the step is entered when the beat falls, so the
    // accompaniment sounds with it - but where a mode gates at bar lines the
    // step is entered *at* the line and the bar then waits there. Sounding
    // then is answering a note nobody has struck.
    const { controller, instrument, midi, metronome, clock } = await readingTheTreble();
    controller.updateSettings({ modeId: BAR_MODE_ID, countInBars: 0 });
    controller.start();
    // Through the gate at the first note, so the run is properly going.
    metronome.advanceSubdivisions(1);
    midi.noteOn(MIDI.C4, clock.now());
    const beforeTheLine = sounded(instrument).length;

    // To the bar line, where the next bar's step is entered and waits.
    metronome.advanceToTicks(4 * Duration.QUARTER.ticks);

    expect(sounded(instrument)).toHaveLength(beforeTheLine);

    // Given its beat, the bar begins and the other hand comes in with it.
    midi.noteOn(MIDI.G4, clock.now());

    expect(sounded(instrument).length).toBeGreaterThan(beforeTheLine);
  });

  it('plays the piece instead of beginning a run, in the listening frame', async () => {
    // His: Start replaces playback. There is no run to begin where the
    // machine does the playing, so the one button reaches for the
    // performance that has always existed.
    const { controller } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ modeId: LISTEN_MODE_ID });

    const session = controller.start();

    // No session at all, and a performance under way instead.
    expect(session).toBeNull();
    expect(controller.session).toBeNull();
    expect(controller.isListening).toBe(true);
  });

  it('is still the frame the reader left the app in', async () => {
    // It is not in the mode registry - nothing about it is a practice mode -
    // so the restoring code had to be told, or a reader who shut the app
    // watching the machine play came back to a run waiting for them.
    const { controller } = createController(true, undefined, { modeId: LISTEN_MODE_ID });

    expect(controller.settings.modeId).toBe(LISTEN_MODE_ID);
    expect(controller.machinePlays).toBe(true);
  });

  it('waits for the reader before answering them', async () => {
    // Nothing keeps time in this mode but the reader, so an accompaniment
    // that had already gone would be answering a note nobody had struck.
    const { controller, instrument } = await readingTheTreble();

    controller.start();

    expect(instrument.played).toEqual([]);
  });

  it('sounds the other hand as the reader reaches each step', async () => {
    // Practising one hand against silence is practising something the piece
    // never asks for: the part only means what it means against the other.
    const { controller, midi, instrument, clock } = await readingTheTreble();
    const first = controller.currentTimeline?.at(0);
    const left = (first?.notes ?? []).filter((note) => note.staffNumber === 2).map((n) => n.midi);
    const right = (first?.notes ?? []).filter((note) => note.staffNumber === 1).map((n) => n.midi);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    controller.start();

    for (const midiNote of right) {
      midi.noteOn(midiNote, clock.now());
    }

    // The hand being read is the reader's to play; the other one answers.
    for (const midiNote of left) {
      expect(sounded(instrument)).toContain(midiNote);
    }
    for (const midiNote of right) {
      expect(sounded(instrument)).not.toContain(midiNote);
    }
  });

  it('goes on in time while the reader holds out the beat', async () => {
    // His correction, and the whole point: in this mode the music must go on
    // *in rhythm* while he holds a long note out to his next entry. The mode
    // reaches every step he owes nothing on the instant it can, so played as
    // they were reached the whole phrase between two entries arrived as one
    // cluster with no rhythm in it.
    const { controller, midi, instrument, clock } = await readingTheTreble();
    // Reading the bass instead: it holds a whole note under a treble that
    // plays four quarters, so three of those quarters are his to wait through.
    controller.updateSettings({ handStaff: 2 });
    controller.start();
    clock.set(5_000);

    midi.noteOn(p('C3').midi, clock.now());

    // A quarter apart at sixty beats, counted from the moment he played -
    // not from when the run began, and not all at once.
    expect(instrument.played.map((note) => note.atMs)).toEqual([5_000, 6_000, 7_000, 8_000]);
  });

  it('counts from the key going down, not from hearing about it', async () => {
    // Over the bridge those are a hop apart, and the whole phrase after a
    // press came out that much late - which is what a reader feels as lag.
    const { controller, midi, instrument, clock } = await readingTheTreble();
    controller.updateSettings({ handStaff: 2 });
    controller.start();
    clock.set(5_000);

    // The key went down 80 ms ago; the page is only hearing about it now.
    midi.noteOn(p('C3').midi, 4_920);

    expect(instrument.played.map((note) => note.atMs)).toEqual([4_920, 5_920, 6_920, 7_920]);
  });

  it('holds each note for as long as it is written', async () => {
    const { controller, midi, instrument, clock } = await readingTheTreble();
    controller.start();

    midi.noteOn(p('C4').midi, clock.now());

    // As long as it is written and no longer: the stop is asked for at the
    // moment the note ends rather than left to the next step to cut it off.
    // At sixty beats a quarter is a second, and this bass note is a whole.
    const note = (controller.currentTimeline?.at(0)?.notes ?? []).find(
      (each) => each.staffNumber === 2,
    );
    const beats = (note?.durationTicks ?? 0) / Duration.QUARTER.ticks;
    expect(beats).toBeGreaterThan(0);
    const [held] = instrument.stopped;
    expect(held?.atMs).toBeCloseTo(beats * 1000, 5);
  });

  it('says nothing while both hands are being read', async () => {
    // There is no other hand then, and sounding one would be the trainer
    // playing the piece at the reader.
    const { controller, midi, instrument, clock } = await readingTheTreble();
    controller.updateSettings({ handStaff: null });
    controller.start();

    midi.noteOn(p('C4').midi, clock.now());

    expect(instrument.played).toEqual([]);
  });

  it('is silent until it is asked for', async () => {
    const { controller, midi, instrument, clock } = await readingTheTreble();
    controller.updateSettings({ hearTheOtherHand: false });
    controller.start();

    midi.noteOn(p('C4').midi, clock.now());

    expect(instrument.played).toEqual([]);
  });

  it('holds a press that went past the hand it is played against', async () => {
    // His: late is allowed, early is not. The accompaniment is laid a written
    // second after the reader's last press, and a note struck at once has
    // gone by it - so it is marked, though it is the note that was asked for.
    const { controller, midi, renderer, clock } = await readingTheTreble();
    controller.start();

    midi.noteOn(p('C4').midi, clock.now());
    midi.noteOn(p('D4').midi, clock.now());

    expect(renderer.played.map((mark) => mark.midi)).toEqual([p('C4').midi, p('D4').midi]);
    expect(renderer.played.map((mark) => mark.correct)).toEqual([true, false]);
  });

  it('holds nothing where no other hand is sounding', async () => {
    // With the accompaniment silent there is nothing to be early against, and
    // a waiting mode's whole promise is that it does not mind how long the
    // reader takes. The setting stays on; it simply has nothing to say.
    const { controller, midi, renderer, clock } = await readingTheTreble();
    controller.updateSettings({ hearTheOtherHand: false });
    controller.start();

    midi.noteOn(p('C4').midi, clock.now());
    midi.noteOn(p('D4').midi, clock.now());

    expect(renderer.played.map((mark) => mark.correct)).toEqual([true, true]);
  });

  it('leaves it alone where the reader did not ask to be held to it', async () => {
    const { controller, midi, renderer, clock } = await readingTheTreble();
    controller.updateSettings({ rushingCounts: false });
    controller.start();

    midi.noteOn(p('C4').midi, clock.now());
    midi.noteOn(p('D4').midi, clock.now());

    expect(renderer.played.map((mark) => mark.correct)).toEqual([true, true]);
  });

  it('takes back what it was holding, and what was still to come', async () => {
    // The accompaniment is laid out ahead of the reader as far as their next
    // entry, so a run stopped in the middle of that would play on alone.
    const { controller, midi, instrument, clock } = await readingTheTreble();
    controller.start();
    midi.noteOn(p('C4').midi, clock.now());
    const scheduled = instrument.stopped.length;
    expect(scheduled).toBeGreaterThan(0);

    controller.stop();

    expect(instrument.stopped.length).toBeGreaterThan(scheduled);
    expect(instrument.stopped.some((note) => note.atMs === undefined)).toBe(true);
  });
});

describe('being reminded to rest', () => {
  /**
   * Plays a note a minute until that many minutes have gone by.
   *
   * A minute apart because the timer counts the gaps between notes: anything
   * shorter than a break is time at the keyboard, so a note a minute counts
   * the minutes exactly and costs the suite a few dozen events instead of a
   * few thousand.
   */
  function playFor(rig: ReturnType<typeof createController>, minutes: number): void {
    for (let at = 0; at <= minutes * 60_000; at += 60_000) {
      rig.midi.noteOn(60, at);
    }
  }

  it('says nothing until the reader has been at it long enough', async () => {
    const rig = createController(true, undefined, { restEveryMinutes: 30 });
    await rig.controller.loadNewExercise();
    let said = 0;
    rig.controller.events.on('restDue', () => {
      said += 1;
    });

    playFor(rig, 20);

    expect(said).toBe(0);
    expect(rig.controller.sittingMs).toBe(20 * 60_000);
  });

  it('says so once the time is up and nothing is playing', async () => {
    const rig = createController(true, undefined, { restEveryMinutes: 30 });
    await rig.controller.loadNewExercise();
    const said: number[] = [];
    rig.controller.events.on('restDue', ({ sittingMs }) => {
      said.push(sittingMs);
    });

    playFor(rig, 31);

    // Once, and not once for every note played after it fell due.
    expect(said).toHaveLength(1);
    expect(said[0]).toBeGreaterThanOrEqual(30 * 60_000);
  });

  it('waits for the run to end rather than interrupting it', async () => {
    // His own note about this says the important half: never in the middle of
    // playing. A reminder that interrupts a run is one to be resented and
    // then turned off for good.
    const rig = createController(true, undefined, { restEveryMinutes: 30 });
    await rig.controller.loadNewExercise();
    let said = 0;
    rig.controller.events.on('restDue', () => {
      said += 1;
    });
    rig.controller.start();

    playFor(rig, 31);
    expect(said).toBe(0);

    rig.controller.stop();

    expect(said).toBe(1);
  });

  it('starts the clock again when the rest is taken', async () => {
    const rig = createController(true, undefined, { restEveryMinutes: 30 });
    await rig.controller.loadNewExercise();
    playFor(rig, 31);

    rig.controller.restTaken();

    expect(rig.controller.sittingMs).toBe(0);
  });

  it('lets the music go round again once the rest has been put off', async () => {
    // Reported from the tablet: the repeat button stopped working after a
    // break was offered and declined. A rest still owed holds back the things
    // that start something new - a passage going round again is one - and
    // "later" left the debt standing, so it held it back for the rest of the
    // session.
    const rig = createController(true, undefined, { restEveryMinutes: 30 });
    await rig.controller.loadNewExercise();
    playFor(rig, 31);
    expect(rig.controller.restIsOwed).toBe(true);

    rig.controller.restPutOff();

    expect(rig.controller.restIsOwed).toBe(false);
  });

  it('asks again a few minutes after being put off', async () => {
    // The other half of the same line. Left said and owed, the reminder was
    // spent by the first refusal and never came back at all.
    const rig = createController(true, undefined, { restEveryMinutes: 30 });
    await rig.controller.loadNewExercise();
    const said: number[] = [];
    rig.controller.events.on('restDue', ({ sittingMs }) => {
      said.push(sittingMs);
    });
    playFor(rig, 31);
    expect(said).toHaveLength(1);

    rig.controller.restPutOff();
    // Not at once, and not never.
    rig.midi.noteOn(60, 32 * 60_000);
    expect(said).toHaveLength(1);

    playFor(rig, 36);

    expect(said).toHaveLength(2);
    expect(said[1]).toBeGreaterThan(said[0] ?? 0);
  });

  it('waits exactly as long as the reader asked it to', async () => {
    // Three snooze buttons, and the number on the button is the answer: two
    // minutes has to mean two, or the buttons are decoration.
    const rig = createController(true, undefined, { restEveryMinutes: 30 });
    await rig.controller.loadNewExercise();
    const said: number[] = [];
    rig.controller.events.on('restDue', ({ sittingMs }) => {
      said.push(sittingMs);
    });
    playFor(rig, 31);

    rig.controller.restPutOff(60_000);
    // Half a minute on, and it holds its tongue.
    rig.midi.noteOn(60, 31.5 * 60_000);
    expect(said).toHaveLength(1);

    // A minute and a half on, and the minute they asked for has passed.
    rig.midi.noteOn(60, 32.5 * 60_000);

    expect(said).toHaveLength(2);
  });

  it('waits a whole interval again when the rest is skipped', async () => {
    // The other answer, and the difference is the reader's to say: skipping
    // passes this one over rather than putting it off a few minutes. The
    // clock still keeps what it has - they have been sitting half an hour,
    // and skipping does not undo that - so a skip buys the interval, not the
    // half hour.
    const rig = createController(true, undefined, { restEveryMinutes: 30 });
    await rig.controller.loadNewExercise();
    const said: number[] = [];
    rig.controller.events.on('restDue', ({ sittingMs }) => {
      said.push(sittingMs);
    });
    playFor(rig, 31);

    rig.controller.restSkipped();
    // Twenty more minutes of playing, and still nothing: a skip is worth a
    // whole interval, not a few minutes.
    for (let at = 32; at <= 50; at += 1) {
      rig.midi.noteOn(60, at * 60_000);
    }
    expect(said).toHaveLength(1);
    expect(rig.controller.sittingMs).toBeGreaterThanOrEqual(50 * 60_000);

    for (let at = 51; at <= 62; at += 1) {
      rig.midi.noteOn(60, at * 60_000);
    }

    expect(said).toHaveLength(2);
  });

  it('keeps what it has when the rest is put off', async () => {
    // They have still been playing for half an hour. The next quiet moment
    // should say so again rather than start the half hour over.
    const rig = createController(true, undefined, { restEveryMinutes: 30 });
    await rig.controller.loadNewExercise();
    playFor(rig, 31);

    rig.controller.restPutOff();

    expect(rig.controller.sittingMs).toBeGreaterThanOrEqual(30 * 60_000);
  });

  it('says nothing at all when the reader has turned it off', async () => {
    const rig = createController(true, undefined, { restEveryMinutes: 0 });
    await rig.controller.loadNewExercise();
    let said = 0;
    rig.controller.events.on('restDue', () => {
      said += 1;
    });

    playFor(rig, 60);

    expect(said).toBe(0);
  });
});

describe('ruling the bars', () => {
  it('makes room in the page it prints, and keeps it out of the music', async () => {
    // The engraver is given a score with rests nobody sees in it, so the
    // beats of a bar stand at even distances. What the trainer *announces* -
    // and so what the library keeps and what anything else reads - is the
    // music, without a word of that scaffolding in it.
    const { controller, renderer } = createController();
    const announced: string[] = [];
    controller.events.on('exerciseLoaded', ({ musicXml }) => announced.push(musicXml));

    await controller.openScore(twoBarExercise());
    expect(renderer.loadedXml).not.toContain('print-object="no"');

    controller.updateSettings({ rhythmRuler: 'quarter' });
    await controller.reloadExercise();

    expect(renderer.loadedXml).toContain('print-object="no"');
    expect(announced[announced.length - 1]).not.toContain('print-object');
  });

  it('gives the cheap page back when it is turned off again', async () => {
    // The spacers are the expensive half of this feature: on his City of
    // Tears there are 1032 of them, and they cost about 150 kB of MusicXML
    // and two seconds of engraving. Nothing on the page says whether they are
    // there, so a refactor that made them unconditional would take those two
    // seconds on every score and look exactly the same - which is the kind of
    // fault that lives for months.
    //
    // The way back is the half that is easy to break: the printing is only
    // redone when the file it would write has changed, so a ruler that stayed
    // in the printed score after being turned off would go on being paid for
    // while drawing nothing at all.
    const { controller, renderer } = createController();

    await controller.openScore(twoBarExercise());
    expect(renderer.loadedXml).not.toContain('print-object="no"');
    // And the drawing is asked for nothing either, rather than being handed
    // marks it would have to decide to ignore.
    expect(renderer.ruler).toEqual([]);

    controller.updateSettings({ rhythmRuler: 'quarter' });
    await controller.reloadExercise();
    expect(renderer.loadedXml).toContain('print-object="no"');
    expect(renderer.ruler.length).toBeGreaterThan(0);

    controller.updateSettings({ rhythmRuler: 'off' });
    await controller.reloadExercise();
    expect(renderer.loadedXml).not.toContain('print-object="no"');
    expect(renderer.ruler).toEqual([]);
  });

  it('changes the hand a playback is sounding, without stopping it', async () => {
    // His line 76, reported from the page: the hand was read once when the
    // performance started, so a reader listening to both hands who asked for
    // one of them went on hearing both until they stopped the music - which
    // is the one thing they were trying not to do.
    const { controller, metronome, instrument } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    // The left hand's own notes, read off the fixture rather than typed out.
    const bass = new Set(
      twoBarExercise({ tempoBpm: 60 })
        .staves.filter((staff) => staff.staffNumber === 2)
        .flatMap((staff) => staff.measures)
        .flatMap((measure) => measure.entries)
        .flatMap((entry) => (entry.kind === 'note' ? entry.pitches : []))
        .map((pitch) => pitch.midi),
    );

    controller.listen();
    metronome.advanceSubdivisions(1);
    const heardBoth = instrument.played.length;
    expect(instrument.played.some((note) => bass.has(note.midi))).toBe(true);

    controller.updateSettings({ handStaff: 1 });
    metronome.advanceSubdivisions(6);

    const after = instrument.played.slice(heardBoth);
    expect(after.length).toBeGreaterThan(0);
    expect(after.some((note) => bass.has(note.midi))).toBe(false);
  });

  it('says which beats are about to pass, and when', async () => {
    // The marker on the notes stands still under a held note while the beats
    // go on passing, and that gap is where a reader loses count. Nothing in a
    // waiting mode can say those beats one at a time - the run reaches them
    // all at once - so they are promised ahead, with the moment each falls.
    const { controller, midi, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({
      handStaff: 2,
      rhythmRuler: 'quarter',
      rulerCursor: true,
    });
    const promised: { atMs: number; weight: string }[] = [];
    controller.events.on('beatsAhead', ({ beats }) => {
      for (const beat of beats) {
        promised.push({ atMs: beat.atMs, weight: beat.mark.weight });
      }
    });
    controller.start();
    clock.set(5_000);

    midi.noteOn(p('C3').midi, clock.now());

    // The beat he played, now; then the three he will wait through, a quarter
    // apart at sixty beats.
    expect(promised).toEqual([
      { atMs: 5_000, weight: 'downbeat' },
      { atMs: 6_000, weight: 'beat' },
      { atMs: 7_000, weight: 'beat' },
      { atMs: 8_000, weight: 'beat' },
    ]);
  });

  it('runs on the grid the ruler is drawn in, not the click', async () => {
    // Reported from the page: a line was drawn at the end of the first bar of
    // Inside a House and the marker never stood on it. It was running on the
    // metronome grid: ruled in eighths with the click on the beat, it
    // skipped every line the click had no opinion about, which is most of
    // them. Two questions, answered separately by the reader.
    const { controller, midi, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({
      handStaff: 2,
      rhythmRuler: 'eighth',
      clickPattern: 'pulse',
      rulerCursor: true,
    });
    const promised: number[] = [];
    controller.events.on('beatsAhead', ({ beats }) => {
      for (const beat of beats) {
        promised.push(beat.atMs);
      }
    });
    controller.start();
    clock.set(5_000);

    midi.noteOn(p('C3').midi, clock.now());

    // Eighths at sixty beats are half a second apart, from the line he is on
    // up to the one he comes in on - which stays his.
    expect(promised).toEqual([5_000, 5_500, 6_000, 6_500, 7_000, 7_500, 8_000, 8_500]);
  });

  it('runs the marker along it while the machine plays too', async () => {
    // Reported from the page: nothing moved along the ruler during a
    // playback. A performance goes past the session entirely, and only the
    // session was saying where the beats were.
    const { controller, metronome, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ rhythmRuler: 'quarter', rulerCursor: true });
    const promised: number[] = [];
    controller.events.on('beatsAhead', ({ beats }) => {
      for (const beat of beats) {
        promised.push(beat.mark.ticks);
      }
    });

    controller.listen();
    metronome.advanceSubdivisions(4);
    void clock;

    // The quarters of the first bar, in order, as the performance reaches
    // them - not one lump at the start and not nothing at all.
    expect(promised.length).toBeGreaterThanOrEqual(4);
    expect(promised.slice(0, 4)).toEqual([
      0,
      Duration.QUARTER.ticks,
      Duration.HALF.ticks,
      Duration.HALF.ticks + Duration.QUARTER.ticks,
    ]);
  });

  it('says nothing about beats while the reader has not asked for them', async () => {
    const { controller, midi, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ handStaff: 2, rhythmRuler: 'quarter' });
    let said = 0;
    controller.events.on('beatsAhead', () => {
      said += 1;
    });
    controller.start();

    midi.noteOn(p('C3').midi, clock.now());

    expect(said).toBe(0);
  });

  it('is the same piece, so the reader keeps their place in it', async () => {
    // Ruling the bars re-engraves the page, and a re-engraving is not new
    // music: the marker stays where it was put.
    const { controller, renderer } = createController();
    await controller.openScore(longExercise({ bars: 8 }));
    const at = controller.beginAtBar(5);
    expect(at).toBeGreaterThan(0);

    controller.updateSettings({ rhythmRuler: 'eighth' });
    await controller.reloadExercise();

    expect(controller.beginsAt).toBe(at);
    expect(renderer.cursor.position).toBe(at);
  });
});

describe('the click in a mode that waits', () => {
  it('sounds the beat the reader plays, and the ones they will not', async () => {
    // His words: the metronome sounds when he presses the keys, and where it
    // is the other hand’s turn while he rests or holds, it goes on in
    // rhythm without waiting for him.
    const { controller, midi, metronome, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    // Reading the bass, which holds a whole note under four treble quarters:
    // three of those beats are his to wait through.
    controller.updateSettings({ handStaff: 2, clickWhen: 'with-me' });
    controller.start();
    clock.set(5_000);

    midi.noteOn(p('C3').midi, clock.now());

    expect(metronome.clicks).toEqual([
      { atMs: 5_000, weight: 'downbeat' },
      { atMs: 6_000, weight: 'beat' },
      { atMs: 7_000, weight: 'beat' },
      { atMs: 8_000, weight: 'beat' },
    ]);
  });

  it('writes the beat the music had ready while it waited for him', async () => {
    // The grid of a waiting run is even, and the waiting goes into the picture
    // as a section rather than as a gap between two lines that should have been
    // a beat apart. Which needs the beat that fell due while the music stood
    // still: written, and never sounded - a click there would be the machine
    // telling him he is late, which is the opposite of a frame that waits.
    const { controller, midi, metronome, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ handStaff: 2, clickWhen: 'with-me' });
    const session = controller.start();
    clock.set(5_000);

    midi.noteOn(p('C3').midi, clock.now());
    // A written bar is four seconds here, so the second bar fell due at nine.
    // He takes it at ten.
    clock.set(10_000);
    midi.noteOn(p('G2').midi, clock.now());
    midi.noteOn(p('D3').midi, clock.now());

    const beats = session?.roll.beats ?? [];
    expect(beats.map((beat) => beat.atMs)).toEqual([
      // The beat the music began with, which he then took five seconds to reach.
      0,
      5_000,
      6_000,
      7_000,
      8_000,
      9_000,
      10_000,
      // And the bar he has just begun, laid out ahead of him from his own entry.
      11_000,
      12_000,
      13_000,
    ]);
    // The pair a bar line's gate leaves, at the same place in the music: where
    // it fell, and where he gave it. Which is what the section is drawn from.
    expect(beats.filter((beat) => beat.positionTicks === Duration.QUARTER.ticks * 4)).toHaveLength(
      2,
    );
    expect(metronome.clicks.map((click) => click.atMs)).not.toContain(9_000);
  });

  it('takes back the beats the reader came in ahead of', async () => {
    // Come in early and the music moves on from there, so the beats still
    // standing in the stretch he left were scheduled and never happened. Drawn,
    // they are lines at no distance from each other in a grid meant to be even.
    // His: "просто придеться скіпати одразу до наступної ноти яку я натиснув".
    const { controller, midi, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ handStaff: 2, clickWhen: 'with-me' });
    const session = controller.start();
    clock.set(5_000);

    midi.noteOn(p('C3').midi, clock.now());
    // The whole bar laid out ahead of him at five, six, seven and eight. He
    // comes in for the second bar at six and a half, which is two and a half
    // seconds before it was due.
    clock.set(6_500);
    midi.noteOn(p('G2').midi, clock.now());
    midi.noteOn(p('D3').midi, clock.now());

    const beats = session?.roll.beats ?? [];
    // Seven and eight are gone; his own, and the bar he has just begun, remain.
    expect(beats.map((beat) => beat.atMs)).toEqual([
      0,
      5_000,
      6_000,
      6_500,
      7_500,
      8_500,
      9_500,
    ]);
    // And the arrival itself, written on its own: the beat he overtook never
    // fell, so there is no second beat at that place to measure it against.
    expect(session?.roll.rushes).toEqual([{ atMs: 6_500, byMs: 2_500 }]);
  });

  it('writes down the chord the run was begun with', async () => {
    // The only presses of a run that never come through the ordinary door: the
    // run did not exist when they were played, so nothing recorded them, and
    // they were handed straight to the mode to be judged. Judged and invisible -
    // the chord he began with was missing from the picture of the run it began.
    // His: "є інша бага при стартових нотах: їх просто нема у MIDI viewer коли я
    // починаю гру".
    const { controller, midi, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ handStaff: 2, clickWhen: 'with-me', immediateStart: true });
    clock.set(5_000);

    midi.noteOn(p('C3').midi, clock.now());
    clock.set(5_200);
    midi.noteOff(p('C3').midi, clock.now());

    expect(controller.session?.status).toBe('running');
    const presses = controller.session?.roll.presses ?? [];
    expect(presses.map((press) => [press.midi, press.downAtMs, press.upAtMs])).toEqual([
      [p('C3').midi, 5_000, 5_200],
    ]);
    // And with the verdict it was given, because it is written before it is
    // judged - which is the order the ordinary door uses, and the reason the
    // verdict has a press to attach itself to.
    expect(presses[0]?.verdict).toBe('correct');
  });

  it('writes its beats down even where the reader hears none', async () => {
    // Two questions, and they had been asked as one: the beats of a waiting run
    // were written only where the reader had asked to hear them, so practising
    // without a click left the picture of the run with no grid and no sections
    // at all. His, on finding it himself: "я тестував без метроному, тому і
    // лінії не малюються у цьому випадку". The roll keeps the pulse rather than
    // the volume, and always said so.
    const { controller, midi, metronome, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ handStaff: 2, clickWhen: 'never' });
    const session = controller.start();
    clock.set(5_000);

    midi.noteOn(p('C3').midi, clock.now());
    // A written bar is four seconds here, so the second bar fell due at nine.
    clock.set(10_000);
    midi.noteOn(p('G2').midi, clock.now());
    midi.noteOn(p('D3').midi, clock.now());

    expect((session?.roll.beats ?? []).map((beat) => beat.atMs)).toEqual([
      0,
      5_000,
      6_000,
      7_000,
      8_000,
      9_000,
      10_000,
      11_000,
      12_000,
      13_000,
    ]);
    // The second bar fell due at nine and he took it at ten, and the picture
    // says so - with no click having sounded at any point.
    expect(theWaits(session?.roll ?? emptyRoll())).toEqual([
      // The five seconds he took to reach the first note at all,
      { fromMs: 0, untilMs: 5_000 },
      // and the second bar, which fell due at nine and which he took at ten.
      { fromMs: 9_000, untilMs: 10_000 },
    ]);
    expect(metronome.clicks).toEqual([]);
  });

  it('follows the music and not the pulse, where the two have parted', async () => {
    // A reader who asks for the click to go on whatever they do still has the
    // music waiting for them: the pulse is a thing to keep up with, not a record
    // of where the music reached. Written down as though it were, its ticks were
    // the machine's own grid laid over the reader's, and the two walked apart
    // without limit - measured on a run taken at a third of the written speed,
    // the notes asked for sat in the first four seconds of the picture and the
    // notes played ran to twelve.
    //
    // His: "краще взагалі не залежати від метроному, а залежати від flow самої
    // гри... він має дивитись як йшла музика, та розуміти де були паузи".
    const { controller, midi, metronome, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ handStaff: 2, clickWhen: 'always', countInBars: 0 });
    const session = controller.start();
    // Four seconds of pulse, and he plays nothing for any of them.
    for (let guard = 0; guard < 4; guard += 1) {
      metronome.advanceSubdivisions(1);
      clock.advance(1_000);
    }

    midi.noteOn(p('C3').midi, clock.now());

    // The music's own beats: where it began, where he took it, and the written
    // bar laid out from his entry. Nothing at one, two or three seconds, which
    // is where the pulse was counting while the music stood still.
    expect((session?.roll.beats ?? []).map((beat) => beat.atMs)).toEqual([
      0, 4_000, 5_000, 6_000, 7_000,
    ]);
    // And the four seconds it stood still for, which is the thing that frame
    // exists to show and which the pulse knows nothing about.
    expect(theWaits(session?.roll ?? emptyRoll())).toEqual([{ fromMs: 0, untilMs: 4_000 }]);
  });

  it('runs the pulse for a count-in even where nothing else wants one', async () => {
    // The count-in is the one reason a pulse ever runs for a while and then has
    // no further part to play, and it is the reason it is asked for separately
    // from whether the pulse has anything to do afterwards.
    const { controller, metronome } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ handStaff: 2, clickWhen: 'with-me', countInBars: 1 });

    controller.start();

    expect(metronome.isRunning).toBe(true);
  });

  it('lets go of the pulse once a count-in is over and nothing else wants it', async () => {
    // It was told to fall *silent* after the count and never told to stop, so it
    // went on counting the written bars to itself - unheard, and written into
    // the picture of the run all the same. Drawn, that was the machine's grid
    // laid over the reader's: two at once, their places disagreeing and their
    // moments interleaved.
    const { controller, midi, metronome, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ handStaff: 2, clickWhen: 'with-me', countInBars: 1 });
    const session = controller.start();
    // Four beats of counting, and the fifth tick is the music's first beat.
    for (let guard = 0; guard < 5; guard += 1) {
      metronome.advanceSubdivisions(1);
      clock.advance(1_000);
    }

    expect(metronome.isRunning).toBe(false);

    // And the pulse is asked for more anyway, as a running one would deliver.
    // Nothing of it reaches the run: the beats are the reader's, in order.
    for (let guard = 0; guard < 3; guard += 1) {
      metronome.advanceSubdivisions(1);
      clock.advance(1_000);
    }
    midi.noteOn(p('C3').midi, clock.now());
    for (let guard = 0; guard < 9; guard += 1) {
      metronome.advanceSubdivisions(1);
      clock.advance(1_000);
    }
    midi.noteOn(p('G2').midi, clock.now());
    midi.noteOn(p('D3').midi, clock.now());

    const beats = session?.roll.beats ?? [];
    expect(beats.length).toBeGreaterThan(4);
    const moments = beats.map((beat) => beat.atMs);
    expect([...moments].sort((left, right) => left - right)).toEqual(moments);
    const places = beats.map((beat) => beat.positionTicks);
    expect([...places].sort((left, right) => left - right)).toEqual(places);
  });

  it('sections every note that waited, however fine the beat it fell on', async () => {
    // A section was read off the beats worth *drawing*, and the divisions are
    // filtered out of those so that a grid clicking them is not a grey wash. But
    // a beat too fine to be given a line of its own is still a beat he came in
    // on, and the music stood still for it just the same. Clicking the divisions
    // of compound time, four of his six entries were the same distance late and
    // had nothing at all to show for it. His: "не може
    // бути щоб на кожну ноту я ідеально влучав прямо завжди".
    const { controller, midi, clock } = createController(true);
    await controller.openScore(compoundBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({
      handStaff: 1,
      clickWhen: 'with-me',
      countInBars: 0,
      clickPattern: 'division',
    });
    const session = controller.start();

    // Six eighths. A written eighth is half a second here, and he takes one and
    // three tenths over each - eight hundred milliseconds of standing still.
    let at = 0;
    for (let guard = 0; guard < 8 && session?.status === 'running'; guard += 1) {
      at += 1_300;
      clock.set(at);
      for (const note of session?.currentStep?.expectedMidi ?? []) {
        midi.noteOn(note, clock.now());
      }
    }

    const waited = theWaits(session?.roll ?? emptyRoll());
    expect(waited).toHaveLength(6);
    // The first is the wait before he came in at all; every one after it is a
    // note of the music standing still for the same three tenths of a second.
    expect(waited.slice(1).map((wait) => wait.untilMs - wait.fromMs)).toEqual([
      800, 800, 800, 800, 800,
    ]);
  });

  it('marks an entry taken early between the clicks, where no beat is drawn', async () => {
    // The fault the sections had, from the other side. An early arrival used to
    // ride on the beat the reader placed, and a beat placed between the clicks
    // they chose is a division - filtered out of the grid so that clicking the
    // divisions is not a rattle - so it had nothing to be drawn on and nothing
    // marked it at all. It is written on its own now, as the waiting it mirrors
    // is read off a pair of its own.
    const { controller, midi, clock } = createController(true);
    await controller.openScore(offBeatAfterALongNote({ tempoBpm: 60 }));
    controller.updateSettings({
      handStaff: 1,
      clickWhen: 'with-me',
      countInBars: 0,
      clickPattern: 'pulse',
    });
    const session = controller.start();

    clock.set(1_000);
    midi.noteOn(p('C4').midi, clock.now());
    // The written distance to the next entry is two beats and a half, so it fell
    // due at three and a half seconds. He takes it at two - a second and a half
    // early, and on the second half of a beat, where the click has nothing.
    clock.set(2_000);
    midi.noteOn(p('D4').midi, clock.now());

    expect(session?.roll.rushes).toEqual([{ atMs: 2_000, byMs: 1_500 }]);
  });

  it('writes the beats it places into the picture of the run', async () => {
    // A frame that waits runs no pulse, so nothing announces its beats - and the
    // drawing of such a run had no grid at all. His: "у wait for notes все ще не
    // малюється смужок у midi viewer діалозі". The beats are placed here; they
    // are as much that run's grid as a pulse's ticks are of another's.
    const { controller, midi, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ handStaff: 2, clickWhen: 'with-me' });
    const session = controller.start();
    clock.set(5_000);

    midi.noteOn(p('C3').midi, clock.now());

    const beats = session?.roll.beats ?? [];
    expect(beats.map((beat) => [beat.atMs, beat.weight])).toEqual([
      // The beat the music began with, and then the four he placed.
      [0, 'downbeat'],
      [5_000, 'downbeat'],
      [6_000, 'beat'],
      [7_000, 'beat'],
      [8_000, 'beat'],
    ]);
    // And each with its place in the music, which is what names the bars and
    // puts the notes that were asked for where they belong.
    expect(beats.map((beat) => beat.positionTicks)).toEqual([
      0,
      0,
      Duration.QUARTER.ticks,
      Duration.HALF.ticks,
      Duration.HALF.ticks + Duration.QUARTER.ticks,
    ]);
  });

  it('writes the first beat of the music down once, not twice', async () => {
    // A frame that waits runs a pulse for its count-in, and the tick that ends
    // the count *is* the first beat of the music. The reader's own entry then
    // placed it a second time, at the same instant: heard, the metronome clicked
    // twice; drawn, it was a bar line given nought milliseconds late, with an
    // empty band to show the waiting. His: "є якісь подвійні смужки які і два
    // рази грають метроном".
    const { controller, midi, clock, metronome } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({
      modeId: new WaitMode().id,
      clickWhen: 'with-me',
      countInBars: 1,
    });
    const session = controller.start();
    // Through the count, whose last tick is the music's first beat.
    metronome.advanceSubdivisions(5);
    metronome.clicks.length = 0;

    for (const note of session?.currentStep?.expectedMidi ?? []) {
      midi.noteOn(note, clock.now());
    }

    const first = (session?.roll.beats ?? []).filter((beat) => beat.positionTicks === 0);
    expect(first).toHaveLength(1);
    // And it is not clicked again either: the machine does not agree with itself.
    expect(metronome.clicks.filter((asked) => asked.atMs === clock.now())).toHaveLength(0);
  });

  it('leaves the pulse to count the reader in and no further', async () => {
    // Reported from the page: the metronome went on playing by itself, and
    // every beat he played came out clicked twice. A count-in is asked for by
    // its own setting, so the pulse was running for that - and then went on
    // clicking through music that was standing still waiting for him.
    const { controller, metronome } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ handStaff: 2, clickWhen: 'with-me', countInBars: 1 });

    controller.start();

    // Silent from the bar the music begins in, which is what the count-in's
    // own answer has always meant.
    expect(metronome.currentConfig.dropout).toEqual({ kind: 'silent-from', fromBar: 1 });
    expect(metronome.currentConfig.muted).toBe(false);
  });

  it('marks the divisions when the reader asked to hear them', async () => {
    // Reported from the page: the subdivisions he had turned on were ignored
    // by the click he places. They were never offered to it - only the felt
    // beats were - and a click he places is still the click he chose the
    // pattern for.
    const { controller, midi, metronome, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ handStaff: 2, clickWhen: 'with-me', clickPattern: 'division' });
    controller.start();
    clock.set(5_000);

    midi.noteOn(p('C3').midi, clock.now());

    // Eighths through a bar of four four: the beats where they were, and a
    // division between each pair of them.
    expect(metronome.clicks).toEqual([
      { atMs: 5_000, weight: 'downbeat' },
      { atMs: 5_500, weight: 'division' },
      { atMs: 6_000, weight: 'beat' },
      { atMs: 6_500, weight: 'division' },
      { atMs: 7_000, weight: 'beat' },
      { atMs: 7_500, weight: 'division' },
      { atMs: 8_000, weight: 'beat' },
      { atMs: 8_500, weight: 'division' },
    ]);
  });

  it('marks only the bar when that is all the reader asked for', async () => {
    const { controller, midi, metronome, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ handStaff: 2, clickWhen: 'with-me', clickPattern: 'downbeat' });
    controller.start();
    clock.set(5_000);

    midi.noteOn(p('C3').midi, clock.now());

    expect(metronome.clicks).toEqual([{ atMs: 5_000, weight: 'downbeat' }]);
  });

  it('stops at the beat the reader comes in on', async () => {
    // That one is his to place. Clicking it before he arrives would be the
    // machine playing his part for him.
    const { controller, midi, metronome, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ handStaff: 2, clickWhen: 'with-me' });
    controller.start();
    midi.noteOn(p('C3').midi, clock.now());

    // The next thing the bass owes is the downbeat of bar two, and no click
    // was laid out for it.
    expect(metronome.clicks.map((click) => click.atMs)).not.toContain(4_000);
  });

  it('says nothing while the reader asked for no click', async () => {
    const { controller, midi, metronome, clock } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));
    controller.updateSettings({ handStaff: 2, clickWhen: 'never' });
    controller.start();

    midi.noteOn(p('C3').midi, clock.now());

    expect(metronome.clicks).toEqual([]);
  });
});

describe('cursor visibility', () => {
  it('shows the cursor by default', async () => {
    const { controller, renderer } = createController();
    expect(controller.settings.cursorWhileRunning).toBe(true);

    await controller.loadNewExercise();

    expect(renderer.cursor.visible).toBe(true);
  });

  it('takes the marker away while the reader plays, and gives it back after', async () => {
    // What the No cursor square writes, and the whole of it: the place on
    // the page is the reader's to keep *while they are playing*. Between
    // runs the marker is where they are about to begin, which is not a
    // challenge - and the one the machine drags along while it plays to them
    // is not one either.
    const { controller, renderer } = createController(true);
    await controller.openScore(twoBarExercise({ tempoBpm: 60 }));

    controller.updateSettings({ cursorWhileRunning: false });

    // Nothing is running, so nothing has changed on the page yet.
    expect(renderer.cursor.visible).toBe(true);

    controller.start();

    expect(renderer.cursor.visible).toBe(false);

    controller.stop();

    expect(renderer.cursor.visible).toBe(true);
  });

  it('hides the cursor as soon as the setting is turned off', async () => {
    const { controller, renderer } = createController();
    await controller.loadNewExercise();

    controller.updateSettings({ cursorWhileRunning: false, cursorWhileListening: false, cursorAtRest: false });

    expect(renderer.cursor.visible).toBe(false);
  });

  it('keeps it hidden across a new exercise', async () => {
    const { controller, renderer } = createController();
    controller.updateSettings({ cursorWhileRunning: false, cursorWhileListening: false, cursorAtRest: false });

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
    controller.updateSettings({ cursorWhileRunning: false, cursorWhileListening: false, cursorAtRest: false });
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

  it('answers a playback with the answer given for playbacks', async () => {
    // His own case, said in his words: never while he plays, sometimes while
    // the machine plays it back.
    const { controller, renderer } = createController(true);
    controller.updateSettings({
      cursorWhileRunning: false,
      cursorWhileListening: true,
      cursorAtRest: false,
    });
    await controller.loadNewExercise();
    expect(renderer.cursor.visible).toBe(false);

    controller.listen();
    // Following along is most of the value of hearing it played.
    expect(renderer.cursor.visible).toBe(true);

    controller.stopListening();

    // A performance is not a decision about the rest of the page: it must not
    // undo the aid the reader turned off everywhere else.
    expect(renderer.cursor.visible).toBe(false);
  });

  it('marks what the reader plays along with a performance, where asked', async () => {
    // His: he plays along with the playback to check himself, and the page
    // said nothing either way - the only thing a performance could not tell
    // him. A mirror rather than a verdict: the marks are drawn and nothing is
    // counted, reported or held against him.
    const { controller, renderer, midi } = createController(true);
    controller.updateSettings({ markWhileListening: true });
    await controller.loadNewExercise();
    controller.listen();
    const wanted = controller.currentTimeline?.at(0)?.expectedMidi[0] ?? 60;

    midi.noteOn(wanted, 0);
    midi.noteOn(wanted + 1, 0);

    expect(renderer.played.map((note) => note.correct)).toEqual([true, false]);
  });

  it('lights the notes a performance is sounding, where asked', async () => {
    // A different question from marking what the reader plays: one says
    // "check yourself", this says "watch where the music is". The marker
    // already names the beat; this names which of its notes, which is the
    // part a dense texture hides.
    const { controller, renderer, metronome } = createController(true);
    controller.updateSettings({ showPlaybackNotes: true, countInBars: 0 });
    await controller.loadNewExercise();
    controller.listen();
    metronome.advanceSubdivisions(1);

    const lit = renderer.played.filter((note) => note.sounding === true);
    expect(lit.length).toBeGreaterThan(0);
    // Its own statement, not a verdict about anybody: nothing is being judged.
    expect(lit.every((note) => note.correct)).toBe(true);
  });

  it('moves the light on rather than leaving a trail behind it', async () => {
    // What has been played is already said by the veil, and a page that
    // filled up as the music went would be saying it twice.
    const { controller, renderer, metronome } = createController(true);
    controller.updateSettings({ showPlaybackNotes: true, countInBars: 0 });
    await controller.loadNewExercise();
    controller.listen();

    metronome.advanceSubdivisions(5);

    // Whatever is lit belongs to one beat: the beat being sounded. The ones
    // before it were put out as the music passed them.
    const lit = renderer.played.filter((note) => note.sounding === true);
    expect(lit.length).toBeGreaterThan(0);
    expect(new Set(lit.map((note) => note.stepIndex)).size).toBe(1);
  });

  it('leaves the page dark for a playback nobody asked to watch', async () => {
    const { controller, renderer, metronome } = createController(true);
    controller.updateSettings({ countInBars: 0 });
    await controller.loadNewExercise();
    controller.listen();
    metronome.advanceSubdivisions(4);

    expect(renderer.played.filter((note) => note.sounding === true)).toHaveLength(0);
  });

  it('says nothing about a playback the reader is only listening to', async () => {
    // Off by default, because a performance is also how a piece is listened
    // to: a page filling with red while nobody is being judged would be the
    // program marking a reader who never asked to be.
    const { controller, renderer, midi } = createController(true);
    await controller.loadNewExercise();
    controller.listen();

    midi.noteOn((controller.currentTimeline?.at(0)?.expectedMidi[0] ?? 60) + 1, 0);

    expect(renderer.played).toHaveLength(0);
  });

  it('stops marking once the performance is over', async () => {
    // The watch stands down with the music. A press between performances is
    // the reader trying something out, not an answer to anything.
    const { controller, renderer, midi } = createController(true);
    controller.updateSettings({ markWhileListening: true });
    await controller.loadNewExercise();
    controller.listen();
    controller.stopListening();

    midi.noteOn(controller.currentTimeline?.at(0)?.expectedMidi[0] ?? 60, 0);

    expect(renderer.played).toHaveLength(0);
  });

  it('takes the marker off a playback when that is what was asked', async () => {
    // Which the machine used to overrule in two places: "hide the marker" was
    // a setting a playback simply ignored.
    const { controller, renderer } = createController(true);
    controller.updateSettings({ cursorWhileListening: false, cursorAtRest: true });
    await controller.loadNewExercise();
    expect(renderer.cursor.visible).toBe(true);

    controller.listen();

    expect(renderer.cursor.visible).toBe(false);
  });

  it('takes it away for a run and gives it back at the end', async () => {
    // The other half of the same wish, and what the third answer is for: no
    // marker while reading, and one afterwards to see where it stopped.
    const { controller, renderer } = createController(true);
    controller.updateSettings({ cursorWhileRunning: false, cursorAtRest: true });
    await controller.loadNewExercise();
    expect(renderer.cursor.visible).toBe(true);

    controller.start();
    expect(renderer.cursor.visible).toBe(false);

    controller.stop();
    expect(renderer.cursor.visible).toBe(true);
  });

  it('keeps it through a re-engraving while the exercise plays itself', async () => {
    const { controller, renderer } = createController(true);
    controller.updateSettings({
      cursorWhileRunning: false,
      cursorWhileListening: true,
      cursorAtRest: false,
    });
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
    controller.updateSettings({ cursorWhileRunning: false, cursorWhileListening: false, cursorAtRest: false });

    controller.stopListening();

    expect(renderer.cursor.visible).toBe(false);
  });

  it('brings it back when the setting is turned on again', async () => {
    const { controller, renderer } = createController();
    await controller.loadNewExercise();
    controller.updateSettings({ cursorWhileRunning: false, cursorWhileListening: false, cursorAtRest: false });

    controller.updateSettings({ cursorWhileRunning: true, cursorWhileListening: true, cursorAtRest: true });

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
    controller.updateSettings({ cursorWhileRunning: false, cursorWhileListening: false, cursorAtRest: false });

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

  it('is drained by the clock in Wait mode, where the music does not move', async () => {
    // It used to be switched off here on the reasoning that nothing moves
    // without the reader, so there is nothing to survive. His line 53 asks
    // for the other reading of it: a bar that falls while you hunt and fills
    // completely on every beat you find - room to think, and a reason not to
    // sit in one place.
    const rig = await survivalRun({ modeId: undefined });
    rig.controller.updateSettings({ modeId: new WaitMode().id });
    rig.controller.start();

    expect(rig.controller.survivalRuns).toBe(true);
    expect(rig.controller.survivalKeepsTime).toBe(false);

    // Three seconds of hunting, drained a tick at a time the way the page
    // does it.
    for (let at = 0; at < 6; at += 1) {
      rig.clock.set(rig.clock.now() + 500);
      rig.controller.drainWhileWaiting();
    }

    expect(rig.controller.health).toBeLessThan(1);
    expect(rig.controller.health).toBeGreaterThan(0);
  });

  it('fills again on every beat the reader finds', async () => {
    const rig = await survivalRun({ modeId: undefined });
    rig.controller.updateSettings({ modeId: new WaitMode().id });
    const session = rig.controller.start();
    for (let at = 0; at < 6; at += 1) {
      rig.clock.set(rig.clock.now() + 500);
      rig.controller.drainWhileWaiting();
    }
    expect(rig.controller.health).toBeLessThan(1);

    for (const note of session?.currentStep?.expectedMidi ?? []) {
      rig.midi.noteOn(note, rig.clock.now());
    }

    expect(rig.controller.health).toBe(1);
  });

  it('gives back only the share of the bar the reader asked for', async () => {
    // His. Filling it outright makes a clock that punishes stopping and
    // nothing else: find one beat and the bar is full again however long the
    // last one took.
    const rig = await survivalRun({ modeId: undefined });
    rig.controller.updateSettings({
      modeId: new WaitMode().id,
      survivalRefillPercent: 30,
    });
    const session = rig.controller.start();
    for (let at = 0; at < 6; at += 1) {
      rig.clock.set(rig.clock.now() + 500);
      rig.controller.drainWhileWaiting();
    }
    const hunted = rig.controller.health;

    for (const note of session?.currentStep?.expectedMidi ?? []) {
      rig.midi.noteOn(note, rig.clock.now());
    }

    expect(rig.controller.health).toBeCloseTo(hunted + 0.3, 5);
    expect(rig.controller.health).toBeLessThan(1);
  });

  it('charges for the wrong notes a beat was found through, where asked', async () => {
    // The hole he named: a beat found through wrong notes filled the bar
    // exactly as a clean one did, so in Wait mode nothing was ever survived.
    const played = async (punishes: boolean): Promise<number> => {
      const rig = await survivalRun({ modeId: undefined });
      rig.controller.updateSettings({
        modeId: new WaitMode().id,
        survivalRefillPercent: 30,
        survivalPunishesMistakes: punishes,
      });
      const session = rig.controller.start();
      // Hunting first, or there is no room in the bar for a share to land in
      // and both answers clamp to full.
      for (let at = 0; at < 6; at += 1) {
        rig.clock.set(rig.clock.now() + 500);
        rig.controller.drainWhileWaiting();
      }
      const wanted = session?.currentStep?.expectedMidi ?? [];
      rig.midi.noteOn((wanted[0] ?? 60) + 1, rig.clock.now());
      for (const note of wanted) {
        rig.midi.noteOn(note, rig.clock.now());
      }
      return rig.controller.health;
    };

    expect(await played(true)).toBeLessThan(await played(false));
  });

  it('ends the run when the hunting has gone on too long', async () => {
    const rig = await survivalRun({ modeId: undefined });
    rig.controller.updateSettings({ modeId: new WaitMode().id });
    const session = rig.controller.start();

    // A minute of nothing, a second at a time.
    for (let at = 0; at < 60; at += 1) {
      rig.clock.set(rig.clock.now() + 1_000);
      rig.controller.drainWhileWaiting();
    }

    expect(rig.controller.health).toBe(0);
    expect(session?.status).toBe('aborted');
  });

  it('is not lost while the page was away', async () => {
    // One tick is worth at most a second however long it has really been: a
    // page put away with a run going should not come back to a run that was
    // lost while nobody was watching.
    const rig = await survivalRun({ modeId: undefined });
    rig.controller.updateSettings({ modeId: new WaitMode().id });
    rig.controller.start();

    rig.clock.set(rig.clock.now() + 10 * 60_000);
    rig.controller.drainWhileWaiting();

    expect(rig.controller.health).toBeGreaterThan(0.85);
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

  it('counts places in the playing, not the numbers printed on the page', async () => {
    // A score that starts at bar 40 - which is what an excerpt carried out of
    // a longer piece looks like - is still eight bars of playing, and its
    // third bar is the third one played. The page goes on saying 40.
    const rig = createController();
    await rig.controller.openScore({ ...longExercise({ bars: 8 }), firstBarNumber: 40 });

    expect(rig.controller.pieceBarRange).toEqual({ firstBar: 1, lastBar: 8 });

    rig.controller.choosePassage(3, 5);
    const loaded = await rig.controller.reloadExercise();

    expect(loaded.firstBarNumber).toBe(40);
    expect(measureCount(loaded)).toBe(8);
    expect(rig.controller.barNumber(0)).toBe(40);

    rig.controller.updateSettings({ countInBars: 0 });
    const session = rig.controller.start();
    expect(session?.currentStep?.measureIndex).toBe(2);
  });

  it('lands on the bar held, not on the one its printed number also names', async () => {
    // His, measured on City of Tears. A repeat is written out, so the page
    // says "5" twice and the sixth bar played is the second of them. Read as
    // a printed number and turned back into a place by subtracting the first
    // bar's number, a passage landed as many bars early as the piece had
    // re-read - a hold on the thirty-eighth bar put the marker on the
    // thirty-second.
    const rig = createController();
    await rig.controller.openScore({
      ...longExercise({ bars: 8 }),
      // Bars three and four read twice, so the last bar played is printed 6.
      barLabels: [1, 2, 3, 4, 3, 4, 5, 6].map((number, at) => ({
        number,
        repeated: at === 4 || at === 5,
      })),
    });

    // The seventh bar played, which the page calls 5.
    rig.controller.choosePassage(7, 7);
    rig.controller.updateSettings({ countInBars: 0 });
    const session = rig.controller.start();

    expect(rig.controller.barNumber(6)).toBe(5);
    expect(session?.currentStep?.measureIndex).toBe(6);
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

    it('starts the clock before it scrolls the page back to the top', async () => {
      // His question, and the right one: a click is placed on the audio graph
      // the moment the pulse starts, and nothing the main thread does after
      // that can move it - so work done *before* the start is added in front
      // of the sound and work done after it is not. Scrolling a long piece
      // back to its first bar is a layout and a scroll over a whole engraving,
      // and it used to stand between the key he pressed to begin and the
      // downbeat he pressed it for.
      const rig = createController(true, undefined, {
        immediateStart: true,
        modeId: FLOW_MODE_ID,
      });
      await rig.controller.openScore(twoBarExercise({ tempoBpm: 60 }));
      const order: string[] = [];
      const started = rig.metronome.start.bind(rig.metronome);
      rig.metronome.start = () => {
        order.push('clock');
        started();
      };
      rig.renderer.onScrollToStart = () => order.push('page');

      for (const midiNote of opening(rig.controller)) {
        rig.midi.noteOn(midiNote, rig.clock.now());
      }

      expect(order).toEqual(['clock', 'page']);
    });

    it('starts the run by playing in every frame there is', async () => {
      // His: "ця фіча має працювати у будь якому режимі". It is the
      // controller's and not a mode's - what begins is whatever run the reader
      // has chosen - but the frame with a gate at the first note is the one
      // that could have deadlocked, each side waiting for the other, so all
      // three are said here rather than assumed.
      for (const modeId of [FLOW_MODE_ID, new WaitMode().id, BAR_MODE_ID]) {
        const { controller, midi, clock, metronome } = createController(true, undefined, {
          immediateStart: true,
          modeId,
        });
        await controller.loadNewExercise();
        expect(controller.session, modeId).toBeNull();

        for (const midiNote of opening(controller)) {
          midi.noteOn(midiNote, clock.now());
        }
        // The pulse, where the frame keeps time, hands the run its first beat.
        metronome.advanceSubdivisions(1);

        expect(controller.session, modeId).not.toBeNull();
        expect(controller.session?.status, modeId).toBe('running');
      }
    });

    it('begins with the pedal where the foot left it', async () => {
      // Pedal on, then play: where the opening chord is what starts the run,
      // the foot always moves before there is a session to hear it, so the
      // lift had no press to close and the span was dropped entirely. His:
      // "якщо я натискаю його рано, то воно показується що воно з самого
      // початку взагалі не було натиснуто".
      const { controller, midi, clock, metronome } = createController(true, undefined, {
        immediateStart: true,
        modeId: FLOW_MODE_ID,
      });
      await controller.loadNewExercise();
      midi.pedal(true, clock.now());

      for (const midiNote of opening(controller)) {
        midi.noteOn(midiNote, clock.now());
      }
      metronome.advanceSubdivisions(1);
      midi.pedal(false, clock.now() + 900);

      const roll = controller.session?.roll ?? null;
      expect(roll?.pedal).toEqual([
        { downAtMs: roll === null ? -1 : rollBeganAtMs(roll), upAtMs: 900 },
      ]);
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

    it('counts it however late the page heard about it', async () => {
      // Reported from the page: with immediate start the first note is not
      // counted, and has to be played twice. A press carries the moment the
      // key went down; over the bridge the page hears about it later, by the
      // hop and by whatever the two clocks disagree about. Judged against the
      // early-press window, the chord that started the run was thrown away
      // for being too old - and the run then asked for it again.
      const { controller, midi, clock } = createController(true, undefined, {
        immediateStart: true,
      });
      await controller.loadNewExercise();
      const wentDown = clock.now() - 300;

      for (const midiNote of opening(controller)) {
        midi.noteOn(midiNote, wentDown);
      }

      expect(controller.session?.status).toBe('running');
      expect(controller.session?.currentStep?.index).toBe(1);
    });

    it('corrects it for the input delay, like every other press', async () => {
      // These are the only presses that do not come through the door where
      // that is done, the run having had no ears when they were played. Left
      // uncorrected they were the one press in the run judged against a
      // different idea of when it happened - and the mark for the first note
      // was drawn away from the beat because of it.
      const { controller, midi, clock } = createController(true, undefined, {
        immediateStart: true,
        inputLatencyMs: 100,
      });
      await controller.loadNewExercise();
      const wentDown = clock.now() - 300;

      for (const midiNote of opening(controller)) {
        midi.noteOn(midiNote, wentDown);
      }

      // Struck 300 ms before the step was entered, and heard about 100 ms
      // after it was struck.
      expect(controller.session?.stepResults[0]?.deviationMs).toBe(-400);
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

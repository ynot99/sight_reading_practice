import type { ExercisePresetRegistry } from '../domain/generation/ExercisePresetRegistry.js';
import type { ExerciseRequest, IExerciseGenerator } from '../domain/generation/IExerciseGenerator.js';
import type { RhythmProfileRegistry } from '../domain/generation/RhythmProfile.js';
import type { Exercise } from '../domain/model/Exercise.js';
import type { KeySignature } from '../domain/model/KeySignature.js';
import type { TimeSignature } from '../domain/model/TimeSignature.js';
import type { IMusicXmlSerializer } from '../domain/notation/MusicXmlSerializer.js';
import type { ScoringStrategyRegistry } from '../domain/scoring/ScoringStrategyRegistry.js';
import { buildTimeline, type ExerciseTimeline, type TimelineStep } from '../domain/timeline/Timeline.js';
import { playedNoteOffset } from './playedNoteOffset.js';
import { TypedEventEmitter, type IEventSource, type Unsubscribe } from '../shared/EventEmitter.js';
import type { PracticeModeRegistry } from './modes/PracticeModeRegistry.js';
import type { IClock } from './ports/IClock.js';
import { GeneratedExerciseProvider, type IExerciseProvider } from './ports/IExerciseProvider.js';
import type { IMetronome } from './ports/IMetronome.js';
import type { IMidiSource } from './ports/IMidiSource.js';
import type { IPitchPlayer } from './ports/IPitchPlayer.js';
import { ExercisePlayer } from './ExercisePlayer.js';
import type { PassageHistory, PracticeHistory } from './PracticeHistory.js';
import { clickIsSilent, type ClickWhen, type ClickPattern } from './ports/IMetronome.js';
import type {
  PlayedNote,
  IPlayedNoteOverlay,
  IScoreCursor,
  IScoreFade,
  IScoreRenderer,
  IScoreZoom,
} from './ports/IScoreRenderer.js';
import { barNumberOf, clefAtMeasure, keyAtMeasure, measureCount } from '../domain/model/Exercise.js';
import { sliceExercise } from '../domain/model/exerciseSlice.js';
import { worstPassage, type Passage } from '../domain/scoring/troubleSpots.js';
import { PracticeSession } from './session/PracticeSession.js';
import { HealthMeter, type HealthMeterOptions } from '../domain/scoring/HealthMeter.js';
import type { LadderStep, PracticeLadder } from './ladder/PracticeLadder.js';

/** When the marks for what was played are put on the page. */
export const PLAYED_NOTE_DISPLAYS = ['live', 'at-end', 'hidden'] as const;

export type PlayedNoteDisplay = (typeof PLAYED_NOTE_DISPLAYS)[number];

/** How far one press of the tempo buttons moves, as a percentage. */
export const TEMPO_STEP_PERCENT = 5;
/** Matches what the stored-settings codec will accept back. */
const MIN_TEMPO_BPM = 20;
const MAX_TEMPO_BPM = 300;
const MIN_TEMPO_PERCENT = 25;
const MAX_TEMPO_PERCENT = 200;

function clampPercent(percent: number): number {
  return Math.min(MAX_TEMPO_PERCENT, Math.max(MIN_TEMPO_PERCENT, percent));
}

/** A passage as the reader has it: an open end is a real answer, not a gap. */
export interface ChosenPassage {
  readonly fromBar: number | null;
  readonly toBar: number | null;
}

/** The fields a rung governs, and so the ones that leaving it is made of. */
function touchesTheRoute(changes: Partial<PracticeSettings>): boolean {
  return (
    changes.presetId !== undefined ||
    changes.rhythmProfileId !== undefined ||
    changes.key !== undefined ||
    changes.timeSignature !== undefined
  );
}

/**
 * A reading clean enough to be worth repeating, and one that came apart.
 *
 * Two of either in a row moves the reader, which is slow enough that one
 * lucky or one ruined page decides nothing.
 */
const LADDER_PROMOTE_AT = 0.9;
const LADDER_DEMOTE_AT = 0.6;
const LADDER_RUNS_TO_MOVE = 2;

/** Everything the user can dial in before pressing start. */
export interface PracticeSettings {
  readonly presetId: string;
  readonly modeId: string;
  /**
   * What the run is graded on.
   *
   * Its own axis, not a consequence of the mode: the same Flow run is worth
   * grading for accuracy, for timing, or for how far it went unbroken, and
   * which of those you are working on is a choice.
   */
  readonly scoringId: string;
  /**
   * Rhythmic level, chosen independently of the preset.
   *
   * Material and rhythm are separate axes: any preset combines with any
   * profile, so adding sixteenths does not mean duplicating the whole ladder.
   */
  readonly rhythmProfileId: string;
  readonly key: KeySignature;
  readonly timeSignature: TimeSignature;
  readonly measures: number;
  readonly tempoBpm: number;
  /** Bars of click before the first note. */
  readonly countInBars: number;
  /**
   * How much of the pulse is sounded.
   *
   * A practice setting in its own right, not just comfort: clicking only on
   * the downbeat makes the reader keep the pulse inside the bar rather than
   * leaning on it.
   */
  readonly clickPattern: ClickPattern;
  /**
   * Staff to practise and to hear, or `null` for both hands.
   *
   * One setting for reading and for listening, because they are the same
   * question asked twice: which hand am I working on.
   */
  readonly handStaff: number | null;
  /**
   * Bars to practise, one-based and inclusive, or `null` for the whole thing.
   *
   * Applied by cutting the passage out as an exercise in its own right, so
   * everything downstream carries on unaware that a longer piece exists.
   */
  readonly rangeFromBar: number | null;
  readonly rangeToBar: number | null;
  /** Start the passage again as soon as it ends. */
  readonly repeatRange: boolean;
  /**
   * Which rung of the practice ladder is being read, or `null` for none.
   *
   * `null` is not "no level" but *off the route*: the axes were set by hand,
   * and nothing should move them afterwards. Setting any of the four fields a
   * rung governs steps off it, which is why leaving is never a decision the
   * reader has to make separately.
   */
  readonly ladderStepId: string | null;
  /**
   * How much of the run the click sits out.
   *
   * Its own axis rather than a fifth {@link ClickPattern}: the pattern says
   * what a click marks and applies to the count-in as well, so "only the
   * count-in" cannot be one of its values without leaving the count-in's own
   * pattern unsaid.
   */
  readonly clickWhen: ClickWhen;
  readonly matchToleranceMs: number;
  readonly pitchClassOnly: boolean;
  /**
   * Judge the timing and not the notes.
   *
   * Reading a rhythm before playing it is standard practice, and it is the
   * half beginners drop first. Composes with either mode rather than being
   * one of its own, since nothing about *when the cursor moves* changes.
   */
  readonly rhythmOnly: boolean;
  /**
   * Seconds to look at the music before it begins. `0` is off.
   *
   * Real sight-reading starts with a scan - key, metre, range, where the hard
   * bar is - and the habit transfers to any page. Nothing here enforces it
   * today: the score is on screen and the reader may study it for an hour or
   * press Start immediately. A phase that ends on its own is what makes the
   * look deliberate.
   */
  readonly previewSeconds: number;
  /**
   * Draw the position marker on the score.
   *
   * Turning it off is a practice aid in its own right: it forces you to keep
   * your place by reading rather than by following the highlight.
   */
  readonly showCursor: boolean;
  /**
   * Stop spelling out the notes of the step that is due.
   *
   * The panel naming them is the crutch that makes hiding the cursor only
   * half a measure: the reader who loses their place reads the letters
   * instead of the stave. With this on, the page is the only thing that says
   * what to play - the bar and beat still show, because knowing *where* you
   * are is orientation, not an answer.
   */
  readonly blindMode: boolean;
  /**
   * When the marks for what you played appear.
   *
   * One axis rather than a switch plus a switch: "draw them" and "draw them
   * now" are the same question at different moments, and two controls would
   * let a reader ask for marks that are hidden.
   *
   * - `live` draws each press as it lands. Immediate, and busy.
   * - `at-end` keeps them back until the run finishes, so the page you are
   *   reading stays the page the engraver drew. Reading is the task; a mark
   *   appearing under your eyes as you play is an answer to a question you
   *   have already answered.
   * - `hidden` never draws them at all.
   */
  readonly playedNotes: PlayedNoteDisplay;
  /**
   * A bar that drains while the music runs and fills when you get it right.
   *
   * Not a way of grading sight-reading: coming apart on a page never seen
   * before is the material working, not the reader failing. This is for music
   * already known, where the question is whether it holds together at tempo.
   * It needs a pulse to drain against, so it says nothing in Wait mode -
   * where the music waits for the reader, there is nothing to survive.
   */
  readonly survival: boolean;
  /**
   * Where the veil sits relative to the cursor, in steps, or `null` for none.
   *
   * One axis, because dimming what is behind and hiding what is under your
   * fingers are the same act at different distances - only the distance says
   * whether the page is being tidied or the reader is being made to look
   * ahead.
   *
   * - `0` dims a step once it is done with. Declutter; nothing is demanded.
   * - `1` takes the step you are on, so it must already have been read.
   * - `2` takes the one after it as well.
   */
  readonly readAheadSteps: number | null;
  /** Note size on the page, as a multiplier. */
  readonly zoom: number;
}

export interface ExerciseLoadedEvent {
  readonly exercise: Exercise;
  readonly timeline: ExerciseTimeline;
  readonly musicXml: string;
}

export interface ControllerEventMap {
  settingsChanged: { readonly settings: PracticeSettings };
  exerciseLoaded: ExerciseLoadedEvent;
  sessionCreated: { readonly session: PracticeSession };
  /**
   * Where the survival bar stands, `0..1`, and why it moved.
   *
   * The two causes look different and must be drawn differently: a drain is a
   * glide paced by the pulse, a settlement is a step landing at once. Told
   * apart here rather than guessed at from the clock, which is what a view
   * timing itself against "the last update of any kind" ends up doing.
   */
  healthChanged: { readonly health: number; readonly cause: 'drain' | 'settle' };
  ladderMoved: {
    readonly from: LadderStep;
    readonly to: LadderStep;
    readonly direction: 'up' | 'down';
  };
  error: { readonly error: Error; readonly context: string };
}

export interface PracticeControllerDependencies {
  readonly presets: ExercisePresetRegistry;
  readonly rhythms: RhythmProfileRegistry;
  readonly modes: PracticeModeRegistry;
  readonly serializer: IMusicXmlSerializer;
  readonly renderer: IScoreRenderer;
  readonly cursor: IScoreCursor;
  readonly overlay: IPlayedNoteOverlay;
  readonly fade: IScoreFade;
  readonly zoom: IScoreZoom;
  readonly midi: IMidiSource;
  readonly metronome: IMetronome;
  /** Sounds an exercise back when the reader asks to hear it. */
  readonly instrument: IPitchPlayer;
  readonly clock: IClock;
  readonly scorings: ScoringStrategyRegistry;
  /** The route through the settings the reader can follow, if there is one. */
  readonly ladder?: PracticeLadder;
  /** Remembers how earlier readings of the same passage went. */
  readonly history?: PracticeHistory;
  /** How hard the survival bar is, for tuning and for tests. */
  readonly health?: HealthMeterOptions;
  /** Seam for alternative exercise sources (files, network, ear training). */
  readonly providerFor?: (generator: IExerciseGenerator) => IExerciseProvider;
  readonly initialSettings?: Partial<PracticeSettings>;
}

/**
 * Application service that ties the pieces together.
 *
 * It owns the current settings, asks a provider for material, renders it,
 * creates a session per run and keeps the on-screen cursor in step with the
 * session's position. Nothing here knows about the DOM, MIDI hardware or
 * audio: those arrive as ports.
 */
export class PracticeController {
  private readonly deps: PracticeControllerDependencies;
  private readonly emitter = new TypedEventEmitter<ControllerEventMap>();

  private currentSettings: PracticeSettings;
  private provider: IExerciseProvider;
  private exercise: Exercise | null = null;
  private timeline: ExerciseTimeline | null = null;
  private currentSession: PracticeSession | null = null;
  private sessionSubscriptions: Unsubscribe[] = [];
  private lastSeed: number | null = null;
  private openedScore: Exercise | null = null;
  private player: ExercisePlayer | null = null;
  /** Highest step already dimmed, so the veil is drawn once per step. */
  private fadedThrough = -1;
  /** Marks waiting for the run to end, when that is when they are drawn. */
  private heldMarks: PlayedNote[] = [];
  private readonly meter: HealthMeter;
  private lastBeatTicks = 0;
  private cleanReadings = 0;
  private poorReadings = 0;

  constructor(dependencies: PracticeControllerDependencies) {
    this.deps = dependencies;
    this.meter = new HealthMeter(dependencies.health);
    // Defaults come from the preset that is actually about to be used, not
    // from the first one registered: restored settings name a preset but may
    // predate a field, and that field has to default to something coherent
    // with the level being restored.
    const restoredPresetId = dependencies.initialSettings?.presetId;
    const preset =
      restoredPresetId !== undefined && dependencies.presets.has(restoredPresetId)
        ? dependencies.presets.get(restoredPresetId)
        : dependencies.presets.first();
    const restoredModeId = dependencies.initialSettings?.modeId;
    const mode =
      restoredModeId !== undefined && dependencies.modes.has(restoredModeId)
        ? dependencies.modes.get(restoredModeId)
        : dependencies.modes.first();
    this.currentSettings = {
      presetId: preset.id,
      modeId: mode.id,
      scoringId: mode.defaultScoringId,
      rhythmProfileId: preset.defaults.rhythmProfileId,
      key: preset.defaults.key,
      timeSignature: preset.defaults.timeSignature,
      measures: preset.defaults.measures,
      tempoBpm: preset.defaults.tempoBpm,
      countInBars: 1,
      clickPattern: 'pulse',
      handStaff: null,
      rangeFromBar: null,
      rangeToBar: null,
      repeatRange: false,
      ladderStepId: null,
      clickWhen: 'always',
      matchToleranceMs: 250,
      pitchClassOnly: false,
      rhythmOnly: false,
      previewSeconds: 0,
      showCursor: true,
      blindMode: false,
      playedNotes: 'live',
      survival: false,
      readAheadSteps: null,
      zoom: 0.85,
      ...dependencies.initialSettings,
    };
    this.provider = this.createProvider();
  }

  get events(): IEventSource<ControllerEventMap> {
    return this.emitter.asSource();
  }

  get settings(): PracticeSettings {
    return this.currentSettings;
  }

  get currentExercise(): Exercise | null {
    return this.exercise;
  }

  get currentTimeline(): ExerciseTimeline | null {
    return this.timeline;
  }

  get session(): PracticeSession | null {
    return this.currentSession;
  }

  /**
   * What a bar of the loaded exercise is called in the score it came from.
   *
   * Everything derived from the exercise counts bars from zero, including the
   * timeline and the report, so anything that shows a bar to the reader has to
   * come back through here. Read from the exercise rather than from the range
   * in the settings: the two disagree from the moment the reader edits the
   * range until the reload, and the page is showing the exercise.
   */
  barNumber(measureIndex: number): number {
    return this.exercise === null ? measureIndex + 1 : barNumberOf(this.exercise, measureIndex);
  }

  /**
   * How many bars there are to choose a passage from.
   *
   * The opened score's own length, or - with nothing opened - the number of
   * bars the settings ask for, since that is the whole of what there will be.
   */
  get wholePieceBars(): number {
    return this.openedScore === null
      ? this.currentSettings.measures
      : measureCount(this.openedScore);
  }

  /**
   * Applies settings.
   *
   * Changing the preset adopts that preset's defaults for anything the caller
   * did not explicitly override, which is what makes the level selector feel
   * like a difficulty ladder rather than a bag of unrelated switches.
   */
  updateSettings(changes: Partial<PracticeSettings>): PracticeSettings {
    let next: PracticeSettings = { ...this.currentSettings, ...changes };

    if (changes.ladderStepId === undefined && touchesTheRoute(changes)) {
      // Setting by hand what a rung sets is how a reader leaves the ladder.
      // Making it a separate decision would let the arrows and the selectors
      // disagree about what is being practised, and one of them would be
      // lying. Tempo and bar count are deliberately not on the list: slowing
      // a rung down is how it is meant to be met.
      next = { ...next, ladderStepId: null };
      this.resetLadderStreaks();
    }

    if (changes.modeId !== undefined && changes.modeId !== this.currentSettings.modeId) {
      // Same idea as the preset ladder: a mode brings the grading it is
      // usually judged by, unless the caller said otherwise in the same breath.
      next = {
        ...next,
        scoringId: changes.scoringId ?? this.deps.modes.get(changes.modeId).defaultScoringId,
      };
    }

    if (changes.presetId !== undefined && changes.presetId !== this.currentSettings.presetId) {
      const defaults = this.deps.presets.get(changes.presetId).defaults;
      next = {
        ...next,
        rhythmProfileId: changes.rhythmProfileId ?? defaults.rhythmProfileId,
        key: changes.key ?? defaults.key,
        timeSignature: changes.timeSignature ?? defaults.timeSignature,
        measures: changes.measures ?? defaults.measures,
        tempoBpm: changes.tempoBpm ?? defaults.tempoBpm,
      };
      this.currentSettings = next;
      // Changing what would be generated is a decision to generate again.
      this.openedScore = null;
      this.provider = this.createProvider();
    } else {
      this.currentSettings = next;
    }

    if (changes.showCursor !== undefined) {
      this.applyCursorVisibility();
    }

    if (changes.zoom !== undefined && changes.zoom !== this.deps.zoom.zoom) {
      this.deps.zoom.setZoom(changes.zoom);
      this.refreshScore();
    }

    if (changes.playedNotes !== undefined && changes.playedNotes !== 'live') {
      // Turning them off, or moving them to the end, both mean the page in
      // front of the reader should be clean again now.
      this.deps.overlay.clearPlayed();
      this.heldMarks = [];
    }

    if (changes.readAheadSteps !== undefined) {
      // Re-drawn from where the run actually is rather than left as it was:
      // moving the veil nearer must give the notes back, not only further
      // away take more.
      this.repaintFade();
    }

    this.emitter.emit('settingsChanged', { settings: next });
    return next;
  }

  /** Generates fresh material and renders it. */
  async loadNewExercise(): Promise<Exercise> {
    // Asking for a new exercise is asking the generator for one, so an opened
    // file steps aside rather than being handed back unchanged.
    this.openedScore = null;
    // Bars 12-16 of the piece just closed mean nothing in the piece about to
    // open, and silently applying them would hand back a passage of something
    // the reader never asked to narrow. A range is about *this* music.
    if (this.currentSettings.rangeFromBar !== null || this.currentSettings.rangeToBar !== null) {
      this.updateSettings({ rangeFromBar: null, rangeToBar: null });
    }
    return this.load(undefined);
  }

  /**
   * Practises a score that came from outside instead of from the generator.
   *
   * It stays until the reader asks for a new exercise or changes what would be
   * generated, so the two sources never quietly swap places underneath them.
   */
  async openScore(exercise: Exercise): Promise<Exercise> {
    this.openedScore = exercise;
    // The file brought its own tempo; adopting it is what makes the slider
    // show the truth, and what lets the reader slow the piece down.
    this.updateSettings({ tempoBpm: exercise.tempoBpm });
    return this.load(undefined);
  }

  /**
   * The tempo the material itself declares, which is what 100% means.
   *
   * Derived rather than stored: an opened score brought its own tempo and a
   * generated one takes its preset's, so there is nothing here that could
   * drift out of step with the music on screen.
   */
  get baseTempoBpm(): number {
    return (
      this.openedScore?.tempoBpm ??
      this.deps.presets.get(this.currentSettings.presetId).defaults.tempoBpm
    );
  }

  /** How fast the run goes against the written tempo, as a percentage. */
  get tempoPercent(): number {
    const base = this.baseTempoBpm;
    return base <= 0 ? 100 : Math.round((this.currentSettings.tempoBpm / base) * 100);
  }

  /**
   * Moves the tempo by whole steps of the written one.
   *
   * A percentage rather than a number of beats because the written tempo
   * changes from piece to piece: "a bit slower" is the same gesture at 60 and
   * at 132, and the reader should not have to work out what number that is.
   * Steps land on multiples of the step size, so repeated presses do not
   * wander off the grid.
   */
  nudgeTempoPercent(deltaPercent: number, step = TEMPO_STEP_PERCENT): number {
    const base = this.baseTempoBpm;
    const from = Math.round(this.tempoPercent / step) * step;
    const wanted = clampPercent(from + deltaPercent);
    const bpm = Math.min(MAX_TEMPO_BPM, Math.max(MIN_TEMPO_BPM, Math.round((base * wanted) / 100)));
    this.updateSettings({ tempoBpm: bpm });
    return this.tempoPercent;
  }

  /** The opened score, or `null` when the material is being generated. */
  get openedExercise(): Exercise | null {
    return this.openedScore;
  }

  /**
   * Re-renders the current material.
   *
   * Generation is seeded, so this reproduces the same notes - used when only
   * the tempo mark on the page has to change.
   */
  async reloadExercise(): Promise<Exercise> {
    return this.load(this.lastSeed ?? undefined);
  }

  /**
   * Re-lays out the score after the container changed size.
   *
   * The engraver rewinds its cursor when it re-renders, so the session's
   * position is put back afterwards - otherwise switching to fullscreen
   * mid-exercise would silently send the marker back to the first note.
   */
  refreshScore(): void {
    this.deps.renderer.refresh();
    this.applyCursorVisibility();
    const index = this.currentSession?.currentIndex ?? -1;
    if (index > 0) {
      this.deps.cursor.moveTo(index);
    }
  }

  private async load(seed: number | undefined): Promise<Exercise> {
    this.disposeSession();

    const opened = this.openedScore;
    if (opened !== null) {
      return this.present(opened);
    }

    const request: ExerciseRequest = {
      measures: this.currentSettings.measures,
      timeSignature: this.currentSettings.timeSignature,
      key: this.currentSettings.key,
      tempoBpm: this.currentSettings.tempoBpm,
      rhythm: this.deps.rhythms.get(this.currentSettings.rhythmProfileId),
      ...(seed === undefined ? {} : { seed }),
    };

    return this.present(await this.provider.provide(request));
  }

  /** Engraves an exercise and makes it the one being practised. */
  private async present(source: Exercise): Promise<Exercise> {
    // An opened score keeps its own notes but takes the reader's tempo, so the
    // slider works on a file exactly as it works on generated material.
    const retimed =
      this.openedScore === null
        ? source
        : { ...source, tempoBpm: this.currentSettings.tempoBpm };
    const { rangeFromBar, rangeToBar } = this.currentSettings;
    const exercise =
      rangeFromBar === null && rangeToBar === null
        ? retimed
        : sliceExercise(
            retimed,
            rangeFromBar ?? 1,
            rangeToBar ?? measureCount(retimed),
          );
    const musicXml = this.deps.serializer.serialize(exercise);

    this.exercise = exercise;
    this.timeline = buildTimeline(exercise);
    this.lastSeed = exercise.metadata.seed;

    await this.deps.renderer.load(musicXml);
    const timeline = this.timeline;
    this.deps.overlay.configureOverlay({
      keyAt: (stepIndex) =>
        keyAtMeasure(exercise, timeline.at(stepIndex)?.measureIndex ?? 0),
      clefAt: (staffNumber, stepIndex) => {
        const measureIndex = timeline.at(stepIndex)?.measureIndex ?? 0;
        const staff = exercise.staves.find((part) => part.staffNumber === staffNumber);
        return staff === undefined ? 'treble' : clefAtMeasure(staff, measureIndex);
      },
    });
    this.deps.overlay.clearPlayed();
    this.deps.fade.clearFaded();
    this.deps.cursor.reset();
    this.applyCursorVisibility();

    this.emitter.emit('exerciseLoaded', { exercise, timeline: this.timeline, musicXml });
    return exercise;
  }

  /**
   * Creates a session for the loaded exercise and starts it.
   * Returns `null` when there is nothing loaded yet.
   */
  /**
   * Plays the exercise back instead of judging it.
   *
   * Mutually exclusive with a run: the same pulse and the same cursor cannot
   * serve two masters, and nobody wants to be graded on a performance the
   * machine is giving.
   */
  listen(): void {
    const timeline = this.timeline;
    if (timeline === null) {
      return;
    }
    this.disposeSession();
    const player = this.ensurePlayer();
    // Following along is most of the value of hearing it, so the marker is
    // shown whatever the reader set - and put back the way they had it when
    // the performance ends.
    this.deps.cursor.show();
    player.start(timeline, {
      staffNumber: this.currentSettings.handStaff,
      clickAudible: !clickIsSilent(this.currentSettings.clickWhen),
    });
  }

  /**
   * Narrows practice to wherever the last run went worst.
   *
   * Reported bars are counted from whatever was being practised, which may
   * already be a passage - so they are put back onto the whole piece before
   * becoming the new range, or a second drill would walk backwards through the
   * score.
   *
   * Returns the passage chosen, or `null` when the run gave nothing to work on.
   */
  drillWorstPassage(bars = 4): Passage | null {
    const report = this.currentSession?.report;
    if (report === undefined || report === null) {
      return null;
    }
    const found = worstPassage(report, { bars });
    if (found === null) {
      return null;
    }
    const passage = { fromBar: this.barNumber(found.fromBar - 1), toBar: this.barNumber(found.toBar - 1) };
    this.updateSettings({ rangeFromBar: passage.fromBar, rangeToBar: passage.toBar });
    return passage;
  }

  /**
   * Sets the passage from a note the reader touched.
   *
   * Whole bars, because that is what `sliceExercise` cuts and what a musician
   * means: a passage begins at a bar line, not partway through one. Cutting
   * mid-bar would leave a pickup and make every seam - the restated clef, the
   * tie let go of, the pedal pressed again - harder for nothing gained.
   *
   * The gesture reads as a selection. The first touch says where to begin and
   * leaves the end alone, so one tap means "from here on". A touch later in
   * the piece closes the passage; a touch on what is already the start opens
   * the whole piece again, which is the way back.
   *
   * Returns the passage now being practised. `toBar` is `null` when it runs
   * to the end of the piece, which is what one tap leaves behind - saying
   * "the last bar" would mean counting bars nobody asked about.
   */
  chooseFromStep(stepIndex: number): ChosenPassage {
    const step = this.timeline?.at(stepIndex);
    if (step === null || step === undefined) {
      return { fromBar: this.currentSettings.rangeFromBar, toBar: this.currentSettings.rangeToBar };
    }
    const bar = this.barNumber(step.measureIndex);
    const from = this.currentSettings.rangeFromBar;

    if (from === bar && this.currentSettings.rangeToBar === null) {
      this.updateSettings({ rangeFromBar: null, rangeToBar: null });
      return { fromBar: null, toBar: null };
    }
    if (from !== null && bar > from && this.currentSettings.rangeToBar === null) {
      this.updateSettings({ rangeToBar: bar });
      return { fromBar: from, toBar: bar };
    }
    this.updateSettings({ rangeFromBar: bar, rangeToBar: null });
    return { fromBar: bar, toBar: null };
  }

  /**
   * What the reader would call the thing being practised.
   *
   * An imported score is known by its title, since its id is minted afresh on
   * every open; generated material has no lasting identity of its own, so the
   * level stands in - the question there is whether *this level* is getting
   * easier, not whether one random exercise did.
   */
  practiceKey(): string {
    const { rangeFromBar, rangeToBar, presetId, rhythmProfileId } = this.currentSettings;
    const what =
      this.openedScore === null
        ? `level:${presetId}/${rhythmProfileId}`
        : `score:${this.openedScore.title}`;
    const bars =
      rangeFromBar === null && rangeToBar === null
        ? ''
        : ` bars:${rangeFromBar ?? 1}-${rangeToBar ?? ''}`;
    return `${what}${bars}`;
  }

  /** How earlier readings of this passage went, or `null` on a first visit. */
  passageHistory(): PassageHistory | null {
    return this.deps.history?.summary(this.practiceKey()) ?? null;
  }

  stopListening(): void {
    if (this.player?.isPlaying !== true) {
      return;
    }
    this.player.stop();
    this.applyCursorVisibility();
  }

  get isListening(): boolean {
    return this.player?.isPlaying ?? false;
  }

  /** Fires when a playback reaches the end on its own. */
  get playbackEvents(): IEventSource<{ started: Record<string, never>; finished: Record<string, never> }> {
    return this.ensurePlayer().events;
  }

  private ensurePlayer(): ExercisePlayer {
    if (this.player === null) {
      this.player = new ExercisePlayer({
        metronome: this.deps.metronome,
        instrument: this.deps.instrument,
        cursor: this.deps.cursor,
      });
      this.player.events.on('finished', () => this.applyCursorVisibility());
    }
    return this.player;
  }

  start(): PracticeSession | null {
    this.stopListening();
    const timeline = this.timeline;
    if (timeline === null) {
      this.emitter.emit('error', {
        error: new Error('Load an exercise before starting a session.'),
        context: 'start',
      });
      return null;
    }

    this.disposeSession();

    const mode = this.deps.modes.get(this.currentSettings.modeId);
    const session = new PracticeSession({
      timeline,
      mode,
      midi: this.deps.midi,
      metronome: this.deps.metronome,
      clock: this.deps.clock,
      scoring: this.deps.scorings.get(this.currentSettings.scoringId),
      options: {
        matchPolicy: {
          toleranceMs: this.currentSettings.matchToleranceMs,
          pitchClassOnly: this.currentSettings.pitchClassOnly,
          anyPitch: this.currentSettings.rhythmOnly,
        },
        countInBars: this.currentSettings.countInBars,
        expectedStaff: this.currentSettings.handStaff,
        click: this.currentSettings.clickPattern,
        clickWhen: this.currentSettings.clickWhen,
      },
    });

    this.currentSession = session;
    // The page a long piece was left scrolled to is not where bar one is.
    this.deps.renderer.scrollToStart();
    this.meter.reset();
    this.lastBeatTicks = 0;
    if (this.survivalRuns) {
      this.emitter.emit('healthChanged', { health: this.meter.health, cause: 'settle' });
    }
    this.heldMarks = [];
    this.deps.overlay.clearPlayed();
    this.deps.fade.clearFaded();
    this.fadedThrough = -1;

    this.sessionSubscriptions.push(
      // A step is dimmed the moment it is done with, whether it was played
      // well, badly or not at all: the page empties as the music passes.
      session.events.on('stepCompleted', ({ result }) => {
        if (this.currentSettings.readAheadSteps !== null) {
          this.fadeThrough(result.index);
        }
        if (this.survivalRuns) {
          // What the step was worth is how long it lasted, so that a bar
          // carries the same weight however many notes are in it.
          this.publishHealth(
            this.meter.settle(result.status, this.beatsIn(this.timeline?.at(result.index))),
            'settle',
          );
        }
      }),
    );

    this.sessionSubscriptions.push(
      // Every press is drawn where it was actually struck, right or wrong. A
      // repeat of a note already collected adds nothing to look at.
      session.events.on('noteJudged', ({ midi, verdict, stepIndex, deviationMs }) => {
        if (this.currentSettings.playedNotes === 'hidden' || verdict === 'duplicate') {
          return;
        }
        const mark = {
          stepIndex,
          midi,
          correct: verdict === 'correct',
          // Measured now, not at the end: the offset is a fraction of the gap
          // to the neighbouring note, and it is only known while the run
          // still knows the tempo it was played at.
          offset: this.timingOffsetFor(stepIndex, deviationMs, session.tempoBpm),
        };
        if (this.currentSettings.playedNotes === 'live') {
          this.deps.overlay.showPlayed(mark);
        } else {
          this.heldMarks.push(mark);
        }
      }),
    );
    this.sessionSubscriptions.push(
      // The pulse the run already keeps, so the bar needs no clock of its own
      // and a whole game replays headlessly.
      session.events.on('beat', (tick) => {
        if (!this.survivalRuns) {
          return;
        }
        const beats = this.beatsFor(tick.positionTicks - this.lastBeatTicks);
        this.lastBeatTicks = tick.positionTicks;
        this.publishHealth(this.meter.drainForBeats(beats), 'drain');
      }),
    );

    this.sessionSubscriptions.push(
      session.events.on('stepEntered', ({ step }) => {
        this.deps.cursor.moveTo(step.index);
        this.fadeAhead(step.index);
      }),
    );
    this.sessionSubscriptions.push(
      session.events.on('finished', ({ report, score }) => {
        this.drawHeldMarks();
        this.deps.history?.record(this.practiceKey(), {
          atMs: this.deps.clock.now(),
          overall: score.overall,
          grade: score.grade,
          completed: report.completed,
        });
        this.considerLadderMove(score.overall, report.completed);
      }),
    );
    this.sessionSubscriptions.push(
      session.events.on('statusChanged', ({ status }) => {
        if (status === 'completed' || status === 'aborted') {
          this.deps.cursor.reset();
        }
      }),
    );

    this.emitter.emit('sessionCreated', { session });
    session.start();
    return session;
  }

  pause(): void {
    this.currentSession?.pause();
  }

  resume(): void {
    this.currentSession?.resume();
  }

  stop(): void {
    this.currentSession?.abort();
  }

  dispose(): void {
    this.player?.dispose();
    this.player = null;
    this.disposeSession();
    this.deps.renderer.clear();
    this.emitter.removeAllListeners();
  }

  private disposeSession(): void {
    for (const unsubscribe of this.sessionSubscriptions) {
      unsubscribe();
    }
    this.sessionSubscriptions = [];
    this.currentSession?.dispose();
    this.currentSession = null;
  }

  /**
   * How far from its note a press is drawn, as a fraction of the gap.
   *
   * Only meaningful when the pulse is what moves the cursor: in Wait mode the
   * music holds still until the reader plays, so taking a moment to find the
   * note is not lateness and drawing it as such would be a lie.
   */
  private timingOffsetFor(
    stepIndex: number,
    deviationMs: number | null,
    tempoBpm: number,
  ): number {
    const timeline = this.timeline;
    if (timeline === null || !this.deps.modes.get(this.currentSettings.modeId).requiresMetronome) {
      return 0;
    }
    return playedNoteOffset(timeline, stepIndex, deviationMs, tempoBpm);
  }

  /**
   * Dims every step up to `limit`, remembering how far it has got.
   *
   * The renderer is happy to be told twice, but the run would then re-walk
   * the whole prefix on every step; keeping the high-water mark makes the
   * whole reading cost one pass.
   */
  private fadeThrough(limit: number): void {
    for (let index = this.fadedThrough + 1; index <= limit; index += 1) {
      this.deps.fade.fadePassed(index);
    }
    this.fadedThrough = Math.max(this.fadedThrough, limit);
  }

  /**
   * Draws the veil for a cursor now sitting at `stepIndex`.
   *
   * A lead of 0 reaches only as far as the step before, which is what "dim
   * what is done" means; each step further takes the note under the fingers
   * and then the one after it.
   */
  private fadeAhead(stepIndex: number): void {
    const lead = this.currentSettings.readAheadSteps;
    if (lead === null) {
      return;
    }
    this.fadeThrough(stepIndex + lead - 1);
  }

  /** Puts the veil back where the current setting says it belongs. */
  private repaintFade(): void {
    this.deps.fade.clearFaded();
    this.fadedThrough = -1;
    const stepIndex = this.currentSession?.currentStep?.index;
    if (stepIndex !== undefined) {
      this.fadeAhead(stepIndex);
    }
  }

  /**
   * Moves the reader a rung after two consecutive readings say so.
   *
   * Only whole readings of fresh material count. Repeating a passage until
   * it is right is practice, but it is not *sight*-reading, and a page read
   * for the fourth time says nothing about whether the next unseen one is
   * within reach.
   */
  private considerLadderMove(overall: number, completed: boolean): void {
    const ladder = this.deps.ladder;
    const stepId = this.currentSettings.ladderStepId;
    if (ladder === undefined || stepId === null || !this.isFreshReading()) {
      return;
    }
    // A run that was stopped is not a reading, in either direction. It also
    // scores a flat 100% under accuracy grading, which counts the notes that
    // were due rather than the ones in the exercise - so a reader who pressed
    // Stop twice would climb.
    if (!completed) {
      return;
    }

    if (overall >= LADDER_PROMOTE_AT) {
      this.cleanReadings += 1;
      this.poorReadings = 0;
    } else if (overall <= LADDER_DEMOTE_AT) {
      this.poorReadings += 1;
      this.cleanReadings = 0;
    } else {
      this.cleanReadings = 0;
      this.poorReadings = 0;
    }

    const offset =
      this.cleanReadings >= LADDER_RUNS_TO_MOVE
        ? 1
        : this.poorReadings >= LADDER_RUNS_TO_MOVE
          ? -1
          : 0;
    if (offset === 0) {
      return;
    }
    this.moveLadder(offset, offset > 0 ? 'up' : 'down');
  }

  /** Whether this reading was of something the reader had not seen before. */
  private isFreshReading(): boolean {
    const { rangeFromBar, rangeToBar, repeatRange } = this.currentSettings;
    return (
      this.openedScore === null &&
      rangeFromBar === null &&
      rangeToBar === null &&
      !repeatRange
    );
  }

  /**
   * Puts the reader on a neighbouring rung, or leaves them where they are.
   *
   * The move arms the next exercise rather than replacing the one on screen:
   * a run has just finished and its report is what the reader is looking at,
   * so pulling the page out from under them would hide the very thing that
   * explains the move.
   */
  moveLadder(offset: number, direction: 'up' | 'down' = offset > 0 ? 'up' : 'down'): LadderStep | null {
    const ladder = this.deps.ladder;
    const stepId = this.currentSettings.ladderStepId;
    if (ladder === undefined) {
      return null;
    }
    const from = stepId === null ? ladder.first() : ladder.get(stepId);
    // Coming back from a hand-set page starts at the rung, not past it.
    const to = stepId === null ? from : ladder.step(stepId, offset);
    if (to.id === from.id && stepId !== null) {
      return null;
    }
    this.selectLadderStep(to.id);
    this.emitter.emit('ladderMoved', { from, to, direction });
    return to;
  }

  /** Puts the reader on a named rung, adopting everything it stands for. */
  selectLadderStep(id: string): LadderStep | null {
    const step = this.deps.ladder?.find(id) ?? null;
    if (step === null) {
      return null;
    }
    this.resetLadderStreaks();
    // Resolved, not the rung's own delta: a rung says the one thing it moves,
    // and arriving at it has to bring everything the route had already set.
    this.updateSettings({
      ...this.deps.ladder?.resolve(step.id),
      ladderStepId: step.id,
    });
    return step;
  }

  /** The rung being read, or `null` when the axes were set by hand. */
  get ladderStep(): LadderStep | null {
    const stepId = this.currentSettings.ladderStepId;
    return stepId === null ? null : (this.deps.ladder?.find(stepId) ?? null);
  }

  /**
   * Forgets how the last readings went.
   *
   * A streak is about consecutive readings *at one rung*, so arriving at one
   * has to start it over - otherwise a reader sent down would be sent
   * straight back up by the two clean runs that came before the fall.
   */
  private resetLadderStreaks(): void {
    this.cleanReadings = 0;
    this.poorReadings = 0;
  }

  /**
   * Puts up the marks a finished run was holding back.
   *
   * Drawn on `finished`, which an abandoned run fires too: stopping is a
   * decision to look at what happened, and a reader who stops halfway and
   * sees a blank page has been given nothing for it.
   */
  private drawHeldMarks(): void {
    for (const mark of this.heldMarks) {
      this.deps.overlay.showPlayed(mark);
    }
    this.heldMarks = [];
  }

  /**
   * Whether the bar is running for this exercise.
   *
   * Needs a pulse to drain against: in Wait mode nothing moves without the
   * reader, so there is nothing to survive and the bar would sit still.
   */
  get survivalRuns(): boolean {
    return (
      this.currentSettings.survival &&
      this.deps.modes.get(this.currentSettings.modeId).requiresMetronome
    );
  }

  /** Where the bar stands, `0..1`. */
  get health(): number {
    return this.meter.health;
  }

  /**
   * Divisions as felt beats, in the metre the music is actually written in.
   *
   * The exercise's own signature and not the one in the settings: an opened
   * score keeps the metre it was written in, and the settings go on saying
   * whatever the generator was last asked for. Read from there, a 6/8 file
   * under a 4/4 setting drained half as fast again as it should.
   */
  private beatsFor(ticks: number): number {
    const signature = this.exercise?.timeSignature ?? this.currentSettings.timeSignature;
    return ticks / signature.ticksPerPulse;
  }

  /** How long a step lasts, in felt beats. */
  private beatsIn(step: TimelineStep | null | undefined): number {
    return step == null ? 0 : this.beatsFor(step.durationTicks);
  }

  /**
   * Announces the bar, and ends the run when it empties.
   *
   * Aborted rather than finished: the reader did not reach the end, and a
   * report that said otherwise would be the one lie this feature could tell.
   */
  private publishHealth(health: number, cause: 'drain' | 'settle'): void {
    this.emitter.emit('healthChanged', { health, cause });
    if (health <= 0) {
      this.currentSession?.abort();
    }
  }

  /**
   * Puts the marker where the reader's setting says it belongs.
   *
   * Except while the exercise is playing itself: a performance shows the
   * cursor whatever they chose, because following along is most of the value.
   * Re-engraving used to run this and take the marker away mid-playback -
   * which is what changing the tempo from the stand does.
   */
  private applyCursorVisibility(): void {
    if (this.currentSettings.showCursor || this.isListening) {
      this.deps.cursor.show();
    } else {
      this.deps.cursor.hide();
    }
  }

  private createProvider(): IExerciseProvider {
    const generator = this.deps.presets.get(this.currentSettings.presetId).generator;
    const factory =
      this.deps.providerFor ?? ((source: IExerciseGenerator) => new GeneratedExerciseProvider(source));
    return factory(generator);
  }
}

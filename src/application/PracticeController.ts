import type { ExercisePresetRegistry } from '../domain/generation/ExercisePresetRegistry.js';
import type { ExerciseRequest, IExerciseGenerator } from '../domain/generation/IExerciseGenerator.js';
import type { RhythmProfileRegistry } from '../domain/generation/RhythmProfile.js';
import type { Exercise } from '../domain/model/Exercise.js';
import type { KeySignature } from '../domain/model/KeySignature.js';
import type { TimeSignature } from '../domain/model/TimeSignature.js';
import type { IMusicXmlSerializer } from '../domain/notation/MusicXmlSerializer.js';
import type { ScoringStrategyRegistry } from '../domain/scoring/ScoringStrategyRegistry.js';
import { buildTimeline, type ExerciseTimeline } from '../domain/timeline/Timeline.js';
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
import type { ClickPattern } from './ports/IMetronome.js';
import type {
  IPlayedNoteOverlay,
  IScoreCursor,
  IScoreFade,
  IScoreRenderer,
  IScoreZoom,
} from './ports/IScoreRenderer.js';
import { clefAtMeasure, keyAtMeasure, measureCount } from '../domain/model/Exercise.js';
import { sliceExercise } from '../domain/model/exerciseSlice.js';
import { worstPassage, type Passage } from '../domain/scoring/troubleSpots.js';
import { PracticeSession } from './session/PracticeSession.js';

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
  readonly metronomeMuted: boolean;
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
  /** Bars of click, then as many silent ones. 0 clicks throughout. */
  readonly dropoutBars: number;
  readonly matchToleranceMs: number;
  readonly pitchClassOnly: boolean;
  /**
   * Draw the position marker on the score.
   *
   * Turning it off is a practice aid in its own right: it forces you to keep
   * your place by reading rather than by following the highlight.
   */
  readonly showCursor: boolean;
  /** Draw what was actually played over the engraving. */
  readonly showPlayedNotes: boolean;
  /** Dim each note once it has been passed, to push the eye forward. */
  readonly fadePassedNotes: boolean;
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
  /** Remembers how earlier readings of the same passage went. */
  readonly history?: PracticeHistory;
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

  constructor(dependencies: PracticeControllerDependencies) {
    this.deps = dependencies;
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
      metronomeMuted: false,
      clickPattern: 'pulse',
      handStaff: null,
      rangeFromBar: null,
      rangeToBar: null,
      repeatRange: false,
      dropoutBars: 0,
      matchToleranceMs: 250,
      pitchClassOnly: false,
      showCursor: true,
      showPlayedNotes: true,
      fadePassedNotes: false,
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
   * Applies settings.
   *
   * Changing the preset adopts that preset's defaults for anything the caller
   * did not explicitly override, which is what makes the level selector feel
   * like a difficulty ladder rather than a bag of unrelated switches.
   */
  updateSettings(changes: Partial<PracticeSettings>): PracticeSettings {
    let next: PracticeSettings = { ...this.currentSettings, ...changes };

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

    if (changes.showPlayedNotes === false) {
      this.deps.overlay.clearPlayed();
    }

    if (changes.fadePassedNotes === false) {
      this.deps.fade.clearFaded();
    }

    this.emitter.emit('settingsChanged', { settings: next });
    return next;
  }

  /** Generates fresh material and renders it. */
  async loadNewExercise(): Promise<Exercise> {
    // Asking for a new exercise is asking the generator for one, so an opened
    // file steps aside rather than being handed back unchanged.
    this.openedScore = null;
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
    this.player ??= new ExercisePlayer({
      metronome: this.deps.metronome,
      instrument: this.deps.instrument,
      cursor: this.deps.cursor,
    });
    this.deps.cursor.show();
    this.player.start(timeline, {
      staffNumber: this.currentSettings.handStaff,
      clickAudible: !this.currentSettings.metronomeMuted,
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
    const offset = (this.currentSettings.rangeFromBar ?? 1) - 1;
    const passage = { fromBar: found.fromBar + offset, toBar: found.toBar + offset };
    this.updateSettings({ rangeFromBar: passage.fromBar, rangeToBar: passage.toBar });
    return passage;
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
    this.player?.stop();
  }

  get isListening(): boolean {
    return this.player?.isPlaying ?? false;
  }

  /** Fires when a playback reaches the end on its own. */
  get playbackEvents(): IEventSource<{ started: Record<string, never>; finished: Record<string, never> }> {
    this.player ??= new ExercisePlayer({
      metronome: this.deps.metronome,
      instrument: this.deps.instrument,
      cursor: this.deps.cursor,
    });
    return this.player.events;
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
        },
        countInBars: this.currentSettings.countInBars,
        expectedStaff: this.currentSettings.handStaff,
        click: this.currentSettings.clickPattern,
        dropoutBars: this.currentSettings.dropoutBars,
        metronomeMuted: this.currentSettings.metronomeMuted,
      },
    });

    this.currentSession = session;
    this.deps.overlay.clearPlayed();
    this.deps.fade.clearFaded();

    this.sessionSubscriptions.push(
      // A step is dimmed the moment it is done with, whether it was played
      // well, badly or not at all: the page empties as the music passes.
      session.events.on('stepCompleted', ({ result }) => {
        if (this.currentSettings.fadePassedNotes) {
          this.deps.fade.fadePassed(result.index);
        }
      }),
    );

    this.sessionSubscriptions.push(
      // Every press is drawn where it was actually struck, right or wrong. A
      // repeat of a note already collected adds nothing to look at.
      session.events.on('noteJudged', ({ midi, verdict, stepIndex, deviationMs }) => {
        if (!this.currentSettings.showPlayedNotes || verdict === 'duplicate') {
          return;
        }
        this.deps.overlay.showPlayed({
          stepIndex,
          midi,
          correct: verdict === 'correct',
          offset: this.timingOffsetFor(stepIndex, deviationMs, session.tempoBpm),
        });
      }),
    );
    this.sessionSubscriptions.push(
      session.events.on('stepEntered', ({ step }) => {
        this.deps.cursor.moveTo(step.index);
      }),
    );
    this.sessionSubscriptions.push(
      session.events.on('finished', ({ report, score }) => {
        this.deps.history?.record(this.practiceKey(), {
          atMs: this.deps.clock.now(),
          overall: score.overall,
          grade: score.grade,
          completed: report.completed,
        });
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

  private applyCursorVisibility(): void {
    if (this.currentSettings.showCursor) {
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

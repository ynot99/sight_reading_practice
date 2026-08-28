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
import type { ClickPattern } from './ports/IMetronome.js';
import type {
  IPlayedNoteOverlay,
  IScoreCursor,
  IScoreFade,
  IScoreRenderer,
  IScoreZoom,
} from './ports/IScoreRenderer.js';
import type { ClefKind } from '../domain/model/Clef.js';
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
  readonly clock: IClock;
  readonly scorings: ScoringStrategyRegistry;
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
    return this.load(undefined);
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

    const request: ExerciseRequest = {
      measures: this.currentSettings.measures,
      timeSignature: this.currentSettings.timeSignature,
      key: this.currentSettings.key,
      tempoBpm: this.currentSettings.tempoBpm,
      rhythm: this.deps.rhythms.get(this.currentSettings.rhythmProfileId),
      ...(seed === undefined ? {} : { seed }),
    };

    const exercise = await this.provider.provide(request);
    const musicXml = this.deps.serializer.serialize(exercise);

    this.exercise = exercise;
    this.timeline = buildTimeline(exercise);
    this.lastSeed = exercise.metadata.seed;

    await this.deps.renderer.load(musicXml);
    this.deps.overlay.configureOverlay({
      key: exercise.key,
      clefByStaff: new Map<number, ClefKind>(
        exercise.staves.map((staff) => [staff.staffNumber, staff.clef]),
      ),
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
  start(): PracticeSession | null {
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

import type { ExercisePresetRegistry } from '../domain/generation/ExercisePresetRegistry.js';
import type { ExerciseRequest, IExerciseGenerator } from '../domain/generation/IExerciseGenerator.js';
import type { RhythmProfileRegistry } from '../domain/generation/RhythmProfile.js';
import type { Exercise } from '../domain/model/Exercise.js';
import type { KeySignature } from '../domain/model/KeySignature.js';
import type { TimeSignature } from '../domain/model/TimeSignature.js';
import type { IMusicXmlSerializer } from '../domain/notation/MusicXmlSerializer.js';
import type { PerformanceReport } from '../domain/scoring/PerformanceReport.js';
import type { ScoringStrategyRegistry } from '../domain/scoring/ScoringStrategyRegistry.js';
import {
  buildTimeline,
  expectedFor,
  type ExerciseTimeline,
  type TimelineStep,
} from '../domain/timeline/Timeline.js';
import { playedNoteOffset } from './playedNoteOffset.js';
import { TypedEventEmitter, type IEventSource, type Unsubscribe } from '../shared/EventEmitter.js';
import type { PracticeModeRegistry } from './modes/PracticeModeRegistry.js';
import type { IClock } from './ports/IClock.js';
import { GeneratedExerciseProvider, type IExerciseProvider } from './ports/IExerciseProvider.js';
import type { IMetronome } from './ports/IMetronome.js';
import type { IMidiSource, MidiEvent, MidiNoteOnEvent } from './ports/IMidiSource.js';
import type { IPitchPlayer } from './ports/IPitchPlayer.js';
import { ExercisePlayer } from './ExercisePlayer.js';
import type { PlayerEventMap } from './ExercisePlayer.js';
import type { PassageHistory, PracticeHistory } from './PracticeHistory.js';
import type { ClickWhen, ClickPattern } from './ports/IMetronome.js';
import type {
  PlayedNote,
  IPlayedNoteOverlay,
  IScoreCursor,
  IScoreFade,
  IStuckMarker,
  IScoreRenderer,
  IScoreZoom,
} from './ports/IScoreRenderer.js';
import {
  barNumberOf,
  clefAtMeasure,
  keyAtMeasure,
  measureCount,
  spanMs,
} from '../domain/model/Exercise.js';
import { worstPassage, type Passage } from '../domain/scoring/troubleSpots.js';
import { PracticeSession } from './session/PracticeSession.js';
import { ChordMatcher, type NoteVerdict } from '../domain/matching/ChordMatcher.js';
import { HealthMeter, type HealthMeterOptions } from '../domain/scoring/HealthMeter.js';
import type { LadderStep, PracticeLadder } from './ladder/PracticeLadder.js';

/** When the marks for what was played are put on the page. */
export const PLAYED_NOTE_DISPLAYS = ['live', 'at-end', 'hidden'] as const;

export type PlayedNoteDisplay = (typeof PLAYED_NOTE_DISPLAYS)[number];

/** Presses kept for the judging log; a bounded ring, not a history. */
const JUDGING_LOG_LENGTH = 300;

/** One press, and everything that decided what became of it. */
export interface JudgedPress {
  readonly midi: number;
  readonly verdict: NoteVerdict;
  /** The step it was given to, which is where its mark is drawn. */
  readonly stepIndex: number;
  /** That step's place in the music, in divisions. */
  readonly onsetTicks: number;
  readonly deviationMs: number | null;
  /** Where the mark sits, as a fraction of the gap to its neighbour. */
  readonly offset: number;
  readonly drawn: boolean;
  /** Why no mark was drawn, or empty when one was. */
  readonly why: string;
}

/** How far one press of the tempo buttons moves, as a percentage. */
export const TEMPO_STEP_PERCENT = 5;
/** Matches what the stored-settings codec will accept back. */
/**
 * How loudly the hand the reader is not playing is sounded.
 *
 * Under the reader's own playing rather than beside it: it is there to be
 * played *against*, and an accompaniment as loud as the part is a duet
 * nobody asked for.
 */
const OTHER_HAND_VELOCITY = 0.45;

const MIN_TEMPO_BPM = 20;
const MAX_TEMPO_BPM = 300;

/**
 * A written tempo taken at the reader's share of it.
 *
 * Kept inside what the metronome and the codec will accept: a quarter of a
 * very slow piece is slower than a metronome can go, and a written rallentando
 * to ten beats a minute is slower still.
 */
function scaledTempo(writtenBpm: number, percent: number): number {
  const bpm = Math.round((writtenBpm * percent) / 100);
  return Math.min(MAX_TEMPO_BPM, Math.max(MIN_TEMPO_BPM, bpm));
}
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
  /**
   * How fast the run goes against the tempo the music itself declares.
   *
   * A percentage and not a number of beats, because it is the reader's
   * choice and the beats are the material's. Stored this way for the same
   * reason: a bpm outlives the piece it was set against, so a tempo chosen
   * for a slow score came back on the next visit as "140%" of generated
   * material nobody had chosen it for. A percentage means the same thing
   * whatever is on the stand.
   */
  readonly tempoPercent: number;
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
   * Sound the hand the reader is not reading, as the music reaches it.
   *
   * Practising one hand against silence is practising something the piece
   * never asks for: the part only means what it means against the other one.
   * Off by default, because an accompaniment nobody asked for is a surprise
   * in the middle of a run.
   */
  readonly hearTheOtherHand: boolean;
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
  /**
   * How long a press takes to reach the page, in milliseconds.
   *
   * Taken off every timestamp before it is judged. A key struck on the beat is
   * not heard about on the beat - the keyboard scans, a relay forwards, the
   * tablet wakes - and without this the reader who plays perfectly reads
   * "late" on every note with no way to tell their own habit from the path
   * their notes travelled.
   */
  readonly inputLatencyMs: number;
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
  /**
   * Whether the marker is drawn, asked three times over.
   *
   * One flag could not hold this. A reader may want no marker at all while
   * *they* are playing - it is a crutch, and reading without it is the point
   * - and still want one while the machine plays the passage back, where
   * following along is most of the value. And a third answer for when
   * nothing is happening at all, which is how they see where they stopped.
   * The three are independent because the reader's reasons for them are.
   */
  readonly cursorWhileRunning: boolean;
  readonly cursorWhileListening: boolean;
  readonly cursorAtRest: boolean;
  /**
   * Whether missing the beat makes a right note count as a wrong one.
   *
   * A display decision and only that: what was played and how far off the
   * beat it was are measured the same either way, and how much timing counts
   * towards the grade is the scoring strategy's question, not this one. This
   * says what the *page* should show, and there are two honest answers - the
   * colour can mean "the right note", with the outline saying it was late, or
   * it can mean "the right note, in time", which is stricter and is how the
   * graded trainers mark it.
   */
  readonly strictTiming: boolean;
  /**
   * Whether the score is read by turning pages instead of by scrolling.
   *
   * The engraver lays a piece out as one tall column. That is right for
   * playing through with the cursor creeping upwards, and wrong for looking
   * through a piece before playing it, which is turning a page, reading it,
   * and turning the next.
   */
  readonly pagedScore: boolean;
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
  /**
   * Start the run by playing its first chord, rather than by pressing Start.
   *
   * The keyboard is listened to while nothing is running, and the moment the
   * opening the page asks for has been played the run begins - with no
   * count-in, since the reader has just set the tempo themselves by playing
   * it. Their hands are already on the keys; reaching for the tablet to
   * begin, and reaching back, is most of what starting costs.
   */
  readonly immediateStart: boolean;
  /**
   * Dim the music this run will not ask for.
   *
   * The hand that is not being read, and the bars outside the chosen
   * passage. Both are still worth having on the page - the neighbours say
   * what the passage is a passage *of*, and the other hand says what this one
   * is playing against - so they are dimmed rather than taken away, and less
   * than a note already played, which goes altogether.
   */
  readonly dimUnplayed: boolean;
  /** Show the top of the next page where the reader has finished reading. */
  readonly previewNextPage: boolean;
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
   * A run was thrown away without finishing.
   *
   * A run that ends says so through the session's own events, but a run that
   * is *taken away* has no session left to say it with - and everything
   * watching went on believing one was in progress. Starting a playback does
   * exactly that, so Start stayed disabled and Stop went on offering to stop
   * something that no longer existed.
   */
  sessionDiscarded: Record<string, never>;
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
  /** Says how much trouble the step under the marker is giving the reader. */
  readonly stuck: IStuckMarker;
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
  /** Where the next run begins, which the reader may have moved. */
  private beginAt = 0;
  /** The opening chord, while it is being waited for; see {@link watchForTheOpening}. */
  private opening: ChordMatcher | null = null;
  private openingPresses: MidiNoteOnEvent[] = [];
  private listeningForTheOpening: Unsubscribe | null = null;
  private openedScore: Exercise | null = null;
  private player: ExercisePlayer | null = null;
  /** The file the page is currently engraved from, so it is drawn once. */
  private engravedXml: string | null = null;
  /** Highest step already dimmed, so the veil is drawn once per step. */
  private fadedThrough = -1;
  /** Marks waiting for the run to end, when that is when they are drawn. */
  private heldMarks: PlayedNote[] = [];
  /** Wrong notes played at the step the marker is standing on. */
  private missteps = 0;
  /** Notes of the other hand still sounding, so a stop can take them back. */
  private readonly sounding = new Set<number>();
  private readonly meter: HealthMeter;
  private lastBeatTicks = 0;
  private readonly judged: JudgedPress[] = [];
  private finishedReport: PerformanceReport | null = null;
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
      tempoPercent: 100,
      countInBars: 1,
      clickPattern: 'pulse',
      handStaff: null,
      hearTheOtherHand: false,
      rangeFromBar: null,
      rangeToBar: null,
      repeatRange: false,
      ladderStepId: null,
      clickWhen: 'always',
      matchToleranceMs: 250,
      inputLatencyMs: 0,
      pitchClassOnly: false,
      rhythmOnly: false,
      previewSeconds: 0,
      cursorWhileRunning: true,
      cursorWhileListening: true,
      cursorAtRest: true,
      strictTiming: false,
      pagedScore: false,
      playedNotes: 'live',
      survival: false,
      readAheadSteps: null,
      zoom: 0.85,
      immediateStart: false,
      dimUnplayed: true,
      previewNextPage: true,
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
   * The first and last bar of the whole piece, in its own numbering.
   *
   * What a passage may be widened back out to. The engraving cannot say: a
   * passage is cut out and engraved on its own, so the bars outside it are
   * not on the page for anything to measure.
   */
  get pieceBarRange(): { readonly firstBar: number; readonly lastBar: number } {
    const firstBar = this.openedScore?.firstBarNumber ?? 1;
    return { firstBar, lastBar: firstBar + Math.max(1, this.wholePieceBars) - 1 };
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
      };
      this.currentSettings = next;
      // Changing what would be generated is a decision to generate again.
      this.openedScore = null;
      this.provider = this.createProvider();
    } else {
      this.currentSettings = next;
    }

    if (
      changes.cursorWhileRunning !== undefined ||
      changes.cursorWhileListening !== undefined ||
      changes.cursorAtRest !== undefined
    ) {
      this.applyCursorVisibility();
    }

    // The click is a thing the reader reaches for *while* playing, so it takes
    // effect there rather than at the next Start. A run stopped to answer a
    // button is the run they were asking about.
    if (changes.clickPattern !== undefined || changes.clickWhen !== undefined) {
      this.currentSession?.applyClick(next.clickPattern, next.clickWhen);
      this.player?.applyClick(next.clickPattern, next.clickWhen);
    }

    // The passage is a thing the reader reaches for *while* listening, so it
    // takes effect there too: clearing it means the rest of the piece should
    // now be heard, and a performance that read the stretch once at the start
    // went on playing the old one to the end.
    if (changes.rangeFromBar !== undefined || changes.rangeToBar !== undefined) {
      this.player?.retarget(this.passageSteps.to);
    }

    // Said now rather than at the end of the round: a reader who turns the
    // repeat off means this reading to be the last, and one who turns it on
    // means this one to come round - and neither should have to stop the
    // music to say so.
    if (changes.repeatRange !== undefined) {
      this.player?.setRepeating(changes.repeatRange);
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

    // Any of these changes what the run will ask for, or whether saying so
    // is wanted at all.
    if (
      changes.dimUnplayed !== undefined ||
      changes.handStaff !== undefined ||
      changes.rangeFromBar !== undefined ||
      changes.rangeToBar !== undefined
    ) {
      this.applyDimming();
    }

    if (changes.readAheadSteps !== undefined) {
      // Re-drawn from where the run actually is rather than left as it was:
      // moving the veil nearer must give the notes back, not only further
      // away take more.
      this.repaintFade();
    }

    // Any of these can change what the opening chord is, or whether there is
    // anything listening for one.
    this.watchForTheOpening();
    this.emitter.emit('settingsChanged', { settings: next });
    return next;
  }

  /**
   * Puts the reader's place in the music, for the next run to begin at.
   *
   * A bar line and not a note: a run that started halfway through a bar
   * would be counted in to a beat that is not the first one, and the reader
   * would be waiting for a downbeat that never came. Touching a note in the
   * middle of a bar therefore means that bar.
   *
   * Returns the step it settled on, or `null` when there was nothing there.
   */
  beginAtBar(measureIndex: number): number | null {
    const timeline = this.timeline;
    const bar = timeline?.steps.find((each) => each.measureIndex === measureIndex) ?? null;
    if (bar === null) {
      return null;
    }
    this.beginAt = bar.index;
    this.deps.cursor.moveTo(this.beginAt);
    // The run would now begin somewhere else, so the chord that starts it is
    // a different chord.
    this.watchForTheOpening();
    return this.beginAt;
  }

  /**
   * Forgets a place the reader had pointed at.
   *
   * Nought means "no place of my own", and a run then begins where the
   * passage does. It is not the same as pointing at bar one: pointing is a
   * one-off, and this is putting the one-off away.
   */
  beginAtTheStart(): void {
    this.beginAt = 0;
    this.watchForTheOpening();
  }

  /**
   * Puts the marker back at the beginning of what is being practised.
   *
   * Which is the passage, not the top of the piece. A reader who has
   * bracketed bars 20 to 27 is working on bars 20 to 27, and "the beginning"
   * means the beginning of that - anywhere else is a place they did not ask
   * for and, on a long piece, a page they were not looking at. The way back
   * to bar one is to widen the passage, which is one button and is itself
   * saying "the whole piece is what I am working on now".
   *
   * MuseScore is inconsistent here in a way worth avoiding: its rewind goes
   * to the top of the score while its playback starts at the selection, so
   * the two disagree about where the beginning is.
   */
  cursorToStart(): void {
    // `moveTo` and never `reset`, even for the top of the piece. A reset is
    // bookkeeping and the page deliberately does not follow one - which left
    // a reader who pressed the button on page three with the marker back at
    // bar one and page three still in front of them. Asking for a position
    // the marker already holds moves nothing and still says so, which is
    // exactly what is wanted here.
    this.deps.cursor.moveTo(this.passageSteps.from);
  }

  /** Which step the next run begins at; nought is the top of the piece. */
  get beginsAt(): number {
    return this.beginAt;
  }

  /**
   * The passage the reader chose, as the first and last step of it.
   *
   * The whole timeline when nothing is chosen. Bars come in as the score's
   * own numbers - what is printed on the page and typed into the boxes - and
   * a step knows which bar it is in, so this is where the two meet.
   */
  private get passageSteps(): { readonly from: number; readonly to: number } {
    const timeline = this.timeline;
    const last = timeline === null ? 0 : timeline.length - 1;
    if (timeline === null) {
      return { from: 0, to: 0 };
    }
    const { rangeFromBar, rangeToBar } = this.currentSettings;
    const first = this.exercise?.firstBarNumber ?? 1;
    const fromMeasure = rangeFromBar === null ? 0 : rangeFromBar - first;
    const toMeasure = rangeToBar === null ? Number.POSITIVE_INFINITY : rangeToBar - first;
    let from = last;
    let to = 0;
    for (const step of timeline.steps) {
      if (step.measureIndex >= fromMeasure && step.measureIndex <= toMeasure) {
        from = Math.min(from, step.index);
        to = Math.max(to, step.index);
      }
    }
    return to >= from ? { from, to } : { from: 0, to: last };
  }

  /** Generates fresh material and renders it. */
  async loadNewExercise(): Promise<Exercise> {
    // Asking for a new exercise is asking the generator for one, so an opened
    // file steps aside rather than being handed back unchanged - and the
    // speed it was being read at steps aside with it. Between one generated
    // exercise and the next it stays: that is the same stand with different
    // notes on it, and what the reader meant by eighty per cent still holds.
    if (this.openedScore !== null) {
      this.forgetTheSpeed();
    }
    this.openedScore = null;
    this.forgetThePassage();
    this.endThePerformance();
    return this.load(undefined);
  }

  /**
   * Ends a performance because the music it was of is being replaced.
   *
   * Not on every re-engraving: changing the tempo from the stand redraws the
   * page under a performance that is still the same music, and taking the
   * sound away for that would answer a question the reader did not ask.
   * Handing them a *different piece* is not that - left running, the
   * performance went on playing the notes of the piece before this one over
   * a page already engraved with the new one, and drove the marker across it
   * while it did.
   */
  private endThePerformance(): void {
    this.stopListening();
  }

  /**
   * Puts the markers back at the two ends, wherever they were dragged to.
   *
   * Bars 12-16 of the piece just closed mean nothing in the piece about to
   * open, and silently applying them would hand back a passage of something
   * the reader never asked to narrow. A range is about *this* music.
   */
  private forgetThePassage(): void {
    if (this.currentSettings.rangeFromBar !== null || this.currentSettings.rangeToBar !== null) {
      this.updateSettings({ rangeFromBar: null, rangeToBar: null });
    }
  }

  /**
   * Puts the reading speed back to what the music is written at.
   *
   * For the reason the passage goes back to the two ends: a percentage is a
   * share *of* something. Sixty per cent of the piece being learned says
   * nothing about the next piece, and carried across it opened every new
   * score at a speed the reader had never asked it for - the harder the
   * piece they had just been slowing down, the further from its own tempo
   * the next one started. What travels between pieces is the reader's habit
   * of choosing a speed, not the number they chose last.
   */
  private forgetTheSpeed(): void {
    if (this.currentSettings.tempoPercent !== 100) {
      this.updateSettings({ tempoPercent: 100 });
    }
  }

  /**
   * Practises a score that came from outside instead of from the generator.
   *
   * It stays until the reader asks for a new exercise or changes what would be
   * generated, so the two sources never quietly swap places underneath them.
   */
  async openScore(exercise: Exercise): Promise<Exercise> {
    // A different piece is a reason to forget the passage; the same piece
    // opened again is not. Identity is the title, which is what the library
    // means by "the same piece" too - a file read back after being edited in
    // MuseScore is the piece the reader was working on, and its id is minted
    // afresh by the parser on every read, so the id cannot answer this.
    if (this.openedScore === null || this.openedScore.title !== exercise.title) {
      this.forgetThePassage();
      this.forgetTheSpeed();
    }
    this.openedScore = exercise;
    this.endThePerformance();
    // Nothing to adopt: the file brings the tempo it is written at, which is
    // what 100% means - and a piece just opened is read at what it says
    // until the reader says otherwise.
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
    return Math.round(this.currentSettings.tempoPercent);
  }

  /**
   * The tempo the run is actually taken at.
   *
   * Worked out from the reader's percentage and whatever is on the stand, so
   * there is one number to keep and nothing that can fall out of step with
   * the music. Kept inside what the metronome and the codec will accept: a
   * quarter of a very slow piece is slower than a metronome can go.
   */
  get tempoBpm(): number {
    return this.tempoBpmForPercent(this.currentSettings.tempoPercent);
  }

  /**
   * Sets the tempo by naming the beats, which is what the bpm box does.
   *
   * The percentage keeps its fraction rather than being rounded here: the
   * box and the percentage are two views of one setting, and a value rounded
   * on the way in would come back as a different number of beats.
   */
  setTempoBpm(bpm: number): PracticeSettings {
    const base = this.baseTempoBpm;
    return this.updateSettings({ tempoPercent: base <= 0 ? 100 : (bpm / base) * 100 });
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
    const from = Math.round(this.tempoPercent / step) * step;
    this.updateSettings({ tempoPercent: clampPercent(from + deltaPercent) });
    return this.tempoPercent;
  }

  /**
   * The written tempo taken at a share of itself, in beats.
   *
   * Held to what a metronome can play and nothing narrower. The quarter-to-
   * double range belongs to the buttons, which is where a runaway press could
   * happen; a tempo typed in beats is a number the reader meant, and snapping
   * it back to a share of a preset they were not thinking about would be the
   * page arguing with them.
   */
  private tempoBpmForPercent(percent: number): number {
    return scaledTempo(this.baseTempoBpm, percent);
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
      tempoBpm: this.tempoBpm,
      rhythm: this.deps.rhythms.get(this.currentSettings.rhythmProfileId),
      ...(seed === undefined ? {} : { seed }),
    };

    return this.present(await this.provider.provide(request));
  }

  /** Engraves an exercise and makes it the one being practised. */
  private async present(source: Exercise): Promise<Exercise> {
    // An opened score keeps its own notes but takes the reader's tempo, so the
    // slider works on a file exactly as it works on generated material.
    // A score that changes tempo keeps its changes in proportion. The reader
    // set one number and meant one thing by it - take the whole piece at this
    // share of its written speed - and a Più mosso left at its own beats
    // would be the piece speeding up to somewhere they never asked for.
    const percent = this.currentSettings.tempoPercent;
    const retimed =
      this.openedScore === null
        ? source
        : {
            ...source,
            tempoBpm: this.tempoBpm,
            tempoChanges: source.tempoChanges.map((change) => ({
              ...change,
              tempoBpm: scaledTempo(change.tempoBpm, percent),
            })),
          };
    // The whole piece, always. A passage is practised by giving the run two
    // ends rather than by cutting the music down to it: the page keeps its
    // context, the bar numbers keep meaning what they say, and every seam a
    // cut has to repair - the restated clef, the tie let go of, the pedal
    // pressed again - stops existing rather than being handled.
    const exercise = retimed;
    // Engraved from the score *as written*, never at the share the reader is
    // taking it. A printed page states the tempo its writer chose and says
    // nothing about how fast anyone is playing it today - which is also why
    // it need not be drawn again when they change their mind. What speed the
    // run is actually going is the transport's to say, and it does.
    const musicXml = this.deps.serializer.serialize(source);

    // The same bytes are the same page. This one test answers both of the
    // questions a re-presentation asks - whether the engraver has anything
    // to draw again, and whether what the reader knows about the page is
    // still true - because they are the same question.
    const newMusic = musicXml !== this.engravedXml;

    this.exercise = exercise;
    this.timeline = buildTimeline(exercise);
    this.lastSeed = exercise.metadata.seed;
    if (newMusic) {
      // New music, so the reader's place in the old music means nothing.
      this.beginAt = 0;
    }

    // Only when the notes have changed. Engraving is two and a half seconds
    // on a long score against thirty milliseconds to write the file, so a
    // tempo nudge that redrew the page spent nearly all of its time redrawing
    // notes nobody had touched - and swallowed the next press while it did.
    if (newMusic) {
      this.engravedXml = musicXml;
      await this.deps.renderer.load(musicXml);
    }
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
    this.forgetTheTrouble();
    if (newMusic) {
      // And the marker goes back to the top of it. On music already on the
      // stand it stays where the reader put it: a tempo nudge is not a
      // request to start over, and the marker sent back to bar one while
      // page five stayed in front of them named a place they were not at.
      this.deps.cursor.reset();
    }
    this.applyCursorVisibility();

    this.watchForTheOpening();
    this.applyDimming();
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
  listen(fromStepIndex?: number): void {
    const timeline = this.timeline;
    if (timeline === null) {
      return;
    }
    this.disposeSession();
    const player = this.ensurePlayer();
    const passage = this.passageSteps;
    player.start(timeline, {
      staffNumber: this.currentSettings.handStaff,
      click: this.currentSettings.clickPattern,
      clickWhen: this.currentSettings.clickWhen,
      // Where the reader put their place, kept inside the passage they chose.
      // Hearing the music is part of learning the passage, so a playback that
      // always began at bar one made them listen through everything they were
      // not working on. Clamped either way, so a performance picked up after
      // a pause still lands inside a passage that moved while it was held.
      fromIndex: Math.min(Math.max(fromStepIndex ?? this.beginAt, passage.from), passage.to),
      toIndex: passage.to,
      // Round again inside the one performance, rather than by starting
      // another: stopping and starting is where the gap on a repeat came
      // from.
      repeat: this.currentSettings.repeatRange,
      // And round to the *passage*, wherever this performance was picked up.
      // A pause halfway through the bar being looped otherwise made that half
      // bar the loop.
      loopFromIndex: passage.from,
    });
    // After the performance has begun, not before: what the marker is for
    // now is whatever the reader asked for *a playback*, and until the player
    // is going there is no playback to ask about. Shown here regardless of
    // what they had said, this was one of the two places that made "hide the
    // marker" a setting the machine overruled.
    this.applyCursorVisibility();
    // Something is happening to the music now, so a press is a press and not
    // the beginning of a run.
    this.watchForTheOpening();
  }

  /**
   * Holds a performance where it is, to be picked up rather than restarted.
   *
   * Nothing about *what* to play is remembered with it: the way back in goes
   * through {@link listen} like any other, reading the passage, the click and
   * the hand from the reader's settings again. Only the place is kept.
   */
  pauseListening(): void {
    if (this.player?.isPlaying !== true) {
      return;
    }
    this.player.pause();
    this.applyCursorVisibility();
    this.watchForTheOpening();
  }

  /** Picks a held performance up where it left off. */
  resumeListening(): void {
    const at = this.player?.pausedAt ?? null;
    if (at === null) {
      return;
    }
    this.listen(at);
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
   * Sets the passage the markers were dragged around.
   *
   * Whole bars, because that is what a musician means: a passage begins at a
   * bar line, not partway through one. A run that began mid-bar would be
   * counted in to a beat that is not the first, and the reader would be
   * waiting for a downbeat that never came.
   *
   * Bars of the whole piece, and clamped to it here.
   *
   * Returns the passage now being practised, with `null` on both ends when
   * it turned out to be the whole piece after all.
   */
  choosePassage(fromBar: number, toBar: number): ChosenPassage {
    const { firstBar, lastBar } = this.pieceBarRange;
    const from = Math.min(Math.max(Math.round(fromBar), firstBar), lastBar);
    const to = Math.min(Math.max(Math.round(toBar), from), lastBar);

    // Pulled back out to both ends, it is not a passage any more. Saying so
    // in the one way the rest of the app already understands - no range at
    // all - is what keeps "the whole piece" a single state rather than two
    // that have to be kept in step.
    if (from === firstBar && to === lastBar) {
      this.updateSettings({ rangeFromBar: null, rangeToBar: null });
      return { fromBar: null, toBar: null };
    }
    this.updateSettings({ rangeFromBar: from, rangeToBar: to });
    return { fromBar: from, toBar: to };
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

  /**
   * The last run that reached an end, whatever has happened since.
   *
   * Not the live session's: that is replaced the moment anything starts
   * another run, and with repeat left on the replacement arrives before the
   * reader can look at what the last one measured. The offer to take the
   * input delay from "the last run" then sat there enabled and did nothing,
   * which is worse than being greyed out.
   *
   * A run belongs to the reader's hands and their keyboard, not to the piece,
   * so it outlives both the session and the material.
   */
  get lastReport(): PerformanceReport | null {
    return this.finishedReport;
  }

  /**
   * What was decided about the last few presses, in order.
   *
   * Kept because every fault in this part of the program has been invisible
   * from outside it: a mark in the wrong colour, or in the wrong place, or
   * missing altogether, all look the same on a page - like nothing happening.
   * The reader can hand this back, and it says which step a press was given
   * to, how far from that step's beat it was, and if no mark was drawn, why
   * not.
   *
   * A bounded ring, because it costs nothing to keep and a session that grew
   * one all day would be a leak in aid of a diagnosis nobody asked for.
   */
  get judgingLog(): readonly JudgedPress[] {
    return this.judged;
  }

  private remember(press: JudgedPress): void {
    this.judged.push(press);
    while (this.judged.length > JUDGING_LOG_LENGTH) {
      this.judged.shift();
    }
  }

  /** How earlier readings of this passage went, or `null` on a first visit. */
  passageHistory(): PassageHistory | null {
    return this.deps.history?.summary(this.practiceKey()) ?? null;
  }

  stopListening(): void {
    // A held performance counts: it is still a performance, and Stop is what
    // says there is not going to be one.
    if (this.player === null || (!this.player.isPlaying && this.player.pausedAt === null)) {
      return;
    }
    this.player.end();
    this.applyCursorVisibility();
    this.watchForTheOpening();
  }

  get isListening(): boolean {
    return this.player?.isPlaying ?? false;
  }

  /** Whether a performance is being held rather than played or ended. */
  get isListeningPaused(): boolean {
    return this.player?.pausedAt !== null && this.player?.pausedAt !== undefined;
  }

  /** Fires when a playback reaches the end on its own. */
  get playbackEvents(): IEventSource<PlayerEventMap> {
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

  /**
   * Listens for the opening chord while nothing is running.
   *
   * Armed and disarmed in one place rather than at each of the events that
   * change the answer - a run beginning or ending, a performance, a new
   * piece, the setting itself - because the question is always the same one:
   * is there music on the page with nothing happening to it.
   */
  private watchForTheOpening(): void {
    const status = this.currentSession?.status;
    const wanted =
      this.currentSettings.immediateStart &&
      this.timeline !== null &&
      // A session that has *ended* is not something happening: it is the
      // report of the last run, and it stays around to be read. Asked whether
      // a session exists at all, this armed itself again only when the next
      // one was created - so the feature worked once and then stopped.
      status !== 'running' &&
      status !== 'counting-in' &&
      status !== 'paused' &&
      // A held performance does count: the reader means to pick it up, and
      // playing over it would start a run instead.
      !this.isListening &&
      !this.isListeningPaused;
    if (!wanted) {
      this.listeningForTheOpening?.();
      this.listeningForTheOpening = null;
      this.opening = null;
      this.openingPresses = [];
      return;
    }
    if (this.listeningForTheOpening !== null) {
      this.armTheOpening();
      return;
    }
    this.armTheOpening();
    this.listeningForTheOpening = this.deps.midi.subscribe((event) => this.hearTheOpening(event));
  }

  /** Builds the matcher for whatever the run would now begin with. */
  private armTheOpening(): void {
    const timeline = this.timeline;
    const passage = this.passageSteps;
    const step = timeline?.at(Math.min(Math.max(this.beginAt, passage.from), passage.to)) ?? null;
    const expected = step === null ? [] : expectedFor(step, this.currentSettings.handStaff);
    this.openingPresses = [];
    // A step with nothing in it for this hand cannot be played, so there is
    // nothing to wait for and the watch stands down rather than starting the
    // run on the reader's next stray key.
    this.opening =
      expected.length === 0
        ? null
        : new ChordMatcher(
            expected,
            {
              toleranceMs: this.currentSettings.matchToleranceMs,
              pitchClassOnly: this.currentSettings.pitchClassOnly,
              anyPitch: this.currentSettings.rhythmOnly,
            },
            step?.ornamentMidi ?? [],
          );
  }

  /**
   * A press heard while nothing was running.
   *
   * Judged by the same matcher a run would judge it with, so the chord that
   * starts the run is exactly the chord the run then asks for - including
   * the reader's own tolerance, their octave rule, and the ornaments the
   * page offers but does not demand. A wrong note is not punished: nothing
   * is being graded yet, and the matcher simply goes on waiting.
   */
  private hearTheOpening(event: MidiEvent): void {
    const matcher = this.opening;
    if (matcher === null || event.type !== 'noteon') {
      return;
    }
    this.openingPresses.push(event);
    matcher.accept(event.midi, event.timestampMs);
    if (!matcher.completed) {
      return;
    }
    // No count-in: the reader has just played the tempo themselves, and
    // counting them in after that is asking them to wait for a bar they have
    // already begun.
    this.beginRun(0, this.openingPresses);
  }

  start(): PracticeSession | null {
    return this.beginRun(this.currentSettings.countInBars, []);
  }

  private beginRun(
    countInBars: number,
    opening: readonly MidiNoteOnEvent[],
  ): PracticeSession | null {
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
    const passage = this.passageSteps;
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
        countInBars,
        // Where the reader put the cursor, but never outside the passage
        // they chose: a place pointed at before the passage was narrowed is
        // no longer in the music being practised.
        startAtIndex: Math.min(Math.max(this.beginAt, passage.from), passage.to),
        stopAfterIndex: passage.to,
        expectedStaff: this.currentSettings.handStaff,
        inputLatencyMs: this.currentSettings.inputLatencyMs,
        click: this.currentSettings.clickPattern,
        clickWhen: this.currentSettings.clickWhen,
      },
    });

    this.currentSession = session;
    // Back to the first note before a beat of the count-in is heard. The
    // cursor used to be left wherever the run before it was paused until the
    // music began, so the reader spent the count-in looking at the wrong bar
    // - which is exactly the stretch the count-in exists to prepare them for.
    //
    // `reset`, not `moveTo(0)`: moving to a position the navigator believes it
    // is already at asks the engraver for nothing, so nothing is redrawn and
    // nothing is scrolled to.
    // Where the reader put the cursor, or the top of the piece. `reset`
    // rather than `moveTo(0)` for the second: moving to a position the
    // navigator believes it is already at asks the engraver for nothing, so
    // nothing is redrawn and nothing is scrolled to.
    const openAt = Math.min(Math.max(this.beginAt, passage.from), passage.to);
    if (openAt > 0) {
      this.deps.cursor.moveTo(openAt);
    } else {
      this.deps.cursor.reset();
      // The page a long piece was left scrolled to is not where bar one is.
      this.deps.renderer.scrollToStart();
    }
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
        const held = this.currentSettings.playedNotes === 'at-end';
        const why =
          this.currentSettings.playedNotes === 'hidden'
            ? 'marks are turned off'
            : verdict === 'duplicate'
              ? 'a note of this chord already collected'
              : held
                ? 'held back until the run ends'
                : '';
        this.remember({
          midi,
          verdict,
          stepIndex,
          onsetTicks: this.timeline?.at(stepIndex)?.onsetTicks ?? -1,
          deviationMs,
          offset: this.timingOffsetFor(stepIndex, deviationMs, session.tempoBpm),
          drawn: why === '',
          why,
        });
        // Before the marks have their say, and deliberately: this exists for
        // the reader who has turned them off.
        this.noteTheTrouble(verdict);
        if (this.currentSettings.playedNotes === 'hidden' || verdict === 'duplicate') {
          return;
        }
        const mark = {
          stepIndex,
          midi,
          // Right against the page, which is what the mark is about: a note
          // the other hand was going to play was read correctly.
          correct: verdict !== 'wrong',
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
        // A new step is nobody's fault yet.
        this.forgetTheTrouble();
        this.soundTheOtherHand(step);
      }),
    );
    this.sessionSubscriptions.push(
      session.events.on('finished', ({ report, score }) => {
        this.finishedReport = report;
        this.drawHeldMarks();
        // The marker reddens to say "you are stuck *here*, now". A run that
        // is over has no here and no now: what is left of it is the report
        // and the marks, and a marker still glowing red over the last chord
        // would be saying the reader is stuck on music they have finished.
        // Said for both ways a run can end, which both arrive here.
        this.forgetTheTrouble();
        // A run that is over takes back what it was still holding.
        this.silenceTheOtherHand();
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
        // Stopped, so back to the beginning of what is being practised -
        // which is the passage, not the top of the piece. A run that
        // *finished* is left where it finished: the reader has just played
        // to the end and putting the marker somewhere else is answering a
        // question they did not ask, and on a paged score it takes the page
        // out from under the last thing they played.
        if (status === 'aborted') {
          this.cursorToStart();
        }
        // A run that has ended leaves the music with nothing happening to it,
        // so the opening is worth listening for again - and the marker is
        // answered for by a different one of the reader's three answers.
        this.watchForTheOpening();
        this.applyCursorVisibility();
      }),
    );

    this.emitter.emit('sessionCreated', { session });
    // Before the session hears anything of its own: the watch and the run
    // would otherwise both be subscribed to the keyboard, and the presses
    // that started this run would arrive at the watch a second time.
    this.watchForTheOpening();
    session.start(opening);
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
    this.listeningForTheOpening?.();
    this.listeningForTheOpening = null;
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
    this.forgetTheTrouble();
    const had = this.currentSession !== null;
    this.currentSession?.dispose();
    this.currentSession = null;
    if (had) {
      // Nothing is running now, so the opening is worth listening for again.
      this.watchForTheOpening();
      this.emitter.emit('sessionDiscarded', {});
    }
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

  /**
   * Says what the run is about to ask for, so the rest can be dimmed.
   *
   * Here rather than in the view because the two halves of the answer are
   * both the controller's: which hand is being read, and which steps the
   * passage comes to. The view knows the setting; this knows the music.
   */
  private applyDimming(): void {
    if (!this.currentSettings.dimUnplayed || this.timeline === null) {
      this.deps.fade.dimUnplayed(null);
      return;
    }
    const passage = this.passageSteps;
    const hand = this.currentSettings.handStaff;
    this.deps.fade.dimUnplayed({
      staves: hand === null ? [] : [hand],
      from: passage.from,
      to: passage.to,
    });
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
  /**
   * Counts a wrong note against the step the marker is standing on.
   *
   * Only where the music waits for the reader. Under the pulse the marker has
   * moved on by the next beat, so reddening it there would be a flash rather
   * than a place - and the reader who turned the marker off would have it
   * blink back at them on every slip.
   */
  private noteTheTrouble(verdict: NoteVerdict): void {
    if (verdict !== 'wrong' || this.deps.modes.get(this.currentSettings.modeId).requiresMetronome) {
      return;
    }
    this.missteps += 1;
    this.deps.stuck.showTrouble(this.missteps);
    // Shown though the reader hid it: see {@link applyCursorVisibility}.
    this.applyCursorVisibility();
  }

  /**
   * Sounds the hand the reader is not reading, as the music reaches it.
   *
   * From the *step*, not from a second player. The same pulse and the same
   * cursor cannot serve two masters - a performance running under a run
   * would be two clocks arguing about where the music is - and there is no
   * need for one here: the session already says when the music arrives
   * somewhere, in both modes and for its own reasons. Under the pulse that
   * is the beat falling; in Wait mode it is the reader finishing the chord
   * before, which is exactly when the next one should answer them.
   *
   * Each note is held for as long as it is written, read off `spanMs` so a
   * written change of speed is honoured. What it does *not* carry is the
   * pedal or a rolled chord - both belong to the performance the player
   * gives, and this is an accompaniment rather than a performance.
   */
  private soundTheOtherHand(step: TimelineStep): void {
    const hand = this.currentSettings.handStaff;
    const exercise = this.exercise;
    // With both hands being read there is no other hand to hear.
    if (!this.currentSettings.hearTheOtherHand || hand === null || exercise === null) {
      return;
    }
    const now = this.deps.clock.now();
    for (const note of step.notes) {
      if (note.staffNumber === hand) {
        continue;
      }
      this.deps.instrument.play(note.midi, OTHER_HAND_VELOCITY);
      this.deps.instrument.stop(
        note.midi,
        now + spanMs(exercise, step.onsetTicks, step.onsetTicks + note.durationTicks),
      );
      this.sounding.add(note.midi);
    }
  }

  /** Takes back what the other hand was still holding when the run ended. */
  private silenceTheOtherHand(): void {
    for (const midi of this.sounding) {
      this.deps.instrument.stop(midi);
    }
    this.sounding.clear();
  }

  /** Puts the marker back to itself, the trouble being over or elsewhere. */
  private forgetTheTrouble(): void {
    if (this.missteps === 0) {
      return;
    }
    this.missteps = 0;
    this.deps.stuck.showTrouble(0);
    this.applyCursorVisibility();
  }

  /**
   * Which of the three answers is the one being asked now.
   *
   * A held playback is still a playback and a paused run is still a run: the
   * reader means to pick both up, and what the marker is for does not change
   * while they are held.
   */
  private wantsCursorNow(): boolean {
    if (this.isListening || this.isListeningPaused) {
      return this.currentSettings.cursorWhileListening;
    }
    const status = this.currentSession?.status;
    const running = status === 'running' || status === 'counting-in' || status === 'paused';
    return running ? this.currentSettings.cursorWhileRunning : this.currentSettings.cursorAtRest;
  }

  /** Whether the marker is on show for whatever is happening now. */
  get cursorShownNow(): boolean {
    return this.wantsCursorNow();
  }

  /**
   * Turns the marker on or off for whatever is happening now.
   *
   * The button beside the music acts on the state the reader is in, the way
   * every other button in that row does: pressed during a run it answers for
   * runs, during a playback for playbacks. Which of the three it moved is
   * not a thing the page has to explain, because it is the one the reader
   * was looking at when they pressed it.
   */
  toggleCursorNow(): PracticeSettings {
    const wanted = !this.wantsCursorNow();
    if (this.isListening || this.isListeningPaused) {
      return this.updateSettings({ cursorWhileListening: wanted });
    }
    const status = this.currentSession?.status;
    const running = status === 'running' || status === 'counting-in' || status === 'paused';
    return this.updateSettings(
      running ? { cursorWhileRunning: wanted } : { cursorAtRest: wanted },
    );
  }

  private applyCursorVisibility(): void {
    // A step that keeps going wrong shows the marker whatever the reader
    // asked for. Practising with every colour off is reading blind on
    // purpose, but blind they cannot tell *where* it went wrong - only that
    // it did. The marker comes back for exactly as long as there is
    // something to say, and it says it by reddening rather than by adding
    // anything to the page.
    if (this.missteps > 0 || this.wantsCursorNow()) {
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

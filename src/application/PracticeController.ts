import type { ExercisePresetRegistry } from '../domain/generation/ExercisePresetRegistry.js';
import type { ExerciseRequest, IExerciseGenerator } from '../domain/generation/IExerciseGenerator.js';
import type { RhythmProfileRegistry } from '../domain/generation/RhythmProfile.js';
import type { Exercise } from '../domain/model/Exercise.js';
import type { PlayingAhead } from './session/PracticeContext.js';
import type { KeySignature } from '../domain/model/KeySignature.js';
import type { TimeSignature } from '../domain/model/TimeSignature.js';
import type { IMusicXmlSerializer } from '../domain/notation/MusicXmlSerializer.js';
import { printedAtEachStep } from '../domain/notation/printedIds.js';
import type { PerformanceReport, StepStatus } from '../domain/scoring/PerformanceReport.js';
import { theReadingPicture, type ReadingPicture } from '../domain/scoring/ReadingPicture.js';
import { modesOn } from './modes/challengeModes.js';
import { pieceOfKey } from './PracticeHistory.js';
import { beatAt, beatsBetween } from './session/metronomePlan.js';
import type { ScoringStrategyRegistry } from '../domain/scoring/ScoringStrategyRegistry.js';
import {
  buildTimeline,
  expectedFor,
  soundsFor,
  type ExerciseTimeline,
  type TimelineStep,
} from '../domain/timeline/Timeline.js';
import { playedNoteOffset } from './playedNoteOffset.js';
import { drillTaskPassed, planTheDrill, type DrillTask } from './drill/SectionDrill.js';
import type { ScoreOrder, WhatOpens } from './ScoreLibrary.js';
import type { PageTurns } from './ports/IScoreRenderer.js';
import { keysOf, type KeyboardSize } from '../domain/generation/keyboards.js';
import type { PitchRange } from '../domain/generation/voices/IVoiceGenerator.js';
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
import type {
  ClickWhen,
  BeatWeight,
  ClickPattern,
  ClickSilence,
  CountInWhen,
} from './ports/IMetronome.js';
import { clickFollowsTheReader, clickIsSilent } from './ports/IMetronome.js';
import { PracticeTimer } from './PracticeTimer.js';
import {
  rulerMarks,
  rulerMarksBetween,
  rulerStepTicks,
  type RulerDivision,
  type RulerMark,
} from './rhythmRuler.js';
import type {
  PlayedNote,
  IPlayedNoteOverlay,
  IScoreCursor,
  IScoreFade,
  IRhythmRuler,
  IStuckMarker,
  IScoreRenderer,
  IScoreZoom,
} from './ports/IScoreRenderer.js';
import {
  barLines,
  barNumberOf,
  clefAtMeasure,
  keyAtMeasure,
  measureCount,
  measureIndexAt,
  spanMs,
  velocityAt,
} from '../domain/model/Exercise.js';
import { worstPassage, type Passage } from '../domain/scoring/troubleSpots.js';
import { PracticeSession } from './session/PracticeSession.js';
import { ONE_BREATH_MS } from './session/RunRoll.js';
import type { RunRoll } from './session/RunRoll.js';
import { machineIsPlaying } from './modes/ListenFrame.js';
import { ChordMatcher, type NoteVerdict } from '../domain/matching/ChordMatcher.js';
import { HealthMeter, type HealthMeterOptions } from '../domain/scoring/HealthMeter.js';
import type { LadderStep, PracticeLadder } from './ladder/PracticeLadder.js';
import { timeTheStart } from '../shared/timeTheStart.js';

/** When the marks for what was played are put on the page. */
/**
 * When the marks of what was played are on the page.
 *
 * `while-held` is his own, from a mode where the page silts up with red: a
 * reader hunting for an accidental leaves a wrong note behind on every try,
 * and by the tenth the note they are looking for is under them. So a wrong
 * one lasts as long as the key does - and every one of them comes back at
 * the end, which is when they are worth reading.
 */
export const PLAYED_NOTE_DISPLAYS = ['live', 'while-held', 'at-end', 'hidden'] as const;

export type PlayedNoteDisplay = (typeof PLAYED_NOTE_DISPLAYS)[number];

/** Presses kept for the judging log; a bounded ring, not a history. */
const JUDGING_LOG_LENGTH = 300;
/**
 * How long "not now" lasts by default, where nothing says how long.
 *
 * Long enough that the answer is respected and short enough that it is still
 * the same sitting. Skipping is the other answer and asks for the whole
 * interval again; neither restarts the clock, because they have still been
 * sitting for an hour and that is why it was offered.
 */
const REST_PUT_OFF_MS = 3 * 60_000;

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
   * Whether a run counts in every time it goes round, or only the first.
   *
   * `never` is said with the bars rather than here: nought bars is no
   * count-in, and two answers for one thing would let them disagree.
   */
  /** Which clicks are left out, so the reader has to supply them. */
  readonly clickSilences: ClickSilence;
  /**
   * The keyboard in the room, so exercises are written for keys he has.
   *
   * Only generated material: an imported score is what its writer wrote, and
   * moving it would be rewriting the piece rather than choosing an exercise.
   */
  readonly keyboard: KeyboardSize;
  readonly countInRun: CountInWhen;
  /** And the same question of a playback, which has never had one at all. */
  readonly countInPlayback: CountInWhen;
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
   * Whether beating the hand the reader is hearing counts against them.
   *
   * His: late is allowed and early is not. A waiting mode stands still until
   * the notes arrive, so nothing there can be late - but the accompaniment
   * placed against the reader's last press does not stand still, and a press
   * that lands before the music reached it is a reader going past the thing
   * they asked to play with. Inert without that other hand, where there is
   * nothing to be early against.
   */
  readonly rushingCounts: boolean;
  /**
   * Whether playing along with a performance is marked on the page.
   *
   * His: he plays along with the playback and wants to see whether he is
   * landing on the right notes. Off by default, because a performance is also
   * how a piece is *listened* to, and a page filling with red while nobody is
   * being judged would be the program marking a reader who never asked to be.
   */
  readonly markWhileListening: boolean;
  /**
   * Whether the notes a performance is sounding are lit as it passes them.
   *
   * A different question from marking what the reader plays, and his own: one
   * says "check yourself", the other says "watch where the music is". The
   * marker already says which beat, and this says which notes of it - which
   * is the part a dense texture hides.
   */
  readonly showPlaybackNotes: boolean;
  /**
   * Whether the picture of a run scrolls past a standing cursor as it plays.
   *
   * His: "зробити курсор sticked на саме ліво, та скролиться не тільки курсор,
   * а й саме вікно разом із курсором щоб це було плавно, та буде це як падаючі
   * ноти." The other way round is the same two things moving - the head walks
   * the grid and the grid is nudged along when the head nears its edge - and
   * at speed the nudges are what the eye follows instead of the music.
   */
  readonly rollScrollPlayback: boolean;
  /**
   * How far into the picture that cursor stands, as a percentage of the width
   * the music is drawn in: nought against the keys, fifty in the middle.
   *
   * His, asked of the same cursor: "додати відсотки на якому offset має
   * знаходитись цей курсор". No further than the middle, because while the
   * music plays it is the part still to come that is being looked at.
   */
  readonly rollHeadAtPercent: number;
  /**
   * Bars to practise, one-based and inclusive, or `null` for the whole thing.
   *
   * Counted in *playing order* rather than by the number printed on the page,
   * and the two are different the moment a piece repeats: a repeat is written
   * out, so the page says "5" twice and the sixth bar played is the second
   * of them. Held to the printed number, a passage could not say which of the
   * two it meant - and, converted back by subtracting the first bar's number,
   * it landed as many bars early as the piece had re-read. Measured on City
   * of Tears: a hold on the thirty-eighth bar put the marker on the
   * thirty-second, six being exactly the bars read twice before it.
   *
   * What the reader sees printed is `barNumber`, and the page carries both -
   * the writer's number, and this one beside it where they part company.
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
  /**
   * What a press belonging to a later beat means, where the music waits.
   *
   * His, and he asked for both answers: some readers press the next note to
   * get to it, and some are learning not to press early at all. Where nothing
   * keeps time but the reader, that difference is the whole of what the mode
   * is teaching, so it is theirs to say.
   */
  readonly playingAhead: PlayingAhead;
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
   * In rhythm only, whether a press sounds the notes written at that beat
   * instead of the key that was pressed.
   *
   * The key is ignored for judging already; this ignores it for the ear too,
   * so a rhythm tapped on one key comes out as the music - and a rhythm
   * tapped wrong comes out as the music gone wrong, which is the lesson. A
   * piano that sounds its own keys has to be turned down for it. His.
   */
  readonly rhythmSoundsTheMusic: boolean;
  /**
   * Whether a Sync button stands by the clock while this device has something
   * the drive has not had. His, and his to turn on.
   */
  readonly offerToSync: boolean;
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
   * Whether a repeated bar says what the writer called it.
   *
   * His: knowing that a bar is being read a second time is worth having, and
   * worth being able to put away. What this hides is the writer's own number
   * and the turning arrow beside it - never the number in the corner, which
   * says where in the *playing* this bar is and is what the marker, the
   * report and the passage all count by.
   */
  readonly showRepeatNumbers: boolean;
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
   * How much of the survival bar a beat found in Wait mode is worth, `10..100`.
   *
   * His. Filling it outright makes a clock that only punishes stopping: find
   * one beat and the bar is full again however long the last one took. A
   * share asks the reader to keep finding them, and is the difference between
   * a bar that measures hesitation and one that measures paralysis.
   */
  readonly survivalRefillPercent: number;
  /**
   * Whether wrong notes cost anything where nothing keeps time.
   *
   * His, and the hole he named: a beat found through five wrong notes filled
   * the bar exactly as a clean one did, so in that mode nothing was ever
   * survived. Off by default, because hunting for a note is what Wait mode is
   * for and a reader who wants it held against them should say so.
   */
  readonly survivalPunishesMistakes: boolean;
  /**
   * End the run at the first wrong note.
   *
   * His line 112, and his reason for it: counting a rhythm is worth nothing
   * if a slip can be played over, so the run stops and has to be started
   * again on purpose. Which is also why it does not restart itself - a run
   * that began again by itself would be one nobody had decided to make.
   *
   * The marker goes back where a stopped run always puts it: the beginning
   * of the passage being practised, not the top of the piece.
   */
  readonly stopAtAMistake: boolean;
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
  /**
   * How the pages are turned, where the score is read as pages at all.
   *
   * One question with three answers rather than a switch beside a behaviour
   * nobody could turn off: `preview` turns the page as the music leaves it
   * and shows the top of the next one while the last system is being played;
   * `automatic` turns it and shows nothing; `manual` leaves it to the reader,
   * which is for a piece already learned, where looking up to find the page
   * has turned itself is worse than not looking up at all.
   */
  readonly pageTurns: PageTurns;
  /** How finely the beat is ruled through the bars, or `off`. */
  readonly rhythmRuler: RulerDivision;
  /**
   * What is on the stand when the page opens.
   *
   * Kept here with the rest of what the reader has chosen, although nothing
   * in this controller acts on it: the page reads it once, on the way in, and
   * a second store for one preference would be a second thing to back up and
   * restore.
   */
  readonly whatOpens: WhatOpens;
  /**
   * The order the shelf of kept scores is read in.
   *
   * Here for the reason `whatOpens` above it is: nothing in this controller
   * acts on it, the page reads it, and a second store for one preference would
   * be a second thing to back up and restore. His: "цей фільтр має
   * запамятовуватись".
   */
  readonly scoreOrder: ScoreOrder;
  /**
   * Print, in the console, how long each stage of starting took.
   *
   * For finding what makes a long score slow to begin; see `timeTheStart`.
   * Here with the rest of what the reader has chosen, for the reason the two
   * above are: nothing in this controller acts on it, and a second store for
   * one preference would be a second thing to back up and restore.
   */
  readonly traceTheStart: boolean;
  /**
   * Run a marker along the ruler, beat by beat.
   *
   * Not the same thing as the marker on the notes. Under a held note that one
   * stands still while the beats go on passing, and the gap between the two
   * is exactly where a reader loses count.
   */
  readonly rulerCursor: boolean;
  /**
   * How strongly the ruler is drawn, from nothing at all to full.
   *
   * A display decision and nothing else: at nought the lines are invisible
   * and the bars are still spaced by time, which is a page some readers will
   * want - the evenness is what makes the rhythm legible, and the lines only
   * say where the beats are on it.
   */
  readonly rulerStrength: number;
  /**
   * How long to play before being reminded to rest, in minutes; `0` for never.
   *
   * The reminder is the reader's own idea and their own note about it says
   * the important half: never in the middle of playing. So this settles when
   * a rest falls *due*, and nothing else - when it is actually said is a
   * question about what is happening, not about the clock.
   */
  readonly restEveryMinutes: number;
}

export interface ExerciseLoadedEvent {
  readonly exercise: Exercise;
  readonly timeline: ExerciseTimeline;
  readonly musicXml: string;
}

export interface ControllerEventMap {
  settingsChanged: { readonly settings: PracticeSettings };
  exerciseLoaded: ExerciseLoadedEvent;
  /**
   * A run has been built and may be listened to, but has not begun.
   *
   * Announced separately from {@link sessionCreated} so that binding to a run
   * and *drawing* it are two moments. Binding is a handful of subscriptions;
   * drawing is the transport, the chrome and the verdict being put away, and all
   * of that used to happen between the reader's key going down and the first
   * thing the run does with it. On a frame that runs no pulse that first thing
   * is a click placed at the moment of the press - a moment already gone - so
   * every millisecond of drawing in front of it was a millisecond the reader
   * heard as lateness. His: "щось я відчуваю буд-то є якась затримка у wait for
   * notes режимі".
   */
  sessionBuilt: { readonly session: PracticeSession };
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
   * Whether the engraver is drawing a page right now.
   *
   * Seconds on a long score, and more of them since the bars can be ruled:
   * room is made in every bar and the engraver has that much more to place.
   * The page it is replacing stays on screen while it works, so without this
   * the reader has asked for something and nothing whatever has happened.
   */
  engraving: { readonly busy: boolean };
  /**
   * What the drill is asking for now, and how far through the plan it is.
   *
   * A `null` task with `at` equal to `of` means the piece has been through
   * the whole plan; a `null` task with both at nought means the reader put
   * the drill away.
   */
  drillChanged: {
    readonly task: DrillTask | null;
    readonly at: number;
    readonly of: number;
  };
  /**
   * The reader has been at it long enough, and nothing is happening.
   *
   * Both halves matter. A rest falls due on the clock; it is *said* at the
   * first moment the music is not going, because a reminder that interrupts
   * a run is a reminder to be resented and then turned off.
   */
  /**
   * The hand the reader is not playing arrives at a step, and when.
   *
   * A moment in the future, because that is how everything the accompaniment
   * does is said: the sound is handed to the instrument ahead of time and the
   * page is told the same number. What acts on it is the view, which is the
   * layer allowed a timer - the run itself has none by design, and the one
   * clock it could borrow is a pulse that only exists when the reader has
   * asked for a click.
   */
  otherHandReached: { readonly stepIndex: number; readonly atMs: number };
  restDue: { readonly sittingMs: number };
  /**
   * The beats about to pass, and when each of them falls.
   *
   * Said ahead rather than one at a time, because in a mode that waits there
   * is nothing to say them *with*: the music between two of the reader's
   * entries is nobody's to play, and the run reaches it all at once. The
   * moments are on the page's own clock, and timing them is the view's -
   * the application layer has no timer, and never wants one.
   */
  beatsAhead: { readonly beats: readonly { readonly mark: RulerMark; readonly atMs: number }[] };
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
  /** Rules the beat through the bars, for reading the rhythm off the page. */
  readonly ruler: IRhythmRuler;
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
  /** Which step the chord being waited for belongs to; see {@link armTheOpening}. */
  private openingBeginsAt: number | null = null;
  /** The opening chord, while it is being waited for; see {@link watchForTheOpening}. */
  private opening: ChordMatcher | null = null;
  private openingPresses: MidiNoteOnEvent[] = [];
  private listeningForTheOpening: Unsubscribe | null = null;
  private openedScore: Exercise | null = null;
  private player: ExercisePlayer | null = null;
  /** The music the page is currently showing, so it is drawn once. */
  private engravedXml: string | null = null;
  /** And what was actually handed to the engraver, spacers and all. */
  private printedXml: string | null = null;
  /** Highest step already dimmed, so the veil is drawn once per step. */
  private fadedThrough = -1;
  /** Marks waiting for the run to end, when that is when they are drawn. */
  private heldMarks: PlayedNote[] = [];
  /** The step a performance has reached, which is what playing along is against. */
  private listeningStep = 0;
  /** The subscription that marks a reader playing along, while there is one. */
  private playAlong: Unsubscribe | null = null;
  /** The notes a performance is lighting right now, so they can be put out. */
  private litNotes: { readonly stepIndex: number; readonly midi: number }[] = [];
  /** The plan being worked through, or `[]` when nothing is being drilled. */
  private drill: readonly DrillTask[] = [];
  private drillAt = 0;
  /** When the waiting bar was last drained, on the page's own clock. */
  private lastWaitDrainMs: number | null = null;
  /** Wrong marks on the page only while their key is down. */
  private lentMarks: PlayedNote[] = [];
  /** Wrong notes played at the step the marker is standing on. */
  private missteps = 0;
  /** Notes of the other hand still sounding, so a stop can take them back. */
  private readonly sounding = new Set<number>();
  /**
   * When the reader last moved the music on, and where the music was then.
   *
   * A mode that waits has no clock of its own: it reaches every step the
   * reader owes nothing on the instant it can, so their music has to be laid
   * back out in the time it is written in, measured from the moment the
   * reader last played. Without it the whole phrase between two entries
   * arrived as one cluster with no rhythm in it at all.
   */
  private otherHandAnchor: { readonly wallMs: number; readonly ticks: number } | null = null;
  /**
   * Where the reader last took the music to, and when.
   *
   * The whole of what the picture of a waiting run needs, and not held by the
   * other hand's anchor above even though both are read off the same entry: the
   * accompaniment's is taken away when a run is walked away from and seeded
   * with "now" where there is none, and an entry asked whether it was late wants
   * neither. Nothing else in a waiting frame knows when a moment of the music
   * *fell due* - the reader is the clock there - so the moment it was ready is
   * only ever the entry before it plus the distance the score puts between the
   * two.
   */
  private readersLastEntry: { readonly atMs: number; readonly ticks: number } | null = null;
  private readonly meter: HealthMeter;
  /** How long the reader has been at the keyboard; see {@link PracticeTimer}. */
  private readonly timer = new PracticeTimer();
  /** Whether a rest is owed but has not been said yet. */
  private restOwed = false;
  /** Whether the reader has been told about this one already. */
  private restSaid = false;
  /** How long they must have been sitting before it is offered again. */
  private restDueAtMs: number | null = null;
  private hearingNotes: Unsubscribe | null = null;
  private watchingThePedal: Unsubscribe | null = null;
  /** Whether the sustain pedal is down, run or no run; see {@link rememberThePedal}. */
  private pedalIsDown = false;
  private lastBeatTicks = 0;
  private readonly judged: JudgedPress[] = [];
  private finishedReport: PerformanceReport | null = null;
  /**
   * What the last run did, kept past the session that did it.
   *
   * The report outlives its session because it is read afterwards, and the
   * picture of the run is read at exactly the same moment and from the same
   * panel - so it is kept in the same way. Taken at `finished` rather than
   * asked of the session later: by the time the reader presses the button the
   * session may be gone.
   */
  private finishedRoll: RunRoll | null = null;
  private cleanReadings = 0;
  private poorReadings = 0;

  constructor(dependencies: PracticeControllerDependencies) {
    this.deps = dependencies;
    this.meter = new HealthMeter(dependencies.health);
    this.hearNotesForTheTimer();
    this.rememberThePedal();
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
      // Every time round, which is what a run has always done: each lap of a
      // repeat is a new run, and each one counted itself in.
      clickSilences: 'nothing',
      keyboard: 'any',
      countInRun: 'every',
      // And a playback has never had one.
      countInPlayback: 'never',
      clickPattern: 'pulse',
      handStaff: null,
      hearTheOtherHand: false,
      markWhileListening: false,
      rushingCounts: true,
      showPlaybackNotes: false,
      rollScrollPlayback: false,
      // A finger's width of what has just been played still behind it: a head
      // hard against the keys reads as a drawing that has been cut off rather
      // than one that is moving.
      rollHeadAtPercent: 15,
      rangeFromBar: null,
      rangeToBar: null,
      repeatRange: false,
      ladderStepId: null,
      clickWhen: 'always',
      matchToleranceMs: 250,
      inputLatencyMs: 0,
      playingAhead: 'a-mistake',
      pitchClassOnly: false,
      rhythmOnly: false,
      rhythmSoundsTheMusic: false,
      offerToSync: false,
      previewSeconds: 0,
      cursorWhileRunning: true,
      cursorWhileListening: true,
      cursorAtRest: true,
      strictTiming: false,
      pagedScore: true,
      showRepeatNumbers: true,
      playedNotes: 'live',
      survival: false,
      survivalRefillPercent: 100,
      survivalPunishesMistakes: false,
      stopAtAMistake: false,
      readAheadSteps: null,
      zoom: 0.85,
      immediateStart: false,
      dimUnplayed: true,
      pageTurns: 'preview',
      rhythmRuler: 'off',
      // A new exercise, which is what opening this has always done.
      whatOpens: 'generated',
      // The order the shelf has always been in.
      scoreOrder: 'recent',
      traceTheStart: false,
      rulerCursor: false,
      rulerStrength: 1,
      restEveryMinutes: 30,
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

  /**
   * What the history files this piece's readings under, whichever bars of it
   * are being read.
   *
   * The key without its passage, so a list narrowed to "this piece" holds the
   * readings of the whole of it and of every stretch inside it - which is
   * what a reader working through a piece has been doing all afternoon.
   */
  get pieceKey(): string {
    return pieceOfKey(this.practiceKey());
  }

  /**
   * Where each judged entry fell in the run, in milliseconds from its first.
   *
   * What the spacing axis of the profile is read against: the music's own
   * clock, so a passage that slows down is not read as a reader who drifted.
   * Asked of the controller because the timeline is its, and the same answer
   * serves the chart after a run and the picture the history keeps.
   */
  whereTheJudgedEntriesFall(report: PerformanceReport): readonly number[] {
    const timeline = this.timeline;
    const exercise = timeline?.exercise ?? null;
    if (timeline === null || exercise === null) {
      return [];
    }
    const from = timeline.at(report.steps[0]?.index ?? 0)?.onsetTicks ?? 0;
    return report.steps
      .filter((step) => step.deviationMs !== null)
      .map((step) => {
        const onset = timeline.at(step.index)?.onsetTicks;
        return onset === undefined ? 0 : spanMs(exercise, from, onset);
      });
  }

  /**
   * What a reading looked like, for the history to keep.
   *
   * Drawn as the run ends rather than when it is next opened: the profile is
   * read against the timeline and the mode of the run it belongs to, and a
   * week later those belong to whatever is open then.
   */
  private pictureOfTheReading(report: PerformanceReport, roll: RunRoll): ReadingPicture {
    const bars =
      this.exercise === null
        ? new Set(report.steps.map((step) => step.measureIndex)).size
        : (this.exercise.staves[0]?.measures.length ?? 0);
    return theReadingPicture({
      report,
      bars,
      velocities: roll.presses.map((press) => press.velocity),
      keepsTime: this.deps.modes.get(this.currentSettings.modeId).requiresMetronome,
      owedAtMs: this.whereTheJudgedEntriesFall(report),
      toleranceMs: this.currentSettings.matchToleranceMs,
    });
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
   * Which bar of the playing a place in the music falls in, counted from one.
   *
   * The number a passage is chosen in, so that a stretch pointed at in the
   * picture of a run can be handed straight to {@link choosePassage}. Places in
   * the playing and not printed bar numbers: a repeat is written out, so one
   * printed bar can be two of these.
   */
  theBarAtTicks(ticks: number): number | null {
    const exercise = this.exercise;
    return exercise === null ? null : measureIndexAt(exercise, ticks) + 1;
  }

  /**
   * The first and last bar of the whole piece, counted in playing order.
   *
   * What a passage may be widened back out to. Always from one, because a
   * position is a count of bars played and the first bar played is the first
   * - an excerpt whose page begins at forty is still forty bars in, and it
   * is that page's own first bar that a reader holds a finger on.
   */
  get pieceBarRange(): { readonly firstBar: number; readonly lastBar: number } {
    return { firstBar: 1, lastBar: Math.max(1, this.wholePieceBars) };
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
      // The listening frame has no grading of its own to bring: nothing in
      // it is judged, and the reader's choice is waiting for them when they
      // come back to a frame that judges.
      // One frame at a time. Whatever the old one had going belongs to it:
      // a performance is the listening frame's run, and a session is the
      // other two frames'. Leaving a frame ends what it was doing, which is
      // one rule in one place - it used to be a fight between the transport
      // buttons, with a run taken away by a playback and no session left to
      // say so.
      this.stopListening();
      this.currentSession?.abort();
      const grading = machineIsPlaying(changes.modeId)
        ? next.scoringId
        : this.deps.modes.get(changes.modeId).defaultScoringId;
      next = { ...next, scoringId: changes.scoringId ?? grading };
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

    // And the same for the hand. Reported from the page: it was read once
    // when the performance started, so a reader listening to both hands who
    // asked for one of them went on hearing both until they stopped the
    // music - which is the one thing they were trying not to do.
    if (changes.handStaff !== undefined) {
      this.player?.playWithHand(next.handStaff);
    }

    if (changes.zoom !== undefined && changes.zoom !== this.deps.zoom.zoom) {
      this.deps.zoom.setZoom(changes.zoom);
      this.refreshScore();
    }

    if (
      changes.playedNotes !== undefined &&
      changes.playedNotes !== 'live' &&
      changes.playedNotes !== 'while-held'
    ) {
      // Turning them off, or moving them to the end, both mean the page in
      // front of the reader should be clean again now.
      this.deps.overlay.clearPlayed();
      this.heldMarks = [];
      this.lentMarks = [];
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

    if (changes.rhythmRuler !== undefined) {
      this.drawTheRuler();
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
   * Which step a run would really begin at.
   *
   * The reader's own place, never outside the passage they chose: a place
   * pointed at before the passage was narrowed is no longer in the music being
   * practised. Here rather than at each of the four places that worked it out
   * for themselves - the run, the marker, the playback and the watch that
   * listens for the opening chord - because four copies of one answer are four
   * chances for them to disagree about where the music starts.
   */
  private whereARunBegins(from: number = this.beginAt): number {
    const passage = this.passageSteps;
    return Math.min(Math.max(from, passage.from), passage.to);
  }

  /**
   * The first step from there that this reader owes a note at.
   *
   * Only a run begun by *playing* asks: the reader announces it with the chord
   * it opens on, and where a hand is switched off that chord can be one they
   * have nothing in - a piece whose left hand opens alone, read with the right.
   * The watch then had nothing to wait for and stood down, so the app sat
   * waiting for notes it had itself switched off and no amount of correct
   * playing began anything. His: "у play to start - якщо якась рука вимкнена -
   * та курсор може стояти на вимкнених нотах, та чекати на гру вимкнених нот".
   *
   * Pressing the button is left alone. There the button announces the run, so
   * it can perfectly well open on a bar this reader sits out: the other hand is
   * sounded for them and they come in where they come in.
   */
  private theFirstStepTheReaderOwes(fromIndex: number): TimelineStep | null {
    const timeline = this.timeline;
    const passage = this.passageSteps;
    for (let index = fromIndex; index <= passage.to; index += 1) {
      const step = timeline?.at(index) ?? null;
      if (step !== null && this.owedByTheReader(step)) {
        return step;
      }
    }
    return null;
  }

  /**
   * The passage the reader chose, as the first and last step of it.
   *
   * The whole timeline when nothing is chosen. Bars come in as places in the
   * playing - the first bar played is one - and a step knows which bar it is
   * in, so this is where the two meet.
   */
  private get passageSteps(): { readonly from: number; readonly to: number } {
    const timeline = this.timeline;
    const last = timeline === null ? 0 : timeline.length - 1;
    if (timeline === null) {
      return { from: 0, to: 0 };
    }
    const { rangeFromBar, rangeToBar } = this.currentSettings;
    const fromMeasure = rangeFromBar === null ? 0 : rangeFromBar - 1;
    const toMeasure = rangeToBar === null ? Number.POSITIVE_INFINITY : rangeToBar - 1;
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
      // The keys he has. Left out entirely for a whole piano, so a request
      // for the ordinary case is the request it has always been - which is
      // what keeps every generated exercise reproducible from its seed.
      ...(keysOf(this.currentSettings.keyboard) === null
        ? {}
        : { withinRange: keysOf(this.currentSettings.keyboard) as PitchRange }),
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
    // What is actually handed to the engraver, which is the same music with
    // room made in it: rests nobody sees, at the grid the ruler is drawn on,
    // so that the beats of a bar stand at even distances across it. See
    // `PrintingOptions.spacersEvery` for why an engraver does not do that on
    // its own.
    // Evened out whenever the bars are ruled, and by the *bar's* own grid
    // rather than the ruler's: measured, a ruler of halves over a bar of
    // quarters changes nothing at all, because the notes between two spacers
    // are back to being spaced by the engraver's judgement.
    const evenBars = rulerStepTicks(this.currentSettings.rhythmRuler) > 0;
    const printed = evenBars
      ? this.deps.serializer.serialize(source, { evenBars: true })
      : musicXml;

    // The same bytes are the same page. This one test answers both of the
    // questions a re-presentation asks - whether the engraver has anything
    // to draw again, and whether what the reader knows about the page is
    // still true - because they are the same question.
    //
    // Asked of the music and not of the printing: ruling the bars re-engraves
    // the page, but it is the same piece and the reader is in the same place
    // in it.
    const newMusic = musicXml !== this.engravedXml;
    timeTheStart('score: written for the engraver', () => `${String(printed.length)} characters`);

    this.exercise = exercise;
    this.timeline = buildTimeline(exercise);
    timeTheStart('score: timeline built', () => `${String(this.timeline?.length ?? 0)} steps`);
    this.lastSeed = exercise.metadata.seed;
    if (newMusic) {
      // New music, so the reader's place in the old music means nothing.
      this.beginAt = 0;
    }

    // Only when the notes have changed. Engraving is two and a half seconds
    // on a long score against thirty milliseconds to write the file, so a
    // tempo nudge that redrew the page spent nearly all of its time redrawing
    // notes nobody had touched - and swallowed the next press while it did.
    if (newMusic || printed !== this.printedXml) {
      this.engravedXml = musicXml;
      this.printedXml = printed;
      this.emitter.emit('engraving', { busy: true });
      try {
        await this.deps.renderer.load(printed, printedAtEachStep(this.timeline));
      } finally {
        // Said even where the drawing threw: a page that failed to appear is
        // still a page nobody is waiting for any more.
        this.emitter.emit('engraving', { busy: false });
      }
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
    this.drawTheRuler();
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
    timeTheStart('playback asked for');
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
      clickSilences: this.currentSettings.clickSilences,
      clickWhen: this.theClickAPlaybackUses,
      // Where the reader put their place, kept inside the passage they chose.
      // Hearing the music is part of learning the passage, so a playback that
      // always began at bar one made them listen through everything they were
      // not working on. Clamped either way, so a performance picked up after
      // a pause still lands inside a passage that moved while it was held.
      fromIndex: this.whereARunBegins(fromStepIndex ?? this.beginAt),
      toIndex: passage.to,
      // Round again inside the one performance, rather than by starting
      // another: stopping and starting is where the gap on a repeat came
      // from.
      // Round inside the performance, unless every lap is to be counted in -
      // a count-in *between* laps is a break by definition, and a seam that
      // is meant to be there is better made by starting again than by
      // teaching the player's clock to stop in the middle.
      repeat: this.currentSettings.repeatRange && !this.countsInEveryLap,
      countInBars: this.aPlaybackIsCountedIn ? this.currentSettings.countInBars : 0,
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
    // Each performance is its own: marks left from the last one would be the
    // page answering a question nobody has asked yet.
    this.deps.overlay.clearPlayed();
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
    timeTheStart('playback resume asked for');
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
    // The report already counts bars the way a passage does: in playing
    // order, from one.
    const passage = { fromBar: found.fromBar, toBar: found.toBar };
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
   * Places in the playing, counted from one, and clamped to the piece here.
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
   * Takes the piece apart and starts learning it, section by section.
   *
   * His line 93, the way Piano Marvel does it. Nothing here is new
   * machinery: a section is the passage this trainer has always had, a hand
   * is the hand, a slow tempo is the percentage. What was missing is the
   * thing that puts them in order and knows when one of them is done - so
   * that is all this is.
   *
   * Built from the whole piece rather than from the passage in front of the
   * reader: the plan *is* a way of cutting the piece up, and starting it
   * inside somebody else's cut would give sections of a section.
   */
  startTheDrill(sectionBars?: number): DrillTask | null {
    const exercise = this.exercise;
    if (exercise === null) {
      return null;
    }
    const hands = [...new Set(exercise.staves.map((staff) => staff.staffNumber))].sort(
      (left, right) => left - right,
    );
    this.drill = planTheDrill(measureCount(exercise), {
      ...(sectionBars === undefined ? {} : { sectionBars }),
      hands,
    });
    this.drillAt = 0;
    this.emitter.emit('drillChanged', { task: this.drillTask, at: 0, of: this.drill.length });
    return this.applyTheDrill();
  }

  /** Puts the drill away. The passage and the hand stay where it left them. */
  stopTheDrill(): void {
    if (this.drill.length === 0) {
      return;
    }
    this.drill = [];
    this.drillAt = 0;
    this.emitter.emit('drillChanged', { task: null, at: 0, of: 0 });
  }

  /** What the drill is asking for, or `null` when nothing is being drilled. */
  get drillTask(): DrillTask | null {
    return this.drill[this.drillAt] ?? null;
  }

  /** How far through the plan the reader is, for anything that shows it. */
  get drillProgress(): { readonly at: number; readonly of: number } {
    return { at: this.drillAt, of: this.drill.length };
  }

  /**
   * Sets the passage, the hand and the speed the current task asks for.
   *
   * Through `updateSettings`, so that everything watching them - the boxes in
   * the drawer, the dimming, the printed page - hears about it exactly as it
   * would if the reader had set them by hand. There is no second way to be
   * practising bars 5 to 8 with the left hand.
   */
  private applyTheDrill(): DrillTask | null {
    const task = this.drillTask;
    if (task === null) {
      return null;
    }
    this.updateSettings({
      rangeFromBar: task.fromBar,
      rangeToBar: task.toBar,
      handStaff: task.hand,
      tempoPercent: task.tempoPercent,
    });
    return task;
  }

  /**
   * Decides what a finished reading means for the plan.
   *
   * Passed, and the plan moves on; short of it, and the same task is asked
   * for again - which is the whole of "until it is learned perfectly". The
   * settings are re-applied either way, since a reader may well have moved
   * the passage or the hand while they were in the middle of it.
   */
  private judgeTheDrill(report: PerformanceReport, score: { readonly overall: number }): void {
    if (this.drill.length === 0) {
      return;
    }
    const passed = drillTaskPassed({ completed: report.completed, overall: score.overall });
    if (passed) {
      this.drillAt += 1;
    }
    if (this.drillAt >= this.drill.length) {
      const of = this.drill.length;
      this.drill = [];
      this.drillAt = 0;
      // Finished, and said so: the piece has been through every stage of the
      // plan, which is the only ending this has.
      this.emitter.emit('drillChanged', { task: null, at: of, of });
      return;
    }
    this.applyTheDrill();
    this.emitter.emit('drillChanged', {
      task: this.drillTask,
      at: this.drillAt,
      of: this.drill.length,
    });
  }

  /**
   * Follows a renamed score through what remembers it by name.
   *
   * Which is the practice history, and only because `practiceKey` writes the
   * title into its keys - so what belongs to a piece is decided here, where
   * the keys are built, rather than in the thing that stores them.
   */
  followTheRename(fromTitle: string, toTitle: string): void {
    if (fromTitle === toTitle) {
      return;
    }
    const was = `score:${fromTitle}`;
    const now = `score:${toTitle}`;
    this.deps.history?.rekey((key) => {
      // The whole key is the piece, or the piece and then the passage's bars.
      // Nothing else counts: titles have spaces in them, so "Old Man" would
      // be carried off by renaming "Old" on any plainer reading.
      if (key === was) {
        return now;
      }
      return key.startsWith(`${was} bars:`) ? `${now}${key.slice(was.length)}` : key;
    });
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
   * What the last run did, or `null` before there has been one.
   *
   * The run in progress answers for itself through `session.roll`; this is the
   * one that has finished, which is the one there is a report to read beside.
   */
  get lastRoll(): RunRoll | null {
    return this.finishedRoll;
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

  /**
   * Whether a playback counts itself in on every lap of a repeat.
   *
   * Which the page needs to know, because it is the page that starts the
   * next lap where this is true: the application layer has no timer to
   * defer with, and starting a performance from inside its own finish is how
   * re-entrancy bugs are made.
   */
  get countsInEveryLap(): boolean {
    return this.currentSettings.countInPlayback === 'every' && this.aPlaybackIsCountedIn;
  }

  /**
   * Whether a playback is counted in at all.
   *
   * Two settings make the one answer - being asked for, and being more than
   * nought bars long - and three places wanted it.
   */
  private get aPlaybackIsCountedIn(): boolean {
    return (
      this.currentSettings.countInPlayback !== 'never' && this.currentSettings.countInBars > 0
    );
  }

  /**
   * What the click does through a playback.
   *
   * The reader's own setting, except that a count-in they asked for is heard.
   * These were two controls with the second quietly answering for the first:
   * with the click switched off the whole metronome was muted, count-in
   * included, so asking to be counted in still pushed the music two bars later
   * and made no sound at all - which from where the reader sits is the setting
   * doing nothing. His: "'Count-in in the playback' опція нічого не робить".
   *
   * A count-in that cannot be heard is not a count-in; it is a delay. What the
   * click was asked to do about the *music* is untouched: `count-in-only` falls
   * silent from the bar the music begins at.
   */
  private get theClickAPlaybackUses(): ClickWhen {
    const asked = this.currentSettings.clickWhen;
    return this.aPlaybackIsCountedIn && clickIsSilent(asked) ? 'count-in-only' : asked;
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
      this.player.events.on('finished', () => {
        this.applyCursorVisibility();
        this.considerARest();
      });
      // A performance keeps time, so the beats between one step and the next
      // fall where they are written - the same reckoning a mode under a pulse
      // uses, and for the same reason.
      this.player.events.on('stepReached', ({ stepIndex, ticks, atMs }) => {
        this.listeningStep = stepIndex;
        this.lightWhatIsSounding(stepIndex);
        this.announceTheBeats(ticks, this.nextStepTicks(stepIndex), atMs);
      });
    }
    return this.player;
  }

  /**
   * Marks what the reader plays along with a performance.
   *
   * His, and it is the one thing a playback could not tell him: he plays
   * along to check himself, and the page said nothing either way. Judged
   * against the beat the performance has reached, which is the beat he is
   * hearing - not against a window, because a performance is not a run and
   * nothing here is being graded. It is a mirror, not a verdict: the marks
   * are drawn and nothing is counted, reported or held against him.
   *
   * Armed and disarmed in one place, like the opening chord, because the
   * question is always the same one: is a performance going with the reader
   * asking to be shown.
   */
  private watchThePlayAlong(): void {
    if (!this.isListening) {
      // The music has stopped, so nothing is sounding: a light left burning
      // would name a note nobody is playing.
      this.putOutTheSounding();
    }
    const wanted = this.currentSettings.markWhileListening && this.isListening;
    if (!wanted) {
      this.playAlong?.();
      this.playAlong = null;
      return;
    }
    if (this.playAlong === null) {
      this.playAlong = this.deps.midi.subscribe((event) => this.hearThePlayAlong(event));
    }
  }

  /**
   * Lights the notes a performance is sounding, and puts out the last ones.
   *
   * A moving light rather than a trail: what has been played is already said
   * by the veil, and a page that filled up as the music went would be saying
   * it twice. Off unless asked for, since a performance is also how a piece
   * is simply listened to.
   */
  private lightWhatIsSounding(stepIndex: number): void {
    if (!this.currentSettings.showPlaybackNotes) {
      return;
    }
    this.putOutTheSounding();
    const step = this.timeline?.at(stepIndex) ?? null;
    if (step === null) {
      return;
    }
    // What the performance is actually sounding, which is the hand it was
    // asked to play - listening to one hand should not light the other.
    const midis = expectedFor(step, this.currentSettings.handStaff);
    this.litNotes = midis.map((midi) => ({ stepIndex, midi }));
    for (const note of this.litNotes) {
      this.deps.overlay.showPlayed({ ...note, correct: true, sounding: true, offset: 0 });
    }
  }

  /** Takes the light off whatever had it. */
  private putOutTheSounding(): void {
    for (const note of this.litNotes) {
      this.deps.overlay.hidePlayed(note);
    }
    this.litNotes = [];
  }

  private hearThePlayAlong(event: MidiEvent): void {
    if (event.type !== 'noteon') {
      return;
    }
    const step = this.timeline?.at(this.listeningStep) ?? null;
    if (step === null) {
      return;
    }
    // What the reader would have been asked for here, so playing along to one
    // hand is marked against that hand - the same question the run asks, put
    // to the beat that is sounding.
    const wanted = expectedFor(step, this.currentSettings.handStaff);
    this.deps.overlay.showPlayed({
      stepIndex: this.listeningStep,
      midi: event.midi,
      correct: wanted.includes(event.midi),
      // Nothing about how early or late: a performance keeps its own time and
      // the reader is following it by ear, so a number saying they were
      // forty milliseconds behind the recording would be measuring the wrong
      // thing and drawing it on their music.
      offset: 0,
    });
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
    // Asked here because it is the same question at the same moments: what is
    // happening to the music. Two watchers, one answer, and no chance of one
    // of them being armed at a moment the other was not.
    this.watchThePlayAlong();
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
    const step = this.theFirstStepTheReaderOwes(this.whereARunBegins());
    this.openingPresses = [];
    this.openingBeginsAt = step?.index ?? null;
    // Nowhere in the passage has anything in it for this hand, so there is no
    // chord to wait for and the watch stands down rather than starting the run
    // on the reader's next stray key.
    this.opening =
      step === null
        ? null
        : new ChordMatcher(
            expectedFor(step, this.currentSettings.handStaff),
            {
              toleranceMs: this.currentSettings.matchToleranceMs,
              pitchClassOnly: this.currentSettings.pitchClassOnly,
              anyPitch: this.currentSettings.rhythmOnly,
            },
            step.ornamentMidi ?? [],
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
   *
   * And it is not punished afterwards either. Only what the matcher took is
   * kept for the run: hunting for a chord is not playing it, and every press
   * since the watch was armed used to be handed over - so the keys tried on
   * the way to the opening arrived as wrong notes against the run's first
   * step, graded and drawn, for playing done before there was a run to play
   * in. His: "при play to start - всі неправильні ноти теж рахуються... щоб
   * перші ноти завжди рахувалися та малювалися як правильними".
   */
  private hearTheOpening(event: MidiEvent): void {
    const matcher = this.opening;
    if (matcher === null || event.type !== 'noteon') {
      return;
    }
    const outcome = matcher.accept(event.midi, event.timestampMs);
    // A press that fell outside the window threw away what the matcher had
    // collected, and what is kept here goes with it: those notes belong to an
    // attempt the reader abandoned.
    if (outcome.windowRestarted) {
      this.openingPresses = [];
    }
    // Everything the page asked for, which is the chord itself, a note of it
    // struck twice, and an ornament leaning on it. Not the hunting.
    if (outcome.verdict !== 'wrong') {
      this.openingPresses.push(event);
    }
    if (!outcome.completed) {
      return;
    }
    // No count-in: the reader has just played the tempo themselves, and
    // counting them in after that is asking them to wait for a bar they have
    // already begun. And from the chord they actually played, which is not
    // always the one the marker sits on.
    this.beginRun(0, this.openingPresses, this.openingBeginsAt ?? undefined);
  }

  /**
   * Starts a run, counting in unless told not to.
   *
   * The going-round is the view's, so it is the view that says whether this
   * time is the first: a repeat that counts itself in every time is one
   * setting, and a passage that goes round without a break is the other.
   */
  start(options: { readonly countIn?: boolean } = {}): PracticeSession | null {
    // His: one button. In the listening frame there is no run to begin - the
    // machine plays and the reader watches - so Start reaches for the
    // performance that has always existed rather than for a session.
    if (this.machinePlays) {
      this.listen();
      return null;
    }
    const bars = options.countIn === false ? 0 : this.currentSettings.countInBars;
    return this.beginRun(bars, []);
  }

  private beginRun(
    countInBars: number,
    opening: readonly MidiNoteOnEvent[],
    from?: number,
  ): PracticeSession | null {
    timeTheStart('run asked for');
    this.stopListening();
    const timeline = this.timeline;
    if (timeline === null) {
      this.emitter.emit('error', {
        error: new Error('Load an exercise before starting a session.'),
        context: 'start',
      });
      return null;
    }

    this.disposeSession('another run');

    const mode = this.deps.modes.get(this.currentSettings.modeId);
    const passage = this.passageSteps;
    // Where the reader put the cursor, unless a run begun by playing has
    // already been told otherwise - and never outside the passage they chose.
    const beginsAt = this.whereARunBegins(from);
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
        startAtIndex: beginsAt,
        stopAfterIndex: passage.to,
        expectedStaff: this.currentSettings.handStaff,
        inputLatencyMs: this.currentSettings.inputLatencyMs,
        playingAhead: this.currentSettings.playingAhead,
        // Gated on there being an accompaniment at all: without one there is
        // no sounding music to be ahead of, and a waiting mode's whole
        // promise is that it does not mind how long the reader takes.
        rushing:
          this.currentSettings.rushingCounts && this.wantsTheOtherHand() ? 'a-mistake' : 'allowed',
        click: this.currentSettings.clickPattern,
        clickSilences: this.currentSettings.clickSilences,
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

    this.sessionSubscriptions.push(
      // A step is dimmed the moment it is done with, whether it was played
      // well, badly or not at all: the page empties as the music passes.
      session.events.on('stepCompleted', ({ result, atMs }) => {
        if (this.soundsTheMusicForTheReader && result.status !== 'skipped') {
          const step = this.timeline?.at(result.index);
          if (step !== undefined && step !== null) {
            this.soundTheWrittenNotes(step, atMs);
          }
        }
        this.readerReaches(result.index, result.status, atMs);
        // The beat is finished, so its right notes stop being provisional.
        // Said for every step, including one nobody played: telling the
        // drawing about a step it has no marks for costs nothing, and the
        // alternative is the controller keeping a second account of which
        // steps have marks on them.
        this.deps.overlay.settlePlayed(result.index);
        if (this.currentSettings.readAheadSteps !== null) {
          this.fadeThrough(result.index);
        }
        if (this.survivalRuns && this.survivalKeepsTime) {
          // What the step was worth is how long it lasted, so that a bar
          // carries the same weight however many notes are in it.
          this.publishHealth(
            this.meter.settle(result.status, this.beatsIn(this.timeline?.at(result.index))),
            'settle',
          );
        } else if (this.survivalRuns && result.status !== 'skipped') {
          // Where nothing keeps time, a beat found is worth whatever share of
          // the bar the reader asked for - and the clock starts again from
          // here rather than from the last time anybody looked.
          this.lastWaitDrainMs = this.deps.clock.now();
          const clean =
            !this.currentSettings.survivalPunishesMistakes || result.status === 'correct';
          this.publishHealth(
            this.meter.refill(this.currentSettings.survivalRefillPercent / 100, clean),
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
        if ((verdict === 'wrong' || verdict === 'rushed') && this.currentSettings.stopAtAMistake) {
          // After the mark is noted and before it is drawn: stopping fires
          // `finished`, which puts up everything the run was holding back -
          // so the note that ended it is on the page with the rest.
          this.currentSession?.abort();
        }
        if (this.currentSettings.playedNotes === 'hidden' || verdict === 'duplicate') {
          return;
        }
        const mark = {
          stepIndex,
          midi,
          // Palely until the beat is finished: a chord half found is not a
          // chord, and the reader should be able to see which of the two
          // they are looking at without counting noteheads.
          settled: false,
          // Right against the page, which is what the mark is about: a note
          // the other hand was going to play was read correctly.
          correct: verdict !== 'wrong' && verdict !== 'rushed',
          // Measured now, not at the end: the offset is a fraction of the gap
          // to the neighbouring note, and it is only known while the run
          // still knows the tempo it was played at.
          offset: this.timingOffsetFor(stepIndex, deviationMs, session.tempoBpm),
        };
        if (this.currentSettings.playedNotes === 'at-end') {
          this.heldMarks.push(mark);
        } else {
          this.deps.overlay.showPlayed(mark);
          // Lent to the page rather than given to it: taken back when the
          // key comes up, and handed over again when the run ends, which is
          // when a reader wants to see where they kept going wrong.
          if (this.marksAreLent && !mark.correct) {
            this.lentMarks.push(mark);
          }
        }
      }),
    );
    this.sessionSubscriptions.push(
      // The pulse the run already keeps, so the bar needs no clock of its own
      // and a whole game replays headlessly.
      session.events.on('beat', (tick) => {
        if (!this.survivalRuns || !this.survivalKeepsTime) {
          return;
        }
        const beats = this.beatsFor(tick.positionTicks - this.lastBeatTicks);
        this.lastBeatTicks = tick.positionTicks;
        this.publishHealth(this.meter.drainForBeats(beats), 'drain');
      }),
    );

    this.sessionSubscriptions.push(
      session.events.on('stepEntered', ({ step }) => {
        timeTheStart('first step entered');
        this.deps.cursor.moveTo(step.index);
        timeTheStart('first step: cursor moved');
        this.fadeAhead(step.index);
        timeTheStart('first step: veil caught up');
        // A new step is nobody's fault yet.
        this.forgetTheTrouble();
        this.otherHandReaches(step);
      }),
    );
    this.sessionSubscriptions.push(
      // The bar the run was waiting at has begun, so everything that was
      // standing still with it comes in - from the moment the reader gave the
      // beat rather than from the moment the page heard about it.
      session.events.on('barBegan', ({ stepIndex, atMs }) => {
        const step = this.timeline?.at(stepIndex) ?? null;
        if (step !== null) {
          this.otherHandReaches(step, atMs);
        }
      }),
    );
    this.sessionSubscriptions.push(
      session.events.on('finished', ({ report, score }) => {
        this.finishedReport = report;
        this.finishedRoll = session.roll;
        this.drawHeldMarks();
        // The marker reddens to say "you are stuck *here*, now". A run that
        // is over has no here and no now: what is left of it is the report
        // and the marks, and a marker still glowing red over the last chord
        // would be saying the reader is stuck on music they have finished.
        // Said for both ways a run can end, which both arrive here.
        this.forgetTheTrouble();
        // A run that is over takes back what it was still holding.
        this.silenceTheOtherHand();
        const picture = this.pictureOfTheReading(report, session.roll);
        const modes = modesOn(this.currentSettings);
        this.deps.history?.record(this.practiceKey(), {
          // The calendar, so a table of readings can say when. `IClock`
          // counts from an arbitrary zero for measuring music.
          atMs: Date.now(),
          overall: score.overall,
          grade: score.grade,
          completed: report.completed,
          tempoPercent: Math.round(this.currentSettings.tempoPercent),
          hand: this.currentSettings.handStaff,
          stoppedAtBar: picture.stoppedAtBar,
          modeId: this.currentSettings.modeId,
          ...(modes.length > 0 ? { modes } : {}),
          picture,
          roll: session.roll,
        });
        this.considerLadderMove(score.overall, report.completed);
        this.judgeTheDrill(report, score);
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
        // And it is the first moment a rest that fell due mid-run may be
        // mentioned without interrupting anything.
        this.considerARest();
      }),
    );

    // Listened to before it begins, so nothing it does is missed.
    timeTheStart('session built');
    this.emitter.emit('sessionBuilt', { session });
    timeTheStart('page took the session');
    // Before the session hears anything of its own: the watch and the run
    // would otherwise both be subscribed to the keyboard, and the presses
    // that started this run would arrive at the watch a second time.
    this.watchForTheOpening();
    const walkedFrom = this.deps.cursor.position;
    if (beginsAt > 0) {
      this.deps.cursor.moveTo(beginsAt);
    } else {
      this.deps.cursor.reset();
    }
    timeTheStart(`cursor at the start (walked ${String(walkedFrom)} -> ${String(beginsAt)})`);
    this.meter.reset();
    this.lastWaitDrainMs = this.deps.clock.now();
    this.lastBeatTicks = 0;
    if (this.survivalRuns) {
      this.emitter.emit('healthChanged', { health: this.meter.health, cause: 'settle' });
    }
    this.heldMarks = [];
    this.lentMarks = [];
    this.deps.overlay.clearPlayed();
    this.deps.fade.clearFaded();
    this.fadedThrough = -1;

    // The clock first, and the page behind it.
    //
    // A click is placed on the audio graph the moment the pulse starts, and
    // nothing the main thread does afterwards can move it: work done *before*
    // this call is added in front of the sound, and work done after it is not.
    // What used to stand here was the page being made ready - the marker sent
    // back to the top, a long piece scrolled there, every mark of the last run
    // taken off the engraving - and on his 159-bar arrangement that is real
    // work, all of it silence between the key he pressed to begin and the
    // downbeat he pressed it for. The same lesson the playback learned, which
    // says it in `ExercisePlayer.start`.
    //
    // Nothing is missed by drawing afterwards: the first tick is not delivered
    // until it is due, which is a scheduling lead away, and all of this
    // finishes long before it.
    timeTheStart('pulse about to start');
    session.start(opening, this.pedalIsDown);
    timeTheStart('pulse started');
    // Drawn afterwards. Everything the page shows about a run being under way is
    // the same a moment later, and the run's first act - a click placed where
    // the reader's key went down - cannot be moved any earlier than it already
    // is, so nothing may stand in front of it.
    this.emitter.emit('sessionCreated', { session });
    timeTheStart('page drew the run');

    // Last of all, and only this. Scrolling a long piece back to its first bar
    // is the one piece of preparing the page that nothing depends on and that
    // really costs - it is a layout and a scroll over a whole engraving - so
    // it is the one piece that waits. Everything above it is the slate being
    // cleaned, which has to be done before the run draws on it.
    if (beginsAt === 0) {
      // The page a long piece was left scrolled to is not where bar one is.
      this.deps.renderer.scrollToStart();
    }


    return session;
  }

  pause(): void {
    if (this.machinePlays) {
      this.pauseListening();
      return;
    }
    this.currentSession?.pause();
  }

  resume(): void {
    timeTheStart('resume asked for');
    if (this.machinePlays) {
      this.resumeListening();
      return;
    }
    this.currentSession?.resume();
  }

  stop(): void {
    if (this.machinePlays) {
      this.stopListening();
      return;
    }
    this.currentSession?.abort();
  }

  dispose(): void {
    this.hearingNotes?.();
    this.hearingNotes = null;
    this.watchingThePedal?.();
    this.watchingThePedal = null;
    this.listeningForTheOpening?.();
    this.listeningForTheOpening = null;
    this.player?.dispose();
    this.player = null;
    this.disposeSession();
    this.deps.renderer.clear();
    this.emitter.removeAllListeners();
  }

  /**
   * Lets go of the running session.
   *
   * @param whatFollows Nothing, or the run being built to take its place.
   * Only the first is worth announcing. A run starting says everything this
   * would say a moment later and says it correctly - `beginRun` re-arms the
   * watch against the new run's own opening chord, and `sessionCreated`
   * tells the page what `sessionDiscarded` was telling it - so on the way
   * *in* this was the same work done twice, and it sat between the key the
   * reader pressed to begin and the downbeat answering it. Worse than
   * wasted: with the session already let go of and the next one not yet
   * built, the only answer the transport could be painted with was "idle",
   * so every start repainted itself as a stopped run first. His: "я вже
   * влучаю у ритм, але трошки раніше, бо є ще якась мізерна затримка".
   */
  private disposeSession(whatFollows: 'nothing' | 'another run' = 'nothing'): void {
    for (const unsubscribe of this.sessionSubscriptions) {
      unsubscribe();
    }
    this.sessionSubscriptions = [];
    this.forgetTheTrouble();
    const had = this.currentSession !== null;
    this.currentSession?.dispose();
    this.currentSession = null;
    if (had && whatFollows === 'nothing') {
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
    if (timeline === null || !this.keepsTime) {
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
    // Whatever is still under a finger as the run ends stays where it is:
    // it is already drawn, and it is not owed to the page twice.
    this.lentMarks = [];
  }

  /**
   * Whether the bar is running for this exercise.
   *
   * Needs a pulse to drain against: in Wait mode nothing moves without the
   * reader, so there is nothing to survive and the bar would sit still.
   */
  get survivalRuns(): boolean {
    return this.currentSettings.survival;
  }

  /**
   * Whether the bar is drained by the music or by the clock.
   *
   * Under a pulse it falls with the beats, so a slow piece is not harder than
   * a fast one. In a mode that waits there are no beats passing to count, and
   * the question is not "can you keep up" but "do you know what comes next" -
   * so it falls with the clock instead, and every beat found fills it.
   */
  get survivalKeepsTime(): boolean {
    return this.keepsTime;
  }

  /**
   * Whether a pulse carries the music in the frame now chosen.
   *
   * The one place that asks. It was seven lookups into the registry spelled
   * out in seven places, which was fine while every frame was a practice mode
   * - and the moment one of them was not, every one of those places would
   * have had to learn about it separately.
   */
  private get keepsTime(): boolean {
    return (
      !machineIsPlaying(this.currentSettings.modeId) &&
      this.deps.modes.get(this.currentSettings.modeId).requiresMetronome
    );
  }

  /** Whether the frame now chosen is the one the machine plays. */
  get machinePlays(): boolean {
    return machineIsPlaying(this.currentSettings.modeId);
  }

  /**
   * Drains the bar for the time that has passed, where nothing else does.
   *
   * Called from outside because this layer owns no timer: the page ticks, and
   * the moment is read off the clock it is given. Each call is worth at most
   * a second however long it has really been - a page put away with a run
   * going should not come back to a run that was lost while nobody watched.
   */
  drainWhileWaiting(): void {
    if (!this.survivalRuns || this.survivalKeepsTime || this.currentSession === null) {
      return;
    }
    const now = this.deps.clock.now();
    const since = this.lastWaitDrainMs;
    this.lastWaitDrainMs = now;
    if (since === null) {
      return;
    }
    const seconds = Math.min(now - since, 1_000) / 1_000;
    this.publishHealth(this.meter.drainForSeconds(seconds), 'drain');
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
    if (
      (verdict !== 'wrong' && verdict !== 'rushed') || this.keepsTime
    ) {
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
  private otherHandReaches(step: TimelineStep, atMs?: number): void {
    if (!this.wantsTheOtherHand()) {
      return;
    }
    // Under a pulse the music arrives when the beat falls, and the step is
    // entered at that moment: there is nothing to work out.
    if (this.keepsTime) {
      // Unless the beat has not fallen. Where a mode holds at bar lines the
      // step is entered *at* the line and the bar waits there to be given its
      // downbeat - so an accompaniment sounding now would be answering a note
      // nobody has struck. His: "ліва рука на старті бару грається одразу не
      // чекаючи на мене". It comes in when the bar does.
      if (this.currentSession?.waitingAtTheBarLine === true) {
        return;
      }
      const now = atMs ?? this.deps.clock.now();
      this.soundTheOtherHand(step, now);
      // As far as the next step and no further: under a pulse the music
      // arrives on its own, and each step will say for itself when it does.
      // The beats *inside* a held note have nothing else to announce them,
      // which is the whole of what this is for.
      this.announceTheBeats(step.onsetTicks, this.nextStepTicks(step.index), now);
      return;
    }
    // Waiting, the reader is the clock. A step they owe nothing on is reached
    // the instant the one before it is finished, so its music is placed where
    // it is *written* - a written quarter after the note they just played,
    // however long they take to play the next one.
    if (this.owedByTheReader(step)) {
      return;
    }
    const anchor = this.otherHandAnchor ?? {
      wallMs: this.deps.clock.now(),
      ticks: step.onsetTicks,
    };
    this.otherHandAnchor = anchor;
    const reachesAt =
      anchor.wallMs + spanMs(this.exercise as Exercise, anchor.ticks, step.onsetTicks);
    this.soundTheOtherHand(step, reachesAt);
    this.emitter.emit('otherHandReached', { stepIndex: step.index, atMs: reachesAt });
  }

  /**
   * The reader has finished a step, which in a waiting mode is the clock.
   *
   * The other hand's share of *that* step sounds with them rather than when
   * the step was entered: the music was standing still until they played, and
   * an accompaniment that had already gone would have been answering a note
   * nobody had struck yet.
   */
  private readerReaches(stepIndex: number, status: StepStatus, atMs: number): void {
    const step = this.timeline?.at(stepIndex) ?? null;
    if (
      step === null ||
      status === 'skipped' ||
      this.keepsTime
    ) {
      return;
    }
    this.theMusicMovesOn(step, atMs);
    this.announceTheBeats(step.onsetTicks, this.nextOwedTicks(step.index), atMs);
    if (!this.wantsTheOtherHand()) {
      return;
    }
    // From the moment the key went down. Over the bridge that is a hop
    // before the run heard about it, and anchored on the hearing the whole
    // phrase after it came out that much late - which is exactly what a
    // reader feels as lag.
    this.otherHandAnchor = { wallMs: atMs, ticks: step.onsetTicks };
    this.soundTheOtherHand(step, atMs);
    // The reader's own step, reached by the other hand the moment they play it.
    this.emitter.emit('otherHandReached', { stepIndex: step.index, atMs });
  }

  /**
   * Clicks the beat the reader has just played, and the ones they will not.
   *
   * His own words: the metronome sounds when he presses the keys, and where
   * it is the other hand's turn while he rests or holds a note, it goes on in
   * rhythm without waiting for him. Both halves are the same rule as the
   * accompaniment's - the beat he plays is where *he* puts it, and the beats
   * between his entries are where they are *written* - and it is the rule a
   * waiting mode needs, because there is no pulse in it to hand beats out.
   *
   * Scheduled as far as his next entry and no further: the beat he comes in
   * on is his to place, and clicking it before he arrives would be the
   * machine playing his part for him.
   *
   * And written down with the one thing the sound has no use for: when the
   * music had that beat *ready*, which is the entry before it plus the written
   * distance. Late, the beat is written where it fell as well as where he gave
   * it, and the pair is the same pair a bar line's gate leaves - so the same
   * yellow section draws it, and the grid up to it stays even. Early, the beats
   * he overtook are taken back and his own carries how far ahead of the music
   * it was. His: "прохав щоб сітка виглядала рівно - а там де нерівності
   * із-за гравця - кожен такий slowdown замальовувати жовтою секцією just like
   * у wait for bars".
   *
   * Nothing new is *sounded*: a click at the moment a beat fell due would be
   * the machine telling him he is late, which is the opposite of a frame that
   * waits. The record keeps the beat the music was measured against, which is
   * the question asked of it afterwards.
   */
  private theMusicMovesOn(step: TimelineStep, atMs: number): void {
    const exercise = this.exercise;
    // Written wherever the music moves with the reader, and sounded only where
    // they asked to hear it. Two questions, and the picture asks only the first:
    // it follows the flow of the music and never the metronome. His: "краще
    // взагалі не залежати від метроному, а залежати від flow самої гри... він
    // має дивитись як йшла музика, та розуміти де були паузи."
    if (this.currentSession?.musicMovesWithTheReader !== true || exercise === null) {
      return;
    }
    const sounded = clickFollowsTheReader(this.currentSettings.clickWhen);
    const owedAtMs = this.whereTheBeatFellDue(exercise, step.onsetTicks);
    // At the resolution the reader asked to hear. A click they place is still
    // the click they chose the pattern for, and the subdivisions they had
    // turned on were simply never offered to it.
    const pattern = this.currentSettings.clickPattern;
    const counted = this.theGapWasCounted(exercise, step.onsetTicks, pattern);
    // Kept whether or not this step lands on a beat of the chosen pattern: the
    // distance to the next entry is written in the score either way, and a step
    // the click has no opinion about still moved the music on. Written down only
    // once both questions above have been asked of the entry before it.
    this.readersLastEntry = { atMs, ticks: step.onsetTicks };
    const here = beatAt(exercise, step.onsetTicks, pattern);
    // A beat of the music whatever the click has to say about it. An entry
    // between the clicks the reader chose is a division: not drawn as a line and
    // not sounded, but there - and being there is what lets the waiting at it be
    // read, the same pair of beats at one place that a bar line's gate leaves.
    // Left out where the click had no opinion, three entries in four on
    // sixteenths had nothing to carry their waiting at all.
    const weight: BeatWeight = here?.weight ?? 'division';
    if (owedAtMs !== null && owedAtMs - atMs > ONE_BREATH_MS && counted) {
      // Arrived before the music got here. The beats laid out ahead of him are
      // taken back, having been scheduled and never happened, and the arrival is
      // written down on its own: there is no second beat at that place to
      // measure it against, the one he overtook never having fallen.
      this.currentSession?.forgetClicksFrom(atMs);
      this.currentSession?.writeDownARush(atMs, owedAtMs - atMs);
    } else if (owedAtMs !== null && atMs - owedAtMs > ONE_BREATH_MS) {
      // The beat the music had ready while it waited for him. Written and not
      // sounded, and written before his own so the two are in the order they
      // happened - which is how the pair that makes a section is read.
      this.currentSession?.writeDownAClick(owedAtMs, weight, step.onsetTicks);
    }
    // Written down first, and sounded only if it was taken and if he asked to
    // hear it: a beat the run has already had is one beat, and clicking it again
    // is the machine agreeing with itself.
    if (
      this.currentSession?.writeDownAClick(atMs, weight, step.onsetTicks) !== false &&
      here !== null &&
      sounded
    ) {
      this.deps.metronome.click(atMs, here.weight);
    }
    const until = this.nextOwedTicks(step.index);
    for (const beat of beatsBetween(exercise, step.onsetTicks, until, pattern)) {
      const at = atMs + spanMs(exercise, step.onsetTicks, beat.ticks);
      if (sounded) {
        this.deps.metronome.click(at, beat.weight);
      }
      this.currentSession?.writeDownAClick(at, beat.weight, beat.ticks);
    }
  }

  /**
   * When the music had the beat at a place ready, or `null` where it cannot say.
   *
   * The reader's previous entry plus the distance the score puts between the
   * two, which in a frame with no pulse is the only clock there is. Local on
   * purpose: a note taken late says so about itself and says nothing about
   * every note after it, which is what makes it a reading rather than a running
   * total.
   */
  private whereTheBeatFellDue(exercise: Exercise, onsetTicks: number): number | null {
    const last = this.readersLastEntry;
    if (last === null || last.ticks >= onsetTicks) {
      // The first entry of a run has nothing before it to be measured from, and
      // needs nothing: it stands on the beat the music began with, which the run
      // wrote down where it started, so the pair is already there. A step at or
      // behind the last one is a repeat rather than a distance.
      return null;
    }
    return last.atMs + spanMs(exercise, last.ticks, onsetTicks);
  }

  /**
   * Whether the machine counted any beats between the reader's last entry and
   * this one.
   *
   * What makes coming in early mean anything. In a frame that waits, the reader
   * *is* the clock: a note played sooner than the written distance is a faster
   * pace, not a fault, and there is no tempo there to be judged against. What
   * they can genuinely be early for is a beat the run laid out ahead of them and
   * they went past - which is the whole of what he described: "ще можливо
   * зіграти ноту за два та більше бітів - та це вже занадто рано - і тоді всі
   * біти посередині теж придеться обрізати".
   *
   * So where nothing was counted in the gap - two entries a beat apart or less -
   * nothing can be early, however fast they take it. Measured before the fix,
   * reading quarters at four times the written speed turned four grid lines in
   * nine red, the second bar's downbeat among them, and he read that as the grid
   * having gone: "тепер лінії взагалі зникли".
   *
   * Being *late* is not conditional in the same way, and should not be: the
   * music standing still is the thing that frame exists to show, and it stood
   * still whether or not a beat was owed while it did.
   */
  private theGapWasCounted(
    exercise: Exercise,
    onsetTicks: number,
    pattern: ClickPattern,
  ): boolean {
    const last = this.readersLastEntry;
    if (last === null || last.ticks >= onsetTicks) {
      return false;
    }
    return beatsBetween(exercise, last.ticks, onsetTicks, pattern).length > 0;
  }

  /**
   * Says which beats are about to pass, for anything that shows them.
   *
   * The same beats the click marks and by the same reckoning - the one the
   * reader is on is now, and the ones after it are where they are written -
   * so the two can never disagree about where a beat is. Where a pulse keeps
   * time this says only the beat that has just fallen, that being all the
   * pulse knows.
   */
  private announceTheBeats(fromTicks: number, untilTicks: number, atMs: number): void {
    const timeline = this.timeline;
    const exercise = this.exercise;
    if (!this.currentSettings.rulerCursor || timeline === null || exercise === null) {
      return;
    }
    if (rulerStepTicks(this.currentSettings.rhythmRuler) <= 0) {
      return;
    }
    // The ruler's own lines, and not the click's beats: the two are separate
    // questions and the reader answers them separately. Ruled in eighths with
    // the click on the beat, the marker used to skip every line the click had
    // no opinion about - which is most of them.
    //
    // From this moment inclusive: the line the reader has just arrived at is
    // theirs and is marked now. Up to their next entry exclusive: that one is
    // theirs to place, and standing on it early would be the machine playing
    // their part for them.
    const beats = rulerMarksBetween(
      timeline,
      this.currentSettings.rhythmRuler,
      fromTicks,
      untilTicks,
    ).map((mark) => ({
      mark,
      atMs: atMs + spanMs(exercise, fromTicks, mark.ticks),
    }));
    if (beats.length > 0) {
      this.emitter.emit('beatsAhead', { beats });
    }
  }

  /** Where the next step of the music is, or the end of it. */
  private nextStepTicks(fromIndex: number): number {
    const timeline = this.timeline;
    return (
      timeline?.at(fromIndex + 1)?.onsetTicks ?? timeline?.totalTicks ?? 0
    );
  }

  /** Where the reader next has to play, or the end of the music. */
  private nextOwedTicks(fromIndex: number): number {
    const timeline = this.timeline;
    if (timeline === null) {
      return 0;
    }
    for (const step of timeline.steps) {
      if (step.index > fromIndex && this.owedByTheReader(step)) {
        return step.onsetTicks;
      }
    }
    return timeline.totalTicks;
  }

  /**
   * Rules the beat through the bars, or takes the ruling away.
   *
   * Worked out here rather than in the drawing because it is a question about
   * the *music* - where the beats of each bar fall, and which of them a metre
   * change moves - and answered as places between drawn notes because that is
   * the only thing the music can say about a page it cannot see.
   */
  private drawTheRuler(): void {
    const timeline = this.timeline;
    this.deps.ruler.showRhythmRuler(
      timeline === null ? [] : rulerMarks(timeline, this.currentSettings.rhythmRuler),
    );
  }

  /** Whether there is another hand to hear at all. */
  private wantsTheOtherHand(): boolean {
    return (
      this.currentSettings.hearTheOtherHand &&
      this.currentSettings.handStaff !== null &&
      this.exercise !== null
    );
  }

  /**
   * Whether the page is listening for the chord that would start a run.
   *
   * Armed and disarmed in one place already; this is only that answer, asked
   * from outside. Worth saying on the page: a reader who has just opened the
   * app cannot otherwise tell whether it is waiting for them or ignoring them.
   */
  get waitingForTheOpening(): boolean {
    return this.opening !== null;
  }

  /**
   * Whether a run begun now would need the audio device before it could move.
   *
   * The frames that keep time are carried by the pulse, and a pulse is audio
   * whether or not anybody hears it: the run waits for its first tick, and a
   * sleeping device never produces one. A count-in is the same, and so is the
   * frame where the machine does the playing.
   *
   * Where none of that is true - the cursor waiting on the reader, no count
   * in front of it, no click - nothing waits on the device at all. Asking such
   * a reader to tap the screen is asking for nothing, and this program does
   * not ask for nothing.
   */
  get needsTheAudioClock(): boolean {
    if (this.machinePlays) {
      return true;
    }
    if (this.deps.modes.get(this.currentSettings.modeId).requiresMetronome) {
      return true;
    }
    if (this.currentSettings.countInBars > 0) {
      return true;
    }
    return !clickIsSilent(this.currentSettings.clickWhen);
  }

  /** Whether this step is one the reader has to play. */
  private owedByTheReader(step: TimelineStep): boolean {
    return expectedFor(step, this.currentSettings.handStaff).length > 0;
  }

  /** Rhythm only, asked to sound the music rather than the reader's keys. */
  private get soundsTheMusicForTheReader(): boolean {
    return this.currentSettings.rhythmOnly && this.currentSettings.rhythmSoundsTheMusic;
  }

  /**
   * Whether a key pressed now stands for the written notes rather than
   * sounding as itself: while a run is going, in rhythm only, asked to sound
   * the music. The page sounds a keyboard that has no voice of its own, and
   * this is when it must not.
   */
  get replacesTheReadersKeys(): boolean {
    const status = this.currentSession?.status;
    return this.soundsTheMusicForTheReader && (status === 'running' || status === 'counting-in');
  }

  /**
   * The notes written for the reader at this step, sounded when they played it.
   *
   * At the moment the key went down, early or late as it was, so the rhythm
   * heard is the one played. Only the reader's hand: the other one, where it
   * is heard, is sounded as it always is. As loud as the page asks there, and
   * as long as each note sounds - a tie is one press and one sound.
   */
  private soundTheWrittenNotes(step: TimelineStep, atMs: number): void {
    const exercise = this.exercise;
    if (exercise === null) {
      return;
    }
    const hand = this.currentSettings.handStaff;
    const measureStart = barLines(exercise)[step.measureIndex]?.startTicks ?? 0;
    // Two voices on one pitch are one key, held as long as the longer of them.
    const longest = new Map<number, TimelineStep['notes'][number]>();
    for (const note of step.notes) {
      if (hand !== null && note.staffNumber !== hand) {
        continue;
      }
      const known = longest.get(note.midi);
      if (known === undefined || soundsFor(known) < soundsFor(note)) {
        longest.set(note.midi, note);
      }
    }
    for (const note of longest.values()) {
      this.deps.instrument.play(
        note.midi,
        velocityAt(exercise, step.measureIndex, step.onsetTicks - measureStart, note.staffNumber),
        atMs,
      );
      this.deps.instrument.stop(
        note.midi,
        atMs + spanMs(exercise, step.onsetTicks, step.onsetTicks + soundsFor(note)),
      );
      this.sounding.add(note.midi);
    }
  }

  private soundTheOtherHand(step: TimelineStep, atMs: number): void {
    const hand = this.currentSettings.handStaff;
    const exercise = this.exercise;
    if (hand === null || exercise === null) {
      return;
    }
    for (const note of step.notes) {
      if (note.staffNumber === hand) {
        continue;
      }
      this.deps.instrument.play(note.midi, OTHER_HAND_VELOCITY, atMs);
      // Sounded for as long as it sounds rather than as long as it is written,
      // which is the same number unless the writer marked it short.
      this.deps.instrument.stop(
        note.midi,
        atMs + spanMs(exercise, step.onsetTicks, step.onsetTicks + soundsFor(note)),
      );
      this.sounding.add(note.midi);
    }
  }

  /**
   * Takes back what the other hand was holding, or was about to.
   *
   * Stopping a note that has not started yet is what silences the rest of a
   * phrase the reader has walked away from: the accompaniment is laid out
   * ahead of them as far as their next entry, and a run stopped in the middle
   * of that would otherwise play on without anybody.
   */
  private silenceTheOtherHand(): void {
    for (const midi of this.sounding) {
      this.deps.instrument.stop(midi);
    }
    this.sounding.clear();
    this.otherHandAnchor = null;
    this.readersLastEntry = null;
    // And the beats laid out with them. A run walked away from must not go on
    // counting itself in an empty room.
    this.deps.metronome.stop();
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

  /**
   * Counts the reader's playing, wherever it happens.
   *
   * Not through a session: most of the wear on a pair of hands is put there
   * outside a graded run - trying a bar over, hunting a chord, playing for
   * the pleasure of it - and none of that reaches a session at all.
   */
  /**
   * Keeps the sustain pedal's state, run or no run.
   *
   * Here because this is the part that outlives a run, and a run can begin
   * with the foot already down: putting the pedal on and then playing is how
   * the instrument is played, and where the opening chord is what starts the
   * run, the foot always moves before the session exists to hear it. Handed
   * over at the start, so the picture of the run opens with what was true when
   * the music did.
   */
  private rememberThePedal(): void {
    this.watchingThePedal = this.deps.midi.subscribe((event) => {
      if (event.type === 'pedal') {
        this.pedalIsDown = event.down;
      }
    });
  }

  private hearNotesForTheTimer(): void {
    this.hearingNotes = this.deps.midi.subscribe((event) => {
      if (event.type === 'noteoff') {
        this.takeBackTheMark(event.midi);
        return;
      }
      if (event.type !== 'noteon') {
        return;
      }
      this.timer.noteHeard(event.timestampMs);
      this.considerARest();
    });
  }

  /** Whether wrong marks are only lent to the page for as long as the key. */
  private get marksAreLent(): boolean {
    return this.currentSettings.playedNotes === 'while-held';
  }

  /**
   * Takes a wrong mark off the page, the key having come up.
   *
   * The key and not the pedal: what this answers is "which note am I holding
   * down", and a pedal holds the sound rather than the finger. Every mark of
   * that note goes - two tries at the same wrong note stand in the same
   * place, so there is nothing to tell them apart on the page anyway.
   *
   * They are kept, not forgotten: at the end of the run they all come back.
   */
  private takeBackTheMark(midi: number): void {
    if (this.lentMarks.length === 0) {
      return;
    }
    const going = this.lentMarks.filter((mark) => mark.midi === midi);
    if (going.length === 0) {
      return;
    }
    this.lentMarks = this.lentMarks.filter((mark) => mark.midi !== midi);
    for (const mark of going) {
      this.deps.overlay.hidePlayed(mark);
      this.heldMarks.push(mark);
    }
  }

  /**
   * Works out whether a rest is owed, and says so when it may be said.
   *
   * Asked from both directions: when a note is played, which is what moves
   * the clock, and when the music stops, which is what makes it sayable.
   */
  private considerARest(): void {
    const every = Math.max(0, this.currentSettings.restEveryMinutes) * 60_000;
    // Put off, it falls due again a few minutes on rather than at once or
    // never. The clock is not restarted - they have still been sitting for an
    // hour - so the question is only when to ask a second time.
    const due = this.restDueAtMs ?? every;
    if (every > 0 && this.timer.sittingMs >= due) {
      this.restOwed = true;
    }
    if (!this.restOwed || this.restSaid || !this.nothingIsHappening) {
      return;
    }
    this.restSaid = true;
    this.emitter.emit('restDue', { sittingMs: this.timer.sittingMs });
  }

  /** Whether the music is standing still, so a word would interrupt nothing. */
  private get nothingIsHappening(): boolean {
    const status = this.currentSession?.status;
    return (
      status !== 'running' &&
      status !== 'counting-in' &&
      status !== 'paused' &&
      !this.isListening &&
      !this.isListeningPaused
    );
  }

  /**
   * The reader has taken their rest, or put it off.
   *
   * Taken, the clock starts again from nothing. Put off, it keeps what it
   * has: they have still been playing for an hour, and the next quiet moment
   * should say so again rather than start the hour over.
   */
  restTaken(): void {
    this.timer.reset();
    this.restOwed = false;
    this.restSaid = false;
    this.restDueAtMs = null;
  }

  /**
   * Not now: the debt is lifted for a few minutes, and the clock keeps what
   * it has.
   *
   * Lifted, and not merely unsaid. "Later" is the reader saying carry on, and
   * a debt left standing stops the things that would start something new -
   * so a passage set to go round again stopped going round, and stayed
   * stopped for the rest of the session. Reported exactly that way: the
   * repeat button no longer worked after a break was offered and declined.
   *
   * And it is asked again rather than dropped. Left said-and-owed, the
   * reminder was spent by the first refusal and never came back, which is
   * the other half of the same line.
   */
  restPutOff(afterMs: number = REST_PUT_OFF_MS): void {
    this.restSaid = false;
    this.restOwed = false;
    this.restDueAtMs = this.timer.sittingMs + Math.max(0, afterMs);
  }

  /**
   * Passed over: nothing more about this one until another whole interval.
   *
   * Different from putting it off by a few minutes, and the difference is
   * the reader's to say. The clock still keeps what it has - they have been
   * sitting an hour and skipping does not undo that - so what a skip buys is
   * the interval, not the hour.
   */
  restSkipped(): void {
    this.restPutOff(Math.max(0, this.currentSettings.restEveryMinutes) * 60_000);
  }

  /**
   * Whether a rest is owed, said or not.
   *
   * Different from having been told: a rest falls due in the middle of a run
   * as easily as anywhere, and the run goes on. What this is for is the
   * things that would *start something new* - a repeat coming round again -
   * which should not, with a reader already owed a break.
   */
  get restIsOwed(): boolean {
    return this.restOwed;
  }

  /** How long the reader has been at the keyboard, for anything showing it. */
  get sittingMs(): number {
    return this.timer.sittingMs;
  }

  private createProvider(): IExerciseProvider {
    const generator = this.deps.presets.get(this.currentSettings.presetId).generator;
    const factory =
      this.deps.providerFor ?? ((source: IExerciseGenerator) => new GeneratedExerciseProvider(source));
    return factory(generator);
  }
}

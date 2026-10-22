import type { AppRuntime } from '../composition/createApp.js';
import { FLOW_MODE_ID } from '../application/modes/FlowMode.js';
import {
  modeIsOn,
  modesOn,
  settingsForFrame,
  settingsForMode,
  type PlayedWith,
} from '../application/modes/challengeModes.js';
import { barCells } from '../domain/scoring/barCells.js';
import { nameOfThePitchClass, nameTheChord, theChordTheNotesMake } from '../domain/harmony/chordName.js';
import { DYNAMIC_LEVELS, DYNAMIC_VELOCITY, type DynamicLevel } from '../domain/model/Exercise.js';
import { eachKeyOnce, sameKeys, theChordsOfTheScale } from '../domain/harmony/chordsOfTheKey.js';
import type { KeyFrom } from '../domain/harmony/chordsAlong.js';
import { theChordMovedTo } from '../domain/harmony/chordMoved.js';
import {
  SCALES,
  SCALE_NAMES,
  theSignatureOfTheScale,
  theTonicOfTheScale,
  theNameOfTheKey,
  thePitchClassesOfTheScale,
  theTonicPitchClass,
} from '../domain/harmony/scales.js';
import { barsOfThePicture, tiersOfThePicture } from '../domain/scoring/ReadingPicture.js';
import { LISTEN_MODE_ID } from '../application/modes/ListenFrame.js';
import { FREE_PLAY_MODE_ID } from '../application/modes/FreePlayFrame.js';
import { clockTime, describeTheScrubBar, momentOfTheScrubBar, type ScrubBar } from './scrubBar.js';
import {
  theTakeOnTheKeys,
  theTakesKeysAt,
  theTakesPedalAt,
  theTakesPedalBetween,
  theTakesPressesBetween,
  type TakeOnTheKeys,
} from '../application/takeOnTheKeys.js';
import { BAR_MODE_ID } from '../application/modes/BarMode.js';
import { NOTE_MODE_ID } from '../application/modes/NoteMode.js';
import { WAIT_MODE_ID } from '../application/modes/WaitMode.js';
import type { PracticeSession } from '../application/session/PracticeSession.js';
import type { SessionStatus } from '../application/session/SessionState.js';
import type { PositionEvent } from '../application/session/SessionEvents.js';
import type { MidiConnectionStatus, MidiEvent } from '../application/ports/IMidiSource.js';
import {
  CLICK_NOTES_OF,
  CLICK_WHEN_CHOICES,
  CLICK_PATTERNS,
  type ClickNotesOf,
  dropoutCycleBars,
  type ChosenClickWhen,
  type ClickPattern,
  type BeatWeight,
} from '../application/ports/IMetronome.js';
import type { SessionScore } from '../domain/scoring/IScoringStrategy.js';
import {
  SAMPLE_LOADING_MODES,
  type SampleLoading,
} from '../application/ports/IPitchPlayer.js';
import type { PerformanceReport } from '../domain/scoring/PerformanceReport.js';
import { COMMON_KEYS, KeySignature } from '../domain/model/KeySignature.js';
import { TimeSignature } from '../domain/model/TimeSignature.js';
import { alterationSign, midiToLabel } from '../domain/model/Pitch.js';
import {
  barsAreHeardIn,
  takeWithTheKeyFrom,
  theBeatOfTheClickAt,
  theChangesOfTheClick,
  theKeyChangesOf,
  theKeyOfTheMusicAt,
  theClickInAnotherMetre,
  theClickOfTheTake,
  takeWithTheDynamicFrom,
  thePlayingWithABarInserted,
  theDynamicAt,
  theDynamicsOf,
  theVelocityOfTheLevel,
  LOUDNESS_UNMARKED,
  type NoteLoudness,
  theHandThatPlays,
  thePaceOfTheClick,
  thePlayingAtAnotherPace,
  writeMidiFile,
  type Hand,
  type HeardBeat,
  type KeyOfTheMusic,
  type MidiFileEvent,
} from '../domain/midi/MidiFile.js';
import { worstPassage } from '../domain/scoring/troubleSpots.js';
import { FREE_CLICK_STEP_BPM, LADDER_RUNS_TO_MOVE, TEMPO_STEP_PERCENT } from '../application/PracticeController.js';
import { drawTheLadderTrack, marksOfThePlace, type PlaceOnTheLadder } from './ladderTrack.js';
import type { PracticeSettings } from '../application/PracticeController.js';
import type { StoredTake } from '../application/TakeLibrary.js';
import { isTypedInto, type TypedInto } from '../shared/typedInto.js';
import {
  aKeyInTheScale,
  theBeatsToBeginIn,
  theScaleOfTheKey,
  theSketchOfTheScore,
  type SketchKey,
  type StoredSketch,
} from '../application/SketchLibrary.js';
import { CONFLICTING_COPY, type SketchOnTheDrive, type SketchSyncOutcome } from '../application/SketchSync.js';
import type { DrillTask } from '../application/drill/SectionDrill.js';
import type { ControlBinding } from '../application/ControlBinding.js';
import {
  RULER_DIVISIONS,
  type RulerDivision,
  type RulerMark,
} from '../application/rhythmRuler.js';
import { PLAYBACK_GOES_ON, PiecesInTurn, type PlaybackGoesOn } from '../application/PiecesInTurn.js';
import {
  scoresInOrder,
  theStarBand,
  theStarsIn,
  WHAT_OPENS,
  type ScoreOrder,
  type WhatOpens,
} from '../application/ScoreLibrary.js';
import { PAGE_TURNS, type PageTurns } from '../application/ports/IScoreRenderer.js';
import type { SavedPassage } from '../application/ports/IScoreStore.js';
import {
  CLICK_SILENCES,
  COUNT_IN_WHEN,
  type BeatSound,
  type ClickSilence,
  type CountInWhen,
} from '../application/ports/IMetronome.js';
import { TimeToday } from '../application/TimeToday.js';
import {
  KEYS_SHOWN,
  METRONOME_TAPS,
  DARK_SYSTEM_THEMES,
  PLAYED_NOTE_DISPLAYS,
  THEMES,
  type DarkSystemTheme,
  type KeysShown,
  type MetronomeTap,
  type PlayedNoteDisplay,
  type Theme,
} from '../application/PracticeController.js';
import { HOLD_MS } from '../shared/holding.js';
import { barItBeganIn, pieceOfKey, type PassageHistory, type PracticeReading } from '../application/PracticeHistory.js';
import {
  drawTheKeyboard,
  keepInView,
  HIGHEST_KEY,
  LOWEST_KEY,
  lightTheKeys,
  MIDDLE_C,
  scrollToShow,
  whereTheKeysAre,
  type KeyLight,
  type KeyPlace,
  type ReplayKeyboard,
} from './replayKeys.js';
import {
  FALLING_AHEAD_MS,
  paintTheLane,
  paintTheFallingPedal,
  theFallingBarLines,
  theFallingNotes,
  theFallingPedal,
  theFallingRuling,
  theRisingClick,
  theRisingNotes,
  theRisingPedal,
  type LanePedal,
  theLaneInks,
  type LaneRuling,
  type LaneBarLine,
  type LaneNote,
  type LaneInks,
} from './fallingNotes.js';
import type { StoredScoreSummary } from '../application/ports/IScoreStore.js';
import { replayFits } from '../application/runReplay.js';
import type { NoteCounts } from '../domain/scoring/PerformanceReport.js';
import type { ClosingCue, DrawnPassage, PassageEnd, ScorePageState } from '../application/ports/IScoreRenderer.js';
import { barLines, barNumberOf, measureCount, measureIndexAt, pedalHeldUntil, type Exercise } from '../domain/model/Exercise.js';
import type { ImportWarning } from '../domain/notation/MusicXmlParser.js';
import { theHitErrors } from '../domain/scoring/theHitErrors.js';
import { theProfile } from '../domain/scoring/theProfile.js';
import { drawTheHitErrors } from './hitErrorBar.js';
import { sizeOf, theStorageAccount } from './storageReport.js';
import { drawTheShareBar } from './shareBar.js';
import { findAll, wordsIn, type Found } from './settingsSearch.js';
import type { DriveScore } from '../application/LibrarySync.js';
import type { SyncProgressShown } from '../application/SyncProgress.js';
import type { SettingsSyncOutcome } from '../application/SettingsSync.js';

/** What happened to the settings, as the status line says it. */
const SETTINGS_WENT: Readonly<Record<SettingsSyncOutcome, string>> = {
  sent: 'sent',
  brought: 'brought here',
  same: 'already the same',
};
import { drawTheProfile } from './profileChart.js';
import { expectedFor, notesStruckAt, soundsFor, theStavesHoldingTheKeysAt } from '../domain/timeline/Timeline.js';
import {
  clicksBefore,
  clicksUpTo,
  rollAsEvents,
  rollBeganAtMs,
  rollEndedAtMs,
  rollOfTheScore,
  barsCountedOnItsBeats,
  rollOfTheTake,
  takeWithAKeyAdded,
  takeWithoutTheKeys,
  takeWithTheKeysChanged,
  takeWithTheKeysCopied,
  takeWithTheKeyCut,
  takeWithTheNotesPasted,
  takeWithTheChordsBroken,
  theMusicsBeats,
  type ArpeggioWay,
  takeWithThePedalAt,
  theBarsAcross,
  takeWithThePlayingRecorded,
  theNotesRecorded,
  theChangeOnTheClipboard,
  theClipboardTextOf,
  theClipboardTextOfTheChange,
  type ChangeCopied,
  theKeysOfTheTake,
  theNotesCopied,
  theNotesOnTheClipboard,
  type NoteCopied,
  theKeysOnTheGrid,
  theKeysHumanized,
  HUMANIZED_BY_AT_MOST,
  type KeyChange,
  type KeyNamed,
  type KeyOfTheTake,
  type RolledPress,
  takeOfTheRun,
  type RunRoll,
  theBeatNearest,
  theNextLineOfTheGrid,
  theLineOfTheGridUnder,
  theEndAKeyFitsTo,
  aKeyIsOverAnotherOfItsPitch,
  theMusicsPlaceAt,
  momentOfTicks,
  type GridChoice,
} from '../application/session/RunRoll.js';
import {
  paintTheChords,
  paintThePedal,
  paintTheGrid,
  type NoteShownAhead,
  paintTheRuler,
  theInksOf,
  type RollInks,
  type RollViewport,
  type Surface,
} from './rollPainter.js';
import { RollScroller, speedOf, type FingerAt } from './rollScroller.js';
import {
  drawTheMap,
  drawThePitchMap,
  drawTheRoll,
  rowFromTap,
  theCanvasesOf,
  theChordAt,
  theNotesOfTheChord,
  theNotesHeldIntoTheChord,
  theKeysStripOf,
  theMapOfThePitches,
  stretchesIn,
  thePitchesOfTheRun,
  theSceneOfTheRoll,
  whatTheChordsSayAt,
  whatThePedalSaysAt,
  theKeyAt,
  theKeysInABox,
  whatTheGridSaysAt,
  whatTheRulerSaysAt,
  type RollCanvases,
  type SceneChord,
  type RollPitches,
  type RollScene,
  type ScenePedal,
  scrollAfterZoom,
  shareOfTheRun,
  zoomAfterWheel,
  LEAST_ROW,
  LEAST_ZOOM,
  MOST_ROW,
  MOST_ZOOM,
  keepTheHeadInView,
  theRunScrolledUnderTheHead,
  scrollForTheWindowAt,
  theWindowOnTheRun,
  pinchedTo,
  timeFromTap,
  theHeadsOf,
  type FingerSpan,
  type PinchedFrom,
  type RollGhost,
  type RollHeads,
} from './rollView.js';
import type { LadderStep } from '../application/ladder/PracticeLadder.js';
import { readBackup } from '../application/Backup.js';
import { calibrationExercise } from '../domain/generation/calibrationExercise.js';

/**
 * How long the page waits after the last tempo press before re-engraving.
 *
 * Long enough that a run of presses costs one redraw rather than one each,
 * short enough that a single press still looks immediate.
 */
/** How often the bridge pill may redraw while he plays. */
const HOP_REFRESH_MS = 1_000;

/**
 * How often the time on the page is added up.
 *
 * Often enough that closing the tab loses only a few seconds, rarely enough
 * that it is nothing on a tablet's battery. Nothing is measured *by* this:
 * the gap between two readings of the clock is what is counted, so a slow
 * tick or a throttled one is still the right number of milliseconds.
 */
/**
 * How often the waiting bar is drained.
 *
 * Ten times a second, which is smooth enough to watch fall and cheap enough
 * to be doing while somebody plays. The moment is read off the clock rather
 * than counted in ticks, so a late one loses nothing.
 */
const SURVIVAL_TICK_MS = 100;

const TIME_TICK_MS = 5_000;

/** How many days the row of marks shows. */
const DAYS_IN_THE_ROW = 7;

/**
 * The most one tick may add, however long it has really been.
 *
 * A machine that went to sleep with the page open comes back with hours
 * between two readings of the clock, and none of them were practice. This is
 * the cheap half of noticing that nobody is there; the other half - a page on
 * screen that nobody is looking at - is a judgement worth making on its own.
 */
const TIME_TICK_CAP_MS = TIME_TICK_MS * 2;

/** How long a rest lasts, once the reader asks for one to be counted. */
const REST_LENGTH_MS = 3 * 60_000;

/** How long each of the rest's two notes sounds, and the gap between them. */
const CHIME_NOTE_MS = 900;
const CHIME_GAP_MS = 260;

/**
 * What to do with a rest, in his own words.
 *
 * Given in turn rather than at random, so the same one is not offered twice
 * running - a reminder that repeats itself is one that stops being read.
 */
/** How often a rest may be asked for, and what to call each answer. */
const REST_INTERVALS: readonly { readonly value: string; readonly label: string }[] = [
  { value: '20', label: 'Every 20 minutes' },
  { value: '30', label: 'Every 30 minutes' },
  { value: '45', label: 'Every 45 minutes' },
  { value: '60', label: 'Every 60 minutes' },
  { value: '0', label: 'Never' },
];

const REST_TIPS: readonly string[] = [
  'Stand up and walk about for a minute.',
  'Shake your hands out, and let the wrists hang.',
  'Look at something far away for twenty seconds, and blink.',
  'Drink something.',
  'Rest your eyes instead: put the playback on and play along without reading.',
];

const TEMPO_REDRAW_DELAY_MS = 350;

/**
 * Presses a run needs before its tendency means anything.
 *
 * Two or three notes average to whatever they happened to be; a bar or two of
 * playing averages to a habit.
 */
const MIN_PRESSES_TO_MEASURE = 8;

/**
 * The largest delay the slider can hold.
 *
 * Three hundred was the first ceiling and a reader measured exactly that,
 * which is what a ceiling looks like from underneath - a relay over a
 * wireless network can cost more than a third of a second on its own.
 */
const MAX_LATENCY_MS = 600;

/**
 * Whether an average is a tendency rather than an accident of the scatter.
 *
 * The first rule here asked for the scatter to be smaller than the average,
 * which is far too strict for reading at sight: pressing within a tenth of a
 * second either side is a good performance, and it hid a real ninety
 * milliseconds of delay behind ordinary human unevenness. What matters is not
 * how wide the presses were spread but how well *their average* is pinned
 * down, and averaging many of them pins it down better - which is the whole
 * reason a run is worth more than one press. Two standard errors is the
 * ordinary line for "this is not nothing".
 */
/**
 * The middle value, which is what a run's tendency really is.
 *
 * An average is pulled about by a handful of wild readings, and a run has
 * them: the opening presses of one arrived before the relay's clock had been
 * measured and were a whole second out, and averaged with the rest they gave
 * a number belonging to neither - three hundred and seventy against a truth
 * of a hundred and twenty. The middle value does not care how wrong the worst
 * few were.
 */
export function middle(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const at = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[at] ?? 0)
    : ((sorted[at - 1] ?? 0) + (sorted[at] ?? 0)) / 2;
}

/**
 * How far the readings sit from their middle, in the same units as a spread.
 *
 * The robust twin of a standard deviation: the middle distance from the
 * middle, scaled so that on ordinary scatter the two agree. Used for the same
 * reason as {@link middle} - a few readings a second out must not be able to
 * decide whether the rest of them say anything.
 */
export function spreadAround(values: readonly number[]): number {
  if (values.length < 2) {
    return 0;
  }
  const centre = middle(values);
  return middle(values.map((value) => Math.abs(value - centre))) * 1.4826;
}

export function isRealTendency(meanMs: number, spreadMs: number, presses: number): boolean {
  if (presses < 2) {
    return false;
  }
  const standardError = spreadMs / Math.sqrt(presses);
  return Math.abs(meanMs) > 2 * standardError;
}

/** Written out rather than escaped inline, where it has been mangled before. */
const NEWLINE = String.fromCharCode(10);

/** How often the take slider is moved while something is sounding. */
const TAKE_TICK_MS = 80;

/**
 * How near a slice's end a moment is to be on it: the beats and bar lines it
 * is laid on are whole milliseconds, worked out from crotchets.
 */
const SLICE_EDGE_MS = 1;

const MILLISECONDS_A_MINUTE = 60_000;

/** How far a sketch's beat is carried on past its end to be clicked under a recording: a quarter of an hour at 120. */
const RECORDED_BEATS_PAST_THE_END = 2_000;

/** How early a key may be struck and still be recorded, where there is no beat to say: as a downbeat is often struck. */
const EARLY_BY_AT_MOST_MS = 150;

/**
 * How long a held step button waits before its `count`th step after the
 * first: a hundred and fifty milliseconds, then twelve fewer each time down
 * to thirty, so a tempo a few beats away is easy to land on and one a hundred
 * away is reached in seconds.
 */
function repeatGapMs(count: number): number {
  return Math.max(30, 150 - 12 * (count - 1));
}
/**
 * What the player is asked to call the run it is sounding.
 *
 * A roll is not a take and has no id of its own, but the player is addressed by
 * one - and this is also what lets everything else tell whether the thing
 * sounding is the drawing's or the shelf's.
 */
const RUN_ROLL_ID = 'the run just played';
/** What the player is sounding while a run is shown again on the notes. */
const RUN_REPLAY_ID = 'a run shown again on the page';
/**
 * How far ahead of the sound the clicks over a playback are laid out.
 *
 * Long enough that a click is placed rather than raced for, short enough that
 * stopping does not leave one sounding after the picture has gone quiet.
 */
const ROLL_CLICK_LEAD_MS = 100;
/**
 * How often the keep pill's counter is redrawn while a take is open.
 *
 * It counts in whole seconds, so half of one is close enough that the number
 * is never visibly stale, and it costs nothing: the timer only exists between
 * the first thing the keyboard does and the silence that closes the take.
 */
const TAKE_COUNTER_MS = 500;

import type { Unsubscribe } from '../shared/EventEmitter.js';
import { fillSelect, requireElement } from './dom.js';
import { keepTheTrail, timeTheStart, traceTheStart } from '../shared/timeTheStart.js';
import { noteAFrame, noteTheFramesStopped, thePlaybackTimingsText } from '../shared/playbackTimings.js';

/** How far a wheel's line is, for a wheel that counts in lines. */
const LINE_PX = 16;
/** The viewer's Back button as a rewind, and as a stop. */
const REWIND_ICON = 'M6 6h2v12H6zM9.5 12l8.5 6V6z';
const STOP_ICON = 'M6 6h12v12H6z';

/** The average of some loudnesses, rounded; the middle of the range where there are none. */
function theMiddleOf(loudness: readonly number[]): number {
  return loudness.length === 0 ? 64 : Math.round(loudness.reduce((sum, level) => sum + level, 0) / loudness.length);
}

/** A loudness MIDI can strike a note at: 1 to 127, since nought is no note. */
/**
 * The marks a sketch's notes can be set to, quietest first: the six the
 * ladder's highest grades write, which are what a piano piece is mostly
 * marked in. Struck as the importer plays a score marked so.
 */
const DYNAMICS_OFFERED: readonly DynamicLevel[] = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];

/** How hard a mark is struck, from 1 to 127: as a score's notes marked so are played. */
function theLoudnessOfTheDynamic(level: DynamicLevel): number {
  return clampTheLoudness(Math.round(DYNAMIC_VELOCITY[level] * 127));
}

function clampTheLoudness(level: number): number {
  return Math.min(127, Math.max(1, level));
}

/** Whether two names are of one key: the same pitch, gone down at the same moment. */
function sameKey(one: KeyNamed, other: KeyNamed): boolean {
  return one.midi === other.midi && one.downAtMs === other.downAtMs;
}

/** How long a chord tapped in the lane sounds at most: long enough to be heard as a chord, short of a bar of one. */
const A_CHORD_TAPPED_SOUNDS_MS = 1_200;

/** The grid of bar lines alone, which a slice's ends go to. */
const BAR_LINES_ONLY: GridChoice = { beats: false, parts: 1 };

/** How often, at most, coming back to the page syncs it: see `syncOnComingBack`. */
const SYNCED_ON_COMING_BACK_AT_MOST_EVERY_MS = 60_000;

/** How near either end of a note the mouse or a finger takes hold of that end, in pixels. */
const GRIP_PX = 10;

/** What of a note or a press of the pedal is taken hold of: the whole of it, moved, or one end, held longer or shorter. */
type Grip = 'whole' | 'start' | 'end';

/**
 * Which part of a stretch across the drawing a moment is on: an end, for
 * the last few pixels of it at either side - a third of one too short for
 * that, so the middle of it can still be moved - or the whole of it.
 */
function theGripOfAStretch(fromMs: number, untilMs: number, atMs: number, pxPerMs: number): Grip {
  const edgePx = Math.min(GRIP_PX, ((untilMs - fromMs) * pxPerMs) / 3);
  if ((untilMs - atMs) * pxPerMs <= edgePx) {
    return 'end';
  }
  return (atMs - fromMs) * pxPerMs <= edgePx ? 'start' : 'whole';
}

/**
 * The pitch a press of the pedal is named by for a second tap on it: one no
 * key has, so two taps, one on a note and one on the pedal, are never a pair.
 */
const THE_PEDALS_ROW = -1;

/** What the pencil says where it begins a sketch of a take: in its viewer, and on the page written from it. */
const BEGIN_A_SKETCH_OF_A_TAKE = 'Begin a sketch of this recording to edit; the recording stays as it was played';

/** The shortest a note can be held: shorter is a click rather than a note. */
const SHORTEST_NOTE_MS = 30;

/**
 * Beats of empty grid drawn past the end of a sketch: room for the next notes,
 * two bars of common time, and all of an empty sketch.
 */
const ROOM_IN_A_SKETCH = 8;

/**
 * A sketch as it was before a change, to be put back: a change of metre or
 * pace moves its beats as well, and the notes chosen then are chosen again,
 * so an undone move leaves in hand what was being moved.
 */
interface SketchAsItWas {
  readonly events: readonly MidiFileEvent[];
  readonly beats: readonly HeardBeat[];
  readonly chosen: readonly KeyNamed[];
}

/** A sketch kept as it is now, with the notes chosen on it, for an undo or a redo to come back to. */
function asItWas(
  sketch: { readonly events: readonly MidiFileEvent[]; readonly beats: readonly HeardBeat[] },
  chosen: readonly KeyNamed[],
): SketchAsItWas {
  return { events: sketch.events, beats: sketch.beats, chosen };
}

/** The corner of a box a pointer is at, kept inside the notes it chooses among. */
function theBoxCornerAt(
  box: { readonly grid: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | null },
  at: { readonly clientX: number; readonly clientY: number },
): { readonly clientX: number; readonly clientY: number } {
  const grid = box.grid;
  return grid === null
    ? at
    : {
        clientX: Math.min(grid.right, Math.max(grid.left, at.clientX)),
        clientY: Math.min(grid.bottom, Math.max(grid.top, at.clientY)),
      };
}

/**
 * Whether a press on a sketch adds to the notes chosen rather than choosing
 * alone: with Ctrl, Cmd or Shift held, as any editor has it. A finger chooses
 * several with the selection tool's box.
 */
function addsToTheChoice(event: PointerEvent): boolean {
  return event.ctrlKey || event.metaKey || event.shiftKey;
}

/**
 * What a sync did with the sketches, in a sentence: what went and came, and
 * - only where there were any - what was kept as a copy because it had been
 * changed on two devices at once.
 */
function theSketchesSynced(sketches: SketchSyncOutcome): string {
  const said = [`Sketches sent ${String(sketches.sent)}, brought here ${String(sketches.brought)}`];
  if (sketches.conflicts > 0) {
    said.push(
      `${String(sketches.conflicts)} changed on two devices at once, kept here as a ${CONFLICTING_COPY} beside the other`,
    );
  }
  return `${said.join('; ')}.`;
}

/** How long a note moved up or down by an arrow key is heard for, at its new pitch. */
const HEARD_ON_A_STEP_MS = 300;

/**
 * The keys to strike for notes heard together: one for each pitch among them,
 * as hard as the hardest of that pitch. The instrument has one voice for a
 * pitch, so a second strike of it at once only cuts the first off and starts
 * it again.
 */
function oneKeyForEachPitch(
  keys: readonly { readonly midi: number; readonly velocity: number }[],
): readonly { readonly midi: number; readonly velocity: number }[] {
  const hardest = new Map<number, number>();
  for (const { midi, velocity } of keys) {
    hardest.set(midi, Math.max(velocity, hardest.get(midi) ?? velocity));
  }
  return [...hardest].map(([midi, velocity]) => ({ midi, velocity }));
}

/**
 * How close two taps must come to be one double tap: as quick as the
 * double click a desktop counts, and as near as a finger lands twice.
 */
const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_PX = 12;

/** How far down the run the view stood, and the place down it a change of row height is held at. */
interface RowsHeld {
  readonly scrolledDownPx: number;
  readonly viewTallPx: number;
  readonly wholeTallPx: number;
  readonly atPx: number;
}

/**
 * How long a beat lasts where a moment falls, on a roll's beats: a note
 * written there is that long. Half a second where the roll has no beats.
 */
function theBeatAt(roll: RunRoll, atMs: number): number {
  const beats = roll.beats;
  let at = 0;
  while (at + 1 < beats.length && (beats[at + 1]?.atMs ?? 0) <= atMs) {
    at += 1;
  }
  const here = beats[at]?.atMs;
  const next = beats[at + 1]?.atMs ?? null;
  const before = beats[at - 1]?.atMs ?? null;
  if (here !== undefined && next !== null) {
    return next - here;
  }
  return here !== undefined && before !== null ? here - before : 500;
}

/**
 * What a chord of the drawer would do to the sketch: the keys heard as it is
 * held, and struck by a key's press of its button; the sketch with it; the
 * notes chosen after; the notes it puts or moves, to show ahead; how loud,
 * how long it sounds, and where the cursor goes, or nowhere.
 */
interface ChordWritten {
  /** Whether it changes the sketch at all: a chord written where it already is changes nothing, but is still heard. */
  readonly changes: boolean;
  readonly heard: readonly number[];
  readonly struck: readonly number[];
  readonly events: readonly MidiFileEvent[];
  readonly chosen: readonly KeyNamed[];
  readonly shown: readonly { readonly midi: number; readonly fromMs: number; readonly untilMs: number }[];
  readonly velocity: number;
  readonly lengthMs: number;
  readonly headAfterMs: number | null;
}

/**
 * How long a finger rests on a chord of the drawer before moving for the
 * move to slide over the others, each heard, rather than scroll the column
 * they stand in: a scroll is a finger moving as it comes down, a slide one
 * that has stopped to listen first.
 */
const A_FINGER_LISTENS_MS = 250;

/** How far a finger on a chord of the drawer goes before it is moving at all, and not only resting unsteadily. */
const A_FINGER_MOVES_PX = 8;

/**
 * The dynamic marked on a moment, and whether reached gradually, as a change
 * copied says one: none where the moment is marked in the one before it.
 */
function theDynamicMarkedAt(events: readonly MidiFileEvent[], atMs: number): { readonly dynamic?: DynamicLevel; readonly gradually?: true } {
  const here = theDynamicAt(events, atMs);
  if (here === null || here === theDynamicAt(events, atMs - 1)) {
    return {};
  }
  return { dynamic: here, ...(theDynamicReachedGraduallyAt(events, atMs) ? { gradually: true } : {}) };
}

/**
 * A dynamic as its flag says it: its level, after a hairpin opening or
 * closing towards it where it is reached gradually from the one before.
 */
function theNameOfTheDynamic(
  dynamic: { readonly atMs: number; readonly level: DynamicLevel; readonly gradually?: true },
  dynamics: readonly { readonly atMs: number; readonly level: DynamicLevel }[],
): string {
  const from = dynamics.filter((each) => each.atMs < dynamic.atMs).pop();
  if (dynamic.gradually !== true || from === undefined) {
    return dynamic.level;
  }
  return `${DYNAMIC_LEVELS.indexOf(dynamic.level) > DYNAMIC_LEVELS.indexOf(from.level) ? '<' : '>'} ${dynamic.level}`;
}

/** Whether the dynamic marked on a moment is reached gradually from the one before. */
function theDynamicReachedGraduallyAt(events: readonly MidiFileEvent[], atMs: number): boolean {
  return theDynamicsOf(events).some((dynamic) => Math.abs(dynamic.atMs - atMs) < 1 && dynamic.gradually === true);
}

/** How the way a chord is broken is said on its button. */
const ARPEGGIO_WAYS: Readonly<Record<ArpeggioWay, string>> = {
  up: 'up',
  down: 'down',
  upAndDown: 'up and back down',
};

/** A chord as the drawer offers it: its name, what is said under it, and its keys. */
interface ChordInTheDrawer {
  readonly name: string;
  readonly under: string;
  readonly midis: readonly number[];
  readonly kept: boolean;
}

/** What a chord's keys are called: the chord they make, or where they make none, each key's name. */
function theNameOfTheKeys(midis: readonly number[], fifths: number): string {
  return nameTheChord(midis, fifths) ?? eachKeyOnce(midis).map((midi) => nameOfThePitchClass(midi, fifths)).join(' ');
}

/** A button's title and label, and whether it is dimmed for the reason the title gives. */
function sayWhetherIdle(button: HTMLElement, says: string, idle: boolean): void {
  button.title = says;
  button.setAttribute('aria-label', says);
  if (idle) {
    button.dataset['idle'] = 'true';
  } else {
    delete button.dataset['idle'];
  }
}

/** Where a beat is, as a change on it is named: "bar 3", or "bar 3, beat 2" inside the bar. */
function thePlaceOfTheBeat(beat: { readonly bar: number; readonly beat: number }): string {
  return beat.beat === 0 ? `bar ${String(beat.bar)}` : `bar ${String(beat.bar)}, beat ${String(beat.beat + 1)}`;
}

/** How loud a note is written: as the sketch's notes are on the whole, and moderately where it has none. */
function theUsualLoudness(events: readonly MidiFileEvent[]): number {
  const loudness = events.flatMap((event) => (event.kind === 'noteOn' ? [event.velocity] : [])).sort((a, b) => a - b);
  return loudness[Math.floor(loudness.length / 2)] ?? 0.7;
}

/** How far a finger may wander and still be tapping, in pixels. */
const TAP_SLOP_PX = 6;

/**
 * A canvas whose size is already known, so the painter is told it rather than
 * made to ask the page.
 */
function sized(canvas: HTMLCanvasElement, widePx: number, tallPx: number): Surface {
  return {
    clientWidth: widePx,
    clientHeight: tallPx,
    get width() {
      return canvas.width;
    },
    set width(value: number) {
      canvas.width = value;
    },
    get height() {
      return canvas.height;
    },
    set height(value: number) {
      canvas.height = value;
    },
    getContext: (kind) => canvas.getContext(kind),
  };
}

/**
 * How this reading compares with the ones before it.
 *
 * The single question a returning reader has - is this getting better - and
 * one the score alone cannot answer, because a number means nothing without
 * the number before it.
 */
function historyRow(
  history: PassageHistory | null,
): readonly (readonly [string, string])[] {
  if (history === null || history.attempts < 2) {
    return [];
  }
  const move = history.previous === null ? 0 : history.last - history.previous;
  const direction = Math.abs(move) < 0.02 ? 'about the same' : move > 0 ? 'better' : 'worse';
  return [
    [
      `Reading ${history.attempts}`,
      `${direction} · best ${Math.round(history.best * 100)}%`,
    ],
  ];
}

/**
 * The signed average, which says something the absolute one cannot.
 *
 * Scatter either side of the beat is a precision problem and takes practice;
 * a whole run sitting consistently ahead of it is a habit, and knowing which
 * of the two you have is worth more than any amount of scatter detail. Small
 * enough and it is neither - just being human.
 */
export function describeTendency(meanDeviationMs: number): string {
  const rounded = Math.round(meanDeviationMs);
  if (Math.abs(rounded) < 15) {
    return 'even';
  }
  return rounded < 0 ? `${Math.abs(rounded)} ms early` : `${rounded} ms late`;
}

/** How the score is cut into pages, and what it was cut against. */
function describePages(state: ScorePageState, wanted: boolean): string {
  if (!wanted) {
    return `off (window ${state.windowPx} px, score ${state.contentPx} px)`;
  }
  return (
    `${state.at + 1} of ${state.count}` +
    `   window ${state.windowPx} px   score ${state.contentPx} px`
  );
}

/** Which bars are on the page, and which of them the run will play. */
function describeBarRange(controller: AppRuntime['controller']): string {
  const exercise = controller.currentExercise;
  const { firstBar, lastBar } = controller.pieceBarRange;
  if (exercise === null) {
    return 'none';
  }
  const bars = measureCount(exercise);
  const printedFrom = exercise.firstBarNumber;
  return (
    `page ${printedFrom}-${printedFrom + bars - 1} (piece ${firstBar}-${lastBar})` +
    `   passage: ${controller.settings.rangeFromBar ?? '-'}..${controller.settings.rangeToBar ?? '-'}` +
    `   steps: ${controller.beginsAt}..`
  );
}

/**
 * What each kind of run does, in one sentence.
 *
 * Said in one place because it is said in two: the sheet where the run is
 * chosen and the line under the settings select. Two copies of a sentence
 * are two sentences the first time either is edited.
 */
/**
 * The frame the app opens in, and so the one it says nothing about.
 *
 * A corner mark and a badge on Start exist to say "this is not the run you
 * last assumed", so the run a reader gets without asking for anything is the
 * one that needs no saying. Named once because three places ask it, and they
 * would go out of step the first time the app opened on something else.
 */
const PLAIN_FRAME = FLOW_MODE_ID;

/**
 * The frames that have a button, in the order the buttons stand.
 *
 * His, and it is a ladder: the least help first and the most last. The bar
 * line gives one place a bar to be found again, every note gives one at each
 * note while the beat still runs, waiting gives one at every note with no beat
 * at all. Flowing in time, which gives no help
 * at all, has no button: it is what is left when none is pressed. Free play
 * comes last, off the ladder: there is nothing on the page to be helped with.
 */
const FRAMES_OFFERED: readonly string[] = [
  BAR_MODE_ID,
  NOTE_MODE_ID,
  WAIT_MODE_ID,
  LISTEN_MODE_ID,
  FREE_PLAY_MODE_ID,
];

/**
 * The short name each frame goes by on the page.
 *
 * Not the id: this ends up in a class and in the corner's mark, where a dot
 * in the middle of `mode.listen` would be two class names rather than one.
 */
const FRAME_SLUG: Readonly<Record<string, string>> = {
  [BAR_MODE_ID]: 'bar',
  [NOTE_MODE_ID]: 'note',
  [WAIT_MODE_ID]: 'wait',
  [FLOW_MODE_ID]: 'flow',
  [LISTEN_MODE_ID]: 'listen',
  [FREE_PLAY_MODE_ID]: 'free',
};

/** What the button is called while it stands for each of them. */
const FRAME_NAME: Readonly<Record<string, string>> = {
  [BAR_MODE_ID]: 'Wait each bar',
  [NOTE_MODE_ID]: 'Wait each note',
  [WAIT_MODE_ID]: 'Wait for me',
  [FLOW_MODE_ID]: 'Flow in time',
  [LISTEN_MODE_ID]: 'Listen to it',
  [FREE_PLAY_MODE_ID]: 'Free play',
};

/** And what it is drawn as, one path each, the way the transport icons are. */
const FRAME_ICON: Readonly<Record<string, string>> = {
  // Movement, and the line it stops at.
  [BAR_MODE_ID]: 'M3 11h9V7l6 5-6 5v-4H3v-2z M20 4h2v16h-2z',
  // Movement, and the note it stops at.
  [NOTE_MODE_ID]: 'M2 11h9V7l6 5-6 5v-4H2v-2z M20.5 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z',
  [WAIT_MODE_ID]:
    'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm1 3v5.3l3.6 2.1-1 1.7L11 13.5V7h2z',
  [FLOW_MODE_ID]: 'M12 3h2l4 16H6L10 3h2zm-1 3-2.6 11h7.2L13 6h-2z M6 15h12v2H6z',
  [LISTEN_MODE_ID]: 'M4 9v6h4l5 4V5L8 9H4zm12-.5a4.5 4.5 0 0 1 0 7v-2a2.5 2.5 0 0 0 0-3v-2z',
  // Notes rising off a row of keys.
  [FREE_PLAY_MODE_ID]: 'M3 16h18v5H3z M5 6h3v8H5z M10.5 3h3v11h-3z M16 8h3v6h-3z',
};

/** The frame a button stands for, read off the slug it is marked with. */
function frameOfTheButton(button: HTMLElement): string | null {
  return FRAMES_OFFERED.find((frame) => FRAME_SLUG[frame] === button.dataset['frame']) ?? null;
}

/*
 * One line each, the length the squares say theirs in.
 *
 * They stand in one row now, and a card with a sentence on it beside cards
 * with a phrase is a row that does not line up. Said once and read in two
 * places - the card and the line under the settings select - so there is one
 * answer to what each frame does.
 */
const FRAME_WHAT: Readonly<Record<string, string>> = {
  [BAR_MODE_ID]: 'The bar line waits for you',
  [NOTE_MODE_ID]: 'Each note waits for you',
  [WAIT_MODE_ID]: 'The cursor waits for you',
  [FLOW_MODE_ID]: 'The beat carries the music',
  [LISTEN_MODE_ID]: 'The machine plays it to you',
  [FREE_PLAY_MODE_ID]: 'Play anything, nothing is judged',
};

/**
 * How often the bar line had to wait, where there is a bar line that waits.
 *
 * Said as a fraction of the bars read, because the number alone means nothing:
 * three in a piece of four bars is a reader who cannot hold the tempo, and
 * three in forty is one nearly ready to do without the gate. Shown at nought
 * too - that is the reading worth arriving at, and a row that vanishes when
 * the news is good is a row nobody trusts.
 */
function barsWaitedRow(report: PerformanceReport): readonly (readonly [string, string])[] {
  if (report.modeId === NOTE_MODE_ID) {
    // Every note it stood at, of the notes asked for: the same fraction, one
    // gate at each note instead of one at each bar.
    return [['Notes it waited at', `${report.totals.barsWaitedFor} of ${report.totals.playableSteps}`]];
  }
  if (report.modeId !== BAR_MODE_ID) {
    return [];
  }
  const bars = new Set(report.steps.map((step) => step.measureIndex)).size;
  return [['Bars it waited at', `${report.totals.barsWaitedFor} of ${bars}`]];
}

/**
 * A control in the drawer that can have nothing to say.
 *
 * Named rather than discovered, because the list is the claim: these are the
 * settings another setting can empty, and a control added to the drawer is
 * not quietly assumed to be one of them.
 */
type IdleControl =
  | 'preset'
  | 'rhythm'
  | 'key'
  | 'time-signature'
  | 'measures'
  | 'playing-ahead'
  | 'hear-other-hand'
  | 'rushing-counts'
  | 'click-when'
  | 'dark-system-theme';

/**
 * Why a control has nothing to say just now, or `null` where it has.
 *
 * His: dim the modes another mode has emptied. The squares already say so,
 * and the drawer is where the same answers are written down - a switch
 * standing there at full strength, doing nothing whatever it is set to, is
 * the program letting the reader decide something that has no content.
 *
 * Left usable all the same. Unlike the squares, nothing here contradicts
 * anything: an answer given early is simply waiting for the setting that
 * gives it meaning, and refusing it would mean the reader could not set a
 * mode up before turning it on.
 */
function whyItIsIdle(
  control: IdleControl,
  settings: PracticeSettings,
  keepsTime: boolean,
  opened: boolean,
): string | null {
  switch (control) {
    // These describe material the program writes. With a score on the stand
    // there is nothing for them to describe - and which of the two is being
    // read is a fact rather than a mode, so nobody has to declare it: open a
    // score and they empty, ask for a fresh exercise and they fill again.
    case 'preset':
    case 'rhythm':
    case 'key':
    case 'time-signature':
    case 'measures':
      return opened ? 'A score is on the stand; this writes the exercises.' : null;
    case 'playing-ahead':
      return keepsTime ? 'Under a pulse the beat says where a press belongs, not the reader.' : null;
    case 'hear-other-hand':
      return settings.handStaff === null
        ? 'Both hands are being read, so there is no other one to hear.'
        : null;
    case 'rushing-counts':
      return settings.hearTheOtherHand && settings.handStaff !== null
        ? null
        : 'Nothing of the other hand is sounding to be ahead of.';
    case 'click-when':
      return settings.clickOn ? null : 'The metronome is off. The switch at the top turns it on.';
    case 'dark-system-theme':
      return settings.theme === 'system' ? null : 'Used only when the theme is System.';
    default:
      return null;
  }
}

/** An empty box means "no limit", which is a choice and not a missing value. */
function barValue(input: HTMLInputElement): number | null {
  const parsed = Number.parseInt(input.value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const CLICK_LABELS: Readonly<Record<ClickPattern, string>> = {
  downbeat: 'First beat of the bar',
  pulse: 'Every beat',
  division: 'Every half beat',
  subdivision: 'Every quarter beat',
  notes: 'The notes',
};

const CLICK_NOTES_LABELS: Readonly<Record<ClickNotesOf, string>> = {
  'my-hand': 'The notes I play',
  'both-hands': 'Every note, both hands',
};

/** Whose notes a stored or typed value names, or the reader's own. */
function readClickNotesOf(value: string): ClickNotesOf {
  return CLICK_NOTES_OF.includes(value as ClickNotesOf) ? (value as ClickNotesOf) : 'my-hand';
}

/**
 * How much of the run the click sits out, from none of it to all of it.
 *
 * The cycles are symmetric on purpose: an equal stretch of silence is the
 * standard exercise, and it makes each one a number the reader can reason
 * about.
 */
/** What a beat of the click in free play is, in words. */
const BEAT_SOUND_SAID: Readonly<Record<BeatSound, string>> = {
  accent: 'marked',
  beat: 'plain',
  silent: 'left out',
};

/** What a tap on a beat of the click in free play makes it. */
const BEAT_SOUND_NEXT: Readonly<Record<BeatSound, string>> = {
  accent: 'leave it plain',
  beat: 'leave it out',
  silent: 'mark it',
};

/** What a playback goes on to, as its button says it. */
const GOES_ON_SAID: Readonly<Record<PlaybackGoesOn, string>> = {
  this: 'Only this piece',
  list: 'The shelf in its order',
  random: 'The shelf shuffled',
};

/** The button's picture for each: a note, a list playing, and the shuffle. */
const GOES_ON_DRAWN: Readonly<Record<PlaybackGoesOn, string>> = {
  this: 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z',
  list: 'M4 10h12v2H4zm0-4h12v2H4zm0 8h8v2H4zm10 0v6l5-3z',
  random:
    'M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z',
};

const RULER_LABELS: Readonly<Record<RulerDivision, string>> = {
  off: 'None',
  metronome: 'Follow metronome',
  half: 'Halves',
  quarter: 'Quarters',
  eighth: 'Eighths',
  sixteenth: 'Sixteenths',
  'thirty-second': 'Thirty-seconds',
};

/**
 * What has to be typed before a whole shelf is emptied.
 *
 * English, like the rest of the interface, and read without regard to case
 * so that a tablet capitalising it is not an argument.
 */
const PURGE_WORD = 'DELETE';

/**
 * A stretch of practice, in the words somebody would use for it.
 *
 * Minutes up to an hour and then hours and minutes: nobody says "94 minutes",
 * and the point of the number is to be taken in at a glance rather than read.
 */
function describeSitting(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  // Seconds under the first minute, so that a page just opened says what it
  // is counting instead of appearing out of nowhere a minute later.
  if (minutes < 1) {
    return `${Math.floor(ms / 1_000)} s`;
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "1 kept score", "12 kept scores" - so the reader is told what they lose. */
function countOf(many: number, thing: string): string {
  return `${many} ${thing}${many === 1 ? '' : 's'}`;
}

/** When a count-in happens, said for a run and for a playback. */
const CLICK_SILENCE_LABELS: Readonly<Record<ClickSilence, string>> = {
  nothing: 'Nothing - click everything',
  'the-downbeat': 'The first beat of the bar',
  'the-beats': 'The beats, leaving the offbeats',
};

const CLICK_SILENCE_DESCRIPTIONS: Readonly<Record<ClickSilence, string>> = {
  nothing: 'Every click the pattern asks for is sounded.',
  'the-downbeat': 'The bar is yours to hold: nothing marks where it begins.',
  'the-beats':
    'Only what falls between the beats is sounded, so the beats are yours to place. Needs a ' +
    'pattern finer than the beat, and says nothing where there is none.',
};

const COUNT_IN_RUN_LABELS: Readonly<Record<CountInWhen, string>> = {
  never: 'Never',
  once: 'The first time only',
  every: 'Every time round',
};

const COUNT_IN_PLAYBACK_DESCRIPTIONS: Readonly<Record<CountInWhen, string>> = {
  never: 'The playback begins on its first note.',
  once: 'A count-in before it starts, so you can come in with it.',
  every:
    'And again before every repeat - which means each time round starts afresh rather than ' +
    'running straight on.',
};

const PAGE_TURN_LABELS: Readonly<Record<PageTurns, string>> = {
  preview: 'Turn them, and show the next page early',
  automatic: 'Turn them as the music leaves',
  manual: 'I turn them myself',
};

const PAGE_TURN_DESCRIPTIONS: Readonly<Record<PageTurns, string>> = {
  preview:
    'A page turn is the hardest moment to read across, so the top of the next page ' +
    'is drawn where the system you have finished used to be.',
  automatic: 'The page follows the music, and nothing is shown before its time.',
  manual:
    'For a piece already learned: the page waits for you, and arrows appear at the ' +
    'foot of the score. The arrow keys turn it too.',
};

const OPENING_LABELS: Readonly<Record<WhatOpens, string>> = {
  generated: 'A new exercise',
  last: 'The score I read last',
  random: 'One of my scores, at random',
  lastSketch: 'The sketch I worked on last',
  lastOfAll: 'Whatever I had open last',
};

const OPENING_DESCRIPTIONS: Readonly<Record<WhatOpens, string>> = {
  generated: 'Material generated at the level the ladder has reached.',
  last: 'The piece you were working on, where the library has it.',
  random:
    'Something to read is already there, so the question becomes whether to play it. ' +
    'Falls back to a new exercise while nothing is kept.',
  lastSketch:
    'The sketch you last edited or wrote down, open in the editor, and written down as a score ' +
    'under it. Falls back to a new exercise while there is none.',
  lastOfAll:
    'The score you read last, or the sketch you worked on last, whichever was later. ' +
    'Falls back to a new exercise while there is neither.',
};

const RULER_DESCRIPTIONS: Readonly<Record<RulerDivision, string>> = {
  off: 'Nothing ruled through the bars.',
  metronome: 'A line wherever the metronome clicks - on the beat, or on its parts - in the metre of each bar, 6/8 as well.',
  half: 'A line at every half note - the broad shape of a slow piece.',
  quarter: 'A line at every quarter, so the beats of the bar can be seen.',
  eighth: 'A line at every eighth, for reading offbeats against the beat.',
  sixteenth: 'A line at every sixteenth, for a bar that is full of them.',
  'thirty-second': 'Every thirty-second, which is a grid more than a ruler.',
};

/** When a stored or typed value says to count in, or the given fallback. */
function readCountIn(value: string, fallback: CountInWhen): CountInWhen {
  return COUNT_IN_WHEN.includes(value as CountInWhen) ? (value as CountInWhen) : fallback;
}

/** The way of turning a stored or typed value names, or the usual one. */
function readPageTurns(value: string): PageTurns {
  return PAGE_TURNS.includes(value as PageTurns) ? (value as PageTurns) : 'preview';
}

const METRONOME_TAP_LABELS: Readonly<Record<MetronomeTap, string>> = {
  'opens-its-sheet': 'Opens this sheet',
  'turns-it-off-and-on': 'Turns the metronome off and on',
};

const METRONOME_TAP_DESCRIPTIONS: Readonly<Record<MetronomeTap, string>> = {
  'opens-its-sheet': 'Holding the button turns the metronome off and on.',
  'turns-it-off-and-on': 'Holding the button, or a right click, opens this sheet.',
};

/** What a tap on the metronome's button does, as a stored or typed value names it. */
function readMetronomeTap(value: string): MetronomeTap {
  return METRONOME_TAPS.includes(value as MetronomeTap) ? (value as MetronomeTap) : 'opens-its-sheet';
}

/**
 * How long before a note's beat the cursors begin to close on it, and how long
 * they stay met on it after: long enough to be seen coming and seen to meet,
 * short enough that a run of quick notes is not a crowd of them.
 */
const CLOSING_LEAD_MS = 1_000;
const CLOSING_MET_MS = 120;

/** The opening a stored or typed value names, falling back to generating. */
function readWhatOpens(value: string): WhatOpens {
  return WHAT_OPENS.includes(value as WhatOpens) ? (value as WhatOpens) : 'generated';
}

/** The ruling a stored or typed value names, or none at all. */
function readRuler(value: string): RulerDivision {
  return RULER_DIVISIONS.includes(value as RulerDivision) ? (value as RulerDivision) : 'off';
}

const CLICK_WHEN_LABELS: Readonly<Record<ChosenClickWhen, string>> = {
  always: 'All the way through',
  'with-my-bars': 'With me, bar by bar',
  'with-me': 'With me, beat by beat',
  'count-in-only': 'Only the count-in',
  'cycle-1': '1 bar on, 1 off',
  'cycle-2': '2 bars on, 2 off',
  'cycle-4': '4 bars on, 4 off',
};

function dropoutDescription(when: ChosenClickWhen, countInBars: number): string {
  if (when === 'always') {
    return 'The click plays all the way through.';
  }
  if (when === 'count-in-only') {
    // Chosen together with no count-in, this asks for silence and nothing
    // else, which is worth saying rather than leaving to be discovered.
    return countInBars > 0
      ? 'You are given the tempo and then left with it for the whole run.'
      : 'There is no count-in to give you the tempo, so nothing will sound at all.';
  }
  if (when === 'with-me') {
    // It fell through to the cycle below, which has no bars to name for it and
    // said the click would leave the reader alone for nought bars at a time.
    return 'Every click is where you put it. Nothing sounds until you play.';
  }
  if (when === 'with-my-bars') {
    return 'A steady click inside the bar, started again on your own downbeat at each bar line.';
  }
  const bars = dropoutCycleBars(when) ?? 0;
  return (
    `The click leaves you alone for ${bars} bar${bars === 1 ? '' : 's'} at a time. ` +
    'You find out on its return whether you drifted.'
  );
}

const CLICK_DESCRIPTIONS: Readonly<Record<ClickPattern, string>> = {
  downbeat: 'One click per bar. You keep the pulse inside it.',
  pulse: 'The felt beat: two dotted quarters in 6/8, four quarters in 4/4.',
  division: 'Halves the beat, or thirds it in compound time.',
  subdivision: 'The finest click. Useful for sixteenths, busy everywhere else.',
  notes:
    'A click as each note falls - the rhythm of the music, heard. The count-in is ' +
    'beaten as ever, and where the music waits for you it clicks on the beat.',
};

/**
 * Where the veil sits, as one ordered menu from tidying to demanding.
 *
 * Dimming what is behind and hiding what is under the fingers are the same
 * act at different distances, so they are one control: two checkboxes would
 * let the reader ask for both and mean nothing by it.
 */
const READ_AHEAD_CHOICES: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'off', label: 'Never' },
  { value: '0', label: 'Once I have played them' },
  { value: '1', label: 'As I reach them' },
  { value: '2', label: 'One step before I reach them' },
];

const READ_AHEAD_DESCRIPTIONS: Readonly<Record<string, string>> = {
  off: 'The whole page stays on screen.',
  '0': 'The page empties behind you. Nothing is demanded; there is just less to look at.',
  '1': 'The note under your fingers is already gone, so it has to have been read first.',
  '2': 'Two steps of reading ahead. Harsh, and the fastest way to stop reading note by note.',
};

function readAheadValue(steps: number | null): string {
  return steps === null ? 'off' : String(steps);
}

function parseReadAhead(value: string): number | null {
  const steps = Number.parseInt(value, 10);
  return Number.isFinite(steps) ? steps : null;
}

/** The moment it was kept, which is the only name a take has until it earns one. */
/**
 * How long ago a score was last read, in the words a reader would use.
 *
 * Days and not hours: a list ordered by when things were last opened is only
 * confusing if it does not say why, and "yesterday" is the whole of what
 * anybody wants to know about a piece they might play next. Counted in
 * calendar days rather than in twenty-four hour blocks, so a score read late
 * last night is yesterday's this morning and not "18 hours ago".
 */
/**
 * One reading in a line: what was played, how it went, and how.
 *
 * The key says the piece and the bars in the shape `practiceKey` writes them,
 * so it is unpicked here rather than stored twice. A generated level says so
 * instead of pretending to a name it does not have.
 */
/** The piece a key names, as the reader would call it. */
function pieceRead(key: string): string {
  const [what = ''] = key.split(' bars:');
  return what.startsWith('score:')
    ? what.slice('score:'.length)
    : what.startsWith('level:')
      ? 'Exercise'
      : what;
}

function describeReading(reading: {
  readonly key: string;
  readonly overall: number;
  readonly grade: string;
  readonly completed: boolean;
  readonly tempoPercent?: number;
  readonly hand?: number | null;
}): string {
  const [, bars = ''] = reading.key.split(' bars:');
  const piece = pieceRead(reading.key);
  const how: string[] = [`${Math.round(reading.overall * 100)}% ${reading.grade}`];
  if (!reading.completed) {
    how.push('stopped');
  }
  if (reading.tempoPercent !== undefined && reading.tempoPercent !== 100) {
    how.push(`${reading.tempoPercent}%`);
  }
  if (reading.hand !== undefined && reading.hand !== null) {
    how.push(reading.hand === 1 ? 'right hand' : 'left hand');
  }
  const where = bars === '' ? piece : `${piece} · bars ${bars}`;
  return `${where} · ${how.join(' · ')}`;
}

function describeWhen(atMs: number, nowMs: number): string {
  const startOfDay = (ms: number): number => {
    const day = new Date(ms);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
  };
  const days = Math.round((startOfDay(nowMs) - startOfDay(atMs)) / 86_400_000);
  if (days <= 0) {
    return 'today';
  }
  if (days === 1) {
    return 'yesterday';
  }
  if (days < 7) {
    return `${days} days ago`;
  }
  if (days < 35) {
    const weeks = Math.round(days / 7);
    return weeks === 1 ? 'a week ago' : `${weeks} weeks ago`;
  }
  const months = Math.round(days / 30);
  if (months < 12) {
    return months === 1 ? 'a month ago' : `${months} months ago`;
  }
  return 'over a year ago';
}

/**
 * A take as a MIDI file. Written from the events, never stored as bytes: the
 * performance is the kept thing and the file is derived from it, the same way
 * the printed MusicXML is derived from an `Exercise`. In the bars of the click
 * it was played to, where it was played to one, and otherwise in those a
 * sketch of it begins in: see `theTakeAsWritten`.
 */
function theTakeAsAFile(take: StoredTake): Uint8Array {
  return thePlayingAsAFile(theTakeAsWritten(take), takeName(take.savedAtMs));
}

/**
 * A take with the beats it is written down in: the click it was played to,
 * or, played without one, common time at 120 from its first note - the bars a
 * sketch of it begins in (`theBeatsToBeginIn`), so its file, its score and
 * its sketch agree about where every bar is.
 */
function theTakeAsWritten(take: StoredTake): StoredTake {
  return { ...take, beats: theBeatsToBeginIn(take.events, take.beats) };
}

/** Some playing as a MIDI file, in the bars of its click where it has one, and in its key where it has one. */
function thePlayingAsAFile(
  playing: {
    readonly events: readonly MidiFileEvent[];
    readonly beats: readonly HeardBeat[];
    readonly key?: SketchKey;
  },
  name: string,
): Uint8Array {
  const key = playing.key;
  return writeMidiFile(playing.events, {
    trackName: name,
    beats: playing.beats,
    ...(key === undefined ? {} : { key: { fifths: key.fifths, minor: key.mode === 'minor' } }),
  });
}

/** The paces a sketch may be set to, in crotchets a minute: those a metronome offers. */
const SLOWEST_SKETCH_BPM = 20;
const FASTEST_SKETCH_BPM = 400;

/** The metres a sketch may be written in: the simple and compound ones a pianist meets. */
const SKETCH_METRES = ['2/4', '3/4', '4/4', '5/4', '6/4', '2/2', '3/2', '3/8', '5/8', '6/8', '7/8', '9/8', '12/8'] as const;

function takeName(savedAtMs: number): string {
  const at = new Date(savedAtMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/**
 * What the relay's clock is doing, in words.
 *
 * The number matters most when it is large: a reader looking at a third of a
 * second of lateness has no way of telling a slow keyboard from a computer
 * that thinks it is a different time, and only one of those is theirs.
 */
/**
 * What to add to the bridge pill about the hop, if anything.
 *
 * Only the spread, because only the spread is felt. A hop that takes the
 * same time every press is taken off every stamp along with the difference
 * between the two clocks; one that varies cannot be, and it is that
 * variation a reader feels as their timing wobbling.
 *
 * Nothing at all while it is steady enough not to matter: a pill that says
 * a number nobody needs is furniture.
 */
function describeHop(spreadMs: number | null): string {
  if (spreadMs === null || spreadMs < 8) {
    return '';
  }
  return ` · ±${Math.round(spreadMs)} ms`;
}

function describeSkew(skewMs: number | null): string {
  if (skewMs === null) {
    return 'not measured (no relay, or too few presses yet)';
  }
  const rounded = Math.round(skewMs);
  return Math.abs(rounded) < 20
    ? `agrees with this page (${rounded} ms)`
    : `${Math.abs(rounded)} ms ${rounded > 0 ? 'behind' : 'ahead of'} this page, and taken off every press`;
}

/** Named the same way as a backup, so a pair of them stay together. */
function judgingFileName(savedAtMs: number): string {
  return backupFileName(savedAtMs).replace(/^sight-reading-/, 'judging-').replace(/\.json$/, '.txt');
}

/** Named by the day it was taken, so two of them sort themselves. */
function backupFileName(savedAtMs: number): string {
  const at = new Date(savedAtMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `sight-reading-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}.json`
  );
}

/** A take's name as a score on the shelf, which goes by name: so to the second, and dated. */
function takeTitle(savedAtMs: number): string {
  return `Take ${whenItWas(savedAtMs)}`;
}

/** A moment to the second, and its day: what a title made from one goes by. */
function whenItWas(atMs: number): string {
  const at = new Date(atMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}, ${theDayItWas(atMs)}`;
}

/**
 * The day something was, without the time: what a sketch is named by, so its
 * name fits beside its buttons on a phone and still says when it was begun.
 */
function theDayItWas(atMs: number): string {
  const at = new Date(atMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)}.${at.getFullYear()}`;
}

function takeFileName(savedAtMs: number): string {
  const at = new Date(savedAtMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `take-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  );
}

const THEME_LABELS: Readonly<Record<Theme, string>> = {
  system: 'System',
  light: 'Light',
  'light-dark-dialogs': 'Light, dark dialogs',
  dark: 'Dark',
};

const PLAYED_NOTE_LABELS: Readonly<Record<PlayedNoteDisplay, string>> = {
  live: 'As I play them',
  'at-end': 'Only when the run ends',
  hidden: 'Never',
};

const PLAYED_NOTE_DESCRIPTIONS: Readonly<Record<PlayedNoteDisplay, string>> = {
  live: 'Each press appears on the page the moment it lands.',
  'at-end':
    'The page stays as the engraver drew it, and the whole reading appears at once when you stop.',
  hidden: 'Your presses are judged and scored, but never drawn.',
};

function readPlayedNotes(value: string): PlayedNoteDisplay {
  return PLAYED_NOTE_DISPLAYS.includes(value as PlayedNoteDisplay)
    ? (value as PlayedNoteDisplay)
    : 'live';
}

/** The transport icons, as one path each so only the `d` has to change. */
const PLAY_ICON = 'M8 5l11 7-11 7z';
/** An arrow down onto a line: what the drive has, brought down to this device. */
const BRING_HERE_ICON = 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z';
/** A bin, as the drawing's own Delete is drawn. */
const TRASH_ICON = 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z';
const PAUSE_ICON = 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z';

/** Note size, in the same steps the slider offers. */
const ZOOM_STEP_PERCENT = 5;
const MIN_ZOOM_PERCENT = 40;
const MAX_ZOOM_PERCENT = 220;

/** Which stave is which hand, as the score numbers them. */
const RIGHT_HAND_STAFF = 1;
const LEFT_HAND_STAFF = 2;

/**
 * The next answer to "which hand", cycling through all three.
 *
 * Both, then the left alone, then the right alone: one press narrows, and a
 * third gives the music back. A single button can carry that where three
 * would take a row the bar does not have.
 */
/**
 * Which staves the run is asking for, as a set rather than as one answer.
 *
 * The setting holds one of three: both hands, or the number of the single
 * staff being read. Two switches need to know which of *them* are on, which
 * is the same fact said the other way round.
 */
function handsPlaying(handStaff: number | null): number[] {
  return handStaff === null ? [RIGHT_HAND_STAFF, LEFT_HAND_STAFF] : [handStaff];
}

/**
 * The setting after one staff's switch has been pressed.
 *
 * Turning off the last hand still standing is read as "put them both back":
 * a run that asks for nothing is not a thing anyone means, and refusing the
 * press outright would leave a switch that sometimes does nothing with no
 * way of saying why.
 */
function handsAfterToggling(handStaff: number | null, staffNumber: number): number | null {
  const playing = new Set(handsPlaying(handStaff));
  if (playing.has(staffNumber)) {
    playing.delete(staffNumber);
  } else {
    playing.add(staffNumber);
  }
  if (playing.size !== 1) {
    return null;
  }
  return [...playing][0] ?? null;
}

function nextHand(current: number | null): number | null {
  if (current === null) {
    return LEFT_HAND_STAFF;
  }
  return current === LEFT_HAND_STAFF ? RIGHT_HAND_STAFF : null;
}

/**
 * How a step landing is drawn, and the longest a drain may take to glide.
 *
 * A settlement is a thing that happened, so it arrives; a drain is time
 * passing, so it slides. The cap catches a pulse so slow that the bar would
 * appear frozen between beats.
 */
const SETTLE_MS = 120;
const MAX_GLIDE_MS = 2000;

/**
 * How fast the survival bar should be gliding, given the pulse it is on.
 *
 * A *pace*, not the time since the last thing happened, and that distinction
 * is the whole bug. The pulse fires and the bar begins a glide; a step lands
 * in the same turn and, timed from "just now", overwrote it with a snap. So
 * the bar glided until steps started completing - which is most beats - and
 * then jumped for the rest of the piece. What a reader sees as "smooth, then
 * a sharp fall, then never smooth again".
 *
 * Everything is drawn at the drain's pace instead. A step landing only moves
 * where the bar is heading; how fast it travels is the music's business.
 */
export function healthGlideMs(previousPaceMs: number, nowMs: number, lastDrainAtMs: number | null): number {
  if (lastDrainAtMs === null) {
    return previousPaceMs;
  }
  return Math.min(MAX_GLIDE_MS, Math.max(SETTLE_MS, nowMs - lastDrainAtMs));
}

/** How far the handle must travel before a drag is a drag and not a tap. */
const DRAWER_DRAG_PX = 24;

const TIME_SIGNATURES = ['4/4', '3/4', '2/4', '3/8', '6/8'] as const;

/**
 * The selectors' answer where a rung draws its key or metre afresh for each
 * exercise. Never a value the settings hold: choosing a key by hand is what
 * leaves the route, and this is the route.
 */
const DRAWN = 'drawn';

/** How a selector names the set a rung draws from. */
function drawnFrom(names: readonly string[], noun: string): string {
  return names.length <= 4
    ? `Drawn each time: ${names.join(', ')}`
    : `Drawn each time from ${String(names.length)} ${noun}`;
}

/** Offers, or takes away, the selector's answer for a rung that draws. */
function offerTheDraw(select: HTMLSelectElement, label: string | null): void {
  select.querySelector(`option[value="${DRAWN}"]`)?.remove();
  if (label === null) {
    return;
  }
  const option = select.ownerDocument.createElement('option');
  option.value = DRAWN;
  option.textContent = label;
  select.prepend(option);
  select.value = DRAWN;
}

const SAMPLE_LOADING_HINTS: Readonly<Record<SampleLoading, string>> = {
  eager: 'About 1 MB, fetched as the page opens.',
  lazy: 'Nothing is fetched until you play a note.',
  off: 'A plain synthesised tone, and no download at all.',
};

/** Anything the space bar already means something to. */
function isFormControl(element: Element | null): boolean {
  if (element === null) {
    return false;
  }
  const tag = element.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'SELECT' ||
    tag === 'TEXTAREA' ||
    tag === 'BUTTON' ||
    element.hasAttribute('contenteditable')
  );
}

/**
 * Whether a control holding the focus has a use of its own for the arrow
 * keys: a list, a slider, a choice of one, anything typed into. A button has
 * none, so the arrows are the editor's still while one holds the focus -
 * as a chord of the drawer does once it is pressed, and Shift and the
 * arrows were then lost to the notes it had just written.
 */
function usesTheArrows(element: Element | null): boolean {
  if (element === null) {
    return false;
  }
  const type = element.tagName === 'INPUT' ? (element.getAttribute('type') ?? 'text') : null;
  return isFormControl(element) && element.tagName !== 'BUTTON' && !['button', 'checkbox', 'submit', 'reset'].includes(type ?? '');
}

/**
 * Whether a control is one pressed rather than typed into: a button, a box
 * ticked, a slider dragged, a list chosen from. Pressed by the pointer, the
 * browser leaves the focus on it all the same. A field typed into is never
 * given up so: a key there is text, however the focus came.
 */
function pressedRatherThanTyped(element: Element | null): element is HTMLElement {
  if (element === null) {
    return false;
  }
  const tag = element.tagName;
  const type = tag === 'INPUT' ? (element.getAttribute('type') ?? 'text') : '';
  return tag === 'BUTTON' || tag === 'SELECT' || ['checkbox', 'radio', 'range'].includes(type);
}

/**
 * Why a score could not be taken, in words the reader can act on.
 *
 * Every refusal already carried a reason and the page threw most of them away:
 * one file showed it, several showed only the names, and the reader was left
 * with "could not open" and nothing to do about it. His: "насправді я не знаю
 * в чому проблема" - which is the page's fault, not his.
 *
 * Running out of room is named rather than repeated. A browser says "the quota
 * has been exceeded", which is true and tells nobody what to do; a reader whose
 * device is full needs to know that it is full and that deleting something
 * fixes it. A score is kept as the whole of its printed music, so one long
 * piece is megabytes and a shelf of them reaches a limit that a shelf of short
 * ones never would.
 */
export function whyAScoreWasRefused(error: unknown): string {
  if (isOutOfRoom(error)) {
    return 'There is no room left on this device. Delete a score and try again.';
  }
  if (error instanceof Error && error.message !== '') {
    return error.message;
  }
  return 'It could not be read.';
}

function isOutOfRoom(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'QuotaExceededError';
  }
  // Not every browser hands back a `DOMException`, and a wrapped one keeps the
  // name and loses the type.
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'QuotaExceededError'
  );
}

function readClickWhen(value: string): ChosenClickWhen {
  return CLICK_WHEN_CHOICES.includes(value as ChosenClickWhen) ? (value as ChosenClickWhen) : 'always';
}

function readSampleLoading(value: string): SampleLoading {
  return SAMPLE_LOADING_MODES.includes(value as SampleLoading)
    ? (value as SampleLoading)
    : 'lazy';
}

/** Matches what the stored-settings codec will accept back. */
const MIN_BARS = 1;
const MAX_BARS = 32;

const MIDI_STATUS_LABELS: Readonly<Record<MidiConnectionStatus, string>> = {
  idle: 'MIDI: not connected',
  connecting: 'MIDI: connecting…',
  connected: 'MIDI: connected',
  unsupported: 'MIDI: unsupported browser',
  denied: 'MIDI: permission denied',
  error: 'MIDI: error',
};

/** Shown under the connection controls when there is something to explain. */
const MIDI_HINTS: Partial<Readonly<Record<MidiConnectionStatus, string>>> = {
  unsupported:
    'This browser has no Web MIDI. On iPad or iPhone, open this page in the free “Web MIDI Browser” app; on a computer use Chrome, Edge or Opera.',
  denied:
    'Permission was refused. Allow MIDI access for this site in the browser settings, then reload.',
  error: 'The browser could not reach your MIDI devices. Reconnect the cable and try again.',
};

/** "a, b and c". */
function listedInWords(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

function keyValue(key: KeySignature): string {
  return `${key.fifths}:${key.mode}`;
}

function parseKeyValue(value: string): KeySignature {
  const [fifths, mode] = value.split(':');
  return new KeySignature(Number.parseInt(fifths ?? '0', 10), mode === 'minor' ? 'minor' : 'major');
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Puts a failure where it can be copied from.
 *
 * The notice on the page says what went wrong in one sentence, which is what
 * a reader needs mid-practice and all there is room for. It cannot be
 * selected on a tablet and it carries no stack, so a fault the reader wants
 * to report has to be read off the screen by hand - the reader asked for
 * this after doing exactly that.
 */
function reportToTheConsole(what: string, error: unknown): void {
  console.error(what, error);
}

/**
 * How far a wheel turned, whichever way it turned.
 *
 * A wheel turns up and down; a trackpad swiped sideways turns only across.
 * Where a turn means a size rather than a place, either way is the same ask.
 */
function theWheelsTurn(event: WheelEvent): number {
  return event.deltaY !== 0 ? event.deltaY : event.deltaX;
}

/** What the keyboard's button says each of its answers is. */
const KEYS_SHOWN_SAID: Readonly<Record<KeysShown, string>> = {
  'falling-notes': 'Falling notes and keyboard',
  keys: 'Keyboard only',
  none: 'The score only',
};

/** A knob the reader may teach, with the loudness it turns and where it is described. */
interface KnobPlace {
  readonly knob: ControlBinding;
  readonly button: HTMLButtonElement;
  readonly status: HTMLElement;
  /** The slider the knob writes through. */
  readonly slider: HTMLInputElement;
  /** What the knob sets, as its description finishes the sentence. */
  readonly sets: string;
  /** The saved setting saying which control drives it. */
  remember(controller: number | null): { volumeController: number | null } | { metronomeController: number | null };
}

/** A step of the section plan in a few words: the bars, the hand, the speed. */
function describeTheDrillTask(task: DrillTask): string {
  const bars = task.fromBar === task.toBar ? `Bar ${String(task.fromBar)}` : `Bars ${String(task.fromBar)}-${String(task.toBar)}`;
  const hand = task.hand === null ? 'both hands' : task.hand === 1 ? 'right hand' : 'left hand';
  return `${bars} · ${hand} · ${String(task.tempoPercent)}%`;
}

/**
 * Vanilla DOM presentation layer.
 *
 * The view only reads controller/session state and writes to elements: it
 * holds no practice logic of its own, which is what allows every rule in the
 * trainer to be tested without a browser.
 */
export class AppView {
  private readonly runtime: AppRuntime;
  private readonly doc: Document;
  private readonly subscriptions: Unsubscribe[] = [];
  private sessionSubscriptions: Unsubscribe[] = [];
  private audioFeedbackEnabled = true;
  /** Where the words searched for in the settings were found, and which one is gone to. */
  private found: readonly Found[] = [];
  private foundAt = -1;
  private previewTimer: ReturnType<typeof setInterval> | null = null;
  /** Pending re-engraving after the tempo buttons stop being pressed. */
  private tempoRedraw: ReturnType<typeof setTimeout> | null = null;
  private restTimer: ReturnType<typeof setTimeout> | null = null;
  /** The week as it was last drawn, so seven marks are not redrawn for nothing. */
  private weekShown: string | null = null;

  /** The modes last drawn in the corner, so an unchanged set is left alone. */
  private modesShown: string | null = null;
  private timeTick: ReturnType<typeof setInterval> | null = null;
  /** The Sync button pressing itself, set for half a minute after the last change. */
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  /** When a sync nobody pressed for last began as the page was opened or come back to: see `syncOnComingBack`. */
  private syncedOnComingBackAtMs: number | null = null;
  /**
   * The sketch open in the editor that a sync under way may take from the
   * drive underneath it, having nothing in it to undo: see `syncWithTheDrive`.
   */
  private sketchTakenUnderTheEditor: string | null = null;
  /** Whether a sync is under way, pressed for or not. */
  private syncing = false;
  /**
   * The last sync that failed, and the change it failed on.
   *
   * The button does not press itself again for that change: what failed once
   * with nothing different will fail again, every half minute, for as long as
   * the page is open. A new change, or a press, tries again.
   */
  private syncFailed: { readonly change: number; readonly why: string } | null = null;
  private survivalTick: ReturnType<typeof setInterval> | null = null;
  /** When the stretch being counted began, or `null` while the page is away. */
  private timeCountedAtMs: number | null = null;
  /** Which tip to give next, so the same one is not given twice running. */
  private restTipAt = 0;
  /** Beats promised but not yet reached; see {@link runTheBeats}. */
  private beatTimers: ReturnType<typeof setTimeout>[] = [];
  /** Pending return of the pill to what the run is saying. */
  /** Which take the transport is showing, playing or not. */
  private selectedTakeId: string | null = null;
  /** The take being watched on the keys, and its presses; see `watchTheTakeOnTheKeys`. */
  private takeOnTheKeys: { readonly id: string; readonly keys: TakeOnTheKeys } | null = null;
  /** Follows a sounding take, so the slider says where it has got to. */
  private takeTick: ReturnType<typeof setInterval> | null = null;
  private rollTick: ReturnType<typeof setInterval> | null = null;
  /** A frame asked for to redraw the map's box, and not yet arrived. */
  private mapFrame: number | null = null;
  /** Whether what is kept is being weighed for the Library pane, which takes a moment. */
  private weighing = false;
  /** The notes of the drawing by pitch, for the map down its side. */
  private rollPitches: RollPitches | null = null;
  /** The head's marks, found once as the drawing is made rather than looked for every frame. */
  private rollHeads: RollHeads | null = null;
  /** What the drawing shows, placed in the run's own time: see `RollScene`. */
  private drawnScene: RollScene | null = null;
  /** The canvases it is painted on and the strip of keys, found once as it is drawn. */
  private rollCanvases: RollCanvases | null = null;
  private rollKeysStrip: HTMLElement | null = null;
  /** Where the view stands on the drawing: see `RollScroller`. */
  private readonly rollScroller = new RollScroller();
  /** The keys a run is shown again over. See `showTheReplaysKeys`. */
  private readonly replayKeyboard: ReplayKeyboard;
  /** The frame the notes over the keys are painted on next, while any fall. */
  private fallingFrame: number | null = null;
  /** The frame the keys under a take or a run shown again are next lit in, while it sounds. */
  private keysFrame: number | null = null;
  /** The frame the closing cursors are next drawn in, while they are. */
  private closingFrame: number | null = null;
  /** Where each key stands along the row, until the row changes size. */
  private keyPlaces: ReadonlyMap<number, KeyPlace> | null = null;
  /**
   * Whether the keys are wider than their screen, so a finger sliding along
   * them moves the row rather than playing. Taken as so until measured, which
   * is how the keys behaved before a slide could play.
   */
  private keysScroll = true;
  /** The lane's colours, read again each time notes begin to fall. */
  private laneInks: LaneInks | null = null;
  /**
   * Where the marker was last put on the drawing, which Back returns the head
   * to; the beginning until it is put anywhere.
   */
  private rollPlacedAtMs = 0;
  /** Which of the scores sheet's two lists it shows; see `showTheList`. */
  private scoresListShown: 'scores' | 'sketches' = 'scores';
  /** How tall a row is, and the ruler and the pedal lane, as last measured. */
  private rollLook = { rowPx: 13, rulerTallPx: 0, chordsTallPx: 0, pedalTallPx: 0 };
  /** The frame a fling is going on in, if one is. */
  private flingFrame: number | null = null;
  /**
   * A finger moving the drawing: where the view stood when it came down, where
   * it came down, and where it has been lately - which is how fast it was
   * going when it lets go.
   */
  private rollPan: {
    readonly pointerId: number;
    readonly fromX: number;
    readonly fromY: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly trail: FingerAt[];
    moved: boolean;
  } | null = null;
  /**
   * The chosen key of a recording held by a finger or the mouse: where it came
   * down, the drawing as it was then, and where the key has been moved to so
   * far, if anywhere.
   */
  private rollDrag: {
    readonly pointerId: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly scene: RollScene;
    /** The key it went down on. */
    readonly key: KeyNamed;
    /** Whether a tap on it adds it to the notes chosen or takes it out, rather than choosing it alone. */
    readonly adds: boolean;
    /**
     * Whether it is taken out of the notes chosen on letting go, where it was
     * not moved: with Ctrl on one already chosen, the press may be the start
     * of a copy of them all, and only a tap takes it out.
     */
    readonly letsGoOfIt: boolean;
    /** Whether a drag of the whole of it copies the keys it holds, leaving them where they were: Ctrl or Cmd held as it was pressed. */
    readonly copies: boolean;
    /** What of it was taken hold of: the whole note, moved, or one end, held longer or shorter. */
    readonly grip: Grip;
    /** When it was let go of, which a drag of its end moves. */
    readonly upAtMs: number;
    readonly moved: {
      readonly to: readonly KeyNamed[];
      readonly events: readonly MidiFileEvent[];
    } | null;
  } | null = null;
  /** The colours it is painted in, read off the stylesheet once and again when those change. */
  private rollInks: RollInks | null = null;
  /** What that map last drew, so a scroll that changes nothing on it redraws nothing. */
  private pitchMarksDrawn = '';
  /** Clicks of the run already handed to the metronome by this playback. */
  private rollClicksSent = 0;
  /** The lap of a slice going round those clicks were counted in: see `soundTheBeat`. */
  private rollLapClicked = 0;
  /** And how many clicks of the lap after it were handed over ahead, as its notes are. */
  private rollClicksOfTheNextLap = 0;
  /**
   * The bars of the drawing a playback goes round, in milliseconds from its
   * beginning, and which drawing they are of - so another one shown has
   * none until one is laid on it. Kept while the page is, and no longer.
   */
  private rollSlice: { readonly of: string; readonly fromMs: number; readonly toMs: number } | null = null;
  /** The keys of the chord last tapped in the lane, sounding for a moment: see `soundTheChordTapped`. */
  private chordTappedSounds: readonly number[] = [];
  /** An end of the slice held by a pointer on the ruler, and where its other end stays: see `takeHoldOfAnEndOfTheSlice`. */
  private sliceEndHeld: { readonly pointerId: number; readonly otherMs: number } | null = null;
  /** Where the marker stood as the drawing was shown, so shutting it carries the marker only where it was put: see `closeTheRoll`. */
  private headWhereShown: number | null = null;
  /**
   * A press on the ruler that may lay a slice: held still long enough it
   * does, and then the finger drags the slice's far end until it is let go.
   * Where it was held, once it has been, or `null` where that took a slice away.
   */
  private sliceHold: {
    readonly pointerId: number;
    readonly clientX: number;
    readonly clientY: number;
    timer: ReturnType<typeof setTimeout> | null;
    held: boolean;
    anchorMs: number | null;
  } | null = null;
  /** Whether the click that ends a press which laid a slice is to be let pass. */
  private sliceLaidByThePress = false;
  /**
   * Playing being recorded into the sketch shown, while it is: which sketch,
   * the moment of it it goes in at, from the drawing's beginning, and when
   * on the clock that moment falls - after the count-in. What has been
   * played, timed from then; and the clicks of the sketch's beat to sound
   * under it, the next of them still to be handed over.
   */
  private recording: {
    readonly sketchId: string;
    readonly fromMs: number;
    readonly beginsAtMs: number;
    readonly played: MidiFileEvent[];
    readonly clicks: readonly { readonly atMs: number; readonly weight: BeatWeight }[];
    nextClick: number;
    readonly stopListening: () => void;
    begins: ReturnType<typeof setTimeout> | null;
    tick: ReturnType<typeof setInterval> | null;
  } | null = null;
  /**
   * A run being shown again on the notes, and where the showing has got to.
   * See `replayTheRun`.
   */
  private replayRoll: RunRoll | null = null;
  /** How long the run shown again lasts, to its last event: where its slider ends. */
  private replayLengthMs = 0;
  private replayTick: ReturnType<typeof setInterval> | null = null;
  /** Moves the slider under a performance along with it, while it plays. */
  private listenTick: ReturnType<typeof setInterval> | null = null;
  /**
   * Whether the performance was playing when the slider under it was taken
   * hold of: held for the drag, it plays on from where it is let go.
   */
  private playsOnAfterTheDrag = false;
  /** The pieces a playback goes through; see `theTurnOfPieces`. */
  private piecesInTurn: PiecesInTurn | null = null;
  /**
   * Counts the ways a playback was asked to go on to another piece, and the
   * stops. One that finds the count moved on by the time its piece is open
   * has been overtaken - by a stop, or by a later press - and plays nothing.
   */
  private goingOn = 0;
  /** Whether a piece is being opened to be played; Stop is for that too. */
  private openingToPlay = false;
  private replayAtMs = 0;
  private replayClicksSent = 0;
  /** Puts the speed in the row or the drawer, as fits now. See `bindNarrowLayout`. */
  private placeTheSpeed: () => void = () => {};
  /**
   * Fingers down on the drawing, and what the zoom was when the second arrived.
   *
   * Two are a pinch. Kept by pointer id rather than counted, because a finger
   * lifted is a particular finger and the one still down has to go on meaning
   * what it meant.
   */
  private readonly rollFingers = new Map<number, { readonly x: number; readonly y: number }>();
  /**
   * Every finger down on the drawing and where it is, whatever it is doing
   * there - holding a note, the pedal or a box as well as moving the drawing:
   * what a second finger needs to make a pinch of the first one's gesture.
   * The mouse and a pen are counted as a first finger.
   */
  private readonly fingersOnTheDrawing = new Map<number, { readonly x: number; readonly y: number }>();
  private pinchedFrom: PinchedFrom | null = null;
  /**
   * How tall a row of pitch is drawn, in pixels.
   *
   * Here rather than on a control of its own, because a pinch down the page is
   * the whole of how it is asked for: the width has a slider because he found
   * the gesture first and the slider second, and the height has not been asked
   * for anywhere but under two fingers. The stylesheet's own value is the same
   * number, and is what is drawn until the first pinch.
   */
  private rollRowPx = 13;
  /** The last tap on a sketch being edited, for the next to be its second. */
  private theLastTap: {
    readonly atMs: number;
    readonly clientX: number;
    readonly clientY: number;
    /** The note it was on, or nothing where it was on empty space. */
    readonly key: KeyNamed | null;
  } | null = null;
  /**
   * What sounds while a key of a sketch is held: every key the hold would
   * move, each at its own loudness, and how far up or down they have been
   * taken - so the ear follows the hand, chord and all.
   */
  private soundOfTheHeldKeys: {
    readonly keys: readonly { readonly midi: number; readonly velocity: number }[];
    readonly bySemitones: number;
  } | null = null;
  /** The box a mouse is drawing over a sketch being edited, to choose the notes inside it. */
  private rollBoxDrawn: {
    readonly pointerId: number;
    /** Where it went down, on the screen. */
    readonly clientX: number;
    readonly clientY: number;
    /** Where the stage the box is placed in stood as it began. */
    readonly stageLeft: number;
    readonly stageTop: number;
    /** Where the notes stood, which the box is kept inside. */
    readonly grid: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number } | null;
    /** Whether what it holds is added to the notes chosen, rather than chosen alone. */
    readonly adds: boolean;
    /** Whether it has gone far enough to be a box rather than a click. */
    readonly drawn: boolean;
  } | null = null;
  /**
   * The pedal's lane held by a pointer while a sketch is edited: a press of
   * the pedal taken hold of by its end or as a whole, or none where a new one
   * is being drawn; and the sketch as the pointer has it so far, once it has
   * changed it.
   */
  private rollPedalDrag: {
    readonly pointerId: number;
    readonly fromMs: number;
    readonly press: ScenePedal | null;
    readonly grip: Grip;
    readonly moved: readonly MidiFileEvent[] | null;
  } | null = null;
  /** A key of the strip beside the drawing held down by a pointer, and sounding till it is let go of. */
  private keyHeldOnTheStrip: { readonly pointerId: number; readonly midi: number; readonly velocity: number } | null = null;
  /** The rows of the keys sounding now: see `lightTheSoundingRows`. */
  private soundingRows: readonly number[] = [];
  /** The chord of the drawer the pointer is on, by its place there, whose notes are shown where it would write them; or none. */
  private chordPointedAt: number | null = null;
  /** Those notes, where they would go: painted dashed over the drawing until the pointer leaves the chord. */
  private notesShownAhead: readonly NoteShownAhead[] = [];
  /** The notes played into a recording under way, where they go, painted as they are played: see `showWhatIsBeingRecorded`. */
  private notesBeingRecorded: readonly NoteShownAhead[] = [];
  /** What the rows sounding last were, so a frame that changes nothing draws nothing. */
  private soundingRowsSaid = '';
  /** The stretch of the run the map down the side last marked, to mark again when a key sounds. */
  private pitchWindow: { readonly fromShare: number; readonly widthShare: number } | null = null;
  /** The sketch the score on the page was written down from, as it was then, and the score it gave. */
  private theSketchOnThePage: { readonly sketch: StoredSketch; readonly exercise: Exercise } | null = null;
  /** The take the score on the page was written down from, and the score it gave. */
  private theTakeOnThePage: { readonly takeId: string; readonly exercise: Exercise } | null = null;
  /** The sketch whose name is being written over, while it is. */
  private sketchBeingRenamed: string | null = null;
  /**
   * Whether the gesture that is ending was a pinch.
   *
   * A pinch ends with fingers coming up, and a finger coming up off an element
   * is a click as far as the page is concerned - so without this, every pinch
   * also moved the head to wherever the last finger happened to be.
   */
  private pinched = false;
  /** And whether it was a finger moving the drawing, which ends the same way. */
  private panned = false;
  /**
   * Where the head stands while nothing is sounding, in milliseconds.
   *
   * Kept here rather than asked of the player, because the player has no
   * position until it has been given something to play - and the reader may put
   * the head somewhere before ever pressing play. It is where a playback starts
   * from, which is what makes a tap on the grid mean anything at all.
   */
  private rollAtMs = 0;
  /** The sketch and the key the head was last found in, so it is followed into another only when it gets there. */
  private keyAtTheHeadFollowed = '';

  /**
   * Whether the drawer of the chords of the key is open beside a sketch being
   * edited: kept from one sketch to the next, as a tool laid out on the desk.
   */
  private chordsOfTheKeyOpen = false;

  /** The beat a change is being asked about, while the sheet asking is open. */
  private beatAskedAbout: ReturnType<typeof theBeatOfTheClickAt> = null;

  /** The flag over the ruler chosen to be changed or taken away, by its moment on the run's own clock, or none. */
  private markChosenAtMs: number | null = null;

  /** And the key that beat is in, and the one the beat before it is in - none before the first. */
  private keyAskedAbout: { readonly here: KeyOfTheMusic; readonly before: KeyOfTheMusic | null } | null = null;
  /** And the dynamic that beat is marked in, and the one the beat before it is: none where none is marked yet. */
  private dynamicAskedAbout: {
    readonly here: DynamicLevel | null;
    readonly before: DynamicLevel | null;
    /** Whether the one marked on the beat is reached gradually. */
    readonly graduallyHere: boolean;
  } | null = null;

  /** Whether a tap on a chord kept in the drawer deletes it, rather than writing it. */
  private chordsBeingForgotten = false;

  /** What last went down on the drawer's chords, so a menu asked by a finger deletes nothing. */
  private pointerOnTheChords = '';

  /**
   * Where the chord last tapped in the lane begins: a chord of the drawer is
   * written over it while its notes are the ones chosen, and nothing else
   * (see `theChordChosenInTheLane`). Only a tap there says so - the notes of
   * a chord just written are chosen too, and the next one tapped follows
   * them rather than replacing them.
   */
  private chordTappedAt: number | null = null;

  /**
   * What the last press on the drawing went down on, which is what its
   * click is on. Not the click's own target: the drawing takes the pointer
   * as it goes down, and Safari then sends the click to the drawing as a
   * whole - a tap on the ruler or the lane of chords arrived as a tap on the
   * grid, and over a note was taken for one on the note.
   */
  private pressedOn: EventTarget | null = null;

  /** Where the marker was before a tap on nothing moved it, to go back to if it was the first of two. */
  private placedBeforeTheTap: number | null = null;

  /**
   * The chord of the drawer a pointer is held down on, sounding until it is
   * let go of: by its place there, or none where the pointer has slid off
   * the chords; its keys, and when they were struck. And what its moving
   * is, once it moves (see `A_FINGER_LISTENS_MS`): a slide over the chords,
   * or the column scrolled, from where it was and where the pointer went
   * down.
   */
  private chordHeld: {
    readonly pointerId: number;
    readonly at: number | null;
    readonly keys: readonly number[];
    readonly struckAtMs: number;
    readonly downAtMs: number;
    readonly downY: number;
    readonly scrolledFrom: number;
    readonly moving: 'not yet' | 'slides' | 'scrolls';
  } | null = null;

  /**
   * The notes last copied in this page, for the paste button where the
   * clipboard cannot be read - an app's browser without the API, or a page
   * not served securely - and where it holds something else.
   */
  private notesCopiedHere: readonly NoteCopied[] | null = null;

  /**
   * Or the change of key, metre or pace last copied from a flag. Copying it
   * lets go of the notes copied here, and notes copied are pasted before it,
   * so the paste button pastes whichever was copied last.
   */
  private changeCopiedHere: ChangeCopied | null = null;

  /**
   * Whether the control with the focus was given it by a pointer pressing
   * it, rather than reached by the keyboard: see `bindSpaceBar`.
   */
  private focusCameByThePointer = false;

  /**
   * The notes chosen on a drawing that is not a sketch - a score, a
   * recording, the run - to be copied into one, and the drawing they are of:
   * another drawing shown, they are chosen on it no longer.
   */
  private chosenToCopy: { readonly roll: RunRoll; readonly chosen: readonly KeyNamed[] } | null = null;

  /**
   * Whether a drag from empty space on such a drawing draws a box to choose
   * notes by - a mouse's as a finger's, as the selection tool says on a
   * sketch. Without it a finger moves the drawing and a mouse points.
   */
  private boxOnTheViewer = false;
  /** Whether the passage markers are on the page, which a tap turns over. */
  private passageMarkersWanted = true;
  /**
   * The bar a hold last put the place on, or `null` for none.
   *
   * Kept here rather than asked of the controller, which answers with the
   * *step* a run begins at - and nought there means "no place of my own",
   * which is also the answer for a place put on the very first bar. The two
   * are the same number and different facts, and this gesture needs the
   * difference: it is what says whether the next hold opens a passage.
   */
  private placedOnBar: number | null = null;
  /** Pending redraw of the keep pill: the counter, and the silence closing. */
  /**
   * Where the hand the reader is not playing will be, and when.
   *
   * Oldest first. The run says this ahead of time - the same numbers the sound
   * is scheduled on - because the run itself has no clock to wait on: it is
   * driven by the reader's keys and by a pulse that only exists when they have
   * asked for a click. The view has one, so the walking is done here.
   */
  /**
   * The playing the picture is of, or `null` for the run just played.
   *
   * A kept recording or a reading out of the history: the picture draws
   * presses and pedal spans against time, and both of those are exactly that
   * written down - so looking at one asks for no second drawing, only for a
   * different answer to "which roll". His: "можливість відчинити будь який
   * recording у MIDI viewer". Each carries what it is and why there is no
   * passage in it to practise, since neither is of the score in front of the
   * reader now.
   */
  private theOtherRollShowing: {
    readonly roll: RunRoll;
    readonly what: string;
    readonly why: string;
    readonly isScore?: boolean;
    /**
     * Whether it was played against the score open now, as that score is now -
     * so that the notes the score asks for belong under it.
     */
    readonly ofTheOpenScore: boolean;
    /** What its bars are called, where the open score's numbers are not theirs. */
    readonly barLabel?: (positionTicks: number) => string | null;
    /** The recording it is, where it is one, which a sketch can be begun from. */
    readonly recording?: string;
    /**
     * The recording it is, where it is one: which, the key chosen on it to be
     * changed, and what it was before each change, the last change last.
     */
    readonly sketch?: {
      readonly id: string;
      /** Whether a touch on the drawing edits the notes rather than placing the marker. */
      readonly editing: boolean;
      /** The keys chosen on it to be changed, a tap at a time. */
      readonly chosen: readonly KeyNamed[];
      /**
       * What a press on empty space does while it is edited: the pencil
       * writes a note, and a finger moves the drawing; selection draws a box
       * around the notes to choose, with a finger as with the mouse.
       */
      readonly tool: 'pencil' | 'selection';
      /** What it was before each change, the last last: its notes, its beats and the notes chosen. */
      readonly before: readonly SketchAsItWas[];
      /** What each undo took it back from, the last last, for a redo to bring back; gone at the next change. */
      readonly after: readonly SketchAsItWas[];
    };
  } | null = null;

  /** The reading the sheet over the list is showing, so its buttons know theirs. */
  private theReadingShowing: PracticeReading | null = null;
  private theOtherHandsWalk: { readonly stepIndex: number; readonly atMs: number }[] = [];
  private theOtherHandsStep: ReturnType<typeof setTimeout> | null = null;
  private silenceWatch: ReturnType<typeof setTimeout> | null = null;
  /** The beat of the click in free play last heard, from nought, or `null` while it is not going. */
  private freeBeatHeard: number | null = null;
  /** Beats of the click in free play placed and not yet heard, by when they will be. */
  private beatsComing: { readonly beat: number; readonly atMs: number }[] = [];
  /** The frame that lights them, while any are coming. */
  private beatFrame: number | null = null;
  private lastDrainAtMs: number | null = null;
  private healthPaceMs = SETTLE_MS;
  /** Whether the reader has already been given this page. */
  private hasLooked = false;
  /** A promotion waiting to be reported alongside the run that earned it. */
  private lastLadderMove: { readonly to: LadderStep; readonly direction: 'up' | 'down' } | null =
    null;
  /**
   * The last reading, kept so that it can be read after it has been taken away.
   *
   * His: "я можу поставити на repeat випадково, та в кінці діалог зявляється та
   * дуже швидко зникає - тому я пропустив всю статистику". Which is exactly
   * what happens: the verdict goes up when a run finishes, the repeat begins
   * the next lap at once, and starting a run is what puts the verdict away - so
   * the reading is rendered and hidden inside one frame with no way back to it.
   *
   * The ladder move is kept with it rather than left in its own field, because
   * that field is emptied by the render that consumes it. A reader who missed
   * the reading missed the news that they had moved up, and that is the half of
   * it worth coming back for.
   */
  private lastReading: {
    readonly score: SessionScore;
    readonly report: PerformanceReport;
    readonly move: { readonly to: LadderStep; readonly direction: 'up' | 'down' } | null;
  } | null = null;

  private readonly el: {
    app: HTMLElement;
    focusBar: HTMLElement;
    score: HTMLElement;
    scoreCover: HTMLElement;
    scoreCoverText: HTMLElement;
    scoreCard: HTMLElement;
    scoreCount: HTMLElement;
    scoreEngraving: HTMLElement;
    drillPill: HTMLButtonElement;
    sheetDrill: HTMLElement;
    drillWhere: HTMLElement;
    drillSteps: HTMLOListElement;
    drillClose: HTMLButtonElement;
    drillStop: HTMLButtonElement;
    drillStart: HTMLButtonElement;
    drillDescription: HTMLElement;
    drillBars: HTMLInputElement;
    scoreRest: HTMLElement;
    restHeading: HTMLElement;
    restTip: HTMLElement;
    restRing: SVGElement;
    restRingArc: SVGCircleElement;
    restLeft: HTMLOutputElement;
    restEvery: HTMLSelectElement;
    restEverySettings: HTMLSelectElement;
    restTake: HTMLButtonElement;
    restLater: HTMLButtonElement;
    restSnooze: HTMLElement;
    scoreVerdict: HTMLElement;
    focusPlay: HTMLButtonElement;
    focusPlayIcon: SVGPathElement;
    focusReplay: HTMLButtonElement;
    focusHandle: HTMLButtonElement;
    focusHealth: HTMLElement;
    focusPlayFrame: HTMLElement;
    focusHands: HTMLButtonElement;
    focusMetronome: HTMLButtonElement;
    freeBeatsFewer: HTMLButtonElement;
    freeBeatsMore: HTMLButtonElement;
    freeBeatsCount: HTMLOutputElement;
    freeFromScore: HTMLButtonElement;
    freeBeatsDots: HTMLElement;
    freeTap: HTMLButtonElement;
    metronomeOn: HTMLButtonElement;
    scoreListening: HTMLButtonElement;
    freeChord: HTMLOutputElement;
    scoreListeningText: HTMLElement;
    focusRepeat: HTMLButtonElement;
    focusBare: HTMLButtonElement;
    pagedScore: HTMLInputElement;
    repeatNumbers: HTMLInputElement;
    traceTheStart: HTMLInputElement;
    timingTrail: HTMLElement;
    timingTrailLines: HTMLElement;
    driveSync: HTMLButtonElement;
    driveCode: HTMLButtonElement;
    driveStatus: HTMLElement;
    driveOnly: HTMLUListElement;
    driveOnlySketches: HTMLUListElement;
    driveOnlySketchesSaid: HTMLElement;
    offerToSync: HTMLInputElement;
    settingsSearch: HTMLInputElement;
    settingsSearchCount: HTMLOutputElement;
    settingsSearchPrevious: HTMLButtonElement;
    settingsSearchNext: HTMLButtonElement;
    scoreSync: HTMLButtonElement;
    scoreSyncText: HTMLElement;
    storageTotal: HTMLElement;
    storageBar: HTMLElement;
    storageLegend: HTMLUListElement;
    storageKept: HTMLElement;
    storageSmall: HTMLElement;
    focusSmaller: HTMLButtonElement;
    focusBigger: HTMLButtonElement;
    focusZoom: HTMLOutputElement;
    focusHandLeft: SVGElement;
    focusHandRight: SVGElement;
    focusHealthFill: HTMLElement;
    playingAhead: HTMLSelectElement;
    immediateStart: HTMLInputElement;
    dimUnplayed: HTMLInputElement;
    pageTurns: HTMLSelectElement;
    pageTurnsDescription: HTMLElement;
    scoreToday: HTMLElement;
    scoreTodayText: HTMLOutputElement;
    scoreWeek: HTMLElement;
    scoreModes: HTMLElement;
    scorePages: HTMLElement;
    scorePageBack: HTMLButtonElement;
    scorePageOn: HTMLButtonElement;
    scorePageAt: HTMLOutputElement;
    hearOtherHand: HTMLInputElement;
    rushingCounts: HTMLInputElement;
    markListening: HTMLInputElement;
    showPlaybackNotes: HTMLInputElement;
    rulerCursor: HTMLInputElement;
    rulerStrength: HTMLInputElement;
    rulerStrengthValue: HTMLOutputElement;
    rhythmRuler: HTMLSelectElement;
    rhythmRulerDescription: HTMLElement;
    focusDrawer: HTMLElement;
    focusRow: HTMLElement;
    focusSpeed: HTMLElement;
    focusStop: HTMLButtonElement;
    focusKeyboard: HTMLButtonElement;
    focusRewind: HTMLButtonElement;
    focusSlower: HTMLButtonElement;
    focusFaster: HTMLButtonElement;
    focusTempo: HTMLOutputElement;
    scoresFresh: HTMLButtonElement;
    scoresFreshRow: HTMLElement;
    scoresTools: HTMLElement;
    scoresShowScores: HTMLButtonElement;
    scoresShowSketches: HTMLButtonElement;
    sketchesList: HTMLElement;
    sketchesEmpty: HTMLElement;
    sketchesNew: HTMLButtonElement;
    scoresRung: HTMLElement;
    scoresExercise: HTMLButtonElement;
    sheetExercise: HTMLElement;
    exerciseClose: HTMLElement;
    ladderTrack: HTMLElement;
    grades: HTMLElement;
    gradeNew: HTMLElement;
    gradeNotYet: HTMLElement;
    midiStatus: HTMLElement;
    bridgeStatus: HTMLElement;
    pedalStatus: HTMLElement;
    connectMidi: HTMLButtonElement;
    midiInput: HTMLSelectElement;
    midiHint: HTMLElement;
    result: HTMLElement;
    drill: HTMLButtonElement;
    verdictFresh: HTMLButtonElement;
    focusKeep: HTMLButtonElement;
    focusKeepText: HTMLElement;
    focusRecord: HTMLElement;
    focusRecordEye: HTMLButtonElement;
    focusTakes: HTMLButtonElement;
    focusScores: HTMLButtonElement;
    sheetMetronome: HTMLElement;
    metronomeClose: HTMLButtonElement;
    sheetTakes: HTMLElement;
    sheetScores: HTMLElement;
    scoreReading: HTMLButtonElement;
    sheetRoll: HTMLElement;
    rollBody: HTMLElement;
    rollKeep: HTMLButtonElement;
    rollEdit: HTMLButtonElement;
    rollPassage: HTMLElement;
    rollVelocity: HTMLElement;
    rollVelocityLevel: HTMLInputElement;
    rollVelocityAs: HTMLButtonElement;
    rollDynamics: HTMLElement;
    rollVelocityTicks: HTMLElement;
    rollVelocitySaid: HTMLOutputElement;
    rollHands: HTMLElement;
    rollSketchStart: HTMLElement;
    rollKey: HTMLSelectElement;
    rollScale: HTMLSelectElement;
    rollMetre: HTMLSelectElement;
    rollTempo: HTMLInputElement;
    rollHandLeft: HTMLButtonElement;
    rollHandPitch: HTMLButtonElement;
    rollHandRight: HTMLButtonElement;
    rollQuantize: HTMLButtonElement;
    rollHumanize: HTMLButtonElement;
    rollDelete: HTMLButtonElement;
    rollSelect: HTMLButtonElement;
    rollUndo: HTMLButtonElement;
    rollRedo: HTMLButtonElement;
    rollChordsOpen: HTMLButtonElement;
    rollMark: HTMLButtonElement;
    sheetRollMark: HTMLElement;
    rollMarkTitle: HTMLElement;
    rollMarkMetre: HTMLSelectElement;
    rollMarkKey: HTMLSelectElement;
    rollMarkScale: HTMLSelectElement;
    rollMarkTempo: HTMLInputElement;
    rollMarkDynamic: HTMLSelectElement;
    rollMarkReached: HTMLSelectElement;
    rollMarkRemove: HTMLButtonElement;
    rollMarkInsert: HTMLButtonElement;
    rollMarkYes: HTMLButtonElement;
    rollMarkNo: HTMLButtonElement;
    rollChords: HTMLElement;
    rollChordsList: HTMLElement;
    rollChordsKeep: HTMLButtonElement;
    rollChordsForget: HTMLButtonElement;
    rollCopy: HTMLButtonElement;
    rollCopyChosen: HTMLButtonElement;
    rollArpeggioUp: HTMLButtonElement;
    rollArpeggioDown: HTMLButtonElement;
    rollArpeggioUpAndDown: HTMLButtonElement;
    rollPaste: HTMLButtonElement;
    rollTitle: HTMLElement;
    rollBox: HTMLElement;
    rollChord: HTMLOutputElement;
    rollRename: HTMLInputElement;
    rollMap: HTMLElement;
    rollMapWindow: HTMLElement;
    rollMapHead: HTMLElement;
    rollPitchMap: HTMLElement;
    rollPitchMapWindow: HTMLElement;
    rollFrom: HTMLButtonElement;
    rollTo: HTMLButtonElement;
    rollPassageWhat: HTMLElement;
    rollPractise: HTMLButtonElement;
    rollZoom: HTMLInputElement;
    rollSnap: HTMLInputElement;
    rollGhosts: HTMLInputElement;
    rollSlips: HTMLInputElement;
    rollScrollPlayback: HTMLInputElement;
    rollHeadAt: HTMLInputElement;
    rollHeadAtValue: HTMLOutputElement;
    rollOptions: HTMLButtonElement;
    sheetRollOptions: HTMLElement;
    rollOptionsClose: HTMLButtonElement;
    rollSpeed: HTMLSelectElement;
    rollClick: HTMLInputElement;
    rollGrid: HTMLSelectElement;
    rollPlay: HTMLButtonElement;
    rollPlayIcon: SVGPathElement;
    rollStop: HTMLButtonElement;
    rollRecord: HTMLButtonElement;
    rollStopIcon: SVGPathElement;
    rollClose: HTMLElement;
    sheetSettings: HTMLElement;
    settingsSections: HTMLElement;
    sheetPlaces: HTMLElement;
    focusPlaces: HTMLButtonElement;
    focusRoll: HTMLButtonElement;
    focusSketch: HTMLButtonElement;
    placesClose: HTMLButtonElement;
    sheetModes: HTMLElement;
    modesGrid: HTMLElement;
    frameChoices: readonly HTMLButtonElement[];
    modesClose: HTMLButtonElement;
    focusModes: HTMLButtonElement;
    settingsMetronome: HTMLButtonElement;
    focusSettings: HTMLButtonElement;
    settingsClose: HTMLButtonElement;
    takesClose: HTMLButtonElement;
    scoresClose: HTMLButtonElement;
    takesEmpty: HTMLElement;
    takeTransport: HTMLElement;
    takePlay: HTMLButtonElement;
    takePlayIcon: SVGPathElement;
    takePosition: HTMLOutputElement;
    takeDuration: HTMLOutputElement;
    takeScrub: HTMLInputElement;
    takeOnTheKeys: HTMLButtonElement;
    takeOffTheKeys: HTMLButtonElement;
    takeOnKeys: HTMLElement;
    replayOnKeys: HTMLElement;
    listenOnKeys: HTMLElement;
    listenGoesOn: HTMLButtonElement;
    listenGoesOnIcon: SVGPathElement;
    listenPrevious: HTMLButtonElement;
    listenNext: HTMLButtonElement;
    listenPosition: HTMLOutputElement;
    listenScrub: HTMLInputElement;
    listenDuration: HTMLOutputElement;
    replayPosition: HTMLOutputElement;
    replayScrub: HTMLInputElement;
    replayDuration: HTMLOutputElement;
    scoresEmpty: HTMLElement;
    scoresAdded: HTMLElement;
    sheetConfirm: HTMLElement;
    confirmText: HTMLElement;
    confirmYes: HTMLButtonElement;
    confirmNo: HTMLButtonElement;
    scoresList: HTMLUListElement;
    scoresOrder: HTMLSelectElement;
    sheetStars: HTMLElement;
    starsText: HTMLElement;
    starsValue: HTMLInputElement;
    starsNone: HTMLButtonElement;
    starsNo: HTMLButtonElement;
    starsYes: HTMLButtonElement;
    scoresSearch: HTMLInputElement;
    sheetReadings: HTMLElement;
    readingsList: HTMLUListElement;
    readingsEmpty: HTMLElement;
    readingsBest: HTMLInputElement;
    readingsThisPiece: HTMLInputElement;
    readingsThrough: HTMLInputElement;
    sheetReading: HTMLElement;
    readingTitle: HTMLElement;
    readingWhat: HTMLElement;
    readingRoll: HTMLButtonElement;
    readingReplay: HTMLButtonElement;
    replayKeys: HTMLElement;
    readingDelete: HTMLButtonElement;
    readingClose: HTMLButtonElement;
    readingsClose: HTMLButtonElement;
    focusReadings: HTMLButtonElement;
    sheetRename: HTMLElement;
    renameText: HTMLElement;
    renameName: HTMLInputElement;
    renameProblem: HTMLElement;
    confirmTyped: HTMLInputElement;
    renameYes: HTMLButtonElement;
    renameNo: HTMLButtonElement;
    whatOpens: HTMLSelectElement;
    whatOpensDescription: HTMLElement;
    scoresClear: HTMLButtonElement;
    takesList: HTMLUListElement;
    takesClear: HTMLButtonElement;
    takesKeptOnly: HTMLInputElement;
    scoresAdd: HTMLButtonElement;
    scoreFile: HTMLInputElement;
    ladderDown: HTMLButtonElement;
    ladderUp: HTMLButtonElement;
    ladderStep: HTMLElement;
    ladderDescription: HTMLElement;
    preset: HTMLSelectElement;
    presetDescription: HTMLElement;
    rhythm: HTMLSelectElement;
    rhythmDescription: HTMLElement;
    key: HTMLSelectElement;
    timeSignature: HTMLSelectElement;
    measures: HTMLInputElement;
    measuresValue: HTMLInputElement;
    tempo: HTMLInputElement;
    tempoValue: HTMLOutputElement;
    click: HTMLSelectElement;
    clickDescription: HTMLElement;
    clickNotesGroup: HTMLElement;
    clickNotes: HTMLSelectElement;
    dropout: HTMLSelectElement;
    dropoutDescription: HTMLElement;
    focusFrom: HTMLInputElement;
    focusTo: HTMLInputElement;
    focusBars: HTMLOutputElement;
    focusWhole: HTMLButtonElement;
    preview: HTMLInputElement;
    previewValue: HTMLOutputElement;
    countIn: HTMLInputElement;
    passageList: HTMLUListElement;
    passageEmpty: HTMLElement;
    passageName: HTMLInputElement;
    passageSave: HTMLButtonElement;
    clickSilences: HTMLSelectElement;
    clickSilencesDescription: HTMLElement;
    countInRun: HTMLSelectElement;
    countInPlayback: HTMLSelectElement;
    countInPlaybackDescription: HTMLElement;
    metronomeTap: HTMLSelectElement;
    metronomeTapDescription: HTMLElement;
    countInValue: HTMLOutputElement;
    tolerance: HTMLInputElement;
    latency: HTMLInputElement;
    latencyValue: HTMLOutputElement;
    latencyMeasure: HTMLButtonElement;
    latencyTest: HTMLButtonElement;
    latencyDescription: HTMLElement;
    saveBackup: HTMLButtonElement;
    openBackup: HTMLButtonElement;
    backupFile: HTMLInputElement;
    backupDescription: HTMLElement;
    saveJudging: HTMLButtonElement;
    copyJudging: HTMLButtonElement;
    saveTimings: HTMLButtonElement;
    copyTimings: HTMLButtonElement;
    toleranceValue: HTMLOutputElement;
    zoom: HTMLInputElement;
    zoomValue: HTMLOutputElement;
    showPlayed: HTMLSelectElement;
    theme: HTMLSelectElement;
    darkSystemTheme: HTMLSelectElement;
    showPlayedDescription: HTMLElement;
    readAhead: HTMLSelectElement;
    readAheadDescription: HTMLElement;
    cursorListening: HTMLInputElement;
    cursorRest: HTMLInputElement;
    sampleLoading: HTMLSelectElement;
    sampleLoadingHint: HTMLElement;
    networkState: HTMLElement;
    metronomeVolume: HTMLInputElement;
    metronomeVolumeValue: HTMLOutputElement;
    soundMetronomeVolume: HTMLInputElement;
    soundMetronomeVolumeValue: HTMLOutputElement;
    instrumentVolume: HTMLInputElement;
    instrumentVolumeValue: HTMLOutputElement;
    learnKnob: HTMLButtonElement;
    knobStatus: HTMLElement;
    learnMetronomeKnob: HTMLButtonElement;
    metronomeKnobStatus: HTMLElement;
    pitchClass: HTMLInputElement;
    audioFeedback: HTMLInputElement;
    computerKeyboard: HTMLInputElement;
  };

  constructor(runtime: AppRuntime, doc: Document = document) {
    this.runtime = runtime;
    this.doc = doc;
    this.el = {
      app: requireElement(doc, 'app'),
      focusBar: requireElement(doc, 'focus-bar'),
      score: requireElement(doc, 'score'),
      scoreCover: requireElement(doc, 'score-cover'),
      scoreCoverText: requireElement(doc, 'score-cover-text'),
      scoreCard: requireElement(doc, 'score-card'),
      scoreCount: requireElement(doc, 'score-count'),
      scoreEngraving: requireElement(doc, 'score-engraving'),
      drillPill: requireElement(doc, 'drill-pill'),
      sheetDrill: requireElement(doc, 'sheet-drill'),
      drillWhere: requireElement(doc, 'drill-where'),
      drillSteps: requireElement(doc, 'drill-steps'),
      drillClose: requireElement(doc, 'drill-close'),
      drillStop: requireElement(doc, 'drill-stop'),
      drillStart: requireElement(doc, 'drill-start'),
      drillDescription: requireElement(doc, 'drill-description'),
      drillBars: requireElement(doc, 'drill-bars'),
      scoreRest: requireElement(doc, 'score-rest'),
      restHeading: requireElement(doc, 'rest-heading'),
      restTip: requireElement(doc, 'rest-tip'),
      restRing: requireElement(doc, 'rest-ring'),
      restRingArc: requireElement(doc, 'rest-ring-arc'),
      restLeft: requireElement(doc, 'rest-left'),
      restEvery: requireElement(doc, 'rest-every'),
      restEverySettings: requireElement(doc, 'rest-every-settings'),
      restTake: requireElement(doc, 'rest-take'),
      restLater: requireElement(doc, 'rest-later'),
      restSnooze: requireElement(doc, 'rest-snooze'),
      scoreVerdict: requireElement(doc, 'score-verdict'),
      focusPlay: requireElement(doc, 'focus-play'),
      focusPlayIcon: requireElement(doc, 'focus-play-icon'),
      focusReplay: requireElement(doc, 'focus-replay'),
      focusHandle: requireElement(doc, 'focus-handle'),
      focusHealth: requireElement(doc, 'focus-health'),
      focusPlayFrame: requireElement(doc, 'focus-play-frame'),
      focusHands: requireElement(doc, 'focus-hands'),
      focusMetronome: requireElement(doc, 'focus-metronome'),
      freeBeatsFewer: requireElement(doc, 'free-beats-fewer'),
      freeBeatsMore: requireElement(doc, 'free-beats-more'),
      freeBeatsCount: requireElement(doc, 'free-beats-count'),
      freeFromScore: requireElement(doc, 'free-from-score'),
      freeBeatsDots: requireElement(doc, 'free-beats-dots'),
      freeTap: requireElement(doc, 'free-tap'),
      metronomeOn: requireElement(doc, 'metronome-on'),
      scoreListening: requireElement(doc, 'score-listening'),
      freeChord: requireElement(doc, 'free-chord'),
      scoreListeningText: requireElement(doc, 'score-listening-text'),
      focusRepeat: requireElement(doc, 'focus-repeat'),
      focusBare: requireElement(doc, 'focus-bare'),
      pagedScore: requireElement(doc, 'paged-score'),
      repeatNumbers: requireElement(doc, 'repeat-numbers'),
      traceTheStart: requireElement(doc, 'trace-the-start'),
      timingTrail: requireElement(doc, 'timing-trail'),
      timingTrailLines: requireElement(doc, 'timing-trail-lines'),
      driveSync: requireElement(doc, 'drive-sync'),
      driveCode: requireElement(doc, 'drive-code'),
      driveStatus: requireElement(doc, 'drive-status'),
      driveOnly: requireElement(doc, 'drive-only'),
      driveOnlySketches: requireElement(doc, 'drive-only-sketches'),
      driveOnlySketchesSaid: requireElement(doc, 'drive-only-sketches-said'),
      offerToSync: requireElement(doc, 'offer-to-sync'),
      settingsSearch: requireElement(doc, 'settings-search'),
      settingsSearchCount: requireElement(doc, 'settings-search-count'),
      settingsSearchPrevious: requireElement(doc, 'settings-search-previous'),
      settingsSearchNext: requireElement(doc, 'settings-search-next'),
      scoreSync: requireElement(doc, 'score-sync'),
      scoreSyncText: requireElement(doc, 'score-sync-text'),
      storageTotal: requireElement(doc, 'storage-total'),
      storageBar: requireElement(doc, 'storage-bar'),
      storageLegend: requireElement(doc, 'storage-legend'),
      storageKept: requireElement(doc, 'storage-kept'),
      storageSmall: requireElement(doc, 'storage-small'),
      focusSmaller: requireElement(doc, 'focus-smaller'),
      focusBigger: requireElement(doc, 'focus-bigger'),
      focusZoom: requireElement(doc, 'focus-zoom'),
      focusHandLeft: requireElement(doc, 'focus-hand-left'),
      focusHandRight: requireElement(doc, 'focus-hand-right'),
      focusHealthFill: requireElement(doc, 'focus-health-fill'),
      playingAhead: requireElement(doc, 'playing-ahead'),
      immediateStart: requireElement(doc, 'immediate-start'),
      dimUnplayed: requireElement(doc, 'dim-unplayed'),
      pageTurns: requireElement(doc, 'page-turns'),
      pageTurnsDescription: requireElement(doc, 'page-turns-description'),
      scoreToday: requireElement(doc, 'score-today'),
      scoreTodayText: requireElement(doc, 'score-today-text'),
      scoreWeek: requireElement(doc, 'score-week'),
      scoreModes: requireElement(doc, 'score-modes'),
      scorePages: requireElement(doc, 'score-pages'),
      scorePageBack: requireElement(doc, 'score-page-back'),
      scorePageOn: requireElement(doc, 'score-page-on'),
      scorePageAt: requireElement(doc, 'score-page-at'),
      hearOtherHand: requireElement(doc, 'hear-other-hand'),
      rushingCounts: requireElement(doc, 'rushing-counts'),
      markListening: requireElement(doc, 'mark-listening'),
      showPlaybackNotes: requireElement(doc, 'show-playback-notes'),
      rulerCursor: requireElement(doc, 'ruler-cursor'),
      rulerStrength: requireElement(doc, 'ruler-strength'),
      rulerStrengthValue: requireElement(doc, 'ruler-strength-value'),
      rhythmRuler: requireElement(doc, 'rhythm-ruler'),
      rhythmRulerDescription: requireElement(doc, 'rhythm-ruler-description'),
      focusDrawer: requireElement(doc, 'focus-drawer'),
      focusRow: requireElement(doc, 'focus-row'),
      focusSpeed: requireElement(doc, 'focus-speed'),
      focusStop: requireElement(doc, 'focus-stop'),
      focusKeyboard: requireElement(doc, 'focus-keyboard'),
      focusRewind: requireElement(doc, 'focus-rewind'),
      focusSlower: requireElement(doc, 'focus-slower'),
      focusFaster: requireElement(doc, 'focus-faster'),
      focusTempo: requireElement(doc, 'focus-tempo'),
      scoresFresh: requireElement(doc, 'scores-fresh'),
      scoresFreshRow: requireElement(doc, 'scores-fresh-row'),
      scoresTools: requireElement(doc, 'scores-tools'),
      scoresShowScores: requireElement(doc, 'scores-show-scores'),
      scoresShowSketches: requireElement(doc, 'scores-show-sketches'),
      sketchesList: requireElement(doc, 'sketches-list'),
      sketchesEmpty: requireElement(doc, 'sketches-empty'),
      sketchesNew: requireElement(doc, 'sketches-new'),
      scoresRung: requireElement(doc, 'scores-rung'),
      scoresExercise: requireElement(doc, 'scores-exercise'),
      sheetExercise: requireElement(doc, 'sheet-exercise'),
      exerciseClose: requireElement(doc, 'exercise-close'),
      ladderTrack: requireElement(doc, 'ladder-track'),
      grades: requireElement(doc, 'grades'),
      gradeNew: requireElement(doc, 'grade-new'),
      gradeNotYet: requireElement(doc, 'grade-not-yet'),
      midiStatus: requireElement(doc, 'midi-status'),
      bridgeStatus: requireElement(doc, 'bridge-status'),
      pedalStatus: requireElement(doc, 'pedal-status'),
      connectMidi: requireElement(doc, 'connect-midi'),
      midiInput: requireElement(doc, 'midi-input'),
      midiHint: requireElement(doc, 'midi-hint'),
      result: requireElement(doc, 'result'),
      drill: requireElement(doc, 'drill'),
      verdictFresh: requireElement(doc, 'verdict-fresh'),
      focusKeep: requireElement(doc, 'focus-keep'),
      focusKeepText: requireElement(doc, 'focus-keep-text'),
      focusRecord: requireElement(doc, 'focus-record'),
      focusRecordEye: requireElement(doc, 'focus-record-eye'),
      focusTakes: requireElement(doc, 'focus-takes'),
      focusScores: requireElement(doc, 'focus-scores'),
      sheetMetronome: requireElement(doc, 'sheet-metronome'),
      metronomeClose: requireElement(doc, 'metronome-close'),
      sheetTakes: requireElement(doc, 'sheet-takes'),
      sheetScores: requireElement(doc, 'sheet-scores'),
      scoreReading: requireElement(doc, 'score-reading'),
      sheetRoll: requireElement(doc, 'sheet-roll'),
      rollBody: requireElement(doc, 'roll-body'),
      rollKeep: requireElement(doc, 'roll-keep'),
      rollEdit: requireElement(doc, 'roll-edit'),
      rollPassage: requireElement(doc, 'roll-passage'),
      rollVelocity: requireElement(doc, 'roll-velocity'),
      rollVelocityLevel: requireElement(doc, 'roll-velocity-level'),
      rollVelocityAs: requireElement(doc, 'roll-velocity-as'),
      rollDynamics: requireElement(doc, 'roll-dynamics'),
      rollVelocityTicks: requireElement(doc, 'roll-velocity-ticks'),
      rollVelocitySaid: requireElement(doc, 'roll-velocity-said'),
      rollHands: requireElement(doc, 'roll-hands'),
      rollSketchStart: requireElement(doc, 'roll-sketch-start'),
      rollKey: requireElement(doc, 'roll-key'),
      rollScale: requireElement(doc, 'roll-scale'),
      rollMetre: requireElement(doc, 'roll-metre'),
      rollTempo: requireElement(doc, 'roll-tempo'),
      rollHandLeft: requireElement(doc, 'roll-hand-left'),
      rollHandPitch: requireElement(doc, 'roll-hand-pitch'),
      rollHandRight: requireElement(doc, 'roll-hand-right'),
      rollQuantize: requireElement(doc, 'roll-quantize'),
      rollHumanize: requireElement(doc, 'roll-humanize'),
      rollDelete: requireElement(doc, 'roll-delete'),
      rollSelect: requireElement(doc, 'roll-select'),
      rollUndo: requireElement(doc, 'roll-undo'),
      rollRedo: requireElement(doc, 'roll-redo'),
      rollChordsOpen: requireElement(doc, 'roll-chords-open'),
      rollMark: requireElement(doc, 'roll-mark'),
      sheetRollMark: requireElement(doc, 'sheet-roll-mark'),
      rollMarkTitle: requireElement(doc, 'roll-mark-title'),
      rollMarkMetre: requireElement(doc, 'roll-mark-metre'),
      rollMarkKey: requireElement(doc, 'roll-mark-key'),
      rollMarkScale: requireElement(doc, 'roll-mark-scale'),
      rollMarkTempo: requireElement(doc, 'roll-mark-tempo'),
      rollMarkDynamic: requireElement(doc, 'roll-mark-dynamic'),
      rollMarkReached: requireElement(doc, 'roll-mark-reached'),
      rollMarkRemove: requireElement(doc, 'roll-mark-remove'),
      rollMarkInsert: requireElement(doc, 'roll-mark-insert'),
      rollMarkYes: requireElement(doc, 'roll-mark-yes'),
      rollMarkNo: requireElement(doc, 'roll-mark-no'),
      rollChords: requireElement(doc, 'roll-chords'),
      rollChordsList: requireElement(doc, 'roll-chords-list'),
      rollChordsKeep: requireElement(doc, 'roll-chords-keep'),
      rollChordsForget: requireElement(doc, 'roll-chords-forget'),
      rollCopy: requireElement(doc, 'roll-copy'),
      rollCopyChosen: requireElement(doc, 'roll-copy-chosen'),
      rollArpeggioUp: requireElement(doc, 'roll-arpeggio-up'),
      rollArpeggioDown: requireElement(doc, 'roll-arpeggio-down'),
      rollArpeggioUpAndDown: requireElement(doc, 'roll-arpeggio-up-and-down'),
      rollPaste: requireElement(doc, 'roll-paste'),
      rollTitle: requireElement(doc, 'roll-title'),
      rollBox: requireElement(doc, 'roll-box'),
      rollChord: requireElement(doc, 'roll-chord'),
      rollRename: requireElement(doc, 'roll-rename'),
      rollMap: requireElement(doc, 'roll-map'),
      rollMapWindow: requireElement(doc, 'roll-map-window'),
      rollMapHead: requireElement(doc, 'roll-map-head'),
      rollPitchMap: requireElement(doc, 'roll-pitch-map'),
      rollPitchMapWindow: requireElement(doc, 'roll-pitch-map-window'),
      rollFrom: requireElement(doc, 'roll-from'),
      rollTo: requireElement(doc, 'roll-to'),
      rollPassageWhat: requireElement(doc, 'roll-passage-what'),
      rollPractise: requireElement(doc, 'roll-practise'),
      rollZoom: requireElement(doc, 'roll-zoom'),
      rollSnap: requireElement(doc, 'roll-snap'),
      rollGhosts: requireElement(doc, 'roll-ghosts'),
      rollSlips: requireElement(doc, 'roll-slips'),
      rollScrollPlayback: requireElement(doc, 'roll-scroll-playback'),
      rollHeadAt: requireElement(doc, 'roll-head-at'),
      rollHeadAtValue: requireElement(doc, 'roll-head-at-value'),
      rollOptions: requireElement(doc, 'roll-options'),
      sheetRollOptions: requireElement(doc, 'sheet-roll-options'),
      rollOptionsClose: requireElement(doc, 'roll-options-close'),
      rollSpeed: requireElement(doc, 'roll-speed'),
      rollClick: requireElement(doc, 'roll-click'),
      rollGrid: requireElement(doc, 'roll-grid'),
      rollPlay: requireElement(doc, 'roll-play'),
      rollPlayIcon: requireElement(doc, 'roll-play-icon'),
      rollStop: requireElement(doc, 'roll-stop'),
      rollRecord: requireElement(doc, 'roll-record'),
      rollStopIcon: requireElement(doc, 'roll-stop-icon'),
      rollClose: requireElement(doc, 'roll-close'),
      sheetSettings: requireElement(doc, 'sheet-settings'),
      settingsSections: requireElement(doc, 'settings-sections'),
      sheetPlaces: requireElement(doc, 'sheet-places'),
      focusPlaces: requireElement(doc, 'focus-places'),
      focusRoll: requireElement(doc, 'focus-roll'),
      focusSketch: requireElement(doc, 'focus-sketch'),
      placesClose: requireElement(doc, 'places-close'),
      sheetModes: requireElement(doc, 'sheet-modes'),
      modesGrid: requireElement(doc, 'modes-grid'),
      frameChoices: [
        ...requireElement(doc, 'modes-grid').querySelectorAll<HTMLButtonElement>('button[data-frame]'),
      ],
      modesClose: requireElement(doc, 'modes-close'),
      focusModes: requireElement(doc, 'focus-modes'),
      settingsMetronome: requireElement(doc, 'settings-metronome'),
      focusSettings: requireElement(doc, 'focus-settings'),
      settingsClose: requireElement(doc, 'settings-close'),
      takesClose: requireElement(doc, 'takes-close'),
      scoresClose: requireElement(doc, 'scores-close'),
      takesEmpty: requireElement(doc, 'takes-empty'),
      takeTransport: requireElement(doc, 'take-transport'),
      takeOnTheKeys: requireElement(doc, 'take-on-the-keys'),
      takeOffTheKeys: requireElement(doc, 'take-off-the-keys'),
      takeOnKeys: requireElement(doc, 'take-on-keys'),
      replayOnKeys: requireElement(doc, 'replay-on-keys'),
      listenOnKeys: requireElement(doc, 'listen-on-keys'),
      listenGoesOn: requireElement(doc, 'listen-goes-on'),
      listenGoesOnIcon: requireElement(doc, 'listen-goes-on-icon'),
      listenPrevious: requireElement(doc, 'listen-previous'),
      listenNext: requireElement(doc, 'listen-next'),
      listenPosition: requireElement(doc, 'listen-position'),
      listenScrub: requireElement(doc, 'listen-scrub'),
      listenDuration: requireElement(doc, 'listen-duration'),
      replayPosition: requireElement(doc, 'replay-position'),
      replayScrub: requireElement(doc, 'replay-scrub'),
      replayDuration: requireElement(doc, 'replay-duration'),
      takePlay: requireElement(doc, 'take-play'),
      takePlayIcon: requireElement(doc, 'take-play-icon'),
      takePosition: requireElement(doc, 'take-position'),
      takeDuration: requireElement(doc, 'take-duration'),
      takeScrub: requireElement(doc, 'take-scrub'),
      scoresEmpty: requireElement(doc, 'scores-empty'),
      scoresAdded: requireElement(doc, 'scores-added'),
      sheetConfirm: requireElement(doc, 'sheet-confirm'),
      confirmText: requireElement(doc, 'confirm-text'),
      confirmYes: requireElement(doc, 'confirm-yes'),
      confirmNo: requireElement(doc, 'confirm-no'),
      scoresList: requireElement(doc, 'scores-list'),
      scoresOrder: requireElement(doc, 'scores-order'),
      sheetStars: requireElement(doc, 'sheet-stars'),
      starsText: requireElement(doc, 'stars-text'),
      starsValue: requireElement(doc, 'stars-value'),
      starsNone: requireElement(doc, 'stars-none'),
      starsNo: requireElement(doc, 'stars-no'),
      starsYes: requireElement(doc, 'stars-yes'),
      scoresSearch: requireElement(doc, 'scores-search'),
      sheetReadings: requireElement(doc, 'sheet-readings'),
      readingsList: requireElement(doc, 'readings-list'),
      readingsEmpty: requireElement(doc, 'readings-empty'),
      readingsBest: requireElement(doc, 'readings-best'),
      readingsThisPiece: requireElement(doc, 'readings-this-piece'),
      readingsThrough: requireElement(doc, 'readings-through'),
      sheetReading: requireElement(doc, 'sheet-reading'),
      readingTitle: requireElement(doc, 'reading-title'),
      readingWhat: requireElement(doc, 'reading-what'),
      readingRoll: requireElement(doc, 'reading-roll'),
      readingReplay: requireElement(doc, 'reading-replay'),
      replayKeys: requireElement(doc, 'replay-keys'),
      readingDelete: requireElement(doc, 'reading-delete'),
      readingClose: requireElement(doc, 'reading-close'),
      readingsClose: requireElement(doc, 'readings-close'),
      focusReadings: requireElement(doc, 'focus-readings'),
      sheetRename: requireElement(doc, 'sheet-rename'),
      renameText: requireElement(doc, 'rename-text'),
      renameName: requireElement(doc, 'rename-name'),
      renameProblem: requireElement(doc, 'rename-problem'),
      confirmTyped: requireElement(doc, 'confirm-typed'),
      renameYes: requireElement(doc, 'rename-yes'),
      renameNo: requireElement(doc, 'rename-no'),
      whatOpens: requireElement(doc, 'what-opens'),
      whatOpensDescription: requireElement(doc, 'what-opens-description'),
      scoresClear: requireElement(doc, 'scores-clear'),
      takesList: requireElement(doc, 'takes-list'),
      takesClear: requireElement(doc, 'takes-clear'),
      takesKeptOnly: requireElement(doc, 'takes-kept-only'),
      scoresAdd: requireElement(doc, 'scores-add'),
      scoreFile: requireElement(doc, 'score-file'),
      ladderDown: requireElement(doc, 'ladder-down'),
      ladderUp: requireElement(doc, 'ladder-up'),
      ladderStep: requireElement(doc, 'ladder-step'),
      ladderDescription: requireElement(doc, 'ladder-description'),
      preset: requireElement(doc, 'preset'),
      presetDescription: requireElement(doc, 'preset-description'),
      rhythm: requireElement(doc, 'rhythm'),
      rhythmDescription: requireElement(doc, 'rhythm-description'),
      key: requireElement(doc, 'key'),
      timeSignature: requireElement(doc, 'time-signature'),
      measures: requireElement(doc, 'measures'),
      measuresValue: requireElement(doc, 'measures-value'),
      tempo: requireElement(doc, 'tempo'),
      tempoValue: requireElement(doc, 'tempo-value'),
      click: requireElement(doc, 'click'),
      clickDescription: requireElement(doc, 'click-description'),
      clickNotesGroup: requireElement(doc, 'click-notes-group'),
      clickNotes: requireElement(doc, 'click-notes'),
      dropout: requireElement(doc, 'dropout'),
      dropoutDescription: requireElement(doc, 'dropout-description'),
      focusFrom: requireElement(doc, 'focus-from'),
      focusTo: requireElement(doc, 'focus-to'),
      focusBars: requireElement(doc, 'focus-bars'),
      focusWhole: requireElement(doc, 'focus-whole'),
      preview: requireElement(doc, 'preview'),
      previewValue: requireElement(doc, 'preview-value'),
      countIn: requireElement(doc, 'count-in'),
      passageList: requireElement(doc, 'passage-list'),
      passageEmpty: requireElement(doc, 'passage-empty'),
      passageName: requireElement(doc, 'passage-name'),
      passageSave: requireElement(doc, 'passage-save'),
      clickSilences: requireElement(doc, 'click-silences'),
      clickSilencesDescription: requireElement(doc, 'click-silences-description'),
      countInRun: requireElement(doc, 'count-in-run'),
      countInPlayback: requireElement(doc, 'count-in-playback'),
      countInPlaybackDescription: requireElement(doc, 'count-in-playback-description'),
      metronomeTap: requireElement(doc, 'metronome-tap'),
      metronomeTapDescription: requireElement(doc, 'metronome-tap-description'),
      countInValue: requireElement(doc, 'count-in-value'),
      tolerance: requireElement(doc, 'tolerance'),
      latency: requireElement(doc, 'latency'),
      latencyValue: requireElement(doc, 'latency-value'),
      latencyMeasure: requireElement(doc, 'latency-measure'),
      latencyTest: requireElement(doc, 'latency-test'),
      latencyDescription: requireElement(doc, 'latency-description'),
      saveBackup: requireElement(doc, 'save-backup'),
      openBackup: requireElement(doc, 'open-backup'),
      backupFile: requireElement(doc, 'backup-file'),
      backupDescription: requireElement(doc, 'backup-description'),
      saveJudging: requireElement(doc, 'save-judging'),
      copyJudging: requireElement(doc, 'copy-judging'),
      saveTimings: requireElement(doc, 'save-timings'),
      copyTimings: requireElement(doc, 'copy-timings'),
      toleranceValue: requireElement(doc, 'tolerance-value'),
      zoom: requireElement(doc, 'zoom'),
      zoomValue: requireElement(doc, 'zoom-value'),
      showPlayed: requireElement(doc, 'show-played'),
      theme: requireElement(doc, 'theme'),
      darkSystemTheme: requireElement(doc, 'dark-system-theme'),
      showPlayedDescription: requireElement(doc, 'show-played-description'),
      readAhead: requireElement(doc, 'read-ahead'),
      readAheadDescription: requireElement(doc, 'read-ahead-description'),
      cursorListening: requireElement(doc, 'cursor-listening'),
      cursorRest: requireElement(doc, 'cursor-rest'),
      sampleLoading: requireElement(doc, 'sample-loading'),
      sampleLoadingHint: requireElement(doc, 'sample-loading-hint'),
      networkState: requireElement(doc, 'network-state'),
      metronomeVolume: requireElement(doc, 'metronome-volume'),
      metronomeVolumeValue: requireElement(doc, 'metronome-volume-value'),
      soundMetronomeVolume: requireElement(doc, 'sound-metronome-volume'),
      soundMetronomeVolumeValue: requireElement(doc, 'sound-metronome-volume-value'),
      instrumentVolume: requireElement(doc, 'instrument-volume'),
      instrumentVolumeValue: requireElement(doc, 'instrument-volume-value'),
      learnKnob: requireElement(doc, 'learn-knob'),
      knobStatus: requireElement(doc, 'knob-status'),
      learnMetronomeKnob: requireElement(doc, 'learn-metronome-knob'),
      metronomeKnobStatus: requireElement(doc, 'metronome-knob-status'),
      pitchClass: requireElement(doc, 'pitch-class'),
      audioFeedback: requireElement(doc, 'audio-feedback'),
      computerKeyboard: requireElement(doc, 'computer-keyboard'),
    };
    this.replayKeyboard = drawTheKeyboard(this.el.replayKeys);
  }

  async initialize(): Promise<void> {
    // First, before anything this visit prints over them: what the last one
    // kept may be the only word there is on why it ended.
    this.showTheLastTimings();
    // And every line from here on kept as it is printed - which is only while
    // the timings are asked for, since nothing is printed otherwise.
    keepTheTrail((lines) => {
      this.runtime.trail.keep(lines);
    });
    this.populateSelects();
    this.bindControls();
    this.bindTransport();
    this.bindControllerEvents();
    this.bindMidi();
    // Before the music, because the music is the slow half. Opening what the
    // reader asked to find on the stand waits on a database and then on an
    // engraving, and asking for the keyboard waits on neither - so a request
    // made after all that left the instrument deaf for as long as the page
    // took to draw. A reader whose hands were already on the keys played into
    // nothing: his, about the run that starts when you play the first notes.
    //
    // Safe here and not before `bindMidi`: the list of inputs is kept by a
    // subscription rather than read once, so whenever the devices arrive the
    // picker is told.
    void this.runtime.webMidi.connect();
    this.syncControlsFromSettings();
    this.updateButtons('idle');
    this.describeTake();
    this.renderTakes();
    this.bindTheKnobs();
    this.countTheTime();
    await this.openWhatWasAskedFor();
    this.syncOnComingBack();
    const onVisibility = (): void => {
      this.syncOnComingBack();
    };
    this.doc.addEventListener('visibilitychange', onVisibility);
    this.subscriptions.push(() => {
      this.doc.removeEventListener('visibilitychange', onVisibility);
    });
    // Again, and after the material this time. Opening material settles
    // things the reader left set on a visit that is over - the passage of a
    // piece not on the stand is not a passage of this one - and the boxes
    // are a view of those settings, not a second copy of them. Drawn only
    // beforehand they went on showing bars 12 to 16 of a piece nobody had
    // opened, and the next thing the reader touched wrote them back.
    this.syncControlsFromSettings();
  }

  /**
   * Puts on the stand whatever the reader asked to find there.
   *
   * Generating is the quick way in and stays the default: the library lives
   * in a database that answers later than the page draws, so anything read
   * out of it has to be waited for. Where a reader has asked for one of their
   * own pieces they would rather wait than watch an exercise appear and be
   * taken away again - two engravings for a piece nobody asked for.
   *
   * Nothing here is a *reading*, so nothing here stamps a score: a random
   * piece the program chose would otherwise push itself to the top of the
   * library and lose the one actually being worked on.
   */
  private async openWhatWasAskedFor(): Promise<void> {
    const wanted = this.runtime.controller.settings.whatOpens;
    if (wanted === 'generated') {
      // The database answers later than the page draws, so the list arrives
      // when it arrives rather than holding the trainer up for it.
      void this.runtime.scores.load().then(() => this.renderScores());
      await this.runtime.controller.loadNewExercise();
      return;
    }

    await this.runtime.scores.load();
    this.renderScores();
    // The sketch opened last, where it is what was asked for - or, asked for
    // whatever was open last, where it was opened after the score read last.
    const sketch = this.runtime.sketches.openedLast;
    const lastRead = this.runtime.scores.lastRead;
    if (
      sketch !== null &&
      (wanted === 'lastSketch' || (wanted === 'lastOfAll' && (lastRead === null || sketch.atMs > lastRead.openedAtMs)))
    ) {
      // In the editor, where a sketch is worked on, over it written down,
      // which is what the page shows once the editor is shut.
      await this.writeDownTheSketch(sketch.sketch.id, this.el.sheetScores);
      this.showTheSketch(sketch.sketch.id);
      return;
    }
    const chosen =
      wanted === 'last' || wanted === 'lastOfAll'
        ? lastRead
        : wanted === 'random'
          ? this.runtime.scores.oneAtRandom(Math.random())
          : null;
    const exercise = chosen === null ? null : await this.runtime.scores.open(chosen.id);
    if (exercise === null) {
      // An empty library, or a score the database no longer has. Either way
      // there is something to read a moment from now, which is the point.
      await this.runtime.controller.loadNewExercise();
      return;
    }
    await this.runtime.controller.openScore(exercise);
  }

  dispose(): void {
    this.forgetTheBeats();
    this.cancelPreview();
    if (this.tempoRedraw !== null) {
      clearTimeout(this.tempoRedraw);
      this.tempoRedraw = null;
    }
    if (this.restTimer !== null) {
      clearTimeout(this.restTimer);
      this.restTimer = null;
    }
    if (this.takeTick !== null) {
      clearInterval(this.takeTick);
      this.takeTick = null;
    }
    if (this.rollTick !== null) {
      clearInterval(this.rollTick);
      this.rollTick = null;
    }
    if (this.replayTick !== null) {
      clearInterval(this.replayTick);
      this.replayTick = null;
    }
    if (this.listenTick !== null) {
      clearInterval(this.listenTick);
      this.listenTick = null;
    }
    this.forgetTheMapFrame();
    this.stopTheNotesFalling();
    if (this.beatFrame !== null) {
      this.doc.defaultView?.cancelAnimationFrame(this.beatFrame);
      this.beatFrame = null;
    }
    if (this.keysFrame !== null) {
      this.doc.defaultView?.cancelAnimationFrame(this.keysFrame);
      this.keysFrame = null;
    }
    if (this.closingFrame !== null) {
      this.doc.defaultView?.cancelAnimationFrame(this.closingFrame);
      this.closingFrame = null;
    }
    this.stopTheFling();
    if (this.timeTick !== null) {
      clearInterval(this.timeTick);
      this.timeTick = null;
    }
    if (this.syncTimer !== null) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.survivalTick !== null) {
      clearInterval(this.survivalTick);
      this.survivalTick = null;
    }
    if (this.silenceWatch !== null) {
      clearTimeout(this.silenceWatch);
      this.silenceWatch = null;
    }
    this.stopTheOtherHandsMarker();
    // Given back before the page goes, or they are swallowed from whatever the
    // reader plays next by a view that is no longer there to answer them.
    this.runtime.mediaKeys.sounding(null);
    this.runtime.takePlayer.stop();
    for (const unsubscribe of [...this.subscriptions, ...this.sessionSubscriptions]) {
      unsubscribe();
    }
    this.subscriptions.length = 0;
    this.sessionSubscriptions = [];
  }

  /**
   * Reads whatever was chosen, and practises it if it was one thing.
   *
   * Several at once are added and none of them opened. Adding a shelf of
   * arrangements is a different act from picking up a piece: opening each in
   * turn engraves every one of them, which on thirty files is minutes of
   * waiting for pages nobody asked to see, and leaves the stand holding
   * whichever happened to be last.
   *
   * One file is still picked up, because choosing one file is choosing that
   * piece.
   *
   * Whatever the importer had to drop is shown rather than swallowed: the
   * model is narrower than MusicXML, and a reader who is not told what was
   * lost will blame the trainer for the difference.
   */
  private async openChosenScore(): Promise<void> {
    const chosen = [...(this.el.scoreFile.files ?? [])];
    // Cleared so that choosing the same file twice still fires a change.
    this.el.scoreFile.value = '';
    if (chosen.length === 0) {
      return;
    }
    const alone = chosen.length === 1;
    const kept: string[] = [];
    const refused: { readonly name: string; readonly why: string }[] = [];

    for (const file of chosen) {
      try {
        if (alone) {
          timeTheStart('score asked for', () => file.name);
        }
        const { exercise, warnings } = await this.runtime.importer.readFile(
          await file.arrayBuffer(),
          file.name,
        );
        timeTheStart('score: read from the file');
        // Kept on the way in, so the file is chosen from the disk once and
        // afterwards the piece is simply there.
        await this.runtime.scores.keep(exercise, Date.now());
        timeTheStart('score: kept in the library');
        kept.push(exercise.title);
        if (alone) {
          await this.pickUpTheFile(exercise);
        }
        this.sayWhatTheFileLeftOut(exercise, warnings);
      } catch (error) {
        reportToTheConsole(`Could not open ${file.name}.`, error);
        refused.push({ name: file.name, why: whyAScoreWasRefused(error) });
      }
    }

    this.renderScores();
    this.sayWhatTheFilesDid(kept, refused, alone);
  }

  /** Puts a piece just read from a file on the stand. */
  private async pickUpTheFile(exercise: Exercise): Promise<void> {
    await this.runtime.controller.openScore(exercise);
    timeTheStart('score opened');
    // Opening a piece can put the passage back to the two ends, and the
    // boxes in the sheet are the same setting seen from another chair.
    this.syncControlsFromSettings();
  }

  /**
   * What a file did not bring with it goes to the console and no further. It
   * is worth keeping - several faults here were found through one of these -
   * and it is not worth a line across the music: the page says which piece
   * opened by printing its name in the corner.
   */
  private sayWhatTheFileLeftOut(exercise: Exercise, warnings: readonly ImportWarning[]): void {
    for (const warning of warnings) {
      reportToTheConsole(`Opening ${exercise.title}:`, warning.detail);
    }
  }

  /**
   * What became of an armful of files.
   *
   * One that would not open is said in the middle of the page, where every
   * other failure is said - and the library sheet it was chosen from stands
   * over exactly that, so the sheet gets out of the way first. Reported that
   * way: no error popup when an import fails.
   *
   * An armful that all went in says so under the list instead, and leaves the
   * sheet up: the reader is adding a shelf and the list they are watching is
   * the answer. One file that went in says nothing at all - the piece is on
   * the stand, which they can see.
   */
  private sayWhatTheFilesDid(
    kept: readonly string[],
    refused: readonly { readonly name: string; readonly why: string }[],
    alone: boolean,
  ): void {
    this.el.scoresAdded.hidden = true;
    if (refused.length === 0) {
      if (!alone) {
        this.el.scoresAdded.hidden = false;
        this.el.scoresAdded.textContent = `Added ${String(kept.length)} score${kept.length === 1 ? '' : 's'}.`;
      }
      return;
    }
    if (alone) {
      const only = refused[0];
      this.el.sheetScores.hidden = true;
      this.sayInTheMiddle(`Could not open ${only?.name ?? 'that file'}. ${only?.why ?? ''}`.trim());
      return;
    }
    // Named *and* explained. Somebody adding thirty files has no other way to
    // tell which of them was refused, and no way at all to tell why - this
    // line used to stop at the names, so a shelf that had run out of room
    // looked exactly like a file that was not music.
    this.el.scoresAdded.hidden = false;
    this.el.scoresAdded.textContent = `Added ${String(kept.length)}. ${refused
      .map((one) => `Could not open ${one.name}. ${one.why}`)
      .join(' ')}`.trim();
  }

  /**
   * The stretches marked out in the piece on the stand.
   *
   * Only for a kept score: an exercise is generated afresh every time, so
   * "bars 5 to 8" of one says nothing about the next. Tapping a row sets the
   * passage exactly as typing the two numbers would, because that is what it
   * does - there is one passage, and this is a way of reaching it.
   */
  private renderPassages(): void {
    const opened = this.runtime.controller.openedExercise;
    const saved = opened === null ? [] : this.runtime.scores.passagesOf(opened.title);
    this.el.passageSave.disabled = opened === null;
    this.el.passageEmpty.hidden = saved.length > 0;
    this.el.passageEmpty.textContent =
      opened === null
        ? 'Open one of your scores to mark places out in it.'
        : 'Nothing marked out yet. Choose a passage, name it, and it is kept with the score.';
    this.el.passageList.replaceChildren();

    const settings = this.runtime.controller.settings;
    for (const [at, passage] of saved.entries()) {
      const row = this.doc.createElement('li');

      // The whole name is the way in, rather than a word beside it: this is
      // reached for on a tablet with a hand that has just left the keys, and
      // the row is the target a thumb finds.
      const apply = this.doc.createElement('button');
      apply.type = 'button';
      apply.className = 'takes__name places__go';
      apply.textContent = `${passage.name} · bars ${passage.fromBar}-${passage.toBar}`;
      apply.title = `Practise bars ${passage.fromBar}-${passage.toBar}`;
      // Which of them the reader is in, said on the row itself. Without it
      // the list is a set of places with no answer to "where am I", and the
      // two numbers in the drawer are the only thing that knows.
      apply.setAttribute(
        'aria-pressed',
        String(settings.rangeFromBar === passage.fromBar && settings.rangeToBar === passage.toBar),
      );
      this.listen(apply, 'click', () => {
        this.goToThePlace(passage);
      });

      const remove = this.doc.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = 'Forget this passage';
      remove.setAttribute('aria-label', `Forget ${passage.name}`);
      this.listen(remove, 'click', () => {
        void this.keepPassages(saved.filter((_, index) => index !== at));
      });

      row.append(apply, remove);
      this.el.passageList.append(row);
    }
  }

  /**
   * Takes the reader to a place they marked out, rather than only to the
   * settings that describe it.
   *
   * His: picking one should jump to where it begins. Setting the two bar
   * numbers leaves the page wherever it was, which on a long piece is
   * usually nowhere near - and a passage the reader cannot see is a passage
   * they have to go and find.
   *
   * Everything the way-back button in the drawer already does, for the same
   * reasons: a run in progress is a run of somewhere else, a place pointed
   * at belongs to the passage being left, and the brackets on the page have
   * to move with the numbers or they bracket the old stretch. And the sheet
   * closes, because the point of the tap was to be somewhere.
   */
  private goToThePlace(passage: SavedPassage): void {
    const controller = this.runtime.controller;
    const status = controller.session?.status;
    if (status === 'running' || status === 'counting-in' || status === 'paused') {
      controller.stop();
    }
    controller.updateSettings({ rangeFromBar: passage.fromBar, rangeToBar: passage.toBar });
    controller.beginAtTheStart();
    this.placedOnBar = null;
    controller.cursorToStart();
    this.showPassageMarkers();
    // Which redraws the list too, so the row that was tapped comes back
    // marked without this having to say so twice.
    this.syncControlsFromSettings();
    this.el.sheetPlaces.hidden = true;
  }

  /**
   * Writes the click back to the score it was chosen for.
   *
   * The score being read, found the way the passages beside it are found - by
   * the title of what is open - so that nothing has to carry an id around for
   * this. Nothing kept, nothing remembered: a generated exercise is not a
   * piece anybody comes back to.
   */
  private async letTheScoreKeepTheClick(pattern: ClickPattern): Promise<void> {
    const opened = this.runtime.controller.openedExercise;
    const kept = this.runtime.scores.list().find((score) => score.title === opened?.title);
    if (kept === undefined) {
      return;
    }
    await this.runtime.scores.keepTheClick(kept.id, pattern, Date.now());
  }

  /** Writes the list back to the score it belongs to, and redraws it. */
  private async keepPassages(passages: readonly SavedPassage[]): Promise<void> {
    const opened = this.runtime.controller.openedExercise;
    const kept = this.runtime.scores.list().find((score) => score.title === opened?.title);
    if (kept === undefined) {
      return;
    }
    await this.runtime.scores.keepPassages(kept.id, passages, Date.now());
    this.renderPassages();
  }

  /**
   * Lists what has been read, newest first or best first.
   *
   * The score alone says little - eighty-two per cent of a passage at
   * seventy with one hand is a different afternoon from eighty-two at full
   * speed with both - so every row carries the speed and the hand it was
   * played at. Readings from before those were recorded simply do not
   * mention them, which is the truth about them.
   */
  private renderReadings(): void {
    const history = this.runtime.history;
    const best = this.el.readingsBest.checked;
    const piece = this.el.readingsThisPiece.checked
      ? this.runtime.controller.pieceKey
      : undefined;
    const through = this.el.readingsThrough.checked;
    const readings = best
      ? history.bestReadings(50, piece, (key) => this.howHardThePieceIs(key), through)
      : history.lastReadings(50, piece, through);
    this.el.readingsEmpty.hidden = readings.length > 0;
    // Whichever order, the list is empty only when nothing has been read:
    // the best of it include the readings that stopped. Unless only those
    // played through are asked for, and then it is those there are none of.
    this.el.readingsEmpty.textContent = through
      ? piece === undefined
        ? 'Nothing played through yet, from the start to the end.'
        : 'Nothing of this piece played through yet, from the start to the end.'
      : piece === undefined
        ? 'Nothing read yet. Play something and it is remembered here.'
        : 'Nothing read of this piece yet.';
    this.el.readingsList.replaceChildren();

    const now = Date.now();
    for (const reading of readings) {
      const row = this.doc.createElement('li');
      row.className = 'readings__row';

      const open = this.doc.createElement('button');
      open.type = 'button';
      open.className = 'readings__open';
      // The sentence stays, under the row rather than in it: it is what a
      // reader of the page hears, and what a test asks for.
      open.title = describeReading(reading);
      open.setAttribute('aria-label', `Open the reading: ${describeReading(reading)}`);
      this.listen(open, 'click', () => {
        this.showTheReading(reading);
      });

      const lines = this.doc.createElement('span');
      lines.className = 'readings__lines';

      const head = this.doc.createElement('span');
      head.className = 'readings__head';
      const name = this.doc.createElement('span');
      name.className = 'readings__name';
      name.textContent = pieceRead(reading.key);
      head.append(name, ...this.whatTheReadingWas(reading));

      const under = this.doc.createElement('span');
      under.className = 'readings__under';
      const grade = this.doc.createElement('span');
      grade.className = 'pill pill--grade';
      grade.dataset['grade'] = reading.grade;
      grade.textContent = `${percent(reading.overall)} ${reading.grade}`;
      under.append(grade);
      if (reading.notes !== undefined) {
        under.append(this.theNotesOf(reading.notes));
      }
      if (reading.tempoPercent !== undefined && reading.tempoPercent !== 100) {
        const tempo = this.doc.createElement('span');
        tempo.textContent = `${String(reading.tempoPercent)}% speed`;
        under.append(tempo);
      }
      const when = this.doc.createElement('span');
      when.className = 'takes__when';
      when.textContent = describeWhen(reading.atMs, now);
      under.append(when);

      lines.append(head, under);
      open.append(lines);
      row.append(open);
      this.el.readingsList.append(row);
    }
  }

  /**
   * A reading's notes as four numbers, each behind a dot in the colour it is
   * drawn on the page: Perfect, Good, missed, wrong.
   *
   * Numbers first and words only under the finger, because a row is read
   * against the rows around it and four short numbers line up. The dots and
   * not the digits carry the colour: the paler green is the page's own, and
   * as text that small it could not be read.
   */
  private theNotesOf(notes: NoteCounts): HTMLElement {
    const counts = this.doc.createElement('span');
    counts.className = 'readings__notes';
    const said = `${notes.perfect} perfect · ${notes.good} good · ${notes.missed} missed · ${notes.wrong} wrong`;
    counts.title = said;
    counts.setAttribute('aria-label', said);
    for (const [kind, count] of [
      ['perfect', notes.perfect],
      ['good', notes.good],
      ['missed', notes.missed],
      ['wrong', notes.wrong],
    ] as const) {
      const one = this.doc.createElement('span');
      one.className = 'readings__count';
      one.dataset['kind'] = kind;
      one.textContent = String(count);
      counts.append(one);
    }
    return counts;
  }

  /**
   * What a reading was, as the marks a row and its sheet both wear.
   *
   * Built once for the two of them: a row the reader is comparing against its
   * neighbours and the sheet they open from it are the same reading, and two
   * lists of what to say about one would differ the first time either was
   * touched. Only what was true of that run appears - both hands is the usual
   * way to play and wears no mark, and neither does full speed.
   */
  private whatTheReadingWas(reading: PracticeReading): readonly HTMLElement[] {
    const marks: HTMLElement[] = [];
    const pill = (kind: string, text: string, what: string): HTMLElement => {
      const made = this.doc.createElement('span');
      made.className = `pill pill--${kind}`;
      made.textContent = text;
      made.title = what;
      return made;
    };

    const [, bars] = reading.key.split(' bars:');
    // A run picked up partway says where, rather than calling itself the
    // whole piece or the whole passage it was only the end of.
    const began = barItBeganIn(reading);
    marks.push(
      began !== null
        ? pill(
            'slice',
            `from bar ${String(began)}`,
            bars === undefined ? 'Picked up partway through the piece' : `Picked up partway through bars ${bars}`,
          )
        : bars === undefined
          ? pill('slice', 'whole piece', 'Read from beginning to end')
          : pill('slice', `bars ${bars}`, 'A passage of it'),
    );

    if (reading.hand === 1 || reading.hand === 2) {
      const right = reading.hand === 1;
      marks.push(pill('hand', right ? 'RH' : 'LH', right ? 'Right hand alone' : 'Left hand alone'));
    }

    const hard = this.howHardThePieceIs(reading.key);
    if (hard !== null) {
      const stars = this.doc.createElement('span');
      // The shelf's own mark, colour and all: how hard a piece is has one
      // answer, and a second way of drawing it would drift from the first.
      stars.className = 'scores__stars';
      stars.dataset['band'] = String(theStarBand(hard));
      stars.textContent = `★ ${hard.toFixed(1)}`;
      stars.title = 'How hard you marked this piece';
      marks.push(stars);
    }

    if (!reading.completed) {
      const where =
        reading.stoppedAtBar === undefined || reading.stoppedAtBar === null
          ? 'stopped'
          : `stopped at bar ${String(reading.stoppedAtBar)}`;
      marks.push(pill('stopped', where, 'The reader did not reach the end'));
    }

    const badges = this.theBadgesOf(reading);
    if (badges.length > 0) {
      const worn = this.doc.createElement('span');
      worn.className = 'readings__modes';
      worn.append(...badges);
      marks.push(worn);
    }
    return marks;
  }

  /**
   * The marks of the kind of run it was, drawn as the squares themselves are.
   *
   * The frame from the table the cycling button is drawn from, and each square
   * from the square: cloned rather than drawn again, because a second drawing
   * of a mode is a second answer to what it looks like.
   */
  private theBadgesOf(reading: PracticeReading): readonly HTMLElement[] {
    const badges: HTMLElement[] = [];
    const frame = reading.modeId;
    if (frame !== undefined && frame !== PLAIN_FRAME && FRAME_ICON[frame] !== undefined) {
      const badge = this.doc.createElement('span');
      const slug = FRAME_SLUG[frame] ?? 'frame';
      badge.className = `score__mode score__mode--${slug} readings__mode`;
      badge.dataset['mode'] = slug;
      badge.title = FRAME_NAME[frame] ?? slug;
      const drawn = this.doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      drawn.setAttribute('viewBox', '0 0 24 24');
      drawn.setAttribute('aria-hidden', 'true');
      const path = this.doc.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', FRAME_ICON[frame] ?? '');
      drawn.append(path);
      badge.append(drawn);
      badges.push(badge);
    }
    for (const mode of reading.modes ?? []) {
      const card = this.el.modesGrid.querySelector<HTMLButtonElement>(
        `button[data-mode="${mode}"]`,
      );
      const icon = card?.querySelector('svg');
      if (card === undefined || card === null || icon === null || icon === undefined) {
        continue;
      }
      const badge = this.doc.createElement('span');
      badge.className = `score__mode score__mode--${mode} readings__mode`;
      badge.dataset['mode'] = mode;
      badge.title = card.querySelector('.mode-card__name')?.textContent ?? mode;
      badge.append(icon.cloneNode(true));
      badges.push(badge);
    }
    return badges;
  }

  /** How hard the piece of a reading was marked, or nothing for one nobody marked. */
  private howHardThePieceIs(key: string): number | null {
    const [what = ''] = key.split(' bars:');
    return what.startsWith('score:')
      ? this.runtime.scores.theStarsFor(what.slice('score:'.length))
      : null;
  }

  /**
   * One reading, opened over the list.
   *
   * What it was: the bars as they read, the shape of the playing, where the
   * hand fell about the beat. All of it kept with the reading when the run
   * ended, so a reading of a piece that is not even open draws the same
   * picture it drew that afternoon. An older one has given its picture up to
   * make room for newer ones, and says so rather than drawing an empty frame.
   */
  private showTheReading(reading: PracticeReading): void {
    this.theReadingShowing = reading;
    this.el.readingTitle.textContent = pieceRead(reading.key);
    this.el.readingWhat.replaceChildren(...this.drawTheReading(reading));
    this.el.readingRoll.hidden = reading.roll === undefined;
    this.el.readingReplay.hidden = !this.canReplayTheReading(reading);
    this.showTheSheet(this.el.sheetReading);
  }

  /** The parts of the picture a reading kept, in the order the report shows them. */
  private drawTheReading(reading: PracticeReading): readonly HTMLElement[] {
    const drawn: HTMLElement[] = [];
    // The same marks the row wears, so the sheet a reader opens from a row is
    // recognisably the thing they pressed.
    const marks = this.doc.createElement('div');
    marks.className = 'reading__marks';
    marks.append(...this.whatTheReadingWas(reading));
    const when = this.doc.createElement('span');
    when.className = 'takes__when';
    when.textContent = describeWhen(reading.atMs, Date.now());
    marks.append(when);
    drawn.push(marks);

    const grade = this.doc.createElement('div');
    grade.className = 'result__grade';
    grade.dataset['grade'] = reading.grade;
    grade.textContent = `${reading.grade} · ${percent(reading.overall)}${
      reading.tempoPercent === undefined || reading.tempoPercent === 100
        ? ''
        : ` · ${String(reading.tempoPercent)}% speed`
    }`;
    drawn.push(grade);

    const picture = reading.picture;
    if (picture === undefined) {
      const gone = this.doc.createElement('p');
      gone.className = 'hint';
      gone.textContent =
        'Only the score of this one is left: its picture was given up to make room for newer readings.';
      drawn.push(gone);
      return drawn;
    }

    const bars = barsOfThePicture(picture);
    if (bars.length >= 2) {
      const strip = this.doc.createElement('div');
      strip.className = 'run-strip';
      for (const cell of bars) {
        const box = this.doc.createElement('span');
        box.className = 'run-strip__bar';
        box.dataset['state'] = cell.state;
        box.dataset['waited'] = String(cell.waited);
        box.title = cell.label;
        strip.append(box);
      }
      drawn.push(strip);
    }

    if (picture.axes.length >= 3) {
      const figure = this.doc.createElement('div');
      figure.className = 'profile-figure';
      figure.append(drawTheProfile(picture.axes));
      const list = this.doc.createElement('dl');
      list.className = 'profile-figure__said';
      for (const axis of picture.axes) {
        const name = this.doc.createElement('dt');
        name.textContent = axis.name;
        const value = this.doc.createElement('dd');
        value.textContent = axis.said;
        list.append(name, value);
      }
      figure.append(list);
      drawn.push(figure);
    }

    const errors = theHitErrors(picture.deviationsMs, picture.toleranceMs, {
      tiers: tiersOfThePicture(picture),
      perfectMs: picture.perfectMs ?? null,
    });
    if (errors !== null) {
      drawn.push(drawTheHitErrors(errors));
      if (picture.pressesJudged > picture.deviationsMs.length) {
        // Said rather than left to be assumed: a strip of six hundred marks
        // standing for three thousand presses is the shape of the playing,
        // but it is not every press, and a reader counting them would be
        // counting the wrong thing.
        const some = this.doc.createElement('p');
        some.className = 'hint';
        some.textContent = `${picture.deviationsMs.length} of the ${picture.pressesJudged} presses drawn.`;
        drawn.push(some);
      }
    }

    const { totals } = picture;
    const rows: readonly (readonly [string, string])[] = [
      [
        'Notes',
        `${totals.correctNotes}/${totals.expectedNotes} (${percent(totals.expectedNotes === 0 ? 0 : totals.correctNotes / totals.expectedNotes)})`,
      ],
      ['Wrong notes', String(totals.wrongNotes)],
      ['Timing', `${Math.round(picture.meanAbsoluteDeviationMs)} ms away on average`],
      [
        'Tendency',
        `${describeTendency(picture.meanDeviationMs)} · ± ${Math.round(picture.deviationSpreadMs)} ms`,
      ],
      // Only where there is a gate at the bar line to wait at; see
      // `barsWaitedRow`, which says the same of a run that has just ended.
      ...(reading.modeId === BAR_MODE_ID
        ? ([['Bars it waited at', `${totals.barsWaitedFor} of ${picture.bars.length}`]] as const)
        : reading.modeId === NOTE_MODE_ID
          ? ([['Notes it waited at', `${totals.barsWaitedFor} of ${totals.playableSteps}`]] as const)
          : []),
    ];
    for (const [name, value] of rows) {
      const row = this.doc.createElement('div');
      row.className = 'result__row';
      const label = this.doc.createElement('span');
      label.textContent = name;
      const number = this.doc.createElement('strong');
      number.textContent = value;
      row.append(label, number);
      drawn.push(row);
    }
    return drawn;
  }

  /** Puts the reading away, and the reading it was of with it. */
  private shutTheReading(): void {
    this.el.sheetReading.hidden = true;
    this.theReadingShowing = null;
  }

  /**
   * Opens the picture on what a kept reading played.
   *
   * The sheet it was asked from steps aside, the way the list of recordings
   * does: asking to look at a reading is asking for the picture, and a sheet
   * standing over what it has just opened is the thing it opened being in the
   * way of itself.
   */
  private showTheReadingRoll(reading: PracticeReading): void {
    const roll = reading.roll;
    if (roll === undefined) {
      return;
    }
    this.stopTheRoll();
    this.theOtherRollShowing = {
      roll,
      what: describeReading(reading),
      why: 'A reading kept from before: its bars are not this score’s to practise.',
      ofTheOpenScore: this.wasPlayedOnTheOpenScore(reading, roll),
    };
    this.rollAtMs = 0;
    this.rollScroller.to(0, 0);
    this.drawTheRollInto();
    this.showTheSheet(this.el.sheetRoll);
    this.showTheView();
    this.sayWhatWouldBePractised();
    this.sayWhatThePictureIsOf();
  }

  /**
   * Lists the kept scores, each openable and each removable.
   *
   * Most recently read first, and the row says how long ago that was - an
   * order nobody can see the reason for is one they read as no order at all.
   * The search narrows what is drawn and nothing else: the count on the
   * opener and the "delete all" button both speak for the whole library,
   * which is what they delete.
   */
  private renderScores(): void {
    // Whatever changed on the shelf may be something the drive has not had.
    this.offerToSync();
    const all = this.runtime.scores.list();
    const query = this.el.scoresSearch.value.trim();
    const found = query === '' ? all : this.runtime.scores.search(query);
    const order = this.runtime.controller.settings.scoreOrder;
    this.el.scoresOrder.value = order;
    const scores = scoresInOrder(found, order);
    const now = Date.now();
    this.el.scoresEmpty.hidden = scores.length > 0;
    this.el.scoresEmpty.textContent =
      all.length > 0
        ? `Nothing kept here is called “${query}”.`
        : 'Nothing kept yet. Open a score and it is remembered here.';
    this.el.scoresClear.disabled = all.length === 0;
    this.el.scoresList.replaceChildren();

    for (const score of scores) {
      const row = this.doc.createElement('li');
      const name = this.doc.createElement('span');
      name.className = 'takes__name';
      name.textContent = `${score.title} · ${score.bars} bars`;
      name.title = score.title;

      const when = this.doc.createElement('span');
      when.className = 'takes__when';
      when.textContent = describeWhen(score.openedAtMs, now);

      // Nothing at all where nobody has said, rather than a nought or a dash:
      // an unmarked piece and an easy one must not look alike, and the column
      // keeps its width either way so the rows do not go ragged.
      const stars = this.doc.createElement('span');
      stars.className = 'scores__stars';
      stars.textContent = score.stars === undefined ? '' : `★ ${score.stars.toFixed(1)}`;
      // Which colour it wears is the sheet's business; this says only which
      // rung of the ladder the piece is on.
      if (score.stars !== undefined) {
        stars.dataset['band'] = String(theStarBand(score.stars));
      }

      const open = this.doc.createElement('button');
      open.type = 'button';
      open.textContent = 'Open';
      this.listen(open, 'click', () => {
        void this.openKeptScore(score.id, score.title);
      });

      const judge = this.doc.createElement('button');
      judge.type = 'button';
      judge.textContent = '★';
      judge.title = 'How hard is this score?';
      judge.setAttribute('aria-label', `How hard is ${score.title}?`);
      this.listen(judge, 'click', () => {
        void this.judgeScore(score.id, score.title);
      });

      const rename = this.doc.createElement('button');
      rename.type = 'button';
      rename.textContent = '✎';
      rename.title = 'Rename this score';
      rename.setAttribute('aria-label', `Rename ${score.title}`);
      this.listen(rename, 'click', () => {
        void this.renameScore(score.id, score.title);
      });

      const remove = this.doc.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = 'Forget this score';
      remove.setAttribute('aria-label', `Forget ${score.title}`);
      this.listen(remove, 'click', () => {
        void this.askToDelete(`Forget ${score.title}?`).then((yes) => {
          if (yes) {
            void this.runtime.scores.remove(score.id).then(() => this.renderScores());
          }
        });
      });

      // Open stays the first button in the row: it is the one thing a reader
      // reaches for, and it has been in that place since there were rows. The
      // mark goes with what the row *says* rather than with what it does, so
      // it stands before the buttons and not among them.
      row.append(name, stars, when, open, judge, rename, remove);
      this.el.scoresList.append(row);
    }
  }

  /**
   * The timings the last visit kept, where it kept any.
   *
   * What a page closed by the browser leaves behind: the last stage in the
   * list is the last thing it lived to reach. His: "яж крашусь" - there is no
   * console to copy from a page that is gone.
   */
  private showTheLastTimings(): void {
    const lines = this.runtime.trail.lastKept();
    this.el.timingTrail.hidden = lines.length === 0;
    this.el.timingTrailLines.textContent = lines.join('\n');
  }

  /**
   * Opens a kept score. `asARead` is false where the program chose it - a
   * playback going on to the next piece - which is not the reader reading
   * it, and does not move it up the shelf.
   */
  private async openKeptScore(id: string, title: string, asARead = true): Promise<void> {
    // Out of the way first. Engraving a long score takes the thread for
    // seconds, and nothing on the page can be drawn or pressed while it does -
    // so the shelf stayed up, over music the reader had already asked for,
    // until the browser offered to kill the page. Shutting it here means the
    // last thing drawn before the wait is the page they asked to see, with the
    // engraver's own "working" beside it. His: "у scores кнопку open мабуть
    // зробити асинхронною, зачиняти сам діалог, та показувати loading, бо
    // сторінка просто зависає".
    this.el.sheetScores.hidden = true;
    timeTheStart('score asked for', () => title);
    try {
      const exercise = await this.runtime.scores.open(id);
      if (exercise === null) {
        this.sayInTheMiddle(`${title} is no longer stored on this device.`);
        this.renderScores();
        return;
      }
      await this.runtime.controller.openScore(exercise);
      timeTheStart('score opened');
      // The click this piece was last read with, where it has one. Only where:
      // a score that has never been chosen for leaves the setting alone, which
      // is what makes this a memory rather than a default.
      const asked = this.runtime.scores.theClickFor(exercise.title);
      if (asked !== null) {
        this.runtime.controller.updateSettings({ clickPattern: asked });
      }
      // Choosing one from the sheet is a reading, and the calendar is what
      // says so - `IClock` counts from an arbitrary zero for measuring music.
      if (asARead) {
        void this.runtime.scores.markRead(exercise.title, Date.now());
      }
      this.syncControlsFromSettings();
    } catch (error) {
      reportToTheConsole(`Could not open ${title}.`, error);
      this.sayInTheMiddle(`Could not open ${title}. ${whyAScoreWasRefused(error)}`);
    }
  }

  /**
   * Narrows to the passage a touch names, and re-engraves for it.
   *
   * Not while a run is going: the page changing under a reader mid-piece is
   * never what a stray touch meant.
   */
  /**
   * Takes the passage the markers were dragged around.
   *
   * The markers report bars of what is engraved, which is the whole piece:
   * a passage no longer cuts it down. So the bar a marker stands on is its
   * place in the playing, counted from one - never the number printed on it,
   * which a written-out repeat prints twice. A drag that reached past the
   * edge comes through as an index outside the engraving; the controller
   * clamps it to the piece, because nothing on the page can.
   */
  private async choosePassageFrom(drawn: DrawnPassage): Promise<void> {
    const controller = this.runtime.controller;
    const before = controller.settings;
    const passage = controller.choosePassage(
      drawn.fromMeasureIndex + 1,
      drawn.toMeasureIndex + 1,
    );
    if (
      passage.fromBar === before.rangeFromBar &&
      passage.toBar === before.rangeToBar
    ) {
      // A tap on a marker, or a drag that came back where it started.
      this.showPassageMarkers();
      return;
    }
    // Nothing is re-engraved. A passage used to cut the music down, so
    // choosing one meant laying the piece out again; now it only says where
    // the run begins and ends, and the notes on the page are the same notes.
    // Engraving them again would blank the staves for a moment and put the
    // reader back on the first page - which is what dragging a marker on
    // page three felt like.
    this.syncControlsFromSettings();
  }

  /**
   * Stands the markers around the passage, inside the whole piece.
   *
   * The music is no longer cut down to a passage, so the markers stand where
   * a pencil would: somewhere in the middle of the page, with the rest of
   * the piece still around them. Dragging one is a plain drag in either
   * direction, because the bars on both sides are on the page to drag to.
   */
  /**
   * Puts the reader's place in the music, where the next run will begin.
   *
   * Refused while a run is going: the cursor is the run's own, and moving it
   * under the music would leave the page and the playing in different bars.
   */
  private beginAt(measureIndex: number): void {
    const controller = this.runtime.controller;
    const status = controller.session?.status;
    if (status === 'running' || status === 'counting-in' || status === 'paused') {
      return;
    }
    const step = controller.beginAtBar(measureIndex);
    if (step === null) {
      return;
    }
    this.placedOnBar = measureIndex;
    this.showPassageMarkers();
  }

  /**
   * One gesture, and the page says what it will do next.
   *
   * Holding a finger on a bar fills in the next mark that is missing: the
   * place to start from, then the near end of the passage, then the far end.
   * With all three set it starts over.
   *
   * Which mark it is could have been said by *where* in the bar the finger
   * landed - near the bar line against the middle of it - and that is a
   * distinction a fingertip cannot reliably make: a bar is a couple of
   * centimetres and a fingertip is one, so a third of the misses would place
   * the wrong mark. Said by what is already on the page instead, the reader
   * never has to aim at anything smaller than a bar, and never has to count
   * how many times they have held: they look, and see which mark is missing.
   *
   * A double tap would have been the other way to say it, and it costs
   * either a quarter-second of waiting on *every* tap - including the grip
   * taps that nudge the passage a bar at a time, which are pressed in a row -
   * or a first tap that acts and is then undone.
   */
  private placeNextMark(measureIndex: number): void {
    const controller = this.runtime.controller;
    const status = controller.session?.status;
    if (status === 'running' || status === 'counting-in' || status === 'paused') {
      return;
    }
    const exercise = controller.currentExercise;
    if (exercise === null) {
      return;
    }
    const { rangeFromBar, rangeToBar } = controller.settings;
    // Where this bar comes in the playing, which is what a passage is made
    // of. The number printed on it says something else after a repeat, and
    // says it about two different bars.
    const bar = measureIndex + 1;
    const last = Math.max(1, measureCount(exercise));
    const flagged = this.placedOnBar;

    // Inside the passage, with a near end already standing: this is the far
    // end. Held on the near end's own bar it makes a passage of that one bar,
    // which is the quickest thing a reader wants; held further on it takes in
    // everything between.
    if (rangeFromBar !== null && bar >= rangeFromBar && bar <= (rangeToBar ?? last)) {
      this.narrowTo(rangeFromBar, bar);
      return;
    }
    // On the place the music starts from, and no passage yet: this is the
    // near end. The place has to be *here* rather than anywhere, so a reader
    // can see what the next hold will do by looking at the bar under their
    // finger.
    if (rangeFromBar === null && flagged === measureIndex) {
      this.narrowTo(bar, null);
      return;
    }
    // Anywhere else: a bar outside what is being practised is a reader
    // starting again somewhere new, so the passage goes and the place lands
    // here.
    if (rangeFromBar !== null || rangeToBar !== null) {
      controller.updateSettings({ rangeFromBar: null, rangeToBar: null });
    }
    this.beginAt(measureIndex);
  }

  /**
   * Shuts the passage onto the single bar one of its markers stands at.
   *
   * The fast way to say "this bar and no more", and it reads off the marker
   * the finger is on: the near one pulls the far one back to the end of its
   * own bar, the far one pulls the near one up to the start of its own.
   */
  private closeOnto(end: PassageEnd): void {
    const controller = this.runtime.controller;
    if (this.isPlaying) {
      return;
    }
    const exercise = controller.currentExercise;
    if (exercise === null) {
      return;
    }
    const last = Math.max(1, measureCount(exercise));
    const { rangeFromBar, rangeToBar } = controller.settings;
    const bar = end === 'from' ? (rangeFromBar ?? 1) : (rangeToBar ?? last);
    this.narrowTo(bar, bar);
  }

  /**
   * Puts the passage where a gesture asked for it.
   *
   * Nothing is said about it in words. The markers are drawn on the bars they
   * were just put on, which is the same answer given where the reader is
   * already looking - and given by the thing itself rather than by a sentence
   * about it.
   */
  private narrowTo(fromBar: number, toBar: number | null): void {
    this.runtime.controller.updateSettings({ rangeFromBar: fromBar, rangeToBar: toBar });
    this.passageMarkersWanted = true;
    this.syncControlsFromSettings();
  }

  private showPassageMarkers(): void {
    const bars = this.runtime.controller.currentExercise;
    this.showHandSwitches();
    if (bars === null || !this.passageMarkersWanted) {
      this.runtime.renderer.hidePassage();
      this.runtime.renderer.showStart(null);
      return;
    }
    const controller = this.runtime.controller;
    const { rangeFromBar, rangeToBar } = controller.settings;
    const last = Math.max(0, measureCount(bars) - 1);
    this.runtime.renderer.showPassage({
      fromMeasureIndex: rangeFromBar === null ? 0 : Math.min(Math.max(rangeFromBar - 1, 0), last),
      toMeasureIndex: rangeToBar === null ? last : Math.min(Math.max(rangeToBar - 1, 0), last),
      repeating: controller.settings.repeatRange,
      movable: !this.isPlaying,
    });
    // Only where the reader has actually moved it. A place at the beginning
    // of the passage is where a run starts anyway, and a mark saying so
    // would be furniture standing on top of the marker that already says it.
    const begins = controller.currentTimeline?.at(controller.beginsAt) ?? null;
    const atThePassageStart =
      begins === null || begins.measureIndex <= (rangeFromBar === null ? 0 : rangeFromBar - 1);
    this.runtime.renderer.showStart(
      controller.beginsAt > 0 && !atThePassageStart ? begins.measureIndex : null,
    );
  }

  /**
   * Plays the exercise, or stops it if it is already playing.
   *
   * Listening and a run share the pulse and the cursor, so the controller
   * makes them mutually exclusive; the button only has to say which of the two
   * it is offering.
   */
  /** Holds the performance where it has got to, to be picked up from there. */
  private holdThePerformance(): void {
    this.runtime.controller.pauseListening();
    // Held music has no next beat until it is picked up again.
    this.forgetTheBeats();
    lightTheKeys(this.replayKeyboard, new Map(), false);
    this.showThePerformance();
  }

  /**
   * Picks a held performance up from where it was held. The page is shown it
   * by the performance saying it has started, as a fresh one is.
   */
  private resumeThePerformance(): void {
    this.runtime.controller.resumeListening();
  }

  private async toggleListening(): Promise<void> {
    const { controller } = this.runtime;
    // Pressing it again holds the music rather than throwing it away. It is
    // the same button that started the performance, and pressing a play
    // button a second time does not mean "back to the top" anywhere else -
    // it used to here, so listening to a phrase twice meant sitting through
    // everything in front of it again. Stop is what ends a performance.
    if (controller.isListening) {
      this.holdThePerformance();
      return;
    }
    if (controller.isListeningPaused) {
      this.resumeThePerformance();
      return;
    }
    await this.beginThePerformance();
  }

  private async beginThePerformance(): Promise<void> {
    // The recordings download on first use, and playback fires a whole piece
    // at once: without waiting, its opening seconds come out on the synthesised
    // fallback and the instrument appears to change halfway through.
    await this.runtime.samples?.load();
    // Hearing it played is studying it, and the cursor would otherwise walk
    // across a blank page. Asking to hear it is the reader spending their
    // look, not a way around it.
    this.hasLooked = true;
    this.applyScoreCover();
    // The last run's verdict is over the music the performance is about to
    // walk through, which the reader asked to watch.
    this.showVerdict(false);
    this.runtime.controller.listen();
    this.showThePerformance();
  }

  /**
   * The pieces a playback goes through, from the one open now.
   *
   * Taken from the shelf, in the order it is read in, the first time it is
   * asked for and again only when it no longer answers: the way asked for is
   * a shuffle where it was not, or the other way round, or the piece open is
   * not the one it stands at - the reader opened another.
   */
  private theTurnOfPieces(): PiecesInTurn {
    const settings = this.runtime.controller.settings;
    const isShuffled = settings.playbackGoesOn === 'random';
    const open = this.runtime.controller.openedExercise?.title ?? null;
    const turn = this.piecesInTurn;
    if (turn !== null && turn.shuffled === isShuffled && open !== null && turn.playing?.title === open) {
      return turn;
    }
    const shelf = scoresInOrder(this.runtime.scores.list(), settings.scoreOrder).map(({ id, title }) => ({
      id,
      title,
    }));
    this.piecesInTurn = PiecesInTurn.fromTheShelf(shelf, open, isShuffled, Math.random);
    return this.piecesInTurn;
  }

  /**
   * Opens the next piece, or the one before, and plays it.
   *
   * What is playing is stopped first - where there is a piece to go to, and
   * not otherwise: a press that goes nowhere leaves the music playing.
   * Opening a long score takes seconds, and a stop, or another press,
   * meanwhile is the reader's later word: the piece opened then is left on
   * the stand, unplayed.
   */
  private async goOnToAnotherPiece(direction: 1 | -1): Promise<void> {
    const { controller } = this.runtime;
    const turn = this.theTurnOfPieces();
    const piece = direction > 0 ? turn.next() : turn.previous();
    if (piece === null) {
      return;
    }
    if (controller.isListening || controller.isListeningPaused) {
      this.stopEverything();
    }
    this.goingOn += 1;
    const asked = this.goingOn;
    this.openingToPlay = true;
    this.describeStopping();
    try {
      await this.openKeptScore(piece.id, piece.title, false);
    } finally {
      if (asked === this.goingOn) {
        this.openingToPlay = false;
        this.describeStopping();
      }
    }
    if (asked !== this.goingOn || controller.session !== null || controller.isListening) {
      return;
    }
    await this.beginThePerformance();
  }

  /** Says on its button what a playback goes on to, and what a press makes it. */
  private describeWhatPlaysNext(): void {
    const goesOn = this.runtime.controller.settings.playbackGoesOn;
    const next = PLAYBACK_GOES_ON[(PLAYBACK_GOES_ON.indexOf(goesOn) + 1) % PLAYBACK_GOES_ON.length] ?? 'this';
    const said = `${GOES_ON_SAID[goesOn]}. Press for ${GOES_ON_SAID[next].toLowerCase()}.`;
    this.el.listenGoesOn.dataset['goesOn'] = goesOn;
    this.el.listenGoesOn.title = said;
    this.el.listenGoesOn.setAttribute('aria-label', said);
    this.el.listenGoesOnIcon.setAttribute('d', GOES_ON_DRAWN[goesOn]);
    // A sketch or a take written down is on no shelf, and a playback of it
    // plays it alone: none of the three has anything to say there.
    const alone = this.runtime.controller.theScoreOpenStandsAlone;
    for (const button of [this.el.listenPrevious, this.el.listenGoesOn, this.el.listenNext]) {
      button.hidden = alone;
    }
    // The two either side go through the shelf, the way the platform's keys
    // do, and have nowhere to go while nothing is kept: dimmed, and said so.
    const empty = this.runtime.scores.isEmpty;
    for (const [button, said] of [
      [this.el.listenPrevious, 'The piece before'],
      [this.el.listenNext, 'The next piece'],
    ] as const) {
      if (empty) {
        button.dataset['idle'] = 'true';
        button.title = `${said}. Nothing is kept on the shelf to go to.`;
      } else {
        delete button.dataset['idle'];
        button.title = said;
      }
      button.setAttribute('aria-label', button.title);
    }
  }

  /**
   * Whether the repeat is pressed, and - in a playback going on to other
   * pieces, where it has nothing to say - dimmed, with the reason.
   */
  private describeTheRepeat(): void {
    const { controller } = this.runtime;
    const settings = controller.settings;
    this.el.focusRepeat.setAttribute('aria-pressed', String(settings.repeatRange));
    const listening = controller.isListening || controller.isListeningPaused;
    if (listening && controller.playbackGoesOnFromHere !== 'this') {
      this.el.focusRepeat.dataset['idle'] = 'true';
      this.el.focusRepeat.title = 'Play the passage again and again. Not while the playback goes on to other pieces.';
    } else {
      delete this.el.focusRepeat.dataset['idle'];
      this.el.focusRepeat.title = 'Play the passage again and again';
    }
    this.el.focusRepeat.setAttribute('aria-label', this.el.focusRepeat.title);
  }

  /**
   * Shows the top of the next page only while there is music moving.
   *
   * It exists to soften a page turn, and nothing is about to turn when
   * nothing is playing: what the reader has then is a page with the top of
   * the *next* one standing over the system they may well want to read
   * again - the one they have just played. Reported from the page: the run
   * stopped and the preview stayed hanging there.
   *
   * A held run and a held playback both count. The reader means to pick
   * them up, and the music will go on from where it is.
   */
  private applyPreview(): void {
    this.showToday();
    this.showTheDrill();
    const controller = this.runtime.controller;
    const moving =
      this.isPlaying || this.isPreviewing || controller.isListening || controller.isListeningPaused;
    this.runtime.renderer.showNextPagePreview(controller.settings.pageTurns === 'preview' && moving);
  }

  /**
   * What the marker button is showing, for the state the reader is in.
   *
   * Said here rather than only when a setting changes, because *which* of the
   * three answers is being shown changes when the music does - the run ends,
   * and the button is suddenly reporting a different one.
   */
  /**
   * Redraws everything a performance moves.
   *
   * It had a button of its own with three labels - listen, pause listening,
   * resume listening - which was a second transport beside the one the bar
   * already had. Listening is a frame now, so Start is what starts it and
   * Start is what says so; what is left here is the chrome that follows any
   * music going, whoever is making it.
   */
  /**
   * Says, in the start timings, when the browser has actually drawn the page.
   *
   * Everything the page does in answer to a start is timed as it is done, and
   * none of it is the browser laying the page out again or painting it - which
   * happens afterwards, where no line can see it. On a long score that can be
   * the largest part of the wait. Two frames, because the first is the one the
   * change is already in.
   */
  private markWhenPainted(): void {
    const view = this.doc.defaultView;
    if (view === null || typeof view.requestAnimationFrame !== 'function') {
      return;
    }
    view.requestAnimationFrame(() => {
      view.requestAnimationFrame(() => {
        timeTheStart('page painted');
      });
    });
  }

  private showThePerformance(): void {
    const controller = this.runtime.controller;
    this.applyPlayingChrome();
    this.describeTheRepeat();
    this.describeWhatPlaysNext();
    this.updateButtons(controller.session?.status ?? 'idle');
    this.describeStopping();
    this.sayWhatIsSounding();
    this.followThePerformance();
  }

  /**
   * Hands the platform's transport keys to a performance, and takes them back.
   *
   * Said from the one place every change to a performance already goes
   * through, so the panel on a lock screen cannot come to disagree with the
   * button on the page - the two would drift the first time a way of stopping
   * was added to one of them.
   *
   * Only a performance, and never a run. A reader mid-run who presses pause on
   * their headphones means the thing they are listening to elsewhere; the run
   * in front of them is not media, and stopping it from another application
   * would be a practice thrown away by a key press meant for something else.
   *
   * Only resuming, too, and never starting. These keys are pressed by somebody
   * who is not looking at this page, and a fresh performance beginning in a tab
   * they have forgotten is not what Play means to them.
   */
  private sayWhatIsSounding(): void {
    const { controller } = this.runtime;
    const playing = controller.isListening;
    if (!playing && !controller.isListeningPaused) {
      this.runtime.mediaKeys.sounding(null);
      return;
    }
    this.runtime.mediaKeys.sounding({
      title: controller.currentExercise?.title ?? 'Sight reading',
      playing,
      // The same roads as the button on the page, each asking first whether
      // there is anything for it to do: a key pressed after the music moved
      // on must neither hold what is held nor start what has ended.
      play: () => {
        if (this.runtime.controller.isListeningPaused) {
          this.resumeThePerformance();
        }
      },
      pause: () => {
        if (this.runtime.controller.isListening) {
          this.holdThePerformance();
        }
      },
      stop: () => {
        this.stopEverything();
      },
      placeNow: () => this.runtime.controller.performancePlace,
      seekTo: (positionMs) => {
        this.runtime.controller.movePerformanceTo(positionMs);
        // A held one moved says so here; a playing one says so as it starts.
        this.showThePerformance();
      },
      // Through the shelf whatever the playback goes on to: a key for the next
      // piece is pressed to hear another piece, and one that did nothing
      // while the button said "only this piece" would seem broken.
      next: this.runtime.scores.isEmpty ? null : () => void this.goOnToAnotherPiece(1),
      previous: this.runtime.scores.isEmpty ? null : () => void this.goOnToAnotherPiece(-1),
    });
  }

  /**
   * Whether there is anything for Stop to stop.
   *
   * Asked of all three things it can end rather than of the session alone: a
   * greyed-out Stop while a performance plays says the button is not for
   * this, which was never true - it was only ever not wired to it.
   */
  private describeStopping(): void {
    this.el.focusStop.disabled = !this.anythingToStop;
  }

  /**
   * Whether there is anything going that Stop would end.
   *
   * Asked in one place because two things ask it: the button, which greys
   * itself out when there is not, and the key beside it, which has to choose
   * between stopping and rewinding. Kept apart they would answer differently
   * the first time a phase was added to one and not the other - and a look is
   * exactly such a phase, which the desk's Stop knew about and the music's did
   * not.
   */
  private get anythingToStop(): boolean {
    const status = this.runtime.controller.session?.status;
    return (
      status === 'running' ||
      status === 'counting-in' ||
      status === 'paused' ||
      this.isPreviewing ||
      this.runtime.controller.isListening ||
      this.runtime.controller.isListeningPaused ||
      this.runtime.controller.replaying ||
      this.openingToPlay
    );
  }

  private populateSelects(): void {
    fillSelect(
      this.el.preset,
      this.runtime.presets.list().map((preset) => ({ value: preset.id, label: preset.label })),
      this.runtime.controller.settings.presetId,
    );
    fillSelect(
      this.el.rhythm,
      this.runtime.rhythms
        .list()
        .map((profile) => ({ value: profile.id, label: profile.label })),
      this.runtime.controller.settings.rhythmProfileId,
    );
    fillSelect(
      this.el.click,
      CLICK_PATTERNS.map((pattern) => ({ value: pattern, label: CLICK_LABELS[pattern] })),
      this.runtime.controller.settings.clickPattern,
    );
    fillSelect(
      this.el.clickNotes,
      CLICK_NOTES_OF.map((whose) => ({ value: whose, label: CLICK_NOTES_LABELS[whose] })),
      this.runtime.controller.settings.clickNotesOf,
    );
    fillSelect(
      this.el.dropout,
      CLICK_WHEN_CHOICES.map((choice) => ({ value: choice, label: CLICK_WHEN_LABELS[choice] })),
      this.runtime.controller.settings.clickWhen,
    );
    fillSelect(
      this.el.rhythmRuler,
      RULER_DIVISIONS.map((choice) => ({ value: choice, label: RULER_LABELS[choice] })),
      this.runtime.controller.settings.rhythmRuler,
    );
    // "Never" belongs to the length rather than to the when: nought bars is
    // no count-in, and two answers for one thing would let them disagree.
    fillSelect(
      this.el.clickSilences,
      CLICK_SILENCES.map((choice) => ({ value: choice, label: CLICK_SILENCE_LABELS[choice] })),
      this.runtime.controller.settings.clickSilences,
    );
    fillSelect(
      this.el.countInRun,
      (['once', 'every'] as const).map((choice) => ({
        value: choice,
        label: COUNT_IN_RUN_LABELS[choice],
      })),
      this.runtime.controller.settings.countInRun,
    );
    fillSelect(
      this.el.countInPlayback,
      COUNT_IN_WHEN.map((choice) => ({ value: choice, label: COUNT_IN_RUN_LABELS[choice] })),
      this.runtime.controller.settings.countInPlayback,
    );
    fillSelect(
      this.el.pageTurns,
      PAGE_TURNS.map((choice) => ({ value: choice, label: PAGE_TURN_LABELS[choice] })),
      this.runtime.controller.settings.pageTurns,
    );
    fillSelect(
      this.el.whatOpens,
      WHAT_OPENS.map((choice) => ({ value: choice, label: OPENING_LABELS[choice] })),
      this.runtime.controller.settings.whatOpens,
    );
    fillSelect(
      this.el.metronomeTap,
      METRONOME_TAPS.map((choice) => ({ value: choice, label: METRONOME_TAP_LABELS[choice] })),
      this.runtime.controller.settings.metronomeTap,
    );
    for (const select of [this.el.restEvery, this.el.restEverySettings]) {
      fillSelect(
        select,
        REST_INTERVALS.map((choice) => ({ ...choice })),
        String(this.runtime.controller.settings.restEveryMinutes),
      );
    }
    fillSelect(
      this.el.theme,
      THEMES.map((choice) => ({ value: choice, label: THEME_LABELS[choice] })),
      this.runtime.controller.settings.theme,
    );
    fillSelect(
      this.el.darkSystemTheme,
      DARK_SYSTEM_THEMES.map((choice) => ({ value: choice, label: THEME_LABELS[choice] })),
      this.runtime.controller.settings.darkSystemTheme,
    );
    fillSelect(
      this.el.showPlayed,
      PLAYED_NOTE_DISPLAYS.map((choice) => ({ value: choice, label: PLAYED_NOTE_LABELS[choice] })),
      this.runtime.controller.settings.playedNotes,
    );
    fillSelect(
      this.el.readAhead,
      READ_AHEAD_CHOICES.map((choice) => ({ value: choice.value, label: choice.label })),
      readAheadValue(this.runtime.controller.settings.readAheadSteps),
    );
    fillSelect(
      this.el.key,
      COMMON_KEYS.map((key) => ({ value: keyValue(key), label: key.name })),
      keyValue(this.runtime.controller.settings.key),
    );
    fillSelect(
      this.el.timeSignature,
      TIME_SIGNATURES.map((value) => ({ value, label: value })),
      this.runtime.controller.settings.timeSignature.toString(),
    );
  }

  private bindControls(): void {
    const { controller } = this.runtime;

    this.listen(this.el.scoreFile, 'change', () => {
      void this.openChosenScore();
    });

    this.listen(this.el.preset, 'change', () => {
      if (this.el.preset.value === DRAWN) {
        return;
      }
      controller.updateSettings({ presetId: this.el.preset.value });
      this.syncControlsFromSettings();
      void this.reload(true);
    });

    this.listen(this.el.rhythm, 'change', () => {
      controller.updateSettings({ rhythmProfileId: this.el.rhythm.value });
      this.syncControlsFromSettings();
      void this.reload(true);
    });

    this.listen(this.el.click, 'change', () => {
      const pattern = this.el.click.value as ClickPattern;
      controller.updateSettings({ clickPattern: pattern });
      // And the piece keeps it. Choosing here is the only way this setting
      // ever moves, so it is the only place that has to remember.
      void this.letTheScoreKeepTheClick(pattern);
      this.syncControlsFromSettings();
    });

    this.listen(this.el.clickNotes, 'change', () => {
      controller.updateSettings({ clickNotesOf: readClickNotesOf(this.el.clickNotes.value) });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.dropout, 'change', () => {
      controller.updateSettings({ clickWhen: readClickWhen(this.el.dropout.value) });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.key, 'change', () => {
      if (this.el.key.value === DRAWN) {
        return;
      }
      controller.updateSettings({ key: parseKeyValue(this.el.key.value) });
      void this.reload(true);
    });

    this.listen(this.el.timeSignature, 'change', () => {
      if (this.el.timeSignature.value === DRAWN) {
        return;
      }
      controller.updateSettings({
        timeSignature: TimeSignature.parse(this.el.timeSignature.value),
      });
      void this.reload(true);
    });

    this.listen(this.el.measures, 'input', () => {
      this.el.measuresValue.value = this.el.measures.value;
    });

    this.listen(this.el.measures, 'change', () => {
      this.applyMeasures(Number.parseInt(this.el.measures.value, 10));
    });

    // Typing a number reaches lengths that are tedious to drag to.
    this.listen(this.el.measuresValue, 'change', () => {
      this.applyMeasures(Number.parseInt(this.el.measuresValue.value, 10));
    });

    this.listen(this.el.tempo, 'input', () => {
      this.el.tempoValue.value = this.el.tempo.value;
    });

    this.listen(this.el.tempo, 'change', () => {
      controller.setTempoBpm(Number.parseInt(this.el.tempo.value, 10));
      // Same seed: identical notes, only the printed tempo mark changes.
      void this.reload(false);
    });

    // One pair of boxes now, where there were two: the desk had its own and
    // the reader was only ever in one place.
    for (const [from, to] of [[this.el.focusFrom, this.el.focusTo]] as const) {
      for (const input of [from, to]) {
        this.listen(input, 'change', () => {
          controller.updateSettings({
            rangeFromBar: barValue(from),
            rangeToBar: barValue(to),
          });
          // No re-engraving: a passage says where the run begins and ends,
          // and the notes on the page are the same notes either way.
          this.syncControlsFromSettings();
        });
      }
    }

    this.listen(this.el.focusWhole, 'click', () => {
      controller.updateSettings({ rangeFromBar: null, rangeToBar: null });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.focusSketch, 'click', () => {
      const onThePage = this.theSketchOfThePage();
      if (onThePage !== null) {
        this.showTheSketch(onThePage.sketch.id);
        return;
      }
      // A take's page: the sketch begins in the bars the page was written
      // in, so from now on the page is the sketch's, written again from it
      // when the editor shuts.
      const takeId = this.theTakeOfThePage();
      const exercise = this.runtime.controller.openedExercise;
      const sketch = takeId === null ? null : this.beginASketchOf(takeId);
      if (sketch !== null && exercise !== null) {
        this.theSketchOnThePage = { sketch, exercise };
        this.showThePencilBesideThePills();
      }
    });
    this.listen(this.el.focusRoll, 'click', () => {
      this.showTheScoreRoll();
    });

    this.listen(this.el.drill, 'click', () => {
      const passage = controller.drillWorstPassage();
      if (passage === null) {
        this.el.drill.hidden = true;
        return;
      }
      this.syncControlsFromSettings();
      void this.reload(false);
    });

    this.listen(this.el.verdictFresh, 'click', () => {
      void this.reload(true);
    });

    /*
     * A tap anywhere on the verdict puts it away.
     *
     * The whole panel and not a close button in its corner: it is over the
     * music, the reader has read it, and the gesture for "yes, I have seen
     * that" is to touch it. The one thing inside it that means something
     * else is the drill button, so that stops the tap before it arrives.
     */
    this.listen(this.el.scoreVerdict, 'click', (event) => {
      if (event.target instanceof Element && event.target.closest('button') !== null) {
        return;
      }
      this.showVerdict(false);
    });

    this.listen(this.el.focusBare, 'click', () => {
      this.showOnlyThePage(this.doc.body.dataset['bare'] !== 'true');
    });

    this.listen(this.el.focusRepeat, 'click', () => {
      controller.updateSettings({ repeatRange: !controller.settings.repeatRange });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.countIn, 'input', () => {
      this.el.countInValue.value = this.el.countIn.value;
      controller.updateSettings({ countInBars: Number.parseInt(this.el.countIn.value, 10) });
      // "Only the count-in" means something different once there is not one.
      this.describeDropout();
    });

    this.listen(this.el.latency, 'input', () => {
      controller.updateSettings({
        inputLatencyMs: Number.parseInt(this.el.latency.value, 10),
      });
      this.describeLatency();
    });

    this.listen(this.el.latencyTest, 'click', () => {
      void this.loadCalibration();
    });

    this.listen(this.el.latencyMeasure, 'click', () => {
      const wanted = this.latencyWouldBecome();
      if (wanted === null) {
        return;
      }
      controller.updateSettings({ inputLatencyMs: wanted });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.tolerance, 'input', () => {
      this.el.toleranceValue.value = this.el.tolerance.value;
      controller.updateSettings({
        matchToleranceMs: Number.parseInt(this.el.tolerance.value, 10),
      });
    });

    this.listen(this.el.zoom, 'input', () => {
      this.el.zoomValue.value = this.el.zoom.value;
    });

    this.listen(this.el.zoom, 'change', () => {
      // On change, not on input: every step of the slider re-engraves the page.
      controller.updateSettings({ zoom: Number.parseInt(this.el.zoom.value, 10) / 100 });
    });

    this.listen(this.el.ladderDown, 'click', () => {
      this.moveLadder(-1);
    });

    this.listen(this.el.ladderUp, 'click', () => {
      this.moveLadder(1);
    });

    this.layTheGrades();

    this.listen(this.el.theme, 'change', () => {
      const theme = this.el.theme.value as Theme;
      controller.updateSettings({ theme: THEMES.includes(theme) ? theme : 'system' });
      this.syncControlsFromSettings();
      this.paintInTheColoursNow();
    });

    this.listen(this.el.darkSystemTheme, 'change', () => {
      const theme = this.el.darkSystemTheme.value as DarkSystemTheme;
      controller.updateSettings({
        darkSystemTheme: DARK_SYSTEM_THEMES.includes(theme) ? theme : 'dark',
      });
      this.syncControlsFromSettings();
      this.paintInTheColoursNow();
    });

    this.listen(this.el.showPlayed, 'change', () => {
      controller.updateSettings({ playedNotes: readPlayedNotes(this.el.showPlayed.value) });
      // Everything that shows this setting has to be told: the switch in the
      // fullscreen drawer is the same value seen from the stand, and two
      // controls that disagree about one setting is worse than either.
      this.syncControlsFromSettings();
    });

    this.listen(this.el.readAhead, 'change', () => {
      controller.updateSettings({ readAheadSteps: parseReadAhead(this.el.readAhead.value) });
      this.el.readAheadDescription.textContent = READ_AHEAD_DESCRIPTIONS[this.el.readAhead.value] ?? '';
      // The veil is also a mode square, and one answer read in two places has
      // to be written to both: set here and left alone, the square went on
      // saying the opposite of what the setting said.
      this.syncControlsFromSettings();
    });

    this.listen(this.el.cursorListening, 'change', () => {
      controller.updateSettings({ cursorWhileListening: this.el.cursorListening.checked });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.cursorRest, 'change', () => {
      controller.updateSettings({ cursorAtRest: this.el.cursorRest.checked });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.sampleLoading, 'change', () => {
      this.applySampleLoading(readSampleLoading(this.el.sampleLoading.value));
    });

    // Two sliders for the metronome's loudness, one in its sheet and one
    // beside the notes' in Sound. Either one moved is the value, and the
    // other is drawn from it.
    for (const slider of [this.el.metronomeVolume, this.el.soundMetronomeVolume]) {
      this.listen(slider, 'input', () => {
        this.el.metronomeVolume.value = slider.value;
        this.applyVolumes(true);
      });
    }

    this.listen(this.el.instrumentVolume, 'input', () => {
      this.applyVolumes(true);
    });

    for (const place of this.theKnobs()) {
      this.listen(place.button, 'click', () => {
        const knob = place.knob;
        if (knob.isLearning) {
          knob.cancelLearning();
        } else if (knob.controller !== null) {
          // A bound knob's button gives it back, since teaching a second one
          // over the top would leave the reader unable to say which is in use.
          knob.forget();
        } else {
          // One knob learned at a time: a turn taken for both would teach
          // the other one a knob the reader never asked it to follow.
          for (const other of this.theKnobs()) {
            other.knob.cancelLearning();
          }
          knob.learn();
        }
        this.describeKnob(place);
      });
    }

    this.listen(this.el.playingAhead, 'change', () => {
      controller.updateSettings({
        playingAhead: this.el.playingAhead.value === 'moves-on' ? 'moves-on' : 'a-mistake',
      });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.immediateStart, 'change', () => {
      controller.updateSettings({ immediateStart: this.el.immediateStart.checked });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.whatOpens, 'change', () => {
      controller.updateSettings({ whatOpens: readWhatOpens(this.el.whatOpens.value) });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.metronomeTap, 'change', () => {
      controller.updateSettings({ metronomeTap: readMetronomeTap(this.el.metronomeTap.value) });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.passageSave, 'click', () => {
      const opened = controller.openedExercise;
      if (opened === null) {
        return;
      }
      // Whatever is set now, with an open end meaning the end of the piece:
      // what is kept is the stretch the reader is looking at.
      const last = Math.max(1, measureCount(opened));
      const fromBar = controller.settings.rangeFromBar ?? 1;
      const toBar = controller.settings.rangeToBar ?? last;
      const name = this.el.passageName.value.trim();
      void this.keepPassages([
        ...this.runtime.scores.passagesOf(opened.title),
        // Named by its bars where the reader did not name it: a list of
        // "bars 17-24" is still a list they can read.
        { name: name === '' ? `Bars ${fromBar}-${toBar}` : name, fromBar, toBar },
      ]).then(() => {
        this.el.passageName.value = '';
      });
    });

    this.listen(this.el.clickSilences, 'change', () => {
      const wanted = this.el.clickSilences.value as ClickSilence;
      controller.updateSettings({
        clickSilences: CLICK_SILENCES.includes(wanted) ? wanted : 'nothing',
      });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.countInRun, 'change', () => {
      controller.updateSettings({ countInRun: readCountIn(this.el.countInRun.value, 'every') });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.countInPlayback, 'change', () => {
      controller.updateSettings({
        countInPlayback: readCountIn(this.el.countInPlayback.value, 'never'),
      });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.readingsBest, 'change', () => {
      this.renderReadings();
    });

    this.listen(this.el.readingsThisPiece, 'change', () => {
      this.renderReadings();
    });

    this.listen(this.el.readingsThrough, 'change', () => {
      this.renderReadings();
    });

    this.listen(this.el.readingClose, 'click', () => {
      this.shutTheReading();
    });

    this.listen(this.el.readingRoll, 'click', () => {
      if (this.theReadingShowing !== null) {
        this.showTheReadingRoll(this.theReadingShowing);
      }
    });

    this.listen(this.el.readingReplay, 'click', () => {
      if (this.theReadingShowing !== null) {
        void this.replayTheReading(this.theReadingShowing);
      }
    });

    this.listen(this.el.readingDelete, 'click', () => {
      const reading = this.theReadingShowing;
      if (reading === null) {
        return;
      }
      void this.askToDelete(`Forget this reading of ${describeReading(reading)}?`).then((yes) => {
        if (!yes) {
          return;
        }
        this.runtime.history.remove(reading.key, reading.atMs);
        this.shutTheReading();
        this.renderReadings();
      });
    });

    this.listen(this.el.readingsClose, 'click', () => {
      this.el.sheetReadings.hidden = true;
    });

    this.listen(this.el.scoresSearch, 'input', () => {
      this.renderScores();
    });

    this.listen(this.el.scoresOrder, 'change', () => {
      // Kept with the rest of what the reader has chosen. A shelf that went
      // back to "recent" every evening is a control nobody uses twice. His:
      // "цей фільтр має запамятовуватись".
      this.runtime.controller.updateSettings({
        scoreOrder: this.el.scoresOrder.value as ScoreOrder,
      });
      this.renderScores();
    });

    this.listen(this.el.drillStart, 'click', () => {
      void this.startThePlan();
    });

    this.listen(this.el.drillPill, 'click', () => {
      this.showTheSheet(this.el.sheetDrill);
    });

    // On the list rather than on each step: the list is drawn again whenever
    // the plan moves, and a listener on each step drawn would be one more
    // every time.
    this.listen(this.el.drillSteps, 'click', (event) => {
      const back = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-step]') : null;
      if (back === null) {
        return;
      }
      controller.goBackInTheDrill(Number(back.dataset['step']));
      this.syncControlsFromSettings();
      this.el.sheetDrill.hidden = true;
    });

    this.listen(this.el.drillClose, 'click', () => {
      this.el.sheetDrill.hidden = true;
    });

    this.listen(this.el.drillStop, 'click', () => {
      void this.stopThePlan();
    });

    this.listen(this.el.restTake, 'click', () => {
      this.takeTheRest();
    });

    this.listen(this.el.restLater, 'click', () => {
      controller.restSkipped();
      this.hideTheRest();
    });

    // One handler for the three, because they are one answer with a number
    // on it. The number is on the button, where the reader can see what they
    // are choosing rather than being told afterwards.
    for (const button of this.el.restSnooze.querySelectorAll('button')) {
      this.listen(button, 'click', () => {
        const minutes = Number(button.dataset['minutes'] ?? '0');
        controller.restPutOff(Math.max(0, minutes) * 60_000);
        this.hideTheRest();
      });
    }

    for (const select of [this.el.restEvery, this.el.restEverySettings]) {
      this.listen(select, 'change', () => {
        const minutes = Number(select.value);
        controller.updateSettings({ restEveryMinutes: minutes });
        this.syncControlsFromSettings();
        // Turned off while the card is up, the card has nothing left to say.
        if (minutes === 0) {
          controller.restTaken();
          this.hideTheRest();
        }
      });
    }

    this.listen(this.el.rulerStrength, 'input', () => {
      controller.updateSettings({ rulerStrength: Number(this.el.rulerStrength.value) / 100 });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.rulerCursor, 'change', () => {
      controller.updateSettings({ rulerCursor: this.el.rulerCursor.checked });
      this.syncControlsFromSettings();
      if (!this.el.rulerCursor.checked) {
        this.forgetTheBeats();
      }
    });

    this.listen(this.el.rhythmRuler, 'change', () => {
      controller.updateSettings({ rhythmRuler: readRuler(this.el.rhythmRuler.value) });
      this.syncControlsFromSettings();
      // The page is engraved differently for a ruled score - room is made in
      // every bar for the beats to stand at even distances - so this is one
      // of the few settings that has to be drawn again to be seen.
      void this.reload(false);
    });

    this.listen(this.el.hearOtherHand, 'change', () => {
      controller.updateSettings({ hearTheOtherHand: this.el.hearOtherHand.checked });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.rushingCounts, 'change', () => {
      controller.updateSettings({ rushingCounts: this.el.rushingCounts.checked });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.markListening, 'change', () => {
      controller.updateSettings({ markWhileListening: this.el.markListening.checked });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.showPlaybackNotes, 'change', () => {
      controller.updateSettings({ showPlaybackNotes: this.el.showPlaybackNotes.checked });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.pageTurns, 'change', () => {
      controller.updateSettings({ pageTurns: readPageTurns(this.el.pageTurns.value) });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.scorePageBack, 'click', () => {
      this.runtime.renderer.turnPages(-1);
      this.showThePages();
    });

    this.listen(this.el.scorePageOn, 'click', () => {
      this.runtime.renderer.turnPages(1);
      this.showThePages();
    });

    this.listen(this.el.dimUnplayed, 'change', () => {
      controller.updateSettings({ dimUnplayed: this.el.dimUnplayed.checked });
    });

    this.listen(this.el.pitchClass, 'change', () => {
      controller.updateSettings({ pitchClassOnly: this.el.pitchClass.checked });
    });

    this.listen(this.el.audioFeedback, 'change', () => {
      this.applyInputSettings(true);
    });

    this.listen(this.el.computerKeyboard, 'change', () => {
      this.applyInputSettings(true);
    });

    this.listen(this.el.focusKeep, 'click', () => {
      this.keepTake();
    });

    this.listen(this.el.focusRecordEye, 'click', () => {
      const open = this.el.focusRecord.dataset['open'] !== 'true';
      this.el.focusRecord.dataset['open'] = String(open);
      this.el.focusRecordEye.setAttribute('aria-expanded', String(open));
      const label = open ? 'Hide what can be kept' : 'Show what can be kept';
      this.el.focusRecordEye.title = label;
      this.el.focusRecordEye.setAttribute('aria-label', label);
    });

    this.listen(this.el.scoresClear, 'click', () => {
      const kept = this.runtime.scores.list().length;
      void this.askToTypeIt(`Delete ${countOf(kept, 'kept score')}?`).then((yes) => {
        if (yes) {
          void this.runtime.scores.forget().then(() => this.renderScores());
        }
      });
    });

    this.listen(this.el.takesClear, 'click', () => {
      const kept = this.runtime.takes.list().length;
      void this.askToTypeIt(`Delete ${countOf(kept, 'kept take')}?`).then((yes) => {
        if (yes) {
          this.runtime.takes.forget();
          this.renderTakes();
        }
      });
    });

    this.bindSheets();
    this.bindBackup();
    this.bindTakeTransport();

    this.subscriptions.push(
      // Everything that was played is filed, whether or not the reader
      // reached for a button - see `TakeOnOffer`.
      this.runtime.takeOnOffer.events.on('filed', () => {
        this.renderTakes();
      }),
    );

    this.listen(this.el.preview, 'input', () => {
      this.el.previewValue.value = this.el.preview.value;
      controller.updateSettings({ previewSeconds: Number.parseInt(this.el.preview.value, 10) });
      // Asking for a look while staring at the page would be asking for
      // nothing, so the page goes back under until the look is taken.
      this.applyScoreCover();
    });

    // The hint is the thing to press. A browser will only start audio inside a
    // gesture it believes in, and the page cannot manufacture one - so rather
    // than ask the reader to tap somewhere and hope, it asks them to tap the
    // words that are asking.
    this.listen(this.el.scoreListening, 'click', () => {
      this.runtime.audio.wake();
    });
    // And the words stop asking the moment the device is awake, however it was
    // woken: a tap anywhere does it, and nothing else on the page changes to
    // say so.
    this.subscriptions.push(
      this.runtime.audio.onChange(() => {
        this.showTheListening();
      }),
    );

    this.bindSpaceBar();

    this.listen(this.el.connectMidi, 'click', () => {
      void this.runtime.webMidi.connect();
    });

    this.listen(this.el.midiInput, 'change', () => {
      const value = this.el.midiInput.value;
      this.runtime.webMidi.selectInput(value === '' ? null : value);
    });

    if (this.el.computerKeyboard.checked) {
      this.runtime.computerKeyboard.enable();
    }
  }

  /**
   * Fullscreen reading, with a pill of controls where a hand can reach it.
   *
   * The pill is not a second copy of the app: it exposes only what is needed
   * once the page is gone - start or pause, stop, next exercise, and the way
   * out - and it drives exactly the same controller calls as the main buttons.
   */
  /**
   * Gives the speed control its second home.
   *
   * The transport row holds five buttons on a phone and no more, and the two
   * that go are the ones reached for least often. Moved rather than copied:
   * a second pair of buttons in the drawer would be a second control
   * answering the same question, and they would disagree the moment one of
   * them was wired up wrong.
   */
  /**
   * Watches for the network coming and going.
   *
   * On the window, because that is where the browser says it. Read once at
   * the start as well: a page opened with no network has had no event to
   * hear, and would sit there claiming to be online.
   */
  private bindTheNetwork(): void {
    const view = this.doc.defaultView;
    this.showTheNetwork();
    if (view === null) {
      return;
    }
    const changed = (): void => {
      this.showTheNetwork();
    };
    view.addEventListener('online', changed);
    view.addEventListener('offline', changed);
    this.subscriptions.push(() => {
      view.removeEventListener('online', changed);
      view.removeEventListener('offline', changed);
    });
  }

  /**
   * Binds the sections of the settings sheet.
   *
   * The panel carries which one is showing and the stylesheet does the rest,
   * so this is only "which question is being answered" - and the tabs read
   * their own answer off the markup rather than from a list kept here, which
   * would be a second copy of the sections to keep in step.
   *
   * A tab says which pane it *chooses*, which is not the same claim as being
   * one. They used to say `data-pane`, the word a group of controls uses of
   * itself, and so the stylesheet's "show this pane" caught the tab of the
   * chosen section and laid it out as a pane: its mark on one line and its
   * name below. One attribute cannot answer two questions.
   */
  private bindTheSections(): void {
    const tabs = [...this.el.settingsSections.querySelectorAll('button[data-chooses]')];
    for (const tab of tabs) {
      if (tab instanceof HTMLElement) {
        this.listen(tab, 'click', () => {
          this.showTheSettingsPane(tab.dataset['chooses'] ?? '');
        });
      }
    }
    this.showTheSettingsPane(tabs[0]?.getAttribute('data-chooses') ?? '');
    this.bindTheSettingsSearch();

    // One panel and two doors to it. A second set of the same controls would
    // be two editors of one setting, disagreeing the moment one is wired up
    // wrong - so this opens the panel the pill opens. Over the settings, not
    // instead of them: closing the metronome goes back to where it was opened.
    this.listen(this.el.settingsMetronome, 'click', () => {
      this.showTheSheet(this.el.sheetMetronome);
    });
  }

  /**
   * The modes, as squares in front of the reader.
   *
   * His shape and his reasons: four lines apart in a drawer are four things
   * to remember, and four squares are a state you can see. Each square is the
   * setting it names and nothing besides - there is one answer to "am I
   * playing survival", and this is another way of reading and writing it,
   * not a second copy of it.
   */
  private bindTheModes(): void {
    // Opening it is the list every other sheet is in. It was bound here
    // alone once, and was then the only sheet a tap outside did not close.
    const cards = [...this.el.modesGrid.querySelectorAll('button[data-mode]')];
    this.listen(this.el.modesClose, 'click', () => {
      this.el.sheetModes.hidden = true;
    });
    for (const button of this.el.frameChoices) {
      const frame = frameOfTheButton(button);
      if (frame === null) {
        continue;
      }
      // Said once, from the same tables the corner and a reading's row read.
      button.querySelector('path')?.setAttribute('d', FRAME_ICON[frame] ?? '');
      const name = button.querySelector('.frame__name');
      if (name !== null) {
        name.textContent = FRAME_NAME[frame] ?? '';
      }
      const what = button.querySelector('.frame__what');
      if (what !== null) {
        what.textContent = FRAME_WHAT[frame] ?? '';
      }
      this.listen(button, 'click', () => {
        const controller = this.runtime.controller;
        controller.updateSettings(settingsForFrame(frame, controller.settings));
        this.syncControlsFromSettings();
      });
    }
    for (const card of cards) {
      if (!(card instanceof HTMLButtonElement)) {
        continue;
      }
      this.listen(card, 'click', () => {
        const on = card.getAttribute('aria-pressed') !== 'true';
        const controller = this.runtime.controller;
        controller.updateSettings(settingsForMode(card.dataset['mode'] ?? '', on, controller.settings));
        this.syncControlsFromSettings();
      });
    }
  }

  /**
   * Draws each square as on or off.
   *
   * Nothing is out of reach any more. Two of these empty each other - "one
   * wrong note ends the run" says nothing while "any note counts" - and the
   * answer used to be that the second square refused and explained itself.
   * His, and better: both answer, and turning one on turns the other off,
   * which the reader watches happen.
   */
  /**
   * Whether the page is listening for the chord that would begin a run.
   *
   * Its own method because two different things change the answer - a run
   * starting or ending, and the setting itself - and a mark that only follows
   * one of them is a mark that is wrong half the time.
   */
  private showTheListening(): void {
    const waiting = this.runtime.controller.waitingForTheOpening;
    // Where the machine plays, the same place says the opposite: the frame
    // is Listen, and playing starts nothing. Still, so as not to say "live".
    const refused = this.runtime.controller.openingRefusedWhileTheMachinePlays;
    this.el.scoreListening.hidden = !waiting && !refused;
    if (refused) {
      this.el.scoreListening.dataset['refused'] = 'true';
      this.el.scoreListeningText.textContent = 'Listening';
      this.el.scoreListening.title = 'Listen is chosen: playing starts nothing.';
      return;
    }
    delete this.el.scoreListening.dataset['refused'];
    this.el.scoreListening.removeAttribute('title');
    if (!waiting) {
      return;
    }
    // And whether the device can answer at once. A browser will not start
    // audio outside a user gesture and a key on a piano is not one, so a page
    // nobody has touched will be a moment late with its first click however
    // early the reader plays - and the honest thing is to ask for the one tap
    // rather than to seem slow. It is asked once a session and never again.
    // Only where a run begun now would actually wait on the device. A frame
    // that keeps time waits for the pulse's first tick and a sleeping device
    // never gives one; a frame that waits for the reader, with no count and no
    // click, waits on nothing at all - and asking that reader for a tap is
    // asking for nothing.
    const awake =
      this.runtime.audio.awake() || !this.runtime.controller.needsTheAudioClock;
    this.el.scoreListening.dataset['awake'] = String(awake);
    this.el.scoreListeningText.textContent = awake ? 'Play to start' : 'Tap once, then play';
  }

  private showTheModes(): void {
    const settings = this.runtime.controller.settings;
    // One of them lit at most: the frame chosen, where it is not the plain
    // one, which has no button and is what none lit means.
    const chosen =
      this.el.frameChoices.find((button) => frameOfTheButton(button) === settings.modeId) ?? null;
    for (const button of this.el.frameChoices) {
      button.setAttribute('aria-pressed', String(button === chosen));
    }
    // The frame first, where it is not the plain one: those are exactly the
    // cases where Start does something other than what a reader expects,
    // which is what a corner is for. Left unsaid, a reader could sit down to
    // practise and have the machine play at them.
    // And on the button that acts on it. The reader presses Start without
    // looking; what it will start is the one thing it may need to say, and
    // only where the answer is not the plain one.
    this.el.focusPlayFrame.replaceChildren();
    const badge = chosen?.querySelector('svg') ?? null;
    if (badge !== null) {
      this.el.focusPlayFrame.append(badge.cloneNode(true));
    }
    this.el.focusPlayFrame.hidden = badge === null;
    for (const card of this.el.modesGrid.querySelectorAll('button[data-mode]')) {
      if (!(card instanceof HTMLButtonElement)) {
        continue;
      }
      const mode = card.dataset['mode'] ?? '';
      card.setAttribute('aria-pressed', String(modeIsOn(mode, settings)));
    }
    // The corner says what the page is showing. A run shown again was played
    // with what it was played with, whatever has been chosen since, and the
    // page is that run's until it is over.
    this.showWhichModesAreOn(
      this.cardsOf(
        this.runtime.controller.replayPlayedWith ?? { modeId: settings.modeId, modes: modesOn(settings) },
      ),
    );
  }

  /**
   * The cards of the Modes sheet a run is played with: its frame, where it is
   * not the plain one, and then the squares that are on, in the sheet's order.
   */
  private cardsOf(playedWith: PlayedWith): HTMLButtonElement[] {
    const cards: HTMLButtonElement[] = [];
    const frame = this.el.frameChoices.find((button) => frameOfTheButton(button) === playedWith.modeId);
    if (frame !== undefined) {
      cards.push(frame);
    }
    for (const card of this.el.modesGrid.querySelectorAll('button[data-mode]')) {
      if (card instanceof HTMLButtonElement && playedWith.modes.includes(card.dataset['mode'] ?? '')) {
        cards.push(card);
      }
    }
    return cards;
  }

  /**
   * Which modes are on, in the corner where the day's clock stands.
   *
   * His, and asked for there: the sheet that sets them is shut by the time
   * the reader is at the keys, and a mode turned on three pieces ago is
   * otherwise invisible until it does something. Each mark is the square's
   * own icon, its own colour and its own name, cloned rather than drawn
   * again - a second drawing of a mode is a second answer to one question,
   * and the two disagree the first time either is changed.
   *
   * Redrawn only when the set has actually changed: this runs on every
   * settings sync, which is most of what the view does.
   */
  private showWhichModesAreOn(cards: readonly HTMLButtonElement[]): void {
    const named = (card: HTMLButtonElement): string =>
      card.dataset['mode'] ?? card.dataset['frame'] ?? '';

    const shape = cards.map(named).join(' ');
    if (shape === this.modesShown) {
      return;
    }
    this.modesShown = shape;
    this.el.scoreModes.replaceChildren();
    const names: string[] = [];
    for (const card of cards) {
      const mode = named(card);
      const name =
        card.querySelector('.mode-card__name')?.textContent ??
        card.querySelector('.frame__name')?.textContent ??
        mode;
      const mark = this.doc.createElement('span');
      mark.className = `score__mode score__mode--${mode}`;
      mark.dataset['mode'] = mode;
      mark.title = name;
      const icon = card.querySelector('svg');
      if (icon !== null) {
        mark.append(icon.cloneNode(true));
      }
      this.el.scoreModes.append(mark);
      names.push(name);
    }
    // Nothing on is nothing to say, rather than an empty strip of furniture.
    this.el.scoreModes.hidden = names.length === 0;
    this.el.scoreModes.setAttribute('aria-label', `Modes on: ${names.join(', ')}`);
  }

  /**
   * Dims every control another setting has emptied, and says why.
   *
   * His, and the same rule the squares follow: a switch that does nothing
   * whatever it is set to should not be standing at full strength. The
   * dimming is the stylesheet's; what is said here is only which controls
   * have nothing to say, and the reason goes on the label so a pointer can
   * ask for it.
   *
   * The *label* and not the input: a checkbox dimmed on its own leaves its
   * own sentence bright beside it, which is the half a reader actually reads.
   */
  private dimWhatHasNothingToSay(): void {
    const settings = this.runtime.controller.settings;
    const keepsTime = this.runtime.controller.survivalKeepsTime;
    const opened = this.runtime.controller.openedExercise !== null;
    const controls: readonly (readonly [IdleControl, HTMLElement])[] = [
      ['preset', this.el.preset],
      ['rhythm', this.el.rhythm],
      ['key', this.el.key],
      ['time-signature', this.el.timeSignature],
      ['measures', this.el.measures],
      ['playing-ahead', this.el.playingAhead],
      ['hear-other-hand', this.el.hearOtherHand],
      ['rushing-counts', this.el.rushingCounts],
      ['click-when', this.el.dropout],
      ['dark-system-theme', this.el.darkSystemTheme],
    ];
    for (const [name, control] of controls) {
      const carrier = control.closest('label, .control-group');
      if (!(carrier instanceof HTMLElement)) {
        continue;
      }
      const why = whyItIsIdle(name, settings, keepsTime, opened);
      if (why === null) {
        delete carrier.dataset['idle'];
        carrier.removeAttribute('title');
      } else {
        carrier.dataset['idle'] = 'true';
        carrier.title = why;
      }
    }
  }

  /**
   * Puts where a run would begin back at the top.
   *
   * A place can be set anywhere by holding a finger on a bar, so the way back
   * must not be "find bar one and hold a finger on that". Lifted out of its
   * button because the key that stops a run does this when there is no run to
   * stop, and two copies of it would drift.
   */
  private rewindToTheStart(): void {
    const { controller } = this.runtime;
    if (this.isPlaying) {
      controller.stop();
    }
    controller.beginAtTheStart();
    // The place is gone, so no bar is standing ready to open a passage.
    this.placedOnBar = null;
    controller.cursorToStart();
    this.showPassageMarkers();
  }

  private bindNarrowLayout(): void {
    const view = this.doc.defaultView;
    if (view === null || typeof view.matchMedia !== 'function') {
      return;
    }
    const narrow = view.matchMedia('(max-width: 560px)');
    // In the row over a replay, however narrow: the drawer goes with the rest
    // of the bar then, and how fast to watch is the replay's own question.
    this.placeTheSpeed = (): void => {
      if (narrow.matches && this.replayRoll === null) {
        this.el.focusDrawer.prepend(this.el.focusSpeed);
      } else {
        this.el.focusRow.insertBefore(this.el.focusSpeed, this.el.focusMetronome);
      }
    };
    const place = (): void => {
      this.placeTheSpeed();
    };
    place();
    narrow.addEventListener('change', place);
    this.subscriptions.push(() => narrow.removeEventListener('change', place));
  }

  private bindTransport(): void {
    const { controller } = this.runtime;
    this.bindNarrowLayout();
    this.bindTheNetwork();
    this.bindTheSections();
    this.bindTheModes();

    this.listen(this.el.focusPlay, 'click', () => {
      this.togglePlayback();
    });

    this.listen(this.el.focusStop, 'click', () => {
      this.stopEverything();
    });

    this.listen(this.el.focusKeyboard, 'click', () => {
      // On round the three, in the order they are listed.
      const at = KEYS_SHOWN.indexOf(controller.settings.keysShown);
      controller.updateSettings({ keysShown: KEYS_SHOWN[(at + 1) % KEYS_SHOWN.length] ?? 'falling-notes' });
      this.syncControlsFromSettings();
    });

    // Hidden at once, the column being let go of; let fall again, it is
    // painted with the next frame of music, as the notes are.
    this.listen(this.replayKeyboard.pedalToggle, 'click', () => {
      controller.updateSettings({ pedalFalls: !controller.settings.pedalFalls });
      this.syncControlsFromSettings();
    });

    this.bindTheKeysOnTheScreen();

    this.listen(this.replayKeyboard.sliderToggle, 'click', () => {
      controller.updateSettings({ sliderShown: !controller.settings.sliderShown });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.focusReplay, 'click', () => {
      this.replayRun();
    });

    this.listen(this.el.focusRewind, 'click', () => {
      this.rewindToTheStart();
    });

    this.listen(this.el.repeatNumbers, 'change', () => {
      controller.updateSettings({ showRepeatNumbers: this.el.repeatNumbers.checked });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.traceTheStart, 'change', () => {
      controller.updateSettings({ traceTheStart: this.el.traceTheStart.checked });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.driveSync, 'click', () => {
      void this.syncWithTheDrive();
    });

    this.el.driveCode.hidden = !this.runtime.codeSignIn.available;
    this.listen(this.el.driveCode, 'click', () => {
      void this.signInWithACode();
    });

    this.listen(this.el.scoreSync, 'click', () => {
      void this.syncWithTheDrive();
    });

    this.listen(this.el.offerToSync, 'change', () => {
      controller.updateSettings({ offerToSync: this.el.offerToSync.checked });
      this.syncControlsFromSettings();
      this.offerToSync();
    });

    this.listen(this.el.pagedScore, 'change', () => {
      controller.updateSettings({ pagedScore: this.el.pagedScore.checked });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.focusSmaller, 'click', () => {
      this.nudgeZoom(-ZOOM_STEP_PERCENT);
    });

    this.listen(this.el.focusBigger, 'click', () => {
      this.nudgeZoom(ZOOM_STEP_PERCENT);
    });

    this.listen(this.el.focusHands, 'click', () => {
      controller.updateSettings({ handStaff: nextHand(controller.settings.handStaff) });
      this.syncControlsFromSettings();
    });

    this.subscriptions.push(
      // A switch beside a staff, pressed. The same setting the drawer's
      // button cycles, said as the two halves it is made of.
      this.runtime.renderer.onHandToggled((staffNumber) => {
        controller.updateSettings({
          handStaff: handsAfterToggling(controller.settings.handStaff, staffNumber),
        });
        this.syncControlsFromSettings();
      }),
    );

    this.listen(this.el.focusHandle, 'click', () => {
      this.setDrawerOpen(!this.isDrawerOpen);
    });

    this.bindDrawerDrag();

    // Held in free play, they step the click's tempo again and again: a bpm
    // at a time reaches any tempo, and a long way only by holding.
    const repeats = (): boolean => this.runtime.controller.playsFreely;
    this.holdToRepeat(this.el.focusSlower, () => this.nudgeTempo(-TEMPO_STEP_PERCENT), repeats);
    this.holdToRepeat(this.el.focusFaster, () => this.nudgeTempo(TEMPO_STEP_PERCENT), repeats);

    this.listen(this.el.scoresFresh, 'click', () => {
      // The sheet asks what to put on the stand, and this is the answer that
      // needs nothing kept - so it closes behind itself the way choosing a
      // score does.
      this.el.sheetScores.hidden = true;
      void this.reload(true);
    });
  }

  /**
   * Start, pause or resume, depending on where the run is.
   *
   * Shared by the pill and the space bar, so the two can never disagree about
   * what pressing "play" means.
   */
  private togglePlayback(): void {
    const { controller } = this.runtime;
    // A run being shown again has the transport until it is stopped.
    if (controller.replaying) {
      this.toggleTheReplay();
      return;
    }
    // His: Start replaces playback. In the listening frame there is no
    // session to ask about - the performance is the run - so the one button
    // hands over to the one that has always driven it.
    if (controller.machinePlays) {
      void this.toggleListening();
      return;
    }
    const status = controller.session?.status;

    if (status === 'running' || status === 'counting-in') {
      controller.pause();
      return;
    }
    if (status === 'paused') {
      controller.resume();
      return;
    }
    this.beginRun();
  }

  /**
   * Starts a run, after the look if one was asked for.
   *
   * The wait lives here rather than in the session for the same reason the
   * repeat does: the application layer has no timer, and a phase that only
   * shows a number and then gets out of the way is a view's business.
   */
  private beginRun(): void {
    this.showVerdict(false);
    this.cancelPreview();
    this.hasLooked = true;
    this.applyScoreCover();

    const seconds = this.runtime.controller.settings.previewSeconds;
    if (seconds <= 0) {
      this.runtime.controller.start();
      return;
    }

    let left = seconds;
    const show = (): void => {
      this.showCount(left);
    };
    show();
    this.previewTimer = setInterval(() => {
      left -= 1;
      if (left > 0) {
        show();
        return;
      }
      this.cancelPreview();
      this.runtime.controller.start();
    }, 1000);
    // After the timer exists, not before: the look is what makes this a
    // playing state and there is no session to read it off, so asking any
    // earlier gets the answer for a page with nothing happening on it. Stop
    // is asked the same question and for the same reason - it is how the
    // reader says they have seen enough, and a phase they cannot leave is a
    // trap.
    this.applyPlayingChrome();
    this.describeStopping();
  }

  /**
   * Reads it again from the top, in one press.
   *
   * Which is stop and then start, and deliberately nothing cleverer: the
   * same place, the same look, the same count-in the reader gets by pressing
   * the two buttons themselves. What it saves is the two presses - and a
   * passage gone wrong in its second bar is a passage to begin again rather
   * than one to sit through to the end.
   *
   * Rewind is left alone. That one puts the *place* back to the top and is
   * for between runs; this one begins the reading that is already going.
   * They are near enough to look like one button and far enough apart that
   * making them one would lose one of the two.
   */
  private replayRun(): void {
    // Over a replay, the replay again: a run begun here would take the page
    // from under the one being watched.
    if (this.replayRoll !== null) {
      this.replayFromTheTop();
      return;
    }
    this.stopEverything();
    this.beginRun();
  }

  /**
   * Keeps the page back until the reader has actually asked for their look.
   *
   * Without this the look enforces nothing: the score sits on screen from the
   * moment it is generated, so the unlimited staring happens *before* Start
   * and the countdown only delays the beginning. Covering it is what makes
   * the number the whole time the reader gets with the music.
   */
  private applyScoreCover(): void {
    const seconds = this.runtime.controller.settings.previewSeconds;
    const covered = seconds > 0 && !this.hasLooked;
    this.el.scoreCover.hidden = !covered;
    this.el.score.classList.toggle('is-covered', covered);
    this.el.scoreCoverText.textContent = covered
      ? `The music is face down. Press Start and you have ${seconds} second${seconds === 1 ? '' : 's'} with it before the run begins.`
      : '';
  }

  /**
   * The number in the middle of the page, or `null` to take it away.
   *
   * Both countdowns come through here - the look before a run and the count
   * the metronome beats in - because they are the same thing to a reader:
   * how long until they have to play. Said in two places they would be two
   * mechanisms, and the pill said them in the corner of an eye that is on
   * the music.
   */
  private showCount(count: number | null): void {
    this.el.scoreCount.textContent = count === null ? '' : String(count);
    this.el.scoreCount.hidden = count === null;
    this.syncCard();
  }

  /**
   * Takes the interface away, leaving the music and the way back.
   *
   * The drawer and every sheet go with it: a panel left standing would be
   * the one thing on screen, which is the opposite of what was asked for.
   */
  private showOnlyThePage(bare: boolean): void {
    // On the page rather than on the bar. What goes is not the bar's own
    // business: the day's clock stands over the music from the other side of
    // the layout, and one flag the whole page can see is what lets the
    // stylesheet say so without the view listing everything twice.
    this.doc.body.dataset['bare'] = String(bare);
    this.el.focusBare.setAttribute('aria-pressed', String(bare));
    if (bare) {
      this.setDrawerOpen(false);
      for (const sheet of this.doc.querySelectorAll('.sheet')) {
        if (sheet instanceof HTMLElement) {
          sheet.hidden = true;
        }
      }
    }
  }

  /**
   * Puts the verdict up in the middle of the page, or takes it away.
   *
   * Contents are still {@link renderResult}'s; this only decides whether the
   * panel holding them is on screen. Away on a tap, and away whenever the
   * music starts again - which is Start, a performance, or a repeat coming
   * round - because a grade over the bar being played is a grade in the way.
   */
  private showVerdict(shown: boolean): void {
    this.el.scoreVerdict.hidden = !shown;
    this.offerTheLastReading();
    this.syncCard();
  }

  /**
   * Whether to offer the way back to the last reading.
   *
   * Exactly when it is the only way to one: there is a reading, it is not on
   * screen, and nothing is playing over the page. Beside a verdict already up it
   * would be a button for what the reader is looking at; over a run it would be
   * a button for what they are not.
   */
  private offerTheLastReading(): void {
    this.el.scoreReading.hidden =
      this.lastReading === null || !this.el.scoreVerdict.hidden || this.somethingIsPlaying();
  }

  /**
   * Puts the last reading back up, whole.
   *
   * Rendered again rather than merely unhidden: the panel is where messages go
   * too, so what is in it may be anything by now - and rendering is what builds
   * the strip, the numbers and the way in to the drawing.
   */
  private showTheLastReading(): void {
    const reading = this.lastReading;
    if (reading === null) {
      return;
    }
    this.lastLadderMove = reading.move;
    this.renderResult(reading.score, reading.report);
  }

  /**
   * The card is only there when it has something in it.
   *
   * Empty it would still be a transparent sheet over the whole score, and
   * although it lets touches through, `hidden` is the honest way to say a
   * thing is not on the page - and the one every test can read.
   */
  private syncCard(): void {
    this.el.scoreCard.hidden =
      this.el.scoreCount.hidden &&
      this.el.scoreVerdict.hidden &&
      this.el.scoreEngraving.hidden &&
      this.el.scoreRest.hidden;
  }

  /**
   * Puts the reminder up, with one thing to do about it.
   *
   * The tips are his own: stand up, shake the hands out, look at something
   * far off, drink something - and one that is still practice, because a
   * break from *reading* is worth having on its own.
   */
  private showTheRest(sittingMs: number): void {
    const minutes = Math.round(sittingMs / 60_000);
    this.el.restHeading.textContent =
      minutes >= 1 ? `You have been playing for ${minutes} minutes` : 'Time for a rest';
    this.el.restTip.textContent = REST_TIPS[this.restTipAt % REST_TIPS.length] ?? '';
    this.restTipAt += 1;
    this.el.restRing.setAttribute('hidden', '');
    this.el.restLeft.hidden = true;
    this.el.restTake.hidden = false;
    this.el.restLater.hidden = false;
    this.el.restSnooze.hidden = false;
    this.el.scoreRest.hidden = false;
    this.syncCard();
  }

  /**
   * Counts the rest down, and says so when it is over.
   *
   * The ring is the whole of it - a border that thins away by itself, to be
   * glanced at from across the room with no number to read. The sound at the
   * end is what lets the reader stop watching it, which is rather the point
   * of a rest.
   */
  private takeTheRest(): void {
    this.runtime.controller.restTaken();
    this.el.restTake.hidden = true;
    this.el.restLater.hidden = true;
    this.el.restSnooze.hidden = true;
    this.el.restRing.removeAttribute('hidden');
    this.el.restLeft.hidden = false;
    this.el.restLeft.value = `${Math.round(REST_LENGTH_MS / 60_000)} minutes`;
    // Restarted rather than merely set: an animation whose duration changes
    // does not begin again on its own.
    this.el.restRingArc.style.animation = 'none';
    void this.el.restRingArc.getBoundingClientRect();
    this.el.restRingArc.style.animation = `rest-ring-empties ${REST_LENGTH_MS}ms linear forwards`;
    if (this.restTimer !== null) {
      clearTimeout(this.restTimer);
    }
    this.restTimer = setTimeout(() => {
      this.restTimer = null;
      this.hideTheRest();
      this.chime();
    }, REST_LENGTH_MS);
  }

  /**
   * Two notes, so the reader can look away and still be told.
   *
   * Both ends of both notes are scheduled here, the way a playback schedules
   * every note it sounds. `play` is a key going down and `stop` is it coming
   * up: a note nobody releases is held, and the synthesised tone holds it for
   * ever. With the recordings decoded the buffer runs out on its own, which is
   * why the missing release went unnoticed until a reader who had not
   * downloaded them heard the fallback tone ring on past the rest, with
   * nothing left that would ever end it. Scheduling both ends also leaves no
   * timer to outlive the view.
   */
  private chime(): void {
    const at = this.runtime.clock.now();
    this.soundTheChime(76, 0.5, at);
    this.soundTheChime(83, 0.45, at + CHIME_GAP_MS);
  }

  private soundTheChime(midi: number, velocity: number, atMs: number): void {
    this.runtime.pitchPlayer.play(midi, velocity, atMs);
    this.runtime.pitchPlayer.stop(midi, atMs + CHIME_NOTE_MS);
  }

  /**
   * Ends the rest without a sound when the music starts.
   *
   * A reader who starts playing during a rest has come back to the keys
   * before the ring ran out. A chime in the middle of the music would only
   * report a rest that is already over. If the rest was offered and not yet
   * answered, starting to play means "not now", so it is put off and asked
   * again a few minutes later, as a snooze would. Left up, either card would
   * stand over the music being read.
   */
  private putTheRestAwayForTheMusic(): void {
    if (this.el.scoreRest.hidden) {
      return;
    }
    if (this.restTimer === null) {
      this.runtime.controller.restPutOff();
    } else {
      clearTimeout(this.restTimer);
      this.restTimer = null;
    }
    this.hideTheRest();
  }

  private hideTheRest(): void {
    this.el.scoreRest.hidden = true;
    this.el.restRing.setAttribute('hidden', '');
    this.el.restLeft.hidden = true;
    this.syncCard();
  }

  /**
   * Keeps the page under the music, whoever is playing it.
   *
   * It used to say the place in words as well - "bar 12 · beat 2.5" - in the
   * pill and again in the panel. On music of any density that line changes
   * several times a second and its width changes with it, so what it
   * actually produced was a smear too unstable to read a number out of. The
   * cursor is already on the note and the bar numbers are already printed:
   * the reader has the answer in front of them, more precisely than a line
   * of text could give it.
   */
  private followMusic({ measureIndex }: PositionEvent): void {
    // Turned once, when the music has actually left the page, rather than
    // scrolled a little on every beat. That is what a page turn is for: the
    // reader looks at one thing until it is finished with.
    this.runtime.renderer.showMeasure(measureIndex);
  }

  /**
   * Stops whatever is going: a run, a look, a performance.
   *
   * One button for all three, because from where the reader is sitting there
   * is only one thing happening and Stop is what ends it. Wired to the
   * session alone it did nothing at all during a look or a performance -
   * neither of which *is* a session - and in fullscreen, where Stop is one of
   * the two buttons left on the page, that made the look a phase with no way
   * out. The desk's Stop knew about the look; the one beside the music did
   * not, which is exactly the wrong way round.
   */
  private stopEverything(): void {
    const controller = this.runtime.controller;
    this.goingOn += 1;
    this.openingToPlay = false;
    this.forgetTheBeats();
    this.cancelPreview();
    this.endTheReplay();
    controller.stop();
    // A performance ends too, whichever frame Stop was pressed in - and this
    // is a no-op where there is none, which is cheaper than a branch that
    // has to be kept in step with what Stop already did.
    controller.stopListening();
    this.showThePerformance();
  }

  /** Ends a look in progress, whether it ran out or the reader stopped it. */
  private cancelPreview(): void {
    if (this.previewTimer === null) {
      return;
    }
    clearInterval(this.previewTimer);
    this.previewTimer = null;
    // Whether the look ran out or the reader cut it short, the number it was
    // counting has nothing left to say.
    this.showCount(null);
    this.updateButtons(this.runtime.controller.session?.status ?? 'idle');
  }

  /**
   * The arrows, where the reader has said they will turn the pages.
   *
   * Only with a score read as pages and more than one of them: two arrows
   * over a single page would be furniture that never did anything. The
   * numbers are there because a reader who turns pages by hand is the one
   * person who needs to know which page they are on.
   */
  private showThePages(): void {
    const pages = this.runtime.renderer.pages;
    const wanted = this.runtime.controller.settings.pageTurns === 'manual' && pages.count > 1;
    this.el.scorePages.hidden = !wanted;
    if (!wanted) {
      return;
    }
    this.el.scorePageAt.value = `${pages.at + 1} / ${pages.count}`;
    this.el.scorePageBack.disabled = pages.at <= 0;
    this.el.scorePageOn.disabled = pages.at >= pages.count - 1;
  }

  /**
   * Counts the time this has been open, while it is actually on screen.
   *
   * Wall clock and not `IClock`: that one counts from an arbitrary zero for
   * measuring music, and "today" is a question about the calendar. The gap
   * between two readings is what is added, so a tick that came late - a
   * throttled tab, a busy machine - still contributes what it should.
   *
   * Stopped when the page goes away rather than counted and discarded later:
   * a tablet suspends timers when the reader leaves, so the stretch that
   * matters is the one ending at the moment they left.
   */
  private countTheTime(): void {
    const tick = (): void => {
      const now = Date.now();
      const since = this.timeCountedAtMs;
      this.timeCountedAtMs = now;
      if (since === null || this.doc.visibilityState === 'hidden') {
        return;
      }
      this.runtime.timeToday.add(now, Math.min(now - since, TIME_TICK_CAP_MS));
      this.showToday();
    };

    this.timeCountedAtMs = this.doc.visibilityState === 'hidden' ? null : Date.now();
    this.timeTick = setInterval(tick, TIME_TICK_MS);

    const onVisibility = (): void => {
      // Both ways: the last stretch before leaving is counted, and coming
      // back starts a new one rather than swallowing the time away.
      tick();
      this.timeCountedAtMs = this.doc.visibilityState === 'hidden' ? null : Date.now();
      this.showToday();
    };
    this.doc.addEventListener('visibilitychange', onVisibility);
    this.subscriptions.push(() => {
      this.doc.removeEventListener('visibilitychange', onVisibility);
    });
    this.showToday();
  }

  /**
   * Says how long today has had, where nothing is running.
   *
   * Kept off the page during a run: what it is for is the moment between
   * runs, and a number over the music while it is being read is furniture.
   * Silent under a minute, since "0 min" is a reproach rather than a fact.
   */
  private showToday(): void {
    const now = Date.now();
    const time = this.runtime.timeToday;
    const ms = time.msOn(now);
    const idle = !this.isPlaying && !this.runtime.controller.isListening;
    this.el.scoreToday.hidden = ms <= 0 || !idle;
    this.offerToSync();
    // A run of one day is not a run: everybody who has ever opened this has
    // a day, and a number that cannot say anything but "1" says nothing.
    const streak = time.streakEndingOn(now);
    this.el.scoreTodayText.value =
      streak > 1
        ? `Today ${describeSitting(ms)} · ${streak} days in a row`
        : `Today ${describeSitting(ms)}`;
    this.showTheWeek(time.lastDays(now, DAYS_IN_THE_ROW));
  }

  /**
   * The week, as seven marks.
   *
   * Redrawn only when it has actually changed: this runs on every tick of the
   * counter, and replacing seven elements every five seconds for the sake of
   * a day that turns over at midnight is work for nothing.
   */
  private showTheWeek(days: readonly { readonly day: string; readonly ms: number }[]): void {
    const shape = days.map((each) => (TimeToday.counts(each.ms) ? '1' : '0')).join('');
    if (shape === this.weekShown) {
      return;
    }
    this.weekShown = shape;
    this.el.scoreWeek.replaceChildren();
    for (const [at, each] of days.entries()) {
      const mark = this.doc.createElement('span');
      mark.className = 'score__week-day';
      if (TimeToday.counts(each.ms)) {
        mark.classList.add('score__week-day--played');
      }
      if (at === days.length - 1) {
        mark.classList.add('score__week-day--today');
      }
      this.el.scoreWeek.append(mark);
    }
    const played = days.filter((each) => TimeToday.counts(each.ms)).length;
    this.el.scoreWeek.setAttribute(
      'aria-label',
      `${played} of the last ${days.length} days practised`,
    );
  }

  /**
   * Keeps the waiting bar falling, or stops it.
   *
   * The page owns the timer because the application layer owns none - the
   * whole practice loop runs headlessly on a manual clock, and a mode that
   * waits for the reader has nothing of its own to measure time with.
   */
  private keepDrainingWhileWaiting(running: boolean): void {
    const wanted =
      running &&
      this.runtime.controller.survivalRuns &&
      !this.runtime.controller.survivalKeepsTime;
    if (!wanted) {
      if (this.survivalTick !== null) {
        clearInterval(this.survivalTick);
        this.survivalTick = null;
      }
      return;
    }
    if (this.survivalTick !== null) {
      return;
    }
    this.survivalTick = setInterval(() => {
      this.runtime.controller.drainWhileWaiting();
    }, SURVIVAL_TICK_MS);
  }

  /**
   * Starts the section plan from its first step, asking first where one is
   * under way - starting it over forgets where that had got to.
   */
  private async startThePlan(): Promise<void> {
    const controller = this.runtime.controller;
    if (
      controller.drillTask !== null &&
      !(await this.ask('Start the plan over? Where it has got to on this piece is forgotten.', null, 'Start over'))
    ) {
      return;
    }
    const bars = Math.max(1, Math.round(Number(this.el.drillBars.value) || 4));
    controller.startTheDrill(bars);
    this.syncControlsFromSettings();
    // Straight to the music: the plan is set, and what it asks for is said
    // at the top of the screen.
    this.el.sheetModes.hidden = true;
  }

  /**
   * Puts the plan away - asking first where it is under way, since where it
   * has got to on this piece goes with it. One played through is only put
   * away: that it was played through is kept.
   */
  private async stopThePlan(): Promise<void> {
    const controller = this.runtime.controller;
    if (
      controller.drillTask !== null &&
      !(await this.ask('Stop the plan? Where it has got to on this piece is forgotten.', null, 'Stop the plan'))
    ) {
      return;
    }
    controller.stopTheDrill();
    this.el.sheetDrill.hidden = true;
    this.showTheDrill();
  }

  /**
   * Says where the plan of learning the piece by sections stands: on the pill
   * at the top of the screen, and step by step in its sheet.
   *
   * At the top and all the time, rather than in a card in the middle of the
   * page between runs: the card stood over the very bars it asked to be
   * played. What it says is the step and what it asks - the bars are in the
   * drawer as well, because the plan sets the ordinary passage rather than a
   * private one of its own.
   */
  private showTheDrill(): void {
    const controller = this.runtime.controller;
    const plan = controller.drillPlan;
    const { at, of } = controller.drillProgress;
    this.el.drillPill.hidden = of === 0;
    const done = of > 0 && at >= of;
    const task = controller.drillTask;
    const said = done
      ? 'Plan done: the whole piece holds together'
      : task === null
        ? ''
        : `Plan ${String(at + 1)}/${String(of)} · ${describeTheDrillTask(task)}`;
    this.el.drillPill.textContent = said;
    this.el.drillPill.title = `${said}. Press for the whole plan.`;
    this.el.drillPill.setAttribute('aria-label', this.el.drillPill.title);
    this.el.drillWhere.textContent = done
      ? 'Every section, and then all of them together, played through cleanly. Press a step to go back to it.'
      : `Step ${String(at + 1)} of ${String(of)}. Each moves on once it is played through cleanly; press one played already to go back to it.`;
    this.el.drillStop.textContent = done ? 'Done' : 'Stop the plan';
    this.el.drillStart.textContent = task === null ? 'Start the plan' : 'Start over';
    this.el.drillDescription.textContent = this.whereThePieceIsInThePlan();
    this.el.drillSteps.replaceChildren(
      ...plan.map((step, index) => {
        const item = this.doc.createElement('li');
        item.dataset['state'] = index < at ? 'done' : index === at ? 'now' : 'later';
        if (index === at) {
          item.setAttribute('aria-current', 'step');
        }
        if (index >= at) {
          item.textContent = describeTheDrillTask(step);
          return item;
        }
        // A step behind is one to go back to, if something has gone again.
        const back = this.doc.createElement('button');
        back.type = 'button';
        back.className = 'drill-steps__back';
        back.textContent = describeTheDrillTask(step);
        back.title = 'Go back to this step';
        back.dataset['step'] = String(index);
        item.append(back);
        return item;
      }),
    );
  }

  /**
   * What the plan beside the button that starts it says of the piece that is
   * open: how to go about it, where it has got to, and when it was last
   * played through.
   */
  private whereThePieceIsInThePlan(): string {
    const controller = this.runtime.controller;
    const { at, of } = controller.drillProgress;
    const finishedAtMs = controller.drillFinishedAtMs;
    const said = [
      'Each section slowly with one hand, then the other, then both; then the sections joined up, until the whole piece holds together.',
    ];
    if (controller.drillTask !== null) {
      said.push(`This piece: step ${String(at + 1)} of ${String(of)}.`);
    }
    if (finishedAtMs !== null) {
      said.push(
        `Played through on ${new Date(finishedAtMs).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}.`,
      );
    }
    return said.join(' ');
  }

  /**
   * What the MIDI viewer is painting, placed in the run's own time.
   *
   * For whoever needs to know what is on a canvas without reading its pixels:
   * the tests, which can read a scene and cannot read a painting.
   */
  get rollScene(): RollScene | null {
    return this.drawnScene;
  }

  /** And the notes it shows ahead, where a chord pointed at would write them: see `showTheChordAhead`. */
  get rollNotesShownAhead(): readonly NoteShownAhead[] {
    return this.notesShownAhead;
  }

  /** And those of a recording under way: see `showWhatIsBeingRecorded`. */
  get rollNotesBeingRecorded(): readonly NoteShownAhead[] {
    return this.notesBeingRecorded;
  }

  /** True while the reader is being given their look at the page. */
  get isPreviewing(): boolean {
    return this.previewTimer !== null;
  }

  /**
   * The space bar starts and pauses, and the arrows turn the pages.
   *
   * Ignored while a control has focus: space is how a button is pressed and
   * how a checkbox is ticked, a number box needs it even less disturbed, and
   * the arrows belong to a slider or a select entirely. At a desk there is no
   * swipe, so without this a score read as pages could only be turned with a
   * mouse held down and dragged across it.
   */
  /**
   * Shuts the innermost thing open, and says whether there was one.
   *
   * Asked of the page, and shut by the sheet's *own* closing control, for two
   * reasons that are really one. A list of sheets kept here is a list to forget
   * the next sheet from - this was such a list, and it had five of the eleven
   * on it, so Escape did nothing over the picture of a run, over a rename, over
   * the places, the modes or the readings. And hiding a sheet is not the same
   * as shutting it: several have something to put away first - a drawing to
   * stop playing, a question whose answer somebody is still waiting on - and a
   * list that hides them would leave exactly that behind. Pressing the control
   * the reader would have pressed does whatever that sheet already does.
   *
   * A sheet laid over another goes first, which is the whole of what "innermost"
   * means here. His: "чи можеш діалогам додати shortcut esc щоб зачиняти їх?".
   */
  private shutTheInnermostSheet(): boolean {
    const shuts = this.theDeepestSheet()?.querySelector<HTMLElement>('[data-shuts]') ?? null;
    if (shuts === null) {
      return false;
    }
    shuts.click();
    return true;
  }

  /**
   * Whether anything is standing over the page.
   *
   * Asked of the page rather than of a list kept here, because a list of them
   * is a thing to forget to add the next sheet to - and the one that got
   * forgotten would be the one whose keys went through to the music.
   */
  private aSheetIsOpen(): boolean {
    return this.doc.querySelector('.sheet:not([hidden])') !== null;
  }

  /**
   * Whether the picture of a run is the thing the reader is looking at.
   *
   * Open, and with nothing standing over it: its own options sheet, a
   * confirmation and a rename all lay themselves over the top, and while one of
   * those is up the keys are its own. Asked of the page for the same reason the
   * question above it is - a list kept here is a list to forget a sheet from.
   */
  private thePictureIsInFront(): boolean {
    return this.theDeepestSheet() === this.el.sheetRoll;
  }

  /**
   * Puts a sheet up, over whatever is up already.
   *
   * How deep it stands is written on the sheet as it opens, because the page
   * is what gets asked afterwards: which sheet a press of Escape belongs to
   * is "whichever is deepest", and the stylesheet raises it by the same
   * number. A list kept in here instead would be a list to forget the next
   * sheet from, which is the fault `shutTheInnermostSheet` was written to
   * stop - and a sheet is deep because of what the reader opened it from,
   * which is not something the markup can know.
   */
  private showTheSheet(sheet: HTMLElement): void {
    if (sheet.hidden) {
      sheet.dataset['over'] = String(
        this.doc.querySelectorAll('.sheet:not([hidden])').length + 1,
      );
    }
    sheet.hidden = false;
  }

  /** The sheet nearest the reader: the last one opened over the rest. */
  private theDeepestSheet(): HTMLElement | null {
    let deepest: HTMLElement | null = null;
    let over = 0;
    for (const sheet of this.doc.querySelectorAll<HTMLElement>('.sheet:not([hidden])')) {
      // Equal depth goes to the later one, which is the one drawn on top.
      const its = Number(sheet.dataset['over'] ?? '1');
      if (its >= over) {
        over = its;
        deepest = sheet;
      }
    }
    return deepest;
  }

  /** Starts the drawing playing, or holds it where it has got to. */
  private togglePlayingTheRoll(): void {
    if (this.recording !== null) {
      this.writeInWhatWasRecorded();
      return;
    }
    if (this.runtime.takePlayer.playing === RUN_ROLL_ID) {
      this.holdTheRoll();
      return;
    }
    this.playTheRoll();
  }

  /**
   * Space, and space held down with the command key.
   *
   * The pair a transport is: the plain key is the one that goes and stops
   * going, and the held one is the square button beside it. In front of the
   * music that is Stop where something is going and Rewind where nothing is -
   * one key for "put me back", because the two are never both on offer and a
   * reader reaching for the keyboard mid-run does not want to pick. Over the
   * picture of a run it is that sheet's own Stop. His: "ctrl+space шорткат для
   * нот щоб зупиняти гру коли гра у прогресі, та rewind коли гра не у
   * прогресі, та у MIDI viewer це має бути stop кнопка".
   */
  private bindSpaceBar(): void {
    const handler = (event: KeyboardEvent): void => {
      if (event.altKey) {
        return;
      }
      // Either key, as everywhere else here that takes a held gesture: which
      // of the two is the command key is the platform's business.
      const held = event.metaKey || event.ctrlKey;
      const focused = this.doc.activeElement;
      if (event.code === 'Space' && this.focusCameByThePointer && pressedRatherThanTyped(focused)) {
        // Pressed by the pointer, it keeps the focus, and the browser would
        // press it again at the space bar - which was meant for the music.
        focused.blur();
      } else if (isFormControl(focused)) {
        return;
      }
      // Nor while a sheet stands over the page. These keys belong to whatever
      // is in front of the reader, and a sheet is in front of everything: he
      // pressed space over the picture of a run expecting the picture to play,
      // and started a *run* behind it - with the sheet still hanging there over
      // music that had begun without him. His: "прибрати пробіл shortcut щоб
      // почати гру коли відчинені діалоги". The arrows go with it, for the same
      // reason: turning a page behind a dialog is the same fault.
      if (this.aSheetIsOpen()) {
        // Except over the picture of a run, which has something of its own to
        // start and stop. The rule is the same one either way - the key belongs
        // to whatever is in front of the reader - and in front of them here is a
        // drawing with a transport on it. His: "я думав запустити playback по
        // space".
        if (event.code === 'Space' && this.thePictureIsInFront()) {
          event.preventDefault();
          if (held) {
            // The sheet's square button: back to the marker first, where
            // there is anywhere to go back to, and from there to the beginning.
            this.goBackInTheRoll();
          } else if (event.shiftKey) {
            this.goBackToTheMarker();
          } else {
            this.togglePlayingTheRoll();
          }
        }
        return;
      }
      if (held) {
        // Nothing else is spoken for while a key is held, so the arrows below
        // stay the browser's and only space is taken.
        if (event.code === 'Space') {
          event.preventDefault();
          if (this.anythingToStop) {
            this.stopEverything();
          } else {
            this.rewindToTheStart();
          }
        }
        return;
      }
      const turn = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (turn !== 0) {
        // Only where there are pages to turn. Left alone otherwise, so the
        // arrows go on doing whatever the browser does with them.
        if (this.runtime.renderer.pages.count > 1) {
          event.preventDefault();
          this.runtime.renderer.turnPages(turn);
        }
        return;
      }
      if (event.code !== 'Space') {
        return;
      }
      event.preventDefault();
      this.togglePlayback();
    };

    this.doc.addEventListener('keydown', handler);
    this.subscriptions.push(() => {
      this.doc.removeEventListener('keydown', handler);
    });

    // How the focus came, as it comes: by a pointer pressed last, or by a
    // key. The browser's own word for it, a visible focus, is no use here -
    // it turns visible at the very key that asks, before anyone hears it.
    let thePointerLast = false;
    const pointed = (): void => {
      thePointerLast = true;
    };
    const keyed = (): void => {
      thePointerLast = false;
    };
    const focusCame = (): void => {
      this.focusCameByThePointer = thePointerLast;
    };
    this.doc.addEventListener('pointerdown', pointed, true);
    this.doc.addEventListener('keydown', keyed, true);
    this.doc.addEventListener('focusin', focusCame, true);
    this.subscriptions.push(() => {
      this.doc.removeEventListener('pointerdown', pointed, true);
      this.doc.removeEventListener('keydown', keyed, true);
      this.doc.removeEventListener('focusin', focusCame, true);
    });
  }

  /**
   * Changes the pace without leaving the stand.
   *
   * The reading moves at once and the run follows when the pressing stops.
   *
   * The page itself no longer moves at all: it is engraved from the score as
   * written, and a printed page states the tempo its writer chose rather than
   * how fast anyone is playing it today. What the run is actually taken at is
   * the transport's to say, and it says it in beats and in per cent.
   *
   * The wait is still worth having. Settling a new tempo rebuilds what the
   * run is judged against and puts the marks and the veil away, and doing
   * that on every press of a held button is churn nobody asked to watch.
   *
   * Generation is seeded, so the notes are the same ones either way.
   */
  private nudgeTempo(deltaPercent: number): void {
    if (this.runtime.controller.replaying) {
      this.changeTheReplaySpeed(deltaPercent > 0 ? 1 : -1);
      return;
    }
    // In free play the buttons are the click's tempo: there is no piece being
    // read there to play faster, and nothing to engrave again.
    if (this.runtime.controller.playsFreely) {
      this.runtime.controller.nudgeFreePlayBpm(deltaPercent > 0 ? FREE_CLICK_STEP_BPM : -FREE_CLICK_STEP_BPM);
      this.syncControlsFromSettings();
      return;
    }
    this.runtime.controller.nudgeTempoPercent(deltaPercent);
    this.describeTempo();
    this.syncControlsFromSettings();

    if (this.tempoRedraw !== null) {
      clearTimeout(this.tempoRedraw);
    }
    this.tempoRedraw = setTimeout(() => {
      this.tempoRedraw = null;
      void this.reload(false);
    }, TEMPO_REDRAW_DELAY_MS);
  }

  /**
   * A step button that steps once on a tap and, where `repeats` says so,
   * again and again while it is held - faster the longer it is held, as a
   * clock's buttons go.
   *
   * The click a held finger makes on letting go is the hold's, not one more
   * step.
   */
  private holdToRepeat(button: HTMLButtonElement, step: () => void, repeats: () => boolean): void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stepped = false;
    const letGo = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const again = (count: number): void => {
      timer = setTimeout(
        () => {
          stepped = true;
          step();
          again(count + 1);
        },
        count === 0 ? HOLD_MS : repeatGapMs(count),
      );
    };
    this.listen(button, 'pointerdown', () => {
      stepped = false;
      letGo();
      if (repeats()) {
        again(0);
      }
    });
    this.listen(button, 'pointerup', letGo);
    this.listen(button, 'pointercancel', letGo);
    this.listen(button, 'pointerleave', letGo);
    this.listen(button, 'click', () => {
      if (stepped) {
        stepped = false;
        return;
      }
      step();
    });
  }

  /**
   * Note size from the stand, in the same steps the slider uses.
   *
   * Re-engraved rather than scaled: the engraver decides how many bars fit a
   * system from the size it is drawing at, so a page merely stretched would
   * be the old layout at the wrong size.
   */
  private nudgeZoom(deltaPercent: number): void {
    const from = Math.round((this.runtime.controller.settings.zoom * 100) / ZOOM_STEP_PERCENT) *
      ZOOM_STEP_PERCENT;
    const wanted = Math.min(MAX_ZOOM_PERCENT, Math.max(MIN_ZOOM_PERCENT, from + deltaPercent));
    this.runtime.controller.updateSettings({ zoom: wanted / 100 });
    this.syncControlsFromSettings();
  }

  /**
   * Loads the piece that exists only to be measured against.
   *
   * One note, on every beat, one hand, at a walking pace: whatever is left
   * between the click and the press is the journey, because the reader has
   * been given nothing else to get wrong.
   *
   * The run has to be one the beat drives and the reader can hear, so the
   * mode, the count-in and the click are set to what the measurement needs.
   * Said out loud rather than done quietly - they are the reader's settings
   * and they will find them changed.
   */
  private async loadCalibration(): Promise<void> {
    const { controller } = this.runtime;
    controller.updateSettings({
      modeId: FLOW_MODE_ID,
      clickWhen: 'always',
      clickOn: true,
      clickPattern: 'pulse',
      countInBars: Math.max(1, controller.settings.countInBars),
      handStaff: null,
      rangeFromBar: null,
      rangeToBar: null,
      survival: false,
    });
    await controller.openScore(calibrationExercise());
    this.syncControlsFromSettings();
    this.el.latencyDescription.textContent =
      'Press Start and play middle C on every click, as squarely as you can. ' +
      'The mode, count-in and click were set to what the measurement needs.';
  }

  /**
   * What the last run measured, rounded to what the slider can hold.
   *
   * The *tendency*, not the scatter: a steady hand forty milliseconds behind
   * the beat is a delay on the way in, and correcting it is honest. Landing
   * wildly either side of the beat averages to the same number and is not
   * something a constant can fix, so a run whose spread is larger than its
   * tendency is refused rather than quietly turned into a correction that
   * would only move the mess.
   */
  private measuredLatencyMs(): number | null {
    const deviations = this.runtime.controller.lastReport?.timing.deviations;
    if (deviations === undefined || deviations.length < MIN_PRESSES_TO_MEASURE) {
      return null;
    }
    const centre = middle(deviations);
    if (!isRealTendency(centre, spreadAround(deviations), deviations.length)) {
      return null;
    }
    const step = 5;
    return Math.round(centre / step) * step;
  }

  /**
   * What the delay would become if the last run were taken.
   *
   * The run measures what is *left over* after the delay already set, so the
   * two are added. Replacing one with the other threw away the answer each
   * time it was found: a reader pressing the button repeatedly went 0, 120,
   * -100, 105, -90, 95, converging by luck and their own patience rather
   * than by arithmetic. Added, the first press is the last one needed.
   */
  private latencyWouldBecome(): number | null {
    const measured = this.measuredLatencyMs();
    if (measured === null) {
      return null;
    }
    const wanted = this.runtime.controller.settings.inputLatencyMs + measured;
    return Math.min(MAX_LATENCY_MS, Math.max(-MAX_LATENCY_MS, wanted));
  }

  /**
   * Says what the delay is for, and whether the last run can settle it.
   *
   * A number nobody can explain is a number nobody will touch, and this one
   * is the difference between "I am late" and "I am told I am late".
   */
  private describeLatency(): void {
    const set = this.runtime.controller.settings.inputLatencyMs;
    this.el.latencyValue.value = String(set);

    const timing = this.runtime.controller.lastReport?.timing;
    const measured = this.measuredLatencyMs();
    const wanted = this.latencyWouldBecome();
    this.el.latencyMeasure.disabled = wanted === null;
    this.el.latencyMeasure.textContent =
      wanted === null ? 'Take it from the last run' : `Take it from the last run (${wanted} ms)`;

    if (set === 0) {
      this.el.latencyDescription.textContent =
        'Taken off every press before it is judged. A key struck on the beat is not heard about on the beat.';
    } else {
      this.el.latencyDescription.textContent =
        `Every press is judged ${Math.abs(set)} ms ${set > 0 ? 'earlier' : 'later'} than it arrived.`;
    }

    if (measured !== null && wanted !== null) {
      this.el.latencyDescription.textContent +=
        ` What is left over runs ${Math.abs(measured)} ms ${measured > 0 ? 'late' : 'early'}, steadily,` +
        ` which would make the delay ${wanted} ms.`;
      return;
    }
    if (timing !== undefined && timing.deviations.length >= MIN_PRESSES_TO_MEASURE) {
      this.el.latencyDescription.textContent +=
        ` The last run averaged ${Math.round(timing.meanDeviationMs)} ms with a spread of ` +
        `${Math.round(timing.deviationSpreadMs)} ms, which is too scattered to call a tendency.`;
    }
  }

  private describeZoom(): void {
    this.el.focusZoom.value = `${Math.round(this.runtime.controller.settings.zoom * 100)}%`;
  }

  private describeTempo(): void {
    if (this.runtime.controller.replaying) {
      // There is no run to set a tempo for while one is shown again, so the
      // buttons say how fast it is played back.
      this.el.focusTempo.value = `${String(Math.round(this.theRollsSpeed() * 100))}%`;
      this.el.focusTempo.title = 'How fast the run is played back';
      return;
    }
    if (this.runtime.controller.playsFreely) {
      // The beat a minute as a score marks it, a crotchet and its number,
      // which fits where the percentage does: the row may not change size.
      const bpm = this.runtime.controller.settings.freePlayBpm;
      // The crotchet drawn rather than typed: the font's own was a speck at
      // the digits' size, and larger it lost its stem. The bpm is said in
      // words in the title.
      const svg = 'http://www.w3.org/2000/svg';
      const note = this.doc.createElementNS(svg, 'svg');
      note.setAttribute('class', 'focus-bar__note');
      note.setAttribute('viewBox', '0 0 10 24');
      note.setAttribute('aria-hidden', 'true');
      const head = this.doc.createElementNS(svg, 'ellipse');
      head.setAttribute('cx', '4.6');
      head.setAttribute('cy', '19.5');
      head.setAttribute('rx', '4.2');
      head.setAttribute('ry', '3.1');
      head.setAttribute('transform', 'rotate(-22 4.6 19.5)');
      const stem = this.doc.createElementNS(svg, 'rect');
      stem.setAttribute('x', '7.4');
      stem.setAttribute('y', '1');
      stem.setAttribute('width', '1.5');
      stem.setAttribute('height', '18');
      note.append(head, stem);
      this.el.focusTempo.replaceChildren(note, String(bpm));
      this.el.focusTempo.title = `The metronome: ${String(bpm)} bpm`;
      return;
    }
    const percent = this.runtime.controller.tempoPercent;
    this.el.focusTempo.value = `${percent}%`;
    this.el.focusTempo.title = `${this.runtime.controller.tempoBpm} bpm`;
  }

  get isDrawerOpen(): boolean {
    return this.el.focusBar.dataset['open'] === 'true';
  }

  /**
   * Opens or closes the drawer under the transport row.
   *
   * The bar holds one line of what is used *during* a run - play, where you
   * are, how fast - and everything reached for between runs waits underneath.
   * That is what keeps it to a single row on a tablet held upright, where it
   * used to wrap onto two.
   */
  setDrawerOpen(open: boolean): void {
    this.el.focusBar.dataset['open'] = String(open);
    this.el.focusHandle.setAttribute('aria-expanded', String(open));
  }

  /**
   * A drag on the handle, in pixels, negative being upwards.
   *
   * Taken as a number rather than as events so the rule - far enough up opens
   * it, far enough down closes it, a small movement is a tap - can be read
   * and tested without a pointer.
   */
  handleDragged(deltaY: number): void {
    if (Math.abs(deltaY) < DRAWER_DRAG_PX) {
      return;
    }
    this.setDrawerOpen(deltaY < 0);
  }

  private bindDrawerDrag(): void {
    let from: number | null = null;
    const start = (event: PointerEvent): void => {
      from = event.clientY;
    };
    const end = (event: PointerEvent): void => {
      if (from !== null) {
        this.handleDragged(event.clientY - from);
      }
      from = null;
    };
    this.listen(this.el.focusHandle, 'pointerdown', start as (event: Event) => void);
    this.listen(this.el.focusHandle, 'pointerup', end as (event: Event) => void);
    this.listen(this.el.focusHandle, 'pointercancel', () => {
      from = null;
    });
  }

  /**
   * Draws the survival bar, gliding rather than stepping.
   *
   * The pulse arrives once a beat on a calm exercise and four times as often
   * on a busy one, so the glide is timed from the gap between updates rather
   * than fixed: a constant duration would stutter on the slow piece and lag
   * behind on the fast one. Which is the same reasoning as the drain itself -
   * everything here is measured against the music, not the clock.
   */
  private renderHealth(health: number, cause: 'drain' | 'settle' = 'settle'): void {
    // His: only once Start has been pressed. Survival being *chosen* is a
    // decision about the next run; the falling bar is that run happening,
    // and a full bar standing over a page nobody is reading yet is the
    // program showing its working.
    const running = this.runtime.controller.survivalRuns && this.isPlaying;
    this.el.focusHealth.hidden = !running;
    if (!running) {
      return;
    }
    // Only a drain paces a drain. Timed against "the last update of any
    // kind", a step landing between two pulses left the next glide with
    // almost no time to run, so the bar jumped and went on jumping until the
    // two happened to fall apart again.
    if (cause === 'drain') {
      // Only a drain re-times the glide, and only a drain moves the mark: a
      // step landing changes where the bar is going, never how fast.
      const now = Date.now();
      this.healthPaceMs = healthGlideMs(this.healthPaceMs, now, this.lastDrainAtMs);
      this.lastDrainAtMs = now;
    }
    const duration = this.healthPaceMs;
    this.el.focusHealthFill.style.transitionDuration = `${duration}ms`;
    this.el.focusHealthFill.style.width = `${Math.round(health * 100)}%`;
    this.el.focusHealthFill.dataset['low'] = String(health <= 0.25);
  }

  /**
   * Says what the metronome is set to, on its button.
   *
   * Whether it is on is shown, lit as a switch that is on and dimmed when
   * off, which is the switch at the head of its sheet; when it sounds and on
   * what is said in words. The count-in alone was shown plain, and a reader
   * who had just turned the click on saw a button that did not say so. What a
   * tap and a hold do is said too, a hold being nowhere to be seen.
   */
  private describeMetronomeButton(settings: PracticeSettings): void {
    const controller = this.runtime.controller;
    if (controller.playsFreely) {
      // Free play has no run for the click to follow, so turning it off and
      // on is starting and stopping it; which of a tap and a hold does that
      // is the reader's one choice for both.
      const going = controller.clicksFreely;
      const beats = settings.freePlayBeats.length;
      const said =
        `Metronome ${going ? 'going' : 'stopped'}, ${String(settings.freePlayBpm)} bpm, ` +
        `${String(beats)} ${beats === 1 ? 'beat' : 'beats'} a bar.`;
      const turn = going ? 'stop it' : 'start it';
      const label =
        settings.metronomeTap === 'opens-its-sheet'
          ? `${said} Tap for its settings, hold to ${turn}.`
          : `${said} Tap to ${turn}, hold for its settings.`;
      this.el.focusMetronome.dataset['click'] = going ? 'on' : 'off';
      this.el.focusMetronome.title = label;
      this.el.focusMetronome.setAttribute('aria-label', label);
      this.el.metronomeOn.setAttribute('aria-checked', String(going));
      return;
    }
    const on = settings.clickOn;
    const set = on
      ? `Metronome: ${CLICK_WHEN_LABELS[settings.clickWhen].toLowerCase()}, ` +
        `${CLICK_LABELS[settings.clickPattern].toLowerCase()}.`
      : 'Metronome off.';
    const turn = on ? 'turn it off' : 'turn it on';
    const label =
      settings.metronomeTap === 'opens-its-sheet'
        ? `${set} Tap for its settings, hold to ${turn}.`
        : `${set} Tap to ${turn}, hold for its settings.`;
    this.el.focusMetronome.dataset['click'] = on ? 'on' : 'off';
    this.el.focusMetronome.title = label;
    this.el.focusMetronome.setAttribute('aria-label', label);
    this.el.metronomeOn.setAttribute('aria-checked', String(on));
  }

  /**
   * The metronome's button has two answers, opening everything about the
   * click and turning it off and on: a tap gives the one the reader chose in
   * its sheet, opening it unless they chose otherwise, and holding it gives
   * the other. The switch at the top of the sheet turns it off and on as well,
   * and says what it does by being a switch.
   *
   * Opening the sheet is the answer a tap gives first because it can be found:
   * nothing on a button says it can be held. A right click is a hold, there
   * being no finger to hold on a desk; and the click a held finger makes on
   * letting go is the hold's, not a tap. What the click is set to stays where
   * it was while it is off, for when it is turned on again.
   */
  private bindTheMetronomeButton(): void {
    const controller = this.runtime.controller;
    const button = this.el.focusMetronome;
    const openTheSheet = (): void => {
      this.syncControlsFromSettings();
      this.showTheSheet(this.el.sheetMetronome);
    };
    // In free play there is no run for the click to follow, so turning it
    // off and on is starting and stopping it - from the button and from the
    // switch at the head of its sheet alike.
    const turnItOffOrOn = (): void => {
      if (controller.playsFreely) {
        controller.clickFreely(!controller.clicksFreely);
      } else {
        controller.updateSettings({ clickOn: !controller.settings.clickOn });
      }
      this.syncControlsFromSettings();
    };
    const tapped = (): void => {
      if (controller.settings.metronomeTap === 'opens-its-sheet') {
        openTheSheet();
      } else {
        turnItOffOrOn();
      }
    };
    const held = (): void => {
      if (controller.settings.metronomeTap === 'opens-its-sheet') {
        turnItOffOrOn();
      } else {
        openTheSheet();
      }
    };
    let holding: ReturnType<typeof setTimeout> | null = null;
    let wasHeld = false;
    const letGo = (): void => {
      if (holding !== null) {
        clearTimeout(holding);
        holding = null;
      }
    };
    this.listen(button, 'pointerdown', () => {
      wasHeld = false;
      letGo();
      holding = setTimeout(() => {
        holding = null;
        wasHeld = true;
        held();
      }, HOLD_MS);
    });
    this.listen(button, 'pointerup', letGo);
    this.listen(button, 'pointercancel', letGo);
    this.listen(button, 'pointerleave', letGo);
    this.listen(button, 'contextmenu', (event) => {
      event.preventDefault();
      letGo();
      if (!wasHeld) {
        wasHeld = true;
        held();
      }
    });
    this.listen(button, 'click', () => {
      if (wasHeld) {
        wasHeld = false;
        return;
      }
      tapped();
    });
    this.listen(this.el.metronomeOn, 'click', turnItOffOrOn);

    this.listen(this.el.freeBeatsFewer, 'click', () => {
      controller.changeTheFreeBeats(-1);
      this.syncControlsFromSettings();
    });
    this.listen(this.el.freeBeatsMore, 'click', () => {
      controller.changeTheFreeBeats(1);
      this.syncControlsFromSettings();
    });
    // On the finger going down, which is the moment the beat is meant: a
    // click arrives on letting go, as much later as the finger rested. A
    // click with no pointer behind it is the keyboard's, and counts.
    const tapTheTempo = (): void => {
      if (controller.tapTheFreeTempo() !== null) {
        this.syncControlsFromSettings();
      }
    };
    this.listen(this.el.freeTap, 'pointerdown', tapTheTempo);
    this.listen(this.el.freeFromScore, 'click', () => {
      controller.takeTheFreeClickFromThePiece();
      this.syncControlsFromSettings();
    });
    this.listen(this.el.freeTap, 'click', (event) => {
      if (event.detail === 0) {
        tapTheTempo();
      }
    });
    // One listener for the row rather than one a dot: the dots are drawn
    // again whenever the bar changes, and a listener each would outlive them.
    this.listen(this.el.freeBeatsDots, 'click', (event) => {
      const dot = (event.target as Element | null)?.closest<HTMLElement>('.free-beats__dot');
      const index = Number(dot?.dataset['index']);
      if (dot === null || dot === undefined || !Number.isInteger(index)) {
        return;
      }
      controller.turnTheFreeBeat(index);
      this.syncControlsFromSettings();
    });
  }

  /**
   * Lights each beat of the click in free play on the first frame at or
   * after the moment it is heard, a frame at a time while any are coming.
   */
  private lightTheBeatsOnTime(): void {
    const view = this.doc.defaultView;
    if (this.beatFrame !== null || view === null || typeof view.requestAnimationFrame !== 'function') {
      return;
    }
    const frame = (): void => {
      this.beatFrame = null;
      const now = this.runtime.clock.now();
      let heard: number | null = null;
      while ((this.beatsComing[0]?.atMs ?? Number.POSITIVE_INFINITY) <= now) {
        heard = this.beatsComing.shift()?.beat ?? heard;
      }
      if (heard !== null) {
        this.lightTheHeardBeat(heard);
      }
      if (this.beatsComing.length > 0) {
        this.beatFrame = view.requestAnimationFrame(frame);
      }
    };
    this.beatFrame = view.requestAnimationFrame(frame);
  }

  /** Lights one beat's dot and puts the others out, or puts them all out. */
  private lightTheHeardBeat(beat: number | null): void {
    this.freeBeatHeard = beat;
    for (const dot of this.el.freeBeatsDots.querySelectorAll<HTMLElement>('.free-beats__dot')) {
      dot.dataset['now'] = String(Number(dot.dataset['index']) === beat);
    }
  }

  /**
   * The bar the click beats in free play, a dot a beat, each saying what it
   * is and what a tap makes it.
   */
  private describeTheFreeBeats(settings: PracticeSettings): void {
    const beats = settings.freePlayBeats;
    const heard = this.freeBeatHeard;
    this.el.freeBeatsCount.value = String(beats.length);
    this.el.freeBeatsDots.replaceChildren(
      ...beats.map((sound, index) => {
        const dot = this.doc.createElement('button');
        dot.type = 'button';
        dot.className = 'free-beats__dot';
        dot.dataset['index'] = String(index);
        dot.dataset['sound'] = sound;
        dot.dataset['now'] = String(index === heard);
        const said = `Beat ${String(index + 1)}: ${BEAT_SOUND_SAID[sound]}. Tap to ${BEAT_SOUND_NEXT[sound]}.`;
        dot.title = said;
        dot.setAttribute('aria-label', said);
        return dot;
      }),
    );
  }

  /**
   * Shows which hands are being read, by dimming the one that is not.
   *
   * The control is its own state rather than a label about it, which is what
   * lets one button carry all three answers.
   */
  private describeHands(handStaff: number | null): void {
    const readsRight = handStaff === null || handStaff === RIGHT_HAND_STAFF;
    const readsLeft = handStaff === null || handStaff === LEFT_HAND_STAFF;
    this.el.focusHandRight.dataset['reading'] = String(readsRight);
    this.el.focusHandLeft.dataset['reading'] = String(readsLeft);
    this.el.focusHands.setAttribute(
      'aria-label',
      handStaff === null ? 'Both hands' : readsLeft ? 'Left hand only' : 'Right hand only',
    );
    this.showHandSwitches();
  }

  /**
   * The switches beside the staves, which are furniture like the markers.
   *
   * A touch on the music puts the furniture away and brings it back, and
   * these go with the rest of it: they stand in the margin of every system on
   * the page, and a reader who has cleared the page has cleared it.
   */
  private showHandSwitches(): void {
    this.runtime.renderer.showHands(
      this.passageMarkersWanted ? handsPlaying(this.runtime.controller.settings.handStaff) : [],
    );
  }

  /**
   * Says which bars are being read, in fullscreen, where nothing else does.
   *
   * A passage is cut out as an exercise in its own right, so by the time it
   * reaches the page there is nothing left in it that remembers a longer piece
   * exists. That is what makes everything downstream simple and it is also how
   * a reader ends up practising eight bars with no idea they are bars 20 to 27
   * - the page now prints their real numbers, and this says the same thing in
   * words that can be typed over.
   *
   * The mark on the handle is for when the drawer is shut, which is most of
   * the time: a narrowed piece should not look like a short one.
   */
  private describePassageRange(): void {
    const { controller } = this.runtime;
    const { rangeFromBar, rangeToBar } = controller.settings;
    const total = controller.wholePieceBars;

    const { firstBar, lastBar } = controller.pieceBarRange;

    this.el.focusFrom.value = rangeFromBar === null ? '' : String(rangeFromBar);
    this.el.focusTo.value = rangeToBar === null ? '' : String(rangeToBar);
    // Places in the playing, counted from one. It was the number printed on
    // the page, which reads well until a piece repeats - and then there is no
    // arithmetic a reader can do in their head, because the printed number
    // names two bars and the boxes have to mean one.
    for (const box of [this.el.focusFrom, this.el.focusTo]) {
      box.min = String(firstBar);
      box.max = String(lastBar);
    }
    this.el.focusBars.value = `of ${total}`;

    const narrowed = rangeFromBar !== null || rangeToBar !== null;
    this.el.focusHandle.dataset['passage'] = String(narrowed);
    // Narrowed to something, and not in the middle of reading it: giving the
    // whole piece back mid-run would move what is being graded.
    this.el.focusWhole.disabled = !narrowed || this.isPlaying;
  }

  private bindControllerEvents(): void {
    const { controller } = this.runtime;

    this.subscriptions.push(
      // Whoever changed it. The mark follows the *answer*, not the control
      // that happened to be pressed: the setting has a checkbox at the desk,
      // and a run beginning or ending changes it without any control at all.
      controller.events.on('settingsChanged', () => {
        this.showTheListening();
        // The rung and the readings in a row at it are both settings.
        this.showTheRung();
        // A shared setting changed is something the drive has not had.
        this.offerToSync();
      }),
    );
    this.subscriptions.push(
      controller.events.on('exerciseLoaded', ({ exercise }) => {
        this.hasLooked = false;
        this.placedOnBar = null;
        // The places marked out belong to the piece, so they are drawn again
        // whenever the piece changes - however it was opened.
        this.renderPassages();
        // Around whatever was just engraved, which *is* the passage: the
        // markers belong at its two ends after every reload, wherever the
        // reader last left them on the page before it.
        this.showPassageMarkers();
        // Which bars the reader has seen before. A repeat is written out
        // rather than jumped back to, so without this the music simply looks
        // like a piece that says the same thing twice.
        this.runtime.renderer.showRepeatedBars(
          exercise.barLabels
            .map((label, at) => (label.repeated ? at : -1))
            .filter((at) => at >= 0),
        );
        this.applyScoreCover();
        // A performance does not survive its own score being replaced, so the
        // button that offers to stop one has to stop saying so.
        this.showThePerformance();
        // A score opened or a page generated: the corner is about the second.
        this.showTheRung();
        // Another score on the page is no sketch's.
        this.showThePencilBesideThePills();
      }),
    );

    this.subscriptions.push(
      controller.events.on('sessionBuilt', ({ session }) => {
        // Only the listening, and nothing that draws: this happens before the
        // run has begun, and what a run does first is the one thing nothing may
        // be put in front of.
        this.bindSession(session);
      }),
    );

    this.subscriptions.push(
      controller.events.on('sessionCreated', () => {
        // A run takes the pulse from a playback, so the button has to admit it.
        this.showThePerformance();
        this.markWhenPainted();
        // Every way of starting a run arrives here - the button, the repeat
        // coming round, a drill - so the verdict on the last one is put away
        // in one place rather than at each of them.
        this.showVerdict(false);
      }),
    );

    this.subscriptions.push(
      controller.events.on('drillChanged', () => {
        // The plan sets the passage, the hand and the speed - taken up as a
        // piece opens as well as started here - and the drawer shows them.
        this.syncControlsFromSettings();
        this.showTheDrill();
      }),
    );

    this.subscriptions.push(
      controller.events.on('otherHandReached', ({ stepIndex, atMs }) => {
        this.walkTheOtherHandTo(stepIndex, atMs);
      }),
    );

    this.subscriptions.push(
      controller.events.on('otherHandOvertaken', ({ atMs }) => {
        this.forgetTheOtherHandsWalkFrom(atMs);
      }),
    );

    this.subscriptions.push(
      controller.events.on('restDue', ({ sittingMs }) => {
        this.showTheRest(sittingMs);
      }),
    );

    this.subscriptions.push(
      controller.events.on('engraving', ({ busy }) => {
        this.el.scoreEngraving.hidden = !busy;
        this.syncCard();
      }),
    );

    this.subscriptions.push(
      controller.events.on('beatsAhead', ({ beats }) => {
        this.runTheBeats(beats);
      }),
    );

    this.subscriptions.push(
      controller.events.on('replayEnded', () => {
        this.letGoOfTheReplay();
      }),
    );

    this.subscriptions.push(
      controller.events.on('freePlayed', () => {
        this.showTheFreePlay();
      }),
    );

    this.subscriptions.push(
      // A key played lights its row on the drawing, whatever the page is doing.
      this.runtime.recorder.events.on('keysChanged', () => {
        this.lightTheSoundingRows();
      }),
    );

    this.subscriptions.push(
      // The dot of each beat lit on the frame it is heard, as on a
      // metronome's own face; put out at once when the click stops.
      controller.events.on('freeClickPlaced', ({ beat, atMs }) => {
        if (beat === null) {
          this.beatsComing = [];
          this.lightTheHeardBeat(null);
          return;
        }
        this.beatsComing.push({ beat, atMs });
        this.lightTheBeatsOnTime();
      }),
    );

    this.subscriptions.push(
      controller.events.on('sessionDiscarded', () => {
        // Asked rather than assumed: this fires on the way into starting a
        // run as well as on the way out of one, and the answer differs.
        this.updateButtons(controller.session?.status ?? 'idle');
        this.showThePerformance();
      }),
    );

    this.subscriptions.push(
      controller.playbackEvents.on('positionChanged', (at) => {
        this.followMusic(at);
      }),
    );

    this.subscriptions.push(
      // Every way a performance begins, rather than only the button that
      // begins most of them. A repeat starts the next round from inside the
      // last one's `finished`, which the button knows nothing about - so the
      // transport went back to offering Listen, and Stop went grey, over a
      // performance that was playing.
      controller.playbackEvents.on('started', ({ stepIndex }) => {
        // Up before it is scrolled: a keyboard not shown has no width to
        // scroll across.
        this.applyKeyboardVisibility();
        // The first notes it will sound, from where it begins: a passage deep
        // in the piece was shown the keys of its first bar.
        const hand = controller.settings.handStaff;
        const firstStruck = controller.currentTimeline?.steps
          .slice(stepIndex)
          .find((step) => expectedFor(step, hand).length > 0);
        const notes = firstStruck === undefined ? [] : expectedFor(firstStruck, hand);
        const initialLowest = notes.length > 0 ? Math.min(...notes) : MIDDLE_C;
        const scrolled = scrollToShow(this.replayKeyboard, initialLowest);
        if (scrolled !== null) {
          this.replayKeyboard.scroller.scrollLeft = scrolled;
        }
        this.showThePerformance();
        this.markWhenPainted();
      }),
    );

    this.subscriptions.push(
      controller.playbackEvents.on('stepReached', ({ stepIndex }) => {
        this.showThePlaybackKeys(stepIndex);
        // Where it stands, told again at every step: a panel outside the
        // page carries the position on by itself, and a lap going round, a
        // change of tempo or a skip is where it would come to disagree.
        this.sayWhatIsSounding();
      }),
    );

    this.subscriptions.push(
      controller.playbackEvents.on('finished', () => {
        // A playback that counts itself in on every lap goes round from
        // here rather than inside the player: a count-in between laps is a
        // break by definition, and starting again is how a break is made.
        // Deferred for the reason the run's repeat is - beginning a
        // performance from inside its own finish is how re-entrancy bugs are
        // made, and this layer is the one with a timer.
        if (!controller.countsInEveryLap || !controller.playbackRepeats) {
          return;
        }
        setTimeout(() => {
          if (controller.countsInEveryLap && controller.playbackRepeats) {
            controller.listen();
          }
        }, 0);
      }),
    );

    this.subscriptions.push(
      // On to the next piece, where the playback goes on: deferred, for the
      // reason the lap above is.
      controller.playbackEvents.on('finished', () => {
        const asked = this.goingOn;
        setTimeout(() => {
          if (asked === this.goingOn && controller.playbackGoesOnFromHere !== 'this') {
            void this.goOnToAnotherPiece(1);
          }
        }, 0);
      }),
    );

    this.subscriptions.push(
      // Nothing to restart here any more. A repeating performance goes round
      // inside itself and never finishes, so this fires only when the music
      // has actually run out - and starting it again from here is where the
      // gap on a repeat came from: a stop and a start re-anchor the metronome
      // to the audio clock a fixed lead ahead of now.
      controller.playbackEvents.on('finished', () => {
        // The beats it had promised go with it: they were promises about a
        // performance that is over.
        this.forgetTheBeats();
        this.showThePerformance();
      }),
    );

    this.subscriptions.push(
      controller.events.on('healthChanged', ({ health, cause }) => {
        this.renderHealth(health, cause);
      }),
    );

    this.subscriptions.push(
      // Fired from inside the run's own `finished`, so it lands before the
      // report is drawn and the report can carry it.
      controller.events.on('ladderMoved', ({ to, direction }) => {
        this.lastLadderMove = { to, direction };
        this.syncControlsFromSettings();
      }),
    );

    this.subscriptions.push(
      controller.events.on('error', ({ error, context }) => {
        this.sayInTheMiddle(`${context}: ${error.message}`);
      }),
    );
  }

  private bindSession(session: PracticeSession): void {
    for (const unsubscribe of this.sessionSubscriptions) {
      unsubscribe();
    }
    this.sessionSubscriptions = [];

    this.sessionSubscriptions.push(
      session.events.on('statusChanged', ({ status }) => {
        this.updateButtons(status);
        this.keepDrainingWhileWaiting(status === 'running');
        this.letTheCursorsClose();
        // Playing a piece is the plainest way of saying it is the one being
        // worked on - and the only way to say it about a score the program
        // put on the stand by itself.
        const opened = this.runtime.controller.openedExercise;
        if (status === 'running' && opened !== null) {
          void this.runtime.scores.markRead(opened.title, Date.now());
        }
      }),
      // The number itself and nowhere else. It was said in words beside the
      // bar as well, which is the same count twice - and the words were in
      // the corner of an eye that is on the music.
      session.events.on('countIn', ({ beatsRemaining }) => {
        this.showCount(beatsRemaining);
      }),
      session.events.on('statusChanged', ({ status }) => {
        // The number in the middle of the page is the count-in and nothing
        // else, so every way out of counting in takes it away: the music
        // beginning, and equally the reader stopping the run while it counts.
        // Told by the first step of the music instead, a run stopped during
        // the count-in never reached one - and the number stood on the page
        // afterwards with nothing counting it down.
        if (status !== 'counting-in') {
          this.showCount(null);
        }
        // Restarting is the view's job, not the controller's: tearing a
        // session down from inside its own event is how re-entrancy bugs are
        // made, and the application layer has no timer to defer with.
        if (status === 'completed' && this.runtime.controller.settings.repeatRange) {
          setTimeout(() => {
            // Not over a rest that is owed: going round again is starting
            // something new, and his own note asks for the repeat to be held
            // when it is time to stop. The reading that was going finishes -
            // nothing is cut off - and then the page says so.
            if (this.runtime.controller.restIsOwed) {
              return;
            }
            if (this.runtime.controller.settings.repeatRange) {
              // Counted in again only where he asked for that: the first time
              // round is always counted in, and every one after it is a
              // question about how a passage is drilled.
              this.runtime.controller.start({
                countIn: this.runtime.controller.settings.countInRun === 'every',
              });
            }
          }, 0);
        }
      }),
      // Where the music is, which under the metronome goes on moving through a
      // held note - the step is what the reader has to play, not where the
      // count has got to, and the pill was asked the second question.
      session.events.on('positionChanged', (at) => {
        this.followMusic(at);
      }),
      session.events.on('finished', ({ report, score }) => {
        // Before the render, which empties the ladder move as it uses it.
        this.lastReading = { score, report, move: this.lastLadderMove };
        this.renderResult(score, report);
        // The run just measured what it measured; the delay control can say
        // so, and offer to settle itself from it.
        this.describeLatency();
      }),
    );
  }

  private bindMidi(): void {
    this.subscriptions.push(
      this.runtime.webMidi.onStatusChange((status) => {
        this.el.midiStatus.textContent = MIDI_STATUS_LABELS[status];
        this.el.midiStatus.className =
          status === 'connected'
            ? 'pill pill--connected'
            : status === 'denied' || status === 'error' || status === 'unsupported'
              ? 'pill pill--error'
              : 'pill pill--idle';
        this.renderMidiHint(status);
        this.refreshInputs();
      }),
    );

    this.subscriptions.push(this.runtime.webMidi.onInputsChanged(() => this.refreshInputs()));
    this.bindBridge();

    this.subscriptions.push(this.subscribeAudioFeedback());
    this.subscriptions.push(
      // Dragging a marker is how a passage is chosen at the stand, where the
      // bar boxes are out of reach and reading their numbers off the page is
      // work in itself.
      this.runtime.renderer.onPassageDragged((passage) => {
        void this.choosePassageFrom(passage);
      }),
    );

    this.subscriptions.push(
      // A touch on the music puts the markers away, and brings them back.
      // They are two lines across the staves and they are wanted only while
      // a passage is being chosen; the rest of the time they are furniture
      // standing in front of the notes.
      // Held on a bar: the reader is filling in the next mark that is
      // missing - where to start, then the two ends of the passage.
      // While a run is shown again it is the reader asking to see it from
      // there, not setting up the next one.
      this.runtime.renderer.onBarHeld((measureIndex) => {
        if (this.replayRoll !== null) {
          this.replayFromBar(measureIndex);
          return;
        }
        this.placeNextMark(measureIndex);
      }),
    );

    this.subscriptions.push(
      this.runtime.renderer.onMarkerHeld((end) => {
        this.closeOnto(end);
      }),
    );

    this.subscriptions.push(
      // However the page was turned - the music, the arrows, the arrow keys,
      // a bar chosen by hand - the numbers under the score have to agree
      // with it, and so does which arrow is left to press.
      this.runtime.renderer.onPagesChanged(() => {
        this.showThePages();
      }),
    );

    this.subscriptions.push(
      this.runtime.renderer.onScoreTapped(() => {
        this.passageMarkersWanted = !this.passageMarkersWanted;
        this.showPassageMarkers();
      }),
    );

  }

  /**
   * Surfaces the desktop relay, when the page was served by one.
   *
   * This is the path that makes a tablet usable, so its state has to be
   * visible: which computer, which keyboard, and whether notes can arrive.
   */
  private bindBridge(): void {
    const bridge = this.runtime.bridge;
    if (bridge === null) {
      this.el.bridgeStatus.hidden = true;
      return;
    }

    this.el.bridgeStatus.hidden = false;
    const render = (): void => {
      const status = bridge.status;
      const device = bridge.deviceName;
      this.el.bridgeStatus.textContent =
        status === 'connected'
          ? `Bridge: ${device ?? 'no keyboard'}${describeHop(bridge.hopSpreadMs)}`
          : status === 'connecting'
            ? 'Bridge: connecting…'
            : 'Bridge: offline';
      this.el.bridgeStatus.className =
        status === 'connected' && device !== null
          ? 'pill pill--connected'
          : status === 'connected'
            ? 'pill pill--idle'
            : 'pill pill--error';
      this.renderMidiHint(this.runtime.webMidi.status);
    };

    this.subscriptions.push(bridge.onStatusChange(render));
    this.subscriptions.push(bridge.onDeviceChange(render));
    // And as he plays, because the number is about the hop he is feeling now
    // rather than the one when the socket opened. Throttled: it is a pill,
    // and he is in the middle of a piece.
    let shownAt = 0;
    this.subscriptions.push(
      bridge.subscribe(() => {
        const now = this.runtime.clock.now();
        if (now - shownAt < HOP_REFRESH_MS) {
          return;
        }
        shownAt = now;
        render();
      }),
    );
    render();
    void bridge.connect();
  }

  /**
   * Explains a missing MIDI connection instead of just reporting it.
   *
   * iPadOS matters here: every browser on it is WebKit, and WebKit ships no
   * Web MIDI API, so "unsupported" is the normal state on the device this is
   * most likely to be practised on.
   */
  private renderMidiHint(status: MidiConnectionStatus): void {
    // A working bridge means notes are already arriving; telling the reader
    // that this browser lacks Web MIDI would be true but useless noise.
    if (this.runtime.bridge?.status === 'connected') {
      this.el.midiHint.hidden = true;
      return;
    }
    const hint = MIDI_HINTS[status];
    this.el.midiHint.textContent = hint ?? '';
    this.el.midiHint.hidden = hint === undefined;
  }

  /** Sounds the player's own keys for controllers without built-in audio. */
  private subscribeAudioFeedback(): Unsubscribe {
    const handler = (event: MidiEvent): void => {
      // Before the mute check: the recorder hears everything the keyboard
      // does, and silencing the monitor is not a decision to stop capturing.
      this.describeTake();
      // Before the mute check, and not inside it: that the pedal was *heard*
      // is not part of hearing the notes. A reader whose keyboard makes its
      // own sound turns the monitor off - which is the whole point of the
      // setting - and their pedal light then went out for good.
      if (event.type === 'pedal') {
        this.renderPedal(event.down);
      }
      if (!this.audioFeedbackEnabled) {
        return;
      }
      switch (event.type) {
        case 'noteon':
          this.runtime.pitchPlayer.play(event.midi, event.velocity);
          return;
        case 'noteoff':
          this.runtime.pitchPlayer.stop(event.midi);
          return;
        case 'pedal':
          // The dampers of the instrument *we* are sounding, which is a
          // different thing from the light and rightly follows the monitor.
          this.runtime.sustain?.setSustain(event.down);
          return;
        default:
          return;
      }
    };
    const fromHardware = this.runtime.webMidi.subscribe(handler);
    const fromKeyboard = this.runtime.computerKeyboard.subscribe(handler);
    const fromTheScreen = this.runtime.screenKeys.subscribe(handler);
    const fromBridge = this.runtime.bridge?.subscribe(handler) ?? (() => undefined);
    return () => {
      fromHardware();
      fromKeyboard();
      fromTheScreen();
      fromBridge();
    };
  }

  /**
   * Shows that the pedal was seen, which is half of trusting that it works.
   *
   * Nothing about it may change the layout, because it changes many times a
   * minute and the header it sits in wraps. Two goes at this were not enough:
   * the label used to gain a word when the pedal went down, and then the pill
   * itself was revealed on the first press - each widened the header and
   * dropped the row beneath it, mid-practice.
   *
   * So it is always present and always the same size, from the first paint.
   * The wrap is decided once, when the page loads, and never again; the state
   * is a dot's colour, and the word for it goes to the accessible name where
   * it costs no width. A reader with no pedal sees a dim one, which is true -
   * the app is listening for one and has not heard it.
   */
  private renderPedal(down: boolean): void {
    this.el.pedalStatus.dataset['down'] = String(down);
    this.el.pedalStatus.setAttribute(
      'aria-label',
      down ? 'Sustain pedal down' : 'Sustain pedal up',
    );
  }

  private refreshInputs(): void {
    const inputs = this.runtime.webMidi.inputs();
    const selected = this.runtime.webMidi.selectedInputId ?? '';
    this.el.midiInput.replaceChildren();
    const all = this.doc.createElement('option');
    all.value = '';
    all.textContent = inputs.length === 0 ? 'No devices' : 'All inputs';
    all.selected = selected === '';
    this.el.midiInput.append(all);
    for (const input of inputs) {
      const element = this.doc.createElement('option');
      element.value = input.id;
      element.textContent = input.name;
      element.selected = input.id === selected;
      this.el.midiInput.append(element);
    }
  }

  private async reload(fresh: boolean): Promise<void> {
    try {
      await (fresh
        ? this.runtime.controller.loadNewExercise()
        : this.runtime.controller.reloadExercise());
      // New material clears the practised bars, and a box still showing the
      // old ones would name a passage of a piece that is no longer open.
      this.syncControlsFromSettings();
      this.showVerdict(false);
    } catch (error) {
      this.sayInTheMiddle(
        error instanceof Error ? error.message : 'Failed to build an exercise.',
      );
    }
  }

  /**
   * Moves the marker along the ruler, beat by beat.
   *
   * The moments come from the run, which knows where the beats are and when
   * each of them falls; the timing is the view's, because the application
   * layer has no timer and should not grow one. In a mode that waits, this
   * is the only thing that moves between the reader's entries - which is
   * exactly the stretch a reader loses count in.
   *
   * Each announcement replaces the last: a new press is a new answer about
   * where the music is, and the beats promised from the old one were
   * promises about a moment that has been overtaken.
   */
  private runTheBeats(
    beats: readonly { readonly mark: RulerMark; readonly atMs: number }[],
  ): void {
    this.forgetTheBeats();
    const now = this.runtime.clock.now();
    for (const beat of beats) {
      const wait = Math.max(0, beat.atMs - now);
      this.beatTimers.push(
        setTimeout(() => {
          this.runtime.renderer.showBeat(beat.mark);
        }, wait),
      );
    }
  }

  /** Stops the beats that have not happened, and takes the marker off. */
  private forgetTheBeats(): void {
    for (const timer of this.beatTimers) {
      clearTimeout(timer);
    }
    this.beatTimers = [];
    this.runtime.renderer.showBeat(null);
  }

  /**
   * Puts a plain sentence where the verdict goes.
   *
   * Which is where a failure has to be said, because the panel it used to be
   * written into is not on the page in fullscreen at all - so the reader
   * whose import failed was told nothing whatsoever, on the layout they
   * actually practise in.
   */
  private sayInTheMiddle(message: string): void {
    this.el.result.replaceChildren(this.doc.createTextNode(message));
    this.el.drill.hidden = true;
    this.el.verdictFresh.hidden = true;
    this.showVerdict(true);
  }

  /**
   * Whether there is a network, said where it decides anything.
   *
   * The application itself is on the device - it is kept there by a worker,
   * which is the whole of his "open it without the internet" - so the only
   * thing a lost network costs is a recording not yet fetched. Said here, by
   * the control that asks for them, and said plainly rather than as an alarm:
   * offline is a fact about the room, not a fault.
   */
  private showTheNetwork(): void {
    const online = this.doc.defaultView?.navigator.onLine ?? true;
    this.el.networkState.textContent = online
      ? 'Online: recordings not yet fetched can still be downloaded.'
      : 'Offline: the recordings already fetched still play; the rest will wait.';
    this.el.networkState.dataset['online'] = String(online);
  }

  /** Applies and remembers when the recordings should be fetched. */
  private applySampleLoading(mode: SampleLoading): void {
    this.el.sampleLoading.value = mode;
    this.el.sampleLoadingHint.textContent = SAMPLE_LOADING_HINTS[mode];
    this.runtime.samples?.setLoading(mode);
    this.runtime.settings.saveAudio({
      ...this.runtime.settings.currentAudio,
      sampleLoading: mode,
    });
  }

  /**
   * Accepts a bar count from either the slider or the box.
   *
   * Typed input can be empty, negative or absurd, so it is clamped to what the
   * generator will actually accept and both controls are put back in step.
   */
  private applyMeasures(requested: number): void {
    const bounded = Number.isFinite(requested)
      ? Math.min(MAX_BARS, Math.max(MIN_BARS, Math.round(requested)))
      : this.runtime.controller.settings.measures;

    this.el.measures.value = String(bounded);
    this.el.measuresValue.value = String(bounded);

    if (bounded === this.runtime.controller.settings.measures) {
      return;
    }
    this.runtime.controller.updateSettings({ measures: bounded });
    void this.reload(true);
  }

  /**
   * Pushes both sliders into the audio sources.
   *
   * Called on restore as well as on change, so the sound always matches what
   * the sliders show - reading the stored value into the DOM alone would
   * leave the audio at its construction default.
   */
  /**
   * Applies the two input switches, and remembers them.
   *
   * Both were view state and nothing else, so every reload silently turned
   * the computer keyboard back on and the monitor with it. They describe the
   * desk rather than the exercise, which is why they live beside the volumes.
   */
  private applyInputSettings(persist: boolean): void {
    this.audioFeedbackEnabled = this.el.audioFeedback.checked;
    if (!this.audioFeedbackEnabled) {
      this.runtime.pitchPlayer.stopAll();
    }
    if (this.el.computerKeyboard.checked) {
      this.runtime.computerKeyboard.enable();
    } else {
      this.runtime.computerKeyboard.disable();
    }
    if (persist) {
      this.runtime.settings.saveAudio({
        ...this.runtime.settings.currentAudio,
        audioFeedback: this.el.audioFeedback.checked,
        computerKeyboard: this.el.computerKeyboard.checked,
      });
    }
  }

  private applyVolumes(persist: boolean): void {
    const metronome = Number.parseInt(this.el.metronomeVolume.value, 10) / 100;
    const instrument = Number.parseInt(this.el.instrumentVolume.value, 10) / 100;

    this.el.metronomeVolumeValue.value = this.el.metronomeVolume.value;
    this.el.soundMetronomeVolume.value = this.el.metronomeVolume.value;
    this.el.soundMetronomeVolumeValue.value = this.el.metronomeVolume.value;
    this.el.instrumentVolumeValue.value = this.el.instrumentVolume.value;

    this.runtime.metronomeVolume.setVolume(metronome);
    this.runtime.instrumentVolume.setVolume(instrument);

    if (persist) {
      this.runtime.settings.saveAudio({
        ...this.runtime.settings.currentAudio,
        metronomeVolume: metronome,
        instrumentVolume: instrument,
      });
    }
  }

  /** Puts one pane of the settings in front of the reader, whichever way it was asked for. */
  private showTheSettingsPane(pane: string): void {
    const panel = this.el.sheetSettings.querySelector('.sheet__panel');
    if (panel instanceof HTMLElement) {
      panel.dataset['showing'] = pane;
    }
    for (const tab of this.el.settingsSections.querySelectorAll('button[data-chooses]')) {
      tab.setAttribute('aria-pressed', String(tab.getAttribute('data-chooses') === pane));
    }
    // Signing in to the drive opens Google's window, which a browser allows
    // only in answer to a press - so what it needs is fetched when the pane
    // with the button is opened, not when it is pressed.
    if (pane === 'library') {
      this.runtime.cloudDrive.prepare();
      // Weighed when it is looked at, which is when the question is asked.
      void this.showWhatIsKept();
    }
  }

  /**
   * Searches the settings as the reader types, and goes from one finding to
   * the next.
   *
   * Every pane is searched and the one a finding is in is opened to show it,
   * because what cannot be found is usually in a pane not being looked at.
   * The words are marked where the browser can mark text without touching the
   * page - which leaves every label and checkbox exactly as it was - and
   * where it cannot, going to them still opens the pane and brings them into
   * view.
   */
  private bindTheSettingsSearch(): void {
    this.listen(this.el.settingsSearch, 'input', () => {
      this.searchTheSettings();
    });
    this.listen(this.el.settingsSearch, 'keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Enter') {
        return;
      }
      event.preventDefault();
      this.goToFinding((event as KeyboardEvent).shiftKey ? -1 : 1);
    });
    this.listen(this.el.settingsSearchNext, 'click', () => {
      this.goToFinding(1);
    });
    this.listen(this.el.settingsSearchPrevious, 'click', () => {
      this.goToFinding(-1);
    });
  }

  private searchTheSettings(): void {
    const controls = this.el.sheetSettings.querySelector('.controls');
    this.found = controls === null ? [] : findAll(wordsIn(controls), this.el.settingsSearch.value);
    this.foundAt = -1;
    this.goToFinding(1);
  }

  /** The next finding, or the one before, round from the end to the start. */
  private goToFinding(step: 1 | -1): void {
    const count = this.found.length;
    this.foundAt = count === 0 ? -1 : (this.foundAt + step + count) % count;
    const here = this.found[this.foundAt];
    this.el.settingsSearchCount.value =
      count === 0
        ? this.el.settingsSearch.value.trim() === ''
          ? ''
          : 'None'
        : `${String(this.foundAt + 1)} / ${String(count)}`;
    this.markTheFindings(here);
    if (here === undefined) {
      return;
    }
    const where = here.node.parentElement;
    const pane = where?.closest<HTMLElement>('[data-pane]')?.dataset['pane']?.split(/\s+/)[0];
    if (pane !== undefined) {
      this.showTheSettingsPane(pane);
    }
    where?.scrollIntoView?.({ block: 'center' });
  }

  /** Marks every finding, and the one gone to more strongly - where the browser can. */
  private markTheFindings(here: Found | undefined): void {
    const view = this.doc.defaultView as
      | (Window & {
          CSS?: { highlights?: Map<string, unknown> };
          Highlight?: new (...ranges: Range[]) => unknown;
        })
      | null;
    const highlights = view?.CSS?.highlights;
    const Highlight = view?.Highlight;
    if (highlights === undefined || Highlight === undefined) {
      return;
    }
    const range = (found: Found): Range => {
      const made = this.doc.createRange();
      made.setStart(found.node, found.start);
      made.setEnd(found.node, found.end);
      return made;
    };
    highlights.set('settings-found', new Highlight(...this.found.map(range)));
    if (here === undefined) {
      highlights.delete('settings-found-here');
      return;
    }
    highlights.set('settings-found-here', new Highlight(range(here)));
  }

  /**
   * Makes the library the same here as on the drive, and says what happened.
   *
   * The scores the drive has and this device does not are listed rather than
   * brought: what is kept here is the reader's choice.
   */
  private async signInWithACode(): Promise<void> {
    this.el.driveCode.disabled = true;
    this.el.driveStatus.textContent = 'Asking Google for a code…';
    try {
      await this.runtime.codeSignIn.signInWithCode(({ code, url }) => {
        this.el.driveStatus.textContent = `On a phone or a computer, open ${url} and enter ${code}`;
      });
    } catch (error) {
      this.el.driveStatus.textContent =
        error instanceof Error ? error.message : 'Google did not let the trainer in.';
      return;
    } finally {
      this.el.driveCode.disabled = false;
    }
    await this.syncWithTheDrive();
  }

  private async syncWithTheDrive(): Promise<void> {
    this.syncing = true;
    const change = this.runtime.driveSync.latestChangeAtMs;
    this.el.driveSync.disabled = true;
    this.el.scoreSync.disabled = true;
    this.showHowFarTheSyncHasGot({ answered: 0, expected: null });
    this.offerToSync();
    try {
      // The sketch open on the page is left as it is, to be settled at the
      // next sync - where it has a change to undo, which is of the notes
      // here. With none, there is nothing of it to lose: what the drive has
      // newer is taken, and shown, as the page opened on it from another
      // device's last sketch has to be.
      const open = (): string | null => {
        const sketch = this.el.sheetRoll.hidden ? undefined : this.theOtherRollShowing?.sketch;
        if (sketch === undefined) {
          return null;
        }
        if (sketch.before.length === 0 && sketch.after.length === 0) {
          this.sketchTakenUnderTheEditor = sketch.id;
          return null;
        }
        return sketch.id;
      };
      const { library, settings, sketches } = await this.runtime.driveSync.sync((shown) => {
        this.showHowFarTheSyncHasGot(shown);
      }, open);
      if (sketches.brought > 0) {
        this.showTheSketchTakenUnderTheEditor();
      }
      this.el.driveStatus.textContent = `Synced. Sent ${String(library.sent)}, brought here ${String(library.brought)}. ${theSketchesSynced(sketches)} Settings ${SETTINGS_WENT[settings]}.`;
      this.showWhatOnlyTheDriveHas(library.onlyOnTheDrive);
      this.showTheSketchesOnlyTheDriveHas(sketches.onlyOnTheDrive);
      this.renderScores();
      this.renderSketches();
      // Chords kept on another device are in the drawer, if it is open.
      this.showTheChordsOfTheKey();
    } catch (error) {
      const why = error instanceof Error ? error.message : 'Google Drive could not be reached.';
      this.el.driveStatus.textContent = why;
      this.syncFailed = { change, why };
    } finally {
      this.syncing = false;
      this.sketchTakenUnderTheEditor = null;
      this.showHowFarTheSyncHasGot(null);
      this.el.driveSync.disabled = false;
      this.el.scoreSync.disabled = false;
      this.offerToSync();
    }
  }

  /**
   * Says how far the sync under way has got, as the share of its requests
   * to the drive answered: round the edge of the button by the clock, and
   * in words in the settings. Before it is known how many there will be,
   * the edge breathes and the words say only that it syncs. `null` once
   * none is under way.
   */
  private showHowFarTheSyncHasGot(shown: SyncProgressShown | null): void {
    const button = this.el.scoreSync;
    const share = shown === null || shown.expected === null ? null : shown.answered / shown.expected;
    if (share === null) {
      button.style.removeProperty('--sync-share');
    } else {
      button.style.setProperty('--sync-share', share.toFixed(3));
    }
    if (shown === null) {
      delete button.dataset['syncMeasured'];
      return;
    }
    button.dataset['syncMeasured'] = String(share !== null);
    this.el.driveStatus.textContent = share === null ? 'Syncing…' : `Syncing… ${String(Math.round(share * 100))}%`;
  }

  /**
   * Draws the sketch open in the editor again as the sync has left it, where
   * the drive's was taken underneath it: the notes chosen let go of, since
   * they were chosen among notes that are not there now.
   */
  private showTheSketchTakenUnderTheEditor(): void {
    const id = this.sketchTakenUnderTheEditor;
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = id === null ? null : this.runtime.sketches.find(id);
    if (showing === null || sketch?.id !== id || stored === null) {
      return;
    }
    this.holdTheRoll();
    const roll = rollOfTheTake(stored, ROOM_IN_A_SKETCH);
    this.theOtherRollShowing = { ...showing, roll, barLabel: barsCountedOnItsBeats(roll), sketch: { ...sketch, chosen: [] } };
    this.drawTheRollInto();
    this.sayWhatCanBeChanged();
  }

  /**
   * Syncs without a press as the page is opened and each time it is come
   * back to - from the other device, as often as not, with what was done
   * there waiting on the drive, which is not asked otherwise until something
   * changes here. Only where the drive can be asked without a press - Google
   * opens a window for one, and a window needs a press - and where syncing
   * was asked for; not during a run, nor while one is under way. Coming and
   * going between windows, at most once a minute.
   */
  private syncOnComingBack(): void {
    const now = Date.now();
    if (
      this.doc.visibilityState === 'hidden' ||
      !this.runtime.controller.settings.offerToSync ||
      !this.runtime.cloudDrive.signedIn ||
      this.syncing ||
      this.isPlaying ||
      this.runtime.controller.isListening ||
      (this.syncedOnComingBackAtMs !== null && now - this.syncedOnComingBackAtMs < SYNCED_ON_COMING_BACK_AT_MOST_EVERY_MS)
    ) {
      return;
    }
    this.syncedOnComingBackAtMs = now;
    void this.syncWithTheDrive();
  }

  /** Stands the Sync button by the clock or takes it away, and sets it to press itself. */
  private offerToSync(): void {
    this.standTheSyncButton();
    this.pressTheSyncButtonSoon();
  }

  /**
   * Stands the Sync button by the clock, or takes it away.
   *
   * Where he asked for it, while this device has something the drive has not
   * had, and only between runs - the corner's rule, since over the music is
   * not where anything but the music belongs. A sync that failed sent
   * nothing, so what there was to send is still there and the button stays:
   * its label says it failed, and pressing it again is the retry.
   */
  private standTheSyncButton(): void {
    const idle = !this.isPlaying && !this.runtime.controller.isListening;
    this.el.scoreSync.hidden =
      !this.runtime.controller.settings.offerToSync ||
      !idle ||
      !this.runtime.driveSync.hasSomethingToSync;
    this.sayWhatTheSyncButtonDoes();
  }

  /**
   * Whether the button will press itself, said on it.
   *
   * It presses itself only while Google lets the trainer in without asking:
   * signing in opens Google's window, and a browser allows that only in
   * answer to a press - so after the page is opened again, or once Google's
   * hour is up, it waits for one. And not again on a change it already failed
   * on. In both cases it says so, in the colour of something waiting on the
   * reader, since a button that looks the same whether or not it will press
   * itself is a sync he would believe had happened. His: "якось помітити
   * кнопку що auto sync не працює".
   */
  private sayWhatTheSyncButtonDoes(): void {
    const button = this.el.scoreSync;
    const failed = this.failedOnThisChange();
    const [state, text, title] = this.syncing
      ? ['syncing', 'Syncing…', 'Syncing with Google Drive']
      : failed !== null
        ? ['by-hand', 'Sync failed', failed]
        : !this.runtime.cloudDrive.signedIn
          ? [
              'by-hand',
              'Tap to sync',
              'Google asks for a press to let the trainer in, so this waits for one before it can sync on its own again.',
            ]
          : [
              'on-its-own',
              'Sync',
              'Syncs on its own half a minute after the last change, or now if pressed.',
            ];
    button.dataset['sync'] = state;
    this.el.scoreSyncText.textContent = text;
    button.title = title;
  }

  /** Why the last sync failed, while nothing has changed since to try again for. */
  private failedOnThisChange(): string | null {
    const failed = this.syncFailed;
    return failed !== null && failed.change === this.runtime.driveSync.latestChangeAtMs
      ? failed.why
      : null;
  }

  /**
   * Presses the Sync button half a minute after the last change, where it is
   * standing and can.
   *
   * Set from the moment of the change rather than from whenever this is
   * asked, so being asked again - which the clock does every few seconds -
   * never puts it off; only a new change does. His: "я хочу щоб ця кнопка сама
   * натискалася 30 секунд".
   */
  private pressTheSyncButtonSoon(): void {
    if (this.syncTimer !== null) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    const due = this.runtime.driveSync.dueAtMs;
    if (due === null) {
      return;
    }
    this.syncTimer = setTimeout(
      () => {
        this.syncTimer = null;
        // Whether it may is asked when it is due and not before: a run may
        // have begun, or Google's hour run out, in the half minute between.
        this.standTheSyncButton();
        if (!this.el.scoreSync.hidden && this.el.scoreSync.dataset['sync'] === 'on-its-own') {
          void this.syncWithTheDrive();
        }
      },
      Math.max(0, due - Date.now()),
    );
  }

  /**
   * The sketches the drive has and this device does not, each to bring here
   * or take off the drive - as the scores are offered, under a line of their own.
   */
  private showTheSketchesOnlyTheDriveHas(sketches: readonly SketchOnTheDrive[]): void {
    const list = this.el.driveOnlySketches;
    const sayWhetherAny = (): void => {
      list.hidden = list.childElementCount === 0;
      this.el.driveOnlySketchesSaid.hidden = list.hidden;
    };
    list.replaceChildren(
      ...sketches.map((sketch) =>
        this.anOfferFromTheDrive({
          said: `${sketch.title} · ${String(sketch.noteCount)} notes`,
          name: sketch.title,
          bring: () =>
            this.runtime.sketchSync.bringHere(sketch.id).then(() => {
              this.renderSketches();
            }),
          notBrought: 'That sketch could not be brought here.',
          remove: () => this.runtime.sketchSync.deleteFromTheDrive(sketch.id),
          notRemoved: 'That sketch could not be taken off the drive.',
          gone: sayWhetherAny,
        }),
      ),
    );
    sayWhetherAny();
  }

  /** The scores only the drive has, each to bring here or take off the drive. */
  private showWhatOnlyTheDriveHas(scores: readonly DriveScore[]): void {
    const list = this.el.driveOnly;
    list.replaceChildren(
      ...scores.map((score) =>
        this.anOfferFromTheDrive({
          said: score.stars === undefined ? score.title : `${score.title} · ${String(score.stars)}★`,
          name: score.title,
          bring: () =>
            this.runtime.librarySync.bringHere(score).then(() => {
              this.renderScores();
            }),
          notBrought: 'That score could not be brought here.',
          remove: () => this.runtime.librarySync.deleteFromTheDrive(score),
          notRemoved: 'That score could not be taken off the drive.',
          gone: () => {
            list.hidden = list.childElementCount === 0;
          },
        }),
      ),
    );
    list.hidden = scores.length === 0;
  }

  /**
   * A row of a list of what only the drive has: what it is, and two icons,
   * since the pane is narrow and the words would crowd the name out - one
   * to bring it here, one to take it off the drive once the word is typed.
   * Either done, the row goes and the list is told; refused, the drive's
   * reason is said where the sync's is, and both can be pressed again.
   */
  private anOfferFromTheDrive(offer: {
    readonly said: string;
    readonly name: string;
    readonly bring: () => Promise<void>;
    readonly notBrought: string;
    readonly remove: () => Promise<void>;
    readonly notRemoved: string;
    readonly gone: () => void;
  }): HTMLLIElement {
    const row = this.doc.createElement('li');
    const title = this.doc.createElement('span');
    title.textContent = offer.said;
    const bring = this.anIconButton(BRING_HERE_ICON, 'Bring here', `Bring ${offer.name} here`);
    const remove = this.anIconButton(TRASH_ICON, 'Delete from the drive', `Delete ${offer.name} from the drive`);
    const ways = this.doc.createElement('span');
    ways.className = 'drive-only__ways';
    ways.append(bring, remove);
    const ask = (done: () => Promise<void>, refused: string): void => {
      bring.disabled = true;
      remove.disabled = true;
      void done()
        .then(() => {
          row.remove();
          offer.gone();
        })
        .catch((error: unknown) => {
          bring.disabled = false;
          remove.disabled = false;
          this.el.driveStatus.textContent = error instanceof Error ? error.message : refused;
        });
    };
    bring.addEventListener('click', () => {
      ask(offer.bring, offer.notBrought);
    });
    remove.addEventListener('click', () => {
      void this.askToTypeIt(
        `Delete ${offer.name} from the drive? A device that still has it will send it back at its next sync.`,
      ).then((yes) => {
        if (yes) {
          ask(offer.remove, offer.notRemoved);
        }
      });
    });
    row.append(title, ways);
    return row;
  }

  /** A button drawn as an icon alone, saying what it does in its title and to a screen reader. */
  private anIconButton(icon: string, title: string, label: string): HTMLButtonElement {
    const button = this.doc.createElement('button');
    button.type = 'button';
    button.className = 'button button--ghost drive-only__way';
    button.title = title;
    button.setAttribute('aria-label', label);
    const drawn = this.doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    drawn.setAttribute('viewBox', '0 0 24 24');
    drawn.setAttribute('aria-hidden', 'true');
    drawn.setAttribute('focusable', 'false');
    drawn.setAttribute('class', 'take-transport__icon');
    const path = this.doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', icon);
    drawn.append(path);
    button.append(drawn);
    return button;
  }

  /**
   * Weighs what the device keeps for the trainer, and draws it as a bar of
   * its parts and the room left, with a legend under it.
   *
   * Asked when the pane is opened, not watched: whether there is room, what
   * is taking it and whether it will be kept is the question, and it is the
   * reader's to ask. Weighing reads the offline copy back, some tens of
   * megabytes, so a second opening while one is going waits for it.
   */
  private async showWhatIsKept(): Promise<void> {
    if (this.weighing) {
      return;
    }
    this.weighing = true;
    this.el.storageTotal.textContent = 'Weighing…';
    try {
      const account = theStorageAccount(await this.runtime.storage.read());
      this.el.storageTotal.textContent = account.total;
      drawTheShareBar(
        this.el.storageBar,
        this.el.storageLegend,
        account.pieces.map((piece) => ({
          kind: piece.kind,
          name: piece.name,
          amount: piece.bytes,
          said:
            piece.count === null ? sizeOf(piece.bytes) : `${sizeOf(piece.bytes)} · ${String(piece.count)}`,
        })),
      );
      this.el.storageKept.textContent = account.kept;
      this.el.storageSmall.textContent = account.small;
    } finally {
      this.weighing = false;
    }
  }

  private syncControlsFromSettings(): void {
    const settings = this.runtime.controller.settings;
    this.el.preset.value = settings.presetId;
    this.el.rhythm.value = settings.rhythmProfileId;
    this.el.key.value = keyValue(settings.key);
    this.el.timeSignature.value = settings.timeSignature.toString();
    // After the settings' own key, which a rung that draws does not use.
    const draws = this.runtime.controller.ladderStep?.draws;
    offerTheDraw(
      this.el.preset,
      draws?.materials === undefined
        ? null
        : drawnFrom(
            draws.materials.map((id) => this.runtime.presets.get(id).label),
            'materials',
          ),
    );
    offerTheDraw(
      this.el.key,
      draws?.keys === undefined ? null : drawnFrom(draws.keys.map((key) => key.name), 'keys'),
    );
    offerTheDraw(
      this.el.timeSignature,
      draws?.times === undefined ? null : drawnFrom(draws.times.map(String), 'metres'),
    );
    this.el.measures.value = String(settings.measures);
    this.el.measuresValue.value = String(settings.measures);
    this.el.tempo.value = String(this.runtime.controller.tempoBpm);
    this.describeTempo();
    this.el.tempoValue.value = String(this.runtime.controller.tempoBpm);
    this.describeHands(settings.handStaff);
    this.el.click.value = settings.clickPattern;
    this.el.clickDescription.textContent = CLICK_DESCRIPTIONS[settings.clickPattern];
    // Shown, not dimmed: it is a question about the notes and nothing else.
    this.el.clickNotesGroup.hidden = settings.clickPattern !== 'notes';
    this.el.clickNotes.value = settings.clickNotesOf;
    this.el.dropout.value = settings.clickWhen;
    this.describeDropout();
    this.describePassageRange();
    // Here as well as on a new engraving: the repeat button changes what the
    // markers say without changing what is on the page.
    this.showPassageMarkers();
    this.describeTheRepeat();
    this.describeWhatPlaysNext();
    this.el.preview.value = String(settings.previewSeconds);
    this.el.previewValue.value = String(settings.previewSeconds);
    this.el.countIn.value = String(settings.countInBars);
    this.el.countInValue.value = String(settings.countInBars);
    this.el.tolerance.value = String(settings.matchToleranceMs);
    this.el.toleranceValue.value = String(settings.matchToleranceMs);
    this.el.latency.value = String(settings.inputLatencyMs);
    this.describeLatency();
    this.el.zoom.value = String(Math.round(settings.zoom * 100));
    this.describeZoom();
    this.el.zoomValue.value = this.el.zoom.value;
    this.el.showPlayed.value = settings.playedNotes;
    this.el.theme.value = settings.theme;
    this.el.darkSystemTheme.value = settings.darkSystemTheme;
    // Said on the root, where the stylesheet's tokens are, and said as they
    // are: which of them the system's theme makes of System is the
    // stylesheet's to ask the system, so a change of it needs nobody here.
    this.doc.documentElement.dataset['theme'] = settings.theme;
    this.doc.documentElement.dataset['darkSystem'] = settings.darkSystemTheme;
    this.el.showPlayedDescription.textContent = PLAYED_NOTE_DESCRIPTIONS[settings.playedNotes];
    this.el.readAhead.value = readAheadValue(settings.readAheadSteps);
    this.el.readAheadDescription.textContent =
      READ_AHEAD_DESCRIPTIONS[this.el.readAhead.value] ?? '';
    this.el.cursorListening.checked = settings.cursorWhileListening;
    this.el.cursorRest.checked = settings.cursorAtRest;
    this.el.pagedScore.checked = settings.pagedScore;
    this.el.repeatNumbers.checked = settings.showRepeatNumbers;
    // The switch as well as the box, and from here: this is where every setting
    // reaches the page, so a reader who left it on finds it on the next visit
    // without having touched it.
    this.el.traceTheStart.checked = settings.traceTheStart;
    traceTheStart(settings.traceTheStart);
    // Said on the page rather than drawn again: the marks belong to the
    // engraving and outlive a setting being changed, so what changes is
    // whether they are shown - no re-engraving for a checkbox.
    this.doc.body.dataset['repeats'] = settings.showRepeatNumbers ? 'shown' : 'hidden';
    this.runtime.renderer.setPaged(settings.pagedScore);
    this.el.pitchClass.checked = settings.pitchClassOnly;
    this.el.playingAhead.value = settings.playingAhead;
    this.el.offerToSync.checked = settings.offerToSync;
    this.el.immediateStart.checked = settings.immediateStart;
    this.el.dimUnplayed.checked = settings.dimUnplayed;
    this.renderPassages();
    this.el.clickSilences.value = settings.clickSilences;
    this.el.clickSilencesDescription.textContent =
      CLICK_SILENCE_DESCRIPTIONS[settings.clickSilences];
    this.el.countInRun.value = settings.countInRun;
    this.el.countInPlayback.value = settings.countInPlayback;
    this.el.countInPlaybackDescription.textContent =
      COUNT_IN_PLAYBACK_DESCRIPTIONS[settings.countInPlayback];
    this.el.pageTurns.value = settings.pageTurns;
    this.el.pageTurnsDescription.textContent = PAGE_TURN_DESCRIPTIONS[settings.pageTurns];
    // Said rather than hidden: the answer means nothing while the score is
    // one long strip, and a control that disappears is one the reader goes
    // looking for.
    this.el.pageTurns.disabled = !settings.pagedScore;
    this.runtime.renderer.turnPagesWithTheMusic(settings.pageTurns !== 'manual');
    this.showThePages();
    this.el.hearOtherHand.checked = settings.hearTheOtherHand;
    this.el.rushingCounts.checked = settings.rushingCounts;
    this.el.markListening.checked = settings.markWhileListening;
    this.showTheModes();
    this.showTheListening();
    this.applyKeyboardVisibility();
    this.dimWhatHasNothingToSay();
    this.el.showPlaybackNotes.checked = settings.showPlaybackNotes;
    this.el.rollScrollPlayback.checked = settings.rollScrollPlayback;
    this.sayWhereTheHeadStands();
    this.el.restEvery.value = String(settings.restEveryMinutes);
    this.el.restEverySettings.value = this.el.restEvery.value;
    this.el.rulerCursor.checked = settings.rulerCursor;
    this.el.rulerStrength.value = String(Math.round(settings.rulerStrength * 100));
    this.el.rulerStrengthValue.value = this.el.rulerStrength.value;
    // A display decision, so the stylesheet is told and does the rest: the
    // three weights keep their difference from one another whatever it is
    // turned down to.
    this.el.score.style.setProperty('--ruler-strength', String(settings.rulerStrength));
    this.el.rhythmRuler.value = settings.rhythmRuler;
    this.el.rhythmRulerDescription.textContent = RULER_DESCRIPTIONS[settings.rhythmRuler];
    this.el.whatOpens.value = settings.whatOpens;
    this.el.whatOpensDescription.textContent = OPENING_DESCRIPTIONS[settings.whatOpens];
    this.el.metronomeTap.value = settings.metronomeTap;
    this.el.metronomeTapDescription.textContent = METRONOME_TAP_DESCRIPTIONS[settings.metronomeTap];
    this.applyPreview();
    this.describeMetronomeButton(settings);
    this.describeTheFreeBeats(settings);
    // What it would take, said before it is pressed.
    const fromThePiece = this.runtime.controller.theFreeClickOfThePiece();
    this.el.freeFromScore.title =
      fromThePiece === null
        ? 'Beat as the score on the page does'
        : `Beat as the score on the page does: ${countOf(fromThePiece.beats.length, 'beat')} a bar at ${String(fromThePiece.bpm)}`;
    this.el.freeFromScore.setAttribute('aria-label', this.el.freeFromScore.title);
    this.renderHealth(this.runtime.controller.health);
    this.describeLadder();
    this.showTheRung();
    this.applyScoreCover();
    this.el.presetDescription.textContent = this.runtime.presets.get(settings.presetId).description;
    this.el.rhythmDescription.textContent = this.runtime.rhythms.get(
      settings.rhythmProfileId,
    ).description;

    const audio = this.runtime.settings.currentAudio;
    this.el.audioFeedback.checked = audio.audioFeedback;
    this.el.computerKeyboard.checked = audio.computerKeyboard;
    this.applyInputSettings(false);
    this.el.metronomeVolume.value = String(Math.round(audio.metronomeVolume * 100));
    this.el.metronomeVolumeValue.value = this.el.metronomeVolume.value;
    this.el.instrumentVolume.value = String(Math.round(audio.instrumentVolume * 100));
    this.el.instrumentVolumeValue.value = this.el.instrumentVolume.value;
    this.applyVolumes(false);

    const mode = this.runtime.settings.currentAudio.sampleLoading;
    this.el.sampleLoading.value = mode;
    this.el.sampleLoadingHint.textContent = SAMPLE_LOADING_HINTS[mode];
    this.runtime.samples?.setLoading(mode);

  }

  /**
   * Restates what the dropout choice means for the count-in now set.
   *
   * Its own method because two controls change the answer: the dropout menu
   * and the count-in slider, which would otherwise leave the line lying.
   */
  private describeDropout(): void {
    const settings = this.runtime.controller.settings;
    this.el.dropoutDescription.textContent = dropoutDescription(
      settings.clickWhen,
      settings.countInBars,
    );
  }

  /**
   * Steps the reader along the route and loads what the new rung asks for.
   *
   * The arrows are a decision to read something else *now*, unlike a
   * promotion, which arrives with a report the reader is still looking at.
   */
  private moveLadder(offset: number): void {
    if (this.runtime.controller.moveLadder(offset) === null) {
      return;
    }
    this.syncControlsFromSettings();
    void this.reload(true);
  }

  /**
   * A button for each grade, from the ladder's own list of them.
   *
   * Choosing one puts the reader on its first rung and writes a page there,
   * as the arrows do: a grade is a decision to read something else now.
   */
  private layTheGrades(): void {
    const { controller, ladder } = this.runtime;
    this.el.grades.replaceChildren(
      ...ladder.gradesInOrder().map((grade) => {
        const button = this.doc.createElement('button');
        button.type = 'button';
        button.className = 'grades__grade';
        button.dataset['grade'] = grade.id;
        button.textContent = grade.short;
        button.title = grade.label;
        button.setAttribute('aria-label', grade.label);
        this.listen(button, 'click', () => {
          const first = ladder.firstOf(grade.id);
          if (first === null || controller.selectLadderStep(first.id) === null) {
            return;
          }
          this.syncControlsFromSettings();
          void this.reload(true);
        });
        return button;
      }),
    );
  }

  /** Names the rung, or says plainly that the reader has left the route. */
  private describeLadder(): void {
    const { controller, ladder } = this.runtime;
    const step = controller.ladderStep;
    const gradeId = step?.grade ?? null;
    for (const button of this.el.grades.querySelectorAll<HTMLElement>('.grades__grade')) {
      button.setAttribute('aria-pressed', String(button.dataset['grade'] === gradeId));
    }
    if (step === null) {
      this.el.ladderStep.textContent = 'Off the ladder';
      this.el.ladderDescription.textContent =
        'The settings below were chosen by hand. A grade or the arrows put you back on.';
      this.el.gradeNew.textContent = '';
      this.el.gradeNotYet.textContent = '';
      this.el.scoresRung.textContent = 'Off the ladder — the settings were chosen by hand';
      this.el.ladderDown.disabled = false;
      this.el.ladderUp.disabled = false;
      return;
    }
    this.el.ladderStep.textContent = `${step.label}, ${ladder.positionOf(step.id)} of ${ladder.list().length}`;
    const grade = ladder.gradeOf(step);
    this.el.ladderDescription.textContent = step.description;
    // What the grade adds, and what a test at it would have that these pages
    // cannot write yet: said, so the top of a grade does not claim all of it.
    this.el.gradeNew.textContent = `New at ${grade.label}: ${listedInWords(grade.newHere)}.`;
    this.el.gradeNotYet.textContent =
      grade.notYet.length === 0 ? '' : `Not written here yet: ${listedInWords(grade.notYet)}.`;
    this.el.scoresRung.textContent = `${step.label} — ${step.description}`;
    this.el.ladderDown.disabled = !ladder.canStep(step.id, -1);
    this.el.ladderUp.disabled = !ladder.canStep(step.id, 1);
  }

  /**
   * Where the reader stands on the ladder, or `null` off it.
   *
   * The two neighbours are the rungs the arrows would go to, and none where
   * there is nowhere further that way.
   */
  private placeOnTheLadder(): PlaceOnTheLadder | null {
    const { controller, ladder } = this.runtime;
    const step = controller.ladderStep;
    if (step === null) {
      return null;
    }
    const neighbour = (offset: number): string | null =>
      ladder.canStep(step.id, offset) ? ladder.step(step.id, offset).label : null;
    return {
      here: step.label,
      below: neighbour(-1),
      above: neighbour(1),
      streak: controller.settings.ladderStreak,
      toMove: LADDER_RUNS_TO_MOVE,
    };
  }

  /** Whether the music on the stand is a generated page rather than a score. */
  private aGeneratedPageIsOpen(): boolean {
    return !this.runtime.controller.pieceKey.startsWith('score:');
  }

  /**
   * The rung after the page's title, and the track in the sheet of what an
   * exercise is made of.
   *
   * On the page only over a generated one: a score is not on the ladder. The
   * sheet whatever is open, since what it sets is the next generated page,
   * and with the rungs either side named - without them the marks look the
   * same on every rung, since arriving at one starts its readings afresh.
   * The verdict draws its own, from the same place, as it is put up.
   */
  private showTheRung(): void {
    const place = this.placeOnTheLadder();
    this.el.ladderTrack.replaceChildren(
      ...(place === null ? [] : [drawTheLadderTrack(this.doc, place, { ends: true })]),
    );
    this.runtime.renderer.showTheRung(
      place !== null && this.aGeneratedPageIsOpen() ? { label: place.here, marks: marksOfThePlace(place) } : null,
    );
  }

  /**
   * Keeps what was just played, and offers it in the list.
   *
   * The recorder has been running since the page opened, so this button is
   * not a start: by the time an idea is worth keeping it has already been
   * played, and a Record button would arrive after the thing it was for.
   */
  private keepTake(): void {
    if (this.runtime.takeOnOffer.keep() === null) {
      return;
    }
    this.renderTakes();
    this.describeTake();
  }

  /**
   * How much playing the buttons are offering to keep, if any.
   *
   * Two buttons, one recorder: the desk one and the one beside the fullscreen
   * bar say the same number because they are reading the same thing, not
   * because someone remembered to update both.
   */
  private describeTake(): void {
    const recorder = this.runtime.recorder;
    const ms = recorder.takeRunningMs;
    const playing = recorder.takeIsOnOffer;
    // Whether the next key press would go on with this take or begin the
    // next one. Shown rather than left to be learnt: the reader who wanted a
    // clean take was waiting out a silence they could not see, and counting
    // seconds under their breath is not a thing a page should ask of anyone.
    const open = playing && !recorder.takeIsSealed;
    const title = !playing
      ? 'Play something and this keeps it.'
      : open
        ? 'Keeps what you have just played, back to the last pause. Playing on adds to it.'
        : 'Already among the takes, until newer ones push it out: this keeps it for good. ' +
          'The next key you press starts a new take.';

    this.el.focusKeep.disabled = !playing;
    this.el.focusKeepText.textContent = playing ? clockTime(ms) : 'Keep';
    this.el.focusKeep.title = title;
    this.el.focusKeep.dataset['recording'] = String(open);

    this.watchForTheSilence();
  }

  /**
   * Redraws the pill once the silence that ends a take has run out.
   *
   * One timer, set for the moment it matters rather than a heartbeat that
   * asks four times a second all day. The recorder keeps no clock of its own
   * - that is what lets a whole session be replayed in a test - so counting
   * the silence out is the page's job, and it only has to be done once per
   * stretch of playing.
   */
  private watchForTheSilence(): void {
    if (this.silenceWatch !== null) {
      clearTimeout(this.silenceWatch);
      this.silenceWatch = null;
    }
    const recorder = this.runtime.recorder;
    const quiet = recorder.silenceSoFarMs;
    if (quiet === null || quiet >= recorder.silenceMs) {
      return;
    }
    // Whichever comes first: the next second of the counter, or the moment
    // the silence seals the take. One timer answers both, and neither is a
    // heartbeat that goes on asking all day - it stops the moment the take
    // is closed and starts again on the next thing the keyboard does.
    const until = Math.min(TAKE_COUNTER_MS, recorder.silenceMs - quiet + 50);
    this.silenceWatch = setTimeout(() => {
      this.silenceWatch = null;
      // The silence has ended the take if this is the last of the waiting,
      // and it goes onto the list now rather than when the next key is
      // pressed - which may be never, if the page is closed first.
      this.runtime.takeOnOffer.fileItIfItHasEnded();
      this.describeTake();
    }, until);
  }

  /**
   * Carries everything off this device, and back onto another one.
   *
   * The reason it exists: installing this page to a Home Screen gives it a
   * store of its own, separate from the tab it was installed from, and a
   * reader who had been practising in the tab opened the app to find their
   * levels, scores and takes gone. Not lost - somewhere the new window cannot
   * reach. Nothing in a browser bridges that; a file does.
   */
  private bindBackup(): void {
    this.listen(this.el.saveBackup, 'click', () => {
      void this.saveBackup();
    });

    this.listen(this.el.openBackup, 'click', () => {
      this.el.backupFile.click();
    });

    this.listen(this.el.backupFile, 'change', () => {
      void this.restoreBackup();
    });

    this.listen(this.el.saveJudging, 'click', () => {
      const text = this.judgingLogText();
      this.runtime.files.save(judgingFileName(Date.now()), new TextEncoder().encode(text), 'text/plain');
      this.el.backupDescription.textContent = this.judgingWrote('Wrote');
    });

    this.listen(this.el.copyJudging, 'click', () => {
      void this.copyJudgingLog();
    });

    this.listen(this.el.saveTimings, 'click', () => {
      this.runtime.files.save(
        `playback-timings-${new Date(Date.now()).toISOString().replace(/[:.]/g, '-')}.txt`,
        new TextEncoder().encode(this.playbackTimingsText()),
        'text/plain',
      );
      this.el.backupDescription.textContent = 'Wrote the playback timings.';
    });

    this.listen(this.el.copyTimings, 'click', () => {
      void this.copyThePlaybackTimings();
    });
  }

  /** The playback's timings, under what the page can say of the device. */
  private playbackTimingsText(): string {
    const view = this.doc.defaultView;
    const device = [
      view?.navigator?.userAgent ?? 'an unknown browser',
      `${String(view?.innerWidth ?? 0)}x${String(view?.innerHeight ?? 0)} at ${String(view?.devicePixelRatio ?? 1)}x`,
      `falling notes ${this.runtime.controller.settings.keysShown === 'falling-notes' ? 'on' : 'off'}`,
    ].join('; ');
    return thePlaybackTimingsText(device);
  }

  /** To the clipboard, as the judging log goes, and saying so where it is refused. */
  private async copyThePlaybackTimings(): Promise<void> {
    const clipboard = this.doc.defaultView?.navigator?.clipboard;
    if (clipboard === undefined) {
      this.el.backupDescription.textContent =
        'This browser will not let a page write to the clipboard. Save it as a file instead.';
      return;
    }
    try {
      await clipboard.writeText(this.playbackTimingsText());
      this.el.backupDescription.textContent = 'Copied the playback timings.';
    } catch {
      this.el.backupDescription.textContent = 'The clipboard was refused. Save it as a file instead.';
    }
  }

  /**
   * Writes down what was decided about each press, for someone to read.
   *
   * Every fault in the judging has been invisible from outside it: a mark in
   * the wrong colour, in the wrong place, or missing altogether all look the
   * same on a page - like nothing happening. Guessing from a description of
   * that costs more than writing the decisions down, so they are written
   * down, and the settings that shaped them go at the top because half of
   * these questions have turned out to be a setting.
   */
  /**
   * Straight to the clipboard, which is the short way to hand it over.
   *
   * Saving a file and finding it again is several steps on a tablet, and the
   * thing being handed over is a few dozen lines of text. The file is still
   * there for a log too long to paste, or for a browser that will not give a
   * page the clipboard - and one that refuses says so rather than appearing
   * to have worked.
   */
  private async copyJudgingLog(): Promise<void> {
    const clipboard = this.doc.defaultView?.navigator?.clipboard;
    if (clipboard === undefined) {
      this.el.backupDescription.textContent =
        'This browser will not let a page write to the clipboard. Save it as a file instead.';
      return;
    }
    try {
      await clipboard.writeText(this.judgingLogText());
      this.el.backupDescription.textContent = this.judgingWrote('Copied');
    } catch {
      this.el.backupDescription.textContent =
        'The clipboard was refused. Save it as a file instead.';
    }
  }

  private judgingWrote(verb: string): string {
    const count = this.runtime.controller.judgingLog.length;
    return `${verb} ${count} press${count === 1 ? '' : 'es'}, and the settings that judged them.`;
  }

  private judgingLogText(): string {
    const { controller } = this.runtime;
    const settings = controller.settings;
    const report = controller.lastReport;
    const lines = [
      `exercise: ${controller.currentExercise?.title ?? 'none'}`,
      // What the page should be printing over the staves. A passage is cut
      // out and engraved on its own, so "which bar is this" has an answer
      // that no longer matches its position, and every fault in that answer
      // looks the same from outside - like a page that started counting at
      // one.
      `bars: ${describeBarRange(controller)}`,
      `pages: ${describePages(this.runtime.renderer.pages, settings.pagedScore)}`,
      `mode: ${settings.modeId}   tempo: ${controller.tempoBpm} bpm (${controller.tempoPercent}%)`,
      `input delay: ${settings.inputLatencyMs} ms   chord window: ${settings.matchToleranceMs} ms`,
      `marks: ${settings.playedNotes}   hand: ${settings.handStaff ?? 'both'}   count-in: ${settings.countInBars}`,
      `click: ${settings.clickOn ? '' : 'off, '}${settings.clickPattern} / ${settings.clickWhen}`,
      `bridge clock: ${describeSkew(this.runtime.bridge?.clockSkewMs ?? null)}`,
      report === undefined || report === null
        ? 'last run: none'
        : `last run: mean ${Math.round(report.timing.meanDeviationMs)} ms, spread ${Math.round(report.timing.deviationSpreadMs)} ms, over ${report.timing.deviations.length} presses`,
      '',
      'note      verdict     step  onset  deviation  offset  drawn',
    ];
    for (const press of controller.judgingLog) {
      lines.push(
        [
          midiToLabel(press.midi).padEnd(9),
          press.verdict.padEnd(11),
          String(press.stepIndex).padStart(4),
          String(press.onsetTicks).padStart(6),
          (press.deviationMs === null ? '-' : `${Math.round(press.deviationMs)}`).padStart(10),
          press.offset.toFixed(2).padStart(7),
          press.drawn ? '  yes' : `  no (${press.why})`,
        ].join(' '),
      );
    }

    return lines.join(NEWLINE) + NEWLINE;
  }

  private async saveBackup(): Promise<void> {
    try {
      const document = await this.runtime.backup.create();
      const bytes = new TextEncoder().encode(JSON.stringify(document));
      this.runtime.files.save(backupFileName(document.savedAtMs), bytes, 'application/json');
      this.el.backupDescription.textContent =
        `Saved: ${document.scores.length} score${document.scores.length === 1 ? '' : 's'}, ` +
        'and everything this device remembers.';
    } catch (error) {
      this.el.backupDescription.textContent =
        error instanceof Error ? `Could not save a backup. ${error.message}` : 'Could not save a backup.';
    }
  }

  /**
   * Reads a backup back in, and puts the page into what it says.
   *
   * Everything is reloaded from its store rather than the page being thrown
   * away and reopened: the reader chose a file, and answering that by
   * restarting the application would look like something had gone wrong.
   */
  private async restoreBackup(): Promise<void> {
    const file = this.el.backupFile.files?.[0];
    // Cleared first, so choosing the same file twice is two restores.
    this.el.backupFile.value = '';
    if (file === undefined) {
      return;
    }

    try {
      const document = readBackup(JSON.parse(await file.text()));
      const summary = await this.runtime.backup.restore(document);

      const restored = this.runtime.settings.load();
      this.runtime.controller.updateSettings(restored.practice);
      this.runtime.takes.load();
      await this.runtime.scores.load();
      this.syncControlsFromSettings();
      this.renderTakes();
      this.renderScores();

      const already =
        summary.scoresAlreadyHere === 0
          ? ''
          : ` ${summary.scoresAlreadyHere} were already here and were left alone.`;
      this.el.backupDescription.textContent =
        `Restored ${summary.stores} kept things and ${summary.scoresAdded} score${summary.scoresAdded === 1 ? '' : 's'}.${already}`;
    } catch (error) {
      this.el.backupDescription.textContent =
        error instanceof Error ? `Could not restore that file. ${error.message}` : 'Could not restore that file.';
    }
  }

  /**
   * Raises and drops the sheets, from either place that can reach them.
   *
   * The lists live in one place and are opened from two, which is the whole
   * reason they are sheets: in fullscreen the panel is not on the page, and
   * leaving fullscreen to look at a list and coming back is a re-engraving
   * each way.
   */
  private bindSheets(): void {
    const pairs: readonly [HTMLElement, readonly HTMLButtonElement[], () => void][] = [
      [
        this.el.sheetTakes,
        [this.el.focusTakes],
        () => {
          // The list takes its transport back, and goes on playing what it played.
          this.letGoOfTheTakeOnTheKeys();
          this.renderTakes();
        },
      ],
      [
        this.el.sheetReadings,
        [this.el.focusReadings],
        () => this.renderReadings(),
      ],
      [
        this.el.sheetScores,
        [this.el.focusScores],
        () => {
          this.el.scoresSearch.value = '';
          // Last time's tally is not this time's news.
          this.el.scoresAdded.hidden = true;
          this.showTheList(this.scoresListShown);
        },
      ],
      [
        // Beside the two bar numbers, which is where a passage is chosen.
        // Down the settings sheet it was nowhere near the thing it is about,
        // and a reader who has just marked a stretch out would have had to
        // leave the page to write it down.
        this.el.sheetPlaces,
        [this.el.focusPlaces],
        () => this.renderPassages(),
      ],
      [
        this.el.sheetModes,
        [this.el.focusModes],
        () => this.showTheModes(),
      ],
      [
        // Over the scores it was opened from, so shutting it goes back to
        // the button that makes the exercise it describes.
        this.el.sheetExercise,
        [this.el.scoresExercise],
        () => this.syncControlsFromSettings(),
      ],
      [
        // The picture's own options.
        this.el.sheetRollOptions,
        [this.el.rollOptions],
        () => undefined,
      ],
      [
        this.el.sheetSettings,
        [this.el.focusSettings],
        // Opened onto whatever the settings actually are, since a run can
        // have moved them - the ladder does, and so does opening a score.
        () => this.syncControlsFromSettings(),
      ],
    ];

    for (const [sheet, openers, render] of pairs) {
      for (const opener of openers) {
        this.listen(opener, 'click', () => {
          render();
          this.showTheSheet(sheet);
        });
      }
    }
    this.bindTheMetronomeButton();

    // The dimmed area outside a panel is a way out that a thumb finds without
    // aiming; the × is for anyone who does aim. Asked of the page and shut by
    // the sheet's own control, as Escape is - see `shutTheInnermostSheet`.
    // Wired sheet by sheet it was a list, and the modes, the picture of a run
    // and a single reading were each in turn the one it had missed. His last:
    // "Reading діалог неможливо зачинити якщо натиснути мишкою поза діалог".
    //
    // Pressed there as well as let go there: a drag begun in the panel -
    // selecting a name being typed - that ends outside it lands its click on
    // the sheet as well, and is no way out.
    //
    // Each sheet the page has listens for itself, rather than the page
    // listening on their behalf: Safari on the iPad may make no click at all
    // of a tap on something that nothing listens to.
    let pressedOn: EventTarget | null = null;
    this.listen(this.doc, 'pointerdown', (event) => {
      pressedOn = event.target;
    });
    for (const sheet of this.doc.querySelectorAll<HTMLElement>('.sheet')) {
      this.listen(sheet, 'click', (event) => {
        if (event.target === sheet && pressedOn === sheet) {
          sheet.querySelector<HTMLElement>('[data-shuts]')?.click();
        }
      });
    }

    this.listen(this.el.settingsClose, 'click', () => {
      this.el.sheetSettings.hidden = true;
    });

    this.listen(this.el.takesKeptOnly, 'change', () => {
      this.renderTakes();
    });

    this.listen(this.el.scoresAdd, 'click', () => {
      // One picker, so a score opened from here is a score opened, with the
      // same reading and the same warnings.
      this.el.scoreFile.click();
    });

    this.listen(this.el.takesClose, 'click', () => {
      this.el.sheetTakes.hidden = true;
    });
    this.listen(this.el.scoresClose, 'click', () => {
      this.el.sheetScores.hidden = true;
    });
    this.listen(this.el.exerciseClose, 'click', () => {
      this.el.sheetExercise.hidden = true;
    });
    this.listen(this.el.metronomeClose, 'click', () => {
      this.el.sheetMetronome.hidden = true;
    });
    this.listen(this.el.scoreReading, 'click', () => {
      this.showTheLastReading();
    });
    this.listen(this.el.rollClose, 'click', () => {
      this.closeTheRoll();
    });
    this.listen(this.el.rollTitle, 'click', () => {
      this.beginRenamingTheSketch();
    });
    this.listen(this.el.rollRename, 'keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Enter' || key === 'Escape') {
        // Escape leaves the name, and not the sheet as well.
        event.preventDefault();
        event.stopPropagation();
        this.endRenamingTheSketch(key === 'Enter');
      }
    });
    this.listen(this.el.rollRename, 'blur', () => {
      this.endRenamingTheSketch(true);
    });
    this.repaintTheRollWhenTheScreenChanges();
    this.measureTheKeysAgainWhenTheyMove();
    this.sayWhetherTheKeysScroll();
    this.sayHowTallTheBarIs();
    this.listen(this.el.rollOptionsClose, 'click', () => {
      this.el.sheetRollOptions.hidden = true;
    });
    this.listen(this.el.rollPlay, 'click', () => {
      this.togglePlayingTheRoll();
    });
    this.listen(this.el.rollStop, 'click', () => {
      this.goBackInTheRoll();
    });
    this.listen(this.el.rollRecord, 'click', () => {
      if (this.recording === null) {
        this.recordIntoTheSketch();
      } else {
        this.writeInWhatWasRecorded();
      }
    });
    this.el.rollBody.addEventListener(
      'wheel',
      (event) => {
        this.scrollOrZoomTheRollByWheel(event);
      },
      // Said, so that a zoom does not zoom the page under it as well.
      { passive: false },
    );
    // The maps say how much of the run, and how many of its rows, are on the
    // screen - so a wheel over either changes that, along its own axis.
    this.el.rollMap.addEventListener(
      'wheel',
      (event) => {
        this.zoomByAWheelOverAMap(event, 'along');
      },
      { passive: false },
    );
    this.el.rollPitchMap.addEventListener(
      'wheel',
      (event) => {
        this.zoomByAWheelOverAMap(event, 'down');
      },
      { passive: false },
    );
    this.listen(this.el.rollMap, 'pointerdown', (event) => {
      this.el.rollMap.setPointerCapture(event.pointerId);
      this.showTheRunWhereItWasPointedAt(event);
    });
    this.listen(this.el.rollMap, 'pointermove', (event) => {
      if (!this.el.rollMap.hasPointerCapture(event.pointerId)) {
        return;
      }
      this.showTheRunWhereItWasPointedAt(event);
    });
    this.listen(this.el.rollPitchMap, 'pointerdown', (event) => {
      this.el.rollPitchMap.setPointerCapture(event.pointerId);
      this.showTheRowsWhereTheyWerePointedAt(event);
    });
    this.listen(this.el.rollPitchMap, 'pointermove', (event) => {
      if (!this.el.rollPitchMap.hasPointerCapture(event.pointerId)) {
        return;
      }
      this.showTheRowsWhereTheyWerePointedAt(event);
    });
    this.listen(this.el.rollScrollPlayback, 'change', () => {
      this.runtime.controller.updateSettings({
        rollScrollPlayback: this.el.rollScrollPlayback.checked,
      });
      this.sayWhereTheHeadStands();
      this.describeTheRoll();
    });
    this.listen(this.el.rollHeadAt, 'input', () => {
      this.runtime.controller.updateSettings({
        rollHeadAtPercent: Number(this.el.rollHeadAt.value),
      });
      this.sayWhereTheHeadStands();
      this.describeTheRoll();
    });
    this.listen(this.el.rollKeep, 'click', () => {
      this.keepTheRun();
    });
    this.listen(this.el.rollFrom, 'click', () => {
      this.takeAnEndFromTheMarker('from');
    });
    this.listen(this.el.rollTo, 'click', () => {
      this.takeAnEndFromTheMarker('to');
    });
    this.listen(this.el.rollPractise, 'click', () => {
      this.goAndPractiseThePassage();
    });
    this.listen(this.el.rollBody, 'click', (event) => {
      // Asked of where the press went down, where there was one; a key's
      // click, with none, is on its own target.
      const on = this.pressedOn ?? event.target;
      this.pressedOn = null;
      if (this.pinched || this.panned) {
        return;
      }
      // A slice laid by a press held on the ruler, which is not a tap there.
      if (this.sliceLaidByThePress) {
        this.sliceLaidByThePress = false;
        return;
      }
      // A flag pressed was answered as it went down; one clicked by the keys
      // is a click with no press before it.
      if (on instanceof Element && on.closest('.roll__marks') !== null) {
        if ((event as MouseEvent).detail === 0) {
          this.answerTheFlags(event);
        }
        return;
      }
      // Anywhere else, a flag chosen is let go of.
      this.chooseTheMark(null);
      // The ruler places the marker whatever the drawing is for: editing, the
      // notes under it answer a tap, and the marker still has to be put
      // somewhere to listen from.
      const onTheRuler = on instanceof Element && on.closest('.roll__ruler') !== null;
      const onTheChords = on instanceof Element && on.closest('.roll__chords') !== null;
      const mouse = event as MouseEvent;
      if (onTheRuler && (mouse.ctrlKey || mouse.metaKey || mouse.altKey)) {
        this.sliceByAClick(mouse);
        return;
      }
      // Two on the ruler of a sketch being edited ask about the beat there,
      // as the flag's button asks about the one the marker is on - which
      // the first of them put there.
      if (onTheRuler && this.isASecondTap(mouse, null) && this.theOtherRollShowing?.sketch?.editing === true) {
        this.askForAChangeAtTheHead();
        return;
      }
      if (onTheChords && this.chooseTheChordTapped(event)) {
        return;
      }
      // The lane of chords is not the notes: a tap there puts the marker, as
      // the ruler's does.
      if (!onTheRuler && !onTheChords && this.theOtherRollShowing?.sketch?.editing === true) {
        this.chooseTheKeyTapped(event);
        return;
      }
      this.putTheHeadWhereItWasTapped(event);
    });
    this.listen(this.el.rollEdit, 'click', () => {
      const showing = this.theOtherRollShowing;
      if (showing?.sketch !== undefined) {
        this.editTheSketch(!showing.sketch.editing);
      } else if (showing?.recording !== undefined) {
        this.beginASketchOf(showing.recording);
      } else if (showing?.isScore === true) {
        this.beginASketchOfTheScore();
      }
    });
    this.listen(this.el.rollVelocityLevel, 'input', () => {
      this.showTheLoudnessAsked();
    });
    this.listen(this.el.rollVelocityLevel, 'change', () => {
      this.setTheLoudnessAsked();
    });
    // First, the notes given back to the flags over them; then a level of their own.
    const toTheFlags = this.doc.createElement('button');
    toTheFlags.type = 'button';
    toTheFlags.className = 'button roll-dynamics__flag';
    toTheFlags.dataset['dynamic'] = 'flag';
    toTheFlags.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" class="take-transport__icon"><path d="M14.4 6 14 4H5v17h2v-7h5.6l.4 2h7V6z" /></svg>';
    toTheFlags.setAttribute('aria-pressed', 'false');
    this.listen(toTheFlags, 'click', () => {
      this.writeTheChosenAt({ level: null, shade: 0 });
    });
    this.el.rollDynamics.replaceChildren(
      toTheFlags,
      ...DYNAMICS_OFFERED.map((level) => {
        const button = this.doc.createElement('button');
        button.type = 'button';
        button.className = 'button';
        button.dataset['dynamic'] = level;
        button.textContent = level;
        button.setAttribute('aria-pressed', 'false');
        this.listen(button, 'click', () => {
          this.writeTheChosenAt({ level, shade: 0 });
        });
        return button;
      }),
    );
    this.listen(this.el.rollVelocityAs, 'click', () => {
      this.runtime.controller.updateSettings({
        velocityAsDynamics: !this.runtime.controller.settings.velocityAsDynamics,
      });
      this.sayHowLoudTheChosenAre();
    });
    // The tonics are named as the scale chosen spells them, once a sketch is shown: see `sayTheKeyOfTheSketch`.
    fillSelect(
      this.el.rollKey,
      Array.from({ length: 12 }, (_, pitchClass) => ({ value: String(pitchClass), label: String(pitchClass) })),
      '0',
    );
    fillSelect(
      this.el.rollScale,
      SCALE_NAMES.map((scale) => ({ value: scale, label: SCALES[scale].called })),
      'major',
    );
    for (const select of [this.el.rollKey, this.el.rollScale]) {
      this.listen(select, 'change', () => {
        this.writeTheSketchInTheKeyChosen();
      });
    }
    this.listen(this.el.rollMetre, 'change', () => {
      this.countTheSketchIn(this.el.rollMetre.value);
    });
    this.listen(this.el.rollTempo, 'change', () => {
      const asked = Math.round(Number(this.el.rollTempo.value));
      if (Number.isFinite(asked) && asked > 0) {
        this.paceTheSketchAt(Math.min(FASTEST_SKETCH_BPM, Math.max(SLOWEST_SKETCH_BPM, asked)));
      } else {
        this.sayWhatCanBeChanged();
      }
    });
    for (const [button, hand] of [
      [this.el.rollHandLeft, 'left'],
      [this.el.rollHandPitch, null],
      [this.el.rollHandRight, 'right'],
    ] as const) {
      this.listen(button, 'click', () => {
        this.giveTheChosenToAHand(hand);
      });
    }
    this.listen(this.el.rollQuantize, 'click', () => {
      this.putTheChosenOnTheGrid();
    });
    this.listen(this.el.rollHumanize, 'click', () => {
      this.humanizeTheChosen();
    });
    this.listen(this.el.scoresShowScores, 'click', () => {
      this.showTheList('scores');
    });
    this.listen(this.el.scoresShowSketches, 'click', () => {
      this.showTheList('sketches');
    });
    this.listen(this.el.sketchesNew, 'click', () => {
      const now = Date.now();
      const sketch = this.runtime.sketches.begin({ events: [], beats: [] }, `Sketch, ${theDayItWas(now)}`, now);
      this.renderSketches();
      this.showTheSketch(sketch.id);
    });
    this.listen(this.el.rollDelete, 'click', () => {
      this.deleteTheChosenKeys();
    });
    // The menu a right click opens is taken on a note being edited: there it
    // takes the note out, as the trash would.
    this.listen(this.el.rollBody, 'contextmenu', (event) => {
      if (this.isOnTheChords(event)) {
        return;
      }
      // And on a press of the pedal, the press.
      if (this.theOtherRollShowing?.sketch?.editing === true && this.isOnThePedal(event)) {
        const at = this.theMomentUnder((event as MouseEvent).clientX);
        const press = at === null ? null : this.thePedalPressAt(at);
        if (press !== null) {
          event.preventDefault();
          this.letGoOfThePedalPress(press);
        }
        return;
      }
      const key = this.theOtherRollShowing?.sketch?.editing === true ? this.theKeyUnder(event as MouseEvent) : null;
      if (key !== null) {
        event.preventDefault();
        this.deleteTheKey(key);
      }
    });
    this.listen(this.el.rollSelect, 'click', () => {
      const showing = this.theOtherRollShowing;
      const sketch = showing?.sketch;
      if (sketch === undefined) {
        this.boxOnTheViewer = !this.boxOnTheViewer;
        this.sayWhatCanBeChanged();
        return;
      }
      if (showing === null) {
        return;
      }
      const tool = sketch.tool === 'selection' ? 'pencil' : 'selection';
      this.theOtherRollShowing = { ...showing, sketch: { ...sketch, tool } };
      this.sayWhatCanBeChanged();
    });
    this.listen(this.el.rollUndo, 'click', () => {
      this.putBackTheLastChange();
    });
    fillSelect(
      this.el.rollMarkMetre,
      SKETCH_METRES.map((metre) => ({ value: metre, label: metre })),
      '4/4',
    );
    fillSelect(
      this.el.rollMarkKey,
      Array.from({ length: 12 }, (_, pitchClass) => ({ value: String(pitchClass), label: String(pitchClass) })),
      '0',
    );
    fillSelect(
      this.el.rollMarkScale,
      SCALE_NAMES.map((scale) => ({ value: scale, label: SCALES[scale].called })),
      'major',
    );
    // The levels a note's buttons strike, and none: a sketch marked nowhere yet.
    fillSelect(
      this.el.rollMarkDynamic,
      [{ value: '', label: 'None' }, ...DYNAMICS_OFFERED.map((level) => ({ value: level, label: level }))],
      '',
    );
    fillSelect(
      this.el.rollMarkReached,
      [
        { value: '', label: 'at once' },
        { value: 'gradually', label: 'gradually' },
      ],
      '',
    );
    // Whether there is anything to come from gradually depends on the dynamic chosen.
    this.listen(this.el.rollMarkDynamic, 'change', () => {
      this.sayWhetherTheDynamicIsReachedGradually();
    });
    // Another scale names the tonics again, as that scale on each is spelt.
    this.listen(this.el.rollMarkScale, 'change', () => {
      const scale = SCALE_NAMES.find((each) => each === this.el.rollMarkScale.value) ?? 'major';
      this.sayTheKeyIn(this.el.rollMarkKey, this.el.rollMarkScale, {
        fifths: theSignatureOfTheScale(Number(this.el.rollMarkKey.value), scale),
        scale,
      });
    });
    this.listen(this.el.rollMark, 'click', () => {
      this.askForAChangeAtTheHead();
    });
    this.listen(this.el.rollMarkYes, 'click', () => {
      this.changeFromTheBeatAsked(
        this.el.rollMarkMetre.value,
        Number(this.el.rollMarkTempo.value),
        this.theKeyAskedFor(),
        this.theDynamicAskedFor(),
        this.el.rollMarkReached.value === 'gradually',
      );
    });
    this.listen(this.el.rollMarkTempo, 'keydown', (event) => {
      if (event.key === 'Enter') {
        this.changeFromTheBeatAsked(
          this.el.rollMarkMetre.value,
          Number(this.el.rollMarkTempo.value),
          this.theKeyAskedFor(),
          this.theDynamicAskedFor(),
          this.el.rollMarkReached.value === 'gradually',
        );
      }
    });
    // Escape and a tap outside press it too.
    this.listen(this.el.rollMarkNo, 'click', () => {
      this.el.sheetRollMark.hidden = true;
      this.beatAskedAbout = null;
    });
    this.listen(this.el.rollMarkRemove, 'click', () => {
      this.takeTheChangeAway();
    });
    this.listen(this.el.rollMarkInsert, 'click', () => {
      this.insertABarBeforeTheBeatAsked();
    });
    this.listen(this.el.rollChordsOpen, 'click', () => {
      this.chordsOfTheKeyOpen = !this.chordsOfTheKeyOpen;
      this.chordsBeingForgotten = false;
      this.showTheChordsOfTheKey();
      // The lane under the notes naming the chords they make comes and goes with them.
      this.drawTheRollInto();
    });
    this.listen(this.el.rollChordsList, 'click', (event) => {
      const chord = (event.target as Element | null)?.closest<HTMLElement>('[data-chord]');
      if (chord === null || chord === undefined) {
        return;
      }
      if (this.chordsBeingForgotten) {
        this.forgetTheChordInTheDrawer(Number(chord.dataset['chord']));
      } else if (event.detail === 0) {
        // A key's click - Enter or Space on a chord - counts no presses. A
        // pointer's writes the chord it is let go of on, and was answered
        // there: see `letGoOfTheChord`.
        const written = this.writeTheChordAtTheHead(Number(chord.dataset['chord']));
        const now = this.runtime.clock.now();
        for (const midi of written === null ? [] : written.struck) {
          this.runtime.pitchPlayer.play(midi, written?.velocity ?? 0, now);
          this.runtime.pitchPlayer.stop(midi, now + (written?.lengthMs ?? 0));
        }
      }
    });
    this.listen(this.el.rollChordsList, 'pointerdown', (event) => {
      this.pointerOnTheChords = event.pointerType;
      this.holdTheChord(event);
    });
    // Asked of the document, as the keys on the screen are: a finger's
    // events keep going to the chord it went down on, wherever it has slid.
    this.listen(this.doc, 'pointermove', (event) => {
      if (event instanceof PointerEvent && this.chordHeld?.pointerId === event.pointerId) {
        this.slideOverTheChords(event);
      }
    });
    for (const type of ['pointerup', 'pointercancel'] as const) {
      this.listen(this.doc, type, (event) => {
        const held = this.chordHeld;
        if (event instanceof PointerEvent && held?.pointerId === event.pointerId) {
          this.letGoOfTheChord(type === 'pointerup' && held.moving !== 'scrolls' ? this.theChordUnder(event) : null);
        }
      });
    }
    // Over a chord - a mouse resting on it, or a finger on it until it is
    // lifted - its notes are shown where it would write them. Let go of, a
    // finger leaves it, and the click writes them there.
    this.listen(this.el.rollChordsList, 'pointerover', (event) => {
      const chord = (event.target as Element | null)?.closest<HTMLElement>('[data-chord]');
      this.pointAtTheChord(chord === null || chord === undefined ? null : Number(chord.dataset['chord']));
    });
    this.listen(this.el.rollChordsList, 'pointerout', (event) => {
      const into = (event as PointerEvent).relatedTarget;
      const chord = into instanceof Element ? into.closest<HTMLElement>('[data-chord]') : null;
      this.pointAtTheChord(chord === null || !this.el.rollChordsList.contains(chord) ? null : Number(chord.dataset['chord']));
    });
    // The right button deletes a chord kept, as it deletes a note on the
    // drawing; a finger held there asks for nothing.
    this.listen(this.el.rollChordsList, 'contextmenu', (event) => {
      const chord = (event.target as Element | null)?.closest<HTMLElement>('[data-chord]');
      if (chord === null || chord === undefined || this.pointerOnTheChords !== 'mouse') {
        return;
      }
      event.preventDefault();
      this.forgetTheChordInTheDrawer(Number(chord.dataset['chord']));
    });
    this.listen(this.el.rollChordsForget, 'click', () => {
      // With none kept it ends as it is drawn: see `showTheChordsOfTheKey`.
      this.chordsBeingForgotten = !this.chordsBeingForgotten;
      this.showTheChordsOfTheKey();
    });
    this.listen(this.el.rollChordsKeep, 'click', () => {
      this.keepOrLetGoOfTheChosenChord();
    });
    this.listen(this.el.rollCopy, 'click', () => {
      this.copyTheChosenKeys(false);
    });
    this.listen(this.el.rollCopyChosen, 'click', () => {
      this.copyTheChosenKeys(false);
    });
    this.listen(this.el.rollPaste, 'click', () => {
      this.pasteWithTheButton();
    });
    for (const [button, way] of this.theArpeggioButtons()) {
      this.listen(button, 'click', () => {
        this.breakTheChosenChords(way);
      });
    }
    this.listen(this.el.rollRedo, 'click', () => {
      this.bringBackTheLastPutBack();
    });
    this.listen(this.el.rollBody, 'pointerdown', (event) => {
      this.pressedOn = event.target;
      this.pinched = false;
      this.panned = false;
      this.stopTheFling();
      this.countTheFingerIn(event);
      // The middle button moves the drawing wherever it goes down; the right
      // one is the menu's, which a note being edited answers.
      const middle = event.pointerType === 'mouse' && event.button === 1;
      if (event.pointerType === 'mouse' && event.button === 2) {
        return;
      }
      // A flag is answered as it is pressed, before the drawing takes the
      // pointer for a drag - which would then take the click as well.
      if (event.button === 0 && this.answerTheFlags(event)) {
        event.preventDefault();
        return;
      }
      this.sliceLaidByThePress = false;
      this.followThePointerPastTheDrawing(event);
      if (event.button === 0 && this.isOnTheRuler(event) && this.takeHoldOfAnEndOfTheSlice(event)) {
        event.preventDefault();
        return;
      }
      if (event.button === 0 && this.isOnTheRuler(event)) {
        this.watchForASliceHold(event);
      }
      if (
        !middle &&
        this.rollFingers.size === 0 &&
        (this.holdTheKeyOnTheStrip(event) ||
          this.takeHoldOfThePedal(event) ||
          // A note is read off where the pointer is, which over the lane of
          // chords is a row under the edge of the grid: nothing there is a note.
          (!this.isOnTheChords(event) && (this.cutTheKeyUnder(event) || this.takeHoldOfAKey(event) || this.beginABox(event))))
      ) {
        return;
      }
      if (middle) {
        // Or the browser starts scrolling the page by it.
        event.preventDefault();
      }
      this.rollFingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.beginAPinch();
      // One finger, or a pen, moves the drawing, and so does a mouse over a
      // sketch being edited without the selection tool, as over any editor's
      // empty space; listening, a mouse points at it, as it always has. A
      // second finger makes a pan a pinch.
      const editingWithThePencil =
        this.theOtherRollShowing?.sketch?.editing === true && this.theOtherRollShowing.sketch.tool === 'pencil';
      this.rollPan =
        (event.pointerType !== 'mouse' || middle || editingWithThePencil) && this.rollFingers.size === 1
          ? {
              pointerId: event.pointerId,
              fromX: this.rollScroller.x,
              fromY: this.rollScroller.y,
              clientX: event.clientX,
              clientY: event.clientY,
              trail: [{ atMs: event.timeStamp, x: event.clientX, y: event.clientY }],
              moved: false,
            }
          : null;
    });
    this.listen(this.el.rollBody, 'pointermove', (event) => {
      if (this.fingersOnTheDrawing.has(event.pointerId)) {
        this.fingersOnTheDrawing.set(event.pointerId, { x: event.clientX, y: event.clientY });
      }
      if (this.dragTheSlice(event) || this.dragAnEndOfTheSlice(event)) {
        return;
      }
      if (this.keyHeldOnTheStrip?.pointerId === event.pointerId) {
        this.slideAlongTheStrip(event);
        return;
      }
      if (this.rollPedalDrag?.pointerId === event.pointerId) {
        this.dragThePedal(event);
        return;
      }
      if (this.rollDrag?.pointerId === event.pointerId) {
        this.dragTheHeldKey(event);
        return;
      }
      if (this.rollBoxDrawn?.pointerId === event.pointerId) {
        this.drawTheBox(event);
        return;
      }
      if (event.pointerType === 'mouse' && this.rollDrag === null && !this.rollFingers.has(event.pointerId)) {
        this.showTheGrip(event);
      }
      if (!this.rollFingers.has(event.pointerId)) {
        return;
      }
      this.rollFingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.pinchTheRoll();
      this.panTheRoll(event);
    });
    for (const ending of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      this.listen(this.el.rollBody, ending, (event) => {
        this.fingersOnTheDrawing.delete(event.pointerId);
        if (this.letGoOfTheSliceHold(event) || this.letGoOfAnEndOfTheSlice(event)) {
          return;
        }
        if (this.keyHeldOnTheStrip?.pointerId === event.pointerId) {
          this.letGoOfTheKeyOnTheStrip();
          return;
        }
        if (this.rollPedalDrag?.pointerId === event.pointerId) {
          this.letGoOfThePedal(event, ending === 'pointerup');
          return;
        }
        if (this.rollDrag?.pointerId === event.pointerId) {
          this.letGoOfTheHeldKey(ending === 'pointerup' ? event : null);
          return;
        }
        if (this.rollBoxDrawn?.pointerId === event.pointerId) {
          this.chooseWhatTheBoxHolds(event, ending === 'pointerup');
          return;
        }
        if (!this.rollFingers.has(event.pointerId)) {
          return;
        }
        this.rollFingers.delete(event.pointerId);
        this.beginAPinch();
        if (this.rollPan?.pointerId === event.pointerId) {
          this.letThePanGo(event, ending === 'pointerup');
        }
      });
    }
    this.listen(this.el.rollZoom, 'input', () => {
      this.applyTheZoom();
    });
    for (const layer of [this.el.rollGhosts, this.el.rollSlips]) {
      this.listen(layer, 'change', () => {
        this.drawTheRollInto();
      });
    }
    this.listen(this.el.rollGrid, 'change', () => {
      this.drawTheRollInto();
      // The count of clicks already handed over indexes into a list that just
      // changed length, so it is asked again rather than carried over.
      const roll = this.theRoll();
      if (roll !== null) {
        this.takeBackTheRollsClicks();
        this.clicksHandedOver(clicksBefore(roll, this.headIsAtMs(), this.theRollsGrid()));
        this.clickAheadOfTheRoll();
      }
    });
    this.listen(this.el.rollSpeed, 'change', () => {
      this.runtime.takePlayer.setSpeed(this.theRollsSpeed());
      // The clicks already out were placed at the old speed, so they are taken
      // back and handed over again at the new one.
      const roll = this.theRoll();
      if (roll !== null) {
        this.takeBackTheRollsClicks();
        this.clicksHandedOver(clicksBefore(roll, this.headIsAtMs(), this.theRollsGrid()));
        this.clickAheadOfTheRoll();
      }
      this.describeTheRoll();
    });
    this.listen(this.el.placesClose, 'click', () => {
      this.el.sheetPlaces.hidden = true;
    });

    this.listen(this.doc, 'keydown', (event) => {
      this.editByTheKeys(event as KeyboardEvent);
    });
    this.listen(this.doc, 'paste', (event) => {
      this.pasteTheNotesCopied(event as ClipboardEvent);
    });
    this.listen(this.doc, 'keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Escape') {
        return;
      }
      // Before focus mode sees it: a sheet is the innermost thing open, and
      // Escape should shut that rather than the layout underneath it.
      if (this.shutTheInnermostSheet()) {
        event.stopPropagation();
      }
    });
  }

  /**
   * Asks before something cannot be undone.
   *
   * Every one of these lists is on a tablet, where the delete sits a few
   * millimetres from the thing it deletes and there is no undo behind it.
   * Answered in the page rather than by `window.confirm`, which is
   * unimplemented in the environment the UI tests run in - and a deletion no
   * test can take is the wrong one to leave untested.
   */
  /**
   * Gives a score the name the reader calls it by.
   *
   * The whole point of it is the library and the page agreeing, so the name
   * goes into the document too and the piece on the stand is opened again
   * where it is the one being renamed - the title is printed in the corner of
   * every page, and one that still said the old name would read as a rename
   * that had not worked.
   */
  /**
   * Asks how hard a piece is, and keeps the answer with the piece.
   *
   * Nothing is written where the reader backs out, which is what makes Cancel
   * different from Unrated: one leaves the mark as it was and the other takes
   * it off. Two ways out of a dialog that both do nothing would be one too
   * many. His: "кнопка щоб редагувати складність знаходиться у списку на
   * кожному itemі".
   */
  private async judgeScore(id: string, title: string): Promise<void> {
    // Read now rather than captured when the row was drawn: the row outlives
    // the drawing of it, and a box opening on a mark the piece no longer has
    // is a box that quietly puts it back.
    const wanted = await this.askHowHard(title, this.runtime.scores.theStarsFor(title));
    if (wanted === 'left alone') {
      return;
    }
    await this.runtime.scores.keepTheStars(id, wanted, Date.now());
    this.renderScores();
  }

  /**
   * The sheet that asks, answering with a number, `null` for unrated, or
   * `'left alone'` where the reader backed out.
   */
  private askHowHard(title: string, current: number | null): Promise<number | null | 'left alone'> {
    this.el.starsText.textContent = `How hard is “${title}”, from one to ten?`;
    this.el.starsValue.value = current === null ? '' : current.toFixed(1);
    this.showTheSheet(this.el.sheetStars);
    this.el.starsValue.focus();
    this.el.starsValue.select();

    return new Promise<number | null | 'left alone'>((resolve) => {
      const answer = (value: number | null | 'left alone'): void => {
        this.el.sheetStars.hidden = true;
        this.el.starsYes.removeEventListener('click', onYes);
        this.el.starsNone.removeEventListener('click', onNone);
        this.el.starsNo.removeEventListener('click', onNo);
        this.el.starsValue.removeEventListener('keydown', onKey);
        this.el.sheetStars.removeEventListener('click', onOutside);
        resolve(value);
      };
      // Nothing typed is not nought: it is the reader pressing Set over an
      // empty box, which means they have nothing to say and is Cancel.
      const onYes = (): void => answer(theStarsIn(this.el.starsValue.value) ?? 'left alone');
      const onNone = (): void => answer(null);
      const onNo = (): void => answer('left alone');
      // Enter only. Escape is the page's, and shuts this by pressing the
      // Cancel beside it - which is this same answer, given once.
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Enter') {
          onYes();
        }
      };
      const onOutside = (event: Event): void => {
        if (event.target === this.el.sheetStars) {
          answer('left alone');
        }
      };
      this.el.starsYes.addEventListener('click', onYes);
      this.el.starsNone.addEventListener('click', onNone);
      this.el.starsNo.addEventListener('click', onNo);
      this.el.starsValue.addEventListener('keydown', onKey);
      this.el.sheetStars.addEventListener('click', onOutside);
    });
  }

  private async renameScore(id: string, title: string): Promise<void> {
    const wanted = await this.askForAName(title);
    if (wanted === null) {
      return;
    }
    const outcome = await this.runtime.scores.rename(id, wanted);
    if (outcome !== 'renamed') {
      this.sayInTheMiddle(
        outcome === 'taken'
          ? `There is already a score called “${wanted.trim()}”.`
          : `${title} is no longer stored on this device.`,
      );
      this.renderScores();
      return;
    }
    // What the reader has read, and how well, follows the name: renaming a
    // piece is not starting it again.
    this.runtime.controller.followTheRename(title, wanted.trim());
    this.renderScores();
    if (this.runtime.controller.openedExercise?.title === title) {
      await this.openKeptScore(this.runtime.scores.list().find(
        (score) => score.title === wanted.trim(),
      )?.id ?? id, wanted.trim());
    }
  }

  /**
   * Asks for a name, with the one it has now already in the box.
   *
   * Refused rather than obeyed while the box is empty: an unnamed score
   * cannot be looked for, and there is nothing sensible to fall back to.
   */
  private askForAName(current: string): Promise<string | null> {
    this.el.renameText.textContent = `What should “${current}” be called?`;
    this.el.renameName.value = current;
    this.el.renameProblem.hidden = true;
    this.showTheSheet(this.el.sheetRename);
    this.el.renameName.focus();
    this.el.renameName.select();

    return new Promise<string | null>((resolve) => {
      const answer = (value: string | null): void => {
        this.el.sheetRename.hidden = true;
        this.el.renameYes.removeEventListener('click', onYes);
        this.el.renameNo.removeEventListener('click', onNo);
        this.el.renameName.removeEventListener('keydown', onKey);
        this.el.sheetRename.removeEventListener('click', onOutside);
        resolve(value);
      };
      const onYes = (): void => {
        const wanted = this.el.renameName.value.trim();
        if (wanted === '') {
          this.el.renameProblem.textContent = 'A score needs a name to be found under.';
          this.el.renameProblem.hidden = false;
          return;
        }
        answer(wanted);
      };
      const onNo = (): void => answer(null);
      // Enter only. Escape is the page's, and shuts this by pressing the
      // Cancel beside it - which is this same answer, given once.
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Enter') {
          onYes();
        }
      };
      const onOutside = (event: Event): void => {
        if (event.target === this.el.sheetRename) {
          answer(null);
        }
      };

      this.el.renameYes.addEventListener('click', onYes);
      this.el.renameNo.addEventListener('click', onNo);
      this.el.renameName.addEventListener('keydown', onKey);
      this.el.sheetRename.addEventListener('click', onOutside);
    });
  }

  private askToDelete(question: string): Promise<boolean> {
    return this.ask(question, null);
  }

  /**
   * Asks for everything to go, or a sketch, and makes the reader say so in
   * words.
   *
   * A row is one score and a mis-tap on it costs a file that is still on the
   * disk. The shelf is the whole library, and on a tablet it is a thumb's
   * width from the row above it - so this one is not a button that can be
   * pressed by accident at all. Typed rather than held down or pressed
   * twice: it is the only sort of confirmation that cannot be given without
   * having read the question. A sketch is asked for the same way: it is
   * music written by hand that is kept nowhere else, and gone it cannot be
   * put back.
   */
  private askToTypeIt(question: string): Promise<boolean> {
    return this.ask(`${question} Type ${PURGE_WORD} to confirm.`, PURGE_WORD);
  }

  /**
   * One question, asked the same way everywhere.
   *
   * `window.confirm` is the alternative and it is not usable here: it is
   * unimplemented in the environment the UI tests run in, so every deletion
   * would be a path no test could take.
   */
  private ask(question: string, typed: string | null, yes = 'Delete'): Promise<boolean> {
    this.el.confirmText.textContent = question;
    // Said each time, since the same sheet asks about more than deleting.
    this.el.confirmYes.textContent = yes;
    this.el.confirmTyped.value = '';
    this.el.confirmTyped.hidden = typed === null;
    // Refused until the word is there, rather than refusing afterwards: the
    // button says what the state of the question is, and there is nothing to
    // report about an answer nobody has given yet.
    this.el.confirmYes.disabled = typed !== null;
    this.showTheSheet(this.el.sheetConfirm);
    if (typed !== null) {
      this.el.confirmTyped.focus();
    }

    return new Promise<boolean>((resolve) => {
      const answer = (yes: boolean): void => {
        this.el.sheetConfirm.hidden = true;
        this.el.confirmYes.disabled = false;
        this.el.confirmTyped.hidden = true;
        this.el.confirmYes.removeEventListener('click', onYes);
        this.el.confirmNo.removeEventListener('click', onNo);
        this.el.confirmTyped.removeEventListener('input', onTyped);
        this.el.confirmTyped.removeEventListener('keydown', onKey);
        this.el.sheetConfirm.removeEventListener('click', onOutside);
        resolve(yes);
      };
      const said = (): boolean =>
        typed === null || this.el.confirmTyped.value.trim().toLowerCase() === typed.toLowerCase();
      const onYes = (): void => {
        if (said()) {
          answer(true);
        }
      };
      const onNo = (): void => answer(false);
      const onTyped = (): void => {
        this.el.confirmYes.disabled = !said();
      };
      // Enter only; Escape is the page's. See the rename above.
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Enter') {
          onYes();
        }
      };
      const onOutside = (event: Event): void => {
        if (event.target === this.el.sheetConfirm) {
          answer(false);
        }
      };

      this.el.confirmYes.addEventListener('click', onYes);
      this.el.confirmNo.addEventListener('click', onNo);
      this.el.confirmTyped.addEventListener('input', onTyped);
      this.el.confirmTyped.addEventListener('keydown', onKey);
      this.el.sheetConfirm.addEventListener('click', onOutside);
    });
  }

  /**
   * The transport under the kept list: play, where we are, and how long.
   *
   * The reading is polled while something is sounding, because the player
   * keeps no counter to be told about - it works out where it is from the
   * clock, so that what is shown cannot drift from what is heard. Polling is
   * the price of that and it is the cheaper half of the bargain.
   */
  private bindTakeTransport(): void {
    const player = this.runtime.takePlayer;

    this.listen(this.el.takePlay, 'click', () => {
      if (player.playing !== null) {
        player.pause();
      } else if (this.selectedTakeId !== null) {
        // From the top when it is already at the end. Pressing play on a
        // finished take otherwise plays the nothing that is left of it, so
        // the reader had to drag the slider back before it would do anything.
        const from = player.positionMs >= player.durationMs ? 0 : player.positionMs;
        this.playTake(this.selectedTakeId, from);
      }
      this.describeTakeTransport();
    });

    this.listen(this.el.takeScrub, 'input', () => {
      player.seek(momentOfTheScrubBar(this.takeScrubBar, player.durationMs));
      this.describeTakeTransport();
    });

    this.listen(this.el.listenGoesOn, 'click', () => {
      const controller = this.runtime.controller;
      const goesOn = controller.settings.playbackGoesOn;
      const next = PLAYBACK_GOES_ON[(PLAYBACK_GOES_ON.indexOf(goesOn) + 1) % PLAYBACK_GOES_ON.length] ?? 'this';
      controller.updateSettings({ playbackGoesOn: next });
      this.describeWhatPlaysNext();
      this.describeTheRepeat();
    });

    this.listen(this.el.listenPrevious, 'click', () => {
      void this.goOnToAnotherPiece(-1);
    });
    this.listen(this.el.listenNext, 'click', () => {
      void this.goOnToAnotherPiece(1);
    });

    // Held while it is dragged and played on where it is let go, rather than
    // started again at every step of the drag: each start is a performance
    // begun, with its count-in where one is set.
    this.listen(this.el.listenScrub, 'input', () => {
      const controller = this.runtime.controller;
      const place = controller.performancePlace;
      if (place === null) {
        return;
      }
      // Read before holding: holding draws the slider where the music was.
      const to = momentOfTheScrubBar(this.performanceScrubBar, place.durationMs);
      if (controller.isListening) {
        this.playsOnAfterTheDrag = true;
        this.holdThePerformance();
      }
      controller.movePerformanceTo(to);
      this.showThePerformance();
    });
    this.listen(this.el.listenScrub, 'change', () => {
      if (!this.playsOnAfterTheDrag) {
        return;
      }
      this.playsOnAfterTheDrag = false;
      if (this.runtime.controller.isListeningPaused) {
        this.resumeThePerformance();
      }
    });

    this.listen(this.el.replayScrub, 'input', () => {
      this.putTheReplayAt(momentOfTheScrubBar(this.replayScrubBar, this.replayLengthMs));
    });

    // Shut with the sheet: a take going on playing behind a closed list is a
    // sound with nothing on the page to stop it.
    this.listen(this.el.takesClose, 'click', () => {
      player.stop();
      this.describeTakeTransport();
    });

    this.listen(this.el.takeOnTheKeys, 'click', () => {
      this.watchTheTakeOnTheKeys();
    });
    this.listen(this.el.takeOffTheKeys, 'click', () => {
      player.stop();
      this.letGoOfTheTakeOnTheKeys();
    });
  }

  /**
   * Shows the take chosen in the list on the keys: lit as it is played, its
   * notes falling onto them over the page, and its transport with it, just
   * above the bar - where the slider is dragged to any moment of it.
   *
   * The page stays: a reader who plays from the score with no frame at all
   * keeps the recording, and looks at what they played against what is
   * printed. How much of the keys and notes is shown is the keyboard's button,
   * as for everything else that falls.
   */
  private watchTheTakeOnTheKeys(): void {
    const id = this.selectedTakeId;
    const take = id === null ? null : this.runtime.takes.find(id);
    if (id === null || take === null) {
      return;
    }
    const player = this.runtime.takePlayer;
    this.endTheReplay();
    this.el.sheetTakes.hidden = true;
    this.takeOnTheKeys = { id, keys: theTakeOnTheKeys(take.events, take.durationMs) };
    this.doc.body.dataset['takeOnKeys'] = 'true';
    this.el.takeOnKeys.append(this.el.takeTransport);
    this.el.takeOnKeys.hidden = false;
    this.applyKeyboardVisibility();
    // Going at once, from where the list had it - asking to watch it is asking
    // to see it played.
    const from = player.positionMs < player.durationMs ? player.positionMs : 0;
    this.playTake(id, from);
  }

  /**
   * Puts the take away from the keys and gives the list its transport back.
   * Whatever is playing goes on: the list is where it can be stopped.
   */
  private letGoOfTheTakeOnTheKeys(): void {
    if (this.takeOnTheKeys === null) {
      return;
    }
    this.takeOnTheKeys = null;
    delete this.doc.body.dataset['takeOnKeys'];
    this.el.sheetTakes.querySelector('.sheet__panel')?.append(this.el.takeTransport);
    this.el.takeOnKeys.hidden = true;
    lightTheKeys(this.replayKeyboard, new Map(), false);
    this.applyKeyboardVisibility();
    this.describeTakeTransport();
  }

  /**
   * The take being watched as it stands at the player's moment: its keys lit,
   * and the notes moved there - falling while it plays, and painted once where
   * it is held, so a take dragged to a moment shows that moment.
   */
  private showTheTakeOnTheKeys(): void {
    if (this.takeOnTheKeys === null) {
      return;
    }
    this.lightTheTakesKeys();
    this.letTheKeysFollow();
    this.sayWhetherNotesFall();
    if (this.notesAreFalling) {
      this.letTheNotesFall();
    } else if (!this.el.replayKeys.hidden && this.runtime.controller.settings.keysShown === 'falling-notes') {
      this.paintTheFallingNotes();
    }
  }

  /** The keys of the take being watched lit as they stand at the player's moment. */
  private lightTheTakesKeys(): void {
    const watched = this.takeOnTheKeys;
    if (watched === null) {
      return;
    }
    const at = this.runtime.takePlayer.positionMs;
    const down = theTakesKeysAt(watched.keys, at);
    lightTheKeys(
      this.replayKeyboard,
      new Map<number, KeyLight>(down.map((midi) => [midi, 'heard'])),
      theTakesPedalAt(watched.keys, at),
    );
    if (down.length > 0) {
      keepInView(this.replayKeyboard, Math.min(...down));
    }
  }

  /**
   * Lights the keys under a take or a run shown again a frame at a time while
   * it sounds, and stops where it stops.
   *
   * The timer that hands the notes to the instrument wakes only every
   * `TAKE_TICK_MS`, and a key lit there went down anything up to that long
   * after its note was heard - behind the sound, and behind the notes falling
   * onto it, which are drawn every frame. Each frame asks the player again,
   * so the keys stop with the music however it was stopped.
   */
  private letTheKeysFollow(): void {
    const view = this.doc.defaultView;
    if (
      !this.keysFollowThePlayer ||
      this.keysFrame !== null ||
      view === null ||
      typeof view.requestAnimationFrame !== 'function'
    ) {
      return;
    }
    const frame = (): void => {
      this.keysFrame = null;
      if (!this.keysFollowThePlayer) {
        return;
      }
      if (this.takeOnTheKeys !== null) {
        this.lightTheTakesKeys();
      } else {
        this.showTheReplaysKeys(this.runtime.takePlayer.positionMs);
      }
      this.keysFrame = view.requestAnimationFrame(frame);
    };
    this.keysFrame = view.requestAnimationFrame(frame);
  }

  /** Whether a take watched on the keys, or a run shown again, is sounding now. */
  private get keysFollowThePlayer(): boolean {
    const watched = this.takeOnTheKeys;
    return (
      (watched !== null && this.runtime.takePlayer.playing === watched.id) ||
      (watched === null && this.replayIsSounding)
    );
  }

  /** Starts a take and follows it until it stops. */
  private playTake(id: string, fromMs = 0): void {
    const take = this.runtime.takes.find(id);
    if (take === null) {
      return;
    }
    // Another take than the one on the keys takes the player from under it.
    if (this.takeOnTheKeys !== null && this.takeOnTheKeys.id !== id) {
      this.letGoOfTheTakeOnTheKeys();
    }
    this.selectedTakeId = id;
    // At its own speed. The shelf offers no speed of its own, so a take played
    // after the picture was slowed would come out slow with nothing on screen
    // to explain it - one player, two places asking it for something.
    this.runtime.takePlayer.setSpeed(1);
    this.runtime.takePlayer.play(id, take.events, fromMs);
    if (this.takeTick === null) {
      this.takeTick = setInterval(() => this.followTake(), TAKE_TICK_MS);
    }
    this.describeTakeTransport();
  }

  private followTake(): void {
    const player = this.runtime.takePlayer;
    // Hands over the next slice of the take before drawing where it has got
    // to: the drawing can wait a frame, the sound cannot.
    player.pump();
    if (player.finished) {
      player.pause();
    }
    if (player.playing === null && this.takeTick !== null) {
      clearInterval(this.takeTick);
      this.takeTick = null;
    }
    this.describeTakeTransport();
  }

  /** The takes' slider and the times either side of it. */
  private get takeScrubBar(): ScrubBar {
    return { position: this.el.takePosition, scrub: this.el.takeScrub, duration: this.el.takeDuration };
  }

  /** The slider through a run shown again. */
  private get replayScrubBar(): ScrubBar {
    return { position: this.el.replayPosition, scrub: this.el.replayScrub, duration: this.el.replayDuration };
  }

  /** The slider through a performance. */
  private get performanceScrubBar(): ScrubBar {
    return { position: this.el.listenPosition, scrub: this.el.listenScrub, duration: this.el.listenDuration };
  }

  /**
   * Says where the performance stands, of how long, and keeps saying it while
   * it plays: it moves between the steps that are all the page is told of.
   */
  private followThePerformance(): void {
    const controller = this.runtime.controller;
    const place = controller.performancePlace;
    if (place !== null) {
      describeTheScrubBar(this.performanceScrubBar, place.positionMs, place.durationMs);
    }
    if (controller.isListening && this.listenTick === null) {
      this.listenTick = setInterval(() => {
        this.followThePerformance();
      }, TAKE_TICK_MS);
    } else if (!controller.isListening && this.listenTick !== null) {
      clearInterval(this.listenTick);
      this.listenTick = null;
    }
  }

  /** Says where the run shown again stands, of how long. */
  private describeTheReplaysBar(): void {
    const player = this.runtime.takePlayer;
    const at = this.replayIsSounding ? player.positionMs : this.replayAtMs;
    describeTheScrubBar(this.replayScrubBar, at, this.replayLengthMs);
  }

  private describeTakeTransport(): void {
    const player = this.runtime.takePlayer;
    const take = this.selectedTakeId === null ? null : this.runtime.takes.find(this.selectedTakeId);
    this.el.takeTransport.hidden = take === null;
    if (take === null) {
      return;
    }

    const total = player.durationMs > 0 ? player.durationMs : take.durationMs;
    describeTheScrubBar(this.takeScrubBar, player.positionMs, total);

    const sounding = player.playing !== null;
    this.el.takePlayIcon.setAttribute('d', sounding ? PAUSE_ICON : PLAY_ICON);
    const label = sounding ? 'Pause' : 'Play';
    this.el.takePlay.title = label;
    this.el.takePlay.setAttribute('aria-label', label);
    this.showTheTakeOnTheKeys();
  }

  private renderTakes(): void {
    const all = this.runtime.takes.list();
    const takes = this.el.takesKeptOnly.checked
      ? all.filter((take) => take.shelf === 'kept')
      : all;
    this.el.takesEmpty.hidden = takes.length > 0;
    // A take deleted takes the pencil off the page written from it.
    this.showThePencilBesideThePills();
    this.el.takesEmpty.textContent =
      all.length > 0 && takes.length === 0
        ? 'Nothing kept for good yet. The star on a row puts it out of reach of the tidying.'
        : 'Nothing kept yet. Play something and keep it from the bar.';
    this.el.takesClear.disabled = all.length === 0;
    // The opener counts everything, whatever the list is filtered to: it is
    // saying how much is kept here, not how much is on screen.
    this.el.takesList.replaceChildren();

    for (const take of takes) {
      const row = this.doc.createElement('li');
      const name = this.doc.createElement('span');
      name.className = 'takes__name';
      name.textContent = `${takeName(take.savedAtMs)} · ${clockTime(take.durationMs)} · ${take.noteCount} notes`;

      if (take.shelf === 'recent') {
        name.classList.add('takes__name--recent');
      }

      const hear = this.doc.createElement('button');
      hear.type = 'button';
      hear.textContent = '▶';
      hear.title = 'Play this take';
      hear.setAttribute('aria-label', `Play the take from ${takeName(take.savedAtMs)}`);
      this.listen(hear, 'click', () => this.playTake(take.id));

      const look = this.doc.createElement('button');
      look.type = 'button';
      look.textContent = '▦';
      look.title = 'Look at this take';
      look.setAttribute('aria-label', `Look at the take from ${takeName(take.savedAtMs)}`);
      this.listen(look, 'click', () => this.showTheTake(take.id));

      const write = this.doc.createElement('button');
      write.type = 'button';
      write.textContent = 'Score';
      write.className = 'takes__score';
      // Played without the click, it is written in the bars a sketch of it
      // would begin in, which the reader can count again in the sketch.
      write.title = barsAreHeardIn(take.beats)
        ? 'Write this take down as a score, in the bars of the click it was played to'
        : 'Write this take down as a score, in common time at 120 from its first note: it was played without the click';
      write.setAttribute('aria-label', write.title);
      this.listen(write, 'click', () => void this.writeTheTakeDown(take.id));

      const save = this.doc.createElement('button');
      save.type = 'button';
      save.textContent = 'MIDI';
      save.title = 'Save this take as a MIDI file';
      this.listen(save, 'click', () => this.exportTake(take.id));

      const kept = take.shelf === 'kept';
      const promote = this.doc.createElement('button');
      promote.type = 'button';
      promote.textContent = kept ? '★' : '☆';
      // Both ways: a reader who kept one by mistake has to be able to say so,
      // and putting it back is not deleting it - only letting the tidying
      // reach it again.
      promote.title = kept
        ? 'Kept for good. Press to let the tidying reach it again.'
        : 'Keep this one for good, out of reach of the tidying.';
      promote.setAttribute(
        'aria-label',
        kept ? 'Stop keeping this take for good' : 'Keep this take for good',
      );
      this.listen(promote, 'click', () => {
        this.runtime.takes.setShelf(take.id, kept ? 'recent' : 'kept');
        this.renderTakes();
      });

      const remove = this.doc.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = 'Delete this take';
      remove.setAttribute('aria-label', `Delete the take from ${takeName(take.savedAtMs)}`);
      this.listen(remove, 'click', () => {
        void this.askToDelete(`Delete the take from ${takeName(take.savedAtMs)}?`).then((yes) => {
          if (yes) {
            this.runtime.takes.remove(take.id);
            this.renderTakes();
          }
        });
      });

      row.append(name, hear, look, write, promote, save, remove);
      this.el.takesList.append(row);
    }
  }

  /**
   * Shows one of the two lists of the scores sheet: the scores kept, with the
   * means of finding and adding them, or the sketches being written.
   */
  private showTheList(which: 'scores' | 'sketches'): void {
    this.scoresListShown = which;
    const sketches = which === 'sketches';
    this.el.scoresShowScores.setAttribute('aria-pressed', String(!sketches));
    this.el.scoresShowSketches.setAttribute('aria-pressed', String(sketches));
    for (const part of [this.el.scoresTools, this.el.scoresFreshRow, this.el.scoresList]) {
      part.hidden = sketches;
    }
    this.el.sketchesList.hidden = !sketches;
    this.el.sketchesNew.hidden = !sketches;
    if (sketches) {
      this.el.scoresEmpty.hidden = true;
      this.el.scoresAdded.hidden = true;
      this.renderSketches();
    } else {
      this.el.sketchesEmpty.hidden = true;
      this.renderScores();
    }
  }

  private renderSketches(): void {
    const sketches = this.runtime.sketches.list();
    this.el.sketchesEmpty.hidden = this.scoresListShown !== 'sketches' || sketches.length > 0;
    this.el.sketchesList.replaceChildren();
    for (const sketch of sketches) {
      const row = this.doc.createElement('li');
      const name = this.doc.createElement('span');
      name.className = 'takes__name';
      name.textContent = `${sketch.title} · ${sketch.noteCount} notes`;
      name.title = sketch.title;

      const edit = this.doc.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.title = 'Edit this sketch';
      edit.setAttribute('aria-label', `Edit ${sketch.title}`);
      this.listen(edit, 'click', () => this.showTheSketch(sketch.id));

      const write = this.doc.createElement('button');
      write.type = 'button';
      write.textContent = 'Score';
      write.title = 'Write this sketch down as a score';
      write.setAttribute('aria-label', `Write ${sketch.title} down as a score`);
      this.listen(write, 'click', () => void this.writeDownTheSketch(sketch.id, this.el.sheetScores));

      const save = this.doc.createElement('button');
      save.type = 'button';
      save.textContent = 'MIDI';
      save.title = 'Save this sketch as a MIDI file';
      this.listen(save, 'click', () => {
        this.runtime.files.save(`${sketch.title}.mid`, thePlayingAsAFile(sketch, sketch.title), 'audio/midi');
      });

      const remove = this.doc.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = 'Delete this sketch';
      remove.setAttribute('aria-label', `Delete ${sketch.title}`);
      this.listen(remove, 'click', () => {
        void this.askToTypeIt(`Delete ${sketch.title}?`).then((yes) => {
          if (yes) {
            this.runtime.sketches.remove(sketch.id);
            this.renderSketches();
            this.showThePencilBesideThePills();
          }
        });
      });

      row.append(name, edit, write, save, remove);
      this.el.sketchesList.append(row);
    }
  }

  private exportTake(id: string): void {
    const take = this.runtime.takes.find(id);
    if (take === null) {
      return;
    }
    this.runtime.files.save(`${takeFileName(take.savedAtMs)}.mid`, theTakeAsAFile(take), 'audio/midi');
  }

  /**
   * Opens a take as a score: the file it would be saved as, read the way a
   * chosen MIDI file is, so its page is the one any other program opening
   * that file is given the bars of - the click's, or common time at 120 where
   * it was played without one.
   *
   * Not kept among the scores, for the reason a sketch's page is not: the
   * take is what is kept, and every take written down was another score in
   * the list. The pencil beside the pills begins a sketch of it instead.
   */
  private async writeTheTakeDown(id: string): Promise<void> {
    const take = this.runtime.takes.find(id);
    if (take === null) {
      return;
    }
    const opened = await this.writeDown(theTakeAsWritten(take), takeTitle(take.savedAtMs), this.el.sheetTakes);
    this.theTakeOnThePage = opened === null ? null : { takeId: take.id, exercise: opened };
    this.showThePencilBesideThePills();
  }

  /**
   * Opens some playing as a score: the file it would be saved as, read the
   * way a chosen MIDI file is, and not kept among the scores - what it was
   * written from is what is kept. The sheet it was asked from goes first: the
   * page is what was asked for.
   */
  private async writeDown(
    playing: {
      readonly events: readonly MidiFileEvent[];
      readonly beats: readonly HeardBeat[];
      readonly key?: SketchKey;
    },
    title: string,
    from: HTMLElement,
  ): Promise<Exercise | null> {
    from.hidden = true;
    timeTheStart('score asked for', () => title);
    try {
      const { exercise, warnings } = await this.runtime.importer.readFile(
        thePlayingAsAFile(playing, title).slice().buffer,
        `${title}.mid`,
      );
      await this.pickUpTheFile(exercise);
      this.sayWhatTheFileLeftOut(exercise, warnings);
      this.runtime.controller.playOnlyTheScoreOpen();
      return this.runtime.controller.openedExercise;
    } catch (error) {
      reportToTheConsole(`Could not write ${title} down.`, error);
      this.sayInTheMiddle(`Could not write ${title} down. ${whyAScoreWasRefused(error)}`);
      return null;
    }
  }

  /**
   * Writes a sketch down on the page, and remembers the page is the sketch's.
   *
   * Not kept among the scores: the sketch is what is kept, and a copy of it
   * there was a second answer to what it says, which the sketch's next change
   * would leave behind - and, kept by its name, one that a sketch of the same
   * name wrote over.
   */
  private async writeDownTheSketch(id: string, from: HTMLElement): Promise<void> {
    const sketch = this.runtime.sketches.find(id);
    if (sketch === null) {
      return;
    }
    this.runtime.sketches.opened(id);
    const opened = await this.writeDown(sketch, sketch.title, from);
    this.theSketchOnThePage = opened === null ? null : { sketch, exercise: opened };
    this.showThePencilBesideThePills();
  }

  /**
   * Shows the pencil beside the pills while the page is a sketch's, to edit
   * it, or a take's, to begin a sketch of it; and only then.
   */
  private showThePencilBesideThePills(): void {
    const ofASketch = this.theSketchOfThePage() !== null;
    this.el.focusSketch.hidden = !ofASketch && this.theTakeOfThePage() === null;
    this.el.focusSketch.title = ofASketch ? 'Edit this sketch' : BEGIN_A_SKETCH_OF_A_TAKE;
    this.el.focusSketch.setAttribute('aria-label', this.el.focusSketch.title);
  }

  /** The take the page was written down from, while the page is still that writing and the take is still kept. */
  private theTakeOfThePage(): string | null {
    const onThePage = this.theTakeOnThePage;
    return onThePage !== null &&
      onThePage.exercise === this.runtime.controller.openedExercise &&
      this.runtime.takes.find(onThePage.takeId) !== null
      ? onThePage.takeId
      : null;
  }

  /**
   * The sketch the page was written down from, while the page is still that
   * writing and the sketch is still there.
   */
  private theSketchOfThePage(): { readonly sketch: StoredSketch; readonly exercise: Exercise } | null {
    const onThePage = this.theSketchOnThePage;
    return onThePage !== null &&
      onThePage.exercise === this.runtime.controller.openedExercise &&
      this.runtime.sketches.find(onThePage.sketch.id) !== null
      ? onThePage
      : null;
  }

  /**
   * The knobs a reader may teach, one under each loudness in Sound: the
   * notes' and the metronome's. Each is taught on its own, and both may be
   * taught the same control, which then turns the two together.
   */
  private theKnobs(): readonly KnobPlace[] {
    return [
      {
        knob: this.runtime.volumeKnob,
        button: this.el.learnKnob,
        status: this.el.knobStatus,
        slider: this.el.instrumentVolume,
        sets: 'the note volume',
        remember: (controller) => ({ volumeController: controller }),
      },
      {
        knob: this.runtime.metronomeKnob,
        button: this.el.learnMetronomeKnob,
        status: this.el.metronomeKnobStatus,
        slider: this.el.metronomeVolume,
        sets: "the metronome's volume",
        remember: (controller) => ({ metronomeController: controller }),
      },
    ];
  }

  /**
   * Follows the knobs the reader taught, and says what each is doing.
   *
   * A knob writes through its slider rather than past it, so the two can
   * never disagree about how loud something is - a hidden second volume is
   * how a reader ends up turning something that changes nothing.
   */
  private bindTheKnobs(): void {
    for (const place of this.theKnobs()) {
      const knob = place.knob;

      this.subscriptions.push(
        knob.events.on('moved', ({ value }) => {
          place.slider.value = String(Math.round(value * 100));
          this.applyVolumes(true);
        }),
      );

      this.subscriptions.push(
        knob.events.on('learned', ({ controller }) => {
          this.runtime.settings.saveAudio({
            ...this.runtime.settings.currentAudio,
            ...place.remember(controller),
          });
          this.describeKnob(place);
        }),
      );

      this.subscriptions.push(
        knob.events.on('heard', ({ controller, value, positions }) => {
          // Says what arrived even when it is the wrong control, so silence
          // here means the keyboard sent nothing rather than that the app did.
          place.status.textContent =
            positions < 2
              ? `Heard CC ${controller} at ${Math.round(value * 100)}% — keep turning.`
              : `Heard CC ${controller} at ${Math.round(value * 100)}% — nearly there.`;
        }),
      );

      this.subscriptions.push(knob.events.on('listeningChanged', () => this.describeKnob(place)));
      this.describeKnob(place);
    }
  }

  private describeKnob(place: KnobPlace): void {
    const { knob, button, status } = place;
    button.dataset['listening'] = String(knob.isLearning);
    if (knob.isLearning) {
      button.textContent = 'Cancel';
      status.textContent = 'Turn the knob you want to use. Nothing here means it sends no MIDI.';
      return;
    }
    if (knob.controller !== null) {
      button.textContent = 'Forget';
      status.textContent = `Knob CC ${knob.controller} sets ${place.sets}.`;
      return;
    }
    button.textContent = 'Use a knob';
    status.textContent = 'Teach the app which control on your keyboard to follow.';
  }

  /** True while a run is under way, paused included: it is still that run. */
  private get isPlaying(): boolean {
    const status = this.runtime.controller.session?.status;
    return status === 'running' || status === 'counting-in' || status === 'paused';
  }

  private updateButtons(status: SessionStatus): void {
    // A performance counts as a run here. It is what Start starts in the
    // listening frame, so it is what Start has to say next about - the
    // button used to have a twin beside it saying this for the performance
    // alone, which is the twin this replaces.
    const controller = this.runtime.controller;
    // And a replay, which is not a session either: held part way through it
    // is held, and ready at its start it is ready.
    const replaySounding = this.replayIsSounding;
    const running =
      status === 'running' || status === 'counting-in' || controller.isListening || replaySounding;
    const paused =
      status === 'paused' ||
      controller.isListeningPaused ||
      (controller.replaying && !replaySounding && this.replayAtMs > 0);
    // What is being practised is settled before a run and not during one: a
    // run is graded, and a passage moved halfway through makes the report a
    // report of nothing in particular. The markers stay on the page saying
    // what is being read; only the handles go.
    for (const input of [
      this.el.focusFrom,
      this.el.focusTo,
    ]) {
      input.disabled = running || paused;
    }
    this.showPassageMarkers();
    this.describePassageRange();


    // One button for all three, as a transport has: an icon says which of
    // them it is now, and the accessible name says it in words.
    const label = running ? 'Pause' : paused ? 'Resume' : 'Start';
    this.el.focusPlay.setAttribute('aria-label', label);
    this.el.focusPlay.title = label;
    this.el.focusPlayIcon.setAttribute('d', running ? PAUSE_ICON : PLAY_ICON);
    this.describeStopping();
    this.applyPlayingChrome();
  }

  /**
   * Takes the interface away while there is music to attend to.
   *
   * What is left is two buttons floating over the score - the one that
   * pauses and the one that stops - and nothing else: no pill, no drawer, no
   * handle, and not even the bar they sat in. A reader mid-piece has their
   * hands on the keys and their eyes on the page, so every control that is
   * not one of those two is something to look past.
   *
   * A pause does not bring it back. Stopping does, which is the difference
   * between the two buttons: a pause is a place held inside a reading and
   * the reading is still what is happening.
   *
   * The look before a run counts as playing, because the whole point of the
   * look is to read the page.
   *
   * One attribute, and the stylesheet does the rest - nothing here measures
   * or moves anything.
   */
  /**
   * Whether anything is happening to the music.
   *
   * One answer, because everything that stands over the page has to agree about
   * it: a performance counts, and so does a run held part way through - a reader
   * who stopped to work something out is still at the keyboard.
   *
   * And a run being shown again, held or going: the page is the replay's, and
   * the bar folds away to its buttons as it does for a run. His: "я очікував
   * побачити 3 кнопки посеред екрану як у грі коли стартуєш грати".
   */
  private somethingIsPlaying(): boolean {
    const controller = this.runtime.controller;
    return (
      this.isPlaying ||
      this.isPreviewing ||
      controller.isListening ||
      controller.isListeningPaused ||
      controller.replaying
    );
  }

  private applyPlayingChrome(): void {
    // A performance counts as playing. It is not a session, so the bar used
    // to keep all its chrome over music that was going - and Stop, which now
    // stands only while there is something to stop, would have been the one
    // button missing exactly where it is needed.
    const playing = this.somethingIsPlaying();
    this.applyPreview();
    // The way back to the last reading goes with the rest of the chrome: over
    // music that is playing it is a button for something the reader is not
    // looking at, and the page should be the page. His: "коли гра почалась -
    // можеш і пілюлю з last run теж ховати?".
    this.offerTheLastReading();
    this.el.focusBar.dataset['playing'] = String(playing);
    this.applyKeyboardVisibility();
    // His: hold the screen while there is a run, and let it go when there is
    // not - including while one is paused, because a reader who has stopped to
    // work something out is still at the keyboard. Asked here because this is
    // already the one place that answers "is anything happening to the music",
    // and a second answer to that question could only disagree with this one.
    // A replay being watched holds it too, since it counts as playing.
    if (playing) {
      this.runtime.screenWake.hold();
    } else {
      this.runtime.screenWake.release();
    }
    // Said on the page as well as on the bar, because things standing over
    // the music are not all inside it - the corner that names the modes is
    // at the other end of the layout and has to fade with the rest.
    this.doc.body.dataset['playing'] = String(playing);
    this.showTheListening();
    // The falling bar belongs to a run, so it comes and goes with one. Health
    // itself only reports when it moves, and a run that has just begun has
    // not moved anything yet.
    this.renderHealth(this.runtime.controller.health);
    if (playing) {
      // Shut rather than merely hidden, so what comes back when the music
      // stops is the bar the reader left, not a drawer they never opened.
      this.setDrawerOpen(false);
      this.putTheRestAwayForTheMusic();
    }
  }

  private renderResult(score: SessionScore, report: PerformanceReport): void {
    this.showVerdict(true);
    // Offered only when the run actually left something to work on; a clean
    // reading has no worst bars, and a button that says otherwise is noise.
    this.el.drill.hidden = worstPassage(report) === null;
    // A score is the same score however often it is opened; only a generated
    // page has another one behind it.
    this.el.verdictFresh.hidden = !this.aGeneratedPageIsOpen();
    this.el.result.replaceChildren();

    const gradeElement = this.doc.createElement('div');
    gradeElement.className = 'result__grade';
    // The letter in its own colour, here as on a reading's row: one walk from
    // green to red, read the same whichever of the two a reader is looking at.
    gradeElement.dataset['grade'] = score.grade;
    gradeElement.textContent = score.grade;
    this.el.result.append(gradeElement);
    // Under the letter, where the reading that just moved it is being read.
    const place = this.aGeneratedPageIsOpen() ? this.placeOnTheLadder() : null;
    if (place !== null) {
      this.el.result.append(drawTheLadderTrack(this.doc, place, { ends: true }));
    }

    const rows: readonly (readonly [string, string])[] = [
      ['Overall', percent(score.overall)],
      [
        'Notes',
        `${report.totals.correctNotes}/${report.totals.expectedNotes} (${percent(score.accuracy)})`,
      ],
      ['Wrong notes', String(report.totals.wrongNotes)],
      [
        'Timing',
        `${percent(score.timing)} · ${Math.round(report.timing.meanAbsoluteDeviationMs)} ms avg`,
      ],
      [
        'Tendency',
        `${describeTendency(report.timing.meanDeviationMs)} · ± ${Math.round(report.timing.deviationSpreadMs)} ms`,
      ],
      ...barsWaitedRow(report),
      ...historyRow(this.runtime.controller.passageHistory()),
      ...(this.lastLadderMove === null
        ? []
        : ([
            [
              this.lastLadderMove.direction === 'up' ? 'Moved up' : 'Moved down',
              `${this.lastLadderMove.to.label} · ${this.lastLadderMove.to.description}`,
            ],
          ] as const)),
    ];
    // Said once, about the run that caused it.
    this.lastLadderMove = null;
    this.drawTheBars(report);
    this.drawTheProfileOf(report);
    this.drawTheHitErrorsOf(report);
    this.offerTheRoll();
    for (const [label, value] of rows) {
      const row = this.doc.createElement('div');
      row.className = 'result__row';
      const name = this.doc.createElement('span');
      name.textContent = label;
      const strong = this.doc.createElement('strong');
      strong.textContent = value;
      row.append(name, strong);
      this.el.result.append(row);
    }
  }

  /**
   * The way in to the picture of the run, where there is a run to picture.
   *
   * A button rather than the drawing itself: the report is read at a glance
   * with a verdict on it, and a grid of every note played is the opposite of a
   * glance. His: "додати кнопку в кінці у статистиці щоб відчинити цей діалог
   * з MIDI viewer".
   */
  private offerTheRoll(): void {
    const roll = this.runtime.controller.lastRoll;
    if (roll === null || roll.presses.length === 0) {
      return;
    }
    const open = this.doc.createElement('button');
    open.type = 'button';
    open.id = 'run-roll-open';
    open.className = 'button button--ghost result__roll';
    open.textContent = 'See what you played';
    this.listen(open, 'click', () => {
      this.showTheRoll();
    });
    this.el.result.append(open);
    // And the way to see it again on the notes, beside the picture of it. His:
    // "See replay щоб перейти у ноти та побачити гру на самих нотах".
    if (!this.runtime.controller.canReplay(roll)) {
      return;
    }
    const replay = this.doc.createElement('button');
    replay.type = 'button';
    replay.id = 'run-replay';
    replay.className = 'button button--ghost result__roll';
    replay.textContent = 'See replay';
    this.listen(replay, 'click', () => {
      const controller = this.runtime.controller;
      this.replayTheRun(roll, controller.lastPlayedWith ?? { modeId: controller.settings.modeId, modes: [] });
    });
    this.el.result.append(replay);
  }

  /**
   * Whether a kept reading can be shown again on the notes.
   *
   * Where it kept what was played, and of a piece that is open or kept on this
   * device - and, where that piece is the one open, where the reading still fits
   * it as it is now. A generated exercise is another one every time, so there is
   * nothing to show one of its readings on.
   */
  private canReplayTheReading(reading: PracticeReading): boolean {
    const roll = reading.roll;
    if (roll === undefined) {
      return false;
    }
    const piece = pieceOfKey(reading.key);
    // A level is filed under what it was generated from, and it is generated
    // afresh: the one open now is not the one the reading was of.
    if (!piece.startsWith('score:')) {
      return false;
    }
    if (piece === this.runtime.controller.pieceKey) {
      return this.runtime.controller.canReplay(roll);
    }
    return this.keptScoreFor(piece) !== null;
  }

  /**
   * Whether a kept reading was played on the score open now, as it is now.
   *
   * The same question a replay asks before it puts a reading on the notes. A
   * generated exercise is another one every time it is made, so a reading of
   * one was never played on the one open.
   */
  private wasPlayedOnTheOpenScore(reading: PracticeReading, roll: RunRoll): boolean {
    const piece = pieceOfKey(reading.key);
    const timeline = this.runtime.controller.currentTimeline;
    return (
      piece.startsWith('score:') &&
      piece === this.runtime.controller.pieceKey &&
      timeline !== null &&
      replayFits(roll, timeline)
    );
  }

  /** The kept score a reading's piece is, by the title it was filed under. */
  private keptScoreFor(piece: string): StoredScoreSummary | null {
    if (!piece.startsWith('score:')) {
      return null;
    }
    const title = piece.slice('score:'.length);
    return this.runtime.scores.list().find((score) => score.title === title) ?? null;
  }

  /**
   * Shows a kept reading again on the notes, opening its piece first where
   * another is open.
   */
  private async replayTheReading(reading: PracticeReading): Promise<void> {
    const roll = reading.roll;
    if (roll === undefined) {
      return;
    }
    this.shutTheReading();
    this.el.sheetReadings.hidden = true;
    const piece = pieceOfKey(reading.key);
    if (piece !== this.runtime.controller.pieceKey) {
      const kept = this.keptScoreFor(piece);
      if (kept === null) {
        return;
      }
      await this.openKeptScore(kept.id, kept.title);
    }
    this.replayTheRun(roll, {
      modeId: reading.modeId ?? this.runtime.controller.settings.modeId,
      // A reading kept before the squares were written down says only its frame.
      modes: reading.modes ?? [],
    });
  }

  /**
   * Puts a run on the notes again, and plays it.
   *
   * The page takes it over: the marks come off, the marker goes to where the
   * music began, and the transport is the replay's - Start plays and holds it,
   * Stop ends it and leaves the run's marks where they were made, and the tempo
   * buttons say how fast it is played back.
   */
  private replayTheRun(roll: RunRoll, playedWith: PlayedWith): void {
    this.showVerdict(false);
    this.endTheReplay();
    // The player is the run's now.
    this.letGoOfTheTakeOnTheKeys();
    if (!this.runtime.controller.beginReplay(roll, playedWith)) {
      this.sayInTheMiddle(
        'This run was played on the piece as it was then, and does not fit it as it is now.',
      );
      return;
    }
    this.replayRoll = roll;
    this.replayAtMs = 0;
    this.replayLengthMs = rollAsEvents(roll).reduce((longest, event) => Math.max(longest, event.atMs), 0);
    this.el.replayOnKeys.hidden = false;
    this.describeTheReplaysBar();
    this.replayClicksSent = 0;
    this.placeTheSpeed();
    this.doc.body.dataset['replaying'] = 'true';
    this.showTheModes();
    this.applyKeyboardVisibility();
    this.showTheReplaysKeys(0);
    const scrolled = scrollToShow(this.replayKeyboard, roll.presses[0]?.midi ?? MIDDLE_C);
    if (scrolled !== null) {
      this.replayKeyboard.scroller.scrollLeft = scrolled;
    }
    this.describeTempo();
    // Going at once: pressing "See replay" was asking to see it, and a replay
    // standing at its first note is one more press before that. His: "коли я
    // починаю "see replay" - я думаю що варто запускати replay автоматично".
    this.toggleTheReplay();
  }

  /**
   * The keys down and the pedal, a moment into the replay.
   *
   * Where the screen is too narrow for the whole keyboard, a key lit out of
   * sight brings the row round to it: a key pressed off the edge is a press
   * nobody sees.
   */
  private showTheReplaysKeys(atMs: number): void {
    const state = this.runtime.controller.replayKeysAt(atMs);
    if (state === null) {
      return;
    }
    lightTheKeys(this.replayKeyboard, state.keys, state.pedal);
    if (state.keys.size > 0) {
      keepInView(this.replayKeyboard, Math.min(...state.keys.keys()));
    }
  }

  /** Whether the replay is sounding now, rather than held or ready. */
  private get replayIsSounding(): boolean {
    return this.replayRoll !== null && this.runtime.takePlayer.playing === RUN_REPLAY_ID;
  }

  /** Start, over a replay: plays it from where it was held, or holds it. */
  private toggleTheReplay(): void {
    const roll = this.replayRoll;
    if (roll === null) {
      return;
    }
    const player = this.runtime.takePlayer;
    if (player.playing === RUN_REPLAY_ID) {
      this.holdTheReplay();
      return;
    }
    const from = this.replayAtMs;
    player.setSpeed(this.theRollsSpeed());
    player.play(RUN_REPLAY_ID, rollAsEvents(roll), from);
    // Those due at once handed over at once, as the notes are: see `clickAheadOfTheRoll`.
    this.replayClicksSent = this.clickTheRunsBeats(roll, clicksBefore(roll, from, this.theRollsGrid()), from);
    this.runtime.controller.replayAt(from);
    this.showTheReplaysKeys(from);
    this.letTheKeysFollow();
    if (this.replayTick === null) {
      this.replayTick = setInterval(() => {
        this.followTheReplay();
      }, TAKE_TICK_MS);
    }
    this.showThePerformance();
  }

  /** Moves the page along with the sound: the marks made by now, and the marker. */
  private followTheReplay(): void {
    const roll = this.replayRoll;
    const player = this.runtime.takePlayer;
    if (roll === null) {
      return;
    }
    player.pump();
    if (player.playing !== RUN_REPLAY_ID) {
      // Something else took the player over.
      this.holdTheReplay();
      return;
    }
    const at = player.positionMs;
    this.replayAtMs = at;
    this.replayClicksSent = this.clickTheRunsBeats(roll, this.replayClicksSent, at);
    this.runtime.controller.replayAt(at);
    this.showTheReplaysKeys(at);
    this.describeTheReplaysBar();
    // Over when it has played out, as a run is: the page comes back with the
    // whole run on it. His: "щоб не треба було додивлюватись до кінця" - Stop
    // is the way out before then.
    if (player.finished) {
      this.endTheReplay();
    }
  }

  /**
   * Puts the replay at the moment the run reached a bar, playing on from
   * there if it was playing and held there if it was held.
   *
   * A hold on a bar is otherwise the reader placing where the next run starts
   * and the ends of its passage. While a run is shown again the reader is
   * looking for a stretch of it, so those are left as they are; and a replay
   * that could only be watched from its beginning made a stretch in the middle
   * of a long run a wait.
   */
  private replayFromBar(measureIndex: number): void {
    const controller = this.runtime.controller;
    const at = controller.replayMomentOfBar(measureIndex);
    if (at === null) {
      // By its place in the playing, which is the number printed over it.
      this.sayInTheMiddle(`The run did not get to bar ${String(measureIndex + 1)}.`);
      return;
    }
    this.putTheReplayAt(at);
  }

  /**
   * Puts the replay at a moment of the run, playing on from there if it was
   * playing and held there if it was held: the marks made by then on the
   * page, the marker, the keys down, the notes falling, and the slider.
   */
  private putTheReplayAt(at: number): void {
    if (this.replayRoll === null) {
      return;
    }
    const controller = this.runtime.controller;
    const going = this.replayIsSounding;
    this.holdTheReplay();
    this.replayAtMs = at;
    if (going) {
      this.toggleTheReplay();
      return;
    }
    controller.replayAt(at);
    this.showTheReplaysKeys(at);
    // Held, the lane stands still, so it is shown once at the new moment.
    if (!this.el.replayKeys.hidden && controller.settings.keysShown === 'falling-notes') {
      this.paintTheFallingNotes();
    }
    this.describeTheReplaysBar();
    // Held at its start it is ready, and anywhere past it held: the bar says which.
    this.showThePerformance();
  }

  /** Play it again, over a replay: the replay from its beginning. */
  private replayFromTheTop(): void {
    this.holdTheReplay();
    this.replayAtMs = 0;
    this.toggleTheReplay();
  }

  /** Holds a replay where it is, to be played on from there. */
  private holdTheReplay(): void {
    const player = this.runtime.takePlayer;
    if (player.playing === RUN_REPLAY_ID) {
      this.replayAtMs = player.positionMs;
      player.pause();
    }
    if (this.replayTick !== null) {
      clearInterval(this.replayTick);
      this.replayTick = null;
      // Handed over ahead of the sound, as its notes are.
      this.runtime.metronomeClick.takeBackTheClicks();
    }
    this.describeTheReplaysBar();
    this.showThePerformance();
  }

  /** Ends a replay, leaving the run's marks on the page where they were made. */
  private endTheReplay(): void {
    // Which the controller says, and `letGoOfTheReplay` hears.
    this.runtime.controller.endReplay();
    this.letGoOfTheReplay();
  }

  /**
   * Takes down what was put up for a replay: its sound, the keyboard under it
   * and the bar raised over that.
   *
   * On the controller saying the replay is over, and not on Stop alone:
   * another piece opened or a run begun ends one as well. See `replayEnded`.
   */
  private letGoOfTheReplay(): void {
    if (this.replayRoll === null) {
      return;
    }
    this.holdTheReplay();
    this.replayRoll = null;
    this.el.replayOnKeys.hidden = true;
    this.placeTheSpeed();
    lightTheKeys(this.replayKeyboard, new Map(), false);
    delete this.doc.body.dataset['replaying'];
    this.showTheModes();
    this.applyKeyboardVisibility();
    this.showThePerformance();
    this.describeTempo();
  }

  /**
   * The keyboard docked under the page and the notes falling onto it, as the
   * music and the reader's choice have them now.
   *
   * Up while a run is shown again or the music is played back, as much of it
   * as the reader has asked for, and put out when neither is going. Worked
   * out from the controller every time, never from what the page last said,
   * so whatever ends a performance takes the keyboard away the next time the
   * page is brought up to date - not only Stop and the music's own end.
   */
  private applyKeyboardVisibility(): void {
    const controller = this.runtime.controller;
    const shows = controller.settings.keysShown;
    const show = shows !== 'none';
    // What is over the page now, and what a press brings: the button goes
    // round three, and a picture of three is not enough to say which comes
    // next.
    const next = KEYS_SHOWN[(KEYS_SHOWN.indexOf(shows) + 1) % KEYS_SHOWN.length] ?? 'falling-notes';
    const title = `${KEYS_SHOWN_SAID[shows]}. Press for ${KEYS_SHOWN_SAID[next].toLowerCase()}.`;
    this.el.focusKeyboard.dataset['shows'] = shows;
    this.el.focusKeyboard.title = title;
    this.el.focusKeyboard.setAttribute('aria-label', title);
    this.el.replayKeys.dataset['shows'] = shows;
    this.describeThePedalToggle();

    const inReplay = this.replayRoll !== null;
    const inPlayback = controller.isListening || controller.isListeningPaused;
    const inFreePlay = this.inFreePlay;
    const active = inReplay || inPlayback || inFreePlay || this.takeOnTheKeys !== null;
    // Said on the page for the stylesheet, which lifts the bar over the keys.
    if (inPlayback) {
      this.doc.body.dataset['listening'] = 'true';
    } else {
      delete this.doc.body.dataset['listening'];
    }
    this.el.listenOnKeys.hidden = !inPlayback;
    // And which, in free play, puts away what there is nothing to do with:
    // no run to start or rewind, and nothing to repeat or play faster.
    if (inFreePlay) {
      this.doc.body.dataset['freePlay'] = 'true';
    } else {
      delete this.doc.body.dataset['freePlay'];
    }
    if (!active) {
      lightTheKeys(this.replayKeyboard, new Map(), false);
    }
    if (!inFreePlay) {
      this.el.freeChord.hidden = true;
      // A key held on the screen as free play ended is let go of with it.
      this.runtime.screenKeys.releaseAll();
    }
    if (!active || shows !== 'falling-notes') {
      // Nothing is falling, and the picture of what was is let go of with
      // the memory it holds - the height of the screen of it. Painting sizes
      // it again.
      this.replayKeyboard.lane.width = 0;
      this.replayKeyboard.pedalLane.width = 0;
    }
    if (!controller.settings.pedalFalls) {
      this.replayKeyboard.pedalLane.width = 0;
    }

    if (active && show) {
      this.el.replayKeys.hidden = false;
      delete this.doc.body.dataset['keysHidden'];
    } else if (active && !show) {
      this.el.replayKeys.hidden = true;
      this.doc.body.dataset['keysHidden'] = 'true';
    } else {
      this.el.replayKeys.hidden = true;
      delete this.doc.body.dataset['keysHidden'];
    }
    this.sayWhetherNotesFall();
    this.placeTheSlider();
    this.letTheNotesFall();
  }

  /**
   * Plays the keys drawn on the screen, where the reader plays freely.
   *
   * Each finger or the pointer is on one key at a time, from going down on
   * it to coming up. Slid along the keys it plays each one it comes to and
   * lets go of the one it left - the mouse always, a finger only where the
   * whole keyboard is on the screen. Where the row is wider than the screen
   * a finger's slide moves the row along instead, and the key it went down
   * on is let go of as the slide begins, the browser cancelling it. Anywhere
   * else the keys only show what is played, and touching them does nothing.
   */
  private bindTheKeysOnTheScreen(): void {
    const keys = this.runtime.screenKeys;
    const row = this.replayKeyboard.row;
    const fingers = new Map<number, { readonly midi: number | null; readonly slides: boolean }>();
    const keyAt = (under: Element | null): number | null => {
      const key = under?.closest<HTMLElement>('[data-midi]') ?? null;
      const midi = Number(key?.dataset['midi']);
      return key !== null && row.contains(key) && Number.isInteger(midi) ? midi : null;
    };
    // A key one finger has left may still be under another.
    const leave = (midi: number | null): void => {
      if (midi !== null && ![...fingers.values()].some((finger) => finger.midi === midi)) {
        keys.release(midi);
      }
    };
    this.listen(row, 'pointerdown', (event) => {
      if (!(event instanceof PointerEvent) || !this.inFreePlay) {
        return;
      }
      const midi = keyAt(event.target instanceof Element ? event.target : null);
      if (midi === null) {
        return;
      }
      fingers.set(event.pointerId, { midi, slides: event.pointerType === 'mouse' || !this.keysScroll });
      keys.press(midi);
    });
    this.listen(this.doc, 'pointermove', (event) => {
      const finger = event instanceof PointerEvent ? fingers.get(event.pointerId) : undefined;
      if (!(event instanceof PointerEvent) || finger === undefined || !finger.slides || !this.inFreePlay) {
        return;
      }
      // Asked of the point and not of the event: a finger's events keep
      // going to the key it went down on, wherever it has slid since.
      const midi = keyAt(this.doc.elementFromPoint(event.clientX, event.clientY));
      if (midi === finger.midi) {
        return;
      }
      fingers.set(event.pointerId, { midi, slides: true });
      leave(finger.midi);
      if (midi !== null) {
        keys.press(midi);
      }
    });
    for (const type of ['pointerup', 'pointercancel'] as const) {
      this.listen(this.doc, type, (event) => {
        const finger = event instanceof PointerEvent ? fingers.get(event.pointerId) : undefined;
        if (!(event instanceof PointerEvent) || finger === undefined) {
          return;
        }
        fingers.delete(event.pointerId);
        leave(finger.midi);
      });
    }
  }

  /**
   * Says whether the slider through a take, a run shown again or a
   * performance stands under the keys, as the switch under the pedal's mark has it - and always where
   * the keys are put away, there being nowhere else to reach it from then.
   */
  private placeTheSlider(): void {
    const settings = this.runtime.controller.settings;
    const toggle = this.replayKeyboard.sliderToggle;
    const said = settings.sliderShown ? 'Hide the slider' : 'Show the slider under the keys';
    toggle.setAttribute('aria-pressed', String(settings.sliderShown));
    toggle.title = said;
    toggle.setAttribute('aria-label', said);
    const controller = this.runtime.controller;
    if (
      this.takeOnTheKeys === null &&
      this.replayRoll === null &&
      !controller.isListening &&
      !controller.isListeningPaused
    ) {
      delete this.doc.body.dataset['slider'];
      return;
    }
    // Put away, it stays away with the keys put away too, so the score can
    // be all there is; the keyboard brought back brings its switch.
    this.doc.body.dataset['slider'] = settings.sliderShown ? 'shown' : 'put-away';
  }

  /**
   * Says on the page for the stylesheet whether notes are moving, which lets
   * them be seen through the bar while they go behind it. Only while they
   * move: held, the bar is what the reader is about to press.
   */
  private sayWhetherNotesFall(): void {
    if (this.notesAreFalling) {
      this.doc.body.dataset['notesFalling'] = 'true';
    } else {
      delete this.doc.body.dataset['notesFalling'];
    }
  }

  /**
   * Whether the reader is playing freely: the frame chosen, and nothing else
   * using the keyboard - a run shown again or a performance - which, started
   * from another frame, is still going.
   */
  private get inFreePlay(): boolean {
    const controller = this.runtime.controller;
    return (
      controller.playsFreely &&
      this.replayRoll === null &&
      this.takeOnTheKeys === null &&
      !controller.isListening &&
      !controller.isListeningPaused
    );
  }

  /** Lights the keys down in free play, and the pedal, as heard: nobody judged them. */
  private lightTheFreePlay(): void {
    const controller = this.runtime.controller;
    // And the chord they make, while they make one. Only here: during a run
    // the name would be the score read out for the reader.
    const chord = controller.freePlayChord;
    this.el.freeChord.textContent = chord ?? '';
    this.el.freeChord.hidden = chord === null;
    const down = controller.freePlayKeysDown;
    lightTheKeys(
      this.replayKeyboard,
      new Map<number, KeyLight>(down.map((midi) => [midi, 'heard'])),
      controller.freePlayPedalDown,
    );
    if (down.length > 0) {
      keepInView(this.replayKeyboard, Math.min(...down));
    }
  }

  /**
   * A key or the pedal went down or came up in free play: lights what is
   * down now, and sets the notes rising if they were standing still.
   */
  private showTheFreePlay(): void {
    if (!this.inFreePlay) {
      return;
    }
    this.lightTheFreePlay();
    this.sayWhetherNotesFall();
    this.letTheNotesFall();
  }

  /**
   * The moment the lane over the keyboard stands at, and how much it shows
   * ahead of it.
   *
   * A playback's on the page's clock. A replay's on its own - and at the speed
   * it is played at, so the lane always holds the same few seconds of screen
   * time and a replay slowed down falls as slowly as it sounds.
   */
  private get laneClock(): { readonly nowMs: number; readonly aheadMs: number } {
    // A take watched on the keys is on its own clock, as a replay is.
    if (this.takeOnTheKeys !== null) {
      const player = this.runtime.takePlayer;
      return { nowMs: player.positionMs, aheadMs: FALLING_AHEAD_MS * player.speed };
    }
    if (this.replayRoll !== null) {
      const player = this.runtime.takePlayer;
      return {
        nowMs: player.playing === RUN_REPLAY_ID ? player.positionMs : this.replayAtMs,
        aheadMs: FALLING_AHEAD_MS * player.speed,
      };
    }
    return { nowMs: this.runtime.clock.now(), aheadMs: FALLING_AHEAD_MS };
  }

  /**
   * The notes over the keyboard at this moment: the next few seconds of a
   * playback, or of the run being shown again.
   *
   * A playback's are the notes the player will sound, lit as heard - the
   * left hand's in its own ink. A replay's are the run's presses, in the
   * colours they were judged.
   */
  get fallingScene(): readonly LaneNote[] {
    const controller = this.runtime.controller;
    const { nowMs, aheadMs } = this.laneClock;
    if (this.inFreePlay) {
      // What has been played rises instead, as heard: nobody judged it.
      return theRisingNotes(
        controller
          .freePlayBetween(nowMs - aheadMs, nowMs)
          .map((note) => ({ ...note, shade: 'heard' as const })),
        nowMs,
        aheadMs,
      );
    }
    const until = nowMs + aheadMs;
    const watched = this.takeOnTheKeys;
    if (watched !== null) {
      // As heard: a recording, and nobody judged it.
      return theFallingNotes(
        theTakesPressesBetween(watched.keys, nowMs, until).map((note) => ({ ...note, shade: 'heard' as const })),
        nowMs,
        aheadMs,
      );
    }
    return theFallingNotes(
      this.replayRoll !== null
        ? controller.replayPressesBetween(nowMs, until)
        : controller
            .playbackKeysDownBetween(nowMs, until)
            .map((note) => ({ ...note, shade: note.staffNumber === LEFT_HAND_STAFF ? ('heard-left' as const) : ('heard' as const) })),
      nowMs,
      aheadMs,
    );
  }

  /**
   * The bar lines falling with the notes, each with the number printed over
   * its bar on the page: a playback's where the player begins each bar, a
   * replay's where the run reached it.
   */
  get fallingBarLines(): readonly LaneBarLine[] {
    const controller = this.runtime.controller;
    const { nowMs, aheadMs } = this.laneClock;
    if (this.inFreePlay) {
      return theRisingClick(controller.freeClickBetween(nowMs - aheadMs, nowMs), nowMs, aheadMs).barLines;
    }
    const until = nowMs + aheadMs;
    const bars =
      this.replayRoll !== null
        ? controller.replayBarsBetween(nowMs, until)
        : controller.playbackBarsBetween(nowMs, until);
    return theFallingBarLines(
      // Numbered by their places in the playing, as the page numbers them.
      bars.map((bar) => ({ label: String(bar.measureIndex + 1), atMs: bar.atMs })),
      nowMs,
      aheadMs,
    );
  }

  /**
   * The ruler's beats and their divisions falling with the notes, in the grid
   * the page is ruled in: a playback's where the player reaches them, a
   * replay's where the run did.
   */
  get fallingRuling(): readonly LaneRuling[] {
    const controller = this.runtime.controller;
    const { nowMs, aheadMs } = this.laneClock;
    if (this.inFreePlay) {
      // The click's beats, rising with what was played against them.
      return theRisingClick(controller.freeClickBetween(nowMs - aheadMs, nowMs), nowMs, aheadMs).ruling;
    }
    const until = nowMs + aheadMs;
    return theFallingRuling(
      this.replayRoll !== null
        ? controller.replayRulingBetween(nowMs, until)
        : controller.playbackRulingBetween(nowMs, until),
      nowMs,
      aheadMs,
    );
  }

  /**
   * The pedal falling onto its mark: a playback's as the player holds it, a
   * replay's as the run did.
   */
  get fallingPedal(): readonly LanePedal[] {
    const controller = this.runtime.controller;
    const { nowMs, aheadMs } = this.laneClock;
    if (this.inFreePlay) {
      return theRisingPedal(controller.freePlayPedalBetween(nowMs - aheadMs, nowMs), nowMs, aheadMs);
    }
    if (this.takeOnTheKeys !== null) {
      return theFallingPedal(theTakesPedalBetween(this.takeOnTheKeys.keys, nowMs, nowMs + aheadMs), nowMs, aheadMs);
    }
    const until = nowMs + aheadMs;
    return theFallingPedal(
      this.replayRoll !== null
        ? controller.replayPedalBetween(nowMs, until)
        : controller.playbackPedalBetween(nowMs, until),
      nowMs,
      aheadMs,
    );
  }

  /**
   * Whether notes are moving now, rather than held, put away or gone: falling
   * under a performance or a replay, or rising in free play for as long as
   * anything played is still in the lane - or the click is going, or a beat
   * of it is, since its beats rise with the notes.
   */
  private get notesAreFalling(): boolean {
    const controller = this.runtime.controller;
    const since = this.runtime.clock.now() - FALLING_AHEAD_MS;
    const rising =
      this.inFreePlay && (controller.freePlayedSince(since) || controller.freeClickHeardSince(since));
    const takeSounding =
      this.takeOnTheKeys !== null && this.runtime.takePlayer.playing === this.takeOnTheKeys.id;
    return (
      !this.el.replayKeys.hidden &&
      controller.settings.keysShown === 'falling-notes' &&
      (controller.isListening || this.replayIsSounding || rising || takeSounding)
    );
  }

  /**
   * Keeps the notes over the keyboard moving while music goes under it, and
   * stops them where it stops.
   *
   * A frame at a time, and only then. Each frame asks whether anything is
   * still falling, of the controller rather than of whatever last told the
   * page, so the lane stops with the music however the music was stopped.
   * Held, the lane keeps the picture it had, as the page keeps its marks; and
   * nothing is painted while nothing moves, which on a tablet is battery.
   */
  private letTheNotesFall(): void {
    const view = this.doc.defaultView;
    if (
      !this.notesAreFalling ||
      this.fallingFrame !== null ||
      view === null ||
      typeof view.requestAnimationFrame !== 'function'
    ) {
      return;
    }
    // Read again, since the ground may have turned dark since the last time.
    this.laneInks = null;
    const frame = (): void => {
      this.fallingFrame = null;
      if (!this.notesAreFalling) {
        // Held: the time until the notes fall again is no stall.
        noteTheFramesStopped();
        // Played freely, the last note has risen out of the lane: it is
        // painted once more, empty, and the bar stops letting it through.
        if (this.inFreePlay) {
          this.paintTheFallingNotes();
          this.sayWhetherNotesFall();
        }
        return;
      }
      this.paintTheFallingNotes();
      noteAFrame();
      this.fallingFrame = view.requestAnimationFrame(frame);
    };
    this.fallingFrame = view.requestAnimationFrame(frame);
  }

  /**
   * The cursors closing on the notes coming, as they stand now: each from
   * where it begins a second before its beat, to meeting on it, and met for a
   * moment after.
   */
  get closingCues(): readonly ClosingCue[] {
    const now = this.runtime.clock.now();
    return this.runtime.controller
      .notesClosingBetween(now - CLOSING_MET_MS, now + CLOSING_LEAD_MS)
      .map((notes) => ({
        stepIndex: notes.stepIndex,
        closing: Math.min(1, Math.max(0, 1 - (notes.atMs - now) / CLOSING_LEAD_MS)),
      }));
  }

  /**
   * Keeps the cursors closing while a run goes and they are asked for - and
   * while it is counted in, so the first note is seen coming - and takes them
   * off the page where it stops. A frame at a time, each asking the
   * controller again, so however a run stops the cursors stop with it.
   */
  private letTheCursorsClose(): void {
    const view = this.doc.defaultView;
    if (this.closingFrame !== null || view === null || typeof view.requestAnimationFrame !== 'function') {
      return;
    }
    const frame = (): void => {
      this.closingFrame = null;
      const controller = this.runtime.controller;
      const status = controller.session?.status;
      if (!controller.settings.closingCursors || (status !== 'running' && status !== 'counting-in')) {
        this.runtime.renderer.showClosing([]);
        return;
      }
      this.runtime.renderer.showClosing(this.closingCues);
      this.closingFrame = view.requestAnimationFrame(frame);
    };
    this.closingFrame = view.requestAnimationFrame(frame);
  }

  private stopTheNotesFalling(): void {
    noteTheFramesStopped();
    if (this.fallingFrame !== null) {
      this.doc.defaultView?.cancelAnimationFrame(this.fallingFrame);
      this.fallingFrame = null;
    }
  }

  private paintTheFallingNotes(): void {
    this.keyPlaces ??= whereTheKeysAre(this.replayKeyboard);
    this.laneInks ??= theLaneInks(this.el.replayKeys);
    paintTheLane(
      this.replayKeyboard.lane,
      { notes: this.fallingScene, barLines: this.fallingBarLines, ruling: this.fallingRuling },
      this.keyPlaces,
      this.laneInks,
      this.doc.defaultView?.devicePixelRatio ?? 1,
    );
    if (this.runtime.controller.settings.pedalFalls) {
      paintTheFallingPedal(
        this.replayKeyboard.pedalLane,
        this.fallingPedal,
        this.laneInks,
        this.doc.defaultView?.devicePixelRatio ?? 1,
      );
    }
  }

  /**
   * Says on the pedal's mark whether the pedal falls onto it, and what a
   * press of it does - dimmed, with the reason, where nothing falls at all.
   */
  private describeThePedalToggle(): void {
    const settings = this.runtime.controller.settings;
    const toggle = this.replayKeyboard.pedalToggle;
    const falls = settings.pedalFalls;
    toggle.dataset['falls'] = String(falls);
    toggle.setAttribute('aria-pressed', String(falls));
    const said = falls ? 'The pedal falls onto its mark. Press to hide it.' : 'The pedal is hidden. Press to let it fall.';
    if (settings.keysShown === 'falling-notes') {
      delete toggle.dataset['idle'];
      toggle.title = said;
    } else {
      // Not refused: what it is set to is kept for when the notes fall again.
      toggle.dataset['idle'] = 'true';
      toggle.title = `${said} Nothing falls while the keyboard is shown alone.`;
    }
    toggle.setAttribute('aria-label', toggle.title);
  }

  /**
   * Tells the stylesheet how tall the transport bar is, whenever that changes.
   *
   * The bar is fixed to the foot of the window and out of the flow. Its height
   * depends on the width, since on a narrow screen the pills join it as rows,
   * and on whether the drawer is open, so the stylesheet has no way to know
   * it. What stands over the page keeps clear of the bar by this number. The
   * position is still the stylesheet's to work out; only the height is told.
   */
  private sayHowTallTheBarIs(): void {
    const view = this.doc.defaultView;
    if (view === null || typeof view.ResizeObserver !== 'function') {
      return;
    }
    const watch = new view.ResizeObserver(() => {
      this.doc.documentElement.style.setProperty(
        '--focus-bar-height',
        `${String(this.el.focusBar.offsetHeight)}px`,
      );
    });
    watch.observe(this.el.focusBar);
    this.subscriptions.push(() => {
      watch.disconnect();
    });
  }

  /**
   * Says whether the keys are wider than their screen, each time either
   * changes size: the browser has to be told before a finger lands whether a
   * slide along the keys plays them or moves the row, and only the laid-out
   * page knows whether there is anywhere to move it.
   */
  private sayWhetherTheKeysScroll(): void {
    const view = this.doc.defaultView;
    if (view === null || typeof view.ResizeObserver !== 'function') {
      return;
    }
    const { scroller, row } = this.replayKeyboard;
    const watch = new view.ResizeObserver(() => {
      this.keysScroll = scroller.scrollWidth > scroller.clientWidth;
      row.dataset['scrolls'] = String(this.keysScroll);
    });
    watch.observe(scroller);
    watch.observe(row);
    this.subscriptions.push(() => {
      watch.disconnect();
    });
  }

  /**
   * Asks the keys where they stand again when the row changes size: shown,
   * hidden, or a screen turned on its side.
   */
  private measureTheKeysAgainWhenTheyMove(): void {
    const view = this.doc.defaultView;
    if (view === null || typeof view.ResizeObserver !== 'function') {
      return;
    }
    const watch = new view.ResizeObserver(() => {
      this.keyPlaces = null;
    });
    watch.observe(this.replayKeyboard.row);
    this.subscriptions.push(() => {
      watch.disconnect();
    });
  }

  /**
   * Lights the keys held down at this step of the playback, and scrolls the
   * ones struck there into view if needed.
   *
   * Every key the music holds, not only the step's own: a bass note under a
   * moving melody is down the whole time, and lit with the step's notes alone
   * it went dark at the melody's next note. Asked again at each step rather
   * than timed out, so the keys keep to the player's clock and a pause has
   * nothing to cancel. A note that ends between two steps - a staccato, a voice
   * falling silent - goes dark at the next step rather than at its own end.
   */
  private showThePlaybackKeys(stepIndex: number): void {
    const controller = this.runtime.controller;
    const timeline = controller.currentTimeline;
    const step = timeline?.at(stepIndex) ?? null;
    if (timeline === null || step === null) {
      return;
    }
    const hand = controller.settings.handStaff;
    const held = theStavesHoldingTheKeysAt(timeline, step.onsetTicks, hand);
    const pedalDown = pedalHeldUntil(timeline.exercise, step.onsetTicks) !== null;
    // As heard: the machine is playing, and nobody's press was judged - a key
    // only the left hand holds in that hand's ink, as its notes fall.
    lightTheKeys(
      this.replayKeyboard,
      new Map<number, KeyLight>(
        [...held].map(([midi, staves]) => [
          midi,
          staves.size === 1 && staves.has(LEFT_HAND_STAFF) ? 'heard-left' : 'heard',
        ]),
      ),
      pedalDown,
    );

    const struck = expectedFor(step, hand);
    if (struck.length > 0) {
      keepInView(this.replayKeyboard, Math.min(...struck));
    }
  }

  /**
   * The tempo buttons, over a replay: the next speed it can be played back at.
   *
   * The same speeds the picture of a run is played at, and the same setting -
   * one question, how fast to hear a run back, whichever way it is shown.
   */
  private changeTheReplaySpeed(step: number): void {
    const speeds = [...this.el.rollSpeed.options].map((option) => option.value);
    const at = speeds.indexOf(this.el.rollSpeed.value);
    const next = speeds[Math.min(speeds.length - 1, Math.max(0, at + step))];
    if (next === undefined || next === this.el.rollSpeed.value) {
      return;
    }
    this.el.rollSpeed.value = next;
    const roll = this.replayRoll;
    const player = this.runtime.takePlayer;
    if (roll !== null && player.playing === RUN_REPLAY_ID) {
      player.setSpeed(this.theRollsSpeed());
      // Placed at the old speed, so taken back and handed over again.
      this.runtime.metronomeClick.takeBackTheClicks();
      this.replayClicksSent = this.clickTheRunsBeats(
        roll,
        clicksBefore(roll, player.positionMs, this.theRollsGrid()),
        player.positionMs,
      );
    }
    this.describeTempo();
  }

  /**
   * Draws the last run into its sheet and puts it up.
   *
   * Built on opening rather than kept: a roll is a few thousand elements, and
   * the reader who never presses the button should not be paying for them.
   */
  private showTheRoll(): void {
    this.theOtherRollShowing = null;
    // A different run is a different thing to keep.
    this.el.rollKeep.disabled = false;
    if (this.theRoll() === null) {
      return;
    }
    this.stopTheRoll();
    this.rollAtMs = 0;
    this.rollScroller.to(0, 0);
    this.drawTheRollInto();
    this.showTheSheet(this.el.sheetRoll);
    this.putTheHeadWhereThePageBegins();
    // Measured after it is on the screen and not before. A hidden sheet has no
    // width, so the box saying which part of the run is in view was worked out
    // against nothing, found nothing to say, and stayed away until the first
    // scroll re-measured it. His: "minimap синій прямокутник не зявляється при
    // відчинені діалогу, а тільки при першому скролі".
    this.showTheView();
    this.sayWhatWouldBePractised();
    this.sayWhatThePictureIsOf();
  }

  /**
   * Stands the head on the map where it stands in the drawing.
   *
   * The map is where the reader looks to find a place; leaving off the one
   * place they have already chosen made them look back at the drawing to see
   * where they were. His: "можеш до мінімапу додати позицію курсору".
   */
  private sayWhereTheHeadIs(): void {
    const roll = this.theRoll();
    if (roll === null) {
      return;
    }
    // Moved, not placed, for the same reason the box beside it is: the head is
    // written to on every tick of a playback, and `left` is a layout each time.
    // The element is as wide as the map and all of it is transparent but its
    // left edge, so a share of the map is a share of the element.
    //
    // On the clock the run was played by, which is what every mark on the map
    // is placed on: the head counts from the run's own nought. Handed over as
    // it was, it read as a moment long before the run began - a minute into a
    // session, a minute before - and was held at the left edge whatever it
    // did. His: "курсор на ньому не оновлюється, а завжди стоїть на самому
    // початку".
    const share = shareOfTheRun(roll, rollBeganAtMs(roll) + this.headIsAtMs());
    this.el.rollMapHead.style.transform = `translateX(${(share * 100).toFixed(3)}%)`;
  }

  /**
   * Moves the zoom by a wheel, leaving what is under the pointer under it.
   *
   * The pointer and not the left edge: pointing at the bar that went wrong and
   * zooming in used to slide that bar off the screen, so every turn of the
   * wheel had to be followed by hunting for the place again.
   *
   * One turn moves the zoom by a small step whatever the wheel says. A notch
   * and a trackpad flick arrive as tens against ones, and a zoom taken straight
   * from either jumps; a flick becomes a run of small steps instead, which is
   * the same gesture arriving smoothly. His: "по скролу робити зум".
   */
  private scrollOrZoomTheRollByWheel(event: WheelEvent): void {
    if (this.drawnScene === null) {
      return;
    }
    // Held down, the wheel zooms: the convention every drawing program and the
    // browser's own page zoom use, and the one a trackpad pinch already
    // arrives as. His: "горизонтальний та вертикальний скроли зробити
    // звичайними скролами, а ctrl+скрол зробити zoom in/zoom out".
    if (event.ctrlKey || event.metaKey) {
      // Taken from the browser, which would zoom the whole page with it.
      event.preventDefault();
      this.zoomAlongTheRunByWheel(event.deltaY, event.clientX);
      return;
    }
    // And with Alt held it makes the rows taller or shorter: the height a
    // pinch changes on a screen, which a desk has no pinch for. Taken from
    // the browser too, which may otherwise go back a page on it.
    if (event.altKey) {
      event.preventDefault();
      this.zoomTheRowsByWheel(theWheelsTurn(event), event.clientY);
      return;
    }
    // Otherwise it scrolls, as it would have scrolled the page: both ways from
    // a trackpad, which keeps its own momentum, and along the run with shift
    // held where a mouse wheel only turns one way.
    //
    // And the browser is left the wheel, having nothing to do with it: nothing
    // around the drawing scrolls, and the page will not take a swipe for
    // "back". Taken from it, the first message of a gesture made the browser
    // wait on the page for every message after it, each then handled on its
    // own and drawn a frame later than the frame it arrived for. Measured on
    // his trackpad, a message waited a frame and more before it was drawn, on
    // either axis. His: "реагує canvas на скрол повільно". Left alone, the rest
    // of the gesture comes with the frame it is drawn in.
    this.stopTheFling();
    const unit =
      event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? this.rollScroller.viewWidePx : 1;
    const sideways = event.shiftKey && event.deltaX === 0;
    if (
      this.rollScroller.by(
        (sideways ? event.deltaY : event.deltaX) * unit,
        (sideways ? 0 : event.deltaY) * unit,
      )
    ) {
      this.askWhereTheViewIs();
    }
  }

  /** Zooms along the run by a wheel, holding the music under `clientX` where it is. */
  private zoomAlongTheRunByWheel(deltaPx: number, clientX: number): void {
    const was = Number(this.el.rollZoom.value);
    const now = zoomAfterWheel(was, deltaPx, LEAST_ZOOM, MOST_ZOOM);
    if (now !== was) {
      this.el.rollZoom.value = String(now);
      this.holdTheZoomAround(clientX, was, now);
    }
  }

  /**
   * Makes the rows taller or shorter by a wheel.
   *
   * From the row as drawn, as a pinch starts from it: the stylesheet never
   * lets the rows fall short of the room they have, and scaled from a smaller
   * row asked for, a turn up would move nothing until it had made up the
   * difference.
   */
  private zoomTheRowsByWheel(deltaPx: number, clientY: number | null): void {
    const was = Math.round(this.theRowAsDrawn());
    const now = zoomAfterWheel(was, deltaPx, LEAST_ROW, MOST_ROW);
    if (now !== was) {
      const held = this.theRowsHeldAt(clientY);
      this.rollRowPx = now;
      this.applyTheZoom();
      this.holdTheRows(held);
    }
  }

  /**
   * The pitch under a place down the view, as the rows are about to grow or
   * shrink: under `clientY`, or under the middle of the view where nothing on
   * the drawing was pointed at.
   *
   * Read before anything is written, as `holdTheZoomAround` reads its widths.
   */
  private theRowsHeldAt(clientY: number | null): RowsHeld {
    const heights = this.theRunsHeights();
    const top = clientY === null ? null : this.rollCanvases?.grid.getBoundingClientRect().top;
    return {
      ...heights,
      atPx: top === null || top === undefined || clientY === null ? heights.viewTallPx / 2 : clientY - top,
    };
  }

  /**
   * Scrolls the view down or up so the pitch that was under the place held is
   * under it again, now that the rows are a new height.
   *
   * Without it the top of the view stayed where it was in pixels, so a taller
   * row pushed what was in the middle down the view and out of it.
   */
  private holdTheRows(held: RowsHeld): void {
    const to = scrollAfterZoom(held.scrolledDownPx, held.atPx, held.wholeTallPx, this.rollScroller.wholeTallPx);
    if (this.rollScroller.to(this.rollScroller.x, to)) {
      this.askWhereTheViewIs();
    }
  }

  /**
   * A wheel over one of the maps: zooms along the axis that map is of.
   *
   * Along the run around the middle of the view, since the pointer is on the
   * map and not over any moment of the drawing. A plain wheel is left to the
   * browser, as over the drawing - nothing around the maps scrolls - and one
   * with Ctrl held is taken, being how a trackpad pinch arrives and what the
   * browser would zoom the whole page by.
   */
  private zoomByAWheelOverAMap(event: WheelEvent, axis: 'along' | 'down'): void {
    if (this.drawnScene === null) {
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
    }
    if (axis === 'down') {
      this.zoomTheRowsByWheel(theWheelsTurn(event), null);
      return;
    }
    const grid = this.rollCanvases?.grid.getBoundingClientRect();
    this.zoomAlongTheRunByWheel(
      theWheelsTurn(event),
      grid === undefined ? 0 : grid.left + grid.width / 2,
    );
  }

  /** Moves the drawing with a finger, where one is moving it. */
  private panTheRoll(event: PointerEvent): void {
    const pan = this.rollPan;
    if (pan?.pointerId !== event.pointerId || this.rollFingers.size !== 1) {
      return;
    }
    const acrossPx = event.clientX - pan.clientX;
    const downPx = event.clientY - pan.clientY;
    // A finger is never quite still: until it has gone somewhere it is a tap,
    // and a tap puts the head down.
    if (!pan.moved && Math.hypot(acrossPx, downPx) < TAP_SLOP_PX) {
      return;
    }
    pan.moved = true;
    this.panned = true;
    pan.trail.push({ atMs: event.timeStamp, x: event.clientX, y: event.clientY });
    if (pan.trail.length > 32) {
      pan.trail.splice(0, pan.trail.length - 32);
    }
    if (this.rollScroller.to(pan.fromX - acrossPx, pan.fromY - downPx)) {
      this.askWhereTheViewIs();
    }
  }

  /** A finger lets go: thrown, the drawing goes on and slows; put down, it stays. */
  private letThePanGo(event: PointerEvent, thrown: boolean): void {
    const pan = this.rollPan;
    this.rollPan = null;
    // A mouse lets go where it is, as a desktop editor's drawing stops under
    // it; a finger's throw is what keeps a drawing going.
    if (pan === null || !pan.moved || !thrown || event.pointerType === 'mouse') {
      return;
    }
    const speed = speedOf(pan.trail, event.timeStamp);
    this.rollScroller.fling(-speed.x, -speed.y);
    this.carryTheFling();
  }

  /** Carries a fling on, a frame at a time, until it has slowed to nothing. */
  private carryTheFling(): void {
    const view = this.doc.defaultView;
    if (view === null || typeof view.requestAnimationFrame !== 'function') {
      return;
    }
    if (this.flingFrame !== null) {
      view.cancelAnimationFrame(this.flingFrame);
    }
    let last: number | null = null;
    const frame = (now: number): void => {
      // The first frame has no frame before it; call it one frame's worth.
      const moved = this.rollScroller.step(last === null ? 16 : now - last);
      last = now;
      if (moved) {
        this.showTheView();
      }
      this.flingFrame = this.rollScroller.flinging ? view.requestAnimationFrame(frame) : null;
    };
    this.flingFrame = this.rollScroller.flinging ? view.requestAnimationFrame(frame) : null;
  }

  private stopTheFling(): void {
    this.rollScroller.stop();
    const view = this.doc.defaultView;
    if (this.flingFrame !== null && view !== null) {
      view.cancelAnimationFrame(this.flingFrame);
    }
    this.flingFrame = null;
  }

  /**
   * Applies a zoom and scrolls so the music under a point stays under it.
   *
   * The widths are the drawing's, so the column of key names is taken off both
   * - it does not stretch with the music and would drag the anchor sideways by
   * its own width every time.
   */
  private holdTheZoomAround(clientX: number, was: number, now: number): void {
    // Everything read before anything is written. The width that follows from
    // the new zoom is arithmetic, so nothing has to be asked twice.
    const widths = this.theRunsWidths();
    const at = clientX - (this.rollCanvases?.grid.getBoundingClientRect().left ?? clientX + 1);

    this.applyTheZoom();

    const widened = (widths.wholeWidePx * now) / was;
    const to =
      widths.wholeWidePx > 0 && at >= 0
        ? scrollAfterZoom(widths.scrolledToPx, at, widths.wholeWidePx, widened)
        : widths.scrolledToPx;
    this.rollScroller.to(to, this.rollScroller.y);
    this.showTheWindow(theWindowOnTheRun(this.rollScroller.x, widths.viewWidePx, widened));
  }

  /**
   * Asks for the view to be shown again - the tiles and the boxes - and at
   * most once a frame.
   *
   * A scroll can fire many times between two frames, and every one of them used
   * to redraw the box. Drawn more often than the screen is painted, the extra
   * ones are thrown away - and they are not free, because each measures the
   * drawing again.
   *
   * The frame is what the scrolling goes through, and a zoom as well: measuring
   * the drawing straight after resizing it lays the whole of it out there and
   * then, and a pinch asks several times a frame. A redraw and the sheet
   * opening show it straight away, being single events with nothing to
   * coalesce.
   */
  private askWhereTheViewIs(): void {
    const view = this.doc.defaultView;
    if (view === null || typeof view.requestAnimationFrame !== 'function') {
      this.showTheView();
      return;
    }
    if (this.mapFrame !== null) {
      return;
    }
    this.mapFrame = view.requestAnimationFrame(() => {
      this.mapFrame = null;
      this.showTheView();
    });
  }

  /**
   * Everything that follows the part of the run on the screen, in one frame:
   * the tiles near it, and then the boxes on the maps saying where it is.
   *
   * The tiles first, because they measure the drawing and then write only
   * inside it; the boxes after, measuring a drawing already laid out. The
   * other way round, the boxes' writes made the tiles' measuring lay the page
   * out a second time.
   */
  private showTheView(): void {
    this.measureTheRoll();
    this.paintTheRoll();
    this.sayWhereTheViewIs();
  }

  /**
   * Tells the scroller how big the view and the drawing are, off the page.
   *
   * Read before anything in the frame is written, so reading it lays nothing
   * out that a write had just unsettled. The lanes do not change size when the
   * run is scrolled or zoomed, so this is the same answer every frame until
   * the sheet itself does.
   */
  private measureTheRoll(): void {
    const scene = this.drawnScene;
    const canvases = this.rollCanvases;
    if (scene === null || canvases === null) {
      return;
    }
    const lane = (canvas: HTMLCanvasElement): { widePx: number; tallPx: number } => ({
      widePx: canvas.parentElement?.clientWidth ?? 0,
      tallPx: canvas.parentElement?.clientHeight ?? 0,
    });
    const grid = lane(canvases.grid);
    const rowPx = this.theRowAsDrawn();
    this.rollLook = {
      rowPx,
      rulerTallPx: lane(canvases.ruler).tallPx,
      chordsTallPx: lane(canvases.chords).tallPx,
      pedalTallPx: lane(canvases.pedal).tallPx,
    };
    this.rollScroller.size(grid, {
      widePx: (scene.lengthMs / 1000) * Number(this.el.rollZoom.value),
      tallPx: scene.rows * rowPx,
    });
  }

  private forgetTheMapFrame(): void {
    const view = this.doc.defaultView;
    if (this.mapFrame !== null && view !== null) {
      view.cancelAnimationFrame(this.mapFrame);
    }
    this.mapFrame = null;
  }

  /**
   * Draws the box saying which part of the run is on the screen.
   *
   * Hidden rather than guessed at where nothing has been laid out: a box
   * claiming to show the whole run at the moment the reader can see none of it
   * is worse than no box.
   */
  private sayWhereTheViewIs(): void {
    const widths = this.theRunsWidths();
    const heights = this.theRunsHeights();
    this.showTheWindow(theWindowOnTheRun(widths.scrolledToPx, widths.viewWidePx, widths.wholeWidePx));
    this.showTheRowsInView(
      theWindowOnTheRun(heights.scrolledDownPx, heights.viewTallPx, heights.wholeTallPx),
    );
  }

  /**
   * Draws the box, given where it goes.
   *
   * Told rather than measuring for itself, so that a zoom can hand it numbers
   * it has already read and nothing reads the drawing after writing to it.
   */
  private showTheWindow(window: { readonly fromShare: number; readonly widthShare: number } | null): void {
    // Whatever moves this box moves the stretch of time on the screen, and
    // that is what the map down the side marks the notes of.
    this.markThePitchesIn(window);
    this.el.rollMapWindow.hidden = window === null;
    if (window === null) {
      return;
    }
    // The width is still a width: it changes when the zoom or the screen does,
    // and a box whose width were a scale would wear a scaled border with it.
    this.el.rollMapWindow.style.width = `${(window.widthShare * 100).toFixed(3)}%`;
    // Moved rather than placed. A transform is handed to the compositor and
    // changes no layout at all, where `left` is a layout on the map and makes
    // the next measurement of the drawing wait for one. That was the whole of
    // it: read the drawing, write a percentage, read it again - and each read
    // after a write had to lay out a drawing that can be thousands of notes
    // wide, on every scroll event. His: "чи можна якось швидкість оновлення
    // зони minimap прискорити? Я хочу щоб все йшло плавно".
    //
    // The share is of the *map*, and a transform's per cent is of the element
    // being moved, which is the window - so it is put in the window's own
    // widths. The division is safe: a window is drawn only where it has width.
    const along = (window.fromShare / window.widthShare) * 100;
    this.el.rollMapWindow.style.transform = `translateX(${along.toFixed(3)}%)`;
  }

  /**
   * Marks, down the side, the rows with a note in the stretch of time on the screen.
   *
   * Nothing where that stretch is not known: marks for a view nobody can see
   * would be marks of nothing in particular.
   */
  private markThePitchesIn(
    window: { readonly fromShare: number; readonly widthShare: number } | null,
  ): void {
    this.pitchWindow = window;
    const marks =
      window === null || this.rollPitches === null
        ? []
        : theMapOfThePitches(this.rollPitches, window, this.soundingRows);
    const said = marks.map((mark) => `${mark.kind}@${mark.fromShare}/${mark.heightShare}`).join();
    if (said === this.pitchMarksDrawn) {
      return;
    }
    this.pitchMarksDrawn = said;
    // The box stays over the marks, and stays the same element.
    this.el.rollPitchMap.replaceChildren(drawThePitchMap(marks), this.el.rollPitchMapWindow);
  }

  /**
   * Draws the box saying which rows are on the screen.
   *
   * The same box as the one under the drawing, turned on its side: a height
   * where that has a width, and moved by a transform for the same reason.
   */
  private showTheRowsInView(window: { readonly fromShare: number; readonly widthShare: number } | null): void {
    this.el.rollPitchMapWindow.hidden = window === null;
    if (window === null) {
      return;
    }
    this.el.rollPitchMapWindow.style.height = `${(window.widthShare * 100).toFixed(3)}%`;
    const along = (window.fromShare / window.widthShare) * 100;
    this.el.rollPitchMapWindow.style.transform = `translateY(${along.toFixed(3)}%)`;
  }

  /** Scrolls the drawing up or down to the rows a finger is on, down the side. */
  private showTheRowsWhereTheyWerePointedAt(event: PointerEvent): void {
    const box = this.el.rollPitchMap.getBoundingClientRect();
    if (box.height <= 0) {
      return;
    }
    const share = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
    const heights = this.theRunsHeights();
    const to = scrollForTheWindowAt(share, heights.viewTallPx, heights.wholeTallPx);
    this.rollScroller.to(this.rollScroller.x, to);
    this.showTheRowsInView(theWindowOnTheRun(to, heights.viewTallPx, heights.wholeTallPx));
    this.askWhereTheViewIs();
  }

  /** Scrolls the drawing to the part of the run a finger is on the map. */
  private showTheRunWhereItWasPointedAt(event: PointerEvent): void {
    const box = this.el.rollMap.getBoundingClientRect();
    if (box.width <= 0) {
      return;
    }
    const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const widths = this.theRunsWidths();
    const to = scrollForTheWindowAt(share, widths.viewWidePx, widths.wholeWidePx);
    this.rollScroller.to(to, this.rollScroller.y);
    this.showTheWindow(theWindowOnTheRun(to, widths.viewWidePx, widths.wholeWidePx));
    this.askWhereTheViewIs();
  }

  /** The drawing measured along the run: where the view stands, how wide it is, and the whole. */
  private theRunsWidths(): {
    readonly scrolledToPx: number;
    readonly viewWidePx: number;
    readonly wholeWidePx: number;
  } {
    const scrolled = this.rollScroller;
    return {
      scrolledToPx: scrolled.x,
      viewWidePx: scrolled.viewWidePx,
      wholeWidePx: scrolled.wholeWidePx,
    };
  }

  /** And down it, as rows of pitch. */
  private theRunsHeights(): {
    readonly scrolledDownPx: number;
    readonly viewTallPx: number;
    readonly wholeTallPx: number;
  } {
    const scrolled = this.rollScroller;
    return {
      scrolledDownPx: scrolled.y,
      viewTallPx: scrolled.viewTallPx,
      wholeTallPx: scrolled.wholeTallPx,
    };
  }

  /**
   * Files the run being looked at with the recordings.
   *
   * The same list, the same player and the same file format as anything played
   * outside a run: what was kept is a stream of notes with times on it, and
   * where it came from is not something the list has to know.
   */
  private keepTheRun(): void {
    const roll = this.theRoll();
    // Which never refuses from here: the picture cannot be opened for a run
    // with nothing played in it, so the button is never on offer for one. The
    // branch is the type's, not a rule of its own.
    const take = roll === null ? null : takeOfTheRun(roll);
    if (take === null) {
      return;
    }
    this.runtime.takes.keepTake(take, Date.now());
    // Kept, and the button says so. Pressed again it would file a second copy
    // of the same run under a second name, and the list is short enough that
    // two of everything is the whole of what makes it useless. His: "коли
    // натискається Keep - можеш зробити щоб кнопка становилась disabled".
    this.el.rollKeep.disabled = true;
    this.renderTakes();
  }

  /**
   * Moves one end of the passage to where the marker stands.
   *
   * The marker and not the finger: it is already the one thing in this sheet
   * that means "here", it snaps to the beat the reader meant, and it is what
   * the playback is following - so there is one answer to "where" rather than
   * two that can disagree.
   *
   * Applied at once, the way the markers on the score are. There is nothing to
   * confirm: a passage is a setting, and the button beside these is for going
   * to it rather than for agreeing to it.
   */
  private takeAnEndFromTheMarker(end: 'from' | 'to'): void {
    const controller = this.runtime.controller;
    const measureIndex = this.theBarOnThePageAt(this.headIsAtMs());
    if (measureIndex === null) {
      return;
    }
    const bar = measureIndex + 1;
    const { firstBar, lastBar } = controller.pieceBarRange;
    const settings = controller.settings;
    const from = end === 'from' ? bar : (settings.rangeFromBar ?? firstBar);
    const to = end === 'to' ? bar : (settings.rangeToBar ?? lastBar);
    controller.choosePassage(from, to);
    // The same as dragging a marker on the score, because it is the same act:
    // everything that draws the passage is drawn again. Without it the setting
    // changed and the page did not - the markers stood round the passage that
    // was there before, and stayed there until something else happened to
    // redraw them. His: "слайси ставляться з MIDI editor - але одразу не
    // перемальовуються... коли натискаю Practise this".
    this.syncControlsFromSettings();
    this.sayWhatWouldBePractised();
    // And the slice in the drawing, which is the passage.
    this.followTheSlice();
  }

  /**
   * Closes the picture and puts the reader in front of the music it named.
   *
   * The whole point of choosing a passage here: the stretch that went wrong is
   * visible in the drawing and nowhere else, and reaching it afterwards meant
   * finding it again on the page. His: "кнопку apply and jump to the slice щоб
   * перемкнутись на слайс з нот, та гравець міг ще раз спробувати цю частину".
   */
  private goAndPractiseThePassage(): void {
    // To the passage's beginning, and not where the marker was left.
    this.closeTheRoll(false);
    this.runtime.controller.cursorToStart();
  }

  /**
   * Puts the picture away, however the reader asked for it to go.
   *
   * One place, because closing it is three things and not one: the playback
   * stops, its own options go with it - a sheet left standing over a picture
   * that has been put away is a dialog about nothing - and the sheet closes.
   * Written at each way out instead, the ways out drift apart, which is how
   * one of them ended up not being a way out at all.
   */
  private closeTheRoll(carryTheMarker = true): void {
    // Where the marker was put, the page's music begins: the bar it is in,
    // since a run begins on a bar line - asked before the playback stops,
    // which takes it back to the beginning, and before the sheet goes, while
    // the drawing is still the one it is in. Only where it was put: shown
    // and shut, a drawing changes nothing, and one of a run begun later in
    // the piece would otherwise move the page's beginning to the run's.
    const placed = this.rollPlacedAtMs;
    const bar = carryTheMarker && placed !== this.headWhereShown ? this.theBarOnThePageAt(placed) : null;
    this.stopTheRoll();
    const beginThere = (): void => {
      if (bar !== null) {
        this.beginAt(bar);
      }
    };
    this.el.sheetRollOptions.hidden = true;
    this.el.sheetRoll.hidden = true;
    // The page written from a sketch changed in it is written again, so the
    // page and the sketch never disagree - and begins at the marker once it is.
    const onThePage = this.theSketchOfThePage();
    const now = onThePage === null ? null : this.runtime.sketches.find(onThePage.sketch.id);
    if (onThePage !== null && now !== null && now !== onThePage.sketch) {
      void this.writeDownTheSketch(now.id, this.el.sheetRoll).then(beginThere);
      return;
    }
    beginThere();
  }

  /**
   * The bar of the music on the page that a moment of the drawing shown is
   * in, by its place in the playing from nought; none where the drawing is
   * not of the page's music. The run just played and the score's own
   * drawing are of the score, and say so by the beats they carry; a sketch
   * is of the page written down from it, whose bars are its bars counted on
   * its beats, as the writing counts them.
   */
  private theBarOnThePageAt(atMs: number): number | null {
    const roll = this.theRoll();
    const showing = this.theOtherRollShowing;
    if (roll === null) {
      return null;
    }
    const stored = this.theSketchShownOnThePage();
    if (stored !== null) {
      const beat = theBeatOfTheClickAt(stored.events, stored.beats, atMs + rollBeganAtMs(roll));
      return beat === null ? null : beat.bar - 1;
    }
    const exercise = this.runtime.controller.currentTimeline?.exercise;
    // A beat carries the run's own clock, and a moment of the drawing is from its beginning.
    const ticks = showing !== null && !showing.ofTheOpenScore ? null : theMusicsPlaceAt(roll, atMs + rollBeganAtMs(roll));
    return exercise === undefined || ticks === null ? null : measureIndexAt(exercise, ticks);
  }

  /** Where a bar of the music on the page begins in the drawing shown, from its beginning: see `theBarOnThePageAt`. */
  private theMomentOfTheBarOnThePage(measureIndex: number): number | null {
    const roll = this.theRoll();
    const showing = this.theOtherRollShowing;
    if (roll === null) {
      return null;
    }
    const stored = this.theSketchShownOnThePage();
    if (stored !== null) {
      const downbeat = (theClickOfTheTake(stored.events, stored.beats) ?? []).filter((beat) => beat.beat === 0)[measureIndex];
      return downbeat === undefined ? null : downbeat.atMs - rollBeganAtMs(roll);
    }
    const exercise = this.runtime.controller.currentTimeline?.exercise;
    const startTicks = exercise === undefined ? undefined : barLines(exercise)[measureIndex]?.startTicks;
    return (showing !== null && !showing.ofTheOpenScore) || startTicks === undefined ? null : momentOfTicks(roll, startTicks);
  }

  /** The sketch shown, as it is kept, where the page is the one written down from it; none otherwise. */
  private theSketchShownOnThePage(): StoredSketch | null {
    const sketch = this.theOtherRollShowing?.sketch;
    return sketch === undefined || this.theSketchOfThePage()?.sketch.id !== sketch.id ? null : this.runtime.sketches.find(sketch.id);
  }

  /** Puts the marker of the drawing just shown where a run of the page's music would begin, where the drawing is of it. */
  private putTheHeadWhereThePageBegins(): void {
    const bar = this.runtime.controller.barARunBeginsAt;
    const at = bar === null ? null : this.theMomentOfTheBarOnThePage(bar);
    if (at !== null && at > 0) {
      this.putTheHeadAt(at);
    }
    this.headWhereShown = this.rollPlacedAtMs;
  }

  /**
   * Remembers where the other hand will be, and starts it walking there.
   *
   * A place already reached is taken at once: the reader's own step is
   * announced for the moment they played it, which is now.
   */
  private walkTheOtherHandTo(stepIndex: number, atMs: number): void {
    this.theOtherHandsWalk.push({ stepIndex, atMs });
    this.theOtherHandsWalk.sort((left, right) => left.atMs - right.atMs);
    this.moveTheOtherHandsMarker();
  }

  /**
   * Moves the marker to everywhere the other hand has already got to, and sets
   * one timer for the next place it has not.
   *
   * One timer and not one per step: a phrase of the other hand is a dozen
   * notes, and a dozen timers is a dozen chances to be left running.
   */
  private moveTheOtherHandsMarker(): void {
    if (this.theOtherHandsStep !== null) {
      clearTimeout(this.theOtherHandsStep);
      this.theOtherHandsStep = null;
    }
    const now = this.runtime.clock.now();
    let reached: number | null = null;
    while (this.theOtherHandsWalk.length > 0 && (this.theOtherHandsWalk[0]?.atMs ?? 0) <= now) {
      reached = this.theOtherHandsWalk.shift()?.stepIndex ?? reached;
    }
    if (reached !== null) {
      this.runtime.renderer.otherHand.moveTo(reached);
      this.runtime.renderer.otherHand.show();
    }
    const next = this.theOtherHandsWalk[0];
    if (next === undefined) {
      return;
    }
    this.theOtherHandsStep = setTimeout(
      () => {
        this.theOtherHandsStep = null;
        this.moveTheOtherHandsMarker();
      },
      Math.max(0, next.atMs - now),
    );
  }

  /**
   * Lets go of the places the other hand was still to walk to.
   *
   * The reader came in ahead of them, and the music they were in has gone with
   * its sound. Walked to after the reader's own entry, the marker went back to
   * bars already left: a second walk running behind the first.
   */
  private forgetTheOtherHandsWalkFrom(atMs: number): void {
    this.theOtherHandsWalk = this.theOtherHandsWalk.filter((place) => place.atMs <= atMs);
    this.moveTheOtherHandsMarker();
  }

  /** Takes the second marker off the page, the run being over. */
  private stopTheOtherHandsMarker(): void {
    if (this.theOtherHandsStep !== null) {
      clearTimeout(this.theOtherHandsStep);
      this.theOtherHandsStep = null;
    }
    this.theOtherHandsWalk = [];
    this.runtime.renderer.otherHand.hide();
  }

  /**
   * The roll the picture is of: a recording if one was opened, else the run.
   *
   * One accessor and not a question asked in nine places, because the answer
   * has to be the same for the drawing, the marker, the playback and the map.
   */
  private theRoll(): RunRoll | null {
    return this.theOtherRollShowing?.roll ?? this.runtime.controller.lastRoll;
  }

  /**
   * Opens the picture on a kept recording instead of on the last run.
   *
   * Nothing is drawn differently. What is missing is the grid, and it is
   * missing by itself: a recording has no beats written down, because nothing
   * was keeping its time. Lines across free playing would be a metre nobody
   * played claiming to be the one that was.
   */
  private showTheTake(id: string): void {
    const take = this.runtime.takes.find(id);
    if (take === null) {
      return;
    }
    this.stopTheRoll();
    // The list steps aside. Asking to look at a recording is asking for the
    // picture, and the sheet it was asked from stood over the thing it had just
    // opened. His: "діалог з recordings перекриває сам MIDI viewer коли я обрав
    // look at this take".
    this.el.sheetTakes.hidden = true;
    const roll = rollOfTheTake(take);
    this.theOtherRollShowing = {
      roll,
      what: 'A recording',
      why: 'Free playing: no bars to practise.',
      ofTheOpenScore: false,
      // Played to the click, its bars are its own, counted from its first.
      barLabel: barsCountedOnItsBeats(roll),
      recording: id,
    };
    this.rollAtMs = 0;
    this.rollScroller.to(0, 0);
    this.drawTheRollInto();
    this.showTheSheet(this.el.sheetRoll);
    this.showTheView();
    this.sayWhatWouldBePractised();
    this.sayWhatThePictureIsOf();
  }

  /**
   * Opens the picture on the score itself: its written notes, pedal spans and
   * bars, with no performance to measure.
   */
  private showTheScoreRoll(): void {
    // A page written from a sketch is looked at as the sketch, to be edited.
    const onThePage = this.theSketchOfThePage();
    if (onThePage !== null) {
      this.showTheSketch(onThePage.sketch.id);
      return;
    }
    const timeline = this.runtime.controller.currentTimeline;
    const exercise = timeline?.exercise ?? this.runtime.controller.currentExercise;
    if (exercise === null || timeline === null) {
      return;
    }
    this.stopTheRoll();
    this.theOtherRollShowing = {
      roll: rollOfTheScore(exercise, timeline),
      what: exercise.title || 'The score',
      why: '',
      isScore: true,
      ofTheOpenScore: true,
    };
    this.rollAtMs = 0;
    this.rollScroller.to(0, 0);
    this.drawTheRollInto();
    this.showTheSheet(this.el.sheetRoll);
    this.putTheHeadWhereThePageBegins();
    this.showTheView();
    this.sayWhatWouldBePractised();
    this.sayWhatThePictureIsOf();
  }

  /**
   * Puts away what only a run can answer.
   *
   * A recording has no passage to practise and no bar to point at - it is not
   * of this score, or of any - and keeping it again would file a second copy of
   * something already in the list.
   *
   * A score on the other hand *is* of this music: its bars are available to
   * choose from and practise, though keeping it again is still hidden since it
   * is already in the library.
   */
  private sayWhatThePictureIsOf(): void {
    const other = this.theOtherRollShowing;
    this.el.rollKeep.hidden = other !== null;
    this.sayWhatCanBeChanged();
    const isScore = other?.isScore ?? false;
    this.el.rollFrom.disabled = other !== null && !isScore;
    this.el.rollTo.disabled = other !== null && !isScore;
    this.el.rollTitle.textContent = other?.what ?? 'What you played';
    // Only a sketch is named by the reader; a recording and a score are what
    // they were.
    if (other?.sketch === undefined) {
      delete this.el.rollTitle.dataset['renamable'];
      this.el.rollTitle.removeAttribute('title');
    } else {
      this.el.rollTitle.dataset['renamable'] = 'true';
      this.el.rollTitle.title = 'Rename this sketch';
    }
    if (other !== null) {
      if (isScore) {
        this.sayWhatWouldBePractised();
      } else {
        this.el.rollPractise.disabled = true;
        this.el.rollPassageWhat.textContent = other.why;
      }
    }
  }

  /**
   * The two buttons that change a recording, as the drawing stands: deleting
   * needs a recording and a key chosen on it that is not its only one, and
   * putting back needs something deleted or moved. Each says what it is waiting for
   * rather than going grey without a word.
   */
  private sayWhatCanBeChanged(): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const editing = sketch?.editing === true;
    this.el.rollEdit.setAttribute('aria-pressed', String(editing));
    if (this.theOtherRollShowing?.recording !== undefined) {
      // A recording is a record of what was played: what is edited is a sketch
      // begun from it.
      delete this.el.rollEdit.dataset['idle'];
      this.el.rollEdit.title = BEGIN_A_SKETCH_OF_A_TAKE;
    } else if (this.theOtherRollShowing?.isScore === true) {
      // And a score is what was written, for the same reason.
      delete this.el.rollEdit.dataset['idle'];
      this.el.rollEdit.title = 'Begin a sketch of this score to edit; the score stays as it is written';
    } else if (sketch === undefined) {
      this.el.rollEdit.dataset['idle'] = 'true';
      this.el.rollEdit.title = 'Edit the notes. Only a sketch is edited: begin one from a recording or a score.';
    } else {
      delete this.el.rollEdit.dataset['idle'];
      this.el.rollEdit.title = editing
        ? 'Back to listening: a tap puts the marker'
        : 'Edit the notes: a tap chooses one, a drag moves it';
    }
    this.el.rollEdit.setAttribute('aria-label', this.el.rollEdit.title);
    this.el.rollSelect.setAttribute('aria-pressed', String(sketch === undefined ? this.boxOnTheViewer : sketch.tool === 'selection'));
    // Only a sketch has them, and they are there only while it is edited.
    for (const button of [this.el.rollDelete, this.el.rollUndo, this.el.rollRedo, this.el.rollMark, this.el.rollChordsOpen, this.el.rollRecord]) {
      button.hidden = sketch === undefined;
      if (editing) {
        delete button.dataset['away'];
      } else {
        button.dataset['away'] = 'true';
      }
    }
    this.sayWhetherItRecords();
    // The box chooses notes on any drawing: on a sketch while it is edited,
    // and on anything else to copy them out of.
    this.el.rollSelect.hidden = false;
    if (editing || sketch === undefined) {
      delete this.el.rollSelect.dataset['away'];
    } else {
      this.el.rollSelect.dataset['away'] = 'true';
    }
    // A sketch is copied from its drawer, with the rest of what a finger does to its notes.
    this.el.rollCopyChosen.hidden = sketch !== undefined;
    const toCopy = this.theNotesChosen().length > 0;
    sayWhetherIdle(
      this.el.rollCopyChosen,
      toCopy
        ? 'Copy the chosen notes, to paste into a sketch'
        : 'Copy the chosen notes, to paste into a sketch. Choose some first: draw a box around them.',
      !toCopy,
    );

    const chosen = sketch?.chosen ?? [];
    const [only] = chosen;
    if (chosen.length === 0) {
      this.el.rollDelete.dataset['idle'] = 'true';
      this.el.rollDelete.title = 'Delete a note (Delete). Tap one to choose it.';
    } else {
      delete this.el.rollDelete.dataset['idle'];
      this.el.rollDelete.title =
        chosen.length === 1 && only !== undefined
          ? `Delete the chosen note, ${midiToLabel(only.midi)} (Delete)`
          : `Delete the ${String(chosen.length)} chosen notes (Delete)`;
    }
    this.el.rollDelete.setAttribute('aria-label', this.el.rollDelete.title);

    this.sayHowLoudTheChosenAre();
    this.nameTheChosenChord();
    this.showTheChordsOfTheKey();

    if ((sketch?.before.length ?? 0) > 0) {
      delete this.el.rollUndo.dataset['idle'];
      this.el.rollUndo.title = `Put back the last change (${this.theCommandKey()}Z; again with Shift)`;
    } else {
      this.el.rollUndo.dataset['idle'] = 'true';
      this.el.rollUndo.title = `Undo (${this.theCommandKey()}Z). Nothing has been changed to put back.`;
    }
    this.el.rollUndo.setAttribute('aria-label', this.el.rollUndo.title);

    if ((sketch?.after.length ?? 0) > 0) {
      delete this.el.rollRedo.dataset['idle'];
      this.el.rollRedo.title = `Bring back the last change put back (Shift+${this.theCommandKey()}Z)`;
    } else {
      this.el.rollRedo.dataset['idle'] = 'true';
      this.el.rollRedo.title = `Redo (Shift+${this.theCommandKey()}Z). Nothing has been put back to bring back.`;
    }
    this.el.rollRedo.setAttribute('aria-label', this.el.rollRedo.title);
  }

  /**
   * The name of the chord the chosen notes make, over the drawing, wherever
   * in time each is: a chord broken into a figure is still that chord - and
   * one with a melody passing over it is mostly that chord, said with "≈",
   * each note weighing as long as it sounds (see `theChordTheNotesMake`).
   * Spelled as a sketch's key spells its black keys. Not there while they
   * make none with a name - and on a sketch none is chosen but while it is
   * edited.
   */
  private nameTheChosenChord(): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const roll = this.theRoll();
    const chosen = this.theNotesChosen();
    // How long each sounds, off the drawing: a key still down when the run ended, to its end.
    const lengthOf = new Map<string, number>();
    if (roll !== null && chosen.length > 0) {
      const ended = rollEndedAtMs(roll);
      for (const press of roll.presses) {
        lengthOf.set(`${String(press.midi)} ${String(press.downAtMs)}`, (press.upAtMs ?? ended) - press.downAtMs);
      }
    }
    // Spelled in a sketch's key; anything else, as chord charts spell it.
    const chord = theChordTheNotesMake(
      chosen.map((key) => ({ midi: key.midi, lengthMs: lengthOf.get(`${String(key.midi)} ${String(key.downAtMs)}`) ?? 0 })),
      stored === null ? null : this.theKeyAtTheHead(stored).fifths,
    );
    this.el.rollChord.textContent = chord === null ? '' : chord.exactly ? chord.name : `≈ ${chord.name}`;
    this.el.rollChord.title =
      chord?.exactly === false ? 'The chord most of the chosen notes make, by how long they sound' : 'The chord the chosen notes make';
    this.el.rollChord.hidden = chord === null;
  }

  /**
   * The chords the drawer offers for a sketch: the key's seven, then the
   * writer's own kept ones, each with what its button says under its name -
   * the key's numeral, or the bass of one kept.
   */
  private theChordsInTheDrawer(key: SketchKey): readonly ChordInTheDrawer[] {
    const { fifths } = key;
    const ofTheKey = theChordsOfTheScale(fifths, theScaleOfTheKey(key)).map(
      ({ name, numeral, midis }): ChordInTheDrawer => ({ name, under: numeral, midis, kept: false }),
    );
    const kept = this.runtime.sketches.keptChords().map(
      (midis): ChordInTheDrawer => ({
        name: theNameOfTheKeys(midis, fifths),
        under: midiToLabel(Math.min(...midis)),
        midis,
        kept: true,
      }),
    );
    return [...ofTheKey, ...kept];
  }

  /**
   * The drawer of chords, open beside a sketch being edited once asked for:
   * a button for each chord, its name and what is under it, built again only
   * when the key or the chords kept change, so a finger on one is not lost
   * from under it by a change it made; and its copy, paste and keep, which
   * the notes chosen decide.
   */
  private showTheChordsOfTheKey(): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const open = this.theChordsOfTheKeyAreOpen();
    this.el.rollChordsOpen.setAttribute('aria-pressed', String(this.chordsOfTheKeyOpen));
    this.el.rollChordsOpen.title = this.chordsOfTheKeyOpen
      ? 'Put the chords away'
      : 'Chords, to write where the cursor is, and copy and paste';
    this.el.rollChordsOpen.setAttribute('aria-label', this.el.rollChordsOpen.title);
    this.el.rollChords.hidden = !open;
    if (!open || stored === null || sketch === undefined) {
      this.pointAtTheChord(null);
      return;
    }
    const keyHere = this.theKeyAtTheHead(stored);
    const { fifths } = keyHere;
    // Nothing kept, nothing to delete: the deleting ends with the last of them.
    const anyKept = this.runtime.sketches.keptChords().length > 0;
    this.chordsBeingForgotten = this.chordsBeingForgotten && anyKept;
    const forgetting = this.chordsBeingForgotten;
    this.el.rollChordsForget.setAttribute('aria-pressed', String(forgetting));
    sayWhetherIdle(
      this.el.rollChordsForget,
      forgetting
        ? 'Done deleting chords'
        : anyKept
          ? 'Delete chords you kept: then a tap on one deletes it'
          : 'Delete chords you kept. None is kept yet.',
      !anyKept,
    );
    this.el.rollChordsList.dataset['forgetting'] = String(forgetting);
    const over = this.theChordChosenInTheLane();
    const shows = `${String(fifths)}:${theScaleOfTheKey(keyHere)} ${JSON.stringify(this.runtime.sketches.keptChords())} ${String(forgetting)} ${over?.name ?? ''}`;
    if (this.el.rollChordsList.dataset['shows'] !== shows) {
      this.el.rollChordsList.dataset['shows'] = shows;
      this.el.rollChordsList.replaceChildren(
        ...this.theChordsInTheDrawer(keyHere).map((chord, at) => {
          const button = this.doc.createElement('button');
          button.type = 'button';
          button.className = chord.kept ? 'button roll-chords__chord roll-chords__chord--kept' : 'button roll-chords__chord';
          button.dataset['chord'] = String(at);
          button.title = !forgetting
            ? over !== null
              ? `Make the chosen ${over.name} ${chord.name} (${chord.under}), moving its notes as little as they can`
              : `Write ${chord.name} (${chord.under}) where the cursor is, to the next line of the grid`
            : chord.kept
              ? `Delete ${chord.name} (${chord.under}) from the chords kept`
              : `${chord.name} is the key's own, and is not deleted`;
          button.setAttribute('aria-label', button.title);
          const name = this.doc.createElement('span');
          name.className = 'roll-chords__name';
          name.textContent = chord.name;
          const under = this.doc.createElement('span');
          under.className = 'roll-chords__numeral';
          under.textContent = forgetting && chord.kept ? '\u00d7' : chord.under;
          button.append(name, under);
          return button;
        }),
      );
    }

    const chosen = sketch.chosen.length > 0;
    sayWhetherIdle(this.el.rollCopy, chosen ? 'Copy the chosen notes' : 'Copy the chosen notes. Choose one first.', !chosen);
    const canRead = typeof this.doc.defaultView?.navigator?.clipboard?.readText === 'function';
    const toPaste = canRead || this.notesCopiedHere !== null || this.changeCopiedHere !== null;
    sayWhetherIdle(
      this.el.rollPaste,
      toPaste ? 'Paste where the cursor is' : 'Paste where the cursor is. Copy notes or a change first.',
      !toPaste,
    );

    // A chord is two keys or more chosen that go down together.
    const struckTogether = sketch.chosen.some((key) =>
      sketch.chosen.some((other) => other.downAtMs === key.downAtMs && other.midi !== key.midi),
    );
    for (const [button, way] of this.theArpeggioButtons()) {
      const breaks = `Break the chosen chords ${ARPEGGIO_WAYS[way]}, a key a step of the grid`;
      sayWhetherIdle(button, struckTogether ? breaks : `${breaks}. Choose a chord first: notes struck together.`, !struckTogether);
    }

    const keeping = this.whatKeepingWouldDo();
    this.el.rollChordsKeep.textContent = keeping.lettingGo ? '\u2212' : '+';
    sayWhetherIdle(this.el.rollChordsKeep, keeping.says, keeping.idle);
    // The cursor moved on, the chords of another key, or the drawer deleting: what is shown ahead follows.
    if (this.chordPointedAt !== null) {
      this.showTheChordAhead();
    }
  }

  /**
   * What the keep button would do with the notes chosen: keep them as a
   * chord, let go of the kept chord they are, or nothing, and why. A chord is
   * two keys or more, and the key's own are always there.
   */
  private whatKeepingWouldDo(): { readonly says: string; readonly idle: boolean; readonly lettingGo: boolean } {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const chosen = eachKeyOnce(sketch?.chosen.map((key) => key.midi) ?? []);
    if (stored === null || chosen.length < 2) {
      return { says: 'Keep the chosen notes as a chord. Choose two notes or more first.', idle: true, lettingGo: false };
    }
    const keyHere = this.theKeyAtTheHead(stored);
    const name = theNameOfTheKeys(chosen, keyHere.fifths);
    const ofTheKey = theChordsOfTheScale(keyHere.fifths, theScaleOfTheKey(keyHere)).find(({ midis }) =>
      sameKeys(midis, chosen),
    );
    if (ofTheKey !== undefined) {
      return { says: `${name} is the key's own ${ofTheKey.numeral}, here already.`, idle: true, lettingGo: false };
    }
    if (this.runtime.sketches.keptChords().some((chord) => sameKeys(chord, chosen))) {
      return { says: `Take ${name} out of the chords kept`, idle: false, lettingGo: true };
    }
    return { says: `Keep ${name}, the chosen notes, as a chord`, idle: false, lettingGo: false };
  }

  /** The drawer's buttons that break a chord, and which way each goes. */
  private theArpeggioButtons(): readonly (readonly [HTMLButtonElement, ArpeggioWay])[] {
    return [
      [this.el.rollArpeggioUp, 'up'],
      [this.el.rollArpeggioDown, 'down'],
      [this.el.rollArpeggioUpAndDown, 'upAndDown'],
    ];
  }

  /**
   * Breaks each chosen chord into one key a step of the grid as it is drawn,
   * over the chord's length: one change, put back as one, and the keys it
   * became chosen, to be broken another way after an undo or moved.
   */
  private breakTheChosenChords(way: ArpeggioWay): void {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (showing === null || sketch === undefined || stored === null) {
      return;
    }
    const lines = theMusicsBeats(showing.roll, this.theRollsGrid()).map((line) => line.atMs);
    const broken = takeWithTheChordsBroken(stored.events, sketch.chosen, lines, way);
    if (broken !== null) {
      this.changeTheSketchShowing(broken.events, [...sketch.before, asItWas(stored, sketch.chosen)], broken.keys);
    }
  }

  /** Where the sketch shown changes key, metre or pace, from its first beat, and what a mark there says: "G major 3/4 ♩=90". */
  private theMarksOfTheSketchShown(): readonly { readonly atMs: number; readonly says: string }[] {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (stored === null) {
      return [];
    }
    const clicked = theChangesOfTheClick(stored.events, stored.beats);
    const begins = clicked[0]?.atMs;
    // The key it begins in at its first bar, and every change of it at its own.
    const keys = [
      ...(begins === undefined ? [] : [{ atMs: begins, ...this.theKeyTheSketchBeginsIn(stored) }]),
      ...theKeyChangesOf(stored.events),
    ];
    const dynamics = theDynamicsOf(stored.events);
    const moments = [
      ...new Set([...clicked.map((change) => change.atMs), ...keys.map((key) => key.atMs), ...dynamics.map((dynamic) => dynamic.atMs)]),
    ].sort((one, other) => one - other);
    const near = (one: number, other: number): boolean => Math.abs(one - other) < 1;
    const marks: { atMs: number; says: string }[] = [];
    for (const atMs of moments) {
      if (marks.some((mark) => near(mark.atMs, atMs))) {
        continue;
      }
      const key = keys.find((each) => near(each.atMs, atMs));
      const change = clicked.find((each) => near(each.atMs, atMs));
      const dynamic = dynamics.find((each) => near(each.atMs, atMs));
      marks.push({
        atMs,
        says: [
          ...(key === undefined ? [] : [theNameOfTheKey(key)]),
          ...(change?.metre === undefined ? [] : [`${String(change.metre.beatsInBar)}/${String(change.metre.beatType)}`]),
          ...(change?.crotchetsPerMinute === undefined ? [] : [`\u2669=${String(change.crotchetsPerMinute)}`]),
          ...(dynamic === undefined ? [] : [theNameOfTheDynamic(dynamic, dynamics)]),
        ].join(' '),
      });
    }
    return marks;
  }

  /** The key a sketch begins in: its own, which the drawer's lists say. */
  private theKeyTheSketchBeginsIn(stored: StoredSketch): KeyOfTheMusic {
    return { fifths: stored.key.fifths, scale: theScaleOfTheKey(stored.key) };
  }

  /**
   * The key of the sketch shown where the cursor is, as a sketch keeps one:
   * what the drawer's chords are of, and the strip marks.
   */
  private theKeyAtTheHead(stored: StoredSketch): SketchKey {
    const roll = this.theRoll();
    const atMs = roll === null ? Number.NEGATIVE_INFINITY : this.headIsAtMs() + rollBeganAtMs(roll);
    const key = theKeyOfTheMusicAt(stored.events, this.theKeyTheSketchBeginsIn(stored), atMs);
    return aKeyInTheScale(key.fifths, key.scale);
  }

  /** The key the sheet's two lists say: the tonic chosen in the scale chosen - as the bar is spelt, where it is the bar's own. */
  private theKeyAskedFor(): KeyOfTheMusic {
    const scale = SCALE_NAMES.find((each) => each === this.el.rollMarkScale.value) ?? 'major';
    const tonic = Number(this.el.rollMarkKey.value);
    const here = this.keyAskedAbout?.here;
    return here !== undefined && here.scale === scale && theTonicPitchClass(here.fifths, here.scale) === tonic
      ? here
      : { fifths: theSignatureOfTheScale(tonic, scale), scale };
  }

  /** Marks on the strip the keys of the scale the cursor is in. */
  private markTheScaleOnTheStrip(): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const key = stored === null ? null : this.theKeyAtTheHead(stored);
    const inTheScale = new Set(key === null ? [] : thePitchClassesOfTheScale(key.fifths, theScaleOfTheKey(key)));
    this.rollKeysStrip?.querySelectorAll<HTMLElement>('.roll__key').forEach((each) => {
      const midi = Number(each.dataset['midi']);
      if (inTheScale.has(((midi % 12) + 12) % 12)) {
        each.dataset['inScale'] = 'true';
      } else {
        delete each.dataset['inScale'];
      }
    });
  }

  /**
   * Follows the head into another key wherever it has gone: put there, or
   * carried past a change of key by a playback or a recording. Only when
   * the key there is another, since this is asked on every step of a
   * playback and the strip and the drawer written again each time would be
   * work for nothing.
   */
  private followTheKeyWhereTheHeadGoes(): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const found = stored === null ? '' : `${stored.id} ${JSON.stringify(this.theKeyAtTheHead(stored))}`;
    if (found === this.keyAtTheHeadFollowed) {
      return;
    }
    this.keyAtTheHeadFollowed = found;
    this.followTheKeyAtTheHead();
  }

  /** What follows the cursor into another key: the drawer's chords, the strip's marks, the chosen chord's spelling. */
  private followTheKeyAtTheHead(): void {
    this.markTheScaleOnTheStrip();
    this.showTheChordsOfTheKey();
    this.nameTheChosenChord();
  }

  /** The scales the sketch shown is written in, each from where it begins, or none where no sketch is shown. */
  private theScalesOfTheSketchShown(): readonly { readonly fromMs: number; readonly pitchClasses: readonly number[] }[] {
    return this.theKeysOfTheSketchShown().map((key) => ({
      fromMs: key.fromMs,
      pitchClasses: thePitchClassesOfTheScale(key.fifths, key.scale),
    }));
  }

  /** The keys the sketch shown is in, each from where it begins: the one it begins in from the very beginning. */
  private theKeysOfTheSketchShown(): readonly KeyFrom[] {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (stored === null) {
      return [];
    }
    const begunIn = this.theKeyTheSketchBeginsIn(stored);
    return [{ atMs: Number.NEGATIVE_INFINITY, ...begunIn }, ...theKeyChangesOf(stored.events)].map((key) => ({
      fromMs: key.atMs,
      fifths: key.fifths,
      scale: key.scale,
    }));
  }

  /** Whether the chords of the key are open beside a sketch being edited. */
  private theChordsOfTheKeyAreOpen(): boolean {
    const sketch = this.theOtherRollShowing?.sketch;
    return this.chordsOfTheKeyOpen && sketch?.editing === true && this.runtime.sketches.find(sketch.id) !== null;
  }

  /**
   * Writes the sketch shown in the key the two lists say: the tonic chosen,
   * in the scale chosen, with the signature that scale on that tonic is
   * written with. Its notes stay where they are, spelt in that key.
   */
  private writeTheSketchInTheKeyChosen(): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const scale = SCALE_NAMES.find((each) => each === this.el.rollScale.value);
    if (sketch === undefined || scale === undefined) {
      return;
    }
    const tonic = Number(this.el.rollKey.value);
    this.runtime.sketches.changeTheKey(sketch.id, aKeyInTheScale(theSignatureOfTheScale(tonic, scale), scale));
    // The key spells the black keys of the chord's name, is what the drawer's
    // chords are of, and lights the rows of its notes.
    this.sayHowLoudTheChosenAre();
    this.nameTheChosenChord();
    this.showTheChordsOfTheKey();
    this.drawTheRollInto();
  }

  /**
   * The two lists of the key, as the sketch is written: its scale, and its
   * tonic among the twelve, each named as that scale on it is spelt - the
   * sketch's own as the sketch spells it, which a score it was begun from
   * may have spelt otherwise.
   */
  private sayTheKeyOfTheSketch(key: SketchKey): void {
    this.sayTheKeyIn(this.el.rollKey, this.el.rollScale, { fifths: key.fifths, scale: theScaleOfTheKey(key) });
  }

  /** A key in a tonic's list and a scale's, the tonics named as the scale on each is spelt, the key's own as it is. */
  private sayTheKeyIn(tonics: HTMLSelectElement, scales: HTMLSelectElement, key: KeyOfTheMusic): void {
    const tonic = theTonicPitchClass(key.fifths, key.scale);
    for (const option of tonics.options) {
      const pitchClass = Number(option.value);
      const { step, alter } = theTonicOfTheScale(
        pitchClass === tonic ? key.fifths : theSignatureOfTheScale(pitchClass, key.scale),
        key.scale,
      );
      option.textContent = `${step}${alterationSign(alter)}`;
    }
    tonics.value = String(tonic);
    scales.value = key.scale;
  }

  /**
   * Deletes a chord of the drawer the writer kept. One of the key's own is
   * never among those kept - the keep button will not keep one - so asked of
   * one, nothing goes.
   */
  private forgetTheChordInTheDrawer(at: number): void {
    const stored = this.theOtherRollShowing?.sketch === undefined ? null : this.runtime.sketches.find(this.theOtherRollShowing.sketch.id);
    const chord = stored === null ? undefined : this.theChordsInTheDrawer(this.theKeyAtTheHead(stored))[at];
    if (chord === undefined) {
      return;
    }
    this.runtime.sketches.letGoOfTheChord(chord.midis);
    this.showTheChordsOfTheKey();
  }

  /** Keeps the chosen notes as a chord, or lets go of the kept chord they are. */
  private keepOrLetGoOfTheChosenChord(): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const keeping = this.whatKeepingWouldDo();
    if (sketch === undefined || keeping.idle) {
      return;
    }
    const chosen = sketch.chosen.map((key) => key.midi);
    if (keeping.lettingGo) {
      this.runtime.sketches.letGoOfTheChord(chosen);
    } else {
      this.runtime.sketches.keepTheChord(chosen);
    }
    this.showTheChordsOfTheKey();
  }

  /**
   * Writes a chord of the drawer into the sketch where the cursor is - from
   * the line of the grid it is in where the marker is put on one - to the
   * next line, as loud as the sketch is on the whole: one change, put back as
   * one, heard as it is written, and chosen, to be moved where it was not
   * quite meant. The cursor goes on to where it ends, so the next chord tapped
   * follows it, and a progression is written by tapping it through. A key of
   * it already sounding there is left out, as a paste leaves it.
   */
  private writeTheChordAtTheHead(at: number): ChordWritten | null {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const written = this.theChordWrittenAtTheHead(at);
    if (sketch === undefined || stored === null || written === null || !written.changes) {
      return null;
    }
    this.changeTheSketchShowing(written.events, [...sketch.before, asItWas(stored, sketch.chosen)], written.chosen);
    // Moved on, the cursor takes what is shown ahead with it: see `showTheChordsOfTheKey`.
    if (written.headAfterMs !== null) {
      this.putTheHeadAt(written.headAfterMs);
    }
    return written;
  }

  /**
   * Strikes the chord of the drawer a pointer goes down on - the mouse's
   * left button, a finger or a pen - to sound until it is let go of, and
   * holds it there to slide over the others. Deleting, the drawer only
   * deletes: the sound is a hearing of what would be written.
   */
  private holdTheChord(event: PointerEvent): void {
    const chord = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-chord]') : null;
    if (chord === null || this.chordsBeingForgotten || (event.pointerType === 'mouse' && event.button !== 0)) {
      return;
    }
    this.letGoOfTheChord(null);
    this.chordHeld = {
      pointerId: event.pointerId,
      at: null,
      keys: [],
      struckAtMs: 0,
      downAtMs: this.runtime.clock.now(),
      downY: event.clientY,
      scrolledFrom: this.el.rollChords.scrollTop,
      // A mouse scrolls with its wheel, so its moving is always a slide.
      moving: event.pointerType === 'mouse' ? 'slides' : 'not yet',
    };
    this.strikeTheChord(Number(chord.dataset['chord']));
  }

  /**
   * Takes the chord held to the one the pointer has slid onto, letting go of
   * the one before as a hand sliding over keys does - and to none, silent,
   * off the chords - and shows where it would be written.
   */
  private slideOverTheChords(event: PointerEvent): void {
    const held = this.chordHeld;
    if (held === null) {
      return;
    }
    if (held.moving === 'not yet') {
      if (Math.abs(event.clientY - held.downY) < A_FINGER_MOVES_PX) {
        return;
      }
      // A column with nothing to scroll is slid over at once.
      const scrolls =
        this.el.rollChords.scrollHeight > this.el.rollChords.clientHeight &&
        this.runtime.clock.now() - held.downAtMs < A_FINGER_LISTENS_MS;
      if (scrolls) {
        // The chord struck as it came down was not asked for: silenced, and nothing written.
        this.strikeTheChord(null);
        this.pointAtTheChord(null);
      }
      this.chordHeld = { ...(this.chordHeld ?? held), moving: scrolls ? 'scrolls' : 'slides' };
    }
    if (this.chordHeld?.moving === 'scrolls') {
      this.el.rollChords.scrollTop = held.scrolledFrom - (event.clientY - held.downY);
      return;
    }
    const at = this.theChordUnder(event);
    if (at !== this.chordHeld?.at) {
      this.strikeTheChord(at);
      this.pointAtTheChord(at);
    }
  }

  /**
   * Silences the chord held, if one is sounding, and strikes the one at a
   * place of the drawer, as loud as the sketch is on the whole: all its keys,
   * those the sketch already has there too, so the chord is heard whole.
   */
  private strikeTheChord(at: number | null): void {
    const held = this.chordHeld;
    if (held === null) {
      return;
    }
    for (const midi of held.keys) {
      this.runtime.pitchPlayer.stop(midi);
    }
    const written = at === null ? null : this.theChordWrittenAtTheHead(at);
    const keys = written === null ? [] : written.heard;
    const now = this.runtime.clock.now();
    for (const midi of keys) {
      this.runtime.pitchPlayer.play(midi, written?.velocity ?? 0, now);
    }
    this.chordHeld = { ...held, at: written === null ? null : at, keys, struckAtMs: now };
  }

  /**
   * Lets go of the chord held, writing the one the pointer is let go of on,
   * or none. Written, it sounds on for as long as it is written, so a quick
   * tap is heard as a note of it and not cut short; held longer, it ends as
   * it is let go of. Its one strike is the hearing: the writing strikes
   * nothing again.
   */
  private letGoOfTheChord(at: number | null): void {
    const held = this.chordHeld;
    if (held === null) {
      return;
    }
    this.chordHeld = null;
    const written = at === null ? null : this.writeTheChordAtTheHead(at);
    const endsAtMs = Math.max(this.runtime.clock.now(), held.struckAtMs + (written?.lengthMs ?? 0));
    for (const midi of held.keys) {
      this.runtime.pitchPlayer.stop(midi, endsAtMs);
    }
  }

  /** The chord of the drawer under a point, by its place there; `null` off the chords. */
  private theChordUnder(event: PointerEvent): number | null {
    const under = this.doc.elementFromPoint(event.clientX, event.clientY);
    const chord = under?.closest<HTMLElement>('[data-chord]') ?? null;
    return chord === null ? null : Number(chord.dataset['chord']);
  }

  /**
   * What a chord of the drawer would make of the sketch: written over the
   * chord chosen in the lane, where one is (see `theChordWrittenOver`), and
   * where the cursor is otherwise - its notes from the line of the grid the
   * cursor is in, where the marker is put on one, to the next, as loud as
   * the sketch is on the whole, the cursor going on to where they end. One
   * answer, for writing it, hearing it and showing it ahead.
   */
  private theChordWrittenAtTheHead(at: number): ChordWritten | null {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const chord = stored === null ? undefined : this.theChordsInTheDrawer(this.theKeyAtTheHead(stored))[at];
    if (showing === null || sketch === undefined || stored === null || chord === undefined) {
      return null;
    }
    const over = this.theChordChosenInTheLane();
    if (over !== null) {
      return this.theChordWrittenOver(over, chord.midis);
    }
    const roll = showing.roll;
    const origin = rollBeganAtMs(roll);
    const grid = this.theRollsGrid();
    const head = this.headIsAtMs();
    const fromMs = this.el.rollSnap.checked ? theLineOfTheGridUnder(roll, head, grid) : head;
    const untilMs = theNextLineOfTheGrid(roll, fromMs, grid, 1) ?? fromMs + theBeatAt(roll, fromMs + origin);
    // As loud as the flag over them says, and following it.
    const velocity = theVelocityOfTheLevel(theDynamicAt(stored.events, fromMs + origin) ?? LOUDNESS_UNMARKED, 0);
    const { events, pasted } = takeWithTheNotesPasted(
      stored.events,
      chord.midis.map((midi) => ({ afterMs: 0, lengthMs: untilMs - fromMs, midi, velocity, loudness: { level: null, shade: 0 } })),
      fromMs + origin,
    );
    return {
      changes: pasted.length > 0,
      heard: chord.midis,
      struck: pasted.map((key) => key.midi),
      events,
      chosen: pasted,
      shown: pasted.map((key) => ({ midi: key.midi, fromMs, untilMs })),
      velocity,
      lengthMs: untilMs - fromMs,
      headAfterMs: untilMs,
    };
  }

  /**
   * The chord tapped in the lane, while the notes chosen are its notes and
   * nothing else - what a chord of the drawer is written over rather than at
   * the cursor; `null` where the choice is anything else. Read off the
   * choice each time it is asked, so it is never out of step with it.
   */
  private theChordChosenInTheLane(): SceneChord | null {
    const scene = this.drawnScene;
    const roll = this.theRoll();
    const sketch = this.theOtherRollShowing?.sketch;
    const at = this.chordTappedAt;
    const chord = scene === null || at === null ? null : theChordAt(scene, at);
    if (chord === null || !chord.chosen || roll === null || sketch === undefined) {
      return null;
    }
    return theNotesOfTheChord(roll, chord.fromMs, chord.untilMs).length === sketch.chosen.length ? chord : null;
  }

  /**
   * A chord of the drawer written over a chord of the lane: its notes moved
   * to the drawer's, as a hand moves from one chord to the next (see
   * `theChordMovedTo`), in the time and the rhythm they have. Only the
   * notes that make the chord move - those that are its tones - and of
   * those, where both hands play in it, only the left hand's, which carry
   * it: a melody over it is the right hand's, and stays. The whole chord
   * stays chosen and the cursor where it begins, so another can be tried
   * over it at once.
   */
  private theChordWrittenOver(over: SceneChord, drawn: readonly number[]): ChordWritten | null {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const roll = this.theRoll();
    const to = theChordTheNotesMake(drawn.map((midi) => ({ midi, lengthMs: 1 })));
    if (stored === null || roll === null || to === null) {
      return null;
    }
    const origin = rollBeganAtMs(roll);
    const notes = theNotesOfTheChord(roll, over.fromMs, over.untilMs);
    const bothHands = new Set(notes.map((note) => theHandThatPlays(note))).size > 1;
    const tones = new Set(over.kind.intervals.map((step) => (over.root + step) % 12));
    const moving = notes.filter(
      (note) => (!bothHands || theHandThatPlays(note) === 'left') && tones.has(((note.midi % 12) + 12) % 12),
    );
    const moved = theChordMovedTo(
      moving.map((note) => note.midi),
      to,
      notes.filter((note) => !moving.includes(note)).map((note) => note.midi),
    );
    const changing = moving.filter((note) => (moved.get(note.midi) ?? note.midi) !== note.midi);
    const events =
      changing.length === 0
        ? stored.events
        : takeWithTheKeysChanged(
            stored.events,
            changing.map((note) => ({
              key: { midi: note.midi, downAtMs: note.downAtMs },
              midi: moved.get(note.midi) ?? note.midi,
              downAtMs: note.downAtMs,
              upAtMs: note.upAtMs,
            })),
          );
    if (events === null) {
      return null;
    }
    const endMs = rollEndedAtMs(roll);
    const heard = [...new Set(moving.map((note) => moved.get(note.midi) ?? note.midi))].sort((low, high) => low - high);
    return {
      changes: changing.length > 0,
      heard,
      struck: heard,
      events,
      chosen: notes.map((note) => ({ midi: moved.get(note.midi) ?? note.midi, downAtMs: note.downAtMs })),
      shown: changing.map((note) => ({
        midi: moved.get(note.midi) ?? note.midi,
        fromMs: note.downAtMs - origin,
        untilMs: (note.upAtMs ?? endMs) - origin,
      })),
      velocity: theUsualLoudness(stored.events),
      lengthMs: over.untilMs - over.fromMs,
      headAfterMs: null,
    };
  }

  /** Points at a chord of the drawer, or at none, and shows its notes where it would write them. */
  private pointAtTheChord(at: number | null): void {
    this.chordPointedAt = at;
    this.showTheChordAhead();
  }

  /**
   * Shows the notes of the chord pointed at where it would write them - the
   * keys it would put in, and none already sounding there - or none while
   * the drawer is deleting what it keeps. Put away, it points at none.
   */
  private showTheChordAhead(): void {
    const at = this.chordPointedAt;
    const scene = this.drawnScene;
    const written = at === null || scene === null || this.chordsBeingForgotten ? null : this.theChordWrittenAtTheHead(at);
    this.notesShownAhead =
      written === null || scene === null
        ? []
        : written.shown.map((key) => ({ row: scene.highest - key.midi, fromMs: key.fromMs, untilMs: key.untilMs }));
    this.paintTheRoll();
  }

  /**
   * The slider of how hard the chosen notes are struck: shown, in the
   * passage's place, while a sketch is edited; at their average, with a mark
   * for each; and dimmed, with the reason, while none is chosen.
   */
  private sayHowLoudTheChosenAre(): void {
    const sketch = this.theOtherRollShowing?.sketch;
    this.el.rollPassage.hidden = sketch !== undefined;
    this.el.rollVelocity.hidden = sketch?.editing !== true;
    // Where it begins, in the options, while it is edited as well.
    this.el.rollSketchStart.hidden = sketch?.editing !== true;
    const key = sketch === undefined ? null : this.runtime.sketches.find(sketch.id)?.key;
    if (key !== undefined && key !== null) {
      this.sayTheKeyOfTheSketch(key);
    }
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const first = stored === null ? undefined : theClickOfTheTake(stored.events, stored.beats)?.[0];
    const pace = stored === null ? null : thePaceOfTheClick(stored.events, stored.beats);
    this.el.rollTempo.value = pace === null ? '' : String(Math.round(pace));
    if (first !== undefined) {
      // A score may be in a metre the list does not offer, and it is shown as it is.
      const metre = `${String(first.beatsInBar)}/${String(first.beatType ?? 4)}`;
      const metres: readonly string[] = SKETCH_METRES.includes(metre as never) ? SKETCH_METRES : [metre, ...SKETCH_METRES];
      fillSelect(
        this.el.rollMetre,
        metres.map((each) => ({ value: each, label: each })),
        metre,
      );
    }
    const loudness = this.theLoudnessOfTheChosen();
    if (loudness.length === 0) {
      this.el.rollVelocity.dataset['idle'] = 'true';
      this.el.rollVelocityLevel.title = 'How hard the chosen notes are struck. Choose a note first.';
    } else {
      delete this.el.rollVelocity.dataset['idle'];
      this.el.rollVelocityLevel.title = 'How hard the chosen notes are struck';
    }
    this.el.rollVelocityLevel.setAttribute('aria-label', this.el.rollVelocityLevel.title);
    this.el.rollVelocityLevel.value = String(theMiddleOf(loudness));
    this.markTheLoudness(loudness);
    this.sayTheDynamicOfTheChosen(loudness);
    this.sayWhichHand();
    const quantizes = 'Quantize: each chosen note begun on the nearest line of the grid, as long as it was';
    if (loudness.length === 0) {
      this.el.rollQuantize.dataset['idle'] = 'true';
      this.el.rollQuantize.title = `${quantizes}. Choose a note first.`;
    } else {
      delete this.el.rollQuantize.dataset['idle'];
      this.el.rollQuantize.title = quantizes;
    }
    this.el.rollQuantize.setAttribute('aria-label', this.el.rollQuantize.title);
    const humanizes = `Humanize: each chosen note struck up to ${String(HUMANIZED_BY_AT_MOST)} steps harder or softer, as a hand would`;
    sayWhetherIdle(this.el.rollHumanize, loudness.length === 0 ? `${humanizes}. Choose a note first.` : humanizes, loudness.length === 0);
  }

  /** The chosen notes each struck a little harder or softer: one change, put back as one. They stay chosen. */
  private humanizeTheChosen(): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (sketch === undefined || stored === null) {
      return;
    }
    const changes = theKeysHumanized(stored.events, sketch.chosen);
    const events = changes.length === 0 ? null : takeWithTheKeysChanged(stored.events, changes);
    if (events !== null) {
      this.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)], sketch.chosen);
    }
  }

  /**
   * Puts the chosen notes on the grid shown, whether or not the marker is put
   * on it: one change, put back as one, and none where every one already is
   * or none can go. They stay chosen where they went.
   */
  private putTheChosenOnTheGrid(): void {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (showing === null || sketch === undefined || stored === null) {
      return;
    }
    const changes = theKeysOnTheGrid(showing.roll, stored.events, sketch.chosen, this.theRollsGrid());
    const events = changes.length === 0 ? null : takeWithTheKeysChanged(stored.events, changes);
    if (events === null) {
      return;
    }
    const chosen = sketch.chosen.map((each) => {
      const moved = changes.find((change) => sameKey(change.key, each));
      return moved === undefined ? each : { midi: moved.midi, downAtMs: moved.downAtMs };
    });
    this.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)], chosen);
  }

  /**
   * The three hand buttons: the one the chosen notes all are pressed - by
   * their pitch where none is said - and none where they differ; dimmed, with
   * the reason, while none is chosen.
   */
  private sayWhichHand(): void {
    const hands = this.theChosenKeys().map((key) => key.hand ?? null);
    const idle = hands.length === 0;
    const all = (hand: Hand | null): boolean => !idle && hands.every((each) => each === hand);
    if (idle) {
      this.el.rollHands.dataset['idle'] = 'true';
    } else {
      delete this.el.rollHands.dataset['idle'];
    }
    const first = idle ? ' Choose a note first.' : '';
    for (const [button, hand, says] of [
      [this.el.rollHandLeft, 'left', 'Left hand: the chosen notes on the lower staff.'],
      [this.el.rollHandPitch, null, 'By pitch: below middle C the left hand, from it the right.'],
      [this.el.rollHandRight, 'right', 'Right hand: the chosen notes on the upper staff.'],
    ] as const) {
      button.setAttribute('aria-pressed', String(all(hand)));
      button.title = `${says}${first}`;
      button.setAttribute('aria-label', button.title);
    }
  }

  /** The chosen keys of the sketch, as they are in it now. */
  private theChosenKeys(): KeyOfTheTake[] {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (sketch === undefined || stored === null) {
      return [];
    }
    return theKeysOfTheTake(stored.events).filter((key) => sketch.chosen.some((each) => sameKey(each, key)));
  }

  /**
   * Counts the sketch on the drawing in another metre: its bars laid afresh,
   * its notes where they were. Kept with the sketch, as its key is.
   */
  /**
   * Asks what the music is to change to from the beat the cursor is on or
   * after: its key, metre and pace, as they are there now, in a sheet over
   * the drawing; and offers to take a change away where one is on that beat.
   */
  private askForAChangeAtTheHead(): void {
    const roll = this.theRoll();
    if (roll !== null && this.askAboutTheBeatAt(this.headIsAtMs() + rollBeganAtMs(roll))) {
      this.showTheSheet(this.el.sheetRollMark);
    }
  }

  /**
   * Sets the sheet to the beat a moment is on or after, on the run's own
   * clock: its key, metre and pace, and whether a change is on it. Says
   * whether there is such a beat to ask about. A metre begins a bar, so
   * chosen on a later beat it is counted from its bar's first, which the
   * dimmed list says.
   */
  private askAboutTheBeatAt(atMs: number): boolean {
    const showing = this.theOtherRollShowing;
    const stored = showing?.sketch === undefined ? null : this.runtime.sketches.find(showing.sketch.id);
    if (showing === null || stored === null) {
      return false;
    }
    const bar = theBeatOfTheClickAt(stored.events, stored.beats, atMs);
    if (bar === null) {
      return false;
    }
    this.beatAskedAbout = bar;
    const begunIn = this.theKeyTheSketchBeginsIn(stored);
    const keyHere = theKeyOfTheMusicAt(stored.events, begunIn, bar.atMs);
    // Just before the beat: what the beat before it is in.
    const keyBefore = bar.before === null ? null : theKeyOfTheMusicAt(stored.events, begunIn, bar.atMs - 1);
    this.keyAskedAbout = { here: keyHere, before: keyBefore };
    this.sayTheKeyIn(this.el.rollMarkKey, this.el.rollMarkScale, keyHere);
    const dynamicHere = theDynamicAt(stored.events, bar.atMs);
    const dynamicBefore = theDynamicAt(stored.events, bar.atMs - 1);
    const graduallyHere = theDynamicReachedGraduallyAt(stored.events, bar.atMs);
    this.dynamicAskedAbout = { here: dynamicHere, before: dynamicBefore, graduallyHere };
    this.el.rollMarkDynamic.value = dynamicHere ?? '';
    this.el.rollMarkReached.value = graduallyHere ? 'gradually' : '';
    this.sayWhetherTheDynamicIsReachedGradually();
    const metre = `${String(bar.metre.beatsInBar)}/${String(bar.metre.beatType)}`;
    // A metre the list does not offer, as a score may be in, is offered as it is.
    if (![...this.el.rollMarkMetre.options].some((option) => option.value === metre)) {
      this.el.rollMarkMetre.append(new Option(metre, metre));
    }
    this.el.rollMarkMetre.value = metre;
    this.el.rollMarkTempo.value = String(bar.crotchetsPerMinute);
    const changesHere =
      bar.before !== null &&
      keyBefore !== null &&
      (keyBefore.fifths !== keyHere.fifths ||
        keyBefore.scale !== keyHere.scale ||
        bar.before.crotchetsPerMinute !== bar.crotchetsPerMinute ||
        bar.before.metre.beatsInBar !== bar.metre.beatsInBar ||
        bar.before.metre.beatType !== bar.metre.beatType);
    const inside = bar.beat > 0;
    sayWhetherIdle(
      this.el.rollMarkMetre,
      inside ? `A metre begins a bar: chosen here, it changes from the start of bar ${String(bar.bar)}` : 'Time signature',
      inside,
    );
    // A score writes a key's signature at a bar line, so one changed inside a bar is printed from the next.
    this.el.rollMarkTitle.textContent = inside
      ? `From ${thePlaceOfTheBeat(bar)}, until the next change. The score shows a key changed here from the next bar.`
      : `From ${thePlaceOfTheBeat(bar)}, until the next change`;
    // A dynamic is marked on any beat, the first too, which has nothing else to give back.
    this.el.rollMarkRemove.hidden = !changesHere && dynamicHere === dynamicBefore;
    // A sketch begins at the bar its first note is in, so a bar put before that one is not kept.
    sayWhetherIdle(
      this.el.rollMarkInsert,
      bar.bar === 1
        ? 'A sketch begins at the bar its first note is in: there is no bar before it to put an empty one after'
        : `Insert an empty bar before bar ${String(bar.bar)}, moving everything from it on by a bar`,
      bar.bar === 1,
    );
    return true;
  }

  /**
   * Puts an empty bar in before the bar of the beat asked about, in its
   * metre and at its pace, and moves everything from it on by as long:
   * one change, put back as one. None before the first.
   */
  private insertABarBeforeTheBeatAsked(): void {
    const bar = this.beatAskedAbout;
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    this.el.sheetRollMark.hidden = true;
    this.beatAskedAbout = null;
    this.keyAskedAbout = null;
    this.dynamicAskedAbout = null;
    if (bar === null || bar.bar === 1 || sketch === undefined || stored === null) {
      return;
    }
    const inserted = thePlayingWithABarInserted(stored.events, stored.beats, bar.atMs);
    this.changeTheSketchShowing(
      inserted.events,
      [...sketch.before, asItWas(stored, sketch.chosen)],
      this.theChosenMovedWith(stored.events, inserted.events, sketch.chosen),
      inserted.beats,
    );
  }

  /**
   * Dims the sheet's choice of how the dynamic is reached where it has
   * nothing to come from gradually: no dynamic before the beat, or none
   * chosen, or the same one, which is no change.
   */
  private sayWhetherTheDynamicIsReachedGradually(): void {
    const before = this.dynamicAskedAbout?.before ?? null;
    const chosen = this.theDynamicAskedFor();
    const why =
      before === null
        ? 'Nothing is marked before this beat to come from gradually: the dynamic is reached at once'
        : chosen === null || chosen === before
          ? `The music is in ${before} already: there is nothing to reach gradually`
          : `Whether ${chosen} is reached at once here, or gradually from ${before}`;
    sayWhetherIdle(this.el.rollMarkReached, why, before === null || chosen === null || chosen === before);
  }

  /** The dynamic the sheet's list says, or none. */
  private theDynamicAskedFor(): DynamicLevel | null {
    return DYNAMIC_LEVELS.find((level) => level === this.el.rollMarkDynamic.value) ?? null;
  }

  /** The beat asked about given back what the beat before it is in: its changes taken away. */
  private takeTheChangeAway(): void {
    const bar = this.beatAskedAbout;
    const before = bar?.before;
    const keyBefore = this.keyAskedAbout?.before;
    const keyHere = this.keyAskedAbout?.here;
    if (bar === null || keyHere === undefined) {
      return;
    }
    // The dynamic of the beat before, or none - the first beat has nothing
    // else to give back, and keeps its own key, metre and pace.
    const dynamicBefore = this.dynamicAskedAbout?.before ?? null;
    if (before !== null && before !== undefined && keyBefore !== null && keyBefore !== undefined) {
      this.changeFromTheBeatAsked(
        `${String(before.metre.beatsInBar)}/${String(before.metre.beatType)}`,
        before.crotchetsPerMinute,
        keyBefore,
        dynamicBefore,
        false,
      );
    } else {
      this.changeFromTheBeatAsked(
        `${String(bar.metre.beatsInBar)}/${String(bar.metre.beatType)}`,
        bar.crotchetsPerMinute,
        keyHere,
        dynamicBefore,
        false,
      );
    }
  }

  /**
   * Answers a tap on a flag over the ruler, or on a button under the chosen
   * one; says whether the tap was one. A flag tapped puts the cursor on its
   * beat; while the sketch is edited it is chosen, and tapped again once
   * chosen it is asked about in the sheet. Under the chosen flag, the pencil
   * asks about it and the bin takes it away.
   */
  private answerTheFlags(event: Event): boolean {
    const target = event.target instanceof Element ? event.target : null;
    const scene = this.drawnScene;
    const roll = this.theRoll();
    if (target === null || scene === null || roll === null || target.closest('.roll__marks') === null) {
      return false;
    }
    const origin = rollBeganAtMs(roll);
    if (target.closest('.roll__mark-change') !== null && this.markChosenAtMs !== null) {
      if (this.askAboutTheBeatAt(this.markChosenAtMs)) {
        this.showTheSheet(this.el.sheetRollMark);
      }
      return true;
    }
    if (target.closest('.roll__mark-delete') !== null && this.markChosenAtMs !== null) {
      this.takeTheMarkAway(this.markChosenAtMs);
      return true;
    }
    if (target.closest('.roll__mark-copy') !== null || target.closest('.roll__mark-cut') !== null) {
      this.copyTheMarkChosen(target.closest('.roll__mark-cut') !== null);
      return true;
    }
    const flag = target.closest<HTMLElement>('.roll__mark');
    const mark = flag === null ? undefined : scene.marks[Number(flag.dataset['mark'])];
    if (mark === undefined) {
      return true;
    }
    const atMs = mark.atMs + origin;
    this.putTheHeadAt(mark.atMs);
    if (this.theOtherRollShowing?.sketch?.editing !== true) {
      return true;
    }
    if (this.markChosenAtMs !== null && Math.abs(this.markChosenAtMs - atMs) < 1) {
      if (this.askAboutTheBeatAt(atMs)) {
        this.showTheSheet(this.el.sheetRollMark);
      }
    } else {
      this.chooseTheMark(atMs);
    }
    return true;
  }

  /** Chooses the flag at a moment on the run's own clock, or lets go of the one chosen. */
  private chooseTheMark(atMs: number | null): void {
    if (atMs === this.markChosenAtMs) {
      return;
    }
    this.markChosenAtMs = atMs;
    // One thing chosen at a time, so a copy, a cut or Delete is never a guess at which.
    if (atMs !== null && this.theNotesChosen().length > 0) {
      this.choose([]);
    }
    this.showTheMarkChosen();
  }

  /**
   * The chosen flag pressed, and the two buttons under it; the bin dimmed,
   * with the reason, over the first beat, whose key, metre and pace are the
   * sketch's own and only changed.
   */
  private showTheMarkChosen(): void {
    const scene = this.drawnScene;
    const roll = this.theRoll();
    const marks = this.rollHeads?.marks;
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (marks === undefined || scene === null || roll === null) {
      return;
    }
    // Where each flag is, as its title says it: a bar, or a beat inside one.
    const placeOf = (atMs: number): string => {
      const beat = stored === null ? null : theBeatOfTheClickAt(stored.events, stored.beats, atMs);
      return beat === null ? '' : thePlaceOfTheBeat(beat);
    };
    const origin = rollBeganAtMs(roll);
    const chosenAt = this.markChosenAtMs;
    const chosen = chosenAt === null ? -1 : scene.marks.findIndex((mark) => Math.abs(mark.atMs + origin - chosenAt) < 1);
    if (chosen < 0 && chosenAt !== null) {
      // Taken away, or moved off: nothing is chosen any more.
      this.markChosenAtMs = null;
    }
    marks.querySelectorAll<HTMLElement>('.roll__mark').forEach((flag) => {
      flag.setAttribute('aria-pressed', String(Number(flag.dataset['mark']) === chosen));
      const mark = scene.marks[Number(flag.dataset['mark'])];
      const place = placeOf((mark?.atMs ?? 0) + origin);
      flag.title = `${place.charAt(0).toUpperCase()}${place.slice(1)}: ${mark?.says ?? ''}. Tap to choose it, and again to change it.`;
      flag.setAttribute('aria-label', flag.title);
    });
    const tools = marks.querySelector<HTMLElement>('.roll__mark-tools');
    const mark = scene.marks[chosen];
    if (tools === null) {
      return;
    }
    tools.hidden = mark === undefined;
    if (mark === undefined) {
      return;
    }
    tools.style.setProperty('--roll-at', (mark.atMs / 1000).toFixed(3));
    const place = placeOf(mark.atMs + origin);
    const change = tools.querySelector<HTMLButtonElement>('.roll__mark-change');
    const copy = tools.querySelector<HTMLButtonElement>('.roll__mark-copy');
    const cut = tools.querySelector<HTMLButtonElement>('.roll__mark-cut');
    const remove = tools.querySelector<HTMLButtonElement>('.roll__mark-delete');
    if (change !== null) {
      change.title = `Change what ${place} is in`;
      change.setAttribute('aria-label', change.title);
    }
    if (copy !== null) {
      sayWhetherIdle(copy, `Copy the change at ${place}, to paste where the cursor is`, false);
    }
    if (cut !== null) {
      sayWhetherIdle(
        cut,
        chosen === 0
          ? "Cut this change. The first bar's key, metre and pace are the sketch's own: copy them instead."
          : `Cut the change at ${place}, to paste where the cursor is`,
        chosen === 0,
      );
    }
    if (remove !== null) {
      sayWhetherIdle(
        remove,
        chosen === 0
          ? "Take this change away. The first bar's key, metre and pace are the sketch's own: change them instead."
          : `Take the change at ${place} away`,
        chosen === 0,
      );
    }
  }

  /**
   * Copies what the chosen flag changes to the clipboard, as text a paste
   * here can read back - into this sketch or another - and kept in the page
   * for the paste button; cutting, takes it away too. The first beat's are
   * the sketch's own, and are copied but never cut.
   */
  private copyTheMarkChosen(cutting: boolean): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const atMs = this.markChosenAtMs;
    const beat = stored === null || atMs === null ? null : theBeatOfTheClickAt(stored.events, stored.beats, atMs);
    if (stored === null || atMs === null || beat === null) {
      return;
    }
    if (cutting && beat.before === null) {
      return;
    }
    const begunIn = this.theKeyTheSketchBeginsIn(stored);
    const key = theKeyOfTheMusicAt(stored.events, begunIn, beat.atMs);
    const keyBefore = beat.before === null ? null : theKeyOfTheMusicAt(stored.events, begunIn, beat.atMs - 1);
    const before = beat.before;
    const change: ChangeCopied = {
      ...(keyBefore === null || keyBefore.fifths !== key.fifths || keyBefore.scale !== key.scale ? { key } : {}),
      ...(before === null || before.metre.beatsInBar !== beat.metre.beatsInBar || before.metre.beatType !== beat.metre.beatType
        ? { metre: beat.metre }
        : {}),
      ...(before === null || before.crotchetsPerMinute !== beat.crotchetsPerMinute ? { crotchetsPerMinute: beat.crotchetsPerMinute } : {}),
      ...theDynamicMarkedAt(stored.events, beat.atMs),
    };
    this.changeCopiedHere = change;
    this.notesCopiedHere = null;
    // The paste button, which says whether there is anything to paste.
    this.showTheChordsOfTheKey();
    // A page not served securely has no clipboard, and a cut there would only take away, as a cut of notes would.
    const clipboard = this.doc.defaultView?.navigator?.clipboard;
    if (clipboard === undefined) {
      return;
    }
    void clipboard.writeText(theClipboardTextOfTheChange(change)).catch(() => undefined);
    if (cutting) {
      this.takeTheMarkAway(atMs);
    }
  }

  /**
   * Changes the music from the beat the cursor is on or after to what a
   * change copied says, as the sheet would: what it does not say stays as it
   * is there. One change, put back as one; its flag chosen.
   */
  private pasteTheChange(change: ChangeCopied): void {
    const roll = this.theRoll();
    if (roll === null || !this.askAboutTheBeatAt(this.headIsAtMs() + rollBeganAtMs(roll))) {
      return;
    }
    const beat = this.beatAskedAbout;
    const keyHere = this.keyAskedAbout?.here;
    if (beat === null || keyHere === undefined) {
      return;
    }
    const metre = change.metre ?? beat.metre;
    this.changeFromTheBeatAsked(
      `${String(metre.beatsInBar)}/${String(metre.beatType)}`,
      change.crotchetsPerMinute ?? beat.crotchetsPerMinute,
      change.key ?? keyHere,
      change.dynamic ?? this.dynamicAskedAbout?.here ?? null,
      change.dynamic === undefined ? this.dynamicAskedAbout?.graduallyHere === true : change.gradually === true,
    );
    this.chooseTheMark(beat.atMs);
  }

  /** Takes the changes at a flag away, its beat given back what the beat before it is in. The first has none before it, and keeps its own. */
  private takeTheMarkAway(atMs: number): void {
    if (this.askAboutTheBeatAt(atMs)) {
      this.takeTheChangeAway();
    }
  }

  /**
   * Changes the key, the metre, the pace and the dynamic from the beat asked
   * about, as far as the next change of each: one change, put back as one. A
   * metre is counted from the first beat of the beat's bar. A pace past what
   * a metronome offers is held to it. No dynamic takes away the one marked
   * on the beat; one is reached gradually from the dynamic before it only
   * where there is one, and another.
   */
  private changeFromTheBeatAsked(
    metre: string,
    crotchetsPerMinute: number,
    key: KeyOfTheMusic,
    dynamic: DynamicLevel | null,
    gradually: boolean,
  ): void {
    const bar = this.beatAskedAbout;
    const keyHere = this.keyAskedAbout?.here ?? null;
    const dynamicHere = this.dynamicAskedAbout?.here ?? null;
    const dynamicBefore = this.dynamicAskedAbout?.before ?? null;
    const graduallyHere = this.dynamicAskedAbout?.graduallyHere === true;
    this.dynamicAskedAbout = null;
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const [beatsInBar, beatType] = metre.split('/').map(Number);
    this.el.sheetRollMark.hidden = true;
    this.beatAskedAbout = null;
    this.keyAskedAbout = null;
    if (bar === null || keyHere === null || sketch === undefined || stored === null || beatsInBar === undefined || beatType === undefined) {
      return;
    }
    const pace = Number.isFinite(crotchetsPerMinute) && crotchetsPerMinute > 0
      ? Math.min(FASTEST_SKETCH_BPM, Math.max(SLOWEST_SKETCH_BPM, Math.round(crotchetsPerMinute)))
      : bar.crotchetsPerMinute;
    const metreChanges = beatsInBar !== bar.metre.beatsInBar || beatType !== bar.metre.beatType;
    const paceChanges = pace !== bar.crotchetsPerMinute;
    const keyChanges = key.fifths !== keyHere.fifths || key.scale !== keyHere.scale;
    const reachedGradually = gradually && dynamic !== null && dynamicBefore !== null && dynamic !== dynamicBefore;
    const dynamicChanges = dynamic !== dynamicHere || reachedGradually !== graduallyHere;
    if (!metreChanges && !paceChanges && !keyChanges && !dynamicChanges) {
      return;
    }
    // The first beat's key is the sketch's own, which the drawer's lists say;
    // any other beat's is a change among the notes, which moves with them.
    let events = stored.events;
    if (keyChanges && bar.before === null) {
      this.runtime.sketches.changeTheKey(sketch.id, aKeyInTheScale(key.fifths, key.scale));
      events = takeWithTheKeyFrom(events, key, bar.atMs, key);
    } else if (keyChanges) {
      events = takeWithTheKeyFrom(events, this.theKeyTheSketchBeginsIn(stored), bar.atMs, key);
    }
    if (dynamicChanges) {
      events = takeWithTheDynamicFrom(events, bar.atMs, dynamic, reachedGradually);
    }
    // The bar keeps its first beat whatever its metre, and its later beats where they fall, so the pace changes from the same place.
    const counted = metreChanges
      ? theClickInAnotherMetre(events, stored.beats, beatsInBar, beatType, bar.atMs)
      : stored.beats;
    const paced = paceChanges
      ? thePlayingAtAnotherPace(events, counted, pace, bar.atMs)
      : { events, beats: counted };
    if (paced.events === stored.events && paced.beats === stored.beats) {
      // Only the sketch's own key changed, which the lists say and the drawing lights.
      this.sayHowLoudTheChosenAre();
      this.nameTheChosenChord();
      this.showTheChordsOfTheKey();
      this.drawTheRollInto();
      return;
    }
    this.changeTheSketchShowing(
      paced.events,
      [...sketch.before, asItWas(stored, sketch.chosen)],
      this.theChosenMovedWith(stored.events, paced.events, sketch.chosen),
      paced.beats,
    );
  }

  /** The chosen notes, named by when they begin, as far as the notes have moved. */
  private theChosenMovedWith(
    was: readonly MidiFileEvent[],
    now: readonly MidiFileEvent[],
    chosen: readonly KeyNamed[],
  ): readonly KeyNamed[] {
    return chosen.flatMap((key) => {
      const at = was.findIndex((event) => event.kind === 'noteOn' && event.midi === key.midi && event.atMs === key.downAtMs);
      const moved = now[at];
      return moved === undefined ? [] : [{ midi: key.midi, downAtMs: moved.atMs }];
    });
  }

  private countTheSketchIn(metre: string): void {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const [beatsInBar, beatType] = metre.split('/').map(Number);
    if (showing === null || stored === null || beatsInBar === undefined || beatType === undefined) {
      return;
    }
    this.changeTheSketchShowing(
      stored.events,
      [...(sketch?.before ?? []), asItWas(stored, sketch?.chosen ?? [])],
      sketch?.chosen,
      theClickInAnotherMetre(stored.events, stored.beats, beatsInBar, beatType),
    );
  }

  /**
   * Plays the sketch on the drawing at another pace: its notes keep their
   * places in the bars and go faster or slower. One change, put back as one.
   */
  private paceTheSketchAt(crotchetsPerMinute: number): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (sketch === undefined || stored === null) {
      return;
    }
    const paced = thePlayingAtAnotherPace(stored.events, stored.beats, crotchetsPerMinute);
    // The chosen notes are named by when they begin, which has moved with them.
    const chosen = this.theChosenMovedWith(stored.events, paced.events, sketch.chosen);
    this.changeTheSketchShowing(paced.events, [...sketch.before, asItWas(stored, sketch.chosen)], chosen, paced.beats);
  }

  /**
   * How the command key is written where a title names a shortcut: the Mac's
   * and an iPad's sign, or Ctrl and a plus elsewhere. Asked of the browser,
   * which knows the machine.
   */
  private theCommandKey(): string {
    const platform = this.doc.defaultView?.navigator.platform ?? '';
    return /Mac|iPhone|iPad/.test(platform) ? '\u2318' : 'Ctrl+';
  }

  /** Puts a field in place of the name of the sketch on the drawing, its name in it to write over. */
  private beginRenamingTheSketch(): void {
    const sketch = this.theOtherRollShowing?.sketch;
    if (sketch === undefined || this.sketchBeingRenamed !== null) {
      return;
    }
    this.sketchBeingRenamed = sketch.id;
    this.el.rollRename.value = this.theOtherRollShowing?.what ?? '';
    this.el.rollTitle.hidden = true;
    this.el.rollRename.hidden = false;
    this.el.rollRename.focus();
    this.el.rollRename.select();
  }

  /**
   * Puts the name back in place of the field, kept where it was asked to be
   * and says something; a name of nothing is no name, and the old one stays.
   * The sketch is the one the field was opened for, though the viewer has
   * been shut since.
   */
  private endRenamingTheSketch(keep: boolean): void {
    const id = this.sketchBeingRenamed;
    if (id === null) {
      return;
    }
    // Said first: hiding the field takes the focus from it, which ends it again.
    this.sketchBeingRenamed = null;
    this.el.rollRename.hidden = true;
    this.el.rollTitle.hidden = false;
    const title = this.el.rollRename.value.trim();
    if (!keep || title === '') {
      return;
    }
    const renamed = this.runtime.sketches.rename(id, title);
    const showing = this.theOtherRollShowing;
    if (renamed === null) {
      return;
    }
    if (showing?.sketch?.id === id) {
      this.theOtherRollShowing = { ...showing, what: renamed.title };
      this.el.rollTitle.textContent = renamed.title;
    }
  }

  /** Gives the chosen notes to a hand, or back to their pitch: one change. */
  private giveTheChosenToAHand(hand: Hand | null): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const keys = this.theChosenKeys();
    if (sketch === undefined || stored === null || keys.length === 0 || keys.every((key) => (key.hand ?? null) === hand)) {
      return;
    }
    const events = takeWithTheKeysChanged(
      stored.events,
      keys.map((key) => ({ key, midi: key.midi, downAtMs: key.downAtMs, upAtMs: key.upAtMs, hand })),
    );
    if (events !== null) {
      this.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)], sketch.chosen);
    }
  }

  /** How hard each chosen note of the sketch is struck, from 1 to 127. */
  private theLoudnessOfTheChosen(): number[] {
    return this.theChosenKeys().map((key) => Math.round(key.velocity * 127));
  }

  /** The marks over the slider, and the number beside it: one, or the softest to the loudest. */
  private markTheLoudness(loudness: readonly number[]): void {
    this.el.rollVelocityTicks.replaceChildren(
      ...loudness.map((level) => {
        const tick = this.doc.createElement('span');
        tick.className = 'roll-velocity__tick';
        tick.style.left = `${(((level - 1) / 126) * 100).toFixed(2)}%`;
        return tick;
      }),
    );
    const soft = Math.min(...loudness);
    const loud = Math.max(...loudness);
    this.el.rollVelocitySaid.value =
      loudness.length === 0 ? '' : soft === loud ? String(soft) : `${String(soft)}\u2013${String(loud)}`;
  }

  /**
   * The marks in the slider's place, where they are asked for: the one every
   * chosen note is struck at pressed, and none where they differ or are at
   * none of them; each saying what it would do. The switch says which is
   * shown, and what pressing it would show instead.
   */
  private sayTheDynamicOfTheChosen(loudness: readonly number[]): void {
    const asMarks = this.runtime.controller.settings.velocityAsDynamics;
    this.el.rollVelocityAs.setAttribute('aria-checked', String(asMarks));
    this.el.rollVelocityAs.title = asMarks
      ? 'Set how hard by a slider, from 1 to 127'
      : 'Set how hard by the marks a score writes, pp to ff';
    this.el.rollVelocityAs.setAttribute('aria-label', this.el.rollVelocityAs.title);
    this.el.rollDynamics.hidden = !asMarks;
    for (const hidden of [this.el.rollVelocityLevel.closest<HTMLElement>('.roll-velocity__track'), this.el.rollVelocitySaid]) {
      if (hidden !== null) {
        hidden.hidden = asMarks;
      }
    }
    // Pressed where every chosen note is at that level of its own, or follows
    // the flags; a level's edge dashed where every one follows the flags and
    // a flag over each says that level.
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const chosen = this.theChosenKeys();
    const following = chosen.length > 0 && chosen.every((key) => key.loudness?.level === null);
    const flagsSay = (key: KeyOfTheTake): DynamicLevel => (stored === null ? LOUDNESS_UNMARKED : theDynamicAt(stored.events, key.downAtMs) ?? LOUDNESS_UNMARKED);
    for (const button of this.el.rollDynamics.querySelectorAll<HTMLButtonElement>('[data-dynamic]')) {
      const said = button.dataset['dynamic'];
      const level = DYNAMIC_LEVELS.find((each) => each === said) ?? null;
      const pressed = level === null ? following : chosen.length > 0 && chosen.every((key) => key.loudness?.level === level);
      button.setAttribute('aria-pressed', String(pressed));
      if (level !== null && following && chosen.every((key) => flagsSay(key) === level)) {
        button.dataset['fromTheFlags'] = 'true';
      } else {
        delete button.dataset['fromTheFlags'];
      }
      const does =
        level === null
          ? 'Make the chosen notes as loud as the flag over each says'
          : `Write the chosen notes ${level}, a level of their own, at ${String(theLoudnessOfTheDynamic(level))}`;
      button.title = loudness.length === 0 ? `${does}. Choose a note first.` : does;
      button.setAttribute('aria-label', button.title);
    }
  }

  /**
   * Every chosen note written at a level - one of its own, or none, as loud as
   * the flag over it says - and no further from it: one change, and none where
   * all are already. How hard each is then struck follows from it.
   */
  private writeTheChosenAt(loudness: NoteLoudness): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const keys = this.theChosenKeys();
    if (
      sketch === undefined ||
      stored === null ||
      keys.every((key) => key.loudness?.level === loudness.level && key.loudness.shade === loudness.shade)
    ) {
      return;
    }
    const changes: KeyChange[] = keys.map((key) => ({
      key,
      midi: key.midi,
      downAtMs: key.downAtMs,
      upAtMs: key.upAtMs,
      loudness,
    }));
    const events = takeWithTheKeysChanged(stored.events, changes);
    if (events !== null) {
      this.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)], sketch.chosen);
    }
  }

  /** The chosen notes as loud as the slider is being moved to: shown, not kept. */
  private showTheLoudnessAsked(): void {
    const loudness = this.theLoudnessOfTheChosen();
    if (loudness.length === 0) {
      this.el.rollVelocityLevel.value = String(theMiddleOf(loudness));
      return;
    }
    const by = Number(this.el.rollVelocityLevel.value) - theMiddleOf(loudness);
    this.markTheLoudness(loudness.map((level) => clampTheLoudness(level + by)));
  }

  /** The chosen notes made as loud as the slider was let go at, by as much each: one change. */
  private setTheLoudnessAsked(): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const loudness = this.theLoudnessOfTheChosen();
    if (sketch === undefined || stored === null || loudness.length === 0) {
      return;
    }
    const by = Number(this.el.rollVelocityLevel.value) - theMiddleOf(loudness);
    if (by === 0) {
      return;
    }
    const changes: KeyChange[] = this.theChosenKeys().map((key) => ({
      key,
      midi: key.midi,
      downAtMs: key.downAtMs,
      upAtMs: key.upAtMs,
      velocity: clampTheLoudness(Math.round(key.velocity * 127) + by) / 127,
      // Set by a number, a note is as loud as it is, and no longer at a level.
      loudness: null,
    }));
    const events = takeWithTheKeysChanged(stored.events, changes);
    if (events !== null) {
      this.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)], sketch.chosen);
    }
  }

  /**
   * Begins a sketch of a recording, a copy of it in its bars or the assumed
   * ones, and opens it to be edited. The recording is left as it was played.
   */
  private beginASketchOf(id: string): StoredSketch | null {
    const take = this.runtime.takes.find(id);
    if (take === null) {
      return null;
    }
    const sketch = this.runtime.sketches.begin(take, `Sketch of a take, ${theDayItWas(take.savedAtMs)}`, Date.now());
    this.renderSketches();
    this.showTheSketch(sketch.id);
    return sketch;
  }

  /** Begins a sketch of the score open now, and opens it to be edited. */
  private beginASketchOfTheScore(): void {
    const timeline = this.runtime.controller.currentTimeline;
    const exercise = timeline?.exercise ?? null;
    if (timeline === null || exercise === null) {
      return;
    }
    const sketch = this.runtime.sketches.begin(
      theSketchOfTheScore(exercise, timeline),
      `Sketch of ${exercise.title || 'the score'}`,
      Date.now(),
      { fifths: exercise.key.fifths, mode: exercise.key.mode },
    );
    this.renderSketches();
    this.showTheSketch(sketch.id);
  }

  /**
   * Opens a sketch in the viewer, being edited: that is what a sketch is for,
   * and the pencil turns it to listening. Drawn first as it is listened to and
   * then turned to editing, as the pencil turns it, so it opens on its notes
   * rather than at the top of the keyboard.
   */
  private showTheSketch(id: string): void {
    const sketch = this.runtime.sketches.find(id);
    if (sketch === null) {
      return;
    }
    this.runtime.sketches.opened(id);
    this.stopTheRoll();
    this.el.sheetTakes.hidden = true;
    this.el.sheetScores.hidden = true;
    const roll = rollOfTheTake(sketch, ROOM_IN_A_SKETCH);
    this.theOtherRollShowing = {
      roll,
      what: sketch.title,
      why: 'A sketch: no bars to practise until it is written down.',
      ofTheOpenScore: false,
      barLabel: barsCountedOnItsBeats(roll),
      sketch: { id, editing: false, chosen: [], before: [], after: [], tool: 'pencil' },
    };
    this.rollAtMs = 0;
    this.rollScroller.to(0, 0);
    this.drawTheRollInto();
    this.showTheSheet(this.el.sheetRoll);
    this.putTheHeadWhereThePageBegins();
    this.showTheView();
    this.sayWhatWouldBePractised();
    this.sayWhatThePictureIsOf();
    this.editTheSketch(true);
  }

  /**
   * Turns editing a sketch on or off. What was chosen is let go of either
   * way: a choice belongs to the editing it was made in.
   */
  private editTheSketch(editing: boolean): void {
    // Listened to from here, what was being recorded is written in first.
    this.writeInWhatWasRecorded();
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    if (showing === null || sketch === undefined) {
      return;
    }
    const highest = this.drawnScene?.highest ?? null;
    // The rows asked for are the rows as drawn, as a pinch starts from them:
    // the stylesheet stretches a few rows to fill the room, and eighty-eight
    // would otherwise come back thinner than the notes the finger was on.
    this.rollRowPx = this.theRowAsDrawn();
    this.theOtherRollShowing = { ...showing, sketch: { ...sketch, editing, chosen: [] } };
    this.drawTheRollInto();
    // The rows above grow or go, and the notes on the screen stay where they
    // were on it.
    const now = this.drawnScene?.highest ?? null;
    if (highest !== null && now !== null) {
      this.rollScroller.to(this.rollScroller.x, this.rollScroller.y + (now - highest) * this.rollLook.rowPx);
      this.paintTheRoll();
    }
    this.sayWhatCanBeChanged();
  }

  /**
   * A click on a sketch being edited where the press found no note: a note
   * is written there, unless a key held said the click was to choose - a
   * choice adds nothing to the music. A note itself is answered when it is
   * let go of: see `letGoOfTheHeldKey`. A click alone puts the marker
   * there; two, writing a note, leave it where it was before the first.
   */
  private chooseTheKeyTapped(event: MouseEvent): void {
    if (this.theKeyUnder(event) !== null) {
      return;
    }
    const keyHeld = event.ctrlKey || event.metaKey || event.shiftKey;
    // The second of two taps where there is nothing writes a note there, and
    // takes the marker back to where the first found it.
    if (this.isASecondTap(event, null) && !keyHeld) {
      this.addAKeyWhereTapped(event);
      if (this.placedBeforeTheTap !== null) {
        this.putTheHeadAt(this.placedBeforeTheTap);
      }
      return;
    }
    // One puts the marker there, to listen from, and lets go of the notes
    // chosen - unless a key held says the click was to choose.
    if (!keyHeld && (this.theOtherRollShowing?.sketch?.chosen.length ?? 0) > 0) {
      this.choose([]);
    }
    this.placedBeforeTheTap = this.rollPlacedAtMs;
    this.putTheHeadWhereItWasTapped(event);
  }

  /**
   * Whether a tap is the second of two on one place - the same note, or the
   * same empty space - close enough together in time and on the screen, and
   * neither with a key held. Worked out here rather than taken from the
   * browser, which sends a double click for a mouse but not reliably for a
   * finger on a tablet. A second tap is the end of a pair: the next starts
   * another.
   */
  private isASecondTap(
    event: { readonly clientX: number; readonly clientY: number; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly shiftKey: boolean },
    key: KeyNamed | null,
  ): boolean {
    const now = this.runtime.clock.now();
    const last = this.theLastTap;
    const plain = !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const second =
      plain &&
      last !== null &&
      now - last.atMs <= DOUBLE_TAP_MS &&
      Math.hypot(event.clientX - last.clientX, event.clientY - last.clientY) <= DOUBLE_TAP_PX &&
      (key === null ? last.key === null : last.key !== null && sameKey(last.key, key));
    this.theLastTap = second || !plain ? null : { atMs: now, clientX: event.clientX, clientY: event.clientY, key };
    return second;
  }

  /**
   * Whether the drawing is of playing nobody judged - a recording or a
   * sketch - whose notes are coloured by the hand that plays them, on the
   * drawing and on the strip beside it alike.
   */
  private nothingOnTheDrawingIsJudged(): boolean {
    return this.theOtherRollShowing?.recording !== undefined || this.theOtherRollShowing?.sketch !== undefined;
  }

  /** Makes these the notes chosen, and only these. */
  private choose(keys: readonly KeyNamed[]): void {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const roll = this.theRoll();
    const chosen = keys.map((key) => ({ midi: key.midi, downAtMs: key.downAtMs }));
    if (chosen.length > 0) {
      // One thing chosen at a time: see `chooseTheMark`.
      this.markChosenAtMs = null;
    }
    if (showing !== null && sketch !== undefined) {
      this.theOtherRollShowing = { ...showing, sketch: { ...sketch, chosen } };
    } else if (sketch === undefined && roll !== null) {
      this.chosenToCopy = { roll, chosen };
    } else {
      return;
    }
    this.drawTheRollInto();
    this.sayWhatCanBeChanged();
  }

  /**
   * The notes chosen on the drawing shown: a sketch's, to change, or those
   * chosen on anything else to copy - while it is the drawing shown.
   */
  private theNotesChosen(): readonly KeyNamed[] {
    const sketch = this.theOtherRollShowing?.sketch;
    if (sketch !== undefined) {
      return sketch.chosen;
    }
    const roll = this.theRoll();
    return roll !== null && this.chosenToCopy?.roll === roll ? this.chosenToCopy.chosen : [];
  }

  /**
   * Begins a box to choose notes by, where a mouse goes down on a sketch being
   * edited and no note is under it. Says whether it did. A finger moves the
   * drawing there instead, as it always has: a tablet has no other way to.
   */
  private beginABox(event: PointerEvent): boolean {
    const sketch = this.theOtherRollShowing?.sketch;
    if (event.button !== 0 || this.rollBoxDrawn !== null) {
      return false;
    }
    // With the selection tool, for a mouse as for a finger - on a sketch
    // only while it is edited. Without it, a finger's drag from empty space
    // moves the drawing, and a mouse's, where nothing else answers it,
    // points.
    const boxes = sketch === undefined ? this.boxOnTheViewer : sketch.editing && sketch.tool === 'selection';
    if (!boxes) {
      return false;
    }
    if (this.isOnTheRuler(event)) {
      return false;
    }
    // Where the stage and the notes are, read once: the box is placed in the
    // one by the pointer, and kept to the other, past whose edge there is no
    // note to choose.
    const stage = this.el.rollBox.parentElement?.getBoundingClientRect();
    const grid = this.el.rollBody.firstElementChild?.querySelector<HTMLElement>('.roll__grid')?.getBoundingClientRect() ?? null;
    // Begun on the pedal under the notes, it begins at their edge.
    const from = theBoxCornerAt({ grid }, event);
    this.rollBoxDrawn = {
      pointerId: event.pointerId,
      clientX: from.clientX,
      clientY: from.clientY,
      stageLeft: stage?.left ?? 0,
      stageTop: stage?.top ?? 0,
      grid,
      adds: addsToTheChoice(event),
      drawn: false,
    };
    return true;
  }

  /** Draws the box from where the mouse went down to where it is: a box once it has gone somewhere. */
  private drawTheBox(event: PointerEvent): void {
    const box = this.rollBoxDrawn;
    if (box === null) {
      return;
    }
    if (!box.drawn && Math.hypot(event.clientX - box.clientX, event.clientY - box.clientY) < TAP_SLOP_PX) {
      return;
    }
    this.rollBoxDrawn = { ...box, drawn: true };
    // A drag, so the click on letting go writes no note.
    this.panned = true;
    const to = theBoxCornerAt(box, event);
    const style = this.el.rollBox.style;
    style.left = `${String(Math.min(box.clientX, to.clientX) - box.stageLeft)}px`;
    style.top = `${String(Math.min(box.clientY, to.clientY) - box.stageTop)}px`;
    style.width = `${String(Math.abs(to.clientX - box.clientX))}px`;
    style.height = `${String(Math.abs(to.clientY - box.clientY))}px`;
    this.el.rollBox.hidden = false;
  }

  /**
   * Chooses the notes the box holds as it is let go of: those alone, or added
   * to those chosen where a key held said so. Let go of off the page, it
   * chooses nothing. A box never drawn was a click, which writes a note.
   */
  private chooseWhatTheBoxHolds(event: PointerEvent, lifted: boolean): void {
    const box = this.rollBoxDrawn;
    this.rollBoxDrawn = null;
    this.el.rollBox.hidden = true;
    const roll = this.theRoll();
    const scene = this.drawnScene;
    const from = box === null ? null : this.thePointOnTheDrawing(box);
    const to = box === null ? null : this.thePointOnTheDrawing(theBoxCornerAt(box, event));
    if (box === null || !box.drawn || !lifted || roll === null || scene === null) {
      return;
    }
    if (from === null || to === null) {
      return;
    }
    const held = theKeysInABox(
      roll,
      scene,
      { fromMs: from.atMs, toMs: to.atMs, fromRow: from.row, toRow: to.row },
      Number(this.el.rollZoom.value),
    );
    const chosen = this.theNotesChosen();
    this.choose(box.adds ? [...chosen, ...held.filter((key) => !chosen.some((each) => sameKey(each, key)))] : held);
  }

  /** Adds a key to the notes chosen, or lets go of it where it was one of them. */
  private chooseOrLetGo(key: KeyNamed): void {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    if (showing === null || sketch === undefined) {
      return;
    }
    const chosen = sketch.chosen.some((each) => sameKey(each, key))
      ? sketch.chosen.filter((each) => !sameKey(each, key))
      : [...sketch.chosen, { midi: key.midi, downAtMs: key.downAtMs }];
    this.theOtherRollShowing = { ...showing, sketch: { ...sketch, chosen } };
    this.drawTheRollInto();
    this.sayWhatCanBeChanged();
  }

  /**
   * Writes a note into the sketch where a tap found none: on the key of the
   * row, on the nearest line of the grid where the marker is put on one,
   * a beat long, as loud as the notes around it are on the whole. It is the
   * one chosen, to be moved where it was not quite meant.
   */
  private addAKeyWhereTapped(event: MouseEvent): void {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const at = this.thePointOnTheDrawing(event);
    const scene = this.drawnScene;
    if (showing === null || sketch === undefined || stored === null || at === null || scene === null) {
      return;
    }
    const midi = scene.highest - at.row;
    if (midi < LOWEST_KEY || midi > HIGHEST_KEY) {
      return;
    }
    const roll = showing.roll;
    const origin = rollBeganAtMs(roll);
    // In the cell of the grid tapped in, from the line it begins on.
    const snapped = this.el.rollSnap.checked ? theLineOfTheGridUnder(roll, at.atMs, this.theRollsGrid()) : at.atMs;
    const downAtMs = Math.round(snapped + origin);
    // Never on or over another of its pitch: cut short where the next begins,
    // and not written where it would begin on or inside one.
    const upAtMs = theEndAKeyFitsTo(stored.events, { midi, downAtMs, upAtMs: downAtMs + theBeatAt(roll, downAtMs) });
    if (upAtMs === null) {
      return;
    }
    // As loud as the flag over it says, and following it.
    const key = {
      midi,
      downAtMs,
      upAtMs,
      velocity: theVelocityOfTheLevel(theDynamicAt(stored.events, downAtMs) ?? LOUDNESS_UNMARKED, 0),
      loudness: { level: null, shade: 0 },
    };
    // Heard as it is written, for as long as it is: both ends handed to the
    // instrument at once, so no timer outlives the drawing.
    const now = this.runtime.clock.now();
    this.runtime.pitchPlayer.play(midi, key.velocity, now);
    this.runtime.pitchPlayer.stop(midi, now + (key.upAtMs - key.downAtMs));
    this.changeTheSketchShowing(takeWithAKeyAdded(stored.events, key), [...sketch.before, asItWas(stored, sketch.chosen)], [
      { midi, downAtMs },
    ]);
  }

  /** The key of the drawing under a point on the screen, as the pointer's hover finds it. */
  private theKeyUnder(point: { readonly clientX: number; readonly clientY: number }): RolledPress | null {
    const roll = this.theRoll();
    const scene = this.drawnScene;
    const at = this.thePointOnTheDrawing(point);
    return roll === null || scene === null || at === null
      ? null
      : theKeyAt(roll, scene, at.atMs, at.row, Number(this.el.rollZoom.value));
  }

  /** Where a point on the screen is on the drawing: a moment of the run, and a row. */
  private thePointOnTheDrawing(point: {
    readonly clientX: number;
    readonly clientY: number;
  }): { readonly atMs: number; readonly row: number } | null {
    const grid = this.el.rollBody.firstElementChild?.querySelector<HTMLElement>('.roll__grid') ?? null;
    if (grid === null) {
      return null;
    }
    // The grid stands still over the run, which is where the view says.
    const box = grid.getBoundingClientRect();
    const atMs = timeFromTap(point.clientX - box.left + this.rollScroller.x, Number(this.el.rollZoom.value));
    const row = rowFromTap(point.clientY - box.top + this.rollScroller.y, this.rollLook.rowPx);
    return atMs === null || row === null ? null : { atMs, row };
  }

  /** The key of the strip beside the drawing an event is on, or `null` off it. */
  private theKeyOfTheStripUnder(event: Event): number | null {
    const key = event.target instanceof Element ? event.target.closest<HTMLElement>('.roll__key') : null;
    const midi = Number(key?.dataset['midi']);
    return key !== null && Number.isInteger(midi) ? midi : null;
  }

  /**
   * Sounds the key of the strip beside the drawing a finger, a pen or the
   * mouse goes down on, as loud as the notes drawn are on the whole, until it
   * is let go of - and lights its row while it sounds; slid up or down, the
   * keys it comes to in turn (see `slideAlongTheStrip`). Says whether it
   * did. The click that follows is taken as answered: a key is no place to
   * put the marker. The drawing is moved up and down on the drawing itself.
   */
  private holdTheKeyOnTheStrip(event: PointerEvent): boolean {
    const midi = this.theKeyOfTheStripUnder(event);
    const roll = this.theRoll();
    if (midi === null || roll === null || (event.pointerType === 'mouse' && event.button !== 0)) {
      return false;
    }
    this.letGoOfTheKeyOnTheStrip();
    const velocity = theUsualLoudness(rollAsEvents(roll));
    this.runtime.pitchPlayer.play(midi, velocity);
    this.keyHeldOnTheStrip = { pointerId: event.pointerId, midi, velocity };
    this.panned = true;
    this.lightTheSoundingRows();
    return true;
  }

  /**
   * Takes the key held on the strip to the one at the height the pointer
   * has slid to, letting go of the one before as a hand sliding over keys
   * does. Read by height alone, so a slide that strays onto the drawing
   * goes on over the keys of its rows, and one past the top or the bottom
   * stays on the last key there is.
   */
  private slideAlongTheStrip(event: PointerEvent): void {
    const held = this.keyHeldOnTheStrip;
    const scene = this.drawnScene;
    const grid = this.el.rollBody.firstElementChild?.querySelector<HTMLElement>('.roll__grid') ?? null;
    const row = grid === null ? null : rowFromTap(event.clientY - grid.getBoundingClientRect().top + this.rollScroller.y, this.rollLook.rowPx);
    if (held === null || scene === null || row === null) {
      return;
    }
    const midi = scene.highest - Math.min(scene.rows - 1, Math.max(0, row));
    if (midi === held.midi) {
      return;
    }
    this.runtime.pitchPlayer.stop(held.midi);
    this.runtime.pitchPlayer.play(midi, held.velocity);
    this.keyHeldOnTheStrip = { ...held, midi };
    this.lightTheSoundingRows();
  }

  /** Lets go of the key held on the strip, if one is. */
  private letGoOfTheKeyOnTheStrip(): void {
    const held = this.keyHeldOnTheStrip;
    if (held === null) {
      return;
    }
    this.keyHeldOnTheStrip = null;
    this.runtime.pitchPlayer.stop(held.midi);
    this.lightTheSoundingRows();
  }

  /**
   * Whether an event is on the ruler over the notes. The ruler stands over
   * the top of them, so a note scrolled under it is not to be taken hold of
   * through it: pressed there, it was chosen and the drawing drawn again
   * under the pointer, and the click on the ruler never came.
   */
  private isOnTheRuler(event: Event): boolean {
    return event.target instanceof Element && event.target.closest('.roll__ruler') !== null;
  }

  /**
   * Chooses the notes of the chord tapped in the lane - added to those
   * chosen, with a key held, as a note tapped is - and puts the marker where
   * the chord begins, to be heard from there. Says whether there was one.
   */
  private chooseTheChordTapped(event: MouseEvent): boolean {
    const scene = this.drawnScene;
    const roll = this.theRoll();
    const at = this.thePointOnTheDrawing(event);
    const chord = scene === null || at === null ? null : theChordAt(scene, at.atMs);
    const sketch = this.theOtherRollShowing?.sketch;
    if (chord === null || roll === null || sketch?.editing !== true) {
      return false;
    }
    const presses = theNotesOfTheChord(roll, chord.fromMs, chord.untilMs);
    const notes = presses.map((press) => ({ midi: press.midi, downAtMs: press.downAtMs }));
    // Heard whole, the notes held into it from before as well: chosen, it is only its own.
    const heard = [...presses, ...theNotesHeldIntoTheChord(roll, chord.fromMs, chord.untilMs)];
    const adds = event.ctrlKey || event.metaKey || event.shiftKey;
    this.choose(adds ? [...sketch.chosen.filter((key) => !notes.some((note) => sameKey(note, key))), ...notes] : notes);
    this.chordTappedAt = chord.fromMs;
    this.showTheChordsOfTheKey();
    this.putTheHeadAt(chord.fromMs);
    this.soundTheChordTapped(heard, chord.untilMs - chord.fromMs);
    return true;
  }

  /**
   * Sounds the notes of a chord tapped in the lane, so it is heard as well
   * as chosen, those held into it from before as well: each pitch once, as
   * hard as it is struck hardest there, all at once, for as long as the
   * chord lasts or a moment, whichever is less. The one tapped before is
   * silenced first.
   */
  private soundTheChordTapped(presses: readonly { readonly midi: number; readonly velocity: number }[], lastsMs: number): void {
    for (const midi of this.chordTappedSounds) {
      this.runtime.pitchPlayer.stop(midi);
    }
    const now = this.runtime.clock.now();
    const keys = oneKeyForEachPitch(presses);
    for (const { midi, velocity } of keys) {
      this.runtime.pitchPlayer.play(midi, velocity, now);
      this.runtime.pitchPlayer.stop(midi, now + Math.min(lastsMs, A_CHORD_TAPPED_SOUNDS_MS));
    }
    this.chordTappedSounds = keys.map(({ midi }) => midi);
  }

  /** Whether an event is on the lane of chords under the notes. */
  private isOnTheChords(event: Event): boolean {
    return event.target instanceof Element && event.target.closest('.roll__chords') !== null;
  }

  /** Whether an event is on the pedal's lane under the notes. */
  private isOnThePedal(event: Event): boolean {
    return event.target instanceof Element && event.target.closest('.roll__pedal') !== null;
  }

  /** The moment of the run under a point across the drawing, from its start; `null` off it. */
  private theMomentUnder(clientX: number): number | null {
    const grid = this.el.rollBody.firstElementChild?.querySelector<HTMLElement>('.roll__grid') ?? null;
    if (grid === null) {
      return null;
    }
    // The grid stands still over the run, which is where the view says.
    return timeFromTap(clientX - grid.getBoundingClientRect().left + this.rollScroller.x, Number(this.el.rollZoom.value));
  }

  /**
   * Keeps a press on the drawing the drawing's until it is let go of, wherever
   * the pointer goes by then: a note, the pedal, a box, a slice or the
   * drawing itself dragged past its edge goes on following it, and a key
   * held on the strip goes on sounding. Without it a mouse leaving the
   * drawing ended whatever it was dragging there - a finger the browser
   * keeps to where it went down anyway.
   */
  private followThePointerPastTheDrawing(event: PointerEvent): void {
    if (typeof this.el.rollBody.setPointerCapture !== 'function') {
      return;
    }
    try {
      this.el.rollBody.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the page no longer has: what it began ends where it leaves.
    }
  }

  /** The press of the pedal drawn at a moment from the run's start, if there is one. */
  private thePedalPressAt(atMs: number): ScenePedal | null {
    return this.drawnScene?.pedal.find((press) => press.fromMs <= atMs && atMs <= press.untilMs) ?? null;
  }

  /**
   * Takes hold of the pedal's lane of a sketch being edited, where a finger,
   * a pen or the mouse goes down on it: a press of the pedal by an end - the
   * first or last few pixels of it - or as a whole, or the place a new one is
   * drawn from. Says whether it did.
   */
  private takeHoldOfThePedal(event: PointerEvent): boolean {
    if (
      this.theOtherRollShowing?.sketch?.editing !== true ||
      !this.isOnThePedal(event) ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return false;
    }
    const at = this.theMomentUnder(event.clientX);
    if (at === null) {
      return false;
    }
    const press = this.thePedalPressAt(at);
    const grip = press === null ? 'whole' : theGripOfAStretch(press.fromMs, press.untilMs, at, Number(this.el.rollZoom.value) / 1000);
    this.rollPedalDrag = { pointerId: event.pointerId, fromMs: at, press, grip, moved: null };
    return true;
  }

  /**
   * The sketch as the pointer on the pedal's lane has it so far: a press drawn
   * from where it went down to where it is, or the press taken hold of made
   * longer or shorter by either end, or moved - each on the nearest line of the
   * grid where the marker is put on one, and exactly with Shift. Shown, and
   * kept to be kept when the pointer lets go.
   */
  private dragThePedal(event: PointerEvent): void {
    const drag = this.rollPedalDrag;
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const at = this.theMomentUnder(event.clientX);
    if (drag === null || showing === null || sketch === undefined || stored === null || at === null) {
      return;
    }
    const roll = showing.roll;
    const origin = rollBeganAtMs(roll);
    const snapping = this.el.rollSnap.checked && !event.shiftKey;
    const snap = (ms: number): number => (snapping ? theBeatNearest(roll, ms, this.theRollsGrid()) : ms);
    const onTheRun = (ms: number): number => Math.round(ms + origin);
    const press = drag.press;
    let moved: readonly MidiFileEvent[] | null = null;
    if (press === null) {
      const ends = [snap(drag.fromMs), snap(at)].sort((one, other) => one - other);
      const [from = 0, until = 0] = ends;
      if (until - from >= SHORTEST_NOTE_MS) {
        moved = takeWithThePedalAt(stored.events, onTheRun(from), onTheRun(until), true);
      }
    } else {
      const endless = press.open ? Number.POSITIVE_INFINITY : null;
      const freed = takeWithThePedalAt(stored.events, onTheRun(press.fromMs), endless ?? onTheRun(press.untilMs), false);
      if (drag.grip === 'end') {
        const until = Math.max(snap(press.untilMs + (at - drag.fromMs)), press.fromMs + SHORTEST_NOTE_MS);
        if (until !== press.untilMs) {
          moved = takeWithThePedalAt(freed, onTheRun(press.fromMs), onTheRun(until), true);
        }
      } else if (drag.grip === 'start') {
        // Put down earlier or later, and let up where it was: never after that, nor before the run.
        const from = Math.max(0, Math.min(snap(press.fromMs + (at - drag.fromMs)), press.untilMs - SHORTEST_NOTE_MS));
        if (from !== press.fromMs) {
          moved = takeWithThePedalAt(freed, onTheRun(from), endless ?? onTheRun(press.untilMs), true);
        }
      } else {
        const by = Math.max(0, snap(press.fromMs + (at - drag.fromMs))) - press.fromMs;
        if (by !== 0) {
          moved = takeWithThePedalAt(freed, onTheRun(press.fromMs + by), endless ?? onTheRun(press.untilMs + by), true);
        }
      }
    }
    this.rollPedalDrag = { ...drag, moved };
    this.drawnScene = this.theSceneToDraw(rollOfTheTake({ ...stored, events: moved ?? stored.events }, ROOM_IN_A_SKETCH), sketch.chosen);
    this.paintTheRoll();
  }

  /**
   * Lets go of the pedal's lane: what a drag made of the sketch kept, one change
   * put back as one, or drawn as it was where the pointer was taken away. A
   * press let go of without a drag was a tap: the second of two on a press of
   * the pedal takes it out, and one on the empty lane puts the marker there.
   * The click of letting go is taken as answered here.
   */
  private letGoOfThePedal(event: PointerEvent, lifted: boolean): void {
    const drag = this.rollPedalDrag;
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    this.rollPedalDrag = null;
    if (drag === null) {
      return;
    }
    this.panned = true;
    if (drag.moved !== null) {
      if (lifted && sketch !== undefined && stored !== null) {
        this.changeTheSketchShowing(drag.moved, [...sketch.before, asItWas(stored, sketch.chosen)], sketch.chosen);
      } else {
        this.drawTheRollInto();
      }
      return;
    }
    if (!lifted) {
      return;
    }
    if (drag.press === null) {
      this.putTheHeadWhereItWasTapped(event);
    } else if (this.isASecondTap(event, { midi: THE_PEDALS_ROW, downAtMs: drag.press.fromMs })) {
      this.letGoOfThePedalPress(drag.press);
    }
  }

  /** Takes a press of the pedal out of the sketch being edited: one change, put back as one. */
  private letGoOfThePedalPress(press: ScenePedal): void {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (showing === null || sketch === undefined || stored === null) {
      return;
    }
    const origin = rollBeganAtMs(showing.roll);
    const events = takeWithThePedalAt(
      stored.events,
      Math.round(press.fromMs + origin),
      press.open ? Number.POSITIVE_INFINITY : Math.round(press.untilMs + origin),
      false,
    );
    this.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)], sketch.chosen);
  }

  /**
   * Cuts the key of a sketch being edited in two where the mouse or a pen goes
   * down on it with Alt held: on the nearest line of the grid where the marker
   * is put on one, and exactly there with Shift or with the grid let go of -
   * never leaving a part shorter than a note can be heard as. Both parts are
   * chosen, one change put back as one. Says whether the press was taken.
   */
  private cutTheKeyUnder(event: PointerEvent): boolean {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    if (
      showing === null ||
      sketch?.editing !== true ||
      !event.altKey ||
      event.pointerType === 'touch' ||
      event.button !== 0 ||
      this.isOnTheRuler(event)
    ) {
      return false;
    }
    const key = this.theKeyUnder(event);
    const at = this.thePointOnTheDrawing(event);
    const stored = this.runtime.sketches.find(sketch.id);
    if (key === null || at === null || stored === null) {
      return false;
    }
    const origin = rollBeganAtMs(showing.roll);
    const snapped = this.el.rollSnap.checked && !event.shiftKey ? theBeatNearest(showing.roll, at.atMs, this.theRollsGrid()) : at.atMs;
    const atMs = Math.round(snapped + origin);
    const endMs = key.upAtMs ?? rollEndedAtMs(showing.roll);
    // Taken either way: an Alt-press on a note is a cut, never a drag.
    if (atMs - key.downAtMs < SHORTEST_NOTE_MS || endMs - atMs < SHORTEST_NOTE_MS) {
      return true;
    }
    const events = takeWithTheKeyCut(stored.events, key, atMs);
    if (events !== null) {
      this.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)], [
        { midi: key.midi, downAtMs: key.downAtMs },
        { midi: key.midi, downAtMs: atMs },
      ]);
    }
    return true;
  }

  /**
   * Takes hold of a key of a sketch being edited, where a finger or the mouse
   * goes down on it. Says whether it did. Anywhere else the drawing is moved,
   * as it always was. What a drag from it moves is decided as it begins, and
   * a press let go of without one is a tap: see `letGoOfTheHeldKey`. A
   * pointer taken off the drawing lets go of it as it was, which is what a
   * drag carried off the edge of anything means.
   */
  private takeHoldOfAKey(event: PointerEvent): boolean {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const scene = this.drawnScene;
    if (showing === null || sketch === undefined || !sketch.editing || this.rollDrag !== null || scene === null || this.isOnTheRuler(event)) {
      return false;
    }
    const key = this.theKeyUnder(event);
    const stored = this.runtime.sketches.find(sketch.id);
    if (key === null || stored === null) {
      return false;
    }
    // Chosen as it is pressed, so it is lit while held: alone where it was
    // not chosen, added or taken out with a key held. One already chosen
    // stays among the rest, which a drag from it moves together; a press let
    // go of without one chooses it alone - see `letGoOfTheHeldKey`.
    const named = { midi: key.midi, downAtMs: key.downAtMs };
    const adds = addsToTheChoice(event);
    const copies = event.ctrlKey || event.metaKey;
    const wasChosen = sketch.chosen.some((each) => sameKey(each, key));
    // With Ctrl, one already chosen stays chosen while held: dragged, it and
    // the rest are copied; tapped, it is taken out as it is let go of.
    const letsGoOfIt = copies && wasChosen;
    if (adds && !letsGoOfIt) {
      this.chooseOrLetGo(named);
    } else if (!adds && !wasChosen) {
      this.choose([named]);
    }
    this.rollDrag = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scene,
      moved: null,
      key: named,
      adds,
      letsGoOfIt,
      copies,
      grip: this.theGripOn(key, event),
      upAtMs: key.upAtMs ?? rollEndedAtMs(showing.roll),
    };
    this.soundTheHeldKeys(
      oneKeyForEachPitch(this.theKeysDragged(this.rollDrag, stored.events)),
      0,
    );
    return true;
  }

  /**
   * Sounds the keys held where they now are, until they are let go of or
   * taken to another pitch: keys moved along their rows go on sounding
   * rather than being struck again.
   */
  private soundTheHeldKeys(keys: readonly { readonly midi: number; readonly velocity: number }[], bySemitones: number): void {
    this.letTheHeldKeysFallSilent();
    for (const key of keys) {
      this.runtime.pitchPlayer.play(key.midi + bySemitones, key.velocity);
    }
    this.soundOfTheHeldKeys = { keys, bySemitones };
  }

  private letTheHeldKeysFallSilent(): void {
    const sounding = this.soundOfTheHeldKeys;
    if (sounding !== null) {
      for (const key of sounding.keys) {
        this.runtime.pitchPlayer.stop(key.midi + sounding.bySemitones);
      }
      this.soundOfTheHeldKeys = null;
    }
  }

  /** Which part of a key a point is on: see `theGripOfAStretch`. */
  private theGripOn(key: RolledPress, point: { readonly clientX: number; readonly clientY: number }): Grip {
    const roll = this.theRoll();
    const at = this.thePointOnTheDrawing(point);
    if (roll === null || at === null) {
      return 'whole';
    }
    const origin = rollBeganAtMs(roll);
    return theGripOfAStretch(
      key.downAtMs - origin,
      (key.upAtMs ?? rollEndedAtMs(roll)) - origin,
      at.atMs,
      Number(this.el.rollZoom.value) / 1000,
    );
  }

  /**
   * Says, by the pointer's shape, what the mouse would take hold of where it
   * rests on a sketch being edited: a note or a press of the pedal, or one
   * end of either.
   */
  private showTheGrip(event: PointerEvent): void {
    const editing = this.theOtherRollShowing?.sketch?.editing === true;
    let grip: Grip | null = null;
    if (this.isOnTheRuler(event)) {
      grip = this.theGripOnTheSlice(event.clientX);
    } else if (editing && this.isOnThePedal(event)) {
      const at = this.theMomentUnder(event.clientX);
      const press = at === null ? null : this.thePedalPressAt(at);
      grip = press === null || at === null ? null : theGripOfAStretch(press.fromMs, press.untilMs, at, Number(this.el.rollZoom.value) / 1000);
    } else {
      const key = editing && !this.isOnTheChords(event) ? this.theKeyUnder(event) : null;
      grip = key === null ? null : this.theGripOn(key, event);
    }
    if (grip === null) {
      delete this.el.rollBody.dataset['grip'];
      return;
    }
    this.el.rollBody.dataset['grip'] = grip === 'whole' ? 'note' : grip;
  }

  /**
   * The keys a drag from a held key changes, as they are in the sketch now:
   * all the chosen ones where it is one of them, and only itself where it is
   * not - one taken out of the choice as it was pressed is moved alone.
   */
  private theKeysDragged(drag: NonNullable<AppView['rollDrag']>, events: readonly MidiFileEvent[]): KeyOfTheTake[] {
    const chosen = this.theOtherRollShowing?.sketch?.chosen ?? [];
    const moving = chosen.some((each) => sameKey(each, drag.key)) ? chosen : [drag.key];
    return theKeysOfTheTake(events).filter((key) => moving.some((each) => sameKey(each, key)));
  }

  /**
   * Moves the keys a drag holds to where the pointer has taken the one it
   * began on: across by time, that one on the nearest line of the grid where
   * the marker would be put on one and the others by as much, and up or down
   * by pitch as far as all of them stay inside the rows drawn. Shown by
   * painting the drawing again, not by building it again, which is too slow
   * to follow a finger.
   */
  private dragTheHeldKey(event: PointerEvent): void {
    const drag = this.rollDrag;
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (drag === null || showing === null || stored === null) {
      return;
    }
    const acrossPx = event.clientX - drag.clientX;
    const downPx = event.clientY - drag.clientY;
    if (drag.moved === null && Math.hypot(acrossPx, downPx) < TAP_SLOP_PX) {
      return;
    }
    // A drag, so the click the finger makes on letting go is not a tap.
    this.panned = true;
    const origin = rollBeganAtMs(showing.roll);
    const keys = this.theKeysDragged(drag, stored.events);
    // On the grid where the marker is put on one, unless Shift is held now:
    // then exactly where the pointer takes it.
    const snapping = this.el.rollSnap.checked && !event.shiftKey;
    if (drag.grip === 'end') {
      this.dragTheEndsOfTheKeys(drag, keys, stored, acrossPx, origin, snapping);
      return;
    }
    if (drag.grip === 'start') {
      this.dragTheStartsOfTheKeys(drag, keys, stored, acrossPx, origin, snapping);
      return;
    }
    const wanted = drag.key.downAtMs - origin + (acrossPx / Number(this.el.rollZoom.value)) * 1000;
    const at = snapping ? theBeatNearest(showing.roll, wanted, this.theRollsGrid()) : wanted;
    const byMs = Math.round(at + origin) - drag.key.downAtMs;
    const lowest = drag.scene.highest - drag.scene.rows + 1;
    const pitches = keys.map((key) => key.midi);
    const bySemitones = Math.min(
      drag.scene.highest - Math.max(...pitches),
      Math.max(lowest - Math.min(...pitches), -Math.round(downPx / this.rollLook.rowPx)),
    );
    const shown = this.showTheDrag(
      drag,
      stored,
      keys.map((key) => ({
        key,
        midi: key.midi + bySemitones,
        downAtMs: key.downAtMs + byMs,
        upAtMs: key.upAtMs === null ? null : key.upAtMs + byMs,
      })),
      drag.copies ? { byMs, bySemitones } : null,
    );
    // Heard where they are shown: a place refused is not where they went.
    const sounding = this.soundOfTheHeldKeys;
    if (shown && sounding !== null && sounding.bySemitones !== bySemitones) {
      this.soundTheHeldKeys(sounding.keys, bySemitones);
    }
  }

  /**
   * Holds the keys a drag holds longer or shorter: the end of the one it began
   * on where the pointer has taken it, on the nearest line of the grid where
   * the marker would be put on one, and the others' by as much. None shorter
   * than to the next line of the grid after it begins, where the end is put
   * on one - pulled back past its start, a note was left a sliver off the
   * grid - nor, put anywhere, than a note can be heard as one.
   */
  private dragTheEndsOfTheKeys(
    drag: NonNullable<AppView['rollDrag']>,
    keys: readonly KeyOfTheTake[],
    stored: StoredSketch,
    acrossPx: number,
    origin: number,
    snapping: boolean,
  ): void {
    const showing = this.theOtherRollShowing;
    if (showing === null) {
      return;
    }
    const wanted = drag.upAtMs - origin + (acrossPx / Number(this.el.rollZoom.value)) * 1000;
    const at = snapping ? theBeatNearest(showing.roll, wanted, this.theRollsGrid()) : wanted;
    const byMs = Math.round(at + origin) - drag.upAtMs;
    const end = rollEndedAtMs(showing.roll);
    const shortest = (key: KeyOfTheTake): number => {
      const line = snapping ? theNextLineOfTheGrid(showing.roll, key.downAtMs - origin, this.theRollsGrid(), 1) : null;
      return line === null ? key.downAtMs + SHORTEST_NOTE_MS : Math.round(line + origin);
    };
    this.showTheDrag(
      drag,
      stored,
      keys.map((key) => ({
        key,
        midi: key.midi,
        downAtMs: key.downAtMs,
        upAtMs: Math.max((key.upAtMs ?? end) + byMs, shortest(key)),
      })),
    );
  }

  /**
   * Begins the keys a drag holds earlier or later, each let go of where it
   * was: the start of the one it began on where the pointer has taken it, on
   * the nearest line of the grid where the marker would be put on one, and
   * the others' by as much. None later than the last line of the grid before
   * it ends, where the start is put on one, nor, put anywhere, than leaves a
   * note too short to be heard as one; and none before the run begins.
   */
  private dragTheStartsOfTheKeys(
    drag: NonNullable<AppView['rollDrag']>,
    keys: readonly KeyOfTheTake[],
    stored: StoredSketch,
    acrossPx: number,
    origin: number,
    snapping: boolean,
  ): void {
    const showing = this.theOtherRollShowing;
    if (showing === null) {
      return;
    }
    const wanted = drag.key.downAtMs - origin + (acrossPx / Number(this.el.rollZoom.value)) * 1000;
    const at = snapping ? theBeatNearest(showing.roll, wanted, this.theRollsGrid()) : wanted;
    const byMs = Math.round(at + origin) - drag.key.downAtMs;
    const end = rollEndedAtMs(showing.roll);
    const latest = (key: KeyOfTheTake): number => {
      const until = key.upAtMs ?? end;
      const line = snapping ? theNextLineOfTheGrid(showing.roll, until - origin, this.theRollsGrid(), -1) : null;
      return line === null ? until - SHORTEST_NOTE_MS : Math.round(line + origin);
    };
    this.showTheDrag(
      drag,
      stored,
      keys.map((key) => ({
        key,
        midi: key.midi,
        // Nor before the run begins, as a press of the pedal is not.
        downAtMs: Math.max(Math.min(key.downAtMs, origin), Math.min(key.downAtMs + byMs, latest(key))),
        upAtMs: key.upAtMs,
      })),
    );
  }

  /**
   * Paints the sketch as a drag has it so far, and keeps it to be kept when
   * the pointer lets go - the keys moved, or, where it copies, copies of them
   * moved and the keys left where they were - unless a key would be over
   * another of its pitch, when the drag stays where it last fitted, to go on
   * from there once it fits again. Says whether it was shown.
   */
  private showTheDrag(
    drag: NonNullable<AppView['rollDrag']>,
    stored: StoredSketch,
    changes: readonly KeyChange[],
    copied: { readonly byMs: number; readonly bySemitones: number } | null = null,
  ): boolean {
    const events =
      copied === null
        ? takeWithTheKeysChanged(stored.events, changes)
        : takeWithTheKeysCopied(
            stored.events,
            changes.map(({ key }) => key),
            copied.byMs,
            copied.bySemitones,
          );
    const to = changes.map(({ midi, downAtMs }) => ({ midi, downAtMs }));
    if (events === null || aKeyIsOverAnotherOfItsPitch(events, to)) {
      return false;
    }
    this.rollDrag = { ...drag, moved: { to, events } };
    this.drawnScene = this.theSceneToDraw(rollOfTheTake({ ...stored, events }, ROOM_IN_A_SKETCH), to);
    this.paintTheRoll();
    return true;
  }

  /**
   * Lets go of the key held: where a drag took the keys on a finger lifted,
   * the sketch changed as a delete changes it, those keys chosen; drawn as it
   * was where the pointer was taken away instead. Without a drag it was a tap
   * on the note, and the click of letting go is taken as answered here.
   */
  private letGoOfTheHeldKey(lifted: PointerEvent | null): void {
    this.letTheHeldKeysFallSilent();
    const drag = this.rollDrag;
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    this.rollDrag = null;
    if (drag === null) {
      return;
    }
    if (drag.moved === null) {
      if (lifted !== null) {
        this.panned = true;
        // The second of two taps on a note takes it out.
        if (this.isASecondTap(lifted, drag.key)) {
          this.deleteTheKey(drag.key);
          return;
        }
        // Added or taken out as it was pressed; otherwise chosen alone.
        if (drag.letsGoOfIt) {
          this.chooseOrLetGo(drag.key);
        } else if (!drag.adds) {
          this.choose([drag.key]);
        }
      }
      return;
    }
    if (lifted !== null && sketch !== undefined && stored !== null) {
      this.changeTheSketchShowing(drag.moved.events, [...sketch.before, asItWas(stored, sketch.chosen)], drag.moved.to);
    } else {
      this.drawTheRollInto();
    }
  }

  /**
   * The keys an editor answers to, while a sketch is being edited and nothing
   * is being typed: Delete or Backspace takes the chosen notes out, and Ctrl+Z
   * (Cmd+Z on a Mac) puts back the last change - the trash and the undo
   * buttons, without leaving the keyboard. The arrows move the chosen notes,
   * and with Ctrl (Cmd) copy them there instead. Ctrl+C and Ctrl+X copy the
   * chosen notes to the clipboard, and cut them; a paste is answered by
   * `pasteTheNotesCopied`.
   */
  private editByTheKeys(event: KeyboardEvent): void {
    if (this.el.sheetRoll.hidden || isTypedInto(event.target as TypedInto | null)) {
      return;
    }
    if (this.theOtherRollShowing?.sketch === undefined) {
      this.chooseByTheKeys(event);
      return;
    }
    if (!this.theOtherRollShowing.sketch.editing) {
      return;
    }
    if (this.markChosenAtMs !== null && (event.key === 'Escape' || event.key === 'Delete' || event.key === 'Backspace')) {
      // A flag chosen answers first: let go of, or taken away.
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        this.chooseTheMark(null);
      } else {
        this.takeTheMarkAway(this.markChosenAtMs);
      }
      return;
    }
    const copying = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (event.code === 'KeyC' || event.code === 'KeyX');
    if (this.markChosenAtMs !== null && copying) {
      event.preventDefault();
      this.copyTheMarkChosen(event.code === 'KeyX');
      return;
    }
    if (event.key === 'Escape' && this.chordsBeingForgotten) {
      // The deleting ends first, then what is chosen, then the sheet.
      event.preventDefault();
      event.stopImmediatePropagation();
      this.chordsBeingForgotten = false;
      this.showTheChordsOfTheKey();
      return;
    }
    const command = (event.ctrlKey || event.metaKey) && !event.altKey;
    const chosen = this.theOtherRollShowing?.sketch?.chosen ?? [];
    if (command && event.code === 'KeyZ') {
      // With Shift it is a redo, as everywhere; Ctrl+Y is the other name for one.
      event.preventDefault();
      if (event.shiftKey) {
        this.bringBackTheLastPutBack();
      } else {
        this.putBackTheLastChange();
      }
    } else if (command && !event.shiftKey && event.code === 'KeyY') {
      event.preventDefault();
      this.bringBackTheLastPutBack();
    } else if (command && !event.shiftKey && event.code === 'KeyA') {
      // Every note, rather than every word on the page.
      event.preventDefault();
      const sketch = this.theOtherRollShowing?.sketch;
      const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
      this.choose(stored === null ? [] : theKeysOfTheTake(stored.events));
    } else if (event.key === 'Escape' && chosen.length > 0) {
      // First what is chosen is let go of; the next Escape shuts the sheet.
      event.preventDefault();
      event.stopImmediatePropagation();
      this.choose([]);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.deleteTheChosenKeys();
    } else if (command && !event.shiftKey && (event.code === 'KeyC' || event.code === 'KeyX') && chosen.length > 0) {
      // Written on the key rather than on the browser's copy, which a browser
      // with no text chosen on the page need not send.
      event.preventDefault();
      this.copyTheChosenKeys(event.code === 'KeyX');
    } else if (command && event.code === 'KeyD' && chosen.length > 0) {
      // The other name for a copy just after, rather than a bookmark.
      event.preventDefault();
      this.moveTheChosenKeys('ArrowRight', false, true);
    } else if (
      !event.altKey &&
      ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) &&
      // A list or a slider with the focus has its own use for them.
      !usesTheArrows(event.target instanceof Element ? event.target : null) &&
      chosen.length > 0
    ) {
      event.preventDefault();
      this.moveTheChosenKeys(event.key, event.shiftKey, command);
    }
  }

  /**
   * The keys that choose and copy notes on a drawing that is not a sketch,
   * as they do on one: everything, nothing, and a copy. Nothing there is
   * changed, so nothing else is answered.
   */
  private chooseByTheKeys(event: KeyboardEvent): void {
    const command = (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    const roll = this.theRoll();
    const chosen = this.theNotesChosen();
    if (command && event.code === 'KeyA' && roll !== null) {
      event.preventDefault();
      this.choose(roll.presses);
    } else if (event.key === 'Escape' && chosen.length > 0) {
      // First what is chosen is let go of; the next Escape shuts the sheet.
      event.preventDefault();
      event.stopImmediatePropagation();
      this.choose([]);
    } else if (command && event.code === 'KeyC' && chosen.length > 0) {
      event.preventDefault();
      this.copyTheChosenKeys(false);
    }
  }

  /**
   * Copies the chosen notes to the clipboard, as text a paste here can read
   * back - into this sketch or another, in this tab or another - and cutting,
   * takes them out as the trash would, to be put back by an undo should the
   * clipboard refuse them.
   */
  private copyTheChosenKeys(cutting: boolean): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const roll = this.theRoll();
    const clipboard = this.doc.defaultView?.navigator?.clipboard;
    // A sketch's notes as it keeps them; anything else's as its drawing has them.
    const events = stored !== null ? stored.events : sketch === undefined && roll !== null ? rollAsEvents(roll) : null;
    if (events === null) {
      return;
    }
    const notes = theNotesCopied(events, this.theNotesChosen());
    if (notes.length > 0) {
      this.notesCopiedHere = notes;
      this.showTheChordsOfTheKey();
    }
    // A page not served securely has no clipboard, and a cut there would only delete.
    if (clipboard === undefined) {
      return;
    }
    if (notes.length > 0) {
      void clipboard.writeText(theClipboardTextOf(notes)).catch(() => undefined);
    }
    if (cutting) {
      this.deleteTheChosenKeys();
    }
  }

  /**
   * Puts notes copied into the sketch being edited, the first of them where
   * the head is, and chooses them: one change, put back as one. Read off the
   * browser's paste rather than asked of the clipboard, which a browser would
   * first ask the reader's leave for. Anything else on the clipboard is left
   * to the browser.
   */
  private pasteTheNotesCopied(event: ClipboardEvent): void {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (
      this.el.sheetRoll.hidden ||
      showing === null ||
      sketch?.editing !== true ||
      stored === null ||
      isTypedInto(event.target as TypedInto | null)
    ) {
      return;
    }
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const notes = theNotesOnTheClipboard(text);
    const change = theChangeOnTheClipboard(text);
    if (notes !== null) {
      event.preventDefault();
      this.pasteTheNotes(notes);
    } else if (change !== null) {
      event.preventDefault();
      this.pasteTheChange(change);
    }
  }

  /**
   * Pastes by the drawer's button, which has no paste event to read: the
   * clipboard is asked - which a browser may first ask the reader's leave
   * for - and where it cannot be read or holds neither notes nor a change,
   * what was last copied in this page is pasted.
   */
  private pasteWithTheButton(): void {
    const clipboard = this.doc.defaultView?.navigator?.clipboard;
    const read =
      typeof clipboard?.readText === 'function'
        ? clipboard.readText().then((text) => text, () => '')
        : Promise.resolve('');
    void read.then((text) => {
      const notes = theNotesOnTheClipboard(text);
      const change = theChangeOnTheClipboard(text);
      if (notes !== null) {
        this.pasteTheNotes(notes);
      } else if (change !== null) {
        this.pasteTheChange(change);
      } else if (this.notesCopiedHere !== null) {
        this.pasteTheNotes(this.notesCopiedHere);
      } else if (this.changeCopiedHere !== null) {
        this.pasteTheChange(this.changeCopiedHere);
      }
    });
  }

  /** Puts notes copied into the sketch being edited, the first where the head is, and chooses them: one change. */
  private pasteTheNotes(notes: readonly NoteCopied[]): void {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (showing === null || sketch === undefined || stored === null) {
      return;
    }
    const { events, pasted } = takeWithTheNotesPasted(stored.events, notes, this.rollAtMs + rollBeganAtMs(showing.roll));
    if (pasted.length > 0) {
      this.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)], pasted);
    }
  }

  /** Takes the chosen keys out of the sketch, keeping what it was to be put back. */
  private deleteTheChosenKeys(): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (sketch === undefined || sketch.chosen.length === 0 || stored === null) {
      return;
    }
    const events = takeWithoutTheKeys(stored.events, sketch.chosen);
    if (events !== null) {
      this.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)]);
    }
  }

  /**
   * Takes one note out of the sketch being edited - tapped twice, or clicked
   * with the right button: one change, put back as one. Only that note goes;
   * the others chosen stay so.
   */
  private deleteTheKey(key: KeyNamed): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (sketch === undefined || stored === null) {
      return;
    }
    const events = takeWithoutTheKeys(stored.events, [key]);
    if (events !== null) {
      this.changeTheSketchShowing(
        events,
        [...sketch.before, asItWas(stored, sketch.chosen)],
        sketch.chosen.filter((each) => !sameKey(each, key)),
      );
    }
  }

  /** Puts the sketch back as it was before its last change, keeping what it was for a redo. */
  private putBackTheLastChange(): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const last = sketch?.before.at(-1);
    if (sketch === undefined || stored === null || last === undefined) {
      return;
    }
    this.changeTheSketchShowing(
      last.events,
      sketch.before.slice(0, -1),
      last.chosen,
      last.beats,
      [...sketch.after, asItWas(stored, sketch.chosen)],
    );
  }

  /** Brings back what the last undo put back, while nothing has changed since. */
  private bringBackTheLastPutBack(): void {
    const sketch = this.theOtherRollShowing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    const last = sketch?.after.at(-1);
    if (sketch === undefined || stored === null || last === undefined) {
      return;
    }
    this.changeTheSketchShowing(
      last.events,
      [...sketch.before, asItWas(stored, sketch.chosen)],
      last.chosen,
      last.beats,
      sketch.after.slice(0, -1),
    );
  }

  /**
   * Moves the chosen notes by an arrow key: across to the next line of the
   * grid, the earliest of them onto it and the rest by as much; up or down a
   * semitone, or an octave with Shift - and not at all where one would leave
   * the keyboard. One change each, heard where it goes up or down.
   *
   * Copying, the chosen stay and copies of them go there and are chosen
   * instead - across, not to the next line but straight after them, or
   * before, from the first one's start to the last one's end: a figure
   * written again, and again on the next press.
   */
  private moveTheChosenKeys(arrow: string, octave: boolean, copying: boolean): void {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (showing === null || sketch === undefined || stored === null) {
      return;
    }
    const keys = theKeysOfTheTake(stored.events).filter((key) => sketch.chosen.some((each) => sameKey(each, key)));
    if (keys.length === 0) {
      return;
    }
    const moved = (byMs: number, bySemitones: number): readonly (KeyChange & { readonly key: KeyOfTheTake })[] =>
      keys.map((key) => ({
        key,
        midi: key.midi + bySemitones,
        downAtMs: key.downAtMs + byMs,
        upAtMs: key.upAtMs === null ? null : key.upAtMs + byMs,
      }));
    // A step onto a place another of a pitch holds goes on past it, to the
    // next where every one fits - or nowhere, where none is left that way.
    // The copies are asked of as the moved notes are: they are where those
    // would have gone.
    type Placed = {
      readonly changes: readonly (KeyChange & { readonly key: KeyOfTheTake })[];
      readonly events: readonly MidiFileEvent[];
    };
    const fits = (byMs: number, bySemitones: number): Placed | null => {
      const changes = moved(byMs, bySemitones);
      const events = copying
        ? takeWithTheKeysCopied(stored.events, keys, byMs, bySemitones)
        : takeWithTheKeysChanged(stored.events, changes);
      return events === null || aKeyIsOverAnotherOfItsPitch(events, changes) ? null : { changes, events };
    };
    let placed: Placed | null = null;
    let bySemitones = 0;
    if (arrow === 'ArrowLeft' || arrow === 'ArrowRight') {
      const origin = rollBeganAtMs(showing.roll);
      const earliest = Math.min(...keys.map((key) => key.downAtMs));
      const towards = arrow === 'ArrowRight' ? 1 : -1;
      if (copying) {
        // A key still down at the end is over its copy wherever that goes,
        // and alone it has no length to be followed on from.
        const span = Math.max(...keys.map((key) => key.upAtMs ?? key.downAtMs)) - earliest;
        if (span <= 0) {
          return;
        }
        const last = stored.events.at(-1)?.atMs ?? earliest;
        // Past every event of the sketch a copy fits or never will.
        for (let byMs = towards * span; placed === null; byMs += towards * span) {
          if (earliest + byMs < origin || earliest + byMs > last + span) {
            return;
          }
          placed = fits(byMs, 0);
        }
      } else {
        for (let from = earliest - origin; placed === null; ) {
          const line = theNextLineOfTheGrid(showing.roll, from, this.theRollsGrid(), towards);
          if (line === null) {
            return;
          }
          placed = fits(Math.round(line + origin) - earliest, 0);
          from = line;
        }
      }
    } else {
      const step = (arrow === 'ArrowUp' ? 1 : -1) * (octave ? 12 : 1);
      for (bySemitones = step; placed === null; bySemitones += step) {
        if (keys.some((key) => key.midi + bySemitones < LOWEST_KEY || key.midi + bySemitones > HIGHEST_KEY)) {
          return;
        }
        placed = fits(0, bySemitones);
      }
    }
    if (placed === null) {
      return;
    }
    const { changes, events } = placed;
    if (bySemitones !== 0) {
      // Heard where they went, a moment each, both ends handed over at once.
      const now = this.runtime.clock.now();
      for (const { midi, velocity } of oneKeyForEachPitch(changes.map(({ midi, key }) => ({ midi, velocity: key.velocity })))) {
        this.runtime.pitchPlayer.play(midi, velocity, now);
        this.runtime.pitchPlayer.stop(midi, now + HEARD_ON_A_STEP_MS);
      }
    }
    this.changeTheSketchShowing(
      events,
      [...sketch.before, asItWas(stored, sketch.chosen)],
      changes.map(({ midi, downAtMs }) => ({ midi, downAtMs })),
    );
  }

  /**
   * Changes the sketch on the drawing, and everything drawn from it: the
   * sketch kept, its drawing and its row in the list. A playback going is
   * held where it stands, since it was sounding the sketch before the change.
   */
  private changeTheSketchShowing(
    events: readonly MidiFileEvent[],
    before: readonly SketchAsItWas[],
    chosen: readonly KeyNamed[] = [],
    beats?: readonly HeardBeat[],
    after: readonly SketchAsItWas[] = [],
  ): void {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    // Not while the drive's is being taken underneath it: a change worked
    // out from the notes drawn would put back the notes the drive's replaced.
    if (showing === null || sketch === undefined || this.sketchTakenUnderTheEditor === sketch.id) {
      return;
    }
    const changed = this.runtime.sketches.changeTheNotes(sketch.id, events, beats);
    if (changed === null) {
      return;
    }
    this.holdTheRoll();
    const roll = rollOfTheTake(changed, ROOM_IN_A_SKETCH);
    this.theOtherRollShowing = {
      ...showing,
      roll,
      barLabel: barsCountedOnItsBeats(roll),
      sketch: { ...sketch, chosen, before, after },
    };
    this.drawTheRollInto();
    this.sayWhatCanBeChanged();
    this.renderSketches();
  }

  /** Says which bars the buttons have settled on, and whether there is one. */
  private sayWhatWouldBePractised(): void {
    const { rangeFromBar, rangeToBar } = this.runtime.controller.settings;
    const chosen = rangeFromBar !== null || rangeToBar !== null;
    const { firstBar, lastBar } = this.runtime.controller.pieceBarRange;
    this.el.rollPassageWhat.textContent = chosen
      ? `Bars ${rangeFromBar ?? firstBar}\u2013${rangeToBar ?? lastBar}`
      : 'The whole piece';
    this.el.rollPractise.disabled = !chosen;
  }

  /** What a roll is drawn as, as the options in the sheet stand. */
  private theSceneToDraw(
    roll: RunRoll,
    chosen: readonly KeyNamed[],
    ghosts: readonly RollGhost[] = this.theNotesAskedFor(),
  ): RollScene {
    return theSceneOfTheRoll({
      roll,
      barLabel: this.barNamer(),
      grid: this.theRollsGrid(),
      ghosts,
      slips: this.el.rollSlips.checked,
      keepsTime: this.theRunKeptTime(),
      chosen,
      wholeKeyboard: this.theOtherRollShowing?.sketch?.editing === true,
      freely: this.nothingOnTheDrawingIsJudged(),
      scales: this.theScalesOfTheSketchShown(),
      marks: this.theMarksOfTheSketchShown(),
      chordsIn: this.theChordsOfTheKeyAreOpen() ? this.theKeysOfTheSketchShown() : undefined,
    });
  }

  /**
   * Builds the drawing again, leaving the playback alone.
   *
   * Separate from opening the sheet because the grid can be made finer while
   * something is sounding, and that is a redraw rather than a fresh start: the
   * head stays where it is and the sound goes on.
   */
  private drawTheRollInto(): void {
    const roll = this.theRoll();
    if (roll === null) {
      return;
    }
    const ghosts = this.theNotesAskedFor();
    const scene = this.theSceneToDraw(roll, this.theNotesChosen(), ghosts);
    this.drawnScene = scene;
    // Said before the drawing is measured: editing, the pedal's lane is
    // taller, to be drawn on with a finger.
    const stage = this.el.rollBody.closest<HTMLElement>('.roll-stage');
    if (stage !== null) {
      stage.dataset['editing'] = String(this.theOtherRollShowing?.sketch?.editing === true);
      // And with the chords open, the lane naming those the notes make -
      // said on the sheet as well, for the rows under the drawing.
      stage.dataset['chords'] = String(this.theChordsOfTheKeyAreOpen());
      this.el.sheetRoll.dataset['chords'] = String(this.theChordsOfTheKeyAreOpen());
    }
    this.el.rollBody.replaceChildren(drawTheRoll(scene));
    this.rollHeads = theHeadsOf(this.el.rollBody);
    this.rollCanvases = theCanvasesOf(this.el.rollBody);
    this.rollKeysStrip = theKeysStripOf(this.el.rollBody);
    this.rollInks = null;
    // A new strip of keys, none of them lit yet, but for those of the scale the cursor is in.
    this.soundingRowsSaid = '';
    this.markTheScaleOnTheStrip();
    this.showTheMarkChosen();
    this.showTheSlice();
    this.rollPitches = thePitchesOfTheRun(roll, ghosts, this.theOtherRollShowing?.sketch?.editing === true, {
      freely: this.nothingOnTheDrawingIsJudged(),
      chosen: this.theNotesChosen(),
    });
    this.applyTheZoom();
    this.el.rollMap.replaceChildren(
      drawTheMap(roll),
      this.el.rollMapWindow,
      this.el.rollMapHead,
    );
    // The drawing is thrown away and built again on every redraw, so what its
    // canvases listen for goes with it and there is nothing to unsubscribe.
    this.tellThePointerWhatIsUnderIt();
    this.showTheView();
    this.describeTheRoll();
  }

  /**
   * Tells a pointer resting on the drawing what the mark under it is.
   *
   * Each mark drawn as an element carried a title of its own. Painted, the
   * lane it is painted in has one, and it is changed to say whatever mark the
   * pointer is over - so a note still says what it was and how far off the
   * beat it came. His: "а чи неможливо буде hover робити на canvas?".
   */
  private tellThePointerWhatIsUnderIt(): void {
    const canvases = this.rollCanvases;
    if (canvases === null) {
      return;
    }
    const answer = (
      canvas: HTMLCanvasElement,
      ask: (scene: RollScene, atMs: number, row: number | null, pxPerSecond: number) => string | null,
    ): void => {
      canvas.addEventListener('pointermove', (event) => {
        const scene = this.drawnScene;
        const pxPerSecond = Number(this.el.rollZoom.value);
        // The canvas stands still over the run, which is where the view says.
        const box = canvas.getBoundingClientRect();
        const atMs = timeFromTap(event.clientX - box.left + this.rollScroller.x, pxPerSecond);
        const row = rowFromTap(event.clientY - box.top + this.rollScroller.y, this.rollLook.rowPx);
        const says = scene === null || atMs === null ? null : ask(scene, atMs, row, pxPerSecond);
        if (canvas.title !== (says ?? '')) {
          canvas.title = says ?? '';
        }
      });
    };
    answer(canvases.grid, (scene, atMs, row, pxPerSecond) =>
      row === null ? null : whatTheGridSaysAt(scene, atMs, row, pxPerSecond),
    );
    answer(canvases.ruler, (scene, atMs, _row, pxPerSecond) =>
      whatTheRulerSaysAt(scene, atMs, pxPerSecond),
    );
    answer(canvases.chords, (scene, atMs) => whatTheChordsSayAt(scene, atMs));
    answer(canvases.pedal, (scene, atMs, _row, pxPerSecond) =>
      whatThePedalSaysAt(scene, atMs, pxPerSecond),
    );
  }


  /**
   * Paints the part of the run in view on the three canvases, and moves the
   * head and the keys to where the view stands - all in one frame, so nothing
   * on the screen is a frame behind anything else.
   *
   * Only that part, and that is the whole of why it is painted at all: laid out
   * as an element a mark, a run of five thousand notes took a second to open
   * and most of one to zoom, every mark of it being placed whether it was on
   * the screen or not.
   */
  private paintTheRoll(): void {
    const scene = this.drawnScene;
    const canvases = this.rollCanvases;
    const drawn = this.el.rollBody.firstElementChild;
    const scrolled = this.rollScroller;
    if (scene === null || canvases === null || !(drawn instanceof HTMLElement)) {
      return;
    }
    const along = `${String(scrolled.x)}px`;
    this.rollHeads?.line.style.setProperty('--roll-x', along);
    this.rollHeads?.mark.style.setProperty('--roll-x', along);
    this.rollHeads?.place.style.setProperty('--roll-x', along);
    this.rollHeads?.marks.style.setProperty('--roll-x', along);
    this.rollKeysStrip?.style.setProperty('--roll-y', `${String(scrolled.y)}px`);
    // Nothing on the screen to paint for: the sheet is shut, or nothing has
    // been laid out yet.
    if (scrolled.viewWidePx <= 0 || scrolled.viewTallPx <= 0) {
      return;
    }
    this.rollInks ??= theInksOf(drawn);
    const look = this.rollLook;
    const view: RollViewport = {
      scrolledPx: scrolled.x,
      scrolledDownPx: scrolled.y,
      pxPerSecond: Number(this.el.rollZoom.value),
      rowPx: look.rowPx,
    };
    const density = this.doc.defaultView?.devicePixelRatio ?? 1;
    paintTheGrid(
      sized(canvases.grid, scrolled.viewWidePx, scrolled.viewTallPx),
      scene,
      view,
      this.rollInks,
      density,
      this.soundingRows,
      this.notesShownAhead,
      this.notesBeingRecorded,
    );
    paintTheRuler(sized(canvases.ruler, scrolled.viewWidePx, look.rulerTallPx), scene, view, this.rollInks, density);
    paintTheChords(sized(canvases.chords, scrolled.viewWidePx, look.chordsTallPx), scene, view, this.rollInks, density);
    paintThePedal(sized(canvases.pedal, scrolled.viewWidePx, look.pedalTallPx), scene, view, this.rollInks, density);
  }

  /**
   * Paints the drawing again when the room it has changes, or its colours do.
   *
   * A canvas is as many pixels as it was made, and stretches rather than grows
   * when the sheet around it does; and it is painted in the colours of the
   * moment it was painted, which a tablet turning dark at dusk changes under
   * it.
   */
  private repaintTheRollWhenTheScreenChanges(): void {
    const view = this.doc.defaultView;
    if (view === null) {
      return;
    }
    if (typeof view.ResizeObserver === 'function') {
      const watch = new view.ResizeObserver(() => {
        this.askWhereTheViewIs();
      });
      watch.observe(this.el.rollBody);
      this.subscriptions.push(() => {
        watch.disconnect();
      });
    }
    if (typeof view.matchMedia === 'function') {
      const dark = view.matchMedia('(prefers-color-scheme: dark)');
      const repaint = (): void => {
        this.paintInTheColoursNow();
      };
      dark.addEventListener('change', repaint);
      this.subscriptions.push(() => {
        dark.removeEventListener('change', repaint);
      });
    }
  }

  /**
   * Paints what is painted on a canvas again, in the colours the page is in
   * now: a canvas keeps the colours of the moment it was painted, and the
   * theme has changed under it.
   */
  private paintInTheColoursNow(): void {
    this.rollInks = null;
    this.laneInks = null;
    this.askWhereTheViewIs();
  }

  /**
   * Whether a machine kept the time of the run being drawn.
   *
   * A property of the frame it was played in rather than of anything the reader
   * chose, and read off the report rather than off the current setting, because
   * the setting may have moved since the run. Unknown counts as keeping time:
   * that is what every mode but one does.
   */
  private theRunKeptTime(): boolean {
    const frame = this.runtime.controller.lastReport?.modeId;
    return frame === undefined || this.runtime.modes.get(frame).requiresMetronome;
  }

  /**
   * The notes the music asked for, where the reader wants to see them.
   *
   * Read off the timeline rather than the run, because that is what the run was
   * measured against - including the notes it never got, which are the ones
   * worth seeing. The hand is the one being practised: a reader working the left
   * hand is not being shown the right hand's notes as something they missed.
   * For the score itself, both hands are shown so the outlines match what was
   * written across the whole piece.
   */
  private theNotesAskedFor(): readonly RollGhost[] {
    const timeline = this.runtime.controller.currentTimeline;
    if (!this.el.rollGhosts.checked || timeline === null) {
      return [];
    }
    // Only under what was played on this score. Under a reading of another
    // piece the open score's notes are somebody else's question drawn beneath
    // its answer.
    if (this.theOtherRollShowing?.ofTheOpenScore === false) {
      return [];
    }
    const isScore = this.theOtherRollShowing?.isScore ?? false;
    const hand = isScore ? null : this.runtime.controller.settings.handStaff;
    const asked: RollGhost[] = [];
    for (const step of timeline.steps) {
      // The same notes, for the same lengths, that the score's own roll is
      // drawn from and the playback sounds: worked out in one place.
      for (const note of notesStruckAt(step, hand)) {
        asked.push({
          midi: note.midi,
          fromTicks: step.onsetTicks,
          untilTicks: step.onsetTicks + soundsFor(note),
          stepIndex: step.index,
        });
      }
    }
    return asked;
  }

  /**
   * How fine a grid the reader has asked for, in the drawing and in the click.
   *
   * The bar-line reading and the number of parts are one control because they
   * are one question - how much detail - and five settings of it are easier to
   * choose between than two controls making fifteen combinations.
   */
  private theRollsGrid(): GridChoice {
    const asked = Number(this.el.rollGrid.value);
    if (this.el.rollGrid.value === 'bars') {
      return { beats: false, parts: 1 };
    }
    return { beats: true, parts: Number.isFinite(asked) && asked >= 1 ? asked : 1 };
  }

  /** Where the head stands, whether something is sounding or not. */
  private headIsAtMs(): number {
    const player = this.runtime.takePlayer;
    return player.playing === RUN_ROLL_ID ? player.positionMs : this.rollAtMs;
  }

  /**
   * What the writer called the bar a position in the music begins, if it does.
   *
   * Read off the printed bar lines rather than counted: a repeat is written out
   * and a re-read bar keeps the number it has in the file. No calibration
   * either, because the roll carries positions in the music - the arithmetic
   * that used to be needed here was an attempt to undo the metronome's own bar
   * counter, which a frame with gates resets at every bar line.
   */
  private barNamer(): (positionTicks: number) => string | null {
    const own = this.theOtherRollShowing?.barLabel;
    if (own !== undefined) {
      return own;
    }
    const exercise = this.runtime.controller.currentExercise;
    if (exercise === null) {
      return () => null;
    }
    const bars = barLines(exercise);
    return (positionTicks) => {
      const index = bars.findIndex((bar) => bar.startTicks === positionTicks);
      return index < 0 ? null : String(barNumberOf(exercise, index));
    };
  }

  /**
   * Sounds the run the drawing is of.
   *
   * Through the player that already plays a recording, because a run written
   * down *is* one: the same stream, the same pedal, the same rebasing to its
   * own nought. What it is not is a take, so the take shelf's own transport is
   * let go of first - one player can only be sounding one thing, and a
   * transport still pointing at a take would be describing a performance that
   * had been taken away from it.
   */
  private playTheRoll(): void {
    const roll = this.theRoll();
    if (roll === null || roll.presses.length === 0) {
      return;
    }
    if (this.takeTick !== null) {
      clearInterval(this.takeTick);
      this.takeTick = null;
    }
    // The player is the picture's now.
    this.letGoOfTheTakeOnTheKeys();
    this.selectedTakeId = null;
    this.describeTakeTransport();
    // From wherever the head stands, which is nought unless the reader has put
    // it somewhere - and the clicks behind it are already spent.
    this.clicksHandedOver(clicksBefore(roll, this.rollAtMs, this.theRollsGrid()));
    this.runtime.takePlayer.setSpeed(this.theRollsSpeed());
    this.runtime.takePlayer.play(RUN_ROLL_ID, rollAsEvents(roll), this.rollAtMs, this.theSliceGoneRoundFrom(this.rollAtMs));
    this.clickAheadOfTheRoll();
    if (this.rollTick === null) {
      this.rollTick = setInterval(() => this.followTheRoll(), TAKE_TICK_MS);
    }
    this.describeTheRoll();
  }

  /**
   * Holds the playback where it is, to be picked up from there.
   *
   * The head stays where the sound stopped, which is the whole difference from
   * stopping: a reader working out what happened in one bar plays it, holds it,
   * looks, and plays on from the same place.
   */
  private holdTheRoll(): void {
    const player = this.runtime.takePlayer;
    if (player.playing === RUN_ROLL_ID) {
      player.pause();
      this.rollAtMs = player.positionMs;
    }
    this.letTheRollTickGo();
    this.describeTheRoll();
  }

  /**
   * Back to where the marker was put, sound stopped; and pressed with the
   * head there already, back to the beginning, the marker with it - a
   * transport's rewind and stop as one button.
   */
  private goBackInTheRoll(): void {
    if (this.recording !== null) {
      this.writeInWhatWasRecorded();
      return;
    }
    const sounding = this.runtime.takePlayer.playing === RUN_ROLL_ID;
    if (!sounding && this.rollAtMs === this.whereTheMarkerGoesBackTo()) {
      this.stopTheRoll();
      return;
    }
    this.goBackToTheMarker();
  }

  /**
   * Where going back takes the marker: to the start of the slice where the
   * marker is inside one - a playback from it goes round the slice, and
   * each lap begins there - and to the marker otherwise.
   */
  private whereTheMarkerGoesBackTo(): number {
    const slice = this.theSliceGoneRoundFrom(this.rollPlacedAtMs);
    return slice === null ? this.rollPlacedAtMs : slice.fromMs;
  }

  /** Back to where the marker was put, a playback going stopped: what Shift+Space asks for. */
  private goBackToTheMarker(): void {
    const sounding = this.runtime.takePlayer.playing === RUN_ROLL_ID;
    if (sounding) {
      this.runtime.takePlayer.stop();
    }
    this.rollPlacedAtMs = this.whereTheMarkerGoesBackTo();
    this.rollAtMs = this.rollPlacedAtMs;
    this.clicksHandedOver(0);
    this.letTheRollTickGo();
    this.describeTheRoll();
  }

  /**
   * Records the instrument into the sketch being edited from where the
   * cursor is: a count-in of as many bars as the settings say, at the
   * sketch's pace and metre there, and then whatever is played, heard over
   * what is already written and the sketch's own beat. Nothing is written
   * until it stops: see `writeInWhatWasRecorded`.
   */
  private recordIntoTheSketch(): void {
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.runtime.sketches.find(sketch.id);
    if (showing === null || sketch === undefined || !sketch.editing || stored === null) {
      return;
    }
    if (this.runtime.takePlayer.playing === RUN_ROLL_ID) {
      this.holdTheRoll();
    }
    const origin = rollBeganAtMs(showing.roll);
    const fromMs = this.headIsAtMs();
    const now = this.runtime.clock.now();
    // The beat where it goes in, which the count-in is counted at; a sketch
    // with no beat is recorded into at once.
    const beat = theBeatOfTheClickAt(stored.events, stored.beats, fromMs + origin);
    const beatMs = beat === null ? 0 : ((MILLISECONDS_A_MINUTE / beat.crotchetsPerMinute) * 4) / beat.metre.beatType;
    const countIn = beat === null ? 0 : this.runtime.controller.settings.countInBars * beat.metre.beatsInBar;
    const beginsAtMs = now + countIn * beatMs;
    for (let at = 0; at < countIn; at += 1) {
      this.runtime.metronomeClick.click(now + at * beatMs, beat !== null && at % beat.metre.beatsInBar === 0 ? 'downbeat' : 'beat');
    }
    // The sketch's beat from there on, carried past its end, to be clicked under the playing.
    const carried = theClickOfTheTake(stored.events, stored.beats, RECORDED_BEATS_PAST_THE_END) ?? [];
    const clicks = carried
      .filter((each) => each.atMs >= fromMs + origin - SLICE_EDGE_MS)
      .map((each) => ({
        atMs: beginsAtMs + (each.atMs - origin - fromMs),
        weight: (each.beat === 0 ? 'downbeat' : 'beat') as BeatWeight,
      }));
    // A key struck a little before the first beat, as a downbeat often is, is the first beat's.
    const earliest = beginsAtMs - (beatMs > 0 ? beatMs / 2 : EARLY_BY_AT_MOST_MS);
    const played: MidiFileEvent[] = [];
    const stopListening = this.runtime.midi.subscribe((event) => {
      const atMs = event.timestampMs;
      if (atMs < earliest) {
        return;
      }
      if (event.type === 'noteon') {
        played.push({ kind: 'noteOn', atMs: atMs - beginsAtMs, midi: event.midi, velocity: event.velocity });
      } else if (event.type === 'noteoff') {
        played.push({ kind: 'noteOff', atMs: atMs - beginsAtMs, midi: event.midi });
      } else if (event.type === 'pedal') {
        played.push({ kind: 'sustain', atMs: atMs - beginsAtMs, value: event.value });
      }
      // Seen as it is played, not a tick later.
      if (event.type === 'noteon' || event.type === 'noteoff') {
        this.showWhatIsBeingRecorded();
      }
    });
    this.recording = { sketchId: sketch.id, fromMs, beginsAtMs, played, clicks, nextClick: 0, stopListening, begins: null, tick: null };
    const recording = this.recording;
    recording.begins = setTimeout(() => {
      recording.begins = null;
      this.goOnRecording();
    }, beginsAtMs - now);
    this.sayWhetherItRecords();
  }

  /**
   * The recording under way: what is written sounds from where the cursor
   * is now, as the cursor walks on, and the beat is handed over a little
   * ahead, as a playback's is. Started when the count-in ends, and then a
   * tick at a time.
   */
  private goOnRecording(): void {
    const recording = this.recording;
    const roll = this.theRoll();
    if (recording === null || roll === null) {
      return;
    }
    const now = this.runtime.clock.now();
    const atMs = recording.fromMs + Math.max(0, now - recording.beginsAtMs);
    const player = this.runtime.takePlayer;
    if (recording.tick === null) {
      if (roll.presses.length > 0) {
        player.setSpeed(1);
        player.play(RUN_ROLL_ID, rollAsEvents(roll), atMs);
      }
      recording.tick = setInterval(() => this.goOnRecording(), TAKE_TICK_MS);
    } else if (player.playing === RUN_ROLL_ID) {
      player.pump();
      // Past what was written, the cursor goes on by itself.
      if (player.finished) {
        player.stop();
      }
    }
    if (this.el.rollClick.checked) {
      for (let next = recording.clicks[recording.nextClick]; next !== undefined && next.atMs <= now + ROLL_CLICK_LEAD_MS; ) {
        this.runtime.metronomeClick.click(next.atMs, next.weight);
        recording.nextClick += 1;
        next = recording.clicks[recording.nextClick];
      }
    }
    this.rollAtMs = atMs;
    this.describeTheRoll();
    this.showWhatIsBeingRecorded();
  }

  /**
   * Paints the notes the recording under way comes to where they go, a key
   * still down as far as now, so the playing is seen as it is played - and
   * as it will be written in, by the same answer; nothing while none is
   * under way. It is written in only once the recording stops.
   */
  private showWhatIsBeingRecorded(): void {
    const recording = this.recording;
    const scene = this.drawnScene;
    const showing = this.theOtherRollShowing;
    const stored = recording === null ? null : this.runtime.sketches.find(recording.sketchId);
    const now = this.runtime.clock.now() - (recording?.beginsAtMs ?? 0);
    this.notesBeingRecorded =
      recording === null || scene === null || showing === null || stored === null
        ? []
        : theNotesRecorded(stored.events, recording.played, recording.fromMs + rollBeganAtMs(showing.roll), now).map((note) => ({
            row: scene.highest - note.midi,
            fromMs: recording.fromMs + note.afterMs,
            untilMs: recording.fromMs + note.afterMs + note.lengthMs,
          }));
    this.paintTheRoll();
  }

  /**
   * Stops recording and writes in what was played, from where it went in,
   * over what is there: one change, put back as one, the keys of it chosen.
   * Stopped during the count-in, nothing was recorded. The cursor stays
   * where the recording stopped, and the marker where it began.
   */
  private writeInWhatWasRecorded(): void {
    const recording = this.recording;
    if (recording === null) {
      return;
    }
    this.recording = null;
    this.showWhatIsBeingRecorded();
    recording.stopListening();
    if (recording.begins !== null) {
      clearTimeout(recording.begins);
    }
    if (recording.tick !== null) {
      clearInterval(recording.tick);
    }
    this.runtime.metronomeClick.takeBackTheClicks();
    if (this.runtime.takePlayer.playing === RUN_ROLL_ID) {
      this.runtime.takePlayer.stop();
    }
    const stoppedAtMs = this.runtime.clock.now() - recording.beginsAtMs;
    const showing = this.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = this.runtime.sketches.find(recording.sketchId);
    this.sayWhetherItRecords();
    if (stoppedAtMs < 0 || showing === null || sketch === undefined || sketch.id !== recording.sketchId || stored === null) {
      this.describeTheRoll();
      return;
    }
    const origin = rollBeganAtMs(showing.roll);
    const { events, pasted } = takeWithThePlayingRecorded(stored.events, recording.played, recording.fromMs + origin, stoppedAtMs);
    this.rollPlacedAtMs = recording.fromMs;
    this.rollAtMs = recording.fromMs + stoppedAtMs;
    if (events !== stored.events) {
      this.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)], pasted);
    }
    this.describeTheRoll();
  }

  /** The record button pressed while it records - counting in or under way - and saying what a press would do. */
  private sayWhetherItRecords(): void {
    const recording = this.recording !== null;
    const bars = this.runtime.controller.settings.countInBars;
    this.el.rollRecord.setAttribute('aria-pressed', String(recording));
    this.el.rollRecord.title = recording
      ? 'Stop recording, and write in what was played'
      : bars > 0
        ? `Record into the sketch from the cursor, after ${String(bars)} ${bars === 1 ? 'bar' : 'bars'} counted in`
        : 'Record into the sketch from the cursor';
    this.el.rollRecord.setAttribute('aria-label', this.el.rollRecord.title);
  }

  /** Which drawing is shown, as a slice laid on it is kept by: a sketch, a recording, or whatever else by what it is. */
  private theDrawingsName(): string {
    const showing = this.theOtherRollShowing;
    if (showing === null) {
      return 'the run just played';
    }
    return showing.sketch?.id ?? showing.recording ?? `${showing.what} ${showing.why}`;
  }

  /**
   * The slice laid on the drawing shown, or none. On a drawing of the music
   * on the page it is the passage chosen there: one answer to which bars are
   * being worked on, laid on the page or in the drawing alike. On any other,
   * the drawing's own.
   */
  private theSliceShown(): { readonly fromMs: number; readonly toMs: number } | null {
    if (this.theDrawingIsOfThePage()) {
      return this.thePassageInTheDrawing();
    }
    const slice = this.rollSlice;
    return slice !== null && slice.of === this.theDrawingsName() ? slice : null;
  }

  /** Whether the drawing shown is of the music on the page: see `theBarOnThePageAt`. */
  private theDrawingIsOfThePage(): boolean {
    const showing = this.theOtherRollShowing;
    return showing === null || showing.ofTheOpenScore || this.theSketchShownOnThePage() !== null;
  }

  /**
   * The passage chosen on the page, where it stands in the drawing shown:
   * from the line its first bar begins on to the one after its last, or to
   * the drawing's end where that bar is its last. None where there is no
   * passage, or the drawing has none of it.
   */
  private thePassageInTheDrawing(): { readonly fromMs: number; readonly toMs: number } | null {
    const controller = this.runtime.controller;
    const roll = this.theRoll();
    const { rangeFromBar, rangeToBar } = controller.settings;
    if (roll === null || (rangeFromBar === null && rangeToBar === null)) {
      return null;
    }
    const { firstBar, lastBar } = controller.pieceBarRange;
    const fromMs = this.theMomentOfTheBarOnThePage((rangeFromBar ?? firstBar) - 1);
    const toMs = this.theMomentOfTheBarOnThePage(rangeToBar ?? lastBar) ?? rollEndedAtMs(roll) - rollBeganAtMs(roll);
    return fromMs === null || toMs <= fromMs ? null : { fromMs, toMs };
  }

  /** The slice a playback from a moment goes round: the one it is inside, or none - from anywhere else it plays on as it always has. */
  private theSliceGoneRoundFrom(atMs: number): { readonly fromMs: number; readonly toMs: number } | null {
    const slice = this.theSliceShown();
    return slice !== null && atMs >= slice.fromMs - SLICE_EDGE_MS && atMs < slice.toMs - SLICE_EDGE_MS ? slice : null;
  }

  /**
   * Lays a slice on the drawing shown, or takes it away; a playback going
   * on goes round it from now on where it is inside it, and its clicks are
   * counted again from where it is.
   */
  private sliceTheDrawing(slice: { readonly fromMs: number; readonly toMs: number } | null): void {
    if (this.theDrawingIsOfThePage()) {
      // The passage, in the bars it takes in: the page and its markers say so at once.
      const controller = this.runtime.controller;
      const from = slice === null ? null : this.theBarOnThePageAt(slice.fromMs + SLICE_EDGE_MS);
      const to = slice === null ? null : this.theBarOnThePageAt(slice.toMs - SLICE_EDGE_MS);
      if (slice === null) {
        controller.updateSettings({ rangeFromBar: null, rangeToBar: null });
      } else if (from !== null && to !== null) {
        controller.choosePassage(from + 1, to + 1);
      }
      this.syncControlsFromSettings();
      this.sayWhatWouldBePractised();
    } else {
      this.rollSlice = slice === null ? null : { of: this.theDrawingsName(), fromMs: slice.fromMs, toMs: slice.toMs };
    }
    this.followTheSlice();
  }

  /**
   * Shows the slice where it now is, and has a playback going on go round
   * it from now on where it is inside it, its clicks counted again from
   * where it is.
   */
  private followTheSlice(): void {
    this.showTheSlice();
    const player = this.runtime.takePlayer;
    const roll = this.theRoll();
    if (player.playing === RUN_ROLL_ID && roll !== null) {
      player.setLoop(this.theSliceGoneRoundFrom(player.positionMs));
      this.takeBackTheRollsClicks();
      this.clicksHandedOver(clicksBefore(roll, player.positionMs, this.theRollsGrid()));
      this.clickAheadOfTheRoll();
    }
  }

  /** Places the band over the ruler where the slice is, or hides it. */
  private showTheSlice(): void {
    const band = this.rollHeads?.slice;
    const slice = this.theSliceShown();
    if (band === undefined) {
      return;
    }
    band.hidden = slice === null;
    if (slice !== null) {
      band.style.setProperty('--roll-at', (slice.fromMs / 1000).toFixed(3));
      band.style.setProperty('--roll-span', ((slice.toMs - slice.fromMs) / 1000).toFixed(3));
    }
  }

  /**
   * Which end of the slice a point on the ruler is on: within a grip of it,
   * inside or just outside it - a third of a slice too narrow for that - or
   * neither.
   */
  private theGripOnTheSlice(clientX: number): 'start' | 'end' | null {
    const slice = this.theSliceShown();
    const at = this.theMomentUnder(clientX);
    if (slice === null || at === null) {
      return null;
    }
    const pxPerMs = Number(this.el.rollZoom.value) / 1000;
    const reachMs = GRIP_PX / pxPerMs;
    if (at < slice.fromMs - reachMs || at > slice.toMs + reachMs) {
      return null;
    }
    const grip = theGripOfAStretch(slice.fromMs, slice.toMs, at, pxPerMs);
    return grip === 'whole' ? null : grip;
  }

  /**
   * Takes hold of an end of the slice where a pointer goes down on the
   * ruler by it, to take it to another bar line, the other end staying
   * where it is. Says whether it did.
   */
  private takeHoldOfAnEndOfTheSlice(event: PointerEvent): boolean {
    const grip = this.theGripOnTheSlice(event.clientX);
    const slice = this.theSliceShown();
    if (grip === null || slice === null) {
      return false;
    }
    this.sliceEndHeld = { pointerId: event.pointerId, otherMs: grip === 'start' ? slice.toMs : slice.fromMs };
    return true;
  }

  /**
   * Takes the end of the slice held to the bar line nearest the pointer, or
   * the drawing's end, as a note's end goes to the beat nearest: past the
   * other end, it is the other end, and on it, the slice keeps a bar. Says
   * whether the move was its.
   */
  private dragAnEndOfTheSlice(event: PointerEvent): boolean {
    const held = this.sliceEndHeld;
    if (held === null || held.pointerId !== event.pointerId) {
      return false;
    }
    const roll = this.theRoll();
    const at = this.theMomentUnder(event.clientX);
    if (roll !== null && at !== null) {
      const began = rollBeganAtMs(roll);
      const lines = [...theMusicsBeats(roll, BAR_LINES_ONLY).map((line) => line.atMs - began), rollEndedAtMs(roll) - began];
      const nearest = lines.reduce((best, line) => (Math.abs(line - at) < Math.abs(best - at) ? line : best));
      const slice = { fromMs: Math.min(held.otherMs, nearest), toMs: Math.max(held.otherMs, nearest) };
      const shown = this.theSliceShown();
      if (slice.toMs > slice.fromMs && (shown === null || shown.fromMs !== slice.fromMs || shown.toMs !== slice.toMs)) {
        this.sliceTheDrawing(slice);
      }
    }
    return true;
  }

  /** Lets go of the end of the slice held; says whether it was one, whose click is then let pass. */
  private letGoOfAnEndOfTheSlice(event: PointerEvent): boolean {
    if (this.sliceEndHeld?.pointerId !== event.pointerId) {
      return false;
    }
    this.sliceEndHeld = null;
    this.sliceLaidByThePress = true;
    return true;
  }

  /** Starts the clock on a press on the ruler, which held still long enough lays a slice. */
  private watchForASliceHold(event: PointerEvent): void {
    this.letGoOfTheSliceHold(null);
    const hold: NonNullable<AppView['sliceHold']> = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      timer: null,
      held: false,
      anchorMs: null,
    };
    this.sliceHold = hold;
    hold.timer = setTimeout(() => {
      hold.timer = null;
      this.holdTheRuler(hold);
    }, HOLD_MS);
  }

  /**
   * A press on the ruler held long enough: on the slice, takes it away;
   * anywhere else, lays one on the bar under it, whose far end the finger
   * then drags. The finger is the slice's from now on, not the drawing's.
   */
  private holdTheRuler(hold: NonNullable<AppView['sliceHold']>): void {
    const roll = this.theRoll();
    const at = this.theMomentUnder(hold.clientX);
    if (roll === null || at === null || this.sliceHold !== hold) {
      return;
    }
    hold.held = true;
    this.rollFingers.delete(hold.pointerId);
    this.rollPan = null;
    const shown = this.theSliceShown();
    if (shown !== null && at >= shown.fromMs && at < shown.toMs) {
      this.sliceTheDrawing(null);
      return;
    }
    hold.anchorMs = at;
    this.sliceTheDrawing(theBarsAcross(roll, at, at));
  }

  /**
   * Follows a press on the ruler: one that wanders before it is held is
   * a drag, and no slice; one held drags the slice's far end to the bar
   * under it. Says whether the move was the slice's.
   */
  private dragTheSlice(event: PointerEvent): boolean {
    const hold = this.sliceHold;
    if (hold === null || hold.pointerId !== event.pointerId) {
      return false;
    }
    if (!hold.held) {
      if (Math.hypot(event.clientX - hold.clientX, event.clientY - hold.clientY) > TAP_SLOP_PX) {
        this.letGoOfTheSliceHold(null);
      }
      return false;
    }
    const roll = this.theRoll();
    const at = this.theMomentUnder(event.clientX);
    if (hold.anchorMs !== null && roll !== null && at !== null) {
      const slice = theBarsAcross(roll, hold.anchorMs, at);
      const shown = this.theSliceShown();
      if (shown === null || shown.fromMs !== slice.fromMs || shown.toMs !== slice.toMs) {
        this.sliceTheDrawing(slice);
      }
    }
    return true;
  }

  /**
   * Lets go of a press on the ruler, or of any where none is named; says
   * whether it was one that was held, whose click is then let pass.
   */
  private letGoOfTheSliceHold(event: PointerEvent | null): boolean {
    const hold = this.sliceHold;
    if (hold === null || (event !== null && hold.pointerId !== event.pointerId)) {
      return false;
    }
    if (hold.timer !== null) {
      clearTimeout(hold.timer);
    }
    this.sliceHold = null;
    this.sliceLaidByThePress = hold.held;
    return hold.held;
  }

  /**
   * A click on the ruler with a key held, as an editor on a computer takes
   * one: with Ctrl or Cmd the slice begins at the bar clicked, with Alt it
   * ends with it - the other end kept where it still can be.
   */
  private sliceByAClick(event: MouseEvent): void {
    const roll = this.theRoll();
    const at = this.theMomentUnder(event.clientX);
    if (roll === null || at === null) {
      return;
    }
    const shown = this.theSliceShown();
    const fromHere = event.ctrlKey || event.metaKey;
    const other = fromHere
      ? shown !== null && shown.toMs > at + SLICE_EDGE_MS ? shown.toMs - SLICE_EDGE_MS : at
      : shown !== null && shown.fromMs < at ? shown.fromMs : at;
    this.sliceTheDrawing(theBarsAcross(roll, at, other));
  }

  /** Says which of the two the button would do, and dims it where neither has anywhere to go. */
  private sayWhereBackGoes(sounding: boolean): void {
    const back = sounding || this.rollAtMs !== this.rollPlacedAtMs;
    const icon = back ? REWIND_ICON : STOP_ICON;
    if (this.el.rollStopIcon.getAttribute('d') !== icon) {
      this.el.rollStopIcon.setAttribute('d', icon);
    }
    if (back) {
      delete this.el.rollStop.dataset['idle'];
      this.el.rollStop.title = 'Back to where the marker was put (Shift+Space)';
    } else if (this.rollPlacedAtMs !== 0) {
      delete this.el.rollStop.dataset['idle'];
      this.el.rollStop.title = 'Back to the beginning, and the marker with it';
    } else {
      this.el.rollStop.dataset['idle'] = 'true';
      this.el.rollStop.title = 'Back to the beginning. It is there already.';
    }
    this.el.rollStop.setAttribute('aria-label', this.el.rollStop.title);
  }

  private stopTheRoll(): void {
    this.writeInWhatWasRecorded();
    if (this.runtime.takePlayer.playing === RUN_ROLL_ID) {
      this.runtime.takePlayer.stop();
    }
    // Back to the beginning, which is what stopping means and pausing does not.
    this.rollAtMs = 0;
    this.rollPlacedAtMs = 0;
    this.clicksHandedOver(0);
    this.letTheRollTickGo();
    this.describeTheRoll();
  }

  private letTheRollTickGo(): void {
    this.takeBackTheRollsClicks();
    if (this.rollTick !== null) {
      clearInterval(this.rollTick);
      this.rollTick = null;
    }
  }

  /**
   * Takes back the clicks a playback has handed over and nobody has heard yet.
   *
   * They go out a little ahead of the head, as its notes do, and the notes are
   * taken back whenever the playback stops or moves - so these are too, or a
   * pause is followed by a click, and a jump by a click from where it was.
   *
   * Only while the drawing is being played: the metronome's one-off clicks are
   * also how the mode with no pulse places its beats.
   */
  private takeBackTheRollsClicks(): void {
    if (this.rollTick !== null) {
      this.runtime.metronomeClick.takeBackTheClicks();
    }
  }

  /**
   * Puts the head where the reader tapped, and the sound with it.
   *
   * The grid is the one thing in the sheet worth pointing at, and pointing at a
   * moment is how anybody looks at a recording. Every note is a real element
   * inside it, so a tap on a note is a tap at that note's moment and needs no
   * arithmetic of its own.
   *
   * The clicks behind the new place count as spent: handed over again they
   * would sound the first half of the run over the second.
   */
  private putTheHeadWhereItWasTapped(event: MouseEvent): void {
    const drawn = this.el.rollBody.firstElementChild;
    const grid = drawn?.querySelector<HTMLElement>('.roll__grid') ?? null;
    const roll = this.theRoll();
    if (grid === null || roll === null) {
      return;
    }
    // The grid stands still over the run, which is where the view says.
    const box = grid.getBoundingClientRect();
    const tapped = timeFromTap(
      event.clientX - box.left + this.rollScroller.x,
      Number(this.el.rollZoom.value),
    );
    if (tapped === null) {
      return;
    }
    // On the nearest beat rather than under the finger. A finger is worth about
    // a tenth of a second at any readable zoom, and nobody pointing at a run
    // means a moment between two beats - they mean the beat.
    // On the nearest beat unless the reader would rather point exactly.
    const at = this.el.rollSnap.checked
      ? theBeatNearest(roll, tapped, this.theRollsGrid())
      : tapped;
    this.putTheHeadAt(at);
  }

  /**
   * Puts the head at a moment of the run, sounding on from there if it was,
   * and marks it as the place a playback goes back to.
   */
  private putTheHeadAt(at: number): void {
    const roll = this.theRoll();
    if (roll === null) {
      return;
    }
    this.rollAtMs = at;
    this.rollPlacedAtMs = at;
    this.takeBackTheRollsClicks();
    this.clicksHandedOver(clicksBefore(roll, at, this.theRollsGrid()));
    if (this.runtime.takePlayer.playing === RUN_ROLL_ID) {
      this.runtime.takePlayer.seek(at);
      // Put inside the slice it goes round it; put outside, it plays on.
      this.runtime.takePlayer.setLoop(this.theSliceGoneRoundFrom(at));
      this.clickAheadOfTheRoll();
    }
    this.describeTheRoll();
  }

  private followTheRoll(): void {
    const player = this.runtime.takePlayer;
    // The sound before the drawing, as a take's own following does: a frame
    // late on screen is nothing, a frame late in the ear is a gap.
    player.pump();
    if (player.finished && player.playing === RUN_ROLL_ID) {
      // Run out: back to where the marker was put, as a playback stopped
      // there is. Where it last began - the place of the last pause - is
      // nothing the reader can see.
      this.goBackToTheMarker();
      return;
    }
    if (player.finished) {
      player.stop();
    }
    // Something else took the player over, and this is no longer following
    // anything.
    if (player.playing !== RUN_ROLL_ID) {
      this.holdTheRoll();
      return;
    }
    this.soundTheBeat(player.positionMs);
    this.describeTheRoll();
  }

  /**
   * Sounds the beat the run was measured against, where the reader wants it.
   *
   * The point of hearing a run back beside its own grid: the picture says how
   * far from the beat a note was, and this is the same fact put to the ear,
   * which is the sense that will be doing the work at the keyboard.
   *
   * Through the metronome's one-off click - the same one a mode without a pulse
   * places the beat with - because nothing here is running a pulse: these
   * moments were recorded, and what they need is sounding at a time, not a
   * tempo to be counted at.
   */
  /**
   * Hands the metronome at once the clicks a playback of the drawing has due
   * from where it now is, as the player hands over its notes the moment it
   * starts or moves. Left to the next tick, a tick later, a beat at the very
   * start was placed that far behind the sound and heard late, while every
   * beat after it went out ahead in time.
   */
  private clickAheadOfTheRoll(): void {
    const player = this.runtime.takePlayer;
    if (player.playing === RUN_ROLL_ID) {
      this.soundTheBeat(player.positionMs);
    }
  }

  private soundTheBeat(positionMs: number): void {
    const roll = this.theRoll();
    if (roll === null) {
      return;
    }
    const player = this.runtime.takePlayer;
    const round = player.playing === RUN_ROLL_ID ? player.goingRound : null;
    if (round === null) {
      this.rollClicksSent = this.clickTheRunsBeats(roll, this.rollClicksSent, positionMs);
      return;
    }
    // Round a slice, each lap clicks its own bars, none past its end; and
    // the first clicks of the next lap go over ahead, as its notes do, or its
    // first beat would be a tick late.
    const grid = this.theRollsGrid();
    const first = clicksBefore(roll, round.fromMs, grid);
    if (player.lap !== this.rollLapClicked) {
      this.rollClicksSent = first + this.rollClicksOfTheNextLap;
      this.rollClicksOfTheNextLap = 0;
      this.rollLapClicked = player.lap;
    }
    this.rollClicksSent = this.clickTheRunsBeats(roll, this.rollClicksSent, positionMs, round.toMs);
    if (positionMs + ROLL_CLICK_LEAD_MS >= round.toMs) {
      // The next lap's beats, a lap's length later than they fall in the run.
      const later = positionMs - (round.toMs - round.fromMs);
      this.rollClicksOfTheNextLap =
        this.clickTheRunsBeats(roll, first + this.rollClicksOfTheNextLap, later, round.toMs) - first;
    }
  }

  /** Counts afresh the clicks handed over, from a place the head was put or began at. */
  private clicksHandedOver(sent: number): void {
    this.rollClicksSent = sent;
    this.rollLapClicked = 0;
    this.rollClicksOfTheNextLap = 0;
  }

  /**
   * Hands the metronome the run's clicks due by a moment of it, and says how
   * many of them have been handed over now.
   *
   * Asked by both ways a run is heard back - its picture and the notes - on the
   * one setting that says whether a run is heard back with its beat.
   */
  private clickTheRunsBeats(roll: RunRoll, sent: number, positionMs: number, beforeMs = Number.POSITIVE_INFINITY): number {
    if (!this.el.rollClick.checked) {
      return sent;
    }
    // The window is a tenth of a second of the *run's* time, which at a slow
    // speed reaches further ahead in the room than that. Harmless, and left
    // alone deliberately: the metronome takes back whatever has not sounded
    // when the reader stops, so placing a click early costs nothing, and a
    // second conversion here would be a rule with no consequence to test.
    const rate = this.runtime.takePlayer.speed;
    // Short of the end of a slice going round: the beat on its last bar line
    // is the next lap's first, a lap later.
    const due = clicksUpTo(
      roll,
      sent,
      Math.min(positionMs + ROLL_CLICK_LEAD_MS, beforeMs - SLICE_EDGE_MS),
      this.theRollsGrid(),
    );
    const now = this.runtime.clock.now();
    const began = rollBeganAtMs(roll);
    for (const beat of due) {
      // Where it falls relative to the sound that is already going, not where
      // it fell in the run: the two clocks share nothing but a duration.
      this.runtime.metronomeClick.click(
        now + (beat.atMs - began - positionMs) / rate,
        beat.weight,
      );
    }
    return sent + due.length;
  }

  /**
   * Lights the rows of the keys sounding now - held down on any input, or
   * struck by the drawing's own playback where the head is - across the
   * drawing, on its keys and down the map beside it. Only when they change:
   * it is asked on every frame of a playback.
   */
  private lightTheSoundingRows(): void {
    const scene = this.drawnScene;
    const rows = new Set<number>();
    if (scene !== null && !this.el.sheetRoll.hidden) {
      const held = this.keyHeldOnTheStrip === null ? [] : [this.keyHeldOnTheStrip.midi];
      for (const midi of [...this.runtime.recorder.keysDown, ...held]) {
        const row = scene.highest - midi;
        if (row >= 0 && row < scene.rows) {
          rows.add(row);
        }
      }
      if (this.runtime.takePlayer.playing === RUN_ROLL_ID) {
        const at = this.headIsAtMs();
        for (const note of stretchesIn(scene.notes, at, at)) {
          if (note.untilMs > at) {
            rows.add(note.row);
          }
        }
      }
    }
    const sounding = [...rows].sort((above, below) => above - below);
    const said = sounding.join();
    if (said === this.soundingRowsSaid) {
      return;
    }
    this.soundingRowsSaid = said;
    this.soundingRows = sounding;
    this.rollKeysStrip?.querySelectorAll<HTMLElement>('.roll__key').forEach((key, row) => {
      if (rows.has(row)) {
        key.dataset['sounding'] = 'true';
      } else {
        delete key.dataset['sounding'];
      }
    });
    this.paintTheRoll();
    this.markThePitchesIn(this.pitchWindow);
  }

  /**
   * Puts the head where the sound is, and keeps it on screen.
   *
   * Scrolled only when it has left the middle of the view rather than on every
   * frame: a grid that re-centres continuously is unreadable, and on a long
   * piece a head that never scrolls is a performance watched off-screen.
   */
  private describeTheRoll(): void {
    const player = this.runtime.takePlayer;
    const sounding = player.playing === RUN_ROLL_ID;
    // Only when it turns over: the same icon set again is a new drawing to the page.
    const icon = sounding ? PAUSE_ICON : PLAY_ICON;
    if (this.el.rollPlayIcon.getAttribute('d') !== icon) {
      this.el.rollPlayIcon.setAttribute('d', icon);
      const label = `${sounding ? 'Pause' : 'Play'} (Space)`;
      this.el.rollPlay.title = label;
      this.el.rollPlay.setAttribute('aria-label', label);
    }
    this.sayWhereBackGoes(sounding);
    this.followTheKeyWhereTheHeadGoes();

    const drawn = this.el.rollBody.firstElementChild;
    if (!(drawn instanceof HTMLElement)) {
      return;
    }
    drawn.classList.toggle('roll--sounding', sounding);
    const heads = this.rollHeads;
    if (heads === null) {
      return;
    }
    // The head is a place, not a sign that something is playing: it stands
    // where the reader put it or where the sound stopped, and it is there from
    // the moment the drawing opens. His: "чи можливо мати курсор завжди? Бо він
    // наразі пропадає як тільки робиться stop".
    //
    // Written on the two marks and not on the drawing, which every note in it
    // would inherit: see `.roll__head` in the stylesheet.
    const at = (this.headIsAtMs() / 1000).toFixed(3);
    heads.line.style.setProperty('--roll-at', at);
    heads.mark.style.setProperty('--roll-at', at);
    heads.place.style.setProperty('--roll-at', (this.rollPlacedAtMs / 1000).toFixed(3));
    this.sayWhereTheHeadIs();
    this.lightTheSoundingRows();
    if (!sounding) {
      return;
    }
    // Where the head is in the drawing is arithmetic: the moment, at the zoom.
    const headPx = (this.headIsAtMs() / 1000) * Number(this.el.rollZoom.value);
    const scrolled = this.rollScroller;
    const to = this.theMusicRunsPastTheHead()
      ? theRunScrolledUnderTheHead(
          headPx,
          scrolled.viewWidePx,
          this.runtime.controller.settings.rollHeadAtPercent / 100,
        )
      : keepTheHeadInView(headPx, scrolled.x, scrolled.viewWidePx);
    if (to !== null && scrolled.to(to, scrolled.y)) {
      this.askWhereTheViewIs();
    }
  }

  /** Whether the picture is the one that moves while the cursor stands still. */
  private theMusicRunsPastTheHead(): boolean {
    return this.runtime.controller.settings.rollScrollPlayback;
  }

  /**
   * Says where the standing cursor stands, and whether it stands at all.
   *
   * From one place because two controls change the answer: the slider, and
   * the box without which the cursor walks and the slider means nothing.
   */
  private sayWhereTheHeadStands(): void {
    const settings = this.runtime.controller.settings;
    this.el.rollHeadAt.value = String(settings.rollHeadAtPercent);
    this.el.rollHeadAtValue.value = this.el.rollHeadAt.value;
    this.el.rollHeadAt.disabled = !settings.rollScrollPlayback;
  }

  /**
   * The gap between two fingers, or `null` unless there are exactly two.
   *
   * Exactly two: a third finger on the drawing is not a wider pinch, it is a
   * hand resting, and taking a gap from whichever two arrived first would zoom
   * on a gesture nobody made.
   */
  private theFingerSpan(): FingerSpan | null {
    if (this.rollFingers.size !== 2) {
      return null;
    }
    const [first, second] = [...this.rollFingers.values()];
    if (first === undefined || second === undefined) {
      return null;
    }
    return {
      acrossPx: Math.abs(first.x - second.x),
      downPx: Math.abs(first.y - second.y),
    };
  }

  /**
   * Counts a finger going down on the drawing in.
   *
   * A second finger is a pinch, whatever the first was doing: what it held -
   * a note, the pedal, a box - is let go of as it was, and it becomes one of
   * the two fingers of the pinch, from where it is now. Without that the
   * first finger kept its gesture and the second only moved the drawing, so
   * a pinch begun on a note, or with the selection tool, never zoomed.
   *
   * The first finger of a touch is the only one down - as the mouse or a pen
   * always is - so any other still counted was lifted where the drawing never
   * heard it, and is forgotten with what it held: kept, it would make every
   * later finger the second of a pinch, or leave a note held that no other
   * finger could then take hold of.
   */
  private countTheFingerIn(event: PointerEvent): void {
    for (const [pointerId, at] of this.fingersOnTheDrawing) {
      this.letGoOfWhatTheFingerHeld(pointerId, event);
      if (event.isPrimary) {
        this.rollFingers.delete(pointerId);
      } else {
        this.rollFingers.set(pointerId, at);
      }
    }
    if (event.isPrimary) {
      this.fingersOnTheDrawing.clear();
    }
    this.fingersOnTheDrawing.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  /** Lets go, as it was, of what a finger held on the drawing: a note, the pedal, a box or a key of the strip. */
  private letGoOfWhatTheFingerHeld(pointerId: number, event: PointerEvent): void {
    if (this.keyHeldOnTheStrip?.pointerId === pointerId) {
      this.letGoOfTheKeyOnTheStrip();
    } else if (this.rollDrag?.pointerId === pointerId) {
      this.letGoOfTheHeldKey(null);
    } else if (this.rollPedalDrag?.pointerId === pointerId) {
      this.letGoOfThePedal(event, false);
    } else if (this.rollBoxDrawn?.pointerId === pointerId) {
      this.chooseWhatTheBoxHolds(event, false);
    }
  }

  /** Remembers where a pinch started from, or forgets there is one. */
  private beginAPinch(): void {
    const span = this.theFingerSpan();
    this.pinchedFrom =
      span === null
        ? null
        : { ...span, zoom: Number(this.el.rollZoom.value), row: this.theRowAsDrawn() };
  }

  /**
   * How tall a row stands on the screen, which is not always what was asked.
   *
   * The stylesheet never lets the rows fall short of the room they have, so
   * after a pinch down past that the row asked for is smaller than the one
   * drawn. Scaled from the one asked for, the next pinch up would move nothing
   * until it had made up the difference; the fingers are stretching what they
   * can see.
   */
  private theRowAsDrawn(): number {
    const key = this.el.rollBody.querySelector<HTMLElement>('.roll__key');
    const drawnPx = key?.getBoundingClientRect().height ?? 0;
    return drawnPx > 0 ? drawnPx : this.rollRowPx;
  }

  /**
   * Zooms the drawing by how much wider the fingers have got.
   *
   * The slider is moved with it rather than left behind: it is the same
   * question, and two controls disagreeing about the answer is the fault this
   * interface keeps removing. His: "zoom слайдер маленький, та не дуже зручно
   * їм користуватись".
   *
   * And down the page as well, which has no slider: "зробити vertical pinch щоб
   * все зробити менше по висоті". A run of a wide part is sixty rows of pitch,
   * and at thirteen pixels each that is most of a tall screen before a note is
   * drawn.
   */
  private pinchTheRoll(): void {
    const from = this.pinchedFrom;
    const now = this.theFingerSpan();
    if (from === null || now === null) {
      return;
    }
    this.pinched = true;
    const asked = pinchedTo(from, now);
    const was = Number(this.el.rollZoom.value);
    const middle = this.theMiddleOfTheFingers();
    const held = asked.row === this.rollRowPx ? null : this.theRowsHeldAt(middle.y);
    this.el.rollZoom.value = String(asked.zoom);
    this.rollRowPx = asked.row;
    // Held around the point between the fingers, for the same reason the wheel
    // is held around the pointer: a pinch aimed at a bar means that bar, and
    // one aimed at a pitch that pitch.
    if (asked.zoom !== was) {
      this.holdTheZoomAround(middle.x, was, asked.zoom);
    } else {
      this.applyTheZoom();
    }
    if (held !== null) {
      this.holdTheRows(held);
    }
  }

  /** Where the point between two fingers is on the screen. */
  private theMiddleOfTheFingers(): { readonly x: number; readonly y: number } {
    const [first, second] = [...this.rollFingers.values()];
    return {
      x: ((first?.x ?? 0) + (second?.x ?? first?.x ?? 0)) / 2,
      y: ((first?.y ?? 0) + (second?.y ?? first?.y ?? 0)) / 2,
    };
  }

  /** How fast the reader has asked to hear the run, as a multiple of its own time. */
  private theRollsSpeed(): number {
    const percent = Number(this.el.rollSpeed.value);
    return Number.isFinite(percent) && percent > 0 ? percent / 100 : 1;
  }

  private applyTheZoom(): void {
    const roll = this.el.rollBody.firstElementChild;
    if (roll instanceof HTMLElement) {
      const second = `${this.el.rollZoom.value}px`;
      // Only where it places something: see `--roll-second` in the stylesheet.
      this.rollHeads?.line.style.setProperty('--roll-second', second);
      this.rollHeads?.mark.style.setProperty('--roll-second', second);
      this.rollHeads?.place.style.setProperty('--roll-second', second);
      this.rollHeads?.marks.style.setProperty('--roll-second', second);
      roll.style.setProperty('--roll-row-asked', `${this.rollRowPx}px`);
    }
    // How long and how tall the run now is follow from the zoom, so the
    // scroller is told at once - a place set next is kept inside the new size,
    // not the old. Rows shorter than the room, which the stylesheet stretches
    // to fill it, leave nowhere to scroll to either way.
    const scene = this.drawnScene;
    const scrolled = this.rollScroller;
    if (scene !== null) {
      scrolled.size(
        { widePx: scrolled.viewWidePx, tallPx: scrolled.viewTallPx },
        {
          widePx: (scene.lengthMs / 1000) * Number(this.el.rollZoom.value),
          tallPx: scene.rows * this.rollRowPx,
        },
      );
    }
    this.askWhereTheViewIs();
  }

  /**
   * The run as a strip, one cell per bar, above the numbers that explain it.
   *
   * Drawn rather than written, and drawn first: a reader who has just played
   * badly is not going to read a table, and this is the one part of the
   * report that says where to look next.
   */
  /**
   * The shape of the reading, and the numbers behind it.
   *
   * Both, and not one: a shape says which way a reading leans - what it is good
   * at and what it is not - and never what it actually was. Read alone it is a
   * picture with no scale on it.
   */
  private drawTheProfileOf(report: PerformanceReport): void {
    const axes = theProfile(
      report,
      (this.runtime.controller.lastRoll?.presses ?? []).map((press) => press.velocity),
      this.theRunKeptTime(),
      this.runtime.controller.whereTheJudgedEntriesFall(report),
    );
    if (axes.length < 3) {
      return;
    }
    const figure = this.doc.createElement('div');
    figure.className = 'profile-figure';
    figure.id = 'run-profile';
    figure.append(drawTheProfile(axes));
    const said = this.doc.createElement('dl');
    said.className = 'profile-figure__said';
    for (const axis of axes) {
      const name = this.doc.createElement('dt');
      name.textContent = axis.name;
      const value = this.doc.createElement('dd');
      value.textContent = axis.said;
      said.append(name, value);
    }
    figure.append(said);
    this.el.result.append(figure);
  }

  /**
   * Draws where the presses of a run landed against the beat.
   *
   * Only where a machine kept it. Where the music waits, a "deviation" is how
   * long the reader took to arrive and not how far off they were - the same
   * confusion that emptied two axes of the shape beside this one - and a row of
   * arrival times placed against a tolerance would draw a patient reading as a
   * wild one, every mark pinned against the late edge.
   *
   * Drawn after the run rather than during it, which is the one thing about
   * this that is not osu!'s answer. There the bar is live because the beatmap
   * is the whole of what the player is looking at; here the page of music is,
   * and a strip that twitches under it is an eye taken off the notes - which is
   * the work the exercise exists for.
   */
  private drawTheHitErrorsOf(report: PerformanceReport): void {
    if (!this.theRunKeptTime()) {
      return;
    }
    const errors = theHitErrors(
      report.timing.deviations,
      this.runtime.controller.settings.matchToleranceMs,
      { tiers: report.timing.tiers, perfectMs: report.timing.perfectMs },
    );
    if (errors === null) {
      return;
    }
    const drawn = drawTheHitErrors(errors);
    drawn.id = 'run-hits';
    this.el.result.append(drawn);
  }

  /**
   * Where each judged entry falls in *written* time, in milliseconds.
   *
   * What the shape needs to tell a reader holding a steady tempo from one whose
   * hand keeps stopping: a piece is not made of one value, so the gaps between
   * their entries are supposed to differ. In the same order and under the same
   * filter as the report's own deviations, since the two are read as a pair.
   */
  private drawTheBars(report: PerformanceReport): void {
    const exercise = this.runtime.controller.currentExercise;
    const bars =
      exercise === null
        ? new Set(report.steps.map((step) => step.measureIndex)).size
        : exercise.staves[0]?.measures.length ?? 0;
    const cells = barCells(report, bars);
    if (cells.length < 2) {
      // One bar is not a shape, and nothing can be seen in it.
      return;
    }
    const strip = this.doc.createElement('div');
    strip.className = 'run-strip';
    strip.id = 'run-strip';
    for (const cell of cells) {
      const box = this.doc.createElement('span');
      box.className = 'run-strip__bar';
      box.dataset['state'] = cell.state;
      box.dataset['waited'] = String(cell.waited);
      box.title = cell.label;
      strip.append(box);
    }
    this.el.result.prepend(strip);
  }

  private listen<K extends keyof HTMLElementEventMap>(
    element: HTMLElement | Document,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void {
    element.addEventListener(type, handler as EventListener);
    this.subscriptions.push(() => {
      element.removeEventListener(type, handler as EventListener);
    });
  }
}

import type { AppRuntime } from '../composition/createApp.js';
import { FLOW_MODE_ID } from '../application/modes/FlowMode.js';
import { LISTEN_MODE_ID } from '../application/modes/ListenFrame.js';
import { BAR_MODE_ID } from '../application/modes/BarMode.js';
import { WAIT_MODE_ID } from '../application/modes/WaitMode.js';
import type { PracticeSession } from '../application/session/PracticeSession.js';
import type { SessionStatus } from '../application/session/SessionState.js';
import type { PositionEvent } from '../application/session/SessionEvents.js';
import type { MidiConnectionStatus, MidiEvent } from '../application/ports/IMidiSource.js';
import {
  CLICK_WHEN,
  CLICK_PATTERNS,
  dropoutCycleBars,
  type ClickWhen,
  type ClickPattern,
} from '../application/ports/IMetronome.js';
import type { SessionScore } from '../domain/scoring/IScoringStrategy.js';
import {
  SAMPLE_LOADING_MODES,
  type SampleLoading,
} from '../application/ports/IPitchPlayer.js';
import type { PerformanceReport } from '../domain/scoring/PerformanceReport.js';
import { COMMON_KEYS, KeySignature } from '../domain/model/KeySignature.js';
import { TimeSignature } from '../domain/model/TimeSignature.js';
import { midiToLabel } from '../domain/model/Pitch.js';
import { writeMidiFile } from '../domain/midi/MidiFile.js';
import { worstPassage } from '../domain/scoring/troubleSpots.js';
import { TEMPO_STEP_PERCENT } from '../application/PracticeController.js';
import type { PracticeSettings } from '../application/PracticeController.js';
import {
  RULER_DIVISIONS,
  type RulerDivision,
  type RulerMark,
} from '../application/rhythmRuler.js';
import { WHAT_OPENS, type WhatOpens } from '../application/ScoreLibrary.js';
import { PAGE_TURNS, type PageTurns } from '../application/ports/IScoreRenderer.js';
import { KEYBOARD_SIZES, keysOf, type KeyboardSize } from '../domain/generation/keyboards.js';
import type { SavedPassage } from '../application/ports/IScoreStore.js';
import {
  CLICK_SILENCES,
  COUNT_IN_WHEN,
  type ClickSilence,
  type CountInWhen,
} from '../application/ports/IMetronome.js';
import { TimeToday } from '../application/TimeToday.js';
import { PLAYED_NOTE_DISPLAYS, type PlayedNoteDisplay } from '../application/PracticeController.js';
import type { PassageHistory } from '../application/PracticeHistory.js';
import type { DrawnPassage, PassageEnd, ScorePageState } from '../application/ports/IScoreRenderer.js';
import { barLines, barNumberOf, measureCount } from '../domain/model/Exercise.js';
import { expectedFor } from '../domain/timeline/Timeline.js';
import {
  clicksBefore,
  clicksUpTo,
  rollAsEvents,
  rollBeganAtMs,
  rollOfTheTake,
  takeOfTheRun,
  type RunRoll,
  theBeatNearest,
  theMusicsPlaceAt,
  type GridChoice,
} from '../application/session/RunRoll.js';
import {
  drawTheMap,
  drawTheRoll,
  scrollAfterZoom,
  shareOfTheRun,
  zoomAfterWheel,
  LEAST_ZOOM,
  MOST_ZOOM,
  keepTheHeadInView,
  scrollForTheWindowAt,
  theWindowOnTheRun,
  pinchedTo,
  timeFromTap,
  type FingerSpan,
  type PinchedFrom,
  type RollGhost,
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
 * What the player is asked to call the run it is sounding.
 *
 * A roll is not a take and has no id of its own, but the player is addressed by
 * one - and this is also what lets everything else tell whether the thing
 * sounding is the drawing's or the shelf's.
 */
const RUN_ROLL_ID = 'the run just played';
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

const SCORING_DESCRIPTIONS: Readonly<Record<string, string>> = {
  'scoring.accuracy': 'The notes alone. You set the pace, so timing is not judged.',
  'scoring.timing-weighted': 'The notes, and how close each press was to its beat.',
  'scoring.continuity':
    'How far you got without the music leaving you behind. A fluffed note costs ' +
    'little; stopping costs everything. Says nothing in Wait mode, where nothing ' +
    'moves without you.',
};

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
 * What a mode square is, said once.
 *
 * Each is a setting that already exists, read and written through this rather
 * than duplicated by it: there is one answer to "am I playing survival", and
 * the square is another way of asking it. `blind` is the veil drawn over the
 * step under the reader's fingers, which is what makes it blind - the note is
 * gone by the time they reach it, so it has to have been read already.
 */
function modeIsOn(mode: string, settings: PracticeSettings): boolean {
  switch (mode) {
    case 'survival':
      return settings.survival;
    case 'blind':
      return settings.readAheadSteps !== null && settings.readAheadSteps >= 1;
    case 'rhythm':
      return settings.rhythmOnly;
    case 'strict':
      return settings.stopAtAMistake;
    // Read the other way round, because the square is the challenge and the
    // setting is the comfort: on means the marker is gone and the reader is
    // keeping the place themselves.
    case 'cursor':
      return !settings.cursorWhileRunning;
    default:
      return false;
  }
}

/** The settings a square writes when it is turned on or off. */
function settingsForMode(mode: string, on: boolean): Partial<PracticeSettings> {
  switch (mode) {
    case 'survival':
      return { survival: on };
    case 'blind':
      return { readAheadSteps: on ? 1 : null };
    // Each of these empties the other, so each turns the other off - "one
    // wrong note ends the run" and "any note counts" cannot both be the
    // answer. His: both squares answer, rather than one of them refusing.
    // Turning either *off* leaves the other alone: it was already off.
    case 'rhythm':
      return on ? { rhythmOnly: true, stopAtAMistake: false } : { rhythmOnly: false };
    case 'strict':
      return on ? { stopAtAMistake: true, rhythmOnly: false } : { stopAtAMistake: false };
    case 'cursor':
      return { cursorWhileRunning: !on };
    default:
      return {};
  }
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
 * The frames in the order the one button walks through them.
 *
 * His, and it is a ladder: hardest first and easiest last. Flow gives no help
 * at all, the bar line gives one place a bar to be found again, waiting gives
 * one at every note, and listening asks for nothing. Starting from the resting
 * frame is what makes the ring read as a list - the first press is always
 * "leave the default", and the reader is never counting from somewhere
 * arbitrary.
 */
const FRAME_ORDER: readonly string[] = [
  FLOW_MODE_ID,
  BAR_MODE_ID,
  WAIT_MODE_ID,
  LISTEN_MODE_ID,
];

/**
 * The short name each frame goes by on the page.
 *
 * Not the id: this ends up in a class and in the corner's mark, where a dot
 * in the middle of `mode.listen` would be two class names rather than one.
 */
const FRAME_SLUG: Readonly<Record<string, string>> = {
  [BAR_MODE_ID]: 'bar',
  [WAIT_MODE_ID]: 'wait',
  [FLOW_MODE_ID]: 'flow',
  [LISTEN_MODE_ID]: 'listen',
};

/** What the button is called while it stands for each of them. */
const FRAME_NAME: Readonly<Record<string, string>> = {
  [BAR_MODE_ID]: 'Wait each bar',
  [WAIT_MODE_ID]: 'Wait for me',
  [FLOW_MODE_ID]: 'Flow in time',
  [LISTEN_MODE_ID]: 'Listen to it',
};

/** And what it is drawn as, one path each, the way the transport icons are. */
const FRAME_ICON: Readonly<Record<string, string>> = {
  // Movement, and the line it stops at.
  [BAR_MODE_ID]: 'M3 11h9V7l6 5-6 5v-4H3v-2z M20 4h2v16h-2z',
  [WAIT_MODE_ID]:
    'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm1 3v5.3l3.6 2.1-1 1.7L11 13.5V7h2z',
  [FLOW_MODE_ID]: 'M12 3h2l4 16H6L10 3h2zm-1 3-2.6 11h7.2L13 6h-2z M6 15h12v2H6z',
  [LISTEN_MODE_ID]: 'M4 9v6h4l5 4V5L8 9H4zm12-.5a4.5 4.5 0 0 1 0 7v-2a2.5 2.5 0 0 0 0-3v-2z',
};

/** The frame after this one, which is what pressing the button means. */
function frameAfter(modeId: string): string {
  const at = FRAME_ORDER.indexOf(modeId);
  return FRAME_ORDER[(at + 1) % FRAME_ORDER.length] ?? WAIT_MODE_ID;
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
  [WAIT_MODE_ID]: 'The cursor waits for you',
  [FLOW_MODE_ID]: 'The beat carries the music',
  [LISTEN_MODE_ID]: 'The machine plays it to you',
};

/**
 * One cell per bar of the run, in reading order.
 *
 * His: "цифрами іноді мій мозок просто йде у loading, та не хочеться розуміти
 * що я зараз читаю". A row of numbers answers "how well"; this answers
 * "where", which is the question a reader actually has - and it answers it
 * without being read at all. Four clean bars and then a wall of red is a
 * sentence about the piece that no percentage can say.
 *
 * Two things at once, and deliberately not one: the colour is what was read
 * there, and the mark is where the music had to stop for you. A bar that
 * waited is very often also a bar with wrong notes in it, so a single colour
 * ranking one above the other would simply lose whichever came second.
 */
function barCells(
  report: PerformanceReport,
  bars: number,
): readonly { readonly label: string; readonly state: string; readonly waited: boolean }[] {
  const waited = new Set(report.waitedAtBars);
  return Array.from({ length: bars }, (_unused, measureIndex) => {
    const steps = report.steps.filter((step) => step.measureIndex === measureIndex);
    const wrong = steps.reduce((sum, step) => sum + step.wrong.length, 0);
    const missing = steps.reduce((sum, step) => sum + step.missing.length, 0);
    const said = [
      wrong > 0 ? `${wrong} wrong` : '',
      missing > 0 ? `${missing} missed` : '',
      waited.has(measureIndex) ? 'waited here' : '',
    ].filter((part) => part !== '');
    // The whole piece, not the part that was reached. A run abandoned in bar
    // three otherwise looks like a flawless piece three bars long, which is
    // the same lie `playableSteps` exists to stop the percentages telling.
    const state = steps.length === 0 ? 'unread' : wrong + missing === 0 ? 'clean' : 'wrong';
    const how = state === 'unread' ? 'not reached' : said.join(', ') || 'clean';
    return {
      label: `Bar ${measureIndex + 1} · ${how}`,
      state,
      waited: waited.has(measureIndex),
    };
  });
}

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
  | 'survival-refill'
  | 'survival-punish'
  | 'playing-ahead'
  | 'hear-other-hand'
  | 'rushing-counts';

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
    case 'survival-refill':
    case 'survival-punish':
      return !settings.survival
        ? 'Nothing is falling: Survival is off.'
        : keepsTime
          ? 'Under a pulse the bar falls with the beats, and a beat found is worth the beat it took.'
          : null;
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
};

/**
 * How much of the run the click sits out, from none of it to all of it.
 *
 * The cycles are symmetric on purpose: an equal stretch of silence is the
 * standard exercise, and it makes each one a number the reader can reason
 * about.
 */
const RULER_LABELS: Readonly<Record<RulerDivision, string>> = {
  off: 'None',
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
const KEYBOARD_LABELS: Readonly<Record<KeyboardSize, string>> = {
  any: 'A whole piano',
  '88': '88 keys',
  '76': '76 keys',
  '61': '61 keys',
  '49': '49 keys',
  '37': '37 keys',
  '25': '25 keys',
  laptop: 'This laptop, two octaves from C3',
};

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
};

const OPENING_DESCRIPTIONS: Readonly<Record<WhatOpens, string>> = {
  generated: 'Material generated at the level the ladder has reached.',
  last: 'The piece you were working on, where the library has it.',
  random:
    'Something to read is already there, so the question becomes whether to play it. ' +
    'Falls back to a new exercise while nothing is kept.',
};

const RULER_DESCRIPTIONS: Readonly<Record<RulerDivision, string>> = {
  off: 'Nothing ruled through the bars.',
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

/** The opening a stored or typed value names, falling back to generating. */
function readWhatOpens(value: string): WhatOpens {
  return WHAT_OPENS.includes(value as WhatOpens) ? (value as WhatOpens) : 'generated';
}

/** The ruling a stored or typed value names, or none at all. */
function readRuler(value: string): RulerDivision {
  return RULER_DIVISIONS.includes(value as RulerDivision) ? (value as RulerDivision) : 'off';
}

const CLICK_WHEN_LABELS: Readonly<Record<ClickWhen, string>> = {
  always: 'All the way through',
  'with-me': 'With me, beat by beat',
  'count-in-only': 'Only the count-in',
  'cycle-1': '1 bar on, 1 off',
  'cycle-2': '2 bars on, 2 off',
  'cycle-4': '4 bars on, 4 off',
  never: 'Never',
};

/**
 * The three answers the fullscreen button cycles through.
 *
 * Not all six: a cycle of bars on and bars off is chosen deliberately before a
 * run, and a thumb between two runs wants "all the way", "just count me in" or
 * "leave me alone". Landing on the list from a cycle gives the first of them,
 * which is the one a reader reaching for the button is most likely to want.
 */
const CLICK_WHEN_BY_THUMB: readonly ClickWhen[] = ['always', 'count-in-only', 'never'];

function dropoutDescription(when: ClickWhen, countInBars: number): string {
  if (when === 'always') {
    return 'The click plays all the way through.';
  }
  if (when === 'never') {
    return 'No click at all. The beat still runs the page; you simply do not hear it.';
  }
  if (when === 'count-in-only') {
    // Chosen together with no count-in, this asks for silence and nothing
    // else, which is worth saying rather than leaving to be discovered.
    return countInBars > 0
      ? 'You are given the tempo and then left with it for the whole run.'
      : 'There is no count-in to give you the tempo, so nothing will sound at all.';
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

/** `m:ss`, which is how long a take feels rather than how long it is. */
function clockTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
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
function describeReading(reading: {
  readonly key: string;
  readonly overall: number;
  readonly grade: string;
  readonly completed: boolean;
  readonly tempoPercent?: number;
  readonly hand?: number | null;
}): string {
  const [what = '', bars = ''] = reading.key.split(' bars:');
  const piece = what.startsWith('score:')
    ? what.slice('score:'.length)
    : what.startsWith('level:')
      ? 'Exercise'
      : what;
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

function takeFileName(savedAtMs: number): string {
  const at = new Date(savedAtMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `take-${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`
  );
}

const PLAYED_NOTE_LABELS: Readonly<Record<PlayedNoteDisplay, string>> = {
  live: 'As I play them',
  'while-held': 'As I play them, a wrong one only while held',
  'at-end': 'Only when the run ends',
  hidden: 'Never',
};

const PLAYED_NOTE_DESCRIPTIONS: Readonly<Record<PlayedNoteDisplay, string>> = {
  live: 'Each press appears on the page the moment it lands.',
  'while-held':
    'A wrong note lasts as long as you hold the key, so hunting for an accidental does not ' +
    'bury the note you are hunting for. They all come back when the run ends.',
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

const TIME_SIGNATURES = ['4/4', '3/4', '2/4', '6/8'] as const;

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

function readClickWhen(value: string): ClickWhen {
  return CLICK_WHEN.includes(value as ClickWhen) ? (value as ClickWhen) : 'always';
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
  private previewTimer: ReturnType<typeof setInterval> | null = null;
  /** Pending re-engraving after the tempo buttons stop being pressed. */
  private tempoRedraw: ReturnType<typeof setTimeout> | null = null;
  private restTimer: ReturnType<typeof setTimeout> | null = null;
  /** The week as it was last drawn, so seven marks are not redrawn for nothing. */
  private weekShown: string | null = null;

  /** The modes last drawn in the corner, so an unchanged set is left alone. */
  private modesShown: string | null = null;
  private timeTick: ReturnType<typeof setInterval> | null = null;
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
  /** Follows a sounding take, so the slider says where it has got to. */
  private takeTick: ReturnType<typeof setInterval> | null = null;
  private rollTick: ReturnType<typeof setInterval> | null = null;
  /** Clicks of the run already handed to the metronome by this playback. */
  private rollClicksSent = 0;
  /**
   * Fingers down on the drawing, and what the zoom was when the second arrived.
   *
   * Two are a pinch. Kept by pointer id rather than counted, because a finger
   * lifted is a particular finger and the one still down has to go on meaning
   * what it meant.
   */
  private readonly rollFingers = new Map<number, { readonly x: number; readonly y: number }>();
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
  /**
   * Whether the gesture that is ending was a pinch.
   *
   * A pinch ends with fingers coming up, and a finger coming up off an element
   * is a click as far as the page is concerned - so without this, every pinch
   * also moved the head to wherever the last finger happened to be.
   */
  private pinched = false;
  /**
   * Where the head stands while nothing is sounding, in milliseconds.
   *
   * Kept here rather than asked of the player, because the player has no
   * position until it has been given something to play - and the reader may put
   * the head somewhere before ever pressing play. It is where a playback starts
   * from, which is what makes a tap on the grid mean anything at all.
   */
  private rollAtMs = 0;
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
   * The recording the picture is of, or `null` for the run just played.
   *
   * The picture draws presses and pedal spans against time, and a recording is
   * exactly that written down - so looking at one asks for no second drawing,
   * only for a different answer to "which roll". His: "можливість відчинити
   * будь який recording у MIDI viewer".
   */
  private theTakeShowing: RunRoll | null = null;
  private theOtherHandsWalk: { readonly stepIndex: number; readonly atMs: number }[] = [];
  private theOtherHandsStep: ReturnType<typeof setTimeout> | null = null;
  private silenceWatch: ReturnType<typeof setTimeout> | null = null;
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
    scoreDrill: HTMLElement;
    drillWhere: HTMLElement;
    drillWhat: HTMLElement;
    drillStop: HTMLButtonElement;
    drillStart: HTMLButtonElement;
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
    scoreListening: HTMLButtonElement;
    scoreListeningText: HTMLElement;
    focusRepeat: HTMLButtonElement;
    focusBare: HTMLButtonElement;
    pagedScore: HTMLInputElement;
    repeatNumbers: HTMLInputElement;
    focusSmaller: HTMLButtonElement;
    focusBigger: HTMLButtonElement;
    focusZoom: HTMLOutputElement;
    focusHandLeft: SVGElement;
    focusHandRight: SVGElement;
    focusHealthFill: HTMLElement;
    playingAhead: HTMLSelectElement;
    survival: HTMLInputElement;
    survivalRefill: HTMLSelectElement;
    survivalPunish: HTMLInputElement;
    stopAtMistake: HTMLInputElement;
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
    focusRewind: HTMLButtonElement;
    focusSlower: HTMLButtonElement;
    focusFaster: HTMLButtonElement;
    focusTempo: HTMLOutputElement;
    scoresFresh: HTMLButtonElement;
    scoresRung: HTMLElement;
    midiStatus: HTMLElement;
    bridgeStatus: HTMLElement;
    pedalStatus: HTMLElement;
    connectMidi: HTMLButtonElement;
    midiInput: HTMLSelectElement;
    midiHint: HTMLElement;
    result: HTMLElement;
    drill: HTMLButtonElement;
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
    rollTitle: HTMLElement;
    rollMap: HTMLElement;
    rollMapWindow: HTMLElement;
    rollMapHead: HTMLElement;
    rollFrom: HTMLButtonElement;
    rollTo: HTMLButtonElement;
    rollPassageWhat: HTMLElement;
    rollPractise: HTMLButtonElement;
    rollZoom: HTMLInputElement;
    rollSnap: HTMLInputElement;
    rollGhosts: HTMLInputElement;
    rollSlips: HTMLInputElement;
    rollOptions: HTMLButtonElement;
    sheetRollOptions: HTMLElement;
    rollOptionsClose: HTMLButtonElement;
    rollSpeed: HTMLSelectElement;
    rollClick: HTMLInputElement;
    rollGrid: HTMLSelectElement;
    rollPlay: HTMLButtonElement;
    rollPlayIcon: SVGPathElement;
    rollStop: HTMLButtonElement;
    rollClose: HTMLElement;
    sheetSettings: HTMLElement;
    settingsSections: HTMLElement;
    sheetPlaces: HTMLElement;
    focusPlaces: HTMLButtonElement;
    placesClose: HTMLButtonElement;
    sheetModes: HTMLElement;
    modesGrid: HTMLElement;
    frameCycle: HTMLButtonElement;
    frameIcon: SVGPathElement;
    frameName: HTMLElement;
    frameWhat: HTMLElement;
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
    scoresEmpty: HTMLElement;
    scoresAdded: HTMLElement;
    sheetConfirm: HTMLElement;
    confirmText: HTMLElement;
    confirmYes: HTMLButtonElement;
    confirmNo: HTMLButtonElement;
    scoresList: HTMLUListElement;
    scoresSearch: HTMLInputElement;
    sheetReadings: HTMLElement;
    readingsList: HTMLUListElement;
    readingsEmpty: HTMLElement;
    readingsBest: HTMLInputElement;
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
    scoring: HTMLSelectElement;
    scoringDescription: HTMLElement;
    key: HTMLSelectElement;
    timeSignature: HTMLSelectElement;
    measures: HTMLInputElement;
    measuresValue: HTMLInputElement;
    tempo: HTMLInputElement;
    tempoValue: HTMLOutputElement;
    click: HTMLSelectElement;
    clickDescription: HTMLElement;
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
    keyboard: HTMLSelectElement;
    keyboardDescription: HTMLElement;
    clickSilences: HTMLSelectElement;
    clickSilencesDescription: HTMLElement;
    countInRun: HTMLSelectElement;
    countInPlayback: HTMLSelectElement;
    countInPlaybackDescription: HTMLElement;
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
    toleranceValue: HTMLOutputElement;
    zoom: HTMLInputElement;
    zoomValue: HTMLOutputElement;
    showPlayed: HTMLSelectElement;
    showPlayedDescription: HTMLElement;
    readAhead: HTMLSelectElement;
    readAheadDescription: HTMLElement;
    cursorRunning: HTMLInputElement;
    cursorListening: HTMLInputElement;
    cursorRest: HTMLInputElement;
    strictTiming: HTMLInputElement;
    sampleLoading: HTMLSelectElement;
    sampleLoadingHint: HTMLElement;
    networkState: HTMLElement;
    metronomeVolume: HTMLInputElement;
    metronomeVolumeValue: HTMLOutputElement;
    instrumentVolume: HTMLInputElement;
    instrumentVolumeValue: HTMLOutputElement;
    learnKnob: HTMLButtonElement;
    knobStatus: HTMLElement;
    pitchClass: HTMLInputElement;
    rhythmOnly: HTMLInputElement;
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
      scoreDrill: requireElement(doc, 'score-drill'),
      drillWhere: requireElement(doc, 'drill-where'),
      drillWhat: requireElement(doc, 'drill-what'),
      drillStop: requireElement(doc, 'drill-stop'),
      drillStart: requireElement(doc, 'drill-start'),
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
      scoreListening: requireElement(doc, 'score-listening'),
      scoreListeningText: requireElement(doc, 'score-listening-text'),
      focusRepeat: requireElement(doc, 'focus-repeat'),
      focusBare: requireElement(doc, 'focus-bare'),
      pagedScore: requireElement(doc, 'paged-score'),
      repeatNumbers: requireElement(doc, 'repeat-numbers'),
      focusSmaller: requireElement(doc, 'focus-smaller'),
      focusBigger: requireElement(doc, 'focus-bigger'),
      focusZoom: requireElement(doc, 'focus-zoom'),
      focusHandLeft: requireElement(doc, 'focus-hand-left'),
      focusHandRight: requireElement(doc, 'focus-hand-right'),
      focusHealthFill: requireElement(doc, 'focus-health-fill'),
      playingAhead: requireElement(doc, 'playing-ahead'),
      survival: requireElement(doc, 'survival'),
      survivalRefill: requireElement(doc, 'survival-refill'),
      survivalPunish: requireElement(doc, 'survival-punish'),
      stopAtMistake: requireElement(doc, 'stop-at-mistake'),
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
      focusRewind: requireElement(doc, 'focus-rewind'),
      focusSlower: requireElement(doc, 'focus-slower'),
      focusFaster: requireElement(doc, 'focus-faster'),
      focusTempo: requireElement(doc, 'focus-tempo'),
      scoresFresh: requireElement(doc, 'scores-fresh'),
      scoresRung: requireElement(doc, 'scores-rung'),
      midiStatus: requireElement(doc, 'midi-status'),
      bridgeStatus: requireElement(doc, 'bridge-status'),
      pedalStatus: requireElement(doc, 'pedal-status'),
      connectMidi: requireElement(doc, 'connect-midi'),
      midiInput: requireElement(doc, 'midi-input'),
      midiHint: requireElement(doc, 'midi-hint'),
      result: requireElement(doc, 'result'),
      drill: requireElement(doc, 'drill'),
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
      rollTitle: requireElement(doc, 'roll-title'),
      rollMap: requireElement(doc, 'roll-map'),
      rollMapWindow: requireElement(doc, 'roll-map-window'),
      rollMapHead: requireElement(doc, 'roll-map-head'),
      rollFrom: requireElement(doc, 'roll-from'),
      rollTo: requireElement(doc, 'roll-to'),
      rollPassageWhat: requireElement(doc, 'roll-passage-what'),
      rollPractise: requireElement(doc, 'roll-practise'),
      rollZoom: requireElement(doc, 'roll-zoom'),
      rollSnap: requireElement(doc, 'roll-snap'),
      rollGhosts: requireElement(doc, 'roll-ghosts'),
      rollSlips: requireElement(doc, 'roll-slips'),
      rollOptions: requireElement(doc, 'roll-options'),
      sheetRollOptions: requireElement(doc, 'sheet-roll-options'),
      rollOptionsClose: requireElement(doc, 'roll-options-close'),
      rollSpeed: requireElement(doc, 'roll-speed'),
      rollClick: requireElement(doc, 'roll-click'),
      rollGrid: requireElement(doc, 'roll-grid'),
      rollPlay: requireElement(doc, 'roll-play'),
      rollPlayIcon: requireElement(doc, 'roll-play-icon'),
      rollStop: requireElement(doc, 'roll-stop'),
      rollClose: requireElement(doc, 'roll-close'),
      sheetSettings: requireElement(doc, 'sheet-settings'),
      settingsSections: requireElement(doc, 'settings-sections'),
      sheetPlaces: requireElement(doc, 'sheet-places'),
      focusPlaces: requireElement(doc, 'focus-places'),
      placesClose: requireElement(doc, 'places-close'),
      sheetModes: requireElement(doc, 'sheet-modes'),
      modesGrid: requireElement(doc, 'modes-grid'),
      frameCycle: requireElement(doc, 'frame-cycle'),
      frameIcon: requireElement(doc, 'frame-icon'),
      frameName: requireElement(doc, 'frame-name'),
      frameWhat: requireElement(doc, 'frame-what'),
      modesClose: requireElement(doc, 'modes-close'),
      focusModes: requireElement(doc, 'focus-modes'),
      settingsMetronome: requireElement(doc, 'settings-metronome'),
      focusSettings: requireElement(doc, 'focus-settings'),
      settingsClose: requireElement(doc, 'settings-close'),
      takesClose: requireElement(doc, 'takes-close'),
      scoresClose: requireElement(doc, 'scores-close'),
      takesEmpty: requireElement(doc, 'takes-empty'),
      takeTransport: requireElement(doc, 'take-transport'),
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
      scoresSearch: requireElement(doc, 'scores-search'),
      sheetReadings: requireElement(doc, 'sheet-readings'),
      readingsList: requireElement(doc, 'readings-list'),
      readingsEmpty: requireElement(doc, 'readings-empty'),
      readingsBest: requireElement(doc, 'readings-best'),
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
      scoring: requireElement(doc, 'scoring'),
      scoringDescription: requireElement(doc, 'scoring-description'),
      key: requireElement(doc, 'key'),
      timeSignature: requireElement(doc, 'time-signature'),
      measures: requireElement(doc, 'measures'),
      measuresValue: requireElement(doc, 'measures-value'),
      tempo: requireElement(doc, 'tempo'),
      tempoValue: requireElement(doc, 'tempo-value'),
      click: requireElement(doc, 'click'),
      clickDescription: requireElement(doc, 'click-description'),
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
      keyboard: requireElement(doc, 'keyboard'),
      keyboardDescription: requireElement(doc, 'keyboard-description'),
      clickSilences: requireElement(doc, 'click-silences'),
      clickSilencesDescription: requireElement(doc, 'click-silences-description'),
      countInRun: requireElement(doc, 'count-in-run'),
      countInPlayback: requireElement(doc, 'count-in-playback'),
      countInPlaybackDescription: requireElement(doc, 'count-in-playback-description'),
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
      toleranceValue: requireElement(doc, 'tolerance-value'),
      zoom: requireElement(doc, 'zoom'),
      zoomValue: requireElement(doc, 'zoom-value'),
      showPlayed: requireElement(doc, 'show-played'),
      showPlayedDescription: requireElement(doc, 'show-played-description'),
      readAhead: requireElement(doc, 'read-ahead'),
      readAheadDescription: requireElement(doc, 'read-ahead-description'),
      cursorRunning: requireElement(doc, 'cursor-running'),
      cursorListening: requireElement(doc, 'cursor-listening'),
      cursorRest: requireElement(doc, 'cursor-rest'),
      strictTiming: requireElement(doc, 'strict-timing'),
      sampleLoading: requireElement(doc, 'sample-loading'),
      sampleLoadingHint: requireElement(doc, 'sample-loading-hint'),
      networkState: requireElement(doc, 'network-state'),
      metronomeVolume: requireElement(doc, 'metronome-volume'),
      metronomeVolumeValue: requireElement(doc, 'metronome-volume-value'),
      instrumentVolume: requireElement(doc, 'instrument-volume'),
      instrumentVolumeValue: requireElement(doc, 'instrument-volume-value'),
      learnKnob: requireElement(doc, 'learn-knob'),
      knobStatus: requireElement(doc, 'knob-status'),
      pitchClass: requireElement(doc, 'pitch-class'),
      rhythmOnly: requireElement(doc, 'rhythm-only'),
      audioFeedback: requireElement(doc, 'audio-feedback'),
      computerKeyboard: requireElement(doc, 'computer-keyboard'),
    };
  }

  async initialize(): Promise<void> {
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
    this.bindVolumeKnob();
    this.countTheTime();
    await this.openWhatWasAskedFor();
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
    const chosen =
      wanted === 'last' ? this.runtime.scores.lastRead : this.runtime.scores.oneAtRandom(Math.random());
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
    if (this.timeTick !== null) {
      clearInterval(this.timeTick);
      this.timeTick = null;
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
        const { exercise, warnings } = await this.runtime.importer.readFile(
          await file.arrayBuffer(),
          file.name,
        );
        // Kept on the way in, so the file is chosen from the disk once and
        // afterwards the piece is simply there.
        await this.runtime.scores.keep(exercise, Date.now());
        kept.push(exercise.title);
        if (alone) {
          await this.runtime.controller.openScore(exercise);
          // Opening a piece can put the passage back to the two ends, and the
          // boxes in the sheet are the same setting seen from another chair.
          this.syncControlsFromSettings();
        }
        // What the file did not bring with it goes to the console and no
        // further. It is worth keeping - several faults here were found
        // through one of these - and it is not worth a line across the music:
        // the page says which piece opened by printing its name in the corner.
        for (const warning of warnings) {
          reportToTheConsole(`Opening ${exercise.title}:`, warning.detail);
        }
      } catch (error) {
        reportToTheConsole(`Could not open ${file.name}.`, error);
        refused.push({
          name: file.name,
          why: error instanceof Error ? error.message : 'It could not be read.',
        });
      }
    }

    this.renderScores();
    this.sayWhatTheFilesDid(kept, refused, alone);
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
    // Named, since somebody adding thirty files has no other way to tell
    // which of them was refused.
    this.el.scoresAdded.hidden = false;
    this.el.scoresAdded.textContent =
      `Added ${String(kept.length)}. Could not open ${refused.map((one) => one.name).join(', ')}.`;
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

  /** Writes the list back to the score it belongs to, and redraws it. */
  private async keepPassages(passages: readonly SavedPassage[]): Promise<void> {
    const opened = this.runtime.controller.openedExercise;
    const kept = this.runtime.scores.list().find((score) => score.title === opened?.title);
    if (kept === undefined) {
      return;
    }
    await this.runtime.scores.keepPassages(kept.id, passages);
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
    const readings = best ? history.bestReadings(10) : history.lastReadings(20);
    this.el.readingsEmpty.hidden = readings.length > 0;
    this.el.readingsEmpty.textContent = best
      ? 'Nothing played to the end yet. A reading has to finish to be one of the best.'
      : 'Nothing read yet. Play something and it is remembered here.';
    this.el.readingsList.replaceChildren();

    const now = Date.now();
    for (const reading of readings) {
      const row = this.doc.createElement('li');
      const name = this.doc.createElement('span');
      name.className = 'takes__name';
      name.textContent = describeReading(reading);
      name.title = reading.key;

      const when = this.doc.createElement('span');
      when.className = 'takes__when';
      when.textContent = describeWhen(reading.atMs, now);

      row.append(name, when);
      this.el.readingsList.append(row);
    }
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
    const all = this.runtime.scores.list();
    const query = this.el.scoresSearch.value.trim();
    const scores = query === '' ? all : this.runtime.scores.search(query);
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

      const open = this.doc.createElement('button');
      open.type = 'button';
      open.textContent = 'Open';
      this.listen(open, 'click', () => {
        void this.openKeptScore(score.id, score.title);
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
      // reaches for, and it has been in that place since there were rows.
      row.append(name, when, open, rename, remove);
      this.el.scoresList.append(row);
    }
  }

  private async openKeptScore(id: string, title: string): Promise<void> {
    try {
      const exercise = await this.runtime.scores.open(id);
      if (exercise === null) {
        this.sayInTheMiddle(`${title} is no longer stored on this device.`);
        this.renderScores();
        return;
      }
      await this.runtime.controller.openScore(exercise);
      // Choosing one from the sheet is a reading, and the calendar is what
      // says so - `IClock` counts from an arbitrary zero for measuring music.
      void this.runtime.scores.markRead(exercise.title, Date.now());
      this.syncControlsFromSettings();
    } catch (error) {
      reportToTheConsole(`Could not open ${title}.`, error);
      this.sayInTheMiddle(
        error instanceof Error ? `Could not open ${title}. ${error.message}` : `Could not open ${title}.`,
      );
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
  private async toggleListening(): Promise<void> {
    const { controller } = this.runtime;
    // Pressing it again holds the music rather than throwing it away. It is
    // the same button that started the performance, and pressing a play
    // button a second time does not mean "back to the top" anywhere else -
    // it used to here, so listening to a phrase twice meant sitting through
    // everything in front of it again. Stop is what ends a performance.
    if (controller.isListening) {
      controller.pauseListening();
      // Held music has no next beat until it is picked up again.
      this.forgetTheBeats();
      this.showThePerformance();
      return;
    }
    if (controller.isListeningPaused) {
      controller.resumeListening();
      this.showThePerformance();
      return;
    }
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
    controller.listen();
    this.showThePerformance();
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
  private showThePerformance(): void {
    this.applyPlayingChrome();
    this.updateButtons(this.runtime.controller.session?.status ?? 'idle');
    this.describeStopping();
  }

  /**
   * Whether there is anything for Stop to stop.
   *
   * Asked of all three things it can end rather than of the session alone: a
   * greyed-out Stop while a performance plays says the button is not for
   * this, which was never true - it was only ever not wired to it.
   */
  private describeStopping(): void {
    const status = this.runtime.controller.session?.status;
    const stoppable =
      status === 'running' ||
      status === 'counting-in' ||
      status === 'paused' ||
      this.isPreviewing ||
      this.runtime.controller.isListening ||
      this.runtime.controller.isListeningPaused;
    this.el.focusStop.disabled = !stoppable;
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
      this.el.scoring,
      this.runtime.scorings
        .list()
        .map((strategy) => ({ value: strategy.id, label: strategy.label })),
      this.runtime.controller.settings.scoringId,
    );
    fillSelect(
      this.el.click,
      CLICK_PATTERNS.map((pattern) => ({ value: pattern, label: CLICK_LABELS[pattern] })),
      this.runtime.controller.settings.clickPattern,
    );
    fillSelect(
      this.el.dropout,
      CLICK_WHEN.map((choice) => ({ value: choice, label: CLICK_WHEN_LABELS[choice] })),
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
      this.el.keyboard,
      KEYBOARD_SIZES.map((choice) => ({ value: choice, label: KEYBOARD_LABELS[choice] })),
      this.runtime.controller.settings.keyboard,
    );
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
    for (const select of [this.el.restEvery, this.el.restEverySettings]) {
      fillSelect(
        select,
        REST_INTERVALS.map((choice) => ({ ...choice })),
        String(this.runtime.controller.settings.restEveryMinutes),
      );
    }
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
      controller.updateSettings({ presetId: this.el.preset.value });
      this.syncControlsFromSettings();
      void this.reload(true);
    });

    this.listen(this.el.rhythm, 'change', () => {
      controller.updateSettings({ rhythmProfileId: this.el.rhythm.value });
      this.syncControlsFromSettings();
      void this.reload(true);
    });

    this.listen(this.el.scoring, 'change', () => {
      controller.updateSettings({ scoringId: this.el.scoring.value });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.click, 'change', () => {
      controller.updateSettings({ clickPattern: this.el.click.value as ClickPattern });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.dropout, 'change', () => {
      controller.updateSettings({ clickWhen: readClickWhen(this.el.dropout.value) });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.key, 'change', () => {
      controller.updateSettings({ key: parseKeyValue(this.el.key.value) });
      void this.reload(true);
    });

    this.listen(this.el.timeSignature, 'change', () => {
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

    this.listen(this.el.drill, 'click', () => {
      const passage = controller.drillWorstPassage();
      if (passage === null) {
        this.el.drill.hidden = true;
        return;
      }
      this.syncControlsFromSettings();
      void this.reload(false);
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

    this.listen(this.el.cursorRunning, 'change', () => {
      controller.updateSettings({ cursorWhileRunning: this.el.cursorRunning.checked });
    });

    this.listen(this.el.strictTiming, 'change', () => {
      controller.updateSettings({ strictTiming: this.el.strictTiming.checked });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.sampleLoading, 'change', () => {
      this.applySampleLoading(readSampleLoading(this.el.sampleLoading.value));
    });

    this.listen(this.el.metronomeVolume, 'input', () => {
      this.applyVolumes(true);
    });

    this.listen(this.el.instrumentVolume, 'input', () => {
      this.applyVolumes(true);
    });

    this.listen(this.el.learnKnob, 'click', () => {
      const knob = this.runtime.volumeKnob;
      if (knob.isLearning) {
        knob.cancelLearning();
      } else if (knob.controller !== null) {
        // A bound knob's button gives it back, since teaching a second one
        // over the top would leave the reader unable to say which is in use.
        knob.forget();
      } else {
        knob.learn();
      }
      this.describeKnob();
    });

    this.listen(this.el.playingAhead, 'change', () => {
      controller.updateSettings({
        playingAhead: this.el.playingAhead.value === 'moves-on' ? 'moves-on' : 'a-mistake',
      });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.survival, 'change', () => {
      controller.updateSettings({ survival: this.el.survival.checked });
      this.renderHealth(controller.health);
      // A mode square and a switch are one question, and the two settings
      // this empties are a second: both are read from here, so both have to
      // be told. Set from the drawer and left alone, the square went on
      // saying the opposite of what the setting said.
      this.syncControlsFromSettings();
    });

    this.listen(this.el.survivalRefill, 'change', () => {
      controller.updateSettings({ survivalRefillPercent: Number(this.el.survivalRefill.value) });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.survivalPunish, 'change', () => {
      controller.updateSettings({ survivalPunishesMistakes: this.el.survivalPunish.checked });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.stopAtMistake, 'change', () => {
      controller.updateSettings(settingsForMode('strict', this.el.stopAtMistake.checked));
      this.syncControlsFromSettings();
    });

    this.listen(this.el.rhythmOnly, 'change', () => {
      // Through the squares' own rule, so the drawer cannot make the pair
      // the squares will not: one switch, one answer, wherever it is asked.
      controller.updateSettings(settingsForMode('rhythm', this.el.rhythmOnly.checked));
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

    this.listen(this.el.keyboard, 'change', () => {
      const wanted = this.el.keyboard.value as KeyboardSize;
      controller.updateSettings({
        keyboard: KEYBOARD_SIZES.includes(wanted) ? wanted : 'any',
      });
      this.syncControlsFromSettings();
      // The next exercise is written for it; the one on the stand was not.
      void this.reload(true);
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

    this.listen(this.el.readingsClose, 'click', () => {
      this.el.sheetReadings.hidden = true;
    });

    this.listen(this.el.scoresSearch, 'input', () => {
      this.renderScores();
    });

    this.listen(this.el.drillStart, 'click', () => {
      const bars = Math.max(1, Math.round(Number(this.el.drillBars.value) || 4));
      controller.startTheDrill(bars);
      this.syncControlsFromSettings();
      // Straight to the music: the plan is set, and what it asks for is
      // said in the middle of the page.
      this.el.sheetSettings.hidden = true;
    });

    this.listen(this.el.drillStop, 'click', () => {
      controller.stopTheDrill();
      this.showTheDrill();
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
      // reached for a button. They notice the idea afterwards, and the take
      // before this one used to be gone by then with nothing to say so.
      this.runtime.recorder.events.on('takeClosed', ({ take }) => {
        this.runtime.takes.file(take, Date.now(), 'recent');
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
    const show = (pane: string): void => {
      const panel = this.el.sheetSettings.querySelector('.sheet__panel');
      if (panel instanceof HTMLElement) {
        panel.dataset['showing'] = pane;
      }
      for (const tab of tabs) {
        tab.setAttribute('aria-pressed', String(tab.getAttribute('data-chooses') === pane));
      }
    };
    for (const tab of tabs) {
      if (tab instanceof HTMLElement) {
        this.listen(tab, 'click', () => {
          show(tab.dataset['chooses'] ?? '');
        });
      }
    }
    show(tabs[0]?.getAttribute('data-chooses') ?? '');

    // One panel and two doors to it. A second set of the same controls would
    // be two editors of one setting, disagreeing the moment one is wired up
    // wrong - so this opens the panel the pill opens.
    this.listen(this.el.settingsMetronome, 'click', () => {
      this.el.sheetSettings.hidden = true;
      this.el.sheetMetronome.hidden = false;
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
    // Opening it, and the dimmed ground that closes it, are the list every
    // other sheet is in: bound here as well, this one would have been the
    // only sheet a tap outside did not close - which is what happened.
    const cards = [...this.el.modesGrid.querySelectorAll('button[data-mode]')];
    this.listen(this.el.modesClose, 'click', () => {
      this.el.sheetModes.hidden = true;
    });
    this.listen(this.el.frameCycle, 'click', () => {
      // The same setting the settings select carries. Several ways to say one
      // thing is how everything here works; what must not happen is two
      // things saying it differently, which is why they read it back through
      // one sync.
      this.runtime.controller.updateSettings({
        modeId: frameAfter(this.runtime.controller.settings.modeId),
      });
      this.syncControlsFromSettings();
      this.turnTheFrame();
    });
    for (const card of cards) {
      if (!(card instanceof HTMLButtonElement)) {
        continue;
      }
      this.listen(card, 'click', () => {
        const on = card.getAttribute('aria-pressed') !== 'true';
        this.runtime.controller.updateSettings(settingsForMode(card.dataset['mode'] ?? '', on));
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
    this.el.scoreListening.hidden = !waiting;
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
    const frame = settings.modeId;
    this.el.frameCycle.dataset['frame'] = FRAME_SLUG[frame] ?? 'wait';
    this.el.frameIcon.setAttribute('d', FRAME_ICON[frame] ?? '');
    this.el.frameName.textContent = FRAME_NAME[frame] ?? '';
    this.el.frameWhat.textContent = FRAME_WHAT[frame] ?? '';
    this.el.frameCycle.title = `${FRAME_NAME[frame] ?? ''} - press for ${FRAME_NAME[frameAfter(frame)] ?? ''}`;
    // On means "not the plain one". Flowing in time is where a reader starts
    // and what the app opens with, so it is the state this rests in - and
    // choosing either of the others lights it the way a square lights.
    this.el.frameCycle.setAttribute('aria-pressed', String(frame !== PLAIN_FRAME));
    // The frame first, where it is not the one that waits. That one is the
    // resting state of this program - Start begins a run and the music waits
    // for the reader - and the other two are exactly the cases where Start
    // does something else, which is what a corner is for. Left unsaid, a
    // reader could sit down to practise and have the machine play at them.
    const on: HTMLButtonElement[] = [];
    const away = settings.modeId !== PLAIN_FRAME;
    if (away) {
      on.push(this.el.frameCycle);
    }
    // And on the button that acts on it. The reader presses Start without
    // looking; what it will start is the one thing it may need to say, and
    // only where the answer is not the plain one.
    this.el.focusPlayFrame.replaceChildren();
    const badge = away ? this.el.frameCycle.querySelector('svg') : null;
    if (badge !== null) {
      this.el.focusPlayFrame.append(badge.cloneNode(true));
    }
    this.el.focusPlayFrame.hidden = badge === null;
    for (const card of this.el.modesGrid.querySelectorAll('button[data-mode]')) {
      if (!(card instanceof HTMLButtonElement)) {
        continue;
      }
      const mode = card.dataset['mode'] ?? '';
      const lit = modeIsOn(mode, settings);
      card.setAttribute('aria-pressed', String(lit));
      if (lit) {
        on.push(card);
      }
    }
    this.showWhichModesAreOn(on);
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
   * Plays the turn again, however the press left the button.
   *
   * The squares get theirs from a transition, and that is right for two
   * states: every press moves between them. This button has three, so two
   * presses running can both leave it lit - and a transition from a state to
   * itself is nothing at all, which read as a button that had not noticed
   * being pressed. Taken off and put back on, with the layout read in
   * between so the browser starts a new animation rather than keeping the
   * one it thinks is already running.
   */
  private turnTheFrame(): void {
    const card = this.el.frameCycle;
    delete card.dataset['turning'];
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions -- reading the layout is the point.
    void card.offsetWidth;
    if (card.getAttribute('aria-pressed') === 'true') {
      card.dataset['turning'] = 'true';
    }
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
      ['survival-refill', this.el.survivalRefill],
      ['survival-punish', this.el.survivalPunish],
      ['playing-ahead', this.el.playingAhead],
      ['hear-other-hand', this.el.hearOtherHand],
      ['rushing-counts', this.el.rushingCounts],
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

  private bindNarrowLayout(): void {
    const view = this.doc.defaultView;
    if (view === null || typeof view.matchMedia !== 'function') {
      return;
    }
    const narrow = view.matchMedia('(max-width: 560px)');
    const place = (): void => {
      if (narrow.matches) {
        this.el.focusDrawer.prepend(this.el.focusSpeed);
      } else {
        this.el.focusRow.insertBefore(this.el.focusSpeed, this.el.focusMetronome);
      }
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

    this.listen(this.el.focusReplay, 'click', () => {
      this.replayRun();
    });

    this.listen(this.el.focusRewind, 'click', () => {
      // Where a run would begin, put back at the top. A place can be set
      // anywhere by holding a finger on a bar, so the way back must not be
      // "find bar one and hold a finger on that".
      const status = controller.session?.status;
      if (status === 'running' || status === 'counting-in' || status === 'paused') {
        controller.stop();
      }
      controller.beginAtTheStart();
      // The place is gone, so no bar is standing ready to open a passage.
      this.placedOnBar = null;
      controller.cursorToStart();
      this.showPassageMarkers();
    });

    this.listen(this.el.repeatNumbers, 'change', () => {
      controller.updateSettings({ showRepeatNumbers: this.el.repeatNumbers.checked });
      this.syncControlsFromSettings();
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

    this.listen(this.el.focusSlower, 'click', () => {
      this.nudgeTempo(-TEMPO_STEP_PERCENT);
    });

    this.listen(this.el.focusFaster, 'click', () => {
      this.nudgeTempo(TEMPO_STEP_PERCENT);
    });

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
      this.el.scoreDrill.hidden &&
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
    this.forgetTheBeats();
    this.cancelPreview();
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
   * Says what the drill is asking for, between runs.
   *
   * Only between runs: it is an instruction to read before playing, and a
   * card in the middle of the page while the music is going would be over
   * the music. What it says is where in the plan the reader is and what this
   * task is - the bars are in the drawer as well, because the drill sets the
   * ordinary passage rather than a private one of its own.
   */
  private showTheDrill(): void {
    const controller = this.runtime.controller;
    const task = controller.drillTask;
    const { at, of } = controller.drillProgress;
    const idle = !this.isPlaying && !controller.isListening;
    if (task === null) {
      // Finished the whole plan, rather than never started: worth saying, and
      // it stays until the reader does something else.
      const done = of > 0 && at >= of;
      this.el.scoreDrill.hidden = !done || !idle;
      if (done) {
        this.el.drillWhere.textContent = 'The whole piece has been through the plan';
        this.el.drillWhat.textContent = 'Every section, and then all of them together.';
        this.el.drillStop.textContent = 'Done';
      }
      this.syncCard();
      return;
    }
    this.el.drillStop.textContent = 'Stop the plan';
    this.el.drillWhere.textContent = `Step ${at + 1} of ${of}`;
    const hand =
      task.hand === null ? 'both hands' : task.hand === 1 ? 'the right hand' : 'the left hand';
    const bars = task.fromBar === task.toBar ? `Bar ${task.fromBar}` : `Bars ${task.fromBar}-${task.toBar}`;
    this.el.drillWhat.textContent = `${bars}, ${hand}, at ${task.tempoPercent}% - play it through cleanly.`;
    this.el.scoreDrill.hidden = !idle;
    this.syncCard();
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
  private bindSpaceBar(): void {
    const handler = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isFormControl(this.doc.activeElement)) {
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
   * Says what the metronome is set to, on the button that opens it.
   *
   * The button raises a sheet rather than cycling anything, so its own state
   * is only ever a label - but a reader glancing at the row wants to know
   * whether the click is on at all without opening it, and the answer is one
   * short line.
   */
  private describeMetronomeButton(when: ClickWhen, pattern: ClickPattern): void {
    const label =
      `Metronome: ${CLICK_WHEN_LABELS[when].toLowerCase()}` +
      `, ${CLICK_LABELS[pattern].toLowerCase()}`;
    this.el.focusMetronome.dataset['click'] = CLICK_WHEN_BY_THUMB.includes(when) ? when : 'always';
    this.el.focusMetronome.title = label;
    this.el.focusMetronome.setAttribute('aria-label', label);
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
        // Every way of starting a run arrives here - the button, the repeat
        // coming round, a drill - so the verdict on the last one is put away
        // in one place rather than at each of them.
        this.showVerdict(false);
      }),
    );

    this.subscriptions.push(
      controller.events.on('drillChanged', () => {
        this.showTheDrill();
      }),
    );

    this.subscriptions.push(
      controller.events.on('otherHandReached', ({ stepIndex, atMs }) => {
        this.walkTheOtherHandTo(stepIndex, atMs);
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
      controller.playbackEvents.on('started', () => {
        this.showThePerformance();
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
        if (!controller.countsInEveryLap || !controller.settings.repeatRange) {
          return;
        }
        setTimeout(() => {
          if (controller.countsInEveryLap && controller.settings.repeatRange) {
            controller.listen();
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
      this.runtime.renderer.onBarHeld((measureIndex) => {
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
    const fromBridge = this.runtime.bridge?.subscribe(handler) ?? (() => undefined);
    return () => {
      fromHardware();
      fromKeyboard();
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

  private syncControlsFromSettings(): void {
    const settings = this.runtime.controller.settings;
    this.el.preset.value = settings.presetId;
    this.el.rhythm.value = settings.rhythmProfileId;
    this.el.scoring.value = settings.scoringId;
    this.el.scoringDescription.textContent = SCORING_DESCRIPTIONS[settings.scoringId] ?? '';
    this.el.key.value = keyValue(settings.key);
    this.el.timeSignature.value = settings.timeSignature.toString();
    this.el.measures.value = String(settings.measures);
    this.el.measuresValue.value = String(settings.measures);
    this.el.tempo.value = String(this.runtime.controller.tempoBpm);
    this.describeTempo();
    this.el.tempoValue.value = String(this.runtime.controller.tempoBpm);
    this.describeHands(settings.handStaff);
    this.el.click.value = settings.clickPattern;
    this.el.clickDescription.textContent = CLICK_DESCRIPTIONS[settings.clickPattern];
    this.el.dropout.value = settings.clickWhen;
    this.describeDropout();
    this.describePassageRange();
    // Here as well as on a new engraving: the repeat button changes what the
    // markers say without changing what is on the page.
    this.showPassageMarkers();
    this.el.focusRepeat.setAttribute('aria-pressed', String(settings.repeatRange));
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
    this.el.showPlayedDescription.textContent = PLAYED_NOTE_DESCRIPTIONS[settings.playedNotes];
    this.el.readAhead.value = readAheadValue(settings.readAheadSteps);
    this.el.readAheadDescription.textContent =
      READ_AHEAD_DESCRIPTIONS[this.el.readAhead.value] ?? '';
    this.el.cursorRunning.checked = settings.cursorWhileRunning;
    this.el.cursorListening.checked = settings.cursorWhileListening;
    this.el.cursorRest.checked = settings.cursorAtRest;
    this.el.strictTiming.checked = settings.strictTiming;
    this.el.pagedScore.checked = settings.pagedScore;
    this.el.repeatNumbers.checked = settings.showRepeatNumbers;
    // Said on the page rather than drawn again: the marks belong to the
    // engraving and outlive a setting being changed, so what changes is
    // whether they are shown - no re-engraving for a checkbox.
    this.doc.body.dataset['repeats'] = settings.showRepeatNumbers ? 'shown' : 'hidden';
    this.runtime.renderer.setPaged(settings.pagedScore);
    // A display decision, so it is answered in the stylesheet: the marks
    // themselves are the same either way, and what was measured about a press
    // does not change because the reader wants stricter colours.
    this.el.score.dataset['strict'] = String(settings.strictTiming);
    this.el.pitchClass.checked = settings.pitchClassOnly;
    this.el.rhythmOnly.checked = settings.rhythmOnly;
    this.el.playingAhead.value = settings.playingAhead;
    this.el.survival.checked = settings.survival;
    this.el.survivalRefill.value = String(settings.survivalRefillPercent);
    this.el.survivalPunish.checked = settings.survivalPunishesMistakes;
    this.el.stopAtMistake.checked = settings.stopAtAMistake;
    this.el.immediateStart.checked = settings.immediateStart;
    this.el.dimUnplayed.checked = settings.dimUnplayed;
    this.renderPassages();
    this.el.keyboard.value = settings.keyboard;
    const keys = keysOf(settings.keyboard);
    this.el.keyboardDescription.textContent =
      keys === null
        ? 'Exercises use the whole range each level asks for.'
        : `Exercises stay between ${keys.lowest.toString()} and ${keys.highest.toString()}. A part that ` +
          'would fall outside is moved by octaves rather than cut.';
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
    this.dimWhatHasNothingToSay();
    this.el.showPlaybackNotes.checked = settings.showPlaybackNotes;
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
    this.applyPreview();
    this.describeMetronomeButton(settings.clickWhen, settings.clickPattern);
    this.renderHealth(this.runtime.controller.health);
    this.describeLadder();
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

  /** Names the rung, or says plainly that the reader has left the route. */
  private describeLadder(): void {
    const { controller, ladder } = this.runtime;
    const step = controller.ladderStep;
    if (step === null) {
      this.el.ladderStep.textContent = 'Off the ladder';
      this.el.ladderDescription.textContent =
        'The settings below were chosen by hand. The arrows put you back on.';
      this.el.scoresRung.textContent = 'Off the ladder — the settings were chosen by hand';
      this.el.ladderDown.disabled = false;
      this.el.ladderUp.disabled = false;
      return;
    }
    this.el.ladderStep.textContent = `${step.label} · ${ladder.positionOf(step.id)} of ${ladder.list().length}`;
    this.el.ladderDescription.textContent = step.description;
    this.el.scoresRung.textContent = `${step.label} — ${step.description}`;
    this.el.ladderDown.disabled = !ladder.canStep(step.id, -1);
    this.el.ladderUp.disabled = !ladder.canStep(step.id, 1);
  }

  /**
   * Keeps what was just played, and offers it in the list.
   *
   * The recorder has been running since the page opened, so this button is
   * not a start: by the time an idea is worth keeping it has already been
   * played, and a Record button would arrive after the thing it was for.
   */
  private keepTake(): void {
    const take = this.runtime.recorder.take();
    if (take === null) {
      return;
    }
    this.runtime.takes.keepTake(take, Date.now());
    // The take is cut at silences, so leaving it in the buffer would let the
    // next press keep it a second time.
    this.runtime.recorder.clear();
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
        : 'Keeps what you have just played. The next key you press starts a new take.';

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
      `click: ${settings.clickPattern} / ${settings.clickWhen}`,
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
        () => this.renderTakes(),
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
          this.renderScores();
        },
      ],
      [
        // Everything about the click, from either place. It was two cycle
        // buttons in the drawer and two sliders down the settings sheet, and
        // "quieter, and give me two bars of count-in" meant both.
        this.el.sheetMetronome,
        [this.el.focusMetronome],
        () => this.syncControlsFromSettings(),
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
        // The picture's own options. Listed here rather than wired on their own
        // so that they get the way out every other sheet has: the dimmed area
        // outside the panel, which a thumb finds without aiming. His: "чи можна
        // ховати діалог з опціями при кліку outside цього діалогу?".
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
          sheet.hidden = false;
        });
      }
      // The dimmed area outside the panel is a way out that a thumb finds
      // without aiming; the × is for anyone who does aim.
      this.listen(sheet, 'click', (event) => {
        if (event.target === sheet) {
          sheet.hidden = true;
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
    this.listen(this.el.metronomeClose, 'click', () => {
      this.el.sheetMetronome.hidden = true;
    });
    this.listen(this.el.scoreReading, 'click', () => {
      this.showTheLastReading();
    });
    this.listen(this.el.rollClose, 'click', () => {
      this.stopTheRoll();
      // Its options go with it: a sheet left standing over a picture that has
      // been put away is a dialog about nothing.
      this.el.sheetRollOptions.hidden = true;
      this.el.sheetRoll.hidden = true;
    });
    this.listen(this.el.rollOptionsClose, 'click', () => {
      this.el.sheetRollOptions.hidden = true;
    });
    this.listen(this.el.rollPlay, 'click', () => {
      if (this.runtime.takePlayer.playing === RUN_ROLL_ID) {
        this.holdTheRoll();
        return;
      }
      this.playTheRoll();
    });
    this.listen(this.el.rollStop, 'click', () => {
      this.stopTheRoll();
    });
    this.el.rollBody.addEventListener(
      'wheel',
      (event) => {
        this.zoomTheRollByWheel(event);
      },
      // Said, so that the zoom may keep the page from scrolling under it.
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
      if (this.pinched) {
        return;
      }
      this.putTheHeadWhereItWasTapped(event);
    });
    this.listen(this.el.rollBody, 'pointerdown', (event) => {
      this.pinched = false;
      this.rollFingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.beginAPinch();
    });
    this.listen(this.el.rollBody, 'pointermove', (event) => {
      if (!this.rollFingers.has(event.pointerId)) {
        return;
      }
      this.rollFingers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.pinchTheRoll();
    });
    for (const ending of ['pointerup', 'pointercancel', 'pointerleave'] as const) {
      this.listen(this.el.rollBody, ending, (event) => {
        this.rollFingers.delete(event.pointerId);
        this.beginAPinch();
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
        this.rollClicksSent = clicksBefore(roll, this.headIsAtMs(), this.theRollsGrid());
      }
    });
    this.listen(this.el.rollSpeed, 'change', () => {
      this.runtime.takePlayer.setSpeed(this.theRollsSpeed());
      this.describeTheRoll();
    });
    this.listen(this.el.placesClose, 'click', () => {
      this.el.sheetPlaces.hidden = true;
    });

    this.listen(this.doc, 'keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Escape') {
        return;
      }
      // Before focus mode sees it: a sheet is the innermost thing open, and
      // Escape should shut that rather than the layout underneath it.
      for (const sheet of [
        this.el.sheetConfirm,
        this.el.sheetTakes,
        this.el.sheetScores,
        this.el.sheetMetronome,
        this.el.sheetSettings,
      ]) {
        if (!sheet.hidden) {
          sheet.hidden = true;
          event.stopPropagation();
          return;
        }
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
    this.el.sheetRename.hidden = false;
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
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Enter') {
          onYes();
        }
        if (event.key === 'Escape') {
          answer(null);
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
   * Asks for everything to go, and makes the reader say so in words.
   *
   * A row is one score and a mis-tap on it costs a file that is still on the
   * disk. The shelf is the whole library, and on a tablet it is a thumb's
   * width from the row above it - so this one is not a button that can be
   * pressed by accident at all. Typed rather than held down or pressed
   * twice: it is the only sort of confirmation that cannot be given without
   * having read the question.
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
  private ask(question: string, typed: string | null): Promise<boolean> {
    this.el.confirmText.textContent = question;
    this.el.confirmTyped.value = '';
    this.el.confirmTyped.hidden = typed === null;
    // Refused until the word is there, rather than refusing afterwards: the
    // button says what the state of the question is, and there is nothing to
    // report about an answer nobody has given yet.
    this.el.confirmYes.disabled = typed !== null;
    this.el.sheetConfirm.hidden = false;
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
      const onKey = (event: KeyboardEvent): void => {
        if (event.key === 'Enter') {
          onYes();
        }
        if (event.key === 'Escape') {
          answer(false);
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
      const wanted = (Number(this.el.takeScrub.value) / 1_000) * player.durationMs;
      player.seek(wanted);
      this.describeTakeTransport();
    });

    // Shut with the sheet: a take going on playing behind a closed list is a
    // sound with nothing on the page to stop it.
    this.listen(this.el.takesClose, 'click', () => {
      player.stop();
      this.describeTakeTransport();
    });
  }

  /** Starts a take and follows it until it stops. */
  private playTake(id: string, fromMs = 0): void {
    const take = this.runtime.takes.find(id);
    if (take === null) {
      return;
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

  private describeTakeTransport(): void {
    const player = this.runtime.takePlayer;
    const take = this.selectedTakeId === null ? null : this.runtime.takes.find(this.selectedTakeId);
    this.el.takeTransport.hidden = take === null;
    if (take === null) {
      return;
    }

    const total = player.durationMs > 0 ? player.durationMs : take.durationMs;
    const at = player.positionMs;
    this.el.takePosition.value = clockTime(at);
    this.el.takeDuration.value = clockTime(total);
    this.el.takeScrub.value = String(total > 0 ? Math.round((at / total) * 1_000) : 0);

    const sounding = player.playing !== null;
    this.el.takePlayIcon.setAttribute('d', sounding ? PAUSE_ICON : PLAY_ICON);
    const label = sounding ? 'Pause' : 'Play';
    this.el.takePlay.title = label;
    this.el.takePlay.setAttribute('aria-label', label);
  }

  private renderTakes(): void {
    const all = this.runtime.takes.list();
    const takes = this.el.takesKeptOnly.checked
      ? all.filter((take) => take.shelf === 'kept')
      : all;
    this.el.takesEmpty.hidden = takes.length > 0;
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

      row.append(name, hear, look, promote, save, remove);
      this.el.takesList.append(row);
    }
  }

  private exportTake(id: string): void {
    const take = this.runtime.takes.find(id);
    if (take === null) {
      return;
    }
    // Written from the events, never stored as bytes: the performance is the
    // kept thing and the file is derived from it, the same way the printed
    // MusicXML is derived from an `Exercise`.
    const bytes = writeMidiFile(take.events, { trackName: takeName(take.savedAtMs) });
    this.runtime.files.save(`${takeFileName(take.savedAtMs)}.mid`, bytes, 'audio/midi');
  }

  /**
   * Follows the knob the reader taught, and says what it is doing.
   *
   * The knob writes through the slider rather than past it, so the two can
   * never disagree about how loud the piano is - a hidden second volume is
   * how a reader ends up turning something that changes nothing.
   */
  private bindVolumeKnob(): void {
    const knob = this.runtime.volumeKnob;

    this.subscriptions.push(
      knob.events.on('moved', ({ value }) => {
        this.el.instrumentVolume.value = String(Math.round(value * 100));
        this.applyVolumes(true);
      }),
    );

    this.subscriptions.push(
      knob.events.on('learned', ({ controller }) => {
        this.runtime.settings.saveAudio({
          ...this.runtime.settings.currentAudio,
          volumeController: controller,
        });
        this.describeKnob();
      }),
    );

    this.subscriptions.push(
      knob.events.on('heard', ({ controller, value, positions }) => {
        // Says what arrived even when it is the wrong control, so silence
        // here means the keyboard sent nothing rather than that the app did.
        this.el.knobStatus.textContent =
          positions < 2
            ? `Heard CC ${controller} at ${Math.round(value * 100)}% — keep turning.`
            : `Heard CC ${controller} at ${Math.round(value * 100)}% — nearly there.`;
      }),
    );

    this.subscriptions.push(knob.events.on('listeningChanged', () => this.describeKnob()));
    this.describeKnob();
  }

  private describeKnob(): void {
    const knob = this.runtime.volumeKnob;
    this.el.learnKnob.dataset['listening'] = String(knob.isLearning);
    if (knob.isLearning) {
      this.el.learnKnob.textContent = 'Cancel';
      this.el.knobStatus.textContent =
        'Turn the knob you want to use. Nothing here means it sends no MIDI.';
      return;
    }
    if (knob.controller !== null) {
      this.el.learnKnob.textContent = 'Forget';
      this.el.knobStatus.textContent = `Knob CC ${knob.controller} sets the note volume.`;
      return;
    }
    this.el.learnKnob.textContent = 'Use a knob';
    this.el.knobStatus.textContent = 'Teach the app which control on your keyboard to follow.';
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
    const running =
      status === 'running' || status === 'counting-in' || controller.isListening;
    const paused = status === 'paused' || controller.isListeningPaused;
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
   */
  private somethingIsPlaying(): boolean {
    const controller = this.runtime.controller;
    return (
      this.isPlaying ||
      this.isPreviewing ||
      controller.isListening ||
      controller.isListeningPaused
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
    // His: hold the screen while there is a run, and let it go when there is
    // not - including while one is paused, because a reader who has stopped to
    // work something out is still at the keyboard. Asked here because this is
    // already the one place that answers "is anything happening to the music",
    // and a second answer to that question could only disagree with this one.
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
    }
  }

  private renderResult(score: SessionScore, report: PerformanceReport): void {
    this.showVerdict(true);
    // Offered only when the run actually left something to work on; a clean
    // reading has no worst bars, and a button that says otherwise is noise.
    this.el.drill.hidden = worstPassage(report) === null;
    this.el.result.replaceChildren();

    const gradeElement = this.doc.createElement('div');
    gradeElement.className = 'result__grade';
    gradeElement.textContent = score.grade;
    this.el.result.append(gradeElement);

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
  }

  /**
   * Draws the last run into its sheet and puts it up.
   *
   * Built on opening rather than kept: a roll is a few thousand elements, and
   * the reader who never presses the button should not be paying for them.
   */
  private showTheRoll(): void {
    this.theTakeShowing = null;
    if (this.theRoll() === null) {
      return;
    }
    this.stopTheRoll();
    this.rollAtMs = 0;
    this.drawTheRollInto();
    this.el.sheetRoll.hidden = false;
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
    const share = shareOfTheRun(roll, this.headIsAtMs());
    this.el.rollMapHead.style.left = `${(share * 100).toFixed(3)}%`;
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
  private zoomTheRollByWheel(event: WheelEvent): void {
    const drawn = this.el.rollBody.firstElementChild;
    // Left to the browser where the reader asked for a sideways scroll, which
    // is what a held shift has always meant on a wheel.
    if (!(drawn instanceof HTMLElement) || event.shiftKey) {
      return;
    }
    event.preventDefault();
    const was = Number(this.el.rollZoom.value);
    const now = zoomAfterWheel(was, event.deltaY, LEAST_ZOOM, MOST_ZOOM);
    if (now === was) {
      return;
    }
    this.el.rollZoom.value = String(now);
    this.holdTheZoomAround(drawn, event.clientX, was, now);
  }

  /**
   * Applies a zoom and scrolls so the music under a point stays under it.
   *
   * The widths are the drawing's, so the column of key names is taken off both
   * - it does not stretch with the music and would drag the anchor sideways by
   * its own width every time.
   */
  private holdTheZoomAround(drawn: HTMLElement, clientX: number, was: number, now: number): void {
    // Everything read before anything is written, and nothing read afterwards.
    // A width or a scroll position asked for *after* a zoom has been written
    // makes the browser lay the whole drawing out there and then - six thousand
    // elements of it on a run of his City of Tears - so a moving pinch that
    // read after each write paid for one of those on every move of a finger
    // instead of one before each frame. The width that follows from the new
    // zoom is arithmetic, so nothing has to be asked twice.
    const widths = this.theRunsWidths(drawn);
    const scrolledTo = drawn.scrollLeft;
    const at = clientX - drawn.getBoundingClientRect().left - widths.keysPx;

    this.applyTheZoom();

    const widened = (widths.wholeWidePx * now) / was;
    const to =
      widths.wholeWidePx > 0 && at >= 0
        ? scrollAfterZoom(scrolledTo, at, widths.wholeWidePx, widened)
        : scrolledTo;
    drawn.scrollLeft = to;
    this.showTheWindow(theWindowOnTheRun(to, widths.viewWidePx, widened));
  }

  /**
   * Draws the box saying which part of the run is on the screen.
   *
   * Hidden rather than guessed at where nothing has been laid out: a box
   * claiming to show the whole run at the moment the reader can see none of it
   * is worse than no box.
   */
  private sayWhereTheViewIs(): void {
    const drawn = this.el.rollBody.firstElementChild;
    const widths = drawn instanceof HTMLElement ? this.theRunsWidths(drawn) : null;
    this.showTheWindow(
      widths === null
        ? null
        : theWindowOnTheRun(widths.scrolledToPx, widths.viewWidePx, widths.wholeWidePx),
    );
  }

  /**
   * Draws the box, given where it goes.
   *
   * Told rather than measuring for itself, so that a zoom can hand it numbers
   * it has already read and nothing reads the drawing after writing to it.
   */
  private showTheWindow(window: { readonly fromShare: number; readonly widthShare: number } | null): void {
    this.el.rollMapWindow.hidden = window === null;
    if (window === null) {
      return;
    }
    this.el.rollMapWindow.style.left = `${(window.fromShare * 100).toFixed(3)}%`;
    this.el.rollMapWindow.style.width = `${(window.widthShare * 100).toFixed(3)}%`;
  }

  /** Scrolls the drawing to the part of the run a finger is on the map. */
  private showTheRunWhereItWasPointedAt(event: PointerEvent): void {
    const drawn = this.el.rollBody.firstElementChild;
    const box = this.el.rollMap.getBoundingClientRect();
    if (!(drawn instanceof HTMLElement) || box.width <= 0) {
      return;
    }
    const share = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const widths = this.theRunsWidths(drawn);
    const to = scrollForTheWindowAt(share, widths.viewWidePx, widths.wholeWidePx);
    drawn.scrollLeft = to;
    this.showTheWindow(theWindowOnTheRun(to, widths.viewWidePx, widths.wholeWidePx));
  }

  /**
   * The drawing measured as music, with the column of key names left out.
   *
   * The names are a sticky column inside the same scroller, so they are part of
   * its width and no part of the run. Counted in, the strip and the drawing
   * measure two different wholes - and two wholes is exactly what put marks on
   * the map at places the run never reached.
   */
  private theRunsWidths(drawn: HTMLElement): {
    readonly keysPx: number;
    readonly scrolledToPx: number;
    readonly viewWidePx: number;
    readonly wholeWidePx: number;
  } {
    const keys = drawn.querySelector<HTMLElement>('.roll__keys')?.clientWidth ?? 0;
    return {
      keysPx: keys,
      scrolledToPx: drawn.scrollLeft,
      viewWidePx: drawn.clientWidth - keys,
      wholeWidePx: drawn.scrollWidth - keys,
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
    const roll = this.theRoll();
    const controller = this.runtime.controller;
    if (roll === null) {
      return;
    }
    const ticks = theMusicsPlaceAt(roll, this.headIsAtMs());
    const bar = ticks === null ? null : controller.theBarAtTicks(ticks);
    if (bar === null) {
      return;
    }
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
    this.stopTheRoll();
    this.el.sheetRollOptions.hidden = true;
    this.el.sheetRoll.hidden = true;
    this.runtime.controller.cursorToStart();
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
    return this.theTakeShowing ?? this.runtime.controller.lastRoll;
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
    this.theTakeShowing = rollOfTheTake(take);
    this.rollAtMs = 0;
    this.drawTheRollInto();
    this.el.sheetRoll.hidden = false;
    this.sayWhatWouldBePractised();
    this.sayWhatThePictureIsOf();
  }

  /**
   * Puts away what only a run can answer.
   *
   * A recording has no passage to practise and no bar to point at - it is not
   * of this score, or of any - and keeping it again would file a second copy of
   * something already in the list.
   */
  private sayWhatThePictureIsOf(): void {
    const aTake = this.theTakeShowing !== null;
    this.el.rollKeep.hidden = aTake;
    this.el.rollFrom.disabled = aTake;
    this.el.rollTo.disabled = aTake;
    this.el.rollTitle.textContent = aTake ? 'A recording' : 'What you played';
    if (aTake) {
      this.el.rollPractise.disabled = true;
      this.el.rollPassageWhat.textContent = 'Free playing: no bars to practise.';
    }
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
    this.el.rollBody.replaceChildren(
      drawTheRoll({
        roll,
        barLabel: this.barNamer(),
        grid: this.theRollsGrid(),
        ghosts: this.theNotesAskedFor(),
        slips: this.el.rollSlips.checked,
        keepsTime: this.theRunKeptTime(),
      }),
    );
    this.applyTheZoom();
    this.el.rollMap.replaceChildren(
      drawTheMap(roll),
      this.el.rollMapWindow,
      this.el.rollMapHead,
    );
    // The drawing is thrown away and built again on every redraw, so the watch
    // on its scrolling goes with it and there is nothing to unsubscribe.
    const drawn = this.el.rollBody.firstElementChild;
    if (drawn instanceof HTMLElement) {
      drawn.addEventListener('scroll', () => {
        this.sayWhereTheViewIs();
      });
    }
    this.sayWhereTheViewIs();
    this.describeTheRoll();
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
   */
  private theNotesAskedFor(): readonly RollGhost[] {
    const timeline = this.runtime.controller.currentTimeline;
    if (!this.el.rollGhosts.checked || timeline === null) {
      return [];
    }
    const hand = this.runtime.controller.settings.handStaff;
    const asked: RollGhost[] = [];
    for (const step of timeline.steps) {
      for (const midi of expectedFor(step, hand)) {
        asked.push({
          midi,
          fromTicks: step.onsetTicks,
          untilTicks: step.onsetTicks + step.durationTicks,
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
    this.selectedTakeId = null;
    this.describeTakeTransport();
    // From wherever the head stands, which is nought unless the reader has put
    // it somewhere - and the clicks behind it are already spent.
    this.rollClicksSent = clicksBefore(roll, this.rollAtMs, this.theRollsGrid());
    this.runtime.takePlayer.setSpeed(this.theRollsSpeed());
    this.runtime.takePlayer.play(RUN_ROLL_ID, rollAsEvents(roll), this.rollAtMs);
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

  private stopTheRoll(): void {
    if (this.runtime.takePlayer.playing === RUN_ROLL_ID) {
      this.runtime.takePlayer.stop();
    }
    // Back to the beginning, which is what stopping means and pausing does not.
    this.rollAtMs = 0;
    this.rollClicksSent = 0;
    this.letTheRollTickGo();
    this.describeTheRoll();
  }

  private letTheRollTickGo(): void {
    if (this.rollTick !== null) {
      clearInterval(this.rollTick);
      this.rollTick = null;
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
    const box = grid.getBoundingClientRect();
    const tapped = timeFromTap(event.clientX - box.left, Number(this.el.rollZoom.value));
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
    this.rollAtMs = at;
    this.rollClicksSent = clicksBefore(roll, at, this.theRollsGrid());
    if (this.runtime.takePlayer.playing === RUN_ROLL_ID) {
      this.runtime.takePlayer.seek(at);
    }
    this.describeTheRoll();
  }

  private followTheRoll(): void {
    const player = this.runtime.takePlayer;
    // The sound before the drawing, as a take's own following does: a frame
    // late on screen is nothing, a frame late in the ear is a gap.
    player.pump();
    if (player.finished) {
      player.stop();
    }
    // Something else took the player over, or it has run out. Either way this
    // is no longer following anything.
    // Something else took the player over, or it ran out. Either way this is no
    // longer following anything - but the head stays where it got to, because
    // the reader is about to look at that place.
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
  private soundTheBeat(positionMs: number): void {
    const roll = this.theRoll();
    if (roll === null || !this.el.rollClick.checked) {
      return;
    }
    // The window is a tenth of a second of the *run's* time, which at a slow
    // speed reaches further ahead in the room than that. Harmless, and left
    // alone deliberately: the metronome takes back whatever has not sounded
    // when the reader stops, so placing a click early costs nothing, and a
    // second conversion here would be a rule with no consequence to test.
    const rate = this.runtime.takePlayer.speed;
    const due = clicksUpTo(
      roll,
      this.rollClicksSent,
      positionMs + ROLL_CLICK_LEAD_MS,
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
    this.rollClicksSent += due.length;
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
    this.el.rollPlayIcon.setAttribute('d', sounding ? PAUSE_ICON : PLAY_ICON);
    const label = sounding ? 'Pause' : 'Play';
    this.el.rollPlay.title = label;
    this.el.rollPlay.setAttribute('aria-label', label);
    // Nothing to stop where the head is already at the beginning and silent.
    this.el.rollStop.disabled = !sounding && this.rollAtMs === 0;

    const drawn = this.el.rollBody.firstElementChild;
    if (!(drawn instanceof HTMLElement)) {
      return;
    }
    drawn.classList.toggle('roll--sounding', sounding);
    // The head is a place, not a sign that something is playing: it stands
    // where the reader put it or where the sound stopped, and it is there from
    // the moment the drawing opens. His: "чи можливо мати курсор завжди? Бо він
    // наразі пропадає як тільки робиться stop".
    drawn.style.setProperty('--roll-at', (this.headIsAtMs() / 1000).toFixed(3));
    this.sayWhereTheHeadIs();
    if (!sounding) {
      return;
    }
    const head = drawn.querySelector<HTMLElement>('.roll__head');
    if (head === null) {
      return;
    }
    const to = keepTheHeadInView(head.offsetLeft, drawn.scrollLeft, drawn.clientWidth);
    if (to !== null) {
      drawn.scrollLeft = to;
    }
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

  /** Remembers where a pinch started from, or forgets there is one. */
  private beginAPinch(): void {
    const span = this.theFingerSpan();
    this.pinchedFrom =
      span === null
        ? null
        : { ...span, zoom: Number(this.el.rollZoom.value), row: this.rollRowPx };
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
    this.el.rollZoom.value = String(asked.zoom);
    this.rollRowPx = asked.row;
    const drawn = this.el.rollBody.firstElementChild;
    // Held around the point between the fingers, for the same reason the wheel
    // is held around the pointer: a pinch aimed at a bar means that bar.
    if (drawn instanceof HTMLElement && asked.zoom !== was) {
      this.holdTheZoomAround(drawn, this.theMiddleOfTheFingers(), was, asked.zoom);
      return;
    }
    this.applyTheZoom();
  }

  /** Where two fingers are, across the screen, as one number. */
  private theMiddleOfTheFingers(): number {
    const [first, second] = [...this.rollFingers.values()];
    return ((first?.x ?? 0) + (second?.x ?? first?.x ?? 0)) / 2;
  }

  /** How fast the reader has asked to hear the run, as a multiple of its own time. */
  private theRollsSpeed(): number {
    const percent = Number(this.el.rollSpeed.value);
    return Number.isFinite(percent) && percent > 0 ? percent / 100 : 1;
  }

  private applyTheZoom(): void {
    const roll = this.el.rollBody.firstElementChild;
    if (roll instanceof HTMLElement) {
      roll.style.setProperty('--roll-second', `${this.el.rollZoom.value}px`);
      roll.style.setProperty('--roll-row', `${this.rollRowPx}px`);
    }
    // The window is a share of a drawing that has just changed width.
    this.sayWhereTheViewIs();
  }

  /**
   * The run as a strip, one cell per bar, above the numbers that explain it.
   *
   * Drawn rather than written, and drawn first: a reader who has just played
   * badly is not going to read a table, and this is the one part of the
   * report that says where to look next.
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

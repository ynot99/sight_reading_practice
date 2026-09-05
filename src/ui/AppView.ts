import type { AppRuntime } from '../composition/createApp.js';
import { FLOW_MODE_ID } from '../application/modes/FlowMode.js';
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
import { PLAYED_NOTE_DISPLAYS, type PlayedNoteDisplay } from '../application/PracticeController.js';
import type { PassageHistory } from '../application/PracticeHistory.js';
import type { DrawnPassage, PassageEnd, ScorePageState } from '../application/ports/IScoreRenderer.js';
import { measureCount } from '../domain/model/Exercise.js';
import type { LadderStep } from '../application/ladder/PracticeLadder.js';
import { elementAt } from '../shared/asserts.js';
import { readBackup } from '../application/Backup.js';
import { calibrationExercise } from '../domain/generation/calibrationExercise.js';

/**
 * How long the page waits after the last tempo press before re-engraving.
 *
 * Long enough that a run of presses costs one redraw rather than one each,
 * short enough that a single press still looks immediate.
 */
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
const CLICK_WHEN_LABELS: Readonly<Record<ClickWhen, string>> = {
  always: 'All the way through',
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

/** What the drawer's marks button says it is doing, in words. */
const MARKS_TITLES: Record<PlayedNoteDisplay, string> = {
  live: 'Colour the notes as I play',
  'at-end': 'Colour the notes when the run ends',
  hidden: 'Never colour the notes',
};

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
const LISTEN_ICON = 'M4 9v6h4l5 4V5L8 9H4zm12-.5a4.5 4.5 0 0 1 0 7v-2a2.5 2.5 0 0 0 0-3v-2z';
/**
 * The same speaker with a pause beside it, and with a play beside it.
 *
 * Three states rather than two, since the button holds the performance now
 * instead of throwing it away: nothing playing, playing, held. The speaker
 * stays in all three so the button is recognisably the same one - what
 * changes is what pressing it will do next, which is what an icon on a
 * transport says.
 */
const PAUSE_LISTEN_ICON = 'M4 9v6h4l5 4V5L8 9H4z M16 8h2v8h-2z M20 8h2v8h-2z';
const RESUME_LISTEN_ICON = 'M4 9v6h4l5 4V5L8 9H4z M16 8l6 4-6 4z';
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
  /** Pending return of the pill to what the run is saying. */
  /** Which take the transport is showing, playing or not. */
  private selectedTakeId: string | null = null;
  /** Follows a sounding take, so the slider says where it has got to. */
  private takeTick: ReturnType<typeof setInterval> | null = null;
  /** Whether the passage markers are on the page, which a tap turns over. */
  private passageMarkersWanted = true;
  /** Pending redraw of the keep pill: the counter, and the silence closing. */
  private silenceWatch: ReturnType<typeof setTimeout> | null = null;
  private lastDrainAtMs: number | null = null;
  private healthPaceMs = SETTLE_MS;
  /** Whether the reader has already been given this page. */
  private hasLooked = false;
  /** A promotion waiting to be reported alongside the run that earned it. */
  private lastLadderMove: { readonly to: LadderStep; readonly direction: 'up' | 'down' } | null =
    null;

  private readonly el: {
    app: HTMLElement;
    focusBar: HTMLElement;
    score: HTMLElement;
    scoreCover: HTMLElement;
    scoreCoverText: HTMLElement;
    scoreCard: HTMLElement;
    scoreCount: HTMLElement;
    scoreVerdict: HTMLElement;
    focusPlay: HTMLButtonElement;
    focusPlayIcon: SVGPathElement;
    focusHandle: HTMLButtonElement;
    focusHealth: HTMLElement;
    focusListenIcon: SVGPathElement;
    focusHands: HTMLButtonElement;
    focusSurvival: HTMLButtonElement;
    focusImmediate: HTMLButtonElement;
    focusMetronome: HTMLButtonElement;
    focusRepeat: HTMLButtonElement;
    focusCursor: HTMLButtonElement;
    focusWait: HTMLButtonElement;
    focusMarks: HTMLButtonElement;
    focusPages: HTMLButtonElement;
    focusSmaller: HTMLButtonElement;
    focusBigger: HTMLButtonElement;
    focusZoom: HTMLOutputElement;
    focusHandLeft: SVGElement;
    focusHandRight: SVGElement;
    focusHealthFill: HTMLElement;
    survival: HTMLInputElement;
    immediateStart: HTMLInputElement;
    focusDrawer: HTMLElement;
    focusRow: HTMLElement;
    focusSpeed: HTMLElement;
    focusStop: HTMLButtonElement;
    focusRewind: HTMLButtonElement;
    focusListen: HTMLButtonElement;
    focusSlower: HTMLButtonElement;
    focusFaster: HTMLButtonElement;
    focusTempo: HTMLOutputElement;
    focusNext: HTMLButtonElement;
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
    sheetSettings: HTMLElement;
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
    sheetConfirm: HTMLElement;
    confirmText: HTMLElement;
    confirmYes: HTMLButtonElement;
    confirmNo: HTMLButtonElement;
    scoresList: HTMLUListElement;
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
    mode: HTMLSelectElement;
    modeDescription: HTMLElement;
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
    showCursor: HTMLInputElement;
    strictTiming: HTMLInputElement;
    sampleLoading: HTMLSelectElement;
    sampleLoadingHint: HTMLElement;
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
      scoreVerdict: requireElement(doc, 'score-verdict'),
      focusPlay: requireElement(doc, 'focus-play'),
      focusPlayIcon: requireElement(doc, 'focus-play-icon'),
      focusHandle: requireElement(doc, 'focus-handle'),
      focusHealth: requireElement(doc, 'focus-health'),
      focusListenIcon: requireElement(doc, 'focus-listen-icon'),
      focusHands: requireElement(doc, 'focus-hands'),
      focusSurvival: requireElement(doc, 'focus-survival'),
      focusImmediate: requireElement(doc, 'focus-immediate'),
      focusMetronome: requireElement(doc, 'focus-metronome'),
      focusRepeat: requireElement(doc, 'focus-repeat'),
      focusCursor: requireElement(doc, 'focus-cursor'),
      focusWait: requireElement(doc, 'focus-wait'),
      focusMarks: requireElement(doc, 'focus-marks'),
      focusPages: requireElement(doc, 'focus-pages'),
      focusSmaller: requireElement(doc, 'focus-smaller'),
      focusBigger: requireElement(doc, 'focus-bigger'),
      focusZoom: requireElement(doc, 'focus-zoom'),
      focusHandLeft: requireElement(doc, 'focus-hand-left'),
      focusHandRight: requireElement(doc, 'focus-hand-right'),
      focusHealthFill: requireElement(doc, 'focus-health-fill'),
      survival: requireElement(doc, 'survival'),
      immediateStart: requireElement(doc, 'immediate-start'),
      focusDrawer: requireElement(doc, 'focus-drawer'),
      focusRow: requireElement(doc, 'focus-row'),
      focusSpeed: requireElement(doc, 'focus-speed'),
      focusStop: requireElement(doc, 'focus-stop'),
      focusRewind: requireElement(doc, 'focus-rewind'),
      focusListen: requireElement(doc, 'focus-listen'),
      focusSlower: requireElement(doc, 'focus-slower'),
      focusFaster: requireElement(doc, 'focus-faster'),
      focusTempo: requireElement(doc, 'focus-tempo'),
      focusNext: requireElement(doc, 'focus-next'),
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
      sheetSettings: requireElement(doc, 'sheet-settings'),
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
      sheetConfirm: requireElement(doc, 'sheet-confirm'),
      confirmText: requireElement(doc, 'confirm-text'),
      confirmYes: requireElement(doc, 'confirm-yes'),
      confirmNo: requireElement(doc, 'confirm-no'),
      scoresList: requireElement(doc, 'scores-list'),
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
      mode: requireElement(doc, 'mode'),
      modeDescription: requireElement(doc, 'mode-description'),
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
      showCursor: requireElement(doc, 'show-cursor'),
      strictTiming: requireElement(doc, 'strict-timing'),
      sampleLoading: requireElement(doc, 'sample-loading'),
      sampleLoadingHint: requireElement(doc, 'sample-loading-hint'),
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
    this.syncControlsFromSettings();
    this.updateButtons('idle');
    this.describeTake();
    this.renderTakes();
    this.bindVolumeKnob();
    // The database answers later than the page draws, so the list arrives
    // when it arrives rather than holding the trainer up for it.
    void this.runtime.scores.load().then(() => this.renderScores());
    await this.runtime.controller.loadNewExercise();
    void this.runtime.webMidi.connect();
  }

  dispose(): void {
    this.cancelPreview();
    if (this.tempoRedraw !== null) {
      clearTimeout(this.tempoRedraw);
      this.tempoRedraw = null;
    }
    if (this.takeTick !== null) {
      clearInterval(this.takeTick);
      this.takeTick = null;
    }
    if (this.silenceWatch !== null) {
      clearTimeout(this.silenceWatch);
      this.silenceWatch = null;
    }
    this.runtime.takePlayer.stop();
    for (const unsubscribe of [...this.subscriptions, ...this.sessionSubscriptions]) {
      unsubscribe();
    }
    this.subscriptions.length = 0;
    this.sessionSubscriptions = [];
  }

  /**
   * Reads the chosen file and practises it.
   *
   * Whatever the importer had to drop is shown rather than swallowed: the
   * model is narrower than MusicXML, and a reader who is not told what was
   * lost will blame the trainer for the difference.
   */
  private async openChosenScore(): Promise<void> {
    const file = this.el.scoreFile.files?.[0];
    // Cleared so that choosing the same file twice still fires a change.
    this.el.scoreFile.value = '';
    if (file === undefined) {
      return;
    }

    try {
      const { exercise, warnings } = await this.runtime.importer.readFile(
        await file.arrayBuffer(),
        file.name,
      );
      await this.runtime.controller.openScore(exercise);
      // Opening a piece can put the passage back to the two ends, and the
      // boxes in the sheet are the same setting seen from another chair.
      this.syncControlsFromSettings();
      // Kept on the way in, so the file is chosen from the disk once and
      // afterwards the piece is simply there.
      await this.runtime.scores.keep(exercise, Date.now());
      this.renderScores();
      // What the file did not bring with it goes to the console and no
      // further. It is worth keeping - several faults here were found through
      // one of these - and it is not worth a line across the music: the page
      // says which piece opened by printing its name in the corner.
      for (const warning of warnings) {
        reportToTheConsole(`Opening ${exercise.title}:`, warning.detail);
      }
    } catch (error) {
      reportToTheConsole('Could not open the chosen file.', error);
      this.sayInTheMiddle(
        error instanceof Error ? `Could not open that file. ${error.message}` : 'Could not open that file.',
      );
    }
  }

  /** Lists the kept scores, each openable and each removable. */
  private renderScores(): void {
    const scores = this.runtime.scores.list();
    this.el.scoresEmpty.hidden = scores.length > 0;
    this.el.scoresClear.disabled = scores.length === 0;
    this.el.scoresList.replaceChildren();

    for (const score of scores) {
      const row = this.doc.createElement('li');
      const name = this.doc.createElement('span');
      name.className = 'takes__name';
      name.textContent = `${score.title} · ${score.bars} bars`;
      name.title = score.title;

      const open = this.doc.createElement('button');
      open.type = 'button';
      open.textContent = 'Open';
      this.listen(open, 'click', () => {
        void this.openKeptScore(score.id, score.title);
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

      row.append(name, open, remove);
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
   * The markers report bars of *what is engraved*, which may already be a
   * passage - so the first drawn bar's own number is what turns them back
   * into bars of the piece. A drag that reached past the edge comes through
   * as an index outside the engraving, which is how a passage grows back
   * wider than the page it was chosen on; the controller clamps it to the
   * piece, because nothing on the page can.
   */
  private async choosePassageFrom(drawn: DrawnPassage): Promise<void> {
    const controller = this.runtime.controller;
    const firstDrawn = controller.barNumber(0);
    const before = controller.settings;
    const passage = controller.choosePassage(
      firstDrawn + drawn.fromMeasureIndex,
      firstDrawn + drawn.toMeasureIndex,
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
    const { rangeFromBar, rangeToBar } = controller.settings;
    const bar = controller.barNumber(measureIndex);

    if (controller.beginsAt === 0) {
      this.beginAt(measureIndex);
      return;
    }
    if (rangeFromBar === null) {
      this.narrowTo(bar, null);
      return;
    }
    if (rangeToBar === null) {
      // Either way round, because a reader who holds behind the near end
      // meant the two bars they pointed at and not an empty passage.
      this.narrowTo(Math.min(rangeFromBar, bar), Math.max(rangeFromBar, bar));
      return;
    }
    // All three are set, so this is a fresh start rather than a fourth mark.
    controller.updateSettings({ rangeFromBar: null, rangeToBar: null });
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
    const first = exercise.firstBarNumber;
    const last = first + Math.max(0, measureCount(exercise) - 1);
    const { rangeFromBar, rangeToBar } = controller.settings;
    const bar = end === 'from' ? (rangeFromBar ?? first) : (rangeToBar ?? last);
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
    const first = bars.firstBarNumber;
    const last = Math.max(0, measureCount(bars) - 1);
    this.runtime.renderer.showPassage({
      fromMeasureIndex: rangeFromBar === null ? 0 : Math.min(Math.max(rangeFromBar - first, 0), last),
      toMeasureIndex: rangeToBar === null ? last : Math.min(Math.max(rangeToBar - first, 0), last),
      repeating: controller.settings.repeatRange,
      movable: !this.isPlaying,
    });
    // Only where the reader has actually moved it. A place at the beginning
    // of the passage is where a run starts anyway, and a mark saying so
    // would be furniture standing on top of the marker that already says it.
    const begins = controller.currentTimeline?.at(controller.beginsAt) ?? null;
    const atThePassageStart =
      begins === null || begins.measureIndex <= (rangeFromBar === null ? 0 : rangeFromBar - first);
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
      this.describeListening();
      return;
    }
    if (controller.isListeningPaused) {
      controller.resumeListening();
      this.describeListening();
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
    this.describeListening();
  }

  private describeListening(): void {
    const listening = this.runtime.controller.isListening;
    const held = this.runtime.controller.isListeningPaused;
    // Three answers, because there are three states: nothing playing, playing,
    // and held. "Pause listening" rather than "Pause" alone for the reason
    // the old label said "Stop listening" - the run's own Pause sits beside
    // it, and one word would not say which of the two this is.
    const label = listening ? 'Pause listening' : held ? 'Resume listening' : 'Listen';
    // The fullscreen one is a picture: writing the label into it would throw
    // the icon away, which is exactly what it used to do.
    this.el.focusListen.setAttribute('aria-label', label);
    this.el.focusListen.title = label;
    this.el.focusListenIcon.setAttribute(
      'd',
      listening ? PAUSE_LISTEN_ICON : held ? RESUME_LISTEN_ICON : LISTEN_ICON,
    );
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
      this.el.mode,
      this.runtime.modes.list().map((mode) => ({ value: mode.id, label: mode.label })),
      this.runtime.controller.settings.modeId,
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

    this.listen(this.el.mode, 'change', () => {
      controller.updateSettings({ modeId: this.el.mode.value });
      // The mode brings its own default grading, so the panel has to catch up.
      this.syncControlsFromSettings();
      this.describeMode();
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
    });

    this.listen(this.el.showCursor, 'change', () => {
      controller.updateSettings({ showCursor: this.el.showCursor.checked });
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

    this.listen(this.el.survival, 'change', () => {
      controller.updateSettings({ survival: this.el.survival.checked });
      this.renderHealth(controller.health);
    });

    this.listen(this.el.rhythmOnly, 'change', () => {
      controller.updateSettings({ rhythmOnly: this.el.rhythmOnly.checked });
    });

    this.listen(this.el.immediateStart, 'change', () => {
      controller.updateSettings({ immediateStart: this.el.immediateStart.checked });
      this.syncControlsFromSettings();
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
      void this.askToDelete('Delete every kept score?').then((yes) => {
        if (yes) {
          void this.runtime.scores.forget().then(() => this.renderScores());
        }
      });
    });

    this.listen(this.el.takesClear, 'click', () => {
      void this.askToDelete('Delete every kept take?').then((yes) => {
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

    this.listen(this.el.focusPlay, 'click', () => {
      this.togglePlayback();
    });

    this.listen(this.el.focusStop, 'click', () => {
      this.stopEverything();
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
      controller.cursorToStart();
      this.showPassageMarkers();
    });

    this.listen(this.el.focusWait, 'click', () => {
      // The mode, from the stand: whether the music waits for the reader or
      // walks on without them is the choice they most often want to change
      // with the instrument already in front of them.
      const waiting = controller.settings.modeId === WAIT_MODE_ID;
      controller.updateSettings({ modeId: waiting ? FLOW_MODE_ID : WAIT_MODE_ID });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.focusCursor, 'click', () => {
      controller.updateSettings({ showCursor: !controller.settings.showCursor });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.focusPages, 'click', () => {
      controller.updateSettings({ pagedScore: !controller.settings.pagedScore });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.focusMarks, 'click', () => {
      // All three, cycled. "When do I see what I played" is one question with
      // three answers, and answering it in the settings while a switch here
      // answered two thirds of it was two controls for one decision - the
      // reader who chose "at the end" downstairs found a switch up here that
      // could only turn it into something else.
      const at = PLAYED_NOTE_DISPLAYS.indexOf(controller.settings.playedNotes);
      controller.updateSettings({
        playedNotes: elementAt(PLAYED_NOTE_DISPLAYS, (at + 1) % PLAYED_NOTE_DISPLAYS.length),
      });
      this.syncControlsFromSettings();
    });

    this.listen(this.el.focusSurvival, 'click', () => {
      controller.updateSettings({ survival: !controller.settings.survival });
      this.syncControlsFromSettings();
      this.renderHealth(controller.health);
    });

    this.listen(this.el.focusImmediate, 'click', () => {
      controller.updateSettings({ immediateStart: !controller.settings.immediateStart });
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

    this.listen(this.el.focusListen, 'click', () => {
      void this.toggleListening();
    });

    this.listen(this.el.focusNext, 'click', () => {
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
   * Puts the verdict up in the middle of the page, or takes it away.
   *
   * Contents are still {@link renderResult}'s; this only decides whether the
   * panel holding them is on screen. Away on a tap, and away whenever the
   * music starts again - which is Start, a performance, or a repeat coming
   * round - because a grade over the bar being played is a grade in the way.
   */
  private showVerdict(shown: boolean): void {
    this.el.scoreVerdict.hidden = !shown;
    this.syncCard();
  }

  /**
   * The card is only there when it has something in it.
   *
   * Empty it would still be a transparent sheet over the whole score, and
   * although it lets touches through, `hidden` is the honest way to say a
   * thing is not on the page - and the one every test can read.
   */
  private syncCard(): void {
    this.el.scoreCard.hidden = this.el.scoreCount.hidden && this.el.scoreVerdict.hidden;
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
    this.cancelPreview();
    controller.stop();
    if (controller.isListening || controller.isListeningPaused) {
      controller.stopListening();
      this.describeListening();
    }
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
    const running = this.runtime.controller.survivalRuns;
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
    // The score's own numbers, which is what the reader reads off the page.
    // A count would be the right answer only for a piece beginning at bar
    // one, and the boxes would refuse the bar numbers printed on every other
    // one - an excerpt starting at forty has no bar 3 to type.
    for (const box of [this.el.focusFrom, this.el.focusTo]) {
      box.min = String(firstBar);
      box.max = String(lastBar);
    }
    this.el.focusBars.value = firstBar === 1 ? `of ${total}` : `${firstBar}–${lastBar}`;

    const narrowed = rangeFromBar !== null || rangeToBar !== null;
    this.el.focusHandle.dataset['passage'] = String(narrowed);
    // Narrowed to something, and not in the middle of reading it: giving the
    // whole piece back mid-run would move what is being graded.
    this.el.focusWhole.disabled = !narrowed || this.isPlaying;
  }

  private bindControllerEvents(): void {
    const { controller } = this.runtime;

    this.subscriptions.push(
      controller.events.on('exerciseLoaded', ({ exercise }) => {
        this.hasLooked = false;
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
        this.describeListening();
      }),
    );

    this.subscriptions.push(
      controller.events.on('sessionCreated', ({ session }) => {
        this.bindSession(session);
        // A run takes the pulse from a playback, so the button has to admit it.
        this.describeListening();
        // Every way of starting a run arrives here - the button, the repeat
        // coming round, a drill - so the verdict on the last one is put away
        // in one place rather than at each of them.
        this.showVerdict(false);
      }),
    );

    this.subscriptions.push(
      controller.events.on('sessionDiscarded', () => {
        // Asked rather than assumed: this fires on the way into starting a
        // run as well as on the way out of one, and the answer differs.
        this.updateButtons(controller.session?.status ?? 'idle');
        this.describeListening();
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
        this.describeListening();
      }),
    );

    this.subscriptions.push(
      // Nothing to restart here any more. A repeating performance goes round
      // inside itself and never finishes, so this fires only when the music
      // has actually run out - and starting it again from here is where the
      // gap on a repeat came from: a stop and a start re-anchor the metronome
      // to the audio clock a fixed lead ahead of now.
      controller.playbackEvents.on('finished', () => {
        this.describeListening();
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
      }),
      // The number itself and nowhere else. It was said in words beside the
      // bar as well, which is the same count twice - and the words were in
      // the corner of an eye that is on the music.
      session.events.on('countIn', ({ beatsRemaining }) => {
        this.showCount(beatsRemaining);
      }),
      session.events.on('statusChanged', ({ status }) => {
        // Restarting is the view's job, not the controller's: tearing a
        // session down from inside its own event is how re-entrancy bugs are
        // made, and the application layer has no timer to defer with.
        if (status === 'completed' && this.runtime.controller.settings.repeatRange) {
          setTimeout(() => {
            if (this.runtime.controller.settings.repeatRange) {
              this.runtime.controller.start();
            }
          }, 0);
        }
      }),
      session.events.on('stepEntered', () => {
        // The count has run out by the time there is a step to play, and the
        // count-in emits no final zero to say so.
        this.showCount(null);
      }),
      // Where the music is, which under the metronome goes on moving through a
      // held note - the step is what the reader has to play, not where the
      // count has got to, and the pill was asked the second question.
      session.events.on('positionChanged', (at) => {
        this.followMusic(at);
      }),
      session.events.on('finished', ({ report, score }) => {
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
          ? `Bridge: ${device ?? 'no keyboard'}`
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
          this.runtime.sustain?.setSustain(event.down);
          this.renderPedal(event.down);
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
    this.el.mode.value = settings.modeId;
    this.el.focusWait.setAttribute('aria-pressed', String(settings.modeId === WAIT_MODE_ID));
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
    this.el.showCursor.checked = settings.showCursor;
    this.el.strictTiming.checked = settings.strictTiming;
    this.el.focusPages.setAttribute('aria-pressed', String(settings.pagedScore));
    this.runtime.renderer.setPaged(settings.pagedScore);
    // A display decision, so it is answered in the stylesheet: the marks
    // themselves are the same either way, and what was measured about a press
    // does not change because the reader wants stricter colours.
    this.el.score.dataset['strict'] = String(settings.strictTiming);
    this.el.focusCursor.setAttribute('aria-pressed', String(settings.showCursor));
    this.el.focusMarks.dataset['marks'] = settings.playedNotes;
    this.el.focusMarks.title = MARKS_TITLES[settings.playedNotes];
    this.el.focusMarks.setAttribute('aria-label', MARKS_TITLES[settings.playedNotes]);
    this.el.pitchClass.checked = settings.pitchClassOnly;
    this.el.rhythmOnly.checked = settings.rhythmOnly;
    this.el.survival.checked = settings.survival;
    this.el.focusSurvival.setAttribute('aria-pressed', String(settings.survival));
    this.el.immediateStart.checked = settings.immediateStart;
    this.el.focusImmediate.setAttribute('aria-pressed', String(settings.immediateStart));
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

    this.describeMode();
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
      this.el.ladderDown.disabled = false;
      this.el.ladderUp.disabled = false;
      return;
    }
    this.el.ladderStep.textContent = `${step.label} · ${ladder.positionOf(step.id)} of ${ladder.list().length}`;
    this.el.ladderDescription.textContent = step.description;
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
    const playing = recorder.pendingEvents > 0;
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
        this.el.sheetScores,
        [this.el.focusScores],
        () => this.renderScores(),
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
  private askToDelete(question: string): Promise<boolean> {
    this.el.confirmText.textContent = question;
    this.el.sheetConfirm.hidden = false;

    return new Promise<boolean>((resolve) => {
      const answer = (yes: boolean): void => {
        this.el.sheetConfirm.hidden = true;
        this.el.confirmYes.removeEventListener('click', onYes);
        this.el.confirmNo.removeEventListener('click', onNo);
        this.el.sheetConfirm.removeEventListener('click', onOutside);
        resolve(yes);
      };
      const onYes = (): void => answer(true);
      const onNo = (): void => answer(false);
      const onOutside = (event: Event): void => {
        if (event.target === this.el.sheetConfirm) {
          answer(false);
        }
      };

      this.el.confirmYes.addEventListener('click', onYes);
      this.el.confirmNo.addEventListener('click', onNo);
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

      row.append(name, hear, promote, save, remove);
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

  private describeMode(): void {
    const mode = this.runtime.modes.get(this.runtime.controller.settings.modeId);
    this.el.modeDescription.textContent = mode.requiresMetronome
      ? 'The cursor moves with the beat and your timing is scored.'
      : 'The cursor waits until you play the notes on the page.';
  }

  /** True while a run is under way, paused included: it is still that run. */
  private get isPlaying(): boolean {
    const status = this.runtime.controller.session?.status;
    return status === 'running' || status === 'counting-in' || status === 'paused';
  }

  private updateButtons(status: SessionStatus): void {
    const running = status === 'running' || status === 'counting-in';
    const paused = status === 'paused';
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
    this.el.focusNext.disabled = running || paused;
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
  private applyPlayingChrome(): void {
    const playing = this.isPlaying || this.isPreviewing;
    this.el.focusBar.dataset['playing'] = String(playing);
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

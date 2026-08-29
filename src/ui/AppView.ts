import type { AppRuntime } from '../composition/createApp.js';
import type { PracticeSession } from '../application/session/PracticeSession.js';
import type { SessionStatus } from '../application/session/SessionState.js';
import type { MidiConnectionStatus, MidiEvent } from '../application/ports/IMidiSource.js';
import {
  CLICK_DROPOUTS,
  CLICK_PATTERNS,
  dropoutCycleBars,
  type ClickDropout,
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
import { PLAYED_NOTE_DISPLAYS, type PlayedNoteDisplay } from '../application/PracticeController.js';
import type { PassageHistory } from '../application/PracticeHistory.js';
import type { LadderStep } from '../application/ladder/PracticeLadder.js';
import type { Unsubscribe } from '../shared/EventEmitter.js';
import { fillSelect, requireElement } from './dom.js';
import { FocusMode } from './FocusMode.js';

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
const DROPOUT_LABELS: Readonly<Record<ClickDropout, string>> = {
  never: 'Never',
  'cycle-1': '1 bar on, 1 off',
  'cycle-2': '2 bars on, 2 off',
  'cycle-4': '4 bars on, 4 off',
  'count-in-only': 'Only the count-in',
};

function dropoutDescription(dropout: ClickDropout, countInBars: number): string {
  if (dropout === 'never') {
    return 'The click plays all the way through.';
  }
  if (dropout === 'count-in-only') {
    // Chosen together with no count-in, this asks for silence and nothing
    // else, which is worth saying rather than leaving to be discovered.
    return countInBars > 0
      ? 'You are given the tempo and then left with it for the whole run.'
      : 'There is no count-in to give you the tempo, so nothing will sound at all.';
  }
  const bars = dropoutCycleBars(dropout) ?? 0;
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

function readClickDropout(value: string): ClickDropout {
  return CLICK_DROPOUTS.includes(value as ClickDropout) ? (value as ClickDropout) : 'never';
}

function readSampleLoading(value: string): SampleLoading {
  return SAMPLE_LOADING_MODES.includes(value as SampleLoading)
    ? (value as SampleLoading)
    : 'lazy';
}

/** Entries kept in the note log; older ones fall off the end. */
const MAX_LOG_ENTRIES = 40;

/** How far from the newest entry still counts as following along. */
const FOLLOW_THRESHOLD_PX = 8;

/** Matches what the stored-settings codec will accept back. */
const MIN_BARS = 1;
const MAX_BARS = 32;

const STATUS_LABELS: Readonly<Record<SessionStatus, string>> = {
  idle: 'Idle',
  'counting-in': 'Counting in…',
  running: 'Playing',
  paused: 'Paused',
  completed: 'Finished',
  aborted: 'Stopped',
};

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

function formatNotes(midiNotes: readonly number[]): string {
  return midiNotes.length === 0 ? '—' : midiNotes.map((midi) => midiToLabel(midi)).join(' ');
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
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
  private totalSteps = 1;
  private previewTimer: ReturnType<typeof setInterval> | null = null;
  private focusMode: FocusMode | null = null;
  private lastStatus: SessionStatus = 'idle';
  private lastPosition = '';
  /** The step now due, kept so blind mode can be turned off mid-run. */
  private lastExpected: readonly number[] = [];
  /** Whether the reader has already been given this page. */
  private hasLooked = false;
  /** A promotion waiting to be reported alongside the run that earned it. */
  private lastLadderMove: { readonly to: LadderStep; readonly direction: 'up' | 'down' } | null =
    null;

  private readonly el: {
    app: HTMLElement;
    focus: HTMLButtonElement;
    focusBar: HTMLElement;
    focusStatus: HTMLElement;
    score: HTMLElement;
    scoreCover: HTMLElement;
    scoreCoverText: HTMLElement;
    focusPlay: HTMLButtonElement;
    focusStop: HTMLButtonElement;
    focusListen: HTMLButtonElement;
    focusNext: HTMLButtonElement;
    focusExit: HTMLButtonElement;
    exerciseTitle: HTMLElement;
    midiStatus: HTMLElement;
    bridgeStatus: HTMLElement;
    pedalStatus: HTMLElement;
    connectMidi: HTMLButtonElement;
    midiInput: HTMLSelectElement;
    midiHint: HTMLElement;
    sessionStatus: HTMLElement;
    expectedRow: HTMLElement;
    expected: HTMLElement;
    position: HTMLElement;
    progress: HTMLProgressElement;
    log: HTMLUListElement;
    result: HTMLElement;
    drill: HTMLButtonElement;
    listen: HTMLButtonElement;
    listenHand: HTMLSelectElement;
    keepTake: HTMLButtonElement;
    takes: HTMLElement;
    takesList: HTMLUListElement;
    takesClear: HTMLButtonElement;
    openScore: HTMLButtonElement;
    scoreFile: HTMLInputElement;
    importNotice: HTMLElement;
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
    rangeFrom: HTMLInputElement;
    rangeTo: HTMLInputElement;
    repeatRange: HTMLInputElement;
    preview: HTMLInputElement;
    previewValue: HTMLOutputElement;
    countIn: HTMLInputElement;
    countInValue: HTMLOutputElement;
    tolerance: HTMLInputElement;
    toleranceValue: HTMLOutputElement;
    zoom: HTMLInputElement;
    zoomValue: HTMLOutputElement;
    showPlayed: HTMLSelectElement;
    showPlayedDescription: HTMLElement;
    readAhead: HTMLSelectElement;
    readAheadDescription: HTMLElement;
    showCursor: HTMLInputElement;
    blindMode: HTMLInputElement;
    sampleLoading: HTMLSelectElement;
    sampleLoadingHint: HTMLElement;
    metronomeVolume: HTMLInputElement;
    metronomeVolumeValue: HTMLOutputElement;
    instrumentVolume: HTMLInputElement;
    instrumentVolumeValue: HTMLOutputElement;
    learnKnob: HTMLButtonElement;
    knobStatus: HTMLElement;
    metronomeMuted: HTMLInputElement;
    pitchClass: HTMLInputElement;
    rhythmOnly: HTMLInputElement;
    audioFeedback: HTMLInputElement;
    computerKeyboard: HTMLInputElement;
    newExercise: HTMLButtonElement;
    start: HTMLButtonElement;
    pause: HTMLButtonElement;
    stop: HTMLButtonElement;
  };

  constructor(runtime: AppRuntime, doc: Document = document) {
    this.runtime = runtime;
    this.doc = doc;
    this.el = {
      app: requireElement(doc, 'app'),
      focus: requireElement(doc, 'focus'),
      focusBar: requireElement(doc, 'focus-bar'),
      focusStatus: requireElement(doc, 'focus-status'),
      score: requireElement(doc, 'score'),
      scoreCover: requireElement(doc, 'score-cover'),
      scoreCoverText: requireElement(doc, 'score-cover-text'),
      focusPlay: requireElement(doc, 'focus-play'),
      focusStop: requireElement(doc, 'focus-stop'),
      focusListen: requireElement(doc, 'focus-listen'),
      focusNext: requireElement(doc, 'focus-next'),
      focusExit: requireElement(doc, 'focus-exit'),
      exerciseTitle: requireElement(doc, 'exercise-title'),
      midiStatus: requireElement(doc, 'midi-status'),
      bridgeStatus: requireElement(doc, 'bridge-status'),
      pedalStatus: requireElement(doc, 'pedal-status'),
      connectMidi: requireElement(doc, 'connect-midi'),
      midiInput: requireElement(doc, 'midi-input'),
      midiHint: requireElement(doc, 'midi-hint'),
      sessionStatus: requireElement(doc, 'session-status'),
      expectedRow: requireElement(doc, 'expected-row'),
      expected: requireElement(doc, 'expected'),
      position: requireElement(doc, 'position'),
      progress: requireElement(doc, 'progress'),
      log: requireElement(doc, 'log'),
      result: requireElement(doc, 'result'),
      drill: requireElement(doc, 'drill'),
      listen: requireElement(doc, 'listen'),
      listenHand: requireElement(doc, 'listen-hand'),
      keepTake: requireElement(doc, 'keep-take'),
      takes: requireElement(doc, 'takes'),
      takesList: requireElement(doc, 'takes-list'),
      takesClear: requireElement(doc, 'takes-clear'),
      openScore: requireElement(doc, 'open-score'),
      scoreFile: requireElement(doc, 'score-file'),
      importNotice: requireElement(doc, 'import-notice'),
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
      rangeFrom: requireElement(doc, 'range-from'),
      rangeTo: requireElement(doc, 'range-to'),
      repeatRange: requireElement(doc, 'repeat-range'),
      preview: requireElement(doc, 'preview'),
      previewValue: requireElement(doc, 'preview-value'),
      countIn: requireElement(doc, 'count-in'),
      countInValue: requireElement(doc, 'count-in-value'),
      tolerance: requireElement(doc, 'tolerance'),
      toleranceValue: requireElement(doc, 'tolerance-value'),
      zoom: requireElement(doc, 'zoom'),
      zoomValue: requireElement(doc, 'zoom-value'),
      showPlayed: requireElement(doc, 'show-played'),
      showPlayedDescription: requireElement(doc, 'show-played-description'),
      readAhead: requireElement(doc, 'read-ahead'),
      readAheadDescription: requireElement(doc, 'read-ahead-description'),
      showCursor: requireElement(doc, 'show-cursor'),
      blindMode: requireElement(doc, 'blind-mode'),
      sampleLoading: requireElement(doc, 'sample-loading'),
      sampleLoadingHint: requireElement(doc, 'sample-loading-hint'),
      metronomeVolume: requireElement(doc, 'metronome-volume'),
      metronomeVolumeValue: requireElement(doc, 'metronome-volume-value'),
      instrumentVolume: requireElement(doc, 'instrument-volume'),
      instrumentVolumeValue: requireElement(doc, 'instrument-volume-value'),
      learnKnob: requireElement(doc, 'learn-knob'),
      knobStatus: requireElement(doc, 'knob-status'),
      metronomeMuted: requireElement(doc, 'metronome-muted'),
      pitchClass: requireElement(doc, 'pitch-class'),
      rhythmOnly: requireElement(doc, 'rhythm-only'),
      audioFeedback: requireElement(doc, 'audio-feedback'),
      computerKeyboard: requireElement(doc, 'computer-keyboard'),
      newExercise: requireElement(doc, 'new-exercise'),
      start: requireElement(doc, 'start'),
      pause: requireElement(doc, 'pause'),
      stop: requireElement(doc, 'stop'),
    };
  }

  async initialize(): Promise<void> {
    this.populateSelects();
    this.bindControls();
    this.bindFocusMode();
    this.bindControllerEvents();
    this.bindMidi();
    this.syncControlsFromSettings();
    this.updateButtons('idle');
    this.describeTake();
    this.renderTakes();
    this.bindVolumeKnob();
    await this.runtime.controller.loadNewExercise();
    void this.runtime.webMidi.connect();
  }

  dispose(): void {
    this.cancelPreview();
    this.focusMode?.dispose();
    this.focusMode = null;
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
      const { exercise, warnings } = await this.runtime.importer.readFile(await file.arrayBuffer());
      await this.runtime.controller.openScore(exercise);
      const dropped = warnings.map((warning) => warning.detail).join(' ');
      this.showImportNotice(
        dropped === '' ? `Opened ${exercise.title}.` : `Opened ${exercise.title}. ${dropped}`,
      );
    } catch (error) {
      this.showImportNotice(
        error instanceof Error ? `Could not open that file. ${error.message}` : 'Could not open that file.',
      );
    }
  }

  private showImportNotice(message: string): void {
    this.el.importNotice.textContent = message;
    this.el.importNotice.hidden = false;
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
    if (controller.isListening) {
      controller.stopListening();
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
    controller.listen();
    this.describeListening();
  }

  private describeListening(): void {
    // The same words in both bars: "Stop" alone would read as the run's Stop,
    // which sits right beside it in the pill.
    const label = this.runtime.controller.isListening ? 'Stop listening' : 'Listen';
    this.el.listen.textContent = label;
    this.el.focusListen.textContent = label;
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
      CLICK_DROPOUTS.map((choice) => ({ value: choice, label: DROPOUT_LABELS[choice] })),
      this.runtime.controller.settings.clickDropout,
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

    this.listen(this.el.listen, 'click', () => {
      void this.toggleListening();
    });

    this.listen(this.el.listenHand, 'change', () => {
      const hand = this.el.listenHand.value;
      controller.updateSettings({ handStaff: hand === '' ? null : Number.parseInt(hand, 10) });
    });

    this.listen(this.el.openScore, 'click', () => {
      this.el.scoreFile.click();
    });

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
      controller.updateSettings({ clickDropout: readClickDropout(this.el.dropout.value) });
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
      controller.updateSettings({ tempoBpm: Number.parseInt(this.el.tempo.value, 10) });
      // Same seed: identical notes, only the printed tempo mark changes.
      void this.reload(false);
    });

    for (const input of [this.el.rangeFrom, this.el.rangeTo]) {
      this.listen(input, 'change', () => {
        controller.updateSettings({
          rangeFromBar: barValue(this.el.rangeFrom),
          rangeToBar: barValue(this.el.rangeTo),
        });
        void this.reload(false);
      });
    }

    this.listen(this.el.drill, 'click', () => {
      const passage = controller.drillWorstPassage();
      if (passage === null) {
        this.el.drill.hidden = true;
        return;
      }
      this.syncControlsFromSettings();
      void this.reload(false);
    });

    this.listen(this.el.repeatRange, 'change', () => {
      controller.updateSettings({ repeatRange: this.el.repeatRange.checked });
    });

    this.listen(this.el.countIn, 'input', () => {
      this.el.countInValue.value = this.el.countIn.value;
      controller.updateSettings({ countInBars: Number.parseInt(this.el.countIn.value, 10) });
      // "Only the count-in" means something different once there is not one.
      this.describeDropout();
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
      this.el.showPlayedDescription.textContent =
        PLAYED_NOTE_DESCRIPTIONS[readPlayedNotes(this.el.showPlayed.value)];
    });

    this.listen(this.el.readAhead, 'change', () => {
      controller.updateSettings({ readAheadSteps: parseReadAhead(this.el.readAhead.value) });
      this.el.readAheadDescription.textContent = READ_AHEAD_DESCRIPTIONS[this.el.readAhead.value] ?? '';
    });

    this.listen(this.el.showCursor, 'change', () => {
      controller.updateSettings({ showCursor: this.el.showCursor.checked });
    });

    this.listen(this.el.blindMode, 'change', () => {
      controller.updateSettings({ blindMode: this.el.blindMode.checked });
      // Mid-run the panel would otherwise hold the last answer until the next
      // step arrives, which in Wait mode may be never.
      this.renderExpected();
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

    this.listen(this.el.metronomeMuted, 'change', () => {
      controller.updateSettings({ metronomeMuted: this.el.metronomeMuted.checked });
    });

    this.listen(this.el.rhythmOnly, 'change', () => {
      controller.updateSettings({ rhythmOnly: this.el.rhythmOnly.checked });
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

    this.listen(this.el.keepTake, 'click', () => {
      this.keepTake();
    });

    this.listen(this.el.takesClear, 'click', () => {
      this.runtime.takes.forget();
      this.renderTakes();
    });

    this.listen(this.el.newExercise, 'click', () => {
      void this.reload(true);
    });

    this.listen(this.el.start, 'click', () => {
      this.beginRun();
    });

    this.listen(this.el.preview, 'input', () => {
      this.el.previewValue.value = this.el.preview.value;
      controller.updateSettings({ previewSeconds: Number.parseInt(this.el.preview.value, 10) });
      // Asking for a look while staring at the page would be asking for
      // nothing, so the page goes back under until the look is taken.
      this.applyScoreCover();
    });

    this.listen(this.el.pause, 'click', () => {
      const status = controller.session?.status;
      if (status === 'paused') {
        controller.resume();
      } else {
        controller.pause();
      }
    });

    this.listen(this.el.stop, 'click', () => {
      // Stopping during the look means the reader has seen enough of it.
      this.cancelPreview();
      controller.stop();
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
  private bindFocusMode(): void {
    const { controller } = this.runtime;

    this.focusMode = new FocusMode({
      root: this.el.app,
      doc: this.doc,
      onChange: (active) => {
        this.el.focusBar.hidden = !active;
        this.el.focus.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
        // The score just changed width; re-engrave it for the new space.
        controller.refreshScore();
        this.updateButtons(this.lastStatus);
      },
    });

    this.listen(this.el.focus, 'click', () => {
      void this.focusMode?.toggle();
    });

    this.listen(this.el.focusExit, 'click', () => {
      void this.focusMode?.exit();
    });

    this.listen(this.el.focusPlay, 'click', () => {
      this.togglePlayback();
    });

    this.listen(this.el.focusStop, 'click', () => {
      controller.stop();
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
    this.clearLog();
    this.el.result.hidden = true;
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
      const message = `Look at it… ${left}`;
      this.el.sessionStatus.textContent = message;
      this.renderFocusStatus(message);
    };
    show();
    // Stop is how the reader says they have seen enough, so it has to be
    // reachable during the look - a phase they cannot leave is a trap.
    this.el.start.disabled = true;
    this.el.stop.disabled = false;
    this.el.focusStop.disabled = false;
    this.previewTimer = setInterval(() => {
      left -= 1;
      if (left > 0) {
        show();
        return;
      }
      this.cancelPreview();
      this.runtime.controller.start();
    }, 1000);
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

  /** Ends a look in progress, whether it ran out or the reader stopped it. */
  private cancelPreview(): void {
    if (this.previewTimer === null) {
      return;
    }
    clearInterval(this.previewTimer);
    this.previewTimer = null;
    this.updateButtons(this.runtime.controller.session?.status ?? 'idle');
  }

  /** True while the reader is being given their look at the page. */
  get isPreviewing(): boolean {
    return this.previewTimer !== null;
  }

  /**
   * The space bar starts and pauses, rather than scrolling the page.
   *
   * Ignored while a control has focus: space is how a button is pressed and
   * how a checkbox is ticked, and a number box needs it even less disturbed.
   */
  private bindSpaceBar(): void {
    const handler = (event: KeyboardEvent): void => {
      if (event.code !== 'Space' || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isFormControl(this.doc.activeElement)) {
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

  private renderFocusStatus(text: string): void {
    this.el.focusStatus.textContent = text;
  }

  /**
   * Writes the "Play now" row, or takes it away entirely.
   *
   * Blank text is not enough on its own: a row headed "Play now" showing a
   * dash reads as *nothing is due*, and the count of notes left standing
   * would still be half an answer. Blind mode removes the row and the text
   * both, so there is nothing to glance at and nothing left in the document
   * for a screen reader to find.
   */
  private renderExpected(): void {
    const blind = this.runtime.controller.settings.blindMode;
    this.el.expectedRow.hidden = blind;
    this.el.expected.textContent = blind ? '' : formatNotes(this.lastExpected);
  }

  private bindControllerEvents(): void {
    const { controller } = this.runtime;

    this.subscriptions.push(
      controller.events.on('exerciseLoaded', ({ exercise, timeline }) => {
        this.totalSteps = Math.max(1, timeline.length);
        this.el.exerciseTitle.textContent = `${exercise.title} · ${timeline.noteCount} notes · seed ${exercise.metadata.seed.toString(16)}`;
        this.el.progress.max = this.totalSteps;
        this.el.progress.value = 0;
        this.hasLooked = false;
        this.applyScoreCover();
        this.lastExpected = [];
        this.renderExpected();
        this.el.position.textContent = '—';
      }),
    );

    this.subscriptions.push(
      controller.events.on('sessionCreated', ({ session }) => {
        this.bindSession(session);
        // A run takes the pulse from a playback, so the button has to admit it.
        this.describeListening();
      }),
    );

    this.subscriptions.push(
      controller.playbackEvents.on('finished', () => {
        this.describeListening();
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
        this.el.result.hidden = false;
        this.el.result.textContent = `${context}: ${error.message}`;
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
        this.el.sessionStatus.textContent = STATUS_LABELS[status];
        this.renderFocusStatus(
          status === 'running' && this.lastPosition !== ''
            ? this.lastPosition
            : STATUS_LABELS[status],
        );
        this.updateButtons(status);
      }),
      session.events.on('countIn', ({ beatsRemaining }) => {
        this.el.sessionStatus.textContent = `Counting in… ${beatsRemaining}`;
        this.renderFocusStatus(`Counting in… ${beatsRemaining}`);
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
      session.events.on('stepEntered', ({ step, expectedMidi }) => {
        this.lastExpected = expectedMidi;
        this.renderExpected();
        this.lastPosition =`bar ${step.measureIndex + 1} · beat ${step.beat.toFixed(2).replace(/\.00$/, '')}`;
        this.el.position.textContent = this.lastPosition;
        this.el.progress.value = step.index;
        this.renderFocusStatus(this.lastPosition);
      }),
      session.events.on('noteJudged', ({ midi, verdict, remaining }) => {
        this.appendLog(midi, verdict, remaining);
      }),
      session.events.on('finished', ({ report, score }) => {
        this.el.progress.value = this.totalSteps;
        this.lastExpected = [];
        this.renderExpected();
        this.lastPosition = '';
        // In fullscreen the result panel is hidden, so the pill carries it.
        this.renderFocusStatus(`${score.grade} · ${percent(score.overall)}`);
        this.renderResult(score, report);
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

  /** Shows that the pedal was seen, which is half of trusting that it works. */
  private renderPedal(down: boolean): void {
    this.el.pedalStatus.hidden = false;
    this.el.pedalStatus.textContent = down ? 'Ped. down' : 'Ped.';
    this.el.pedalStatus.className = down ? 'pill pill--connected' : 'pill pill--idle';
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
      this.clearLog();
      this.el.result.hidden = true;
    } catch (error) {
      this.el.result.hidden = false;
      this.el.result.textContent =
        error instanceof Error ? error.message : 'Failed to build an exercise.';
    }
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
    this.el.scoring.value = settings.scoringId;
    this.el.scoringDescription.textContent = SCORING_DESCRIPTIONS[settings.scoringId] ?? '';
    this.el.key.value = keyValue(settings.key);
    this.el.timeSignature.value = settings.timeSignature.toString();
    this.el.measures.value = String(settings.measures);
    this.el.measuresValue.value = String(settings.measures);
    this.el.tempo.value = String(settings.tempoBpm);
    this.el.tempoValue.value = String(settings.tempoBpm);
    this.el.listenHand.value = settings.handStaff === null ? '' : String(settings.handStaff);
    this.el.click.value = settings.clickPattern;
    this.el.clickDescription.textContent = CLICK_DESCRIPTIONS[settings.clickPattern];
    this.el.dropout.value = settings.clickDropout;
    this.describeDropout();
    this.el.rangeFrom.value = settings.rangeFromBar === null ? '' : String(settings.rangeFromBar);
    this.el.rangeTo.value = settings.rangeToBar === null ? '' : String(settings.rangeToBar);
    this.el.repeatRange.checked = settings.repeatRange;
    this.el.preview.value = String(settings.previewSeconds);
    this.el.previewValue.value = String(settings.previewSeconds);
    this.el.countIn.value = String(settings.countInBars);
    this.el.countInValue.value = String(settings.countInBars);
    this.el.tolerance.value = String(settings.matchToleranceMs);
    this.el.toleranceValue.value = String(settings.matchToleranceMs);
    this.el.zoom.value = String(Math.round(settings.zoom * 100));
    this.el.zoomValue.value = this.el.zoom.value;
    this.el.showPlayed.value = settings.playedNotes;
    this.el.showPlayedDescription.textContent = PLAYED_NOTE_DESCRIPTIONS[settings.playedNotes];
    this.el.readAhead.value = readAheadValue(settings.readAheadSteps);
    this.el.readAheadDescription.textContent =
      READ_AHEAD_DESCRIPTIONS[this.el.readAhead.value] ?? '';
    this.el.showCursor.checked = settings.showCursor;
    this.el.blindMode.checked = settings.blindMode;
    this.renderExpected();
    this.el.metronomeMuted.checked = settings.metronomeMuted;
    this.el.pitchClass.checked = settings.pitchClassOnly;
    this.el.rhythmOnly.checked = settings.rhythmOnly;
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
      settings.clickDropout,
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

  /** How much playing the button is offering to keep, if any. */
  private describeTake(): void {
    const ms = this.runtime.recorder.takeDurationMs;
    const playing = this.runtime.recorder.pendingEvents > 0;
    this.el.keepTake.disabled = !playing;
    this.el.keepTake.textContent = '';
    const dot = this.doc.createElement('span');
    dot.className = 'button__dot';
    dot.setAttribute('aria-hidden', 'true');
    this.el.keepTake.append(dot, this.doc.createTextNode(playing ? `Keep ${clockTime(ms)}` : 'Keep take'));
    this.el.keepTake.title = playing
      ? 'Keeps what you have just played, back to the last pause.'
      : 'Play something and this keeps it.';
  }

  private renderTakes(): void {
    const takes = this.runtime.takes.list();
    this.el.takes.hidden = takes.length === 0;
    this.el.takesList.replaceChildren();

    for (const take of takes) {
      const row = this.doc.createElement('li');
      const name = this.doc.createElement('span');
      name.className = 'takes__name';
      name.textContent = `${takeName(take.savedAtMs)} · ${clockTime(take.durationMs)} · ${take.noteCount} notes`;

      const save = this.doc.createElement('button');
      save.type = 'button';
      save.textContent = 'MIDI';
      save.title = 'Save this take as a MIDI file';
      this.listen(save, 'click', () => this.exportTake(take.id));

      const remove = this.doc.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = 'Delete this take';
      remove.setAttribute('aria-label', `Delete the take from ${takeName(take.savedAtMs)}`);
      this.listen(remove, 'click', () => {
        this.runtime.takes.remove(take.id);
        this.renderTakes();
      });

      row.append(name, save, remove);
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

  private updateButtons(status: SessionStatus): void {
    this.lastStatus = status;
    const running = status === 'running' || status === 'counting-in';
    const paused = status === 'paused';

    this.el.start.disabled = running || paused;
    this.el.pause.disabled = !running && !paused;
    this.el.pause.textContent = paused ? 'Resume' : 'Pause';
    this.el.stop.disabled = !running && !paused;
    this.el.newExercise.disabled = running || paused;

    this.el.focusPlay.textContent = running ? 'Pause' : paused ? 'Resume' : 'Start';
    this.el.focusStop.disabled = !running && !paused;
    this.el.focusNext.disabled = running || paused;
    this.el.focus.disabled = false;
  }

  private appendLog(midi: number, verdict: string, remaining: readonly number[]): void {
    const item = this.doc.createElement('li');
    item.dataset['verdict'] = verdict;
    const left = this.doc.createElement('span');
    left.textContent = `${midiToLabel(midi)} ${verdict}`;
    const right = this.doc.createElement('span');
    // "still: C4 E4" names the rest of the chord, which is the same answer the
    // panel was hiding; the note the reader themselves played may stay.
    right.textContent =
      remaining.length > 0 && !this.runtime.controller.settings.blindMode
        ? `still: ${formatNotes(remaining)}`
        : '';
    item.append(left, right);

    // Newest first, and the view follows it - unless the reader has scrolled
    // down to look at something, in which case leave them where they are.
    const wasFollowing = this.el.log.scrollTop <= FOLLOW_THRESHOLD_PX;
    this.el.log.prepend(item);
    while (this.el.log.childElementCount > MAX_LOG_ENTRIES) {
      this.el.log.lastElementChild?.remove();
    }
    if (wasFollowing) {
      this.el.log.scrollTop = 0;
    }
  }

  private clearLog(): void {
    this.el.log.replaceChildren();
  }

  private renderResult(score: SessionScore, report: PerformanceReport): void {
    this.el.result.hidden = false;
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
      ['Tendency', describeTendency(report.timing.meanDeviationMs)],
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
    element: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ): void {
    element.addEventListener(type, handler);
    this.subscriptions.push(() => {
      element.removeEventListener(type, handler);
    });
  }
}

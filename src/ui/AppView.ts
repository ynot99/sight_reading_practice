import type { AppRuntime } from '../composition/createApp.js';
import type { PracticeSession } from '../application/session/PracticeSession.js';
import type { SessionStatus } from '../application/session/SessionState.js';
import type { MidiConnectionStatus, MidiEvent } from '../application/ports/IMidiSource.js';
import { CLICK_PATTERNS, type ClickPattern } from '../application/ports/IMetronome.js';
import type { SessionScore } from '../domain/scoring/IScoringStrategy.js';
import {
  SAMPLE_LOADING_MODES,
  type SampleLoading,
} from '../application/ports/IPitchPlayer.js';
import type { PerformanceReport } from '../domain/scoring/PerformanceReport.js';
import { COMMON_KEYS, KeySignature } from '../domain/model/KeySignature.js';
import { TimeSignature } from '../domain/model/TimeSignature.js';
import { midiToLabel } from '../domain/model/Pitch.js';
import { worstPassage } from '../domain/scoring/troubleSpots.js';
import type { PassageHistory } from '../application/PracticeHistory.js';
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
 * Dropout cycles offered, as bars of click followed by as many silent ones.
 *
 * Symmetric on purpose: an equal stretch of silence is the standard exercise,
 * and it makes the setting one number the reader can reason about.
 */
const DROPOUT_CHOICES: readonly { readonly bars: number; readonly label: string }[] = [
  { bars: 0, label: 'Never' },
  { bars: 1, label: '1 bar on, 1 off' },
  { bars: 2, label: '2 bars on, 2 off' },
  { bars: 4, label: '4 bars on, 4 off' },
];

function dropoutDescription(bars: number): string {
  return bars <= 0
    ? 'The click plays all the way through.'
    : `The click leaves you alone for ${bars} bar${bars === 1 ? '' : 's'} at a time. ` +
      'You find out on its return whether you drifted.';
}

const CLICK_DESCRIPTIONS: Readonly<Record<ClickPattern, string>> = {
  downbeat: 'One click per bar. You keep the pulse inside it.',
  pulse: 'The felt beat: two dotted quarters in 6/8, four quarters in 4/4.',
  division: 'Halves the beat, or thirds it in compound time.',
  subdivision: 'The finest click. Useful for sixteenths, busy everywhere else.',
};

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
  private focusMode: FocusMode | null = null;
  private lastStatus: SessionStatus = 'idle';
  private lastPosition = '';

  private readonly el: {
    app: HTMLElement;
    focus: HTMLButtonElement;
    focusBar: HTMLElement;
    focusStatus: HTMLElement;
    focusPlay: HTMLButtonElement;
    focusStop: HTMLButtonElement;
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
    expected: HTMLElement;
    position: HTMLElement;
    progress: HTMLProgressElement;
    log: HTMLUListElement;
    result: HTMLElement;
    drill: HTMLButtonElement;
    listen: HTMLButtonElement;
    listenHand: HTMLSelectElement;
    openScore: HTMLButtonElement;
    scoreFile: HTMLInputElement;
    importNotice: HTMLElement;
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
    countIn: HTMLInputElement;
    countInValue: HTMLOutputElement;
    tolerance: HTMLInputElement;
    toleranceValue: HTMLOutputElement;
    zoom: HTMLInputElement;
    zoomValue: HTMLOutputElement;
    showPlayed: HTMLInputElement;
    fadePassed: HTMLInputElement;
    showCursor: HTMLInputElement;
    sampleLoading: HTMLSelectElement;
    sampleLoadingHint: HTMLElement;
    metronomeVolume: HTMLInputElement;
    metronomeVolumeValue: HTMLOutputElement;
    instrumentVolume: HTMLInputElement;
    instrumentVolumeValue: HTMLOutputElement;
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
      focusPlay: requireElement(doc, 'focus-play'),
      focusStop: requireElement(doc, 'focus-stop'),
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
      expected: requireElement(doc, 'expected'),
      position: requireElement(doc, 'position'),
      progress: requireElement(doc, 'progress'),
      log: requireElement(doc, 'log'),
      result: requireElement(doc, 'result'),
      drill: requireElement(doc, 'drill'),
      listen: requireElement(doc, 'listen'),
      listenHand: requireElement(doc, 'listen-hand'),
      openScore: requireElement(doc, 'open-score'),
      scoreFile: requireElement(doc, 'score-file'),
      importNotice: requireElement(doc, 'import-notice'),
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
      countIn: requireElement(doc, 'count-in'),
      countInValue: requireElement(doc, 'count-in-value'),
      tolerance: requireElement(doc, 'tolerance'),
      toleranceValue: requireElement(doc, 'tolerance-value'),
      zoom: requireElement(doc, 'zoom'),
      zoomValue: requireElement(doc, 'zoom-value'),
      showPlayed: requireElement(doc, 'show-played'),
      fadePassed: requireElement(doc, 'fade-passed'),
      showCursor: requireElement(doc, 'show-cursor'),
      sampleLoading: requireElement(doc, 'sample-loading'),
      sampleLoadingHint: requireElement(doc, 'sample-loading-hint'),
      metronomeVolume: requireElement(doc, 'metronome-volume'),
      metronomeVolumeValue: requireElement(doc, 'metronome-volume-value'),
      instrumentVolume: requireElement(doc, 'instrument-volume'),
      instrumentVolumeValue: requireElement(doc, 'instrument-volume-value'),
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
    await this.runtime.controller.loadNewExercise();
    void this.runtime.webMidi.connect();
  }

  dispose(): void {
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
    controller.listen();
    this.describeListening();
  }

  private describeListening(): void {
    this.el.listen.textContent = this.runtime.controller.isListening ? 'Stop listening' : 'Listen';
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
      DROPOUT_CHOICES.map((choice) => ({ value: String(choice.bars), label: choice.label })),
      String(this.runtime.controller.settings.dropoutBars),
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
      controller.updateSettings({ dropoutBars: Number.parseInt(this.el.dropout.value, 10) });
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

    this.listen(this.el.showPlayed, 'change', () => {
      controller.updateSettings({ showPlayedNotes: this.el.showPlayed.checked });
    });

    this.listen(this.el.fadePassed, 'change', () => {
      controller.updateSettings({ fadePassedNotes: this.el.fadePassed.checked });
    });

    this.listen(this.el.showCursor, 'change', () => {
      controller.updateSettings({ showCursor: this.el.showCursor.checked });
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
      this.audioFeedbackEnabled = this.el.audioFeedback.checked;
      if (!this.audioFeedbackEnabled) {
        this.runtime.pitchPlayer.stopAll();
      }
    });

    this.listen(this.el.computerKeyboard, 'change', () => {
      if (this.el.computerKeyboard.checked) {
        this.runtime.computerKeyboard.enable();
      } else {
        this.runtime.computerKeyboard.disable();
      }
    });

    this.listen(this.el.newExercise, 'click', () => {
      void this.reload(true);
    });

    this.listen(this.el.start, 'click', () => {
      this.clearLog();
      this.el.result.hidden = true;
      controller.start();
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
    this.clearLog();
    this.el.result.hidden = true;
    controller.start();
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

  private bindControllerEvents(): void {
    const { controller } = this.runtime;

    this.subscriptions.push(
      controller.events.on('exerciseLoaded', ({ exercise, timeline }) => {
        this.totalSteps = Math.max(1, timeline.length);
        this.el.exerciseTitle.textContent = `${exercise.title} · ${timeline.noteCount} notes · seed ${exercise.metadata.seed.toString(16)}`;
        this.el.progress.max = this.totalSteps;
        this.el.progress.value = 0;
        this.el.expected.textContent = '—';
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
        this.el.expected.textContent = formatNotes(expectedMidi);
        this.lastPosition = `bar ${step.measureIndex + 1} · beat ${step.beat.toFixed(2).replace(/\.00$/, '')}`;
        this.el.position.textContent = this.lastPosition;
        this.el.progress.value = step.index;
        this.renderFocusStatus(this.lastPosition);
      }),
      session.events.on('noteJudged', ({ midi, verdict, remaining }) => {
        this.appendLog(midi, verdict, remaining);
      }),
      session.events.on('finished', ({ report, score }) => {
        this.el.progress.value = this.totalSteps;
        this.el.expected.textContent = '—';
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
    this.el.dropout.value = String(settings.dropoutBars);
    this.el.dropoutDescription.textContent = dropoutDescription(settings.dropoutBars);
    this.el.rangeFrom.value = settings.rangeFromBar === null ? '' : String(settings.rangeFromBar);
    this.el.rangeTo.value = settings.rangeToBar === null ? '' : String(settings.rangeToBar);
    this.el.repeatRange.checked = settings.repeatRange;
    this.el.countIn.value = String(settings.countInBars);
    this.el.countInValue.value = String(settings.countInBars);
    this.el.tolerance.value = String(settings.matchToleranceMs);
    this.el.toleranceValue.value = String(settings.matchToleranceMs);
    this.el.zoom.value = String(Math.round(settings.zoom * 100));
    this.el.zoomValue.value = this.el.zoom.value;
    this.el.showPlayed.checked = settings.showPlayedNotes;
    this.el.fadePassed.checked = settings.fadePassedNotes;
    this.el.showCursor.checked = settings.showCursor;
    this.el.metronomeMuted.checked = settings.metronomeMuted;
    this.el.pitchClass.checked = settings.pitchClassOnly;
    this.el.rhythmOnly.checked = settings.rhythmOnly;
    this.el.presetDescription.textContent = this.runtime.presets.get(settings.presetId).description;
    this.el.rhythmDescription.textContent = this.runtime.rhythms.get(
      settings.rhythmProfileId,
    ).description;

    const audio = this.runtime.settings.currentAudio;
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
    right.textContent = remaining.length > 0 ? `still: ${formatNotes(remaining)}` : '';
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
    ];
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

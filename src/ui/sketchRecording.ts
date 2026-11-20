import type { BeatWeight } from '../application/ports/IMetronome.js';
import { rollAsEvents, rollBeganAtMs, takeWithThePlayingRecorded, theNotesRecorded } from '../application/session/RunRoll.js';
import { theBeatOfTheClickAt, theClickOfTheTake, type MidiFileEvent } from '../domain/midi/MidiFile.js';
import { asItWas } from './sketchEditing.js';
import type { NoteShownAhead } from './rollPainter.js';
import { MILLISECONDS_A_MINUTE, ROLL_CLICK_LEAD_MS, RUN_ROLL_ID, SLICE_EDGE_MS, TAKE_TICK_MS } from './rollTiming.js';
import type { AppView } from './AppView.js';

/** How far a sketch's beat is carried on past its end to be clicked under a recording: a quarter of an hour at 120. */
const RECORDED_BEATS_PAST_THE_END = 2_000;

/** How early a key may be struck and still be recorded, where there is no beat to say: as a downbeat is often struck. */
const EARLY_BY_AT_MOST_MS = 150;

/**
 * What recording into a sketch asks of the view: the sketch shown and how it
 * is drawn, where the cursor is, the transport, and writing in what was
 * played.
 */
export type TheViewOfTheRecording = Pick<
  AppView,
  | 'changeTheSketchShowing'
  | 'describeTheRoll'
  | 'drawnScene'
  | 'el'
  | 'headIsAtMs'
  | 'holdTheRoll'
  | 'paintTheRoll'
  | 'rollAtMs'
  | 'rollPlacedAtMs'
  | 'runtime'
  | 'theDrumsAreWritten'
  | 'theOtherRollShowing'
  | 'theRoll'
  | 'theSketchAsDrawn'
>;

/**
 * Recording what is played into the sketch being edited: counted in, heard
 * over what is written and its beat, shown as it is played, and written in
 * as one change when it stops - the keys into the notes, or the drums struck
 * on the letters into the drums while they are written.
 *
 * Its own state is the recording under way and what it has come to so far;
 * the sketch, its drawing and the transport stay the view's, asked of it
 * through `TheViewOfTheRecording`.
 */
export class SketchRecording {
  private readonly host: TheViewOfTheRecording;
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
    /** Takes in a key struck or let go of, at a moment on the page's clock: see `recordIntoTheSketch`. */
    readonly hear: (event: MidiFileEvent) => void;
    readonly clicks: readonly { readonly atMs: number; readonly weight: BeatWeight }[];
    nextClick: number;
    readonly stopListening: () => void;
    begins: ReturnType<typeof setTimeout> | null;
    tick: ReturnType<typeof setInterval> | null;
  } | null = null;
  /** The notes played into a recording under way, where they go, painted as they are played: see `showWhatIsBeingRecorded`. */
  private notesShown: readonly NoteShownAhead[] = [];

  constructor(host: TheViewOfTheRecording) {
    this.host = host;
  }

  /** Whether a recording is under way, counting in or recording. */
  get isRecording(): boolean {
    return this.recording !== null;
  }

  /** The notes the recording under way comes to, where they go, painted as they are played. */
  get notesBeingRecorded(): readonly NoteShownAhead[] {
    return this.notesShown;
  }

  /**
   * A drum struck or let go of on the letters, at a moment on the page's
   * clock. Struck only while the drums are written, and a recording begun
   * among the notes is written in before the drums are turned to: any
   * recording under way when one is struck is of the drums.
   */
  hearTheDrums(event: MidiFileEvent): void {
    this.recording?.hear(event);
  }

  /**
   * Records the instrument into the sketch being edited from where the
   * cursor is: a count-in of as many bars as the settings say, at the
   * sketch's pace and metre there, and then whatever is played, heard over
   * what is already written and the sketch's own beat. Nothing is written
   * until it stops: see `writeInWhatWasRecorded`.
   *
   * While the drums are written, what is recorded is the drums struck on
   * the letters of the computer keyboard, and the keys are not: a key is no
   * drum, and among the drums it would be a row of the kit by chance.
   */
  recordIntoTheSketch(): void {
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = sketch === undefined ? null : this.host.runtime.sketches.find(sketch.id);
    if (showing === null || sketch === undefined || !sketch.editing || stored === null) {
      return;
    }
    if (this.host.runtime.takePlayer.playing === RUN_ROLL_ID) {
      this.host.holdTheRoll();
    }
    const origin = rollBeganAtMs(showing.roll);
    const fromMs = this.host.headIsAtMs();
    const now = this.host.runtime.clock.now();
    // The beat where it goes in, which the count-in is counted at; a sketch
    // with no beat is recorded into at once.
    const beat = theBeatOfTheClickAt(stored.events, stored.beats, fromMs + origin);
    const beatMs = beat === null ? 0 : ((MILLISECONDS_A_MINUTE / beat.crotchetsPerMinute) * 4) / beat.metre.beatType;
    const countIn = beat === null ? 0 : this.host.runtime.controller.settings.countInBars * beat.metre.beatsInBar;
    const beginsAtMs = now + countIn * beatMs;
    for (let at = 0; at < countIn; at += 1) {
      this.host.runtime.metronomeClick.click(now + at * beatMs, beat !== null && at % beat.metre.beatsInBar === 0 ? 'downbeat' : 'beat');
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
    const hear = (event: MidiFileEvent): void => {
      if (event.atMs < earliest) {
        return;
      }
      played.push({ ...event, atMs: event.atMs - beginsAtMs });
      // Seen as it is played, not a tick later.
      if (event.kind === 'noteOn' || event.kind === 'noteOff') {
        this.showWhatIsBeingRecorded();
      }
    };
    const drums = sketch.drums;
    const stopListening = this.host.runtime.midi.subscribe((event) => {
      if (drums) {
        return;
      }
      const atMs = event.timestampMs;
      if (event.type === 'noteon') {
        hear({ kind: 'noteOn', atMs, midi: event.midi, velocity: event.velocity });
      } else if (event.type === 'noteoff') {
        hear({ kind: 'noteOff', atMs, midi: event.midi });
      } else if (event.type === 'pedal') {
        hear({ kind: 'sustain', atMs, value: event.value });
      }
    });
    this.recording = {
      sketchId: sketch.id,
      fromMs,
      beginsAtMs,
      played,
      hear,
      clicks,
      nextClick: 0,
      stopListening,
      begins: null,
      tick: null,
    };
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
    const roll = this.host.theRoll();
    if (recording === null || roll === null) {
      return;
    }
    const now = this.host.runtime.clock.now();
    const atMs = recording.fromMs + Math.max(0, now - recording.beginsAtMs);
    const player = this.host.runtime.takePlayer;
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
    if (this.host.el.rollClick.checked) {
      for (let next = recording.clicks[recording.nextClick]; next !== undefined && next.atMs <= now + ROLL_CLICK_LEAD_MS; ) {
        this.host.runtime.metronomeClick.click(next.atMs, next.weight);
        recording.nextClick += 1;
        next = recording.clicks[recording.nextClick];
      }
    }
    this.host.rollAtMs = atMs;
    this.host.describeTheRoll();
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
    const scene = this.host.drawnScene;
    const showing = this.host.theOtherRollShowing;
    const stored = recording === null ? null : this.host.theSketchAsDrawn(recording.sketchId);
    const now = this.host.runtime.clock.now() - (recording?.beginsAtMs ?? 0);
    this.notesShown =
      recording === null || scene === null || showing === null || stored === null
        ? []
        : theNotesRecorded(stored.events, recording.played, recording.fromMs + rollBeganAtMs(showing.roll), now).map((note) => ({
            row: scene.highest - note.midi,
            fromMs: recording.fromMs + note.afterMs,
            untilMs: recording.fromMs + note.afterMs + note.lengthMs,
          }));
    this.host.paintTheRoll();
  }

  /**
   * Stops recording and writes in what was played, from where it went in,
   * over what is there: one change, put back as one, the keys of it chosen.
   * Stopped during the count-in, nothing was recorded. The cursor stays
   * where the recording stopped, and the marker where it began.
   */
  writeInWhatWasRecorded(): void {
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
    this.host.runtime.metronomeClick.takeBackTheClicks();
    if (this.host.runtime.takePlayer.playing === RUN_ROLL_ID) {
      this.host.runtime.takePlayer.stop();
    }
    const stoppedAtMs = this.host.runtime.clock.now() - recording.beginsAtMs;
    const showing = this.host.theOtherRollShowing;
    const sketch = showing?.sketch;
    const stored = this.host.theSketchAsDrawn(recording.sketchId);
    this.sayWhetherItRecords();
    if (stoppedAtMs < 0 || showing === null || sketch === undefined || sketch.id !== recording.sketchId || stored === null) {
      this.host.describeTheRoll();
      return;
    }
    const origin = rollBeganAtMs(showing.roll);
    const { events, pasted } = takeWithThePlayingRecorded(stored.events, recording.played, recording.fromMs + origin, stoppedAtMs);
    this.host.rollPlacedAtMs = recording.fromMs;
    this.host.rollAtMs = recording.fromMs + stoppedAtMs;
    if (events !== stored.events) {
      this.host.changeTheSketchShowing(events, [...sketch.before, asItWas(stored, sketch.chosen)], pasted);
    }
    this.host.describeTheRoll();
  }

  /** The record button pressed while it records - counting in or under way - and saying what a press would do. */
  sayWhetherItRecords(): void {
    const recording = this.recording !== null;
    const bars = this.host.runtime.controller.settings.countInBars;
    const what = this.host.theDrumsAreWritten() ? 'Record the drums, struck on the letters Q to O or Z to the full stop,' : 'Record into the sketch';
    this.host.el.rollRecord.setAttribute('aria-pressed', String(recording));
    this.host.el.rollRecord.title = recording
      ? 'Stop recording, and write in what was played'
      : bars > 0
        ? `${what} from the cursor, after ${String(bars)} ${bars === 1 ? 'bar' : 'bars'} counted in`
        : `${what} from the cursor`;
    this.host.el.rollRecord.setAttribute('aria-label', this.host.el.rollRecord.title);
  }
}

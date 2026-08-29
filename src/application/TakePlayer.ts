import type { MidiFileEvent } from '../domain/midi/MidiFile.js';
import type { IClock } from './ports/IClock.js';
import type { IPitchPlayer, ISustainPedal } from './ports/IPitchPlayer.js';

export interface TakePlayerDependencies {
  readonly instrument: IPitchPlayer;
  readonly clock: IClock;
  /** `null` when the instrument has no dampers to lift. */
  readonly sustain?: ISustainPedal | null;
}

/** How far ahead of the moment notes are handed to the instrument. */
const LOOK_AHEAD_MS = 250;

/**
 * Plays a kept take back.
 *
 * Notes are handed to the instrument a little ahead of when they are due, and
 * no further. Handing over the whole take at once was the first attempt and
 * it was wrong twice: the instrument keeps one voice per pitch, so a repeated
 * note released the earlier one before it had sounded, and stopping could
 * only silence what was already sounding - everything scheduled beyond that
 * played on with nothing left to stop it. A quarter of a second of look-ahead
 * is enough that no note is placed late and little enough that stopping is
 * immediate.
 *
 * The pumping is the caller's, not a timer of this class's own: whoever is
 * drawing the slider is already waking up, and a second clock here would be
 * one more thing to keep in step with the first.
 *
 * Where it has got to is arithmetic on the clock rather than a counter
 * something keeps, so it cannot drift from what is being heard.
 */
export class TakePlayer {
  private readonly instrument: IPitchPlayer;
  private readonly clock: IClock;
  private readonly sustain: ISustainPedal | null;

  private notes: readonly PairedNote[] = [];
  private sustains: readonly MidiFileEvent[] = [];
  /** How many notes have been handed to the instrument already. */
  private handedOver = 0;
  private lengthMs = 0;
  private startedAtMs: number | null = null;
  private offsetMs = 0;
  private playingId: string | null = null;

  constructor(dependencies: TakePlayerDependencies) {
    this.instrument = dependencies.instrument;
    this.clock = dependencies.clock;
    this.sustain = dependencies.sustain ?? null;
  }

  /** Which take is sounding, or `null` when none is. */
  get playing(): string | null {
    return this.startedAtMs === null ? null : this.playingId;
  }

  /** How long the take being played lasts, in milliseconds. */
  get durationMs(): number {
    return this.lengthMs;
  }

  /**
   * How far in it has got, in milliseconds.
   *
   * Read from the clock rather than counted, so it can only say what is
   * actually being heard. Past the end it stops at the end rather than
   * running on: the take is over, and a marker still travelling would be
   * describing silence.
   */
  get positionMs(): number {
    if (this.startedAtMs === null) {
      return this.offsetMs;
    }
    return Math.min(this.lengthMs, this.offsetMs + (this.clock.now() - this.startedAtMs));
  }

  /** True once the take has run out, which is what stops a scrubber. */
  get finished(): boolean {
    return this.startedAtMs !== null && this.positionMs >= this.lengthMs;
  }

  /**
   * Starts a take, or restarts it from `fromMs`.
   *
   * Notes already sounding at that point are struck at the seek rather than
   * skipped: a listener who drops into the middle of a held chord should hear
   * the chord, not the silence between its attack and its release.
   */
  play(id: string, events: readonly MidiFileEvent[], fromMs = 0): void {
    this.stop();
    this.notes = pairUp(events);
    this.sustains = events.filter((event) => event.kind === 'sustain');
    this.lengthMs = events.reduce((longest, event) => Math.max(longest, event.atMs), 0);
    this.playingId = id;
    this.offsetMs = Math.max(0, Math.min(this.lengthMs, fromMs));
    this.startedAtMs = this.clock.now();
    this.handedOver = 0;
    this.pump();
  }

  /**
   * Hands over whatever is due within the look-ahead.
   *
   * Called by whoever is following the playback. Notes are kept in order, so
   * this only ever walks forward from where it stopped last time.
   */
  pump(): void {
    if (this.startedAtMs === null) {
      return;
    }
    const origin = this.startedAtMs - this.offsetMs;
    const until = this.positionMs + LOOK_AHEAD_MS;

    while (this.handedOver < this.notes.length) {
      const note = this.notes[this.handedOver];
      if (note === undefined || note.startMs > until) {
        break;
      }
      this.handedOver += 1;
      // Only what the seek has wholly passed. A note left unreleased at the
      // very end of a take has no length at all, and a plain "ends before
      // here" test would drop it rather than sound it.
      if (note.endMs <= this.offsetMs && note.startMs < this.offsetMs) {
        continue;
      }
      // A note straddling the seek is struck there rather than skipped: a
      // listener who drops into the middle of a held chord should hear the
      // chord, not the silence between its attack and its release.
      const startsAt = Math.max(note.startMs, this.offsetMs);
      this.instrument.play(note.midi, note.velocity, origin + startsAt);
      this.instrument.stop(note.midi, origin + note.endMs);
    }

    for (const event of this.sustains) {
      if (event.kind !== 'sustain' || event.atMs < this.offsetMs || event.atMs > until) {
        continue;
      }
      this.sustain?.setSustain(event.value >= 0.5);
    }
  }

  /** Stops, keeping where it had got to so that play resumes from there. */
  pause(): void {
    if (this.startedAtMs === null) {
      return;
    }
    this.offsetMs = this.positionMs;
    this.startedAtMs = null;
    this.silence();
  }

  /** Stops and forgets the position. */
  stop(): void {
    this.startedAtMs = null;
    this.offsetMs = 0;
    this.playingId = null;
    this.silence();
  }

  /** Moves the position without deciding whether to go on playing. */
  seek(toMs: number): void {
    const at = Math.max(0, Math.min(this.lengthMs, toMs));
    if (this.startedAtMs === null) {
      this.offsetMs = at;
      return;
    }
    // Everything already handed over is silenced and the walk restarts from
    // the new place: a seek that left the old notes scheduled would play two
    // parts of the take over each other.
    this.silence();
    this.offsetMs = at;
    this.startedAtMs = this.clock.now();
    this.handedOver = this.notes.findIndex((note) => note.endMs > at);
    if (this.handedOver < 0) {
      this.handedOver = this.notes.length;
    }
    this.pump();
  }

  private silence(): void {
    this.instrument.stopAll();
    this.sustain?.setSustain(false);
  }
}

interface PairedNote {
  readonly midi: number;
  readonly velocity: number;
  readonly startMs: number;
  readonly endMs: number;
}

/**
 * Note-ons and note-offs joined back into notes.
 *
 * A take is a stream of presses and releases, which is the right thing to
 * keep - it is what happened. Playing it back needs the other view of the
 * same fact, because a note is only skippable or seekable into once you know
 * where it ends. Anything left open at the end is released there, since a
 * note nobody stops is a note that rings for ever.
 */
function pairUp(events: readonly MidiFileEvent[]): PairedNote[] {
  const open = new Map<number, { startMs: number; velocity: number }>();
  const notes: PairedNote[] = [];
  let last = 0;

  for (const event of events) {
    last = Math.max(last, event.atMs);
    if (event.kind === 'noteOn') {
      const already = open.get(event.midi);
      if (already !== undefined) {
        notes.push({ midi: event.midi, velocity: already.velocity, startMs: already.startMs, endMs: event.atMs });
      }
      open.set(event.midi, { startMs: event.atMs, velocity: event.velocity });
      continue;
    }
    if (event.kind === 'noteOff') {
      const started = open.get(event.midi);
      if (started !== undefined) {
        open.delete(event.midi);
        notes.push({ midi: event.midi, velocity: started.velocity, startMs: started.startMs, endMs: event.atMs });
      }
    }
  }

  for (const [midi, started] of open) {
    notes.push({ midi, velocity: started.velocity, startMs: started.startMs, endMs: last });
  }
  return notes.sort((left, right) => left.startMs - right.startMs);
}

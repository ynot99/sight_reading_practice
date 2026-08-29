import type { MidiFileEvent } from '../domain/midi/MidiFile.js';
import type { IClock } from './ports/IClock.js';
import type { IPitchPlayer, ISustainPedal } from './ports/IPitchPlayer.js';

export interface TakePlayerDependencies {
  readonly instrument: IPitchPlayer;
  readonly clock: IClock;
  /** `null` when the instrument has no dampers to lift. */
  readonly sustain?: ISustainPedal | null;
}

/**
 * Plays a kept take back.
 *
 * Every note is handed to the instrument at once, scheduled for the moment it
 * is due. That is the whole reason there is no timer here: {@link IPitchPlayer}
 * already takes a time, because a melody placed on delivery rather than on
 * schedule is audibly uneven - and a player built on repeated wake-ups would
 * have inherited exactly that unevenness while also being untestable without
 * one.
 *
 * Where it is up to is therefore arithmetic on the clock rather than a
 * counter something has to keep, which means it cannot drift from what is
 * being heard.
 */
export class TakePlayer {
  private readonly instrument: IPitchPlayer;
  private readonly clock: IClock;
  private readonly sustain: ISustainPedal | null;

  private events: readonly MidiFileEvent[] = [];
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
    this.events = events;
    this.lengthMs = events.reduce((longest, event) => Math.max(longest, event.atMs), 0);
    this.playingId = id;
    this.offsetMs = Math.max(0, Math.min(this.lengthMs, fromMs));
    this.startedAtMs = this.clock.now();

    const origin = this.startedAtMs - this.offsetMs;
    for (const note of pairUp(events)) {
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

    for (const event of events) {
      if (event.kind === 'sustain' && event.atMs >= this.offsetMs) {
        this.sustain?.setSustain(event.value >= 0.5);
      }
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
    const wasPlaying = this.startedAtMs !== null;
    const id = this.playingId;
    const events = this.events;
    const at = Math.max(0, Math.min(this.lengthMs, toMs));
    if (wasPlaying && id !== null) {
      this.play(id, events, at);
      return;
    }
    this.offsetMs = at;
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

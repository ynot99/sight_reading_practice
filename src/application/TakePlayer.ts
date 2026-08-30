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
 * The pedal is not played back as a pedal. Every note is worked out ahead of
 * time to last exactly as long as it was heard to last - see
 * {@link soundingNotes} - so nothing about the sound is left to be decided
 * while the take is running, where the look-ahead would decide it a quarter
 * of a second out.
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
  /** Notes below this index are all handed over; `handed` holds the rest. */
  private handedOver = 0;
  private readonly handed = new Set<number>();
  /** When the key now down on each pitch comes up, in take time. */
  private readonly soundingUntil = new Map<number, number>();
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
    this.lengthMs = events.reduce((longest, event) => Math.max(longest, event.atMs), 0);
    this.notes = soundingNotes(events, this.lengthMs);
    this.playingId = id;
    this.offsetMs = Math.max(0, Math.min(this.lengthMs, fromMs));
    this.startedAtMs = this.clock.now();
    this.rewindTo(0);
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
    const at = this.positionMs;
    const until = at + LOOK_AHEAD_MS;

    for (let index = this.handedOver; index < this.notes.length; index += 1) {
      const note = this.notes[index];
      if (note === undefined || note.startMs > until) {
        break;
      }
      if (this.handed.has(index)) {
        continue;
      }
      // Only what the seek has wholly passed. A note left unreleased at the
      // very end of a take has no length at all, and a plain "ends before
      // here" test would drop it rather than sound it.
      //
      // The key coming up is what counts here, not the damper falling: under
      // a long pedal half the take is still ringing at any moment, and
      // striking all of it again at the seek would be a chord nobody played.
      if (note.keyUpMs <= this.offsetMs && note.startMs < this.offsetMs) {
        this.handed.add(index);
        continue;
      }
      // The instrument keeps one voice per pitch, so a pitch is handed over
      // only once the key before it on that pitch has come up. Handing over
      // a repeat while its predecessor is still waiting to sound killed the
      // predecessor before it ever did - a run of repeated notes coming out
      // clipped to nothing. No note is ever late for this: two notes of one
      // pitch never overlap, so the moment one key rises is at or before the
      // moment the next goes down. What the pedal does to the *sound* after
      // that is already in the note's length and is not this rule's business.
      const busyUntil = this.soundingUntil.get(note.midi);
      if (busyUntil !== undefined && at < busyUntil) {
        continue;
      }

      // A note straddling the seek is struck there rather than skipped: a
      // listener who drops into the middle of a held chord should hear the
      // chord, not the silence between its attack and its release.
      const startsAt = Math.max(note.startMs, this.offsetMs);
      this.instrument.play(note.midi, note.velocity, origin + startsAt);
      this.instrument.stop(note.midi, origin + Math.max(note.endMs, startsAt));
      this.soundingUntil.set(note.midi, note.keyUpMs);
      this.handed.add(index);
    }

    while (this.handed.has(this.handedOver)) {
      this.handed.delete(this.handedOver);
      this.handedOver += 1;
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
    const from = this.notes.findIndex((note) => note.keyUpMs > at);
    this.rewindTo(from < 0 ? this.notes.length : from);
    this.pump();
  }

  /** Puts the walk back to a place, forgetting what was handed over before. */
  private rewindTo(index: number): void {
    this.handedOver = index;
    this.handed.clear();
    this.soundingUntil.clear();
  }

  private silence(): void {
    this.instrument.stopAll();
    this.sustain?.setSustain(false);
  }
}

/** A key, from the moment it went down to the moment it came back up. */
interface StruckNote {
  readonly midi: number;
  readonly velocity: number;
  readonly startMs: number;
  readonly keyUpMs: number;
}

interface PairedNote extends StruckNote {
  /** When the sound stops: the damper falling, or the next strike. */
  readonly endMs: number;
}

/** A moment the sustain pedal changed which side of down it was on. */
interface DamperChange {
  readonly atMs: number;
  readonly down: boolean;
}

/**
 * When the pedal moved, with everything that did not move it left out.
 *
 * A keyboard sends a stream of readings rather than two events - this one
 * reports the damper twice on every press, and again halfway - and only the
 * crossings mean anything here.
 */
function damperChanges(events: readonly MidiFileEvent[]): DamperChange[] {
  const changes: DamperChange[] = [];
  let down = false;
  for (const event of [...events].sort((left, right) => left.atMs - right.atMs)) {
    if (event.kind !== 'sustain') {
      continue;
    }
    const nowDown = event.value >= 0.5;
    if (nowDown !== down) {
      changes.push({ atMs: event.atMs, down: nowDown });
      down = nowDown;
    }
  }
  return changes;
}

/**
 * How long a key stays audible after it is let go.
 *
 * Under the pedal, letting a key up does nothing at all: the string goes on
 * ringing until the dampers come back down. That is the whole reason a
 * pedalled passage sounds joined up rather than as a row of short notes, and
 * working it out here - once, from the take - is what makes the playback
 * sound like the playing.
 */
function soundsUntil(
  changes: readonly DamperChange[],
  keyUpMs: number,
  takeEndMs: number,
): number {
  let down = false;
  let index = 0;
  for (; index < changes.length; index += 1) {
    const change = changes[index];
    if (change === undefined || change.atMs > keyUpMs) {
      break;
    }
    down = change.down;
  }
  if (!down) {
    return keyUpMs;
  }
  for (; index < changes.length; index += 1) {
    const change = changes[index];
    if (change !== undefined && !change.down) {
      return change.atMs;
    }
  }
  // Never lifted: it rings to the end of what was captured.
  return Math.max(keyUpMs, takeEndMs);
}

/**
 * The take as notes that last as long as they were heard to last.
 *
 * The pedal is folded into the lengths rather than pressed and lifted as the
 * playback goes past it, and that is not a shortcut - it is the only way the
 * arithmetic can be right. Notes are handed to the instrument a quarter of a
 * second early, so a pedal obeyed when the *music* reaches it is always being
 * asked about notes that were handed over under the last state of it: every
 * press and lift got a quarter second of notes on the wrong side of it.
 *
 * Worse, a released key under the pedal stayed in the instrument's hands,
 * waiting for a lift - and striking that pitch again took it back and damped
 * it *at the moment it was handed over*, which is up to a quarter second
 * before the new note sounds. Under a pedal held down through a whole piece,
 * that is a hole punched in the sound before every repeated note. Which is
 * exactly what it sounded like.
 *
 * With the length known here, each note is scheduled once, ends where it
 * really ended, and nothing has to be decided later.
 */
function soundingNotes(events: readonly MidiFileEvent[], takeEndMs: number): PairedNote[] {
  const changes = damperChanges(events);
  const struck = pairUp(events);
  /** When each pitch is next struck, walking backwards through the take. */
  const nextStrike = new Map<number, number>();
  const notes: PairedNote[] = [];

  for (let index = struck.length - 1; index >= 0; index -= 1) {
    const note = struck[index];
    if (note === undefined) {
      continue;
    }
    // Striking a key re-hits the string whatever the pedal is doing, so the
    // note before it on that pitch ends there and no later.
    const until = nextStrike.get(note.midi) ?? Number.POSITIVE_INFINITY;
    const ringing = soundsUntil(changes, note.keyUpMs, takeEndMs);
    notes.push({ ...note, endMs: Math.max(note.startMs, Math.min(ringing, until)) });
    nextStrike.set(note.midi, note.startMs);
  }

  return notes.reverse();
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
function pairUp(events: readonly MidiFileEvent[]): StruckNote[] {
  const open = new Map<number, { startMs: number; velocity: number }>();
  const notes: StruckNote[] = [];
  let last = 0;

  for (const event of events) {
    last = Math.max(last, event.atMs);
    if (event.kind === 'noteOn') {
      const already = open.get(event.midi);
      if (already !== undefined) {
        notes.push({ midi: event.midi, velocity: already.velocity, startMs: already.startMs, keyUpMs: event.atMs });
      }
      open.set(event.midi, { startMs: event.atMs, velocity: event.velocity });
      continue;
    }
    if (event.kind === 'noteOff') {
      const started = open.get(event.midi);
      if (started !== undefined) {
        open.delete(event.midi);
        notes.push({ midi: event.midi, velocity: started.velocity, startMs: started.startMs, keyUpMs: event.atMs });
      }
    }
  }

  for (const [midi, started] of open) {
    notes.push({ midi, velocity: started.velocity, startMs: started.startMs, keyUpMs: last });
  }
  return notes.sort((left, right) => left.startMs - right.startMs);
}

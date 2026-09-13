import type { NoteVerdict } from '../../domain/matching/ChordMatcher.js';
import type { BeatWeight, MetronomeTick } from '../ports/IMetronome.js';
import type {
  MidiNoteOffEvent,
  MidiNoteOnEvent,
  MidiPedalEvent,
} from '../ports/IMidiSource.js';
import type { NoteJudgedEvent } from './SessionEvents.js';

/**
 * One key going down and coming up again, as it was actually played.
 *
 * Times are on the clock the events arrived on, untouched. Nothing here is
 * rebased against where the music starts, and deliberately: the bar frame
 * moves the run's origin at every gate it opens, so an origin subtracted at
 * capture time would be a different number for the beginning of a run than for
 * the end of it, and the picture would bend where the reader waited. The view
 * subtracts one origin from the finished roll, which is one arithmetic and
 * cannot disagree with itself.
 */
export interface RolledPress {
  readonly midi: number;
  readonly downAtMs: number;
  /** `null` where the key was still down when the run ended. */
  readonly upAtMs: number | null;
  /** `0..1`, as the keyboard sent it. */
  readonly velocity: number;
  /**
   * What the run made of the press, or `null` for one it never judged.
   *
   * A press can go unjudged: struck while the music was somewhere else, or
   * after the step it was reaching for had already closed. Drawn without a
   * verdict it is still worth seeing - it is a key the reader pressed - and
   * saying `null` is how the picture admits that nothing was decided about it
   * rather than quietly calling it wrong.
   */
  readonly verdict: NoteVerdict | null;
  readonly stepIndex: number | null;
  /** How far from the beat, where the mode judges timing at all. */
  readonly deviationMs: number | null;
}

/** One click of the pulse, at the moment it was heard. */
export interface RolledBeat {
  readonly atMs: number;
  readonly weight: BeatWeight;
  /** Zero-based, on the metronome's own count. */
  readonly measure: number;
}

/** The sustain pedal down and up again. */
export interface RolledPedal {
  readonly downAtMs: number;
  /** `null` where it was still down when the run ended. */
  readonly upAtMs: number | null;
}

/**
 * Everything a run did, in the order it happened, for drawing rather than for
 * scoring.
 *
 * The report says how it went; this says what happened. They are built from
 * the same stream and answer different questions: a mean deviation of forty
 * milliseconds cannot say whether the reader is evenly late, accelerating
 * through the phrase, or steady in one hand and dragging in the other, and
 * those are three different things to practise.
 */
export interface RunRoll {
  readonly presses: readonly RolledPress[];
  readonly beats: readonly RolledBeat[];
  readonly pedal: readonly RolledPedal[];
  /**
   * Whether anything was left out for want of room.
   *
   * A run is bounded by the piece and cannot realistically reach these caps,
   * but a run left going all afternoon would, and a measuring tool that
   * quietly discards half its measurements is worse than one that says so.
   */
  readonly truncated: boolean;
}

/** Presses kept before a run stops recording them. */
const PRESS_CAPACITY = 20_000;
/** And clicks, which at the finest resolution outnumber the presses. */
const BEAT_CAPACITY = 60_000;

const EMPTY: RunRoll = { presses: [], beats: [], pedal: [], truncated: false };

/** A press whose verdict has not arrived yet, and where it sits. */
interface Open {
  readonly midi: number;
  readonly at: number;
}

/**
 * Writes down a run as it is played.
 *
 * Fed rather than subscribed: the session already receives every press, every
 * release and every click, and a second subscription to the same keyboard
 * would have to pair each press with its verdict across two streams that can
 * interleave. Told directly, the pairing is whatever the session did.
 */
export class RollRecorder {
  private presses: RolledPress[] = [];
  private beats: RolledBeat[] = [];
  private pedalSpans: RolledPedal[] = [];
  /** Keys still down, oldest first, by the press each one belongs to. */
  private readonly held: Open[] = [];
  /** Presses still waiting for a verdict, oldest first. */
  private readonly unjudged: Open[] = [];
  private pedalDownAt: number | null = null;
  private full = false;

  /** Forgets the last run. Called where a run begins, not where one ends. */
  reset(): void {
    this.presses = [];
    this.beats = [];
    this.pedalSpans = [];
    this.held.length = 0;
    this.unjudged.length = 0;
    this.pedalDownAt = null;
    this.full = false;
  }

  keyDown(event: MidiNoteOnEvent): void {
    if (this.presses.length >= PRESS_CAPACITY) {
      this.full = true;
      return;
    }
    const at = this.presses.length;
    this.presses.push({
      midi: event.midi,
      downAtMs: event.timestampMs,
      upAtMs: null,
      velocity: event.velocity,
      verdict: null,
      stepIndex: null,
      deviationMs: null,
    });
    this.held.push({ midi: event.midi, at });
    this.unjudged.push({ midi: event.midi, at });
  }

  keyUp(event: MidiNoteOffEvent): void {
    // The oldest press of that key still down, because that is the one being
    // let go of. A trill holds the same pitch twice within a few hundred
    // milliseconds, and closing the newest would leave the first note of it
    // running to the end of the piece.
    const index = this.held.findIndex((open) => open.midi === event.midi);
    if (index < 0) {
      return;
    }
    const [open] = this.held.splice(index, 1);
    const press = open === undefined ? undefined : this.presses[open.at];
    if (open === undefined || press === undefined) {
      return;
    }
    this.presses[open.at] = { ...press, upAtMs: event.timestampMs };
  }

  /**
   * Attaches a verdict to the press it was given for.
   *
   * The oldest unjudged press of that pitch, for the same reason a release
   * takes the oldest held one - and because a verdict can arrive long after
   * the press. A note struck before the music reached it is held and judged
   * when the gate it was reaching for opens, so by then the reader may have
   * struck the same key again.
   */
  judged(event: NoteJudgedEvent): void {
    const index = this.unjudged.findIndex((open) => open.midi === event.midi);
    if (index < 0) {
      return;
    }
    const [open] = this.unjudged.splice(index, 1);
    const press = open === undefined ? undefined : this.presses[open.at];
    if (open === undefined || press === undefined) {
      return;
    }
    this.presses[open.at] = {
      ...press,
      verdict: event.verdict,
      stepIndex: event.stepIndex,
      deviationMs: event.deviationMs,
    };
  }

  pedal(event: MidiPedalEvent): void {
    if (event.down) {
      // Already down stays down: a keyboard sends a stream of values while the
      // pedal moves, and half-pedalling is a dozen of them. One span.
      this.pedalDownAt ??= event.timestampMs;
      return;
    }
    if (this.pedalDownAt === null) {
      return;
    }
    this.pedalSpans.push({ downAtMs: this.pedalDownAt, upAtMs: event.timestampMs });
    this.pedalDownAt = null;
  }

  /** One click, at the moment it is heard rather than the moment it is placed. */
  beat(tick: MetronomeTick): void {
    if (this.beats.length >= BEAT_CAPACITY) {
      this.full = true;
      return;
    }
    this.beats.push({
      atMs: tick.scheduledTimeMs,
      weight: tick.isDownbeat ? 'downbeat' : tick.isPulse ? 'beat' : 'division',
      measure: tick.measure,
    });
  }

  /**
   * The run as it stands, with whatever is still down left open.
   *
   * A key held when the run ends has no release to draw to, and inventing one
   * at the run's end would say the reader let go there. `null` says they had
   * not, and the view runs the note to the edge of what it is drawing.
   */
  roll(): RunRoll {
    const pedal =
      this.pedalDownAt === null
        ? this.pedalSpans
        : [...this.pedalSpans, { downAtMs: this.pedalDownAt, upAtMs: null }];
    return {
      presses: [...this.presses],
      beats: [...this.beats],
      pedal: [...pedal],
      truncated: this.full,
    };
  }
}

/** A roll with nothing in it, for a run that has not been played. */
export function emptyRoll(): RunRoll {
  return EMPTY;
}

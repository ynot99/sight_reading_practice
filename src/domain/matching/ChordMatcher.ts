import { assertPositive, floorMod } from '../../shared/asserts.js';

/**
 * Rules that decide when a set of key presses counts as "the notated chord".
 */
export interface MatchPolicy {
  /**
   * How far apart two presses may be and still count as simultaneous.
   * `Number.POSITIVE_INFINITY` accumulates presses indefinitely, which is the
   * friendly behaviour for slow practice in Wait mode.
   */
  readonly toleranceMs: number;
  /** Ignore octaves. Handy for beginners drilling note names. */
  readonly pitchClassOnly: boolean;
  /**
   * Judge only *when*, never *what*.
   *
   * Reading the rhythm before playing the notes is standard practice, and it
   * is the half beginners drop first. One press satisfies a step whatever the
   * pitch and however many notes the step holds - a chord is one gesture of
   * the hand, so counting it as three wrong notes would punish the reader for
   * doing the thing correctly.
   */
  readonly anyPitch?: boolean;
}

export const DEFAULT_MATCH_POLICY: MatchPolicy = {
  toleranceMs: 250,
  pitchClassOnly: false,
};

/**
 * What became of one press.
 *
 * `other-hand` and `late` are never returned by the matcher. It is told only
 * what *this* step expects, and cannot know the rest of the page or the step
 * before. The session knows both, and they are the difference between a note
 * the reader invented and a note that was there to be played.
 */
export type NoteVerdict =
  | 'correct'
  | 'duplicate'
  | 'wrong'
  | 'other-hand'
  | 'late'
  /**
   * An ornament printed here, which the run neither asked for nor minds.
   *
   * A grace note is on the page: playing it is reading the page correctly and
   * must not be marked wrong. It is also the performer's to add rather than
   * the writer's to demand, so nothing waits for it and it counts towards
   * nothing.
   */
  | 'ornament';

export interface MatchOutcome {
  readonly verdict: NoteVerdict;
  /** True once every expected pitch has been collected. */
  readonly completed: boolean;
  /** True when this press fell outside the window and restarted the attempt. */
  readonly windowRestarted: boolean;
  readonly remaining: readonly number[];
}

export interface MatchSummary {
  readonly expected: readonly number[];
  readonly matched: readonly number[];
  readonly missing: readonly number[];
  readonly wrong: readonly number[];
  readonly completed: boolean;
}

/**
 * Judges the note-ons played against one timeline step.
 *
 * A chord is not a single event on a MIDI wire: it arrives as several
 * note-ons a few milliseconds apart, in any order. The matcher collects them
 * inside a tolerance window and reports the moment the expected set is
 * complete. Presses that arrive after the window has elapsed are treated as a
 * fresh attempt rather than as part of the previous one.
 *
 * Instances are single-use per step and hold no timing source of their own:
 * the caller supplies timestamps, which keeps the class pure and testable.
 */
export class ChordMatcher {
  private readonly policy: MatchPolicy;
  private readonly expectedList: readonly number[];
  private readonly expectedByKey: ReadonlyMap<number, number>;
  private readonly ornamentKeys: ReadonlySet<number>;
  private pending: Set<number>;
  /** Rhythm-only: whether this step has had its one press yet. */
  private tapped = false;
  private matchedNotes: number[] = [];
  private wrongPresses: number[] = [];
  private windowStart: number | null = null;

  constructor(
    expectedMidi: Iterable<number>,
    policy: MatchPolicy = DEFAULT_MATCH_POLICY,
    ornamentMidi: Iterable<number> = [],
  ) {
    if (policy.toleranceMs !== Number.POSITIVE_INFINITY) {
      assertPositive(policy.toleranceMs, 'toleranceMs');
    }
    this.policy = policy;

    const byKey = new Map<number, number>();
    for (const midi of expectedMidi) {
      const key = this.keyOf(midi);
      if (!byKey.has(key)) {
        byKey.set(key, midi);
      }
    }
    this.expectedByKey = byKey;
    this.expectedList = [...byKey.values()].sort((left, right) => left - right);
    this.pending = new Set(byKey.keys());
    // Never counted among the expected, so nothing waits for one and nothing
    // is missing when it is left out.
    this.ornamentKeys = new Set([...ornamentMidi].map((midi) => this.keyOf(midi)));
  }

  private keyOf(midi: number): number {
    return this.policy.pitchClassOnly ? floorMod(midi, 12) : midi;
  }

  get expected(): readonly number[] {
    return this.expectedList;
  }

  get completed(): boolean {
    return this.policy.anyPitch === true ? this.tapped : this.pending.size === 0;
  }

  /**
   * Expected pitches not yet played, ascending.
   *
   * Rhythm-only still reports the whole chord until the step is tapped: the
   * reader is reading those notes even while only the timing is judged.
   */
  get remaining(): readonly number[] {
    if (this.policy.anyPitch === true) {
      return this.tapped ? [] : this.expectedList;
    }
    return [...this.pending]
      .map((key) => this.expectedByKey.get(key) ?? key)
      .sort((left, right) => left - right);
  }

  /** Correct presses collected so far, in the order they arrived. */
  get matched(): readonly number[] {
    return this.matchedNotes;
  }

  /** Every unexpected press seen while this step was active. */
  get wrong(): readonly number[] {
    return this.wrongPresses;
  }

  /** Timestamp of the first correct press of the current attempt. */
  get windowStartMs(): number | null {
    return this.windowStart;
  }

  accept(midi: number, timestampMs: number): MatchOutcome {
    if (this.policy.anyPitch === true) {
      if (this.tapped) {
        // The rest of a chord is the same gesture, not extra notes.
        return this.outcome('duplicate', false);
      }
      this.tapped = true;
      this.matchedNotes.push(midi);
      this.windowStart ??= timestampMs;
      return this.outcome('correct', false);
    }

    const key = this.keyOf(midi);
    let windowRestarted = false;

    if (!this.completed && this.windowStart !== null && this.isOutsideWindow(timestampMs)) {
      this.restartAttempt();
      windowRestarted = true;
    }

    if (!this.expectedByKey.has(key)) {
      if (this.ornamentKeys.has(key)) {
        // On the page and not asked for: neither collected nor held against
        // the reader, and it does not restart the window either - an ornament
        // is played *into* the beat it decorates.
        return this.outcome('ornament', windowRestarted);
      }
      this.wrongPresses.push(midi);
      return this.outcome('wrong', windowRestarted);
    }

    if (!this.pending.has(key)) {
      // Already collected: repeating a note of the chord is harmless.
      return this.outcome('duplicate', windowRestarted);
    }

    if (this.windowStart === null) {
      this.windowStart = timestampMs;
    }
    this.pending.delete(key);
    this.matchedNotes.push(midi);
    return this.outcome('correct', windowRestarted);
  }

  summary(): MatchSummary {
    return {
      expected: this.expectedList,
      matched: [...this.matchedNotes],
      // A tapped step counts its notes as played: the reader did what was
      // asked, and accuracy would otherwise read as though nothing sounded.
      missing: this.policy.anyPitch === true && this.tapped ? [] : this.remaining,
      wrong: [...this.wrongPresses],
      completed: this.completed,
    };
  }

  /** Clears the collected presses but keeps the wrong-note history. */
  restartAttempt(): void {
    this.pending = new Set(this.expectedByKey.keys());
    this.matchedNotes = [];
    this.windowStart = null;
    this.tapped = false;
  }

  /** Full reset, including the wrong-note history. */
  reset(): void {
    this.restartAttempt();
    this.wrongPresses = [];
  }

  private isOutsideWindow(timestampMs: number): boolean {
    if (this.windowStart === null) {
      return false;
    }
    return timestampMs - this.windowStart > this.policy.toleranceMs;
  }

  private outcome(verdict: NoteVerdict, windowRestarted: boolean): MatchOutcome {
    return {
      verdict,
      completed: this.completed,
      windowRestarted,
      remaining: this.remaining,
    };
  }
}

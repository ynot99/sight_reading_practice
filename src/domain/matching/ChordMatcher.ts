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
}

export const DEFAULT_MATCH_POLICY: MatchPolicy = {
  toleranceMs: 250,
  pitchClassOnly: false,
};

export type NoteVerdict = 'correct' | 'duplicate' | 'wrong';

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
  private pending: Set<number>;
  private matchedNotes: number[] = [];
  private wrongPresses: number[] = [];
  private windowStart: number | null = null;

  constructor(expectedMidi: Iterable<number>, policy: MatchPolicy = DEFAULT_MATCH_POLICY) {
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
  }

  private keyOf(midi: number): number {
    return this.policy.pitchClassOnly ? floorMod(midi, 12) : midi;
  }

  get expected(): readonly number[] {
    return this.expectedList;
  }

  get completed(): boolean {
    return this.pending.size === 0;
  }

  /** Expected pitches not yet played, ascending. */
  get remaining(): readonly number[] {
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
    const key = this.keyOf(midi);
    let windowRestarted = false;

    if (!this.completed && this.windowStart !== null && this.isOutsideWindow(timestampMs)) {
      this.restartAttempt();
      windowRestarted = true;
    }

    if (!this.expectedByKey.has(key)) {
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
      missing: this.remaining,
      wrong: [...this.wrongPresses],
      completed: this.completed,
    };
  }

  /** Clears the collected presses but keeps the wrong-note history. */
  restartAttempt(): void {
    this.pending = new Set(this.expectedByKey.keys());
    this.matchedNotes = [];
    this.windowStart = null;
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

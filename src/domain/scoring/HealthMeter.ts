import { clamp } from '../../shared/asserts.js';

export interface HealthMeterOptions {
  /**
   * Health lost over one beat of *musical* time.
   *
   * Musical, not wall-clock, and that is the whole of how this survives a
   * slow piece: a beat at 50 bpm lasts more than twice as long as one at 120,
   * so the bar falls at half the speed on screen without anything being told
   * the tempo. A rate in seconds would make a slow melody unplayable and a
   * fast one trivial.
   */
  readonly drainPerBeat?: number;
  /** Given back for a step played correctly. Must exceed the drain, or
   * perfect playing still ends in failure. */
  readonly rewardPerStep?: number;
  /** Taken for a step the music took away. */
  readonly missPenalty?: number;
  /** Taken for a step that was played, but with wrong notes mixed in. */
  readonly wrongPenalty?: number;
}

const DEFAULTS = {
  drainPerBeat: 0.035,
  rewardPerStep: 0.06,
  missPenalty: 0.12,
  wrongPenalty: 0.04,
} as const;

/**
 * The bar that falls while you play, and rises when you get it right.
 *
 * Not a way of grading sight-reading - coming apart on a page you have never
 * seen is the material working, not the reader failing. This is for music
 * they already know, where the question is whether they can hold it together
 * at tempo, and where running out is part of the game rather than a verdict.
 *
 * Pure, and told about time rather than reading a clock: what it is given is
 * a number of beats, so a test can play a whole piece in microseconds and the
 * rule stays the same one the reader meets.
 */
export class HealthMeter {
  private readonly drainPerBeat: number;
  private readonly rewardPerStep: number;
  private readonly missPenalty: number;
  private readonly wrongPenalty: number;
  private value = 1;

  constructor(options: HealthMeterOptions = {}) {
    this.drainPerBeat = options.drainPerBeat ?? DEFAULTS.drainPerBeat;
    this.rewardPerStep = options.rewardPerStep ?? DEFAULTS.rewardPerStep;
    this.missPenalty = options.missPenalty ?? DEFAULTS.missPenalty;
    this.wrongPenalty = options.wrongPenalty ?? DEFAULTS.wrongPenalty;
  }

  /** `0..1`. */
  get health(): number {
    return this.value;
  }

  get isEmpty(): boolean {
    return this.value <= 0;
  }

  /** Time passing, measured in beats rather than in seconds. */
  drainForBeats(beats: number): number {
    if (beats <= 0) {
      return this.value;
    }
    return this.set(this.value - this.drainPerBeat * beats);
  }

  /**
   * A step that has been decided, one way or the other.
   *
   * A rest is neither rewarded nor punished: nothing was asked for, and
   * paying the reader for silence would let a piece full of them carry them.
   * The drain still runs through it, which is what keeps a long rest from
   * being a place to stand still.
   */
  settle(status: 'correct' | 'incorrect' | 'missed' | 'skipped'): number {
    switch (status) {
      case 'correct':
        return this.set(this.value + this.rewardPerStep);
      case 'incorrect':
        return this.set(this.value - this.wrongPenalty);
      case 'missed':
        return this.set(this.value - this.missPenalty);
      default:
        return this.value;
    }
  }

  reset(): void {
    this.value = 1;
  }

  private set(next: number): number {
    this.value = clamp(next, 0, 1);
    return this.value;
  }
}

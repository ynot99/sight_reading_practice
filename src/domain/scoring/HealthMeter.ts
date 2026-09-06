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
  /**
   * Given back, per beat, for keeping up with the music.
   *
   * Per beat and not per step, which is the difference between a game and a
   * lottery about note density. A step repays the time it occupies, so a bar
   * is worth the same whether it holds one whole note or sixteen sixteenths -
   * and a reader practising one hand through a passage where that hand has
   * four notes is not asked to earn what sixteen would have earned.
   *
   * Must exceed the drain, or perfect playing still ends in failure.
   */
  readonly rewardPerBeat?: number;
  /**
   * Health lost over a second of *wall-clock* time, where nothing keeps time.
   *
   * The other half of this meter, and it has to be measured differently: in
   * a mode that waits for the reader there are no beats passing to count, and
   * what the bar is asking is not "can you keep up" but "do you know what
   * comes next". So it falls with the clock while the reader hunts, and every
   * beat they find fills it again completely - room to think, and a reason
   * not to sit in one place.
   */
  readonly drainPerSecond?: number;
  /** Taken for a step the music took away. */
  readonly missPenalty?: number;
  /** Taken for a step that was played, but with wrong notes mixed in. */
  readonly wrongPenalty?: number;
}

const DEFAULTS = {
  drainPerBeat: 0.035,
  // Ten seconds from full to empty, refilled by every beat found. Long
  // enough to read an unfamiliar chord, short enough that stopping to think
  // about the whole bar costs something.
  drainPerSecond: 0.1,
  rewardPerBeat: 0.06,
  missPenalty: 0.12,
  // Set so that at the beat, a wrong note loses what a right one gains.
  wrongPenalty: 0.05,
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
  private readonly rewardPerBeat: number;
  private readonly drainPerSecond: number;
  private readonly missPenalty: number;
  private readonly wrongPenalty: number;
  private value = 1;

  constructor(options: HealthMeterOptions = {}) {
    this.drainPerBeat = options.drainPerBeat ?? DEFAULTS.drainPerBeat;
    this.rewardPerBeat = options.rewardPerBeat ?? DEFAULTS.rewardPerBeat;
    this.drainPerSecond = options.drainPerSecond ?? DEFAULTS.drainPerSecond;
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

  /** Time passing where no music does: seconds, not beats. */
  drainForSeconds(seconds: number): number {
    if (seconds <= 0) {
      return this.value;
    }
    return this.set(this.value - this.drainPerSecond * seconds);
  }

  /**
   * Filled again, the reader having found the beat.
   *
   * All the way, and not by what the step was worth: where nothing is keeping
   * time there is nothing to have kept up with, and the only question the bar
   * is asking is whether the reader is moving at all.
   */
  refill(): number {
    return this.set(1);
  }

  /**
   * A step that has been decided, one way or the other, and the beats of
   * music it occupied.
   *
   * Keeping up repays the time; getting it wrong costs on top of it. Repaid
   * per beat so that a bar is worth what a bar is worth however it happens to
   * be divided - it is the difference between a game and a lottery about how
   * many notes the writer put in it.
   *
   * A step nothing was asked at - a rest, or a bar belonging to the hand that
   * is not being practised - repays exactly what it drained, so the bar holds
   * level through it. It used to repay nothing, on the reasoning that paying
   * for silence would let a piece full of rests carry the reader. That reads
   * as fair and is not: practising one hand, whole passages belong to the
   * other, and the reader was being drained for a rest they were correctly
   * observing, with no note in reach to earn it back. Nothing was asked, so
   * nothing can be failed.
   */
  settle(status: 'correct' | 'incorrect' | 'missed' | 'skipped', beats = 0): number {
    const held = Math.max(0, beats);
    switch (status) {
      case 'correct':
        return this.set(this.value + this.rewardPerBeat * held);
      case 'incorrect':
        // Played, and kept up with, but not cleanly.
        return this.set(this.value + this.rewardPerBeat * held - this.wrongPenalty);
      case 'missed':
        // The music went past: nothing is repaid, and the miss costs as well.
        return this.set(this.value - this.missPenalty);
      default:
        return this.set(this.value + this.drainPerBeat * held);
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

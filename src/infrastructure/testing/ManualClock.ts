import type { IClock } from '../../application/ports/IClock.js';

/**
 * Clock the test drives by hand.
 *
 * Every timing rule in the trainer - chord tolerance windows, timing
 * deviations, step durations - can therefore be asserted exactly, with no
 * sleeping and no flakiness.
 */
export class ManualClock implements IClock {
  private current: number;

  constructor(startMs = 0) {
    this.current = startMs;
  }

  now(): number {
    return this.current;
  }

  advance(milliseconds: number): number {
    this.current += milliseconds;
    return this.current;
  }

  set(milliseconds: number): void {
    this.current = milliseconds;
  }
}

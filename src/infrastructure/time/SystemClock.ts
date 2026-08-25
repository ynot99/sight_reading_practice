import type { IClock } from '../../application/ports/IClock.js';

/**
 * The browser's high-resolution clock.
 *
 * `performance.now()` shares its time origin with Web MIDI event timestamps
 * and with the Web Audio scheduler's conversions, so every timing comparison
 * in the app is made on a single monotonic timeline.
 */
export class SystemClock implements IClock {
  now(): number {
    return typeof performance === 'undefined' ? Date.now() : performance.now();
  }
}

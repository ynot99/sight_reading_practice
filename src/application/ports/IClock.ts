/**
 * Monotonic time source.
 *
 * Every timing decision in the application flows through this port, so tests
 * can replay a whole performance instantly with a hand-advanced clock.
 */
export interface IClock {
  /** Milliseconds since an arbitrary but fixed origin. */
  now(): number;
}

/**
 * A slider through something played back - a take, a run shown again - with
 * where it stands and how long it is on either side.
 *
 * One answer for every such slider: what it says at a moment, and which
 * moment a position along it is. What dragging it does is the caller's.
 */
export interface ScrubBar {
  readonly position: HTMLOutputElement;
  readonly scrub: HTMLInputElement;
  readonly duration: HTMLOutputElement;
}

/** How finely the slider divides what it goes through. */
const STEPS = 1_000;

/** `m:ss`, which is how long a take feels rather than how long it is. */
export function clockTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Says where in it the playing stands, of how long. */
export function describeTheScrubBar(bar: ScrubBar, atMs: number, totalMs: number): void {
  bar.position.value = clockTime(atMs);
  bar.duration.value = clockTime(totalMs);
  bar.scrub.value = String(totalMs > 0 ? Math.round((Math.min(atMs, totalMs) / totalMs) * STEPS) : 0);
}

/** The moment the slider has been dragged to, of how long. */
export function momentOfTheScrubBar(bar: ScrubBar, totalMs: number): number {
  return (Number(bar.scrub.value) / STEPS) * totalMs;
}

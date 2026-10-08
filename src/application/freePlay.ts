import type { KeyDown, PedalDown } from './ExercisePlayer.js';
import type { MidiEvent } from './ports/IMidiSource.js';

/**
 * What the reader has played in free play, for as long as anything shows it.
 *
 * Each press from when to when, and each press of the pedal, kept in the
 * order they began. A key or a pedal still down has no end yet; asked about,
 * it lasts until the moment it is asked at, so a held note grows as it is
 * held.
 *
 * The moments are the caller's, taken when an event is heard rather than
 * read off the event: a keyboard's own timestamps may run on another clock -
 * the bridge's did, a second apart - and what is drawn here is drawn against
 * the page's.
 */
export class FreePlayed {
  private presses: KeyDown[] = [];
  private readonly held = new Map<number, number>();
  private pedals: PedalDown[] = [];
  private pedalFromMs: number | null = null;

  /**
   * Takes in one event heard at a moment, and says whether it changed what
   * is down.
   *
   * A key pressed again while it is down is the same press - two inputs can
   * report one key, and the first said it - and a key let go that was never
   * heard going down is nothing to end.
   */
  hear(event: MidiEvent, atMs: number): boolean {
    switch (event.type) {
      case 'noteon':
        if (this.held.has(event.midi)) {
          return false;
        }
        this.held.set(event.midi, atMs);
        return true;
      case 'noteoff': {
        const fromMs = this.held.get(event.midi);
        if (fromMs === undefined) {
          return false;
        }
        this.held.delete(event.midi);
        this.presses.push({ midi: event.midi, fromMs, untilMs: atMs });
        return true;
      }
      case 'pedal':
        if (event.down === (this.pedalFromMs !== null)) {
          return false;
        }
        if (event.down) {
          this.pedalFromMs = atMs;
        } else {
          this.pedals.push({ fromMs: this.pedalFromMs ?? atMs, untilMs: atMs });
          this.pedalFromMs = null;
        }
        return true;
      default:
        return false;
    }
  }

  /** The keys down now. */
  get keysDown(): readonly number[] {
    return [...this.held.keys()];
  }

  /** Whether the pedal is down now. */
  get pedalDown(): boolean {
    return this.pedalFromMs !== null;
  }

  /**
   * The presses down at any time between two moments, the ones still held
   * lasting until `nowMs`.
   */
  pressesBetween(fromMs: number, untilMs: number, nowMs: number): readonly KeyDown[] {
    const held = [...this.held].map(([midi, from]) => ({ midi, fromMs: from, untilMs: nowMs }));
    return [...this.presses, ...held].filter((press) => press.untilMs > fromMs && press.fromMs < untilMs);
  }

  /** The pedal down at any time between two moments, a press still down lasting until `nowMs`. */
  pedalBetween(fromMs: number, untilMs: number, nowMs: number): readonly PedalDown[] {
    const down = this.pedalFromMs === null ? [] : [{ fromMs: this.pedalFromMs, untilMs: nowMs }];
    return [...this.pedals, ...down].filter((press) => press.untilMs > fromMs && press.fromMs < untilMs);
  }

  /**
   * Lets go of what ended before a moment: nothing will ask about it again,
   * and an hour of playing would otherwise be kept to draw nothing.
   */
  forgetBefore(ms: number): void {
    this.presses = this.presses.filter((press) => press.untilMs >= ms);
    this.pedals = this.pedals.filter((press) => press.untilMs >= ms);
  }

  /** Whether anything is down, or ended at or after a moment. */
  anythingSince(ms: number): boolean {
    return (
      this.held.size > 0 ||
      this.pedalFromMs !== null ||
      this.presses.some((press) => press.untilMs >= ms) ||
      this.pedals.some((press) => press.untilMs >= ms)
    );
  }

  /** Lets go of everything, the keys still down included. */
  forget(): void {
    this.presses = [];
    this.held.clear();
    this.pedals = [];
    this.pedalFromMs = null;
  }
}

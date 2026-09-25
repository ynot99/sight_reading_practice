import type { IMidiSource, MidiEvent } from '../../application/ports/IMidiSource.js';
import type { Unsubscribe } from '../../shared/EventEmitter.js';

/**
 * How close together two presses of one key are one press heard twice.
 *
 * A key has to rise before it can be struck again, and no piano action
 * repeats a note this fast - so a second press of the same key inside it is
 * the first one arriving by another way: the keyboard plugged in, and the
 * bridge relaying the same keyboard. A key struck twice counts as an extra
 * note, and an echo counted as one would put a wrong note beside every right
 * one.
 */
export const ONE_PRESS_MS = 50;

/**
 * Merges several input streams into one.
 *
 * The session should not care whether a note came from a hardware keyboard,
 * the computer keyboard or a test script - it only cares that a note arrived,
 * and that it arrived once.
 */
export class CompositeMidiSource implements IMidiSource {
  private readonly sources: readonly IMidiSource[];

  constructor(sources: readonly IMidiSource[]) {
    this.sources = sources;
  }

  subscribe(listener: (event: MidiEvent) => void): Unsubscribe {
    const struck = new Map<number, number>();
    const once = (event: MidiEvent): void => {
      if (event.type === 'noteon') {
        const before = struck.get(event.midi);
        if (before !== undefined && Math.abs(event.timestampMs - before) < ONE_PRESS_MS) {
          return;
        }
        struck.set(event.midi, event.timestampMs);
      }
      listener(event);
    };
    const handles = this.sources.map((source) => source.subscribe(once));
    return () => {
      for (const handle of handles) {
        handle();
      }
    };
  }
}

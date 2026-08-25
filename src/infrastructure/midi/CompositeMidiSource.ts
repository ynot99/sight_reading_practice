import type { IMidiSource, MidiEvent } from '../../application/ports/IMidiSource.js';
import type { Unsubscribe } from '../../shared/EventEmitter.js';

/**
 * Merges several input streams into one.
 *
 * The session should not care whether a note came from a hardware keyboard,
 * the computer keyboard or a test script - it only cares that a note arrived.
 */
export class CompositeMidiSource implements IMidiSource {
  private readonly sources: readonly IMidiSource[];

  constructor(sources: readonly IMidiSource[]) {
    this.sources = sources;
  }

  subscribe(listener: (event: MidiEvent) => void): Unsubscribe {
    const handles = this.sources.map((source) => source.subscribe(listener));
    return () => {
      for (const handle of handles) {
        handle();
      }
    };
  }
}

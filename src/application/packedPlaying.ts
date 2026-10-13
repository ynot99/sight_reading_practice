import type { HeardBeat, MidiFileEvent } from '../domain/midi/MidiFile.js';

/*
 * How a stream of playing is written into browser storage, for every shelf
 * that keeps one: the takes, and the sketches made from them.
 */

/**
 * One event as a tuple, which is most of what makes the library fit.
 *
 * `{"kind":"noteOn","atMs":12345,"midi":60,"velocity":0.7}` is fifty-odd
 * characters and `[0,12345,60,89]` is fifteen, over tens of thousands of
 * events. The events themselves stay the stored thing - the MIDI file is
 * derived from them on export, never the other way round, for the same
 * reason an `Exercise` and not its MusicXML is what this project keeps.
 */
type Packed = readonly [kind: number, atMs: number, a: number, b: number];

export function pack(event: MidiFileEvent): Packed {
  switch (event.kind) {
    case 'noteOn':
      return [0, Math.round(event.atMs), event.midi, Math.round(event.velocity * 127)];
    case 'noteOff':
      return [1, Math.round(event.atMs), event.midi, 0];
    case 'sustain':
      return [2, Math.round(event.atMs), 0, Math.round(event.value * 127)];
  }
}

export function unpack(value: unknown): MidiFileEvent | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }
  const [kind, atMs, a, b] = value as readonly unknown[];
  if (typeof kind !== 'number' || typeof atMs !== 'number' || typeof a !== 'number' || typeof b !== 'number') {
    return null;
  }
  switch (kind) {
    case 0:
      return { kind: 'noteOn', atMs, midi: a, velocity: b / 127 };
    case 1:
      return { kind: 'noteOff', atMs, midi: a };
    case 2:
      return { kind: 'sustain', atMs, value: b / 127 };
    default:
      return null;
  }
}

/** A beat as a tuple, as the events are: `[atMs, beat, beatsInBar]`. */
export function packBeat(beat: HeardBeat): readonly [number, number, number] {
  return [Math.round(beat.atMs), beat.beat, beat.beatsInBar];
}

export function unpackBeat(value: unknown): HeardBeat | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const [atMs, beat, beatsInBar] = value as readonly unknown[];
  // Its place has to be one its bar has: the bars are counted back from it.
  if (
    typeof atMs !== 'number' ||
    !Number.isInteger(beat) ||
    !Number.isInteger(beatsInBar) ||
    (beat as number) < 0 ||
    (beat as number) >= (beatsInBar as number)
  ) {
    return null;
  }
  return { atMs, beat: beat as number, beatsInBar: beatsInBar as number };
}

/**
 * A click's beats read back, every one or none: a bar is read off every beat
 * of it, so one beat unreadable costs the click and not what was played; and
 * something kept before there were beats was played without one.
 */
export function theBeatsIfWhole(value: unknown): readonly HeardBeat[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const beats = value.map(unpackBeat);
  return beats.every((beat) => beat !== null) ? (beats as HeardBeat[]) : [];
}

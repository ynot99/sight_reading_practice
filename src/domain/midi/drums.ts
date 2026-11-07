import type { MidiFileEvent } from './MidiFile.js';

/** One drum of the kit a sketch's drums are written for. */
export interface DrumOfTheKit {
  /** The number a hit of it is kept under, in the place a key's pitch is. */
  readonly midi: number;
  /** Its name in full, as a row of the drawing says it when asked. */
  readonly name: string;
  /** And as short as the strip beside the drawing has room for. */
  readonly short: string;
}

/**
 * The drums a sketch's drums are written for, the lowest first - the kick at
 * the foot of the drawing, the cymbals at its head, as a drummer reads a
 * kit from the floor up.
 *
 * Numbered one after another rather than by a standard's numbers, which
 * leave gaps: each number is a row of the drawing, and a gap would be a row
 * no drum is on. The drums are never written into a file, so no other
 * program has to read the numbers.
 */
export const DRUM_KIT: readonly DrumOfTheKit[] = [
  { midi: 36, name: 'Kick drum', short: 'Kick' },
  { midi: 37, name: 'Snare drum', short: 'Snare' },
  { midi: 38, name: 'Hand clap', short: 'Clap' },
  { midi: 39, name: 'Closed hi-hat', short: 'Hat' },
  { midi: 40, name: 'Open hi-hat', short: 'Open hat' },
  { midi: 41, name: 'Low tom', short: 'Low tom' },
  { midi: 42, name: 'High tom', short: 'High tom' },
  { midi: 43, name: 'Ride cymbal', short: 'Ride' },
  { midi: 44, name: 'Crash cymbal', short: 'Crash' },
];

/** The drum a number names, or `null` where the kit has none by it. */
export function theDrumOf(midi: number): DrumOfTheKit | null {
  return DRUM_KIT.find((drum) => drum.midi === midi) ?? null;
}

/** The lowest and highest numbers of the kit: the rows a drawing of the drums has. */
export const THE_KITS_RANGE: { readonly low: number; readonly high: number } = {
  low: Math.min(...DRUM_KIT.map((drum) => drum.midi)),
  high: Math.max(...DRUM_KIT.map((drum) => drum.midi)),
};

/**
 * The events with the notes and the drums changed places: each drum struck
 * as a key struck, and each key as a drum. Everything else - the pedal, the
 * marks, the times - as it was.
 *
 * What lets the drums be written with everything the notes are written
 * with: shown so, every gesture that finds and changes notes finds and
 * changes the drums, and leaves the notes alone as it leaves the pedal.
 * Done twice it is undone, so what was changed in it is changed back by
 * doing it again.
 */
export function theNotesAndTheDrumsSwapped(events: readonly MidiFileEvent[]): readonly MidiFileEvent[] {
  return events.map((event): MidiFileEvent => {
    switch (event.kind) {
      case 'noteOn':
        return { ...event, kind: 'drumOn' };
      case 'drumOn':
        return { ...event, kind: 'noteOn' };
      case 'noteOff':
        return { ...event, kind: 'drumOff' };
      case 'drumOff':
        return { ...event, kind: 'noteOff' };
      default:
        return event;
    }
  });
}

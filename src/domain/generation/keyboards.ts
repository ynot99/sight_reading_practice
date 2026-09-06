import { Pitch } from '../model/Pitch.js';
import type { PitchRange } from './voices/IVoiceGenerator.js';

/**
 * The keyboards a reader might be sitting at.
 *
 * Named by how many keys they have, which is how they are sold and how
 * anybody describes one - "a sixty-one" rather than "C2 to C7". `any` is a
 * whole piano and asks for no narrowing at all, which is what generated
 * material has always assumed.
 *
 * `laptop` is this program's own computer-keyboard input: two octaves from
 * C3, which is the map it lays over the letter keys. A reader practising on
 * a train has those and nothing else.
 */
export const KEYBOARD_SIZES = ['any', '88', '76', '61', '49', '37', '25', 'laptop'] as const;

export type KeyboardSize = (typeof KEYBOARD_SIZES)[number];

/**
 * The lowest and highest key of each, as MIDI numbers.
 *
 * The usual makers' spans: an eighty-eight starts at A0 and ends at C8;
 * the smaller boards are the common C-to-C runs, which is what all but a
 * handful of them are.
 */
const SPANS: Readonly<Record<Exclude<KeyboardSize, 'any'>, readonly [number, number]>> = {
  '88': [21, 108],
  '76': [28, 103],
  '61': [36, 96],
  '49': [36, 84],
  '37': [48, 84],
  '25': [48, 72],
  laptop: [48, 72],
};

/** The keys a size has, or `null` for a whole piano. */
export function keysOf(size: KeyboardSize): PitchRange | null {
  if (size === 'any') {
    return null;
  }
  const span = SPANS[size];
  return { lowest: Pitch.fromMidi(span[0]), highest: Pitch.fromMidi(span[1]) };
}

/** How many keys a size has, for saying so on the page. */
export function keyCountOf(size: KeyboardSize): number | null {
  const keys = keysOf(size);
  return keys === null ? null : keys.highest.midi - keys.lowest.midi + 1;
}

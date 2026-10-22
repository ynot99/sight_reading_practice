import type { Hand, HeardBeat, MidiFileEvent } from '../domain/midi/MidiFile.js';
import { SCALE_NAMES } from '../domain/harmony/scales.js';
import { DYNAMIC_LEVELS } from '../domain/model/Exercise.js';

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
type Packed = readonly number[];

/** A hand as a number after a press's four, where one is said: 1 the right, 2 the left. */
const HAND_CODES: Readonly<Record<Hand, number>> = { right: 1, left: 2 };

export function pack(event: MidiFileEvent): Packed {
  switch (event.kind) {
    case 'noteOn': {
      const packed = [0, Math.round(event.atMs), event.midi, Math.round(event.velocity * 127)];
      const hand = event.hand === undefined ? [] : [HAND_CODES[event.hand]];
      // How loud it is written after its hand, none being said as nought:
      // the level by its place in the list from one, or nought for the
      // dynamic it is in, and the share towards the next.
      return event.loudness === undefined
        ? [...packed, ...hand]
        : [
            ...packed,
            hand[0] ?? 0,
            event.loudness.level === null ? 0 : DYNAMIC_LEVELS.indexOf(event.loudness.level) + 1,
            Math.round(event.loudness.shade),
          ];
    }
    case 'noteOff':
      return [1, Math.round(event.atMs), event.midi, 0];
    case 'sustain':
      return [2, Math.round(event.atMs), 0, Math.round(event.value * 127)];
    case 'key':
      return [3, Math.round(event.atMs), event.fifths, SCALE_NAMES.indexOf(event.scale)];
    case 'dynamic':
      return [4, Math.round(event.atMs), DYNAMIC_LEVELS.indexOf(event.level), 0];
  }
}

export function unpack(value: unknown): MidiFileEvent | null {
  if (!Array.isArray(value) || value.length < 4) {
    return null;
  }
  const [kind, atMs, a, b, hand, level, shade] = value as readonly unknown[];
  if (typeof kind !== 'number' || typeof atMs !== 'number' || typeof a !== 'number' || typeof b !== 'number') {
    return null;
  }
  switch (kind) {
    case 0: {
      const played = { kind: 'noteOn' as const, atMs, midi: a, velocity: b / 127 };
      // A level not known, or a share past the next level, is no loudness
      // written: the note is as loud as it is.
      const written = typeof level === 'number' && Number.isInteger(level) && typeof shade === 'number' && Math.abs(shade) <= 100
        ? level === 0
          ? { level: null, shade }
          : DYNAMIC_LEVELS[level - 1] === undefined
            ? undefined
            : { level: DYNAMIC_LEVELS[level - 1] ?? null, shade }
        : undefined;
      const struck = written === undefined ? played : { ...played, loudness: written };
      // A hand not known is no hand said, which is what the note had before.
      return hand === HAND_CODES.right
        ? { ...struck, hand: 'right' }
        : hand === HAND_CODES.left
          ? { ...struck, hand: 'left' }
          : struck;
    }
    case 1:
      return { kind: 'noteOff', atMs, midi: a };
    case 2:
      return { kind: 'sustain', atMs, value: b / 127 };
    case 3: {
      // A signature has seven sharps or flats at most, and the scale is one of those offered.
      const scale = SCALE_NAMES[b];
      return Number.isInteger(a) && a >= -7 && a <= 7 && scale !== undefined ? { kind: 'key', atMs, fifths: a, scale } : null;
    }
    case 4: {
      const level = DYNAMIC_LEVELS[a];
      return level === undefined ? null : { kind: 'dynamic', atMs, level };
    }
    default:
      return null;
  }
}

/**
 * A beat as a tuple, as the events are: `[atMs, beat, beatsInBar]`, and its
 * value after them where it says one.
 */
export function packBeat(beat: HeardBeat): readonly number[] {
  const packed = [Math.round(beat.atMs), beat.beat, beat.beatsInBar];
  return beat.beatType === undefined ? packed : [...packed, beat.beatType];
}

/** The values a beat may be written as: a breve's half down to a demisemiquaver. */
const BEAT_TYPES: readonly number[] = [1, 2, 4, 8, 16, 32];

export function unpackBeat(value: unknown): HeardBeat | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const [atMs, beat, beatsInBar, beatType] = value as readonly unknown[];
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
  const read = { atMs, beat: beat as number, beatsInBar: beatsInBar as number };
  if (beatType === undefined) {
    return read;
  }
  // A value no bar is written in would give its beats no length to be.
  return BEAT_TYPES.includes(beatType as number) ? { ...read, beatType: beatType as number } : null;
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

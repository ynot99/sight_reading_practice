import { DomainError } from '../../shared/errors.js';

/**
 * One thing that happened at the keyboard, in the terms a file needs.
 *
 * Deliberately not `MidiEvent` from the input port: that one carries where it
 * came from and when it was delivered, neither of which belongs in a file.
 */
export type MidiFileEvent =
  | { readonly kind: 'noteOn'; readonly atMs: number; readonly midi: number; readonly velocity: number }
  | { readonly kind: 'noteOff'; readonly atMs: number; readonly midi: number }
  | { readonly kind: 'sustain'; readonly atMs: number; readonly value: number };

export interface MidiFileOptions {
  /**
   * The tempo the file declares.
   *
   * Free playing has no tempo to discover, so one is declared rather than
   * guessed and the notes are placed in real time against it. Anything
   * opening the file sees the rhythm that was actually played; a wrong guess
   * would move the notes, and a capture that moves the notes is not a
   * capture.
   */
  readonly tempoBpm?: number;
  readonly trackName?: string;
}

const DEFAULT_TEMPO_BPM = 120;
const MICROSECONDS_PER_MINUTE = 60_000_000;

/**
 * Ticks to the quarter in the files this writes.
 *
 * Its own number, not the notation's divisions. They were the same once and
 * that was a coincidence: a capture is placed in real time and carries no
 * notated values at all, so how finely a septuplet has to divide is nothing
 * to do with it. 480 is what a sequencer expects to see in a header, and a
 * capture is meant to be opened by other programs.
 */
const TICKS_PER_QUARTER = 480;

/** Halfway on a damper pedal, where the felt reaches the strings. */
const DAMPER_HALFWAY = 64;

/**
 * Whether the dampers are off the strings, from a pedal reading.
 *
 * MIDI's own convention is that 64 and above is "on", and for a switch that
 * is fine because a switch only ever says 0 or 127. A keyboard that reports
 * how far the pedal has travelled says 64 on the way through, in both
 * directions - so a foot that comes up and goes straight back down, which is
 * how a pianist changes the pedal, is reported as `127, 64, 127` with no
 * zero in it at all. Read by the convention that would be no movement, and
 * the change of harmony the reader made with their foot is thrown away.
 *
 * Halfway is where the felt begins to touch, so halfway is read as touching.
 * A switch pedal is unaffected: it never reports the middle.
 */
export function damperIsDown(value: number): boolean {
  return Math.round(value * 127) > DAMPER_HALFWAY;
}

/** MIDI's 7-bit range, with 0 reserved: a note-on of 0 is a note-off. */
function toVelocity(normalised: number): number {
  return Math.min(127, Math.max(1, Math.round(normalised * 127)));
}

function toController(normalised: number): number {
  return Math.min(127, Math.max(0, Math.round(normalised * 127)));
}

/**
 * MIDI's variable-length quantity: seven bits per byte, high bit as "more".
 *
 * Delta times are written this way, which is what keeps a file of mostly
 * small gaps small.
 */
function variableLength(value: number): number[] {
  if (value < 0 || !Number.isInteger(value)) {
    throw new DomainError(`A delta time must be a whole number of ticks, got ${value}.`);
  }
  const bytes = [value & 0x7f];
  let rest = value >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0) & 0x7f);
}

function uint32(value: number): number[] {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** Rank at one instant: a release must be written before the next press. */
function orderAt(event: MidiFileEvent): number {
  switch (event.kind) {
    case 'noteOff':
      return 0;
    case 'sustain':
      return 1;
    default:
      return 2;
  }
}

/**
 * Writes a performance as a Standard MIDI File.
 *
 * Format 0 - one track, every channel in it - because a capture of one
 * keyboard is one stream, and format 0 is the shape every program reads.
 *
 * Pure by design, like {@link ../notation/MusicXmlSerializer.js}: bytes in,
 * bytes out, no clock and no I/O, so a whole recording can be asserted on
 * byte for byte in a test.
 */
export function writeMidiFile(
  events: readonly MidiFileEvent[],
  options: MidiFileOptions = {},
): Uint8Array {
  const tempoBpm = options.tempoBpm ?? DEFAULT_TEMPO_BPM;
  if (tempoBpm <= 0) {
    throw new DomainError(`A tempo must be positive, got ${tempoBpm}.`);
  }
  const msPerTick = 60_000 / (tempoBpm * TICKS_PER_QUARTER);

  // Stable: two events at the same instant keep the order they arrived in,
  // except that a release always precedes a press, so re-striking a key that
  // is still down cannot silence the note that just started.
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const byTime = left.event.atMs - right.event.atMs;
      if (byTime !== 0) {
        return byTime;
      }
      const byKind = orderAt(left.event) - orderAt(right.event);
      return byKind === 0 ? left.index - right.index : byKind;
    })
    .map(({ event }) => event);

  const track: number[] = [];
  // Tempo, so the notes mean the same thing wherever the file is opened.
  track.push(
    ...variableLength(0),
    0xff,
    0x51,
    0x03,
    ...uint32(Math.round(MICROSECONDS_PER_MINUTE / tempoBpm)).slice(1),
  );
  const name = options.trackName;
  if (name !== undefined && name.length > 0) {
    const text = ascii(name);
    track.push(...variableLength(0), 0xff, 0x03, ...variableLength(text.length), ...text);
  }

  let previousTick = 0;
  for (const event of ordered) {
    const tick = Math.max(0, Math.round(event.atMs / msPerTick));
    track.push(...variableLength(Math.max(0, tick - previousTick)));
    previousTick = Math.max(previousTick, tick);
    switch (event.kind) {
      case 'noteOn':
        track.push(0x90, event.midi & 0x7f, toVelocity(event.velocity));
        break;
      case 'noteOff':
        track.push(0x80, event.midi & 0x7f, 0x40);
        break;
      case 'sustain':
        track.push(0xb0, 0x40, toController(event.value));
        break;
    }
  }
  track.push(...variableLength(0), 0xff, 0x2f, 0x00);

  return Uint8Array.from([
    ...ascii('MThd'),
    ...uint32(6),
    0x00,
    0x00,
    0x00,
    0x01,
    (TICKS_PER_QUARTER >> 8) & 0xff,
    TICKS_PER_QUARTER & 0xff,
    ...ascii('MTrk'),
    ...uint32(track.length),
    ...track,
  ]);
}

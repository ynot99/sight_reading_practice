/**
 * Structural types for the Web MIDI API.
 *
 * Declaring exactly what we use - instead of depending on ambient `MIDIAccess`
 * globals that may or may not exist in a given TypeScript lib - keeps the
 * adapter free of environment assumptions and makes it injectable in tests.
 */
export interface MidiMessageEventLike {
  readonly data: Uint8Array | null;
  readonly timeStamp: number;
}

export interface MidiInputLike {
  readonly id: string;
  readonly name: string | null;
  readonly manufacturer: string | null;
  readonly state: string;
  onmidimessage: ((event: MidiMessageEventLike) => void) | null;
}

export interface MidiInputMapLike {
  values(): IterableIterator<MidiInputLike>;
}

export interface MidiAccessLike {
  readonly inputs: MidiInputMapLike;
  onstatechange: ((event: unknown) => void) | null;
}

/** Requests access to the host's MIDI devices. */
export type MidiAccessProvider = (options?: { sysex?: boolean }) => Promise<MidiAccessLike>;

interface NavigatorWithMidi {
  requestMIDIAccess?: MidiAccessProvider;
}

/** The browser's provider, or `null` when the API is unavailable. */
export function browserMidiAccessProvider(): MidiAccessProvider | null {
  if (typeof navigator === 'undefined') {
    return null;
  }
  const candidate = (navigator as unknown as NavigatorWithMidi).requestMIDIAccess;
  if (typeof candidate !== 'function') {
    return null;
  }
  return (options) => candidate.call(navigator, options);
}

export const NOTE_ON = 0x90;
export const NOTE_OFF = 0x80;

export interface ParsedMidiMessage {
  readonly kind: 'noteon' | 'noteoff';
  readonly midi: number;
  readonly velocity: number;
}

/**
 * Decodes a raw MIDI packet.
 *
 * Note-on with zero velocity is the running-status idiom for note-off, and
 * plenty of keyboards use it exclusively, so it is normalised here.
 */
export function parseMidiMessage(data: Uint8Array | null): ParsedMidiMessage | null {
  if (data === null || data.length < 3) {
    return null;
  }
  const status = (data[0] ?? 0) & 0xf0;
  const midi = data[1] ?? 0;
  const rawVelocity = data[2] ?? 0;

  if (status === NOTE_ON && rawVelocity > 0) {
    return { kind: 'noteon', midi, velocity: rawVelocity / 127 };
  }
  if (status === NOTE_OFF || (status === NOTE_ON && rawVelocity === 0)) {
    return { kind: 'noteoff', midi, velocity: 0 };
  }
  return null;
}

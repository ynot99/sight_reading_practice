import type { Unsubscribe } from '../../shared/EventEmitter.js';

export interface MidiNoteOnEvent {
  readonly type: 'noteon';
  readonly midi: number;
  /** `0..1`, normalised from the 7-bit MIDI velocity. */
  readonly velocity: number;
  readonly timestampMs: number;
  readonly sourceId: string;
}

export interface MidiNoteOffEvent {
  readonly type: 'noteoff';
  readonly midi: number;
  readonly timestampMs: number;
  readonly sourceId: string;
}

/**
 * The sustain pedal, which a keyboard reports as a continuous controller.
 *
 * Carried as its own event rather than folded into note events because it
 * changes how the *instrument* behaves, not what was played: the practice
 * session is entirely uninterested in it.
 */
export interface MidiPedalEvent {
  readonly type: 'pedal';
  readonly pedal: 'sustain';
  readonly down: boolean;
  /** Raw controller value, `0..1`; half-pedalling lives in here. */
  readonly value: number;
  readonly timestampMs: number;
  readonly sourceId: string;
}

/**
 * A knob, slider or wheel, as the controller number it actually sends.
 *
 * Unnamed on purpose. There is no standard for which controller a volume knob
 * uses - it might be 7, or 11, or whatever the manufacturer chose - so the
 * number travels intact and what it *means* is decided where the reader can
 * teach it.
 */
export interface MidiControlEvent {
  readonly type: 'control';
  /** `0..127`, the controller number the keyboard sent. */
  readonly controller: number;
  /** Its position, normalised to `0..1`. */
  readonly value: number;
  readonly timestampMs: number;
  readonly sourceId: string;
}

export type MidiEvent =
  | MidiNoteOnEvent
  | MidiNoteOffEvent
  | MidiPedalEvent
  | MidiControlEvent;

/**
 * A stream of note events.
 *
 * Deliberately the smallest possible interface: the practice session needs
 * nothing beyond "tell me when keys go down and up". A hardware keyboard, the
 * computer keyboard and a scripted test double are all interchangeable here.
 */
export interface IMidiSource {
  subscribe(listener: (event: MidiEvent) => void): Unsubscribe;
}

export type MidiConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'unsupported'
  | 'denied'
  | 'error';

/** Lifecycle of a hardware connection, kept separate from the event stream. */
export interface IMidiConnection {
  readonly status: MidiConnectionStatus;
  connect(): Promise<MidiConnectionStatus>;
  disconnect(): Promise<void>;
  onStatusChange(listener: (status: MidiConnectionStatus) => void): Unsubscribe;
}

export interface MidiInputDescriptor {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string;
}

/** Device discovery and selection, again separate so mocks stay tiny. */
export interface IMidiDeviceDirectory {
  readonly selectedInputId: string | null;
  inputs(): readonly MidiInputDescriptor[];
  /** `null` listens to every available input. */
  selectInput(inputId: string | null): void;
  onInputsChanged(listener: (inputs: readonly MidiInputDescriptor[]) => void): Unsubscribe;
}

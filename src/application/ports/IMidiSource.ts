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

export type MidiEvent = MidiNoteOnEvent | MidiNoteOffEvent;

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

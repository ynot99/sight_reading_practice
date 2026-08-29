import type { IClock } from '../../application/ports/IClock.js';
import type {
  IMidiConnection,
  IMidiDeviceDirectory,
  IMidiSource,
  MidiConnectionStatus,
  MidiEvent,
  MidiInputDescriptor,
} from '../../application/ports/IMidiSource.js';
import { TypedEventEmitter, type Unsubscribe } from '../../shared/EventEmitter.js';

export interface MockMidiOptions {
  /** Clock used for timestamps when the caller does not supply one. */
  readonly clock?: IClock;
  readonly sourceId?: string;
  readonly inputs?: readonly MidiInputDescriptor[];
}

/**
 * Scriptable MIDI keyboard.
 *
 * Implements the same three ports as the real Web MIDI adapter, so an entire
 * practice run - including chord tolerance windows and timing deviations -
 * can be replayed deterministically in a Node test with no hardware, no DOM
 * and no waiting.
 */
export class MockMidiAdapter implements IMidiSource, IMidiConnection, IMidiDeviceDirectory {
  private readonly emitter = new TypedEventEmitter<{
    midi: MidiEvent;
    status: MidiConnectionStatus;
    inputs: readonly MidiInputDescriptor[];
  }>();

  private readonly clock: IClock | null;
  private readonly sourceId: string;
  private availableInputs: readonly MidiInputDescriptor[];
  private currentStatus: MidiConnectionStatus = 'idle';
  private selectedId: string | null = null;

  /** Every event this adapter has emitted, for assertions. */
  readonly emitted: MidiEvent[] = [];

  constructor(options: MockMidiOptions = {}) {
    this.clock = options.clock ?? null;
    this.sourceId = options.sourceId ?? 'mock-midi';
    this.availableInputs = options.inputs ?? [
      { id: 'mock-1', name: 'Mock Keyboard', manufacturer: 'Test' },
    ];
  }

  get status(): MidiConnectionStatus {
    return this.currentStatus;
  }

  get selectedInputId(): string | null {
    return this.selectedId;
  }

  subscribe(listener: (event: MidiEvent) => void): Unsubscribe {
    return this.emitter.on('midi', listener);
  }

  onStatusChange(listener: (status: MidiConnectionStatus) => void): Unsubscribe {
    return this.emitter.on('status', listener);
  }

  onInputsChanged(listener: (inputs: readonly MidiInputDescriptor[]) => void): Unsubscribe {
    return this.emitter.on('inputs', listener);
  }

  connect(): Promise<MidiConnectionStatus> {
    this.currentStatus = 'connected';
    this.emitter.emit('status', this.currentStatus);
    return Promise.resolve(this.currentStatus);
  }

  disconnect(): Promise<void> {
    this.currentStatus = 'idle';
    this.emitter.emit('status', this.currentStatus);
    return Promise.resolve();
  }

  inputs(): readonly MidiInputDescriptor[] {
    return this.availableInputs;
  }

  selectInput(inputId: string | null): void {
    this.selectedId = inputId;
  }

  /** Simulates hot-plugging a device. */
  setInputs(inputs: readonly MidiInputDescriptor[]): void {
    this.availableInputs = inputs;
    this.emitter.emit('inputs', inputs);
  }

  noteOn(midi: number, timestampMs?: number, velocity = 0.8): MidiEvent {
    const event: MidiEvent = {
      type: 'noteon',
      midi,
      velocity,
      timestampMs: timestampMs ?? this.timestamp(),
      sourceId: this.sourceId,
    };
    this.dispatch(event);
    return event;
  }

  noteOff(midi: number, timestampMs?: number): MidiEvent {
    const event: MidiEvent = {
      type: 'noteoff',
      midi,
      timestampMs: timestampMs ?? this.timestamp(),
      sourceId: this.sourceId,
    };
    this.dispatch(event);
    return event;
  }

  /** Presses or releases the sustain pedal. */
  pedal(down: boolean, timestampMs?: number): MidiEvent {
    const event: MidiEvent = {
      type: 'pedal',
      pedal: 'sustain',
      down,
      value: down ? 1 : 0,
      timestampMs: timestampMs ?? this.timestamp(),
      sourceId: this.sourceId,
    };
    this.dispatch(event);
    return event;
  }

  /** A knob, slider or wheel at `value` (`0..1`). */
  control(controller: number, value: number, timestampMs?: number): MidiEvent {
    const event: MidiEvent = {
      type: 'control',
      controller,
      value,
      timestampMs: timestampMs ?? this.timestamp(),
      sourceId: this.sourceId,
    };
    this.dispatch(event);
    return event;
  }

  /** Presses and releases a single note. */
  play(midi: number, timestampMs?: number, velocity = 0.8): void {
    const at = timestampMs ?? this.timestamp();
    this.noteOn(midi, at, velocity);
    this.noteOff(midi, at);
  }

  /**
   * Presses several notes, optionally spreading them over time to exercise
   * the chord tolerance window.
   */
  playChord(
    midiNotes: readonly number[],
    startMs?: number,
    spreadMsBetweenNotes = 0,
    velocity = 0.8,
  ): void {
    const start = startMs ?? this.timestamp();
    midiNotes.forEach((midi, index) => {
      this.noteOn(midi, start + index * spreadMsBetweenNotes, velocity);
    });
  }

  /** Releases every note of a chord at the same instant. */
  releaseChord(midiNotes: readonly number[], atMs?: number): void {
    const at = atMs ?? this.timestamp();
    for (const midi of midiNotes) {
      this.noteOff(midi, at);
    }
  }

  private dispatch(event: MidiEvent): void {
    this.emitted.push(event);
    this.emitter.emit('midi', event);
  }

  private timestamp(): number {
    return this.clock?.now() ?? 0;
  }
}

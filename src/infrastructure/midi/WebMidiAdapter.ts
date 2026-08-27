import type {
  IMidiConnection,
  IMidiDeviceDirectory,
  IMidiSource,
  MidiConnectionStatus,
  MidiEvent,
  MidiInputDescriptor,
} from '../../application/ports/IMidiSource.js';
import type { IClock } from '../../application/ports/IClock.js';
import { TypedEventEmitter, type Unsubscribe } from '../../shared/EventEmitter.js';
import {
  parseMidiMessage,
  type MidiAccessLike,
  type MidiAccessProvider,
  type MidiInputLike,
} from './webmidi-dom.js';

interface AdapterEvents {
  midi: MidiEvent;
  status: MidiConnectionStatus;
  inputs: readonly MidiInputDescriptor[];
}

export interface WebMidiAdapterOptions {
  readonly requestSysex?: boolean;
}

/**
 * Web MIDI API adapter.
 *
 * Implements the three MIDI ports separately - stream, connection lifecycle
 * and device directory - so consumers depend only on the slice they need.
 * The access provider is injected, which is what allows the whole adapter,
 * including message decoding and hot-plugging, to be tested without hardware.
 */
export class WebMidiAdapter implements IMidiSource, IMidiConnection, IMidiDeviceDirectory {
  private readonly emitter = new TypedEventEmitter<AdapterEvents>();
  private readonly provider: MidiAccessProvider | null;
  private readonly clock: IClock;
  private readonly options: WebMidiAdapterOptions;

  private access: MidiAccessLike | null = null;
  private attached: MidiInputLike[] = [];
  private currentStatus: MidiConnectionStatus = 'idle';
  private selectedId: string | null = null;

  constructor(
    provider: MidiAccessProvider | null,
    clock: IClock,
    options: WebMidiAdapterOptions = {},
  ) {
    this.provider = provider;
    this.clock = clock;
    this.options = options;
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

  async connect(): Promise<MidiConnectionStatus> {
    if (this.provider === null) {
      return this.setStatus('unsupported');
    }
    if (this.currentStatus === 'connected') {
      return this.currentStatus;
    }

    this.setStatus('connecting');
    try {
      const access = await this.provider({ sysex: this.options.requestSysex ?? false });
      this.access = access;
      access.onstatechange = () => {
        this.attachInputs();
        this.emitter.emit('inputs', this.inputs());
      };
      this.attachInputs();
      this.emitter.emit('inputs', this.inputs());
      return this.setStatus('connected');
    } catch (error) {
      const denied =
        error instanceof Error && /denied|NotAllowed|SecurityError/i.test(`${error.name} ${error.message}`);
      return this.setStatus(denied ? 'denied' : 'error');
    }
  }

  async disconnect(): Promise<void> {
    this.detachInputs();
    if (this.access !== null) {
      this.access.onstatechange = null;
    }
    this.access = null;
    this.setStatus('idle');
    return Promise.resolve();
  }

  inputs(): readonly MidiInputDescriptor[] {
    if (this.access === null) {
      return [];
    }
    return [...this.access.inputs.values()].map((input) => ({
      id: input.id,
      name: input.name ?? 'Unnamed input',
      manufacturer: input.manufacturer ?? '',
    }));
  }

  selectInput(inputId: string | null): void {
    this.selectedId = inputId;
    this.attachInputs();
  }

  /** Subscribes to the selected input, or to every input when none is chosen. */
  private attachInputs(): void {
    this.detachInputs();
    if (this.access === null) {
      return;
    }

    for (const input of this.access.inputs.values()) {
      if (this.selectedId !== null && input.id !== this.selectedId) {
        continue;
      }
      input.onmidimessage = (event) => {
        this.handleMessage(input.id, event.data, event.timeStamp);
      };
      this.attached.push(input);
    }
  }

  private detachInputs(): void {
    for (const input of this.attached) {
      input.onmidimessage = null;
    }
    this.attached = [];
  }

  private handleMessage(sourceId: string, data: Uint8Array | null, timeStamp: number): void {
    const message = parseMidiMessage(data);
    if (message === null) {
      return;
    }
    // Some drivers report a zero timestamp; the clock is the reliable fallback.
    const timestampMs = timeStamp > 0 ? timeStamp : this.clock.now();

    switch (message.kind) {
      case 'noteon':
        this.emitter.emit('midi', {
          type: 'noteon',
          midi: message.midi,
          velocity: message.velocity,
          timestampMs,
          sourceId,
        });
        return;
      case 'noteoff':
        this.emitter.emit('midi', {
          type: 'noteoff',
          midi: message.midi,
          timestampMs,
          sourceId,
        });
        return;
      case 'sustain':
        this.emitter.emit('midi', {
          type: 'pedal',
          pedal: 'sustain',
          down: message.down,
          value: message.value,
          timestampMs,
          sourceId,
        });
        return;
      default:
        return;
    }
  }

  private setStatus(status: MidiConnectionStatus): MidiConnectionStatus {
    if (this.currentStatus !== status) {
      this.currentStatus = status;
      this.emitter.emit('status', status);
    }
    return status;
  }
}

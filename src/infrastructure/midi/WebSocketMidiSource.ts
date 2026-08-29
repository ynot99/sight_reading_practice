import type { IClock } from '../../application/ports/IClock.js';
import type {
  IMidiConnection,
  IMidiSource,
  MidiConnectionStatus,
  MidiEvent,
} from '../../application/ports/IMidiSource.js';
import { TypedEventEmitter, type Unsubscribe } from '../../shared/EventEmitter.js';
import { parseBridgeMessage } from './bridgeProtocol.js';

/** The slice of `WebSocket` this adapter uses, so tests can supply their own. */
export interface SocketLike {
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

/** Cancels a pending callback. */
export type CancelScheduled = () => void;

export type Scheduler = (callback: () => void, delayMs: number) => CancelScheduled;

export const browserSocketFactory: SocketFactory = (url) =>
  new WebSocket(url) as unknown as SocketLike;

export const timeoutScheduler: Scheduler = (callback, delayMs) => {
  const handle = setTimeout(callback, delayMs);
  return () => {
    clearTimeout(handle);
  };
};

export interface WebSocketMidiOptions {
  readonly url: string;
  readonly clock: IClock;
  readonly socketFactory?: SocketFactory;
  readonly schedule?: Scheduler;
  /** Backoff steps; the last one repeats for as long as the bridge is away. */
  readonly reconnectDelaysMs?: readonly number[];
  /**
   * Wall-clock moment this page's monotonic clock started from.
   *
   * The bridge stamps a key press with its own `Date.now()`, and everything
   * here is measured on `performance.now()`. This constant is exactly what
   * joins the two, and it does not drift the way repeated sampling would.
   */
  readonly timeOriginMs?: number;
}

/**
 * How far apart the two clocks may be before the bridge's stamp is dropped.
 *
 * Generous on purpose: the whole point is to *see* a disagreement of a few
 * milliseconds rather than to hide it, so only a difference no reader could
 * have played - a clock set to the wrong minute - is refused.
 */
const CLOCKS_DISAGREE_MS = 5_000;

interface AdapterEvents {
  midi: MidiEvent;
  status: MidiConnectionStatus;
  device: string | null;
}

const DEFAULT_RECONNECT_DELAYS: readonly number[] = [500, 1_000, 2_000, 5_000];

/**
 * MIDI arriving over a LAN socket from a desktop bridge.
 *
 * This is what makes an iPad usable as a practice screen: iPadOS has no Web
 * MIDI at all, so the keyboard is plugged into a computer nearby and its notes
 * are relayed here. To the rest of the application this is just another
 * {@link IMidiSource} - the session cannot tell it apart from real hardware.
 *
 * Reconnection is automatic and quiet: unplugging the keyboard, restarting the
 * bridge or letting the tablet sleep must not require a page reload.
 */
export class WebSocketMidiSource implements IMidiSource, IMidiConnection {
  private readonly emitter = new TypedEventEmitter<AdapterEvents>();
  private readonly url: string;
  private readonly clock: IClock;
  private readonly socketFactory: SocketFactory;
  private readonly schedule: Scheduler;
  private readonly reconnectDelays: readonly number[];

  private socket: SocketLike | null = null;
  private currentStatus: MidiConnectionStatus = 'idle';
  private device: string | null = null;
  private attempt = 0;
  private cancelRetry: CancelScheduled | null = null;
  private wantsConnection = false;
  private settle: ((status: MidiConnectionStatus) => void) | null = null;
  private readonly timeOriginMs: number | null;

  constructor(options: WebSocketMidiOptions) {
    this.url = options.url;
    this.clock = options.clock;
    this.socketFactory = options.socketFactory ?? browserSocketFactory;
    this.schedule = options.schedule ?? timeoutScheduler;
    this.reconnectDelays =
      options.reconnectDelaysMs === undefined || options.reconnectDelaysMs.length === 0
        ? DEFAULT_RECONNECT_DELAYS
        : options.reconnectDelaysMs;
    this.timeOriginMs =
      options.timeOriginMs ?? (typeof performance === 'undefined' ? null : performance.timeOrigin);
  }

  get status(): MidiConnectionStatus {
    return this.currentStatus;
  }

  /** Name of the MIDI port the bridge is reading, once it has told us. */
  get deviceName(): string | null {
    return this.device;
  }

  get endpoint(): string {
    return this.url;
  }

  subscribe(listener: (event: MidiEvent) => void): Unsubscribe {
    return this.emitter.on('midi', listener);
  }

  onStatusChange(listener: (status: MidiConnectionStatus) => void): Unsubscribe {
    return this.emitter.on('status', listener);
  }

  onDeviceChange(listener: (device: string | null) => void): Unsubscribe {
    return this.emitter.on('device', listener);
  }

  /** Resolves once the first attempt has settled; retries continue after that. */
  connect(): Promise<MidiConnectionStatus> {
    if (this.currentStatus === 'connected') {
      return Promise.resolve(this.currentStatus);
    }
    this.wantsConnection = true;
    const pending = new Promise<MidiConnectionStatus>((resolve) => {
      this.settle = resolve;
    });
    this.open();
    return pending;
  }

  disconnect(): Promise<void> {
    this.wantsConnection = false;
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.attempt = 0;
    this.closeSocket();
    this.setDevice(null);
    this.setStatus('idle');
    return Promise.resolve();
  }

  private open(): void {
    this.closeSocket();
    this.setStatus('connecting');

    let socket: SocketLike;
    try {
      socket = this.socketFactory(this.url);
    } catch {
      this.handleFailure();
      return;
    }

    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.setStatus('connected');
      this.resolveFirstAttempt('connected');
    };
    socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };
    socket.onerror = () => {
      // A close always follows; retrying here as well would double the backoff.
    };
    socket.onclose = () => {
      this.socket = null;
      this.setDevice(null);
      this.handleFailure();
    };
  }

  private handleFailure(): void {
    if (!this.wantsConnection) {
      this.setStatus('idle');
      return;
    }
    this.setStatus('error');
    this.resolveFirstAttempt('error');

    const index = Math.min(this.attempt, this.reconnectDelays.length - 1);
    const delay = this.reconnectDelays[index] ?? 5_000;
    this.attempt += 1;
    this.cancelRetry?.();
    this.cancelRetry = this.schedule(() => {
      this.cancelRetry = null;
      if (this.wantsConnection) {
        this.open();
      }
    }, delay);
  }

  private handleMessage(data: unknown): void {
    const message = parseBridgeMessage(data);
    if (message === null) {
      return;
    }

    switch (message.type) {
      case 'hello':
      case 'device':
        this.setDevice(message.device);
        return;
      case 'noteon':
        this.emitter.emit('midi', {
          type: 'noteon',
          midi: message.note,
          velocity: message.velocity,
          timestampMs: this.stampFor(message.at),
          sourceId: 'bridge',
        });
        return;
      case 'noteoff':
        this.emitter.emit('midi', {
          type: 'noteoff',
          midi: message.note,
          timestampMs: this.stampFor(message.at),
          sourceId: 'bridge',
        });
        return;
      case 'pedal':
        this.emitter.emit('midi', {
          type: 'pedal',
          pedal: 'sustain',
          down: message.down,
          value: message.value,
          timestampMs: this.clock.now(),
          sourceId: 'bridge',
        });
        return;
      case 'control':
        this.emitter.emit('midi', {
          type: 'control',
          controller: message.controller,
          value: message.value,
          timestampMs: this.clock.now(),
          sourceId: 'bridge',
        });
        return;
      default:
        return;
    }
  }

  private closeSocket(): void {
    const socket = this.socket;
    if (socket === null) {
      return;
    }
    // Detach first: an intentional close must not trigger the retry path.
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    this.socket = null;
    try {
      socket.close();
    } catch {
      // Already closing; nothing to do.
    }
  }

  private setStatus(status: MidiConnectionStatus): void {
    if (this.currentStatus === status) {
      return;
    }
    this.currentStatus = status;
    this.emitter.emit('status', status);
  }

  /**
   * When the key was struck, in this page's own time.
   *
   * The bridge's stamp is preferred because it was taken at the source: the
   * LAN hop and the tablet's scheduling both land between the press and its
   * arrival here, and neither is steady, so a press exactly on the beat could
   * read as late by a different amount each time. Taken at the bridge, that
   * jitter is gone and what remains is the difference between two clocks -
   * steady, and therefore visible.
   *
   * It rests on both machines agreeing about the wall clock, which they do
   * when both keep time from the network. When they plainly do not, arrival
   * is used instead: a stamp minutes adrift is not a better measurement than
   * a slightly late one, it is an unusable app.
   */
  private stampFor(bridgeAtMs: number | undefined): number {
    const arrived = this.clock.now();
    if (bridgeAtMs === undefined || this.timeOriginMs === null) {
      return arrived;
    }
    const converted = bridgeAtMs - this.timeOriginMs;
    return Math.abs(converted - arrived) > CLOCKS_DISAGREE_MS ? arrived : converted;
  }

  private setDevice(device: string | null): void {
    if (this.device === device) {
      return;
    }
    this.device = device;
    this.emitter.emit('device', device);
  }

  private resolveFirstAttempt(status: MidiConnectionStatus): void {
    const settle = this.settle;
    if (settle !== null) {
      this.settle = null;
      settle(status);
    }
  }
}

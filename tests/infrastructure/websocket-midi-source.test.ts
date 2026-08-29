import { describe, expect, it, vi } from 'vitest';
import type { MidiEvent } from '../../src/application/ports/IMidiSource.js';
import { parseBridgeMessage } from '../../src/infrastructure/midi/bridgeProtocol.js';
import { isPrivateHost, resolveBridgeUrl } from '../../src/infrastructure/midi/bridgeUrl.js';
import {
  WebSocketMidiSource,
  type SocketLike,
} from '../../src/infrastructure/midi/WebSocketMidiSource.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';

/** Socket the test opens, closes and feeds by hand. */
class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {}

  open(): void {
    this.onopen?.();
  }

  deliver(payload: unknown): void {
    this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  }

  drop(): void {
    this.onclose?.();
  }

  close(): void {
    this.closed = true;
  }
}

interface Rig {
  readonly source: WebSocketMidiSource;
  readonly clock: ManualClock;
  readonly events: MidiEvent[];
  readonly sockets: FakeSocket[];
  /** Runs the pending reconnect timer, if one was scheduled. */
  runPendingRetry(): void;
  readonly pendingDelays: number[];
}

function createRig(url = 'ws://192.168.1.5:8080/midi', timeOriginMs?: number): Rig {
  const clock = new ManualClock(1_000);
  const sockets: FakeSocket[] = [];
  const events: MidiEvent[] = [];
  const pending: (() => void)[] = [];
  const pendingDelays: number[] = [];

  const source = new WebSocketMidiSource({
    url,
    clock,
    ...(timeOriginMs === undefined ? {} : { timeOriginMs }),
    socketFactory: (target) => {
      const socket = new FakeSocket(target);
      sockets.push(socket);
      return socket;
    },
    schedule: (callback, delayMs) => {
      pending.push(callback);
      pendingDelays.push(delayMs);
      return () => {
        const index = pending.indexOf(callback);
        if (index >= 0) {
          pending.splice(index, 1);
          pendingDelays.splice(index, 1);
        }
      };
    },
    reconnectDelaysMs: [10, 20, 40],
  });

  source.subscribe((event) => events.push(event));

  return {
    source,
    clock,
    events,
    sockets,
    pendingDelays,
    runPendingRetry(): void {
      const next = pending.shift();
      pendingDelays.shift();
      next?.();
    },
  };
}

function latest(sockets: readonly FakeSocket[]): FakeSocket {
  const socket = sockets.at(-1);
  if (socket === undefined) {
    throw new Error('no socket was opened');
  }
  return socket;
}

describe('parseBridgeMessage', () => {
  it('decodes the messages the bridge sends', () => {
    expect(parseBridgeMessage('{"v":1,"type":"noteon","note":60,"velocity":0.5}')).toEqual({
      type: 'noteon',
      note: 60,
      velocity: 0.5,
    });
    expect(parseBridgeMessage('{"v":1,"type":"noteoff","note":60}')).toEqual({
      type: 'noteoff',
      note: 60,
    });
    expect(parseBridgeMessage('{"v":1,"type":"hello","device":"CASIO USB-MIDI"}')).toEqual({
      type: 'hello',
      device: 'CASIO USB-MIDI',
    });
    expect(parseBridgeMessage('{"v":1,"type":"device","device":null}')).toEqual({
      type: 'device',
      device: null,
    });
  });

  it('decodes the sustain pedal', () => {
    expect(parseBridgeMessage('{"v":1,"type":"pedal","down":true,"value":1}')).toEqual({
      type: 'pedal',
      down: true,
      value: 1,
    });
    expect(parseBridgeMessage('{"v":1,"type":"pedal","down":false,"value":0}')).toEqual({
      type: 'pedal',
      down: false,
      value: 0,
    });
  });

  it('falls back to a usable velocity when the bridge omits or mangles it', () => {
    expect(parseBridgeMessage('{"type":"noteon","note":60}')).toEqual({
      type: 'noteon',
      note: 60,
      velocity: 0.8,
    });
    expect(parseBridgeMessage('{"type":"noteon","note":60,"velocity":7}')?.type).toBe('noteon');
  });

  it('ignores anything it does not understand instead of throwing', () => {
    expect(parseBridgeMessage('not json')).toBeNull();
    expect(parseBridgeMessage('null')).toBeNull();
    expect(parseBridgeMessage('[1,2,3]')).toBeNull();
    expect(parseBridgeMessage('{"type":"aftertouch","value":30}')).toBeNull();
    expect(parseBridgeMessage('{"type":"noteon","note":900}')).toBeNull();
    expect(parseBridgeMessage('{"type":"noteon","note":"C4"}')).toBeNull();
    expect(parseBridgeMessage(new ArrayBuffer(4))).toBeNull();
  });
});

describe('resolveBridgeUrl', () => {
  const base = { protocol: 'http:', hostname: '192.168.1.5', host: '192.168.1.5:8080', search: '' };

  it('points at the server that served the page, on a private network', () => {
    expect(resolveBridgeUrl(base)).toBe('ws://192.168.1.5:8080/midi');
    expect(resolveBridgeUrl({ ...base, hostname: 'localhost', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/midi',
    );
  });

  it('uses a secure socket for a secure page', () => {
    expect(resolveBridgeUrl({ ...base, protocol: 'https:' })).toBe('wss://192.168.1.5:8080/midi');
  });

  it('gives up on a public host, where no bridge can exist', () => {
    expect(
      resolveBridgeUrl({
        protocol: 'https:',
        hostname: 'ynot99.github.io',
        host: 'ynot99.github.io',
        search: '',
      }),
    ).toBeNull();
  });

  it('honours an explicit override', () => {
    expect(resolveBridgeUrl({ ...base, search: '?bridge=10.0.0.9:9000' })).toBe(
      'ws://10.0.0.9:9000/midi',
    );
    expect(resolveBridgeUrl({ ...base, search: '?bridge=ws://pi.local:8080/midi' })).toBe(
      'ws://pi.local:8080/midi',
    );
  });

  it('recognises private addresses', () => {
    for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.4', '172.16.5.6', 'pi.local']) {
      expect(isPrivateHost(host)).toBe(true);
    }
    for (const host of ['ynot99.github.io', 'example.com', '8.8.8.8', '172.32.0.1']) {
      expect(isPrivateHost(host)).toBe(false);
    }
  });
});

describe('WebSocketMidiSource', () => {
  it('reports the keyboard the bridge is listening to', async () => {
    const rig = createRig();
    const devices: (string | null)[] = [];
    rig.source.onDeviceChange((device) => devices.push(device));

    const connecting = rig.source.connect();
    latest(rig.sockets).open();
    expect(await connecting).toBe('connected');

    latest(rig.sockets).deliver({ type: 'hello', device: 'CASIO USB-MIDI' });

    expect(rig.source.status).toBe('connected');
    expect(rig.source.deviceName).toBe('CASIO USB-MIDI');
    expect(devices).toEqual(['CASIO USB-MIDI']);
  });

  it('turns relayed notes into MIDI events', async () => {
    const rig = createRig();
    const connecting = rig.source.connect();
    latest(rig.sockets).open();
    await connecting;

    latest(rig.sockets).deliver({ type: 'noteon', note: 60, velocity: 0.75 });
    latest(rig.sockets).deliver({ type: 'noteoff', note: 60 });

    expect(rig.events).toEqual([
      { type: 'noteon', midi: 60, velocity: 0.75, timestampMs: 1_000, sourceId: 'bridge' },
      { type: 'noteoff', midi: 60, timestampMs: 1_000, sourceId: 'bridge' },
    ]);
  });

  it('stamps events with the local clock, not the bridge computer’s', async () => {
    const rig = createRig();
    const connecting = rig.source.connect();
    latest(rig.sockets).open();
    await connecting;

    latest(rig.sockets).deliver({ type: 'noteon', note: 60, velocity: 0.5 });
    rig.clock.advance(250);
    latest(rig.sockets).deliver({ type: 'noteon', note: 64, velocity: 0.5 });

    // Two clocks with different origins would make Flow mode's timing
    // meaningless, so arrival time on this device is the only thing used.
    expect(rig.events.map((event) => event.timestampMs)).toEqual([1_000, 1_250]);
  });

  it('relays the pedal as well as the notes', async () => {
    const rig = createRig();
    const connecting = rig.source.connect();
    latest(rig.sockets).open();
    await connecting;

    latest(rig.sockets).deliver({ type: 'pedal', down: true, value: 1 });

    expect(rig.events).toEqual([
      {
        type: 'pedal',
        pedal: 'sustain',
        down: true,
        value: 1,
        timestampMs: 1_000,
        sourceId: 'bridge',
      },
    ]);
  });

  it('survives frames it cannot parse', async () => {
    const rig = createRig();
    const connecting = rig.source.connect();
    latest(rig.sockets).open();
    await connecting;

    latest(rig.sockets).deliver('nonsense');
    latest(rig.sockets).deliver({ type: 'sysex', bytes: [1, 2] });
    latest(rig.sockets).deliver({ type: 'noteon', note: 62, velocity: 0.5 });

    expect(rig.events).toHaveLength(1);
    const first = rig.events[0];
    expect(first !== undefined && 'midi' in first ? first.midi : null).toBe(62);
  });

  it('reconnects with a backoff when the bridge goes away', async () => {
    const rig = createRig();
    const statuses: string[] = [];
    rig.source.onStatusChange((status) => statuses.push(status));

    const connecting = rig.source.connect();
    latest(rig.sockets).open();
    await connecting;

    latest(rig.sockets).drop();
    expect(rig.source.status).toBe('error');
    expect(rig.pendingDelays).toEqual([10]);

    rig.runPendingRetry();
    expect(rig.sockets).toHaveLength(2);

    latest(rig.sockets).drop();
    expect(rig.pendingDelays).toEqual([20]);

    rig.runPendingRetry();
    latest(rig.sockets).open();

    expect(rig.source.status).toBe('connected');
    expect(statuses).toEqual([
      'connecting',
      'connected',
      'error',
      'connecting',
      'error',
      'connecting',
      'connected',
    ]);
  });

  it('forgets the keyboard while the bridge is unreachable', async () => {
    const rig = createRig();
    const connecting = rig.source.connect();
    latest(rig.sockets).open();
    await connecting;
    latest(rig.sockets).deliver({ type: 'hello', device: 'CASIO USB-MIDI' });

    latest(rig.sockets).drop();

    expect(rig.source.deviceName).toBeNull();
  });

  it('reports a bridge that was never there, and keeps trying', async () => {
    const rig = createRig();
    const connecting = rig.source.connect();

    latest(rig.sockets).drop();

    expect(await connecting).toBe('error');
    expect(rig.pendingDelays).toEqual([10]);
  });

  it('stops retrying once disconnected on purpose', async () => {
    const rig = createRig();
    const connecting = rig.source.connect();
    latest(rig.sockets).open();
    await connecting;

    await rig.source.disconnect();

    expect(rig.source.status).toBe('idle');
    expect(latest(rig.sockets).closed).toBe(true);
    expect(rig.pendingDelays).toEqual([]);
  });

  it('does not reopen a socket that is already connected', async () => {
    const rig = createRig();
    const connecting = rig.source.connect();
    latest(rig.sockets).open();
    await connecting;

    await rig.source.connect();

    expect(rig.sockets).toHaveLength(1);
  });

  it('survives a socket factory that throws', async () => {
    const clock = new ManualClock();
    const schedule = vi.fn(() => () => undefined);
    const source = new WebSocketMidiSource({
      url: 'ws://nope/midi',
      clock,
      socketFactory: () => {
        throw new Error('blocked');
      },
      schedule,
      reconnectDelaysMs: [10],
    });

    expect(await source.connect()).toBe('error');
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it('exposes where it is pointing', () => {
    const rig = createRig('ws://10.0.0.2:8080/midi');
    expect(rig.source.endpoint).toBe('ws://10.0.0.2:8080/midi');
  });
});

describe('when the bridge says a key was struck', () => {
  const ORIGIN = 1_700_000_000_000;

  function noteFrom(rig: Rig, payload: Record<string, unknown>): MidiEvent | undefined {
    rig.source.connect();
    rig.sockets[0]?.open();
    rig.sockets[0]?.deliver({ v: 1, type: 'noteon', note: 60, velocity: 0.8, ...payload });
    return rig.events.at(-1);
  }

  it('prefers the reading taken at the source', () => {
    // The page's clock is monotonic from `timeOrigin`; the bridge's is the
    // wall clock. That constant is exactly what joins them, and it does not
    // drift the way repeated sampling would.
    const rig = createRig(undefined, ORIGIN);

    const event = noteFrom(rig, { at: ORIGIN + 1_250 });

    expect(event?.timestampMs).toBe(1_250);
  });

  it('stamps on arrival when the bridge sent no reading', () => {
    // An older bridge, and a tablet that insisted would simply stop working.
    const rig = createRig(undefined, ORIGIN);

    expect(noteFrom(rig, {})?.timestampMs).toBe(1_000);
  });

  it('refuses a reading no reader could have played', () => {
    // A bridge whose clock is set to the wrong minute: using it would place
    // every note far outside the run, which is worse than a slightly late
    // stamp because it looks like an answer.
    const rig = createRig(undefined, ORIGIN);

    expect(noteFrom(rig, { at: ORIGIN + 600_000 })?.timestampMs).toBe(1_000);
  });

  it('keeps a disagreement small enough to be worth seeing', () => {
    // The whole point is to show a few milliseconds of clock difference, not
    // to hide it, so a small gap is passed through rather than clamped away.
    const rig = createRig(undefined, ORIGIN);

    expect(noteFrom(rig, { at: ORIGIN + 1_040 })?.timestampMs).toBe(1_040);
  });
});

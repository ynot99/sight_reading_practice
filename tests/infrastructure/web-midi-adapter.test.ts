import { describe, expect, it, vi } from 'vitest';
import type { MidiEvent } from '../../src/application/ports/IMidiSource.js';
import { WebMidiAdapter } from '../../src/infrastructure/midi/WebMidiAdapter.js';
import {
  parseMidiMessage,
  type MidiAccessLike,
  type MidiInputLike,
  type MidiMessageEventLike,
} from '../../src/infrastructure/midi/webmidi-dom.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';

class FakeInput implements MidiInputLike {
  onmidimessage: ((event: MidiMessageEventLike) => void) | null = null;
  readonly state = 'connected';

  constructor(
    readonly id: string,
    readonly name: string | null,
    readonly manufacturer: string | null = 'Test Instruments',
  ) {}

  send(bytes: readonly number[], timeStamp = 0): void {
    this.onmidimessage?.({ data: new Uint8Array(bytes), timeStamp });
  }
}

class FakeAccess implements MidiAccessLike {
  onstatechange: ((event: unknown) => void) | null = null;
  private readonly list: FakeInput[];

  constructor(inputs: FakeInput[]) {
    this.list = inputs;
  }

  get inputs(): { values(): IterableIterator<MidiInputLike> } {
    return { values: () => this.list.values() };
  }

  plug(input: FakeInput): void {
    this.list.push(input);
    this.onstatechange?.({});
  }
}

function createAdapter(inputs: FakeInput[] = [new FakeInput('a', 'Piano A')]): {
  adapter: WebMidiAdapter;
  access: FakeAccess;
  clock: ManualClock;
  received: MidiEvent[];
} {
  const access = new FakeAccess(inputs);
  const clock = new ManualClock(500);
  const adapter = new WebMidiAdapter(() => Promise.resolve(access), clock);
  const received: MidiEvent[] = [];
  adapter.subscribe((event) => received.push(event));
  return { adapter, access, clock, received };
}

describe('parseMidiMessage', () => {
  it('decodes note on and note off', () => {
    expect(parseMidiMessage(new Uint8Array([0x90, 60, 100]))).toEqual({
      kind: 'noteon',
      midi: 60,
      velocity: 100 / 127,
    });
    expect(parseMidiMessage(new Uint8Array([0x80, 60, 0]))).toEqual({
      kind: 'noteoff',
      midi: 60,
      velocity: 0,
    });
  });

  it('treats a zero-velocity note on as a note off', () => {
    expect(parseMidiMessage(new Uint8Array([0x92, 64, 0]))?.kind).toBe('noteoff');
  });

  it('ignores channel messages that are not notes, and truncated packets', () => {
    expect(parseMidiMessage(new Uint8Array([0xb0, 64, 127]))).toBeNull();
    expect(parseMidiMessage(new Uint8Array([0x90, 60]))).toBeNull();
    expect(parseMidiMessage(null)).toBeNull();
  });
});

describe('WebMidiAdapter', () => {
  it('reports an unsupported environment when the API is missing', async () => {
    const adapter = new WebMidiAdapter(null, new ManualClock());
    const statuses: string[] = [];
    adapter.onStatusChange((status) => statuses.push(status));

    expect(await adapter.connect()).toBe('unsupported');
    expect(adapter.status).toBe('unsupported');
    expect(statuses).toEqual(['unsupported']);
    expect(adapter.inputs()).toEqual([]);
  });

  it('connects and lists the available inputs', async () => {
    const { adapter } = createAdapter([new FakeInput('a', 'Piano A'), new FakeInput('b', null)]);

    expect(await adapter.connect()).toBe('connected');
    expect(adapter.inputs()).toEqual([
      { id: 'a', name: 'Piano A', manufacturer: 'Test Instruments' },
      { id: 'b', name: 'Unnamed input', manufacturer: 'Test Instruments' },
    ]);
  });

  it('reports a rejected permission prompt as denied', async () => {
    const adapter = new WebMidiAdapter(
      () => Promise.reject(new Error('Permission denied by the user')),
      new ManualClock(),
    );
    expect(await adapter.connect()).toBe('denied');
  });

  it('reports other failures as errors', async () => {
    const adapter = new WebMidiAdapter(() => Promise.reject(new Error('boom')), new ManualClock());
    expect(await adapter.connect()).toBe('error');
  });

  it('publishes note events from every input by default', async () => {
    const first = new FakeInput('a', 'Piano A');
    const second = new FakeInput('b', 'Piano B');
    const { adapter, received } = createAdapter([first, second]);
    await adapter.connect();

    first.send([0x90, 60, 64], 1234);
    second.send([0x80, 60, 0], 1300);

    expect(received).toEqual([
      { type: 'noteon', midi: 60, velocity: 64 / 127, timestampMs: 1234, sourceId: 'a' },
      { type: 'noteoff', midi: 60, timestampMs: 1300, sourceId: 'b' },
    ]);
  });

  it('falls back to the clock when a driver reports no timestamp', async () => {
    const first = new FakeInput('a', 'Piano A');
    const { adapter, received, clock } = createAdapter([first]);
    await adapter.connect();
    clock.set(4242);

    first.send([0x90, 72, 80], 0);

    expect(received[0]?.timestampMs).toBe(4242);
  });

  it('listens to one input when a device is selected', async () => {
    const first = new FakeInput('a', 'Piano A');
    const second = new FakeInput('b', 'Piano B');
    const { adapter, received } = createAdapter([first, second]);
    await adapter.connect();

    adapter.selectInput('b');
    first.send([0x90, 60, 64], 1);
    second.send([0x90, 62, 64], 2);

    expect(adapter.selectedInputId).toBe('b');
    expect(received).toHaveLength(1);
    expect(received[0]?.midi).toBe(62);
  });

  it('picks up devices plugged in after connecting', async () => {
    const { adapter, access, received } = createAdapter([]);
    const onInputs = vi.fn();
    adapter.onInputsChanged(onInputs);
    await adapter.connect();

    const late = new FakeInput('c', 'Late Arrival');
    access.plug(late);

    expect(onInputs).toHaveBeenCalledTimes(2);
    expect(adapter.inputs().map((input) => input.id)).toEqual(['c']);

    late.send([0x90, 65, 90], 9);
    expect(received).toHaveLength(1);
  });

  it('stops listening after disconnecting', async () => {
    const first = new FakeInput('a', 'Piano A');
    const { adapter, received } = createAdapter([first]);
    await adapter.connect();
    await adapter.disconnect();

    first.send([0x90, 60, 64], 1);

    expect(received).toHaveLength(0);
    expect(adapter.status).toBe('idle');
    expect(first.onmidimessage).toBeNull();
  });

  it('does not reconnect while already connected', async () => {
    const provider = vi.fn(() => Promise.resolve(new FakeAccess([])));
    const adapter = new WebMidiAdapter(provider, new ManualClock());

    await adapter.connect();
    await adapter.connect();

    expect(provider).toHaveBeenCalledTimes(1);
  });
});

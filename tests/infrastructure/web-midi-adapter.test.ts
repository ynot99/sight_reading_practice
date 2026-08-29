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

/** Narrows to the events that carry a pitch. */
function noteOf(event: MidiEvent | undefined): number | null {
  return event !== undefined && 'midi' in event ? event.midi : null;
}

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

  it('decodes the sustain pedal, which is a controller rather than a note', () => {
    expect(parseMidiMessage(new Uint8Array([0xb0, 64, 127]))).toEqual({
      kind: 'sustain',
      down: true,
      value: 1,
    });
    expect(parseMidiMessage(new Uint8Array([0xb0, 64, 0]))).toEqual({
      kind: 'sustain',
      down: false,
      value: 0,
    });
    // Half way is the convention for "down"; a real pedal sweeps through it.
    expect(parseMidiMessage(new Uint8Array([0xb3, 64, 64]))?.kind).toBe('sustain');
    expect(parseMidiMessage(new Uint8Array([0xb0, 64, 63]))).toMatchObject({ down: false });
  });

  it('passes other controllers through by number, unnamed', () => {
    // No table can say which controller a volume knob uses - it might be 7,
    // or 11, or whatever the maker chose - so the number travels intact and
    // the meaning is assigned where a reader can teach it.
    expect(parseMidiMessage(new Uint8Array([0xb0, 7, 127]))).toEqual({
      kind: 'control',
      controller: 7,
      value: 1,
    });
    expect(parseMidiMessage(new Uint8Array([0xb0, 11, 0]))).toEqual({
      kind: 'control',
      controller: 11,
      value: 0,
    });
  });

  it('still keeps the damper apart from the rest', () => {
    // Sustain is not a knob to be taught: it is a pedal the app already
    // sounds, and folding it in would let it be learned as a volume control.
    expect(parseMidiMessage(new Uint8Array([0xb0, 64, 127]))).toMatchObject({ kind: 'sustain' });
  });

  it('ignores what is not a message at all', () => {
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

  it('publishes the sustain pedal as its own event', async () => {
    const first = new FakeInput('a', 'Piano A');
    const { adapter, received } = createAdapter([first]);
    await adapter.connect();

    first.send([0xb0, 64, 127], 100);
    first.send([0xb0, 64, 0], 200);

    expect(received).toEqual([
      { type: 'pedal', pedal: 'sustain', down: true, value: 1, timestampMs: 100, sourceId: 'a' },
      { type: 'pedal', pedal: 'sustain', down: false, value: 0, timestampMs: 200, sourceId: 'a' },
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
    expect(noteOf(received[0])).toBe(62);
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

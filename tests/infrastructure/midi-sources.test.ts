import { describe, expect, it, vi } from 'vitest';
import type { MidiEvent } from '../../src/application/ports/IMidiSource.js';
import { CompositeMidiSource } from '../../src/infrastructure/midi/CompositeMidiSource.js';
import {
  ComputerKeyboardMidiSource,
  type KeyboardEventLike,
  type KeyboardTarget,
} from '../../src/infrastructure/midi/ComputerKeyboardMidiSource.js';
import { ManualClock } from '../../src/infrastructure/testing/ManualClock.js';
import { MockMidiAdapter } from '../../src/infrastructure/testing/MockMidiAdapter.js';

type KeyListener = (event: KeyboardEventLike) => void;

class FakeKeyboardTarget implements KeyboardTarget {
  private readonly listeners = new Map<string, Set<KeyListener>>();

  addEventListener(type: 'keydown' | 'keyup', listener: KeyListener): void {
    const bucket = this.listeners.get(type) ?? new Set<KeyListener>();
    bucket.add(listener);
    this.listeners.set(type, bucket);
  }

  removeEventListener(type: 'keydown' | 'keyup', listener: KeyListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  get listenerCount(): number {
    return [...this.listeners.values()].reduce((total, bucket) => total + bucket.size, 0);
  }

  private dispatch(type: 'keydown' | 'keyup', event: KeyboardEventLike): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  press(code: string, overrides: Partial<KeyboardEventLike> = {}): void {
    this.dispatch('keydown', {
      code,
      repeat: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault: () => undefined,
      ...overrides,
    });
  }

  release(code: string): void {
    this.dispatch('keyup', {
      code,
      repeat: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault: () => undefined,
    });
  }
}

describe('ComputerKeyboardMidiSource', () => {
  function setup(): {
    target: FakeKeyboardTarget;
    source: ComputerKeyboardMidiSource;
    clock: ManualClock;
    events: MidiEvent[];
  } {
    const target = new FakeKeyboardTarget();
    const clock = new ManualClock(100);
    const source = new ComputerKeyboardMidiSource(target, clock);
    const events: MidiEvent[] = [];
    source.subscribe((event) => events.push(event));
    return { target, source, clock, events };
  }

  it('maps the keyboard onto MIDI notes once enabled', () => {
    const { target, source, events } = setup();
    source.enable();

    target.press('KeyZ');
    target.press('KeyX');

    expect(events).toEqual([
      { type: 'noteon', midi: 48, velocity: 0.7, timestampMs: 100, sourceId: 'computer-keyboard' },
      { type: 'noteon', midi: 50, velocity: 0.7, timestampMs: 100, sourceId: 'computer-keyboard' },
    ]);
  });

  it('emits nothing before being enabled', () => {
    const { target, events } = setup();
    target.press('KeyZ');
    expect(events).toEqual([]);
  });

  it('suppresses auto-repeat and modifier combinations', () => {
    const { target, source, events } = setup();
    source.enable();

    target.press('KeyZ', { repeat: true });
    target.press('KeyX', { ctrlKey: true });
    target.press('KeyC', { metaKey: true });

    expect(events).toEqual([]);
  });

  it('ignores keys that are not part of the layout', () => {
    const { target, source, events } = setup();
    source.enable();
    target.press('Escape');
    expect(events).toEqual([]);
  });

  it('emits a note off when the key is released, and only then', () => {
    const { target, source, clock, events } = setup();
    source.enable();

    target.press('KeyZ');
    target.press('KeyZ');
    clock.set(400);
    target.release('KeyZ');
    target.release('KeyZ');

    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      type: 'noteoff',
      midi: 48,
      timestampMs: 400,
      sourceId: 'computer-keyboard',
    });
  });

  it('honours a custom base octave', () => {
    const target = new FakeKeyboardTarget();
    const source = new ComputerKeyboardMidiSource(target, new ManualClock(), { baseMidi: 60 });
    const events: MidiEvent[] = [];
    source.subscribe((event) => events.push(event));
    source.enable();

    target.press('KeyZ');
    const first = events[0];
    expect(first !== undefined && 'midi' in first ? first.midi : null).toBe(60);
  });

  it('detaches its listeners when disabled', () => {
    const { target, source, events } = setup();
    source.enable();
    expect(target.listenerCount).toBe(2);
    expect(source.isEnabled).toBe(true);

    source.disable();
    expect(target.listenerCount).toBe(0);
    target.press('KeyZ');
    expect(events).toEqual([]);

    // Enabling twice must not attach duplicate listeners.
    source.enable();
    source.enable();
    expect(target.listenerCount).toBe(2);
  });
});

describe('CompositeMidiSource', () => {
  it('merges the streams of every source', () => {
    const first = new MockMidiAdapter({ sourceId: 'first' });
    const second = new MockMidiAdapter({ sourceId: 'second' });
    const composite = new CompositeMidiSource([first, second]);
    const events: MidiEvent[] = [];

    const unsubscribe = composite.subscribe((event) => events.push(event));
    first.noteOn(60, 1);
    second.noteOn(62, 2);

    expect(events.map((event) => event.sourceId)).toEqual(['first', 'second']);

    unsubscribe();
    first.noteOn(64, 3);
    expect(events).toHaveLength(2);
  });
});

describe('MockMidiAdapter', () => {
  it('timestamps events from the injected clock', () => {
    const clock = new ManualClock(1000);
    const adapter = new MockMidiAdapter({ clock });
    const events: MidiEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.noteOn(60);
    clock.advance(250);
    adapter.noteOff(60);

    expect(events.map((event) => event.timestampMs)).toEqual([1000, 1250]);
    expect(adapter.emitted).toHaveLength(2);
  });

  it('spreads a chord over the requested interval', () => {
    const adapter = new MockMidiAdapter();
    const events: MidiEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.playChord([60, 64, 67], 100, 15);

    expect(events.map((event) => event.timestampMs)).toEqual([100, 115, 130]);
    expect(events.every((event) => event.type === 'noteon')).toBe(true);
  });

  it('plays and releases a single note at one instant', () => {
    const adapter = new MockMidiAdapter();
    const events: MidiEvent[] = [];
    adapter.subscribe((event) => events.push(event));

    adapter.play(60, 42);
    adapter.releaseChord([60], 60);

    expect(events.map((event) => `${event.type}@${event.timestampMs}`)).toEqual([
      'noteon@42',
      'noteoff@42',
      'noteoff@60',
    ]);
  });

  it('implements the connection and directory ports', async () => {
    const adapter = new MockMidiAdapter();
    const onInputs = vi.fn();
    adapter.onInputsChanged(onInputs);

    expect(await adapter.connect()).toBe('connected');
    expect(adapter.inputs()).toHaveLength(1);

    adapter.selectInput('mock-1');
    expect(adapter.selectedInputId).toBe('mock-1');

    adapter.setInputs([]);
    expect(onInputs).toHaveBeenCalledWith([]);

    await adapter.disconnect();
    expect(adapter.status).toBe('idle');
  });
});

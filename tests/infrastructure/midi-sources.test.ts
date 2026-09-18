import { describe, expect, it, vi } from 'vitest';
import type { MidiEvent } from '../../src/application/ports/IMidiSource.js';
import { CompositeMidiSource } from '../../src/infrastructure/midi/CompositeMidiSource.js';
import {
  ComputerKeyboardMidiSource,
  isTypedInto,
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

  release(code: string, overrides: Partial<KeyboardEventLike> = {}): void {
    this.dispatch('keyup', {
      code,
      repeat: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault: () => undefined,
      ...overrides,
    });
  }
}

describe('whether a key was typed into something', () => {
  it('counts what takes text', () => {
    expect(isTypedInto({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(isTypedInto({ tagName: 'INPUT', type: 'number' })).toBe(true);
    expect(isTypedInto({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTypedInto({ tagName: 'TEXTAREA' })).toBe(true);
    // A letter jumps to an option, which is close enough to typing.
    expect(isTypedInto({ tagName: 'SELECT' })).toBe(true);
    expect(isTypedInto({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('does not count what a letter means nothing to', () => {
    // Each of these keeps the focus after a click, and counting them would
    // leave the keyboard dead until the reader thought to click elsewhere.
    expect(isTypedInto({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypedInto({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTypedInto({ tagName: 'INPUT', type: 'radio' })).toBe(false);
    expect(isTypedInto({ tagName: 'INPUT', type: 'range' })).toBe(false);
    expect(isTypedInto({ tagName: 'DIV' })).toBe(false);
    expect(isTypedInto(null)).toBe(false);
    expect(isTypedInto(undefined)).toBe(false);
  });

  it('treats an input type it has never heard of as one that takes text', () => {
    // The list is of what to let through, that way round on purpose: an
    // unknown box should swallow a note rather than a name.
    expect(isTypedInto({ tagName: 'INPUT', type: 'something-new' })).toBe(true);
    expect(isTypedInto({ tagName: 'INPUT' })).toBe(true);
  });

  it('is not troubled by a type shouted at it', () => {
    expect(isTypedInto({ tagName: 'INPUT', type: 'CHECKBOX' })).toBe(false);
  });
});

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

  it('plays nothing while the reader is typing, and swallows nothing either', () => {
    // Nearly every letter and digit here is a note, and the ones it takes it
    // takes with `preventDefault` - so a name typed into a box came out as a
    // tune with most of its characters missing. His: "щоб клавіатура не грала
    // піаніно коли я щось вводжу в input? Бо піаніно перехоплює event".
    const { target, source, events } = setup();
    source.enable();
    let swallowed = 0;

    target.press('KeyZ', {
      target: { tagName: 'INPUT', type: 'text' },
      preventDefault: () => {
        swallowed += 1;
      },
    });

    expect(events).toEqual([]);
    expect(swallowed).toBe(0);
  });

  it('goes on playing with a button or a tick box holding the focus', () => {
    // The question the space bar asks counts a focused button, because space
    // presses buttons. This one must not, or the keyboard would go dead the
    // moment Start was pressed with a mouse and the focus stayed on it.
    const { target, source, events } = setup();
    source.enable();

    target.press('KeyZ', { target: { tagName: 'BUTTON' } });
    target.press('KeyX', { target: { tagName: 'INPUT', type: 'checkbox' } });

    expect(events.map((event) => ('midi' in event ? event.midi : null))).toEqual([48, 50]);
  });

  it('lets a note go wherever the reader has got to since pressing it', () => {
    // Begun on the page and released after a box was clicked. Asked about the
    // focus on the way up as well, this note would never be released at all.
    const { target, source, events } = setup();
    source.enable();
    target.press('KeyZ');

    target.release('KeyZ', { target: { tagName: 'INPUT', type: 'text' } });

    expect(events.map((event) => event.type)).toEqual(['noteon', 'noteoff']);
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

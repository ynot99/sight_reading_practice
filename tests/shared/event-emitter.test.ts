import { describe, expect, it, vi } from 'vitest';
import { TypedEventEmitter } from '../../src/shared/EventEmitter.js';
import { StateMachine, type TransitionTable } from '../../src/shared/StateMachine.js';
import { InvalidTransitionError } from '../../src/shared/errors.js';

interface TestEvents {
  ping: { value: number };
  pong: string;
}

describe('TypedEventEmitter', () => {
  it('delivers payloads to every subscriber of an event', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const first = vi.fn();
    const second = vi.fn();

    emitter.on('ping', first);
    emitter.on('ping', second);
    emitter.on('pong', vi.fn());
    emitter.emit('ping', { value: 7 });

    expect(first).toHaveBeenCalledWith({ value: 7 });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes through the returned handle and through off()', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const listener = vi.fn();

    const unsubscribe = emitter.on('pong', listener);
    unsubscribe();
    emitter.emit('pong', 'a');
    expect(listener).not.toHaveBeenCalled();

    emitter.on('pong', listener);
    emitter.off('pong', listener);
    emitter.emit('pong', 'b');
    expect(listener).not.toHaveBeenCalled();
    expect(emitter.listenerCount('pong')).toBe(0);
  });

  it('fires once() listeners exactly once', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const listener = vi.fn();

    emitter.once('pong', listener);
    emitter.emit('pong', 'a');
    emitter.emit('pong', 'b');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('a');
  });

  it('tolerates subscribing and unsubscribing during dispatch', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const late = vi.fn();
    const first = vi.fn(() => {
      emitter.on('pong', late);
    });
    const second = vi.fn();

    const unsubscribeSecond = emitter.on('pong', second);
    emitter.on('pong', first);
    emitter.on('pong', () => {
      unsubscribeSecond();
    });

    expect(() => emitter.emit('pong', 'a')).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
    expect(late).not.toHaveBeenCalled();

    emitter.emit('pong', 'b');
    expect(second).toHaveBeenCalledTimes(1);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('ignores events nobody listens to and clears everything on demand', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    expect(() => emitter.emit('ping', { value: 1 })).not.toThrow();

    emitter.on('ping', vi.fn());
    emitter.removeAllListeners();
    expect(emitter.listenerCount('ping')).toBe(0);
  });

  it('exposes a read-only projection', () => {
    const emitter = new TypedEventEmitter<TestEvents>();
    const source = emitter.asSource();
    const listener = vi.fn();

    source.on('pong', listener);
    emitter.emit('pong', 'x');
    expect(listener).toHaveBeenCalledWith('x');
  });
});

type LightState = 'red' | 'green' | 'yellow';
type LightEvent = 'go' | 'slow' | 'stop';

const LIGHT_TABLE: TransitionTable<LightState, LightEvent> = {
  red: { go: 'green' },
  green: { slow: 'yellow' },
  yellow: { stop: 'red' },
};

describe('StateMachine', () => {
  it('follows the transition table', () => {
    const machine = new StateMachine<LightState, LightEvent>('red', LIGHT_TABLE);
    expect(machine.state).toBe('red');
    expect(machine.dispatch('go')).toBe('green');
    expect(machine.dispatch('slow')).toBe('yellow');
    expect(machine.dispatch('stop')).toBe('red');
  });

  it('rejects illegal transitions', () => {
    const machine = new StateMachine<LightState, LightEvent>('red', LIGHT_TABLE);
    expect(machine.can('slow')).toBe(false);
    expect(() => machine.dispatch('slow')).toThrow(InvalidTransitionError);
    expect(machine.tryDispatch('slow')).toBeNull();
    expect(machine.state).toBe('red');
  });

  it('notifies observers with the full transition', () => {
    const machine = new StateMachine<LightState, LightEvent>('red', LIGHT_TABLE);
    const observer = vi.fn();
    const unsubscribe = machine.onTransition(observer);

    machine.dispatch('go');
    expect(observer).toHaveBeenCalledWith({ from: 'red', to: 'green', event: 'go' });

    unsubscribe();
    machine.dispatch('slow');
    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('returns to its initial state on reset', () => {
    const machine = new StateMachine<LightState, LightEvent>('red', LIGHT_TABLE);
    machine.dispatch('go');
    machine.reset();
    expect(machine.state).toBe('red');
  });
});

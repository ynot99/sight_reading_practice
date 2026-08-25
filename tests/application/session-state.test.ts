import { describe, expect, it } from 'vitest';
import {
  SESSION_STATUSES,
  SESSION_TRANSITIONS,
  createSessionMachine,
  isActive,
  type SessionStatus,
  type SessionTrigger,
} from '../../src/application/session/SessionState.js';
import { InvalidTransitionError } from '../../src/shared/errors.js';

const ALL_TRIGGERS: readonly SessionTrigger[] = [
  'start',
  'countInComplete',
  'pause',
  'resume',
  'complete',
  'abort',
  'reset',
];

function legalTriggers(status: SessionStatus): SessionTrigger[] {
  return ALL_TRIGGERS.filter((trigger) => SESSION_TRANSITIONS[status][trigger] !== undefined);
}

describe('session state machine', () => {
  it('starts idle', () => {
    expect(createSessionMachine().state).toBe('idle');
  });

  it('walks a complete run: idle -> counting-in -> running -> completed', () => {
    const machine = createSessionMachine();
    expect(machine.dispatch('start')).toBe('counting-in');
    expect(machine.dispatch('countInComplete')).toBe('running');
    expect(machine.dispatch('complete')).toBe('completed');
  });

  it('allows pausing and resuming only while running', () => {
    const machine = createSessionMachine();
    expect(machine.can('pause')).toBe(false);

    machine.dispatch('start');
    expect(machine.can('pause')).toBe(false);

    machine.dispatch('countInComplete');
    expect(machine.dispatch('pause')).toBe('paused');
    expect(machine.can('pause')).toBe(false);
    expect(machine.dispatch('resume')).toBe('running');
  });

  it('cannot resume a finished run, but can restart it', () => {
    const machine = createSessionMachine();
    machine.dispatch('start');
    machine.dispatch('countInComplete');
    machine.dispatch('complete');

    expect(() => machine.dispatch('resume')).toThrow(InvalidTransitionError);
    expect(machine.dispatch('start')).toBe('counting-in');
  });

  it('can be aborted from every active state', () => {
    for (const status of ['counting-in', 'running', 'paused'] as const) {
      expect(SESSION_TRANSITIONS[status].abort).toBe('aborted');
    }
    expect(SESSION_TRANSITIONS.idle.abort).toBeUndefined();
  });

  it('defines a transition entry for every status', () => {
    for (const status of SESSION_STATUSES) {
      expect(SESSION_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('exposes exactly the intended transitions', () => {
    expect(legalTriggers('idle')).toEqual(['start']);
    expect(legalTriggers('counting-in')).toEqual(['countInComplete', 'abort']);
    expect(legalTriggers('running')).toEqual(['pause', 'complete', 'abort']);
    expect(legalTriggers('paused')).toEqual(['resume', 'abort']);
    expect(legalTriggers('completed')).toEqual(['start', 'reset']);
    expect(legalTriggers('aborted')).toEqual(['start', 'reset']);
  });

  it('knows which statuses hold live subscriptions', () => {
    expect(isActive('running')).toBe(true);
    expect(isActive('counting-in')).toBe(true);
    expect(isActive('paused')).toBe(true);
    expect(isActive('idle')).toBe(false);
    expect(isActive('completed')).toBe(false);
  });
});

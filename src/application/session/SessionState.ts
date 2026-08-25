import { StateMachine, type TransitionTable } from '../../shared/StateMachine.js';

export const SESSION_STATUSES = [
  'idle',
  'counting-in',
  'running',
  'paused',
  'completed',
  'aborted',
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type SessionTrigger =
  | 'start'
  | 'countInComplete'
  | 'pause'
  | 'resume'
  | 'complete'
  | 'abort'
  | 'reset';

/**
 * The full lifecycle of a practice run.
 *
 * Written as data so the legal paths are obvious at a glance and can be
 * asserted exhaustively in tests: a run always passes through `counting-in`
 * (possibly for zero beats), only a running session can be paused, and a
 * finished session must be restarted rather than resumed.
 */
export const SESSION_TRANSITIONS: TransitionTable<SessionStatus, SessionTrigger> = {
  idle: { start: 'counting-in' },
  'counting-in': { countInComplete: 'running', abort: 'aborted' },
  running: { pause: 'paused', complete: 'completed', abort: 'aborted' },
  paused: { resume: 'running', abort: 'aborted' },
  completed: { start: 'counting-in', reset: 'idle' },
  aborted: { start: 'counting-in', reset: 'idle' },
};

export function createSessionMachine(): StateMachine<SessionStatus, SessionTrigger> {
  return new StateMachine<SessionStatus, SessionTrigger>('idle', SESSION_TRANSITIONS);
}

/** True while the session is consuming MIDI input. */
export function isActive(status: SessionStatus): boolean {
  return status === 'counting-in' || status === 'running' || status === 'paused';
}

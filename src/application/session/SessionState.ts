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

/**
 * Everything that can move a run along, as data.
 *
 * A list rather than a bare union, for the same reason the statuses are one:
 * a test that wants to check the transition table exhaustively needs the set
 * at runtime, and a hand-kept copy of it goes stale the first time a trigger
 * is added - quietly, since a shorter list simply checks less.
 */
export const SESSION_TRIGGERS = [
  'start',
  'countInComplete',
  'pause',
  'resume',
  'resumeCountIn',
  'complete',
  'abort',
  'reset',
] as const;

export type SessionTrigger = (typeof SESSION_TRIGGERS)[number];

/**
 * The full lifecycle of a practice run.
 *
 * Written as data so the legal paths are obvious at a glance and can be
 * asserted exhaustively in tests: a run always passes through `counting-in`
 * (possibly for zero beats), and a finished session must be restarted rather
 * than resumed.
 *
 * A count-in can be paused too. It looks like part of the run to the reader -
 * the button is right there and says Pause - so refusing it silently was the
 * control lying about what it does. Resuming returns to the count rather than
 * to the music, because a count-in half heard is no count at all.
 */
export const SESSION_TRANSITIONS: TransitionTable<SessionStatus, SessionTrigger> = {
  idle: { start: 'counting-in' },
  'counting-in': { countInComplete: 'running', pause: 'paused', abort: 'aborted' },
  running: { pause: 'paused', complete: 'completed', abort: 'aborted' },
  paused: { resume: 'running', resumeCountIn: 'counting-in', abort: 'aborted' },
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

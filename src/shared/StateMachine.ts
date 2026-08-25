import { InvalidTransitionError } from './errors.js';

/** `state -> event -> next state`. Missing entries are illegal transitions. */
export type TransitionTable<TState extends string, TEvent extends string> = Readonly<
  Record<TState, Partial<Readonly<Record<TEvent, TState>>>>
>;

export interface Transition<TState extends string, TEvent extends string> {
  readonly from: TState;
  readonly to: TState;
  readonly event: TEvent;
}

/**
 * Deterministic finite state machine.
 *
 * Session lifecycle rules live in one declarative table rather than in
 * scattered status checks, which makes them exhaustively testable.
 */
export class StateMachine<TState extends string, TEvent extends string> {
  private readonly initial: TState;
  private readonly table: TransitionTable<TState, TEvent>;
  private current: TState;
  private readonly observers = new Set<(transition: Transition<TState, TEvent>) => void>();

  constructor(initial: TState, table: TransitionTable<TState, TEvent>) {
    this.initial = initial;
    this.table = table;
    this.current = initial;
  }

  get state(): TState {
    return this.current;
  }

  can(event: TEvent): boolean {
    return this.table[this.current][event] !== undefined;
  }

  /** Applies `event`, or throws {@link InvalidTransitionError}. */
  dispatch(event: TEvent): TState {
    const next = this.table[this.current][event];
    if (next === undefined) {
      throw new InvalidTransitionError(this.current, event);
    }
    const transition: Transition<TState, TEvent> = { from: this.current, to: next, event };
    this.current = next;
    for (const observer of [...this.observers]) {
      observer(transition);
    }
    return next;
  }

  /** Applies `event` when legal, returns `null` otherwise. */
  tryDispatch(event: TEvent): TState | null {
    return this.can(event) ? this.dispatch(event) : null;
  }

  onTransition(observer: (transition: Transition<TState, TEvent>) => void): () => void {
    this.observers.add(observer);
    return () => {
      this.observers.delete(observer);
    };
  }

  reset(): void {
    this.current = this.initial;
  }
}

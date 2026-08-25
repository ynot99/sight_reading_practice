/**
 * Base class for every error raised deliberately by this application.
 * A single root makes it trivial to tell "expected" domain failures apart
 * from programming errors once they bubble up to the UI layer.
 */
export class SightReadingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Raised when a value violates a documented domain invariant. */
export class DomainError extends SightReadingError {}

/** Raised when an exercise fails structural validation. */
export class ExerciseValidationError extends DomainError {
  readonly path: string;

  constructor(message: string, path: string) {
    super(path + ": " + message);
    this.path = path;
  }
}

/** Raised when a state machine receives an event that is illegal for its state. */
export class InvalidTransitionError extends SightReadingError {
  readonly state: string;
  readonly event: string;

  constructor(state: string, event: string) {
    super('Event "' + event + '" is not allowed while in state "' + state + '".');
    this.state = state;
    this.event = event;
  }
}

/** Raised by infrastructure adapters when the host environment lacks a capability. */
export class UnsupportedEnvironmentError extends SightReadingError {}

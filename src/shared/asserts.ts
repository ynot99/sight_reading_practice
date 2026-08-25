import { DomainError } from './errors.js';

/**
 * Indexed-access helper for `noUncheckedIndexedAccess`.
 * Returns the element or throws instead of silently widening to `undefined`.
 */
export function elementAt<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) {
    throw new DomainError(`Index ${index} is out of bounds (length ${items.length}).`);
  }
  return value;
}

/** Narrowing guard for values whose absence would be a programming error. */
export function assertDefined<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new DomainError(message);
  }
  return value;
}

/** Guards a "finite and greater than zero" invariant. */
export function assertPositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new DomainError(`${name} must be a finite positive number, received ${value}.`);
  }
  return value;
}

/** Guards an integer invariant. */
export function assertInteger(value: number, name: string): number {
  if (!Number.isInteger(value)) {
    throw new DomainError(`${name} must be an integer, received ${value}.`);
  }
  return value;
}

/** Exhaustiveness helper for discriminated unions. */
export function assertNever(value: never, message: string): never {
  throw new DomainError(`${message}: ${JSON.stringify(value)}`);
}

/** Mathematical modulo: the result always carries the sign of the divisor. */
export function floorMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** Clamps `value` into the inclusive interval `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  if (min > max) {
    throw new DomainError(`Invalid clamp bounds: [${min}, ${max}].`);
  }
  return Math.min(max, Math.max(min, value));
}

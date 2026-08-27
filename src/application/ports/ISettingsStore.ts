/**
 * Somewhere to keep a small blob of JSON between visits.
 *
 * Deliberately ignorant of what the blob means: the store deals in bytes, the
 * codec deals in meaning. That keeps the browser-storage quirks - private
 * mode, quota, a cleared profile - in one adapter, and keeps the settings
 * rules testable without any storage at all.
 */
export interface ISettingsStore {
  /** The stored value, or `null` when there is nothing (or nothing readable). */
  read(): unknown;
  /** Best effort: a store that cannot write must not break the application. */
  write(value: unknown): void;
  clear(): void;
}

/** Null object for hosts with no usable storage. */
export class InMemorySettingsStore implements ISettingsStore {
  private value: unknown = null;

  read(): unknown {
    return this.value;
  }

  write(value: unknown): void {
    this.value = value;
  }

  clear(): void {
    this.value = null;
  }
}

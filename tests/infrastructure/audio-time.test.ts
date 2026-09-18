import { describe, expect, it } from 'vitest';
import { TOO_LATE_MS, tooLateToSound } from '../../src/infrastructure/audio/audioTime.js';

describe('whether a moment has gone', () => {
  it('lets ordinary lateness through', () => {
    // A scheduler waking a few milliseconds off is nothing, and a note a hair
    // late is better than a silent one.
    expect(tooLateToSound(1_000, 1_000)).toBe(false);
    expect(tooLateToSound(1_000, 1_030)).toBe(false);
    expect(tooLateToSound(1_000, 1_000 + TOO_LATE_MS)).toBe(false);
  });

  it('drops a note from a moment that is genuinely gone', () => {
    // The burst this exists to prevent: the page stalls, the scheduler wakes
    // with seconds of notes overdue, and every one of them would otherwise be
    // started at the same instant and released immediately after. His: "таке
    // враження будто воно грає в 3 рази швидше, та кожна нота обрізається".
    expect(tooLateToSound(1_000, 1_000 + TOO_LATE_MS + 1)).toBe(true);
    expect(tooLateToSound(1_000, 4_000)).toBe(true);
  });

  it('says nothing about a sound with no moment of its own', () => {
    // No moment means "now", which cannot be late.
    expect(tooLateToSound(undefined, 9_999)).toBe(false);
  });

  it('never calls a sound still to come late', () => {
    expect(tooLateToSound(2_000, 1_000)).toBe(false);
  });
});

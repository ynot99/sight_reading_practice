import { describe, expect, it } from 'vitest';
import { describeStorage, sizeOf } from '../../src/ui/storageReport.js';

describe('what the device keeps, said to the reader', () => {
  it('says each answer the browser gave', () => {
    const lines = describeStorage({
      usedBytes: 42 * 1024 * 1024,
      quotaBytes: 100 * 1024 * 1024 * 1024,
      databaseBytes: 30 * 1024 * 1024,
      persisted: true,
      shelves: [
        { name: 'settings', characters: 3 * 1024 },
        { name: 'takes', characters: 1536 * 1024 },
      ],
    });

    expect(lines).toEqual([
      'Everything this site keeps: 42.0 MB of 100 GB allowed',
      'Scores: 30.0 MB',
      'Kept from being cleared: yes',
      'Small store: 1.5 MB of about 5.0 MB (settings 3 KB, takes 1.5 MB)',
    ]);
  });

  it('says the browser did not say, rather than showing nothing as nought', () => {
    // Safari breaks nothing out and older browsers say nothing at all. A
    // nought would read as "empty", which is a claim nobody made.
    const lines = describeStorage({
      usedBytes: null,
      quotaBytes: null,
      databaseBytes: null,
      persisted: null,
      shelves: [],
    });

    expect(lines[0]).toBe('Everything this site keeps: the browser does not say');
    expect(lines[1]).toBe('Scores: this browser does not break them out');
    expect(lines[2]).toBe('Kept from being cleared: the browser does not say');
  });

  it('says a size the way a reader would', () => {
    expect(sizeOf(0)).toBe('0 B');
    expect(sizeOf(1023)).toBe('1023 B');
    expect(sizeOf(2048)).toBe('2 KB');
    expect(sizeOf(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(sizeOf(150 * 1024 * 1024)).toBe('150 MB');
  });
});

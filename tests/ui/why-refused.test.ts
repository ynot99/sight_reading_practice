// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { whyAScoreWasRefused } from '../../src/ui/AppView.js';

describe('why a score was refused', () => {
  it('names a full device, rather than repeating the browser at the reader', () => {
    // "The quota has been exceeded" is true and tells nobody what to do. A
    // reader whose device is full needs to know it is full and that deleting
    // something fixes it. A score is kept as the whole of its printed music,
    // so one long piece is megabytes.
    const full = new DOMException('The quota has been exceeded.', 'QuotaExceededError');

    expect(whyAScoreWasRefused(full)).toContain('no room left');
    expect(whyAScoreWasRefused(full)).toContain('Delete a score');
  });

  it('knows a full device even where the browser hands back a plain object', () => {
    // Not every browser gives a `DOMException`, and a wrapped one keeps the
    // name and loses the type.
    expect(whyAScoreWasRefused({ name: 'QuotaExceededError' })).toContain('no room left');
  });

  it('passes on what any other failure said for itself', () => {
    expect(whyAScoreWasRefused(new Error('That file has no notes in it.'))).toBe(
      'That file has no notes in it.',
    );
  });

  it('says something rather than nothing where the failure said nothing', () => {
    // An empty message reaching the reader is a line that says "could not
    // open" twice and explains neither.
    expect(whyAScoreWasRefused(new Error(''))).toBe('It could not be read.');
    expect(whyAScoreWasRefused('a string nobody typed')).toBe('It could not be read.');
    expect(whyAScoreWasRefused(null)).toBe('It could not be read.');
  });
});

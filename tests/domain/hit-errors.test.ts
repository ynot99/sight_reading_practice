import { describe, expect, it } from 'vitest';
import { theHitErrors } from '../../src/domain/scoring/theHitErrors.js';

/** Six presses, so that anything shorter is the thing being tested. */
const ENOUGH = [-40, -10, 0, 10, 40, 80];

describe('where the presses of a run landed', () => {
  it('stands the beat in the middle and the window at the edges', () => {
    // The edges are the reader's own tolerance and not a number invented here:
    // the window they set is already the line between a press that counted and
    // one that did not, so a mark against the edge means "that only just
    // landed". His: "hit error bar як в osu".
    const errors = theHitErrors([-250, 0, 250, 10], 250);

    expect(errors?.marks.map((mark) => mark.of)).toEqual([0, 0.5, 1, 0.52]);
  });

  it('widens with the window, saying the same thing about a looser reading', () => {
    const tight = theHitErrors(ENOUGH, 100);
    const loose = theHitErrors(ENOUGH, 400);

    // The same press of eighty milliseconds late: four fifths of the way out
    // where a hundred was allowed, and a tenth of the way where four hundred
    // was.
    expect(tight?.marks[5]?.of).toBeCloseTo(0.9, 10);
    expect(loose?.marks[5]?.of).toBeCloseTo(0.6, 10);
  });

  it('draws a press that missed the window against the edge it left', () => {
    // Left off, a run of wild misses would draw as an empty strip - and an
    // empty strip reads as a tidy one.
    const errors = theHitErrors([-900, 0, 0, 900], 250);

    expect(errors?.marks.map((mark) => mark.of)).toEqual([0, 0.5, 0.5, 1]);
    expect(errors?.marks.map((mark) => mark.beyond)).toEqual([true, false, false, true]);
  });

  it('calls a press on the very edge of the window one that landed', () => {
    const errors = theHitErrors([-250, 250, 0, 0], 250);

    expect(errors?.marks.map((mark) => mark.beyond)).toEqual([false, false, false, false]);
  });

  it('says nothing about a handful of presses', () => {
    // Three marks across a strip invite a reader to see a tendency in what is
    // three points of noise, and a tendency is exactly what this is for.
    expect(theHitErrors([0, 10, -10], 250)).toBeNull();
    expect(theHitErrors([0, 10, -10, 5], 250)).not.toBeNull();
  });

  it('says nothing where the window has no width to place them in', () => {
    // An endless window is what the headless rig runs with. Every press would
    // land at dead centre, and the strip would say a flawless run had been
    // played whatever actually happened.
    expect(theHitErrors(ENOUGH, Number.POSITIVE_INFINITY)).toBeNull();
    expect(theHitErrors(ENOUGH, 0)).toBeNull();
    expect(theHitErrors(ENOUGH, -250)).toBeNull();
  });

  it('counts which way the reading leaned, and calls the beat neither way', () => {
    // Counting a press dead on the beat as one of them would put a machine's
    // reading down as leaning whichever way the tie was broken.
    const errors = theHitErrors([-40, -10, 0, 10, 40, 80], 250);

    expect(errors?.early).toBe(2);
    expect(errors?.late).toBe(3);
  });

  it('stands the average on the same scale as the marks', () => {
    // Which is the whole reason it is a line and not a number: what is worth
    // seeing is where the middle of a reading stands against its scatter.
    const errors = theHitErrors([100, 100, 100, 100], 200);

    expect(errors?.meanOf).toBeCloseTo(0.75, 10);
  });

  it('carries the milliseconds behind each mark', () => {
    const errors = theHitErrors(ENOUGH, 250);

    expect(errors?.marks.map((mark) => mark.deviationMs)).toEqual(ENOUGH);
  });
});

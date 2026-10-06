// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { drawTheLadderTrack, saidOfThePlace, type PlaceOnTheLadder } from '../../src/ui/ladderTrack.js';

const PLACE: PlaceOnTheLadder = {
  here: 'Grade 1 · b',
  below: 'Grade 1 · a',
  above: 'Grade 1 · c',
  streak: 0,
  toMove: 2,
};

/**
 * Each mark as a letter: `r` a rung at an end, `p` a place between, `x` a rung
 * there is none of, and upper case where the reader stands.
 */
function marksOf(track: HTMLElement): string {
  return [...track.querySelectorAll('.ladder-track__mark')]
    .map((mark) => {
      const letter = mark.classList.contains('ladder-track__mark--none')
        ? 'x'
        : mark.classList.contains('ladder-track__mark--rung')
          ? 'r'
          : 'p';
      return mark.classList.contains('ladder-track__mark--here') ? letter.toUpperCase() : letter;
    })
    .join('');
}

describe('the readings in a row, drawn between two rungs', () => {
  it('stands the reader in the middle, and a mark along for each reading in a row', () => {
    expect(marksOf(drawTheLadderTrack(document, PLACE))).toBe('rpPpr');
    expect(marksOf(drawTheLadderTrack(document, { ...PLACE, streak: 1 }))).toBe('rppPr');
    expect(marksOf(drawTheLadderTrack(document, { ...PLACE, streak: -1 }))).toBe('rPppr');
    // As many places as the readings it takes to move, either way.
    expect(marksOf(drawTheLadderTrack(document, { ...PLACE, toMove: 3, streak: 2 }))).toBe('rppppPr');
  });

  it('leaves the end faint where there is no rung that way', () => {
    expect(marksOf(drawTheLadderTrack(document, { ...PLACE, below: null }))).toBe('xpPpr');
    expect(marksOf(drawTheLadderTrack(document, { ...PLACE, above: null }))).toBe('rpPpx');
  });

  it('names the rungs at the two ends only when asked', () => {
    const ends = (track: HTMLElement) =>
      [...track.querySelectorAll('.ladder-track__end')].map((end) => end.textContent);

    expect(ends(drawTheLadderTrack(document, PLACE, { ends: true }))).toEqual(['Grade 1 · a', 'Grade 1 · c']);
    expect(ends(drawTheLadderTrack(document, { ...PLACE, above: null }, { ends: true }))).toEqual([
      'Grade 1 · a',
      '',
    ]);
    expect(ends(drawTheLadderTrack(document, PLACE))).toEqual([]);
  });

  it('says in words where the reader stands, for anyone who cannot see the marks', () => {
    expect(saidOfThePlace(PLACE)).toBe('Grade 1 · b: no readings in a row yet');
    expect(saidOfThePlace({ ...PLACE, streak: 1 })).toBe('Grade 1 · b: 1 clean reading of 2 towards Grade 1 · c');
    expect(saidOfThePlace({ ...PLACE, toMove: 3, streak: -2 })).toBe(
      'Grade 1 · b: 2 poor readings of 3 towards Grade 1 · a',
    );
    const track = drawTheLadderTrack(document, { ...PLACE, streak: 1 });
    expect(track.getAttribute('role')).toBe('img');
    expect(track.getAttribute('aria-label')).toBe(saidOfThePlace({ ...PLACE, streak: 1 }));
  });
});

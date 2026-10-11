import { describe, expect, it } from 'vitest';
import { PiecesInTurn, type PieceInTurn } from '../../src/application/PiecesInTurn.js';

const SHELF: readonly PieceInTurn[] = ['Berceuse', 'Canon', 'Dirtmouth', 'Etude'].map((title) => ({
  id: `score:${title}`,
  title,
}));

/** A source of numbers that walks a fixed list round and round. */
function numbers(...values: number[]): () => number {
  let at = 0;
  return () => {
    const value = values[at % values.length] ?? 0;
    at += 1;
    return value;
  };
}

const titles = (pieces: readonly (PieceInTurn | null)[]): (string | null)[] => pieces.map((piece) => piece?.title ?? null);

describe('the pieces a playback goes through', () => {
  it('goes down the shelf from the piece playing, and round to the top', () => {
    const turn = PiecesInTurn.fromTheShelf(SHELF, 'Canon', false, numbers(0.5));

    expect(turn.playing?.title).toBe('Canon');
    expect(titles([turn.next(), turn.next(), turn.next(), turn.next()])).toEqual([
      'Dirtmouth',
      'Etude',
      'Berceuse',
      'Canon',
    ]);
  });

  it('goes back up it, and round to the bottom', () => {
    const turn = PiecesInTurn.fromTheShelf(SHELF, 'Canon', false, numbers(0.5));

    expect(titles([turn.previous(), turn.previous()])).toEqual(['Berceuse', 'Etude']);
  });

  it('begins at the top for a piece that is not on the shelf', () => {
    const turn = PiecesInTurn.fromTheShelf(SHELF, 'Generated', false, numbers(0.5));

    expect(turn.playing).toBeNull();
    expect(turn.next()?.title).toBe('Berceuse');
  });

  it('plays every piece once in a shuffle, the one playing first, before any again', () => {
    for (const seed of [0, 0.2, 0.5, 0.8, 0.99]) {
      const turn = PiecesInTurn.fromTheShelf(SHELF, 'Dirtmouth', true, numbers(seed, 0.3, 0.7));
      const heard = [turn.playing, turn.next(), turn.next(), turn.next()];

      expect(heard[0]?.title).toBe('Dirtmouth');
      expect(new Set(titles(heard))).toEqual(new Set(SHELF.map((piece) => piece.title)));
      // Dealt again for the next time round, and never with the last first.
      const again = turn.next();
      expect(again?.title).not.toBe(heard[3]?.title);
    }
  });

  it('deals the shuffle again for each time round', () => {
    const rounds = [0, 0.2, 0.5, 0.8].map((seed) => {
      const turn = PiecesInTurn.fromTheShelf(SHELF, 'Berceuse', true, numbers(seed, 0.9, 0.1, 0.6));
      const first = titles([turn.playing, turn.next(), turn.next(), turn.next()]);
      const second = titles([turn.next(), turn.next(), turn.next(), turn.next()]);
      return { first, second };
    });

    expect(rounds.some(({ first, second }) => first.join() !== second.join())).toBe(true);
  });

  it('shuffles, rather than keeping the shelf order', () => {
    const turn = PiecesInTurn.fromTheShelf(SHELF, 'Berceuse', true, numbers(0));

    expect(titles([turn.playing, turn.next(), turn.next(), turn.next()])).not.toEqual(
      SHELF.map((piece) => piece.title),
    );
  });

  it('goes back through a shuffle no further than its first piece', () => {
    const turn = PiecesInTurn.fromTheShelf(SHELF, 'Dirtmouth', true, numbers(0.4));
    const second = turn.next();

    expect(turn.previous()?.title).toBe('Dirtmouth');
    expect(turn.previous()?.title).toBe('Dirtmouth');
    expect(turn.next()?.title).toBe(second?.title);
  });

  it('has nothing to go to on an empty shelf', () => {
    const turn = PiecesInTurn.fromTheShelf([], null, true, numbers(0.4));

    expect(turn.next()).toBeNull();
    expect(turn.previous()).toBeNull();
  });
});

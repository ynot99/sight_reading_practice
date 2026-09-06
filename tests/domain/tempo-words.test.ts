import { describe, expect, it } from 'vitest';
import { tempoWordKind, withTempoWordsPlayed } from '../../src/domain/notation/tempoWords.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { spanMs } from '../../src/domain/model/Exercise.js';
import { longExercise } from '../support/fixtures.js';
import type { Exercise, TempoWord } from '../../src/domain/model/Exercise.js';

/** Four bars of quarters at 60, with whatever words and marks are given. */
function piece(
  words: readonly TempoWord[],
  tempoChanges: Exercise['tempoChanges'] = [],
): Exercise {
  return { ...longExercise({ bars: 4, tempoBpm: 60 }), tempoWords: words, tempoChanges };
}

function word(
  measureIndex: number,
  text: string,
  offsetTicks = 0,
): TempoWord {
  return { measureIndex, offsetTicks, text, kind: tempoWordKind(text) };
}

describe('what a word about the speed means', () => {
  it('knows the ones that move the clock from the ones that do not', () => {
    expect(tempoWordKind('accel.')).toBe('accelerando');
    expect(tempoWordKind('rit.')).toBe('ritardando');
    expect(tempoWordKind('rallentando')).toBe('ritardando');
    expect(tempoWordKind('a tempo')).toBe('a-tempo');
    expect(tempoWordKind('Tempo I')).toBe('a-tempo');
    // Printed and left alone.
    expect(tempoWordKind('dolce')).toBe('other');
    expect(tempoWordKind('espressivo')).toBe('other');
    // These two look like relatives of accel. and rit. and are not: each
    // names a new speed taken up at once, which the file writes as a number
    // beside them if it wants it heard.
    expect(tempoWordKind('Più mosso')).toBe('other');
    expect(tempoWordKind('Meno mosso')).toBe('other');
  });
});

describe('a piece with its words played', () => {
  it('leaves the clock alone where a word has nothing to move to', () => {
    // An instruction with no destination is drawn and obeyed by the reader,
    // not guessed at by the program.
    const alone = piece([word(1, 'rit.')]);

    expect(withTempoWordsPlayed(alone).tempoChanges).toEqual([]);
  });

  it('moves the speed evenly from the word to the mark it heads for', () => {
    // Bar two says rit.; bar four says 30. The bars between are the change.
    const marked = piece([word(1, 'rit.')], [
      { measureIndex: 3, offsetTicks: 0, tempoBpm: 30 },
    ]);

    const played = withTempoWordsPlayed(marked);
    const added = played.tempoChanges.filter((change) => change.tempoBpm !== 30);

    expect(added.length).toBeGreaterThan(0);
    // Falling all the way, and never past the mark it was heading for.
    expect(Math.max(...added.map((change) => change.tempoBpm))).toBeLessThan(60);
    expect(Math.min(...added.map((change) => change.tempoBpm))).toBeGreaterThan(30);
    // In order, and slower every time.
    const inOrder = [...added].sort(
      (left, right) =>
        left.measureIndex - right.measureIndex || left.offsetTicks - right.offsetTicks,
    );
    for (let at = 1; at < inOrder.length; at += 1) {
      expect(inOrder[at]?.tempoBpm ?? 0).toBeLessThanOrEqual(inOrder[at - 1]?.tempoBpm ?? 0);
    }
  });

  it('takes a slowing piece longer to play than an even one', () => {
    // The point of the whole thing: the clock actually moves.
    const even = piece([]);
    const slowing = withTempoWordsPlayed(
      piece([word(1, 'rit.')], [{ measureIndex: 3, offsetTicks: 0, tempoBpm: 30 }]),
    );
    const toTheEnd = (exercise: Exercise): number =>
      spanMs(exercise, 0, Duration.WHOLE.ticks * 4);

    expect(toTheEnd(slowing)).toBeGreaterThan(toTheEnd(even));
  });

  it('leaves the clock alone where the next mark is the wrong way', () => {
    // A rit. followed by a faster mark is not a rit. towards it: the piece
    // holds its speed and the new number arrives when it is written.
    const wrongWay = piece([word(1, 'rit.')], [
      { measureIndex: 2, offsetTicks: 0, tempoBpm: 90 },
    ]);

    expect(withTempoWordsPlayed(wrongWay).tempoChanges).toEqual([
      { measureIndex: 2, offsetTicks: 0, tempoBpm: 90 },
    ]);
  });

  it('leaves the clock alone where the next mark is too far off', () => {
    // Twelve bars away, and so not this word's destination. Read as one, the
    // whole stretch between comes out gradually slowing - which is what a
    // Minecraft arrangement did across sixty-three bars of itself.
    const distant: Exercise = {
      ...longExercise({ bars: 16, tempoBpm: 60 }),
      tempoWords: [word(1, 'rit.')],
      tempoChanges: [{ measureIndex: 13, offsetTicks: 0, tempoBpm: 30 }],
    };

    expect(withTempoWordsPlayed(distant).tempoChanges).toEqual([
      { measureIndex: 13, offsetTicks: 0, tempoBpm: 30 },
    ]);
  });

  it('puts the speed back where "a tempo" says so', () => {
    const marked = piece(
      [word(1, 'rit.'), word(2, 'a tempo')],
      [{ measureIndex: 1, offsetTicks: 0, tempoBpm: 60 }],
    );

    const played = withTempoWordsPlayed(marked);
    const atBarThree = played.tempoChanges.filter((change) => change.measureIndex === 2);

    // Back to sixty, which is the last speed the piece was *told* to play at
    // rather than the speed the slowing had reached.
    expect(atBarThree.map((change) => change.tempoBpm)).toEqual([60]);
  });

  it('says nothing about a piece with no words at all', () => {
    const plain = piece([]);

    expect(withTempoWordsPlayed(plain)).toBe(plain);
  });
});

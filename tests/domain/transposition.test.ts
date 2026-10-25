import { describe, expect, it } from 'vitest';
import { validateExercise, type Exercise } from '../../src/domain/model/Exercise.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { theQuestionsPlayedBack } from '../../src/domain/solfege/playedBack.js';
import { TRANSPOSITION_NAMES, TRANSPOSITIONS_IN_A_ROUND, theTransposition, type TranspositionName } from '../../src/domain/solfege/transposition.js';

/** How far each transposition moves a note, in semitones. */
const SEMITONES: Readonly<Record<TranspositionName, number>> = {
  upASecond: 2,
  downASecond: -2,
  upAThird: 3,
  downAThird: -3,
  upAFourth: 5,
  downAFourth: -5,
};

/** Each phrase as written, and as transposed, by its keys. */
function phrasesOf(round: Exercise): { readonly written: number[]; readonly moved: number[] }[] {
  const measures = round.staves[0]?.measures ?? [];
  const keys = (from: number): number[] =>
    measures.slice(from, from + 2).flatMap((measure) => measure.entries.flatMap((entry) => (entry.kind === 'note' ? entry.pitches.map((pitch) => pitch.midi) : [])));
  return Array.from({ length: TRANSPOSITIONS_IN_A_ROUND }, (_, at) => ({ written: keys(at * 4), moved: keys(at * 4 + 2) }));
}

const KEYS = [0, 3, -2, 6, -7, 7].flatMap((fifths) => [false, true].map((minor) => ({ fifths, minor })));

describe('transposition', () => {
  it('is a valid round of three phrases, each written and then to be played in the key asked, the same for the same seed', () => {
    for (const key of KEYS) {
      for (const by of TRANSPOSITION_NAMES) {
        const round = theTransposition({ ...key, by, seed: 4 });
        expect(() => {
          validateExercise(round);
        }).not.toThrow();
        expect(round.staves[0]?.measures.length).toBe(TRANSPOSITIONS_IN_A_ROUND * 4);
        expect(theTransposition({ ...key, by, seed: 4 })).toEqual(round);
      }
    }
  });

  it('moves every note of a phrase by the interval asked, the same degrees of the new key, its signature within seven', () => {
    const broken: string[] = [];
    for (const key of KEYS) {
      for (const by of TRANSPOSITION_NAMES) {
        for (const seed of [1, 2, 3, 4, 5]) {
          const round = theTransposition({ ...key, by, seed });
          for (const { written, moved } of phrasesOf(round)) {
            const shifts = new Set(moved.map((midi, at) => midi - (written[at] ?? 0)));
            if (moved.length !== written.length || shifts.size !== 1 || !shifts.has(SEMITONES[by])) {
              broken.push(`${String(key.fifths)}${key.minor ? 'm' : ''} ${by}: ${[...shifts].join()}`);
            }
          }
          const target = round.keyChanges.find((change) => change.measureIndex === 2)?.key;
          if (target === undefined || Math.abs(target.fifths) > 7 || target.mode !== (key.minor ? 'minor' : 'major')) {
            broken.push(`${String(key.fifths)} ${by}: signature ${String(target?.fifths)}`);
          }
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it('writes the key back before each phrase, names the new one over its bars, and keeps all of each transposed phrase but its first note to be found, read and not heard', () => {
    const round = theTransposition({ fifths: 0, minor: false, by: 'upASecond', seed: 2 });
    expect(round.keyChanges.map((change) => `${String(change.measureIndex)} ${String(change.key.fifths)}`)).toEqual(['2 2', '4 0', '6 2', '8 0', '10 2']);
    expect(round.rehearsalMarks?.map((mark) => `${String(mark.measureIndex)} ${mark.text}`)).toEqual(['2 In D major', '6 In D major', '10 In D major']);
    expect(round.title).toBe('Up a major second: C major to D major');
    expect([round.playedBack?.heard, round.playedBack?.keyFirst]).toEqual([false, false]);
    const timeline = buildTimeline(round);
    const questions = theQuestionsPlayedBack(timeline);
    expect(questions.map((question) => timeline.at(question.given)?.measureIndex)).toEqual([2, 6, 10]);
    // Every note of the bars transposed but the first is to be found; none written out is.
    const found = new Set(questions.flatMap((question) => question.found));
    expect(timeline.steps.filter((step) => found.has(step.index)).every((step) => [2, 3, 6, 7, 10, 11].includes(step.measureIndex))).toBe(true);
    expect(found.size).toBe(phrasesOf(round).reduce((all, phrase) => all + phrase.moved.length - 1, 0));
    // G sharp major is written as A flat.
    expect(theTransposition({ fifths: 6, minor: false, by: 'upASecond', seed: 1 }).keyChanges[0]?.key.fifths).toBe(-4);
  });
});

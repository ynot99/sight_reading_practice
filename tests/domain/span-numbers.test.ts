import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import type { DynamicHairpin, Exercise, OctaveShift } from '../../src/domain/model/Exercise.js';
import { MusicXmlSerializer, spanNumbers } from '../../src/domain/notation/MusicXmlSerializer.js';
import { longExercise } from '../support/fixtures.js';

const q = Duration.QUARTER.ticks;

function hairpin(
  kind: DynamicHairpin['kind'],
  from: [number, number],
  until: [number, number],
): DynamicHairpin {
  return {
    measureIndex: from[0],
    offsetTicks: from[1],
    kind,
    untilMeasureIndex: until[0],
    untilOffsetTicks: until[1],
    staffNumber: null,
  };
}

/** Each wedge written, in order: its type and its number. */
function wedges(xml: string): string[] {
  return [...xml.matchAll(/<wedge type="(\w+)" number="(\d+)"/g)].map((found) => `${found[1]} ${found[2]}`);
}

describe('numbering the lines over the music', () => {
  it('gives a line one number for the whole piece, the lowest free where it begins', () => {
    const lines = [
      hairpin('crescendo', [0, 0], [1, 0]),
      hairpin('diminuendo', [1, 0], [2, 0]),
      hairpin('crescendo', [3, 0], [4, 0]),
    ];

    const numbers = spanNumbers(lines);

    // The second begins where the first ends, so both are open there; the
    // third begins after both have ended, and takes the first number again.
    expect(lines.map((line) => numbers.get(line))).toEqual([1, 2, 1]);
  });

  it('keeps a line that is still open out of the way of one beginning inside it', () => {
    const lines = [hairpin('crescendo', [0, 0], [3, 0]), hairpin('diminuendo', [1, q], [2, 0])];

    const numbers = spanNumbers(lines);

    expect(lines.map((line) => numbers.get(line))).toEqual([1, 2]);
  });
});

describe('writing a line whose ends are in different bars', () => {
  it('ends it with the number it began with, whatever else touches either bar', () => {
    // His Alkan, bars 37 to 39: a crescendo ending where a diminuendo
    // begins. The diminuendo was begun as 2 in the bar it shared and ended as
    // 1 in a bar of its own, and Verovio drew it on to bar 1240.
    const piece: Exercise = {
      ...longExercise({ bars: 4 }),
      hairpins: [hairpin('crescendo', [0, 0], [1, 0]), hairpin('diminuendo', [1, 0], [2, 0])],
    };

    expect(wedges(new MusicXmlSerializer().serialize(piece))).toEqual([
      'crescendo 1',
      'stop 1',
      'diminuendo 2',
      'stop 2',
    ]);
  });

  it('does the same for an octave line', () => {
    const shift = (from: [number, number], until: [number, number]): OctaveShift => ({
      measureIndex: from[0],
      offsetTicks: from[1],
      untilMeasureIndex: until[0],
      untilOffsetTicks: until[1],
      direction: 'down',
      size: 8,
      staffNumber: null,
    });
    const piece: Exercise = {
      ...longExercise({ bars: 4 }),
      octaveShifts: [shift([0, 0], [1, 0]), shift([1, 0], [2, 0])],
    };

    const written = [...new MusicXmlSerializer().serialize(piece).matchAll(/<octave-shift type="(\w+)"[^>]*number="(\d+)"/g)].map(
      (found) => `${found[1]} ${found[2]}`,
    );

    expect(written).toEqual(['down 1', 'stop 1', 'down 2', 'stop 2']);
  });
});

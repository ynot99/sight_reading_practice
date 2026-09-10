import { describe, expect, it } from 'vitest';
import { withFermatasHeld } from '../../src/domain/notation/fermatas.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry, spanMs, tempoAtTick } from '../../src/domain/model/Exercise.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { bar, p, twoBarExercise } from '../support/fixtures.js';

/** One bar of four crotchets, with a fermata over whichever are named. */
function withFermatasOn(...over: readonly number[]): Exercise {
  const written = twoBarExercise({ tempoBpm: 60 });
  return {
    ...written,
    tempoChanges: [],
    staves: [
      {
        staffNumber: 1,
        voice: 1,
        clef: 'treble',
        clefChanges: [],
        measures: [
          bar(
            ...['C4', 'D4', 'E4', 'F4'].map((name, at) =>
              noteEntry(p(name), Duration.QUARTER, [], [], null, false, {
                fermata: over.includes(at),
              }),
            ),
          ),
        ],
      },
    ],
  };
}

describe('a note under a fermata', () => {
  it('is held by taking it slower, and the speed goes back afterwards', () => {
    // Said as a change of speed because that is the language the clock
    // already speaks: the metronome's plan, the timeline's milliseconds, the
    // judging window and the marker are all read off the tempo. Lengthening
    // the note instead would have moved the bar lines, and the bar lines are
    // where the music is printed.
    const held = withFermatasHeld(withFermatasOn(1));

    expect(tempoAtTick(held, 0)).toBe(60);
    expect(tempoAtTick(held, Duration.QUARTER.ticks)).toBe(30);
    expect(tempoAtTick(held, Duration.HALF.ticks)).toBe(60);
    // And nothing about it is the writer's to print.
    expect(held.tempoChanges.every((change) => change.implied === true)).toBe(true);
  });

  it('makes the bar it is in take longer to play', () => {
    // The whole point, and the thing that was missing: the fermatas were
    // read, carried and printed, and given no time at all.
    const plain = withFermatasOn();
    const held = withFermatasHeld(withFermatasOn(1));
    const wholeBar = Duration.QUARTER.ticks * 4;

    expect(spanMs(held, 0, wholeBar)).toBeGreaterThan(spanMs(plain, 0, wholeBar));
    // One crotchet at sixty is a second, and held it is two.
    expect(spanMs(held, 0, wholeBar)).toBe(spanMs(plain, 0, wholeBar) + 1_000);
  });

  it('holds a run of them as one stretch rather than several', () => {
    // Three fermatas over three notes in a row are held one after another,
    // and putting the tempo back between them would be a restoration nobody
    // hears. His White Palace writes its slowings exactly that way: two or
    // three over the last notes of the bar.
    const held = withFermatasHeld(withFermatasOn(1, 2, 3));
    const changes = held.tempoChanges;

    expect(changes).toHaveLength(2);
    expect(changes[0]?.offsetTicks).toBe(Duration.QUARTER.ticks);
    expect(changes[0]?.tempoBpm).toBe(30);
    // Back at the end of the last of them, not between.
    expect(changes[1]?.offsetTicks).toBe(Duration.QUARTER.ticks * 4);
    expect(changes[1]?.tempoBpm).toBe(60);
  });

  it('says nothing about a piece that has none', () => {
    const plain = withFermatasOn();

    expect(withFermatasHeld(plain)).toBe(plain);
  });

  it('is half of whatever speed was in force, not half the opening one', () => {
    // A fermata inside a slowing passage is half of what that passage had
    // reached; the speed it goes back to is what the passage had by then.
    const slowing: Exercise = {
      ...withFermatasOn(2),
      tempoChanges: [{ measureIndex: 0, offsetTicks: Duration.QUARTER.ticks, tempoBpm: 40 }],
    };

    const held = withFermatasHeld(slowing);

    expect(tempoAtTick(held, Duration.HALF.ticks)).toBe(20);
    expect(tempoAtTick(held, Duration.QUARTER.ticks * 3)).toBe(40);
  });
});

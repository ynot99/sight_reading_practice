import { describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry, type Exercise, type MusicalEntry } from '../../src/domain/model/Exercise.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { landing, perfectWindowMs } from '../../src/domain/scoring/noteTiers.js';
import { buildTimeline, type ExerciseTimeline } from '../../src/domain/timeline/Timeline.js';
import { bar, p, twoBarExercise } from '../support/fixtures.js';

/** One staff of music, bar after bar, at a tempo. */
function played(tempoBpm: number, bars: readonly (readonly MusicalEntry[])[], time?: TimeSignature): ExerciseTimeline {
  const base = twoBarExercise({ tempoBpm });
  const [treble] = base.staves;
  const exercise: Exercise = {
    ...base,
    ...(time === undefined ? {} : { timeSignature: time }),
    staves: [
      {
        ...(treble as NonNullable<typeof treble>),
        measures: bars.map((entries) => bar(...entries)),
      },
    ],
  };
  return buildTimeline(exercise);
}

function times(count: number, duration: Duration): MusicalEntry[] {
  return Array.from({ length: count }, () => noteEntry(p('C4'), duration));
}

const QUARTERS = [times(4, Duration.QUARTER)];
const SIXTEENTHS = [times(16, Duration.SIXTEENTH)];

describe('how far from its moment a note may land and still be Perfect', () => {
  it('is forty milliseconds at a moderate tempo', () => {
    // Six per cent of a beat at 120 is thirty, under the floor.
    expect(perfectWindowMs(played(120, QUARTERS), 1, false)).toBe(40);
  });

  it('grows with a long beat, where a steady hand scatters more', () => {
    expect(perfectWindowMs(played(60, QUARTERS), 1, false)).toBeCloseTo(60, 9);
    expect(perfectWindowMs(played(40, QUARTERS), 1, true)).toBeCloseTo(90, 9);
  });

  it('never reaches a third of the way to the next note', () => {
    // A sixteenth at 160 is 93.75 ms: forty would be nearly half of it.
    expect(perfectWindowMs(played(160, SIXTEENTHS), 5, false)).toBeCloseTo(93.75 / 3, 9);
    expect(perfectWindowMs(played(160, SIXTEENTHS), 5, true)).toBeCloseTo(93.75 / 3, 9);
  });

  it('measures each side against the note on that side', () => {
    // A quarter, then sixteenths: behind the first sixteenth is a whole beat,
    // ahead of it only a sixteenth.
    const timeline = played(160, [
      [noteEntry(p('C4'), Duration.QUARTER), ...times(4, Duration.SIXTEENTH), noteEntry(p('C4'), Duration.HALF)],
    ]);

    expect(perfectWindowMs(timeline, 1, true)).toBe(40);
    expect(perfectWindowMs(timeline, 1, false)).toBeCloseTo(93.75 / 3, 9);
  });

  it('leaves the first note nothing behind it to be kept from', () => {
    // Triplet sixteenths at forty: the beat allows ninety, and the next note
    // is 250 ms on - so ahead the window stops at a third of that, and behind
    // there is nothing to stop it.
    const timeline = played(40, [times(24, Duration.TRIPLET_SIXTEENTH)]);

    expect(perfectWindowMs(timeline, 0, true)).toBeCloseTo(90, 9);
    expect(perfectWindowMs(timeline, 0, false)).toBeCloseTo(250 / 3, 9);
  });

  it('takes the beat that is felt, a dotted quarter in six-eight', () => {
    // Counted by the eighth it would be six per cent of 500 ms, and the floor.
    const timeline = played(60, [times(6, Duration.EIGHTH)], new TimeSignature(6, 8));

    expect(perfectWindowMs(timeline, 2, false)).toBeCloseTo(90, 9);
  });

  it('follows the tempo the note is played at, where the piece changes it', () => {
    const base = played(120, [times(4, Duration.QUARTER), times(4, Duration.QUARTER)]);
    const slower = buildTimeline({
      ...base.exercise,
      tempoChanges: [{ measureIndex: 1, offsetTicks: 0, tempoBpm: 40 }],
    });

    expect(perfectWindowMs(slower, 1, false)).toBe(40);
    expect(perfectWindowMs(slower, 5, false)).toBeCloseTo(90, 9);
  });
});

describe('Perfect or Good', () => {
  const timeline = played(60, QUARTERS);

  it('is Perfect inside the window, to its edge, on either side', () => {
    expect(landing(timeline, 1, 60).tier).toBe('perfect');
    expect(landing(timeline, 1, -60).tier).toBe('perfect');
    expect(landing(timeline, 1, 0).tier).toBe('perfect');
  });

  it('is Good outside it, on either side', () => {
    expect(landing(timeline, 1, 61).tier).toBe('good');
    expect(landing(timeline, 1, -61).tier).toBe('good');
  });

  it('says the window it was judged in, on the side it fell', () => {
    expect(landing(timeline, 1, 30).windowMs).toBeCloseTo(60, 9);
    const mixed = played(160, [
      [noteEntry(p('C4'), Duration.QUARTER), ...times(4, Duration.SIXTEENTH), noteEntry(p('C4'), Duration.HALF)],
    ]);
    expect(landing(mixed, 1, -10).windowMs).toBe(40);
    expect(landing(mixed, 1, 10).windowMs).toBeCloseTo(93.75 / 3, 9);
  });

  it('asks the side the press fell on', () => {
    // Behind the first sixteenth is a beat, ahead of it a sixteenth: forty
    // milliseconds early is Perfect, forty late is not.
    const mixed = played(160, [
      [noteEntry(p('C4'), Duration.QUARTER), ...times(4, Duration.SIXTEENTH), noteEntry(p('C4'), Duration.HALF)],
    ]);

    expect(landing(mixed, 1, -40).tier).toBe('perfect');
    expect(landing(mixed, 1, 40).tier).toBe('good');
  });
});

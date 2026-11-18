import { describe, expect, it } from 'vitest';
import {
  howHardItLooks,
  RAW_TO_STARS,
  theBusiestPlaces,
  theStarsForTheRaw,
} from '../../src/domain/difficulty/howHardItLooks.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry, restEntry, type Exercise } from '../../src/domain/model/Exercise.js';
import { bar, longExercise, p } from '../support/fixtures.js';

interface Shape {
  /** Bars of the busy part. */
  readonly bars?: number;
  /** Strikes to a beat: 1, 2 or 4. */
  readonly perBeat?: 1 | 2 | 4;
  /** Keys in each strike. */
  readonly keys?: number;
  readonly bpm?: number;
  /** Bars of one held note each, before the busy part. */
  readonly quietBarsFirst?: number;
}

/** A piece of one figure: strikes of a chord, evenly, after some quiet bars. */
function piece({ bars = 32, perBeat = 1, keys = 1, bpm = 60, quietBarsFirst = 0 }: Shape = {}): Exercise {
  const value = perBeat === 1 ? Duration.QUARTER : perBeat === 2 ? Duration.EIGHTH : Duration.SIXTEENTH;
  const chord = ['C4', 'E4', 'G4', 'C5'].slice(0, keys).map(p);
  const base = longExercise({ tempoBpm: bpm });
  const [staff] = base.staves;
  if (staff === undefined) {
    throw new Error('The fixture has a staff.');
  }
  return {
    ...base,
    staves: [
      {
        ...staff,
        measures: [
          ...Array.from({ length: quietBarsFirst }, () => bar(noteEntry(p('C4'), Duration.WHOLE))),
          ...Array.from({ length: bars }, () =>
            bar(...Array.from({ length: 4 * perBeat }, () => noteEntry(chord, value))),
          ),
        ],
      },
    ],
  };
}

describe('how hard a piece looks from its notes', () => {
  it('has nothing to say about a piece with no notes in it', () => {
    const silent = piece({ bars: 0, quietBarsFirst: 0 });
    const rests = {
      ...silent,
      staves: silent.staves.map((staff) => ({ ...staff, measures: [bar(restEntry(Duration.WHOLE))] })),
    };

    expect(howHardItLooks(rests)).toBeNull();
  });

  it('counts notes a second, a chord as many notes as it has keys', () => {
    // One strike a second, for two minutes: every stretch holds four in four seconds.
    expect(theBusiestPlaces(piece())).toBeCloseTo(1, 2);
    expect(theBusiestPlaces(piece({ keys: 3 }))).toBeCloseTo(3, 2);
    expect(theBusiestPlaces(piece({ perBeat: 4, bpm: 120 }))).toBeCloseTo(8, 1);
  });

  it('counts the busiest few seconds: a four-second burst at its own pace, a two-second one at half', () => {
    // At 120 a beat is half a second, so two bars are four seconds and one is two.
    const bursts = (busyBars: number): Exercise => {
      const base = piece({ bpm: 120 });
      const [staff] = base.staves;
      if (staff === undefined) {
        throw new Error('The fixture has a staff.');
      }
      const busy = () => bar(...Array.from({ length: 16 }, () => noteEntry(p('C4'), Duration.SIXTEENTH)));
      const still = () => bar(restEntry(Duration.WHOLE));
      const turn = [
        ...Array.from({ length: busyBars }, busy),
        ...Array.from({ length: busyBars }, still),
      ];
      return { ...base, staves: [{ ...staff, measures: Array.from({ length: 16 }, () => turn).flat() }] };
    };

    // Eight notes a second while they last.
    expect(theBusiestPlaces(bursts(2))).toBeGreaterThan(7);
    expect(theBusiestPlaces(bursts(1))).toBeGreaterThan(3.5);
    expect(theBusiestPlaces(bursts(1))).toBeLessThan(4.5);
  });

  it('reads the raw measure as stars along its points, and along the end ones past them', () => {
    // Given to a tenth, so within half of one.
    const near = (raw: number, stars: number): void => {
      expect(Math.abs(theStarsForTheRaw(raw) - stars), `raw ${String(raw)}`).toBeLessThanOrEqual(0.05 + 1e-9);
    };
    RAW_TO_STARS.forEach(([raw, stars], index) => {
      near(raw, stars);
      const next = RAW_TO_STARS[index + 1];
      if (next !== undefined) {
        near((raw + next[0]) / 2, (stars + next[1]) / 2);
      }
    });
    const [lastRaw] = RAW_TO_STARS.at(-1) ?? [0, 0];
    const [firstRaw] = RAW_TO_STARS[0] ?? [0, 0];
    expect(theStarsForTheRaw(firstRaw - 10)).toBe(1);
    expect(theStarsForTheRaw(lastRaw + 10)).toBe(10);
  });

  it('is as busy as its busiest places, whatever quiet comes before them', () => {
    // An average over the piece would make the run a third as busy.
    const alone = theBusiestPlaces(piece({ bars: 16, perBeat: 4, bpm: 120 }));
    const afterQuiet = theBusiestPlaces(piece({ bars: 16, perBeat: 4, bpm: 120, quietBarsFirst: 32 }));

    expect(afterQuiet / alone).toBeGreaterThan(0.97);
    expect(afterQuiet / alone).toBeLessThan(1.03);
  });

  it('never looks easier for more notes a second, at any tempo or figure', () => {
    const tempos = [40, 60, 80, 100, 120, 140, 160, 200, 240];
    const figures = [1, 2, 4] as const;
    const stars = figures.map((perBeat) => tempos.map((bpm) => howHardItLooks(piece({ perBeat, bpm })) ?? 0));
    const table = stars.map((row, index) => `${String(figures[index])}: ${row.join(' ')}`).join('\n');

    for (const row of stars) {
      row.slice(1).forEach((value, index) => {
        expect(value, table).toBeGreaterThanOrEqual(row[index] ?? 0);
      });
    }
    tempos.forEach((_, column) => {
      figures.slice(1).forEach((_, index) => {
        expect(stars[index + 1]?.[column] ?? 0, table).toBeGreaterThanOrEqual(stars[index]?.[column] ?? 0);
      });
    });
    // And across the whole band it climbs, not merely stays level.
    expect(stars[2]?.[8] ?? 0, table).toBeGreaterThan((stars[0]?.[0] ?? 0) + 3);
  });

  it('looks harder the longer it goes on, at the same pace', () => {
    expect(howHardItLooks(piece({ bars: 64, perBeat: 2, bpm: 100 }))).toBeGreaterThan(
      howHardItLooks(piece({ bars: 16, perBeat: 2, bpm: 100 })) ?? 10,
    );
  });

  it('stays between one star and ten, to a tenth', () => {
    expect(howHardItLooks(piece({ bars: 4, bpm: 40 }))).toBe(1);
    expect(howHardItLooks(piece({ bars: 400, perBeat: 4, keys: 4, bpm: 240 }))).toBe(10);
    for (const bpm of [50, 70, 90, 110, 130, 150, 170, 190]) {
      const stars = howHardItLooks(piece({ perBeat: 2, keys: 2, bpm })) ?? 0;
      expect(Math.round(stars * 10)).toBeCloseTo(stars * 10, 9);
    }
  });
});

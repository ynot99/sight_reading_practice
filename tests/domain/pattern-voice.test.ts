import { describe, expect, it } from 'vitest';
import {
  FigureWalker,
  type Figure,
  type FigureKind,
  type FigureWalkerOptions,
  type WeightedFigure,
} from '../../src/domain/generation/voices/figures.js';
import { PatternVoiceGenerator } from '../../src/domain/generation/voices/PatternVoiceGenerator.js';
import { createRng } from '../../src/domain/generation/Rng.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { measureTicks } from '../../src/domain/model/Exercise.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { steadyProfile } from '../support/rhythm.js';

const COMMON = new TimeSignature(4, 4);

function only(...kinds: FigureKind[]): WeightedFigure[] {
  return kinds.map((value) => ({ value, weight: 1 }));
}

function walkerFor(overrides: Partial<FigureWalkerOptions> = {}): FigureWalker {
  return new FigureWalker({
    rng: createRng(7),
    lowest: 0,
    highest: 21,
    startIndex: 10,
    tonicIndex: 7,
    figures: only('scale'),
    maxLeap: 3,
    ...overrides,
  });
}

/** Walks `count` notes and reports the figures they were drawn from, in order. */
function figuresOf(walker: FigureWalker, count: number): { figures: Figure[]; notes: number[] } {
  const figures: Figure[] = [];
  const notes: number[] = [];
  let last: Figure | null = null;
  for (let index = 0; index < count; index += 1) {
    notes.push(walker.next());
    const current = walker.lastFigure;
    if (current !== null && current !== last) {
      figures.push(current);
      last = current;
    }
  }
  return { figures, notes };
}

describe('FigureWalker', () => {
  it('writes scale fragments as runs of neighbouring degrees', () => {
    const { figures } = figuresOf(walkerFor({ figures: only('scale') }), 60);

    expect(figures.length).toBeGreaterThan(5);
    for (const figure of figures) {
      expect(figure.shape.length).toBeGreaterThanOrEqual(3);
      expect(figure.shape.length).toBeLessThanOrEqual(5);
      const steps = figure.shape.slice(1).map((offset, index) => offset - (figure.shape[index] ?? 0));
      // Every step of a run is one degree, all in the same direction.
      expect(new Set(steps)).toEqual(new Set([steps[0]]));
      expect(Math.abs(steps[0] ?? 0)).toBe(1);
    }
  });

  it('writes arpeggios as stacked thirds, in either direction', () => {
    const { figures } = figuresOf(walkerFor({ figures: only('arpeggio') }), 80);

    expect(figures.length).toBeGreaterThan(5);
    for (const figure of figures) {
      // What makes it a chord is the set of notes, not the order they are
      // played in: normalise to the lowest note and it must be a stack of
      // thirds with nothing missing from the middle.
      const lowest = Math.min(...figure.shape);
      const stack = [...new Set(figure.shape.map((offset) => offset - lowest))].sort(
        (left, right) => left - right,
      );
      expect({ shape: [...figure.shape], stack }).toEqual({
        shape: [...figure.shape],
        stack: [0, 2, 4, 6].slice(0, stack.length),
      });
    }
  });

  it('builds arpeggios on I, IV or V rather than any degree', () => {
    const tonicIndex = 7;
    const { figures } = figuresOf(walkerFor({ figures: only('arpeggio'), tonicIndex }), 80);

    expect(figures.length).toBeGreaterThan(5);
    for (const figure of figures) {
      // The root is the lowest note, whichever end the figure starts from.
      const root = figure.start + Math.min(...figure.shape);
      const degree = (((root - tonicIndex) % 7) + 7) % 7;
      expect([0, 3, 4]).toContain(degree);
    }
  });

  it('answers a figure with the same shape a step away', () => {
    const { figures } = figuresOf(
      walkerFor({ figures: [{ value: 'scale', weight: 1 }, { value: 'sequence', weight: 9 }] }),
      120,
    );

    const sequences = figures.filter((figure) => figure.kind === 'sequence');
    expect(sequences.length).toBeGreaterThan(3);

    for (let index = 1; index < figures.length; index += 1) {
      const figure = figures[index];
      const previous = figures[index - 1];
      if (figure === undefined || previous === undefined || figure.kind !== 'sequence') {
        continue;
      }
      // Same motif, moved by a step or two - the whole point of a sequence.
      expect(figure.shape.join()).toBe(previous.shape.join());
      expect([1, 2]).toContain(Math.abs(figure.start - previous.start));
    }
  });

  it('repeats a motif exactly when asked', () => {
    const { figures } = figuresOf(
      walkerFor({ figures: [{ value: 'scale', weight: 1 }, { value: 'repeat', weight: 9 }] }),
      120,
    );

    const repeats = figures.filter((figure) => figure.kind === 'repeat');
    expect(repeats.length).toBeGreaterThan(3);

    for (let index = 1; index < figures.length; index += 1) {
      const figure = figures[index];
      const previous = figures[index - 1];
      if (figure === undefined || previous === undefined || figure.kind !== 'repeat') {
        continue;
      }
      expect(figure.start).toBe(previous.start);
      expect(figure.shape.join()).toBe(previous.shape.join());
    }
  });

  it('stops sequencing before the ear tires of it', () => {
    const { figures } = figuresOf(
      walkerFor({ figures: [{ value: 'scale', weight: 1 }, { value: 'sequence', weight: 99 }] }),
      200,
    );

    let run = 0;
    for (const figure of figures) {
      run = figure.kind === 'sequence' ? run + 1 : 0;
      expect(run).toBeLessThanOrEqual(2);
    }
  });

  it('never leaves the range, however little room there is', () => {
    for (const [lowest, highest] of [
      [0, 21],
      [0, 4],
      [3, 5],
      [2, 2],
    ] as const) {
      for (let seed = 0; seed < 12; seed += 1) {
        const { notes } = figuresOf(
          walkerFor({
            rng: createRng(seed),
            lowest,
            highest,
            startIndex: lowest,
            tonicIndex: lowest,
            figures: only('scale', 'arpeggio', 'neighbour', 'repeat', 'sequence'),
          }),
          80,
        );
        for (const note of notes) {
          expect(note).toBeGreaterThanOrEqual(lowest);
          expect(note).toBeLessThanOrEqual(highest);
        }
      }
    }
  });

  it('turns a run around at the ceiling instead of flattening it', () => {
    // No room above and no connecting leap: the only way to place a rising
    // scale is to mirror it.
    const { figures } = figuresOf(
      walkerFor({ lowest: 0, highest: 4, startIndex: 4, figures: only('scale'), maxLeap: 0 }),
      12,
    );

    const first = figures[0];
    expect(first).toBeDefined();
    expect(first?.start).toBe(4);
    expect(Math.max(...(first?.shape ?? [0]))).toBe(0);
  });
});

describe('PatternVoiceGenerator', () => {
  const context = {
    rng: createRng(3),
    key: KeySignature.major(2),
    timeSignature: COMMON,
    measures: 6,
    rhythm: steadyProfile(Duration.QUARTER),
  };

  const generator = new PatternVoiceGenerator({
    range: { lowest: Pitch.parse('C4'), highest: Pitch.parse('C6') },
    role: 'lead',
    figures: [
      { value: 'scale', weight: 4 },
      { value: 'arpeggio', weight: 3 },
      { value: 'neighbour', weight: 2 },
      { value: 'sequence', weight: 2 },
      { value: 'repeat', weight: 1 },
    ],
    maxLeap: 3,
  });

  it('fills every bar and stays inside the hand', () => {
    const measures = generator.generate({ ...context, rng: createRng(11) });

    expect(measures).toHaveLength(6);
    for (const measure of measures) {
      expect(measureTicks(measure)).toBe(COMMON.ticksPerMeasure);
      for (const entry of measure.entries) {
        if (entry.kind !== 'note') {
          continue;
        }
        for (const pitch of entry.pitches) {
          // Staff positions, not semitones: the range names notes on the page,
          // and the key signature is free to sharpen the top one.
          expect(pitch.diatonicIndex).toBeGreaterThanOrEqual(
            Pitch.parse('C4').diatonicIndex,
          );
          expect(pitch.diatonicIndex).toBeLessThanOrEqual(Pitch.parse('C6').diatonicIndex);
        }
      }
    }
  });

  it('spells everything for the key signature', () => {
    const measures = generator.generate({ ...context, rng: createRng(5) });
    const pitches = measures.flatMap((measure) =>
      measure.entries.flatMap((entry) => (entry.kind === 'note' ? [...entry.pitches] : [])),
    );

    expect(pitches.length).toBeGreaterThan(0);
    for (const pitch of pitches) {
      // D major: F and C are sharp, everything else natural.
      expect(pitch.alter).toBe(pitch.step === 'F' || pitch.step === 'C' ? 1 : 0);
    }
  });

  it('is reproducible from its seed', () => {
    const shape = (seed: number): string =>
      generator
        .generate({ ...context, rng: createRng(seed) })
        .flatMap((measure) =>
          measure.entries.flatMap((entry) =>
            entry.kind === 'note' ? entry.pitches.map((pitch) => pitch.toString()) : ['rest'],
          ),
        )
        .join(' ');

    expect(shape(19)).toBe(shape(19));
    expect(shape(19)).not.toBe(shape(20));
  });

  it('reads as figures, not as a random walk', () => {
    const measures = generator.generate({ ...context, rng: createRng(23), measures: 16 });
    const indices = measures.flatMap((measure) =>
      measure.entries.flatMap((entry) =>
        entry.kind === 'note' ? entry.pitches.map((pitch) => pitch.diatonicIndex) : [],
      ),
    );

    // The property that matters: most notes continue a figure, so most
    // intervals are the small ones figures are made of rather than the free
    // leaps that only happen between them.
    const steps = indices.slice(1).map((index, at) => Math.abs(index - (indices[at] ?? index)));
    const inFigure = steps.filter((step) => step <= 2).length;
    expect(inFigure / steps.length).toBeGreaterThan(0.7);
  });
});

import { describe, expect, it } from 'vitest';
import type { MidiFileEvent } from '../../src/domain/midi/MidiFile.js';
import {
  theTakeOnTheKeys,
  theTakesKeysAt,
  theTakesPedalAt,
  theTakesPedalBetween,
  theTakesPressesBetween,
} from '../../src/application/takeOnTheKeys.js';

const on = (atMs: number, midi: number): MidiFileEvent => ({ kind: 'noteOn', atMs, midi, velocity: 0.7 });
const off = (atMs: number, midi: number): MidiFileEvent => ({ kind: 'noteOff', atMs, midi });
const damper = (atMs: number, value: number): MidiFileEvent => ({ kind: 'sustain', atMs, value });

describe('a take on the keys', () => {
  it('pairs each key going down with its coming up, in the order they went down', () => {
    // Given out of order, as nothing promises they are not.
    const take = theTakeOnTheKeys([off(500, 60), on(0, 60), on(200, 64), off(900, 64), on(200, 67), off(400, 67)], 1000);

    expect(take.presses).toEqual([
      { midi: 60, fromMs: 0, untilMs: 500 },
      { midi: 64, fromMs: 200, untilMs: 900 },
      { midi: 67, fromMs: 200, untilMs: 400 },
    ]);
  });

  it('ends a press where the same key goes down again, and holds one cut off by the end until the end', () => {
    const take = theTakeOnTheKeys([on(0, 60), on(300, 60), off(450, 60), on(600, 62), off(700, 99)], 1200);

    expect(take.presses).toEqual([
      { midi: 60, fromMs: 0, untilMs: 300 },
      { midi: 60, fromMs: 300, untilMs: 450 },
      { midi: 62, fromMs: 600, untilMs: 1200 },
    ]);
  });

  it('keeps the pedal down while the damper is, out of a stream of readings', () => {
    // A keyboard reports the damper several times a press, and halfway too.
    const take = theTakeOnTheKeys(
      [damper(100, 0.2), damper(150, 0.9), damper(160, 1), damper(400, 0.6), damper(500, 0.1), damper(800, 1)],
      1000,
    );

    expect(take.pedal).toEqual([
      { fromMs: 150, untilMs: 500 },
      { fromMs: 800, untilMs: 1000 },
    ]);
  });

  it('answers what is down at a moment, and what is down at some time between two', () => {
    const take = theTakeOnTheKeys([on(0, 60), off(500, 60), on(500, 62), off(900, 62), damper(100, 1), damper(300, 0)], 1000);

    expect(theTakesKeysAt(take, 0)).toEqual([60]);
    // Let go of at the moment the next goes down: one key, not two.
    expect(theTakesKeysAt(take, 500)).toEqual([62]);
    expect(theTakesKeysAt(take, 950)).toEqual([]);
    expect(theTakesPedalAt(take, 100)).toBe(true);
    expect(theTakesPedalAt(take, 300)).toBe(false);

    expect(theTakesPressesBetween(take, 500, 600).map((press) => press.midi)).toEqual([62]);
    expect(theTakesPressesBetween(take, 499, 600).map((press) => press.midi)).toEqual([60, 62]);
    expect(theTakesPressesBetween(take, 900, 1000)).toEqual([]);
    expect(theTakesPedalBetween(take, 300, 1000)).toEqual([]);
    expect(theTakesPedalBetween(take, 0, 101)).toEqual([{ fromMs: 100, untilMs: 300 }]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { PrintedOnce } from '../../src/domain/notation/printedOnce.js';
import { twoBarExercise } from '../support/fixtures.js';

describe('an exercise printed once', () => {
  function counted(): { printer: PrintedOnce; calls: () => number } {
    const inner = new MusicXmlSerializer();
    const serialize = vi.spyOn(inner, 'serialize');
    return { printer: new PrintedOnce(inner), calls: () => serialize.mock.calls.length };
  }

  it('gives back what it already printed, when the same exercise is asked for the same way', () => {
    const { printer, calls } = counted();
    const exercise = twoBarExercise();

    const first = printer.serialize(exercise);
    const again = printer.serialize(exercise);

    expect(again).toBe(first);
    expect(calls()).toBe(1);
    expect(first).toBe(new MusicXmlSerializer().serialize(exercise));
  });

  it('prints it again for another way of printing it, and remembers both', () => {
    const { printer, calls } = counted();
    const exercise = twoBarExercise();

    const plain = printer.serialize(exercise);
    const even = printer.serialize(exercise, { evenBars: true });
    printer.serialize(exercise);
    printer.serialize(exercise, { evenBars: true });

    expect(even).not.toBe(plain);
    expect(even).toBe(new MusicXmlSerializer().serialize(exercise, { evenBars: true }));
    expect(calls()).toBe(2);
  });

  it('prints another exercise afresh, even one with the same notes', () => {
    // Nothing is compared: an exercise is the object, and two alike are two.
    const { printer, calls } = counted();

    printer.serialize(twoBarExercise({ title: 'One' }));
    printer.serialize(twoBarExercise({ title: 'Two' }));
    printer.serialize(twoBarExercise({ title: 'One' }));

    expect(calls()).toBe(3);
  });
});

import { describe, expect, it } from 'vitest';
import { FreePlayed } from '../../src/application/freePlay.js';
import type { MidiEvent } from '../../src/application/ports/IMidiSource.js';

const on = (midi: number): MidiEvent => ({ type: 'noteon', midi, velocity: 0.8, timestampMs: 0, sourceId: 'k' });
const off = (midi: number): MidiEvent => ({ type: 'noteoff', midi, timestampMs: 0, sourceId: 'k' });
const pedal = (down: boolean): MidiEvent => ({
  type: 'pedal',
  pedal: 'sustain',
  down,
  value: down ? 1 : 0,
  timestampMs: 0,
  sourceId: 'k',
});

describe('what is played in free play', () => {
  it('keeps each press from when it went down to when it came up, at the moments it was heard', () => {
    const played = new FreePlayed();
    // The event's own timestamp is another clock's; the moment heard is ours.
    played.hear({ ...on(60), timestampMs: 99_999 } as MidiEvent, 1000);
    played.hear(on(64), 1100);
    played.hear(off(60), 1500);

    expect(played.keysDown).toEqual([64]);
    // A key still down lasts until the moment it is asked about.
    expect(played.pressesBetween(0, 3000, 2000)).toEqual([
      { midi: 60, fromMs: 1000, untilMs: 1500 },
      { midi: 64, fromMs: 1100, untilMs: 2000 },
    ]);
  });

  it('takes a key pressed again while down as the press it already is, and ignores a release never pressed', () => {
    const played = new FreePlayed();
    expect(played.hear(on(60), 1000)).toBe(true);
    expect(played.hear(on(60), 1010)).toBe(false);
    expect(played.hear(off(62), 1020)).toBe(false);
    expect(played.hear(off(60), 1200)).toBe(true);
    expect(played.hear(off(60), 1300)).toBe(false);

    expect(played.pressesBetween(0, 3000, 3000)).toEqual([{ midi: 60, fromMs: 1000, untilMs: 1200 }]);
  });

  it('answers only for the presses down at some time between two moments', () => {
    const played = new FreePlayed();
    played.hear(on(60), 1000);
    played.hear(off(60), 1200);
    played.hear(on(62), 2000);
    played.hear(off(62), 2200);

    expect(played.pressesBetween(1200, 2000, 5000)).toEqual([]);
    expect(played.pressesBetween(1199, 2001, 5000).map((press) => press.midi)).toEqual([60, 62]);
  });

  it('keeps the pedal the same way, a press still down lasting until it is asked about', () => {
    const played = new FreePlayed();
    played.hear(pedal(true), 1000);
    expect(played.hear(pedal(true), 1050)).toBe(false);
    played.hear(pedal(false), 1400);
    played.hear(pedal(true), 1500);

    expect(played.pedalDown).toBe(true);
    expect(played.pedalBetween(0, 3000, 2000)).toEqual([
      { fromMs: 1000, untilMs: 1400 },
      { fromMs: 1500, untilMs: 2000 },
    ]);
    expect(played.pedalBetween(1400, 1500, 2000)).toEqual([]);
  });

  it('lets go of what ended before a moment, and never of what is still down', () => {
    const played = new FreePlayed();
    played.hear(on(60), 1000);
    played.hear(off(60), 1200);
    played.hear(on(62), 1100);
    played.hear(pedal(true), 1000);
    played.hear(pedal(false), 1200);

    played.forgetBefore(1201);

    expect(played.pressesBetween(0, 9000, 9000)).toEqual([{ midi: 62, fromMs: 1100, untilMs: 9000 }]);
    expect(played.pedalBetween(0, 9000, 9000)).toEqual([]);
    // Ended exactly at the moment is still kept.
    played.hear(off(62), 1300);
    played.forgetBefore(1300);
    expect(played.pressesBetween(0, 9000, 9000)).toHaveLength(1);
  });

  it('says whether anything is down or ended since a moment, and forgets everything when asked', () => {
    const played = new FreePlayed();
    expect(played.anythingSince(0)).toBe(false);
    played.hear(on(60), 1000);
    expect(played.anythingSince(5000)).toBe(true);
    played.hear(off(60), 1200);
    expect(played.anythingSince(1200)).toBe(true);
    expect(played.anythingSince(1201)).toBe(false);
    played.hear(pedal(true), 2000);
    expect(played.anythingSince(9000)).toBe(true);

    played.forget();
    expect(played.anythingSince(0)).toBe(false);
    expect(played.keysDown).toEqual([]);
    expect(played.pedalDown).toBe(false);
  });
});

import { damperIsDown, type MidiFileEvent } from '../domain/midi/MidiFile.js';
import type { KeyDown, PedalDown } from './ExercisePlayer.js';

/**
 * A take as the keys show it: each key from when it went down to when it came
 * up, and each press of the pedal, in the take's own time.
 */
export interface TakeOnTheKeys {
  readonly presses: readonly KeyDown[];
  readonly pedal: readonly PedalDown[];
}

/**
 * The presses and the pedal of a take, read off its events.
 *
 * Each key down is paired with the key's next release. A key pressed again
 * before it came up is a new press and the old one ends there; one never let
 * go of in the take - cut off by its end - lasts until `durationMs`. The pedal
 * is down while its readings say the damper is, which is the same line the
 * player hears it by: a keyboard sends a stream of readings, and only the
 * crossings move anything.
 */
export function theTakeOnTheKeys(events: readonly MidiFileEvent[], durationMs: number): TakeOnTheKeys {
  const presses: KeyDown[] = [];
  const pedal: PedalDown[] = [];
  const held = new Map<number, number>();
  let pedalFromMs: number | null = null;
  const inOrder = [...events].sort((left, right) => left.atMs - right.atMs);
  for (const event of inOrder) {
    switch (event.kind) {
      case 'noteOn': {
        const from = held.get(event.midi);
        if (from !== undefined) {
          presses.push({ midi: event.midi, fromMs: from, untilMs: event.atMs });
        }
        held.set(event.midi, event.atMs);
        break;
      }
      case 'noteOff': {
        const from = held.get(event.midi);
        if (from !== undefined) {
          presses.push({ midi: event.midi, fromMs: from, untilMs: event.atMs });
          held.delete(event.midi);
        }
        break;
      }
      case 'sustain': {
        const down = damperIsDown(event.value);
        if (down && pedalFromMs === null) {
          pedalFromMs = event.atMs;
        } else if (!down && pedalFromMs !== null) {
          pedal.push({ fromMs: pedalFromMs, untilMs: event.atMs });
          pedalFromMs = null;
        }
        break;
      }
    }
  }
  for (const [midi, fromMs] of held) {
    presses.push({ midi, fromMs, untilMs: durationMs });
  }
  if (pedalFromMs !== null) {
    pedal.push({ fromMs: pedalFromMs, untilMs: durationMs });
  }
  return {
    presses: presses.sort((left, right) => left.fromMs - right.fromMs || left.midi - right.midi),
    pedal,
  };
}

/** The keys down a moment into the take. */
export function theTakesKeysAt(take: TakeOnTheKeys, atMs: number): readonly number[] {
  return take.presses.filter((press) => press.fromMs <= atMs && atMs < press.untilMs).map((press) => press.midi);
}

/** Whether the pedal is down a moment into the take. */
export function theTakesPedalAt(take: TakeOnTheKeys, atMs: number): boolean {
  return take.pedal.some((press) => press.fromMs <= atMs && atMs < press.untilMs);
}

/** The presses of the take down at any time between two moments of it. */
export function theTakesPressesBetween(take: TakeOnTheKeys, fromMs: number, untilMs: number): readonly KeyDown[] {
  return take.presses.filter((press) => press.untilMs > fromMs && press.fromMs < untilMs);
}

/** The pedal of the take down at any time between two moments of it. */
export function theTakesPedalBetween(take: TakeOnTheKeys, fromMs: number, untilMs: number): readonly PedalDown[] {
  return take.pedal.filter((press) => press.untilMs > fromMs && press.fromMs < untilMs);
}

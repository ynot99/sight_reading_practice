import type { IPitchPlayer } from '../../application/ports/IPitchPlayer.js';

export interface RecordedNote {
  readonly midi: number;
  readonly velocity: number;
  readonly atMs: number | undefined;
}

/**
 * A silent instrument that remembers what it was asked to sound and when.
 *
 * Playback is worth testing for its *timing*, which is the part that can be
 * wrong, so the double records the scheduled moment rather than only the note.
 */
export class RecordingPitchPlayer implements IPitchPlayer {
  readonly played: RecordedNote[] = [];
  readonly stopped: RecordedNote[] = [];
  stopAllCount = 0;
  /** The moments notes were taken back from, in the order asked. */
  readonly takenBackFrom: number[] = [];
  private readonly takenBack = new Set<RecordedNote>();

  play(midi: number, velocity: number, atMs?: number): void {
    this.played.push({ midi, velocity, atMs });
  }

  stop(midi: number, atMs?: number): void {
    this.stopped.push({ midi, velocity: 0, atMs });
  }

  stopAll(): void {
    this.stopAllCount += 1;
  }

  takeBackFrom(atMs: number): void {
    this.takenBackFrom.push(atMs);
    for (const note of this.played) {
      if (note.atMs !== undefined && note.atMs > atMs) {
        this.takenBack.add(note);
      }
    }
  }

  /** What was handed over and not taken back before it began: what was heard. */
  get heard(): readonly RecordedNote[] {
    return this.played.filter((note) => !this.takenBack.has(note));
  }
}

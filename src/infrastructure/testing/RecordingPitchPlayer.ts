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

  play(midi: number, velocity: number, atMs?: number): void {
    this.played.push({ midi, velocity, atMs });
  }

  stop(midi: number, atMs?: number): void {
    this.stopped.push({ midi, velocity: 0, atMs });
  }

  stopAll(): void {
    this.stopAllCount += 1;
  }
}

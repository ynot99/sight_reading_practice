import type { IPitchPlayer } from '../../application/ports/IPitchPlayer.js';

/** A silent drum that remembers how hard, and for when, each hit was struck. */
export class RecordingHitSound implements IPitchPlayer {
  readonly hits: number[] = [];
  /** The moment each hit was handed over for, `undefined` for now. */
  readonly heardAt: (number | undefined)[] = [];
  stopAllCount = 0;

  play(_midi: number, velocity: number, atMs?: number): void {
    this.hits.push(velocity);
    this.heardAt.push(atMs);
  }

  stop(): void {
    // A hit has no length to cut.
  }

  stopAll(): void {
    this.stopAllCount += 1;
  }

  takeBackFrom(): void {
    // Nothing kept to take back.
  }
}

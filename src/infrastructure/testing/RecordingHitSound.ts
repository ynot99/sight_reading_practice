import type { IHitSound } from '../../application/ports/IHitSound.js';

/** A silent hit that remembers how hard each one was struck. */
export class RecordingHitSound implements IHitSound {
  readonly hits: number[] = [];

  hit(velocity: number): void {
    this.hits.push(velocity);
  }
}

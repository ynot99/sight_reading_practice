/**
 * The sound of a key struck where only the moment of it is judged.
 *
 * In rhythm only, which key is pressed is nobody's question: the run takes
 * any key for the note written. Sounding the key as itself then plays a
 * melody nobody wrote - on a computer's keyboard, whichever letters were
 * nearest - so the press is heard as a drum is: a hit, the same each time,
 * and as loud as it was struck.
 */
export interface IHitSound {
  /** Sounds one hit now, `velocity` from 0 to 1 as a key's is. */
  hit(velocity: number): void;
}

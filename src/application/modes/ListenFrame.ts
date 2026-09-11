/**
 * The frame in which the machine plays and the reader listens.
 *
 * Deliberately *not* an `IPracticeMode`. A practice mode says how a run
 * advances and how input is judged; here there is no run and nothing is
 * judged - the performance that has always existed does the playing, and the
 * reader watches it. Giving it a class with six empty hooks would put a thing
 * in the registry that no session may ever be handed, which is a trap rather
 * than a design.
 *
 * It is the same setting as the other two because it answers the same
 * question - what kind of run this is - and a reader asks that once. What
 * changes with the answer is which of two things the Start button reaches
 * for, and that is the controller's single place to decide.
 */
export const LISTEN_MODE_ID = 'mode.listen';

/**
 * Every frame id a stored setting may name.
 *
 * The registry holds the practice modes and this one is not among them, so
 * anything validating a restored setting against the registry alone would
 * throw the listening frame away on the way back in. Said once, because the
 * composition root and the test rig both have to say it and two lists drift.
 */
export function knownFrameIds(modeIds: readonly string[]): readonly string[] {
  return [...modeIds, LISTEN_MODE_ID];
}

/** Whether the chosen frame is the one nobody plays. */
export function machineIsPlaying(modeId: string): boolean {
  return modeId === LISTEN_MODE_ID;
}

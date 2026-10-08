/**
 * The frame in which the reader plays whatever they like, and nothing is
 * asked of them.
 *
 * Like listening, deliberately *not* an `IPracticeMode`: there is no run, no
 * music to keep to and nothing judged, so no session may ever be handed it.
 * It is a frame because it answers the same question the others do - what
 * the keys are for just now - and a press heard in it is not the opening of
 * a run, which is what a press between runs otherwise is.
 */
export const FREE_PLAY_MODE_ID = 'mode.free';

/** Whether the chosen frame is the one where the reader plays freely. */
export function playsFreely(modeId: string): boolean {
  return modeId === FREE_PLAY_MODE_ID;
}

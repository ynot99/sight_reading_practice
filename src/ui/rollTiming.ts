/*
 * Times and names the drawing of a run and what plays it share: the view,
 * its playback and a recording into a sketch.
 */

/** How often the take slider is moved while something is sounding. */
export const TAKE_TICK_MS = 80;

/**
 * How near a slice's end a moment is to be on it: the beats and bar lines it
 * is laid on are whole milliseconds, worked out from crotchets.
 */
export const SLICE_EDGE_MS = 1;

export const MILLISECONDS_A_MINUTE = 60_000;

/**
 * What the player is asked to call the run it is sounding.
 *
 * A roll is not a take and has no id of its own, but the player is addressed by
 * one - and this is also what lets everything else tell whether the thing
 * sounding is the drawing's or the shelf's.
 */
export const RUN_ROLL_ID = 'the run just played';

/**
 * How far ahead of the sound the clicks over a playback are laid out.
 *
 * Long enough that a click is placed rather than raced for, short enough that
 * stopping does not leave one sounding after the picture has gone quiet.
 */
export const ROLL_CLICK_LEAD_MS = 100;

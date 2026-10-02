/**
 * How long a finger stays put before it is pointing rather than touching.
 *
 * Long enough not to fire under a reader who is turning a page or reaching
 * for a marker, short enough that holding still feels like an instruction
 * rather than a wait. One length for every hold there is - a bar held to
 * begin there, the metronome's button held for the other of its two answers -
 * so a hand learns it once.
 */
export const HOLD_MS = 450;

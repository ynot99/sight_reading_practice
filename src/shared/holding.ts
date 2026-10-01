/**
 * How long a finger stays put before it is pointing rather than touching.
 *
 * Long enough not to fire under a reader who is turning a page or reaching
 * for a marker, short enough that holding still feels like an instruction
 * rather than a wait. One length for every hold the page answers - a bar held
 * to begin there, a button held for what stands behind it - so a hand learns
 * it once.
 */
export const HOLD_MS = 450;

/**
 * Times what happens between asking for music and hearing it.
 *
 * One line in the console for each stage, the first time that stage is reached
 * after a run, a playback or a resume was asked for: the time since, and the
 * gap since the stage before. The big gap is the answer.
 *
 * It is what found the four seconds a long score spent gathering its notes
 * with the pulse already running - measured on his own device in one pass,
 * after three guesses from a headless probe had each been wrong. Kept for the
 * next long score, behind a switch in the settings, so that nobody hears from
 * it who did not ask. His: "може їх лишити при опції з settings у розділі for
 * developers".
 *
 * A switch held here rather than a setting passed down to every caller,
 * because the callers are the controller, the player, the pulse and both
 * instruments: threading a flag through each of them to decide whether to
 * print a line would be more code than the thing it switches. The page sets it
 * from the setting and that is the only writer.
 */

/** The stages that start the clock again. */
const RESETS = new Set([
  'run asked for',
  'resume asked for',
  'playback asked for',
  'playback resume asked for',
]);

let tracing = false;
let began: number | null = null;
let last = 0;
const seen = new Set<string>();

/**
 * Turns the lines on or off. Called by the page, from the setting.
 *
 * Nothing at all unless the answer changes. The page reports every setting
 * whenever any of them moves - which happens in the middle of starting - and a
 * clock put back to nought there would divide one start into two halves that
 * each looked quick.
 */
export function traceTheStart(on: boolean): void {
  if (on === tracing) {
    return;
  }
  tracing = on;
  began = null;
  seen.clear();
  if (on) {
    // eslint-disable-next-line no-console -- printing is the whole of it.
    console.log('[timing] on - start a run or a playback and the stages will follow');
  }
}

export function timeTheStart(label: string): void {
  if (!tracing) {
    return;
  }
  const now = performance.now();
  if (RESETS.has(label)) {
    began = now;
    last = now;
    seen.clear();
  }
  // Never silent. The first stage seen starts the clock if nothing else has:
  // it once stayed quiet through a whole playback because the way in was not
  // the one expected, which is exactly the case an instrument exists for.
  if (began === null) {
    began = now;
    last = now;
  }
  if (seen.has(label)) {
    return;
  }
  seen.add(label);
  // eslint-disable-next-line no-console -- printing is the whole of it.
  console.log(
    `[timing] +${String(Math.round(now - began)).padStart(6)} ms   gap ${String(Math.round(now - last)).padStart(6)} ms   ${label}`,
  );
  last = now;
}

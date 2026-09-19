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
  // Opening a score as well: the stage his Alkan never gets past on the
  // iPad is the engraving, and a start is never reached to be timed.
  'score asked for',
]);

let tracing = false;
let began: number | null = null;
let last = 0;
const seen = new Set<string>();
/** The lines printed since the clock last started, for {@link keepTheTrail}. */
const trail: string[] = [];
let keeper: ((lines: readonly string[]) => void) | null = null;

/**
 * Hands every line to somewhere that outlives the page, as it is printed.
 *
 * The console goes with the page, and the page whose timings most need
 * reading is the one the browser closed in the middle of them. `null` stops.
 */
export function keepTheTrail(keep: ((lines: readonly string[]) => void) | null): void {
  keeper = keep;
}

/**
 * How much the page is holding, where the browser will say.
 *
 * Chrome does and Safari does not, so on the iPad the lines carry times
 * alone - but measured on the desk, the stage where the memory climbs is the
 * stage the iPad is most likely to be closed in.
 */
function held(): string {
  const bytes = (performance as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize;
  return bytes === undefined ? '' : `   heap ${String(Math.round(bytes / 1e6))} MB`;
}

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
  trail.length = 0;
  if (on) {
    // eslint-disable-next-line no-console -- printing is the whole of it.
    console.log('[timing] on - start a run or a playback and the stages will follow');
  }
}

/**
 * Marks a stage. `detail` is printed with it and is not part of what makes it
 * a stage: the first note dropped as too late is one stage however late it
 * was, and saying how late is the whole point of the line. Worked out only
 * when the line is printed, because some stages are marked on every tick.
 */
export function timeTheStart(label: string, detail?: () => string): void {
  if (!tracing) {
    return;
  }
  const now = performance.now();
  if (RESETS.has(label)) {
    began = now;
    last = now;
    seen.clear();
    trail.length = 0;
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
  const line = `[timing] +${String(Math.round(now - began)).padStart(6)} ms   gap ${String(Math.round(now - last)).padStart(6)} ms   ${label}${detail === undefined ? '' : ` (${detail()})`}${held()}`;
  // eslint-disable-next-line no-console -- printing is the whole of it.
  console.log(line);
  trail.push(line);
  keeper?.(trail);
  last = now;
}

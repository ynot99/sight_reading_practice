import { aMarkOf, placeOnTheStrip, theHitErrors, type HitErrors, type HitMark } from '../domain/scoring/theHitErrors.js';
import { thePerfectWindowOf } from '../domain/scoring/PerformanceReport.js';
import type { NoteTier } from '../domain/scoring/noteTiers.js';

function element(tag: string, className: string): HTMLElement {
  const made = document.createElement(tag);
  made.className = className;
  return made;
}

function saidOf(errors: HitErrors): string {
  // How many landed in the window, where the run said: the number the green
  // span is there to make visible.
  if (errors.tally !== null) {
    return `${errors.tally.perfect} perfect · ${errors.tally.good} good`;
  }
  if (errors.early === 0 && errors.late === 0) {
    return 'every press on the beat';
  }
  return `${errors.early} early · ${errors.late} late`;
}

/** One press's mark on the strip, in the colour its note is drawn on the page. */
function aTickFor(mark: HitMark): HTMLElement {
  const tick = element('span', 'hit-bar__tick');
  tick.dataset['beyond'] = String(mark.beyond);
  if (mark.tier !== undefined) {
    tick.dataset['tier'] = mark.tier;
  }
  tick.style.left = `${(mark.of * 100).toFixed(3)}%`;
  tick.title = `${Math.round(mark.deviationMs)} ms`;
  return tick;
}

/**
 * A run's presses, drawn across the window they were judged in.
 *
 * Marks rather than a curve, and translucent ones: where several presses landed
 * together their marks stack and that part of the line goes dark, which is the
 * whole of how a clump shows itself. A histogram would say the same thing in
 * bins, and bins are a decision about how wide a bin is - at four presses the
 * bins are the picture and the reading is not in it.
 *
 * The average is a line of its own rather than a number, because the thing
 * worth seeing is where it stands *against the scatter*: a mean well to the
 * late side of a tight clump is a reader who could fix their timing with one
 * thought, and the same mean in the middle of a spray is a reader who could not.
 */
export function drawTheHitErrors(errors: HitErrors): HTMLElement {
  const figure = element('div', 'hit-bar');
  const strip = element('div', 'hit-bar__strip');
  if (errors.perfect !== null) {
    // Behind the marks, so the ones that landed in it are seen standing in it.
    const perfect = element('span', 'hit-bar__perfect');
    perfect.style.left = `${(errors.perfect.from * 100).toFixed(3)}%`;
    perfect.style.width = `${((errors.perfect.to - errors.perfect.from) * 100).toFixed(3)}%`;
    strip.append(perfect);
  }
  strip.append(element('span', 'hit-bar__beat'));
  for (const mark of errors.marks) {
    strip.append(aTickFor(mark));
  }
  const mean = element('span', 'hit-bar__mean');
  mean.style.left = `${(errors.meanOf * 100).toFixed(3)}%`;
  strip.append(mean);

  const ends = element('div', 'hit-bar__ends');
  const early = element('span', 'hit-bar__end');
  early.textContent = `${Math.round(errors.toleranceMs)} ms early`;
  const said = element('strong', 'hit-bar__said');
  said.textContent = saidOf(errors);
  const late = element('span', 'hit-bar__end');
  late.textContent = `${Math.round(errors.toleranceMs)} ms late`;
  ends.append(early, said, late);

  figure.append(strip, ends);
  return figure;
}

/** One tap as it landed, for the strip drawn as a run goes. */
export interface LandedTap {
  readonly deviationMs: number;
  readonly tier: NoteTier;
  readonly windowMs: number | undefined;
}

export interface LiveHitStripOptions {
  /** How long a mark stays before it is gone, fading over the end of it. */
  readonly fadeMs: number;
  readonly later: (run: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly cancel: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * The strip of a run's presses, drawn as they land.
 *
 * As a rhythm game draws it: each mark stays a moment and fades by itself,
 * whatever comes after it - so the strip says how the last few seconds were
 * tapped, and a pause in the tapping empties it rather than leaving the old
 * marks standing until new ones push them out. The mean, and the Perfect
 * window of a typical tap behind them, are of the marks still there; the mean
 * only once there are enough of them to make a shape, by the same rule the
 * strip after the run keeps.
 *
 * Built once and added to, not drawn again: a mark drawn again would begin
 * its fading again.
 */
export class LiveHitStrip {
  private readonly host: HTMLElement;
  private readonly options: LiveHitStripOptions;
  private readonly standing: { readonly tap: LandedTap; readonly tick: HTMLElement; readonly fading: ReturnType<typeof setTimeout> }[] = [];
  private strip: HTMLElement | null = null;
  private perfect: HTMLElement | null = null;
  private mean: HTMLElement | null = null;
  private toleranceMs = 0;

  constructor(host: HTMLElement, options: LiveHitStripOptions) {
    this.host = host;
    this.options = options;
    // The fading's length said once, to the stylesheet that draws it.
    host.style.setProperty('--live-tick-ms', `${String(options.fadeMs)}ms`);
  }

  /** How many marks are standing on the strip. */
  get marks(): number {
    return this.standing.length;
  }

  /** Puts a tap on the strip, in a window as wide as the tolerance. */
  land(tap: LandedTap, toleranceMs: number): void {
    // A window with no width has nowhere to place a tap: see `theHitErrors`.
    if (!Number.isFinite(toleranceMs) || toleranceMs <= 0) {
      return;
    }
    const strip = this.theStrip();
    this.toleranceMs = toleranceMs;
    const tick = aTickFor(aMarkOf(tap.deviationMs, toleranceMs, tap.tier));
    // Under the mean, which reads over the marks however many have stacked up.
    strip.insertBefore(tick, this.mean);
    const standing = {
      tap,
      tick,
      fading: this.options.later(() => {
        this.goes(standing);
      }, this.options.fadeMs),
    };
    this.standing.push(standing);
    this.host.hidden = false;
    this.saysWhereTheyStand();
  }

  /** Takes the strip away, with every mark on it. */
  clear(): void {
    for (const standing of this.standing) {
      this.options.cancel(standing.fading);
    }
    this.standing.length = 0;
    this.strip = null;
    this.perfect = null;
    this.mean = null;
    this.host.replaceChildren();
    this.host.hidden = true;
  }

  /** Takes a mark away when its time is up; cleared first, its timer was cancelled. */
  private goes(standing: (typeof this.standing)[number]): void {
    this.standing.splice(this.standing.indexOf(standing), 1);
    standing.tick.remove();
    this.saysWhereTheyStand();
  }

  /** The mean and the Perfect window, of the marks still standing. */
  private saysWhereTheyStand(): void {
    const taps = this.standing.map((standing) => standing.tap);
    const perfectMs = thePerfectWindowOf(taps.flatMap((tap) => (tap.windowMs === undefined ? [] : [tap.windowMs])));
    const errors = theHitErrors(
      taps.map((tap) => tap.deviationMs),
      this.toleranceMs,
      { tiers: taps.map((tap) => tap.tier), perfectMs },
    );
    if (this.perfect !== null) {
      this.perfect.hidden = perfectMs === null;
      if (perfectMs !== null) {
        const from = placeOnTheStrip(-perfectMs, this.toleranceMs);
        this.perfect.style.left = `${(from * 100).toFixed(3)}%`;
        this.perfect.style.width = `${((placeOnTheStrip(perfectMs, this.toleranceMs) - from) * 100).toFixed(3)}%`;
      }
    }
    if (this.mean !== null) {
      this.mean.hidden = errors === null;
      if (errors !== null) {
        this.mean.style.left = `${(errors.meanOf * 100).toFixed(3)}%`;
      }
    }
  }

  private theStrip(): HTMLElement {
    if (this.strip !== null) {
      return this.strip;
    }
    const figure = element('div', 'hit-bar');
    const strip = element('div', 'hit-bar__strip');
    const perfect = element('span', 'hit-bar__perfect');
    perfect.hidden = true;
    const mean = element('span', 'hit-bar__mean');
    mean.hidden = true;
    strip.append(perfect, element('span', 'hit-bar__beat'), mean);
    figure.append(strip);
    this.host.replaceChildren(figure);
    this.strip = strip;
    this.perfect = perfect;
    this.mean = mean;
    return strip;
  }
}

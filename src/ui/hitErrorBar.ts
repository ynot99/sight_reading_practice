import type { HitErrors } from '../domain/scoring/theHitErrors.js';

function element(tag: string, className: string): HTMLElement {
  const made = document.createElement(tag);
  made.className = className;
  return made;
}

function saidOf(errors: HitErrors): string {
  if (errors.early === 0 && errors.late === 0) {
    return 'every press on the beat';
  }
  return `${errors.early} early · ${errors.late} late`;
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
  strip.append(element('span', 'hit-bar__beat'));
  for (const mark of errors.marks) {
    const tick = element('span', 'hit-bar__tick');
    tick.dataset['beyond'] = String(mark.beyond);
    tick.style.left = `${(mark.of * 100).toFixed(3)}%`;
    tick.title = `${Math.round(mark.deviationMs)} ms`;
    strip.append(tick);
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

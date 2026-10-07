import type { RungMark } from '../application/ports/IScoreRenderer.js';

/** Where a reader stands between two rungs, and what the track is to show. */
export interface PlaceOnTheLadder {
  /** The rung being read. */
  readonly here: string;
  /** The rung a fall would land on, or `null` at the bottom of the ladder. */
  readonly below: string | null;
  /** The rung a climb would land on, or `null` at the top. */
  readonly above: string | null;
  /** Clean readings in a row, or minus the ones that came apart, or 0. */
  readonly streak: number;
  /** How many in a row move the reader. */
  readonly toMove: number;
}

function element(doc: Document, tag: string, className: string): HTMLElement {
  const made = doc.createElement(tag);
  made.className = className;
  return made;
}

function readings(count: number, kind: string): string {
  return `${String(count)} ${kind} reading${count === 1 ? '' : 's'}`;
}

/** The track in words, for anyone who cannot see it and as its title. */
export function saidOfThePlace(place: PlaceOnTheLadder): string {
  const { here, below, above, streak, toMove } = place;
  if (streak > 0 && above !== null) {
    return `${here}: ${readings(streak, 'clean')} of ${String(toMove)} towards ${above}`;
  }
  if (streak < 0 && below !== null) {
    return `${here}: ${readings(-streak, 'poor')} of ${String(toMove)} towards ${below}`;
  }
  return `${here}: no readings in a row yet`;
}

/**
 * One mark for each place the run can stand, the middle one where it starts.
 *
 * The one answer to what the marks are, for the track drawn here and the one
 * the page prints after its title.
 */
export function marksOfThePlace(place: PlaceOnTheLadder): RungMark[] {
  const reach = Math.max(1, place.toMove);
  const at = Math.max(-reach, Math.min(reach, place.streak));
  const marks: RungMark[] = [];
  for (let position = -reach; position <= reach; position += 1) {
    const rung = Math.abs(position) === reach;
    marks.push({
      rung,
      none: rung && (position < 0 ? place.below : place.above) === null,
      here: position === at,
    });
  }
  return marks;
}

/**
 * The readings in a row, as a line of marks between two rungs.
 *
 * Marks and not a bar that fills, because what is counted is a short run of
 * readings and not anything that accumulates: the run turns round, or starts
 * again, on a single reading, and a bar sliding back from two-thirds would
 * say something about the reader that is not true. One mark for each place
 * the run can stand, the middle one where it starts; the two at the ends are
 * rings, since reaching one is arriving at the next rung, where the run
 * starts again in the middle. The mark the reader is on is filled.
 *
 * With `ends`, the two neighbouring rungs are named at the two ends. Where
 * there is no rung that way - the bottom or the top of the ladder - that end
 * is left empty and faint, since nothing a reading does can go there.
 */
export function drawTheLadderTrack(
  doc: Document,
  place: PlaceOnTheLadder,
  options: { readonly ends: boolean } = { ends: false },
): HTMLElement {
  const track = element(doc, 'div', 'ladder-track');
  track.setAttribute('role', 'img');
  const said = saidOfThePlace(place);
  track.setAttribute('aria-label', said);
  track.title = said;

  const end = (name: string | null, side: string): HTMLElement => {
    const label = element(doc, 'span', `ladder-track__end ladder-track__end--${side}`);
    label.textContent = name ?? '';
    return label;
  };

  const marks = element(doc, 'span', 'ladder-track__marks');
  for (const { rung, none, here } of marksOfThePlace(place)) {
    const mark = element(doc, 'span', 'ladder-track__mark');
    mark.classList.toggle('ladder-track__mark--rung', rung);
    mark.classList.toggle('ladder-track__mark--none', none);
    mark.classList.toggle('ladder-track__mark--here', here);
    marks.append(mark);
  }

  if (options.ends) {
    track.append(end(place.below, 'below'), marks, end(place.above, 'above'));
  } else {
    track.append(marks);
  }
  return track;
}

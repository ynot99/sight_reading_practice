import { theChordInTheKey, theNotesOfTheChordNamed, type HarmonicFunction } from '../domain/harmony/harmonicFunction.js';
import { theNameOfTheKey } from '../domain/harmony/scales.js';
import type { SceneBar, SceneChord } from './rollView.js';

/**
 * The chords of a sketch as a chart: bar by bar, four to a row, each chord
 * with its degree, its notes and what it does in its key - the whole of
 * the music's harmony at once, to plan what comes next by, where the lane
 * under the notes shows only the stretch on the screen. Read off the lane's
 * own chords, so the two never disagree.
 */

/** A chord in a bar of the chart. */
export interface ChartChord {
  readonly fromMs: number;
  readonly untilMs: number;
  readonly name: string;
  readonly numeral: string;
  /** Its notes from its root up, as its key spells them. */
  readonly notes: string;
  readonly function: HarmonicFunction | null;
  readonly ofTheKey: boolean;
  /** The key it is read in, where it is another than the chord before's - or it is the first. */
  readonly keyBegins: string | null;
  /** How much of its bar it takes, as a share of the chords there. */
  readonly share: number;
}

/**
 * A bar of the chart: its printed name, where it begins, its chords, and the
 * chord it begins in the middle of, if any, with how much of the bar it
 * takes.
 */
export interface ChartBar {
  readonly name: string;
  readonly fromMs: number;
  readonly chords: readonly ChartChord[];
  readonly goesOn: { readonly name: string; readonly share: number } | null;
}

/**
 * The chart of the chords along the bars of a drawing: each chord in the
 * bar it begins in, taking as much of the bar as it lasts in it; a bar a
 * chord goes on into from the one before says so, as much of it as it
 * takes. Chords before the first bar line are the first bar's, and the
 * last bar is as long as its chords.
 */
export function theChartOfTheChords(bars: readonly SceneBar[], chords: readonly SceneChord[]): readonly ChartBar[] {
  return bars.map((bar, at) => {
    const untilMs = bars[at + 1]?.atMs ?? Number.POSITIVE_INFINITY;
    const inIt = chords.filter((chord) => (at === 0 || chord.fromMs >= bar.atMs) && chord.fromMs < untilMs);
    const beganMs = Math.min(bar.atMs, ...inIt.map((chord) => chord.fromMs));
    const goesOn = at === 0 ? undefined : chords.find((chord) => chord.fromMs < bar.atMs && chord.untilMs > bar.atMs);
    const lasts = (chord: SceneChord): number => Math.max(Math.min(chord.untilMs, untilMs) - Math.max(chord.fromMs, beganMs), 0);
    const endedMs = Number.isFinite(untilMs) ? untilMs : Math.max(beganMs, ...inIt.map((chord) => chord.untilMs));
    const all = endedMs - beganMs;
    const shareOf = (chord: SceneChord): number => (all > 0 ? lasts(chord) / all : 1);
    return {
      name: bar.name,
      fromMs: bar.atMs,
      goesOn: goesOn === undefined ? null : { name: goesOn.name, share: shareOf(goesOn) },
      chords: inIt.map((chord): ChartChord => {
        const before = chords[chords.indexOf(chord) - 1];
        const keyBegins =
          before === undefined || before.key.fifths !== chord.key.fifths || before.key.scale !== chord.key.scale
            ? theNameOfTheKey(chord.key)
            : null;
        const standing = theChordInTheKey(chord, chord.key);
        return {
          fromMs: chord.fromMs,
          untilMs: chord.untilMs,
          name: chord.name,
          numeral: chord.numeral,
          notes: theNotesOfTheChordNamed(chord, chord.key.fifths).join(' '),
          function: standing.function,
          ofTheKey: standing.ofTheKey,
          keyBegins,
          share: shareOf(chord),
        };
      }),
    };
  });
}

/** What a function is called on a chord, and its letter. */
const SAID: Readonly<Record<HarmonicFunction, { readonly letter: string; readonly called: string }>> = {
  tonic: { letter: 'T', called: 'tonic: rest' },
  subdominant: { letter: 'S', called: 'subdominant: moving away' },
  dominant: { letter: 'D', called: 'dominant: pulling home' },
};

/** Draws the chart into its place, a bar a cell, each chord a button that puts the cursor where it begins. */
export function drawTheChart(host: HTMLElement, chart: readonly ChartBar[]): void {
  const doc = host.ownerDocument;
  if (chart.every((bar) => bar.chords.length === 0)) {
    const none = doc.createElement('p');
    none.className = 'roll-chart__none';
    none.textContent = 'No chords yet: write some, or tap one on the circle.';
    host.replaceChildren(none);
    return;
  }
  const grid = doc.createElement('div');
  grid.className = 'roll-chart__grid';
  for (const bar of chart) {
    const cell = doc.createElement('div');
    cell.className = 'roll-chart__bar';
    const number = doc.createElement('span');
    number.className = 'roll-chart__number';
    number.textContent = bar.name;
    const chords = doc.createElement('div');
    chords.className = 'roll-chart__chords';
    if (bar.goesOn !== null) {
      const goesOn = doc.createElement('span');
      goesOn.className = 'roll-chart__goes-on';
      goesOn.textContent = '—';
      goesOn.title = `${bar.goesOn.name} goes on`;
      goesOn.style.flexGrow = String(bar.goesOn.share);
      chords.append(goesOn);
    }
    for (const chord of bar.chords) {
      chords.append(theChordOfTheChart(doc, chord));
    }
    cell.append(number, chords);
    grid.append(cell);
  }
  host.replaceChildren(grid);
}

/** A chord of the chart, as a button: its key where one begins, its name and degree, its notes, and what it does. */
function theChordOfTheChart(doc: Document, chord: ChartChord): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'roll-chart__chord';
  button.dataset['from'] = String(chord.fromMs);
  button.dataset['until'] = String(chord.untilMs);
  button.dataset['function'] = chord.function ?? 'none';
  button.dataset['ofTheKey'] = String(chord.ofTheKey);
  button.style.flexGrow = String(chord.share);
  const parts: HTMLElement[] = [];
  if (chord.keyBegins !== null) {
    const key = doc.createElement('span');
    key.className = 'roll-chart__key';
    key.textContent = chord.keyBegins;
    parts.push(key);
  }
  const name = doc.createElement('span');
  name.className = 'roll-chart__name';
  name.textContent = chord.name;
  const numeral = doc.createElement('span');
  numeral.className = 'roll-chart__numeral';
  numeral.textContent = chord.numeral;
  const notes = doc.createElement('span');
  notes.className = 'roll-chart__notes';
  notes.textContent = chord.notes;
  const does = doc.createElement('span');
  does.className = 'roll-chart__function';
  does.textContent = chord.function === null ? '' : SAID[chord.function].letter;
  parts.push(name, numeral, notes, does);
  button.append(...parts);
  const standing = [
    chord.function === null ? null : SAID[chord.function].called,
    chord.ofTheKey ? null : 'outside the key',
  ].filter((each) => each !== null);
  button.title = `${chord.name} (${chord.numeral}, ${chord.notes})${standing.length === 0 ? '' : `: ${standing.join(', ')}`}. Press to put the cursor here.`;
  return button;
}

/** Marks the chord of the chart the cursor is in, and no other. */
export function showWhereOnTheChart(host: HTMLElement, atMs: number): void {
  for (const chord of host.querySelectorAll<HTMLElement>('.roll-chart__chord')) {
    const here = Number(chord.dataset['from']) <= atMs && atMs < Number(chord.dataset['until']);
    if (here) {
      chord.dataset['here'] = 'true';
    } else {
      delete chord.dataset['here'];
    }
  }
}

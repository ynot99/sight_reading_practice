import { theBrightnessOfTheChord, theTensionOfTheChord } from '../domain/harmony/chordFeeling.js';
import { theChordInTheKey, theNotesOfTheChordNamed, type HarmonicFunction } from '../domain/harmony/harmonicFunction.js';
import { theNameOfTheKey } from '../domain/harmony/scales.js';
import type { SceneBar, SceneChord } from './rollView.js';

/**
 * The chords of a sketch as a chart: bar by bar, four to a row, each chord
 * with its degree, its notes and what it does in its key - the whole of
 * the music's harmony at once, to plan what comes next by, where the lane
 * under the notes shows only the stretch on the screen. Read off the lane's
 * own chords, so the two never disagree. Over it, the tension and the
 * brightness of the chords along the whole piece (see `chordFeeling.ts`).
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
  readonly tension: number;
  readonly brightness: number;
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
  /** The section beginning in it, by its name; none where none does. */
  readonly section: string | null;
  /** Whether it begins a row of the chart: four bars to a row, and each section on a row of its own from its first. */
  readonly beginsARow: boolean;
}

/** How many bars a row of the chart holds. */
const BARS_TO_A_ROW = 4;

/**
 * The chart of the chords along the bars of a drawing: each chord in the
 * bar it begins in, taking as much of the bar as it lasts in it; a bar a
 * chord goes on into from the one before says so, as much of it as it
 * takes. Chords before the first bar line are the first bar's, and the
 * last bar is as long as its chords. A section begins in the bar it falls
 * in, and that bar begins a row.
 */
export function theChartOfTheChords(
  bars: readonly SceneBar[],
  chords: readonly SceneChord[],
  sections: readonly { readonly atMs: number; readonly name: string }[] = [],
): readonly ChartBar[] {
  let column = 0;
  return bars.map((bar, at) => {
    const untilMs = bars[at + 1]?.atMs ?? Number.POSITIVE_INFINITY;
    const inIt = chords.filter((chord) => (at === 0 || chord.fromMs >= bar.atMs) && chord.fromMs < untilMs);
    const beganMs = Math.min(bar.atMs, ...inIt.map((chord) => chord.fromMs));
    const goesOn = at === 0 ? undefined : chords.find((chord) => chord.fromMs < bar.atMs && chord.untilMs > bar.atMs);
    const lasts = (chord: SceneChord): number => Math.max(Math.min(chord.untilMs, untilMs) - Math.max(chord.fromMs, beganMs), 0);
    const endedMs = Number.isFinite(untilMs) ? untilMs : Math.max(beganMs, ...inIt.map((chord) => chord.untilMs));
    const all = endedMs - beganMs;
    const shareOf = (chord: SceneChord): number => (all > 0 ? lasts(chord) / all : 1);
    const section = sections.find((each) => (at === 0 || each.atMs >= bar.atMs) && each.atMs < untilMs)?.name ?? null;
    column = section === null ? column : 0;
    const beginsARow = column === 0;
    column = (column + 1) % BARS_TO_A_ROW;
    return {
      name: bar.name,
      fromMs: bar.atMs,
      section,
      beginsARow,
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
          tension: theTensionOfTheChord(chord, chord.key),
          brightness: theBrightnessOfTheChord(chord, chord.key),
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

/** A chord's tension and brightness for as long as it lasts: a step of the curves over the chart. */
export interface ChartCurve {
  readonly fromMs: number;
  readonly untilMs: number;
  readonly tension: number;
  readonly brightness: number;
}

/** The tension and the brightness of the chords along the whole piece, a step a chord. */
export function theCurvesOfTheChords(chords: readonly SceneChord[]): readonly ChartCurve[] {
  return chords.map((chord) => ({
    fromMs: chord.fromMs,
    untilMs: chord.untilMs,
    tension: theTensionOfTheChord(chord, chord.key),
    brightness: theBrightnessOfTheChord(chord, chord.key),
  }));
}

/** The curves are drawn in a box this wide and tall, stretched to the chart's width. */
const CURVES_WIDE = 1000;
const CURVES_TALL = 100;

/**
 * How far the scales of the curves reach at least: so a calm piece is drawn
 * calm, low on its scale, rather than stretched to the top of it; the
 * brightness either side of nought, which is the middle.
 */
const TENSION_DRAWN_TO = 3.5;
const BRIGHTNESS_DRAWN_TO = 3;

/**
 * How wide a stretch the trend of a curve is the mean of, in rows of the
 * chart: a chord at a time is too restless to read a piece's shape by, and
 * a row - four bars, a phrase - is the stretch it is planned in.
 */
const TREND_OVER_ROWS = 1;

/** How many points the trend is drawn through, across the whole piece. */
const TREND_POINTS = 200;

/**
 * The trend of a curve: at each of evenly spaced moments, the mean of it
 * over the stretch around that moment, each chord weighed by how long it
 * sounds in the stretch; none where nothing sounds in it.
 */
export function theTrend(
  curves: readonly ChartCurve[],
  value: (curve: ChartCurve) => number,
  fromMs: number,
  untilMs: number,
  overMs: number,
): readonly ({ readonly atMs: number; readonly value: number } | null)[] {
  return Array.from({ length: TREND_POINTS + 1 }, (_, at) => {
    const atMs = fromMs + ((untilMs - fromMs) * at) / TREND_POINTS;
    let weight = 0;
    let sum = 0;
    for (const curve of curves) {
      const lasts = Math.min(curve.untilMs, atMs + overMs / 2) - Math.max(curve.fromMs, atMs - overMs / 2);
      if (lasts > 0) {
        weight += lasts;
        sum += lasts * value(curve);
      }
    }
    return weight > 0 ? { atMs, value: sum / weight } : null;
  });
}

/** A trend as a line through its points, broken where it has none. */
function theLine(
  trend: readonly ({ readonly atMs: number; readonly value: number } | null)[],
  x: (ms: number) => number,
  y: (value: number) => number,
): string {
  let path = '';
  let going = false;
  for (const point of trend) {
    if (point === null) {
      going = false;
      continue;
    }
    path += ` ${going ? 'L' : 'M'} ${x(point.atMs).toFixed(2)} ${y(point.value).toFixed(2)}`;
    going = true;
  }
  return path.trim();
}

/** One curve as steps: level for each chord, joined where one follows another, broken where nothing sounds between. */
function theSteps(curves: readonly ChartCurve[], x: (ms: number) => number, y: (curve: ChartCurve) => number): string {
  let path = '';
  let endedAt: number | null = null;
  for (const curve of curves) {
    const height = y(curve).toFixed(2);
    path += endedAt === curve.fromMs ? ` V ${height}` : ` M ${x(curve.fromMs).toFixed(2)} ${height}`;
    path += ` H ${x(curve.untilMs).toFixed(2)}`;
    endedAt = curve.untilMs;
  }
  return path.trim();
}

/**
 * The tension and the brightness along the whole piece, over the chart: a
 * line for each, the brightness about a line of nought, a faint line where
 * each row of the chart begins, and one where the cursor is. Pressed, it
 * puts the cursor where it was pressed: see `theMomentOnTheCurves`.
 */
function drawTheCurves(doc: Document, curves: readonly ChartCurve[], chart: readonly ChartBar[]): HTMLElement {
  // A row of the chart in time: the piece's bars on the whole, as many as a row holds.
  const overMs = (theLengthOfTheCurves(curves) / Math.max(chart.length, 1)) * BARS_TO_A_ROW * TREND_OVER_ROWS;
  const SVG = 'http://www.w3.org/2000/svg';
  const box = doc.createElement('div');
  box.className = 'roll-chart__curves';
  const legend = doc.createElement('div');
  legend.className = 'roll-chart__legend';
  const tensionSaid = doc.createElement('span');
  tensionSaid.className = 'roll-chart__legend-tension';
  tensionSaid.textContent = 'Tension';
  const brightnessSaid = doc.createElement('span');
  brightnessSaid.className = 'roll-chart__legend-brightness';
  brightnessSaid.textContent = 'Brightness';
  legend.append(tensionSaid, brightnessSaid);
  const fromMs = Math.min(...curves.map((curve) => curve.fromMs));
  const untilMs = Math.max(...curves.map((curve) => curve.untilMs));
  const x = (ms: number): number => ((ms - fromMs) / Math.max(untilMs - fromMs, 1)) * CURVES_WIDE;
  const tallest = Math.max(TENSION_DRAWN_TO, ...curves.map((curve) => curve.tension));
  const furthest = Math.max(BRIGHTNESS_DRAWN_TO, ...curves.map((curve) => Math.abs(curve.brightness)));
  const drawing = doc.createElementNS(SVG, 'svg');
  drawing.setAttribute('viewBox', `0 0 ${String(CURVES_WIDE)} ${String(CURVES_TALL)}`);
  drawing.setAttribute('preserveAspectRatio', 'none');
  drawing.setAttribute('role', 'img');
  drawing.setAttribute('aria-label', 'The tension and the brightness of the chords along the piece. Press to put the cursor there.');
  drawing.dataset['from'] = String(fromMs);
  drawing.dataset['until'] = String(untilMs);
  const line = (className: string, x1: number, y1: number, x2: number, y2: number): SVGLineElement => {
    const drawn = doc.createElementNS(SVG, 'line');
    drawn.setAttribute('class', className);
    drawn.setAttribute('x1', x1.toFixed(2));
    drawn.setAttribute('y1', String(y1));
    drawn.setAttribute('x2', x2.toFixed(2));
    drawn.setAttribute('y2', String(y2));
    drawn.setAttribute('vector-effect', 'non-scaling-stroke');
    return drawn;
  };
  // Where each row after the first begins, and more strongly where a section does.
  const rows = chart
    .filter((bar, at) => at > 0 && bar.beginsARow)
    .map((bar) =>
      line(bar.section === null ? 'roll-chart__row-line' : 'roll-chart__section-line', x(bar.fromMs), 0, x(bar.fromMs), CURVES_TALL),
    );
  const nought = line('roll-chart__nought', 0, CURVES_TALL / 2, CURVES_WIDE, CURVES_TALL / 2);
  const path = (className: string, d: string): SVGPathElement => {
    const drawn = doc.createElementNS(SVG, 'path');
    drawn.setAttribute('class', className);
    drawn.setAttribute('d', d);
    drawn.setAttribute('vector-effect', 'non-scaling-stroke');
    return drawn;
  };
  const tensionY = (tension: number): number => CURVES_TALL - 4 - (tension / tallest) * (CURVES_TALL - 8);
  const brightnessY = (brightness: number): number => CURVES_TALL / 2 - (brightness / furthest) * (CURVES_TALL / 2 - 4);
  // Each chord's own, faint, and the trend of each over a phrase over it.
  const tension = path('roll-chart__tension', theSteps(curves, x, (curve) => tensionY(curve.tension)));
  const brightness = path('roll-chart__brightness', theSteps(curves, x, (curve) => brightnessY(curve.brightness)));
  const tensionTrend = path(
    'roll-chart__tension-trend',
    theLine(theTrend(curves, (curve) => curve.tension, fromMs, untilMs, overMs), x, tensionY),
  );
  const brightnessTrend = path(
    'roll-chart__brightness-trend',
    theLine(theTrend(curves, (curve) => curve.brightness, fromMs, untilMs, overMs), x, brightnessY),
  );
  // Off the drawing until the cursor is placed: see `showWhereOnTheChart`.
  const cursor = line('roll-chart__cursor', -1, 0, -1, CURVES_TALL);
  drawing.append(...rows, nought, brightness, tension, brightnessTrend, tensionTrend, cursor);
  box.append(legend, drawing);
  return box;
}

/** How long the curves run, from the first chord to the end of the last. */
function theLengthOfTheCurves(curves: readonly ChartCurve[]): number {
  return Math.max(...curves.map((curve) => curve.untilMs)) - Math.min(...curves.map((curve) => curve.fromMs));
}

/** The moment of the piece a press on the curves is over, from where it is across them; none where they have no width. */
export function theMomentOnTheCurves(drawing: Element, clientX: number): number | null {
  const box = drawing.getBoundingClientRect();
  if (!(drawing instanceof SVGSVGElement) || box.width <= 0) {
    return null;
  }
  const fromMs = Number(drawing.dataset['from']);
  const untilMs = Number(drawing.dataset['until']);
  const across = Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
  return fromMs + across * (untilMs - fromMs);
}

/** Draws the chart into its place - the curves over it, a bar a cell - each chord a button that puts the cursor where it begins. */
export function drawTheChart(host: HTMLElement, chart: readonly ChartBar[], curves: readonly ChartCurve[]): void {
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
    if (bar.section !== null) {
      cell.dataset['section'] = bar.section;
      const section = doc.createElement('span');
      section.className = 'roll-chart__section';
      section.textContent = bar.section;
      cell.append(section);
    }
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
  host.replaceChildren(drawTheCurves(doc, curves, chart), grid);
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
  button.title =
    `${chord.name} (${chord.numeral}, ${chord.notes})${standing.length === 0 ? '' : `: ${standing.join(', ')}`}. ` +
    `Tension ${chord.tension.toFixed(1)}, brightness ${chord.brightness.toFixed(1)}. Press to put the cursor here.`;
  return button;
}

/** Marks the chord of the chart the cursor is in, and no other, and the cursor's place along the curves. */
export function showWhereOnTheChart(host: HTMLElement, atMs: number): void {
  const drawing = host.querySelector<SVGSVGElement>('.roll-chart__curves svg');
  const cursor = drawing?.querySelector('.roll-chart__cursor');
  if (drawing !== null && drawing !== undefined && cursor !== null && cursor !== undefined) {
    const fromMs = Number(drawing.dataset['from']);
    const untilMs = Number(drawing.dataset['until']);
    const across = ((atMs - fromMs) / Math.max(untilMs - fromMs, 1)) * CURVES_WIDE;
    const at = (across < 0 || across > CURVES_WIDE ? -1 : across).toFixed(2);
    cursor.setAttribute('x1', at);
    cursor.setAttribute('x2', at);
  }
  for (const chord of host.querySelectorAll<HTMLElement>('.roll-chart__chord')) {
    const here = Number(chord.dataset['from']) <= atMs && atMs < Number(chord.dataset['until']);
    if (here) {
      chord.dataset['here'] = 'true';
    } else {
      delete chord.dataset['here'];
    }
  }
}

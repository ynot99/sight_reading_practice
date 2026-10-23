// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CHORD_KINDS, type ChordKind } from '../../src/domain/harmony/chordName.js';
import type { ScaleName } from '../../src/domain/harmony/scales.js';
import {
  drawTheChart,
  showWhereOnTheChart,
  theChartOfTheChords,
  theCurvesOfTheChords,
  theMomentOnTheCurves,
  theTrend,
} from '../../src/ui/chordChart.js';
import type { SceneChord } from '../../src/ui/rollView.js';

function kind(suffix: string): ChordKind {
  const found = CHORD_KINDS.find((each) => each.suffix === suffix);
  if (found === undefined) {
    throw new Error(`no kind ${suffix}`);
  }
  return found;
}

/** A chord of the lane, as the drawing names it. */
function chord(
  fromMs: number,
  untilMs: number,
  name: string,
  numeral: string,
  root: number,
  suffix: string,
  key: { fifths: number; scale: ScaleName } = { fifths: 0, scale: 'major' },
): SceneChord {
  return { fromMs, untilMs, name, numeral, exactly: true, chosen: false, root, kind: kind(suffix), key, says: name };
}

// Bars of two seconds, named as printed.
const BARS = [
  { atMs: 0, name: '1' },
  { atMs: 2_000, name: '2' },
  { atMs: 4_000, name: '3' },
];
const CHORDS = [
  // A pickup before the first bar line.
  chord(-500, 0, 'G', 'V', 7, ''),
  chord(0, 1_000, 'C', 'I', 0, ''),
  // Across the bar line, into the second bar's first half.
  chord(1_000, 3_000, 'Fm', 'iv', 5, 'm'),
  chord(3_000, 4_000, 'G7', 'V7', 7, '7'),
  // Into A minor, on its dominant.
  chord(4_000, 6_000, 'E', 'V', 4, '', { fifths: 0, scale: 'minor' }),
];

describe('the chart of the chords', () => {
  const chart = theChartOfTheChords(BARS, CHORDS);
  const said = chart.map((bar) => ({
    name: bar.name,
    goesOn: bar.goesOn,
    chords: bar.chords.map((each) => [each.name, each.numeral, each.notes, each.function, each.ofTheKey, each.keyBegins, each.share]),
  }));

  it('puts each chord in the bar it begins in, as much of it as it lasts there, the pickup in the first', () => {
    expect(said.map((bar) => bar.name)).toEqual(['1', '2', '3']);
    // The first bar from the pickup on: two and a half seconds.
    expect(said[0]?.chords.map((each) => [each[0], each[6]])).toEqual([
      ['G', 0.2],
      ['C', 0.4],
      ['Fm', 0.4],
    ]);
    expect(said[1]?.chords.map((each) => [each[0], each[6]])).toEqual([['G7', 0.5]]);
    // The last bar as long as its chords.
    expect(said[2]?.chords.map((each) => [each[0], each[6]])).toEqual([['E', 1]]);
  });

  it('says a bar a chord goes on into, as much of it as it takes, and only where one does', () => {
    expect(said.map((bar) => bar.goesOn)).toEqual([null, { name: 'Fm', share: 0.5 }, null]);
    // A pickup held over the first bar line is the first bar's own, not one going on into it.
    const heldOver = theChartOfTheChords(BARS, [chord(-500, 500, 'G', 'V', 7, ''), chord(500, 2_000, 'C', 'I', 0, '')]);
    expect(heldOver[0]?.goesOn).toBeNull();
    expect(heldOver[0]?.chords.map((each) => each.name)).toEqual(['G', 'C']);
  });

  it('gives each chord its notes, what it does in its key and whether it is of it, and the key where one begins', () => {
    expect(said[0]?.chords).toEqual([
      ['G', 'V', 'G B D', 'dominant', true, 'C major', 0.2],
      ['C', 'I', 'C E G', 'tonic', true, null, 0.4],
      ['Fm', 'iv', 'F A♭ C', 'subdominant', false, null, 0.4],
    ]);
    expect(said[2]?.chords[0]?.slice(0, 6)).toEqual(['E', 'V', 'E G♯ B', 'dominant', true, 'A minor']);
  });

  it('draws a bar a cell and a chord a button, saying so on it, and marks the one a moment is in', () => {
    const host = document.createElement('div');
    drawTheChart(host, chart, theCurvesOfTheChords(CHORDS));
    const bars = [...host.querySelectorAll('.roll-chart__bar')];
    expect(bars.map((bar) => bar.querySelector('.roll-chart__number')?.textContent)).toEqual(['1', '2', '3']);
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('.roll-chart__chord')];
    expect(buttons.map((each) => [each.dataset['from'], each.dataset['function'], each.dataset['ofTheKey'], each.style.flexGrow])).toEqual([
      ['-500', 'dominant', 'true', '0.2'],
      ['0', 'tonic', 'true', '0.4'],
      ['1000', 'subdominant', 'false', '0.4'],
      ['3000', 'dominant', 'true', '0.5'],
      ['4000', 'dominant', 'true', '1'],
    ]);
    const fm = buttons[2];
    expect(fm?.querySelector('.roll-chart__function')?.textContent).toBe('S');
    expect(fm?.querySelector('.roll-chart__notes')?.textContent).toBe('F A♭ C');
    expect(fm?.title).toBe(
      'Fm (iv, F A♭ C): subdominant: moving away, outside the key. Tension 1.5, brightness -1.2. Press to put the cursor here.',
    );
    expect(buttons[0]?.querySelector('.roll-chart__key')?.textContent).toBe('C major');
    expect(buttons[1]?.querySelector('.roll-chart__key')).toBeNull();
    const goesOn = bars[1]?.querySelector<HTMLElement>('.roll-chart__goes-on');
    expect([goesOn?.title, goesOn?.style.flexGrow]).toEqual(['Fm goes on', '0.5']);
    expect(bars[0]?.querySelector('.roll-chart__goes-on')).toBeNull();

    const here = (): (string | undefined)[] => [...host.querySelectorAll<HTMLElement>('[data-here]')].map((each) => each.dataset['from']);
    showWhereOnTheChart(host, 2_500);
    expect(here()).toEqual(['1000']);
    showWhereOnTheChart(host, 3_000);
    expect(here()).toEqual(['3000']);
    showWhereOnTheChart(host, 7_000);
    expect(here()).toEqual([]);
  });

  it('draws the tension and the brightness along the piece over it, a step a chord, the cursor on them', () => {
    const curves = theCurvesOfTheChords(CHORDS);
    expect(curves.map((curve) => [curve.fromMs, curve.untilMs, curve.tension, Number(curve.brightness.toFixed(3))])).toEqual([
      [-500, 0, 2, 2.167],
      [0, 1_000, 0, 1.667],
      [1_000, 3_000, 1.5, -1.167],
      [3_000, 4_000, 2.75, 1.25],
      [4_000, 6_000, 2, 2.167],
    ]);
    const host = document.createElement('div');
    drawTheChart(host, chart, curves);
    const drawing = host.querySelector<SVGSVGElement>('.roll-chart__curves svg');
    expect([drawing?.dataset['from'], drawing?.dataset['until']]).toEqual(['-500', '6000']);
    expect([...host.querySelectorAll('.roll-chart__legend span')].map((each) => each.textContent)).toEqual(['Tension', 'Brightness']);
    // Across a thousand for six and a half seconds; the tension from the foot up to its highest, three and a half;
    // the brightness about the middle, as far as three either way.
    const x = (ms: number): string => (((ms + 500) / 6_500) * 1000).toFixed(2);
    const tensionY = (tension: number): string => (96 - (tension / 3.5) * 92).toFixed(2);
    const brightnessY = (brightness: number): string => (50 - (brightness / 3) * 46).toFixed(2);
    expect(host.querySelector('.roll-chart__tension')?.getAttribute('d')).toBe(
      [
        `M ${x(-500)} ${tensionY(2)} H ${x(0)}`,
        `V ${tensionY(0)} H ${x(1_000)}`,
        `V ${tensionY(1.5)} H ${x(3_000)}`,
        `V ${tensionY(2.75)} H ${x(4_000)}`,
        `V ${tensionY(2)} H ${x(6_000)}`,
      ].join(' '),
    );
    expect(host.querySelector('.roll-chart__brightness')?.getAttribute('d')).toMatch(
      new RegExp(`^M ${x(-500)} ${brightnessY(curves[0]?.brightness ?? 0)} H ${x(0)} V ${brightnessY(curves[1]?.brightness ?? 0)} `),
    );
    // A gap where nothing sounds breaks the curve; a tension past three and a half raises the scale to it.
    const apart = theCurvesOfTheChords([
      chord(0, 1_000, 'C', 'I', 0, ''),
      chord(2_000, 3_000, 'B9', 'VII9', 11, '9'),
    ]);
    const another = document.createElement('div');
    drawTheChart(another, theChartOfTheChords(BARS, []), apart);
    expect(another.querySelector('.roll-chart__curves')).toBeNull();
    drawTheChart(another, theChartOfTheChords(BARS, [chord(0, 1_000, 'C', 'I', 0, '')]), apart);
    const highest = apart[1]?.tension ?? 0;
    expect(highest).toBeGreaterThan(3.5);
    expect(another.querySelector('.roll-chart__tension')?.getAttribute('d')).toBe(
      `M 0.00 96.00 H 333.33 M 666.67 ${(96 - 92).toFixed(2)} H 1000.00`,
    );
    // And a brightness past three either way widens its scale to it, dark as well as bright.
    const dark = document.createElement('div');
    drawTheChart(dark, theChartOfTheChords(BARS, [chord(0, 1_000, 'C', 'I', 0, '')]), [
      { fromMs: 0, untilMs: 1_000, tension: 0, brightness: -4 },
      { fromMs: 1_000, untilMs: 2_000, tension: 0, brightness: 2 },
    ]);
    expect(dark.querySelector('.roll-chart__brightness')?.getAttribute('d')).toBe('M 0.00 96.00 H 500.00 V 27.00 H 1000.00');
    // A line where each row of four bars after the first begins: none with three bars.
    expect(host.querySelectorAll('.roll-chart__row-line')).toHaveLength(0);
    const twelve = Array.from({ length: 12 }, (_, at) => ({ atMs: at * 2_000, name: String(at + 1) }));
    const longer = document.createElement('div');
    const along = [chord(0, 24_000, 'C', 'I', 0, '')];
    drawTheChart(longer, theChartOfTheChords(twelve, along), theCurvesOfTheChords(along));
    expect([...longer.querySelectorAll('.roll-chart__row-line')].map((each) => each.getAttribute('x1'))).toEqual(['333.33', '666.67']);

    // The cursor along them, off them where it is outside the piece.
    const cursorAt = (): string | null | undefined => host.querySelector('.roll-chart__cursor')?.getAttribute('x1');
    expect(cursorAt()).toBe('-1.00');
    showWhereOnTheChart(host, 2_750);
    expect(cursorAt()).toBe(x(2_750));
    showWhereOnTheChart(host, 9_000);
    expect(cursorAt()).toBe('-1.00');
  });

  it('draws the trend of each over a row of the chart, each chord weighed by how long it sounds there, none where nothing does', () => {
    const steps = [
      { fromMs: 0, untilMs: 1_000, tension: 0, brightness: 1 },
      { fromMs: 1_000, untilMs: 4_000, tension: 2, brightness: -1 },
      { fromMs: 6_000, untilMs: 10_000, tension: 1, brightness: 0 },
    ];
    const trend = theTrend(steps, (curve) => curve.tension, 0, 10_000, 2_000);
    expect(trend).toHaveLength(201);
    const at = (ms: number): number | null | undefined => trend.find((point) => point !== null && point.atMs === ms)?.value ?? null;
    // From nought to a thousand around the first moment: the first chord alone.
    expect(at(0)).toBe(0);
    // A second either side of a thousand: half each.
    expect(at(1_000)).toBe(1);
    // Around fifteen hundred, half a second of the first and a second and a half of the second: by how long.
    expect(at(1_500)).toBe(1.5);
    // Of a second and a half sounding around two and a half thousand... all the second chord.
    expect(at(2_500)).toBe(2);
    // Around five thousand nothing sounds: no point.
    expect(trend[100]).toBeNull();
    // Around six thousand, the third alone, its second half of the stretch.
    expect(at(6_000)).toBe(1);
    // Drawn over the steps, broken where it has no point.
    const host = document.createElement('div');
    drawTheChart(host, chart, theCurvesOfTheChords(CHORDS));
    const line = host.querySelector('.roll-chart__tension-trend')?.getAttribute('d') ?? '';
    expect(line.startsWith('M ')).toBe(true);
    expect(line.split(' M ')).toHaveLength(1);
    expect(host.querySelector('.roll-chart__brightness-trend')?.getAttribute('d')).toMatch(/^M [\d.]+ [\d.]+ L /);
    // A row of four bars of a quarter of a second is a second wide: the two seconds of nothing break it.
    const forty = Array.from({ length: 40 }, (_, bar) => ({ atMs: bar * 250, name: String(bar + 1) }));
    const gapped = document.createElement('div');
    drawTheChart(gapped, theChartOfTheChords(forty, [chord(0, 1_000, 'C', 'I', 0, '')]), steps);
    expect((gapped.querySelector('.roll-chart__tension-trend')?.getAttribute('d') ?? '').split(' M ')).toHaveLength(2);
    // With twelve bars to the ten seconds a row is over three seconds wide, and bridges them.
    const twelve = Array.from({ length: 12 }, (_, bar) => ({ atMs: (bar * 10_000) / 12, name: String(bar + 1) }));
    const bridged = document.createElement('div');
    drawTheChart(bridged, theChartOfTheChords(twelve, [chord(0, 1_000, 'C', 'I', 0, '')]), steps);
    expect((bridged.querySelector('.roll-chart__tension-trend')?.getAttribute('d') ?? '').split(' M ')).toHaveLength(1);
  });

  it('reads the moment a press on the curves is over from where it is across them', () => {
    const host = document.createElement('div');
    drawTheChart(host, chart, theCurvesOfTheChords(CHORDS));
    const drawing = host.querySelector('.roll-chart__curves svg');
    if (drawing === null) {
      throw new Error('expected the curves');
    }
    drawing.getBoundingClientRect = () => ({ left: 100, width: 650, top: 0, height: 72, right: 750, bottom: 72, x: 100, y: 0, toJSON: () => ({}) });
    expect(theMomentOnTheCurves(drawing, 100)).toBe(-500);
    expect(theMomentOnTheCurves(drawing, 425)).toBe(2_750);
    expect(theMomentOnTheCurves(drawing, 750)).toBe(6_000);
    // Held to the piece either side.
    expect(theMomentOnTheCurves(drawing, 0)).toBe(-500);
    expect(theMomentOnTheCurves(drawing, 900)).toBe(6_000);
    // With no width, nowhere.
    drawing.getBoundingClientRect = () => ({ left: 0, width: 0, top: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
    expect(theMomentOnTheCurves(drawing, 10)).toBeNull();
  });

  it('says there are no chords yet where there are none', () => {
    const host = document.createElement('div');
    drawTheChart(host, theChartOfTheChords(BARS, []), []);
    expect(host.querySelector('.roll-chart__curves')).toBeNull();
    expect(host.querySelector('.roll-chart__none')?.textContent).toBe('No chords yet: write some, or tap one on the circle.');
    expect(host.querySelector('.roll-chart__grid')).toBeNull();
  });
});

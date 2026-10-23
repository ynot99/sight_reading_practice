// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CHORD_KINDS, type ChordKind } from '../../src/domain/harmony/chordName.js';
import type { ScaleName } from '../../src/domain/harmony/scales.js';
import { drawTheChart, showWhereOnTheChart, theChartOfTheChords } from '../../src/ui/chordChart.js';
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
    drawTheChart(host, chart);
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
    expect(fm?.title).toBe('Fm (iv, F A♭ C): subdominant: moving away, outside the key. Press to put the cursor here.');
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

  it('says there are no chords yet where there are none', () => {
    const host = document.createElement('div');
    drawTheChart(host, theChartOfTheChords(BARS, []));
    expect(host.querySelector('.roll-chart__none')?.textContent).toBe('No chords yet: write some, or tap one on the circle.');
    expect(host.querySelector('.roll-chart__grid')).toBeNull();
  });
});

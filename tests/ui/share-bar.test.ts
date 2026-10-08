// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { drawTheShareBar, type BarPiece } from '../../src/ui/shareBar.js';

function piece(kind: string, amount: number): BarPiece {
  return { kind, name: kind, amount, said: `${String(amount)} units` };
}

describe('a bar of what a whole is made of', () => {
  let bar: HTMLElement;
  let legend: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="bar"></div><ul id="legend"></ul>';
    bar = document.getElementById('bar') as HTMLElement;
    legend = document.getElementById('legend') as HTMLElement;
  });

  it('gives each piece the share of the bar its amount is of the whole', () => {
    drawTheShareBar(bar, legend, [piece('a', 6), piece('b', 3), piece('c', 1)]);

    const parts = [...bar.children] as HTMLElement[];
    expect(parts.map((part) => part.dataset['kind'])).toEqual(['a', 'b', 'c']);
    expect(parts.map((part) => parseFloat(part.style.width))).toEqual([60, 30, 10]);
    expect(parts.every((part) => part.style.width.endsWith('%'))).toBe(true);
  });

  it('keeps a piece of nothing off the bar, and its line in the legend', () => {
    drawTheShareBar(bar, legend, [piece('a', 4), piece('empty', 0)]);

    expect([...bar.children].map((part) => (part as HTMLElement).dataset['kind'])).toEqual(['a']);
    expect((bar.children[0] as HTMLElement).style.width).toBe('100%');
    expect([...legend.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'a4 units',
      'empty0 units',
    ]);
  });

  it('says every piece to a reader who cannot see the bar', () => {
    drawTheShareBar(bar, legend, [piece('a', 4), piece('b', 1)]);

    expect(bar.getAttribute('aria-label')).toBe('a 4 units, b 1 units');
  });

  it('draws again from nothing, rather than adding to what was drawn', () => {
    drawTheShareBar(bar, legend, [piece('a', 4), piece('b', 1)]);
    drawTheShareBar(bar, legend, [piece('c', 2)]);

    expect(bar.children).toHaveLength(1);
    expect(legend.children).toHaveLength(1);
  });
});

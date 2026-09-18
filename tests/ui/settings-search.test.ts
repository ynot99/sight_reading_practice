// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findAll, wordsIn } from '../../src/ui/settingsSearch.js';

function settings(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.replaceChildren(root);
  return root;
}

describe('searching the words of the settings', () => {
  it('reads every pane, but not what is hidden for good or a closed list of options', () => {
    const root = settings(`
      <label data-pane="page">Cursor while I play</label>
      <label data-pane="modes">Survival: keep the bar up</label>
      <ul hidden><li>Only on the drive</li></ul>
      <select><option>Counts as a wrong note</option></select>
    `);

    const words = wordsIn(root).map((text) => text.nodeValue?.trim());

    expect(words).toEqual(['Cursor while I play', 'Survival: keep the bar up']);
  });

  it('reads the settings while the sheet around them is shut', () => {
    // The sheet is hidden until it is opened, and that is no reason to find
    // nothing in it.
    const sheet = document.createElement('div');
    sheet.hidden = true;
    sheet.innerHTML = '<div class="controls"><label>Survival</label></div>';
    document.body.replaceChildren(sheet);
    const controls = sheet.querySelector('.controls');
    if (controls === null) {
      throw new Error('made above');
    }

    expect(wordsIn(controls).map((text) => text.nodeValue)).toEqual(['Survival']);
  });

  it('finds every place the words are, whatever their case', () => {
    const said = 'Rhythm only: play the written notes, not my rhythm';
    const root = settings(`<label>${said}</label>`);

    const found = findAll(wordsIn(root), 'RHYTHM');

    expect(found.map((each) => each.start)).toEqual([0, said.lastIndexOf('rhythm')]);
    expect(found.every((each) => each.end - each.start === 'rhythm'.length)).toBe(true);
  });

  it('does not count the spaces at either end of what was typed', () => {
    const root = settings('<label>Survival</label>');

    expect(findAll(wordsIn(root), '  survival ')).toHaveLength(1);
  });

  it('finds nothing for nothing typed', () => {
    const root = settings('<label>Survival</label>');

    expect(findAll(wordsIn(root), '   ')).toEqual([]);
  });
});

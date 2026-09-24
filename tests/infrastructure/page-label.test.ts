import { describe, expect, it } from 'vitest';
import { pageLabelText } from '../../src/infrastructure/rendering/pageLabel.js';

/** What a page says in its corner, whichever engraver drew it. */
describe('the line in the corner of a page', () => {
  it('says the piece and which page of it', () => {
    expect(pageLabelText('Long fixture', 0, 3)).toBe('Long fixture · Page 1 of 3');
    expect(pageLabelText('Long fixture', 2, 3)).toBe('Long fixture · Page 3 of 3');
  });

  it('says nothing about pages where there is only one, or a column', () => {
    // "Page 1 of 1" at a reader who never asked for pages is furniture. The
    // title is not: what piece this is is worth saying at its top.
    expect(pageLabelText('Long fixture', 0, 1)).toBe('Long fixture');
    expect(pageLabelText('Long fixture', 0, 0)).toBe('Long fixture');
  });

  it('says only the pages when the score has no title, and nothing when it has neither', () => {
    // A generated exercise can arrive nameless, and a separator with nothing
    // in front of it is furniture of a worse kind.
    expect(pageLabelText('', 0, 3)).toBe('Page 1 of 3');
    expect(pageLabelText('   ', 1, 3)).toBe('Page 2 of 3');
    expect(pageLabelText('', 0, 1)).toBe('');
  });

  it('cuts a title too long for the corner, and keeps the page number', () => {
    // SVG text does not wrap: an untrimmed one runs off the side of the page
    // and out of the drawing, taking the page number with it.
    const title = 'Nausicaa of the Valley of the Wind: Requiem for a Dying World, Arranged';

    const written = pageLabelText(title, 0, 4);

    const shown = written.split(' · ')[0] ?? '';
    expect(shown).toHaveLength(48);
    expect(shown.endsWith('…')).toBe(true);
    expect(title.startsWith(shown.slice(0, -1))).toBe(true);
    expect(written.endsWith('Page 1 of 4')).toBe(true);
    // And one that fits is left as it is.
    const fits = 'Requiem'.padEnd(48, '!');
    expect(pageLabelText(fits, 0, 0)).toBe(fits);
  });
});

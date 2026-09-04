import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A file as one line, so a name is found wherever the wrapping put it.
 *
 * These are prose files wrapped at eighty columns, and "Alexander Holm" is
 * split across two of them in one of them today. The fact is the same; only
 * the line break is not.
 */
function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\s+/g, ' ');
}

const README = read('README.md');
const HTML = read('index.html');
const CREDITS = read('public/samples/piano/CREDITS.md');

/**
 * Everything this project ships that somebody else made, and everything it
 * names that somebody else sells.
 *
 * Both are the same kind of mistake to make twice: a credit is easy to lose
 * in a rewrite, and a competitor's name is easy to reach for when explaining
 * what a control does. Neither belongs to the code, so neither has anywhere
 * else to be checked.
 */
describe('what the project says about other people', () => {
  it('names no trainer it is competing with', () => {
    // A control explained by naming a paid product tells a reader who has
    // never seen it nothing, and puts that product's name in a page it has
    // no business being on.
    for (const [where, text] of [
      ['README.md', README],
      ['index.html', HTML],
    ] as const) {
      expect(text, where).not.toMatch(/piano\s*marvel/i);
      expect(text, where).not.toMatch(/sight\s*reading\s*factory/i);
    }
  });

  it('credits the piano it ships, where the licence is stated', () => {
    // Attribution is a condition of CC BY, so it belongs beside the project's
    // own licence rather than only in a file next to the recordings - which
    // is where it was, and which nobody reading the licence would find.
    const licence = README.slice(README.lastIndexOf('## Licence'));
    expect(licence).toContain('Salamander Grand Piano V3');
    expect(licence).toContain('Alexander Holm');
    expect(licence).toContain('creativecommons.org/licenses/by/3.0/');
  });

  it('says the same thing beside the recordings', () => {
    // Two statements of one fact drift apart. These are checked against each
    // other rather than kept in step by hand.
    expect(CREDITS).toContain('Salamander Grand Piano V3');
    expect(CREDITS).toContain('Alexander Holm');
    expect(CREDITS).toContain('creativecommons.org/licenses/by/3.0/');
  });
});

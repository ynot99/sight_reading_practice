import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const HTML = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

/**
 * The sheet with its comments taken out.
 *
 * A comment carries no braces, so it would otherwise be read as part of the
 * selector that follows it - and this file is heavily commented.
 */
const CSS = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/**
 * Every rule in the sheet, as selector and body.
 *
 * Innermost braces only, which is what skips past `@media` without needing to
 * understand it: the rules inside are exactly the ones that matter here.
 */
function rules(): { selector: string; body: string; at: number }[] {
  return [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    // The last line of what precedes the brace: anything above it belongs to
    // the rule before, or is blank.
    selector: (match[1] ?? '').trim().split(/\r?\n/).pop()?.trim() ?? '',
    body: match[2] ?? '',
    at: match.index ?? 0,
  }));
}

/**
 * The stylesheet, checked for the one mistake it keeps making.
 *
 * Not a test of how the page looks - that is not something a string can
 * answer - but of an invariant no other test can see. jsdom does not apply
 * the stylesheet, so a rule that quietly reveals a hidden element passes
 * every UI test in the suite and shows up only as a layout that moves on the
 * reader's iPad.
 */
describe('the stylesheet', () => {
  it('lets nothing outrank the browser on what hidden means', () => {
    // An author rule that sets a display beats the browser's own
    // `[hidden] { display: none }`. Three components have been made into flex
    // boxes over this project's life and each one became permanently visible
    // while still carrying the attribute.
    const guard = rules().find((rule) => rule.selector === '[hidden]');

    expect(guard).toBeDefined();
    expect(guard?.body).toMatch(/display\s*:\s*none\s*!important/);
  });

  it('keeps that rule where nothing can be declared before it', () => {
    // `!important` wins regardless of order, but a reader of the file should
    // meet the invariant before the rules it governs.
    const guard = rules().find((rule) => rule.selector === '[hidden]');
    const firstComponent = rules().find(
      (rule) => rule.selector.startsWith('.') && /display\s*:/.test(rule.body),
    );

    expect(guard).toBeDefined();
    expect(guard?.at ?? Infinity).toBeLessThan(firstComponent?.at ?? 0);
  });

  it('says it once rather than per component', () => {
    // Every `X[hidden]` rule that was added one at a time is a place the next
    // component will be forgotten.
    const perComponent = rules().filter(
      (rule) => rule.selector.includes('[hidden]') && rule.selector !== '[hidden]',
    );

    expect(perComponent.map((rule) => rule.selector)).toEqual([]);
  });

  it('covers every element the markup starts hidden', () => {
    // A list, so that adding a hidden element to the page cannot silently
    // rely on a guard that only some components have.
    const hiddenIds = [...HTML.matchAll(/id="([a-z-]+)"[^>]*\shidden/g)].map(
      (match) => match[1],
    );

    expect(hiddenIds.length).toBeGreaterThan(5);
    // One rule, matching by attribute, so the count does not matter.
    expect(rules().some((rule) => rule.selector === '[hidden]')).toBe(true);
  });
});

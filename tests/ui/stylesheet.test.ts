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

  it('keeps everything that changes out of the transport row', () => {
    // What fullscreen says - "Idle", "Counting in... 3", "bar 12 . beat 2.5",
    // a grade - all changes while the reader plays and all of it is wider
    // than a button. It is one pill, taken out of the flow, so no width it
    // takes can move what a thumb is aiming at.
    const notice = rules().find((rule) => rule.selector === '.focus-notice');

    expect(notice).toBeDefined();
    expect(notice?.body).toMatch(/position\s*:\s*absolute/);
    // Anchored past the bar's left edge, so it grows away from it.
    expect(notice?.body).toMatch(/right\s*:\s*100%/);
    // Nothing left inside the row that sizes itself to changing text.
    expect(rules().some((rule) => rule.selector === '.focus-bar__status')).toBe(false);
  });

  it('asks the viewport to reach under the safe areas', () => {
    // The stylesheet already offsets by `env(safe-area-inset-*)`, and without
    // `viewport-fit=cover` those resolve to zero - so the transport pill sits
    // under a tablet's home indicator and the offsets do nothing.
    const viewport = /<meta[^>]*name="viewport"[^>]*>/.exec(HTML)?.[0] ?? '';

    expect(viewport).toContain('viewport-fit=cover');
  });

  it('can be installed, which is the only way off the fullscreen chrome', () => {
    // Safari's floating close button and its swipe-down cannot be turned off
    // from a page - a browser has to leave a way out of fullscreen. Added to
    // a Home Screen there is no fullscreen to leave.
    expect(HTML).toMatch(/<link[^>]*rel="manifest"/);
    expect(HTML).toMatch(/name="apple-mobile-web-app-capable"[^>]*content="yes"/);
    expect(HTML).toMatch(/<link[^>]*rel="apple-touch-icon"/);
  });

  it('does not name file types the reader may be unable to choose', () => {
    // iOS resolves `accept` to its own file types, and `.mxl` is not one it
    // knows - a picker that named it greyed out every score on the device.
    // Opening the file is where its kind gets decided, and it already says so
    // when the answer is no.
    const picker = /<input[^>]*id="score-file"[^>]*>/.exec(HTML)?.[0] ?? '';

    expect(picker).not.toBe('');
    expect(picker).not.toMatch(/accept=/);
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

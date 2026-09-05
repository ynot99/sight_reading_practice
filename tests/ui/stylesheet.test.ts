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
    // The whole selector, newlines and all - a grouped rule lists several,
    // one per line, and keeping only the last quietly checked one of them.
    // Comments are gone already, so nothing else can be in here.
    selector: (match[1] ?? '').trim().replace(/\s*\n\s*/g, ' '),
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
    // Nothing in the row may size itself to text that changes while the
    // reader plays: a width that moves moves every button beside it, and a
    // thumb is aiming at one of those. What the page has to say is said in
    // the middle of it now, or by the page drawing the thing itself.
    const inTheRow = rules().filter((rule) => rule.selector.startsWith('.focus-bar__'));
    for (const rule of inTheRow) {
      expect(rule.body).not.toMatch(/width\s*:\s*max-content/);
    }
    expect(rules().some((rule) => rule.selector === '.focus-bar__status')).toBe(false);
    expect(rules().some((rule) => rule.selector === '.focus-notice')).toBe(false);
  });

  it('takes the transport away while the music is going', () => {
    // Only the marked buttons survive mid-run, and the bar loses its own
    // ground so the two that stay are floating over the score rather than
    // sitting in a strip of furniture. jsdom applies no stylesheet, so
    // without this the attribute could be set on a bar that still shows
    // everything and every UI test would pass.
    const stripped = rules().find(
      (rule) => rule.selector === ".focus-bar[data-playing='true']",
    );
    const row = rules().find(
      (rule) => rule.selector === ".focus-bar[data-playing='true'] .focus-bar__row > *:not([data-mid-run])",
    );

    expect(stripped?.body).toMatch(/background\s*:\s*transparent/);
    expect(stripped?.body).toMatch(/box-shadow\s*:\s*none/);
    expect(row?.body).toMatch(/display\s*:\s*none/);
    // The take recorder and the drawer's handle go with it.
    const hidden = rules().find(
      (rule) =>
        rule.selector.includes("[data-playing='true']") && rule.selector.includes('.focus-record'),
    );
    expect(hidden?.selector).toContain('.focus-bar__handle');
    expect(hidden?.body).toMatch(/display\s*:\s*none/);
  });

  it('keeps quick replay off the bar until there is a run to replay', () => {
    // The row's one button the other way round: it survives a run like pause
    // and stop, and has nothing to say between runs, where the button that
    // begins a reading is Start. jsdom applies no stylesheet, so nothing in
    // the view tests can see this.
    const waiting = rules().find(
      (rule) => rule.selector === ".focus-bar:not([data-playing='true']) #focus-replay",
    );

    expect(waiting?.body).toMatch(/display\s*:\s*none/);
  });

  it('reddens the marker where the reader keeps missing', () => {
    // The engraver owns that element, so the state is written on the page it
    // stands on and the colour is taken from there. jsdom applies no
    // stylesheet, so nothing in the view tests can see this.
    const steps = rules().filter((rule) => rule.selector.includes('[data-trouble='));

    expect(steps.length).toBeGreaterThanOrEqual(4);
    for (const step of steps) {
      expect(step.selector).toContain('cursorImg');
      expect(step.body).toMatch(/filter\s*:/);
    }
    // Stronger and stronger, so the ladder says how much rather than only
    // that something is wrong.
    const strength = steps.map((step) => Number.parseFloat(/saturate\(([\d.]+)\)/.exec(step.body)?.[1] ?? '0'));
    for (let at = 1; at < strength.length; at += 1) {
      expect(strength[at]).toBeGreaterThan(strength[at - 1] ?? 0);
    }
  });

  it('lets a touch through the middle of the page to the music under it', () => {
    // The card covering the score is transparent and covers all of it, so
    // taking touches would kill the two gestures the page is read with - a
    // held finger on a bar to put the place there, a tap to raise the passage
    // markers - and kill them silently, since nothing would happen at all.
    // Only the verdict takes a touch, and only because a tap is how it is
    // dismissed. jsdom applies no stylesheet, so nothing else can see this.
    const card = rules().find((rule) => rule.selector === '.score-card');
    const verdict = rules().find((rule) => rule.selector === '.score-card__verdict');

    expect(card?.body).toMatch(/pointer-events\s*:\s*none/);
    expect(verdict?.body).toMatch(/pointer-events\s*:\s*auto/);
    // And the count never does: it is a phase that ends on its own, and a tap
    // that dismissed it would leave the run starting on a blank page.
    const count = rules().find((rule) => rule.selector === '.score-card__count');
    expect(count?.body).not.toMatch(/pointer-events\s*:\s*auto/);
  });

  it('says a marker will not scroll the page before anyone touches it', () => {
    // A browser decides whether a touch is going to scroll as the touch
    // begins, from what is under the finger. Said only once the drag had
    // started, it was too late by then: the marker could be nudged sideways
    // with great care and not moved down the page at all. jsdom applies no
    // stylesheet, so nothing else in the suite can see this.
    const hit = rules().find((rule) => rule.selector === '.passage-marker__hit');

    expect(hit?.body).toMatch(/touch-action\s*:\s*none/);
    // Invisible, not absent: it is a fingertip's worth of area to aim at.
    expect(hit?.body).toMatch(/fill\s*:\s*transparent/);
  });

  it('lets a hand switch be aimed at without scrolling the page', () => {
    // The same rule the passage markers live by: a browser decides whether a
    // touch will scroll from what is under the finger at the moment it lands,
    // so it has to be said on the shape rather than when the press arrives.
    const hit = rules().find((rule) => rule.selector === '.hand-switch__hit');
    const tab = rules().find((rule) => rule.selector === '.hand-switch__tab');

    expect(hit?.body).toMatch(/touch-action\s*:\s*none/);
    // Invisible, not absent: it is a fingertip's worth of area to aim at.
    expect(hit?.body).toMatch(/fill\s*:\s*transparent/);
    // The drawn tab is a label on the switch and must not swallow the touch.
    expect(tab?.body).toMatch(/pointer-events\s*:\s*none/);
    // And a hand that is off looks different from one that is on, which is
    // the whole of what the switch says.
    const off = rules().find((rule) => rule.selector === ".hand-switch[data-on='false'] .hand-switch__tab");
    expect(off?.body).toMatch(/opacity\s*:/);
  });

  it('draws the arrow on a handle over it rather than in front of it', () => {
    // The handles are buttons and the arrow is a label on one. A label that
    // swallowed the touch would leave the button working everywhere except
    // in the middle, which is where a thumb lands.
    const arrow = rules().find((rule) => rule.selector === '.passage-marker__arrow');

    expect(arrow?.body).toMatch(/pointer-events\s*:\s*none/);
  });

  it('says whether a take is still open without moving anything', () => {
    // The dot beats while the take is still open and goes quiet once the
    // silence has sealed it, which is what saves the reader counting that
    // silence out under their breath. In the fullscreen bar it has to cost
    // no width at all: a control that changes size is a control a thumb
    // aims at and misses.
    const live = rules().find((rule) => rule.selector === "[data-recording='true'] .button__dot");
    const sealed = rules().find((rule) => rule.selector === "[data-recording='false'] .button__dot");

    expect(live?.body).toMatch(/animation\s*:/);
    expect(sealed?.body).toMatch(/background\s*:/);
    for (const rule of [live, sealed]) {
      expect(rule?.body).not.toMatch(/width|height|padding|margin|font-size|border/);
    }
  });

  it('keeps the start mark out of the way of a finger too', () => {
    // It is a sign and not a control, and it stands on a bar line where a
    // passage marker may be standing as well: a mark that took the touch
    // would make that marker unusable.
    const mark = rules().find((rule) => rule.selector === '.start-marker');

    expect(mark?.body).toMatch(/pointer-events\s*:\s*none/);
  });

  it('keeps the page label out of the way of a finger', () => {
    // It is printed on the page, so it sits over the music: a label that
    // swallowed a touch would put a dead patch in the corner of every page,
    // which is exactly where a marker at bar one stands. Longer now that it
    // carries the title too, so it covers more of that corner.
    const label = rules().find((rule) => rule.selector === '.page-label');

    expect(label?.body).toMatch(/pointer-events\s*:\s*none/);
    expect(label?.body).toMatch(/fill\s*:/);
  });

  it('takes the scrollbar away from a score that is turned', () => {
    // A page that can also be nudged upward by half a system is not a page,
    // and the reader who nudged it has no way back to where the turn had put
    // them. jsdom applies no stylesheet, so nothing else in the suite can see
    // this rule at all.
    const paged = rules().find((rule) => rule.selector === ".score__scroll[data-paged='true']");

    expect(paged?.body).toMatch(/overflow\s*:\s*hidden/);
    expect(paged?.body).toMatch(/touch-action\s*:\s*none/);
  });

  it('gives the reading frame the height of the screen, not a minimum', () => {
    // A minimum lets the frame grow to whatever ends up inside it - a page,
    // the strip above it, the room kept below it for the transport bar - and
    // anything over a screenful becomes a scrollbar on a layout whose whole
    // promise is that there is nothing to scroll. Fixed, there is nowhere to
    // grow, and no arithmetic has to keep it in line.
    const frame = rules().find((rule) => rule.selector === '.score');

    expect(frame?.body).toMatch(/(^|[^-])height\s*:\s*100dvh/);
    expect(frame?.body).not.toMatch(/min-height/);
  });

  it('draws a page as a block, so no text line hangs under it', () => {
    // An `<svg>` is inline by default: it stands on a baseline, and the line
    // keeps room under it for the tails of letters that are not there. Five
    // and a half pixels of nothing under every page, which was most of the
    // scrollbar that would not go away.
    const page = rules().find((rule) => rule.selector === '.score__surface svg');

    expect(page?.body).toMatch(/display\s*:\s*block/);
  });

  it('answers strict marking in colour alone', () => {
    // A note struck off its beat is measured the same either way; only what
    // the page paints it changes. Kept here so it cannot quietly grow into a
    // second answer to "how much does timing count", which is the scoring
    // strategy's question and already has one.
    const strict = rules().filter((rule) => rule.selector.includes("[data-strict='true']"));

    expect(strict.length).toBeGreaterThan(0);
    for (const rule of strict) {
      expect(rule.selector).toContain('played--loose');
      expect(rule.body).toMatch(/stroke|fill/);
      expect(rule.body).not.toMatch(/display|visibility|opacity|transform/);
    }
  });

  it('marks a cut passage without moving anything to do it', () => {
    // The drawer says which bars, and it is shut most of the time - so the
    // handle carries a mark while a passage is cut. Taken out of the flow,
    // like everything else that appears and disappears up here: in it, the
    // grab bar would shift sideways the moment the reader narrowed the piece.
    const mark = rules().find(
      (rule) => rule.selector === ".focus-bar__handle[data-passage='true']::after",
    );

    expect(mark).toBeDefined();
    expect(mark?.body).toMatch(/position\s*:\s*absolute/);
    expect(
      rules().find((rule) => rule.selector === '.focus-bar__handle')?.body,
    ).toMatch(/position\s*:\s*relative/);
  });

  it('answers a press before the work it starts finishes', () => {
    // A touch device has no hover, so without an active state the only sign a
    // button was hit is whatever it eventually causes. The tempo buttons
    // re-engrave the page, which on a long piece is most of a second, and the
    // reader pressed again in the meantime.
    const pressed = rules().find(
      (rule) => rule.selector === '.focus-bar__button:active:not(:disabled)',
    );

    expect(pressed).toBeDefined();
    expect(pressed?.body).toMatch(/transform\s*:/);
  });

  it('keeps a caret out of the range iOS magnifies the page for', () => {
    // Anything under 16px makes iOS zoom the whole page in on focus and never
    // undo it - which is a score left magnified because a bar number was
    // tapped. Said once, by element, so a new field cannot miss it.
    const fields = rules().find((rule) => rule.selector === 'input, select, textarea');

    expect(fields).toBeDefined();
    expect(fields?.body).toMatch(/font-size\s*:\s*max\(16px/);
  });

  it('stops a scroll at the edge of the score instead of handing it on', () => {
    // Past the top of a long piece the drag used to chain out to the page,
    // where a tablet reads the overscroll as a gesture of its own.
    const scroll = rules().find((rule) => rule.selector === '.score__scroll');

    expect(scroll?.body).toMatch(/overscroll-behavior\s*:\s*contain/);
    expect(rules().find((rule) => rule.selector === 'body')?.body).toMatch(
      /overscroll-behavior\s*:\s*none/,
    );
  });

  it('stretches a control only inside the column meant for it', () => {
    // Unscoped, `select { width: 100% }` caught the MIDI picker in the header
    // too. It then asked for the whole row and pushed the connection controls
    // onto a second line under the title, for no reason a reader could see.
    const stretched = rules().filter((rule) => /^\s*width\s*:\s*100%/m.test(rule.body));
    const bare = stretched.filter((rule) =>
      rule.selector.split(',').some((part) => /^(select|input)/.test(part.trim())),
    );

    expect(bare.map((rule) => rule.selector)).toEqual([]);
  });

  it('puts the question above the thing it is asking about', () => {
    // The confirm sheet is the only one raised from another. Sharing a
    // stacking level with the list it was opened from put it behind that
    // list: visible only as a page that had dimmed twice and stopped
    // responding to anything.
    const base = rules().find((rule) => rule.selector === '.sheet')?.body ?? '';
    const over = rules().find((rule) => rule.selector === '.sheet--over')?.body ?? '';
    const level = (body: string): number =>
      Number(/z-index\s*:\s*(\d+)/.exec(body)?.[1] ?? '0');

    expect(level(over)).toBeGreaterThan(level(base));
    expect(HTML).toMatch(/id="sheet-confirm"[^>]*class="[^"]*sheet--over/);
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

  it('leaves the music the only thing on the page', () => {
    // There is one layout now. The desk it used to be hidden behind - a
    // header, a toolbar and a side panel - is gone rather than hidden, so
    // what this used to check by looking for `display: none` is checked by
    // looking for the markup at all.
    for (const gone of ['toolbar', 'panel', 'app-header', 'layout']) {
      expect(HTML).not.toContain(`class="${gone}"`);
    }
    // And the settings are not hidden anywhere: they live in a sheet, which
    // is the one way into them from where the reader is actually reading.
    expect(HTML).toContain('id="sheet-settings"');
  });

  it('gives every fullscreen control a name on hover', () => {
    // The bar is icons now, and an icon that has to be guessed at is not a
    // label. `aria-label` says it to a screen reader and nothing else; `title`
    // is what a mouse gets.
    const bar = HTML.slice(HTML.indexOf('id="focus-bar"'));
    const buttons = [...bar.matchAll(/<button[\s\S]*?>/g)].map((match) => match[0]);

    expect(buttons.length).toBeGreaterThan(10);
    for (const button of buttons) {
      const named = /aria-label="([^"]+)"/.exec(button)?.[1];
      expect({ button: named ?? button.slice(0, 40), titled: button.includes('title="') }).toEqual({
        button: named ?? button.slice(0, 40),
        titled: true,
      });
    }
  });

  it('gives every control in the bar an id of its own', () => {
    // Two buttons shared an id once, and only the first was ever wired up:
    // the other sat in the drawer looking like a control and doing nothing.
    const bar = HTML.slice(HTML.indexOf('id="focus-bar"'));
    const ids = [...bar.matchAll(/id="(focus-[a-z-]+)"/g)].map((match) => match[1]);

    expect(ids.length).toBeGreaterThan(10);
    expect([...new Set(ids)]).toHaveLength(ids.length);
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

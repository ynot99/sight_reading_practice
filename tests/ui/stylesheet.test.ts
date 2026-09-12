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
  it('scrolls the squares inside their sheet', () => {
    // The panel has a height and hides what overflows it. `.controls` was given
    // a scroll of its own when the metronome sheet outgrew its panel; the modes
    // grid never was, so on a short window - a phone upright, or a browser
    // window not much taller than it is wide - the last row of squares was cut
    // off with no scrollbar and no way down to it. His report, from a phone.
    const grid = rules().find((rule) => rule.selector === '.modes');

    expect(grid?.body).toMatch(/overflow-y\s*:\s*auto/);
    // Filling the sheet is what lets it scroll, and without this the rows
    // would stretch to share the room wherever there is room to share.
    expect(grid?.body).toMatch(/min-height\s*:\s*0/);
    expect(grid?.body).toMatch(/align-content\s*:\s*start/);
  });

  it('brings each satellite in over the bar before it leaves the screen', () => {
    // The bar is centred and about 420px wide, so the room beside it is half of
    // whatever the screen has over that - and the left pill is four buttons to
    // the right pill's two. Measured in a real browser: the left needs some
    // 890px of screen and the right about 680, so they cross over at different
    // widths. One breakpoint of 560px served both, and the left pill stood
    // 175px off the side of a phone held upright, which is where he found it,
    // and 45px off an 820px window long before anything looked like a phone.
    const aside = /@media \(max-width: (\d+)px\) \{\s*\.focus-aside \{/.exec(CSS);
    const both = /@media \(max-width: (\d+)px\) \{\s*\.focus-aside,\s*\.focus-record \{/.exec(
      CSS,
    );
    const joined = rules().find((rule) => rule.selector === '.focus-aside, .focus-record');

    expect(Number(aside?.[1] ?? 0)).toBeGreaterThanOrEqual(890);
    expect(Number(both?.[1] ?? 0)).toBeGreaterThanOrEqual(680);
    // And narrower still they hang off nothing at all. Above the bar is no
    // answer on a phone: below 560px the tempo leaves the transport row, the
    // bar narrows to 294px, and two pills at its two edges overlap by 56. They
    // join the column the bar already is instead.
    expect(joined?.body).toMatch(/position\s*:\s*static/);
  });

  it('keeps a slider inside the column it is given', () => {
    // A range input carries `margin: 2px` from the browser's own sheet, and a
    // margin sits outside a width of 100%: a slider in the last column stood
    // 2px past the pane, and a pane that scrolls down grew a bar across as
    // well. Two pixels, under the whole form. Which section it showed up in
    // followed the column count rather than the pane, which is why it came and
    // went - measured in a real browser, because jsdom lays nothing out.
    const stretched = rules().find(
      (rule) => rule.selector === ".control-group > select, .control-group > input[type='range']",
    );
    const slider = rules().find(
      (rule) => rule.selector === ".control-group > input[type='range']",
    );

    expect(stretched?.body).toMatch(/width\s*:\s*100%/);
    expect(slider?.body).toMatch(/margin\s*:\s*0/);
  });

  it('matches a pane as a list, because one box belongs to four', () => {
    // The box of checkboxes is shared - its labels are page's, playing's,
    // modes' and sound's - so it names all four and the showing rules have to
    // match one word of several. With `=` it could name none, and a box naming
    // no pane is a cell in *every* pane: an empty one, holding a column of the
    // grid open, which is what put Practice a third of the way in from the
    // left. His report.
    const showing = rules().filter((rule) => rule.selector.includes("[data-showing='"));

    expect(showing).toHaveLength(1);
    expect(showing[0]?.selector).toContain('[data-pane~=');
    expect(showing[0]?.selector).not.toContain("[data-pane='");
  });

  it('writes every variant below the rule it varies', () => {
    // A variant of a class weighs exactly what the class weighs, so between
    // `.sheet__panel` and `.sheet__panel--wide` nothing decides but which
    // comes last. The wide one stood above the base rule from the day it was
    // written: the settings sheet was 520px wide and 640px tall the whole
    // time, every number in the variant reached nothing, and the test beside
    // this one read that losing rule and believed what it said. Two of the
    // transport's buttons were losing their padding to the same mistake.
    //
    // Written over the whole sheet rather than the one component, because the
    // next variant will be somewhere else. jsdom applies no stylesheet, so
    // nothing else in the suite can see a declaration that never lands.
    const bases = new Map<string, number>();
    for (const rule of rules()) {
      if (/^\.[A-Za-z0-9_-]+$/.test(rule.selector) && !rule.selector.includes('--')) {
        if (!bases.has(rule.selector)) {
          bases.set(rule.selector, rule.at);
        }
      }
    }

    const above = rules().filter((rule) => {
      const base = /^(\.[A-Za-z0-9_-]+?)--[A-Za-z0-9-]+$/.exec(rule.selector)?.[1];
      return base !== undefined && bases.has(base) && rule.at < (bases.get(base) ?? 0);
    });

    expect(bases.size).toBeGreaterThan(20);
    expect(above.map((rule) => rule.selector)).toEqual([]);
  });

  it('draws the transport icons at a size it states, not one left over', () => {
    // An `<svg>` carries `overflow: hidden` from the browser's own sheet, so
    // as a flex item its automatic minimum size is zero: squeeze the box it
    // sits in and it rescales silently, with nothing in the file to say so.
    // These asked for 26px inside a content box of 14px for as long as they
    // existed, and were drawn at 14px. Fixing the padding they were squeezed
    // by nearly doubled every icon on the transport bar, which he saw at once.
    //
    // So the mark must fit the box with room to spare: then the number in the
    // file is the number on screen, and a padding changed later cannot quietly
    // resize it again.
    const button = rules().find((rule) => rule.selector === '.focus-bar__button--icon');
    const icon = rules().find((rule) => rule.selector === '.focus-bar__button--icon svg');
    const base = rules().find((rule) => rule.selector === '.focus-bar__button');
    const px = (body: string | undefined, property: string): number =>
      Number(new RegExp(property + ':\\s*(\\d+)px').exec(body ?? '')?.[1] ?? '0');

    const across = px(button?.body, 'width');
    const border = px(base?.body, 'border');
    const drawn = px(icon?.body, 'width');

    expect(across).toBeGreaterThan(0);
    expect(drawn).toBeGreaterThan(0);
    // No side padding to squeeze it, and small enough for the box that leaves.
    expect(button?.body).toMatch(/padding:\s*0;/);
    expect(drawn).toBeLessThanOrEqual(across - 2 * border);
  });

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

  it('stands the settings sections down the side, not across the top', () => {
    // The shape every settings window has, and his own examples: the system
    // settings, MuseScore, Reaper. The list stays put while the pane beside
    // it scrolls, so the reader can see where they are and what else there is
    // without losing either. jsdom applies no stylesheet, so the view tests
    // cannot see any of this.
    const body = rules().find((rule) => rule.selector === '.settings-body');
    const rail = rules().find((rule) => rule.selector === '.settings-sections');
    const pane = rules().find((rule) => rule.selector === '.settings-body > .controls');

    expect(body?.body).toMatch(/display\s*:\s*flex/);
    expect(rail?.body).toMatch(/flex-direction\s*:\s*column/);
    // A fixed rail and a pane that takes what is left: the list must not
    // shrink away as the pane fills up.
    expect(rail?.body).toMatch(/flex\s*:\s*0 0/);
    expect(pane?.body).toMatch(/overflow-y\s*:\s*auto/);

    // The marks beside the names are drawn rather than filled: the rest of
    // this page's icons are solid glyphs the size of a thumb, and a solid
    // shape the size of a word reads as a blot.
    const icon = rules().find((rule) => rule.selector === '.settings-sections__tab svg');
    expect(icon?.body).toMatch(/fill\s*:\s*none/);
    expect(icon?.body).toMatch(/stroke\s*:\s*currentColor/);
    // A box of its own rather than a letter on a line: inline, an svg sits on
    // the text baseline and hangs below the word it belongs to.
    expect(icon?.body).toMatch(/display\s*:\s*block/);

    // And the panel is wide enough for several columns of it: the rail takes
    // a fixed slice off the left before the settings get any of it.
    const panel = rules().find((rule) => rule.selector === '.sheet__panel--wide');
    const widest = Number(/width:\s*min\((\d+)px/.exec(panel?.body ?? '')?.[1] ?? '0');
    expect(widest).toBeGreaterThan(1000);

    // Spent on wider columns rather than more of them, which is the only way
    // a wider sheet reaches the controls: at the old 190px the grid answered
    // every extra 200px with another narrow column. `auto-fill`, not
    // `auto-fit` - Library holds a single group, and a collapsed track would
    // draw its slider across the whole width of the sheet.
    expect(pane?.body).toMatch(/repeat\(auto-fill,\s*minmax\(280px/);

    // And it holds one height rather than a ceiling. His report: the sheet
    // changed size as he moved down the rail, which moves the rail under his
    // finger - the panes hold between one group and thirteen. Written as one
    // number used twice, because a plain height would be cut back by the
    // ceiling every sheet carries, and that ceiling is right for the sheets
    // that really do fit what is in them.
    // Spelt so that `max-height` cannot answer for it: a word boundary sits
    // between the dash and the word, so a bare `\bheight` matches both of them.
    expect(panel?.body).toMatch(/(?<!-)height:\s*var\(--sheet-height\)/);
    expect(panel?.body).toMatch(/max-height:\s*var\(--sheet-height\)/);

    // And a tab is a row of a mark and a name, which nothing may undo. The
    // rules that decide panes are heavier than the tab's own - a class and
    // two attributes against a class and one - so writing the tab's rule
    // again does not settle it, which is what a
    // `.settings-sections__tab[data-pane] { display: flex }` was trying to do
    // while the chosen tab went on breaking into a column. It is settled by
    // the rail not claiming to be a pane, so nothing that decides panes can
    // reach a tab at all.
    const tab = rules().find((rule) => rule.selector === '.settings-sections__tab');
    const reaching = rules().filter(
      (rule) =>
        rule.selector.includes('.settings-sections__tab') &&
        rule.selector.includes('[data-pane'),
    );

    expect(tab?.body).toMatch(/display\s*:\s*flex/);
    expect(reaching).toEqual([]);
  });

  it('wraps a row of buttons rather than scrolling the form sideways', () => {
    // His report: a horizontal scrollbar in the settings, now and then. The
    // rows of two buttons are what did it. Their words never break - the words
    // are the button - so "Copy a judging log" beside "Save it as a file"
    // wants some 280px in a column of about 250, and a pane that scrolls one
    // way scrolls both. A wider sheet is no answer: the grid spends more room
    // on more columns of the same width. jsdom lays nothing out, so the rule
    // is the only place this can be read.
    const row = rules().find((rule) => rule.selector === '.ladder-row');
    const button = rules().find((rule) => rule.selector === '.ladder-row .button');

    expect(row?.body).toMatch(/flex-wrap\s*:\s*wrap/);
    // And the words stay whole: it is the row that gives way, not the label.
    expect(button?.body).toMatch(/white-space\s*:\s*nowrap/);
  });

  it('hangs both satellites off the bar, which stays in the middle', () => {
    // His: the middle pill is always in the middle. A reader looks for it
    // there, and it is the one thing on the page whose place must not depend
    // on what is beside it - which it did, for one commit, when the two were
    // laid out as a row and the bar was pushed along by its neighbour. Both
    // satellites are measured from the bar's own edges instead. jsdom lays
    // nothing out, so no view test can see the bar move.
    const bar = rules().find((rule) => rule.selector === '.focus-bar');
    const aside = rules().find((rule) => rule.selector === '.focus-aside');
    const record = rules().find((rule) => rule.selector === '.focus-record');
    const gone = rules().find(
      (rule) => rule.selector.includes('.focus-aside') && rule.body.includes('none'),
    );

    expect(bar?.body).toMatch(/position\s*:\s*fixed/);
    expect(bar?.body).toMatch(/left\s*:\s*50%/);
    expect(aside?.body).toMatch(/position\s*:\s*absolute/);
    expect(aside?.body).toMatch(/right\s*:\s*100%/);
    expect(record?.body).toMatch(/left\s*:\s*100%/);
    // One row each, and both aligned to the bar's foot: three pills of one
    // height along the bottom of the page read as three, and a stack of them
    // does not.
    expect(record?.body).not.toMatch(/flex-direction\s*:\s*column/);
    expect(aside?.body).not.toMatch(/flex-direction\s*:\s*column/);
    expect(record?.body).toMatch(/bottom\s*:\s*0/);
    expect(aside?.body).toMatch(/bottom\s*:\s*0/);
    // Nothing is reached for mid-run, and a bare page keeps none of it.
    expect(gone?.selector).toMatch(/data-playing/);
    expect(gone?.selector).toMatch(/data-bare/);
  });

  it('never lets a square change the size of the sheet it is in', () => {
    // Reported: pressing a square made the dialog jump. A square that gained
    // a state also gained 22 pixels of padding, which grew its row and the
    // whole panel with it - under the finger that had just pressed something
    // else. So a square's state may be said with paint and movement, never
    // with its box. jsdom lays nothing out, so no view test can see a jump.
    const states = rules().filter(
      (rule) => rule.selector.startsWith('.mode-card[') || rule.selector.includes(' .mode-card['),
    );

    for (const rule of states) {
      expect(rule.body).not.toMatch(/(^|[;{\s])(padding|margin|width|height|font-size|border-width)\s*:/);
    }
  });

  it('empties the bar down to the way out when only the page is wanted', () => {
    // The same rule mid-run follows, for the reader's own "just the music":
    // what stays is named, so anything added to the row goes by default.
    // jsdom applies no stylesheet, so without this the attribute could be set
    // on a bar that still shows everything and the view test would pass.
    const stripped = rules().find((rule) => rule.selector === "body[data-bare='true'] .focus-bar");
    const row = rules().find(
      (rule) =>
        rule.selector === "body[data-bare='true'] .focus-bar__row > *:not([data-bare])",
    );

    expect(stripped?.body).toMatch(/background\s*:\s*transparent/);
    expect(row?.body).toMatch(/display\s*:\s*none/);
    // The drawer goes with it, whatever the reader left open - and so does
    // the day's clock, which stands over the music from the other side of the
    // layout and would otherwise be the one thing left on a bare page.
    const hidden = rules().find(
      (rule) =>
        rule.selector.includes("[data-bare='true']") && rule.selector.includes('.focus-bar__drawer'),
    );
    expect(hidden?.body).toMatch(/display\s*:\s*none/);
    expect(hidden?.selector).toContain('.score__today');
    // The modes standing in the same corner go with it. A reader who asked
    // for the page alone did not mean "except those".
    expect(hidden?.selector).toContain('.score__modes');
  });

  it('lets the list of places scroll itself, and keeps the way in below it', () => {
    // Reported twice: the sheet would not scroll under the pointer. The list
    // is the scrolling thing, as it is in every other sheet here - a wheel
    // over a row turns the list the row is in, which is what a reader tries
    // first - and being capped is also what keeps the naming row in sight.
    // jsdom lays nothing out, so no view test can see a wheel do nothing.
    const list = rules().find((rule) => rule.selector === '.takes__list');
    const places = rules().find((rule) => rule.selector === '.places__list');

    expect(list?.body).toMatch(/overflow-y\s*:\s*auto/);
    expect(places?.body).toMatch(/max-height\s*:\s*min\(/);
    // Nothing else in the sheet may take the scrolling off it again.
    expect(rules().find((rule) => rule.selector === '.places')).toBeUndefined();
  });

  it('keeps the button in a row on one line, whatever is typed beside it', () => {
    // Reported: "Keep it" broke across two lines. A full-width box in a flex
    // row takes the row and leaves the button what is left, which in a narrow
    // sheet was not enough for two words. jsdom lays nothing out, so no view
    // test can see a button wrap.
    const button = rules().find((rule) => rule.selector === '.ladder-row .button');
    const box = rules().find((rule) => rule.selector === '.ladder-row .sheet__input');

    expect(button?.body).toMatch(/white-space\s*:\s*nowrap/);
    expect(button?.body).toMatch(/flex\s*:\s*none/);
    // The box is what gives up the room, so it has to be allowed to.
    expect(box?.body).toMatch(/min-width\s*:\s*0/);
  });

  it('marks the place the reader is in, in the list of places', () => {
    // The only thing that makes "where am I" visible in that list, and jsdom
    // applies no stylesheet, so the view test can see the attribute and
    // nothing at all about whether it shows.
    const here = rules().find(
      (rule) => rule.selector === ".takes__list button.places__go[aria-pressed='true']",
    );

    expect(here?.body).toMatch(/var\(--accent\)/);
  });

  it('dims a control with nothing to say rather than taking it away', () => {
    // His words: lower the opacity. Not `display: none` - a reader looking
    // for a setting that has gone has no way to find out that another one
    // took it - and not `disabled`, since nothing here contradicts anything
    // and setting a mode up before turning it on is reasonable. jsdom
    // applies no stylesheet, so no view test can see this.
    const dimmed = rules().find((rule) => rule.selector === ".controls [data-idle='true']");

    expect(dimmed?.body).toMatch(/opacity\s*:\s*0?\.\d+/);
    expect(dimmed?.body).not.toMatch(/display\s*:\s*none/);
  });

  it('gives the frame button a turn of its own to play', () => {
    // It stands in the squares' own grid now, so its size is theirs and
    // needs no rule. The turn still does: the squares get theirs from a
    // transition, which is right for two states, and this button has three -
    // two presses running can both leave it lit, and a transition from a
    // state to itself is no movement at all. jsdom runs no animation, so
    // nothing in the view tests can see it.
    const turn = rules().find((rule) => rule.selector === ".frame__choice[data-turning='true']");

    expect(turn?.body).toMatch(/animation\s*:\s*frame-turn/);
  });

  it('hides only what a repeat says it was called', () => {
    // The number in the corner says where in the playing this bar is, and the
    // marker, the report and the passage all count by it - so it can never be
    // what this takes away. jsdom applies no stylesheet, so no view test can
    // see which of the three went.
    const rule = rules().find((each) => each.selector.includes("data-repeats='hidden'"));

    expect(rule?.body).toMatch(/display\s*:\s*none/);
    expect(rule?.selector).toContain('.bar-printed');
    expect(rule?.selector).toContain('.repeat-mark');
    expect(rule?.selector).not.toContain('.bar-position');
  });

  it('takes the modes further back while the music is going', () => {
    // His: a reminder between runs and furniture during one. Not gone - a
    // reader glancing down mid-piece to check that survival really is on
    // should find the answer - but far enough back that the ink wins. jsdom
    // applies no stylesheet, so the attribute is all a view test can see.
    const faded = rules().find(
      (rule) => rule.selector === "body[data-playing='true'] .score__modes",
    );
    const opacity = /opacity\s*:\s*(0?\.\d+)/.exec(faded?.body ?? '');

    expect(opacity).not.toBeNull();
    expect(Number(opacity?.[1])).toBeLessThan(1);
    expect(Number(opacity?.[1])).toBeGreaterThan(0);
  });

  it('lets the page show through what stands over it', () => {
    // His: a mark in the corner that covers a note should leave enough of it
    // to be seen, and as much of it as the clock beside it does. One number
    // for both, because "as transparent as that" is one answer. jsdom
    // applies no stylesheet, so no view test can see through anything.
    const clock = rules().find((rule) => rule.selector === '.score__today');
    const mark = rules().find((rule) => rule.selector === '.score__mode');

    for (const rule of [clock, mark]) {
      expect(rule?.body).toMatch(/background:\s*color-mix\([^;]*var\(--over-the-page\)/);
      expect(rule?.body).toMatch(/transparent/);
    }
  });

  it('lets one corner place the clock and the modes beneath it', () => {
    // Asked for beside the pill, and beside is the stylesheet stacking them:
    // a second corner measured in pixels against the first lands on top of it
    // the moment either changes height, which the clock does as soon as a
    // streak gives it a second line. jsdom lays nothing out, so no view test
    // can see them collide.
    const corner = rules().find((rule) => rule.selector === '.score__corner');
    const clock = rules().find((rule) => rule.selector === '.score__today');
    const modes = rules().find((rule) => rule.selector === '.score__modes');

    expect(corner?.body).toMatch(/position\s*:\s*absolute/);
    expect(corner?.body).toMatch(/flex-direction\s*:\s*column/);
    expect(clock?.body).not.toMatch(/position\s*:\s*absolute/);
    expect(modes?.body).not.toMatch(/position\s*:\s*absolute/);
  });

  it('keeps quick replay off the bar until there is a run to replay', () => {
    // The row's one button the other way round: it survives a run like pause
    // and stop, and has nothing to say between runs, where the button that
    // begins a reading is Start. jsdom applies no stylesheet, so nothing in
    // the view tests can see this.
    const waiting = rules().find(
      (rule) =>
        rule.selector.includes('#focus-replay') && rule.selector.includes("data-playing='true'"),
    );

    expect(waiting?.body).toMatch(/display\s*:\s*none/);
    // And Stop keeps the same company: it has nothing to end between runs,
    // and a button greyed out over a page where nothing is happening is
    // furniture. It is not redundant, though - Play holds a run and Stop
    // ends one - so it is hidden rather than taken away.
    expect(waiting?.selector).toContain('#focus-stop');
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

  it('tells the three weights of the ruler apart at a glance', () => {
    // Reported from the page: the ruler was so faint he could barely see it,
    // and a division looked like a beat. A shade of difference is not a
    // difference when the thing behind it is notation, so the division is
    // dashed and the beats are not - and none of the three is a whisper.
    const rules_ = rules();
    const base = rules_.find((rule) => rule.selector === '.ruler-line');
    const beat = rules_.find((rule) => rule.selector === '.ruler-line--beat');
    const downbeat = rules_.find((rule) => rule.selector === '.ruler-line--downbeat');

    expect(base?.body).toMatch(/stroke-dasharray/);
    expect(beat?.body).toMatch(/stroke-dasharray\s*:\s*none/);
    expect(downbeat?.body).toMatch(/stroke-dasharray\s*:\s*none/);
    const opacity = (body: string | undefined): number =>
      Number.parseFloat(/opacity\s*:\s*(?:calc\()?\s*([\d.]+)/.exec(body ?? '')?.[1] ?? '0');
    expect(opacity(base?.body)).toBeGreaterThan(0.3);
    expect(opacity(downbeat?.body)).toBeGreaterThan(opacity(beat?.body));
    const width = (body: string | undefined): number =>
      Number.parseFloat(/stroke-width\s*:\s*([\d.]+)/.exec(body ?? '')?.[1] ?? '0');
    expect(width(downbeat?.body)).toBeGreaterThan(width(beat?.body));
    expect(width(beat?.body)).toBeGreaterThan(width(base?.body));
    // And one number turns all three down together, so that turning the
    // ruler down never turns a division into a beat.
    for (const rule of [base, beat, downbeat]) {
      expect(rule?.body).toContain('--ruler-strength');
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

  it('lets a list fill the sheet it is the whole point of', () => {
    // The 190px cap belongs to the desk panel, where the list sits under
    // everything else. Left to apply in a sheet it made a scroll box five
    // rows tall in the middle of a screen with room for thirty - and no test
    // that runs in jsdom can see a height, so the rule is checked here.
    const inSheet = rules().find((rule) => rule.selector === '.sheet .takes__list');

    expect(inSheet?.body).toMatch(/max-height\s*:\s*none/);
    expect(inSheet?.body).toMatch(/overflow-y\s*:\s*auto/);
    // Shrinking rather than growing, so three scores stay three rows tall.
    expect(inSheet?.body).toMatch(/flex\s*:\s*0\s+1\s+auto/);
  });

  it('gives the sheets room on a screen that has room', () => {
    // The panel is sized for the tablet held upright; on a desk monitor the
    // same 520px is a small window in the middle of an empty screen.
    const roomy = rules().find((rule) =>
      rule.selector.startsWith('.sheet__panel:not('),
    );

    expect(roomy).toBeDefined();
    expect(roomy?.body).toMatch(/width\s*:\s*min\(7[0-9]{2}px/);
    // And the two panels that have their own sizes are left out of it: a
    // question with two buttons under it does not want to be 760px wide.
    expect(roomy?.selector).toContain('--narrow');
    expect(roomy?.selector).toContain('--wide');
  });

  it('puts nothing of its own along the foot of the score', () => {
    // The transport bar is fixed to the bottom of the window, so anything
    // inside the score pinned to its bottom edge ends up behind it. Both the
    // page-turn arrows and the day counter were put there once, and neither
    // could be found on the page.
    const inTheScore = rules().filter((rule) => /^\.score__[a-z-]+$/.test(rule.selector));

    expect(inTheScore.length).toBeGreaterThan(1);
    for (const rule of inTheScore) {
      if (/position\s*:\s*absolute/.test(rule.body)) {
        expect(rule.body, rule.selector).not.toMatch(/\bbottom\s*:/);
      }
    }
  });

  it('lets everything in a sheet scroll inside it', () => {
    // The panel has a height and hides what overflows, so a group of
    // controls taller than the panel is cut off with no way down. This was
    // the wide panel's rule alone until the metronome sheet outgrew itself.
    const inSheets = rules().find((rule) => rule.selector === '.sheet__panel .controls');

    expect(inSheets?.body).toMatch(/overflow-y\s*:\s*auto/);
    // Without this a grid item refuses to shrink and scrolls nothing.
    expect(inSheets?.body).toMatch(/min-height\s*:\s*0/);
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

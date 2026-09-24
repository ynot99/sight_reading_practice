import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import type {
  EngraverAsk,
  EngraverLine,
  EngraverReply,
} from '../../src/infrastructure/rendering/verovio/engraverLine.js';
import {
  HEAP_BYTES_PER_CHARACTER,
  heapFor,
  VerovioCore,
  type PageShape,
} from '../../src/infrastructure/rendering/verovio/VerovioCore.js';
import { VerovioEngraver } from '../../src/infrastructure/rendering/verovio/VerovioEngraver.js';
import { longExercise, twoBarExercise } from '../support/fixtures.js';
import { lineToThe } from '../support/verovioLine.js';

/**
 * Verovio itself, in Node - the same engraver the worker runs, so nothing
 * here is a double of it. Started once for the file: compiling it is the
 * slowest thing in here.
 */
let core: VerovioCore;
beforeAll(async () => {
  core = await VerovioCore.start();
});

const serializer = new MusicXmlSerializer();
const WIDE: PageShape = { pageWidth: 2200, pageHeight: 1400, scale: 50 };

describe('Verovio, reading what the trainer prints', () => {
  it('lays out a printed exercise and draws it, every bar and note under its own name', () => {
    const pages = core.load(serializer.serialize(twoBarExercise()), WIDE);
    const svg = core.page(1);

    expect(pages).toBe(1);
    for (const name of ['m0', 'm1', 'n0-1-0-0', 'n0-2-0-0', 'n1-2-0-1', 'r1-2-1']) {
      expect(svg).toContain(`id="${name}"`);
    }
  });

  it('prints no header and no footer of its own', () => {
    // The trainer says what the piece is; a title at the head of every page
    // and a number at its foot are room taken from the music.
    core.load(serializer.serialize(twoBarExercise({ title: 'Called something' })), WIDE);

    expect(core.page(1)).not.toContain('Called something');
  });

  it('finds the page a bar is drawn on, and says when nothing is', () => {
    // A short page, so forty bars come to several.
    const pages = core.load(serializer.serialize(longExercise({ bars: 40 })), {
      pageWidth: 1400,
      pageHeight: 900,
      scale: 50,
    });

    expect(pages).toBeGreaterThan(2);
    expect(core.pageOf('m0')).toBe(1);
    expect(core.pageOf('m39')).toBe(pages);
    expect(core.pageOf('m40')).toBeNull();
  });

  it('lays the same score out again on a narrower page, which takes more of them', () => {
    const wide = core.load(serializer.serialize(longExercise({ bars: 40 })), WIDE);

    const narrow = core.relayout({ pageWidth: 1100, pageHeight: 1400, scale: 50 });

    expect(narrow).toBeGreaterThan(wide);
    // And every bar is still there to be found, on the new pages.
    expect(core.pageOf('m39')).toBe(narrow);
  });

  it('refuses a page that is not there', () => {
    const pages = core.load(serializer.serialize(twoBarExercise()), WIDE);

    expect(() => core.page(0)).toThrow(RangeError);
    expect(() => core.page(pages + 1)).toThrow(/no page 2; the score has 1/);
  });

  it('says so when a score cannot be read', () => {
    expect(() => core.load('this is not music', WIDE)).toThrow(/could not read the score/);
  });
});

describe('room for a large score, made before it is read', () => {
  it('asks for about what the longest score he has took', () => {
    // 10.8 million characters were read in 248 MB without the heap growing; it
    // must ask for at least that, and not so much more that the iPad runs out
    // asking - left to grow as it read, the heap came to 266 MB.
    const alkan = heapFor(10_822_714);

    expect(alkan).toBeGreaterThanOrEqual(248 * 1024 * 1024);
    expect(alkan).toBeLessThan(266 * 1024 * 1024);
    expect(heapFor(1_000)).toBe(1_000 * HEAP_BYTES_PER_CHARACTER);
  });

  it('leaves the heap alone for a score that fits in it', () => {
    const before = core.heapBytes;

    core.makeRoomFor(1_400_000);

    expect(core.heapBytes).toBe(before);
  });

  it('makes the room before reading, for the score it is about to read', () => {
    const making = vi.spyOn(core, 'makeRoomFor');
    const printed = serializer.serialize(twoBarExercise());

    core.load(printed, WIDE);

    expect(making).toHaveBeenCalledWith(printed.length);
    making.mockRestore();
  });

  it('grows the heap to hold a larger one', () => {
    const characters = Math.ceil((core.heapBytes + 32 * 1024 * 1024) / HEAP_BYTES_PER_CHARACTER);

    core.makeRoomFor(characters);

    expect(core.heapBytes).toBeGreaterThanOrEqual(heapFor(characters));
  });
});

describe('the engraver, asked across a line', () => {
  it('brings each answer back to the one who asked, however many are waiting', async () => {
    const engraver = new VerovioEngraver(lineToThe(core));

    const [pages, svg, page, nowhere] = await Promise.all([
      engraver.load(serializer.serialize(twoBarExercise()), WIDE),
      engraver.page(1),
      engraver.pageOf('m1'),
      engraver.pageOf('no-such-bar'),
    ]);

    expect(pages).toBe(1);
    expect(svg).toContain('id="n1-1-0-0"');
    expect(page).toBe(1);
    expect(nowhere).toBeNull();
  });

  it('finds the one who asked even when the answers come back in another order', async () => {
    // A worker answers in order; nothing here may depend on it.
    const asked: EngraverAsk[] = [];
    let reply: (reply: EngraverReply) => void = () => undefined;
    const engraver = new VerovioEngraver({
      send(ask) {
        asked.push(ask);
      },
      onReply(listener) {
        reply = listener;
      },
      onBroken() {
        // Never.
      },
      close() {
        // Nothing to let go of.
      },
    });
    const first = engraver.pageOf('m0');
    const second = engraver.pageOf('m1');

    for (const ask of [...asked].reverse()) {
      reply({ id: ask.id, ok: true, value: ask.question.type === 'pageOf' && ask.question.elementId === 'm0' ? 1 : 2 });
    }

    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
  });

  it('lays out again across the line', async () => {
    const engraver = new VerovioEngraver(lineToThe(core));
    const wide = await engraver.load(serializer.serialize(longExercise({ bars: 40 })), WIDE);

    const narrow = await engraver.relayout({ pageWidth: 1100, pageHeight: 1400, scale: 50 });

    expect(narrow).toBeGreaterThan(wide);
    // The pages of the new layout, which is where the last bar now ends.
    await expect(engraver.pageOf('m39')).resolves.toBe(narrow);
  });

  it('hands a failure back to the one who asked, and goes on answering', async () => {
    const engraver = new VerovioEngraver(lineToThe(core));
    await engraver.load(serializer.serialize(twoBarExercise()), WIDE);

    await expect(engraver.page(9)).rejects.toThrow(/no page 9/);
    await expect(engraver.page(1)).resolves.toContain('id="m0"');
  });

  it('numbers every ask, so two alike are still two', async () => {
    const line = lineToThe(core);
    const engraver = new VerovioEngraver(line);
    await engraver.load(serializer.serialize(twoBarExercise()), WIDE);

    await Promise.all([engraver.page(1), engraver.page(1)]);

    const ids = line.sent.map((ask) => ask.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lets the far end go when it is let go of, failing what was waiting', async () => {
    let closed = false;
    const engraver = new VerovioEngraver({
      send() {
        // Asked, and never answered.
      },
      onReply() {
        // Nothing will come.
      },
      onBroken() {
        // Never.
      },
      close() {
        closed = true;
      },
    });
    const waiting = engraver.page(1);

    engraver.dispose();

    expect(closed).toBe(true);
    await expect(waiting).rejects.toThrow(/let go/);
    await expect(engraver.page(1)).rejects.toThrow(/let go/);
  });

  it('fails what is waiting when the line breaks, and everything asked after', async () => {
    let breakIt: (reason: string) => void = () => undefined;
    const silent: EngraverLine = {
      send() {
        // Asked, and never answered: the worker is starting, or gone.
      },
      onReply() {
        // Nothing will come.
      },
      onBroken(listener) {
        breakIt = listener;
      },
      close() {
        // Nothing to let go of.
      },
    };
    const engraver = new VerovioEngraver(silent);
    const waiting = engraver.page(1);

    breakIt('The script did not load.');

    await expect(waiting).rejects.toThrow(/not there\. The script did not load/);
    await expect(engraver.pageOf('m0')).rejects.toThrow(/not there/);
  });
});

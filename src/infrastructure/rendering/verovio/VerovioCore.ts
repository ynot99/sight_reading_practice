import createVerovioModule, { type VerovioModule } from 'verovio/wasm';
import { enableLogToBuffer, VerovioToolkit } from 'verovio/esm';

/** The page Verovio lays the music out on, in its own units. */
export interface PageShape {
  readonly pageWidth: number;
  readonly pageHeight: number;
  /**
   * How large the SVG is written, as a percentage.
   *
   * Only the size of the drawing: the systems are broken by the page's width,
   * so music that reflows at another size is a page of another width, laid out
   * again.
   */
  readonly scale: number;
  /** Room above the music, in the page's units; Verovio's own where not said. */
  readonly pageMarginTop?: number;
}

/**
 * What every layout asks for, whatever the page.
 *
 * No header and no footer: the trainer prints its own title, and a page number
 * at the foot of every page is room taken from the music.
 */
const EVERY_LAYOUT = { breaks: 'auto', header: 'none', footer: 'none' } as const;

/**
 * Room in Verovio's heap for each character of a score.
 *
 * Measured on 2026-09-24: the Alkan's 10.8 million characters were read in a
 * heap of 248 MB without it growing, 24 bytes a character, and none of his
 * other 43 scores - the longest 1.4 million - grew the 128 MB it starts with at
 * all. One byte more, for a score a little denser; not many more, because the
 * heap grows in steps of a fifth, and asking past one step on the iPad costs a
 * whole one (28 a character came to 319 MB where 25 comes to 266).
 */
export const HEAP_BYTES_PER_CHARACTER = 25;

/** The heap is grown by asking for blocks of this size. */
const ROOM_BLOCK_BYTES = 16 * 1024 * 1024;

/** How much heap a score this long wants, in bytes. */
export function heapFor(characters: number): number {
  return characters * HEAP_BYTES_PER_CHARACTER;
}

/**
 * Verovio itself: a score read, laid out, and drawn a page at a time.
 *
 * On one thread and with no idea of any other, so the same object runs inside
 * the worker the page talks to and inside a test that talks to it directly.
 */
export class VerovioCore {
  private readonly module: VerovioModule;
  private readonly toolkit: VerovioToolkit;

  private constructor(module: VerovioModule) {
    this.module = module;
    // Into a buffer rather than the console: a long score has hundreds of
    // remarks about where a beam had room, and the one worth reading is the
    // reason a score would not open, which is read from here.
    enableLogToBuffer(1, module);
    this.toolkit = new VerovioToolkit(module);
  }

  /** Compiles the engraver; a few seconds on the iPad, which is why it runs apart. */
  static async start(): Promise<VerovioCore> {
    return new VerovioCore(await createVerovioModule());
  }

  /** How large the heap is now. It grows and never gives room back. */
  get heapBytes(): number {
    return this.module.HEAPU8.buffer.byteLength;
  }

  /**
   * Grows the heap to hold a score this long, before any of it is read.
   *
   * Grown while the score was being read, it held the iPad's page still - four
   * seconds, then a second twice, with the page's own timers late by three -
   * even from a worker; grown first, in one piece and let go, the longest the
   * page stood was half a second (`firstload.html`, docs/verovio.md on the
   * `verovio` branch).
   */
  makeRoomFor(characters: number): void {
    const wanted = heapFor(characters);
    // Taken a block at a time until the heap is that large, and all given
    // back. One block the size of what is missing would not do it: the heap
    // has room free inside it, and a block that fits there grows nothing.
    const held: number[] = [];
    while (this.heapBytes < wanted) {
      const block = this.module._malloc(ROOM_BLOCK_BYTES);
      if (block === 0) {
        // No more to be had. The score may still fit, and if it does not,
        // reading it is what says so.
        break;
      }
      held.push(block);
    }
    for (const block of held) {
      this.module._free(block);
    }
  }

  /** Reads a score and lays it out; the number of pages it came to. */
  load(musicXml: string, shape: PageShape): number {
    this.makeRoomFor(musicXml.length);
    this.toolkit.setOptions({ ...EVERY_LAYOUT, ...shape });
    if (!this.toolkit.loadData(musicXml)) {
      throw new Error(`Verovio could not read the score. ${this.toolkit.getLog()}`.trim());
    }
    return this.toolkit.getPageCount();
  }

  /** One page of the score laid out last, as SVG. Pages count from one. */
  page(page: number): string {
    const count = this.toolkit.getPageCount();
    if (!Number.isInteger(page) || page < 1 || page > count) {
      throw new RangeError(`There is no page ${String(page)}; the score has ${String(count)}.`);
    }
    return this.toolkit.renderToSVG(page);
  }

  /** Lays the same score out again on another page; the pages it came to. */
  relayout(shape: PageShape): number {
    this.toolkit.setOptions(shape);
    this.toolkit.redoLayout();
    return this.toolkit.getPageCount();
  }

  /**
   * The page an element is drawn on, by the name it was printed with, or
   * `null` when nothing is.
   *
   * A search of the whole score - about a millisecond for a bar and eight for
   * a note on the Alkan - so it is for a jump, not for every step.
   */
  pageOf(elementId: string): number | null {
    const page = this.toolkit.getPageWithElement(elementId);
    return page > 0 ? page : null;
  }
}

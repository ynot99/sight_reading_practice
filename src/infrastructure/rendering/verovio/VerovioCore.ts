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
  /** Room left of the music, in the page's units; Verovio's own where not said. */
  readonly pageMarginLeft?: number;
  /** Room right of the music, in the page's units; Verovio's own where not said. */
  readonly pageMarginRight?: number;
}

/**
 * What every layout asks for, whatever the page.
 *
 * No header and no footer: the trainer prints its own title, and a page number
 * at the foot of every page is room taken from the music. A number over every
 * second bar, as the page had under OSMD, rather than Verovio's one at the
 * start of each line: a reader finds a bar by its number, and the mark on a
 * bar read a second time stands beside it.
 */
const EVERY_LAYOUT = { breaks: 'auto', header: 'none', footer: 'none', mnumInterval: 2 } as const;

/**
 * Room in Verovio's heap for each character of a score.
 *
 * The heap grows in steps of about a fifth - 128, 184, 221, 266, 319 MB - so a
 * rate either lands on the step a score needs or asks for a whole step more,
 * which the iPad pays for and never gets back: the heap does not shrink.
 *
 * Measured on 2026-09-25 against the Alkan as printed now, 11.3 million
 * characters with every note named. Left to grow as it read, the heap went
 * from 128 MB to 221 MB. With room made first at 18 to 20 bytes a character
 * it stood at 221 MB before the reading and never moved during it; 22 made it
 * 266 MB, and the 25 used until then 319 MB - two steps the iPad paid for, and
 * the tab then closed when he imported a score on top of it. 19 is the middle
 * of the rates that land on the step. None of his other 43 scores - the
 * longest 1.4 million characters - asks for more than the 128 MB it starts
 * with.
 */
export const HEAP_BYTES_PER_CHARACTER = 19;

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

  /**
   * Reads a score and lays it out; the number of pages it came to.
   *
   * Says how large the heap is once room has been made for the score, and
   * before it is read: on the iPad a page that closes while a score is opened
   * has closed in one of the two, and the trail says which.
   */
  load(musicXml: string, shape: PageShape, roomMade?: (heapBytes: number) => void): number {
    this.makeRoomFor(musicXml.length);
    roomMade?.(this.heapBytes);
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

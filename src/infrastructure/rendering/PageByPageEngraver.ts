import {
  OpenSheetMusicDisplay,
  type BoundingBox,
  type GraphicalMusicPage,
} from 'opensheetmusicdisplay';

/**
 * The two hooks of the engraver's drawer this class steers it by: whether a
 * box is worth drawing, and drawing one page. Both are the drawer's own, and
 * protected, which is why they are named here rather than called directly.
 */
interface PageDrawer {
  isVisible(box: BoundingBox): boolean;
  drawPage(page: GraphicalMusicPage): void;
}

/**
 * The engraver, laying the whole piece out and drawing only the pages asked for.
 *
 * Laying out is cheap and drawing is not. Every note, stem and beam the
 * engraver draws is an element of its own, and they are all kept - on his
 * Alkan, 1342 bars on 331 pages, that is 254 000 elements and 1.2 GB more in
 * Chrome, and the iPad closes the tab. Laid out whole with two pages drawn it
 * is 4 000 elements and 0.43 GB, and the iPad keeps it; read through to the
 * end a page at a time, it keeps it too.
 *
 * Only the drawing is cut. The layout is whole, so the page breaks, the place
 * of every note and the marker's walk are exactly what they would be with
 * every page drawn, and a page drawn later is the same page - drawn in some
 * tens of milliseconds. The engraver's own `drawFromMeasureNumber` is not the
 * same thing: it lays the piece out again from where it starts, and the page
 * breaks would depend on where the reader began.
 */
export class PageByPageEngraver extends OpenSheetMusicDisplay {
  /** The pages the next engraving draws, or `null` for every one of them. */
  private toDraw: ReadonlySet<number> | null = null;
  /** The pages that are drawn now. */
  private readonly drawn = new Set<number>();

  /** Which pages the next engraving draws, by index; `null` for every page. */
  drawOnly(pages: Iterable<number> | null): void {
    this.toDraw = pages === null ? null : new Set(pages);
  }

  /** Lays the whole piece out again, drawing the pages asked for and no others. */
  override render(): void {
    // An engraving starts from blank pages, whatever was drawn before it.
    this.drawn.clear();
    super.render();
  }

  /** How many pages the piece was laid out on. */
  get pageCount(): number {
    return this.GraphicSheet?.MusicPages.length ?? 0;
  }

  isDrawn(page: number): boolean {
    return this.drawn.has(page);
  }

  /** Draws a page that is not drawn, and says whether it did. */
  drawPage(index: number): boolean {
    const page = this.GraphicSheet?.MusicPages[index];
    if (page === undefined || this.drawn.has(index)) {
      return false;
    }
    // Before drawing, because being drawn is what lets it past the gate.
    this.drawn.add(index);
    (this.Drawer as unknown as PageDrawer).drawPage(page);
    return true;
  }

  /**
   * Takes a page's drawing away and leaves the page, blank and its own size.
   *
   * Emptied before it is removed. The engraver's layout keeps a hold on much
   * of what it drew - a note on its group, a label on its text, a line on its
   * path - so an element taken off the page is not let go of, and a reader
   * who went through the whole piece would end up holding all of it again.
   * Every element emptied of its children and its attributes first, what is
   * still held is an empty shell: read to the end of the Alkan, that is 615 MB
   * in Chrome against 822 without it.
   */
  forgetPage(index: number): void {
    if (!this.drawn.delete(index)) {
      return;
    }
    const backend = this.Drawer.Backends[index];
    const sheet = backend?.getInnerElement().querySelector('svg') ?? null;
    // The page itself keeps its size: only what is drawn inside it goes.
    for (const element of sheet?.querySelectorAll('*') ?? []) {
      element.replaceChildren();
      for (const name of element.getAttributeNames()) {
        element.removeAttribute(name);
      }
    }
    backend?.clear();
  }

  /**
   * Makes every engraving from here on draw only the pages it was asked to.
   *
   * The drawer is made afresh for each engraving, here, so this is the one
   * place its gate can be set before anything is drawn.
   */
  protected override createOrRefreshRenderBackend(): void {
    super.createOrRefreshRenderBackend();
    const pages = new Map<object, number>(
      this.graphic.MusicPages.map((page, index) => [page, index]),
    );
    const drawer = this.drawer as unknown as PageDrawer;
    drawer.isVisible = (box: BoundingBox): boolean => {
      const index = pages.get(box.DataObject);
      // Only pages are gated. Everything inside a page is drawn when it is.
      if (index === undefined || this.drawn.has(index)) {
        return true;
      }
      if (this.toDraw !== null && !this.toDraw.has(index)) {
        return false;
      }
      this.drawn.add(index);
      return true;
    };
  }
}

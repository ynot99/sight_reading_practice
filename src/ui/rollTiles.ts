import {
  paintThePedal,
  paintTheGrid,
  paintTheRuler,
  type RollInks,
  type RollViewport,
  type Surface,
} from './rollPainter.js';
import type { RollScene } from './rollView.js';

/**
 * How big a tile is, in page pixels, both ways.
 *
 * Small enough that the tiles a screen needs are not much more than the
 * screen - on a tablet a page pixel is four of the screen's, and every tile
 * is held in memory whole - and big enough that crossing into a new one is
 * rare while scrolling.
 */
export const TILE_PX = 256;

/**
 * How many tiles are kept ready past each side of the screen, along the run
 * and across it.
 *
 * Along the run, two: a flick of a finger scrolls further in one frame than
 * a tile, and a tile painted after it is needed is a blank square. Across it,
 * one, because the rows mostly fill the screen and are scrolled rarely.
 */
const READY_ALONG = 2;
const READY_ACROSS = 1;

/** Spare canvases kept for tiles to come, rather than made and thrown away. */
const MOST_SPARE = 24;

/** The three lanes a run is painted in: see `drawTheRoll`. */
export interface RollLanes {
  readonly ruler: HTMLElement;
  readonly grid: HTMLElement;
  readonly pedal: HTMLElement;
}

/** The part of the grid on the screen, in the grid's own pixels. */
export interface TileView {
  readonly scrolledPx: number;
  readonly scrolledDownPx: number;
  readonly widePx: number;
  readonly tallPx: number;
}

/** How the run is being drawn: how wide a second is, and how tall a row. */
export interface RollLook {
  readonly pxPerSecond: number;
  readonly rowPx: number;
}

/** The first and last of a run of tiles, both included; `until` below `from` is none. */
export interface TileSpan {
  readonly from: number;
  readonly until: number;
}

/**
 * The tiles of one axis a view needs: those on the screen, and those kept
 * ready either side, and none past either end of the drawing.
 */
export function tilesAlong(scrolledPx: number, onScreenPx: number, wholePx: number, ready: number): TileSpan {
  const last = Math.ceil(wholePx / TILE_PX) - 1;
  return {
    from: Math.max(0, Math.floor(scrolledPx / TILE_PX) - ready),
    until: Math.min(last, Math.floor((scrolledPx + Math.max(0, onScreenPx - 1)) / TILE_PX) + ready),
  };
}

type Lane = keyof RollLanes;

/** A tile: where it is, and what it was last painted for. */
interface Tile {
  readonly lane: Lane;
  readonly canvas: HTMLCanvasElement;
  /** The zoom, the row and the screen's pixels it was painted at; empty until it is painted. */
  paintedFor: string;
  paintedWith: RollInks | null;
  widePx: number;
  tallPx: number;
}

/** A tile a view wants: where it goes, and whether it is on the screen or kept ready. */
interface Wanted {
  readonly key: string;
  readonly lane: Lane;
  readonly leftPx: number;
  readonly topPx: number;
  readonly widePx: number;
  readonly tallPx: number;
  readonly onScreen: boolean;
  readonly paint: (surface: Surface) => void;
}

/**
 * Paints a run in tiles that the page scrolls, rather than on a canvas that
 * stands still while the run scrolls under it.
 *
 * A canvas standing still has to be painted again for every step of a scroll,
 * and the page does the scrolling on its own and a frame sooner: the notes
 * went a frame behind everything else, in jerks, while the head - an element,
 * scrolled by the page - went smoothly. His: "скрол йде з ривками, але курсор
 * скролиться нормально". Tiles are part of what the page scrolls, so they go
 * with it as the head does, and are painted only when they come near the
 * screen: a scroll paints nothing at all until a new tile is needed.
 *
 * A tile stays where it is in the drawing's pixels whatever the zoom, and is
 * painted again where it stands when the zoom, the height of a row, the
 * screen's pixels or its colours change - the ones on the screen at once, and
 * the ones kept ready a frame later, so a pinch pays only for what it shows.
 */
export class RollTiles {
  private readonly lanes: RollLanes;
  private readonly tiles = new Map<string, Tile>();
  private readonly spare: HTMLCanvasElement[] = [];
  private paintedFor = '';
  private paintedWith: RollInks | null = null;
  private laterFrame: number | null = null;

  constructor(lanes: RollLanes) {
    this.lanes = lanes;
  }

  /** How many tiles are up, lane by lane: for the tests, and for the curious. */
  get count(): Readonly<Record<Lane, number>> {
    const counted = { ruler: 0, grid: 0, pedal: 0 };
    for (const tile of this.tiles.values()) {
      counted[tile.lane] += 1;
    }
    return counted;
  }

  /**
   * Puts up the tiles a view needs and takes down the ones it has left
   * behind, painting those on the screen that are not painted for how the run
   * is drawn now, and the ready ones a frame later.
   */
  show(scene: RollScene, look: RollLook, view: TileView, inks: RollInks, density: number): void {
    this.paintedFor = `${String(look.pxPerSecond)}:${String(look.rowPx)}:${String(density)}`;
    this.paintedWith = inks;
    const wholeWide = (scene.lengthMs / 1000) * look.pxPerSecond;
    const wholeTall = scene.rows * look.rowPx;
    const along = tilesAlong(view.scrolledPx, view.widePx, wholeWide, READY_ALONG);
    const across = tilesAlong(view.scrolledDownPx, view.tallPx, wholeTall, READY_ACROSS);
    const onScreenAlong = tilesAlong(view.scrolledPx, view.widePx, wholeWide, 0);
    const onScreenAcross = tilesAlong(view.scrolledDownPx, view.tallPx, wholeTall, 0);
    // Read before anything is written, so putting a tile up does not make the
    // next measurement wait for a layout.
    const rulerTall = this.lanes.ruler.clientHeight;
    const pedalTall = this.lanes.pedal.clientHeight;

    const paintAt = (column: number, row: number): RollViewport => ({
      scrolledPx: column * TILE_PX,
      scrolledDownPx: row * TILE_PX,
      pxPerSecond: look.pxPerSecond,
      rowPx: look.rowPx,
    });
    const wanted: Wanted[] = [];
    for (let column = along.from; column <= along.until; column += 1) {
      const leftPx = column * TILE_PX;
      const widePx = Math.min(TILE_PX, wholeWide - leftPx);
      const shownAlong = column >= onScreenAlong.from && column <= onScreenAlong.until;
      wanted.push(
        {
          key: `ruler:${String(column)}`,
          lane: 'ruler',
          leftPx,
          topPx: 0,
          widePx,
          tallPx: rulerTall,
          onScreen: shownAlong,
          paint: (surface) => {
            paintTheRuler(surface, scene, paintAt(column, 0), inks, density);
          },
        },
        {
          key: `pedal:${String(column)}`,
          lane: 'pedal',
          leftPx,
          topPx: 0,
          widePx,
          tallPx: pedalTall,
          onScreen: shownAlong,
          paint: (surface) => {
            paintThePedal(surface, scene, paintAt(column, 0), inks, density);
          },
        },
      );
      for (let row = across.from; row <= across.until; row += 1) {
        wanted.push({
          key: `grid:${String(column)}:${String(row)}`,
          lane: 'grid',
          leftPx,
          topPx: row * TILE_PX,
          widePx,
          tallPx: Math.min(TILE_PX, wholeTall - row * TILE_PX),
          onScreen: shownAlong && row >= onScreenAcross.from && row <= onScreenAcross.until,
          paint: (surface) => {
            paintTheGrid(surface, scene, paintAt(column, row), inks, density);
          },
        });
      }
    }

    const keys = new Set(wanted.map((tile) => tile.key));
    for (const [key, tile] of this.tiles) {
      if (!keys.has(key)) {
        this.takeDown(key, tile);
      }
    }
    const stale: Wanted[] = [];
    for (const want of wanted) {
      if (want.widePx <= 0 || want.tallPx <= 0) {
        continue;
      }
      const tile = this.putUp(want);
      if (tile.paintedFor === this.paintedFor && tile.paintedWith === inks) {
        continue;
      }
      if (want.onScreen) {
        this.paint(tile, want);
      } else {
        stale.push(want);
      }
    }
    this.paintLater(stale);
  }

  /** Takes every tile down and lets go of their pixels, for a drawing thrown away. */
  forget(): void {
    this.paintLater([]);
    for (const [key, tile] of [...this.tiles]) {
      this.takeDown(key, tile);
    }
    for (const canvas of this.spare) {
      // Safari keeps a canvas's pixels until they are asked for back.
      canvas.width = 0;
      canvas.height = 0;
    }
    this.spare.length = 0;
  }

  /**
   * Paints the tiles kept ready, in the next frame: they are off the screen,
   * and a pinch that paints them on every step pays twice for what it shows.
   * Asked again before then, the next asking says which are still wanted.
   */
  private paintLater(stale: readonly Wanted[]): void {
    const view = this.lanes.grid.ownerDocument.defaultView;
    if (this.laterFrame !== null) {
      view?.cancelAnimationFrame(this.laterFrame);
      this.laterFrame = null;
    }
    if (stale.length === 0) {
      return;
    }
    const paintedFor = this.paintedFor;
    const paintedWith = this.paintedWith;
    const paint = (): void => {
      this.laterFrame = null;
      for (const want of stale) {
        const tile = this.tiles.get(want.key);
        if (tile !== undefined && (tile.paintedFor !== paintedFor || tile.paintedWith !== paintedWith)) {
          this.paint(tile, want);
        }
      }
    };
    if (view === null || typeof view.requestAnimationFrame !== 'function') {
      paint();
      return;
    }
    this.laterFrame = view.requestAnimationFrame(paint);
  }

  /** The tile a view wants, put up where it goes if it was not up already. */
  private putUp(want: Wanted): Tile {
    const had = this.tiles.get(want.key);
    if (had !== undefined) {
      if (had.widePx !== want.widePx || had.tallPx !== want.tallPx) {
        // The last one along, which the run's end cuts off where the zoom says.
        had.canvas.style.width = `${String(want.widePx)}px`;
        had.canvas.style.height = `${String(want.tallPx)}px`;
        had.widePx = want.widePx;
        had.tallPx = want.tallPx;
        had.paintedFor = '';
      }
      return had;
    }
    const canvas = this.spare.pop() ?? this.lanes.grid.ownerDocument.createElement('canvas');
    canvas.className = 'roll__tile';
    canvas.style.left = `${String(want.leftPx)}px`;
    canvas.style.top = `${String(want.topPx)}px`;
    canvas.style.width = `${String(want.widePx)}px`;
    canvas.style.height = `${String(want.tallPx)}px`;
    this.lanes[want.lane].append(canvas);
    const tile: Tile = {
      lane: want.lane,
      canvas,
      paintedFor: '',
      paintedWith: null,
      widePx: want.widePx,
      tallPx: want.tallPx,
    };
    this.tiles.set(want.key, tile);
    return tile;
  }

  private paint(tile: Tile, want: Wanted): void {
    const canvas = tile.canvas;
    // Its size is known, so the painter is told it rather than made to ask
    // the page, which would lay the page out once for every tile.
    want.paint({
      clientWidth: want.widePx,
      clientHeight: want.tallPx,
      get width() {
        return canvas.width;
      },
      set width(value: number) {
        canvas.width = value;
      },
      get height() {
        return canvas.height;
      },
      set height(value: number) {
        canvas.height = value;
      },
      getContext: (kind) => canvas.getContext(kind),
    });
    tile.paintedFor = this.paintedFor;
    tile.paintedWith = this.paintedWith;
  }

  private takeDown(key: string, tile: Tile): void {
    tile.canvas.remove();
    this.tiles.delete(key);
    if (this.spare.length < MOST_SPARE) {
      this.spare.push(tile.canvas);
    } else {
      tile.canvas.width = 0;
      tile.canvas.height = 0;
    }
  }
}

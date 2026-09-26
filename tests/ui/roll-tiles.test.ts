// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RollTiles, TILE_PX, tilesAlong, type RollLanes } from '../../src/ui/rollTiles.js';
import { drawTheRoll, theLanesOf, theSceneOfTheRoll, type RollScene } from '../../src/ui/rollView.js';
import type { RollInks } from '../../src/ui/rollPainter.js';
import type { RunRoll } from '../../src/application/session/RunRoll.js';

const INKS = { font: 'serif' } as RollInks;

/** A run of `seconds` seconds, a note a second. */
function sceneOf(seconds: number): RollScene {
  const roll: RunRoll = {
    presses: Array.from({ length: seconds }, (_unused, at) => ({
      midi: 60 + (at % 5),
      downAtMs: at * 1000,
      upAtMs: at * 1000 + 400,
      velocity: 0.5,
      verdict: 'correct' as const,
      stepIndex: at,
      deviationMs: null,
    })),
    beats: [],
    pedal: [],
    rushes: [],
    truncated: false,
  };
  return theSceneOfTheRoll({ roll, barLabel: () => null });
}

/** Which canvases have been painted, and how often. */
let painted: Map<HTMLCanvasElement, number>;

beforeEach(() => {
  painted = new Map();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    // A canvas that takes every stroke and keeps only that it was cleared,
    // which a painting does once.
    return new Proxy(
      {},
      {
        get: (_target, name) =>
          name === 'clearRect'
            ? () => painted.set(this, (painted.get(this) ?? 0) + 1)
            : () => undefined,
        set: () => true,
      },
    ) as unknown as RenderingContext;
  });
});

/** Every set of tiles a test puts up, taken down after it: one kept ready is painted a frame later. */
const made: RollTiles[] = [];

function tilesIn(lanes: RollLanes): RollTiles {
  const tiles = new RollTiles(lanes);
  made.push(tiles);
  return tiles;
}

afterEach(() => {
  for (const tiles of made.splice(0)) {
    tiles.forget();
  }
  vi.restoreAllMocks();
});

function lanesOf(scene: RollScene): RollLanes {
  const lanes = theLanesOf(drawTheRoll(scene));
  if (lanes === null) {
    throw new Error('expected a drawing with lanes');
  }
  // jsdom lays nothing out; the ruler and the pedal lane are as tall as the
  // stylesheet makes them inside their borders.
  Object.defineProperty(lanes.ruler, 'clientHeight', { value: 19 });
  Object.defineProperty(lanes.pedal, 'clientHeight', { value: 15 });
  return lanes;
}

const look = { pxPerSecond: 100, rowPx: 10 };
const frame = (): Promise<void> =>
  new Promise((done) => {
    requestAnimationFrame(() => done());
  });
/** A screen 600 by 100 pixels of grid, scrolled to `scrolledPx`. */
const screen = (scrolledPx = 0) => ({ scrolledPx, scrolledDownPx: 0, widePx: 600, tallPx: 100 });
const lefts = (lane: HTMLElement): number[] =>
  [...lane.querySelectorAll<HTMLElement>('.roll__tile')]
    .map((tile) => Number.parseFloat(tile.style.left))
    .filter((left, at, all) => all.indexOf(left) === at)
    .sort((a, b) => a - b);

describe('which tiles a view needs', () => {
  it('covers the screen and keeps some ready either side', () => {
    // Two and a half tiles of screen, a little way in, and two ready each side.
    expect(tilesAlong(300, 640, 100 * TILE_PX, 2)).toEqual({ from: 0, until: 5 });
    expect(tilesAlong(10 * TILE_PX, 640, 100 * TILE_PX, 2)).toEqual({ from: 8, until: 14 });
  });

  it('goes no further than the drawing does', () => {
    expect(tilesAlong(0, 640, 300, 2)).toEqual({ from: 0, until: 1 });
    expect(tilesAlong(0, 640, 0, 2).until).toBeLessThan(0);
  });
});

describe('a run painted in tiles', () => {
  it('puts up the tiles on and near the screen in each lane, and paints each once', async () => {
    // A run of sixty seconds is six thousand pixels here; the screen shows six hundred.
    const scene = sceneOf(60);
    const lanes = lanesOf(scene);
    const tiles = tilesIn(lanes);

    tiles.show(scene, look, screen(), INKS, 1);
    await frame();

    expect(lefts(lanes.grid)).toEqual([0, 256, 512, 768, 1024]);
    expect(lefts(lanes.ruler)).toEqual(lefts(lanes.grid));
    expect(lefts(lanes.pedal)).toEqual(lefts(lanes.grid));
    expect([...painted.values()].every((times) => times === 1)).toBe(true);
    expect(painted.size).toBe(tiles.count.grid + tiles.count.ruler + tiles.count.pedal);
    // And under the head, which is the reader's and stands over the music.
    expect(lanes.grid.parentElement?.lastElementChild?.className).toBe('roll__head');
  });

  it('paints nothing on a scroll that needs no new tile', () => {
    const scene = sceneOf(60);
    const tiles = tilesIn(lanesOf(scene));
    tiles.show(scene, look, screen(), INKS, 1);
    painted.clear();

    tiles.show(scene, look, screen(40), INKS, 1);

    expect(painted.size).toBe(0);
  });

  it('paints the tiles a scroll comes to, and takes down the ones it has left', () => {
    const scene = sceneOf(60);
    const lanes = lanesOf(scene);
    const tiles = tilesIn(lanes);
    tiles.show(scene, look, screen(), INKS, 1);
    painted.clear();

    tiles.show(scene, look, screen(3000), INKS, 1);

    // The screen from 3000 to 3600 is tiles eleven to fourteen, and two more
    // either side.
    expect(lefts(lanes.grid)).toEqual([2304, 2560, 2816, 3072, 3328, 3584, 3840, 4096]);
    expect([...painted.keys()].every((canvas) => Number.parseFloat(canvas.style.left) >= 2304)).toBe(true);
  });

  it('cuts the last tile off where the run ends', () => {
    const scene = sceneOf(3);
    const lanes = lanesOf(scene);
    const tiles = tilesIn(lanes);

    tiles.show(scene, look, screen(), INKS, 1);

    const widths = [...lanes.grid.querySelectorAll<HTMLElement>('.roll__tile')].map((tile) => tile.style.width);
    // Three seconds and the second of air a roll ends with, at a hundred to the second.
    expect(scene.lengthMs).toBe(3400);
    expect(widths.sort()).toEqual(['256px', `${String(340 - 256)}px`].sort());
  });

  it('paints the tiles on the screen at once, and the ones kept ready a frame later', async () => {
    // So a pinch, which asks on every step, pays only for what it shows.
    const scene = sceneOf(60);
    const tiles = tilesIn(lanesOf(scene));

    tiles.show(scene, look, screen(), INKS, 1);

    const lefts = (): number[] => [...painted.keys()].map((canvas) => Number.parseFloat(canvas.style.left));
    expect(Math.max(...lefts())).toBe(512);
    await frame();
    expect(Math.max(...lefts())).toBe(1024);
  });

  it('repaints a tile where it stands, rather than putting up another', () => {
    const scene = sceneOf(60);
    const lanes = lanesOf(scene);
    const tiles = tilesIn(lanes);
    tiles.show(scene, look, screen(), INKS, 1);
    const before = [...lanes.grid.querySelectorAll('.roll__tile')];

    tiles.show(scene, { ...look, pxPerSecond: 120 }, screen(), INKS, 1);

    expect([...lanes.grid.querySelectorAll('.roll__tile')]).toEqual(before);
  });

  it('paints every tile afresh when the zoom, the rows or the colours change', async () => {
    const scene = sceneOf(60);
    const tiles = tilesIn(lanesOf(scene));
    tiles.show(scene, look, screen(), INKS, 1);
    // A dark ground, say: the same inks read again, and different.
    const dark = { ...INKS };

    for (const changed of [
      () => tiles.show(scene, { ...look, pxPerSecond: 120 }, screen(), INKS, 1),
      () => tiles.show(scene, { ...look, pxPerSecond: 120, rowPx: 12 }, screen(), INKS, 1),
      () => tiles.show(scene, { ...look, pxPerSecond: 120, rowPx: 12 }, screen(), dark, 1),
      () => tiles.show(scene, { ...look, pxPerSecond: 120, rowPx: 12 }, screen(), dark, 2),
    ]) {
      painted.clear();
      changed();
      await frame();
      expect(painted.size).toBe(tiles.count.grid + tiles.count.ruler + tiles.count.pedal);
    }
  });

  it('lets go of every tile when the drawing is thrown away', () => {
    const scene = sceneOf(60);
    const lanes = lanesOf(scene);
    const tiles = tilesIn(lanes);
    tiles.show(scene, look, screen(), INKS, 1);

    tiles.forget();

    expect(lanes.grid.querySelectorAll('.roll__tile')).toHaveLength(0);
    expect(tiles.count).toEqual({ ruler: 0, grid: 0, pedal: 0 });
  });
});

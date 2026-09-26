// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  asCanvasColour,
  paintThePedal,
  paintTheGrid,
  paintTheRuler,
  type RollInks,
  type RollViewport,
  type Surface,
} from '../../src/ui/rollPainter.js';
import { theSceneOfTheRoll, type RollScene } from '../../src/ui/rollView.js';
import type { RolledBeat, RolledPress, RunRoll } from '../../src/application/session/RunRoll.js';
import type { BeatWeight } from '../../src/application/ports/IMetronome.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { MIDI } from '../support/fixtures.js';

/** Every ink named by what it is for, so a mark painted says which it was. */
const INKS: RollInks = {
  wait: 'wait',
  row: 'row',
  line: 'line',
  division: 'division',
  downbeat: 'downbeat',
  given: 'given',
  rushed: 'rushed',
  ghost: 'ghost',
  ghostEdge: 'ghost-edge',
  late: 'late',
  note: 'note',
  correct: 'correct',
  wrong: 'wrong',
  aside: 'aside',
  tickDivision: 'tick-division',
  tickBeat: 'tick-beat',
  tickDownbeat: 'tick-downbeat',
  bar: 'bar',
  pedal: 'pedal',
  font: 'serif',
};

/** One thing painted: a box filled or outlined, a line, or some words. */
interface Mark {
  readonly how: 'fill' | 'stroke' | 'text';
  readonly ink: string;
  readonly x: number;
  readonly y: number;
  readonly wide: number;
  readonly tall: number;
  readonly corners?: number | readonly number[];
  readonly dashes?: readonly number[];
  readonly alpha: number;
  readonly words?: string;
}

/**
 * A canvas that writes down what is painted on it rather than painting it.
 *
 * jsdom has no canvas to paint on, and a picture is judged by what it has on
 * it: which marks, in which inks, where and in what order.
 */
class Recorder {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 1;
  globalAlpha = 1;
  font = '';
  textBaseline = '';
  readonly marks: Mark[] = [];
  transform: readonly number[] = [];
  private path: { x: number; y: number; wide: number; tall: number; corners?: number | readonly number[] } | null =
    null;
  private dashes: readonly number[] = [];

  setTransform(...values: number[]): void {
    this.transform = values;
  }
  clearRect(): void {}
  fillRect(x: number, y: number, wide: number, tall: number): void {
    this.marks.push({ how: 'fill', ink: this.fillStyle, x, y, wide, tall, alpha: this.globalAlpha });
  }
  beginPath(): void {
    this.path = null;
  }
  roundRect(x: number, y: number, wide: number, tall: number, corners: number | number[]): void {
    this.path = { x, y, wide, tall, corners };
  }
  rect(x: number, y: number, wide: number, tall: number): void {
    this.path = { x, y, wide, tall };
  }
  moveTo(x: number, y: number): void {
    this.path = { x, y, wide: 0, tall: 0 };
  }
  lineTo(x: number, y: number): void {
    if (this.path !== null) {
      this.path = { ...this.path, wide: x - this.path.x, tall: y - this.path.y };
    }
  }
  setLineDash(dashes: number[]): void {
    this.dashes = dashes;
  }
  fill(): void {
    if (this.path !== null) {
      this.marks.push({ how: 'fill', ink: this.fillStyle, ...this.path, alpha: this.globalAlpha });
    }
  }
  stroke(): void {
    if (this.path !== null) {
      this.marks.push({ how: 'stroke', ink: this.strokeStyle, ...this.path, dashes: this.dashes, alpha: this.globalAlpha });
    }
  }
  fillText(words: string, x: number, y: number): void {
    this.marks.push({ how: 'text', ink: this.fillStyle, x, y, wide: 0, tall: 0, words, alpha: this.globalAlpha });
  }

  /** The inks in the order they were first painted with. */
  get order(): string[] {
    return [...new Set(this.marks.map((mark) => mark.ink))];
  }

  inked(ink: string): Mark[] {
    return this.marks.filter((mark) => mark.ink === ink);
  }
}

function surface(widePx = 700, tallPx = 280): { surface: Surface; recorder: Recorder; asked: () => number } {
  const recorder = new Recorder();
  let asked = 0;
  return {
    recorder,
    asked: () => asked,
    surface: {
      clientWidth: widePx,
      clientHeight: tallPx,
      width: 0,
      height: 0,
      getContext: () => {
        asked += 1;
        return recorder as unknown as CanvasRenderingContext2D;
      },
    },
  };
}

const at = (over: Partial<RollViewport> = {}): RollViewport => ({
  scrolledPx: 0,
  scrolledDownPx: 0,
  pxPerSecond: 140,
  rowPx: 14,
  ...over,
});

function press(over: Partial<RolledPress> = {}): RolledPress {
  return {
    midi: MIDI.C4,
    downAtMs: 1000,
    upAtMs: 1500,
    velocity: 0.8,
    verdict: 'correct',
    stepIndex: 0,
    deviationMs: null,
    ...over,
  };
}

function beat(atMs: number, weight: BeatWeight, positionTicks: number): RolledBeat {
  return { atMs, weight, positionTicks };
}

function roll(over: Partial<RunRoll> = {}): RunRoll {
  return { presses: [], beats: [], pedal: [], rushes: [], truncated: false, ...over };
}

function sceneOf(input: RunRoll, over: { ghosts?: boolean; parts?: number } = {}): RollScene {
  return theSceneOfTheRoll({
    roll: input,
    barLabel: (ticks) =>
      ticks % (Duration.QUARTER.ticks * 4) === 0 ? String(ticks / (Duration.QUARTER.ticks * 4) + 1) : null,
    grid: { beats: true, parts: over.parts ?? 1 },
    ghosts:
      over.ghosts === true
        ? input.presses.map((each, index) => ({
            midi: each.midi,
            fromTicks: index * Duration.QUARTER.ticks,
            untilTicks: (index + 1) * Duration.QUARTER.ticks,
            stepIndex: each.stepIndex ?? index,
          }))
        : [],
  });
}

/** A bar of four at a second a beat, so a second and a beat are the same. */
function barsOfFour(bars: number): RolledBeat[] {
  return Array.from({ length: bars * 4 }, (_unused, index) =>
    beat(index * 1000, index % 4 === 0 ? 'downbeat' : 'beat', index * Duration.QUARTER.ticks),
  );
}

describe('painting the grid', () => {
  it('paints only the notes on the screen, however long the run', () => {
    // The whole of why it is painted: laid out as an element a mark, every
    // note of the run was placed whether it was on the screen or not.
    const presses = Array.from({ length: 1000 }, (_unused, index) =>
      press({ downAtMs: index * 1000, upAtMs: index * 1000 + 500, stepIndex: index }),
    );
    const { surface: canvas, recorder } = surface(700);

    // Five seconds of screen, a hundred seconds in.
    paintTheGrid(canvas, sceneOf(roll({ presses })), at({ scrolledPx: 14_000 }), INKS, 1);

    const painted = recorder.inked('correct');
    expect(painted.length).toBeGreaterThanOrEqual(5);
    expect(painted.length).toBeLessThanOrEqual(6);
  });

  it('places a note by the zoom and by how far the run is scrolled', () => {
    const scene = sceneOf(roll({ beats: barsOfFour(1), presses: [press({ downAtMs: 1000, upAtMs: 1500 })] }));
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at({ scrolledPx: 70, scrolledDownPx: 14 }), INKS, 1);

    const [note] = recorder.inked('correct');
    const row = scene.notes[0]?.row ?? 0;
    expect(note).toMatchObject({ x: 70, y: row * 14 - 14, tall: 14, corners: 2 });
    expect(note?.wide).toBeCloseTo(70, 6);
  });

  it('paints nothing of a row that is scrolled out of sight', () => {
    const scene = sceneOf(roll({ presses: [press({ midi: 40 }), press({ midi: 90 })] }));
    const { surface: canvas, recorder } = surface(700, 140);

    // Ten rows of a band of fifty-five, from the top.
    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('correct').map((mark) => mark.y)).toEqual([2 * 14]);
  });

  it('draws a note too short to see two pixels wide', () => {
    const scene = sceneOf(roll({ presses: [press({ downAtMs: 1000, upAtMs: 1001 })] }));
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('correct')[0]?.wide).toBe(2);
  });

  it('squares off a note still down when the run ended, and outlines one nothing was decided about', () => {
    const scene = sceneOf(
      roll({
        beats: barsOfFour(1),
        presses: [press({ upAtMs: null }), press({ midi: MIDI.C4 + 2, verdict: null })],
      }),
    );
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('correct')[0]?.corners).toEqual([2, 0, 0, 2]);
    // An outline, because a fill in any colour is a verdict and there was not one.
    expect(recorder.inked('note').map((mark) => mark.how)).toEqual(['stroke']);
  });

  it('colours each press by its verdict', () => {
    const scene = sceneOf(
      roll({
        presses: [
          press({ verdict: 'correct' }),
          press({ midi: MIDI.C4 + 2, verdict: 'wrong' }),
          press({ midi: MIDI.C4 + 4, verdict: 'duplicate' }),
        ],
      }),
    );
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('correct')).toHaveLength(1);
    expect(recorder.inked('wrong')).toHaveLength(1);
    expect(recorder.inked('aside')).toHaveLength(1);
  });

  it('lays the waits under the rows, the bands under the presses, and the capsules over them', () => {
    // The waits under the rows, which are a dark wash with the ground showing
    // through, so the black keys darken them - his "на чорні ноти також буде
    // темне жовтий колір". The capsules over the presses, because an outline
    // under the note that answered it is one nobody can see - his "чи можеш
    // зробити ghost ноти щоб вони малювалися поверх моїх нот".
    const scene = sceneOf(
      roll({
        beats: [beat(0, 'downbeat', 0), beat(400, 'downbeat', 0), beat(1400, 'beat', Duration.QUARTER.ticks)],
        presses: [press({ downAtMs: 700, upAtMs: 1200, stepIndex: 0 })],
      }),
      { ghosts: true },
    );
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    const order = recorder.order;
    expect(order.indexOf('wait')).toBeLessThan(order.indexOf('row'));
    expect(order.indexOf('late')).toBeLessThan(order.indexOf('correct'));
    expect(order.indexOf('correct')).toBeLessThan(order.indexOf('ghost'));
    // The capsule rimmed after it is filled, so the rim is on top.
    expect(order.indexOf('ghost')).toBeLessThan(order.indexOf('ghost-edge'));
  });

  it('makes a band as solid as the gap it stands for', () => {
    const scene = sceneOf(
      roll({ beats: barsOfFour(1), presses: [press({ downAtMs: 200, upAtMs: 800, stepIndex: 0 })] }),
      { ghosts: true },
    );
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('late')[0]?.alpha).toBe(scene.slips[0]?.strength);
    // And no solidity left behind it for whatever is painted next.
    expect(recorder.inked('correct')[0]?.alpha).toBe(1);
  });

  it('dashes the lines between the beats and draws the rest solid, each at its weight', () => {
    const scene = sceneOf(roll({ beats: barsOfFour(1) }), { parts: 2 });
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('division').every((mark) => mark.dashes?.join() === '3,3')).toBe(true);
    expect(recorder.inked('division').length).toBeGreaterThan(0);
    expect(recorder.inked('line').map((mark) => mark.wide)).toEqual([1, 1, 1]);
    expect(recorder.inked('downbeat').map((mark) => mark.wide)).toEqual([2]);
  });

  it('draws a bar line the reader gave, and a beat they overtook', () => {
    const scene = sceneOf(
      roll({
        beats: [beat(0, 'downbeat', 0), beat(300, 'downbeat', 0)],
        rushes: [{ atMs: 600, byMs: 100 }],
      }),
    );
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('given').map((mark) => mark.x)).toEqual([42]);
    expect(recorder.inked('rushed').map((mark) => mark.x)).toEqual([84]);
  });

  it('paints as many pixels as the screen has, and no more work where there is no screen', () => {
    const scene = sceneOf(roll({ presses: [press()] }));
    const sharp = surface(700, 280);

    paintTheGrid(sharp.surface, scene, at(), INKS, 2);

    expect([sharp.surface.width, sharp.surface.height]).toEqual([1400, 560]);
    expect(sharp.recorder.transform).toEqual([2, 0, 0, 2, 0, 0]);

    const none = surface(0, 280);
    paintTheGrid(none.surface, scene, at(), INKS, 1);
    expect(none.asked()).toBe(0);
  });
});

describe('painting the ruler and the pedal', () => {
  it('marks the ruler with the grid’s own lines, in the same places', () => {
    // A ruler with a metre of its own would be a second answer to what the bar is.
    const scene = sceneOf(roll({ beats: barsOfFour(2) }), { parts: 2 });
    const grid = surface();
    const ruler = surface(700, 19);

    paintTheGrid(grid.surface, scene, at({ scrolledPx: 100 }), INKS, 1);
    paintTheRuler(ruler.surface, scene, at({ scrolledPx: 100 }), INKS, 1);

    const xs = (recorder: Recorder, inks: string[]): number[] =>
      recorder.marks.filter((mark) => inks.includes(mark.ink)).map((mark) => mark.x).sort((a, b) => a - b);
    expect(xs(ruler.recorder, ['tick-beat', 'tick-downbeat'])).toEqual(xs(grid.recorder, ['line', 'downbeat']));
    // Tall for a bar, short for a beat, shorter for what falls between, all
    // standing on the foot of the ruler.
    const tall = (ink: string): number | undefined => ruler.recorder.inked(ink)[0]?.tall;
    expect([tall('tick-division'), tall('tick-beat'), tall('tick-downbeat')]).toEqual([4, 7, 11]);
    expect(ruler.recorder.inked('tick-beat').every((mark) => mark.y + mark.tall === 19)).toBe(true);
  });

  it('names each bar on the ruler, a little in from its line', () => {
    const scene = sceneOf(roll({ beats: barsOfFour(2) }));
    const { surface: canvas, recorder } = surface(700, 19);

    paintTheRuler(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('bar').map((mark) => [mark.words, mark.x, mark.y])).toEqual([
      ['1', 3, 3],
      ['2', 563, 3],
    ]);
    expect(recorder.font).toBe('10px serif');
  });

  it('keeps the name of a bar begun just off the left edge', () => {
    const scene = sceneOf(roll({ beats: barsOfFour(2) }));
    const { surface: canvas, recorder } = surface(700, 19);

    paintTheRuler(canvas, scene, at({ scrolledPx: 10 }), INKS, 1);

    expect(recorder.inked('bar').map((mark) => mark.words)).toEqual(['1', '2']);
  });

  it('paints the pedal for as long as it was down', () => {
    const scene = sceneOf(roll({ beats: barsOfFour(1), pedal: [{ downAtMs: 500, upAtMs: 2500 }] }));
    const { surface: canvas, recorder } = surface(700, 15);

    paintThePedal(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('pedal')).toMatchObject([{ x: 70, y: 4, tall: 7, corners: 4 }]);
    expect(recorder.inked('pedal')[0]?.wide).toBeCloseTo(280, 6);
  });
});

describe('the colours the drawing is painted in', () => {
  it('writes a colour mixed with transparency out as one every canvas takes', () => {
    expect(asCanvasColour('color(srgb 0.984314 0.74902 0.141176 / 0.26)')).toBe('rgba(251, 191, 36, 0.26)');
    expect(asCanvasColour('color(srgb 1 0 0)')).toBe('rgba(255, 0, 0, 1)');
    expect(asCanvasColour('rgb(74, 222, 128)')).toBe('rgb(74, 222, 128)');
  });
});

import type { Surface } from '../../src/ui/rollPainter.js';

/** One thing painted: a box filled or outlined, a line, or some words. */
export interface Mark {
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
  /** Where an ink that fades runs from and to, and its stops on the way. */
  readonly fade?: { readonly fromY: number; readonly toY: number; readonly stops: readonly [number, string][] };
}

/**
 * An ink that changes along a line, as painted with: said as the colour it
 * is most, so a mark in it is found by the ink it fades from.
 */
class RecordedGradient {
  readonly stops: [number, string][] = [];
  readonly fromY: number;
  readonly toY: number;

  constructor(fromY: number, toY: number) {
    this.fromY = fromY;
    this.toY = toY;
  }

  addColorStop(offset: number, colour: string): void {
    this.stops.push([offset, colour]);
  }

  /** Said as the colour most of its stops are, which is the ink it fades from. */
  toString(): string {
    const counted = new Map<string, number>();
    for (const [, colour] of this.stops) {
      counted.set(colour, (counted.get(colour) ?? 0) + 1);
    }
    return [...counted].sort((left, right) => right[1] - left[1])[0]?.[0] ?? '';
  }
}

/** A mark's ink and how it fades, whatever it was painted with. */
function inkOf(style: unknown): { readonly ink: string; readonly fade?: Mark['fade'] } {
  return style instanceof RecordedGradient
    ? { ink: String(style), fade: { fromY: style.fromY, toY: style.toY, stops: style.stops } }
    : { ink: String(style) };
}

/**
 * A canvas that writes down what is painted on it rather than painting it.
 *
 * jsdom has no canvas to paint on, and a picture is judged by what it has on
 * it: which marks, in which inks, where and in what order.
 */
export class Recorder {
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
  createLinearGradient(_fromX: number, fromY: number, _toX: number, toY: number): RecordedGradient {
    return new RecordedGradient(fromY, toY);
  }
  fill(): void {
    if (this.path !== null) {
      this.marks.push({ how: 'fill', ...inkOf(this.fillStyle), ...this.path, alpha: this.globalAlpha });
    }
  }
  stroke(): void {
    if (this.path !== null) {
      this.marks.push({
        how: 'stroke',
        ...inkOf(this.strokeStyle),
        ...this.path,
        dashes: this.dashes,
        alpha: this.globalAlpha,
      });
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

export function surface(widePx = 700, tallPx = 280): { surface: Surface; recorder: Recorder; asked: () => number } {
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

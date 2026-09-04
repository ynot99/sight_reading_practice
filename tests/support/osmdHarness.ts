/**
 * Lets the real engraver run under jsdom.
 *
 * OSMD measures text with a canvas, which jsdom does not provide, and reads
 * its width from `offsetWidth`, which jsdom always reports as zero. Supplying
 * both is enough to get a genuine SVG out of it - which is the only way to
 * check that things drawn over the notation actually land on it.
 */
export interface HarnessContainer {
  readonly element: HTMLElement;
}

const TEXT_WIDTH_PER_CHARACTER = 6;

export function installCanvasStub(): void {
  // jsdom lays nothing out, so it implements neither of these. The engraver
  // needs both the moment a cursor is shown: it paints itself with a gradient
  // and then asks to be scrolled into view.
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = () => undefined;
  }
  HTMLCanvasElement.prototype.getContext = (() => ({
    font: '',
    measureText: (text: string) => ({
      width: text.length * TEXT_WIDTH_PER_CHARACTER,
      height: 10,
    }),
    fillText: () => undefined,
    strokeText: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    scale: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    bezierCurveTo: () => undefined,
    quadraticCurveTo: () => undefined,
    arc: () => undefined,
    stroke: () => undefined,
    fill: () => undefined,
    clearRect: () => undefined,
    fillRect: () => undefined,
    // The cursor paints itself with a gradient, so showing one needs this.
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  })) as unknown as HTMLCanvasElement['getContext'];
}

/** A container the engraver will believe has a real width. */
export function createScoreContainer(width = 900): HTMLElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'offsetWidth', { value: width, configurable: true });
  document.body.append(element);
  return element;
}

/**
 * The frame and the box that scrolls inside it, arranged the way the real page
 * has them - the frame taller than the screen, because it is given a minimum
 * of one screen and then grows to what is engraved in it.
 *
 * Anything testing pages needs this: without a window height the engraver is
 * given an endless page and lays the piece out as one column, so a test about
 * turning would have nothing to turn.
 */
export function withLayout(container: HTMLElement, windowHeight: number): HTMLElement {
  const frame = document.createElement('div');
  frame.className = 'score';
  const scroller = document.createElement('div');
  scroller.className = 'score__scroll';
  container.replaceWith(frame);
  frame.append(scroller);
  scroller.append(container);
  frame.getBoundingClientRect = (() => ({
    left: 0,
    top: 0,
    bottom: 99_999,
    width: 900,
    height: 99_999,
  })) as Element['getBoundingClientRect'];
  // The box the page is drawn into fills the screen, which is what the
  // reading layout gives it - and what the page is sized against.
  scroller.getBoundingClientRect = (() => ({
    left: 0,
    top: 0,
    bottom: windowHeight,
    width: 900,
    height: windowHeight,
  })) as Element['getBoundingClientRect'];
  Object.defineProperty(window, 'innerHeight', { value: windowHeight, configurable: true });
  return scroller;
}

/** Y positions of the printed staff lines, read out of the drawn SVG. */
export function staffLineYs(container: HTMLElement): number[] {
  const ys: number[] = [];
  container.querySelectorAll('.staffline path').forEach((path) => {
    const match = /^M[\d.]+ ([\d.]+)L[\d.]+ ([\d.]+)$/.exec(path.getAttribute('d') ?? '');
    if (match !== null && match[1] === match[2] && match[1] !== undefined) {
      ys.push(Number.parseFloat(match[1]));
    }
  });
  return [...new Set(ys)].sort((left, right) => left - right);
}

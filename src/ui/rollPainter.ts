import {
  NARROWEST_PX,
  momentsIn,
  stretchesIn,
  type LineKind,
  type NoteShade,
  type RollScene,
} from './rollView.js';

/**
 * Which part of the drawing a canvas covers.
 *
 * Where its left and top edges are in the drawing, and how wide a second and
 * how tall a row are drawn: everything a scene placed in the run's own time
 * needs to be put on a canvas, and nothing it needs working out again.
 */
export interface RollViewport {
  readonly scrolledPx: number;
  readonly scrolledDownPx: number;
  readonly pxPerSecond: number;
  readonly rowPx: number;
}

/**
 * The colours the drawing is painted in, as the stylesheet names them.
 *
 * Read off it rather than written here, so the look of the drawing stays where
 * the look of everything else is, dark ground and light alike: see the
 * `--roll-ink-*` properties on `.roll`.
 */
export interface RollInks {
  readonly wait: string;
  readonly row: string;
  readonly line: string;
  readonly division: string;
  readonly downbeat: string;
  readonly given: string;
  readonly rushed: string;
  readonly ghost: string;
  readonly ghostEdge: string;
  readonly late: string;
  readonly note: string;
  readonly correct: string;
  readonly wrong: string;
  readonly aside: string;
  readonly tickDivision: string;
  readonly tickBeat: string;
  readonly tickDownbeat: string;
  readonly bar: string;
  readonly pedal: string;
  /** The typeface of the bar numbers, which is the page's. */
  readonly font: string;
}

/** Each ink, and the name the stylesheet gives it after `--roll-ink-`. */
export const INKS: Readonly<Record<Exclude<keyof RollInks, 'font'>, string>> = {
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
};

/**
 * A colour as a canvas is sure to take it.
 *
 * A colour mixed with transparency comes back from the page as
 * `color(srgb r g b / a)`, which Chrome's canvas takes and which nothing here
 * can check Safari's does. Written out as `rgba()` it is a colour every
 * canvas has taken since there were canvases.
 */
export function asCanvasColour(said: string): string {
  const mixed = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/.exec(
    said.trim(),
  );
  if (mixed === null) {
    return said;
  }
  const [red, green, blue] = [mixed[1], mixed[2], mixed[3]].map((part) =>
    Math.round(Math.min(1, Math.max(0, Number(part))) * 255),
  );
  return `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${mixed[4] ?? '1'})`;
}

/**
 * The inks of a drawing, read off the stylesheet through a mark of its own.
 *
 * Each ink is a custom property, and a custom property is read back as it was
 * written - `color-mix(...)` and all. Put through `color`, it comes back as the
 * colour it works out to on this page, on this ground.
 */
export function theInksOf(drawing: HTMLElement): RollInks {
  const probe = drawing.ownerDocument.createElement('span');
  probe.hidden = true;
  drawing.append(probe);
  const view = drawing.ownerDocument.defaultView;
  const read = (name: string): string => {
    probe.style.color = `var(--roll-ink-${name})`;
    return asCanvasColour(view?.getComputedStyle(probe).color ?? '');
  };
  const inks = Object.fromEntries(
    Object.entries(INKS).map(([key, name]) => [key, read(name)]),
  ) as Omit<RollInks, 'font'>;
  const font = view?.getComputedStyle(drawing).fontFamily ?? 'sans-serif';
  probe.remove();
  return { ...inks, font };
}

/** A canvas, as far as painting on one goes. */
export interface Surface {
  readonly clientWidth: number;
  readonly clientHeight: number;
  width: number;
  height: number;
  getContext(kind: '2d'): CanvasRenderingContext2D | null;
}

/** A canvas made ready for a picture: sized to the screen's pixels and cleared. */
interface Readied {
  readonly paint: CanvasRenderingContext2D;
  readonly widePx: number;
  readonly tallPx: number;
  /** A position on the screen's own pixels, so a line one pixel wide is one pixel and not two half ones. */
  readonly snap: (px: number) => number;
}

/**
 * Sizes a canvas's pixels to the screen's and clears it, or `null` where there
 * is nothing to size it to.
 *
 * As many pixels as the screen has, not as many as the page says: on a tablet
 * those are two or three to a page pixel, and a canvas of page pixels is drawn
 * at a half or a third of what the screen can show.
 */
function readied(surface: Surface, density: number): Readied | null {
  const widePx = surface.clientWidth;
  const tallPx = surface.clientHeight;
  if (widePx <= 0 || tallPx <= 0) {
    return null;
  }
  const wide = Math.round(widePx * density);
  const tall = Math.round(tallPx * density);
  if (surface.width !== wide) {
    surface.width = wide;
  }
  if (surface.height !== tall) {
    surface.height = tall;
  }
  const paint = surface.getContext('2d');
  if (paint === null) {
    return null;
  }
  paint.setTransform(density, 0, 0, density, 0, 0);
  paint.clearRect(0, 0, widePx, tallPx);
  return { paint, widePx, tallPx, snap: (px) => Math.round(px * density) / density };
}

/** Where on the canvas a moment of the run is, and which moments the canvas shows. */
function across(view: RollViewport, widePx: number) {
  const perMs = view.pxPerSecond / 1000;
  return {
    x: (ms: number): number => ms * perMs - view.scrolledPx,
    fromMs: view.scrolledPx / perMs,
    untilMs: (view.scrolledPx + widePx) / perMs,
    /** How many milliseconds a number of pixels is, for reaching a little past the edges. */
    ms: (px: number): number => px / perMs,
  };
}

/** A box with rounded corners, or square ones where the canvas cannot round them. */
function box(
  paint: CanvasRenderingContext2D,
  x: number,
  y: number,
  wide: number,
  tall: number,
  radii: number | readonly number[],
): void {
  paint.beginPath();
  if (typeof paint.roundRect === 'function') {
    paint.roundRect(x, y, wide, tall, typeof radii === 'number' ? radii : [...radii]);
  } else {
    paint.rect(x, y, wide, tall);
  }
}

/** How wide a line of the grid is drawn, in page pixels. */
const LINE_WIDE: Readonly<Record<LineKind | 'rushed', number>> = {
  division: 1,
  beat: 1,
  downbeat: 2,
  given: 2,
  rushed: 2,
};

/** The dashes a line between the beats is drawn in: see `--roll-ink-division`. */
const DASHES = [3, 3];

/** How round the corners of a note, a band and a capsule are. */
const CORNER_PX = 2;

function inkOfLine(inks: RollInks, kind: LineKind): string {
  switch (kind) {
    case 'division':
      return inks.division;
    case 'beat':
      return inks.line;
    case 'downbeat':
      return inks.downbeat;
    case 'given':
      return inks.given;
  }
}

function inkOfNote(inks: RollInks, shade: NoteShade): string {
  switch (shade) {
    case 'correct':
      return inks.correct;
    case 'wrong':
      return inks.wrong;
    case 'aside':
      return inks.aside;
    case 'unjudged':
      return inks.note;
  }
}

/**
 * Paints the part of the grid a canvas covers: see `RollTiles`.
 *
 * In the order the marks lie over one another, which is part of what they
 * say. The waits go under the rows, which are a dark wash with the ground
 * showing through, so a wait comes out darker where the black keys are - his
 * "на чорні ноти також буде темне жовтий колір", falling out of the order
 * rather than needing a colour of its own. The bands saying how far a note was
 * off go under the presses, being a stretch of ground; and the notes the music
 * asked for go over them, because an outline under the note that answered it
 * is an outline nobody can see. His: "чи можеш зробити ghost ноти щоб вони
 * малювалися поверх моїх нот".
 */
export function paintTheGrid(
  surface: Surface,
  scene: RollScene,
  view: RollViewport,
  inks: RollInks,
  density: number,
): void {
  const ready = readied(surface, density);
  if (ready === null) {
    return;
  }
  const { paint, widePx, tallPx, snap } = ready;
  const { x, fromMs, untilMs, ms } = across(view, widePx);
  const rowPx = view.rowPx;
  const y = (row: number): number => row * rowPx - view.scrolledDownPx;
  const shows = (row: number): boolean => y(row) + rowPx > 0 && y(row) < tallPx;
  const wide = (from: number, until: number): number => Math.max(NARROWEST_PX, x(until) - x(from));

  paint.fillStyle = inks.wait;
  for (const wait of stretchesIn(scene.waits, fromMs, untilMs)) {
    paint.fillRect(x(wait.fromMs), 0, x(wait.untilMs) - x(wait.fromMs), tallPx);
  }

  paint.fillStyle = inks.row;
  for (const row of scene.blackRows) {
    if (shows(row)) {
      paint.fillRect(0, y(row), widePx, rowPx);
    }
  }

  // A little past either edge, so a two-pixel line half off the screen is
  // still drawn half on it.
  for (const line of momentsIn(scene.lines, fromMs - ms(2), untilMs + ms(2))) {
    const left = snap(x(line.atMs));
    if (line.kind === 'division') {
      paint.strokeStyle = inks.division;
      paint.lineWidth = 1;
      paint.setLineDash(DASHES);
      paint.beginPath();
      paint.moveTo(left + 0.5, 0);
      paint.lineTo(left + 0.5, tallPx);
      paint.stroke();
      paint.setLineDash([]);
      continue;
    }
    paint.fillStyle = inkOfLine(inks, line.kind);
    paint.fillRect(left, 0, LINE_WIDE[line.kind], tallPx);
  }
  paint.fillStyle = inks.rushed;
  for (const rush of momentsIn(scene.rushes, fromMs - ms(2), untilMs + ms(2))) {
    paint.fillRect(snap(x(rush.atMs)), 0, LINE_WIDE.rushed, tallPx);
  }

  for (const slip of stretchesIn(scene.slips, fromMs, untilMs)) {
    if (!shows(slip.row)) {
      continue;
    }
    paint.globalAlpha = slip.strength;
    paint.fillStyle = slip.kind === 'late' ? inks.late : inks.rushed;
    box(paint, x(slip.fromMs), y(slip.row), x(slip.untilMs) - x(slip.fromMs), rowPx, CORNER_PX);
    paint.fill();
  }
  paint.globalAlpha = 1;

  for (const note of stretchesIn(scene.notes, fromMs - ms(NARROWEST_PX), untilMs)) {
    if (!shows(note.row)) {
      continue;
    }
    const left = x(note.fromMs);
    // Still down when the run ended, so it runs to the edge rather than stopping.
    const corners = note.open ? [CORNER_PX, 0, 0, CORNER_PX] : CORNER_PX;
    if (note.shade === 'unjudged') {
      // An outline, because a fill in any colour is a verdict and there was not one.
      paint.strokeStyle = inks.note;
      paint.lineWidth = 1;
      box(paint, left + 0.5, y(note.row) + 0.5, wide(note.fromMs, note.untilMs) - 1, rowPx - 1, corners);
      paint.stroke();
      continue;
    }
    paint.fillStyle = inkOfNote(inks, note.shade);
    box(paint, left, y(note.row), wide(note.fromMs, note.untilMs), rowPx, corners);
    paint.fill();
  }

  // A capsule the press sits inside: filled, so it is a container rather than
  // a pair of edges to measure between, and rimmed more heavily than it is
  // filled, or it has no rim.
  paint.lineWidth = 1;
  for (const ghost of stretchesIn(scene.ghosts, fromMs - ms(NARROWEST_PX), untilMs)) {
    if (!shows(ghost.row)) {
      continue;
    }
    const left = x(ghost.fromMs);
    const span = wide(ghost.fromMs, ghost.untilMs);
    paint.fillStyle = inks.ghost;
    box(paint, left, y(ghost.row), span, rowPx, CORNER_PX);
    paint.fill();
    paint.strokeStyle = inks.ghostEdge;
    box(paint, left + 0.5, y(ghost.row) + 0.5, span - 1, rowPx - 1, CORNER_PX);
    paint.stroke();
  }
}

/** How tall a tick on the ruler stands, and how wide: tall for a bar, short for a beat. */
const TICKS: Readonly<Record<LineKind, { readonly tall: number; readonly wide: number }>> = {
  division: { tall: 4, wide: 1 },
  beat: { tall: 7, wide: 1 },
  downbeat: { tall: 11, wide: 2 },
  given: { tall: 11, wide: 2 },
};

/** Where a bar's number stands, off its line: a little in and a little down. */
const BAR_NAME_IN_PX = 3;
const BAR_NAME_DOWN_PX = 3;
const BAR_NAME_PX = 10;
/** As wide as a bar's number might be, so one begun off the left edge is still drawn. */
const BAR_NAME_WIDEST_PX = 48;

function inkOfTick(inks: RollInks, kind: LineKind): string {
  switch (kind) {
    case 'division':
      return inks.tickDivision;
    case 'beat':
      return inks.tickBeat;
    case 'downbeat':
      return inks.tickDownbeat;
    case 'given':
      return inks.given;
  }
}

/**
 * Paints the part of the ruler a canvas covers: the metre, and the bars' numbers.
 *
 * Small and bright, at his asking: the grid's own grey is right behind the
 * music, where the lines must not compete with the notes, and wrong on a ruler
 * a metre long that is read at a glance from a music stand. Short enough that
 * the bar numbers still read over them.
 */
export function paintTheRuler(
  surface: Surface,
  scene: RollScene,
  view: RollViewport,
  inks: RollInks,
  density: number,
): void {
  const ready = readied(surface, density);
  if (ready === null) {
    return;
  }
  const { paint, widePx, tallPx, snap } = ready;
  const { x, fromMs, untilMs, ms } = across(view, widePx);
  for (const line of momentsIn(scene.lines, fromMs - ms(2), untilMs + ms(2))) {
    const tick = TICKS[line.kind];
    paint.fillStyle = inkOfTick(inks, line.kind);
    paint.fillRect(snap(x(line.atMs)), tallPx - tick.tall, tick.wide, tick.tall);
  }
  paint.fillStyle = inks.bar;
  paint.font = `${String(BAR_NAME_PX)}px ${inks.font}`;
  paint.textBaseline = 'top';
  for (const bar of momentsIn(scene.bars, fromMs - ms(BAR_NAME_WIDEST_PX), untilMs)) {
    paint.fillText(bar.name, x(bar.atMs) + BAR_NAME_IN_PX, BAR_NAME_DOWN_PX);
  }
}

/** Where a pedal span sits in its lane, and how round it is. */
const PEDAL_DOWN_PX = 4;
const PEDAL_TALL_PX = 7;
const PEDAL_CORNER_PX = 4;

/** Paints the part of the pedal lane a canvas covers. */
export function paintThePedal(
  surface: Surface,
  scene: RollScene,
  view: RollViewport,
  inks: RollInks,
  density: number,
): void {
  const ready = readied(surface, density);
  if (ready === null) {
    return;
  }
  const { paint, widePx } = ready;
  const { x, fromMs, untilMs, ms } = across(view, widePx);
  paint.fillStyle = inks.pedal;
  for (const span of stretchesIn(scene.pedal, fromMs - ms(NARROWEST_PX), untilMs)) {
    const left = x(span.fromMs);
    box(paint, left, PEDAL_DOWN_PX, Math.max(NARROWEST_PX, x(span.untilMs) - left), PEDAL_TALL_PX, PEDAL_CORNER_PX);
    paint.fill();
  }
}

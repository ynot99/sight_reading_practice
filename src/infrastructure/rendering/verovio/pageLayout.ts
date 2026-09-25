/**
 * Where things stand on a page Verovio drew, read off the drawing itself.
 *
 * Verovio writes every position into the SVG as numbers - a staff line is a
 * path from one point to another, a notehead is a glyph placed at a point -
 * so nothing here asks the browser to lay anything out. That is what lets the
 * same reading run on a page in the app and on a string in a test, and it is
 * the page and not a model of it: a staff is measured off its printed lines,
 * which is the lesson OSMD taught (its boxes moved with the ink).
 *
 * All of it in the page's own units, the inner `viewBox` - the margin Verovio
 * puts round the music included - so a position here and a position on the
 * screen differ by one scale, which the renderer applies.
 */

/** The five lines of one staff in one bar, top first. */
export interface StaffLines {
  readonly lines: readonly number[];
  readonly top: number;
  readonly bottom: number;
}

/**
 * A bar's number as the engraver printed it over the bar: where, how large,
 * and what it says.
 */
export interface NumberOnThePage {
  /** The middle of the figures, which is where Verovio places a number. */
  readonly x: number;
  /** Their baseline. */
  readonly y: number;
  /** How tall they are set. */
  readonly size: number;
  readonly text: string;
}

/** One bar across all of its staves, barline to barline. */
export interface BarOnThePage {
  readonly id: string;
  readonly left: number;
  readonly right: number;
  /** Top staff first. */
  readonly staves: readonly StaffLines[];
  /** The number printed over it, where one is: every other bar or so. */
  readonly number: NumberOnThePage | null;
}

/** One system: a line of bars across the page. */
export interface SystemOnThePage {
  readonly top: number;
  readonly bottom: number;
  readonly bars: readonly BarOnThePage[];
}

/** Where a notehead, or a rest, is drawn: the glyph's left edge and its middle. */
export interface HeadOnThePage {
  readonly x: number;
  readonly y: number;
  /**
   * A rest that is the whole of its bar, which the engraver sets in the
   * middle of the bar and not at the moment it begins.
   */
  readonly wholeBar: boolean;
}

export interface PageLayout {
  readonly width: number;
  readonly height: number;
  /** Top of the page first. */
  readonly systems: readonly SystemOnThePage[];
  /**
   * Every named note and rest the page draws, by its name. A rest nobody
   * draws has no place of its own on the page and is not here.
   */
  readonly heads: ReadonlyMap<string, HeadOnThePage>;
}

/**
 * The little of an SVG node this reads - enough for the browser's own and for
 * a parser's, so a test can hand it a string and the app a page.
 */
export interface SvgNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly childNodes: ArrayLike<SvgNode>;
  /** What a piece of text says; nothing for an element. */
  readonly nodeValue?: string | null;
  getAttribute?(name: string): string | null;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/** The music's own drawing: Verovio's inner SVG, which holds the page's units. */
const MUSIC = 'definition-scale';

/** Reads the page Verovio drew: its size, its systems and bars, and where each head stands. */
export function readThePage(page: SvgNode): PageLayout {
  const music = findByClass(page, MUSIC);
  if (music === null) {
    throw new Error('Not a page Verovio drew: it has no drawing of the music inside it.');
  }
  const box = (attribute(music, 'viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const [, , width, height] = box;
  if (width === undefined || height === undefined || !Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('Not a page Verovio drew: its drawing has no size.');
  }
  const reading: Reading = { systems: [], heads: new Map() };
  visit(music, { x: 0, y: 0 }, reading, null);
  return { width, height, systems: reading.systems, heads: reading.heads };
}

interface Offset {
  readonly x: number;
  readonly y: number;
}

interface Reading {
  readonly systems: SystemOnThePage[];
  readonly heads: Map<string, HeadOnThePage>;
}

/** The notehead or rest a glyph found below here would be the drawing of. */
interface Owner {
  readonly id: string;
  /** For a note, only the glyph inside its head is; a stem or a dot is not. */
  readonly inHead: boolean;
  readonly isRest: boolean;
  readonly wholeBar: boolean;
}

function visit(node: SvgNode, at: Offset, reading: Reading, owner: Owner | null): void {
  for (const child of elementsIn(node)) {
    const classes = classesOf(child);
    const here = moved(at, attribute(child, 'transform'));
    if (classes.has('system')) {
      reading.systems.push(systemAt(child, here, reading));
      continue;
    }
    visitElement(child, classes, here, reading, owner);
  }
}

function visitElement(
  element: SvgNode,
  classes: ReadonlySet<string>,
  at: Offset,
  reading: Reading,
  owner: Owner | null,
): void {
  const id = attribute(element, 'id');
  if (id !== null && classes.has('note')) {
    visit(element, at, reading, { id, inHead: false, isRest: false, wholeBar: false });
    return;
  }
  if (id !== null && (classes.has('rest') || classes.has('mRest'))) {
    visit(element, at, reading, { id, inHead: false, isRest: true, wholeBar: classes.has('mRest') });
    return;
  }
  if (owner !== null && classes.has('notehead')) {
    visit(element, at, reading, { ...owner, inHead: true });
    return;
  }
  if (owner !== null && element.nodeName === 'use' && (owner.inHead || owner.isRest)) {
    // The glyph's own translation is where it is placed, and it is already in
    // `at`: this is the head.
    reading.heads.set(owner.id, { x: at.x, y: at.y, wholeBar: owner.wholeBar });
    return;
  }
  visit(element, at, reading, owner);
}

function systemAt(system: SvgNode, at: Offset, reading: Reading): SystemOnThePage {
  const bars: BarOnThePage[] = [];
  collectBars(system, at, reading, bars);
  const tops = bars.flatMap((bar) => bar.staves.map((staff) => staff.top));
  const bottoms = bars.flatMap((bar) => bar.staves.map((staff) => staff.bottom));
  return {
    top: tops.length > 0 ? Math.min(...tops) : at.y,
    bottom: bottoms.length > 0 ? Math.max(...bottoms) : at.y,
    bars,
  };
}

function collectBars(node: SvgNode, at: Offset, reading: Reading, bars: BarOnThePage[]): void {
  for (const child of elementsIn(node)) {
    const classes = classesOf(child);
    const here = moved(at, attribute(child, 'transform'));
    const id = attribute(child, 'id');
    if (id !== null && classes.has('measure')) {
      bars.push(barAt(child, id, here, reading));
      continue;
    }
    collectBars(child, here, reading, bars);
  }
}

function barAt(bar: SvgNode, id: string, at: Offset, reading: Reading): BarOnThePage {
  const staves: StaffLines[] = [];
  let left = Infinity;
  let right = -Infinity;
  let number: NumberOnThePage | null = null;
  for (const child of elementsIn(bar)) {
    const classes = classesOf(child);
    if (classes.has('mNum')) {
      number = numberAt(child, moved(at, attribute(child, 'transform')));
      continue;
    }
    // Everything drawn for a note is inside the staff it is on; beside the
    // staves a bar holds only what joins them - barlines, slurs, words.
    if (!classes.has('staff')) {
      continue;
    }
    const here = moved(at, attribute(child, 'transform'));
    // Top line first, as Verovio writes them.
    const lines: number[] = [];
    for (const line of elementsIn(child)) {
      if (line.nodeName !== 'path') {
        continue;
      }
      const drawn = lineOf(attribute(line, 'd'));
      if (drawn === null) {
        continue;
      }
      lines.push(here.y + drawn.y);
      left = Math.min(left, here.x + drawn.from);
      right = Math.max(right, here.x + drawn.to);
    }
    staves.push({ lines, top: lines[0] ?? here.y, bottom: lines[lines.length - 1] ?? here.y });
    visit(child, here, reading, null);
  }
  return {
    id,
    left: Number.isFinite(left) ? left : at.x,
    right: Number.isFinite(right) ? right : at.x,
    staves,
    number,
  };
}

/**
 * A bar's number, from the text Verovio writes for it.
 *
 * The figures are set inside the text, a size given to them there - the text
 * itself says nought, so it takes no room of its own - and the text's own x
 * is left out where it is nought, which is at the start of a system.
 */
function numberAt(group: SvgNode, at: Offset): NumberOnThePage | null {
  const text = findByName(group, 'text');
  if (text === null) {
    return null;
  }
  const here = moved(at, attribute(text, 'transform'));
  const sizes: number[] = [];
  const figures: string[] = [];
  readTheText(text, sizes, figures);
  return {
    x: here.x + Number(attribute(text, 'x') ?? '0'),
    y: here.y + Number(attribute(text, 'y') ?? '0'),
    size: Math.max(0, ...sizes),
    // Without the line breaks the drawing is written with between its parts.
    text: figures.join('').replace(/\s+/g, ''),
  };
}

function readTheText(node: SvgNode, sizes: number[], figures: string[]): void {
  const size = Number.parseFloat(attribute(node, 'font-size') ?? '');
  if (Number.isFinite(size)) {
    sizes.push(size);
  }
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes[index];
    if (child?.nodeType === TEXT_NODE) {
      figures.push(child.nodeValue ?? '');
    } else if (child?.nodeType === ELEMENT_NODE) {
      readTheText(child, sizes, figures);
    }
  }
}

function findByName(node: SvgNode, name: string): SvgNode | null {
  for (const child of elementsIn(node)) {
    if (child.nodeName === name) {
      return child;
    }
    const found = findByName(child, name);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function elementsIn(node: SvgNode): SvgNode[] {
  const elements: SvgNode[] = [];
  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes[index];
    if (child !== undefined && child.nodeType === ELEMENT_NODE) {
      elements.push(child);
    }
  }
  return elements;
}

function findByClass(node: SvgNode, wanted: string): SvgNode | null {
  for (const child of elementsIn(node)) {
    if (classesOf(child).has(wanted)) {
      return child;
    }
    const found = findByClass(child, wanted);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

function attribute(node: SvgNode, name: string): string | null {
  return node.getAttribute?.(name) ?? null;
}

function classesOf(node: SvgNode): ReadonlySet<string> {
  return new Set((attribute(node, 'class') ?? '').split(/\s+/).filter((word) => word !== ''));
}

const TRANSLATION = /translate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)/;

function translationOf(transform: string | null): Offset | null {
  const found = transform === null ? null : TRANSLATION.exec(transform);
  if (found === null) {
    return null;
  }
  return { x: Number(found[1]), y: Number(found[2] ?? '0') };
}

/**
 * Where a group puts what is inside it.
 *
 * Only a translation moves a position: the scale Verovio writes beside one is
 * on the glyphs, which are placed at the point and drawn smaller round it.
 */
function moved(at: Offset, transform: string | null): Offset {
  const by = translationOf(transform);
  return by === null ? at : { x: at.x + by.x, y: at.y + by.y };
}

const LINE = /M\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*L\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/;

/** A straight horizontal line as Verovio writes a staff line: `M x y L x y`. */
function lineOf(d: string | null): { readonly from: number; readonly to: number; readonly y: number } | null {
  const found = d === null ? null : LINE.exec(d);
  if (found === null || found[2] !== found[4]) {
    return null;
  }
  const from = Number(found[1]);
  const to = Number(found[3]);
  return { from: Math.min(from, to), to: Math.max(from, to), y: Number(found[2]) };
}

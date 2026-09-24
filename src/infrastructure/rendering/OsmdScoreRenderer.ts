import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { PageByPageEngraver } from './PageByPageEngraver.js';
import type { RulerMark } from '../../application/rhythmRuler.js';
import type {
  DrawnPassage,
  IPassageMarkers,
  IScorePages,
  ScorePageState,
  IPlayedNoteOverlay,
  IScoreCursor,
  IScoreFade,
  IRhythmRuler,
  IScoreRenderer,
  IStuckMarker,
  ScoreReading,
  IScoreZoom,
  OverlayContext,
  PassageEnd,
  PlayedNote,
} from '../../application/ports/IScoreRenderer.js';
import {
  BAR_PRINTED_RISE,
  BAR_PRINTED_SCALE,
  drawHandSwitch,
  drawPassageMarker,
  drawRepeatMark,
  drawStartMarker,
  handUnder,
  HOLD_MS,
  markerUnder,
  REPEAT_MARK_GAP,
  REPEAT_MARK_RADIUS,
  TAP_SLACK_PX,
} from './furniture.js';
import {
  bracketShapes,
  gripAt,
  gripsOf,
  gripUnderPointer,
  measureAt,
  passageAfterTap,
  measureForDrag,
  pageTurnForDrag,
  passageAfterDrag,
  toDrawingPoint,
  type DrawnMeasure,
  type GripEnd,
  type PassageEdge,
} from './passageBrackets.js';
import {
  overflowBelow,
  visibleHeightOf,
  swipeDirection,
} from './pageTurns.js';
import { PAGE_LABEL_INSET, pageLabelText } from './pageLabel.js';
import { drawShape } from './overlayElements.js';
import { placesToBeginIn, walkEveryPlace } from './cursorWalk.js';
import { timeTheStart } from '../../shared/timeTheStart.js';
import { CursorNavigator, type ICursorPrimitive } from './CursorNavigator.js';
import { buildOverlayShapes, type PlayedMark } from './playedNoteShapes.js';
import {
  diatonicIndexOf,
  fitStaffGeometry,
  type DrawnNoteSample,
} from './staffGeometry.js';

export interface OsmdRendererOptions {
  readonly zoom?: number;
  readonly cursorColor?: string;
  /** The second marker's colour; a grey that keeps out of the reader's way. */
  readonly otherHandColor?: string;
  readonly drawTitle?: boolean;
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Engraver units to drawing units.
 *
 * Zoom is applied by shrinking the SVG viewBox rather than by moving anything
 * inside it, so this stays constant and an overlay drawn into the same SVG
 * scales along with the notation. A test pins the relationship against a real
 * rendering, so a change in the engraver fails loudly instead of quietly
 * sliding every mark off its note.
 */
const UNITS_TO_PIXELS = 10;
/**
 * How many times a page may be cut down to fit what is drawn on it.
 *
 * Every pass is a whole engraving and the reader is waiting for it, so this
 * is small on purpose: a score that has not settled in four passes is one
 * where the room itself is the problem, and cutting further will not find it.
 */
/** How long the engraver waits for a paint it may never be given. */
const PAINT_WAIT_MS = 50;

const FIT_PASSES = 4;

/**
 * How long the page fitting may spend re-engraving before it gives up.
 *
 * A pass costs a whole engraving of the whole score, and on a short piece that
 * is nothing. On a long one it is everything: measured on a thirteen-hundred
 * bar score, one engraving is twenty-one seconds, so the four passes below it
 * turned opening the piece into a hundred seconds of drawing - and each one
 * allocates the whole drawing again before the last is collected, which is
 * where a page and a half of memory came from. His: "навіть для компютера цей
 * score для малювання дуже важкий, та також щоб почати це грати - бо воно
 * досить довго думає як стартувати".
 *
 * Set so that nothing the reader actually owns loses a pass. An engraving of
 * one of his arrangements is a fraction of a second, so all four still fit
 * inside this and the page goes on being fitted exactly as he asked for it to
 * be; only a score whose single engraving is measured in seconds spends its
 * way out, and by then the choice is between a clipped system and a minute and
 * a half of waiting.
 */
const FIT_BUDGET_MS = 2_000;

/**
 * How many fitting passes are worth paying for, given what one engraving costs.
 *
 * The thing being bought is a page that does not clip its last system. It is
 * worth several engravings when an engraving is a few milliseconds, and worth
 * none at all when one is twenty seconds: a reader waiting a hundred seconds
 * for a piece has a worse page than a reader looking at one clipped system, and
 * they can still zoom, which re-engraves and fits again at a moment of their
 * choosing rather than at the worst one.
 *
 * Its own function because it is the whole of the judgement and none of the
 * drawing, and a judgement inside a method that needs a browser is a judgement
 * no test can reach.
 */
export function fittingPassesWorth(engravedMs: number): number {
  if (!Number.isFinite(engravedMs) || engravedMs <= 0) {
    return FIT_PASSES;
  }
  return Math.min(FIT_PASSES, Math.floor(FIT_BUDGET_MS / engravedMs));
}

/**
 * Waits for the browser to have painted whatever was last asked of it.
 *
 * Two frames, because one only reaches the frame this change is already in.
 * Falls back to a turn of the task queue where there are no frames - a
 * headless test, a hidden tab - which yields just as well and never hangs.
 */
function afterTheBrowserHasDrawn(): Promise<void> {
  return new Promise((done) => {
    let answered = false;
    const once = (): void => {
      if (!answered) {
        answered = true;
        done();
      }
    };
    // Whichever comes first, and a timer is always one of them. A frame is
    // not promised: Safari stops giving them to a page it does not consider
    // visible, and on the iPad that included the moment a score was being
    // opened - so a wait for two frames was a wait for ever, and the page
    // simply stopped. His: "на айпаді здається сторінка взагалі поламалась".
    //
    // Nothing is lost by the timer winning. The frame is only wanted so the
    // browser can paint what the page has already said; a turn of the task
    // queue gives it the same chance, and where it does not, the engraving
    // goes ahead un-announced rather than not at all.
    setTimeout(once, PAINT_WAIT_MS);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(once));
    }
  });
}

/** A number the engraver printed, as it was read off the page. */
interface PrintedNumber {
  readonly node: SVGTextElement;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

/** The page's own clock, or the calendar's where there is no page. */
function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
/**
 * How close to a bar number a text has to be to *be* that bar's number.
 *
 * The engraver draws it just above and just left of the bar line, a few units
 * out. Bars are more than a hundred units apart, so nothing else can be
 * mistaken for it.
 */
const NUMBER_REACH = 14;

/** A staff is five lines. This is that sentence, used as arithmetic. */
const STAFF_LINES = 5;

/**
 * The five lines of the staff, among everything horizontal drawn with them.
 *
 * Two other things share that group, and each defeats one test on its own.
 * A **ledger line** sits exactly on the staff's own grid - that is what a
 * ledger *is* - so spacing alone cannot tell it apart; its length can, being
 * a couple of note-widths against a line that runs a whole measure. A
 * **bracket** - the pedal's above all, and this reader's library is two
 * thousand of them - runs most of a system, so length alone cannot tell that
 * apart; its spacing can, since it lies nowhere on the staff's grid.
 *
 * So both, and neither as a threshold: among every run of five evenly spaced
 * lines, the one whose shortest line is longest. A staff is five equally
 * spaced lines that run the width of the music, and that sentence is the
 * whole of the rule. No number in it has to be guessed, which matters -
 * measured against the widest line in the group, a bracket that happened to
 * outrun every staff line would have thrown all five of them away.
 */
export function staffLinesIn(
  rules: readonly { readonly y: number; readonly from: number; readonly to: number }[],
): number[] {
  const longest = new Map<number, number>();
  for (const rule of rules) {
    const y = rule.y;
    longest.set(y, Math.max(longest.get(y) ?? 0, rule.to - rule.from));
  }
  const ys = [...longest.keys()].sort((left, right) => left - right);

  let best: number[] = [];
  let bestShortest = -1;
  for (let at = 0; at + STAFF_LINES <= ys.length; at += 1) {
    const run = ys.slice(at, at + STAFF_LINES);
    const gap = (run[1] ?? 0) - (run[0] ?? 0);
    const even =
      gap > 0 && run.every((y, index) => Math.abs(y - (run[0] ?? 0) - index * gap) < 0.5);
    if (!even) {
      continue;
    }
    // The shortest line in the run, which is what a ledger gives itself away
    // by: the staff's own five all run the length of a measure.
    const shortest = Math.min(...run.map((y) => longest.get(y) ?? 0));
    if (shortest > bestShortest) {
      best = run;
      bestShortest = shortest;
    }
  }
  return best;
}

/**
 * Every horizontal line drawn inside an element, with the span it covers.
 *
 * The engraver draws a staff line, a ledger line and a bracket the same way;
 * what tells them apart is how far they run and where they fall.
 */
function horizontalRules(group: Element): { y: number; from: number; to: number }[] {
  const found: { y: number; from: number; to: number }[] = [];
  for (const path of group.querySelectorAll('path')) {
    const drawn = /^M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)$/.exec(path.getAttribute('d') ?? '');
    if (drawn === null || drawn[2] !== drawn[4]) {
      continue;
    }
    found.push({
      y: Number.parseFloat(drawn[2] ?? '0'),
      from: Number.parseFloat(drawn[1] ?? '0'),
      to: Number.parseFloat(drawn[3] ?? '0'),
    });
  }
  return found;
}

/** As much of the engraver's own model as the markers need to read. */
interface DrawnStaff {
  readonly staffNumber: number;
  readonly page: number;
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

interface DrawnSheet {
  readonly MusicPages?: readonly { readonly MusicSystems?: readonly DrawnSystem[] }[];
}

interface DrawnSystem {
  readonly GraphicalMeasures?: readonly (readonly (DrawnGraphicalMeasure | undefined)[])[];
  readonly StaffLines?: readonly { readonly PositionAndShape?: DrawnBox }[];
  readonly PositionAndShape?: DrawnBox;
}

interface DrawnBox {
  readonly AbsolutePosition?: { readonly x: number; readonly y: number };
  readonly Size?: { readonly width: number; readonly height: number };
}

interface DrawnGraphicalMeasure {
  readonly PositionAndShape?: DrawnBox;
  readonly parentSourceMeasure?: { readonly measureListIndex?: number };
}

/**
 * The size the engraving was drawn at, in its own pixels.
 *
 * Read from the attributes rather than from `width.baseVal`: the animated
 * length is what a browser fills in, and a document that has laid nothing out
 * does not have one - which is every test that runs the real engraver without
 * a real window. The attribute is what the engraver wrote there itself.
 */
function intrinsicSize(svg: SVGSVGElement): { readonly width: number; readonly height: number } {
  // The `viewBox` first, because everything measured here is in the
  // engraver's own units and the viewBox is what those units mean. The width
  // and height attributes are the size the drawing is *shown* at, and the two
  // part company the moment the reader zooms: at 85% the box is 818 units
  // tall while the attribute says 696 pixels. Read the attribute as the unit
  // count and every position comes out eighteen per cent too far down, which
  // packs a system too many onto each page and slices the last one.
  const box = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map((part) => Number.parseFloat(part));
  const boxWidth = box[2];
  const boxHeight = box[3];
  if (boxWidth !== undefined && boxHeight !== undefined && Number.isFinite(boxWidth) && Number.isFinite(boxHeight)) {
    return { width: boxWidth, height: boxHeight };
  }
  const attribute = (name: string): number => Number.parseFloat(svg.getAttribute(name) ?? '');
  const width = attribute('width');
  const height = attribute('height');
  return {
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  };
}

/** Top and bottom of everything a system's staves cover, in pixels. */
function systemExtent(system: DrawnSystem): { top: number; bottom: number } | null {
  // The staff lines and not the measures: a measure's box is drawn round what
  // is *in* it, so an empty bar of rests reports a height of one unit and a
  // marker measured on it stops halfway down the treble. The staves are the
  // thing that is the same height whatever is written on them.
  //
  // Nor the system's own box, which reaches down into the gap before the next
  // line - a marker that long hangs into the space between systems.
  const boxes = (system.StaffLines ?? []).map((line) => line.PositionAndShape);
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    const at = box?.AbsolutePosition;
    const size = box?.Size;
    if (at === undefined || size === undefined) {
      continue;
    }
    top = Math.min(top, at.y * UNITS_TO_PIXELS);
    bottom = Math.max(bottom, (at.y + size.height) * UNITS_TO_PIXELS);
  }
  return Number.isFinite(top) && Number.isFinite(bottom) ? { top, bottom } : null;
}

/**
 * What was actually drawn on a page, in the drawing's own units.
 *
 * `null` where nothing can measure it: jsdom has no layout engine and an
 * empty page has no box at all.
 */
function boundingBoxOf(
  sheet: SVGGraphicsElement,
): { readonly y: number; readonly height: number } | null {
  if (typeof sheet.getBBox !== 'function') {
    return null;
  }
  try {
    const box = sheet.getBBox();
    return box.height > 0 ? { y: box.y, height: box.height } : null;
  } catch {
    return null;
  }
}

/**
 * Where the previewed page has to stand, as a transform for its clone.
 *
 * Three things decide it. It wants to stand where the finished system stood,
 * so the notes are where the reader last looked. It may not stand so high
 * that the ink above its staff - the ledger lines and the stems of the notes
 * on them - is cut off by the top of the page. And where even that leaves it
 * hanging past the line it stands on, it is drawn smaller rather than sliced:
 * a system with its bottom cut off says as little as one with its top cut
 * off, and the reader is looking at it precisely because it is hard.
 *
 * Without a box to ask - no layout engine, nothing drawn - the staff's own
 * top stands in for the ink, which is the honest floor: there is ink on the
 * staff lines whatever else the system carries.
 */
function previewPlacement(
  moved: SVGGraphicsElement,
  slot: { readonly top: number },
  target: { readonly top: number; readonly bottom: number },
  bottom: number,
): string {
  const inkTop = boundingBoxOf(moved)?.y ?? target.top;
  const shift = Math.min(target.top - slot.top, inkTop - PREVIEW_TOP_PAD);
  const placedAt = inkTop - shift;
  const needs = target.bottom - inkTop;
  const room = bottom - placedAt;
  const scale = needs > room && needs > 0 && room > 0 ? room / needs : 1;
  return `translate(0, ${placedAt}) scale(${scale}) translate(0, ${-inkTop})`;
}

/**
 * The page itself: how tall it is in the drawing's units, and how much of a
 * pixel each of those is worth on screen.
 *
 * Read from the `viewBox` against the height it is displayed at, because
 * those two are what the engraver actually wrote - the attributes carry the
 * zoom, the box carries the drawing.
 */
function pageBoxOf(
  sheet: SVGSVGElement,
): { readonly height: number; readonly scale: number } | null {
  const viewBox = (sheet.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  const height = viewBox[3];
  const shown = Number.parseFloat(sheet.getAttribute('height') ?? '');
  if (height === undefined || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  const scale = Number.isFinite(shown) && shown > 0 ? shown / height : 1;
  return { height, scale };
}

/** A bar's notes, in order, and which of them a beam group starts on. */
interface MeasureNotes {
  readonly notes: readonly Element[];
  readonly at: ReadonlyMap<Element, number>;
  readonly owners: ReadonlySet<string>;
}

/**
 * How red the marker gets, at most.
 *
 * Four misses is already "I cannot read this chord"; counting higher would
 * make the last steps of the ladder indistinguishable and say nothing new.
 */
const TROUBLE_LEVELS = 4;

/**
 * Everything on a page that this program drew rather than the engraver.
 *
 * A preview of the page ahead is a picture of the *music* on it. The marks
 * left by an earlier reading, the passage markers, the hand switches and the
 * page's own label all belong to the page they are on and to the moment they
 * were drawn, and carried into the preview they would be saying those things
 * about the wrong bars.
 */
const OUR_OWN_MARKS = [
  '.played-overlay',
  '.page-label',
  '.passage-marker',
  '.start-marker',
  '.repeat-mark',
  '.hand-switch',
  '.page-preview',
].join(',');

/** The one clip the preview needs; only ever one preview is on the page. */
const PREVIEW_CLIP_ID = 'page-preview-clip';

/**
 * How much room the preview keeps above the highest ink it carries.
 *
 * Rather less than a staff space. Enough that a ledger line does not sit on
 * the very edge of the page, which reads as a line that has been cut rather
 * than one that ends.
 */
const PREVIEW_TOP_PAD = 8;

/** The cut that leaves the previewed page its first system and nothing else. */
const PREVIEW_SYSTEM_CLIP_ID = 'page-preview-system-clip';

/** Class that dims the notes of a step already played. */
const FADED_CLASS = 'note--passed';
/** What the run will not ask for: another hand, or outside the passage. */
const UNPLAYED_CLASS = 'note--unplayed';

/** The part of the engraver's graphical note this adapter reads. */
interface DrawnNote {
  getSVGGElement?: () => SVGGElement | null;
  readonly sourceNote?: {
    readonly pitch?: { readonly FundamentalNote?: number; readonly Octave?: number } | null;
    readonly parentStaffEntry?: { readonly parentStaff?: { readonly id?: number } };
  };
  readonly PositionAndShape?: { readonly AbsolutePosition?: { x: number; y: number } };
  /**
   * The engraver's own answer to which page this was laid out on.
   *
   * Asked only where the drawing cannot be: a rest is given no group of its
   * own in the SVG, so there is no element to look up from.
   */
  readonly parentVoiceEntry?: {
    readonly parentStaffEntry?: {
      readonly parentMeasure?: {
        readonly ParentMusicSystem?: { readonly Parent?: { readonly PageNumber?: number } };
      };
    };
  };
}

/** Bridges OSMD's forward-only cursor to {@link ICursorPrimitive}. */
class OsmdCursorPrimitive implements ICursorPrimitive {
  private readonly resolve: () => OpenSheetMusicDisplay | null;
  /** Which of the engraver's cursors this one drives. */
  private readonly which: number;

  constructor(resolve: () => OpenSheetMusicDisplay | null, which = 0) {
    this.resolve = resolve;
    this.which = which;
  }

  private get cursor(): OpenSheetMusicDisplay['cursor'] | null {
    const display = this.resolve();
    return (display?.cursors?.[this.which] ?? (this.which === 0 ? display?.cursor : null)) ?? null;
  }

  get endReached(): boolean {
    const iterator = this.cursor?.iterator;
    return iterator === undefined || iterator === null ? true : iterator.EndReached;
  }

  reset(): void {
    this.cursor?.reset();
  }

  next(): void {
    this.cursor?.next();
  }

  /**
   * Exactly the step `next` takes, without the drawing it does afterwards.
   *
   * Exactly: the engraver's `next` is `moveToNextVisibleVoiceEntry(false)` and
   * then `update()`, and this was first written as the iterator's plain
   * `moveToNext` - which does not skip what is not drawn. This program writes
   * every silence as a rest the page does not print, so a plain step counts
   * positions the marker never stands on, and a walk of a thousand of them
   * fell short of where it was going: measured on the device, a start eight
   * hundred bars in put the marker a little way back, and further back the
   * further in. His: "курсор на таких великих дистанціях ставиться кудись
   * трішки назад". The double in the tests takes the same step both ways, so
   * only the engraver itself can say whether the two agree; see the test that
   * asks it.
   *
   * Where the engraver has no iterator to offer - it has not rendered yet -
   * this falls back to the whole of `next`, which is slower and always right.
   */
  stepWithoutDrawing(): void {
    const cursor = this.cursor;
    if (cursor === null || cursor === undefined) {
      return;
    }
    const iterator = cursor.iterator as
      | { moveToNextVisibleVoiceEntry?: (notesOnly: boolean) => void }
      | undefined;
    if (typeof iterator?.moveToNextVisibleVoiceEntry !== 'function') {
      cursor.next();
      return;
    }
    iterator.moveToNextVisibleVoiceEntry(false);
  }

  drawWhereItIs(): void {
    this.cursor?.update();
  }

  /**
   * Exactly the step `previous` takes, without the drawing it does afterwards:
   * the engraver's `previous` is `moveToPreviousVisibleVoiceEntry(false)` and
   * then `update()`. See `stepWithoutDrawing` for why exactly.
   */
  stepBackWithoutDrawing(): void {
    const cursor = this.cursor;
    if (cursor === null || cursor === undefined) {
      return;
    }
    const iterator = cursor.iterator as
      | { moveToPreviousVisibleVoiceEntry?: (notesOnly: boolean) => void }
      | undefined;
    if (typeof iterator?.moveToPreviousVisibleVoiceEntry !== 'function') {
      cursor.previous();
      return;
    }
    iterator.moveToPreviousVisibleVoiceEntry(false);
  }

  show(): void {
    this.cursor?.show();
  }

  hide(): void {
    this.cursor?.hide();
  }
}

/**
 * OpenSheetMusicDisplay adapter.
 *
 * The only file in the project that knows OSMD exists. Everything above it
 * depends on the score ports, so swapping the engraver is a single-file
 * change.
 *
 * OSMD (with VexFlow behind it) is by far the heaviest dependency here, so it
 * is imported dynamically: the controls are interactive while the engraver is
 * still downloading.
 */
/** A marker a finger is holding, and where it has got to. */
interface PassageDrag {
  readonly edge: PassageEdge;
  readonly pointerId: number;
  readonly passage: DrawnPassage;
  /** Where the finger landed, so a tap can be told from a drag. */
  readonly from: { readonly x: number; readonly y: number };
  /** The handle it landed on, when it landed on one rather than the line. */
  readonly grip: GripEnd | null;
  /** Whether the finger is currently past the end of the page it is on. */
  readonly overshot: boolean;
}

/** A finger that may be turning a page, and where it started. */
interface PageSwipe {
  readonly pointerId: number;
  readonly from: { readonly x: number; readonly y: number };
}

export class OsmdScoreRenderer
  implements
    IScoreRenderer,
    IPlayedNoteOverlay,
    IScoreFade,
    IScoreZoom,
    IPassageMarkers,
    IScorePages,
    IStuckMarker,
    IRhythmRuler
{
  private readonly container: HTMLElement;
  private readonly options: OsmdRendererOptions;
  private readonly navigator: CursorNavigator;
  /** The second marker: where the hand the reader is not playing has got to. */
  private readonly otherNavigator: CursorNavigator;

  /** Where each timeline step sits, and the notes drawn there. */
  private stepX = new Map<number, number>();
  private stepElements = new Map<number, SVGGElement[]>();
  /** Which staff each drawn note belongs to; see {@link paintDimmed}. */
  private elementStaff = new WeakMap<SVGGElement, number>();
  /** What the run is about to ask for, or `null` to dim nothing. */
  private reading: ScoreReading | null = null;
  /** Which sheet each step was drawn on; every page is an SVG of its own. */
  private stepPage = new Map<number, number>();
  /**
   * The engraver's systems, numbered in the order the walk meets them.
   *
   * Its own system object is the identity and is never read from; the number
   * is ours, so that a sample can carry it and two samples can be compared.
   * Rebuilt with every engraving, since the objects are.
   */
  private systemNumbers = new Map<object, number>();
  /** True while the cursor is being walked to find out what is where. */
  private walking = false;
  private faded = new Set<number>();
  private samples: DrawnNoteSample[] = [];
  /**
   * How tall a staff position is on each page, measured once per engraving.
   *
   * It is a fact about the drawing, so it changes only when the drawing does
   * - and it was being worked out again for every page on every note the
   * reader played, from every note in the score. On a long piece that was
   * thousands of measurements per keystroke, growing as the marks did, and
   * the trainer stopped answering partway through.
   */
  private geometryByPage = new Map<number, ReturnType<typeof fitStaffGeometry>>();
  /** Each page's layers of our own, by name; see {@link layerOn}. */
  private readonly layers = new WeakMap<SVGSVGElement, Map<string, SVGGElement>>();
  /** The pages as last engraved; see {@link sheets}. */
  private drawnSheets: SVGSVGElement[] | null = null;
  /**
   * The staves read off each page's printed lines, by page.
   *
   * Kept for as long as the engraving is, even after a page's drawing has been
   * let go: where the lines were is a fact about the layout, and the layout
   * has not changed. A page not drawn yet has no entry, and anything measured
   * against it falls back on the engraver's own reckoning until it is.
   */
  private printedStaves = new Map<number, readonly DrawnStaff[]>();
  /** The engraver's notes at each step, drawn or not; see {@link collectDrawnNotes}. */
  private stepNotes = new Map<number, DrawnNote[]>();
  /** The steps laid out on each page. */
  private stepsByPage = new Map<number, number[]>();
  /** The page the marker stood on when the pages kept drawn were last chosen. */
  private markerPage = -1;
  /**
   * The engraver's bar numbers on each page, read once per page.
   *
   * Keyed by the page itself, so a page drawn again is a new key and the old
   * reading goes with the old page - there is nothing to remember to clear.
   */
  private readonly numbersOn = new WeakMap<SVGSVGElement, readonly PrintedNumber[]>();
  /** Each page's printed label; see {@link labelPage}. */
  private pageLabels = new WeakMap<SVGSVGElement, Element>();
  private marks: PlayedMark[] = [];
  private overlayContext: OverlayContext | null = null;

  /** Where the engraver put each bar, and the markers standing on them. */
  private measures: DrawnMeasure[] = [];
  private passage: DrawnPassage | null = null;
  /** The bar the music will start from, when the reader has moved it. */
  private startMeasure: number | null = null;
  private repeatedBars: readonly number[] = [];
  private passageListeners: ((passage: DrawnPassage) => void)[] = [];
  private dragging: PassageDrag | null = null;

  /** The column cut into pages, and which one is being read. */
  private paged = false;
  /**
   * How much shorter than the window a page has to be asked for.
   *
   * Kept between engravings of the same music: a piece whose systems spill
   * over spills every time, and starting from nothing again would mean two
   * engravings on every resize instead of one. Cleared when new music
   * arrives, because it is a fact about the music, not about the window.
   */
  private pageSurplusPx = 0;
  /**
   * The window the correction was measured against.
   *
   * A correction is only true of the page it was measured on. The trainer
   * opens in the desk layout and enters the reading layout a moment later,
   * which is a different window and a different page - carrying the first
   * measurement into the second would shorten a page that never spilled, and
   * carrying it again on every following engraving would go on shortening it.
   */
  private pageSurplusWindow = 0;
  private pageAt = 0;
  /** Whether the music may turn the page, or only the reader. */
  private pagesFollowTheMusic = true;
  /** The page whose top is being shown in place of this one's, if any. */
  private previewShown: number | null = null;
  private previewGroup: SVGGElement | null = null;
  private previewWanted = true;
  /** Printed extent of each system, keyed `page:index within the page`. */
  private systemBands = new Map<string, { top: number; bottom: number }>();
  /** The last system of each page, in the numbering the samples carry. */
  private lastSystemOnPage = new Map<number, number>();
  /** How many systems each page holds. */
  private systemsOnPage = new Map<number, number>();
  /** Which system of its own page each system is, top down. */
  private systemIndexOnPage = new Map<number, number>();
  /** The ruler to draw through the bars, in playing order. */
  private ruled: readonly RulerMark[] = [];
  private rulerGroup: SVGGElement | null = null;
  /** The ruled line the music has reached, if it is being shown. */
  private beatMark: RulerMark | null = null;
  private beatGroup: SVGGElement | null = null;
  private pageListeners: ((state: ScorePageState) => void)[] = [];
  private swipe: PageSwipe | null = null;
  private tapListeners: (() => void)[] = [];
  private heldListeners: ((measureIndex: number) => void)[] = [];
  private markerHeldListeners: ((end: PassageEnd) => void)[] = [];
  private handListeners: ((staffNumber: number) => void)[] = [];
  /** A finger down on a hand switch, and which staff it stands beside. */
  private pressedHand: { pointerId: number; staffNumber: number } | null = null;
  /** Which staves the run is asking for; see {@link paintHands}. */
  private handsPlaying: readonly number[] = [];
  private holding: ReturnType<typeof setTimeout> | null = null;
  /** Where a touch that took hold of nothing began, so a tap can be told. */
  private tapFrom: { readonly pointerId: number; readonly x: number; readonly y: number } | null =
    null;

  private osmd: PageByPageEngraver | null = null;
  private loaded = false;
  private currentZoom: number;
  private observer: ResizeObserver | null = null;
  /** Width the sheet was last engraved for; a height change is not one. */
  private engravedWidth = 0;

  constructor(container: HTMLElement, options: OsmdRendererOptions = {}) {
    this.container = container;
    this.options = options;
    this.currentZoom = options.zoom ?? 0.85;
    this.navigator = new CursorNavigator(new OsmdCursorPrimitive(() => this.osmd));
    this.otherNavigator = new CursorNavigator(new OsmdCursorPrimitive(() => this.osmd, 1));
    // The page follows the cursor, in every mode that moves it: practising,
    // listening, a take played back. Told by the page's own driver instead,
    // it would follow only where somebody had remembered to say so - and
    // during playback nobody had.
    this.navigator.onMoved((stepIndex, byTheMusic) => this.followCursor(stepIndex, byTheMusic));
    this.watchForDrags();
  }

  get cursor(): IScoreCursor {
    return this.navigator;
  }

  /**
   * The second marker; see {@link IOtherHandMarker}.
   *
   * It has no `onMoved` of its own on purpose: the page follows what the reader
   * is reading, and a page that turned itself to keep the accompaniment in view
   * would take their own music out from under them.
   */
  get otherHand(): IScoreCursor {
    return this.otherNavigator;
  }

  get zoom(): number {
    return this.currentZoom;
  }

  setZoom(zoom: number): void {
    this.currentZoom = Math.min(3, Math.max(0.3, zoom));
    if (this.osmd !== null) {
      this.osmd.zoom = this.currentZoom;
    }
  }

  async load(musicXml: string): Promise<void> {
    // Before the thread goes. Everything below is one long stretch of work
    // that the browser cannot paint through, so whatever the page put up to
    // say it is working - and it does put something up - would otherwise be
    // drawn only after the work it was announcing. One turn of the event loop
    // is all it takes, and it is the difference between a page that says
    // "engraving" and a page that has stopped answering.
    await afterTheBrowserHasDrawn();
    timeTheStart('engraver: the page has drawn');
    const osmd = await this.ensureEngraver();
    timeTheStart('engraver: ready');
    this.marks = [];
    // Nothing, rather than the engraver's "Untitled Score", for a score that
    // does not name itself. The second argument is the name it falls back to,
    // and left at its default it invents one - which the page label would
    // then print in the corner of all thirty pages as though the piece were
    // called that. An empty title is a fact about the file and says so.
    await osmd.load(musicXml, '');
    timeTheStart('engraver: file read');
    osmd.zoom = this.currentZoom;
    // Before the first engraving, not only when the reader turns pages on.
    // A visit that opens already in pages - because that is how the reader
    // left it - has nothing to turn them on, so the page was laid out as one
    // endless column and only switching the setting off and on again fixed
    // it. Asked here, the first engraving is already the right shape.
    // New music, so what the last piece spilled over says nothing about this
    // one - and neither does the page the reader had reached in it. A piece
    // opened while page four of the last one was on screen stayed on page
    // four, which in the new piece is a page nobody had turned to.
    this.pageSurplusPx = 0;
    this.pageSurplusWindow = 0;
    this.pageAt = 0;
    this.markPaged();
    // The engraver may only now exist, and it is made with following on.
    this.followOrTurn();
    this.applyPageFormat();
    this.drawOnlyNearTheReader();
    const engravedAt = nowMs();
    osmd.render();
    const engravedMs = nowMs() - engravedAt;
    timeTheStart('engraver: laid out', () => `${String(osmd.pageCount)} pages`);
    this.forgetSheets();
    this.fitPagesToTheirContent(engravedMs);
    timeTheStart('engraver: pages fitted');
    this.loaded = true;
    this.engravedWidth = this.container.offsetWidth;
    this.walking = true;
    this.navigator.reset();
    this.walking = false;
    this.indexDrawnNotes();
    timeTheStart('engraver: notes walked', () => `${String(this.stepPage.size)} steps`);
    this.measures = this.readMeasures();
    this.keepThePagesDrawn();
    timeTheStart('engraver: pages near the reader drawn');
    this.showOnlyCurrentPage();
    this.paintOverlay();
    this.paintFaded();
    this.paintDimmed();
    this.paintPassage();
    this.paintHands();
    this.paintPreview(true);
    this.paintRuler();
    this.paintBeat();
    this.watchContainer();
    timeTheStart('engraver: done');
  }

  /**
   * Re-engraves when the space the sheet has to fill actually changed.
   *
   * OSMD's own `autoResize` listens to the window, and on iOS the window
   * changes height whenever the browser's toolbar collapses - which is on
   * every scroll. Each of those re-engraved the page and threw away the
   * overlay drawn on it, so the marks from a finished run vanished the moment
   * the reader scrolled to look at them.
   *
   * Width is the only thing the engraver's decisions depend on: a page that
   * got taller holds the same systems in the same places.
   */
  handleContainerResize(width: number): void {
    if (!this.loaded || width <= 0 || Math.abs(width - this.engravedWidth) < 1) {
      return;
    }
    this.refresh();
  }

  private watchContainer(): void {
    if (this.observer !== null || typeof ResizeObserver === 'undefined') {
      return;
    }
    this.observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      this.handleContainerResize(width);
    });
    this.observer.observe(this.container);
  }

  /** Stops watching. Called when the renderer is thrown away with the page. */
  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  /**
   * Reddens the marker for the step it is standing on.
   *
   * Said on the surface rather than on the marker itself, and left to the
   * stylesheet from there. The engraver owns that element - it makes it, it
   * moves it, and it replaces it whenever the page is drawn again - so an
   * attribute written on it would be lost at the next engraving, while one
   * written on the page it stands on cannot be.
   */
  showTrouble(missteps: number): void {
    const level = Math.min(Math.max(Math.round(missteps), 0), TROUBLE_LEVELS);
    if (level <= 0) {
      delete this.container.dataset['trouble'];
      return;
    }
    this.container.dataset['trouble'] = String(level);
  }

  refresh(): void {
    if (!this.loaded || this.osmd === null) {
      return;
    }
    this.osmd.zoom = this.currentZoom;
    // The window may be a different size than it was - a rotation, a resize,
    // the transport bar appearing - and a page is cut to the window.
    this.markPaged();
    this.applyPageFormat();
    this.drawOnlyNearTheReader();
    const engravedAt = nowMs();
    this.osmd.render();
    const engravedMs = nowMs() - engravedAt;
    this.forgetSheets();
    this.fitPagesToTheirContent(engravedMs);
    this.engravedWidth = this.container.offsetWidth;
    this.walking = true;
    this.navigator.reset();
    this.walking = false;
    // Re-engraving throws the old SVG away, and everything drawn on it.
    this.indexDrawnNotes();
    this.measures = this.readMeasures();
    // The reader is put back on the page they were reading rather than at the
    // front: a re-engraving is a zoom or a turn of the tablet, not a request
    // to start over. It is clamped, because there may be fewer pages now.
    this.turnToPage(this.pageAt);
    this.paintOverlay();
    this.paintFaded();
    this.paintDimmed();
    this.paintPassage();
    this.paintHands();
    this.paintPreview(true);
    this.paintRuler();
    this.paintBeat();
  }

  /**
   * Reads the score in pages instead of one endless column.
   *
   * The engraver does the breaking. Given a page size it lays the music out
   * as separate pages and draws each into an SVG of its own, so a page turn
   * is showing one element and hiding the others - no measuring of ink, no
   * arithmetic about what fits, and nothing that can cut a system in half.
   *
   * That was worth going back for. Doing the breaking ourselves meant
   * measuring systems, guessing at beams that hang below the staves, working
   * out which box on the page was the one that scrolled, and fighting a
   * stylesheet for the height of the frame - four attempts, and every one of
   * them had another edge to it.
   *
   * The engraver's own cursor-following goes off with it: it scrolls the
   * column to keep the cursor in view, which is the opposite of a page that
   * stays still until it is turned.
   */
  setPaged(paged: boolean): void {
    if (this.paged === paged) {
      return;
    }
    this.paged = paged;
    // Before the early return below, not after it. A visit that opens already
    // in pages sets this before anything is engraved, and the stylesheet's
    // promise - no scrollbar, no drag - hung on an attribute that was then
    // never written for the rest of the session, because coming back through
    // here found the setting already true and left at the top.
    this.markPaged();
    this.followOrTurn();
    if (!this.loaded) {
      // Nothing engraved yet. The setting is kept and the first engraving
      // will be asked for in pages, which is what a visit that opens in
      // pages needs.
      return;
    }
    // A new page size is a new engraving; there is no way to page a layout
    // that was made without pages in mind.
    this.applyPageFormat();
    this.refresh();
  }

  /**
   * Tells the engraver how big a page is, in its own units.
   *
   * Ten of them to the pixel, whatever the zoom: the page keeps the size it
   * is given on screen and the music inside it grows or shrinks instead,
   * which is what makes zooming change how many pages there are rather than
   * how big they look.
   */
  private applyPageFormat(): void {
    const osmd = this.osmd as unknown as {
      setCustomPageFormat?: (width: number, height: number) => void;
      setPageFormat?: (format: string) => void;
    } | null;
    if (osmd === null) {
      return;
    }
    if (!this.paged) {
      osmd.setPageFormat?.('Endless');
      return;
    }
    const width = this.container.offsetWidth;
    const window = this.windowHeight();
    if (window !== this.pageSurplusWindow) {
      this.pageSurplusPx = 0;
      this.pageSurplusWindow = window;
    }
    const height = window - this.pageSurplusPx;
    if (width > 0 && height > 0) {
      osmd.setCustomPageFormat?.(width / UNITS_TO_PIXELS, height / UNITS_TO_PIXELS);
    }
  }

  /**
   * Whether the engraver scrolls the page to keep the marker in view.
   *
   * Off in pages, where a turn is what shows the reader the next system and
   * nothing scrolls at all. Leaving it on there is not merely redundant: the
   * engraver calls `scrollIntoView` with a smooth behaviour on *every* step,
   * which on a long score is an animation over tens of thousands of elements
   * started again before the last one has finished. On a tablet that is a
   * stall on every beat of the piece.
   *
   * Applied wherever the setting or the engraver may have changed, and
   * before the early return in {@link setPaged}: a visit that opens in pages
   * sets the mode before anything is engraved, and this used to be left
   * behind by that - so the readers who never touched the switch were the
   * ones who paid for it.
   */
  private followOrTurn(): void {
    const engraver = this.osmd as unknown as { FollowCursor?: boolean } | null;
    if (engraver !== null) {
      engraver.FollowCursor = !this.paged;
    }
  }

  /**
   * Says on the page itself whether it is being read in pages.
   *
   * The stylesheet takes the scrollbar away and stops a drag from scrolling
   * when this is set, so it has to be true of the element whenever it is true
   * of the renderer - including the visit that opens in pages before there is
   * anything engraved, and every engraving after it.
   */
  private markPaged(): void {
    const scroller = this.scroller();
    if (scroller instanceof HTMLElement) {
      scroller.dataset['paged'] = String(this.paged);
    }
  }

  /**
   * Re-engraves when the engraver drew past the page it was given.
   *
   * It fits systems onto a page by its own reckoning of how tall each one is,
   * and that reckoning is short of what actually gets drawn - a beam over a
   * run of thirty-seconds, a ledger line, an inner voice hanging below the
   * stave. The page is an SVG cut to the size we asked for, so anything past
   * the bottom is not merely off the window: it is clipped away by the page's
   * own edge, and the reader sees a system sliced in half with no way to
   * scroll to the rest of it.
   *
   * So the page is asked for again, shorter by exactly what spilled over, and
   * the system that did not fit moves to the next page where it belongs. The
   * measurement is the drawing's own bounding box against the page box, so
   * there is no margin invented here and nothing to tune.
   *
   * Once only. A second engraving lays the systems out differently and could
   * spill again by a hair; chasing that would re-engrave all night, and the
   * remedy for a hair is not another whole page.
   *
   * And how many times at all is decided by what an engraving costs, not by a
   * number written here: see {@link fittingPassesWorth}. On everything the
   * reader owns this is the four it always was; on a score long enough for one
   * engraving to be measured in seconds it is fewer, or none.
   */
  private fitPagesToTheirContent(engravedMs: number): void {
    if (!this.paged || this.osmd === null) {
      return;
    }
    // Not even measured where the engraving alone is past what the fitting
    // may spend: measuring draws every page in turn, and on the longest score
    // he has that is three hundred pages drawn for a pass that will not run.
    if (fittingPassesWorth(engravedMs) === 0) {
      return;
    }
    // A pass is an engraving and then every page drawn to be measured. The
    // engraving draws only a page or two, so what it cost is a part of what a
    // pass costs, and the measuring is the rest - both are counted, or a
    // piece whose drawing is the expensive part would be given passes it
    // cannot afford.
    const measuredAt = nowMs();
    const first = this.surplusBelowPage();
    const passes = fittingPassesWorth(engravedMs + (nowMs() - measuredAt));
    // Over and over, not once. Taking the surplus off changes which systems
    // fit on a page, and that changes which page draws furthest past its box
    // - so a single pass is a guess. It measured as one too: opening a long
    // score gave two systems to pages that hold one and a half, and the
    // reader's own fix was to zoom in and out again, each zoom being another
    // pass at the same arithmetic.
    for (let pass = 0; pass < passes; pass += 1) {
      const surplus = pass === 0 ? first : this.surplusBelowPage();
      if (surplus <= 0) {
        return;
      }
      // A page cannot be cut past nothing. Where the room has run out the
      // next engraving would draw the same thing again, and the reader would
      // wait for it.
      if (this.windowHeight() - this.pageSurplusPx - surplus <= 0) {
        return;
      }
      this.pageSurplusPx += surplus;
      this.applyPageFormat();
      this.drawOnlyNearTheReader();
      this.osmd.render();
      this.forgetSheets();
    }
  }

  /**
   * How far the tallest page's drawing runs past the bottom of the page.
   *
   * In screen pixels: the box is in the drawing's own units, so it is scaled
   * by what the page is displayed at. Pages that cannot be measured - no
   * layout engine, no box - answer nothing, which is the right answer for a
   * page nobody can see.
   */
  private surplusBelowPage(): number {
    let worst = 0;
    const osmd = this.osmd;
    for (const [at, sheet] of this.sheets.entries()) {
      // Every page, though most are not drawn: what spills is ink, so a page
      // is drawn for as long as it takes to measure and let go again. One at
      // a time, which is what keeps this from drawing a long piece whole.
      const lent =
        osmd !== null && typeof sheet.getBBox === 'function' && !osmd.isDrawn(at) && osmd.drawPage(at);
      const box = boundingBoxOf(sheet);
      if (lent) {
        osmd.forgetPage(at);
      }
      const page = pageBoxOf(sheet);
      if (box === null || page === null || page.height <= 0) {
        continue;
      }
      worst = Math.max(worst, overflowBelow(box, page.height) * page.scale);
    }
    return worst;
  }

  /**
   * Every page the engraver drew, in reading order.
   *
   * Kept between engravings. Asking the container for them is a query over
   * the whole drawing, and this is read on every note the reader plays - on
   * a long score that one lookup was almost the entire cost of showing a
   * mark. The pages change only when the music is engraved again, which is
   * where the list is dropped.
   */
  private get sheets(): SVGSVGElement[] {
    const drawn = this.drawnSheets ?? [...this.container.querySelectorAll('svg')];
    this.drawnSheets = drawn;
    return drawn;
  }

  /** Forgets the pages, so the next reader of {@link sheets} finds them again. */
  private forgetSheets(): void {
    this.drawnSheets = null;
    // What was read off the old pages goes with them.
    this.printedStaves = new Map();
  }

  /** Whether a page has its drawing, which is what anything painted on it needs. */
  private isDrawn(page: number): boolean {
    return this.osmd?.isDrawn(page) ?? false;
  }

  /** A page, if it is drawn; nothing of ours is painted onto a blank one. */
  private drawnSheet(page: number): SVGSVGElement | undefined {
    return this.isDrawn(page) ? this.sheets[page] : undefined;
  }

  /** The pages that are drawn, with where each is in the piece. */
  private sheetsDrawn(): [number, SVGSVGElement][] {
    return [...this.sheets.entries()].filter(([at]) => this.isDrawn(at));
  }

  /**
   * The pages worth having drawn: the one being read, the ones either side of
   * it, the one the marker is on, and the one the run starts from.
   *
   * Drawing is what a long piece cannot afford - on the Alkan, every page
   * drawn at once is more than the iPad will hold - and a page is drawn in a
   * few tens of milliseconds when it is wanted. So only what a reader can
   * reach in one move is kept: a turn either way, the music the marker is
   * standing in, and the start a repeat goes back to. His: "не забувай що є
   * repeat кнопка яка має швидко повернутись на старт де був поставлений
   * слайс чи курсор".
   *
   * `null` for every page, which a single column is.
   */
  private pagesWanted(): ReadonlySet<number> | null {
    if (!this.paged) {
      return null;
    }
    const near = [
      this.pageAt - 1,
      this.pageAt,
      this.pageAt + 1,
      this.pageOfStep(this.navigator.position),
    ];
    if (this.reading !== null) {
      near.push(this.pageOfStep(this.reading.from));
    }
    if (this.startMeasure !== null) {
      near.push(this.pageOfMeasure(this.startMeasure));
    }
    if (this.passage !== null) {
      near.push(this.pageOfMeasure(this.passage.fromMeasureIndex));
    }
    return new Set(near.filter((page) => page >= 0));
  }

  /**
   * Tells the engraver which pages its next engraving is to draw.
   *
   * The pages around the one being read, and no more: where anything else is
   * - the marker, the start - is known only once the piece has been laid out,
   * so those are drawn afterwards, by {@link keepThePagesDrawn}.
   */
  private drawOnlyNearTheReader(): void {
    this.osmd?.drawOnly(
      this.paged ? [this.pageAt - 1, this.pageAt, this.pageAt + 1].filter((page) => page >= 0) : null,
    );
  }

  /**
   * Draws the pages that are wanted and are not drawn, and lets go of the rest.
   *
   * Says whether it drew anything, because a page newly drawn is a page every
   * layer of ours still has to be painted onto.
   */
  private keepThePagesDrawn(): boolean {
    const osmd = this.osmd;
    if (osmd === null) {
      return false;
    }
    const wanted = this.pagesWanted();
    this.markerPage = this.pageOfStep(this.navigator.position);
    let drew = false;
    for (const [at, sheet] of this.sheets.entries()) {
      const want = wanted === null || wanted.has(at);
      if (want && !osmd.isDrawn(at)) {
        osmd.drawPage(at);
        this.collectDrawnNotes(at);
        drew = true;
      } else if (!want && osmd.isDrawn(at)) {
        for (const stepIndex of this.stepsByPage.get(at) ?? []) {
          this.stepElements.delete(stepIndex);
        }
        // Read off text that is going with the drawing. The page keeps its
        // place, so this is keyed by a page that will be drawn again - with
        // new text, which the old reading would never find.
        this.numbersOn.delete(sheet);
        osmd.forgetPage(at);
      }
    }
    if (drew) {
      // Its printed lines can be read now, and the bars on it measured by them.
      this.measures = this.readMeasures();
    }
    return drew;
  }

  /**
   * Keeps the right pages drawn, and paints ours onto any page just drawn.
   *
   * Everything of ours that belongs to a page - what was played, the veil,
   * the dimming, the markers, the hand switches - is painted only on pages
   * that are drawn, and kept as the thing it is a picture of: so a page drawn
   * later is painted from that, as though it had been drawn all along.
   */
  private drawThePagesNearTheReader(): void {
    if (!this.keepThePagesDrawn()) {
      return;
    }
    this.paintOverlay();
    this.paintFaded();
    this.paintDimmed();
    this.paintPassage();
    this.paintHands();
  }

  /**
   * Finds the groups a page's notes were drawn as, now that it is drawn.
   *
   * Asked of the engraver's notes kept from the walk, because a page drawn
   * later is drawn long after the walk has been and gone.
   */
  private collectDrawnNotes(page: number): void {
    const sheet = this.sheets[page];
    if (sheet === undefined) {
      return;
    }
    const steps = this.stepsByPage.get(page) ?? [];
    for (const stepIndex of steps) {
      const drawn: SVGGElement[] = [];
      for (const note of this.stepNotes.get(stepIndex) ?? []) {
        const element = typeof note.getSVGGElement === 'function' ? note.getSVGGElement() : null;
        if (element === null || element === undefined) {
          continue;
        }
        drawn.push(element);
        // Which hand drew it, for dimming the one that is not being read.
        const staff = note.sourceNote?.parentStaffEntry?.parentStaff?.id;
        if (staff !== undefined) {
          this.elementStaff.set(element, staff);
        }
      }
      if (drawn.length > 0) {
        this.stepElements.set(stepIndex, drawn);
      } else {
        this.stepElements.delete(stepIndex);
      }
    }
    this.attachNoteFurniture(sheet, steps);
  }

  /** The page the reader is looking at. */
  private currentSheet(): SVGSVGElement | null {
    const sheets = this.sheets;
    return sheets[this.paged ? this.pageAt : 0] ?? sheets[0] ?? null;
  }

  /** The bars on it, which are the only ones a touch can be aimed at. */
  private measuresHere(): DrawnMeasure[] {
    return this.paged
      ? this.measures.filter((measure) => measure.page === this.pageAt)
      : this.measures;
  }

  /**
   * Where the reader is, or nothing at all when the score is one column.
   *
   * A scrolling score has no pages to be on rather than one long page: the
   * difference matters to anything that would say "page 1 of 1" at a reader
   * who never asked for pages.
   */
  get pages(): ScorePageState {
    const count = this.paged ? this.sheets.length : 0;
    return {
      at: Math.min(this.pageAt, Math.max(0, count - 1)),
      count,
      windowPx: Math.round(this.windowHeight()),
      contentPx: Math.round(this.sheets[0]?.getBoundingClientRect().height ?? 0),
    };
  }

  turnPages(delta: number): void {
    this.turnToPage(this.pageAt + delta);
  }

  showMeasure(measureIndex: number): void {
    if (!this.paged) {
      return;
    }
    const drawn = this.measures.find((measure) => measure.measureIndex === measureIndex);
    // Only when the music has actually left the page: turning to the page it
    // is already on would fight a reader who has looked ahead.
    if (drawn !== undefined && drawn.page !== this.pageAt) {
      this.turnToPage(drawn.page);
    }
  }

  onPagesChanged(listener: (state: ScorePageState) => void): () => void {
    this.pageListeners.push(listener);
    return () => {
      this.pageListeners = this.pageListeners.filter((each) => each !== listener);
    };
  }

  /**
   * How tall a page may be: the room inside the box it is drawn into.
   *
   * Asked of that box rather than worked out from the window, because the box
   * is what the page has to fit and only the box knows what has been reserved
   * inside it. Subtracting the room kept for the transport bar by hand once
   * left the strip above the page unaccounted for - eight pixels nobody
   * owned, enough to push the frame past the screen and put a scrollbar on a
   * mode whose promise is that there is nothing to scroll.
   *
   * Clamped to the screen: outside the reading layout the frame is given a
   * minimum of one screen and then grows to whatever is engraved in it, so
   * its own height is the length of the piece rather than the room a page
   * has.
   */
  private windowHeight(): number {
    const scroller = this.scroller();
    if (!(scroller instanceof HTMLElement)) {
      return 0;
    }
    const box = scroller.getBoundingClientRect();
    const visible = visibleHeightOf({ top: box.top, bottom: box.bottom }, this.viewportHeight());
    const style = getComputedStyle(scroller);
    const reserved =
      (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
    return Math.max(0, visible - reserved);
  }

  /** How tall the screen is, as far as this document can tell. */
  private viewportHeight(): number {
    const view = this.container.ownerDocument.defaultView;
    const inner = view?.innerHeight ?? 0;
    return inner > 0 ? inner : (this.container.ownerDocument.documentElement.clientHeight ?? 0);
  }

  /** Puts one page in front of the reader and takes the others away. */
  private turnToPage(index: number): void {
    const sheets = this.sheets;
    this.pageAt = Math.min(Math.max(index, 0), Math.max(0, sheets.length - 1));
    this.drawThePagesNearTheReader();
    this.showOnlyCurrentPage();
    this.announcePages();
  }

  private showOnlyCurrentPage(): void {
    const sheets = this.sheets;
    for (const [at, sheet] of sheets.entries()) {
      // Only where it differs. A turn changes two pages of the thirty, and
      // assigning the same value to the rest still asks the browser to lay
      // them out again.
      const shown = !this.paged || at === this.pageAt ? '' : 'none';
      if (sheet.style.display !== shown) {
        sheet.style.display = shown;
      }
      if (this.isDrawn(at)) {
        this.labelPage(sheet, at, this.paged ? sheets.length : 0);
      }
    }
    this.placeCursor();
    this.paintPreview();
    this.paintRuler();
    this.paintBeat();
  }

  /**
   * What this page is: which piece, and which page of it.
   *
   * Drawn into the sheet rather than floated over it, because that is what
   * it is: part of this page and not part of the screen. It stays put, it is
   * there before anything has been turned, and it goes wherever the page
   * goes - none of which a pill announcing a turn can do, since it says its
   * piece and disappears.
   *
   * The title is here rather than printed over the first system, which is
   * where engraved music puts it and where the engraver would put it if
   * `drawTitle` were on. A title block costs vertical room on the one page
   * whose room is scarcest, and room is what a page in this trainer is
   * always short of. In the margin it costs none - and being on every page
   * it answers "what am I playing" on page seven, which a printed title
   * cannot do at all.
   *
   * The engraver keeps both a title and a page number in its model and draws
   * neither, so this is ours to draw.
   */
  private labelPage(sheet: SVGSVGElement, at: number, count: number): void {
    // Kept rather than looked up, for the reason the overlay layer is: asking
    // the page for it by class walks the whole page, it is appended last so
    // the walk never ends early, and this runs for every page of the score on
    // every turn. Thirty pages of a long piece made a page turn a visible
    // stall - the music stopped, then caught up all at once.
    const held = this.pageLabels.get(sheet);
    const existing = held?.parentNode === sheet ? held : null;
    const label = this.pageLabel(at, count);
    if (label === '') {
      existing?.remove();
      this.pageLabels.delete(sheet);
      return;
    }
    const text = existing ?? sheet.ownerDocument.createElementNS(SVG_NAMESPACE, 'text');
    if (existing !== null && text.textContent === label) {
      return;
    }
    text.setAttribute('class', 'page-label');
    text.setAttribute('x', String(PAGE_LABEL_INSET));
    text.setAttribute('y', String(PAGE_LABEL_INSET));
    text.textContent = label;
    if (existing === null) {
      sheet.append(text);
      this.pageLabels.set(sheet, text);
    }
  }

  /**
   * The line itself, or `''` where there is nothing to say.
   *
   * "Page 1 of 1" at a reader who never asked for pages is furniture, so the
   * count only speaks when there is more than one page. The title speaks
   * whenever the score has one - including in a single column, where it is
   * the whole of the line.
   */
  private pageLabel(at: number, count: number): string {
    return pageLabelText(this.osmd?.Sheet?.TitleString ?? '', at, count);
  }

  /**
   * Turns to the page the cursor has just landed on.
   *
   * And takes the cursor off the page it is not on. The engraver draws it as
   * one marker over the whole sheet and positions it in the coordinates of
   * its own page, so on any other page it stands wherever those coordinates
   * happen to fall - which is a cursor hanging over unrelated music, and is
   * what the reader saw after turning a page by hand.
   */
  private followCursor(stepIndex: number, byTheMusic: boolean): void {
    // Not while the renderer is walking the cursor for its own bookkeeping.
    // Reading where every step was drawn means running the cursor from the
    // top and putting it back, and a page that followed that would end the
    // re-engraving on page one however far in the reader had got.
    if (this.walking) {
      return;
    }
    const page = this.pageOfStep(stepIndex);
    if (byTheMusic && this.pagesFollowTheMusic && this.paged && page !== this.pageAt) {
      this.turnToPage(page);
      return;
    }
    // A marker gone on to a page of its own keeps that page drawn, so a
    // reader who has looked ahead finds the music there when they turn back.
    if (page !== this.markerPage) {
      this.drawThePagesNearTheReader();
    }
    // The marker still has to be taken off a page it is no longer on, even
    // when the page is staying where it is.
    this.placeCursor();
    this.paintPreview();
  }

  /**
   * Whether to show the top of the page ahead, and which page that is.
   *
   * Only once the music has reached the *last* system of the page: what the
   * preview stands on is a system the reader has finished with, and taking
   * away a system they are still reading would be worse than no preview at
   * all. A page holding one system has nothing to give up, so it gets none -
   * the reader's own answer for that case is a single bar inset into the
   * system being played, which is a different drawing and not this one.
   */
  private previewToShow(): number | null {
    const next = this.pageAt + 1;
    if (!this.previewWanted || !this.paged || next >= this.sheets.length) {
      return null;
    }
    if ((this.systemsOnPage.get(this.pageAt) ?? 0) < 2) {
      return null;
    }
    const at = this.navigator.position;
    if (this.pageOfStep(at) !== this.pageAt) {
      return null;
    }
    const system = this.systemOfStep(at);
    const last = this.lastSystemOnPage.get(this.pageAt);
    return system !== null && last !== undefined && system >= last ? next : null;
  }

  /**
   * Draws it, or takes it away, when the answer has changed.
   *
   * Asked on every step the music reaches, and a preview is a clone of a
   * whole page of notation - so the drawing happens only when the answer
   * actually moves, never on the steps in between.
   */
  private paintPreview(afresh = false): void {
    const next = this.previewToShow();
    if (!afresh && next === this.previewShown) {
      return;
    }
    this.previewShown = next;
    this.previewGroup?.remove();
    this.previewGroup = null;
    this.coverHandSwitches(null);
    if (next !== null) {
      this.drawPreview(next);
    }
  }

  /**
   * Takes the hand switches off the system the preview stands on.
   *
   * Reported: the switches of the top row appeared to belong to the row
   * below. They are painted where the staves are and never move, which is
   * right - but the preview *replaces* the system they belong to, and a
   * switch beside music that is not on the page any more is a switch for the
   * wrong staff. It comes back when the preview does, which is the moment
   * the music it belongs to is on the page again.
   */
  private coverHandSwitches(above: number | null): void {
    const sheet = this.sheets[this.pageAt];
    if (sheet === undefined) {
      return;
    }
    for (const switchOn of sheet.querySelectorAll('g.hand-switch')) {
      const top = Number(switchOn.querySelector('.hand-switch__hit')?.getAttribute('y'));
      if (above !== null && Number.isFinite(top) && top < above) {
        (switchOn as SVGGElement).dataset['covered'] = 'true';
      } else {
        delete (switchOn as SVGGElement).dataset['covered'];
      }
    }
  }

  /**
   * The top of the next page, in the place the first system of this one had.
   *
   * A page turn is the hardest moment in sight reading: the music the reader
   * needs is on a page they cannot see yet, and turning it is exactly when
   * they can least afford to look away. So the page turns *in halves* - by
   * the time the last system is being played, the music after it is already
   * on screen, in the space the first system has finished needing.
   *
   * A clone of the page ahead rather than anything re-engraved: it is the
   * same drawing at the same size, so the notes stand where they will stand
   * when the page does turn, and nothing about the layout has to be worked
   * out twice. Shifted so that page's first system lands where this page's
   * first system was, and cut off at the line between the two systems it
   * stands in front of.
   *
   * One system of it, and no more. The clone is cut a second time in the
   * previewed page's own coordinates, because the second system there can
   * come into view whenever the first has to be shrunk to fit - and two rows
   * of music nobody is playing is the distraction this exists to avoid.
   *
   * Shifted only as far as the ink allows, which is the part that was wrong.
   * A system carrying high notes is pushed down its own page to make room for
   * their ledger lines and stems - so the taller that ink, the further this
   * moved the system up, and the more of that same ink went off the top of
   * the page and was cut away. The music that was hardest to read was the
   * music the preview showed least of.
   */
  private drawPreview(next: number): void {
    const sheet = this.sheets[this.pageAt];
    const ahead = this.sheets[next];
    const slot = this.systemBands.get(`${this.pageAt}:0`);
    const below = this.systemBands.get(`${this.pageAt}:1`);
    const target = this.systemBands.get(`${next}:0`);
    if (sheet === undefined || ahead === undefined) {
      return;
    }
    if (slot === undefined || below === undefined || target === undefined) {
      return;
    }
    const doc = sheet.ownerDocument;
    const box = (sheet.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    const width = box[2] ?? 0;
    // Halfway to the system underneath: far enough to hold the ledger lines
    // and the tails hanging off the previewed music, and never into the
    // system the reader is actually playing.
    const bottom = (slot.bottom + below.top) / 2;

    const group = doc.createElementNS(SVG_NAMESPACE, 'g');
    group.setAttribute('class', 'page-preview');

    const clip = doc.createElementNS(SVG_NAMESPACE, 'clipPath');
    clip.setAttribute('id', PREVIEW_CLIP_ID);
    const cut = doc.createElementNS(SVG_NAMESPACE, 'rect');
    cut.setAttribute('x', '0');
    cut.setAttribute('y', '0');
    cut.setAttribute('width', String(width));
    cut.setAttribute('height', String(bottom));
    clip.append(cut);
    group.append(clip);

    // Solid, because this *replaces* the system underneath rather than being
    // laid over it: two systems of notation printed on top of one another is
    // no clearer than the page turn this exists to soften.
    const ground = doc.createElementNS(SVG_NAMESPACE, 'rect');
    ground.setAttribute('class', 'page-preview__ground');
    ground.setAttribute('x', '0');
    ground.setAttribute('y', '0');
    ground.setAttribute('width', String(width));
    ground.setAttribute('height', String(bottom));
    group.append(ground);

    // The clip on one group and the shift on another inside it, because a
    // clip is resolved in the space the element it sits on already has - so a
    // group carrying both would be cut in the shifted space and take the cut
    // with it.
    const frame = doc.createElementNS(SVG_NAMESPACE, 'g');
    frame.setAttribute('clip-path', `url(#${PREVIEW_CLIP_ID})`);
    const moved = doc.createElementNS(SVG_NAMESPACE, 'g');
    // A third group, carrying no transform of its own, so its clip is read in
    // the *previewed page's* coordinates - which is the only space in which
    // "where that page's first system ends" can be said. Reported: the second
    // system of the page ahead came into view, which it can whenever the
    // first is shrunk to fit, and two rows of music the reader is not playing
    // is exactly the distraction this feature exists to avoid.
    const firstSystem = doc.createElementNS(SVG_NAMESPACE, 'g');
    const ends = this.systemBands.get(`${next}:1`);
    if (ends !== undefined) {
      firstSystem.setAttribute('clip-path', `url(#${PREVIEW_SYSTEM_CLIP_ID})`);
      const systemClip = doc.createElementNS(SVG_NAMESPACE, 'clipPath');
      systemClip.setAttribute('id', PREVIEW_SYSTEM_CLIP_ID);
      const keep = doc.createElementNS(SVG_NAMESPACE, 'rect');
      keep.setAttribute('x', '0');
      keep.setAttribute('y', '0');
      keep.setAttribute('width', String(width));
      // Halfway to the system underneath it, for the same reason the outer
      // cut is halfway: the ledger lines and tails hanging off the first
      // system belong to it, and the second system's do not.
      keep.setAttribute('height', String((target.bottom + ends.top) / 2));
      systemClip.append(keep);
      group.append(systemClip);
    }
    for (const child of [...ahead.children]) {
      firstSystem.append(child.cloneNode(true));
    }
    for (const ours of [...firstSystem.querySelectorAll(OUR_OWN_MARKS)]) {
      ours.remove();
    }
    moved.append(firstSystem);
    frame.append(moved);
    group.append(frame);

    // Said with a line, because otherwise this is simply a page with the
    // wrong bars at the top of it. Dashed: the reader is looking at a piece
    // of something, and a solid rule would read as a system of its own.
    const edge = doc.createElementNS(SVG_NAMESPACE, 'line');
    edge.setAttribute('class', 'page-preview__edge');
    edge.setAttribute('x1', '0');
    edge.setAttribute('x2', String(width));
    edge.setAttribute('y1', String(bottom));
    edge.setAttribute('y2', String(bottom));
    group.append(edge);

    sheet.append(group);
    // Placed once it is on the page: a box can only be asked of a drawing the
    // document is holding, and it is the clone with our own marks taken out
    // that has to fit - not the page it was taken from, which prints a label
    // in the corner this does not carry.
    moved.setAttribute('transform', previewPlacement(moved, slot, target, bottom));
    this.previewGroup = group;
    // Over the preview, not under it. The label says what the *page* is -
    // which piece, which page of it - and the preview replaces one system of
    // that page rather than the page itself. Painted first it went out for
    // as long as the preview stood there, which is the stretch just before a
    // turn, when "which page am I on" is most alive.
    const label = this.pageLabels.get(sheet);
    if (label?.parentNode === sheet) {
      sheet.append(label);
    }
    // The system this stands on is not on the page while it stands there, so
    // neither is the switch that belongs to it.
    this.coverHandSwitches(bottom);
  }

  /**
   * Rules the beat through the bars of the page in front of the reader.
   *
   * Drawn *behind* the notation rather than over it - it is a grid to read
   * the music against, and a grid that hides a notehead is worse than none.
   * Only the page being read: a ruler is thousands of lines on a long score,
   * and the pages nobody is looking at can be ruled when they are turned to.
   *
   * The line stands from the top staff's top line to the bottom staff's
   * bottom one, which is where a bar line stands - because that is what this
   * is, a bar line for a beat.
   */
  private paintRuler(): void {
    this.rulerGroup?.remove();
    this.rulerGroup = null;
    const sheet = this.sheets[this.pageAt];
    if (sheet === undefined || this.ruled.length === 0) {
      return;
    }
    const doc = sheet.ownerDocument;
    const group = doc.createElementNS(SVG_NAMESPACE, 'g');
    group.setAttribute('class', 'rhythm-ruler');
    for (const mark of this.ruled) {
      const line = this.ruleOne(mark, doc);
      if (line !== null) {
        group.append(line);
      }
    }
    // First, so the engraver's ink is drawn over it.
    sheet.prepend(group);
    this.rulerGroup = group;
  }

  /** One ruled line, or `null` where this page cannot place it. */
  private ruleOne(mark: RulerMark, doc: Document): SVGLineElement | null {
    if (this.pageOfStep(mark.fromStep) !== this.pageAt) {
      return null;
    }
    const from = this.stepX.get(mark.fromStep);
    // The far side: the step across the way, or - where that would be over a
    // bar line - this bar's own right edge, which is the last place in it
    // that still means a moment of its music.
    const to =
      mark.toStep === null
        ? this.measures.find((measure) => measure.measureIndex === mark.bar)?.right
        : this.stepX.get(mark.toStep);
    if (from === undefined || to === undefined) {
      return null;
    }
    // A line that falls between two notes is reckoned between where they were
    // drawn; one that falls *on* a note names it twice and lands on it
    // exactly. Notes on either side of a system break would be reckoned
    // across the width of the page, so those are left unruled.
    const system = this.systemOfStep(mark.fromStep);
    if (system === null || (mark.toStep !== null && system !== this.systemOfStep(mark.toStep))) {
      return null;
    }
    const band = this.systemBands.get(`${this.pageAt}:${this.systemIndexOnPage.get(system) ?? -1}`);
    if (band === undefined) {
      return null;
    }
    const x = from + (to - from) * mark.fraction;
    const line = doc.createElementNS(SVG_NAMESPACE, 'line');
    line.setAttribute('class', `ruler-line ruler-line--${mark.weight}`);
    line.setAttribute('x1', String(x));
    line.setAttribute('x2', String(x));
    line.setAttribute('y1', String(band.top));
    line.setAttribute('y2', String(band.bottom));
    return line;
  }

  showRhythmRuler(marks: readonly RulerMark[]): void {
    this.ruled = marks;
    this.paintRuler();
  }

  showBeat(mark: RulerMark | null): void {
    this.beatMark = mark;
    this.paintBeat();
  }

  /**
   * Stands a marker on the ruled line the music has reached.
   *
   * Drawn over the ruler rather than as part of it: the ruler says where the
   * beats *are*, and this says which one is happening - the second of those
   * moves and the first does not, so redrawing one must not redraw the other
   * on every beat of the piece.
   */
  private paintBeat(): void {
    this.beatGroup?.remove();
    this.beatGroup = null;
    const sheet = this.sheets[this.pageAt];
    const mark = this.beatMark;
    if (sheet === undefined || mark === null) {
      return;
    }
    const doc = sheet.ownerDocument;
    const line = this.ruleOne(mark, doc);
    if (line === null) {
      return;
    }
    line.setAttribute('class', `ruler-beat ruler-beat--${mark.weight}`);
    const group = doc.createElementNS(SVG_NAMESPACE, 'g');
    group.setAttribute('class', 'ruler-beat-mark');
    group.append(line);
    sheet.prepend(group);
    this.beatGroup = group;
  }

  /** Turns the preview on or off, the reader having said which they want. */
  turnPagesWithTheMusic(wanted: boolean): void {
    this.pagesFollowTheMusic = wanted;
  }

  showNextPagePreview(wanted: boolean): void {
    if (this.previewWanted === wanted) {
      return;
    }
    this.previewWanted = wanted;
    this.paintPreview(true);
  }

  /** Shows the cursor only where it belongs; the reader's choice still wins. */
  /**
   * Shows the marker where it belongs and hides it where it does not - and
   * does nothing at all where it is already as it should be.
   *
   * That last clause is the whole of what makes a playback affordable. This is
   * asked on every tick of the pulse, several to a note, whether or not the
   * marker moved; and the engraver's `show` is not a flag but a redraw - it
   * paints the marker's gradient onto a fresh canvas and encodes it as a PNG
   * every time. Measured on his device with the browser's profiler, a long
   * score spent two thirds of every second of playback doing that, for a
   * marker already standing in the right place, and the pulse had no time
   * left to keep. A marker that is showing has been put where it goes by the
   * step that moved it; showing it again moves nothing.
   */
  private placeCursor(): void {
    const cursor = this.osmd?.cursor as
      | { hidden?: boolean; show?: () => void; hide?: () => void }
      | undefined;
    if (cursor === undefined) {
      return;
    }
    const onThisPage = !this.paged || this.pageOfStep(this.navigator.position) === this.pageAt;
    if (onThisPage && this.navigator.isWanted) {
      if (cursor.hidden !== false) {
        cursor.show?.();
      }
      return;
    }
    // Hiding asks for no such care: it is a display flag and nothing more.
    cursor.hide?.();
  }

  private announcePages(): void {
    const state = this.pages;
    for (const listener of [...this.pageListeners]) {
      listener(state);
    }
  }

  /** The box that actually scrolls, which is not the one being drawn in. */
  private scroller(): Element | null {
    return this.container.closest('.score__scroll') ?? this.container.parentElement;
  }

  showPassage(passage: DrawnPassage): void {
    this.passage = passage;
    this.drawThePagesNearTheReader();
    this.paintPassage();
  }

  showStart(measureIndex: number | null): void {
    this.startMeasure = measureIndex;
    this.drawThePagesNearTheReader();
    this.paintPassage();
  }

  showRepeatedBars(measureIndexes: readonly number[]): void {
    this.repeatedBars = [...measureIndexes];
    this.paintPassage();
  }

  hidePassage(): void {
    this.passage = null;
    this.paintPassage();
  }

  /**
   * Reports the passage a drag left behind.
   *
   * One listener on the container rather than one per marker: the page is
   * re-engraved often - a zoom, a resize, a tempo change - and handlers bound
   * to elements would have to be rebound each time, or quietly stop working
   * after the first redraw.
   */
  onPassageDragged(listener: (passage: DrawnPassage) => void): () => void {
    this.passageListeners.push(listener);
    return () => {
      this.passageListeners = this.passageListeners.filter((each) => each !== listener);
    };
  }

  onScoreTapped(listener: () => void): () => void {
    this.tapListeners.push(listener);
    return () => {
      this.tapListeners = this.tapListeners.filter((each) => each !== listener);
    };
  }

  onBarHeld(listener: (measureIndex: number) => void): () => void {
    this.heldListeners.push(listener);
    return () => {
      this.heldListeners = this.heldListeners.filter((each) => each !== listener);
    };
  }

  onMarkerHeld(listener: (end: PassageEnd) => void): () => void {
    this.markerHeldListeners.push(listener);
    return () => {
      this.markerHeldListeners = this.markerHeldListeners.filter((each) => each !== listener);
    };
  }

  /**
   * Starts the clock on a finger that has taken hold of a marker.
   *
   * The same wait as a hold on a bar, and it ends the drag when it fires:
   * the reader asked for the marker to do something, not to be moved, and
   * letting the drag finish as well would nudge the passage a bar on the way
   * out - a tap on a grip already means that.
   */
  private watchForAMarkerHold(event: PointerEvent, edge: PassageEdge): void {
    this.cancelHold();
    this.holding = setTimeout(() => {
      this.holding = null;
      if (this.dragging?.pointerId !== event.pointerId) {
        return;
      }
      this.dragging = null;
      this.container.releasePointerCapture?.(event.pointerId);
      const end: PassageEnd = edge === 'start' ? 'from' : 'to';
      for (const listener of [...this.markerHeldListeners]) {
        listener(end);
      }
    }, HOLD_MS);
  }

  /** Starts the clock on a finger that may be pointing at a bar. */
  private watchForAHold(event: PointerEvent): void {
    this.cancelHold();
    this.holding = setTimeout(() => {
      this.holding = null;
      // Still where it landed: a finger that travelled was doing something
      // else, and by now it has been told so.
      if (this.tapFrom?.pointerId !== event.pointerId) {
        return;
      }
      // Asked at the end rather than at the start, because what is wanted is
      // where the finger *is*, and a bar is found by coordinates rather than
      // by whatever element happened to be under it.
      const point = this.drawingPointOf(event);
      const bar = point === null ? null : measureAt(this.measuresHere(), point);
      if (bar === null) {
        return;
      }
      this.tapFrom = null;
      for (const listener of [...this.heldListeners]) {
        listener(bar);
      }
    }, HOLD_MS);
  }

  private cancelHold(): void {
    if (this.holding !== null) {
      clearTimeout(this.holding);
      this.holding = null;
    }
  }

  /**
   * Follows a finger that has taken hold of a marker.
   *
   * Bound once, in the constructor, for the reason above. `pointerdown` only
   * takes hold when the touch actually landed on a marker, so everything else
   * - a scroll, a pinch - passes through untouched.
   */
  private watchForDrags(): void {
    // Before anything else, and not passive: a touch that landed on a marker
    // must not become a scroll. `touch-action` is supposed to say this on
    // its own, and on an SVG child it is not honoured everywhere - which is
    // why a marker could be moved sideways but never down the page. This
    // says it in the one way every browser obeys.
    this.container.addEventListener(
      'touchstart',
      (event) => {
        if (markerUnder(event.target, this.container) !== null) {
          event.preventDefault();
        }
      },
      { passive: false },
    );
    this.container.addEventListener(
      'touchmove',
      (event) => {
        if (this.dragging !== null) {
          event.preventDefault();
        }
      },
      { passive: false },
    );
    this.container.addEventListener('pointerdown', (event) => this.beginDrag(event));
    this.container.addEventListener('pointermove', (event) => this.continueDrag(event));
    this.container.addEventListener('pointerup', (event) => this.endDrag(event));
    this.container.addEventListener('pointercancel', () => {
      this.swipe = null;
      this.tapFrom = null;
      this.cancelHold();
      this.dragging = null;
      this.paintPassage();
    });
  }

  private beginDrag(event: PointerEvent): void {
    // A preview of the page ahead is a picture and nothing else. The bars in
    // it are not on this page, so a finger landing there must not be read as
    // pointing at a bar of this one - nor take hold of a marker standing
    // underneath it, which is drawn there and hidden.
    if (event.target instanceof Element && event.target.closest('.page-preview') !== null) {
      return;
    }
    // Before anything else. A switch is a drawn thing with an edge to aim
    // at, so what the browser says was touched is the exact answer - and a
    // press on one is not a tap on the music, a hold on a bar, or a page
    // being swiped.
    const hand = handUnder(event.target);
    if (hand !== null) {
      this.pressedHand = { pointerId: event.pointerId, staffNumber: hand };
      return;
    }
    const passage = this.passage;
    const touched = markerUnder(event.target, this.container);
    const point = this.drawingPointOf(event);
    // What the browser says was touched, and only then what the arithmetic
    // makes of the coordinates. The drawn handle and the area that answers
    // for it are the same shape, so the first answer is exact.
    const edge =
      touched?.edge ??
      (passage === null || point === null
        ? null
        : gripAt(
            bracketShapes(this.measuresHere(), passage.fromMeasureIndex, passage.toMeasureIndex),
            point,
          ));
    if (edge === null || passage === null) {
      // Not a marker, so it may be a page being turned. The markers come
      // first: a finger that landed on one is moving it, whatever else it
      // then does.
      this.swipe = this.paged
        ? { pointerId: event.pointerId, from: { x: event.clientX, y: event.clientY } }
        : null;
      this.tapFrom = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      this.watchForAHold(event);
      return;
    }
    // Held for the whole gesture, so a finger that wanders off the marker -
    // which is most of them - goes on moving it instead of being dropped.
    this.container.setPointerCapture?.(event.pointerId);
    // For the mouse. A touch screen has already decided, from the
    // `touch-action` of the shape the finger landed on.
    event.preventDefault();
    this.dragging = {
      edge,
      pointerId: event.pointerId,
      passage,
      from: { x: event.clientX, y: event.clientY },
      grip: touched?.end ?? null,
      overshot: false,
    };
    this.watchForAMarkerHold(event, edge);
  }

  private continueDrag(event: PointerEvent): void {
    this.turnIfDraggedOffThePage(event);
    const began = this.tapFrom ?? this.dragging?.from ?? null;
    if (
      began !== null &&
      Math.hypot(event.clientX - began.x, event.clientY - began.y) > TAP_SLACK_PX
    ) {
      // Moving is not pointing - of a bar or of a marker. A finger that has
      // set off with a marker is dragging it, and the wait it started when it
      // landed must not go off in the middle of that.
      this.cancelHold();
    }
    const moved = this.draggedTo(event);
    if (moved === null) {
      return;
    }
    event.preventDefault();
    this.dragging = { ...this.dragging as PassageDrag, passage: moved };
    this.paintPassage();
  }

  private endDrag(event: PointerEvent): void {
    const pressed = this.pressedHand;
    if (pressed !== null && pressed.pointerId === event.pointerId) {
      this.pressedHand = null;
      // Only if the finger is still on it: one that travelled was reaching
      // for something else, even if it did not reach it.
      if (handUnder(event.target) === pressed.staffNumber) {
        for (const listener of [...this.handListeners]) {
          listener(pressed.staffNumber);
        }
      }
      return;
    }
    const swipe = this.swipe;
    this.swipe = null;
    if (swipe !== null && swipe.pointerId === event.pointerId) {
      const turned = swipeDirection(swipe.from, { x: event.clientX, y: event.clientY });
      if (turned !== 0) {
        this.turnPages(turned);
        this.tapFrom = null;
        return;
      }
    }

    const began = this.tapFrom;
    this.tapFrom = null;
    this.cancelHold();
    if (began !== null && began.pointerId === event.pointerId) {
      // A tap and not a drag: a finger that stayed put. Anything that moved
      // was reaching for something, even if it did not reach it.
      const wandered = Math.hypot(event.clientX - began.x, event.clientY - began.y);
      if (wandered <= TAP_SLACK_PX) {
        for (const listener of [...this.tapListeners]) {
          listener();
        }
      }
      return;
    }

    const drag = this.dragging;
    const tapped = this.tappedGrip(event, drag);
    const moved = tapped ?? this.draggedTo(event);
    this.dragging = null;
    if (moved === null || drag === undefined || drag === null) {
      return;
    }
    this.container.releasePointerCapture?.(event.pointerId);
    this.passage = moved;
    this.paintPassage();
    for (const listener of [...this.passageListeners]) {
      listener(moved);
    }
  }

  /**
   * The passage one bar out or in, when a handle was tapped rather than
   * dragged.
   *
   * A finger that stayed put on a handle meant the button; anything that
   * travelled meant the handle, even if it did not travel far. Which is why
   * this is asked before the drag: at nought pixels of movement a drag says
   * "put it back where it already was", and that is not what was meant.
   */
  private tappedGrip(event: PointerEvent, drag: PassageDrag | null): DrawnPassage | null {
    if (drag === null) {
      return null;
    }
    const wandered = Math.hypot(event.clientX - drag.from.x, event.clientY - drag.from.y);
    if (wandered > TAP_SLACK_PX) {
      return null;
    }
    const shapes = bracketShapes(
      this.measuresHere(),
      drag.passage.fromMeasureIndex,
      drag.passage.toMeasureIndex,
    );
    const point = this.drawingPointOf(event);
    const grip =
      drag.grip === null
        ? point === null
          ? null
          : gripUnderPointer(gripsOf(shapes), point)
        : (gripsOf(shapes).find(
            (each) => each.edge === drag.edge && each.end === drag.grip,
          ) ?? null);
    if (grip === null) {
      return null;
    }
    const next = passageAfterTap(
      { fromIndex: drag.passage.fromMeasureIndex, toIndex: drag.passage.toMeasureIndex },
      grip,
    );
    return { fromMeasureIndex: next.fromIndex, toMeasureIndex: next.toIndex };
  }

  /**
   * Turns the page when a marker is dragged off the side of it.
   *
   * A passage that runs onto the next page cannot be chosen otherwise: the
   * marker reaches the edge and stops, because the bar it is being taken to
   * is not on the page. Dragging past the edge is the reader saying "further
   * than this", and it is the same gesture as carrying a finger off the side
   * of a list.
   *
   * The turn does not repeat while the finger stays out there: the new page
   * occupies the same part of the screen, so the pointer is inside it again
   * the moment it arrives.
   */
  private turnIfDraggedOffThePage(event: PointerEvent): void {
    const drag = this.dragging;
    if (!this.paged || drag === null) {
      return;
    }
    const point = this.drawingPointOf(event);
    const sheet = this.currentSheet();
    if (point === null || sheet === null) {
      return;
    }

    // Into the margin the engraver leaves at the edge of the page, which is
    // somewhere a finger can actually reach - the page is as wide as the
    // screen, so nothing can be dragged beyond it. Which handle is being
    // held has nothing to do with it: either of them can want the next page.
    const beyond = pageTurnForDrag(this.measuresHere(), point, intrinsicSize(sheet).width);
    if (beyond !== 0 && !drag.overshot) {
      this.dragging = { ...drag, overshot: true };
      this.turnPages(beyond);
      return;
    }
    // Only on the way in. Held out there, the finger would be past the new
    // page's last bar too the moment it arrived, and the reader would watch
    // the whole piece flip by; coming back inside arms it again, so going
    // several pages is several small movements rather than one long wait.
    if (beyond === 0 && drag.overshot) {
      this.dragging = { ...drag, overshot: false };
    }
  }

  /** Where this event puts the passage, or `null` when nothing is held. */
  private draggedTo(event: PointerEvent): DrawnPassage | null {
    const drag = this.dragging;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return null;
    }
    const point = this.drawingPointOf(event);
    if (point === null) {
      return null;
    }
    const landedOn = measureForDrag(this.measuresHere(), point, drag.edge);
    if (landedOn === null) {
      return null;
    }
    const next = passageAfterDrag(
      { fromIndex: drag.passage.fromMeasureIndex, toIndex: drag.passage.toMeasureIndex },
      drag.edge,
      landedOn,
    );
    return { fromMeasureIndex: next.fromIndex, toMeasureIndex: next.toIndex };
  }

  /** A touch, in the pixels the engraving was measured in. */
  private drawingPointOf(event: PointerEvent): { x: number; y: number } | null {
    // The sheet being read, not the first one. Every page is an SVG of its
    // own with its own coordinates, so mapping a touch through a page that
    // is hidden gives an answer about music nobody is looking at.
    const svg = this.currentSheet();
    if (svg === null) {
      return null;
    }

    // The browser's own answer, and the only one that is always right.
    //
    // Working it out by hand - the box on screen against the size the
    // engraver drew - assumes those two are a plain ratio of one another,
    // and they are not: a `viewBox`, a transform anywhere up the tree, or
    // the page being zoomed all break it, and the error grows with distance
    // from the origin. Which is exactly how the reader found it: the handles
    // at the top were nearly right, the ones lower down had to be pressed
    // below themselves, and the right-hand marker - furthest of all from the
    // corner - could not be taken hold of at all.
    const matrix = svg.getScreenCTM?.();
    if (matrix !== null && matrix !== undefined) {
      const inside = new DOMPointReadOnly(event.clientX, event.clientY).matrixTransform(
        matrix.inverse(),
      );
      return { x: inside.x, y: inside.y };
    }

    // No layout to ask - which is every test that runs the engraver without a
    // browser. The ratio is right whenever the drawing is shown whole and
    // unrotated, which is what those tests set up.
    const box = svg.getBoundingClientRect();
    return toDrawingPoint(
      { left: box.left, top: box.top, width: box.width, height: box.height },
      intrinsicSize(svg),
      { x: event.clientX, y: event.clientY },
    );
  }

  scrollToStart(): void {
    if (this.paged) {
      // Back to the first page, not to a scroll position: the two would
      // otherwise disagree about where the reader is, and the next page turn
      // would go somewhere neither of them expected.
      this.turnToPage(0);
      return;
    }
    // The scrolling box, not the framed one: the frame holds the cover and
    // does not move. Whichever ancestor actually scrolls is the one to ask.
    this.scroller()?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  }

  clear(): void {
    this.osmd?.clear();
    this.forgetSheets();
    this.pageAt = 0;
    this.swipe = null;
    this.measures = [];
    this.passage = null;
    this.dragging = null;
    this.marks = [];
    this.stepX = new Map();
    this.stepElements = new Map();
    this.stepNotes = new Map();
    this.stepsByPage = new Map();
    this.printedStaves = new Map();
    this.faded = new Set();
    this.samples = [];
    // The page it stood on has gone, so the group has too - and what is being
    // remembered about it must go with them, or the next page that wanted the
    // same preview would decide it was already drawn.
    this.previewGroup = null;
    this.previewShown = null;
    this.systemBands = new Map();
    this.lastSystemOnPage = new Map();
    this.systemsOnPage = new Map();
    this.loaded = false;
  }

  configureOverlay(context: OverlayContext): void {
    this.overlayContext = context;
  }

  showPlayed(note: PlayedNote): void {
    const mark: PlayedMark = {
      stepIndex: note.stepIndex,
      midi: note.midi,
      correct: note.correct,
      sounding: note.sounding,
      offset: note.offset,
      settled: note.settled,
    };
    this.marks.push(mark);
    // Only the mark just made, onto the page its own note is drawn on.
    // Redrawing every mark on every page for each note played is work that
    // grows with the run: two hundred notes into a long piece it was two
    // hundred times the drawing for one keystroke, and the trainer stopped
    // answering partway through the score.
    const page = this.pageOfStep(mark.stepIndex);
    const sheet = this.drawnSheet(page);
    const geometry = this.geometryByPage.get(page) ?? null;
    if (sheet === undefined || geometry === null) {
      return;
    }
    this.drawMarks([mark], this.overlayGroupFor(sheet), geometry);
  }

  /**
   * Takes a mark off again, without redrawing the rest.
   *
   * Found by what it is a mark *of* rather than by holding a handle to every
   * element: one mark is a notehead and possibly ledger lines and an
   * accidental, and a run puts hundreds of them on a page.
   */
  hidePlayed(note: { readonly stepIndex: number; readonly midi: number }): void {
    const before = this.marks.length;
    this.marks = this.marks.filter(
      (mark) => mark.stepIndex !== note.stepIndex || mark.midi !== note.midi,
    );
    if (this.marks.length === before) {
      return;
    }
    const sheet = this.sheets[this.pageOfStep(note.stepIndex)];
    for (const drawn of sheet?.querySelectorAll(`[data-mark="${note.stepIndex}:${note.midi}"]`) ??
      []) {
      drawn.remove();
    }
  }

  settlePlayed(stepIndex: number): void {
    let changed = false;
    this.marks = this.marks.map((mark) => {
      if (mark.stepIndex !== stepIndex || mark.settled) {
        return mark;
      }
      changed = true;
      return { ...mark, settled: true };
    });
    if (!changed) {
      return;
    }
    const sheet = this.sheets[this.pageOfStep(stepIndex)];
    // Restyled where they stand: the shapes are where they were, and only
    // what they say about themselves has changed.
    for (const drawn of sheet?.querySelectorAll(`[data-mark^="${stepIndex}:"]`) ?? []) {
      drawn.classList.remove('played--unsettled');
    }
  }

  clearPlayed(): void {
    this.marks = [];
    this.paintOverlay();
  }

  fadePassed(stepIndex: number): void {
    this.faded.add(stepIndex);
    for (const element of this.stepElements.get(stepIndex) ?? []) {
      element.classList.add(FADED_CLASS);
    }
  }

  clearFaded(): void {
    for (const stepIndex of this.faded) {
      for (const element of this.stepElements.get(stepIndex) ?? []) {
        element.classList.remove(FADED_CLASS);
      }
    }
    this.faded.clear();
  }

  /** Re-dims everything already passed, after the page has been redrawn. */
  dimUnplayed(reading: ScoreReading | null): void {
    this.reading = reading;
    this.drawThePagesNearTheReader();
    this.paintDimmed();
  }

  /**
   * Dims every note this run will not ask for, and undims the rest.
   *
   * Walked over the steps rather than kept as a set of elements, because the
   * answer changes whenever the passage or the hand does and the drawing is
   * thrown away whenever the music is engraved again. It is one pass over
   * what is on the page, which is what the fade already costs.
   */
  private paintDimmed(): void {
    const reading = this.reading;
    for (const [stepIndex, elements] of this.stepElements) {
      const outside = reading !== null && (stepIndex < reading.from || stepIndex > reading.to);
      for (const element of elements) {
        const staff = this.elementStaff.get(element);
        const otherHand =
          reading !== null &&
          reading.staves.length > 0 &&
          staff !== undefined &&
          !reading.staves.includes(staff);
        element.classList.toggle(UNPLAYED_CLASS, outside || otherHand);
      }
    }
  }

  private paintFaded(): void {
    for (const stepIndex of this.faded) {
      for (const element of this.stepElements.get(stepIndex) ?? []) {
        element.classList.add(FADED_CLASS);
      }
    }
  }

  /** Everything drawn over the engraving, rebuilt from the marks. */
  /**
   * Draws what was played, page by page.
   *
   * Per page and not once over the whole score, because every page is an SVG
   * of its own whose coordinates start again at nought. A mark for a note on
   * the second page, drawn into the first page's sheet, is a mark on the
   * wrong music - and on the page nobody is looking at.
   */
  private paintOverlay(): void {
    const context = this.overlayContext;
    // Sorted once, not filtered once per page: this runs on every note the
    // reader plays.
    const byPage = new Map<number, PlayedMark[]>();
    for (const mark of this.marks) {
      const page = this.pageOfStep(mark.stepIndex);
      byPage.set(page, [...(byPage.get(page) ?? []), mark]);
    }
    for (const [at, sheet] of this.sheetsDrawn()) {
      const group = this.overlayGroupFor(sheet);
      while (group.firstChild !== null) {
        group.firstChild.remove();
      }
      const marks = byPage.get(at) ?? [];
      // The heights this page was measured at, and no other: at a page break
      // the nearest note in the same step is on the sheet before, and taking
      // its height would put the mark a page out.
      const geometry = this.geometryByPage.get(at) ?? null;
      if (context === null || geometry === null || marks.length === 0) {
        continue;
      }
      this.drawMarks(marks, group, geometry);
    }
  }

  /**
   * Draws marks onto a page's overlay, leaving what is already there.
   *
   * Every mark is worked out on its own - none of them depends on another -
   * so the one that has just been played can be added without redrawing the
   * ones before it.
   */
  private drawMarks(
    marks: readonly PlayedMark[],
    group: SVGGElement,
    geometry: NonNullable<ReturnType<typeof fitStaffGeometry>>,
  ): void {
    const context = this.overlayContext;
    if (context === null || marks.length === 0) {
      return;
    }
    // One mark at a time, so each element can say which mark it belongs to -
    // a mark drawn only while a key is held has to be findable again when the
    // key comes up. The shapes of one mark depend on nothing but that mark,
    // so this draws exactly what building them all at once did.
    const shapes = marks.flatMap((mark) =>
      buildOverlayShapes([mark], {
        geometry,
        stepX: this.stepX,
        clefAt: context.clefAt,
        keyAt: context.keyAt,
      }).map((shape) => ({ shape, mark })),
    );
    for (const { shape, mark } of shapes) {
      const drawn = drawShape(shape, group.ownerDocument);
      drawn.setAttribute('data-mark', `${mark.stepIndex}:${mark.midi}`);
      if (mark.correct && mark.settled === false) {
        drawn.classList.add('played--unsettled');
      }
      group.append(drawn);
    }
  }

  /** The page a step's notes were drawn on. */
  private pageOfStep(stepIndex: number): number {
    return this.stepPage.get(stepIndex) ?? 0;
  }

  /**
   * Which system of the engraving this was drawn in, numbered as met.
   *
   * The engraver's own system object is the identity; the number is ours, so
   * that a sample can carry it and two samples can be compared. Numbered in
   * walk order, which is the order the systems run down the page.
   */
  private systemNumberOf(note: DrawnNote): number {
    const system: object | undefined =
      note.parentVoiceEntry?.parentStaffEntry?.parentMeasure?.ParentMusicSystem;
    if (system === undefined) {
      return -1;
    }
    const known = this.systemNumbers.get(system);
    if (known !== undefined) {
      return known;
    }
    const next = this.systemNumbers.size;
    this.systemNumbers.set(system, next);
    return next;
  }

  /** The page the engraver says it laid something out on, zero-based. */
  private pageOfGraphical(note: DrawnNote): number | null {
    const number =
      note.parentVoiceEntry?.parentStaffEntry?.parentMeasure?.ParentMusicSystem?.Parent
        ?.PageNumber;
    // The engraver numbers its pages from one; every page index here is from
    // nought, because it indexes the sheets it drew.
    return typeof number === 'number' && number >= 1 ? number - 1 : null;
  }

  /**
   * Where the engraver put every bar, asked of its own model.
   *
   * The model and not the drawn SVG, for the same reason the noteheads are:
   * a bounding box has to be measured by a browser that has laid the page
   * out, and the engraver already knows the answer without one. A bar is
   * measured across every staff of its system, so a marker spans both hands
   * rather than hanging off the treble.
   */
  private readMeasures(): DrawnMeasure[] {
    const sheet = (this.osmd as unknown as { GraphicSheet?: DrawnSheet } | null)?.GraphicSheet;
    const byIndex = new Map<number, DrawnMeasure>();
    const printed = this.readSystems();
    // Kept: the preview needs to know where a system stands, and reading the
    // printed lines walks every page of the drawing.
    this.systemBands = printed;
    for (const [pageAt, page] of (sheet?.MusicPages ?? []).entries()) {
      for (const [systemAt, system] of (page.MusicSystems ?? []).entries()) {
        // The printed lines where they can be read, and the engraver's own
        // reckoning where they cannot - which is only before anything has
        // been drawn.
        const extent = printed.get(`${pageAt}:${systemAt}`) ?? systemExtent(system);
        if (extent === null) {
          continue;
        }
        for (const staves of system.GraphicalMeasures ?? []) {
          // A grand staff draws each bar once per hand, at the same place
          // across the page; either copy gives the same left and right, and
          // the height belongs to the system rather than to the bar.
          for (const measure of staves ?? []) {
            const box = measure?.PositionAndShape;
            const at = measure?.parentSourceMeasure?.measureListIndex;
            if (box?.AbsolutePosition === undefined || box.Size === undefined || at === undefined) {
              continue;
            }
            const left = box.AbsolutePosition.x * UNITS_TO_PIXELS;
            const right = left + box.Size.width * UNITS_TO_PIXELS;
            const known = byIndex.get(at);
            byIndex.set(at, {
              measureIndex: at,
              page: pageAt,
              left: known === undefined ? left : Math.min(known.left, left),
              right: known === undefined ? right : Math.max(known.right, right),
              top: extent.top,
              bottom: extent.bottom,
            });
          }
        }
      }
    }
    return [...byIndex.values()].sort((left, right) => left.measureIndex - right.measureIndex);
  }

  /**
   * Draws the two markers, or takes them away.
   *
   * Their own group, not the overlay's: a mark for a note the reader played
   * is cleared at the start of every run, and the passage is not.
   */
  private paintPassage(): void {
    for (const [, sheet] of this.sheetsDrawn()) {
      this.passageGroupFor(sheet).replaceChildren();
    }
    this.paintStart();
    this.paintBarMarks();
    const showing = this.dragging?.passage ?? this.passage;
    if (showing === null) {
      return;
    }
    for (const bracket of bracketShapes(
      this.measures,
      showing.fromMeasureIndex,
      showing.toMeasureIndex,
    )) {
      // Each marker on the page its own bar is drawn on: a passage can run
      // across a page break, and then the two markers are not on the same
      // sheet at all.
      const sheet = this.drawnSheet(this.pageOfMeasure(bracket.measureIndex));
      if (sheet === undefined) {
        continue;
      }
      this.passageGroupFor(sheet).append(drawPassageMarker(sheet.ownerDocument, bracket, showing));
    }
  }

  /**
   * Draws the bar the music will start from.
   *
   * A quieter line than the passage markers and with nothing to take hold
   * of: it is a sign and not a control, moved by holding a finger on a bar
   * and cleared from the transport bar. It hides with the markers, because
   * a reader who has put the furniture away has put all of it away.
   */
  /**
   * What each numbered bar has to say about itself beyond its number.
   *
   * Two things, and they belong together because they stand in the same
   * place: the bar's own number, then its place in the playing where the two
   * have parted company, then a turning arrow where this reading is a second
   * one. Laid out left to right in that order, because otherwise the arrow
   * and the place are drawn on top of each other.
   *
   * Only where the engraver drew a number. It numbers every second bar or
   * so, and the number is the thing that needs explaining - a bar with no
   * number asks the reader no question - and it is the one place above the
   * staff already kept clear, so nothing here can land on a note.
   */
  private paintBarMarks(): void {
    for (const measure of this.measures) {
      // Every page, not the one being read. `measuresHere` is for aiming a
      // touch, where only the page in front of the reader can be hit; a mark
      // is drawn once and then turned to, so asking that question here meant
      // the marks existed only on whichever page happened to be current when
      // this last ran. Turning to any other page showed none - and zooming
      // in, which cuts the piece into more pages, put nearly every repeated
      // bar on a page that had never been painted.
      const sheet = this.drawnSheet(measure.page);
      if (sheet === undefined) {
        continue;
      }
      const number = this.numberTextNear(sheet, measure);
      if (number === null) {
        continue;
      }
      const repeated = this.repeatedBars.includes(measure.measureIndex);
      const place = measure.measureIndex + 1;
      const printed = Number.parseInt(number.text, 10);
      const renumbered = Number.isFinite(printed) && printed !== place;
      const doc = sheet.ownerDocument;
      let after = number.x + number.width;

      // A piece that repeats prints one number on two bars, and every bar
      // after a repeat is further into the playing than its number says. The
      // hold, the markers and the boxes all count the playing, so the place
      // is what the bar is called here, drawn as the engraver draws one, and
      // the number the writer gave it goes on the line above where it is
      // still there to be found.
      if (renumbered) {
        number.node.style.display = 'none';
        const said = doc.createElementNS(SVG_NAMESPACE, 'text');
        said.setAttribute('class', 'bar-position');
        said.setAttribute('x', String(number.x));
        said.setAttribute('y', String(number.y));
        said.setAttribute('font-size', String(number.height));
        said.textContent = String(place);
        this.passageGroupFor(sheet).append(said);
        after = number.x + String(place).length * number.height * 0.5;
      }

      if (!repeated) {
        continue;
      }

      // The line above belongs to the bar being read a second time: what the
      // writer called it, and the turning arrow saying why the numbers went
      // back. Only here, because only here is there a question - a bar read
      // once and numbered by its place asks nothing.
      let markX = after + REPEAT_MARK_GAP + REPEAT_MARK_RADIUS;
      let markY = number.y - number.height;
      if (renumbered) {
        const height = number.height * BAR_PRINTED_SCALE;
        const above = number.y - number.height * BAR_PRINTED_RISE;
        const was = doc.createElementNS(SVG_NAMESPACE, 'text');
        was.setAttribute('class', 'bar-printed');
        was.setAttribute('x', String(number.x));
        was.setAttribute('y', String(above));
        was.setAttribute('font-size', String(height));
        was.textContent = String(printed);
        this.passageGroupFor(sheet).append(was);
        markX =
          number.x + String(printed).length * height * 0.5 + REPEAT_MARK_GAP + REPEAT_MARK_RADIUS;
        markY = above - height * 0.35;
      }
      this.passageGroupFor(sheet).append(drawRepeatMark(doc, markX, markY));
    }
  }

  /**
   * The bar number the engraver drew for this bar, if it drew one.
   *
   * Found by where it is rather than by what it says: a score written out
   * from its repeats says "twenty" twice, which is the whole reason the mark
   * exists, so the text itself cannot tell the two apart.
   */
  /**
   * Every number the engraver printed on a page, read once for that page.
   *
   * Asked once for each bar that is marked, and it used to query the whole
   * page's text and read every piece of it attribute by attribute each time:
   * the bars times the text on the page, all of it through the document. Read
   * once, the search for a bar is a walk over a short list in memory.
   *
   * The engraver's own numbers only. Ours, from the last painting of this same
   * page, are digits too - the writer's number drawn on the line above is
   * digits beside a bar number, which is exactly what this is looking for - so
   * they are passed over by the class this renderer gives them. Hiding one of
   * the engraver's numbers, which painting does, changes nothing read here.
   */
  private numbersPrintedOn(sheet: SVGSVGElement): readonly PrintedNumber[] {
    const known = this.numbersOn.get(sheet);
    if (known !== undefined) {
      return known;
    }
    const found: PrintedNumber[] = [];
    for (const text of sheet.querySelectorAll('text')) {
      const ours = text.getAttribute('class') ?? '';
      if (ours === 'bar-position' || ours === 'bar-printed') {
        continue;
      }
      const digits = text.textContent ?? '';
      if (!/^\d+$/.test(digits)) {
        continue;
      }
      const height = Number.parseFloat((text.getAttribute('font-size') ?? '15').replace(/[a-z]+$/i, ''));
      found.push({
        node: text,
        text: digits,
        x: Number.parseFloat(text.getAttribute('x') ?? ''),
        y: Number.parseFloat(text.getAttribute('y') ?? ''),
        height: Number.isFinite(height) ? height : 15,
      });
    }
    this.numbersOn.set(sheet, found);
    return found;
  }

  private numberTextNear(
    sheet: SVGSVGElement,
    measure: DrawnMeasure,
  ): {
    node: SVGTextElement;
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null {
    for (const printed of this.numbersPrintedOn(sheet)) {
      if (
        Math.abs(printed.x - measure.left) > NUMBER_REACH ||
        Math.abs(printed.y - measure.top) > NUMBER_REACH
      ) {
        continue;
      }
      return {
        node: printed.node,
        text: printed.text,
        x: printed.x,
        y: printed.y,
        // Its own width, near enough: the digits are what the mark stands
        // clear of, and a glyph is about half its height across.
        width: printed.text.length * printed.height * 0.5,
        height: printed.height,
      };
    }
    return null;
  }

  private paintStart(): void {
    const at = this.startMeasure;
    // All of them, for the reason the repeat marks are: the reader puts their
    // place on a bar and then turns the page away from it, and the mark has
    // to be there when they turn back.
    const measure = at === null ? undefined : this.measures.find(
      (each) => each.measureIndex === at,
    );
    if (measure === undefined || this.passage === null) {
      return;
    }
    const sheet = this.drawnSheet(measure.page);
    if (sheet === undefined) {
      return;
    }
    this.passageGroupFor(sheet).append(drawStartMarker(sheet.ownerDocument, measure));
  }

  /** The marker layer inside one page's sheet, made if it is not there yet. */
  /**
   * Where each staff of each system was drawn, page by page.
   *
   * Read off the five printed lines rather than out of the engraver's model.
   * The model's box for a staff is drawn round what is *on* it - stems,
   * beams, an inner voice hanging below - so a switch centred in that box
   * sat below the lines, and by a different amount on each hand. The lines
   * themselves are where the staff is, by definition.
   *
   * Ledger lines are drawn in the same group and have to be told from the
   * staff's own: a ledger is a couple of note-widths and a staff line runs
   * the width of the measure, so width tells them apart. Middle C in the
   * treble is exactly this case, and it is the first note of half the
   * fixtures here.
   */
  /**
   * Where every staff was drawn, read off the printed lines.
   *
   * Read once for each page and kept, for as long as the layout it was read
   * from: it is a fact about the drawing and nothing else, and it is asked
   * every time the markers are painted - which happens on every start of a run
   * or a playback, twice. Each reading walks every staff line on a page and
   * asks the document for its ends one attribute at a time, and on a long
   * score that was a quarter of a second of every start, measured with the
   * browser's profiler on his device.
   *
   * Only the pages that have been drawn can be read, and a page not drawn yet
   * has nothing here until it is.
   */
  private readStaves(): DrawnStaff[] {
    const staves: DrawnStaff[] = [];
    for (const [pageAt, sheet] of this.sheets.entries()) {
      let onPage = this.printedStaves.get(pageAt);
      if (onPage === undefined) {
        if (!this.isDrawn(pageAt)) {
          continue;
        }
        onPage = this.stavesPrintedOn(sheet, pageAt);
        this.printedStaves.set(pageAt, onPage);
      }
      staves.push(...onPage);
    }
    return staves;
  }

  /** One page's staves, off its printed lines. */
  private stavesPrintedOn(sheet: SVGSVGElement, pageAt: number): DrawnStaff[] {
    const staves: DrawnStaff[] = [];
    const drawn = [...sheet.querySelectorAll('.staffline')];
    for (const [at, group] of drawn.entries()) {
      const ys = staffLinesIn(horizontalRules(group));
      if (ys.length === 0) {
        continue;
      }
      const full = horizontalRules(group).filter((line) => ys.includes(line.y));
      staves.push({
        // Counted from the top down within each system, which is how the
        // score numbers them and how the reader would: the right hand is
        // the upper staff.
        staffNumber: (at % Math.max(1, this.stavesPerSystem())) + 1,
        page: pageAt,
        left: Math.min(...full.map((line) => line.from)),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
      });
    }
    return staves;
  }

  /**
   * How far each system reaches, top line to bottom line.
   *
   * Off the printed lines, for the reason the hand switches are: the
   * engraver's box for a staff is drawn round what is *on* it, so a marker
   * measured from it runs past the staves where an inner voice hangs below
   * and stops short of them where the music sits high. On the fixture it
   * overran the bottom line by twenty pixels - two staff spaces - and the
   * amount changes with the notes.
   *
   * Keyed by page and by which system of it, which is the order both this and
   * the engraver's own model walk in.
   */
  private readSystems(): Map<string, { top: number; bottom: number }> {
    const perSystem = Math.max(1, this.stavesPerSystem());
    const found = new Map<string, { top: number; bottom: number }>();
    const seen = new Map<number, number>();
    for (const staff of this.readStaves()) {
      const at = seen.get(staff.page) ?? 0;
      seen.set(staff.page, at + 1);
      const key = `${staff.page}:${Math.floor(at / perSystem)}`;
      const known = found.get(key);
      found.set(key, {
        top: known === undefined ? staff.top : Math.min(known.top, staff.top),
        bottom: known === undefined ? staff.bottom : Math.max(known.bottom, staff.bottom),
      });
    }
    return found;
  }

  /** How many staves each system carries, which is the same for every one. */
  private stavesPerSystem(): number {
    const sheet = (this.osmd as unknown as { GraphicSheet?: DrawnSheet } | null)?.GraphicSheet;
    for (const page of sheet?.MusicPages ?? []) {
      for (const system of page.MusicSystems ?? []) {
        const count = (system.StaffLines ?? []).length;
        if (count > 0) {
          return count;
        }
      }
    }
    return 1;
  }

  showHands(playing: readonly number[]): void {
    this.handsPlaying = [...playing];
    this.paintHands();
  }

  onHandToggled(listener: (staffNumber: number) => void): () => void {
    this.handListeners.push(listener);
    return () => {
      this.handListeners = this.handListeners.filter((each) => each !== listener);
    };
  }

  /**
   * A switch beside every staff, on every system of every page.
   *
   * Repeated the way a clef is repeated, so there is one within reach of
   * wherever the reader's eye happens to be - a single switch at the top of
   * the page would be a switch to go and find.
   *
   * Outside the staff rather than over it: the left margin holds the brace
   * and nothing else, so nothing here can land on a note.
   */
  private paintHands(): void {
    for (const [, sheet] of this.sheetsDrawn()) {
      this.handGroupFor(sheet).replaceChildren();
    }
    if (this.handsPlaying.length === 0) {
      return;
    }
    for (const staff of this.readStaves()) {
      const sheet = this.drawnSheet(staff.page);
      if (sheet === undefined) {
        continue;
      }
      const on = this.handsPlaying.includes(staff.staffNumber);
      this.handGroupFor(sheet).append(drawHandSwitch(sheet.ownerDocument, staff, on));
    }
  }

  /**
   * Its own layer, and under the passage markers.
   *
   * The passage layer is emptied and redrawn every time a marker moves, and
   * these do not move at all: they belong to the staves, which only change
   * when the music is engraved again.
   */
  private handGroupFor(sheet: SVGSVGElement): SVGGElement {
    return this.layerOn(sheet, 'hand-switches');
  }

  private passageGroupFor(sheet: SVGSVGElement): SVGGElement {
    return this.layerOn(sheet, 'passage-markers');
  }

  /** The page a bar was drawn on. */
  private pageOfMeasure(measureIndex: number): number {
    return this.measures.find((measure) => measure.measureIndex === measureIndex)?.page ?? 0;
  }


  private overlayGroupFor(sheet: SVGSVGElement): SVGGElement {
    return this.layerOn(sheet, 'played-overlay');
  }

  /**
   * A layer of our own inside one page's sheet - the marks played, the hand
   * switches, the passage - made if it is not there yet, and kept rather than
   * looked up.
   *
   * One per page rather than one for the score: what is drawn on a page has
   * to live in that page's SVG or it is drawn in the wrong coordinates on the
   * wrong sheet. And kept, because asking the page for it by class walks the
   * whole drawing, and a layer is appended last so the walk never ends early:
   * on a score of twenty-odd thousand elements that was the entire cost of
   * showing a played note, paid again on every keystroke. The hands and the
   * passage are painted on every start, on every page, and on the longest
   * score he owns their two walks were seventeen milliseconds of each start.
   *
   * Keyed by the page itself, so an engraving that replaces the pages leaves
   * the old entries unreachable and the new pages simply have none.
   */
  private layerOn(sheet: SVGSVGElement, name: string): SVGGElement {
    const onThisPage = this.layers.get(sheet) ?? new Map<string, SVGGElement>();
    this.layers.set(sheet, onThisPage);
    const kept = onThisPage.get(name);
    if (kept !== undefined && kept.parentNode === sheet) {
      return kept;
    }
    const group = sheet.ownerDocument.createElementNS(SVG_NAMESPACE, 'g');
    group.setAttribute('class', name);
    sheet.append(group);
    onThisPage.set(name, group);
    return group;
  }


  /**
   * Records where the engraver put each step, and the pitches it drew there.
   *
   * Walking the cursor is the only way to ask, so the visible cursor is walked
   * once and then put back where it was.
   */
  private indexDrawnNotes(): void {
    this.walking = true;
    try {
      this.walkDrawnNotes();
    } finally {
      this.walking = false;
    }
  }

  private walkDrawnNotes(): void {
    const osmd = this.osmd;
    const cursor = osmd?.cursor;
    if (osmd === null || cursor === undefined || cursor === null) {
      this.stepX = new Map();
      this.samples = [];
      return;
    }

    const restoreTo = this.navigator.position;
    const stepX = new Map<number, number>();
    /** Steps whose place was read off a note rather than off a rest. */
    const placedByANote = new Set<number>();
    const samples: DrawnNoteSample[] = [];
    const stepNotes = new Map<number, DrawnNote[]>();
    this.stepElements = new Map();
    this.systemNumbers = new Map();
    // Found again, every one: the layout they were found in has gone.
    this.stepPage = new Map();

    const index = walkEveryPlace(cursor, placesToBeginIn(osmd.Sheet), (step) => {
      this.readStep(cursor, step, stepX, placedByANote, samples, stepNotes);
    });

    this.carryPagesForward(index);
    this.stepNotes = stepNotes;
    this.stepsByPage = new Map();
    for (const [stepIndex, page] of this.stepPage) {
      const onPage = this.stepsByPage.get(page) ?? [];
      onPage.push(stepIndex);
      this.stepsByPage.set(page, onPage);
    }
    this.stepX = stepX;
    this.samples = samples;
    this.measureStaffHeights();
    this.readSystemShape();
    for (const [page] of this.sheetsDrawn()) {
      this.collectDrawnNotes(page);
    }
    this.navigator.reset();
    this.navigator.moveTo(restoreTo);
  }

  /**
   * Which systems each page holds, in the numbering the samples carry.
   *
   * The samples number systems as they are met, walking the score, so the
   * numbers on one page are consecutive and run down it - which makes the
   * largest of them the last system on that page, and that is the only thing
   * the preview needs to know about where the music has got to.
   */
  private readSystemShape(): void {
    const byPage = new Map<number, Set<number>>();
    for (const sample of this.samples) {
      const bucket = byPage.get(sample.page) ?? new Set<number>();
      bucket.add(sample.system);
      byPage.set(sample.page, bucket);
    }
    this.lastSystemOnPage = new Map();
    this.systemsOnPage = new Map();
    this.systemIndexOnPage = new Map();
    for (const [page, systems] of byPage) {
      this.lastSystemOnPage.set(page, Math.max(...systems));
      this.systemsOnPage.set(page, systems.size);
      // Numbered as they were met, so sorting them puts them back in the
      // order they run down the page - which is what the printed bands are
      // keyed by.
      for (const [at, system] of [...systems].sort((left, right) => left - right).entries()) {
        this.systemIndexOnPage.set(system, at);
      }
    }
  }

  /** Which system a step was drawn in, or `null` where nothing knows. */
  private systemOfStep(stepIndex: number): number | null {
    const page = this.pageOfStep(stepIndex);
    return this.geometryByPage.get(page)?.systemOfStep.get(stepIndex) ?? null;
  }

  /**
   * Gives the steps that could say nothing the page of the one before them.
   *
   * Two whole bars of rest in a row are drawn as a single multi-rest, so the
   * second bar has no graphical object at all to ask. A step the engraver
   * cannot place is on the page the music had reached when it got there,
   * which is the only answer a forward walk can give and the right one: a
   * page break happens at a bar the engraver *did* draw.
   */
  private carryPagesForward(steps: number): void {
    let last = 0;
    for (let index = 0; index < steps; index += 1) {
      const known = this.stepPage.get(index);
      if (known === undefined) {
        this.stepPage.set(index, last);
        continue;
      }
      last = known;
    }
  }

  /**
   * Measures each page's staff, once per engraving.
   *
   * A page's own notes and no others: at a page break the nearest note in
   * the same step is on the sheet before, and its height belongs to that
   * page's drawing rather than this one's.
   */
  private measureStaffHeights(): void {
    const byPage = new Map<number, DrawnNoteSample[]>();
    for (const sample of this.samples) {
      byPage.set(sample.page, [...(byPage.get(sample.page) ?? []), sample]);
    }
    this.geometryByPage = new Map();
    for (const [page, samples] of byPage) {
      this.geometryByPage.set(page, fitStaffGeometry(samples));
    }
  }

  /**
   * Gives each step the stems, ledger lines and beams that belong to it.
   *
   * The cursor hands back a notehead's own group and nothing else, so fading
   * a step left its stem standing and its beam floating over the gap - which
   * reads as sixteenths that lost their flags rather than as a page emptying.
   *
   * VexFlow's ids are the link: a note drawn as `vf-auto1003` owns
   * `vf-auto1003-stem` and `vf-auto1003ledgers`, and any beam beginning at it
   * is `vf-auto1003-beam0`.
   */
  private attachNoteFurniture(sheet: SVGSVGElement, steps: readonly number[]): void {
    const stepOfNote = new Map<string, number>();
    for (const stepIndex of steps) {
      for (const element of this.stepElements.get(stepIndex) ?? []) {
        if (element.id !== '') {
          stepOfNote.set(element.id, stepIndex);
        }
      }
    }

    const add = (stepIndex: number, element: SVGGElement | null): void => {
      if (element === null) {
        return;
      }
      const bucket = this.stepElements.get(stepIndex) ?? [];
      bucket.push(element);
      this.stepElements.set(stepIndex, bucket);
    };

    // One pass over the page for each kind of furniture, and a map to look
    // them up in. Asking the document to find one element at a time cost the
    // length of the score times the size of it - thousands of full scans on a
    // long piece, every time it was engraved.
    //
    // One page at a time, since pages are drawn one at a time - and every page
    // that is drawn, not only the first: stems on every page but the first
    // were once left behind by the notes they belong to.
    const byId = (selector: string): Map<string, SVGGElement> => {
      const found = new Map<string, SVGGElement>();
      for (const element of sheet.querySelectorAll<SVGGElement>(selector)) {
        found.set(element.id, element);
      }
      return found;
    };
    const stems = byId('g.vf-stem');
    const ledgers = byId('g.vf-ledgers');
    for (const [id, stepIndex] of stepOfNote) {
      add(stepIndex, stems.get(`${id}-stem`) ?? null);
      add(stepIndex, ledgers.get(`${id}ledgers`) ?? null);
    }

    const notes = byId('g.vf-stavenote');
    const inMeasures = new Map<Element, MeasureNotes>();
    for (const beam of sheet.querySelectorAll<SVGGElement>('g.vf-beam')) {
      const owner = beam.id.replace(/-beam\d+$/, '');
      const lastStep = this.lastStepOfBeam(owner, notes, inMeasures, stepOfNote);
      if (lastStep !== null) {
        // The *last* note of the group, not its first: a beam that left with
        // the note it starts on would strand the notes it still joins.
        add(lastStep, beam);
      }
    }
  }

  /**
   * The step the last note under a beam belongs to.
   *
   * The group runs from its owning note up to the next note that owns a beam,
   * or to the end of that measure. A group followed by unbeamed notes reaches
   * one note too far and the beam fades a moment late, which is the safe
   * direction to be wrong in: a note keeping its beam still reads correctly,
   * while a beam without notes does not.
   */
  private lastStepOfBeam(
    owner: string,
    notesById: ReadonlyMap<string, SVGGElement>,
    inMeasures: Map<Element, MeasureNotes>,
    stepOfNote: ReadonlyMap<string, number>,
  ): number | null {
    const start = notesById.get(owner) ?? null;
    const measure = start?.parentElement ?? null;
    if (start === null || measure === null) {
      return null;
    }
    // Read once per measure and kept: a bar's notes and its beam owners are
    // the same answer for every beam in it, and there may be many.
    let inMeasure = inMeasures.get(measure);
    if (inMeasure === undefined) {
      const notes = [...measure.querySelectorAll('g.vf-stavenote')];
      inMeasure = {
        notes,
        at: new Map(notes.map((note, index) => [note, index])),
        owners: new Set(
          [...measure.querySelectorAll('g.vf-beam')].map((beam) =>
            beam.id.replace(/-beam\d+$/, ''),
          ),
        ),
      };
      inMeasures.set(measure, inMeasure);
    }

    const from = inMeasure.at.get(start) ?? -1;
    let last: number | null = null;
    for (let at = from; at >= 0 && at < inMeasure.notes.length; at += 1) {
      const note = inMeasure.notes[at];
      if (note === undefined || (at > from && inMeasure.owners.has(note.id))) {
        break;
      }
      const step = stepOfNote.get(note.id);
      if (step !== undefined) {
        last = last === null ? step : Math.max(last, step);
      }
    }
    return last;
  }

  private readStep(
    cursor: NonNullable<OpenSheetMusicDisplay['cursor']>,
    stepIndex: number,
    stepX: Map<number, number>,
    placedByANote: Set<number>,
    samples: DrawnNoteSample[],
    stepNotes: Map<number, DrawnNote[]>,
  ): void {
    try {
      for (const graphical of cursor.GNotesUnderCursor()) {
        const note = graphical as unknown as DrawnNote;
        const position = note.PositionAndShape?.AbsolutePosition;
        if (position === undefined) {
          continue;
        }

        // Where this step stands on the page - and taken from a *note*
        // whenever one is drawn here. A whole-measure rest is not drawn where
        // its bar begins but in the middle of the bar, wherever the music of
        // that bar actually falls: it says "this voice is silent for the
        // whole bar" and has no moment of its own to stand at. Read off one,
        // every mark for a downbeat in Bone Bottom's opening bars - the right
        // hand resting through them while the left plays - was drawn half a
        // bar to the right of the beat it was played on.
        //
        // A rest still answers where nothing else does: a step where every
        // voice is silent has nowhere better for a mark to go.
        const pitched = note.sourceNote?.pitch !== undefined && note.sourceNote?.pitch !== null;
        if (pitched ? !placedByANote.has(stepIndex) : !stepX.has(stepIndex)) {
          stepX.set(stepIndex, position.x * UNITS_TO_PIXELS);
          if (pitched) {
            placedByANote.add(stepIndex);
          }
        }

        // Kept whether or not it is drawn: most pages are not, and the group
        // a note is drawn as is looked for when its page is.
        const kept = stepNotes.get(stepIndex) ?? [];
        kept.push(note);
        stepNotes.set(stepIndex, kept);
        // Which page the engraver laid it out on, asked of the layout rather
        // than read off the drawing, since most pages are not drawn. Rests are
        // asked the same way: read off the drawing, a rest - which is given no
        // group of its own - belonged to no page at all, which reads as page
        // one, and the page turned back to the beginning under a reader in the
        // middle of the piece.
        if (!this.stepPage.has(stepIndex)) {
          const page = this.pageOfGraphical(note);
          if (page !== null) {
            this.stepPage.set(stepIndex, page);
          }
        }

        // Everything below is about *pitch*, which a rest has none of: it
        // takes a cursor position and a place on the page, but no staff
        // position for the overlay geometry to measure from.
        const pitch = note.sourceNote?.pitch;
        if (pitch === undefined || pitch === null) {
          continue;
        }

        const diatonicIndex = diatonicIndexOf(pitch.FundamentalNote ?? -1, pitch.Octave ?? 0);
        if (diatonicIndex === null) {
          continue;
        }
        samples.push({
          stepIndex,
          x: position.x * UNITS_TO_PIXELS,
          page: this.stepPage.get(stepIndex) ?? 0,
          system: this.systemNumberOf(note),
          staffNumber: note.sourceNote?.parentStaffEntry?.parentStaff?.id ?? 1,
          diatonicIndex,
          y: position.y * UNITS_TO_PIXELS,
        });
      }
    } catch {
      // A step the engraver could not describe simply contributes nothing.
    }
  }

  private async ensureEngraver(): Promise<PageByPageEngraver> {
    if (this.osmd !== null) {
      return this.osmd;
    }
    const { PageByPageEngraver: Engraver } = await import('./PageByPageEngraver.js');
    const osmd = new Engraver(this.container, {
      autoResize: false,
      backend: 'svg',
      drawTitle: this.options.drawTitle ?? false,
      drawSubtitle: false,
      drawComposer: false,
      drawPartNames: false,
      drawMetronomeMarks: true,
      // The numbers the file states, which for a passage are the numbers of
      // the score it was cut out of. Drawn from 1 they would say "an eight-bar
      // piece" about bars 20 to 27, and nothing else on the page corrects it.
      drawMeasureNumbers: true,
      useXMLMeasureNumbers: true,
      autoBeam: true,
      followCursor: true,
      disableCursor: false,
      cursorsOptions: [
        {
          type: 0,
          color: this.options.cursorColor ?? '#3b82f6',
          alpha: 0.45,
          follow: true,
        },
        // The other hand's, and fainter: it says where the music is rather than
        // where the reader must be, so it must never be the thing the eye goes
        // to. It does not follow, either - see `otherHand`.
        {
          type: 0,
          color: this.options.otherHandColor ?? '#94a3b8',
          alpha: 0.28,
          follow: false,
        },
      ],
    });
    osmd.zoom = this.currentZoom;
    this.osmd = osmd;
    return osmd;
  }
}

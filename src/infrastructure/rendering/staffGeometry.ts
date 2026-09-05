import { floorMod } from '../../shared/asserts.js';
import type { ClefKind } from '../../domain/model/Clef.js';

/**
 * A note the engraver has already drawn, used to work out where everything
 * else on that staff belongs.
 */
export interface DrawnNoteSample {
  /** Timeline step this note was drawn for. */
  readonly stepIndex: number;
  /**
   * Which page of the engraving this note was drawn on.
   *
   * Every page is an SVG of its own and starts again at nought, so a height
   * measured on one page means nothing on another. Marks are placed against
   * the nearest note in the same step, and at a page break the nearest step
   * is on the sheet before - which would put the mark a page's height out.
   */
  readonly page: number;
  /**
   * Which system of that page this note was drawn in.
   *
   * A page holds several systems one under another, and the same fault the
   * page number exists to stop happens again at a smaller scale between them:
   * the nearest note in step order is on the line above or below whenever a
   * staff has nothing at the step being placed, and a mark measured from it
   * is drawn a system's height out - over empty staff, in the other clef.
   */
  readonly system: number;
  readonly staffNumber: number;
  /** Absolute staff position: `C4` is 28, `D4` is 29. */
  readonly diatonicIndex: number;
  /** Vertical centre of the notehead, in the drawing's own units. */
  readonly y: number;
  /**
   * Where the notehead stands across the page, in the same units.
   *
   * Optional because a sample can be fabricated - the arithmetic here is
   * tested on made-up numbers - and a fabricated one has no drawing to have
   * been read off. Absent, a mark falls back to the step's own place, which
   * is where every mark stood before this was recorded.
   */
  readonly x?: number;
}

export interface StaffGeometry {
  /** Vertical distance between neighbouring staff positions. */
  readonly stepHeight: number;
  /**
   * Every drawn note, grouped by staff.
   *
   * A page holds several systems, one under another, so a staff has no single
   * vertical position: the third bar's treble stave may be four hundred units
   * below the first one's. Marks are therefore placed against the nearest note
   * in the same *step*, never against a page-wide average.
   */
  readonly byStaff: ReadonlyMap<number, readonly DrawnNoteSample[]>;
  /**
   * Which system each step was drawn in, across every staff of the page.
   *
   * Read from the staves together, because a step drawn on one of them is at
   * that height on all of them - which is what lets a mark on a staff with
   * nothing at this step still be placed on the right line.
   */
  readonly systemOfStep: ReadonlyMap<number, number>;
  /**
   * Where each printed note stands, by step and staff position.
   *
   * The page's own answer to "which hand is this note written for, and where
   * is it", and the only one that cannot be argued with: the note is *there*,
   * on that stave, in that bar, at that point across it.
   */
  readonly printedOn: ReadonlyMap<number, ReadonlyMap<number, PrintedNote>>;
}

/** Where the page puts one note: which stave, and where across it. */
export interface PrintedNote {
  readonly staffNumber: number;
  /** `null` where the drawing did not say. */
  readonly x: number | null;
}

/** Semitone value of each letter, which is what the engraver reports. */
const LETTER_BY_SEMITONE: Readonly<Record<number, number>> = {
  0: 0, // C
  2: 1, // D
  4: 2, // E
  5: 3, // F
  7: 4, // G
  9: 5, // A
  11: 6, // B
};

/**
 * Converts the engraver's own pitch description into a staff position.
 *
 * Its octave numbering is three below scientific pitch - middle C is octave 1
 * there and octave 4 everywhere else in this project.
 */
export function diatonicIndexOf(fundamentalSemitone: number, engraverOctave: number): number | null {
  const letter = LETTER_BY_SEMITONE[fundamentalSemitone];
  if (letter === undefined) {
    return null;
  }
  return (engraverOctave + 3) * 7 + letter;
}

/**
 * Works out the vertical scale of the drawing from notes already on it.
 *
 * Nothing is assumed about the engraver's units: the distance between staff
 * positions is measured from pairs of real notes, so a change of zoom, of
 * engraving rules, or of engraver entirely cannot silently move the overlay.
 * The median of those measurements is used because a single odd pair - two
 * notes of a chord sharing a position, say - must not skew it.
 */
/**
 * Half a staff line gap, as engravers of this size draw it.
 *
 * Used only where a page gave nothing to measure, and only for notes on a
 * position the page never showed. It is a guess and is meant to be: the
 * alternative was drawing nothing.
 */
const DEFAULT_STEP_HEIGHT = 5;

export function fitStaffGeometry(samples: readonly DrawnNoteSample[]): StaffGeometry | null {
  if (samples.length === 0) {
    return null;
  }
  const byStaff = new Map<number, DrawnNoteSample[]>();
  for (const sample of samples) {
    const bucket = byStaff.get(sample.staffNumber) ?? [];
    bucket.push(sample);
    byStaff.set(sample.staffNumber, bucket);
  }

  // Neighbours in the same system only. Two notes from different systems are
  // hundreds of units apart vertically for reasons that have nothing to do
  // with pitch, and pairing them measures the gap between systems instead of
  // the gap between staff positions. The median used to absorb those pairs;
  // now that a sample says which system it was drawn in, they are simply not
  // made.
  const heights: number[] = [];
  for (const bucket of byStaff.values()) {
    const ordered = [...bucket].sort((left, right) => left.stepIndex - right.stepIndex);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous === undefined || current === undefined || previous.system !== current.system) {
        continue;
      }
      const steps = previous.diatonicIndex - current.diatonicIndex;
      if (steps !== 0) {
        heights.push(Math.abs((current.y - previous.y) / steps));
      }
    }
  }

  heights.sort((left, right) => left - right);
  const measured = heights[Math.floor(heights.length / 2)];
  // A page that never changes note gives nothing to measure - every pair of
  // neighbours is the same position, so no distance can be read off it. That
  // is not a page nothing can be drawn on: where each note *is* was still
  // seen, and a mark on a position already seen is exact whatever the scale
  // says. Only a note somewhere else needs the scale, and for those a
  // sensible one beats refusing to draw at all, which is what used to happen
  // - the calibration piece is sixteen middle Cs, and nothing the reader
  // played on it appeared anywhere.
  const stepHeight = measured !== undefined && measured > 0 ? measured : DEFAULT_STEP_HEIGHT;

  const sorted = new Map<number, readonly DrawnNoteSample[]>();
  for (const [staffNumber, bucket] of byStaff) {
    sorted.set(
      staffNumber,
      [...bucket].sort((left, right) => left.stepIndex - right.stepIndex),
    );
  }

  return {
    stepHeight,
    byStaff: sorted,
    systemOfStep: systemsByStep(samples),
    printedOn: printedByStep(samples),
  };
}

/** Where each note of the page is printed: step, then position, then place. */
function printedByStep(
  samples: readonly DrawnNoteSample[],
): ReadonlyMap<number, ReadonlyMap<number, PrintedNote>> {
  const printed = new Map<number, Map<number, PrintedNote>>();
  for (const sample of samples) {
    const atStep = printed.get(sample.stepIndex) ?? new Map<number, PrintedNote>();
    // The first staff that printed it. Two staves may notate one sounding
    // pitch at one instant - a unison written in both hands - and then either
    // is the right answer, because the reader played the note that is on both.
    if (!atStep.has(sample.diatonicIndex)) {
      atStep.set(sample.diatonicIndex, {
        staffNumber: sample.staffNumber,
        x: sample.x ?? null,
      });
    }
    printed.set(sample.stepIndex, atStep);
  }
  return printed;
}

/**
 * Where a note printed at this step stands across the page.
 *
 * The two hands do not share a point in time on the page: a chord in the left
 * hand is drawn a little to the left of the right hand's, by however much the
 * engraver needed for stems, accidentals and the ledger lines between them.
 * Measured on his own file, that is nearly three units in one bar and nearly
 * nine in another - small, and enough for a mark to sit visibly beside the
 * notehead it belongs to.
 *
 * `null` where the page prints no such note here, and then the step's own
 * place is the best answer there is.
 */
export function xForDiatonic(
  geometry: StaffGeometry,
  stepIndex: number,
  diatonicIndex: number,
): number | null {
  return geometry.printedOn.get(stepIndex)?.get(diatonicIndex)?.x ?? null;
}

/**
 * The system each step belongs to, filled in for the steps that drew nothing.
 *
 * A step of rests contributes no sample - a rest has no staff position to
 * measure - so it would otherwise have no system, and a mark on it would fall
 * back to whatever is nearest. It is on the system the music had reached when
 * it got there, which is the same answer a forward walk gives everywhere else.
 */
function systemsByStep(samples: readonly DrawnNoteSample[]): ReadonlyMap<number, number> {
  const ordered = [...samples].sort((left, right) => left.stepIndex - right.stepIndex);
  const systems = new Map<number, number>();
  let last: number | null = null;
  for (const sample of ordered) {
    if (last !== null) {
      for (let step = last + 1; step < sample.stepIndex; step += 1) {
        systems.set(step, systems.get(last) ?? sample.system);
      }
    }
    systems.set(sample.stepIndex, sample.system);
    last = sample.stepIndex;
  }
  return systems;
}

/**
 * The drawn note to measure from: the nearest one on that staff, in steps.
 *
 * Nearest in time is nearest on the page, because that is the order the music
 * is laid out in - so this lands on the same system as the mark being placed.
 */
export function anchorFor(
  geometry: StaffGeometry,
  staffNumber: number,
  stepIndex: number,
): DrawnNoteSample | null {
  const all = geometry.byStaff.get(staffNumber);
  if (all === undefined || all.length === 0) {
    return null;
  }
  // This staff's notes in the system the step was drawn in, when it is known
  // which that is. Nearest in time is nearest on the page only *along* a
  // system: across a break it is the line above or below, and a mark measured
  // from there is drawn a system's height out, over empty staff. Where this
  // staff drew nothing in the whole system there is nothing better to measure
  // from, so the nearest note anywhere is used, as it always was.
  const system = geometry.systemOfStep.get(stepIndex);
  const inSystem =
    system === undefined ? [] : all.filter((sample) => sample.system === system);
  const bucket = inSystem.length > 0 ? inSystem : all;
  // The bucket is in step order, so the nearest sample is one of the two
  // either side of where this step would fall. Walking the whole staff to
  // find it read every note in the piece, several times over for every note
  // the reader played - which on a long score was most of the cost of
  // drawing a mark, and did not get smaller as the run went on.
  let low = 0;
  let high = bucket.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((bucket[middle]?.stepIndex ?? 0) < stepIndex) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  const after = bucket[low] ?? null;
  const before = low > 0 ? (bucket[low - 1] ?? null) : null;
  if (before === null) {
    return after;
  }
  if (after === null) {
    return before;
  }
  // The earlier one on a tie, which is the sample a walk from the start
  // would have stopped on.
  return stepIndex - before.stepIndex <= after.stepIndex - stepIndex ? before : after;
}

/** Where a staff position sits vertically, near a given step. */
export function yForDiatonic(
  geometry: StaffGeometry,
  staffNumber: number,
  stepIndex: number,
  diatonicIndex: number,
): number | null {
  const anchor = anchorFor(geometry, staffNumber, stepIndex);
  if (anchor === null) {
    return null;
  }
  // Higher pitch, smaller y: the page grows downwards.
  return anchor.y - (diatonicIndex - anchor.diatonicIndex) * geometry.stepHeight;
}

/** How far a staff position is from the printed lines of a clef. */
function distanceToClef(clef: ClefKind, diatonicIndex: number): number {
  const [bottom, top] = CLEF_LINE_RANGE[clef];
  if (diatonicIndex < bottom) {
    return bottom - diatonicIndex;
  }
  return diatonicIndex > top ? diatonicIndex - top : 0;
}

/**
 * The staff a played note belongs on.
 *
 * **Where the page prints that note, when it prints it.** The reader played a
 * note the score asks for at this step, and the score has already put it on a
 * stave - so there is nothing to work out. Asked by clef instead, an ordinary
 * left hand reaching up to D4 was marked on the treble stave, D4 being one
 * position from the treble's lines and three from the bass's: a hundred and
 * twenty notes of City of Tears went to the wrong hand, the first note of the
 * piece among them, and sixty-eight of Bone Bottom.
 *
 * Only a note printed nowhere at this step - a wrong one - needs deciding,
 * and then the *clef* decides, which is the thing on the page that says which
 * pitches a staff is for. Judged instead against whatever note each staff
 * happened to draw nearby, the answer turned on an accident: where both hands
 * are written close together, one staff wins by a single position, and in a
 * bar where the left hand climbs the bass staff's nearest note can be higher
 * than the treble's.
 *
 * Distance to the printed lines rather than to their middle, so a note below
 * the bass stave is nearer to it than to the treble by the margin a reader
 * would say it is. Where two staves share a clef nothing distinguishes them,
 * and the nearest note decides as it always did.
 */
export function staffForDiatonic(
  geometry: StaffGeometry,
  stepIndex: number,
  diatonicIndex: number,
  clefOf: (staffNumber: number) => ClefKind,
): number | null {
  const printed = geometry.printedOn.get(stepIndex)?.get(diatonicIndex);
  if (printed !== undefined) {
    return printed.staffNumber;
  }
  let best: { staffNumber: number; clef: number; pitch: number } | null = null;
  for (const staffNumber of geometry.byStaff.keys()) {
    const anchor = anchorFor(geometry, staffNumber, stepIndex);
    if (anchor === null) {
      // Nothing drawn on it anywhere near, so there is nothing to measure a
      // mark from even if the clef says this is where the note belongs.
      continue;
    }
    const clef = distanceToClef(clefOf(staffNumber), diatonicIndex);
    const pitch = Math.abs(diatonicIndex - anchor.diatonicIndex);
    if (best === null || clef < best.clef || (clef === best.clef && pitch < best.pitch)) {
      best = { staffNumber, clef, pitch };
    }
  }
  return best?.staffNumber ?? null;
}

/**
 * Staff positions needing a ledger line for a note outside the stave.
 *
 * Lines only ever sit on line positions, which are every second staff step
 * out from the edge of the stave, and a note sitting in the space just beyond
 * the stave needs none at all.
 */
export function ledgerIndicesFor(
  bottomLineIndex: number,
  topLineIndex: number,
  diatonicIndex: number,
): number[] {
  const lines: number[] = [];
  // Below the stave.
  for (let index = bottomLineIndex - 2; index >= diatonicIndex; index -= 2) {
    lines.push(index);
  }
  // Above it.
  for (let index = topLineIndex + 2; index <= diatonicIndex; index += 2) {
    lines.push(index);
  }
  return lines;
}

/** Staff position of the lowest and highest printed line, per clef. */
export const CLEF_LINE_RANGE: Readonly<Record<'treble' | 'bass' | 'alto', readonly [number, number]>> =
  {
    // E4 up to F5.
    treble: [30, 38],
    // G2 up to A3.
    bass: [18, 26],
    // F3 up to G4.
    alto: [24, 32],
  };

/** Letter of a staff position, for choosing how to spell an accidental. */
export function letterIndexOf(diatonicIndex: number): number {
  return floorMod(diatonicIndex, 7);
}

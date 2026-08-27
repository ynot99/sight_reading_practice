import { floorMod } from '../../shared/asserts.js';

/**
 * A note the engraver has already drawn, used to work out where everything
 * else on that staff belongs.
 */
export interface DrawnNoteSample {
  /** Timeline step this note was drawn for. */
  readonly stepIndex: number;
  readonly staffNumber: number;
  /** Absolute staff position: `C4` is 28, `D4` is 29. */
  readonly diatonicIndex: number;
  /** Vertical centre of the notehead, in the drawing's own units. */
  readonly y: number;
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
export function fitStaffGeometry(samples: readonly DrawnNoteSample[]): StaffGeometry | null {
  const byStaff = new Map<number, DrawnNoteSample[]>();
  for (const sample of samples) {
    const bucket = byStaff.get(sample.staffNumber) ?? [];
    bucket.push(sample);
    byStaff.set(sample.staffNumber, bucket);
  }

  // Neighbours only. Two notes from different systems are hundreds of units
  // apart vertically for reasons that have nothing to do with pitch, and
  // pairing them would measure the gap between staves instead of the gap
  // between staff positions.
  const heights: number[] = [];
  for (const bucket of byStaff.values()) {
    const ordered = [...bucket].sort((left, right) => left.stepIndex - right.stepIndex);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous === undefined || current === undefined) {
        continue;
      }
      const steps = previous.diatonicIndex - current.diatonicIndex;
      if (steps !== 0) {
        heights.push(Math.abs((current.y - previous.y) / steps));
      }
    }
  }

  if (heights.length === 0) {
    return null;
  }
  heights.sort((left, right) => left - right);
  const stepHeight = heights[Math.floor(heights.length / 2)];
  if (stepHeight === undefined || stepHeight <= 0) {
    return null;
  }

  const sorted = new Map<number, readonly DrawnNoteSample[]>();
  for (const [staffNumber, bucket] of byStaff) {
    sorted.set(
      staffNumber,
      [...bucket].sort((left, right) => left.stepIndex - right.stepIndex),
    );
  }

  return { stepHeight, byStaff: sorted };
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
  const bucket = geometry.byStaff.get(staffNumber);
  if (bucket === undefined || bucket.length === 0) {
    return null;
  }
  let best = bucket[0] ?? null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const sample of bucket) {
    const distance = Math.abs(sample.stepIndex - stepIndex);
    if (distance < bestDistance) {
      best = sample;
      bestDistance = distance;
    }
  }
  return best;
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

/**
 * The staff a played note belongs on.
 *
 * Judged against what each staff is carrying *at that point in the music*,
 * not against a page-wide average: a left hand that climbs above middle C in
 * one bar must not drag every later mark onto the wrong stave.
 */
export function staffForDiatonic(
  geometry: StaffGeometry,
  stepIndex: number,
  diatonicIndex: number,
): number | null {
  let best: { staffNumber: number; distance: number } | null = null;
  for (const staffNumber of geometry.byStaff.keys()) {
    const anchor = anchorFor(geometry, staffNumber, stepIndex);
    if (anchor === null) {
      continue;
    }
    const distance = Math.abs(diatonicIndex - anchor.diatonicIndex);
    if (best === null || distance < best.distance) {
      best = { staffNumber, distance };
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

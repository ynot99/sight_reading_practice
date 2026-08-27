import { floorMod } from '../../shared/asserts.js';

/**
 * A note the engraver has already drawn, used to work out where everything
 * else on that staff belongs.
 */
export interface DrawnNoteSample {
  readonly staffNumber: number;
  /** Absolute staff position: `C4` is 28, `D4` is 29. */
  readonly diatonicIndex: number;
  /** Vertical centre of the notehead, in the drawing's own units. */
  readonly y: number;
}

export interface StaffAnchor {
  readonly diatonicIndex: number;
  readonly y: number;
  /** Average position of the notes drawn here; used to pick a staff. */
  readonly centreIndex: number;
}

export interface StaffGeometry {
  /** Vertical distance between neighbouring staff positions. */
  readonly stepHeight: number;
  readonly anchors: ReadonlyMap<number, StaffAnchor>;
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

  const heights: number[] = [];
  for (const bucket of byStaff.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i];
        const b = bucket[j];
        if (a === undefined || b === undefined) {
          continue;
        }
        const steps = a.diatonicIndex - b.diatonicIndex;
        if (steps !== 0) {
          heights.push(Math.abs((b.y - a.y) / steps));
        }
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

  const anchors = new Map<number, StaffAnchor>();
  for (const [staffNumber, bucket] of byStaff) {
    const first = bucket[0];
    if (first === undefined) {
      continue;
    }
    const centreIndex =
      bucket.reduce((total, sample) => total + sample.diatonicIndex, 0) / bucket.length;
    anchors.set(staffNumber, { diatonicIndex: first.diatonicIndex, y: first.y, centreIndex });
  }

  return { stepHeight, anchors };
}

/** Where a staff position sits vertically, or `null` for an unknown staff. */
export function yForDiatonic(
  geometry: StaffGeometry,
  staffNumber: number,
  diatonicIndex: number,
): number | null {
  const anchor = geometry.anchors.get(staffNumber);
  if (anchor === undefined) {
    return null;
  }
  // Higher pitch, smaller y: the page grows downwards.
  return anchor.y - (diatonicIndex - anchor.diatonicIndex) * geometry.stepHeight;
}

/** The staff a played note belongs on: whichever one it is nearest. */
export function staffForDiatonic(geometry: StaffGeometry, diatonicIndex: number): number | null {
  let best: { staffNumber: number; distance: number } | null = null;
  for (const [staffNumber, anchor] of geometry.anchors) {
    const distance = Math.abs(diatonicIndex - anchor.centreIndex);
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

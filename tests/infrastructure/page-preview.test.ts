import { describe, expect, it } from 'vitest';
import { boundingBoxOf, previewPlacement } from '../../src/infrastructure/rendering/pagePreview.js';

/**
 * Where the top of the next page is stood when it is shown early, whichever
 * engraver drew it: over the first system of this page, as high as its ink
 * allows and no higher, and smaller rather than sliced where it will not fit.
 */

/** A drawing whose ink is measured as given, or cannot be measured at all. */
function inked(box: { readonly y: number; readonly height: number } | 'none' | 'throws'): SVGGraphicsElement {
  if (box === 'none') {
    return {} as SVGGraphicsElement;
  }
  return {
    getBBox: () => {
      if (box === 'throws') {
        throw new Error('not rendered');
      }
      return { x: 0, width: 10, ...box } as DOMRect;
    },
  } as unknown as SVGGraphicsElement;
}

/** Where the ink is put, and what it is scaled by. */
function placed(transform: string): { at: number; scale: number; from: number } {
  const said = /translate\(0, (-?[\d.]+)\) scale\(([\d.]+)\) translate\(0, (-?[\d.]+)\)/.exec(transform);
  return { at: Number(said?.[1] ?? NaN), scale: Number(said?.[2] ?? NaN), from: -Number(said?.[3] ?? NaN) };
}

const SLOT = { top: 60 };
const TARGET = { top: 90, bottom: 190 };
const BOTTOM = 260;

describe('the top of the next page, placed', () => {
  it('stands its first system where the finished one stood', () => {
    // Nothing to measure its ink by: the staff's own top stands in for it.
    const where = placed(previewPlacement(inked('none'), SLOT, TARGET, BOTTOM));

    expect(where.from).toBe(TARGET.top);
    expect(where.at).toBe(SLOT.top);
    expect(where.scale).toBe(1);
  });

  it('keeps the ink above its staff on the page rather than cutting it off', () => {
    // Reported from the tablet: high notes on ledger lines, and the stems
    // under them, sliced off along the top edge. The taller that ink, the
    // further down its own page the system sits, and the further up it was
    // pulled - so the music hardest to read was the music shown least of.
    const inkTop = TARGET.top - (SLOT.top + 12);
    const where = placed(
      previewPlacement(inked({ y: inkTop, height: TARGET.bottom - inkTop + 20 }), SLOT, TARGET, BOTTOM),
    );

    expect(where.from).toBe(inkTop);
    expect(where.at).toBeGreaterThanOrEqual(8);
    expect(where.scale).toBe(1);
  });

  it('draws a system too tall for the room smaller instead of slicing it', () => {
    // A system with its bottom cut off says as little as one with its top
    // cut off, and the reader is looking at it precisely because it is hard.
    const inkTop = TARGET.top - 4000;
    const where = placed(previewPlacement(inked({ y: inkTop, height: 5000 }), SLOT, TARGET, BOTTOM));

    expect(where.at).toBeGreaterThanOrEqual(8);
    expect(where.scale).toBeLessThan(1);
    expect(where.scale).toBeGreaterThan(0);
    // Exactly as small as the room asks: the system's foot on the line.
    expect(where.at + (TARGET.bottom - inkTop) * where.scale).toBeCloseTo(BOTTOM, 5);
  });
});

describe('the ink of a drawing, measured', () => {
  it('is what the browser measures', () => {
    expect(boundingBoxOf(inked({ y: 12, height: 40 }))).toEqual({ y: 12, height: 40 });
  });

  it('is nothing where nothing can measure it, or there is nothing to measure', () => {
    expect(boundingBoxOf(inked('none'))).toBeNull();
    expect(boundingBoxOf(inked('throws'))).toBeNull();
    expect(boundingBoxOf(inked({ y: 12, height: 0 }))).toBeNull();
  });
});

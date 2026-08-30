import { describe, expect, it } from 'vitest';
import {
  CLEF_LINE_RANGE,
  diatonicIndexOf,
  fitStaffGeometry,
  ledgerIndicesFor,
  staffForDiatonic,
  yForDiatonic,
  type DrawnNoteSample,
} from '../../src/infrastructure/rendering/staffGeometry.js';
import { Pitch } from '../../src/domain/model/Pitch.js';

/**
 * The numbers below are the ones a real engraving produced: staff lines ten
 * apart, so five per staff position, with middle C at 155.5 on a treble stave
 * whose bottom line sits at 145.5.
 */
const TREBLE: DrawnNoteSample[] = [
  { stepIndex: 0, staffNumber: 1, diatonicIndex: Pitch.parse('C4').diatonicIndex, y: 155.5 },
  { stepIndex: 1, staffNumber: 1, diatonicIndex: Pitch.parse('D4').diatonicIndex, y: 150.5 },
  { stepIndex: 2, staffNumber: 1, diatonicIndex: Pitch.parse('E4').diatonicIndex, y: 145.5 },
];

describe('diatonicIndexOf', () => {
  it('reads the engraver’s pitch, whose octaves run three low', () => {
    // Middle C is octave 1 to the engraver, 4 everywhere else here.
    expect(diatonicIndexOf(0, 1)).toBe(Pitch.parse('C4').diatonicIndex);
    expect(diatonicIndexOf(9, 0)).toBe(Pitch.parse('A3').diatonicIndex);
    expect(diatonicIndexOf(11, 1)).toBe(Pitch.parse('B4').diatonicIndex);
  });

  it('refuses a semitone that is not a letter', () => {
    // A sharp is a letter plus an accidental, never a position of its own.
    expect(diatonicIndexOf(1, 1)).toBeNull();
    expect(diatonicIndexOf(6, 1)).toBeNull();
  });
});

describe('fitStaffGeometry', () => {
  it('measures the step height from the notes already drawn', () => {
    const geometry = fitStaffGeometry(TREBLE);
    expect(geometry?.stepHeight).toBeCloseTo(5, 10);
  });

  it('is not fooled by two notes sharing a position', () => {
    const geometry = fitStaffGeometry([
      ...TREBLE,
      { stepIndex: 0, staffNumber: 1, diatonicIndex: Pitch.parse('C4').diatonicIndex, y: 155.5 },
    ]);
    expect(geometry?.stepHeight).toBeCloseTo(5, 10);
  });

  it('works at any scale, because nothing is hard-coded', () => {
    const zoomed = TREBLE.map((sample) => ({ ...sample, y: sample.y * 1.5 }));
    expect(fitStaffGeometry(zoomed)?.stepHeight).toBeCloseTo(7.5, 10);
  });

  it('gives up only when it was shown nothing at all', () => {
    expect(fitStaffGeometry([])).toBeNull();
  });

  it('still places what it did see, on a page that never changes note', () => {
    // Sixteen middle Cs give no pair of different positions, so no distance
    // can be read off them - but where that note *is* was still seen. Refusing
    // the whole page meant nothing the reader played on the calibration piece
    // appeared anywhere at all.
    const geometry = fitStaffGeometry([
      { stepIndex: 0, staffNumber: 1, diatonicIndex: 28, y: 155.5 },
      { stepIndex: 1, staffNumber: 1, diatonicIndex: 28, y: 155.5 },
    ]);

    expect(geometry).not.toBeNull();
    // Exact on the position it was shown, whatever scale it guessed for the
    // rest: that is the only position this page has.
    expect(yForDiatonic(geometry as NonNullable<typeof geometry>, 1, 0, 28)).toBe(155.5);
  });
});

describe('yForDiatonic', () => {
  const geometry = fitStaffGeometry(TREBLE);

  it('reproduces the positions it was given', () => {
    for (const sample of TREBLE) {
      expect(yForDiatonic(geometry!, 1, 0, sample.diatonicIndex)).toBeCloseTo(sample.y, 10);
    }
  });

  it('places notes the engraver never drew', () => {
    // G4 is four positions above C4, so four steps higher up the page.
    expect(yForDiatonic(geometry!, 1, 0, Pitch.parse('G4').diatonicIndex)).toBeCloseTo(135.5, 10);
    // A3 is two below.
    expect(yForDiatonic(geometry!, 1, 0, Pitch.parse('A3').diatonicIndex)).toBeCloseTo(165.5, 10);
  });

  it('knows nothing about a staff it never saw', () => {
    expect(yForDiatonic(geometry!, 2, 0, 28)).toBeNull();
  });
});

describe('staffForDiatonic', () => {
  const geometry = fitStaffGeometry([
    ...TREBLE,
    { stepIndex: 0, staffNumber: 2, diatonicIndex: Pitch.parse('C3').diatonicIndex, y: 210.5 },
    { stepIndex: 1, staffNumber: 2, diatonicIndex: Pitch.parse('G2').diatonicIndex, y: 225.5 },
  ]);

  it('puts a note on the staff it is nearest', () => {
    expect(staffForDiatonic(geometry!, 0, Pitch.parse('G4').diatonicIndex)).toBe(1);
    expect(staffForDiatonic(geometry!, 0, Pitch.parse('E2').diatonicIndex)).toBe(2);
  });

  it('keeps a wildly wrong note on the nearer staff rather than dropping it', () => {
    expect(staffForDiatonic(geometry!, 0, Pitch.parse('C7').diatonicIndex)).toBe(1);
    expect(staffForDiatonic(geometry!, 0, Pitch.parse('A0').diatonicIndex)).toBe(2);
  });
});

describe('systems stacked down the page', () => {
  /** Two systems: the same staff, four hundred units apart. */
  const geometry = fitStaffGeometry([
    { stepIndex: 0, staffNumber: 1, diatonicIndex: Pitch.parse('C4').diatonicIndex, y: 155.5 },
    { stepIndex: 1, staffNumber: 1, diatonicIndex: Pitch.parse('E4').diatonicIndex, y: 145.5 },
    { stepIndex: 8, staffNumber: 1, diatonicIndex: Pitch.parse('C4').diatonicIndex, y: 555.5 },
    { stepIndex: 9, staffNumber: 1, diatonicIndex: Pitch.parse('E4').diatonicIndex, y: 545.5 },
  ]);

  it('places a mark on the system its step belongs to', () => {
    // A page-wide anchor would drag every later mark up to the first system.
    expect(yForDiatonic(geometry!, 1, 9, Pitch.parse('G4').diatonicIndex)).toBeCloseTo(535.5, 10);
    expect(yForDiatonic(geometry!, 1, 0, Pitch.parse('G4').diatonicIndex)).toBeCloseTo(135.5, 10);
  });

  it('measures one step height for the whole page', () => {
    expect(geometry?.stepHeight).toBeCloseTo(5, 10);
  });
});

describe('ledgerIndicesFor', () => {
  const [bottom, top] = CLEF_LINE_RANGE.treble;

  it('asks for none inside the stave', () => {
    expect(ledgerIndicesFor(bottom, top, Pitch.parse('E4').diatonicIndex)).toEqual([]);
    expect(ledgerIndicesFor(bottom, top, Pitch.parse('B4').diatonicIndex)).toEqual([]);
    expect(ledgerIndicesFor(bottom, top, Pitch.parse('F5').diatonicIndex)).toEqual([]);
  });

  it('asks for none for a note in the space just outside', () => {
    // D4 hangs below the stave without touching a line.
    expect(ledgerIndicesFor(bottom, top, Pitch.parse('D4').diatonicIndex)).toEqual([]);
    expect(ledgerIndicesFor(bottom, top, Pitch.parse('G5').diatonicIndex)).toEqual([]);
  });

  it('draws one through middle C', () => {
    expect(ledgerIndicesFor(bottom, top, Pitch.parse('C4').diatonicIndex)).toEqual([
      Pitch.parse('C4').diatonicIndex,
    ]);
  });

  it('stacks them for notes further out', () => {
    expect(ledgerIndicesFor(bottom, top, Pitch.parse('A3').diatonicIndex)).toEqual([
      Pitch.parse('C4').diatonicIndex,
      Pitch.parse('A3').diatonicIndex,
    ]);
    expect(ledgerIndicesFor(bottom, top, Pitch.parse('C6').diatonicIndex)).toEqual([
      Pitch.parse('A5').diatonicIndex,
      Pitch.parse('C6').diatonicIndex,
    ]);
  });
});

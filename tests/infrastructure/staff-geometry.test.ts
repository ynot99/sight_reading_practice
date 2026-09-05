import { describe, expect, it } from 'vitest';
import {
  anchorFor,
  CLEF_LINE_RANGE,
  diatonicIndexOf,
  fitStaffGeometry,
  ledgerIndicesFor,
  staffForDiatonic,
  yForDiatonic,
  type DrawnNoteSample,
} from '../../src/infrastructure/rendering/staffGeometry.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import type { ClefKind } from '../../src/domain/model/Clef.js';

/**
 * The numbers below are the ones a real engraving produced: staff lines ten
 * apart, so five per staff position, with middle C at 155.5 on a treble stave
 * whose bottom line sits at 145.5.
 */
const TREBLE: DrawnNoteSample[] = [
  { stepIndex: 0, page: 0, system: 0, staffNumber: 1, diatonicIndex: Pitch.parse('C4').diatonicIndex, y: 155.5 },
  { stepIndex: 1, page: 0, system: 0, staffNumber: 1, diatonicIndex: Pitch.parse('D4').diatonicIndex, y: 150.5 },
  { stepIndex: 2, page: 0, system: 0, staffNumber: 1, diatonicIndex: Pitch.parse('E4').diatonicIndex, y: 145.5 },
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
      { stepIndex: 0, page: 0, system: 0, staffNumber: 1, diatonicIndex: Pitch.parse('C4').diatonicIndex, y: 155.5 },
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
      { stepIndex: 0, page: 0, system: 0, staffNumber: 1, diatonicIndex: 28, y: 155.5 },
      { stepIndex: 1, page: 0, system: 0, staffNumber: 1, diatonicIndex: 28, y: 155.5 },
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
    { stepIndex: 0, page: 0, system: 0, staffNumber: 2, diatonicIndex: Pitch.parse('C3').diatonicIndex, y: 210.5 },
    { stepIndex: 1, page: 0, system: 0, staffNumber: 2, diatonicIndex: Pitch.parse('G2').diatonicIndex, y: 225.5 },
  ]);

  /** A grand staff: treble above, bass below. */
  const grandStaff = (staffNumber: number): ClefKind =>
    staffNumber === 1 ? 'treble' : 'bass';

  it('puts a note on the staff whose clef is for it', () => {
    expect(staffForDiatonic(geometry!, 0, Pitch.parse('G4').diatonicIndex, grandStaff)).toBe(1);
    expect(staffForDiatonic(geometry!, 0, Pitch.parse('E2').diatonicIndex, grandStaff)).toBe(2);
  });

  it('puts a note where the page prints it, whatever the clefs would say', () => {
    // Ordinary piano writing: the left hand reaches up to D4, printed on the
    // bass stave with a ledger line. D4 is one position from the treble's
    // lines and three from the bass's, so by the clefs alone the mark went to
    // the other hand - a hundred and twenty notes of City of Tears, the first
    // note of the piece among them, and sixty-eight of Bone Bottom.
    const written = fitStaffGeometry([
      ...TREBLE,
      {
        stepIndex: 0,
        page: 0,
        system: 0,
        staffNumber: 2,
        diatonicIndex: Pitch.parse('D4').diatonicIndex,
        y: 200.5,
      },
      {
        stepIndex: 1,
        page: 0,
        system: 0,
        staffNumber: 2,
        diatonicIndex: Pitch.parse('G2').diatonicIndex,
        y: 225.5,
      },
    ]);

    expect(staffForDiatonic(written!, 0, Pitch.parse('D4').diatonicIndex, grandStaff)).toBe(2);
    // And the mark then stands exactly where that note is printed.
    expect(yForDiatonic(written!, 2, 0, Pitch.parse('D4').diatonicIndex)).toBe(200.5);
    // A pitch the page does not print here is still the clefs' to place.
    expect(staffForDiatonic(written!, 0, Pitch.parse('G4').diatonicIndex, grandStaff)).toBe(1);
  });

  it('keeps a wildly wrong note on the nearer staff rather than dropping it', () => {
    expect(staffForDiatonic(geometry!, 0, Pitch.parse('C7').diatonicIndex, grandStaff)).toBe(1);
    expect(staffForDiatonic(geometry!, 0, Pitch.parse('A0').diatonicIndex, grandStaff)).toBe(2);
  });

  it('is not swayed by which hand happens to be drawn nearer', () => {
    // The left hand climbing into the treble range, which is ordinary piano
    // writing: the bass staff's nearest note is then *higher* than the
    // treble's, and a low note lost to the staff it least belongs on.
    const crossed = fitStaffGeometry([
      { stepIndex: 0, page: 0, system: 0, staffNumber: 1, diatonicIndex: Pitch.parse('G4').diatonicIndex, y: 140 },
      { stepIndex: 1, page: 0, system: 0, staffNumber: 1, diatonicIndex: Pitch.parse('A4').diatonicIndex, y: 135 },
      { stepIndex: 0, page: 0, system: 0, staffNumber: 2, diatonicIndex: Pitch.parse('B4').diatonicIndex, y: 230 },
      { stepIndex: 1, page: 0, system: 0, staffNumber: 2, diatonicIndex: Pitch.parse('C5').diatonicIndex, y: 225 },
    ]);

    expect(staffForDiatonic(crossed!, 0, Pitch.parse('E2').diatonicIndex, grandStaff)).toBe(2);
  });

  it('lets the nearest note decide where two staves share a clef', () => {
    // Nothing about the clef tells them apart, so the old question is the
    // only one left to ask.
    const bothTreble = fitStaffGeometry([
      { stepIndex: 0, page: 0, system: 0, staffNumber: 1, diatonicIndex: Pitch.parse('C5').diatonicIndex, y: 140 },
      { stepIndex: 0, page: 0, system: 0, staffNumber: 2, diatonicIndex: Pitch.parse('C4').diatonicIndex, y: 230 },
    ]);

    expect(staffForDiatonic(bothTreble!, 0, Pitch.parse('D4').diatonicIndex, () => 'treble')).toBe(2);
    expect(staffForDiatonic(bothTreble!, 0, Pitch.parse('B4').diatonicIndex, () => 'treble')).toBe(1);
  });
});

describe('systems stacked down the page', () => {
  /** Two systems: the same staff, four hundred units apart. */
  const geometry = fitStaffGeometry([
    { stepIndex: 0, page: 0, system: 0, staffNumber: 1, diatonicIndex: Pitch.parse('C4').diatonicIndex, y: 155.5 },
    { stepIndex: 1, page: 0, system: 0, staffNumber: 1, diatonicIndex: Pitch.parse('E4').diatonicIndex, y: 145.5 },
    { stepIndex: 8, page: 0, system: 1, staffNumber: 1, diatonicIndex: Pitch.parse('C4').diatonicIndex, y: 555.5 },
    { stepIndex: 9, page: 0, system: 1, staffNumber: 1, diatonicIndex: Pitch.parse('E4').diatonicIndex, y: 545.5 },
  ]);

  it('places a mark on the system its step belongs to', () => {
    // A page-wide anchor would drag every later mark up to the first system.
    expect(yForDiatonic(geometry!, 1, 9, Pitch.parse('G4').diatonicIndex)).toBeCloseTo(535.5, 10);
    expect(yForDiatonic(geometry!, 1, 0, Pitch.parse('G4').diatonicIndex)).toBeCloseTo(135.5, 10);
  });

  it('measures one step height for the whole page', () => {
    expect(geometry?.stepHeight).toBeCloseTo(5, 10);
  });

  it('does not measure the gap between systems as a step', () => {
    // The pair that spans the break is four hundred units apart for reasons
    // that have nothing to do with pitch. The median used to absorb it; a
    // sample that says which system it is in means the pair is never made.
    expect(geometry?.stepHeight).toBeLessThan(20);
  });
});

describe('a staff that enters late in a system', () => {
  /**
   * A grand staff of two systems, where the treble rests through the start of
   * the second and the bass plays on.
   *
   *   treble: steps 0-3 (system 0), then nothing until step 10 (system 1)
   *   bass:   steps 0-3 (system 0), steps 4-11 (system 1)
   */
  const treble = Pitch.parse('C4').diatonicIndex;
  const bass = Pitch.parse('C3').diatonicIndex;
  const geometry = fitStaffGeometry([
    { stepIndex: 0, page: 0, system: 0, staffNumber: 1, diatonicIndex: treble, y: 150 },
    { stepIndex: 1, page: 0, system: 0, staffNumber: 1, diatonicIndex: treble + 1, y: 145 },
    { stepIndex: 2, page: 0, system: 0, staffNumber: 1, diatonicIndex: treble, y: 150 },
    { stepIndex: 3, page: 0, system: 0, staffNumber: 1, diatonicIndex: treble + 1, y: 145 },
    { stepIndex: 0, page: 0, system: 0, staffNumber: 2, diatonicIndex: bass, y: 250 },
    { stepIndex: 3, page: 0, system: 0, staffNumber: 2, diatonicIndex: bass + 1, y: 245 },
    { stepIndex: 4, page: 0, system: 1, staffNumber: 2, diatonicIndex: bass, y: 650 },
    { stepIndex: 9, page: 0, system: 1, staffNumber: 2, diatonicIndex: bass + 1, y: 645 },
    { stepIndex: 10, page: 0, system: 1, staffNumber: 1, diatonicIndex: treble, y: 550 },
    { stepIndex: 11, page: 0, system: 1, staffNumber: 1, diatonicIndex: treble + 1, y: 545 },
  ]);

  it('knows which system a step is in from the staves together', () => {
    // Step 4 drew nothing on the treble, but the bass drew there, so the
    // page knows perfectly well which line the step is on.
    expect(geometry?.systemOfStep.get(3)).toBe(0);
    expect(geometry?.systemOfStep.get(4)).toBe(1);
    expect(geometry?.systemOfStep.get(9)).toBe(1);
  });

  it('measures a mark from its own line, not the one above', () => {
    // Nearest in step order is step 3, on the system before - and a mark
    // measured from there is drawn four hundred units up, over empty staff
    // in the other clef. Which is where the reader kept finding it.
    const anchor = anchorFor(geometry!, 1, 4);
    expect(anchor?.system).toBe(1);
    expect(anchor?.stepIndex).toBe(10);
    expect(yForDiatonic(geometry!, 1, 4, treble)).toBeCloseTo(550, 10);
  });

  it('falls back to the nearest note where a staff drew nothing all system', () => {
    // Nothing better to measure from, so this is no worse than it was.
    const empty = fitStaffGeometry([
      { stepIndex: 0, page: 0, system: 0, staffNumber: 1, diatonicIndex: treble, y: 150 },
      { stepIndex: 1, page: 0, system: 0, staffNumber: 1, diatonicIndex: treble + 1, y: 145 },
      { stepIndex: 4, page: 0, system: 1, staffNumber: 2, diatonicIndex: bass, y: 650 },
    ]);
    expect(anchorFor(empty!, 1, 4)?.stepIndex).toBe(1);
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

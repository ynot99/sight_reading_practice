import { describe, expect, it } from 'vitest';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import {
  buildOverlayShapes,
  spellPlayed,
  type NoteheadShape,
  type OverlayLayout,
  type OverlayShape,
} from '../../src/infrastructure/rendering/playedNoteShapes.js';
import { fitStaffGeometry } from '../../src/infrastructure/rendering/staffGeometry.js';

/** Built from the numbers a real engraving produced: 5 units per position. */
const geometry = fitStaffGeometry([
  { stepIndex: 0, staffNumber: 1, diatonicIndex: Pitch.parse('C4').diatonicIndex, y: 155.5 },
  { stepIndex: 0, staffNumber: 1, diatonicIndex: Pitch.parse('E4').diatonicIndex, y: 145.5 },
  { stepIndex: 0, staffNumber: 2, diatonicIndex: Pitch.parse('C3').diatonicIndex, y: 210.5 },
  { stepIndex: 0, staffNumber: 2, diatonicIndex: Pitch.parse('G2').diatonicIndex, y: 225.5 },
]);

function layout(key = KeySignature.major(0)): OverlayLayout {
  if (geometry === null) {
    throw new Error('expected geometry');
  }
  return {
    geometry,
    stepX: new Map([
      [0, 120],
      [1, 200],
    ]),
    clefByStaff: new Map([
      [1, 'treble'],
      [2, 'bass'],
    ]),
    key,
  };
}

function noteheads(shapes: readonly OverlayShape[]): NoteheadShape[] {
  return shapes.filter((shape): shape is NoteheadShape => shape.kind === 'notehead');
}

describe('buildOverlayShapes', () => {
  it('draws a played note exactly where that pitch is engraved', () => {
    const shapes = buildOverlayShapes([{ stepIndex: 0, midi: 60, correct: true }], layout());

    const [head] = noteheads(shapes);
    expect(head?.x).toBe(120);
    // Middle C sits where the engraver put its own middle C.
    expect(head?.y).toBeCloseTo(155.5, 10);
    expect(head?.correct).toBe(true);
  });

  it('places a note the engraver never drew, by counting positions', () => {
    const shapes = buildOverlayShapes([{ stepIndex: 1, midi: 67, correct: false }], layout());

    // G4 is four staff positions above C4: four steps of five units.
    expect(noteheads(shapes)[0]?.y).toBeCloseTo(135.5, 10);
    expect(noteheads(shapes)[0]?.correct).toBe(false);
  });

  it('puts a low note on the bass staff, not far below the treble', () => {
    const shapes = buildOverlayShapes([{ stepIndex: 0, midi: 43, correct: false }], layout());

    // G2 is the bottom line of the bass stave.
    expect(noteheads(shapes)[0]?.y).toBeCloseTo(225.5, 10);
    expect(shapes.filter((shape) => shape.kind === 'ledger')).toHaveLength(0);
  });

  it('adds a ledger line through middle C', () => {
    const shapes = buildOverlayShapes([{ stepIndex: 0, midi: 60, correct: true }], layout());

    const ledgers = shapes.filter((shape) => shape.kind === 'ledger');
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0]?.kind === 'ledger' ? ledgers[0].y : null).toBeCloseTo(155.5, 10);
  });

  it('stacks ledger lines for a note further out', () => {
    // A3 needs lines at C4 and at itself.
    const shapes = buildOverlayShapes([{ stepIndex: 0, midi: 57, correct: false }], layout());
    expect(shapes.filter((shape) => shape.kind === 'ledger')).toHaveLength(2);
  });

  it('spells a black key and draws the accidental, so the mark cannot lie', () => {
    const shapes = buildOverlayShapes([{ stepIndex: 0, midi: 61, correct: false }], layout());

    const accidentals = shapes.filter((shape) => shape.kind === 'accidental');
    expect(accidentals).toHaveLength(1);
    expect(accidentals[0]?.kind === 'accidental' ? accidentals[0].text : '').toBe('♯');
    // Drawn at C, not at some position between C and D.
    expect(noteheads(shapes)[0]?.y).toBeCloseTo(155.5, 10);
  });

  it('follows the key when choosing how to spell a black key', () => {
    const flatKey = buildOverlayShapes(
      [{ stepIndex: 0, midi: 61, correct: false }],
      layout(KeySignature.major(-3)),
    );
    const accidental = flatKey.find((shape) => shape.kind === 'accidental');
    expect(accidental?.kind === 'accidental' ? accidental.text : '').toBe('♭');
    expect(spellPlayed(61, KeySignature.major(-3)).toString()).toBe('Db4');
    expect(spellPlayed(61, KeySignature.major(2)).toString()).toBe('C#4');
  });

  it('draws no accidental for a note the key signature already alters', () => {
    // F# is in the key of G, so its notehead needs no sign of its own.
    const shapes = buildOverlayShapes(
      [{ stepIndex: 0, midi: 66, correct: true }],
      layout(KeySignature.major(1)),
    );
    expect(shapes.filter((shape) => shape.kind === 'accidental')).toHaveLength(0);
  });

  it('draws a natural where the key expects an alteration', () => {
    const shapes = buildOverlayShapes(
      [{ stepIndex: 0, midi: 65, correct: false }],
      layout(KeySignature.major(1)),
    );
    const accidental = shapes.find((shape) => shape.kind === 'accidental');
    expect(accidental?.kind === 'accidental' ? accidental.text : '').toBe('♮');
  });

  it('scales with the drawing, so zoom moves nothing out of place', () => {
    const zoomed = fitStaffGeometry([
      { stepIndex: 0, staffNumber: 1, diatonicIndex: Pitch.parse('C4').diatonicIndex, y: 311 },
      { stepIndex: 0, staffNumber: 1, diatonicIndex: Pitch.parse('E4').diatonicIndex, y: 291 },
    ]);
    if (zoomed === null) {
      throw new Error('expected geometry');
    }

    const shapes = buildOverlayShapes([{ stepIndex: 0, midi: 67, correct: true }], {
      geometry: zoomed,
      stepX: new Map([[0, 240]]),
      clefByStaff: new Map([[1, 'treble']]),
      key: KeySignature.major(0),
    });

    const [head] = noteheads(shapes);
    expect(head?.y).toBeCloseTo(271, 10);
    expect(head?.radiusX).toBeCloseTo(12.5, 10);
  });

  it('skips a press on a step that was never drawn', () => {
    const shapes = buildOverlayShapes([{ stepIndex: 99, midi: 60, correct: false }], layout());
    expect(shapes).toEqual([]);
  });

  it('keeps every press, including several on one step', () => {
    const shapes = buildOverlayShapes(
      [
        { stepIndex: 0, midi: 60, correct: true },
        { stepIndex: 0, midi: 64, correct: true },
        { stepIndex: 0, midi: 62, correct: false },
      ],
      layout(),
    );
    expect(noteheads(shapes)).toHaveLength(3);
    expect(noteheads(shapes).map((head) => head.correct)).toEqual([true, true, false]);
  });
});

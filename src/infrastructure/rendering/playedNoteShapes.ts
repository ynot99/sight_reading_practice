import type { ClefKind } from '../../domain/model/Clef.js';
import type { KeySignature } from '../../domain/model/KeySignature.js';
import { Pitch } from '../../domain/model/Pitch.js';
import {
  CLEF_LINE_RANGE,
  ledgerIndicesFor,
  staffForDiatonic,
  yForDiatonic,
  type StaffGeometry,
} from './staffGeometry.js';

/** One key press, and whether it belonged where it landed. */
export interface PlayedMark {
  readonly stepIndex: number;
  readonly midi: number;
  readonly correct: boolean;
  /** Signed fraction of the gap to the neighbouring note; `0` is dead on. */
  readonly offset: number;
}

export interface OverlayLayout {
  readonly geometry: StaffGeometry;
  /** Horizontal centre of each timeline step, in drawing units. */
  readonly stepX: ReadonlyMap<number, number>;
  readonly clefAt: (staffNumber: number, stepIndex: number) => ClefKind;
  readonly key: KeySignature;
}

export interface NoteheadShape {
  readonly kind: 'notehead';
  readonly x: number;
  readonly y: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly correct: boolean;
  /**
   * True when the press had to lean towards a neighbour to be drawn.
   *
   * A right note played well out of time is not the same achievement as one
   * played on the beat, and the page should not congratulate both the same
   * way. Derived from the offset rather than carried beside it, so a mark is
   * pale exactly when it is displaced: the two can never disagree.
   */
  readonly looseTiming: boolean;
}

export interface LedgerShape {
  readonly kind: 'ledger';
  readonly y: number;
  readonly x1: number;
  readonly x2: number;
  readonly correct: boolean;
  readonly looseTiming: boolean;
}

export interface AccidentalShape {
  readonly kind: 'accidental';
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly size: number;
  readonly correct: boolean;
  readonly looseTiming: boolean;
}

export type OverlayShape = NoteheadShape | LedgerShape | AccidentalShape;

const ACCIDENTAL_GLYPHS: Readonly<Record<number, string>> = {
  [-2]: '𝄫',
  [-1]: '♭',
  [0]: '♮',
  [1]: '♯',
  [2]: '𝄪',
};

/** Spelling for a played key, biased by the key signature. */
export function spellPlayed(midi: number, key: KeySignature): Pitch {
  return Pitch.fromMidi(midi, key.fifths < 0);
}

/**
 * Turns key presses into marks to draw over the engraving.
 *
 * The notation underneath is left exactly as it is: these are rings around
 * what was played, not a recolouring of what was printed. A press that landed
 * on the right note therefore shows a green ring around a black notehead, and
 * a wrong one shows a red ring where nothing is printed at all - which is the
 * whole point, since it says *what* was played rather than merely that
 * something was wrong.
 */
/**
 * Horizontal centre of a mark, shifted by how early or late it was.
 *
 * The shift is scaled by the distance to the neighbour it is leaning towards,
 * so it means the same thing at any tempo, zoom or note spacing. When that
 * neighbour is on the next system there is no distance to scale by - the x
 * axis restarts - so the mark simply stays on its own note.
 */
function markX(
  stepX: ReadonlyMap<number, number>,
  stepIndex: number,
  offset: number,
): number | undefined {
  const base = stepX.get(stepIndex);
  if (base === undefined || offset === 0) {
    return base;
  }
  const neighbour = stepX.get(offset < 0 ? stepIndex - 1 : stepIndex + 1);
  if (neighbour === undefined) {
    return base;
  }
  const gap = offset < 0 ? base - neighbour : neighbour - base;
  return gap > 0 ? base + offset * gap : base;
}

export function buildOverlayShapes(
  marks: readonly PlayedMark[],
  layout: OverlayLayout,
): OverlayShape[] {
  const shapes: OverlayShape[] = [];
  const step = layout.geometry.stepHeight;
  const radiusX = step * 1.25;
  const radiusY = step * 0.95;

  for (const mark of marks) {
    const x = markX(layout.stepX, mark.stepIndex, mark.offset);
    if (x === undefined) {
      // A step the engraver never drew, such as a bar of rests.
      continue;
    }

    // Displaced means it missed the beat: the offset already carries the
    // dead zone, so nothing here has to re-decide what counts as on time.
    const looseTiming = mark.offset !== 0;
    const pitch = spellPlayed(mark.midi, layout.key);
    const staffNumber = staffForDiatonic(layout.geometry, mark.stepIndex, pitch.diatonicIndex);
    if (staffNumber === null) {
      continue;
    }
    const y = yForDiatonic(layout.geometry, staffNumber, mark.stepIndex, pitch.diatonicIndex);
    if (y === null) {
      continue;
    }

    const clef = layout.clefAt(staffNumber, mark.stepIndex);
    const [bottomLine, topLine] = CLEF_LINE_RANGE[clef];
    for (const ledgerIndex of ledgerIndicesFor(bottomLine, topLine, pitch.diatonicIndex)) {
      const ledgerY = yForDiatonic(layout.geometry, staffNumber, mark.stepIndex, ledgerIndex);
      if (ledgerY !== null) {
        shapes.push({
          kind: 'ledger',
          y: ledgerY,
          x1: x - radiusX * 1.6,
          x2: x + radiusX * 1.6,
          correct: mark.correct,
          looseTiming,
        });
      }
    }

    if (pitch.alter !== layout.key.alterationFor(pitch.step)) {
      shapes.push({
        kind: 'accidental',
        x: x - radiusX * 2.4,
        y: y + step * 0.7,
        text: ACCIDENTAL_GLYPHS[pitch.alter] ?? '',
        size: step * 3.2,
        correct: mark.correct,
        looseTiming,
      });
    }

    shapes.push({
      kind: 'notehead',
      x,
      y,
      radiusX,
      radiusY,
      correct: mark.correct,
      looseTiming,
    });
  }

  return shapes;
}

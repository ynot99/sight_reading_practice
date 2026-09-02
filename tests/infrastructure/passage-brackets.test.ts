import { describe, expect, it } from 'vitest';
import {
  bracketShapes,
  gripAt,
  gripsOf,
  gripUnderPointer,
  measureAt,
  measureForDrag,
  passageAfterTap,
  measureUnderPointer,
  passageAfterDrag,
  toDrawingPoint,
  type DrawnMeasure,
  type Grip,
} from '../../src/infrastructure/rendering/passageBrackets.js';

/** Four bars on one line, then four on the next. */
function page(): DrawnMeasure[] {
  const measures: DrawnMeasure[] = [];
  for (let system = 0; system < 2; system += 1) {
    for (let at = 0; at < 4; at += 1) {
      measures.push({
        measureIndex: system * 4 + at,
        page: 0,
        left: 40 + at * 100,
        right: 140 + at * 100,
        top: 20 + system * 200,
        bottom: 120 + system * 200,
      });
    }
  }
  return measures;
}

describe('where the markers stand', () => {
  it('puts one at the front of the first bar and one at the back of the last', () => {
    const [start, end] = bracketShapes(page(), 1, 2);

    expect(start).toEqual({ edge: 'start', measureIndex: 1, x: 140, top: 20, bottom: 120 });
    expect(end).toEqual({ edge: 'end', measureIndex: 2, x: 340, top: 20, bottom: 120 });
  });

  it('gives each marker the height of the system it stands in', () => {
    // A page holds several lines one under another, so a bar has no page-wide
    // vertical position: a passage running across a line break has its two
    // markers two hundred pixels apart vertically.
    const [start, end] = bracketShapes(page(), 3, 5);

    expect(start?.top).toBe(20);
    expect(end?.top).toBe(220);
  });

  it('keeps a marker at the edge when the passage runs past what is drawn', () => {
    // A drag can reach for bars the engraving does not contain - the score on
    // screen *is* the passage - and the marker has to stay somewhere the
    // reader can still see and still be holding.
    const [start, end] = bracketShapes(page(), -3, 99);

    expect(start?.x).toBe(40);
    expect(end?.x).toBe(440);
  });

  it('says nothing when there is nothing to stand on', () => {
    expect(bracketShapes([], 0, 1)).toEqual([]);
    // Backwards is not a passage.
    expect(bracketShapes(page(), 5, 2)).toEqual([]);
  });
});

describe('a drag that reaches past the edge of the engraving', () => {
  it('counts a bar for every bar-width it overshoots by', () => {
    // Narrowing is obvious and widening was impossible: a passage is cut out
    // and engraved on its own, so the bars on either side of it are not on
    // the page at all. Pulling the marker past the edge is how they come
    // back, and the index it reports then falls outside what is drawn.
    const measures = page();

    expect(measureForDrag(measures, { x: -60, y: 70 }, 'start')).toBe(-1);
    expect(measureForDrag(measures, { x: -160, y: 70 }, 'start')).toBe(-2);
    expect(measureForDrag(measures, { x: 460, y: 270 }, 'end')).toBe(8);
  });

  it('only counts outwards at the end it is actually the end of', () => {
    // Left of the first bar of the *second* line is the middle of the piece,
    // not before the beginning of it.
    const measures = page();

    expect(measureForDrag(measures, { x: -60, y: 270 }, 'start')).toBe(4);
    expect(measureForDrag(measures, { x: 460, y: 70 }, 'end')).toBe(3);
  });

  it('behaves like a plain drag anywhere inside the piece', () => {
    expect(measureForDrag(page(), { x: 240, y: 70 }, 'start')).toBe(2);
    expect(measureForDrag([], { x: 0, y: 0 }, 'start')).toBeNull();
  });
});

describe('the bar a finger is resting on', () => {
  it('takes the bar the point is inside, not the nearest bar line', () => {
    // A marker being dragged wants the nearest line, because it stands on
    // one. A finger pointing at a bar wants the bar - which is a box the
    // size of a thumbprint several times over, where a notehead is the size
    // of a pencil tip.
    // Bars run 40..140, 140..240, 240..340, so this is well inside the third.
    expect(measureAt(page(), { x: 290, y: 70 })).toBe(2);
    expect(measureAt(page(), { x: 190, y: 70 })).toBe(1);
  });

  it('reads the line first, like everything else on a page', () => {
    expect(measureAt(page(), { x: 290, y: 270 })).toBe(6);
  });

  it('lands on a bar even when the finger is off the staves', () => {
    // On the stem of a high note, or in the space under the last stave.
    expect(measureAt(page(), { x: 290, y: -40 })).toBe(2);
    expect(measureAt(page(), { x: 900, y: 70 })).toBe(3);
    expect(measureAt(page(), { x: -60, y: 70 })).toBe(0);
  });

  it('has nothing to point at on an empty page', () => {
    expect(measureAt([], { x: 0, y: 0 })).toBeNull();
  });
});

describe('the bar a drag lands on', () => {
  it('takes the nearest bar line, not the bar the finger is inside', () => {
    // A marker is put *on* a bar line, so what matters is which line the
    // finger is nearest - dropping it just past a line means that line.
    expect(measureUnderPointer(page(), { x: 145, y: 70 }, 'start')).toBe(1);
    expect(measureUnderPointer(page(), { x: 135, y: 70 }, 'start')).toBe(1);
  });

  it('measures the start from where a bar begins and the end from where it finishes', () => {
    // Both have to read as "this bar is in the passage", and a bar has two
    // sides.
    const at = { x: 240, y: 70 };

    expect(measureUnderPointer(page(), at, 'start')).toBe(2);
    expect(measureUnderPointer(page(), at, 'end')).toBe(1);
  });

  it('chooses the line first and the bar second', () => {
    // A page is read in systems. A finger an inch to the right of the last
    // bar of the first line means the end of that line, not somewhere on the
    // second - which is what a plain nearest-box test would have said.
    expect(measureUnderPointer(page(), { x: 900, y: 70 }, 'end')).toBe(3);
    expect(measureUnderPointer(page(), { x: 900, y: 270 }, 'end')).toBe(7);
  });

  it('lands somewhere even when the drag strays into the gap between lines', () => {
    expect(measureUnderPointer(page(), { x: 140, y: 160 }, 'start')).toBe(1);
    expect(measureUnderPointer([], { x: 0, y: 0 }, 'start')).toBeNull();
  });
});

describe('taking hold of a marker', () => {
  const brackets = bracketShapes(page(), 1, 2);

  it('answers to a fingertip rather than to a hairline', () => {
    // The marker is a few pixels wide and a fingertip is a centimetre. The
    // gesture this replaces missed constantly, which is why it is being
    // replaced.
    expect(gripAt(brackets, { x: 140, y: 70 })).toBe('start');
    expect(gripAt(brackets, { x: 155, y: 70 })).toBe('start');
    expect(gripAt(brackets, { x: 330, y: 70 })).toBe('end');
  });

  it('lets a touch on the music through', () => {
    expect(gripAt(brackets, { x: 240, y: 70 })).toBeNull();
    // Far above the system the markers stand in.
    expect(gripAt(brackets, { x: 140, y: -100 })).toBeNull();
  });

  it('gives a touch between two markers to the nearer one', () => {
    const together = bracketShapes(page(), 1, 1);

    expect(gripAt(together, { x: 142, y: 70 })).toBe('start');
    expect(gripAt(together, { x: 238, y: 70 })).toBe('end');
  });
});

describe('the four round handles', () => {
  const brackets = bracketShapes(page(), 1, 3);

  it('puts one at each end of each marker', () => {
    const grips = gripsOf(brackets);

    expect(grips.map((grip) => `${grip.edge}-${grip.end}`)).toEqual([
      'start-top',
      'start-bottom',
      'end-top',
      'end-bottom',
    ]);
  });

  it('widens from the top of either marker and narrows from the bottom', () => {
    // One rule for all four, so there is nothing to remember - and each one
    // carries an arrow pointing the way it will actually move.
    const grips = gripsOf(brackets);
    const by = (edge: string, end: string) =>
      grips.find((grip) => grip.edge === edge && grip.end === end);

    expect(by('start', 'top')).toMatchObject({ widens: true, towards: -1 });
    expect(by('start', 'bottom')).toMatchObject({ widens: false, towards: 1 });
    expect(by('end', 'top')).toMatchObject({ widens: true, towards: 1 });
    expect(by('end', 'bottom')).toMatchObject({ widens: false, towards: -1 });
  });

  it('answers a tap on itself and not on the line between', () => {
    const grips = gripsOf(brackets);

    expect(gripUnderPointer(grips, { x: 140, y: 22 })).toMatchObject({ end: 'top' });
    expect(gripUnderPointer(grips, { x: 140, y: 118 })).toMatchObject({ end: 'bottom' });
    // Halfway down the marker is the part you drag, not a button.
    expect(gripUnderPointer(grips, { x: 140, y: 70 })).toBeNull();
  });

  it('moves the passage one bar', () => {
    const grips = gripsOf(brackets);
    const at = { fromIndex: 1, toIndex: 3 };

    expect(passageAfterTap(at, grips[0] as Grip)).toEqual({ fromIndex: 0, toIndex: 3 });
    expect(passageAfterTap(at, grips[1] as Grip)).toEqual({ fromIndex: 2, toIndex: 3 });
    expect(passageAfterTap(at, grips[2] as Grip)).toEqual({ fromIndex: 1, toIndex: 4 });
    expect(passageAfterTap(at, grips[3] as Grip)).toEqual({ fromIndex: 1, toIndex: 2 });
  });

  it('will not narrow a passage of one bar out of existence', () => {
    const one = gripsOf(bracketShapes(page(), 2, 2));
    const at = { fromIndex: 2, toIndex: 2 };

    expect(passageAfterTap(at, one[1] as Grip)).toEqual({ fromIndex: 2, toIndex: 2 });
    expect(passageAfterTap(at, one[3] as Grip)).toEqual({ fromIndex: 2, toIndex: 2 });
  });
});

describe('what a drag leaves behind', () => {
  it('moves the marker that was dragged and leaves the other alone', () => {
    expect(passageAfterDrag({ fromIndex: 1, toIndex: 5 }, 'start', 3)).toEqual({
      fromIndex: 3,
      toIndex: 5,
    });
    expect(passageAfterDrag({ fromIndex: 1, toIndex: 5 }, 'end', 3)).toEqual({
      fromIndex: 1,
      toIndex: 3,
    });
  });

  it('will not let one marker pass the other', () => {
    // Dragged past, it reads as "just this bar" - plainly where the reader
    // was heading, and better than a passage that runs backwards or a drag
    // that silently does nothing.
    expect(passageAfterDrag({ fromIndex: 1, toIndex: 5 }, 'start', 9)).toEqual({
      fromIndex: 5,
      toIndex: 5,
    });
    expect(passageAfterDrag({ fromIndex: 4, toIndex: 5 }, 'end', 0)).toEqual({
      fromIndex: 4,
      toIndex: 4,
    });
  });
});

describe('putting a touch back into the drawing', () => {
  it('undoes whatever the page is scaling the engraving by', () => {
    // The engraving is drawn at one size and shown at another - the reader
    // zooms, and a tablet held sideways scales it again.
    const point = toDrawingPoint(
      { left: 10, top: 50, width: 400, height: 200 },
      { width: 800, height: 400 },
      { x: 210, y: 150 },
    );

    expect(point).toEqual({ x: 400, y: 200 });
  });

  it('says nothing when there is nothing on the page to measure against', () => {
    expect(
      toDrawingPoint({ left: 0, top: 0, width: 0, height: 0 }, { width: 8, height: 4 }, { x: 1, y: 1 }),
    ).toBeNull();
  });
});

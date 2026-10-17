// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  asCanvasColour,
  paintTheChords,
  paintThePedal,
  paintTheGrid,
  paintTheRuler,
  type RollInks,
  type RollViewport,
} from '../../src/ui/rollPainter.js';
import { surface, type Recorder } from '../support/recordingCanvas.js';
import { theSceneOfTheRoll, type RollScene } from '../../src/ui/rollView.js';
import type { RolledBeat, RolledPress, RunRoll } from '../../src/application/session/RunRoll.js';
import type { BeatWeight } from '../../src/application/ports/IMetronome.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { MIDI } from '../support/fixtures.js';

/** Every ink named by what it is for, so a mark painted says which it was. */
const INKS: RollInks = {
  wait: 'wait',
  row: 'row',
  line: 'line',
  division: 'division',
  downbeat: 'downbeat',
  given: 'given',
  rushed: 'rushed',
  ghost: 'ghost',
  ghostEdge: 'ghost-edge',
  late: 'late',
  note: 'note',
  correct: 'correct',
  wrong: 'wrong',
  aside: 'aside',
  chosen: 'chosen',
  sounding: 'sounding',
  scale: 'scale',
  right: 'right',
  left: 'left',
  tickDivision: 'tick-division',
  tickBeat: 'tick-beat',
  tickDownbeat: 'tick-downbeat',
  bar: 'bar',
  pedal: 'pedal',
  chord: 'chord',
  chordEdge: 'chord-edge',
  chordName: 'chord-name',
  velocity: 'velocity',
  font: 'serif',
};

const at = (over: Partial<RollViewport> = {}): RollViewport => ({
  scrolledPx: 0,
  scrolledDownPx: 0,
  pxPerSecond: 140,
  rowPx: 14,
  ...over,
});

function press(over: Partial<RolledPress> = {}): RolledPress {
  return {
    midi: MIDI.C4,
    downAtMs: 1000,
    upAtMs: 1500,
    velocity: 0.8,
    verdict: 'correct',
    stepIndex: 0,
    deviationMs: null,
    ...over,
  };
}

function beat(atMs: number, weight: BeatWeight, positionTicks: number): RolledBeat {
  return { atMs, weight, positionTicks };
}

function roll(over: Partial<RunRoll> = {}): RunRoll {
  return { presses: [], beats: [], pedal: [], rushes: [], truncated: false, ...over };
}

function sceneOf(input: RunRoll, over: { ghosts?: boolean; parts?: number } = {}): RollScene {
  return theSceneOfTheRoll({
    roll: input,
    barLabel: (ticks) =>
      ticks % (Duration.QUARTER.ticks * 4) === 0 ? String(ticks / (Duration.QUARTER.ticks * 4) + 1) : null,
    grid: { beats: true, parts: over.parts ?? 1 },
    ghosts:
      over.ghosts === true
        ? input.presses.map((each, index) => ({
            midi: each.midi,
            fromTicks: index * Duration.QUARTER.ticks,
            untilTicks: (index + 1) * Duration.QUARTER.ticks,
            stepIndex: each.stepIndex ?? index,
          }))
        : [],
  });
}

/** A bar of four at a second a beat, so a second and a beat are the same. */
function barsOfFour(bars: number): RolledBeat[] {
  return Array.from({ length: bars * 4 }, (_unused, index) =>
    beat(index * 1000, index % 4 === 0 ? 'downbeat' : 'beat', index * Duration.QUARTER.ticks),
  );
}

describe('painting the grid', () => {
  it('paints only the notes on the screen, however long the run', () => {
    // The whole of why it is painted: laid out as an element a mark, every
    // note of the run was placed whether it was on the screen or not.
    const presses = Array.from({ length: 1000 }, (_unused, index) =>
      press({ downAtMs: index * 1000, upAtMs: index * 1000 + 500, stepIndex: index }),
    );
    const { surface: canvas, recorder } = surface(700);

    // Five seconds of screen, a hundred seconds in.
    paintTheGrid(canvas, sceneOf(roll({ presses })), at({ scrolledPx: 14_000 }), INKS, 1);

    const painted = recorder.inked('correct');
    expect(painted.length).toBeGreaterThanOrEqual(5);
    expect(painted.length).toBeLessThanOrEqual(6);
  });

  it('places a note by the zoom and by how far the run is scrolled', () => {
    const scene = sceneOf(roll({ beats: barsOfFour(1), presses: [press({ downAtMs: 1000, upAtMs: 1500 })] }));
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at({ scrolledPx: 70, scrolledDownPx: 14 }), INKS, 1);

    const [note] = recorder.inked('correct');
    const row = scene.notes[0]?.row ?? 0;
    expect(note).toMatchObject({ x: 70, y: row * 14 - 14, tall: 14, corners: 2 });
    expect(note?.wide).toBeCloseTo(70, 6);
  });

  it('paints nothing of a row that is scrolled out of sight', () => {
    const scene = sceneOf(roll({ presses: [press({ midi: 40 }), press({ midi: 90 })] }));
    const { surface: canvas, recorder } = surface(700, 140);

    // Ten rows of a band of fifty-five, from the top.
    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('correct').map((mark) => mark.y)).toEqual([2 * 14]);
  });

  it('draws a note too short to see two pixels wide', () => {
    const scene = sceneOf(roll({ presses: [press({ downAtMs: 1000, upAtMs: 1001 })] }));
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('correct')[0]?.wide).toBe(2);
  });

  it('squares off a note still down when the run ended, and outlines one nothing was decided about', () => {
    const scene = sceneOf(
      roll({
        beats: barsOfFour(1),
        presses: [press({ upAtMs: null }), press({ midi: MIDI.C4 + 2, verdict: null })],
      }),
    );
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('correct')[0]?.corners).toEqual([2, 0, 0, 2]);
    // An outline, because a fill in any colour is a verdict and there was not one.
    expect(recorder.inked('note').map((mark) => mark.how)).toEqual(['stroke']);
  });

  it('rims the note chosen to be changed in the accent, inside its own edge, and no other', () => {
    const chosen = press({ midi: MIDI.C4 + 2, downAtMs: 1000, upAtMs: 1500, verdict: null });
    const scene = theSceneOfTheRoll({
      roll: roll({ presses: [press({ verdict: null }), chosen] }),
      barLabel: () => null,
      chosen: [{ midi: chosen.midi, downAtMs: chosen.downAtMs }],
    });
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    const row = scene.notes.find((note) => note.chosen === true)?.row ?? -1;
    expect(scene.notes.filter((note) => note.chosen === true)).toHaveLength(1);
    const [rim, ...more] = recorder.inked('chosen');
    expect(more).toEqual([]);
    expect(rim).toMatchObject({ how: 'stroke', x: 1, y: row * 14 + 1, tall: 12, corners: 2 });
    expect(rim?.wide).toBeCloseTo(68, 6);
  });

  it('fills the notes being recorded in the accent, faintly, where they go', () => {
    const scene = theSceneOfTheRoll({
      roll: roll({ presses: [press({ verdict: null })] }),
      barLabel: () => null,
    });
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1, [], [], [
      { row: 2, fromMs: 500, untilMs: 1_000 },
      { row: 1_000, fromMs: 500, untilMs: 1_000 },
    ]);

    expect(recorder.inked('chosen').map((mark) => [mark.how, mark.x, mark.y, mark.tall])).toEqual([['fill', 70, 2 * 14, 14]]);
    const [filled] = recorder.inked('chosen');
    expect(filled?.wide).toBeCloseTo(70, 6);
    expect(filled?.alpha).toBeGreaterThan(0.3);
    expect(filled?.alpha).toBeLessThan(1);
    // And the canvas left at full strength for the next painting of it.
    recorder.marks.length = 0;
    paintTheGrid(canvas, scene, at(), INKS, 1);
    expect(recorder.marks.map((mark) => mark.alpha)).not.toContain(filled?.alpha);
  });

  it('rims the notes a chord would be written as where they would go, dashed in the accent, over everything', () => {
    const scene = theSceneOfTheRoll({
      roll: roll({ presses: [press({ verdict: null })] }),
      barLabel: () => null,
    });
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1, [], [
      { row: 1, fromMs: 500, untilMs: 1_000 },
      { row: 3, fromMs: 500, untilMs: 1_000 },
      // Off the drawing, below its last row: not painted.
      { row: 1_000, fromMs: 500, untilMs: 1_000 },
    ]);

    const ahead = recorder.inked('chosen');
    expect(ahead.map((mark) => [mark.how, mark.y, mark.tall, mark.corners])).toEqual([
      ['stroke', 1 * 14 + 1, 12, 2],
      ['stroke', 3 * 14 + 1, 12, 2],
    ]);
    expect(ahead.every((mark) => (mark.dashes ?? []).length > 0)).toBe(true);
    // Half a second in, at 140 pixels a second, inside its own edge.
    expect(ahead[0]?.x).toBeCloseTo(71, 6);
    expect(ahead[0]?.wide).toBeCloseTo(68, 6);
    // The last thing painted.
    expect(recorder.marks.slice(-2)).toEqual(ahead);
    // And the next painting of the same canvas, which keeps how it was left, dashes nothing it did not.
    const chosen = theSceneOfTheRoll({
      roll: roll({ presses: [press({ verdict: null })] }),
      barLabel: () => null,
      chosen: [{ midi: press({}).midi, downAtMs: press({}).downAtMs }],
    });
    recorder.marks.length = 0;
    paintTheGrid(canvas, chosen, at(), INKS, 1);
    expect(recorder.inked('chosen').map((mark) => mark.dashes)).toEqual([[]]);
    // None asked for, none painted.
    const { surface: again, recorder: bare } = surface();
    paintTheGrid(again, scene, at(), INKS, 1);
    expect(bare.inked('chosen')).toEqual([]);
  });

  it('fills a note nothing judged by the hand that plays it, as strongly as it was struck', () => {
    const presses = [
      // Said: the left hand, though its pitch is the right's.
      press({ midi: MIDI.C4 + 4, verdict: null, hand: 'left', velocity: 1 }),
      // Not said: by pitch, middle C the right hand's, B below it the left's.
      press({ midi: MIDI.C4, downAtMs: 1600, upAtMs: 1900, verdict: null, velocity: 0 }),
      press({ midi: MIDI.C4 - 1, downAtMs: 2000, upAtMs: 2400, verdict: null, velocity: 0.5 }),
    ];
    const freely = theSceneOfTheRoll({
      roll: roll({ presses }),
      barLabel: () => null,
      freely: true,
      chosen: [{ midi: MIDI.C4 + 4, downAtMs: 1000 }],
    });
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, freely, at(), INKS, 1);

    expect(freely.notes.map((note) => note.shade)).toEqual(['left', 'right', 'left']);
    expect(recorder.inked('left').map((mark) => [mark.how, mark.alpha])).toEqual([
      ['fill', 1],
      ['fill', 0.3 + 0.7 * 0.5],
    ]);
    expect(recorder.inked('right').map((mark) => [mark.how, mark.alpha])).toEqual([['fill', 0.3]]);
    // And what is painted after a faint one is painted at full strength.
    expect(recorder.inked('chosen').map((mark) => mark.alpha)).toEqual([1]);
    expect(freely.notes.map((note) => note.says)).toEqual([
      'E4 · not judged · left hand',
      'C4 · not judged',
      'B3 · not judged',
    ]);
    // A run's unjudged notes are still an outline: nothing was decided about them.
    expect(sceneOf(roll({ presses })).notes.map((note) => note.shade)).toEqual(['unjudged', 'unjudged', 'unjudged']);
  });

  it('bars the top of each note as long, of its length, as it was loud, inside its edges, and none on a note too small', () => {
    const scene = sceneOf(
      roll({
        presses: [
          // Half a second at 140 px a second is 70 px: 64 inside the insets.
          press({ midi: MIDI.C4, velocity: 1 }),
          press({ midi: MIDI.C4 + 2, velocity: 0.5, verdict: null }),
          press({ midi: MIDI.C4 + 4, velocity: 0 }),
          press({ midi: MIDI.C4 + 5, velocity: 0.25, verdict: 'wrong' }),
          // Too short to hold a bar inside its edges.
          press({ midi: MIDI.C4 + 7, downAtMs: 2000, upAtMs: 2030 }),
        ],
      }),
    );
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    const rowOf = (midi: number): number => scene.notes.find((note) => scene.highest - note.row === midi)?.row ?? -1;
    expect(
      recorder.inked('velocity').map((mark) => [mark.how, mark.x, mark.y, Number(mark.wide.toFixed(6)), mark.tall]),
    ).toEqual([
      ['fill', 3, rowOf(MIDI.C4) * 14 + 3, 64, 2],
      ['fill', 3, rowOf(MIDI.C4 + 2) * 14 + 3, 32, 2],
      ['fill', 3, rowOf(MIDI.C4 + 4) * 14 + 3, 0, 2],
      ['fill', 3, rowOf(MIDI.C4 + 5) * 14 + 3, 16, 2],
    ]);
    // Painted over the notes, under the rim of one chosen.
    const order = recorder.marks.map((mark) => mark.ink);
    expect(order.lastIndexOf('correct')).toBeLessThan(order.indexOf('velocity'));
    // A row too short to hold one, none.
    const short = surface();
    paintTheGrid(short.surface, scene, at({ rowPx: 7 }), INKS, 1);
    expect(short.recorder.inked('velocity')).toEqual([]);
  });

  it('colours each press by its verdict', () => {
    const scene = sceneOf(
      roll({
        presses: [
          press({ verdict: 'correct' }),
          press({ midi: MIDI.C4 + 2, verdict: 'wrong' }),
          press({ midi: MIDI.C4 + 4, verdict: 'duplicate' }),
        ],
      }),
    );
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('correct')).toHaveLength(1);
    expect(recorder.inked('wrong')).toHaveLength(1);
    expect(recorder.inked('aside')).toHaveLength(1);
  });

  it('lights each row of a scale as far as the next, over the black keys\' shading and under the notes, none out of sight', () => {
    const input = roll({ presses: [press({ midi: 40 }), press({ midi: 90 })] });
    // One scale until two seconds in - 280 pixels at 140 a second - then another.
    const scene = {
      ...sceneOf(input),
      scaleSpans: [
        { fromMs: Number.NEGATIVE_INFINITY, untilMs: 2_000, rows: [2, 50] },
        { fromMs: 2_000, untilMs: Number.POSITIVE_INFINITY, rows: [3] },
        // Past the screen altogether.
        { fromMs: 9_000, untilMs: 10_000, rows: [4] },
      ],
    };
    const { surface: canvas, recorder } = surface(700, 140);

    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('scale')).toEqual([
      expect.objectContaining({ x: 0, y: 2 * 14, wide: 280, tall: 14 }),
      expect.objectContaining({ x: 280, y: 3 * 14, wide: 420, tall: 14 }),
    ]);
    expect(recorder.order.indexOf('row')).toBeLessThan(recorder.order.indexOf('scale'));
    expect(recorder.order.indexOf('scale')).toBeLessThan(recorder.order.indexOf('correct'));
    const { surface: plain, recorder: none } = surface(700, 140);
    paintTheGrid(plain, sceneOf(input), at(), INKS, 1);
    expect(none.inked('scale')).toEqual([]);
  });

  it('lays a band across the whole width of each row sounding, under the notes, and none out of sight', () => {
    const scene = sceneOf(roll({ presses: [press({ midi: 40 }), press({ midi: 90 })] }));
    const { surface: canvas, recorder } = surface(700, 140);

    // Ten rows of a band of fifty-five, from the top: the third is on the screen, the fiftieth is not.
    paintTheGrid(canvas, scene, at(), INKS, 1, [2, 50]);

    expect(recorder.inked('sounding')).toEqual([expect.objectContaining({ x: 0, y: 2 * 14, wide: 700, tall: 14 })]);
    expect(recorder.order.indexOf('sounding')).toBeLessThan(recorder.order.indexOf('correct'));
    // None sounding, none painted.
    const { surface: still, recorder: none } = surface(700, 140);
    paintTheGrid(still, scene, at(), INKS, 1);
    expect(none.inked('sounding')).toEqual([]);
  });

  it('lays the waits under the rows, the bands under the presses, and the capsules over them', () => {
    // The waits under the rows, which are a dark wash with the ground showing
    // through, so the black keys darken them - his "на чорні ноти також буде
    // темне жовтий колір". The capsules over the presses, because an outline
    // under the note that answered it is one nobody can see - his "чи можеш
    // зробити ghost ноти щоб вони малювалися поверх моїх нот".
    const scene = sceneOf(
      roll({
        beats: [beat(0, 'downbeat', 0), beat(400, 'downbeat', 0), beat(1400, 'beat', Duration.QUARTER.ticks)],
        presses: [press({ downAtMs: 700, upAtMs: 1200, stepIndex: 0 })],
      }),
      { ghosts: true },
    );
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    const order = recorder.order;
    expect(order.indexOf('wait')).toBeLessThan(order.indexOf('row'));
    expect(order.indexOf('late')).toBeLessThan(order.indexOf('correct'));
    expect(order.indexOf('correct')).toBeLessThan(order.indexOf('ghost'));
    // The capsule rimmed after it is filled, so the rim is on top.
    expect(order.indexOf('ghost')).toBeLessThan(order.indexOf('ghost-edge'));
  });

  it('makes a band as solid as the gap it stands for', () => {
    const scene = sceneOf(
      roll({ beats: barsOfFour(1), presses: [press({ downAtMs: 200, upAtMs: 800, stepIndex: 0 })] }),
      { ghosts: true },
    );
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('late')[0]?.alpha).toBe(scene.slips[0]?.strength);
    // And no solidity left behind it for whatever is painted next.
    expect(recorder.inked('correct')[0]?.alpha).toBe(1);
  });

  it('dashes the lines between the beats and draws the rest solid, each at its weight', () => {
    const scene = sceneOf(roll({ beats: barsOfFour(1) }), { parts: 2 });
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('division').every((mark) => mark.dashes?.join() === '3,3')).toBe(true);
    expect(recorder.inked('division').length).toBeGreaterThan(0);
    expect(recorder.inked('line').map((mark) => mark.wide)).toEqual([1, 1, 1]);
    expect(recorder.inked('downbeat').map((mark) => mark.wide)).toEqual([2]);
  });

  it('draws a bar line the reader gave, and a beat they overtook', () => {
    const scene = sceneOf(
      roll({
        beats: [beat(0, 'downbeat', 0), beat(300, 'downbeat', 0)],
        rushes: [{ atMs: 600, byMs: 100 }],
      }),
    );
    const { surface: canvas, recorder } = surface();

    paintTheGrid(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('given').map((mark) => mark.x)).toEqual([42]);
    expect(recorder.inked('rushed').map((mark) => mark.x)).toEqual([84]);
  });

  it('paints as many pixels as the screen has, and no more work where there is no screen', () => {
    const scene = sceneOf(roll({ presses: [press()] }));
    const sharp = surface(700, 280);

    paintTheGrid(sharp.surface, scene, at(), INKS, 2);

    expect([sharp.surface.width, sharp.surface.height]).toEqual([1400, 560]);
    expect(sharp.recorder.transform).toEqual([2, 0, 0, 2, 0, 0]);

    const none = surface(0, 280);
    paintTheGrid(none.surface, scene, at(), INKS, 1);
    expect(none.asked()).toBe(0);
  });
});

describe('painting the ruler and the pedal', () => {
  it('marks the ruler with the grid’s own lines, in the same places', () => {
    // A ruler with a metre of its own would be a second answer to what the bar is.
    const scene = sceneOf(roll({ beats: barsOfFour(2) }), { parts: 2 });
    const grid = surface();
    const ruler = surface(700, 19);

    paintTheGrid(grid.surface, scene, at({ scrolledPx: 100 }), INKS, 1);
    paintTheRuler(ruler.surface, scene, at({ scrolledPx: 100 }), INKS, 1);

    const xs = (recorder: Recorder, inks: string[]): number[] =>
      recorder.marks.filter((mark) => inks.includes(mark.ink)).map((mark) => mark.x).sort((a, b) => a - b);
    expect(xs(ruler.recorder, ['tick-beat', 'tick-downbeat'])).toEqual(xs(grid.recorder, ['line', 'downbeat']));
    // Tall for a bar, short for a beat, shorter for what falls between, all
    // standing on the foot of the ruler.
    const tall = (ink: string): number | undefined => ruler.recorder.inked(ink)[0]?.tall;
    expect([tall('tick-division'), tall('tick-beat'), tall('tick-downbeat')]).toEqual([4, 7, 11]);
    expect(ruler.recorder.inked('tick-beat').every((mark) => mark.y + mark.tall === 19)).toBe(true);
  });

  it('names each bar on the ruler, a little in from its line', () => {
    const scene = sceneOf(roll({ beats: barsOfFour(2) }));
    const { surface: canvas, recorder } = surface(700, 19);

    paintTheRuler(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('bar').map((mark) => [mark.words, mark.x, mark.y])).toEqual([
      ['1', 3, 3],
      ['2', 563, 3],
    ]);
    expect(recorder.font).toBe('10px serif');
  });

  it('names on the ruler no bar a flag is over, the flag naming it', () => {
    const scene = theSceneOfTheRoll({
      roll: roll({ beats: barsOfFour(3) }),
      barLabel: (ticks) => (ticks % (Duration.QUARTER.ticks * 4) === 0 ? String(ticks / (Duration.QUARTER.ticks * 4) + 1) : null),
      marks: [
        { atMs: 4_000, says: '3/4' },
        { atMs: 5_000, says: '\u2669=90' },
      ],
    });
    const { surface: canvas, recorder } = surface(1_400, 19);

    paintTheRuler(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('bar').map((mark) => mark.words)).toEqual(['1', '3']);
  });

  it('keeps the name of a bar begun just off the left edge', () => {
    const scene = sceneOf(roll({ beats: barsOfFour(2) }));
    const { surface: canvas, recorder } = surface(700, 19);

    paintTheRuler(canvas, scene, at({ scrolledPx: 10 }), INKS, 1);

    expect(recorder.inked('bar').map((mark) => mark.words)).toEqual(['1', '2']);
  });

  it('paints the pedal for as long as it was down', () => {
    const scene = sceneOf(roll({ beats: barsOfFour(1), pedal: [{ downAtMs: 500, upAtMs: 2500 }] }));
    const { surface: canvas, recorder } = surface(700, 15);

    paintThePedal(canvas, scene, at(), INKS, 1);

    expect(recorder.inked('pedal')).toMatchObject([{ x: 70, y: 4, tall: 7, corners: 4 }]);
    expect(recorder.inked('pedal')[0]?.wide).toBeCloseTo(280, 6);
  });
});

describe('painting the chords the notes make', () => {
  /** A scene with these chords in its lane, each a block from one second to another. */
  const withChords = (chords: readonly [number, number, string, string, boolean, boolean?][]): RollScene => ({
    ...sceneOf(roll({ beats: barsOfFour(4) })),
    chords: chords.map(([from, until, name, numeral, exactly, chosen]) => ({
      fromMs: from * 1000,
      untilMs: until * 1000,
      name,
      numeral,
      exactly,
      chosen: chosen === true,
      says: name,
    })),
  });

  it('paints a block for each chord as long as it lasts, its name and degree written in it', () => {
    const { surface: canvas, recorder } = surface(700, 30);

    paintTheChords(canvas, withChords([[0, 2, 'C', 'I', true], [2, 4, 'Am', 'vi', false]]), at(), INKS, 1);

    // A second is 140 pixels: blocks a pixel in from the line between them.
    expect(recorder.inked('chord').map(({ x, y, wide, tall }) => [x, y, wide, tall])).toEqual([
      [1, 2, 278, 26],
      [281, 2, 278, 26],
    ]);
    // Edged whole where it is every note, in dashes where it is most of them.
    expect(recorder.inked('chord-edge').map((mark) => mark.dashes)).toEqual([[], [3, 2]]);
    // The name, then the degree after it: six pixels a letter here.
    expect(recorder.inked('chord-name').map(({ words, x, y }) => [words, x, y])).toEqual([
      ['C', 6, 15],
      ['Am', 286, 15],
    ]);
    expect(recorder.inked('bar').map(({ words, x }) => [words, x])).toEqual([
      ['I', 6 + 6 + 5],
      ['vi', 286 + 12 + 5],
    ]);
  });

  it('keeps the words of a chord begun off the left edge in sight, as far as they still fit in it', () => {
    const { surface: canvas, recorder } = surface(700, 30);
    // Scrolled a second and a half in, through a chord of two seconds.
    paintTheChords(canvas, withChords([[0, 2, 'Dm7', 'ii7', true]]), at({ scrolledPx: 210 }), INKS, 1);
    expect(recorder.inked('chord-name').map(({ x }) => x)).toEqual([5]);

    // Further, until they would run out of it: they stay at its end.
    const further = surface(700, 30);
    paintTheChords(further.surface, withChords([[0, 2, 'Dm7', 'ii7', true]]), at({ scrolledPx: 260 }), INKS, 1);
    expect(further.recorder.inked('chord-name').map(({ x }) => x)).toEqual([2 * 140 - 260 - 1 - 5 - 18]);
  });

  it('rims a chord whose notes are chosen as a chosen note is rimmed', () => {
    const { surface: canvas, recorder } = surface(700, 30);

    paintTheChords(canvas, withChords([[0, 2, 'C', 'I', true, true], [2, 4, 'Am', 'vi', true]]), at(), INKS, 1);

    expect(recorder.marks.filter((mark) => mark.how === 'stroke').map((mark) => mark.ink)).toEqual(['chosen', 'chord-edge']);
  });

  it('leaves the words out of a block too short to hold them, and the degree out of one that holds only the name', () => {
    const { surface: canvas, recorder } = surface(700, 30);
    // A tenth of a second is fourteen pixels; a fifth, twenty-eight.
    paintTheChords(canvas, withChords([[0, 0.1, 'G7', 'V7', true], [1, 1.2, 'C', 'I', true]]), at(), INKS, 1);

    expect(recorder.inked('chord')).toHaveLength(2);
    expect(recorder.inked('chord-name').map((mark) => mark.words)).toEqual(['C']);
    expect(recorder.inked('bar')).toEqual([]);
  });
});

describe('the colours the drawing is painted in', () => {
  it('writes a colour mixed with transparency out as one every canvas takes', () => {
    expect(asCanvasColour('color(srgb 0.984314 0.74902 0.141176 / 0.26)')).toBe('rgba(251, 191, 36, 0.26)');
    expect(asCanvasColour('color(srgb 1 0 0)')).toBe('rgba(255, 0, 0, 1)');
    expect(asCanvasColour('rgb(74, 222, 128)')).toBe('rgb(74, 222, 128)');
  });
});

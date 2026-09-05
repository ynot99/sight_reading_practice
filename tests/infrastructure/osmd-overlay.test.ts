// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { Pitch } from '../../src/domain/model/Pitch.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import type { ClefKind } from '../../src/domain/model/Clef.js';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { BUILT_IN_RHYTHM_PROFILES } from '../../src/domain/generation/rhythmProfiles.js';
import { RhythmProfileRegistry } from '../../src/domain/generation/RhythmProfile.js';

import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { bar, beamedSixteenths, p, twoBarExercise } from '../support/fixtures.js';
import { rulerMarks } from '../../src/application/rhythmRuler.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { noteEntry, restEntry, type Exercise } from '../../src/domain/model/Exercise.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { createScoreContainer, installCanvasStub, staffLineYs } from '../support/osmdHarness.js';

const RHYTHMS = new RhythmProfileRegistry().registerAll(BUILT_IN_RHYTHM_PROFILES);

const CLEFS = new Map<number, ClefKind>([
  [1, 'treble'],
  [2, 'bass'],
]);

function noteheads(container: HTMLElement): SVGEllipseElement[] {
  return [...container.querySelectorAll('ellipse.played-note')] as SVGEllipseElement[];
}

function centreY(element: Element | undefined): number {
  return Number.parseFloat(element?.getAttribute('cy') ?? 'NaN');
}

/**
 * The overlay against the real engraver.
 *
 * Everything else about it is covered by arithmetic on fabricated numbers;
 * this is the test that says the arithmetic matches what OSMD actually drew.
 */
describe('played notes drawn over a real engraving', () => {
  let container: HTMLElement;
  let renderer: OsmdScoreRenderer;

  beforeAll(() => {
    installCanvasStub();
  });

  beforeEach(async () => {
    document.body.replaceChildren();
    container = createScoreContainer();
    renderer = new OsmdScoreRenderer(container, { zoom: 1 });
    await renderer.load(new MusicXmlSerializer().serialize(twoBarExercise()));
    renderer.configureOverlay({
      keyAt: () => KeySignature.major(0),
      clefAt: (staffNumber) => CLEFS.get(staffNumber) ?? 'treble',
    });
  });

  it('places a step by a note, never by a hand resting through the bar', async () => {
    // Reported from the page. Bone Bottom opens with four bars of the right
    // hand resting while the left plays, and every mark for a downbeat there
    // was drawn well inside the bar instead of on the beat: a whole-measure
    // rest is drawn in the *middle* of its bar - it says "silent for the
    // whole bar" and has no moment of its own - and the step's place was
    // being read off whichever thing the engraver happened to hand over
    // first.
    const resting: Exercise = {
      ...twoBarExercise(),
      staves: [
        {
          staffNumber: 1,
          voice: 1,
          clef: 'treble',
          clefChanges: [],
          measures: [bar(restEntry(Duration.WHOLE)), bar(noteEntry(p('G4'), Duration.WHOLE))],
        },
        {
          staffNumber: 2,
          voice: 2,
          clef: 'bass',
          clefChanges: [],
          measures: [
            bar(
              noteEntry(p('C3'), Duration.QUARTER),
              noteEntry(p('D3'), Duration.QUARTER),
              noteEntry(p('E3'), Duration.QUARTER),
              noteEntry(p('F3'), Duration.QUARTER),
            ),
            bar(noteEntry(p('G3'), Duration.WHOLE)),
          ],
        },
      ],
    };
    await renderer.load(new MusicXmlSerializer().serialize(resting));
    renderer.configureOverlay({
      keyAt: () => KeySignature.major(0),
      clefAt: (staffNumber) => CLEFS.get(staffNumber) ?? 'treble',
    });

    for (const [at, name] of ['C3', 'D3', 'E3', 'F3'].entries()) {
      renderer.showPlayed({ stepIndex: at, midi: Pitch.parse(name).midi, correct: true, offset: 0 });
    }

    // The four beats of the bar run across the page in the order they were
    // played. With the downbeat read off the resting hand's rest it landed in
    // the middle of the bar, which is to say between the second beat and the
    // third.
    const across = noteheads(container).map((head) => Number.parseFloat(head.getAttribute('cx') ?? 'NaN'));
    expect(across).toHaveLength(4);
    for (let at = 1; at < across.length; at += 1) {
      expect(across[at]).toBeGreaterThan(across[at - 1] ?? Number.NaN);
    }
  });

  it('draws a correct press exactly on the note the engraver printed', () => {
    // Step 0 of the fixture is C4 over C3.
    renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });

    const [head] = noteheads(container);
    expect(head).toBeDefined();
    // The treble stave's bottom line is E4; middle C sits two positions below.
    const lines = staffLineYs(container);
    const trebleBottom = lines[4];
    expect(trebleBottom).toBeDefined();
    expect(centreY(head)).toBeCloseTo((trebleBottom ?? 0) + 2 * 5, 6);
    expect(head?.getAttribute('class')).toContain('played--correct');
  });

  it('paints a right note played off the beat in its own tone', () => {
    renderer.showPlayed({
      stepIndex: 1,
      midi: Pitch.parse('D4').midi,
      correct: true,
      offset: -0.4,
    });

    const [head] = noteheads(container);
    const className = head?.getAttribute('class') ?? '';
    expect(className).toContain('played--loose');
    expect(className).not.toContain('played--correct');
  });

  it('puts a bass note on the bass stave', () => {
    renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C3').midi, correct: true, offset: 0 });

    const lines = staffLineYs(container);
    const trebleBottom = lines[4] ?? 0;
    // Below every treble line, which is what "on the other stave" means here.
    expect(centreY(noteheads(container)[0])).toBeGreaterThan(trebleBottom);
  });

  it('separates two pitches by the printed line spacing', () => {
    renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });
    renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('E4').midi, correct: false, offset: 0 });

    const lines = staffLineYs(container);
    const spacing = (lines[1] ?? 0) - (lines[0] ?? 0);
    const heads = noteheads(container);
    // C4 to E4 is two staff positions, which is one line of separation.
    expect(centreY(heads[0]) - centreY(heads[1])).toBeCloseTo(spacing, 6);
  });

  it('marks a wrong press differently, at the pitch actually struck', () => {
    renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('F4').midi, correct: false, offset: 0 });

    const [head] = noteheads(container);
    expect(head?.getAttribute('class')).toContain('played--wrong');
    const lines = staffLineYs(container);
    // F4 is the space just above the bottom treble line.
    expect(centreY(head)).toBeCloseTo((lines[4] ?? 0) - 5, 6);
  });

  it('draws a ledger line through middle C', () => {
    renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });

    const ledgers = container.querySelectorAll('line.played-ledger');
    expect(ledgers).toHaveLength(1);
    expect(Number.parseFloat(ledgers[0]?.getAttribute('y1') ?? 'NaN')).toBeCloseTo(
      centreY(noteheads(container)[0]),
      6,
    );
  });

  it('writes an accidental for a black key, so the mark cannot lie', () => {
    renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C#4').midi, correct: false, offset: 0 });

    const accidental = container.querySelector('text.played-accidental');
    expect(accidental?.textContent).toBe('♯');
    // Drawn on C, with the sign saying which C.
    expect(centreY(noteheads(container)[0])).toBeCloseTo(
      (staffLineYs(container)[4] ?? 0) + 10,
      6,
    );
  });

  it('adds the note just played without redrawing the ones before it', () => {
    // Every mark is worked out on its own, so a new one is drawn beside the
    // others rather than by clearing the layer and building all of them
    // again. On a long score that redrawing grew with the run - two hundred
    // notes in, one keystroke cost two hundred marks' worth of work, and the
    // page stopped answering partway through.
    renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });
    const first = noteheads(container)[0];

    renderer.showPlayed({ stepIndex: 1, midi: Pitch.parse('D4').midi, correct: true, offset: 0 });

    // The very same element, not an equal one drawn afresh.
    expect(noteheads(container)[0]).toBe(first);
    expect(noteheads(container)).toHaveLength(2);
  });

  it('keeps one layer per page rather than looking for it each time', () => {
    // Finding it by class walks the whole drawing, and it is appended last so
    // the walk never ends early - which on a big score was the entire cost of
    // showing a played note.
    renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });
    const layers = container.querySelectorAll('g.played-overlay');

    renderer.showPlayed({ stepIndex: 1, midi: Pitch.parse('D4').midi, correct: true, offset: 0 });

    expect(container.querySelectorAll('g.played-overlay')).toHaveLength(layers.length);
    expect(layers[0]?.querySelectorAll('ellipse.played-note')).toHaveLength(2);
  });

  it('places marks along the page, one step after another', () => {
    renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });
    renderer.showPlayed({ stepIndex: 1, midi: Pitch.parse('D4').midi, correct: true, offset: 0 });

    const heads = noteheads(container);
    const first = Number.parseFloat(heads[0]?.getAttribute('cx') ?? 'NaN');
    const second = Number.parseFloat(heads[1]?.getAttribute('cx') ?? 'NaN');
    expect(second).toBeGreaterThan(first);
  });

  it('survives being re-engraved, and comes back in the same place', () => {
    renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });
    const before = centreY(noteheads(container)[0]);

    renderer.refresh();

    expect(noteheads(container)).toHaveLength(1);
    expect(centreY(noteheads(container)[0])).toBeCloseTo(before, 6);
  });

  it('keeps its place when the notes are made larger', () => {
    renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });

    renderer.setZoom(1.5);
    renderer.refresh();

    // Zoom shrinks the viewBox rather than moving anything inside it, so the
    // mark keeps the same coordinates and scales with the notation.
    const lines = staffLineYs(container);
    expect(centreY(noteheads(container)[0])).toBeCloseTo((lines[4] ?? 0) + 10, 6);
  });

  it('wipes every mark on demand', () => {
    renderer.showPlayed({ stepIndex: 0, midi: 60, correct: true, offset: 0 });
    renderer.showPlayed({ stepIndex: 1, midi: 62, correct: false, offset: 0 });

    renderer.clearPlayed();

    expect(noteheads(container)).toHaveLength(0);
  });

  describe('room made for the beat', () => {
    /** How many places the engraver's own cursor will stop at. */
    function cursorStops(): number {
      const inner = renderer as unknown as {
        osmd: { cursor: { reset: () => void; next: () => void; iterator: { EndReached: boolean } } };
      };
      const cursor = inner.osmd.cursor;
      cursor.reset();
      let stops = 0;
      let guard = 200;
      while (!cursor.iterator.EndReached && guard > 0) {
        guard -= 1;
        stops += 1;
        cursor.next();
      }
      return stops;
    }

    it('costs the marker nothing, which is the invariant it must not break', async () => {
      // The ruler asks for room in every bar - rests nobody sees, at the beat
      // - so the beats stand at even distances across it. Those rests are
      // events, and an event is somewhere a cursor could stop. The marker and
      // the timeline are stepped by one index, so a stop that is not a step
      // would put every note of the piece out by one.
      const exercise = twoBarExercise();
      const plain = buildTimeline(exercise).length;
      expect(cursorStops()).toBe(plain);

      await renderer.load(
        new MusicXmlSerializer().serialize(exercise, { spacersEvery: Duration.QUARTER.ticks }),
      );

      expect(cursorStops()).toBe(plain);
    });

    it('spaces the beats of a bar by their time, near enough', async () => {
      // What the room is *for*. Left to the engraver, a half takes about one
      // and a half times a quarter's width where its length asks for two -
      // which is why the beats of a bar do not fall at even distances, and
      // why a ruler drawn over them looked crooked.
      const uneven: Exercise = {
        ...twoBarExercise(),
        staves: twoBarExercise().staves.map((staff, at) => ({
          ...staff,
          measures: [
            bar(
              noteEntry(p(at === 0 ? 'C4' : 'C3'), Duration.HALF),
              noteEntry(p(at === 0 ? 'D4' : 'D3'), Duration.QUARTER),
              noteEntry(p(at === 0 ? 'E4' : 'E3'), Duration.QUARTER),
            ),
            bar(noteEntry(p(at === 0 ? 'G4' : 'G3'), Duration.WHOLE)),
          ],
        })),
      };
      const serializer = new MusicXmlSerializer();
      const widths = async (xml: string): Promise<number> => {
        await renderer.load(xml);
        const inner = renderer as unknown as { stepX: Map<number, number> };
        const at = [0, 1, 2].map((step) => inner.stepX.get(step) ?? Number.NaN);
        return (at[1]! - at[0]!) / (at[2]! - at[1]!);
      };

      const asWritten = await widths(serializer.serialize(uneven));
      const spaced = await widths(
        serializer.serialize(uneven, { spacersEvery: Duration.QUARTER.ticks }),
      );

      // Time says the half should take twice the room of the quarter.
      expect(asWritten).toBeLessThan(1.7);
      expect(spaced).toBeGreaterThan(1.85);
      expect(spaced).toBeLessThanOrEqual(2.05);
    });

    it('draws them, but with nothing anyone can see', async () => {
      // The engraver has no way to leave them out - drawing hidden notes is
      // "not yet supported", says its own documentation - so it draws them
      // fully transparent, which comes to the same thing.
      await renderer.load(
        new MusicXmlSerializer().serialize(twoBarExercise(), {
          spacersEvery: Duration.QUARTER.ticks,
        }),
      );

      const inked = [...container.querySelectorAll('svg path')].filter(
        (path) => (path.getAttribute('fill') ?? '') !== '#00000000',
      );
      const transparent = [...container.querySelectorAll('svg path')].filter(
        (path) => path.getAttribute('fill') === '#00000000',
      );
      expect(transparent.length).toBeGreaterThan(0);
      expect(inked.length).toBeGreaterThan(transparent.length);
    });
  });

  describe('the ruler through the bars', () => {
    /** Every line of the ruler, left to right. */
    function ruled(): SVGLineElement[] {
      return [...container.querySelectorAll('line.ruler-line')] as SVGLineElement[];
    }

    function xOf(line: SVGLineElement | undefined): number {
      return Number.parseFloat(line?.getAttribute('x1') ?? 'NaN');
    }

    it('stands on the notes the beats are written on', () => {
      // The sharpest thing that can be said about a ruler: the line for a
      // beat and the mark for the note played on that beat are the same
      // place, since a mark is already known to land on its notehead.
      renderer.showRhythmRuler(rulerMarks(buildTimeline(twoBarExercise()), 'quarter'));
      renderer.showPlayed({ stepIndex: 1, midi: Pitch.parse('D4').midi, correct: true, offset: 0 });

      const [head] = noteheads(container);
      expect(xOf(ruled()[1])).toBeCloseTo(Number.parseFloat(head?.getAttribute('cx') ?? 'NaN'), 5);
    });

    it('is drawn behind the music, not over it', () => {
      renderer.showRhythmRuler(rulerMarks(buildTimeline(twoBarExercise()), 'quarter'));

      // First child of the page: an SVG is painted in document order, so the
      // engraver's ink goes over the grid rather than the other way about. A
      // grid that hides a notehead is worse than no grid.
      const sheet = container.querySelector('svg');
      expect(sheet?.firstElementChild?.getAttribute('class')).toBe('rhythm-ruler');
    });

    it('runs across the page in order, and more finely when asked', () => {
      renderer.showRhythmRuler(rulerMarks(buildTimeline(twoBarExercise()), 'quarter'));
      const quarters = ruled().map(xOf);
      expect(quarters.length).toBeGreaterThan(2);
      for (let at = 1; at < quarters.length; at += 1) {
        expect(quarters[at]).toBeGreaterThan(quarters[at - 1] ?? Number.NaN);
      }

      renderer.showRhythmRuler(rulerMarks(buildTimeline(twoBarExercise()), 'eighth'));

      expect(ruled().length).toBeGreaterThan(quarters.length);
    });

    it('stands as tall as the staves it rules, top line to bottom', () => {
      renderer.showRhythmRuler(rulerMarks(buildTimeline(twoBarExercise()), 'quarter'));

      const [line] = ruled();
      const top = Number.parseFloat(line?.getAttribute('y1') ?? 'NaN');
      const bottom = Number.parseFloat(line?.getAttribute('y2') ?? 'NaN');
      // Both staves and the gap between them, which is where a bar line
      // stands - because that is what this is, a bar line for a beat.
      expect(bottom - top).toBeGreaterThan(0);
      const lines = staffLineYs(container);
      expect(top).toBeCloseTo(Math.min(...lines), 1);
      expect(bottom).toBeCloseTo(Math.max(...lines), 1);
    });

    it('stands a marker on one of its lines, and takes it off again', () => {
      const marks = rulerMarks(buildTimeline(twoBarExercise()), 'quarter');
      renderer.showRhythmRuler(marks);

      renderer.showBeat(marks[2] ?? null);

      const [beat] = [...container.querySelectorAll('line.ruler-beat')];
      expect(beat).toBeDefined();
      // On the very line the ruler drew there, and not beside it.
      expect(beat?.getAttribute('x1')).toBe(ruled()[2]?.getAttribute('x1'));

      renderer.showBeat(null);
      expect(container.querySelectorAll('line.ruler-beat')).toHaveLength(0);
    });

    it('takes the ruling away again', () => {
      renderer.showRhythmRuler(rulerMarks(buildTimeline(twoBarExercise()), 'quarter'));
      expect(ruled().length).toBeGreaterThan(0);

      renderer.showRhythmRuler([]);

      expect(ruled()).toEqual([]);
    });
  });

  describe('the marker where the reader keeps missing', () => {
    it('says how much trouble the step is giving, on the page it stands on', () => {
      // Written on the surface and not on the marker: the engraver makes that
      // element, moves it, and replaces it whenever the page is drawn again.
      renderer.showTrouble(2);
      expect(container.dataset['trouble']).toBe('2');

      // And it survives the page being drawn again, which the marker itself
      // would not.
      renderer.refresh();
      expect(container.dataset['trouble']).toBe('2');

      renderer.showTrouble(0);
      expect(container.dataset['trouble']).toBeUndefined();
    });

    it('stops counting where more red would say nothing new', () => {
      renderer.showTrouble(99);
      expect(container.dataset['trouble']).toBe('4');
    });
  });

  describe('dimming what the run will not ask for', () => {
    /** Every note group that is currently dimmed as unplayed. */
    function dimmed(): Element[] {
      return [...container.querySelectorAll('.note--unplayed.vf-stavenote')];
    }

    it('dims nothing until it is told what is being read', () => {
      expect(dimmed()).toHaveLength(0);
    });

    it('dims the hand that is not being read', () => {
      // The fixture is C4 over C3, so one note a step on each staff.
      renderer.dimUnplayed({ staves: [1], from: 0, to: 99 });
      const withoutTheLeft = new Set(dimmed());
      renderer.dimUnplayed({ staves: [2], from: 0, to: 99 });
      const withoutTheRight = new Set(dimmed());

      // Reading one hand dims exactly the other, so the two answers share
      // nothing and between them account for every note on the page.
      expect(withoutTheLeft.size).toBeGreaterThan(0);
      expect(withoutTheRight.size).toBeGreaterThan(0);
      expect([...withoutTheLeft].filter((note) => withoutTheRight.has(note))).toEqual([]);
      expect(withoutTheLeft.size + withoutTheRight.size).toBe(
        container.querySelectorAll('.vf-stavenote').length,
      );
    });

    it('dims the steps outside the passage', () => {
      renderer.dimUnplayed({ staves: [], from: 0, to: 0 });

      // Step 0 is left alone on both hands; everything after it is dimmed.
      expect(dimmed().length).toBeGreaterThan(0);
    });

    it('gives it all back when there is nothing to dim', () => {
      renderer.dimUnplayed({ staves: [1], from: 0, to: 0 });
      expect(dimmed().length).toBeGreaterThan(0);

      renderer.dimUnplayed(null);

      expect(dimmed()).toHaveLength(0);
    });

    it('says nothing about a note already played, which is a different veil', () => {
      // One is "behind you" and goes altogether; the other is "not yours this
      // time" and stays readable. A note can be both.
      renderer.dimUnplayed({ staves: [1], from: 0, to: 99 });
      renderer.fadePassed(0);

      expect(container.querySelectorAll('.note--passed').length).toBeGreaterThan(0);
      expect(dimmed().length).toBeGreaterThan(0);
    });
  });

  it('dims the notes of a step once it is passed, and only those', () => {
    renderer.fadePassed(0);

    const dimmed = [...container.querySelectorAll('.note--passed')];
    // Step 0 of the fixture is C4 over C3: one note on each stave, plus the
    // furniture the engraver drew for them - a stem, a ledger line for middle
    // C - which belongs to those notes and has to leave with them.
    const noteGroups = dimmed.filter((element) =>
      element.classList.contains('vf-stavenote'),
    );
    expect(noteGroups).toHaveLength(2);
    for (const element of dimmed) {
      expect(
        ['vf-stavenote', 'vf-stem', 'vf-ledgers', 'vf-beam'].some((kind) =>
          element.classList.contains(kind),
        ),
      ).toBe(true);
    }
  });

  it('keeps the dimming through a re-engraving', () => {
    renderer.fadePassed(0);
    const before = container.querySelectorAll('.note--passed').length;

    renderer.refresh();

    expect(container.querySelectorAll('.note--passed')).toHaveLength(before);
  });

  it('draws onto the pages the engraver has just made, not the ones it replaced', () => {
    // The pages are remembered between engravings, because finding them is a
    // query over the whole drawing and a mark is drawn for every note the
    // reader plays. Remembering them across a re-engraving instead would
    // draw onto sheets that are no longer on the page - marks that simply
    // never appear.
    renderer.refresh();

    renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });

    const head = noteheads(container)[0];
    expect(head).toBeDefined();
    expect(head?.isConnected).toBe(true);
  });

  it('brings every note back', () => {
    renderer.fadePassed(0);
    renderer.fadePassed(1);

    renderer.clearFaded();

    expect(container.querySelectorAll('.note--passed')).toHaveLength(0);
  });

  describe('the beams over a fading group', () => {
    async function beamed(): Promise<HTMLElement> {
      document.body.replaceChildren();
      const own = createScoreContainer();
      const engraver = new OsmdScoreRenderer(own, { zoom: 1 });
      await engraver.load(new MusicXmlSerializer().serialize(beamedSixteenths()));
      renderer = engraver;
      return own;
    }

    function beamsDimmed(scope: HTMLElement): number {
      return scope.querySelectorAll('g.vf-beam.note--passed').length;
    }

    it('keeps a beam while it still joins a note that is showing', async () => {
      const scope = await beamed();

      renderer.fadePassed(0);
      renderer.fadePassed(1);
      renderer.fadePassed(2);

      // Three of the four sixteenths are gone; the beam still joins the
      // fourth, and a beam that left with the note it starts on would strand
      // the notes it is still holding together.
      expect(beamsDimmed(scope)).toBe(0);
    });

    it('takes the beams once the whole group has gone', async () => {
      const scope = await beamed();

      for (const step of [0, 1, 2, 3]) {
        renderer.fadePassed(step);
      }

      // Two beams for sixteenths: the eighth beam and the sixteenth beam.
      expect(beamsDimmed(scope)).toBe(2);
      // The second group is untouched, so its notes keep theirs.
      expect(scope.querySelectorAll('g.vf-beam')).toHaveLength(4);
    });

    it('leaves nothing of a note behind when it goes', async () => {
      const scope = await beamed();

      renderer.fadePassed(0);

      // The stem stood on alone before, which reads as a sixteenth that lost
      // its flag rather than as a page emptying.
      expect(scope.querySelectorAll('g.vf-stem.note--passed')).toHaveLength(1);
    });

    it('brings the beams back with everything else', async () => {
      const scope = await beamed();
      for (const step of [0, 1, 2, 3]) {
        renderer.fadePassed(step);
      }

      renderer.clearFaded();

      expect(scope.querySelectorAll('.note--passed')).toHaveLength(0);
    });
  });

  describe('the page being re-measured', () => {
    it('does not re-engrave when only the height changed', () => {
      renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });
      const engraved = container.querySelector('svg');

      // iOS collapses its toolbar on every scroll, which changes the window's
      // height. OSMD's own autoResize re-engraved for that and threw the
      // overlay away with the old SVG, so a finished run lost its marks the
      // moment the reader scrolled to look at them.
      renderer.handleContainerResize(container.offsetWidth);

      // The same drawing, not a redrawn one: re-engraving is what costs the
      // marks, so the test has to say it did not happen rather than that they
      // survived - they survive a redraw too.
      expect(container.querySelector('svg')).toBe(engraved);
      expect(noteheads(container)).toHaveLength(1);
    });

    it('re-engraves when the width changed, and redraws what was on it', () => {
      renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });
      renderer.fadePassed(0);

      const engraved = container.querySelector('svg');
      Object.defineProperty(container, 'offsetWidth', { value: 600, configurable: true });
      renderer.handleContainerResize(600);

      expect(container.querySelector('svg')).not.toBe(engraved);

      // Width is the only thing the engraver's decisions depend on, so this
      // one is a real re-engraving - and everything drawn on the old SVG has
      // to arrive on the new one.
      expect(noteheads(container)).toHaveLength(1);
      expect(container.querySelectorAll('.note--passed').length).toBeGreaterThan(0);
    });

    it('ignores a measurement of nothing', () => {
      renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });

      // A container that is display:none measures zero, and re-engraving for
      // that would lay the whole page out for no width at all.
      const engraved = container.querySelector('svg');
      renderer.handleContainerResize(0);

      expect(container.querySelector('svg')).toBe(engraved);
      expect(noteheads(container)).toHaveLength(1);
    });
  });

  it('draws nothing for a step that was never engraved', () => {
    renderer.showPlayed({ stepIndex: 99, midi: 60, correct: false, offset: 0 });
    expect(noteheads(container)).toHaveLength(0);
  });
});

/**
 * The case a two-bar fixture cannot show: a page long enough to be broken
 * into several systems, one under another.
 */
describe('played notes on a page of several systems', () => {
  beforeAll(() => {
    installCanvasStub();
  });

  it('draws a mark on the system its step belongs to', async () => {
    document.body.replaceChildren();
    const container = createScoreContainer(650);
    const renderer = new OsmdScoreRenderer(container, { zoom: 1 });
    const preset = BUILT_IN_PRESETS[0];
    if (preset === undefined) {
      throw new Error('expected a preset');
    }
    const exercise = preset.generator.generate({
      measures: 16,
      timeSignature: new TimeSignature(4, 4),
      key: KeySignature.major(0),
      tempoBpm: 60,
      rhythm: RHYTHMS.get(preset.defaults.rhythmProfileId),
      seed: 7,
    });
    await renderer.load(new MusicXmlSerializer().serialize(exercise));
    renderer.configureOverlay({
      keyAt: () => KeySignature.major(0),
      clefAt: (staffNumber) => CLEFS.get(staffNumber) ?? 'treble',
    });

    const lines = staffLineYs(container);
    const firstSystemBottom = lines[10] ?? 0;
    expect(lines.length).toBeGreaterThan(20);

    renderer.showPlayed({ stepIndex: 0, midi: Pitch.parse('C4').midi, correct: true, offset: 0 });
    const early = centreY(noteheads(container)[0]);
    renderer.clearPlayed();

    renderer.showPlayed({ stepIndex: 40, midi: Pitch.parse('C4').midi, correct: false, offset: 0 });
    const late = centreY(noteheads(container)[0]);

    // A page-wide anchor put every mark in the first system; a late step
    // belongs well below it.
    expect(early).toBeLessThan(firstSystemBottom);
    expect(late).toBeGreaterThan(firstSystemBottom);
  });
});

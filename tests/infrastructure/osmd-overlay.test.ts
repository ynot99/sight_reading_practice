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
import { beamedSixteenths, twoBarExercise } from '../support/fixtures.js';
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

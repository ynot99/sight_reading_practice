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
import { twoBarExercise } from '../support/fixtures.js';
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
    renderer.configureOverlay({ key: KeySignature.major(0), clefAt: (staffNumber) => CLEFS.get(staffNumber) ?? 'treble' });
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

  it('dims the notes of a step once it is passed, and only those', () => {
    renderer.fadePassed(0);

    const dimmed = container.querySelectorAll('.note--passed');
    expect(dimmed.length).toBeGreaterThan(0);
    // Step 0 of the fixture is C4 over C3: one note on each stave.
    expect(dimmed).toHaveLength(2);
  });

  it('keeps the dimming through a re-engraving', () => {
    renderer.fadePassed(0);
    const before = container.querySelectorAll('.note--passed').length;

    renderer.refresh();

    expect(container.querySelectorAll('.note--passed')).toHaveLength(before);
  });

  it('brings every note back', () => {
    renderer.fadePassed(0);
    renderer.fadePassed(1);

    renderer.clearFaded();

    expect(container.querySelectorAll('.note--passed')).toHaveLength(0);
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
    renderer.configureOverlay({ key: KeySignature.major(0), clefAt: (staffNumber) => CLEFS.get(staffNumber) ?? 'treble' });

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

import { DOMParser } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry, restEntry } from '../../src/domain/model/Exercise.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import {
  readThePage,
  type HeadOnThePage,
  type PageLayout,
  type SvgNode,
} from '../../src/infrastructure/rendering/verovio/pageLayout.js';
import { VerovioCore, type PageShape } from '../../src/infrastructure/rendering/verovio/VerovioCore.js';
import { longExercise, p, partialVoiceExercise, twoBarExercise } from '../support/fixtures.js';

/**
 * Pages drawn by Verovio itself, read back. Nothing here is a hand-written
 * SVG: a reading that only fits a made-up page is no reading of Verovio's.
 */
let core: VerovioCore;
beforeAll(async () => {
  core = await VerovioCore.start();
});

const serializer = new MusicXmlSerializer();
const WIDE: PageShape = { pageWidth: 2200, pageHeight: 1400, scale: 50 };

function pagesOf(exercise: Exercise, shape: PageShape = WIDE): PageLayout[] {
  const count = core.load(serializer.serialize(exercise), shape);
  return Array.from({ length: count }, (_, index) => {
    const svg = new DOMParser().parseFromString(core.page(index + 1), 'image/svg+xml');
    return readThePage(svg as unknown as SvgNode);
  });
}

function head(page: PageLayout | undefined, id: string): HeadOnThePage {
  const found = page?.heads.get(id);
  if (found === undefined) {
    throw new Error(`No head named ${id} on the page.`);
  }
  return found;
}

describe('a page Verovio drew, read off the drawing', () => {
  //   treble: C4 D4 E4 F4 | G4 (whole)
  //   bass:   C3 (whole)  | [G2 D3] (half) + half rest
  let page: PageLayout | undefined;
  let system: PageLayout['systems'][number] | undefined;
  let first: PageLayout['systems'][number]['bars'][number] | undefined;
  let second: typeof first;
  beforeAll(() => {
    [page] = pagesOf(twoBarExercise());
    [system] = page?.systems ?? [];
    [first, second] = system?.bars ?? [];
  });

  it('finds every bar by its name, in order', () => {
    expect(page?.systems).toHaveLength(1);
    expect(system?.bars.map((bar) => bar.id)).toEqual(['m0', 'm1']);
  });

  it('stands a system from the top line of its top staff to the bottom line of its lowest', () => {
    expect(system?.top).toBe(first?.staves[0]?.top);
    expect(system?.bottom).toBe(first?.staves[1]?.bottom);
  });

  it('measures a bar barline to barline, and one bar begins where the last ended', () => {
    expect(first?.left).toBeLessThan(first?.right ?? 0);
    expect(second?.left).toBe(first?.right);
  });

  it('reads each staff as its five lines, evenly spaced, the treble above the bass', () => {
    for (const bar of [first, second]) {
      expect(bar?.staves).toHaveLength(2);
      for (const staff of bar?.staves ?? []) {
        const gaps = staff.lines.slice(1).map((line, index) => line - (staff.lines[index] ?? 0));
        expect(staff.lines).toHaveLength(5);
        expect(new Set(gaps).size).toBe(1);
        expect(staff.top).toBe(staff.lines[0]);
        expect(staff.bottom).toBe(staff.lines[4]);
      }
      expect(bar?.staves[0]?.bottom).toBeLessThan(bar?.staves[1]?.top ?? 0);
    }
  });

  it('stands each head at its pitch against those lines', () => {
    // E4 sits on the treble's bottom line, F4 in the space above it, D4 in the
    // space below and C4 on a ledger line of its own - where the played notes
    // will be drawn against the same lines.
    const treble = first?.staves[0];
    const gap = ((treble?.bottom ?? 0) - (treble?.top ?? 0)) / 4;

    expect(head(page, 'n0-1-2-0').y).toBe(treble?.bottom);
    expect(head(page, 'n0-1-3-0').y).toBe((treble?.bottom ?? 0) - gap / 2);
    expect(head(page, 'n0-1-1-0').y).toBe((treble?.bottom ?? 0) + gap / 2);
    expect(head(page, 'n0-1-0-0').y).toBe((treble?.bottom ?? 0) + gap);
  });

  it('stands the heads of a bar inside it, in the order they are played', () => {
    const xs = ['n0-1-0-0', 'n0-1-1-0', 'n0-1-2-0', 'n0-1-3-0'].map((id) => head(page, id).x);

    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(4);
    for (const x of xs) {
      expect(x).toBeGreaterThan(first?.left ?? Infinity);
      expect(x).toBeLessThan(first?.right ?? -Infinity);
    }
  });

  it('gives a chord one place across and a rest a place of its own', () => {
    expect(head(page, 'n1-2-0-0').x).toBe(head(page, 'n1-2-0-1').x);
    expect(head(page, 'n1-2-0-0').y).toBeGreaterThan(head(page, 'n1-2-0-1').y);
    const rest = head(page, 'r1-2-1');
    expect(rest.x).toBeGreaterThan(head(page, 'n1-2-0-0').x);
    expect(rest.x).toBeLessThan(second?.right ?? -Infinity);
  });

  it('is measured in the page’s own units, the size of the page Verovio was asked for', () => {
    expect((page?.width ?? 0) / (page?.height ?? 1)).toBeCloseTo(2200 / 1400, 5);
  });
});

describe('what a page does not draw, or draws small', () => {
  it('gives a rest nobody draws no place, and the notes around it theirs', () => {
    //   voice 2: (silence) G3 (silence)
    const [page] = pagesOf(partialVoiceExercise());

    expect(page?.heads.has('r0-2-0')).toBe(false);
    expect(page?.heads.has('r0-2-2')).toBe(false);
    expect(page?.heads.has('n0-2-1-0')).toBe(true);
  });

  it('stands a head where the head is, not where its accidental is', () => {
    // The sharp is drawn to the left of the note it belongs to, inside the
    // note's own drawing; taken for the head, the note would stand a sharp's
    // width early.
    const [page] = pagesOf(partialVoiceExercise([noteEntry([p('C4'), p('F#4')], Duration.WHOLE)]));

    expect(head(page, 'n0-2-0-1').x).toBe(head(page, 'n0-2-0-0').x);
  });

  it('gives a rest that fills its bar a place too', () => {
    const [page] = pagesOf(partialVoiceExercise([restEntry(Duration.WHOLE)]));

    expect(page?.heads.has('r0-2-0')).toBe(true);
  });

  it('stands a grace note before the note it leans on', () => {
    const leaning = noteEntry(p('C5'), Duration.HALF, [], [], null, false, {
      graces: [{ pitches: [p('D5')], duration: Duration.EIGHTH, slashed: true }],
    });
    const [page] = pagesOf(partialVoiceExercise([noteEntry(p('G3'), Duration.HALF), leaning]));

    expect(head(page, 'g0-2-1-0-0').x).toBeLessThan(head(page, 'n0-2-1-0').x);
  });
});

describe('a page of several systems', () => {
  let pages: PageLayout[] = [];
  let page: PageLayout | undefined;
  beforeAll(() => {
    pages = pagesOf(longExercise({ bars: 40 }), { pageWidth: 1400, pageHeight: 1400, scale: 50 });
    [page] = pages;
  });

  it('reads the systems from the top of the page down', () => {
    const systems = page?.systems ?? [];

    expect(systems.length).toBeGreaterThan(1);
    for (let index = 1; index < systems.length; index += 1) {
      expect(systems[index - 1]?.bottom).toBeLessThan(systems[index]?.top ?? 0);
    }
  });

  it('holds every bar of the score once, in order, across the systems and the pages', () => {
    const ids = pages.flatMap((each) => each.systems.flatMap((system) => system.bars.map((bar) => bar.id)));

    expect(ids).toEqual(Array.from({ length: 40 }, (_, index) => `m${String(index)}`));
  });

  it('runs each system edge to edge, every bar beginning where the one before it ended', () => {
    // What a bracket round a passage is drawn along; a gap between two bars
    // would be a bracket broken where no bar ends.
    for (const system of page?.systems ?? []) {
      for (let index = 1; index < system.bars.length; index += 1) {
        expect(system.bars[index]?.left).toBe(system.bars[index - 1]?.right);
      }
    }
  });
});

describe('the page’s margin', () => {
  it('is added to everything on the page, lines and heads alike', () => {
    // Made by hand, as Verovio nests it, so the margin can be told apart from
    // everything else a real page moves by.
    const svg = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
        '<svg class="definition-scale" viewBox="0 0 1000 800">' +
        '<g class="page-margin" transform="translate(50, 30)">' +
        '<g class="system"><g id="m0" class="measure"><g class="staff">' +
        '<path d="M10 100 L200 100"/><path d="M10 110 L200 110"/><path d="M10 120 L200 120"/>' +
        '<path d="M10 130 L200 130"/><path d="M10 140 L200 140"/>' +
        '<g class="layer"><g id="n0-1-0-0" class="note"><g class="notehead">' +
        '<use xlink:href="#E0A4" transform="translate(60, 120) scale(0.72, 0.72)"/>' +
        '</g></g></g></g></g></g></g></svg></svg>',
      'image/svg+xml',
    );

    const page = readThePage(svg as unknown as SvgNode);

    expect(page.systems[0]?.bars[0]).toEqual({
      id: 'm0',
      left: 60,
      right: 250,
      staves: [{ lines: [130, 140, 150, 160, 170], top: 130, bottom: 170 }],
    });
    expect(page.heads.get('n0-1-0-0')).toEqual({ x: 110, y: 150 });
    expect([page.width, page.height]).toEqual([1000, 800]);
  });
});

describe('what is not a page Verovio drew', () => {
  it('says so when the music has no size', () => {
    const svg = new DOMParser().parseFromString(
      '<svg xmlns="http://www.w3.org/2000/svg"><svg class="definition-scale"><g/></svg></svg>',
      'image/svg+xml',
    );

    expect(() => readThePage(svg as unknown as SvgNode)).toThrow(/has no size/);
  });

  it('says so when there is no music in it', () => {
    const svg = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>', 'image/svg+xml');

    expect(() => readThePage(svg as unknown as SvgNode)).toThrow(/no drawing of the music/);
  });
});

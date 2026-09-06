// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import { twoBarExercise } from '../support/fixtures.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { createScoreContainer, installCanvasStub } from '../support/osmdHarness.js';

/** One line swelling while another fades, both under the same staff. */
function twoHairpins(upper: 'above' | 'below'): Exercise {
  return {
    ...twoBarExercise(),
    hairpins: [
      {
        measureIndex: 0,
        offsetTicks: 0,
        kind: 'crescendo',
        untilMeasureIndex: 1,
        untilOffsetTicks: 0,
        staffNumber: 1,
        placement: upper,
      },
      {
        measureIndex: 0,
        offsetTicks: 0,
        kind: 'diminuendo',
        untilMeasureIndex: 1,
        untilOffsetTicks: 0,
        staffNumber: 1,
        placement: 'below',
      },
    ],
  };
}

/** Every straight line drawn on the page, from the ink rather than the model. */
function lines(container: HTMLElement): readonly { x: number; y: number; toX: number; toY: number }[] {
  const drawn: { x: number; y: number; toX: number; toY: number }[] = [];
  for (const path of container.querySelectorAll('path')) {
    const said = /^M([\d.]+) ([\d.]+)L([\d.]+) ([\d.]+)$/.exec(path.getAttribute('d') ?? '');
    if (said !== null) {
      drawn.push({ x: Number(said[1]), y: Number(said[2]), toX: Number(said[3]), toY: Number(said[4]) });
    }
  }
  return drawn;
}

/**
 * A hairpin's arms are the only slanted straight lines an engraver draws.
 *
 * Level rules out the staff lines, upright rules out the stems, and what is
 * left on a page of plain quarter notes is the wedges.
 */
function slanted(container: HTMLElement): readonly number[] {
  return lines(container)
    .filter((line) => line.y !== line.toY && line.x !== line.toX)
    .map((line) => Math.min(line.y, line.toY));
}

/** The top line of the first staff, which is the highest level line on the page. */
function topOfTheStaff(container: HTMLElement): number {
  return Math.min(...lines(container).filter((line) => line.y === line.toY).map((line) => line.y));
}

describe('two hairpins under one staff', () => {
  beforeAll(() => {
    installCanvasStub();
  });

  async function drawn(upper: 'above' | 'below'): Promise<HTMLElement> {
    document.body.replaceChildren();
    const container = createScoreContainer();
    const renderer = new OsmdScoreRenderer(container, { zoom: 1 });
    await renderer.load(new MusicXmlSerializer().serialize(twoHairpins(upper)));
    return container;
  }

  it('draws the one the writer put above the staff above it', async () => {
    // Measured off the ink: with the side carried, the swelling line is drawn
    // clear of the top staff line and the fading one stays underneath.
    const container = await drawn('above');
    const top = topOfTheStaff(container);
    const arms = slanted(container);

    expect(arms.filter((y) => y < top)).toHaveLength(2);
    expect(arms.filter((y) => y > top)).toHaveLength(2);
  });

  it('draws a crescendo written as a word as that word', async () => {
    // What he sees in his arrangement at bars 188 to 189 and did not see
    // here: the page says `cresc.`, so the page has to say `cresc.`
    const container = await drawn('below');
    const worded = {
      ...twoBarExercise(),
      hairpins: [
        {
          measureIndex: 0,
          offsetTicks: 0,
          kind: 'crescendo' as const,
          untilMeasureIndex: 1,
          untilOffsetTicks: 0,
          staffNumber: 1,
          placement: 'below' as const,
          text: 'cresc.',
        },
      ],
    };
    document.body.replaceChildren();
    const page = createScoreContainer();
    const renderer = new OsmdScoreRenderer(page, { zoom: 1 });
    await renderer.load(new MusicXmlSerializer().serialize(worded));

    const said = [...page.querySelectorAll('text')].map((node) => node.textContent ?? '');

    expect(said).toContain('cresc.');
    // And it is a word instead of a wedge, not as well as one.
    expect(slanted(page).length).toBeLessThan(slanted(container).length);
  });

  it('puts both below the staff where the writer said below', async () => {
    // The state this program was in for every file: nothing is lost, but the
    // second hairpin is pushed further down under the first, and the page
    // stops saying which of the two lines each belongs to.
    const container = await drawn('below');
    const top = topOfTheStaff(container);

    expect(slanted(container).filter((y) => y < top)).toHaveLength(0);
  });
});

import { afterEach, beforeAll, vi } from 'vitest';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { printedAtEachStep, type PrintedStep } from '../../src/domain/notation/printedIds.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { VerovioCore } from '../../src/infrastructure/rendering/verovio/VerovioCore.js';
import { VerovioEngraver } from '../../src/infrastructure/rendering/verovio/VerovioEngraver.js';
import { VerovioScoreRenderer } from '../../src/infrastructure/rendering/verovio/VerovioScoreRenderer.js';
import { lineToThe } from './verovioLine.js';

/**
 * The Verovio renderer on a page jsdom holds, drawn by Verovio itself on this
 * thread.
 *
 * jsdom lays nothing out, so the surface has no size: the renderer lays the
 * music out on the page it uses for a surface not measured yet, 1024 by 768,
 * which is a real page and the same one every time.
 */

export interface Stage {
  readonly renderer: VerovioScoreRenderer;
  readonly engraver: VerovioEngraver;
  readonly surface: HTMLElement;
  readonly scroller: HTMLElement;
}

export interface Printed {
  readonly xml: string;
  readonly steps: readonly PrintedStep[];
}

const serializer = new MusicXmlSerializer();

/** A score as the controller hands it over: the printing, and where each step is on it. */
export function printed(exercise: Exercise): Printed {
  return { xml: serializer.serialize(exercise), steps: printedAtEachStep(buildTimeline(exercise)) };
}

/**
 * How long a test waits on the engraver.
 *
 * Verovio's work is real work: the long fixture takes a second or two of it
 * to lay out again in jsdom, and more with the rest of the suite running
 * beside it. The second `vi.waitFor` allows unless told otherwise is less
 * than one layout, and a test waiting on one failed or passed by the load on
 * the machine.
 */
const ENGRAVER_WAIT_MS = 20_000;

/** Waits until a check holds, allowing the engraver the time its work takes. */
export function whenDrawn(check: () => void): Promise<void> {
  return vi.waitFor(check, { timeout: ENGRAVER_WAIT_MS, interval: 25 });
}

/**
 * Stages for one test file: Verovio started once before its tests, and every
 * stage taken down after each of them.
 *
 * Each test in the file is given room for several layouts, for the reason
 * `whenDrawn` gives.
 */
export function verovioStages(): { readonly aStage: () => Stage } {
  vi.setConfig({ testTimeout: 3 * ENGRAVER_WAIT_MS });
  let core: VerovioCore | null = null;
  const stages: Stage[] = [];
  beforeAll(async () => {
    core = await VerovioCore.start();
  });
  afterEach(() => {
    for (const stage of stages.splice(0)) {
      stage.renderer.dispose();
      stage.scroller.remove();
    }
  });
  return {
    aStage(): Stage {
      if (core === null) {
        throw new Error('Verovio is started before the tests, not while they are collected.');
      }
      const scroller = document.createElement('div');
      scroller.className = 'score__scroll';
      const surface = document.createElement('div');
      surface.className = 'score__surface';
      scroller.append(surface);
      document.body.append(scroller);
      const engraver = new VerovioEngraver(lineToThe(core));
      const stage = { renderer: new VerovioScoreRenderer(surface, engraver), engraver, surface, scroller };
      stages.push(stage);
      return stage;
    },
  };
}

/** The boxes the pages stand in, in order. */
export function sheets(surface: HTMLElement): HTMLElement[] {
  return [...surface.querySelectorAll<HTMLElement>(':scope > .score__page')];
}

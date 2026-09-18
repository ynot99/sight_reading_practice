// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { Duration } from '../../src/domain/model/Duration.js';
import { noteEntry, silenceEntry } from '../../src/domain/model/Exercise.js';
import type { Exercise } from '../../src/domain/model/Exercise.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import { bar, p, partialVoiceExercise } from '../support/fixtures.js';
import { createScoreContainer, installCanvasStub } from '../support/osmdHarness.js';

/**
 * A bar with a moment in it where nothing is drawn.
 *
 *   treble: C4 (half)                 D4 (half)
 *   bass:   G3 (quarter)  (silence)   A3 (half)
 *
 * The bass is silent on the second beat and nothing else starts there, so the
 * only thing at that moment is a rest the page does not print. The engraver's
 * iterator stops on it; its visible cursor does not.
 */
function aMomentOfNothing(): Exercise {
  const base = partialVoiceExercise();
  const [treble, bass] = base.staves;
  if (treble === undefined || bass === undefined) {
    throw new Error('the fixture has two staves');
  }
  return {
    ...base,
    staves: [
      {
        ...treble,
        measures: [bar(noteEntry(p('C4'), Duration.HALF), noteEntry(p('D4'), Duration.HALF))],
      },
      {
        ...bass,
        measures: [
          bar(
            noteEntry(p('G3'), Duration.QUARTER),
            silenceEntry(Duration.QUARTER),
            noteEntry(p('A3'), Duration.HALF),
          ),
        ],
      },
    ],
  };
}

/**
 * Two bars with the moment of nothing in the second.
 *
 *   treble: C4 (half)  D4 (half)  | E4 (half)                F4 (half)
 *   bass:   G3 (half)  A3 (half)  | B3 (quarter) (silence)   C3 (half)
 *
 * Drawn positions at 0, 0.5, 1 and 1.5; the silence at 1.25 is one the
 * engraver's iterator stops on and its cursor does not.
 */
function nothingInTheSecondBar(): Exercise {
  const base = partialVoiceExercise();
  const [treble, bass] = base.staves;
  if (treble === undefined || bass === undefined) {
    throw new Error('the fixture has two staves');
  }
  return {
    ...base,
    staves: [
      {
        ...treble,
        measures: [
          bar(noteEntry(p('C4'), Duration.HALF), noteEntry(p('D4'), Duration.HALF)),
          bar(noteEntry(p('E4'), Duration.HALF), noteEntry(p('F4'), Duration.HALF)),
        ],
      },
      {
        ...bass,
        measures: [
          bar(noteEntry(p('G3'), Duration.HALF), noteEntry(p('A3'), Duration.HALF)),
          bar(
            noteEntry(p('B3'), Duration.QUARTER),
            silenceEntry(Duration.QUARTER),
            noteEntry(p('C3'), Duration.HALF),
          ),
        ],
      },
    ],
  };
}

function engraverOf(renderer: OsmdScoreRenderer): OpenSheetMusicDisplay {
  return (renderer as unknown as { osmd: OpenSheetMusicDisplay }).osmd;
}

function whereTheCursorIs(osmd: OpenSheetMusicDisplay): number {
  return osmd.cursor.iterator.currentTimeStamp.RealValue;
}

describe('walking the cursor without drawing it', () => {
  beforeAll(() => {
    installCanvasStub();
  });

  it('lands exactly where stepping it one drawn step at a time would', async () => {
    // A walk steps the iterator and draws the marker once, at the end. It was
    // first written with the iterator's plain `moveToNext`, which does not skip
    // what is not drawn - and every silence here is a rest the page does not
    // print - so a walk counted positions the marker never stands on and fell
    // short of where it was going. On the device: a start eight hundred bars
    // in put the marker "кудись трішки назад", further back the further in.
    //
    // Only the engraver can answer this. The test double takes the same step
    // both ways, which is the contract and is exactly what was not being kept.
    const renderer = new OsmdScoreRenderer(createScoreContainer(), { zoom: 1 });
    await renderer.load(new MusicXmlSerializer().serialize(aMomentOfNothing()));
    const osmd = engraverOf(renderer);

    renderer.cursor.moveTo(1);
    const walked = whereTheCursorIs(osmd);

    osmd.cursor.reset();
    osmd.cursor.next();
    const stepped = whereTheCursorIs(osmd);

    // The second beat is the silence, and the marker does not stand on it: one
    // drawn step from the top is the second half of the bar.
    expect(stepped).toBe(0.5);
    expect(walked).toBe(stepped);
  });

  it('lands exactly where stepping back one drawn step at a time would', async () => {
    // The walk back steps the iterator and draws once, for the reason the walk
    // forward does - and it has to take the engraver's own step back to do it,
    // or it stops on the silence the marker never stands on.
    const renderer = new OsmdScoreRenderer(createScoreContainer(), { zoom: 1 });
    await renderer.load(new MusicXmlSerializer().serialize(nothingInTheSecondBar()));
    const osmd = engraverOf(renderer);

    renderer.cursor.moveTo(3);
    renderer.cursor.moveTo(2);
    const walked = whereTheCursorIs(osmd);

    osmd.cursor.reset();
    osmd.cursor.next();
    osmd.cursor.next();
    osmd.cursor.next();
    osmd.cursor.previous();
    const stepped = whereTheCursorIs(osmd);

    expect(stepped).toBe(1);
    expect(walked).toBe(stepped);
  });

  it('does not redraw a marker that is already showing where it belongs', async () => {
    // The pulse says where the music is on every tick, several to a note, and
    // the marker is told each time whether or not it moved. The engraver's
    // `show` repaints the marker onto a fresh canvas and encodes it as a PNG,
    // so asking it again of a marker already standing in place cost a long
    // score two thirds of every second of playback, measured with the
    // browser's own profiler on his device.
    const renderer = new OsmdScoreRenderer(createScoreContainer(), { zoom: 1 });
    await renderer.load(new MusicXmlSerializer().serialize(aMomentOfNothing()));
    const osmd = engraverOf(renderer);
    renderer.cursor.show();
    renderer.cursor.moveTo(1);
    // The engraver's own redraw, which it keeps private; counted from outside.
    const cursor = osmd.cursor as unknown as { updateStyle: (...args: unknown[]) => void };
    let redrawn = 0;
    const redraw = cursor.updateStyle.bind(cursor);
    cursor.updateStyle = (...args: unknown[]): void => {
      redrawn += 1;
      redraw(...args);
    };

    // Five ticks inside one note.
    for (let tick = 0; tick < 5; tick += 1) {
      renderer.cursor.moveTo(1);
    }

    expect(redrawn).toBe(0);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import {
  placesToBeginIn,
  walkEveryPlace,
  type WalkableCursor,
} from '../../src/infrastructure/rendering/cursorWalk.js';
import { longExercise } from '../support/fixtures.js';
import { createScoreContainer } from '../support/osmdHarness.js';

/** A cursor over a piece with this many places, or one that never ends. */
function cursorOver(positions: number | 'endless'): WalkableCursor {
  let at = 0;
  return {
    reset: () => {
      at = 0;
    },
    next: () => {
      at += 1;
    },
    iterator: {
      get EndReached() {
        return positions !== 'endless' && at >= positions;
      },
    },
  };
}

describe('walking the cursor from the top to the end', () => {
  it('reaches the end of a piece longer than ten thousand steps', () => {
    // The walk stopped after ten thousand, and the longest score he owns has
    // thirteen and a half thousand steps. Every one after the limit was taken
    // to be on page one: a start at bar a thousand turned him back to the
    // first page, and a playback from there turned the page back on every
    // beat while the music turned it forward, until the tab hung.
    const visited: number[] = [];

    const walked = walkEveryPlace(cursorOver(13_414), 13_416, (index) => visited.push(index));

    expect(walked).toBe(13_414);
    expect(visited).toHaveLength(13_414);
    expect(visited[13_413]).toBe(13_413);
  });

  it('cannot hang the page on a cursor that never reaches its end', () => {
    expect(walkEveryPlace(cursorOver('endless'), 50, () => undefined)).toBe(50);
  });

  it('counts at least as many places as the cursor stops at', async () => {
    // The bound is read off the piece, so it must never be smaller than the
    // walk it bounds - or it is a limit on the piece all over again.
    const exercise = longExercise({ bars: 12 });
    const osmd = new OpenSheetMusicDisplay(createScoreContainer(), { autoResize: false });
    await osmd.load(new MusicXmlSerializer().serialize(exercise));

    expect(placesToBeginIn(osmd.Sheet)).toBeGreaterThanOrEqual(buildTimeline(exercise).length);
  });
});

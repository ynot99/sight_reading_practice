// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { BUILT_IN_PRESETS } from '../../src/domain/generation/presets.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { TimeSignature } from '../../src/domain/model/TimeSignature.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { buildTimeline } from '../../src/domain/timeline/Timeline.js';
import { twoBarExercise } from '../support/fixtures.js';

const serializer = new MusicXmlSerializer();

function createDisplay(): OpenSheetMusicDisplay {
  const container = document.createElement('div');
  document.body.append(container);
  return new OpenSheetMusicDisplay(container, {
    backend: 'svg',
    autoResize: false,
    drawTitle: false,
    drawingParameters: 'compact',
  });
}

/**
 * Contract test between our serializer and the real engraver.
 *
 * Rendering needs layout APIs jsdom does not provide, so this stops at
 * parsing - which is exactly the step that would break if the MusicXML we
 * emit were malformed, mis-ordered or missing required elements.
 */
describe('OSMD accepts the MusicXML we produce', () => {
  beforeAll(() => {
    // OSMD probes for a canvas to measure text; jsdom has no 2D context and
    // logs a warning for every probe. Parsing does not need one.
    HTMLCanvasElement.prototype.getContext = () => null;
  });

  it('parses a grand staff exercise into the expected structure', async () => {
    const exercise = twoBarExercise();
    const osmd = createDisplay();

    await osmd.load(serializer.serialize(exercise));

    const sheet = osmd.Sheet;
    expect(sheet).toBeDefined();
    expect(sheet.SourceMeasures).toHaveLength(2);
    expect(sheet.Instruments[0]?.Staves).toHaveLength(2);
  });

  it('agrees with our timeline on where the cursor can stop', async () => {
    const exercise = twoBarExercise();
    const timeline = buildTimeline(exercise);
    const osmd = createDisplay();

    await osmd.load(serializer.serialize(exercise));

    // Walk OSMD's own iterator and count the positions it visits.
    const iterator = osmd.Sheet.MusicPartManager.getIterator();
    let positions = 0;
    let guard = 100;
    while (!iterator.EndReached && guard > 0) {
      guard -= 1;
      positions += 1;
      iterator.moveToNext();
    }

    expect(positions).toBe(timeline.length);
  });

  it('parses every built-in preset', async () => {
    for (const preset of BUILT_IN_PRESETS) {
      const exercise = preset.generator.generate({
        measures: 4,
        timeSignature: new TimeSignature(3, 4),
        key: KeySignature.major(-2),
        tempoBpm: 80,
        seed: 777,
      });
      const osmd = createDisplay();

      await osmd.load(serializer.serialize(exercise));

      expect(osmd.Sheet.SourceMeasures).toHaveLength(4);
    }
  });
});

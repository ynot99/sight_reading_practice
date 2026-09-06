// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Duration } from '../../src/domain/model/Duration.js';
import { KeySignature } from '../../src/domain/model/KeySignature.js';
import { MusicXmlSerializer } from '../../src/domain/notation/MusicXmlSerializer.js';
import { OsmdScoreRenderer } from '../../src/infrastructure/rendering/OsmdScoreRenderer.js';
import { bar, p, twoBarExercise } from '../support/fixtures.js';
import { noteEntry, type Exercise } from '../../src/domain/model/Exercise.js';
import { createScoreContainer, installCanvasStub } from '../support/osmdHarness.js';

/** High music in bar one, drawn an octave lower under an 8va. */
function underAnOctaveSign(): Exercise {
  const written = twoBarExercise();
  return {
    ...written,
    octaveShifts: [
      {
        measureIndex: 0,
        offsetTicks: 0,
        untilMeasureIndex: 0,
        untilOffsetTicks: Duration.WHOLE.ticks,
        direction: 'down',
        size: 8,
        staffNumber: 1,
      },
    ],
    staves: written.staves.map((staff, at) =>
      at === 0
        ? {
            ...staff,
            measures: [
              bar(
                noteEntry(p('C6'), Duration.QUARTER),
                noteEntry(p('D6'), Duration.QUARTER),
                noteEntry(p('E6'), Duration.QUARTER),
                noteEntry(p('F6'), Duration.QUARTER),
              ),
              staff.measures[1] ?? bar(noteEntry(p('G4'), Duration.WHOLE)),
            ],
          }
        : staff,
    ),
  };
}

describe('music written an octave from where it sounds', () => {
  let container: HTMLElement;
  let renderer: OsmdScoreRenderer;

  beforeAll(() => {
    installCanvasStub();
  });

  beforeEach(async () => {
    document.body.replaceChildren();
    container = createScoreContainer();
    renderer = new OsmdScoreRenderer(container, { zoom: 1 });
    await renderer.load(new MusicXmlSerializer().serialize(underAnOctaveSign()));
    renderer.configureOverlay({
      keyAt: () => KeySignature.major(0),
      clefAt: (staffNumber) => (staffNumber === 1 ? 'treble' : 'bass'),
    });
  });

  it('marks a note where the engraver drew it, not where it sounds', () => {
    // The risk in carrying 8va at all: the pitch in the file is the sounding
    // one, and the engraver draws it an octave away. The marks survive it
    // because the geometry is measured off the drawn notes rather than
    // computed from the pitch - which is the rule this project keeps
    // everywhere, and this is the case that would punish breaking it.
    renderer.showPlayed({ stepIndex: 0, midi: p('C6').midi, correct: true, offset: 0 });

    const mark = container.querySelector('ellipse.played-note');
    const drawn = (renderer as unknown as { samples: readonly { stepIndex: number; y: number }[] })
      .samples.find((sample) => sample.stepIndex === 0);

    expect(mark).not.toBeNull();
    expect(drawn).toBeDefined();
    expect(Number(mark?.getAttribute('cy') ?? NaN)).toBeCloseTo(drawn?.y ?? -1, 0);
  });

  it('leaves a note outside the sign where it always was', () => {
    // A page can hold both, and one fit has to serve them.
    renderer.clearPlayed();
    renderer.showPlayed({ stepIndex: 4, midi: p('G4').midi, correct: true, offset: 0 });

    const mark = container.querySelector('ellipse.played-note');
    const drawn = (renderer as unknown as { samples: readonly { stepIndex: number; y: number }[] })
      .samples.find((sample) => sample.stepIndex === 4);

    expect(Number(mark?.getAttribute('cy') ?? NaN)).toBeCloseTo(drawn?.y ?? -1, 0);
  });
});

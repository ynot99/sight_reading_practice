// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  LEAST_ZOOM,
  MOST_ZOOM,
  drawTheRoll,
  momentsIn,
  rowFromTap,
  stretchesIn,
  theCanvasesOf,
  theSceneOfTheRoll,
  whatThePedalSaysAt,
  whatTheGridSaysAt,
  whatTheRulerSaysAt,
  keepTheHeadInView,
  theRunScrolledUnderTheHead,
  timeFromTap,
  scaledBy,
  pinchedTo,
  LEAST_ROW,
  MOST_ROW,
  theMapOfTheRun,
  theMapOfThePitches,
  thePitchesOfTheRun,
  theSquaresOfTheBar,
  theWindowOnTheRun,
  scrollForTheWindowAt,
  scrollAfterZoom,
  shareOfTheRun,
  zoomFromWheel,
  zoomAfterWheel,
} from '../../src/ui/rollView.js';
import {
  RollRecorder,
  type RolledBeat,
  type RolledPress,
  type RunRoll,
} from '../../src/application/session/RunRoll.js';
function beatOf(atMs: number, weight: BeatWeight, positionTicks: number): RolledBeat {
  return { atMs, weight, positionTicks };
}

import type { BeatWeight } from '../../src/application/ports/IMetronome.js';
import { Duration } from '../../src/domain/model/Duration.js';
import { MIDI } from '../support/fixtures.js';
import { drawTheProfile } from '../../src/ui/profileChart.js';
import type { RollScene } from '../../src/ui/rollView.js';
import type { ProfileAxis } from '../../src/domain/scoring/theProfile.js';

function press(over: Partial<RolledPress> = {}): RolledPress {
  return {
    midi: MIDI.C4,
    downAtMs: 1000,
    upAtMs: 1500,
    velocity: 0.8,
    verdict: 'correct',
    stepIndex: 0,
    deviationMs: null,
    ...over,
  };
}

function roll(over: Partial<RunRoll> = {}): RunRoll {
  return { presses: [], beats: [], pedal: [], rushes: [], truncated: false, ...over };
}

/**
 * A bar of four beats at one second each, at a bar of the music.
 *
 * A second to the quarter, which is sixty to the minute - so the moments and
 * the places in the music stay in step and the drawing has nothing to reconcile.
 */
function barOfFour(measure: number, fromMs: number): RolledBeat[] {
  const bar = Duration.QUARTER.ticks * 4;
  return [0, 1, 2, 3].map((beat) =>
    beatOf(
      fromMs + beat * 1000,
      beat === 0 ? 'downbeat' : 'beat',
      measure * bar + beat * Duration.QUARTER.ticks,
    ),
  );
}

function draw(
  input: RunRoll,
  label: (positionTicks: number) => string | null = (ticks) =>
    ticks % (Duration.QUARTER.ticks * 4) === 0
      ? `${ticks / (Duration.QUARTER.ticks * 4) + 1}`
      : null,
): HTMLElement {
  return drawTheRoll(theSceneOfTheRoll({ roll: input, barLabel: label }));
}

/** What a run is drawn as, with the bars named as `draw` names them. */
function sceneOf(
  input: RunRoll,
  label: (positionTicks: number) => string | null = (ticks) =>
    ticks % (Duration.QUARTER.ticks * 4) === 0
      ? `${ticks / (Duration.QUARTER.ticks * 4) + 1}`
      : null,
): RollScene {
  return theSceneOfTheRoll({ roll: input, barLabel: label });
}

describe('drawing a run as a piano roll', () => {
  it('places a note by when it was struck and let go of', () => {
    // The grid's nought is the first thing that happened, so a run whose first
    // click is at four seconds does not start four seconds of empty grid.
    const scene = sceneOf(
      roll({
        beats: barOfFour(0, 4000),
        presses: [press({ downAtMs: 5000, upAtMs: 5500 })],
      }),
    );

    expect(scene.notes.map(({ fromMs, untilMs }) => [fromMs, untilMs])).toEqual([[1000, 1500]]);
    // And the bar's number with it, at the run's own nought.
    expect(scene.bars).toEqual([{ atMs: 0, name: '1' }]);
  });

  it('runs a key still held to the edge and says that is what it is', () => {
    const scene = sceneOf(
      roll({ beats: barOfFour(0, 0), presses: [press({ downAtMs: 0, upAtMs: null })] }),
    );

    expect(scene.notes[0]?.open).toBe(true);
    // To the last click plus the tail, which is four seconds of bar and one over.
    expect(scene.notes[0]?.untilMs).toBe(4000);
  });

  it('stacks the pitches downwards from the top of the band', () => {
    const scene = sceneOf(
      roll({
        presses: [press({ midi: MIDI.C4 }), press({ midi: MIDI.C4 + 1 })],
      }),
    );

    // Pitch runs downwards, so the semitone above sits exactly one row higher.
    // Both are well inside the band, which has grown around them to the twelve
    // rows a drawing gets however few notes there were.
    expect(scene.notes.map((note) => note.row)).toEqual([6, 5]);
  });

  it('draws a line for a bar and for a beat, and none for a subdivision', () => {
    const scene = sceneOf(
      roll({
        beats: [
          beatOf(0, 'downbeat', Duration.QUARTER.ticks * 0),
          beatOf(250, 'division', Duration.QUARTER.ticks * 0.25),
          beatOf(500, 'beat', Duration.QUARTER.ticks * 0.5),
        ],
      }),
    );

    expect(scene.lines.map((line) => line.kind)).toEqual(['downbeat', 'beat']);
  });

  it('marks the head on the ruler as well as in the grid', () => {
    // His: "на ruler теж додати мітку над курсором". One, and on the ruler,
    // where the head's own line does not reach.
    const view = draw(roll());

    expect(view.querySelectorAll('.roll__head-mark')).toHaveLength(1);
    expect(view.querySelector('.roll__ruler .roll__head-mark')).not.toBeNull();
  });

  it('paints the run rather than laying it out: a canvas each for the ruler, the grid and the pedal', () => {
    // Laid out as an element a mark, five thousand notes took a second to open
    // and most of one to zoom.
    const view = draw(
      roll({ beats: barOfFour(0, 0), presses: [press(), press({ downAtMs: 2000 })] }),
    );

    expect(theCanvasesOf(view)).not.toBeNull();
    expect(view.querySelector('.roll__grid')?.children).toHaveLength(2);
    // And the marks each paint over the one it stands in.
    expect(view.querySelector('.roll__grid > .roll__paint + .roll__head')).not.toBeNull();
    expect(view.querySelector('.roll__ruler > .roll__paint + .roll__head-mark')).not.toBeNull();
  });

  it('draws a bar line the reader gave as theirs', () => {
    // Two lines at one bar line is not a fault to be tidied away; drawing them
    // alike was. The metre's line says where the beat was, this one says where
    // the reader put it.
    const scene = sceneOf(
      roll({
        beats: [
          beatOf(0, 'downbeat', 0),
          beatOf(180, 'downbeat', 0),
        ],
      }),
    );

    expect(scene.lines.map((line) => line.kind)).toEqual(['downbeat', 'given']);
  });

  it('paints the whole wait, from where the beat fell to where it was given', () => {
    // The band rather than its edge: the eye takes a width where it would have
    // to measure a gap.
    const scene = sceneOf(
      roll({
        beats: [
          beatOf(1000, 'downbeat', 0),
          beatOf(1180, 'downbeat', 0),
          beatOf(2000, 'beat', Duration.QUARTER.ticks),
        ],
      }),
    );

    // From the run's own beginning, which is its first event.
    expect(scene.waits).toEqual([{ fromMs: 0, untilMs: 180, says: 'The music waited 180 ms' }]);
  });

  it('paints nothing where every beat fell where it was meant to', () => {
    expect(sceneOf(roll({ beats: barOfFour(0, 0) })).waits).toEqual([]);
  });

  it('names a bar once, at the line that fell due rather than the one given', () => {
    // The number over the grid is the page's, and the page does not move.
    const scene = sceneOf(
      roll({
        beats: [
          beatOf(0, 'downbeat', 0),
          beatOf(180, 'downbeat', 0),
        ],
      }),
      () => '12',
    );

    expect(scene.bars).toEqual([{ atMs: 0, name: '12' }]);
  });

  it('leaves a beat unnamed where the music has no bar line', () => {
    // A beat inside a bar is not a bar, and the ruler says nothing about it.
    const scene = sceneOf(roll({ beats: barOfFour(0, 0) }), (ticks) => (ticks === 0 ? '1' : null));

    expect(scene.bars).toHaveLength(1);
  });

  it('cuts the beat into the parts that were asked for', () => {
    const beats = [
      beatOf(0, 'downbeat', 0),
      beatOf(1000, 'beat', Duration.QUARTER.ticks),
    ];

    expect(sceneOf(roll({ beats })).lines).toHaveLength(2);

    const finer = theSceneOfTheRoll({
      roll: roll({ beats }),
      barLabel: () => null,
      grid: { beats: true, parts: 2 },
    });

    expect(finer.lines).toHaveLength(3);
    expect(finer.lines.filter((line) => line.kind === 'division').map((line) => line.atMs)).toEqual([
      500,
    ]);
  });

  it('draws the bar lines alone where that is all that is wanted', () => {
    // The reading a long run wants: where the bars fell, and nothing else
    // competing for the eye.
    const scene = theSceneOfTheRoll({
      roll: roll({ beats: barOfFour(0, 0) }),
      barLabel: () => null,
      grid: { beats: false, parts: 1 },
    });

    expect(scene.lines).toHaveLength(1);
  });

  it('names each bar once, by what the writer called it', () => {
    // A repeat is written out, so the fifth bar of the playing is not bar five
    // of the page. The drawing asks rather than counts.
    const scene = sceneOf(
      roll({ beats: [...barOfFour(0, 0), ...barOfFour(1, 4000)] }),
      // A namer answers for bar lines and says nothing about anything else.
      (ticks) => {
        if (ticks === 0) {
          return '8';
        }
        return ticks === Duration.QUARTER.ticks * 4 ? '9' : null;
      },
    );

    expect(scene.bars).toEqual([
      { atMs: 0, name: '8' },
      { atMs: 4000, name: '9' },
    ]);
  });

  it('colours a press by the verdict the page was marked with', () => {
    const scene = sceneOf(
      roll({
        presses: [
          press({ midi: MIDI.C4, verdict: 'correct' }),
          press({ midi: MIDI.C4 + 2, verdict: 'wrong' }),
          press({ midi: MIDI.C4 + 5, verdict: 'duplicate' }),
          press({ midi: MIDI.C4 + 7, verdict: null }),
        ],
      }),
    );

    expect(scene.notes.map((note) => note.shade)).toEqual(['correct', 'wrong', 'aside', 'unjudged']);
  });

  it('says nothing about the timing in a note’s colour', () => {
    // The right note is the right note. How far off the beat it came is the
    // band's business, and giving the note its own colour for it made one
    // colour mean three different things.
    const scene = sceneOf(
      roll({
        presses: [
          press({ midi: MIDI.C4, verdict: 'rushed' }),
          press({ midi: MIDI.C4 + 4, verdict: 'late' }),
        ],
      }),
    );

    expect(scene.notes.map((note) => note.shade)).toEqual(['correct', 'correct']);
  });

  it('reddens a beat the reader overtook, and gives it no band', () => {
    // There is no width to draw: the stretch between where they played and
    // where the beat was due is time that never elapsed, the music having moved
    // on when they did. His: "малювати цю ранню вертикальну лінію метроному
    // червоним кольором".
    const scene = sceneOf(
      roll({
        beats: [beatOf(0, 'downbeat', 0), beatOf(1000, 'beat', Duration.QUARTER.ticks)],
        rushes: [{ atMs: 1600, byMs: 400 }],
      }),
    );

    expect(scene.rushes).toEqual([{ atMs: 1600, says: 'Taken 400 ms early' }]);
    expect(scene.waits).toEqual([]);
  });

  it('cuts a note the music asked for where the reader came in early', () => {
    // The beat at the far end is the one they took, so the note ends there
    // rather than running on through music the reader had already left. His:
    // "якщо ghost нота була достатньо довгою - то придеться її розрізати".
    const scene = theSceneOfTheRoll({
      roll: roll({
        beats: [beatOf(0, 'downbeat', 0), beatOf(1600, 'downbeat', Duration.QUARTER.ticks * 4)],
        presses: [press({ downAtMs: 0, upAtMs: 200 })],
      }),
      barLabel: () => null,
      ghosts: [
        { stepIndex: 0, midi: MIDI.C4, fromTicks: 0, untilTicks: Duration.QUARTER.ticks * 4 },
      ],
    });

    // A written bar of it, cut at one and six tenths where he came in.
    expect(scene.ghosts.map(({ fromMs, untilMs }) => [fromMs, untilMs])).toEqual([[0, 1600]]);
  });

  it('says how far off the beat a press was, signed the way a reader falls', () => {
    const scene = sceneOf(roll({ presses: [press({ deviationMs: 42.4 })] }));

    expect(scene.notes[0]?.says).toBe('C4 · correct · +42 ms');
  });

  it('keeps a band of pitches even for a single note', () => {
    // One note drawn as one row is a stripe, not a picture.
    expect(sceneOf(roll({ presses: [press()] })).rows).toBe(12);
    expect(draw(roll({ presses: [press()] })).style.getPropertyValue('--roll-rows')).toBe('12');
  });

  it('clamps the band to what was played, with air above and below', () => {
    // Eighty-eight rows of which sixty are empty puts the music in a tenth of
    // the screen, and the question being asked is about the other axis.
    const scene = sceneOf(roll({ presses: [press({ midi: 48 }), press({ midi: 72 })] }));

    expect(scene.rows).toBe(29);
    expect(scene.highest).toBe(74);
  });

  it('draws the pedal for as long as it was held', () => {
    const scene = sceneOf(
      roll({ beats: barOfFour(0, 0), pedal: [{ downAtMs: 500, upAtMs: 2500 }] }),
    );

    expect(scene.pedal).toEqual([{ fromMs: 500, untilMs: 2500, open: false, says: 'Pedal' }]);
  });

  it('runs a pedal still down to the edge, and says so', () => {
    const scene = sceneOf(
      roll({ beats: barOfFour(0, 0), pedal: [{ downAtMs: 0, upAtMs: null }] }),
    );

    expect(scene.pedal).toEqual([
      { fromMs: 0, untilMs: 4000, open: true, says: 'Pedal, still down' },
    ]);
  });

  it('shades the rows the black keys are on', () => {
    // An octave from C to C has five of them, and the band drawn for one note
    // is an octave.
    const input = roll({ presses: [press({ midi: MIDI.C4 })] });

    // Down from the top of the band, which runs from G3 to F#4: F#, D#, C#,
    // A# and G#.
    expect(sceneOf(input).blackRows).toEqual([0, 3, 5, 8, 10]);
    expect(draw(input).querySelectorAll('.roll__key--black')).toHaveLength(5);
  });

  it('puts every list in the order its marks begin, however they came', () => {
    // So the stretch of a long run on the screen can be found without walking
    // the rest of it.
    const scene = sceneOf(
      roll({
        presses: [press({ downAtMs: 900, upAtMs: 950 }), press({ downAtMs: 100, upAtMs: 150 })],
        pedal: [
          { downAtMs: 700, upAtMs: 800 },
          { downAtMs: 200, upAtMs: 300 },
        ],
      }),
    );

    expect(scene.notes.map((note) => note.fromMs)).toEqual([0, 800]);
    expect(scene.pedal.map((span) => span.fromMs)).toEqual([100, 600]);
  });

  it('draws an empty run without falling over', () => {
    const scene = sceneOf(roll());

    expect(scene.notes).toEqual([]);
    expect(scene.rows).toBe(12);
  });
});

describe('running the music past a standing head', () => {
  it('holds the head where it was asked to stand, wherever the music has got to', () => {
    expect(theRunScrolledUnderTheHead(1_000, 400, 0.15)).toBe(940);
    expect(theRunScrolledUnderTheHead(2_000, 400, 0.15)).toBe(1_940);
  });

  it('stands it anywhere from against the keys to the middle', () => {
    // Nought scrolls the head to the very front of the music; a half leaves
    // as much of what was played behind it as is coming in front.
    expect(theRunScrolledUnderTheHead(1_000, 400, 0)).toBe(1_000);
    expect(theRunScrolledUnderTheHead(1_000, 400, 0.5)).toBe(800);
  });

  it('does not scroll past the front of the drawing', () => {
    // The first seconds of a run are played with the head walking out to
    // where it will stand, because there is nothing behind it to show.
    expect(theRunScrolledUnderTheHead(20, 400, 0.15)).toBe(0);
  });
});

describe('keeping a playback on screen', () => {
  it('leaves the view alone while the head is comfortably inside it', () => {
    // A grid that re-centres on every frame cannot be read.
    expect(keepTheHeadInView(300, 0, 1000)).toBeNull();
  });

  it('moves the view once the head has drifted too far across it', () => {
    // Past three quarters, and then the head lands a quarter of the way in, so
    // most of the width is what is about to be played.
    expect(keepTheHeadInView(800, 0, 1000)).toBe(550);
  });

  it('follows the head back when it is behind the view', () => {
    // Which is what a seek backwards, or a second playback, looks like.
    expect(keepTheHeadInView(200, 1000, 1000)).toBe(0);
  });

  it('does not scroll past the front of the drawing', () => {
    expect(keepTheHeadInView(100, 400, 1000)).toBe(0);
  });

  it('says nothing when there is no view to speak of', () => {
    // Nothing is laid out - a drawing that has not been measured yet, or a
    // test - and there is no inside for the head to be kept in.
    expect(keepTheHeadInView(500, 0, 0)).toBeNull();
  });
});

describe('reading a moment back off the grid', () => {
  it('turns a distance across the grid into a moment in the run', () => {
    // The drawing's whole geometry is the zoom times a number of seconds, so
    // this is that arithmetic run the other way - and it has to be, or the head
    // lands somewhere other than where the finger did.
    expect(timeFromTap(140, 140)).toBe(1000);
    expect(timeFromTap(70, 140)).toBe(500);
  });

  it('never reads a moment before the run began', () => {
    expect(timeFromTap(-50, 140)).toBe(0);
  });

  it('says nothing when nothing has been laid out', () => {
    expect(timeFromTap(100, 0)).toBeNull();
  });
});

describe('the size two fingers ask for', () => {
  it('reads a pinch as a ratio, so the gesture means the same at any size', () => {
    expect(scaledBy(140, 2, LEAST_ZOOM, MOST_ZOOM)).toBe(280);
    expect(scaledBy(280, 0.5, LEAST_ZOOM, MOST_ZOOM)).toBe(140);
  });

  it('answers to the pixel, so the gesture does not move in jumps', () => {
    // It used to snap to the twenty its slider stepped in, which is
    // twenty-ninths of the whole range under a moving hand. The slider steps in
    // ones now instead, so the two still agree. His: "чи можна pinch zoom
    // зробити більш плавним".
    expect(scaledBy(140, 1.07, LEAST_ZOOM, MOST_ZOOM)).toBe(150);
    expect(scaledBy(140, 1.01, LEAST_ZOOM, MOST_ZOOM)).toBe(141);
  });

  it('will not go closer or wider than the drawing allows', () => {
    expect(scaledBy(140, 100, LEAST_ZOOM, MOST_ZOOM)).toBe(MOST_ZOOM);
    expect(scaledBy(140, 0.001, LEAST_ZOOM, MOST_ZOOM)).toBe(LEAST_ZOOM);
  });

  it('leaves the size alone when the fingers say nothing', () => {
    // A gap of nought is two fingers in one place, which is not a pinch.
    expect(scaledBy(140, 0, LEAST_ZOOM, MOST_ZOOM)).toBe(140);
    expect(scaledBy(140, Number.NaN, LEAST_ZOOM, MOST_ZOOM)).toBe(140);
  });

  it('answers each axis from its own span', () => {
    // A pinch across the screen is about how much of the run is on it; one down
    // the page is about how tall the band of pitches is drawn. His: "зробити
    // vertical pinch щоб все зробити менше по висоті".
    const from = { acrossPx: 200, downPx: 200, zoom: 140, row: 13 };

    expect(pinchedTo(from, { acrossPx: 400, downPx: 200 })).toEqual({ zoom: 280, row: 13 });
    expect(pinchedTo(from, { acrossPx: 200, downPx: 100 })).toEqual({ zoom: 140, row: 7 });
    expect(pinchedTo(from, { acrossPx: 400, downPx: 400 })).toEqual({ zoom: 280, row: 26 });
  });

  it('ignores an axis the fingers were never apart along', () => {
    // Two fingers level with each other have a span down the page of a few
    // pixels of wobble, and a ratio taken from it is noise - so a pinch straight
    // across would squash the height by whatever the hand happened to do.
    const from = { acrossPx: 200, downPx: 6, zoom: 140, row: 13 };

    expect(pinchedTo(from, { acrossPx: 400, downPx: 18 })).toEqual({ zoom: 280, row: 13 });
  });

  it('will not squeeze a row past what can be seen', () => {
    const from = { acrossPx: 200, downPx: 200, zoom: 140, row: 13 };

    expect(pinchedTo(from, { acrossPx: 200, downPx: 4 }).row).toBe(LEAST_ROW);
    expect(pinchedTo(from, { acrossPx: 200, downPx: 4_000 }).row).toBe(MOST_ROW);
  });
});

describe('the notes the music asked for', () => {
  const grid = [
    beatOf(0, 'downbeat', 0),
    beatOf(1000, 'beat', Duration.QUARTER.ticks),
  ];
  const spans = (scene: RollScene): number[][] =>
    scene.ghosts.map(({ fromMs, untilMs }) => [fromMs, untilMs]);

  it('places them by the clicks that happened, not by a tempo', () => {
    const scene = theSceneOfTheRoll({
      roll: roll({ beats: grid }),
      barLabel: () => null,
      ghosts: [
        { midi: MIDI.C4, fromTicks: Duration.QUARTER.ticks / 2, untilTicks: Duration.QUARTER.ticks, stepIndex: 0 },
      ],
    });

    expect(spans(scene)).toEqual([[500, 1000]]);
    expect(scene.ghosts[0]?.says).toBe('C4 · asked for here');
  });

  it('keeps a note nobody played inside the band', () => {
    // Which is the one worth seeing: a band drawn round the presses alone would
    // leave a missed note outside the picture altogether.
    const scene = theSceneOfTheRoll({
      roll: roll({ beats: grid, presses: [press({ midi: 60 })] }),
      barLabel: () => null,
      ghosts: [{ midi: 84, fromTicks: 0, untilTicks: Duration.QUARTER.ticks, stepIndex: 0 }],
    });

    expect(scene.ghosts).toHaveLength(1);
    // Twenty-four semitones apart, plus the air above and below.
    expect(scene.rows).toBe(29);
  });

  it('draws none of them past where the run stopped', () => {
    // The picture is of a run. A run that was stopped after two beats asked for
    // nothing beyond them, and the notes of the rest of the piece have no beat
    // here to be placed against - so placing them meant running the last pair
    // of clicks out over the whole score and drawing a canvas of notes nobody
    // played. His: "MIDI viewer наразі малює повний канвас нот, навіть якщо я
    // грав тільки слайс".
    const scene = theSceneOfTheRoll({
      roll: roll({ beats: grid }),
      barLabel: () => null,
      ghosts: [
        { midi: MIDI.C4, fromTicks: 0, untilTicks: Duration.QUARTER.ticks, stepIndex: 0 },
        {
          midi: MIDI.D4,
          fromTicks: Duration.QUARTER.ticks * 200,
          untilTicks: Duration.QUARTER.ticks * 201,
          stepIndex: 200,
        },
      ],
    });

    expect(scene.ghosts).toHaveLength(1);
  });

  it('measures the end of the run from where the run began', () => {
    // A run that began five seconds into the page's own clock is still a run
    // two seconds long. Measured against that clock instead, the notes of the
    // next five seconds of the score would be drawn as though the reader had
    // reached them.
    const scene = theSceneOfTheRoll({
      roll: roll({
        beats: [beatOf(5_000, 'downbeat', 0), beatOf(6_000, 'beat', Duration.QUARTER.ticks)],
      }),
      barLabel: () => null,
      ghosts: [
        { midi: MIDI.C4, fromTicks: 0, untilTicks: Duration.QUARTER.ticks, stepIndex: 0 },
        {
          midi: MIDI.D4,
          fromTicks: Duration.QUARTER.ticks * 3,
          untilTicks: Duration.QUARTER.ticks * 4,
          stepIndex: 3,
        },
      ],
    });

    expect(scene.ghosts).toHaveLength(1);
  });

  it('cuts one the run stopped in the middle of off at the end', () => {
    // A note still being asked for when the reader stopped is part of the run;
    // how much of it there was to play afterwards is not.
    const scene = theSceneOfTheRoll({
      roll: roll({ beats: grid }),
      barLabel: () => null,
      ghosts: [
        {
          midi: MIDI.C4,
          fromTicks: Duration.QUARTER.ticks,
          untilTicks: Duration.QUARTER.ticks * 9,
          stepIndex: 1,
        },
      ],
    });

    // The roll ends a second past its last click, and the outline stops there.
    expect(spans(scene)).toEqual([[1000, 2000]]);
  });

  it('draws none of them where the run had no pulse to place them against', () => {
    const scene = theSceneOfTheRoll({
      roll: roll({ presses: [press()] }),
      barLabel: () => null,
      ghosts: [{ midi: MIDI.C4, fromTicks: 0, untilTicks: Duration.QUARTER.ticks, stepIndex: 0 }],
    });

    expect(scene.ghosts).toEqual([]);
  });

  it('cuts a note off where its beat fell, not where the reader arrived', () => {
    // A note ending on a bar line that waited was drawn on to the end of the
    // wait, which made the yellow band look like part of the note.
    const scene = theSceneOfTheRoll({
      roll: roll({
        beats: [
          beatOf(0, 'downbeat', 0),
          beatOf(1000, 'downbeat', Duration.QUARTER.ticks),
          beatOf(1400, 'downbeat', Duration.QUARTER.ticks),
        ],
      }),
      barLabel: () => null,
      ghosts: [{ midi: MIDI.C4, fromTicks: 0, untilTicks: Duration.QUARTER.ticks, stepIndex: 0 }],
    });

    // One second, which is where the beat fell - not one and four tenths.
    expect(spans(scene)).toEqual([[0, 1000]]);
  });

  it('begins a note on a waited bar line where the reader took it', () => {
    const scene = theSceneOfTheRoll({
      roll: roll({
        beats: [
          beatOf(0, 'downbeat', 0),
          beatOf(1000, 'downbeat', Duration.QUARTER.ticks),
          beatOf(1400, 'downbeat', Duration.QUARTER.ticks),
        ],
      }),
      barLabel: () => null,
      ghosts: [
        {
          midi: MIDI.C4,
          fromTicks: Duration.QUARTER.ticks,
          untilTicks: Duration.QUARTER.ticks * 2,
          stepIndex: 0,
        },
      ],
    });

    expect(scene.ghosts[0]?.fromMs).toBe(1400);
  });

  it('draws none unless they are asked for', () => {
    expect(sceneOf(roll({ beats: grid, presses: [press()] })).ghosts).toEqual([]);
  });
});

describe('how far a note was from where it was owed', () => {
  const grid = [
    beatOf(0, 'downbeat', 0),
    beatOf(1000, 'beat', Duration.QUARTER.ticks),
  ];
  const owed = {
    midi: MIDI.C4,
    fromTicks: 0,
    untilTicks: Duration.QUARTER.ticks,
    stepIndex: 0,
  };

  function drawnWith(pressed: Partial<RolledPress>): RollScene {
    return theSceneOfTheRoll({
      roll: roll({ beats: grid, presses: [press({ midi: MIDI.C4, stepIndex: 0, ...pressed })] }),
      barLabel: () => null,
      ghosts: [owed],
    });
  }

  it('fills the gap where the note came late', () => {
    const [band] = drawnWith({ downAtMs: 300, upAtMs: 800 }).slips;

    expect(band?.kind).toBe('late');
    expect([band?.fromMs, band?.untilMs]).toEqual([0, 300]);
    expect(band?.row).toBe(drawnWith({ downAtMs: 300 }).notes[0]?.row);
    expect(band?.says).toBe('Late by 300 ms');
  });

  it('fills it the other way where the note was rushed', () => {
    // The band reaches back from the note to where it was owed, and says so in
    // the colour this program already uses for a fault.
    const scene = theSceneOfTheRoll({
      roll: roll({
        beats: grid,
        presses: [press({ midi: MIDI.C4, stepIndex: 0, downAtMs: -200, upAtMs: 300 })],
      }),
      barLabel: () => null,
      ghosts: [owed],
    });

    const [band] = scene.slips;
    expect(band?.kind).toBe('rushed');
    expect(band?.says).toBe('Rushed by 200 ms');
  });

  it('grows stronger with the size of the gap, and stops growing', () => {
    // So that "badly rushed" looks worse than "a little early" without a
    // threshold anybody has to agree on.
    const faint = drawnWith({ downAtMs: 60 }).slips[0]?.strength ?? 0;
    const plain = drawnWith({ downAtMs: 200 }).slips[0]?.strength ?? 0;
    const most = drawnWith({ downAtMs: 2_000 }).slips[0]?.strength ?? 0;

    expect(faint).toBeLessThan(plain);
    expect(plain).toBeLessThan(most);
    expect(most).toBe(0.5);
  });

  it('leaves the gaps unfilled where that is not the question', () => {
    // Whether a chord went down together is read off whether the presses line
    // up, and bands lying across them are colour between the eye and that line.
    const scene = theSceneOfTheRoll({
      roll: roll({ beats: grid, presses: [press({ midi: MIDI.C4, stepIndex: 0, downAtMs: 300 })] }),
      barLabel: () => null,
      ghosts: [owed],
      slips: false,
    });

    expect(scene.slips).toEqual([]);
    // And what the question *is* about is still there.
    expect(scene.ghosts).toHaveLength(1);
    expect(scene.notes).toHaveLength(1);
  });

  it('says nothing about a note that was near enough', () => {
    // Every note is off by something; drawn without a floor the whole run is one
    // wash of colour saying nothing about anywhere in particular.
    expect(drawnWith({ downAtMs: 10 }).slips).toEqual([]);
  });

  it('says nothing where the note was never played', () => {
    // The outline says that on its own, and there is no second edge to fill to.
    const scene = theSceneOfTheRoll({
      roll: roll({ beats: grid, presses: [] }),
      barLabel: () => null,
      ghosts: [owed],
    });

    expect(scene.slips).toEqual([]);
    expect(scene.ghosts).toHaveLength(1);
  });

  it('pairs a press with the note it answered, not with the pitch', () => {
    // A piece returns to the same note again and again. Paired by pitch, the
    // second C would be measured against the first C's place in the music.
    const scene = theSceneOfTheRoll({
      roll: roll({
        beats: grid,
        presses: [
          press({ midi: MIDI.C4, stepIndex: 0, downAtMs: 0, upAtMs: 100 }),
          press({ midi: MIDI.C4, stepIndex: 1, downAtMs: 1_300, upAtMs: 1_400 }),
        ],
      }),
      barLabel: () => null,
      ghosts: [
        owed,
        {
          midi: MIDI.C4,
          fromTicks: Duration.QUARTER.ticks,
          untilTicks: Duration.QUARTER.ticks * 2,
          stepIndex: 1,
        },
      ],
    });

    // The first was dead on and says nothing; the second was three tenths late.
    expect(scene.slips.map((band) => band.says)).toEqual(['Late by 300 ms']);
  });
});

describe('the part of a run on the screen', () => {
  const stretch = (fromMs: number, untilMs: number) => ({ fromMs, untilMs, says: null });

  it('finds the marks between two moments, and none of the rest', () => {
    const marks = [0, 1000, 2000, 3000, 4000].map((at) => stretch(at, at + 500));

    expect(stretchesIn(marks, 1800, 3100).map((mark) => mark.fromMs)).toEqual([2000, 3000]);
  });

  it('keeps a long mark begun well before the screen, and still on it', () => {
    // A note held for a minute begins long before the view does. Searched by
    // where marks begin alone, it would be lost.
    const marks = [stretch(0, 60_000), stretch(1_000, 1_200), stretch(30_000, 30_100)];

    expect(stretchesIn(marks, 29_000, 29_500).map((mark) => mark.fromMs)).toEqual([0]);
    expect(stretchesIn(marks, 30_050, 31_000).map((mark) => mark.fromMs)).toEqual([0, 30_000]);
  });

  it('counts a mark that only touches the edge as on it', () => {
    const marks = [stretch(0, 1000), stretch(2000, 3000)];

    expect(stretchesIn(marks, 1000, 2000)).toHaveLength(2);
  });

  it('finds the instants between two moments', () => {
    const lines = [0, 500, 1000, 1500].map((atMs) => ({ atMs, says: null }));

    expect(momentsIn(lines, 400, 1000).map((line) => line.atMs)).toEqual([500, 1000]);
    expect(momentsIn(lines, 1600, 2000)).toEqual([]);
  });
});

describe('what a pointer resting on the drawing is told', () => {
  // A second is 140 pixels, so three pixels either side of a line is about
  // twenty milliseconds.
  const zoom = 140;
  const grid = [beatOf(0, 'downbeat', 0), beatOf(1000, 'beat', Duration.QUARTER.ticks)];

  it('says what a press was, as its element used to', () => {
    const scene = sceneOf(roll({ beats: grid, presses: [press({ deviationMs: -12 })] }));
    const row = scene.notes[0]?.row ?? -1;

    expect(whatTheGridSaysAt(scene, 1200, row, zoom)).toBe('C4 · correct · -12 ms');
    // And nothing a row away, or after the key came up.
    expect(whatTheGridSaysAt(scene, 1200, row + 1, zoom)).toBeNull();
    expect(whatTheGridSaysAt(scene, 1600, row, zoom)).toBeNull();
  });

  it('answers for the press under an outline, and not for the outline', () => {
    // The outline is painted over the press so it can be seen, and must not
    // take the pointer from it: what a finger on a note asks is what it was and
    // how far off the beat it came, which the outline cannot say.
    const scene = theSceneOfTheRoll({
      roll: roll({
        beats: grid,
        presses: [press({ midi: MIDI.C4, stepIndex: 0, downAtMs: 0, upAtMs: 400 })],
      }),
      barLabel: () => null,
      ghosts: [{ midi: MIDI.C4, fromTicks: 0, untilTicks: Duration.QUARTER.ticks, stepIndex: 0 }],
    });
    const row = scene.notes[0]?.row ?? -1;

    expect(whatTheGridSaysAt(scene, 200, row, zoom)).toBe('C4 · correct');
    // Past the press, over the outline alone, there is nothing to say.
    expect(whatTheGridSaysAt(scene, 600, row, zoom)).toBeNull();
  });

  it('says how far off a note came, over the band between', () => {
    const scene = theSceneOfTheRoll({
      roll: roll({ beats: grid, presses: [press({ midi: MIDI.C4, stepIndex: 0, downAtMs: 300 })] }),
      barLabel: () => null,
      ghosts: [{ midi: MIDI.C4, fromTicks: 0, untilTicks: Duration.QUARTER.ticks, stepIndex: 0 }],
    });

    expect(whatTheGridSaysAt(scene, 150, scene.slips[0]?.row ?? -1, zoom)).toBe('Late by 300 ms');
  });

  it('finds a note too short to aim at, as wide as it is drawn', () => {
    const scene = sceneOf(roll({ presses: [press({ downAtMs: 1000, upAtMs: 1000 })] }));
    const row = scene.notes[0]?.row ?? -1;

    // It is drawn two pixels wide, which is fourteen milliseconds here - from
    // the run's nought, the note being all there is of it.
    expect(whatTheGridSaysAt(scene, 10, row, zoom)).not.toBeNull();
    expect(whatTheGridSaysAt(scene, 20, row, zoom)).toBeNull();
  });

  it('finds a line a pointer is near, and says nothing of one that has nothing to say', () => {
    const scene = sceneOf(
      roll({
        beats: [beatOf(0, 'downbeat', 0), beatOf(180, 'downbeat', 0), beatOf(1180, 'beat', Duration.QUARTER.ticks)],
        rushes: [{ atMs: 600, byMs: 250 }],
      }),
    );

    // The bar line given late, within a few pixels of it.
    expect(whatTheGridSaysAt(scene, 195, 0, zoom)).toBe('Given 180 ms late');
    expect(whatTheGridSaysAt(scene, 605, 0, zoom)).toBe('Taken 250 ms early');
    // A plain beat says nothing, and a pointer over the grid near it hears the
    // nothing it says.
    expect(whatTheGridSaysAt(scene, 1181, 0, zoom)).toBeNull();
  });

  it('finds the line that says something, beside one that says nothing', () => {
    // A beat struck ten milliseconds after a bar line given late is within
    // reach of the pointer as well, and is drawn after it.
    const scene = sceneOf(
      roll({
        beats: [beatOf(0, 'downbeat', 0), beatOf(180, 'downbeat', 0), beatOf(190, 'beat', Duration.QUARTER.ticks)],
      }),
    );

    expect(whatTheGridSaysAt(scene, 185, 0, zoom)).toBe('Given 180 ms late');
  });

  it('says how long the music waited, anywhere across the wait', () => {
    const scene = sceneOf(
      roll({ beats: [beatOf(0, 'downbeat', 0), beatOf(900, 'downbeat', 0)] }),
    );

    expect(whatTheGridSaysAt(scene, 450, 3, zoom)).toBe('The music waited 900 ms');
  });

  it('says on the ruler where a bar line was given late, and on the lane where the pedal was', () => {
    const scene = sceneOf(
      roll({
        beats: [beatOf(0, 'downbeat', 0), beatOf(180, 'downbeat', 0)],
        pedal: [{ downAtMs: 500, upAtMs: 900 }],
      }),
    );

    expect(whatTheRulerSaysAt(scene, 182, zoom)).toBe('Given 180 ms late');
    expect(whatTheRulerSaysAt(scene, 90, zoom)).toBeNull();
    expect(whatThePedalSaysAt(scene, 700, zoom)).toBe('Pedal');
    expect(whatThePedalSaysAt(scene, 950, zoom)).toBeNull();
  });

  it('counts rows down from the top of the grid', () => {
    expect(rowFromTap(0, 14)).toBe(0);
    expect(rowFromTap(29, 14)).toBe(2);
    expect(rowFromTap(29, 0)).toBeNull();
  });
});

describe('the whole run on one line', () => {
  /** A run that stood still twice, once briefly and once for a long time. */
  function stoppedTwice(): RunRoll {
    const roller = new RollRecorder();
    roller.beat(0, 'downbeat', 0);
    roller.beat(1_000, 'beat', Duration.QUARTER.ticks);
    // Given late, which is the music standing still: a pair at one place.
    roller.beat(2_000, 'beat', Duration.QUARTER.ticks * 2);
    roller.beat(2_200, 'beat', Duration.QUARTER.ticks * 2);
    roller.beat(3_000, 'beat', Duration.QUARTER.ticks * 3);
    roller.beat(9_000, 'beat', Duration.QUARTER.ticks * 3);
    roller.rushed(9_500, 300);
    return roller.roll();
  }

  it('draws the stops and nothing else', () => {
    // A run of a long piece is thousands of notes and none of them is what a
    // scroll is a search for. His: "звичайним скролингом шукати секції де були
    // великі затупи - це складно".
    const marks = theMapOfTheRun(stoppedTwice());

    expect(marks.map((mark) => mark.kind)).toEqual(['wait', 'wait', 'rush']);
  });

  it('makes the longest stop the widest band, without ranking anything', () => {
    // His: "самі сильні затупи по ідеї вже повинно бути видно на minimap". The
    // run is ten seconds long, so a six-second stop is more than half of it and
    // a fifth of a second is a sliver.
    const marks = theMapOfTheRun(stoppedTwice());
    const [brief, long] = marks;

    expect(brief?.widthShare ?? 1).toBeLessThan(0.05);
    expect(long?.widthShare ?? 0).toBeGreaterThan(0.5);
    expect(long?.fromShare ?? 0).toBeGreaterThan(brief?.fromShare ?? 1);
  });

  it('gives a rush no width, having none', () => {
    const rush = theMapOfTheRun(stoppedTwice()).find((mark) => mark.kind === 'rush');

    expect(rush?.widthShare).toBe(0);
  });

  it('says nothing about a run with no length', () => {
    expect(theMapOfTheRun(new RollRecorder().roll())).toEqual([]);
  });
});

describe('the window on the run', () => {
  it('is the share of the drawing that is on the screen', () => {
    expect(theWindowOnTheRun(0, 400, 2_000)).toEqual({ fromShare: 0, widthShare: 0.2 });
    expect(theWindowOnTheRun(1_000, 400, 2_000)).toEqual({ fromShare: 0.5, widthShare: 0.2 });
  });

  it('stops at the far end rather than hanging off it', () => {
    // A drawing scrolled to its end shows its last screenful, not a window
    // reaching past where the run stops.
    expect(theWindowOnTheRun(1_600, 400, 2_000)).toEqual({ fromShare: 0.8, widthShare: 0.2 });
  });

  it('stays on the strip while the drawing is bounced past its ends', () => {
    // An iPad rubber-bands a scroll past either end and reports where it has
    // been pulled to, so without this the box would be drawn hanging off the
    // side of the map for as long as a flick takes to settle.
    expect(theWindowOnTheRun(1_900, 400, 2_000)).toEqual({ fromShare: 0.8, widthShare: 0.2 });
    expect(theWindowOnTheRun(-200, 400, 2_000)).toEqual({ fromShare: 0, widthShare: 0.2 });
  });

  it('fills itself where the whole run is already on the screen', () => {
    expect(theWindowOnTheRun(0, 2_000, 1_000)).toEqual({ fromShare: 0, widthShare: 1 });
  });

  it('says nothing where nothing has been laid out', () => {
    // jsdom, and a sheet that has not been opened yet. A box claiming to show
    // the whole run at the moment the reader can see none of it is worse than
    // no box.
    expect(theWindowOnTheRun(0, 0, 0)).toBeNull();
    expect(theWindowOnTheRun(0, 400, 0)).toBeNull();
  });

  it('centres the view on the place a finger points at', () => {
    // Started at the finger instead, the thing pointed at would sit against the
    // left edge with the run into it out of sight.
    expect(scrollForTheWindowAt(0.5, 400, 2_000)).toBe(800);
  });

  it('will not scroll past either end for a finger near it', () => {
    expect(scrollForTheWindowAt(0, 400, 2_000)).toBe(0);
    expect(scrollForTheWindowAt(1, 400, 2_000)).toBe(1_600);
  });
});

describe('the notes in view, by pitch', () => {
  /**
   * Two notes two octaves apart at the start, and one near the end.
   *
   * The run is ten and a half seconds long - the last release and a second of
   * air - and the band runs from two below C4 to two above C6, which is 29 rows.
   */
  function spread(): RunRoll {
    return roll({
      presses: [
        press({ midi: MIDI.C4, downAtMs: 0, upAtMs: 500 }),
        press({ midi: MIDI.C4 + 24, downAtMs: 0, upAtMs: 500, verdict: 'wrong' }),
        press({ midi: MIDI.E4, downAtMs: 9_000, upAtMs: 9_500 }),
      ],
    });
  }

  it('marks only the notes in the time on the screen', () => {
    // His: "щоб бачити які наразі ноти out of view". Every pitch of the run
    // would fill the strip and say nothing about the part being looked at.
    const pitches = thePitchesOfTheRun(spread());

    const atTheStart = theMapOfThePitches(pitches, { fromShare: 0, widthShare: 0.1 });
    const atTheEnd = theMapOfThePitches(pitches, { fromShare: 0.8, widthShare: 0.2 });

    // Top of the band first, which is the highest note.
    expect(atTheStart.map((mark) => [mark.kind, mark.fromShare])).toEqual([
      ['wrong', 2 / 29],
      ['correct', 26 / 29],
    ]);
    expect(atTheEnd.map((mark) => [mark.kind, mark.fromShare])).toEqual([['correct', 22 / 29]]);
  });

  it('counts a note still sounding where the screen begins', () => {
    const pitches = thePitchesOfTheRun(
      roll({ presses: [press({ midi: MIDI.C4, downAtMs: 0, upAtMs: 9_000 })] }),
    );

    expect(theMapOfThePitches(pitches, { fromShare: 0.5, widthShare: 0.5 })).toHaveLength(1);
  });

  it('gives each mark one row of the band the drawing draws', () => {
    // The same band, or a mark would stand beside the wrong row. A note nobody
    // played widens it, in the drawing and here alike.
    const run = roll({ beats: barOfFour(0, 0), presses: [press({ midi: 60 })] });
    const ghosts = [{ midi: 84, fromTicks: 0, untilTicks: Duration.QUARTER.ticks, stepIndex: 0 }];
    const view = drawTheRoll(theSceneOfTheRoll({ roll: run, barLabel: () => null, ghosts }));

    const pitches = thePitchesOfTheRun(run, ghosts);
    const marks = theMapOfThePitches(pitches, { fromShare: 0, widthShare: 1 });

    expect(String(pitches.rows)).toBe(view.style.getPropertyValue('--roll-rows'));
    expect(marks.map((mark) => mark.heightShare)).toEqual([1 / 29, 1 / 29]);
  });

  it('puts the wrong note on a row over the right one, whichever came first', () => {
    // The one worth scrolling to.
    const both = (first: RolledPress['verdict'], second: RolledPress['verdict']): string[] =>
      theMapOfThePitches(
        thePitchesOfTheRun(
          roll({
            presses: [
              press({ downAtMs: 0, upAtMs: 100, verdict: first }),
              press({ downAtMs: 200, upAtMs: 300, verdict: second }),
            ],
          }),
        ),
        { fromShare: 0, widthShare: 1 },
      ).map((mark) => mark.kind);

    expect(both('wrong', 'correct')).toEqual(['wrong']);
    expect(both('correct', 'wrong')).toEqual(['wrong']);
    // And a note played right over one nothing was said about.
    expect(both('correct', 'duplicate')).toEqual(['correct']);
  });

  it('colours a mark as the drawing colours its note', () => {
    const kindOf = (verdict: RolledPress['verdict']): string | undefined =>
      theMapOfThePitches(thePitchesOfTheRun(roll({ presses: [press({ verdict })] })), {
        fromShare: 0,
        widthShare: 1,
      })[0]?.kind;

    // Late is still the right note: when it came is the band's business.
    expect(kindOf('late')).toBe('correct');
    expect(kindOf('duplicate')).toBe('plain');
    expect(kindOf(null)).toBe('plain');
  });

  it('marks the notes asked for where the drawing draws them, and none past the run', () => {
    const run = roll({ beats: barOfFour(0, 0) });
    const pitches = thePitchesOfTheRun(run, [
      { midi: MIDI.C4, fromTicks: 0, untilTicks: Duration.QUARTER.ticks, stepIndex: 0 },
      {
        midi: MIDI.D4,
        fromTicks: Duration.QUARTER.ticks * 200,
        untilTicks: Duration.QUARTER.ticks * 201,
        stepIndex: 200,
      },
    ]);

    const marks = theMapOfThePitches(pitches, { fromShare: 0, widthShare: 1 });

    expect(marks.map((mark) => mark.kind)).toEqual(['plain']);
  });
});

describe('where a moment of the run falls on the map', () => {
  it('is its share of the whole, so the marks and the marker agree', () => {
    const roller = new RollRecorder();
    roller.beat(0, 'downbeat', 0);
    roller.beat(3_000, 'beat', Duration.QUARTER.ticks);
    // A second of air past the last click, which is where the roll stops.
    const roll = roller.roll();

    expect(shareOfTheRun(roll, 0)).toBe(0);
    expect(shareOfTheRun(roll, 2_000)).toBeCloseTo(0.5, 10);
    expect(shareOfTheRun(roll, 4_000)).toBe(1);
  });

  it('counts from where the run began, not from the page’s own clock', () => {
    // A run begun three seconds into the page's clock is still a run three
    // seconds long, and its middle is its own middle.
    const roller = new RollRecorder();
    roller.beat(1_000, 'downbeat', 0);
    roller.beat(3_000, 'beat', Duration.QUARTER.ticks);
    const roll = roller.roll();

    expect(shareOfTheRun(roll, 2_500)).toBeCloseTo(0.5, 10);
  });

  it('holds a moment outside the run to the end it lies past', () => {
    const roller = new RollRecorder();
    roller.beat(1_000, 'downbeat', 0);
    roller.beat(2_000, 'beat', Duration.QUARTER.ticks);
    const roll = roller.roll();

    expect(shareOfTheRun(roll, 0)).toBe(0);
    expect(shareOfTheRun(roll, 90_000)).toBe(1);
  });

  it('has a whole to be a share of even where nothing was played', () => {
    // A roll ends a moment past its last event, so one with nothing in it is
    // still a second of air long and there is nothing to divide by nought.
    expect(shareOfTheRun(new RollRecorder().roll(), 0)).toBe(0);
    expect(shareOfTheRun(new RollRecorder().roll(), 90_000)).toBe(1);
  });
});

describe('a zoom held around a point', () => {
  it('keeps the moment under a finger under it', () => {
    // Point at the bar that went wrong, zoom in, and the bar has to stay where
    // the finger is - otherwise every turn of the wheel is followed by hunting
    // for the place again.
    const held = scrollAfterZoom(1_000, 200, 2_000, 4_000);

    // The finger stood over three fifths of the run; it still does.
    expect((held + 200) / 4_000).toBeCloseTo((1_000 + 200) / 2_000, 10);
  });

  it('will not scroll behind the beginning to hold one', () => {
    // Zooming out near the top: there is no run in front of the first note to
    // put under the finger, so the drawing stops at its own beginning.
    expect(scrollAfterZoom(100, 200, 2_000, 400)).toBe(0);
  });

  it('leaves a drawing of no width where it is', () => {
    expect(scrollAfterZoom(50, 200, 0, 400)).toBe(50);
  });
});

describe('the zoom a wheel asks for', () => {
  it('reads a turn as a step, whichever way it went', () => {
    expect(zoomFromWheel(-100)).toBeGreaterThan(1);
    expect(zoomFromWheel(100)).toBeLessThan(1);
    expect(zoomFromWheel(0)).toBe(1);
  });

  it('undoes a turn with a turn back', () => {
    // Added rather than grown, in and then out by the same step lands a little
    // below where it started, and a reader rocking the wheel to settle on a
    // size drifts downwards the whole time.
    expect(zoomFromWheel(-100) * zoomFromWheel(100)).toBeCloseTo(1, 10);
  });

  it('holds a flick to a step a notch can reach', () => {
    // A wheel notch and a trackpad flick arrive as tens against ones, and a
    // zoom taken straight from either jumps. His: "цей зум дуже не responsive,
    // та є відчуття буд-то він тормозить".
    const flick = zoomFromWheel(-4_000);

    expect(flick).toBeLessThan(1.2);
    expect(flick).toBeGreaterThan(zoomFromWheel(-100));
  });

  it('moves by a pixel at the least, however fine the message', () => {
    // A trackpad's finest message asks for a fraction of a pixel, and rounded
    // to the nearest that is no change - so the gesture would do nothing at all
    // rather than a little.
    expect(zoomAfterWheel(40, -1, LEAST_ZOOM, MOST_ZOOM)).toBe(41);
    expect(zoomAfterWheel(41, 1, LEAST_ZOOM, MOST_ZOOM)).toBe(40);
  });

  it('stands still where the wheel said nothing', () => {
    expect(zoomAfterWheel(140, 0, LEAST_ZOOM, MOST_ZOOM)).toBe(140);
  });

  it('will not go closer or wider than the drawing allows', () => {
    expect(zoomAfterWheel(LEAST_ZOOM, 4_000, LEAST_ZOOM, MOST_ZOOM)).toBe(LEAST_ZOOM);
    expect(zoomAfterWheel(MOST_ZOOM, -4_000, LEAST_ZOOM, MOST_ZOOM)).toBe(MOST_ZOOM);
  });
});

describe('the bar as a row of squares', () => {
  /** Two bars of four at sixty: a click a second, a bar every four. */
  function twoBarsOfFour(): RunRoll {
    const roller = new RollRecorder();
    const quarter = Duration.QUARTER.ticks;
    for (let click = 0; click < 8; click += 1) {
      roller.beat(click * 1_000, click % 4 === 0 ? 'downbeat' : 'beat', click * quarter);
    }
    return roller.roll();
  }

  it('holds as many squares as the metre says, not as many as were played', () => {
    // A run stopped after one note still stopped inside a bar of four, and a
    // row of one square would be counting what was played rather than what was
    // written. Where the bar *began* is the run's answer, because that is a
    // moment; how long it is, is the metre's.
    const oneNote = new RollRecorder();
    oneNote.beat(0, 'downbeat', 0);

    expect(theSquaresOfTheBar(twoBarsOfFour(), 0, 1_000, 4)?.of).toBe(4);
    expect(theSquaresOfTheBar(oneNote.roll(), 0, 1_000, 4)?.of).toBe(4);
  });

  it('refuses a bar of no clicks', () => {
    expect(theSquaresOfTheBar(twoBarsOfFour(), 0, 1_000, 0)).toBeNull();
  });

  it('fills one the moment the bar begins', () => {
    // The downbeat is a click like any other, so a bar of four opens with one
    // of its four already gone rather than with none.
    expect(theSquaresOfTheBar(twoBarsOfFour(), 0, 1_000, 4)?.filled).toBe(1);
  });

  it('counts in written time, not in the time the reader took', () => {
    // Which is the whole of what it is for: the drawing is the reader's own
    // time and stretches wherever they waited, so a row counting strictly
    // beside it makes the gap between the two visible. His: "статичний
    // метроном який не йде за затримками".
    const roll = twoBarsOfFour();

    expect(theSquaresOfTheBar(roll, 2_500, 1_000, 4)?.filled).toBe(3);
    expect(theSquaresOfTheBar(roll, 3_900, 1_000, 4)?.filled).toBe(4);
  });

  it('starts counting again at every bar line', () => {
    // His own second answer: "збивався кожного бару (починався з сильної
    // долі)". Counted on from the top of a piece it would be a bar out by the
    // middle and would say nothing about the bar in front of the reader.
    const roll = twoBarsOfFour();

    expect(theSquaresOfTheBar(roll, 4_000, 1_000, 4)?.filled).toBe(1);
    expect(theSquaresOfTheBar(roll, 6_200, 1_000, 4)?.filled).toBe(3);
  });

  it('says so once strict time has left the bar behind', () => {
    // A click over is a whole click late, which is the thing worth seeing
    // rather than the fractions before it. His: "якщо був зайвий вже клік - то
    // всі квадратики замальовуються червоним кольором".
    const roll = twoBarsOfFour();

    expect(theSquaresOfTheBar(roll, 3_999, 1_000, 4)?.overflowed).toBe(false);
    // The reader is still inside the first bar of the drawing, and the
    // metronome has gone into the next one.
    const late = theSquaresOfTheBar({ ...roll, beats: roll.beats.slice(0, 4) }, 4_500, 1_000, 4);
    expect(late?.overflowed).toBe(true);
    // And every square is filled, so the red has something to colour.
    expect(late?.filled).toBe(late?.of);
  });

  it('counts from the run’s own beginning, like everything else drawn', () => {
    // The marker is a place *in the drawing*: a tap and the playback both give
    // it as a distance from the run's left edge, and every other thing laid
    // against it - the head, the map, the notes - is measured the same way. Told
    // the beats' own moments instead, a run that began a few seconds into the
    // page's clock showed no squares at all until the playback had run that far.
    // His: "вони не з'являються на початку MIDI viewer playback".
    const roller = new RollRecorder();
    const quarter = Duration.QUARTER.ticks;
    for (let click = 0; click < 4; click += 1) {
      roller.beat(45_000 + click * 1_000, click === 0 ? 'downbeat' : 'beat', click * quarter);
    }
    const late = roller.roll();

    // The head at the very start of the run, which is where a playback opens.
    expect(theSquaresOfTheBar(late, 0, 1_000, 4)?.filled).toBe(1);
    expect(theSquaresOfTheBar(late, 2_500, 1_000, 4)?.filled).toBe(3);
  });

  it('says nothing where no bar line has been passed', () => {
    // Which needs something in front of the first one: the run begins at the
    // earliest thing that happened in it, so a bar line reached first *is* the
    // beginning. A note struck over the count-in is the ordinary way that
    // happens - it is in the picture, and the bar it belongs to has not begun.
    const roller = new RollRecorder();
    roller.keyDown({
      type: 'noteon',
      midi: MIDI.C4,
      velocity: 0.8,
      timestampMs: 0,
      sourceId: 'test',
    });
    roller.beat(5_000, 'downbeat', 0);

    expect(theSquaresOfTheBar(roller.roll(), 1_000, 1_000, 4)).toBeNull();
    // And once it has, they are counted from it.
    expect(theSquaresOfTheBar(roller.roll(), 5_200, 1_000, 4)?.filled).toBe(1);
  });

  it('says nothing about free playing', () => {
    // A recording has no bar lines, because nothing was keeping its time.
    expect(theSquaresOfTheBar(new RollRecorder().roll(), 0, 1_000, 4)).toBeNull();
  });

  it('refuses a click of no length', () => {
    expect(theSquaresOfTheBar(twoBarsOfFour(), 0, 0, 4)).toBeNull();
  });
});

describe('the shape a reading is drawn as', () => {
  function axesOf(count: number): ProfileAxis[] {
    return Array.from({ length: count }, (_unused, at) => ({
      name: `Axis ${at + 1}`,
      of: 0.5,
      said: 'something',
    }));
  }

  it('draws as many corners as it is given, whatever the number', () => {
    // The count decides the angle and nothing else, so there is no version of
    // this written for four. His: "якщо ми захочемо додати ще одну точку, або
    // мати динамічну кількість точок".
    for (const count of [3, 4, 5, 8]) {
      const shape = drawTheProfile(axesOf(count)).querySelector('.profile__shape');
      expect(shape?.getAttribute('points')?.split(' '), `${count} axes`).toHaveLength(count);
      expect(
        drawTheProfile(axesOf(count)).querySelectorAll('.profile__spoke'),
        `${count} spokes`,
      ).toHaveLength(count);
    }
  });

  it('names every axis on the page, not only in the shape', () => {
    const names = [...drawTheProfile(axesOf(5)).querySelectorAll('.profile__name')].map(
      (node) => node.textContent,
    );

    expect(names).toEqual(['Axis 1', 'Axis 2', 'Axis 3', 'Axis 4', 'Axis 5']);
  });

  it('lays a name against its spoke by where the spoke points', () => {
    // Which is the whole of what keeps the names apart as the axes multiply:
    // left to one anchor they pile up either side of the vertical.
    const drawn = [...drawTheProfile(axesOf(4)).querySelectorAll('.profile__name')];

    // Top, right, bottom, left.
    expect(drawn.map((node) => node.getAttribute('text-anchor'))).toEqual([
      'middle',
      'start',
      'middle',
      'end',
    ]);
  });

  it('draws no shape where there is no shape to draw', () => {
    // Two axes are a line and one is a dot; neither says anything about a
    // reading, and drawing something anyway would be a picture of nothing.
    expect(drawTheProfile(axesOf(2)).querySelector('.profile__shape')).toBeNull();
    expect(drawTheProfile(axesOf(1)).querySelector('.profile__shape')).toBeNull();
  });

  it('pulls a corner in as far as its axis fell short', () => {
    const full = drawTheProfile([
      { name: 'A', of: 1, said: '' },
      { name: 'B', of: 1, said: '' },
      { name: 'C', of: 1, said: '' },
    ]);
    const half = drawTheProfile([
      { name: 'A', of: 0.5, said: '' },
      { name: 'B', of: 1, said: '' },
      { name: 'C', of: 1, said: '' },
    ]);
    const topOf = (chart: SVGElement): number =>
      Number(
        chart.querySelector('.profile__shape')?.getAttribute('points')?.split(' ')[0]?.split(',')[1],
      );

    // The first corner points straight up, so falling short moves it down.
    expect(topOf(half)).toBeGreaterThan(topOf(full));
  });

  it('says what it shows to anything that cannot see it', () => {
    const said = drawTheProfile(axesOf(3)).getAttribute('aria-label') ?? '';

    expect(said).toContain('Axis 1, something');
  });
});

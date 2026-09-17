// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  LEAST_ZOOM,
  MOST_ZOOM,
  drawTheRoll,
  keepTheHeadInView,
  timeFromTap,
  scaledBy,
  pinchedTo,
  LEAST_ROW,
  MOST_ROW,
  theMapOfTheRun,
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
  return drawTheRoll({ roll: input, barLabel: label });
}

describe('drawing a run as a piano roll', () => {
  it('places a note by when it was struck and let go of', () => {
    // The grid's nought is the first thing that happened, so a run whose first
    // click is at four seconds does not start four seconds of empty grid.
    const view = draw(
      roll({
        beats: barOfFour(0, 4000),
        presses: [press({ downAtMs: 5000, upAtMs: 5500 })],
      }),
    );

    const note = view.querySelector<HTMLElement>('.roll__note');
    expect(note?.style.left).toBe('calc(var(--roll-second) * 1.0000)');
    expect(note?.style.width).toBe('calc(var(--roll-second) * 0.5000)');
  });

  it('runs a key still held to the edge and says that is what it is', () => {
    const view = draw(
      roll({ beats: barOfFour(0, 0), presses: [press({ downAtMs: 0, upAtMs: null })] }),
    );

    const note = view.querySelector<HTMLElement>('.roll__note');
    expect(note?.classList.contains('roll__note--open')).toBe(true);
    // To the last click plus the tail, which is four seconds of bar and one over.
    expect(note?.style.width).toBe('calc(var(--roll-second) * 4.0000)');
  });

  it('stacks the pitches downwards from the top of the band', () => {
    const view = draw(
      roll({
        presses: [press({ midi: MIDI.C4 }), press({ midi: MIDI.C4 + 1 })],
      }),
    );

    const tops = [...view.querySelectorAll<HTMLElement>('.roll__note')].map(
      (note) => note.style.top,
    );
    // Pitch runs downwards, so the semitone above sits exactly one row higher.
    // Both are well inside the band, which has grown around them to the twelve
    // rows a drawing gets however few notes there were.
    expect(tops).toEqual([
      'calc(var(--roll-row) * 6)',
      'calc(var(--roll-row) * 5)',
    ]);
  });

  it('draws a line for a bar and for a beat, and none for a subdivision', () => {
    const view = draw(
      roll({
        beats: [
          beatOf(0, 'downbeat', Duration.QUARTER.ticks * 0),
          beatOf(250, 'division', Duration.QUARTER.ticks * 0.25),
          beatOf(500, 'beat', Duration.QUARTER.ticks * 0.5),
        ],
      }),
    );

    expect(view.querySelectorAll('.roll__line')).toHaveLength(2);
    expect(view.querySelectorAll('.roll__line--downbeat')).toHaveLength(1);
  });

  it('draws a bar line the reader gave as theirs', () => {
    // Two lines at one bar line is not a fault to be tidied away; drawing them
    // alike was. The metre's line says where the beat was, this one says where
    // the reader put it.
    const view = draw(
      roll({
        beats: [
          beatOf(0, 'downbeat', 0),
          beatOf(180, 'downbeat', 0),
        ],
      }),
    );

    expect([...view.querySelectorAll<HTMLElement>('.roll__line')].map((line) => line.className))
      .toEqual(['roll__line roll__line--downbeat', 'roll__line roll__line--given']);
  });

  it('paints the whole wait, from where the beat fell to where it was given', () => {
    // The band rather than its edge: the eye takes a width where it would have
    // to measure a gap.
    const view = draw(
      roll({
        beats: [
          beatOf(1000, 'downbeat', 0),
          beatOf(1180, 'downbeat', 0),
          beatOf(2000, 'beat', Duration.QUARTER.ticks),
        ],
      }),
    );

    const bands = [...view.querySelectorAll<HTMLElement>('.roll__wait')];
    expect(bands).toHaveLength(1);
    // From the run's own beginning, which is its first event.
    expect(bands[0]?.style.left).toBe('calc(var(--roll-second) * 0.0000)');
    expect(bands[0]?.style.width).toBe('calc(var(--roll-second) * 0.1800)');
    expect(bands[0]?.title).toBe('The music waited 180 ms');
  });

  it('lays the wait under the rows, so the black keys darken it', () => {
    // Those rows are a dark wash with the ground showing through, so a band
    // beneath one is seen through it - which is the darker yellow he asked for,
    // and it falls out of the order rather than needing a second colour.
    const view = draw(
      roll({
        presses: [press({ midi: MIDI.C4 })],
        beats: [
          beatOf(0, 'downbeat', 0),
          beatOf(180, 'downbeat', 0),
        ],
      }),
    );

    const grid = view.querySelector('.roll__grid');
    const kinds = [...(grid?.children ?? [])].map((child) => child.className.split(' ')[0]);
    expect(kinds.indexOf('roll__wait')).toBeLessThan(kinds.indexOf('roll__row'));
  });

  it('paints nothing where every beat fell where it was meant to', () => {
    const view = draw(roll({ beats: barOfFour(0, 0) }));

    expect(view.querySelectorAll('.roll__wait')).toHaveLength(0);
  });

  it('names a bar once, at the line that fell due rather than the one given', () => {
    // The number over the grid is the page's, and the page does not move.
    const view = draw(
      roll({
        beats: [
          beatOf(0, 'downbeat', 0),
          beatOf(180, 'downbeat', 0),
        ],
      }),
      () => '12',
    );

    const marks = [...view.querySelectorAll<HTMLElement>('.roll__bar')];
    expect(marks).toHaveLength(1);
    expect(marks[0]?.style.left).toBe('calc(var(--roll-second) * 0.0000)');
  });

  it('leaves a beat unnamed where the music has no bar line', () => {
    // A beat inside a bar is not a bar, and the ruler says nothing about it.
    const view = draw(
      roll({ beats: barOfFour(0, 0) }),
      (ticks) => (ticks === 0 ? '1' : null),
    );

    expect(view.querySelectorAll('.roll__bar')).toHaveLength(1);
  });

  it('cuts the beat into the parts that were asked for', () => {
    const beats = [
      beatOf(0, 'downbeat', 0),
      beatOf(1000, 'beat', Duration.QUARTER.ticks),
    ];

    expect(draw(roll({ beats })).querySelectorAll('.roll__line')).toHaveLength(2);

    const finer = drawTheRoll({
      roll: roll({ beats }),
      barLabel: () => null,
      grid: { beats: true, parts: 2 },
    });

    expect(finer.querySelectorAll('.roll__line')).toHaveLength(3);
    const cut = finer.querySelector<HTMLElement>('.roll__line--division');
    expect(cut?.style.left).toBe('calc(var(--roll-second) * 0.5000)');
  });

  it('draws the bar lines alone where that is all that is wanted', () => {
    // The reading a long run wants: where the bars fell, and nothing else
    // competing for the eye.
    const view = drawTheRoll({
      roll: roll({ beats: barOfFour(0, 0) }),
      barLabel: () => null,
      grid: { beats: false, parts: 1 },
    });

    expect(view.querySelectorAll('.roll__line')).toHaveLength(1);
  });

  it('names each bar once, by what the writer called it', () => {
    // A repeat is written out, so the fifth bar of the playing is not bar five
    // of the page. The drawing asks rather than counts.
    const view = draw(
      roll({ beats: [...barOfFour(0, 0), ...barOfFour(1, 4000)] }),
      // A namer answers for bar lines and says nothing about anything else.
      (ticks) => {
        if (ticks === 0) {
          return '8';
        }
        return ticks === Duration.QUARTER.ticks * 4 ? '9' : null;
      },
    );

    const marks = [...view.querySelectorAll<HTMLElement>('.roll__bar')];
    expect(marks.map((mark) => mark.textContent)).toEqual(['8', '9']);
    expect(marks[1]?.style.left).toBe('calc(var(--roll-second) * 4.0000)');
  });

  it('colours a press by the verdict the page was marked with', () => {
    const view = draw(
      roll({
        presses: [
          press({ midi: MIDI.C4, verdict: 'correct' }),
          press({ midi: MIDI.C4 + 2, verdict: 'wrong' }),
          press({ midi: MIDI.C4 + 5, verdict: 'duplicate' }),
          press({ midi: MIDI.C4 + 7, verdict: null }),
        ],
      }),
    );

    const shades = [...view.querySelectorAll<HTMLElement>('.roll__note')].map(
      (note) => note.className,
    );
    expect(shades).toEqual([
      'roll__note roll__note--correct',
      'roll__note roll__note--wrong',
      'roll__note roll__note--aside',
      'roll__note roll__note--unjudged',
    ]);
  });

  it('says nothing about the timing in a note’s colour', () => {
    // The right note is the right note. How far off the beat it came is the
    // band's business, and giving the note its own colour for it made one
    // colour mean three different things.
    const view = draw(
      roll({
        presses: [
          press({ midi: MIDI.C4, verdict: 'rushed' }),
          press({ midi: MIDI.C4 + 4, verdict: 'late' }),
        ],
      }),
    );

    const shades = [...view.querySelectorAll<HTMLElement>('.roll__note')].map(
      (note) => note.className,
    );
    expect(shades).toEqual(['roll__note roll__note--correct', 'roll__note roll__note--correct']);
  });

  it('reddens a beat the reader overtook, and gives it no band', () => {
    // There is no width to draw: the stretch between where they played and
    // where the beat was due is time that never elapsed, the music having moved
    // on when they did. His: "малювати цю ранню вертикальну лінію метроному
    // червоним кольором".
    const view = draw(
      roll({
        beats: [beatOf(0, 'downbeat', 0), beatOf(1000, 'beat', Duration.QUARTER.ticks)],
        rushes: [{ atMs: 1600, byMs: 400 }],
      }),
    );

    const early = view.querySelectorAll<HTMLElement>('.roll__line--rushed');
    expect(early).toHaveLength(1);
    expect(early[0]?.title).toBe('Taken 400 ms early');
    expect(early[0]?.style.left).toBe('calc(var(--roll-second) * 1.6000)');
    expect(view.querySelectorAll('.roll__wait')).toHaveLength(0);
  });

  it('cuts a note the music asked for where the reader came in early', () => {
    // The beat at the far end is the one they took, so the note ends there
    // rather than running on through music the reader had already left. His:
    // "якщо ghost нота була достатньо довгою - то придеться її розрізати".
    const view = drawTheRoll({
      roll: roll({
        beats: [beatOf(0, 'downbeat', 0), beatOf(1600, 'downbeat', Duration.QUARTER.ticks * 4)],
        presses: [press({ downAtMs: 0, upAtMs: 200 })],
      }),
      barLabel: () => null,
      ghosts: [
        { stepIndex: 0, midi: MIDI.C4, fromTicks: 0, untilTicks: Duration.QUARTER.ticks * 4 },
      ],
    });

    const outline = view.querySelector<HTMLElement>('.roll__ghost');
    // A written bar of it, cut at one and six tenths where he came in.
    expect(outline?.style.width).toBe('calc(var(--roll-second) * 1.6000)');
  });

  it('says how far off the beat a press was, signed the way a reader falls', () => {
    const view = draw(roll({ presses: [press({ deviationMs: 42.4 })] }));

    expect(view.querySelector<HTMLElement>('.roll__note')?.title).toBe('C4 · correct · +42 ms');
  });

  it('keeps a band of pitches even for a single note', () => {
    // One note drawn as one row is a stripe, not a picture.
    const view = draw(roll({ presses: [press()] }));

    expect(view.style.getPropertyValue('--roll-rows')).toBe('12');
  });

  it('clamps the band to what was played, with air above and below', () => {
    // Eighty-eight rows of which sixty are empty puts the music in a tenth of
    // the screen, and the question being asked is about the other axis.
    const view = draw(
      roll({ presses: [press({ midi: 48 }), press({ midi: 72 })] }),
    );

    expect(view.style.getPropertyValue('--roll-rows')).toBe('29');
  });

  it('draws the pedal for as long as it was held', () => {
    const view = draw(
      roll({ beats: barOfFour(0, 0), pedal: [{ downAtMs: 500, upAtMs: 2500 }] }),
    );

    const span = view.querySelector<HTMLElement>('.roll__pedal-span');
    expect(span?.style.left).toBe('calc(var(--roll-second) * 0.5000)');
    expect(span?.style.width).toBe('calc(var(--roll-second) * 2.0000)');
  });

  it('runs a pedal still down to the edge, and says so', () => {
    const view = draw(
      roll({ beats: barOfFour(0, 0), pedal: [{ downAtMs: 0, upAtMs: null }] }),
    );

    expect(view.querySelector<HTMLElement>('.roll__pedal-span')?.title).toBe('Pedal, still down');
  });

  it('shades the rows the black keys are on', () => {
    // An octave from C to C has five of them, and the band drawn for one note
    // is an octave.
    const view = draw(roll({ presses: [press({ midi: MIDI.C4 })] }));

    expect(view.querySelectorAll('.roll__row')).toHaveLength(5);
    expect(view.querySelectorAll('.roll__key--black')).toHaveLength(5);
  });

  it('draws an empty run without falling over', () => {
    const view = draw(roll());

    expect(view.querySelectorAll('.roll__note')).toHaveLength(0);
    expect(view.style.getPropertyValue('--roll-rows')).toBe('12');
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

  it('draws them over the ones that were played', () => {
    // An outline underneath the note that answered it is an outline nobody can
    // see: a note played at all covers most of one, and the outline is the thing
    // the reader is checking against. His: "чи можеш зробити ghost ноти щоб вони
    // малювалися поверх моїх нот... бо наразі мої ноти перекривають більшість
    // ghost нот".
    const view = drawTheRoll({
      roll: roll({ beats: grid, presses: [press({ midi: MIDI.C4 })] }),
      barLabel: () => null,
      ghosts: [
        { midi: MIDI.C4, fromTicks: 0, untilTicks: Duration.QUARTER.ticks, stepIndex: 0 },
      ],
    });

    const inGrid = [...(view.querySelector('.roll__grid')?.children ?? [])].map(
      (child) => child.className.split(' ')[0],
    );
    expect(inGrid.indexOf('roll__ghost')).toBeGreaterThan(inGrid.indexOf('roll__note'));
  });

  it('places them by the clicks that happened, not by a tempo', () => {
    const view = drawTheRoll({
      roll: roll({ beats: grid }),
      barLabel: () => null,
      ghosts: [
        { midi: MIDI.C4, fromTicks: Duration.QUARTER.ticks / 2, untilTicks: Duration.QUARTER.ticks, stepIndex: 0 },
      ],
    });

    const ghost = view.querySelector<HTMLElement>('.roll__ghost');
    expect(ghost?.style.left).toBe('calc(var(--roll-second) * 0.5000)');
    expect(ghost?.style.width).toBe('calc(var(--roll-second) * 0.5000)');
  });

  it('keeps a note nobody played inside the band', () => {
    // Which is the one worth seeing: a band drawn round the presses alone would
    // leave a missed note outside the picture altogether.
    const view = drawTheRoll({
      roll: roll({ beats: grid, presses: [press({ midi: 60 })] }),
      barLabel: () => null,
      ghosts: [{ midi: 84, fromTicks: 0, untilTicks: Duration.QUARTER.ticks, stepIndex: 0 }],
    });

    const ghost = view.querySelector<HTMLElement>('.roll__ghost');
    expect(ghost).not.toBeNull();
    // Twenty-four semitones apart, plus the air above and below.
    expect(view.style.getPropertyValue('--roll-rows')).toBe('29');
  });

  it('draws none of them past where the run stopped', () => {
    // The picture is of a run. A run that was stopped after two beats asked for
    // nothing beyond them, and the notes of the rest of the piece have no beat
    // here to be placed against - so placing them meant running the last pair
    // of clicks out over the whole score and drawing a canvas of notes nobody
    // played. His: "MIDI viewer наразі малює повний канвас нот, навіть якщо я
    // грав тільки слайс".
    const view = drawTheRoll({
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

    expect(view.querySelectorAll('.roll__ghost')).toHaveLength(1);
  });

  it('measures the end of the run from where the run began', () => {
    // A run that began five seconds into the page's own clock is still a run
    // two seconds long. Measured against that clock instead, the notes of the
    // next five seconds of the score would be drawn as though the reader had
    // reached them.
    const view = drawTheRoll({
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

    expect(view.querySelectorAll('.roll__ghost')).toHaveLength(1);
  });

  it('cuts one the run stopped in the middle of off at the end', () => {
    // A note still being asked for when the reader stopped is part of the run;
    // how much of it there was to play afterwards is not.
    const view = drawTheRoll({
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

    const ghost = view.querySelector<HTMLElement>('.roll__ghost');
    // The roll ends a second past its last click, and the outline stops there.
    expect(ghost?.style.width).toBe('calc(var(--roll-second) * 1.0000)');
  });

  it('draws none of them where the run had no pulse to place them against', () => {
    const view = drawTheRoll({
      roll: roll({ presses: [press()] }),
      barLabel: () => null,
      ghosts: [{ midi: MIDI.C4, fromTicks: 0, untilTicks: Duration.QUARTER.ticks, stepIndex: 0 }],
    });

    expect(view.querySelectorAll('.roll__ghost')).toHaveLength(0);
  });

  it('cuts a note off where its beat fell, not where the reader arrived', () => {
    // A note ending on a bar line that waited was drawn on to the end of the
    // wait, which made the yellow band look like part of the note.
    const view = drawTheRoll({
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

    const ghost = view.querySelector<HTMLElement>('.roll__ghost');
    expect(ghost?.style.left).toBe('calc(var(--roll-second) * 0.0000)');
    // One second, which is where the beat fell - not one and four tenths.
    expect(ghost?.style.width).toBe('calc(var(--roll-second) * 1.0000)');
  });

  it('begins a note on a waited bar line where the reader took it', () => {
    const view = drawTheRoll({
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

    expect(view.querySelector<HTMLElement>('.roll__ghost')?.style.left).toBe(
      'calc(var(--roll-second) * 1.4000)',
    );
  });

  it('draws none unless they are asked for', () => {
    const view = draw(roll({ beats: grid, presses: [press()] }));

    expect(view.querySelectorAll('.roll__ghost')).toHaveLength(0);
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

  function drawnWith(pressed: Partial<RolledPress>): HTMLElement {
    return drawTheRoll({
      roll: roll({ beats: grid, presses: [press({ midi: MIDI.C4, stepIndex: 0, ...pressed })] }),
      barLabel: () => null,
      ghosts: [owed],
    });
  }

  it('fills the gap where the note came late', () => {
    const band = drawnWith({ downAtMs: 300, upAtMs: 800 }).querySelector<HTMLElement>('.roll__slip');

    expect(band?.className).toBe('roll__slip roll__slip--late');
    expect(band?.style.left).toBe('calc(var(--roll-second) * 0.0000)');
    expect(band?.style.width).toBe('calc(var(--roll-second) * 0.3000)');
    expect(band?.title).toBe('Late by 300 ms');
  });

  it('fills it the other way where the note was rushed', () => {
    // The band reaches back from the note to where it was owed, and says so in
    // the colour this program already uses for a fault.
    const view = drawTheRoll({
      roll: roll({
        beats: grid,
        presses: [press({ midi: MIDI.C4, stepIndex: 0, downAtMs: -200, upAtMs: 300 })],
      }),
      barLabel: () => null,
      ghosts: [owed],
    });

    const band = view.querySelector<HTMLElement>('.roll__slip');
    expect(band?.className).toBe('roll__slip roll__slip--rushed');
    expect(band?.title).toBe('Rushed by 200 ms');
  });

  it('grows stronger with the size of the gap, and stops growing', () => {
    // So that "badly rushed" looks worse than "a little early" without a
    // threshold anybody has to agree on.
    const faint = drawnWith({ downAtMs: 60 }).querySelector<HTMLElement>('.roll__slip');
    const plain = drawnWith({ downAtMs: 200 }).querySelector<HTMLElement>('.roll__slip');
    const most = drawnWith({ downAtMs: 2_000 }).querySelector<HTMLElement>('.roll__slip');

    expect(Number(faint?.style.opacity)).toBeLessThan(Number(plain?.style.opacity));
    expect(Number(plain?.style.opacity)).toBeLessThan(Number(most?.style.opacity));
    expect(Number(most?.style.opacity)).toBe(0.5);
  });

  it('leaves the gaps unfilled where that is not the question', () => {
    // Whether a chord went down together is read off whether the presses line
    // up, and bands lying across them are colour between the eye and that line.
    const view = drawTheRoll({
      roll: roll({ beats: grid, presses: [press({ midi: MIDI.C4, stepIndex: 0, downAtMs: 300 })] }),
      barLabel: () => null,
      ghosts: [owed],
      slips: false,
    });

    expect(view.querySelectorAll('.roll__slip')).toHaveLength(0);
    // And what the question *is* about is still there.
    expect(view.querySelectorAll('.roll__ghost')).toHaveLength(1);
    expect(view.querySelectorAll('.roll__note')).toHaveLength(1);
  });

  it('says nothing about a note that was near enough', () => {
    // Every note is off by something; drawn without a floor the whole run is one
    // wash of colour saying nothing about anywhere in particular.
    expect(drawnWith({ downAtMs: 10 }).querySelectorAll('.roll__slip')).toHaveLength(0);
  });

  it('says nothing where the note was never played', () => {
    // The outline says that on its own, and there is no second edge to fill to.
    const view = drawTheRoll({
      roll: roll({ beats: grid, presses: [] }),
      barLabel: () => null,
      ghosts: [owed],
    });

    expect(view.querySelectorAll('.roll__slip')).toHaveLength(0);
    expect(view.querySelectorAll('.roll__ghost')).toHaveLength(1);
  });

  it('pairs a press with the note it answered, not with the pitch', () => {
    // A piece returns to the same note again and again. Paired by pitch, the
    // second C would be measured against the first C's place in the music.
    const view = drawTheRoll({
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

    const bands = [...view.querySelectorAll<HTMLElement>('.roll__slip')];
    // The first was dead on and says nothing; the second was three tenths late.
    expect(bands).toHaveLength(1);
    expect(bands[0]?.title).toBe('Late by 300 ms');
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

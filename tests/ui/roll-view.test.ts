// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  LEAST_ZOOM,
  MOST_ZOOM,
  drawTheRoll,
  keepTheHeadInView,
  timeFromTap,
  zoomedBy,
} from '../../src/ui/rollView.js';
import type { RolledPress, RunRoll } from '../../src/application/session/RunRoll.js';
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
  return { presses: [], beats: [], pedal: [], truncated: false, ...over };
}

/**
 * A bar of four beats at one second each, at a bar of the music.
 *
 * A second to the quarter, which is sixty to the minute - so the moments and
 * the places in the music stay in step and the drawing has nothing to reconcile.
 */
function barOfFour(measure: number, fromMs: number) {
  const bar = Duration.QUARTER.ticks * 4;
  return [0, 1, 2, 3].map((beat) => ({
    atMs: fromMs + beat * 1000,
    weight: (beat === 0 ? 'downbeat' : 'beat') as 'downbeat' | 'beat',
    positionTicks: measure * bar + beat * Duration.QUARTER.ticks,
  }));
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
          { atMs: 0, weight: 'downbeat', positionTicks: Duration.QUARTER.ticks * 0 },
          { atMs: 250, weight: 'division', positionTicks: Duration.QUARTER.ticks * 0.25 },
          { atMs: 500, weight: 'beat', positionTicks: Duration.QUARTER.ticks * 0.5 },
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
          { atMs: 0, weight: 'downbeat', positionTicks: 0 },
          { atMs: 180, weight: 'downbeat', positionTicks: 0 },
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
          { atMs: 1000, weight: 'downbeat', positionTicks: 0 },
          { atMs: 1180, weight: 'downbeat', positionTicks: 0 },
          { atMs: 2000, weight: 'beat', positionTicks: Duration.QUARTER.ticks },
        ],
      }),
    );

    const bands = [...view.querySelectorAll<HTMLElement>('.roll__wait')];
    expect(bands).toHaveLength(1);
    // From the run's own beginning, which is its first event.
    expect(bands[0]?.style.left).toBe('calc(var(--roll-second) * 0.0000)');
    expect(bands[0]?.style.width).toBe('calc(var(--roll-second) * 0.1800)');
    expect(bands[0]?.title).toBe('Bar line given 180 ms late');
  });

  it('lays the wait under the rows, so the black keys darken it', () => {
    // Those rows are a dark wash with the ground showing through, so a band
    // beneath one is seen through it - which is the darker yellow he asked for,
    // and it falls out of the order rather than needing a second colour.
    const view = draw(
      roll({
        presses: [press({ midi: MIDI.C4 })],
        beats: [
          { atMs: 0, weight: 'downbeat', positionTicks: 0 },
          { atMs: 180, weight: 'downbeat', positionTicks: 0 },
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
          { atMs: 0, weight: 'downbeat', positionTicks: 0 },
          { atMs: 180, weight: 'downbeat', positionTicks: 0 },
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
      { atMs: 0, weight: 'downbeat' as const, positionTicks: 0 },
      { atMs: 1000, weight: 'beat' as const, positionTicks: Duration.QUARTER.ticks },
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
          press({ midi: MIDI.C4 + 4, verdict: 'rushed' }),
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
      'roll__note roll__note--off-the-beat',
      'roll__note roll__note--aside',
      'roll__note roll__note--unjudged',
    ]);
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

describe('the zoom two fingers ask for', () => {
  it('reads a pinch as a ratio, so the gesture means the same at any zoom', () => {
    expect(zoomedBy(140, 2)).toBe(280);
    expect(zoomedBy(280, 0.5)).toBe(140);
  });

  it('snaps to the step its slider moves in', () => {
    // A slider showing a value it cannot reach is a control lying about itself.
    expect(zoomedBy(140, 1.07) % 20).toBe(0);
  });

  it('will not go closer or wider than the drawing allows', () => {
    expect(zoomedBy(140, 100)).toBe(MOST_ZOOM);
    expect(zoomedBy(140, 0.001)).toBe(LEAST_ZOOM);
  });

  it('leaves the zoom alone when the fingers say nothing', () => {
    // A gap of nought is two fingers in one place, which is not a pinch.
    expect(zoomedBy(140, 0)).toBe(140);
    expect(zoomedBy(140, Number.NaN)).toBe(140);
  });
});

describe('the notes the music asked for', () => {
  const grid = [
    { atMs: 0, weight: 'downbeat' as const, positionTicks: 0 },
    { atMs: 1000, weight: 'beat' as const, positionTicks: Duration.QUARTER.ticks },
  ];

  it('draws them behind the ones that were played', () => {
    // The press is the answer and this is the question: the eye should land on
    // the answer and find the question underneath it.
    const view = drawTheRoll({
      roll: roll({ beats: grid, presses: [press({ midi: MIDI.C4 })] }),
      barLabel: () => null,
      ghosts: [
        { midi: MIDI.C4, fromTicks: 0, untilTicks: Duration.QUARTER.ticks },
      ],
    });

    const inGrid = [...(view.querySelector('.roll__grid')?.children ?? [])].map(
      (child) => child.className.split(' ')[0],
    );
    expect(inGrid.indexOf('roll__ghost')).toBeLessThan(inGrid.indexOf('roll__note'));
  });

  it('places them by the clicks that happened, not by a tempo', () => {
    const view = drawTheRoll({
      roll: roll({ beats: grid }),
      barLabel: () => null,
      ghosts: [
        { midi: MIDI.C4, fromTicks: Duration.QUARTER.ticks / 2, untilTicks: Duration.QUARTER.ticks },
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
      ghosts: [{ midi: 84, fromTicks: 0, untilTicks: Duration.QUARTER.ticks }],
    });

    const ghost = view.querySelector<HTMLElement>('.roll__ghost');
    expect(ghost).not.toBeNull();
    // Twenty-four semitones apart, plus the air above and below.
    expect(view.style.getPropertyValue('--roll-rows')).toBe('29');
  });

  it('draws none of them where the run had no pulse to place them against', () => {
    const view = drawTheRoll({
      roll: roll({ presses: [press()] }),
      barLabel: () => null,
      ghosts: [{ midi: MIDI.C4, fromTicks: 0, untilTicks: Duration.QUARTER.ticks }],
    });

    expect(view.querySelectorAll('.roll__ghost')).toHaveLength(0);
  });

  it('cuts a note off where its beat fell, not where the reader arrived', () => {
    // A note ending on a bar line that waited was drawn on to the end of the
    // wait, which made the yellow band look like part of the note.
    const view = drawTheRoll({
      roll: roll({
        beats: [
          { atMs: 0, weight: 'downbeat', positionTicks: 0 },
          { atMs: 1000, weight: 'downbeat', positionTicks: Duration.QUARTER.ticks },
          { atMs: 1400, weight: 'downbeat', positionTicks: Duration.QUARTER.ticks },
        ],
      }),
      barLabel: () => null,
      ghosts: [{ midi: MIDI.C4, fromTicks: 0, untilTicks: Duration.QUARTER.ticks }],
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
          { atMs: 0, weight: 'downbeat', positionTicks: 0 },
          { atMs: 1000, weight: 'downbeat', positionTicks: Duration.QUARTER.ticks },
          { atMs: 1400, weight: 'downbeat', positionTicks: Duration.QUARTER.ticks },
        ],
      }),
      barLabel: () => null,
      ghosts: [
        {
          midi: MIDI.C4,
          fromTicks: Duration.QUARTER.ticks,
          untilTicks: Duration.QUARTER.ticks * 2,
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

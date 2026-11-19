import { describe, expect, it } from 'vitest';
import type { HeardBeat, MidiFileEvent } from '../../src/domain/midi/MidiFile.js';
import {
  A_CHANGE_STANDS_IN,
  whatWasChanged,
  whereToSeeTheChange,
  type TheLayout,
  type ThingChanged,
} from '../../src/ui/theChangeInView.js';

const BEATS: readonly HeardBeat[] = [0, 500].map((atMs, beat) => ({ atMs, beat, beatsInBar: 4 }));

function note(midi: number, atMs: number, upAtMs: number | null = atMs + 400, velocity = 0.5): MidiFileEvent[] {
  return [
    { kind: 'noteOn', atMs, midi, velocity },
    ...(upAtMs === null ? [] : [{ kind: 'noteOff' as const, atMs: upAtMs, midi }]),
  ];
}

const drawn = (events: readonly MidiFileEvent[], beats = BEATS) => ({ events, beats });

describe('what a change to a sketch made or took away', () => {
  it('is a note moved, where it was and where it went, and not the notes left as they were', () => {
    const changed = whatWasChanged(drawn([...note(60, 0), ...note(64, 2_000)]), drawn([...note(60, 0), ...note(65, 3_000)]));

    expect(changed).toEqual([
      { fromMs: 2_000, untilMs: 2_400, midi: 64 },
      { fromMs: 3_000, untilMs: 3_400, midi: 65 },
    ]);
  });

  it('is a note struck harder, or given to the other hand, or written at a loudness, as the same note twice', () => {
    const harder = whatWasChanged(drawn(note(60, 0)), drawn(note(60, 0, 400, 0.9)));
    const handed = whatWasChanged(drawn(note(60, 0)), drawn([{ kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5, hand: 'left' }, ...note(60, 0).slice(1)]));
    const written = whatWasChanged(
      drawn(note(60, 0)),
      drawn([{ kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5, loudness: { level: 'f', shade: 0 } }, ...note(60, 0).slice(1)]),
    );

    for (const changed of [harder, handed, written]) {
      expect(changed).toEqual([
        { fromMs: 0, untilMs: 400, midi: 60 },
        { fromMs: 0, untilMs: 400, midi: 60 },
      ]);
    }
  });

  it('is a note held longer, from its start to where it ends now', () => {
    expect(whatWasChanged(drawn(note(60, 0)), drawn(note(60, 0, 900)))).toEqual([
      { fromMs: 0, untilMs: 400, midi: 60 },
      { fromMs: 0, untilMs: 900, midi: 60 },
    ]);
  });

  it('is a note left down to the end at its start', () => {
    expect(whatWasChanged(drawn([]), drawn(note(60, 700, null)))).toEqual([{ fromMs: 700, untilMs: 700, midi: 60 }]);
  });

  it('is a mark at its moment, on no row', () => {
    expect(whatWasChanged(drawn(note(60, 0)), drawn([...note(60, 0), { kind: 'dynamic', atMs: 1_500, level: 'p' }]))).toEqual([
      { fromMs: 1_500, untilMs: 1_500, midi: null },
    ]);
  });

  it('counts a note struck twice over as two, one taken away being one changed', () => {
    expect(whatWasChanged(drawn([...note(60, 0), ...note(60, 0)]), drawn(note(60, 0)))).toEqual([{ fromMs: 0, untilMs: 400, midi: 60 }]);
  });

  it('is nothing where nothing changed', () => {
    expect(whatWasChanged(drawn(note(60, 0)), drawn(note(60, 0)))).toEqual([]);
  });

  it('is nothing where the beats changed, the change being the whole sketch', () => {
    const slower = BEATS.map((beat) => ({ ...beat, atMs: beat.atMs * 2 }));
    const longer = [...BEATS, { atMs: 1_000, beat: 2, beatsInBar: 4 }];
    const otherMetre = BEATS.map((beat) => ({ ...beat, beatsInBar: 3 }));
    const counted = BEATS.map((beat, index) => ({ ...beat, beat: index + 1 }));
    const inQuavers = BEATS.map((beat) => ({ ...beat, beatType: 8 }));

    for (const beats of [slower, longer, otherMetre, counted, inQuavers]) {
      expect(whatWasChanged(drawn(note(60, 0)), drawn(note(60, 2_000), beats))).toEqual([]);
    }
    // The same beats in new arrays are the same beats.
    expect(whatWasChanged(drawn(note(60, 0)), drawn(note(60, 2_000), BEATS.map((beat) => ({ ...beat }))))).toHaveLength(2);
  });
});

describe('where to scroll so a change is seen', () => {
  // A second is a hundred pixels, a row ten; the drawing begins a second
  // into the events' clock, with 100 on its top row. The screen shows two
  // seconds and ten rows.
  const layout: TheLayout = { beganAtMs: 1_000, pxPerSecond: 100, rowPx: 10, highest: 100 };
  const view = { x: 0, y: 0, widePx: 200, tallPx: 100 };
  const at = (fromMs: number, untilMs: number, midi: number | null): ThingChanged => ({ fromMs, untilMs, midi });

  it('leaves the view alone where the change is on the screen', () => {
    expect(whereToSeeTheChange([at(1_500, 1_900, 95)], view, layout)).toBeNull();
  });

  it('leaves it alone where any of the change is: a note running onto the screen, or one of several', () => {
    const along = { ...view, x: 500 };
    expect(whereToSeeTheChange([at(5_000, 6_000, 95)], along, layout)).toBeNull();
    expect(whereToSeeTheChange([at(8_000, 8_400, 95)], along, layout)).toBeNull();
    expect(whereToSeeTheChange([at(20_000, 20_400, 95), at(6_500, 6_900, 95)], along, layout)).toBeNull();
  });

  it('counts a note as on the screen up to its last pixel either side', () => {
    const along = { ...view, x: 500 };
    // Ending at the left edge, beginning at the right.
    expect(whereToSeeTheChange([at(5_000, 6_000, 95)], along, layout)).toBeNull();
    expect(whereToSeeTheChange([at(8_000, 9_000, 95)], along, layout)).toBeNull();
    expect(whereToSeeTheChange([at(5_000, 5_990, 95)], along, layout)).not.toBeNull();
    expect(whereToSeeTheChange([at(8_010, 9_000, 95)], along, layout)).not.toBeNull();
  });

  it('counts a row as on the screen while any of it is', () => {
    const down = { ...view, y: 100 };
    // Rows ten to nineteen are on the screen: 90 down to 81.
    expect(whereToSeeTheChange([at(1_500, 1_900, 90)], down, layout)).toBeNull();
    expect(whereToSeeTheChange([at(1_500, 1_900, 81)], down, layout)).toBeNull();
    expect(whereToSeeTheChange([at(1_500, 1_900, 91)], down, layout)).not.toBeNull();
    expect(whereToSeeTheChange([at(1_500, 1_900, 80)], down, layout)).not.toBeNull();
  });

  it('scrolls across to a change out of the time on the screen, a tenth of the screen in', () => {
    // Ten seconds in on the events' clock is nine into the drawing.
    expect(A_CHANGE_STANDS_IN).toBe(0.1);
    expect(whereToSeeTheChange([at(10_000, 10_400, 95)], view, layout)).toEqual({ x: 900 - 20, y: 0 });
  });

  it('scrolls back across to one before the screen, to where it begins', () => {
    expect(whereToSeeTheChange([at(3_000, 3_400, 95), at(4_000, 4_400, 95)], { ...view, x: 2_000 }, layout)).toEqual({ x: 200 - 20, y: 0 });
  });

  it('scrolls no further back than the beginning', () => {
    expect(whereToSeeTheChange([at(1_050, 1_100, 95)], { ...view, x: 2_000 }, layout)).toEqual({ x: 0, y: 0 });
  });

  it('scrolls down to a change out of the rows on the screen, its pitches in the middle', () => {
    // 50 to 40 is rows fifty to sixty: from 500 down to 610, the middle at 555.
    expect(whereToSeeTheChange([at(1_500, 1_900, 50), at(1_600, 1_900, 40)], view, layout)).toEqual({ x: 0, y: 555 - 50 });
    // And up, no further than the top.
    expect(whereToSeeTheChange([at(1_500, 1_900, 99)], { ...view, y: 500 }, layout)).toEqual({ x: 0, y: 0 });
  });

  it('scrolls both ways to a change out of both', () => {
    expect(whereToSeeTheChange([at(10_000, 10_400, 50)], view, layout)).toEqual({ x: 880, y: 505 - 50 });
  });

  it('scrolls down only to the pitches of what is in the time it scrolls to', () => {
    // The one at 30 is far along; the one at 50 is in the time on the screen.
    expect(whereToSeeTheChange([at(1_500, 1_900, 50), at(30_000, 30_400, 30)], view, layout)).toEqual({ x: 0, y: 505 - 50 });
  });

  it('scrolls only across to a mark, which is seen at any height', () => {
    expect(whereToSeeTheChange([at(10_000, 10_000, null)], { ...view, y: 300 }, layout)).toEqual({ x: 880, y: 300 });
    expect(whereToSeeTheChange([at(1_500, 1_500, null)], { ...view, y: 300 }, layout)).toBeNull();
  });

  it('leaves the view alone where nothing changed, or nothing is laid out', () => {
    expect(whereToSeeTheChange([], view, layout)).toBeNull();
    expect(whereToSeeTheChange([at(10_000, 10_400, 95)], { ...view, widePx: 0 }, layout)).toBeNull();
    expect(whereToSeeTheChange([at(10_000, 10_400, 95)], { ...view, tallPx: 0 }, layout)).toBeNull();
  });
});

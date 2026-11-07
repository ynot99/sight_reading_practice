import { describe, expect, it } from 'vitest';
import {
  takeWithADrumLoop,
  takeWithTheDrumLoopsKeptInStep,
  takeWithTheDrumLoopUntil,
  takeWithoutTheDrumLoop,
  theDrumLoopsOf,
} from '../../src/domain/midi/drumLoops.js';
import { thePlayingAtAnotherPace, thePlayingWithABarInserted, writeMidiFile, type HeardBeat, type MidiFileEvent } from '../../src/domain/midi/MidiFile.js';

const KICK = 36;
const SNARE = 37;
const HAT = 39;

const hit = (midi: number, atMs: number, upAtMs = atMs + 100, velocity = 0.75): MidiFileEvent[] => [
  { kind: 'drumOn', atMs, midi, velocity },
  { kind: 'drumOff', atMs: upAtMs, midi },
];
const edge = (loop: number, atMs: number, which: 'from' | 'lap' | 'until'): MidiFileEvent => ({ kind: 'drumLoop', atMs, loop, edge: which });
/** A click of four in a bar, a beat every half second. */
const fours = (count: number): HeardBeat[] => Array.from({ length: count }, (_, at) => ({ atMs: at * 500, beat: at % 4, beatsInBar: 4 }));
/** The hits, as moment, drum and length, in the order they are struck. */
const hits = (events: readonly MidiFileEvent[]): string[] => {
  const open = new Map<number, number[]>();
  const out: { atMs: number; midi: number; upAtMs: number; velocity: number }[] = [];
  for (const event of [...events].sort((one, other) => one.atMs - other.atMs)) {
    if (event.kind === 'drumOn') {
      open.set(event.midi, [...(open.get(event.midi) ?? []), out.length]);
      out.push({ atMs: event.atMs, midi: event.midi, upAtMs: -1, velocity: event.velocity });
    } else if (event.kind === 'drumOff') {
      const at = open.get(event.midi)?.shift();
      const found = at === undefined ? undefined : out[at];
      if (found !== undefined) {
        found.upAtMs = event.atMs;
      }
    }
  }
  return out.map((each) => `${String(each.atMs)} ${String(each.midi)} ${String(each.upAtMs - each.atMs)}${each.velocity === 0.75 ? '' : ` v${String(each.velocity)}`}`);
};

/** A bar of kick, snare, kick, snare and a hat after the first kick, a loop of it. */
const A_BAR: readonly MidiFileEvent[] = [...hit(KICK, 0), ...hit(HAT, 250), ...hit(SNARE, 500), ...hit(KICK, 1_000), ...hit(SNARE, 1_500)];
const looped = (): readonly MidiFileEvent[] => {
  const made = takeWithADrumLoop(A_BAR, 0, 2_000);
  if (made === null) {
    throw new Error('no loop');
  }
  return made;
};

describe('a loop of drums', () => {
  it('is made of a stretch, one lap long, numbered after any there was', () => {
    expect(theDrumLoopsOf(looped())).toEqual([{ id: 1, fromMs: 0, lapMs: 2_000, untilMs: 2_000 }]);
    const two = takeWithADrumLoop(looped(), 4_000, 5_000);
    expect(theDrumLoopsOf(two ?? []).map((loop) => [loop.id, loop.fromMs])).toEqual([
      [1, 0],
      [2, 4_000],
    ]);
  });

  it('is not made of no stretch, nor over a loop already there', () => {
    expect(takeWithADrumLoop(A_BAR, 1_000, 1_000)).toBeNull();
    expect(takeWithADrumLoop(looped(), 1_500, 3_000)).toBeNull();
    expect(takeWithADrumLoop(looped(), -500, 500)).toBeNull();
    // Beginning where one ends is beside it, not over it.
    expect(takeWithADrumLoop(looped(), 2_000, 3_000)).not.toBeNull();
  });

  it('is only one with all three edges, in their order', () => {
    expect(theDrumLoopsOf([edge(1, 0, 'from'), edge(1, 1_000, 'lap')])).toEqual([]);
    expect(theDrumLoopsOf([edge(1, 1_000, 'from'), edge(1, 500, 'lap'), edge(1, 2_000, 'until')])).toEqual([]);
    expect(theDrumLoopsOf([edge(1, 0, 'from'), edge(1, 1_000, 'lap'), edge(1, 500, 'until')])).toEqual([]);
  });

  it('pulled out, writes its first lap again in each lap, the last cut where it ends, and nothing else moves', () => {
    const outside = [...hit(KICK, 6_000)];
    const pulled = takeWithTheDrumLoopUntil([...looped(), ...outside], 1, 5_250);
    expect(theDrumLoopsOf(pulled)).toEqual([{ id: 1, fromMs: 0, lapMs: 2_000, untilMs: 5_250 }]);
    expect(hits(pulled)).toEqual([
      ...['0 36 100', '250 39 100', '500 37 100', '1000 36 100', '1500 37 100'],
      ...['2000 36 100', '2250 39 100', '2500 37 100', '3000 36 100', '3500 37 100'],
      // Five eighths of a lap, as far as the second kick.
      ...['4000 36 100', '4250 39 100', '4500 37 100', '5000 36 100'],
      '6000 36 100',
    ]);
    // Cut by the end: a hat held over it ends with it.
    const held = takeWithTheDrumLoopUntil(takeWithADrumLoop([...hit(HAT, 0, 400)], 0, 1_000) ?? [], 1, 1_200);
    expect(hits(held)).toEqual(['0 39 400', '1000 39 200']);
  });

  it('pulled in, takes back the laps past its end, and stops no shorter than its first lap, nor in the loop after it', () => {
    const pulled = takeWithTheDrumLoopUntil(looped(), 1, 6_000);
    const back = takeWithTheDrumLoopUntil(pulled, 1, 2_500);
    expect(hits(back)).toEqual(['0 36 100', '250 39 100', '500 37 100', '1000 36 100', '1500 37 100', '2000 36 100', '2250 39 100']);
    expect(theDrumLoopsOf(takeWithTheDrumLoopUntil(pulled, 1, 500))[0]?.untilMs).toBe(2_000);
    const beside = takeWithADrumLoop(looped(), 3_000, 3_500) ?? [];
    expect(theDrumLoopsOf(takeWithTheDrumLoopUntil(beside, 1, 9_000))[0]?.untilMs).toBe(3_000);
    // One not there is nothing to pull.
    expect(takeWithTheDrumLoopUntil(looped(), 7, 9_000)).toEqual(looped());
  });

  it('let go of, leaves its hits as they are', () => {
    const pulled = takeWithTheDrumLoopUntil(looped(), 1, 4_000);
    const free = takeWithoutTheDrumLoop(pulled, 1);
    expect(theDrumLoopsOf(free)).toEqual([]);
    expect(free.some((event) => event.kind === 'drumLoop')).toBe(false);
    expect(hits(free)).toEqual(hits(pulled));
  });
});

describe('the laps of a loop kept alike', () => {
  const twoAndAHalf = (): readonly MidiFileEvent[] => takeWithTheDrumLoopUntil(looped(), 1, 5_000);

  it('makes a hit put into any lap every lap\'s, as far as a short last lap goes', () => {
    const before = twoAndAHalf();
    // A hat put into the second lap, three quarters into it.
    const after = takeWithTheDrumLoopsKeptInStep(before, [...before, ...hit(HAT, 3_750)]);
    expect(hits(after).filter((each) => each.endsWith(' 39 100'))).toEqual(['250 39 100', '1750 39 100', '2250 39 100', '3750 39 100', '4250 39 100']);
  });

  it('makes a hit taken out of, or struck harder in, any lap every lap\'s', () => {
    const before = twoAndAHalf();
    const snareOfTheSecondLap = before.findIndex((event) => event.kind === 'drumOn' && event.atMs === 2_500);
    const without = before.filter((_, at) => at !== snareOfTheSecondLap && !(before[at]?.kind === 'drumOff' && before[at]?.atMs === 2_600));
    expect(hits(takeWithTheDrumLoopsKeptInStep(before, without)).filter((each) => each.includes(' 37 '))).toEqual(['1500 37 100', '3500 37 100']);
    const harder = before.map((event) => (event.kind === 'drumOn' && event.atMs === 0 ? { ...event, velocity: 1 } : event));
    expect(hits(takeWithTheDrumLoopsKeptInStep(before, harder)).filter((each) => each.endsWith('v1'))).toEqual([
      '0 36 100 v1',
      '2000 36 100 v1',
      '4000 36 100 v1',
    ]);
  });

  it('takes a change to a short last lap as far as it goes, and keeps the rest of the first lap', () => {
    const before = twoAndAHalf();
    // The kick of the last half-lap taken out: the first kick of every lap, and the second stays.
    const without = before.filter((event) => !(('midi' in event) && event.midi === KICK && (event.atMs === 4_000 || event.atMs === 4_100)));
    expect(hits(takeWithTheDrumLoopsKeptInStep(before, without)).filter((each) => each.includes(' 36 '))).toEqual(['1000 36 100', '3000 36 100']);
  });

  it('does nothing where every lap is still alike, as after a change of pace', () => {
    const before = twoAndAHalf();
    const paced = thePlayingAtAnotherPace(before, fours(12), 60).events;
    expect(takeWithTheDrumLoopsKeptInStep(before, paced)).toEqual(paced);
  });

  it('lets the loop go where two laps were changed and are not alike, the hits as the change left them', () => {
    const before = twoAndAHalf();
    const twoChanged = [...before, ...hit(HAT, 1_750), ...hit(SNARE, 2_250)];
    const after = takeWithTheDrumLoopsKeptInStep(before, twoChanged);
    expect(theDrumLoopsOf(after)).toEqual([]);
    expect(hits(after)).toEqual(hits(twoChanged));
  });

  it('keeps a loop whose first lap holds a hit ringing past its end, through a change elsewhere', () => {
    // Made a loop, its hits are as they were: the hat rings on past the first lap.
    const ringing = takeWithADrumLoop([...hit(HAT, 1_500, 2_400)], 0, 2_000) ?? [];
    expect(hits(ringing)).toEqual(['1500 39 900']);
    const elsewhere = takeWithTheDrumLoopsKeptInStep(ringing, [...ringing, ...hit(KICK, 6_000)]);
    expect(theDrumLoopsOf(elsewhere)).toHaveLength(1);
    // Pulled out, every lap is cut where it ends, the first as well.
    expect(hits(takeWithTheDrumLoopUntil(ringing, 1, 4_000))).toEqual(['1500 39 500', '3500 39 500']);
  });

  it('takes away the edges of a loop that is no longer one', () => {
    const cut = looped().filter((event) => !(event.kind === 'drumLoop' && event.edge === 'lap'));
    expect(takeWithTheDrumLoopsKeptInStep(looped(), cut).some((event) => event.kind === 'drumLoop')).toBe(false);
  });
});

describe('the edges of a loop under the music changed', () => {
  it('move with a bar put in, the beginning on its bar line with the bar after', () => {
    const at2000 = takeWithADrumLoop([...hit(KICK, 2_000)], 2_000, 4_000) ?? [];
    expect(theDrumLoopsOf(thePlayingWithABarInserted(at2000, fours(12), 2_000).events)).toEqual([
      { id: 1, fromMs: 4_000, lapMs: 6_000, untilMs: 6_000 },
    ]);
    // Put in at its end, the bar is after it.
    expect(theDrumLoopsOf(thePlayingWithABarInserted(at2000, fours(12), 4_000).events)).toEqual([
      { id: 1, fromMs: 2_000, lapMs: 4_000, untilMs: 4_000 },
    ]);
  });

  it('go into no file', () => {
    const notes: MidiFileEvent[] = [
      { kind: 'noteOn', atMs: 0, midi: 60, velocity: 0.5 },
      { kind: 'noteOff', atMs: 400, midi: 60 },
    ];
    const withALoop = takeWithTheDrumLoopUntil(takeWithADrumLoop([...notes, ...A_BAR], 0, 2_000) ?? [], 1, 8_000);
    expect(writeMidiFile(withALoop, { beats: fours(4) })).toEqual(writeMidiFile(notes, { beats: fours(4) }));
  });
});

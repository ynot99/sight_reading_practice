import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepTheTrail, timeTheStart, traceTheStart } from '../../src/shared/timeTheStart.js';

describe('the start timings', () => {
  let now = 0;
  let lines: string[] = [];

  beforeEach(() => {
    now = 1_000;
    lines = [];
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
  });

  afterEach(() => {
    traceTheStart(false);
    vi.restoreAllMocks();
  });

  const stages = (): string[] => lines.filter((line) => line.includes(' ms ')).map((line) => line.replace(/\s+/g, ' '));

  it('says nothing to anybody who did not ask', () => {
    timeTheStart('playback asked for');
    timeTheStart('first note sounded');

    expect(lines).toEqual([]);
  });

  it('gives each stage its time since the start and the gap before it', () => {
    // The big gap is the answer. His own run found four seconds between the
    // pulse starting and the notes being gathered, which no line of the code
    // could have said on its own.
    traceTheStart(true);
    timeTheStart('playback asked for');
    now += 20;
    timeTheStart('metronome started');
    now += 4_000;
    timeTheStart('notes collected');

    expect(stages()).toEqual([
      '[timing] + 0 ms gap 0 ms playback asked for',
      '[timing] + 20 ms gap 20 ms metronome started',
      '[timing] + 4020 ms gap 4000 ms notes collected',
    ]);
  });

  it('prints a detail with its stage, without making it another one', () => {
    // How late the first dropped note was is the answer; the next one, later
    // or not, is the same stage.
    traceTheStart(true);
    timeTheStart('playback asked for');
    timeTheStart('a note dropped as too late', () => '560 ms late');
    timeTheStart('a note dropped as too late', () => '561 ms late');

    expect(stages()).toEqual([
      '[timing] + 0 ms gap 0 ms playback asked for',
      '[timing] + 0 ms gap 0 ms a note dropped as too late (560 ms late)',
    ]);
  });

  it('says each stage once a start, however often it is reached', () => {
    // A tick is heard many times a second; only the first says anything about
    // how long starting took.
    traceTheStart(true);
    timeTheStart('playback asked for');
    timeTheStart('first tick heard');
    now += 500;
    timeTheStart('first tick heard');

    expect(stages()).toHaveLength(2);
  });

  it('starts the clock again at every start', () => {
    traceTheStart(true);
    timeTheStart('playback asked for');
    now += 3_000;
    timeTheStart('playback resume asked for');
    now += 10;
    timeTheStart('first tick heard');

    expect(stages().at(-1)).toBe('[timing] + 10 ms gap 10 ms first tick heard');
  });

  it('is never silent where the way in was not the one expected', () => {
    // It once stayed quiet through a whole playback, because every stage waited
    // for a start it had been told about and the playback came in another way.
    traceTheStart(true);
    timeTheStart('metronome started');

    expect(stages()).toEqual(['[timing] + 0 ms gap 0 ms metronome started']);
  });

  it('does not put the clock back when told what it already knows', () => {
    // The page reports every setting whenever any of them moves, which happens
    // in the middle of starting. Put back to nought there, one start would be
    // divided into two halves that each looked quick.
    traceTheStart(true);
    timeTheStart('playback asked for');
    now += 4_000;
    traceTheStart(true);
    timeTheStart('notes collected');

    expect(stages().at(-1)).toBe('[timing] + 4000 ms gap 4000 ms notes collected');
  });
});

describe('keeping the start timings for a page that may not live to show them', () => {
  let now = 0;

  beforeEach(() => {
    now = 1_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    keepTheTrail(null);
    traceTheStart(false);
    vi.restoreAllMocks();
  });

  const plain = (lines: readonly string[]): string[] => lines.map((line) => line.replace(/\s+/g, ' '));

  it('hands every line to the keeper as it is printed', () => {
    // His Alkan closes the page on the iPad while it is engraved, and the
    // console goes with it: "яж крашусь".
    const kept: string[][] = [];
    keepTheTrail((lines) => kept.push([...lines]));
    traceTheStart(true);

    timeTheStart('score asked for');
    now += 900;
    timeTheStart('engraver: file read');

    expect(kept.map(plain)).toEqual([
      ['[timing] + 0 ms gap 0 ms score asked for'],
      ['[timing] + 0 ms gap 0 ms score asked for', '[timing] + 900 ms gap 900 ms engraver: file read'],
    ]);
  });

  it('starts the lines again when a score is asked for, as the clock does', () => {
    const kept: string[][] = [];
    keepTheTrail((lines) => kept.push([...lines]));
    traceTheStart(true);
    timeTheStart('playback asked for');
    timeTheStart('first note sounded');

    now += 5_000;
    timeTheStart('score asked for');

    expect(plain(kept.at(-1) ?? [])).toEqual(['[timing] + 0 ms gap 0 ms score asked for']);
  });

  it('keeps nothing for a reader who did not ask for the timings', () => {
    const kept: string[][] = [];
    keepTheTrail((lines) => kept.push([...lines]));

    timeTheStart('score asked for');

    expect(kept).toEqual([]);
  });

  it('says how much the page holds, where the browser will tell', () => {
    // Chrome does and Safari does not: on the desk, the stage where the
    // memory climbs is where the iPad is most likely to close the page.
    const kept: string[][] = [];
    keepTheTrail((lines) => kept.push([...lines]));
    Object.defineProperty(performance, 'memory', {
      configurable: true,
      value: { usedJSHeapSize: 238_400_000 },
    });
    try {
      traceTheStart(true);
      timeTheStart('score asked for');
    } finally {
      delete (performance as { memory?: unknown }).memory;
    }

    expect(kept[0]?.[0]).toMatch(/score asked for\s+heap 238 MB$/);
  });
});

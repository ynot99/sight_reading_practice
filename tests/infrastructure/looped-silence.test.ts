// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LET_GO_AFTER_MS, LoopedSilence, type SilenceTimers } from '../../src/infrastructure/media/MediaSessionKeys.js';
import { beginThePlaybackTimings, thePlaybackTimingsText } from '../../src/shared/playbackTimings.js';

describe('the silence that makes the page a player', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The parts of a media element and of the address book jsdom leaves out, counted. */
  function stubTheBrowser(): { made: string[]; freed: string[]; loaded: HTMLMediaElement[]; played: HTMLMediaElement[] } {
    const made: string[] = [];
    const freed: string[] = [];
    const loaded: HTMLMediaElement[] = [];
    const played: HTMLMediaElement[] = [];
    Object.assign(URL, {
      createObjectURL: (): string => {
        const url = `blob:silence-${String(made.length)}`;
        made.push(url);
        return url;
      },
      revokeObjectURL: (url: string): void => {
        freed.push(url);
      },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      played.push(this);
      return Promise.resolve();
    });
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function (this: HTMLMediaElement) {
      loaded.push(this);
    });
    return { made, freed, loaded, played };
  }

  /** Timers that wait until told: each waiting one, with how long it was asked to wait. */
  function heldTimers(): SilenceTimers & { waiting: Map<number, { run: () => void; ms: number }>; runAll(): void } {
    const waiting = new Map<number, { run: () => void; ms: number }>();
    let made = 0;
    return {
      waiting,
      setTimeout: (run, ms) => {
        made += 1;
        waiting.set(made, { run, ms });
        return made as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (id) => {
        waiting.delete(id as unknown as number);
      },
      runAll: () => {
        const due = [...waiting.values()];
        waiting.clear();
        for (const { run } of due) {
          run();
        }
      },
    };
  }

  it('is held when the music is over, and let go of altogether only once it has stayed over a while', () => {
    const browser = stubTheBrowser();
    const timers = heldTimers();
    const silence = new LoopedSilence(timers);

    silence.play();
    const [element] = browser.played;
    expect(element?.getAttribute('src')).toBe('blob:silence-0');
    expect(element?.loop).toBe(true);
    // Held, it is the same element, kept to play on.
    silence.pause();
    silence.play();
    expect(browser.played).toEqual([element, element]);
    expect(browser.made).toHaveLength(1);

    // Over: held at once, and nothing emptied - played again soon, it is the
    // same element, begun once rather than made again.
    const paused = vi.mocked(HTMLMediaElement.prototype.pause);
    paused.mockClear();
    silence.release();
    expect(paused).toHaveBeenCalledTimes(1);
    expect(element?.getAttribute('src')).toBe('blob:silence-0');
    expect([...timers.waiting.values()].map(({ ms }) => ms)).toEqual([LET_GO_AFTER_MS]);
    // Long enough for a run of starts and stops at the keys.
    expect(LET_GO_AFTER_MS).toBeGreaterThanOrEqual(10_000);
    silence.play();
    expect(timers.waiting.size).toBe(0);
    expect(browser.made).toHaveLength(1);
    expect(browser.played.at(-1)).toBe(element);

    // Over, and over twice, it waits once; once the wait is out, emptied as a
    // media element is let go of: no source, loaded again, its file freed.
    silence.release();
    silence.release();
    expect(timers.waiting.size).toBe(1);
    timers.runAll();
    expect(element?.hasAttribute('src')).toBe(false);
    expect(browser.loaded).toEqual([element]);
    expect(browser.freed).toEqual(['blob:silence-0']);

    // Let go of again, nothing more to wait for; played again, a new one.
    silence.release();
    expect(timers.waiting.size).toBe(0);
    silence.play();
    expect(browser.made).toEqual(['blob:silence-0', 'blob:silence-1']);
    expect(browser.played.at(-1)).not.toBe(element);
  });

  it('tells the playback timings when it is asked to play and when it begins', () => {
    const browser = stubTheBrowser();
    const silence = new LoopedSilence();
    beginThePlaybackTimings();
    const happened = (): string[] =>
      thePlaybackTimingsText('')
        .split('\n')
        .filter((line) => line.includes('silence'))
        .map((line) => line.trim().replace(/^\+?\d+ +/, ''));

    silence.play();
    silence.pause();
    silence.play();
    browser.played[0]?.dispatchEvent(new Event('playing'));

    expect(happened()).toEqual([
      "the media keys' silence asked to play",
      "the media keys' silence asked to play",
      "the media keys' silence began playing",
    ]);
  });

  it('asks nothing of the browser while it is playing already', () => {
    const browser = stubTheBrowser();
    const silence = new LoopedSilence();
    beginThePlaybackTimings();

    silence.play();
    const [element] = browser.played;
    if (element === undefined) {
      throw new Error('Nothing played.');
    }
    Object.defineProperty(element, 'paused', { configurable: true, value: false });
    silence.play();
    silence.play();

    expect(browser.played).toEqual([element]);
    expect(thePlaybackTimingsText('').split('\n').filter((line) => line.includes('asked to play'))).toHaveLength(1);
  });

  it('lets go of nothing it never made', () => {
    const browser = stubTheBrowser();
    const timers = heldTimers();

    new LoopedSilence(timers).release();

    expect([browser.freed, browser.loaded]).toEqual([[], []]);
    // Nor waits to.
    expect(timers.waiting.size).toBe(0);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoopedSilence, theMediaSession } from '../../src/infrastructure/media/MediaSessionKeys.js';
import { beginThePlaybackTimings, thePlaybackTimingsText } from '../../src/shared/playbackTimings.js';
import { theLatestPlayback } from '../support/playbackTimings.js';

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

  it('is held with the music, and let go of altogether when asked, its file freed, and made again for the next', () => {
    const browser = stubTheBrowser();
    const silence = new LoopedSilence();

    silence.play();
    const [element] = browser.played;
    expect(element?.getAttribute('src')).toBe('blob:silence-0');
    expect(element?.loop).toBe(true);
    // Held, it is the same element, kept to play on.
    silence.pause();
    silence.play();
    expect(browser.played).toEqual([element, element]);
    expect(browser.made).toHaveLength(1);

    silence.release();
    // Emptied as a media element is let go of: no source, loaded again.
    expect(element?.hasAttribute('src')).toBe(false);
    expect(browser.loaded).toEqual([element]);
    expect(browser.freed).toEqual(['blob:silence-0']);

    // Let go of twice, nothing more; played again, a new one.
    silence.release();
    expect(browser.freed).toHaveLength(1);
    silence.play();
    expect(browser.made).toEqual(['blob:silence-0', 'blob:silence-1']);
    expect(browser.played.at(-1)).not.toBe(element);
  });

  it('is begun ahead of the music and held as soon as it plays, once, and plays on for music asked for meanwhile', () => {
    const browser = stubTheBrowser();
    const paused = vi.mocked(HTMLMediaElement.prototype.pause);

    // Ahead of any music: begun, and held once it is playing.
    const ahead = new LoopedSilence();
    ahead.prime();
    ahead.prime();
    const [element] = browser.played;
    expect(browser.played).toEqual([element]);
    expect(browser.made).toHaveLength(1);
    paused.mockClear();
    element?.dispatchEvent(new Event('playing'));
    expect(paused).toHaveBeenCalledTimes(1);
    // The music then plays the same element, begun already.
    Object.defineProperty(element, 'paused', { configurable: true, value: true });
    ahead.play();
    expect(browser.made).toHaveLength(1);
    expect(browser.played.at(-1)).toBe(element);
    // And held with the music no longer, playing again is the music's.
    paused.mockClear();
    element?.dispatchEvent(new Event('playing'));
    expect(paused).not.toHaveBeenCalled();

    // The music asked for while it is still beginning: not held when it begins.
    const meanwhile = new LoopedSilence();
    meanwhile.prime();
    const begun = browser.played.at(-1);
    meanwhile.play();
    paused.mockClear();
    begun?.dispatchEvent(new Event('playing'));
    expect(paused).not.toHaveBeenCalled();

    // Begun by the music, it is not begun again ahead of it.
    const later = new LoopedSilence();
    later.play();
    const count = browser.played.length;
    later.prime();
    expect(browser.played).toHaveLength(count);

    // Let go of while the music played: begun ahead again, it is held again.
    later.release();
    later.prime();
    paused.mockClear();
    browser.played.at(-1)?.dispatchEvent(new Event('playing'));
    expect(paused).toHaveBeenCalledTimes(1);

    // The music held before it had begun: held as it begins.
    const quick = new LoopedSilence();
    quick.play();
    quick.pause();
    paused.mockClear();
    browser.played.at(-1)?.dispatchEvent(new Event('playing'));
    expect(paused).toHaveBeenCalledTimes(1);
  });

  it('tells the playback timings when it is asked to play and when it begins', () => {
    const browser = stubTheBrowser();
    const silence = new LoopedSilence();
    beginThePlaybackTimings();
    const happened = (): string[] => theLatestPlayback(thePlaybackTimingsText('')).happened;

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
    expect(theLatestPlayback(thePlaybackTimingsText('')).happened).toEqual(["the media keys' silence asked to play"]);
  });

  it('is let go of by the page\'s own media session when the page is put away or its window left with nothing playing', () => {
    const browser = stubTheBrowser();
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: { metadata: null, playbackState: 'none', setActionHandler: () => undefined },
    });
    const shown = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    try {
      const keys = theMediaSession();
      keys.prime();
      const [element] = browser.played;
      expect(element).toBeDefined();

      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(browser.loaded).toEqual([]);
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      expect(browser.loaded).toEqual([element]);

      // And its window left for another, the page still showing: begun again by a touch, and let go of.
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      keys.prime();
      const again = browser.played.at(-1);
      expect([again === element, browser.loaded]).toEqual([false, [element]]);
      window.dispatchEvent(new Event('blur'));
      expect(browser.loaded).toEqual([element, again]);
    } finally {
      Reflect.deleteProperty(navigator, 'mediaSession');
      Reflect.deleteProperty(document, 'visibilityState');
      if (shown !== undefined) {
        Object.defineProperty(Document.prototype, 'visibilityState', shown);
      }
    }
  });

  it('lets go of nothing it never made', () => {
    const browser = stubTheBrowser();

    new LoopedSilence().release();

    expect([browser.freed, browser.loaded]).toEqual([[], []]);
  });
});

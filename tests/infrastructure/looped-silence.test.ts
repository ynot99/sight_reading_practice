// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoopedSilence } from '../../src/infrastructure/media/MediaSessionKeys.js';

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

  it('is let go of altogether when the music is over, its file freed, and made again for the next', () => {
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

  it('lets go of nothing it never made', () => {
    const browser = stubTheBrowser();

    new LoopedSilence().release();

    expect([browser.freed, browser.loaded]).toEqual([[], []]);
  });
});

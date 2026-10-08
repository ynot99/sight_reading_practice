// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  drawTheKeyboard,
  HIGHEST_KEY,
  isBlackKey,
  keepInView,
  lightTheKeys,
  LOWEST_KEY,
  scrollToShow,
  whereTheKeysAre,
} from '../../src/ui/replayKeys.js';
import type { KeyShade } from '../../src/application/runReplay.js';

function aKeyboard(): ReturnType<typeof drawTheKeyboard> {
  const host = document.createElement('div');
  document.body.append(host);
  return drawTheKeyboard(host);
}

describe('the keyboard a run is shown again over', () => {
  it('has all eighty-eight keys, from A0 to C8, the black ones in their places', () => {
    const keyboard = aKeyboard();
    const whites = [...keyboard.row.children];

    expect(keyboard.keys.size).toBe(88);
    expect(whites).toHaveLength(52);
    expect(whites[0]?.getAttribute('data-midi')).toBe(String(LOWEST_KEY));
    expect(whites.at(-1)?.getAttribute('data-midi')).toBe(String(HIGHEST_KEY));
    // A#0 stands on A0, and middle C has C# on it and nothing before it.
    expect(keyboard.keys.get(22)?.parentElement).toBe(keyboard.keys.get(21));
    expect(keyboard.keys.get(61)?.parentElement).toBe(keyboard.keys.get(60));
    expect(keyboard.keys.get(64)?.children).toHaveLength(0);
    expect([...keyboard.keys.keys()].filter(isBlackKey)).toHaveLength(36);
  });

  it('puts the lane the notes fall through over the row, inside what scrolls', () => {
    const keyboard = aKeyboard();

    expect(keyboard.lane.tagName).toBe('CANVAS');
    // In the one track as the row, and above it, so the two scroll as one.
    const track = keyboard.row.parentElement;
    expect(track?.parentElement).toBe(keyboard.scroller);
    expect(keyboard.lane.parentElement?.parentElement).toBe(track);
    expect(track?.firstElementChild).toBe(keyboard.lane.parentElement);
    expect(track?.lastElementChild).toBe(keyboard.row);
  });

  it('says where each key stands along the row, a black one from the white one it stands on', () => {
    const keyboard = aKeyboard();
    const lay = (element: HTMLElement | undefined, sizes: Record<string, number>): void => {
      for (const [name, value] of Object.entries(sizes)) {
        Object.defineProperty(element, name, { value, configurable: true });
      }
    };
    lay(keyboard.keys.get(60), { offsetLeft: 322, offsetWidth: 14 });
    lay(keyboard.keys.get(61), { offsetLeft: 10, offsetWidth: 8 });

    const places = whereTheKeysAre(keyboard);

    expect(places.size).toBe(88);
    expect(places.get(60)).toEqual({ left: 322, width: 14 });
    expect(places.get(61)).toEqual({ left: 332, width: 8 });
  });

  it('lights the keys down in their verdicts, puts the rest out, and says the pedal', () => {
    const keyboard = aKeyboard();
    const shade = (midi: number): string | undefined => keyboard.keys.get(midi)?.dataset['shade'];

    lightTheKeys(keyboard, new Map<number, KeyShade>([[60, 'perfect'], [61, 'wrong']]), true);

    expect(shade(60)).toBe('perfect');
    expect(shade(61)).toBe('wrong');
    expect(shade(62)).toBeUndefined();
    expect(keyboard.pedal.dataset['down']).toBe('true');

    lightTheKeys(keyboard, new Map<number, KeyShade>([[62, 'good']]), false);

    expect(shade(60)).toBeUndefined();
    expect(shade(61)).toBeUndefined();
    expect(shade(62)).toBe('good');
    expect(keyboard.pedal.dataset['down']).toBe('false');
  });

  it('keeps the light a key was lit in after it comes up, so it fades out in that colour', () => {
    const keyboard = aKeyboard();
    const lit = (midi: number): string | undefined => keyboard.keys.get(midi)?.dataset['lit'];

    lightTheKeys(keyboard, new Map<number, KeyShade>([[60, 'wrong']]), false);
    lightTheKeys(keyboard, new Map<number, KeyShade>(), false);

    expect(keyboard.keys.get(60)?.dataset['shade']).toBeUndefined();
    expect(lit(60)).toBe('wrong');
    // Never lit, never coloured.
    expect(lit(62)).toBeUndefined();

    // Lit again in another light, that is the colour it fades in next.
    lightTheKeys(keyboard, new Map<number, KeyShade>([[60, 'perfect']]), false);
    expect(lit(60)).toBe('perfect');
  });

  it('touches nothing that has not changed', async () => {
    // Asked on every frame of a replay, and a handful of eighty-eight change.
    const keyboard = aKeyboard();
    const down = new Map<number, KeyShade>([[60, 'perfect']]);
    lightTheKeys(keyboard, down, true);
    const changes: MutationRecord[] = [];
    const watch = new MutationObserver((records) => changes.push(...records));
    watch.observe(keyboard.scroller.parentElement as HTMLElement, { attributes: true, subtree: true });

    lightTheKeys(keyboard, down, true);
    await Promise.resolve();
    changes.push(...watch.takeRecords());
    watch.disconnect();

    expect(changes).toEqual([]);
  });

  it('scrolls a row too wide for its screen to put a key in the middle, and leaves one that fits', () => {
    const keyboard = aKeyboard();
    const lay = (element: HTMLElement, sizes: Record<string, number>): void => {
      for (const [name, value] of Object.entries(sizes)) {
        Object.defineProperty(element, name, { value, configurable: true });
      }
    };
    lay(keyboard.scroller, { scrollWidth: 728, clientWidth: 360 });
    const c4 = keyboard.keys.get(60) as HTMLElement;
    lay(c4, { offsetLeft: 322, offsetWidth: 14 });

    expect(scrollToShow(keyboard, 60)).toBe(322 + 7 - 180);
    // A black key is found by the white one it stands on.
    expect(scrollToShow(keyboard, 61)).toBe(322 + 7 - 180);

    lay(keyboard.scroller, { scrollWidth: 1100, clientWidth: 1100 });

    expect(scrollToShow(keyboard, 60)).toBeNull();
  });

  it('slides the row round to a key out of sight, and leaves it where the key already shows', () => {
    const keyboard = aKeyboard();
    const lay = (element: HTMLElement, sizes: Record<string, number>): void => {
      for (const [name, value] of Object.entries(sizes)) {
        Object.defineProperty(element, name, { value, configurable: true });
      }
    };
    const slides: number[] = [];
    Object.defineProperty(keyboard.scroller, 'scrollTo', {
      configurable: true,
      value: (options: ScrollToOptions) => {
        slides.push(options.left ?? Number.NaN);
      },
    });
    lay(keyboard.scroller, { scrollWidth: 728, clientWidth: 360, scrollLeft: 0 });
    const c4 = keyboard.keys.get(60) as HTMLElement;

    lay(c4, { offsetLeft: 322, offsetWidth: 14 });
    keepInView(keyboard, 60);
    expect(slides).toEqual([]);

    lay(c4, { offsetLeft: 500, offsetWidth: 14 });
    keepInView(keyboard, 60);
    // A black key is judged by the white one it stands on.
    keepInView(keyboard, 61);
    expect(slides).toEqual([500 + 7 - 180, 500 + 7 - 180]);

    lay(keyboard.scroller, { scrollWidth: 1100, clientWidth: 1100 });
    keepInView(keyboard, 60);
    expect(slides).toHaveLength(2);
  });
});

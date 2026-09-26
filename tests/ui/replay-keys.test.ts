// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  drawTheKeyboard,
  HIGHEST_KEY,
  isBlackKey,
  lightTheKeys,
  LOWEST_KEY,
  scrollToShow,
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
    const whites = [...keyboard.scroller.children];

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
});

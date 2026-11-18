import { describe, expect, it } from 'vitest';
import { A_LOUDNESS_HEARD_EVERY_MS, LoudnessHeard } from '../../src/ui/loudnessHeard.js';

const GAP = A_LOUDNESS_HEARD_EVERY_MS;

function aSlider(): { readonly heard: LoudnessHeard; readonly at: number[] } {
  const at: number[] = [];
  return { heard: new LoudnessHeard((atMs) => at.push(atMs)), at };
}

describe('a loudness heard as its slider moves', () => {
  it('is heard as the slider starts to move', () => {
    const { heard, at } = aSlider();

    heard.moved('55', 1_000);

    expect(at).toEqual([1_000]);
  });

  it('is heard no more often than its gap, however often the slider moves', () => {
    const { heard, at } = aSlider();

    // A value for every few milliseconds, as a finger dragging sends them.
    for (let now = 0; now <= 3 * GAP; now += 10) {
      heard.moved(String(now), now);
    }

    expect(at).toEqual([0, GAP, 2 * GAP, 3 * GAP]);
  });

  it('is heard again the moment its gap is over, and not a moment before', () => {
    const { heard, at } = aSlider();
    heard.moved('40', 0);

    heard.moved('41', GAP - 1);
    heard.moved('42', GAP);

    expect(at).toEqual([0, GAP]);
  });

  it('is heard where it is let go of, once the last one has had its time', () => {
    const { heard, at } = aSlider();
    heard.moved('40', 0);
    heard.moved('45', 100);

    heard.letGo('45', 100);

    // Not on top of the one just heard: after it, at the loudness left.
    expect(at).toEqual([0, GAP]);
  });

  it('is heard at once where it is let go of after a pause', () => {
    const { heard, at } = aSlider();
    heard.moved('40', 0);
    heard.moved('45', 100);

    heard.letGo('45', 2 * GAP);

    expect(at).toEqual([0, 2 * GAP]);
  });

  it('is not heard twice where it is let go of at the loudness just heard', () => {
    const { heard, at } = aSlider();
    heard.moved('40', 0);

    heard.letGo('40', 50);

    expect(at).toEqual([0]);
  });

  it('keeps its gap after the one heard where it was let go of', () => {
    const { heard, at } = aSlider();
    heard.moved('40', 0);
    heard.letGo('45', 100);

    heard.moved('50', GAP + 100);
    heard.moved('55', 2 * GAP);

    expect(at).toEqual([0, GAP, 2 * GAP]);
  });
});

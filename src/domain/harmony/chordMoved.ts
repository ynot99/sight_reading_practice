import type { ChordKind } from './chordName.js';

/**
 * The furthest a voice is looked for a tone of the new chord, either way:
 * every tone is within half of it, and one no other key is on within all of it.
 */
const AN_OCTAVE = 12;

/**
 * The tones of a chord, by their steps over its root, in the order a voice
 * is spared for them: the third, or what stands for it in a suspended chord,
 * then the seventh or the sixth, then the rest - the fifth last, being the
 * one the ear supplies.
 */
const TONES_FIRST = [3, 4, 5, 2, 10, 11, 9, 6, 8, 7];

/**
 * Where each key of a chord goes for the chord to become another, as a
 * pianist moves from one to the next: the lowest to the new root, as near as
 * it is and still under the keys above it; each of the others to the tone of
 * the new chord nearest it, the lower where two are as near; and each tone the new chord cannot do without that is then
 * nowhere, the third first - it says major or minor - to the nearest of the
 * voices doubling another tone. A fifth left out is a chord only where its
 * kind lets it go, and three keys of C left as F, F and A are no chord at all. As many keys as there were, each on a pitch of its own - never on
 * one another key goes to, nor on one of the notes staying where they are:
 * two of one pitch at once are one key struck twice.
 *
 * Keys are moved by pitch, so a key struck again and again goes to the same
 * place each time, and a broken chord stays broken the same way.
 */
export function theChordMovedTo(
  midis: readonly number[],
  to: { readonly root: number; readonly kind: ChordKind },
  staying: readonly number[] = [],
): ReadonlyMap<number, number> {
  const [bass, ...upper] = [...new Set(midis)].sort((low, high) => low - high);
  const moved = new Map<number, number>();
  if (bass === undefined) {
    return moved;
  }
  const pitchClass = (midi: number): number => ((midi % 12) + 12) % 12;
  const tones = to.kind.intervals.map((step) => (to.root + step) % 12);
  /**
   * The keys with one of these pitch classes nearest a key, nearest first,
   * the lower first where two are as near, and none another key is on.
   */
  const nearest = (midi: number, pitchClasses: readonly number[], self: number): number[] => {
    const taken = new Set([...staying, ...[...moved].filter(([from]) => from !== self).map(([, onto]) => onto)]);
    const found: number[] = [];
    for (let away = 0; away <= AN_OCTAVE; away += 1) {
      for (const each of away === 0 ? [midi] : [midi - away, midi + away]) {
        if (pitchClasses.includes(pitchClass(each)) && !taken.has(each)) {
          found.push(each);
        }
      }
    }
    return found;
  };
  const root = nearest(bass, [to.root], bass)[0] ?? bass;
  const above = upper[0];
  moved.set(bass, above !== undefined && root > above ? root - 12 : root);
  for (const voice of upper) {
    moved.set(voice, nearest(voice, tones, voice)[0] ?? voice);
  }
  // Each tone the new chord cannot do without, the third first, to the
  // nearest voice doubling another, as long as there is one to spare.
  const wanted = to.kind.intervals
    .filter((step) => step !== 0 && !(step === 7 && to.kind.fifthMayGo))
    .sort((one, other) => TONES_FIRST.indexOf(one) - TONES_FIRST.indexOf(other));
  for (const step of wanted) {
    const tone = (to.root + step) % 12;
    const now = [...moved.values()].map(pitchClass);
    if (now.includes(tone)) {
      continue;
    }
    const doubled = upper.filter((voice) => now.filter((each) => each === pitchClass(moved.get(voice) ?? voice)).length > 1);
    const nearestTone = (voice: number): number => nearest(moved.get(voice) ?? voice, [tone], voice)[0] ?? voice;
    const goes = doubled.sort(
      (one, other) =>
        Math.abs(nearestTone(one) - (moved.get(one) ?? one)) - Math.abs(nearestTone(other) - (moved.get(other) ?? other)),
    )[0];
    if (goes !== undefined) {
      moved.set(goes, nearestTone(goes));
    }
  }
  return moved;
}

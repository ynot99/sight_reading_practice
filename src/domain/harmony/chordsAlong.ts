import {
  theChordMostOfTheNotesMake,
  theNumeralOfTheChord,
  type ChordHeard,
  type ChordKind,
  type ChordMostlyHeard,
} from './chordName.js';
import { thePitchClassesOfTheScale, type ScaleName } from './scales.js';

/** A note sounding from one moment until another. */
export interface NoteSounding {
  readonly midi: number;
  readonly fromMs: number;
  readonly untilMs: number;
}

/** A bar: when each of its beats falls, the first being where it begins, and where it ends. */
export interface BarOfBeats {
  readonly beatsMs: readonly number[];
  readonly untilMs: number;
}

/** A key the music is in from a moment, as far as the next. */
export interface KeyFrom {
  readonly fromMs: number;
  readonly fifths: number;
  readonly scale: ScaleName;
}

/** A chord the music makes for a stretch: its name, its degree in the key there, and whether exactly. */
export interface ChordAlong {
  readonly fromMs: number;
  readonly untilMs: number;
  readonly name: string;
  readonly numeral: string;
  readonly exactly: boolean;
  /** Its root, as a pitch class, and its kind: which pitches are its tones. */
  readonly root: number;
  readonly kind: ChordKind;
}

/**
 * What a change of chord costs, as a share of how long all the notes of the
 * bar it cuts sound: two chords have to account for that much more of it
 * than one does to be heard as two. Enough that a melody note on a beat of
 * its own, or a chord held a moment into the next bar, does not cut the
 * bar; little enough that a chord changing partway through it does.
 */
const A_CHANGE_COSTS = 0.1;

/**
 * The chords the music makes, bar by bar, as a lead sheet writes them over
 * it: read off the notes sounding, each as long as it sounds there (see
 * `theChordMostOfTheNotesMake`), so a melody's passing notes do not make a
 * bar of A minor A minor add nine.
 *
 * A bar is read as the stretches of whole beats it is best read as: each
 * stretch the chord it mostly is, worth what that reading is worth, and
 * every cut between two costing what a change of chord costs (see
 * `A_CHANGE_COSTS`). So a melody note on a beat of its own, an arpeggio
 * passing a beat at a time, or a chord held a moment into the next bar does
 * not cut the bar, and a change of chord partway through it - on every
 * beat, even - does. The same chord on from one stretch to the next is
 * one stretch; where nothing makes a chord, there is none.
 */
export function theChordsAlongTheBars(
  notes: readonly NoteSounding[],
  bars: readonly BarOfBeats[],
  keys: readonly KeyFrom[],
): readonly ChordAlong[] {
  const keyAt = (atMs: number): KeyFrom =>
    keys.filter((key) => key.fromMs <= atMs).at(-1) ?? keys[0] ?? { fromMs: 0, fifths: 0, scale: 'major' };
  const soundingIn = (fromMs: number, untilMs: number): { readonly midi: number; readonly lengthMs: number }[] =>
    notes
      .map((note) => ({ midi: note.midi, lengthMs: Math.min(untilMs, note.untilMs) - Math.max(fromMs, note.fromMs) }))
      .filter((note) => note.lengthMs > 0);
  const read = (fromMs: number, untilMs: number): ChordMostlyHeard | null => {
    const sounding = soundingIn(fromMs, untilMs);
    return sounding.length === 0 ? null : theChordMostOfTheNotesMake(sounding, keyAt(fromMs).fifths);
  };
  const along: ChordAlong[] = [];
  const write = (fromMs: number, untilMs: number, chord: ChordHeard): void => {
    const key = keyAt(fromMs);
    const numeral = theNumeralOfTheChord(chord, thePitchClassesOfTheScale(key.fifths, key.scale));
    const before = along.at(-1);
    if (before !== undefined && before.untilMs === fromMs && before.name === chord.name && before.numeral === numeral) {
      along[along.length - 1] = { ...before, untilMs, exactly: before.exactly && chord.exactly };
    } else {
      along.push({ fromMs, untilMs, name: chord.name, numeral, exactly: chord.exactly, root: chord.root, kind: chord.kind });
    }
  };
  const readTheBar = (moments: readonly number[]): void => {
    const cost =
      A_CHANGE_COSTS * soundingIn(moments[0] ?? 0, moments.at(-1) ?? 0).reduce((sum, note) => sum + note.lengthMs, 0);
    // The best reading of the bar as far as each beat: what it is worth, and
    // the beat its last stretch begins on.
    const best: { readonly worth: number; readonly from: number }[] = [{ worth: 0, from: 0 }];
    for (let until = 1; until < moments.length; until += 1) {
      let chosen = { worth: Number.NEGATIVE_INFINITY, from: 0 };
      for (let from = 0; from < until; from += 1) {
        const stretch = read(moments[from] ?? 0, moments[until] ?? 0);
        // Every stretch is charged a change, the first too: the same to every
        // reading, and so nothing between them.
        const worth = (best[from]?.worth ?? 0) + (stretch?.worth ?? 0) - cost;
        if (worth > chosen.worth) {
          chosen = { worth, from };
        }
      }
      best.push(chosen);
    }
    const ends: number[] = [];
    for (let at = moments.length - 1; at > 0; at = best[at]?.from ?? 0) {
      ends.unshift(at);
    }
    let from = 0;
    for (const until of ends) {
      const fromMs = moments[from] ?? 0;
      const untilMs = moments[until] ?? 0;
      const stretch = read(fromMs, untilMs);
      if (stretch !== null) {
        write(fromMs, untilMs, stretch);
      }
      from = until;
    }
  };
  for (const bar of bars) {
    readTheBar([...bar.beatsMs, bar.untilMs]);
  }
  return along;
}

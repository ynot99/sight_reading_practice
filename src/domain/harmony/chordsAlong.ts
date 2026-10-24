import {
  theChordMostOfTheNotesMake,
  theNumeralOfTheChord,
  type ChordHeard,
  type ChordKind,
  type ChordMostlyHeard,
} from './chordName.js';
import type { ScaleName } from './scales.js';

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
  /** The key it is read in, which its numeral is the degree of. */
  readonly key: { readonly fifths: number; readonly scale: ScaleName };
}

/** The sustain pedal down from a moment until another, or on to the end where nobody let it up. */
export interface PedalDown {
  readonly downAtMs: number;
  readonly upAtMs: number | null;
}

/**
 * The notes as they sound with the pedal: one let go of while the pedal is
 * down rings on until the pedal comes up or its key is struck again, as a
 * string rings with its damper held off, over a bar line as much as within
 * a bar. Without it, a broken chord in the bass - its third a quaver at the
 * start of the bar - is heard without its third.
 *
 * But a pedal never let up before the music ends is no pedalling: a score
 * marks it once so for a whole piece, to be changed with the harmony as the
 * pianist hears it. Under that, a note rings to the end of the bar it began
 * in and no further, the chords being read a bar at a time - carried on, it
 * would be heard in every chord after it.
 */
export function theNotesThePedalHolds(
  notes: readonly NoteSounding[],
  pedal: readonly PedalDown[],
  bars: readonly BarOfBeats[],
): readonly NoteSounding[] {
  if (pedal.length === 0) {
    return notes;
  }
  const theMusicEnds = Math.max(...notes.map((note) => note.untilMs));
  const strikesOfEachKey = new Map<number, number[]>();
  for (const note of notes) {
    strikesOfEachKey.set(note.midi, [...(strikesOfEachKey.get(note.midi) ?? []), note.fromMs]);
  }
  return notes.map((note) => {
    const held = pedal.find((down) => down.downAtMs <= note.untilMs && (down.upAtMs ?? Number.POSITIVE_INFINITY) > note.untilMs);
    const bar = bars.find((each) => (each.beatsMs[0] ?? each.untilMs) <= note.fromMs && note.fromMs < each.untilMs);
    if (held === undefined || bar === undefined) {
      return note;
    }
    const struckAgain = Math.min(...(strikesOfEachKey.get(note.midi) ?? []).filter((atMs) => atMs > note.fromMs));
    const neverLetUp = held.upAtMs === null || held.upAtMs >= theMusicEnds;
    const untilMs = Math.min(held.upAtMs ?? Number.POSITIVE_INFINITY, struckAgain, neverLetUp ? bar.untilMs : Number.POSITIVE_INFINITY);
    return untilMs > note.untilMs ? { ...note, untilMs } : note;
  });
}

/**
 * The notes sounding in each bar, a list for each: a note held across a
 * bar line is in both. The bars are in time order, as a piece's are.
 */
export function theNotesOfEachBar(
  notes: readonly NoteSounding[],
  bars: readonly BarOfBeats[],
): readonly (readonly NoteSounding[])[] {
  const ofEachBar: NoteSounding[][] = bars.map(() => []);
  for (const note of notes) {
    // The first bar ending after the note begins, found by halving; then on while each begins before it ends.
    let low = 0;
    let high = bars.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((bars[middle]?.untilMs ?? 0) > note.fromMs) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    for (let index = low; index < bars.length; index += 1) {
      const bar = bars[index];
      if (bar === undefined || (bar.beatsMs[0] ?? bar.untilMs) >= note.untilMs) {
        break;
      }
      ofEachBar[index]?.push(note);
    }
  }
  return ofEachBar;
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
  const soundingIn = (
    among: readonly NoteSounding[],
    fromMs: number,
    untilMs: number,
  ): { readonly midi: number; readonly lengthMs: number }[] =>
    among
      .map((note) => ({ midi: note.midi, lengthMs: Math.min(untilMs, note.untilMs) - Math.max(fromMs, note.fromMs) }))
      .filter((note) => note.lengthMs > 0);
  const read = (among: readonly NoteSounding[], fromMs: number, untilMs: number): ChordMostlyHeard | null => {
    const sounding = soundingIn(among, fromMs, untilMs);
    const key = keyAt(fromMs);
    return sounding.length === 0 ? null : theChordMostOfTheNotesMake(sounding, key.fifths, key.scale);
  };
  const along: ChordAlong[] = [];
  const write = (fromMs: number, untilMs: number, chord: ChordHeard): void => {
    const key = keyAt(fromMs);
    const numeral = theNumeralOfTheChord(chord, key);
    const before = along.at(-1);
    if (before !== undefined && before.untilMs === fromMs && before.name === chord.name && before.numeral === numeral) {
      along[along.length - 1] = { ...before, untilMs, exactly: before.exactly && chord.exactly };
    } else {
      along.push({
        fromMs,
        untilMs,
        name: chord.name,
        numeral,
        exactly: chord.exactly,
        root: chord.root,
        kind: chord.kind,
        key: { fifths: key.fifths, scale: key.scale },
      });
    }
  };
  const readTheBar = (moments: readonly number[], among: readonly NoteSounding[]): void => {
    const cost =
      A_CHANGE_COSTS * soundingIn(among, moments[0] ?? 0, moments.at(-1) ?? 0).reduce((sum, note) => sum + note.lengthMs, 0);
    // The best reading of the bar as far as each beat: what it is worth, and
    // the beat its last stretch begins on.
    const best: { readonly worth: number; readonly from: number }[] = [{ worth: 0, from: 0 }];
    for (let until = 1; until < moments.length; until += 1) {
      let chosen = { worth: Number.NEGATIVE_INFINITY, from: 0 };
      for (let from = 0; from < until; from += 1) {
        const stretch = read(among, moments[from] ?? 0, moments[until] ?? 0);
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
      const stretch = read(among, fromMs, untilMs);
      if (stretch !== null) {
        write(fromMs, untilMs, stretch);
      }
      from = until;
    }
  };
  // Each bar read among its own notes: a stretch of it is read many times
  // over, and a score's thousands of notes each time cost a long score half
  // a minute.
  const ofEachBar = theNotesOfEachBar(notes, bars);
  for (const [index, bar] of bars.entries()) {
    readTheBar([...bar.beatsMs, bar.untilMs], ofEachBar[index] ?? []);
  }
  return along;
}

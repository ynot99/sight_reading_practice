import { floorMod } from '../../shared/asserts.js';
import { STEPS, alterationSign, type Alteration } from '../model/Pitch.js';
import { theTonicOfTheScale, thePitchClassesOfTheScale, type ScaleName } from './scales.js';

/**
 * What a chord is called, read off the keys held down.
 *
 * Only what the notes are, never where they lie: the octave a note is played
 * in and how often it is doubled change nothing, except that the lowest note
 * is the bass, and a bass that is not the root is said after a slash.
 */

/** A kind of chord: its intervals above the root, in semitones, and its name after the root. */
export interface ChordKind {
  readonly suffix: string;
  readonly intervals: readonly number[];
  /**
   * Whether it is still this chord with the fifth left out, as a pianist
   * leaves it out of a seventh or a ninth to free a finger. Never where the
   * fifth is what the chord is - diminished, augmented, half-diminished.
   */
  readonly fifthMayGo: boolean;
  /** Whether its third is minor, which writes its degree in lower case. */
  readonly minor: boolean;
  /** What its degree is written with after the numeral: G7 is V7, B diminished vii°. */
  readonly afterTheNumeral: string;
}

/**
 * Every chord that is named, in the order a reading is preferred when two
 * fit the same notes and neither stands on its root in the bass: the plainer
 * first. C E G A over an E is A minor seventh before it is C sixth.
 */
export const CHORD_KINDS: readonly ChordKind[] = [
  { suffix: '', intervals: [0, 4, 7], fifthMayGo: false, minor: false, afterTheNumeral: '' },
  { suffix: 'm', intervals: [0, 3, 7], fifthMayGo: false, minor: true, afterTheNumeral: '' },
  { suffix: 'dim', intervals: [0, 3, 6], fifthMayGo: false, minor: true, afterTheNumeral: '°' },
  { suffix: '+', intervals: [0, 4, 8], fifthMayGo: false, minor: false, afterTheNumeral: '+' },
  { suffix: 'sus4', intervals: [0, 5, 7], fifthMayGo: false, minor: false, afterTheNumeral: 'sus4' },
  { suffix: 'sus2', intervals: [0, 2, 7], fifthMayGo: false, minor: false, afterTheNumeral: 'sus2' },
  { suffix: '7', intervals: [0, 4, 7, 10], fifthMayGo: true, minor: false, afterTheNumeral: '7' },
  { suffix: 'maj7', intervals: [0, 4, 7, 11], fifthMayGo: true, minor: false, afterTheNumeral: 'maj7' },
  { suffix: 'm7', intervals: [0, 3, 7, 10], fifthMayGo: true, minor: true, afterTheNumeral: '7' },
  { suffix: 'm7♭5', intervals: [0, 3, 6, 10], fifthMayGo: false, minor: true, afterTheNumeral: 'ø7' },
  { suffix: 'dim7', intervals: [0, 3, 6, 9], fifthMayGo: false, minor: true, afterTheNumeral: '°7' },
  { suffix: 'm(maj7)', intervals: [0, 3, 7, 11], fifthMayGo: true, minor: true, afterTheNumeral: '(maj7)' },
  { suffix: '7sus4', intervals: [0, 5, 7, 10], fifthMayGo: false, minor: false, afterTheNumeral: '7sus4' },
  { suffix: '6', intervals: [0, 4, 7, 9], fifthMayGo: false, minor: false, afterTheNumeral: '6' },
  { suffix: 'm6', intervals: [0, 3, 7, 9], fifthMayGo: false, minor: true, afterTheNumeral: '6' },
  { suffix: 'add9', intervals: [0, 2, 4, 7], fifthMayGo: false, minor: false, afterTheNumeral: 'add9' },
  { suffix: 'm(add9)', intervals: [0, 2, 3, 7], fifthMayGo: false, minor: true, afterTheNumeral: '(add9)' },
  { suffix: '9', intervals: [0, 2, 4, 7, 10], fifthMayGo: true, minor: false, afterTheNumeral: '9' },
  { suffix: 'maj9', intervals: [0, 2, 4, 7, 11], fifthMayGo: true, minor: false, afterTheNumeral: 'maj9' },
  { suffix: 'm9', intervals: [0, 2, 3, 7, 10], fifthMayGo: true, minor: true, afterTheNumeral: '9' },
  { suffix: '5', intervals: [0, 7], fifthMayGo: false, minor: false, afterTheNumeral: '5' },
];

/**
 * How the black keys are spelled: as the key signature on the page spells
 * them - sharps in a sharp key, flats in a flat one - and with none, as chord
 * charts do. The white keys keep their own letters.
 */
const SPELLINGS: Readonly<Record<'sharps' | 'flats' | 'charts', readonly string[]>> = {
  sharps: ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'],
  flats: ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'],
  charts: ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'],
};

/** The name of a pitch class, in a key with this many sharps (above nought) or flats (below), or none. */
export function nameOfThePitchClass(pitchClass: number, fifths: number | null): string {
  const spelling = fifths === null || fifths === 0 ? 'charts' : fifths > 0 ? 'sharps' : 'flats';
  return SPELLINGS[spelling][((pitchClass % 12) + 12) % 12] ?? '';
}

/**
 * The name of the chord the keys held make, or `null` where they make none
 * this knows - a single note, which no kind is, or a cluster.
 *
 * Every pitch class held is tried as the root. Where one reading stands on
 * the bass, it wins: C E G A with C below is C sixth, with A below A minor
 * seventh. Otherwise the plainer kind, said over its bass - E G C is C over E.
 * Nothing else is needed to choose: no set of notes is one kind with its
 * fifth and another without it, on the same footing with the bass.
 */
export function nameTheChord(midis: readonly number[], fifths: number | null = null, scale?: ScaleName): string | null {
  return theChordTheKeysMake(midis, fifths, scale)?.name ?? null;
}

/**
 * The chord the keys held make, named as `nameTheChord` names it, with its
 * root and kind: `null` where it names none. In the scale of the key where
 * that is known, its root named as the key has it (see `theNameOfTheRoot`).
 */
export function theChordTheKeysMake(midis: readonly number[], fifths: number | null = null, scale?: ScaleName): ChordHeard | null {
  const read = readTheChord(midis);
  if (read === null) {
    return null;
  }
  const chord = { root: read.root, kind: read.kind };
  const name = `${theNameOfTheRootIn(chord, fifths, scale)}${read.kind.suffix}`;
  return {
    name: read.root === read.bass ? name : `${name}/${theNameOfTheBass(chord, read.bass, fifths, scale)}`,
    exactly: true,
    root: read.root,
    kind: read.kind,
  };
}

/** The root and the kind of the chord some keys make exactly, and their bass: see `nameTheChord`. */
function readTheChord(
  midis: readonly number[],
): { readonly root: number; readonly kind: ChordKind; readonly bass: number } | null {
  const held = [...new Set(midis.map((midi) => ((midi % 12) + 12) % 12))];
  const bass = ((Math.min(...midis) % 12) + 12) % 12;
  const readings: { readonly root: number; readonly kindAt: number }[] = [];
  for (const root of held) {
    const intervals = held.map((pitchClass) => (pitchClass - root + 12) % 12).sort((a, b) => a - b);
    CHORD_KINDS.forEach((kind, kindAt) => {
      const withoutTheFifth = kind.intervals.filter((step) => step !== 7);
      if (sameNumbers(intervals, kind.intervals) || (kind.fifthMayGo && sameNumbers(intervals, withoutTheFifth))) {
        readings.push({ root, kindAt });
      }
    });
  }
  const best = readings.sort(
    (left, right) => Number(right.root === bass) - Number(left.root === bass) || left.kindAt - right.kindAt,
  )[0];
  const kind = best === undefined ? undefined : CHORD_KINDS[best.kindAt];
  return best === undefined || kind === undefined ? null : { root: best.root, kind, bass };
}

/** A chord some notes make, and whether they make exactly it or only mostly. */
export interface ChordHeard {
  readonly name: string;
  readonly exactly: boolean;
  /** Its root, as a pitch class, C being nought. */
  readonly root: number;
  readonly kind: ChordKind;
}

/**
 * What a chord tone costs, as a share of how long all the notes sound
 * together: a tone has to sound at least this much of the time to be heard
 * as part of the chord rather than as a note passing it.
 */
const EACH_TONE_COSTS = 0.15;

/** The share of the sounding a chord has to account for to be named at all. */
const MOSTLY = 0.5;

/**
 * The chord some notes make: exactly, where they make one this knows (see
 * `nameTheChord`), or otherwise the one most of their sounding is (see
 * `theChordMostOfTheNotesMake`). The notes chosen are what is asked about,
 * so a set that makes a chord is named as that chord.
 */
export function theChordTheNotesMake(
  notes: readonly { readonly midi: number; readonly lengthMs: number }[],
  fifths: number | null = null,
  scale?: ScaleName,
): ChordHeard | null {
  return (
    theChordTheKeysMake(
      notes.map((note) => note.midi),
      fifths,
      scale,
    ) ?? theChordMostOfTheNotesMake(notes, fifths, scale)
  );
}

/** A chord most of the sounding of some notes is, and what that reading is worth. */
export interface ChordMostlyHeard extends ChordHeard {
  /**
   * What its tones weigh, less what they cost, in the notes' own lengths:
   * how much of the sounding it accounts for, so two readings of the same
   * notes - as one chord, or as two one after the other - can be weighed.
   */
  readonly worth: number;
}

/**
 * The chord most of the sounding of some notes is - a bar of a broken chord
 * with a melody over it is that chord, though the melody's passing notes
 * make the whole set some other one, or none: what a stretch of music is
 * heard as, where every note sounding in it is counted, the passing ones
 * too. Exactly that chord only where it is every note.
 *
 * Each pitch class weighs as long as its notes sound. A reading is a root
 * and a kind whose every tone is there (the fifth may go where the kind lets
 * it), worth what its tones weigh less what they cost; the best one wins if
 * it accounts for at least half of the sounding, standing on the bass where
 * two are worth the same, as an exact one does. Said over the lowest note
 * where that is another tone of it.
 */
export function theChordMostOfTheNotesMake(
  notes: readonly { readonly midi: number; readonly lengthMs: number }[],
  fifths: number | null = null,
  scale?: ScaleName,
): ChordMostlyHeard | null {
  const weight = new Map<number, number>();
  for (const note of notes) {
    const pitchClass = ((note.midi % 12) + 12) % 12;
    weight.set(pitchClass, (weight.get(pitchClass) ?? 0) + Math.max(note.lengthMs, 1));
  }
  const total = [...weight.values()].reduce((sum, each) => sum + each, 0);
  const lowest = Math.min(...notes.map((note) => note.midi));
  const bass = ((lowest % 12) + 12) % 12;
  // A reading the bass is no tone of loses the bass's sounding again: the
  // harmony stands on the bass, and the same notes over another bass are
  // another chord - D major's over a G is G's. A loss rather than a gain,
  // so a stretch cut where the bass moves is worth no more for it, and the
  // readings that have the bass are weighed between them as before.
  const theBassSounds = notes.filter((note) => note.midi === lowest).reduce((sum, note) => sum + Math.max(note.lengthMs, 1), 0);
  type Reading = { readonly root: number; readonly kindAt: number; readonly tones: readonly number[]; readonly worth: number };
  const readings: Reading[] = [];
  for (let root = 0; root < 12; root += 1) {
    for (const [kindAt, kind] of CHORD_KINDS.entries()) {
      const there = (step: number): boolean => weight.has((root + step) % 12);
      if (!kind.intervals.every((step) => there(step) || (kind.fifthMayGo && step === 7))) {
        continue;
      }
      const tones = kind.intervals.filter(there).map((step) => (root + step) % 12);
      const covered = tones.reduce((sum, tone) => sum + (weight.get(tone) ?? 0), 0);
      if (covered >= MOSTLY * total) {
        const offTheBass = tones.includes(bass) ? 0 : theBassSounds;
        readings.push({ root, kindAt, tones, worth: covered - offTheBass - EACH_TONE_COSTS * total * tones.length });
      }
    }
  }
  const found = readings.sort(
    (left, right) =>
      right.worth - left.worth ||
      Number(right.root === bass) - Number(left.root === bass) ||
      left.kindAt - right.kindAt,
  )[0];
  const kind = found === undefined ? undefined : CHORD_KINDS[found.kindAt];
  if (found === undefined || kind === undefined) {
    return null;
  }
  const chord = { root: found.root, kind };
  const name = `${theNameOfTheRootIn(chord, fifths, scale)}${kind.suffix}`;
  const overTheBass = bass !== found.root && found.tones.includes(bass);
  return {
    name: overTheBass ? `${name}/${theNameOfTheBass(chord, bass, fifths, scale)}` : name,
    exactly: found.tones.length === weight.size,
    root: found.root,
    kind,
    worth: found.worth,
  };
}

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

/** A key a chord is named and numbered in: its signature, and the scale of it the music is in. */
export interface KeyOfTheChord {
  readonly fifths: number;
  readonly scale: ScaleName;
}

/**
 * Where a chord's root stands in a key: the degree it is, by its letter
 * counted from the tonic's, and whether it is raised or lowered from the
 * scale's own note there - one answer for its name and its numeral.
 *
 * A note of the scale is its degree. A root off it is the degree under it
 * raised or the one over it lowered, whichever leaves the chord's notes the
 * fewer the key does not have, each counted by how far it is from the
 * key's note of its letter: F♯ minor in C, not G♭ minor, whose B𝄫 is two
 * off; B♭ in C, not A♯ with its C𝄪; G♯ diminished in A minor, its leading
 * note raised, ♯vii°. Where the two leave as many, as the signature spells
 * the root.
 */
export function theDegreeOfTheRoot(
  chord: { readonly root: number; readonly kind: ChordKind },
  key: KeyOfTheChord,
): { readonly degree: number; readonly alter: -1 | 0 | 1 } {
  const scale = thePitchClassesOfTheScale(key.fifths, key.scale);
  const degreeOf = (pitchClass: number): number => scale.indexOf(floorMod(pitchClass, 12));
  const on = degreeOf(chord.root);
  if (on >= 0) {
    return { degree: on, alter: 0 };
  }
  const tonicLetter = STEPS.indexOf(theTonicOfTheScale(key.fifths, key.scale).step);
  const offTheKey = (degree: number): number =>
    theNotesStackedOn(chord, floorMod(tonicLetter + degree, STEPS.length)).reduce((sum, { letter, pitchClass }) => {
      const ours = scale[floorMod(letter - tonicLetter, STEPS.length)] ?? 0;
      const off = floorMod(pitchClass - ours, 12);
      return sum + Math.min(off, 12 - off);
    }, 0);
  const ways = [
    { degree: degreeOf(chord.root + 1), alter: -1 as const },
    { degree: degreeOf(chord.root - 1), alter: 1 as const },
  ]
    .filter((way) => way.degree >= 0)
    .map((way) => ({ ...way, off: offTheKey(way.degree) }));
  const asSigned = nameOfThePitchClass(chord.root, key.fifths).charAt(0);
  const best = ways.sort(
    (one, other) =>
      one.off - other.off ||
      Number(STEPS[floorMod(tonicLetter + other.degree, STEPS.length)] === asSigned) -
        Number(STEPS[floorMod(tonicLetter + one.degree, STEPS.length)] === asSigned),
  )[0];
  return best === undefined ? { degree: 0, alter: 0 } : { degree: best.degree, alter: best.alter };
}

/** The name of a chord's root in a key: the letter of its degree, raised or lowered as it is (see `theDegreeOfTheRoot`). */
export function theNameOfTheRoot(chord: { readonly root: number; readonly kind: ChordKind }, key: KeyOfTheChord): string {
  const { degree } = theDegreeOfTheRoot(chord, key);
  const letter = floorMod(STEPS.indexOf(theTonicOfTheScale(key.fifths, key.scale).step) + degree, STEPS.length);
  const off = floorMod(chord.root - (NATURAL[letter] ?? 0), 12);
  return `${STEPS[letter] ?? ''}${alterationSign((off > 6 ? off - 12 : off) as Alteration)}`;
}

/** A root's name in the scale of a key where that is known, and as the signature alone spells it where not. */
function theNameOfTheRootIn(
  chord: { readonly root: number; readonly kind: ChordKind },
  fifths: number | null,
  scale: ScaleName | undefined,
): string {
  return fifths === null || scale === undefined ? nameOfThePitchClass(chord.root, fifths) : theNameOfTheRoot(chord, { fifths, scale });
}

/** What each degree of a scale is called, from the tonic up. */
const DEGREE_NAMES = ['tonic', 'supertonic', 'mediant', 'subdominant', 'dominant', 'submediant', 'leading tone'] as const;

/**
 * What the degree a chord stands on is called (see `theDegreeOfTheRoot`):
 * the supertonic, the mediant, and so on. The seventh by how far it is
 * under the tonic, as it is heard: a semitone, the leading tone, which
 * leads up to it; further, the subtonic, which does not - B♭ in C, or G in
 * A minor. Any other degree off the scale, raised or lowered.
 */
export function theNameOfTheDegree(chord: { readonly root: number; readonly kind: ChordKind }, key: KeyOfTheChord): string {
  const { degree, alter } = theDegreeOfTheRoot(chord, key);
  if (degree === 6) {
    const under = floorMod((thePitchClassesOfTheScale(key.fifths, key.scale)[0] ?? 0) - chord.root, 12);
    return under === 1 ? 'leading tone' : 'subtonic';
  }
  const called = DEGREE_NAMES[degree] ?? '';
  return alter === 0 ? called : `${alter > 0 ? 'raised' : 'lowered'} ${called}`;
}

/**
 * A chord's degree in a key, in roman numerals: upper case where its third
 * is major, lower where minor, and what its kind adds after (see
 * `afterTheNumeral`), raised or lowered as its root is (see
 * `theDegreeOfTheRoot`).
 */
export function theNumeralOfTheChord(chord: { readonly root: number; readonly kind: ChordKind }, key: KeyOfTheChord): string {
  const { degree, alter } = theDegreeOfTheRoot(chord, key);
  const numeral = NUMERALS[degree] ?? '';
  const sign = alter < 0 ? '♭' : alter > 0 ? '♯' : '';
  return `${sign}${chord.kind.minor ? numeral.toLowerCase() : numeral}${chord.kind.afterTheNumeral}`;
}

/**
 * The name of a chord's bass, said after the slash: always a tone of the
 * chord, and named as its notes are, a letter a step from the root - E's
 * third is G♯ under it in any key, not the A♭ a key without sharps would
 * call the same key.
 */
function theNameOfTheBass(
  chord: { readonly root: number; readonly kind: ChordKind },
  bass: number,
  fifths: number | null,
  scale: ScaleName | undefined,
): string {
  const step = chord.kind.intervals.indexOf(floorMod(bass - chord.root, 12));
  return theNotesOfTheChordNamed(chord, fifths ?? 0, fifths === null ? undefined : scale)[step] ?? nameOfThePitchClass(bass, fifths);
}

/** The pitch class of each letter unaltered. */
const NATURAL: readonly number[] = [0, 2, 4, 5, 7, 9, 11];

/**
 * How many letters above its root a note of a kind of chord is written: a
 * third two, whatever its size, a fifth four, a seventh six - the
 * diminished seventh's too, though it sounds as a sixth does.
 */
function theLettersAbove(semitones: number, kind: ChordKind): number {
  if (semitones === 9) {
    return kind.intervals.includes(6) && !kind.intervals.includes(10) ? 6 : 5;
  }
  return [0, 1, 1, 2, 2, 3, 4, 4, 4, 5, 6, 6][floorMod(semitones, 12)] ?? 0;
}

/**
 * The names of a chord's notes from its root up: the root as the key names
 * it (see `theNameOfTheRoot`) - or as a key with so many sharps or flats
 * spells it, where its scale is not known - and the rest stacked on it a
 * letter for each step - so E major in A minor is E G♯ B, not E A♭ B. A
 * root has one sharp or flat at most and no kind's step is more than one
 * from the letters', so none needs more than two.
 */
export function theNotesOfTheChordNamed(
  chord: { readonly root: number; readonly kind: ChordKind },
  fifths: number,
  scale?: ScaleName,
): readonly string[] {
  const rootName = theNameOfTheRootIn(chord, fifths, scale);
  const rootLetter = STEPS.findIndex((step) => rootName.startsWith(step));
  return theNotesStackedOn(chord, rootLetter).map(({ letter, pitchClass }) => {
    const off = floorMod(pitchClass - (NATURAL[letter] ?? 0), 12);
    return `${STEPS[letter] ?? ''}${alterationSign((off > 6 ? off - 12 : off) as Alteration)}`;
  });
}

/** A chord's notes from its root up, each by its letter - the root's on a letter given, the rest a letter a step - and its pitch class. */
function theNotesStackedOn(
  chord: { readonly root: number; readonly kind: ChordKind },
  rootLetter: number,
): readonly { readonly letter: number; readonly pitchClass: number }[] {
  return chord.kind.intervals.map((semitones) => ({
    letter: floorMod(rootLetter + theLettersAbove(semitones, chord.kind), STEPS.length),
    pitchClass: floorMod(chord.root + semitones, 12),
  }));
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, at) => value === right[at]);
}

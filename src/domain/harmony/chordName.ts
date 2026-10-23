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
export function nameTheChord(midis: readonly number[], fifths: number | null = null): string | null {
  return theChordTheKeysMake(midis, fifths)?.name ?? null;
}

/** The chord the keys held make, named as `nameTheChord` names it, with its root and kind: `null` where it names none. */
export function theChordTheKeysMake(midis: readonly number[], fifths: number | null = null): ChordHeard | null {
  const read = readTheChord(midis);
  if (read === null) {
    return null;
  }
  const name = `${nameOfThePitchClass(read.root, fifths)}${read.kind.suffix}`;
  return {
    name: read.root === read.bass ? name : `${name}/${nameOfThePitchClass(read.bass, fifths)}`,
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
): ChordHeard | null {
  return (
    theChordTheKeysMake(
      notes.map((note) => note.midi),
      fifths,
    ) ?? theChordMostOfTheNotesMake(notes, fifths)
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
): ChordMostlyHeard | null {
  const weight = new Map<number, number>();
  for (const note of notes) {
    const pitchClass = ((note.midi % 12) + 12) % 12;
    weight.set(pitchClass, (weight.get(pitchClass) ?? 0) + Math.max(note.lengthMs, 1));
  }
  const total = [...weight.values()].reduce((sum, each) => sum + each, 0);
  const bass = ((Math.min(...notes.map((note) => note.midi)) % 12) + 12) % 12;
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
        readings.push({ root, kindAt, tones, worth: covered - EACH_TONE_COSTS * total * tones.length });
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
  const name = `${nameOfThePitchClass(found.root, fifths)}${kind.suffix}`;
  const overTheBass = bass !== found.root && found.tones.includes(bass);
  return {
    name: overTheBass ? `${name}/${nameOfThePitchClass(bass, fifths)}` : name,
    exactly: found.tones.length === weight.size,
    root: found.root,
    kind,
    worth: found.worth,
  };
}

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'] as const;

/**
 * A chord's degree in a scale, in roman numerals: upper case where its third
 * is major, lower where minor, and what its kind adds after (see
 * `afterTheNumeral`). A root the scale does not have is written from the
 * degree a semitone above it, flattened - B flat in C major is ♭VII - or,
 * where the scale has none there, from the one below, sharpened.
 */
export function theNumeralOfTheChord(
  chord: { readonly root: number; readonly kind: ChordKind },
  pitchClassesOfTheScale: readonly number[],
): string {
  const degree = (pitchClass: number): number => pitchClassesOfTheScale.indexOf(((pitchClass % 12) + 12) % 12);
  const on = degree(chord.root);
  const above = degree(chord.root + 1);
  const [sign, at] = on >= 0 ? ['', on] : above >= 0 ? ['♭', above] : ['♯', degree(chord.root - 1)];
  const numeral = NUMERALS[at] ?? '';
  return `${sign}${chord.kind.minor ? numeral.toLowerCase() : numeral}${chord.kind.afterTheNumeral}`;
}

function sameNumbers(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, at) => value === right[at]);
}

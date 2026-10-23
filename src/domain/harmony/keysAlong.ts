import { floorMod } from '../../shared/asserts.js';
import { theChordsAlongTheBars, theNotesOfEachBar, type BarOfBeats, type KeyFrom, type NoteSounding } from './chordsAlong.js';
import { SCALES, theTonicPitchClass, type ScaleName } from './scales.js';

/** A key a bar is read in: its signature, and the scale of it the music is in. */
export interface KeyOfTheBar {
  readonly fifths: number;
  readonly scale: ScaleName;
}

/**
 * The modes one signature writes, a tonic each: two flats are B♭ major, C
 * dorian, F mixolydian, G minor and the rest alike. Locrian is not among
 * them: its tonic chord is diminished, and no music that rests on one is
 * written with a signature of its own.
 */
const THE_MODES_OF_A_SIGNATURE: readonly ScaleName[] = ['major', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'minor'];

/**
 * How likely each pitch class above a tonic is to be heard in a bar of
 * music in that key, major and minor: the Kostka-Payne profiles, counted
 * by Temperley in the excerpts of a harmony textbook. A bar is weighed by
 * which pitch classes are in it, not how long they sound, so a held bass
 * outweighs nothing and a run of passing notes outweighs nothing either.
 */
const HEARD_IN_A_MAJOR_KEY = [0.748, 0.06, 0.488, 0.082, 0.67, 0.46, 0.096, 0.715, 0.104, 0.366, 0.057, 0.4];
const HEARD_IN_A_MINOR_KEY = [0.712, 0.084, 0.474, 0.618, 0.049, 0.46, 0.105, 0.747, 0.404, 0.067, 0.133, 0.33];

/**
 * What the bass on a bar's first beat being the tonic is worth, and the
 * bar's chords having it for their root, as a share of the bar. The notes
 * alone cannot choose between the modes of one signature - they share
 * every note - and the tonic is where the bass and the chords come home to.
 */
const THE_BASS_ON_THE_TONIC = 1;
const THE_CHORDS_ON_THE_TONIC = 1.5;

/**
 * The same again, worth this many times more, in the bar a key begins in -
 * the first, or the first after the signature changes - and the last note
 * of the piece and its last chord being on the tonic, worth more still: a
 * piece is heard to end at home far more surely than to begin there. Both
 * together less than a change of key costs, so a piece ending on its
 * fourth does not end in a key of that bar's own.
 */
const AT_THE_OPENING = 4;
const AT_THE_END = 5;

/**
 * What a key the music seldom rests in costs a bar read in it: phrygian and
 * lydian, which a run of one chord's notes reads as as readily as it reads
 * the major or minor it is far likelier to be.
 */
const A_RARE_MODE_COSTS = 0.5;

/**
 * What a change of key the signature does not make costs, as as much as a
 * bar can be worth: enough that a chord or two from elsewhere does not
 * move the music out of its key, little enough that a section in another
 * does - the riff of a verse taken up a tone, a middle in the relative
 * minor.
 */
const A_CHANGE_OF_KEY_COSTS = 12;

/**
 * How many bars a key lasts at the least, unless its signature lasts
 * fewer: a phrase. A change at either end of the music is paid for once,
 * where one in the middle is paid for going and coming back, so without it
 * a piece beginning or ending on a chord of its own - its fourth, say - is
 * in a key of that bar's own there.
 */
const A_KEY_LASTS_AT_LEAST = 4;

/**
 * A way of reading the music as far as a bar: the key it reads the bar in,
 * by its place among the bar's, how many bars that key has lasted (as many
 * as it has to at most), whether it began where its signature did, what
 * the reading is worth, and the way it came by.
 */
interface WayOfReading {
  readonly at: number;
  readonly lasted: number;
  readonly withTheSignature: boolean;
  readonly worth: number;
  readonly before: WayOfReading | null;
}

/**
 * The key each bar of some music is in: of the modes its signature writes,
 * the one whose tonic the bar's notes, its bass and its chords say, held
 * from bar to bar unless the music says another for long enough to pay
 * for the change (see `A_CHANGE_OF_KEY_COSTS`), as Temperley's model
 * reads a piece. A signature says which notes are flat or sharp and
 * nothing of which is home: two flats are as much F mixolydian as B♭
 * major. A key written as minor is the writer's own word on it, and kept;
 * major is also what a file says where it says nothing, and so is read.
 *
 * The keys are those written, each from where it begins; one bar for each
 * of `bars`.
 */
export function theKeysAlongTheBars(
  notes: readonly NoteSounding[],
  bars: readonly BarOfBeats[],
  written: readonly KeyFrom[],
): readonly KeyOfTheBar[] {
  // The written key a moment is in, by its place among them, the first before any.
  const writtenAt = (atMs: number): number => written.reduce((found, key, index) => (key.fromMs <= atMs ? index : found), 0);
  const chords = theChordsAlongTheBars(notes, bars, written);
  const lastStruckMs = Math.max(...notes.map((note) => note.fromMs));
  const finalNotes = notes.filter((note) => note.fromMs <= lastStruckMs && note.untilMs > lastStruckMs);
  const finalBass = finalNotes.length === 0 ? null : floorMod(Math.min(...finalNotes.map((note) => note.midi)), 12);
  const finalRoot = chords.at(-1)?.root ?? null;
  const ofEachBar = theNotesOfEachBar(notes, bars);

  const readings = bars.map((bar, index) => {
    const fromMs = bar.beatsMs[0] ?? bar.untilMs;
    const signature = writtenAt(fromMs);
    const key = written[signature] ?? { fromMs, fifths: 0, scale: 'major' };
    const keys: readonly KeyOfTheBar[] =
      key.scale === 'major'
        ? THE_MODES_OF_A_SIGNATURE.map((scale) => ({ fifths: key.fifths, scale }))
        : [{ fifths: key.fifths, scale: key.scale }];
    const sounding = ofEachBar[index] ?? [];
    const heard = new Set(sounding.map((note) => floorMod(note.midi, 12)));
    const firstBeatEnds = bar.beatsMs[1] ?? bar.untilMs;
    const onTheBeat = sounding.filter((note) => note.fromMs < firstBeatEnds);
    const bass = onTheBeat.length === 0 ? null : floorMod(Math.min(...onTheBeat.map((note) => note.midi)), 12);
    const rootMs = new Map<number, number>();
    let chordMs = 0;
    for (const chord of chords) {
      const lengthMs = Math.min(bar.untilMs, chord.untilMs) - Math.max(fromMs, chord.fromMs);
      if (lengthMs > 0) {
        rootMs.set(chord.root, (rootMs.get(chord.root) ?? 0) + lengthMs);
        chordMs += lengthMs;
      }
    }
    const opens = index === 0 || writtenAt(bars[index - 1]?.beatsMs[0] ?? fromMs) !== signature;
    const ends = index === bars.length - 1;
    const worth = keys.map(({ fifths, scale }) => {
      if (heard.size === 0) {
        return 0;
      }
      const tonic = theTonicPitchClass(fifths, scale);
      const profile = SCALES[scale].minor ? HEARD_IN_A_MINOR_KEY : HEARD_IN_A_MAJOR_KEY;
      const fits = profile.reduce((sum, likely, step) => sum + Math.log(heard.has(floorMod(tonic + step, 12)) ? likely : 1 - likely), 0);
      const home = THE_BASS_ON_THE_TONIC * Number(bass === tonic) + (THE_CHORDS_ON_THE_TONIC * (rootMs.get(tonic) ?? 0)) / Math.max(1, chordMs);
      const opening = opens ? AT_THE_OPENING * (Number(bass === tonic) + (rootMs.get(tonic) ?? 0) / Math.max(1, chordMs)) : 0;
      const ending = ends ? AT_THE_END * (Number(finalBass === tonic) + Number(finalRoot === tonic)) : 0;
      const rare = scale === 'phrygian' || scale === 'lydian' ? A_RARE_MODE_COSTS : 0;
      return fits + home + opening + ending - rare;
    });
    return { signature, keys, worth };
  });

  // The best way of reading the music as far as each bar, for each key the bar may be in, how long it has lasted and
  // whether it began with its signature: a key may end only where it has lasted long enough, or its signature began it.
  const mayEnd = (way: WayOfReading): boolean => way.lasted >= A_KEY_LASTS_AT_LEAST || way.withTheSignature;
  let ways: WayOfReading[] = [];
  readings.forEach((reading, index) => {
    const previous = readings[index - 1];
    const next = new Map<string, WayOfReading>();
    const offer = (way: WayOfReading): void => {
      const name = `${String(way.at)} ${String(way.lasted)} ${String(way.withTheSignature)}`;
      const there = next.get(name);
      if (there === undefined || way.worth > there.worth) {
        next.set(name, way);
      }
    };
    if (previous === undefined || previous.signature !== reading.signature) {
      // A key the signature changes to is the signature's change, and free.
      for (const before of previous === undefined ? [null] : ways.filter(mayEnd)) {
        reading.keys.forEach((_, at) => {
          offer({ at, lasted: 1, withTheSignature: true, worth: (before?.worth ?? 0) + (reading.worth[at] ?? 0), before });
        });
      }
    } else {
      for (const before of ways) {
        reading.keys.forEach((_, at) => {
          const worth = before.worth + (reading.worth[at] ?? 0);
          if (at === before.at) {
            offer({ at, lasted: Math.min(before.lasted + 1, A_KEY_LASTS_AT_LEAST), withTheSignature: before.withTheSignature, worth, before });
          } else if (before.lasted >= A_KEY_LASTS_AT_LEAST) {
            offer({ at, lasted: 1, withTheSignature: false, worth: worth - A_CHANGE_OF_KEY_COSTS, before });
          }
        });
      }
    }
    ways = [...next.values()];
  });
  const chosen: KeyOfTheBar[] = [];
  let way = ways.filter(mayEnd).reduce<WayOfReading | null>((found, each) => (found === null || each.worth > found.worth ? each : found), null);
  for (let index = readings.length - 1; index >= 0 && way !== null; index -= 1) {
    const key = readings[index]?.keys[way.at];
    if (key !== undefined) {
      chosen.unshift(key);
    }
    way = way.before;
  }
  return chosen;
}

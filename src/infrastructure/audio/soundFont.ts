import { DomainError } from '../../shared/errors.js';

/**
 * Raised when bytes handed over as a soundfont cannot be played from: not a
 * soundfont at all, one cut short, or one this reader does not read yet.
 */
export class SoundFontUnreadable extends DomainError {}

/**
 * A soundfont, as what it takes to sound it: the instruments it offers and the
 * recordings they are made of.
 *
 * The file is two layers of zones over a set of recordings. An *instrument*
 * divides the keyboard into zones, each a recording and how to play it - which
 * keys and how hard, the key it was recorded at, its loop, its envelope. A
 * *preset* is what a player chooses, by name or by bank and program, and it
 * lays instruments over ranges of its own, able to nudge everything they say.
 * Those two layers are flattened here into one list of zones per preset, so
 * what plays a note has one zone to read and nothing to work out.
 */
export interface SoundFont {
  /** What the file calls itself, or empty where it does not say. */
  readonly name: string;
  readonly presets: readonly SoundFontPreset[];
  /**
   * Every recording in the file, one after another, as the signed 16-bit
   * values it keeps them as. A zone says where its own lies in here.
   */
  readonly sampleData: Int16Array;
}

export interface SoundFontPreset {
  readonly name: string;
  readonly bank: number;
  readonly program: number;
  readonly zones: readonly SoundZone[];
}

/** An inclusive range of keys or of how hard they are struck, 0 to 127. */
export interface MidiRange {
  readonly low: number;
  readonly high: number;
}

/**
 * How a recording loops while its key is held: not at all, round and round
 * until its sound has died, or round only while the key is down and then on
 * through the rest of the recording.
 */
export type SoundLoop = 'none' | 'continuous' | 'until-release';

/** One recording over a range of keys and of strengths, with everything said about playing it. */
export interface SoundZone {
  readonly keys: MidiRange;
  readonly velocities: MidiRange;
  readonly sampleName: string;
  readonly sampleRate: number;
  /** Where the recording begins and ends in `sampleData`, the end not included. */
  readonly start: number;
  readonly end: number;
  /** Where its loop begins and ends in `sampleData`. */
  readonly loopStart: number;
  readonly loopEnd: number;
  readonly loop: SoundLoop;
  /** The key it sounds as when played as recorded. */
  readonly rootKey: number;
  /** Cents added to the recording's pitch as it is played: the file's correction of how it was recorded. */
  readonly correctionCents: number;
  /**
   * What the zone says about pitch, loudness, colour and shape, in the file's
   * own units, the preset's added to the instrument's as the format has it:
   * see {@link SoundSettings}. Read into seconds, decibels and hertz where
   * they are played, which is where they are clamped to what can be.
   */
  readonly settings: SoundSettings;
}

/**
 * The soundfont's own words for how a zone sounds, each in the unit the
 * format gives it.
 *
 * Times are in timecents (1200 is a doubling, -12000 near enough none),
 * loudness in centibels of attenuation, pitch in cents, the filter's corner in
 * cents above 8.176 Hz, pan in tenths of a per cent from -500 (left) to 500.
 */
export interface SoundSettings {
  readonly coarseTune: number;
  readonly fineTune: number;
  /** Cents a key moves the pitch by: 100 is a semitone a key, 0 the same pitch on every key. */
  readonly scaleTuning: number;
  readonly initialAttenuation: number;
  readonly pan: number;
  readonly initialFilterFc: number;
  readonly initialFilterQ: number;
  readonly delayVolEnv: number;
  readonly attackVolEnv: number;
  readonly holdVolEnv: number;
  readonly decayVolEnv: number;
  /** How far below its peak the note settles while held, in centibels. */
  readonly sustainVolEnv: number;
  readonly releaseVolEnv: number;
  /** Timecents the hold changes by for each key below middle C: a low string rings longer. */
  readonly keynumToVolEnvHold: number;
  readonly keynumToVolEnvDecay: number;
  /** Zones sharing a class other than 0 cut each other off, as an open hi-hat is cut by a closed one. */
  readonly exclusiveClass: number;
}

/** The generators read, by the number the format gives each. */
const GENERATOR = {
  startAddrsOffset: 0,
  endAddrsOffset: 1,
  startloopAddrsOffset: 2,
  endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4,
  initialFilterFc: 8,
  initialFilterQ: 9,
  endAddrsCoarseOffset: 12,
  pan: 17,
  delayVolEnv: 33,
  attackVolEnv: 34,
  holdVolEnv: 35,
  decayVolEnv: 36,
  sustainVolEnv: 37,
  releaseVolEnv: 38,
  keynumToVolEnvHold: 39,
  keynumToVolEnvDecay: 40,
  instrument: 41,
  keyRange: 43,
  velRange: 44,
  startloopAddrsCoarseOffset: 45,
  initialAttenuation: 48,
  endloopAddrsCoarseOffset: 50,
  coarseTune: 51,
  fineTune: 52,
  sampleID: 53,
  sampleModes: 54,
  scaleTuning: 56,
  exclusiveClass: 57,
  overridingRootKey: 58,
} as const;

/**
 * What a zone that says nothing about it is given. The envelope's stages
 * default to no time at all and the filter to wide open: a recording played
 * as it is.
 */
const DEFAULT_SETTINGS: SoundSettings = {
  coarseTune: 0,
  fineTune: 0,
  scaleTuning: 100,
  initialAttenuation: 0,
  pan: 0,
  initialFilterFc: 13_500,
  initialFilterQ: 0,
  delayVolEnv: -12_000,
  attackVolEnv: -12_000,
  holdVolEnv: -12_000,
  decayVolEnv: -12_000,
  sustainVolEnv: 0,
  releaseVolEnv: -12_000,
  keynumToVolEnvHold: 0,
  keynumToVolEnvDecay: 0,
  exclusiveClass: 0,
};

type SettingName = keyof SoundSettings;

/**
 * The settings a preset may nudge, each added to what the instrument says.
 * The class a zone cuts others off by belongs to the instrument alone: the
 * format does not let a preset say it, and one that does is not listened to.
 */
const NUDGED_BY_A_PRESET: readonly SettingName[] = (Object.keys(DEFAULT_SETTINGS) as SettingName[]).filter(
  (name) => name !== 'exclusiveClass',
);

/** How far a coarse address offset moves: whole blocks of 32768 sample points. */
const COARSE_ADDRESS = 32_768;

/** What a recording's own key is said to be where it has no pitch: 255, heard as middle C. */
const UNPITCHED = 255;
const MIDDLE_C = 60;

/** The bit of a sample's type that marks its data compressed, as an SF3 file has it. */
const COMPRESSED_SAMPLE = 0x10;
/** The bit marking a recording held in a synthesiser's memory rather than the file. */
const ROM_SAMPLE = 0x8000;

/** One generator as the file holds it: what it sets, and the value as both readings of its two bytes. */
interface GeneratorSaid {
  readonly operator: number;
  readonly signed: number;
  readonly unsigned: number;
}

/** The generators of one zone, by operator, the last saying of each standing. */
type ZoneGenerators = ReadonlyMap<number, GeneratorSaid>;

/**
 * Reads a soundfont (`.sf2`) into its presets and the recordings they play.
 *
 * Refuses, with what is wrong, anything that is not one, one cut short, and
 * one whose recordings are compressed (`.sf3`), which is not read yet.
 */
export function readSoundFont(bytes: Uint8Array): SoundFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 12 || fourCc(bytes, 0) !== 'RIFF' || fourCc(bytes, 8) !== 'sfbk') {
    throw new SoundFontUnreadable('This is not a soundfont: an .sf2 file begins RIFF ... sfbk.');
  }
  const chunks = theChunks(bytes, view);

  const version = chunks.get('ifil');
  if (version !== undefined && version.size >= 2 && view.getUint16(version.at, true) >= 3) {
    throw new SoundFontUnreadable('This soundfont keeps its recordings compressed (SF3), which cannot be read yet.');
  }

  const smpl = theChunk(chunks, 'smpl');
  const presetHeaders = records(chunks, 'phdr', 38);
  const presetBags = records(chunks, 'pbag', 4);
  const presetGenerators = records(chunks, 'pgen', 4);
  const instrumentHeaders = records(chunks, 'inst', 22);
  const instrumentBags = records(chunks, 'ibag', 4);
  const instrumentGenerators = records(chunks, 'igen', 4);
  const sampleHeaders = records(chunks, 'shdr', 46);

  const sampleData = theSampleData(bytes, smpl);
  const samples = theSamples(bytes, view, sampleHeaders);
  const instruments = theInstruments(view, instrumentHeaders, { view, bags: instrumentBags, generators: instrumentGenerators });
  const presets = thePresets(
    bytes,
    view,
    presetHeaders,
    { view, bags: presetBags, generators: presetGenerators },
    instruments,
    samples,
    sampleData.length,
  );

  const name = chunks.get('INAM');
  return {
    name: name === undefined ? '' : text(bytes, name.at, name.size),
    presets,
    sampleData,
  };
}

interface Chunk {
  readonly at: number;
  readonly size: number;
}

/** A run of fixed-size records, the terminal one the format closes every list with included. */
interface Table {
  readonly at: number;
  readonly count: number;
  readonly size: number;
}

/**
 * Every chunk inside the file's three lists, by its name.
 *
 * The file is a RIFF tree: `INFO` says what it is, `sdta` holds the
 * recordings and `pdta` how they are played. Nothing is nested deeper, and
 * no name appears in two lists, so one table by name is the whole of it.
 */
function theChunks(bytes: Uint8Array, view: DataView): ReadonlyMap<string, Chunk> {
  const found = new Map<string, Chunk>();
  const fileEnd = Math.min(bytes.byteLength, 8 + view.getUint32(4, true));
  for (const list of chunksBetween(bytes, view, 12, fileEnd)) {
    if (list.name !== 'LIST' || list.size < 4) {
      continue;
    }
    for (const inner of chunksBetween(bytes, view, list.at + 4, list.at + list.size)) {
      if (!found.has(inner.name)) {
        found.set(inner.name, { at: inner.at, size: inner.size });
      }
    }
  }
  return found;
}

function* chunksBetween(
  bytes: Uint8Array,
  view: DataView,
  from: number,
  to: number,
): Generator<{ readonly name: string; readonly at: number; readonly size: number }> {
  let at = from;
  while (at + 8 <= to) {
    const name = fourCc(bytes, at);
    const size = view.getUint32(at + 4, true);
    if (at + 8 + size > to) {
      throw new SoundFontUnreadable(`This soundfont is cut short: its ${name} runs past the end of the file.`);
    }
    yield { name, at: at + 8, size };
    // A chunk of odd length is followed by a byte of padding.
    at += 8 + size + (size % 2);
  }
}

function theChunk(chunks: ReadonlyMap<string, Chunk>, name: string): Chunk {
  const chunk = chunks.get(name);
  if (chunk === undefined) {
    throw new SoundFontUnreadable(`This soundfont has no ${name}, which every one needs.`);
  }
  return chunk;
}

function records(chunks: ReadonlyMap<string, Chunk>, name: string, size: number): Table {
  const chunk = theChunk(chunks, name);
  // At least the terminal record, which only closes the list.
  if (chunk.size % size !== 0 || chunk.size < size) {
    throw new SoundFontUnreadable(`This soundfont's ${name} is not whole ${String(size)}-byte records.`);
  }
  return { at: chunk.at, count: chunk.size / size, size };
}

/**
 * The recordings, read where they lie when the bytes allow it. Sixteen-bit
 * values have to begin on an even byte to be read in place; anywhere else
 * they are copied, once.
 */
function theSampleData(bytes: Uint8Array, smpl: Chunk): Int16Array {
  const start = bytes.byteOffset + smpl.at;
  const count = Math.floor(smpl.size / 2);
  if (start % 2 === 0) {
    return new Int16Array(bytes.buffer, start, count);
  }
  return new Int16Array(bytes.slice(smpl.at, smpl.at + count * 2).buffer);
}

interface Sample {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly loopStart: number;
  readonly loopEnd: number;
  readonly sampleRate: number;
  readonly originalKey: number;
  readonly correctionCents: number;
  /** Held in a synthesiser's memory rather than the file, and so not here to be played. */
  readonly elsewhere: boolean;
}

function theSamples(bytes: Uint8Array, view: DataView, table: Table): readonly Sample[] {
  const samples: Sample[] = [];
  // The last record only closes the list.
  for (let index = 0; index < table.count - 1; index += 1) {
    const at = table.at + index * table.size;
    const type = view.getUint16(at + 44, true);
    if ((type & COMPRESSED_SAMPLE) !== 0) {
      throw new SoundFontUnreadable('This soundfont keeps its recordings compressed (SF3), which cannot be read yet.');
    }
    samples.push({
      name: text(bytes, at, 20),
      start: view.getUint32(at + 20, true),
      end: view.getUint32(at + 24, true),
      loopStart: view.getUint32(at + 28, true),
      loopEnd: view.getUint32(at + 32, true),
      sampleRate: view.getUint32(at + 36, true),
      originalKey: view.getUint8(at + 40),
      correctionCents: view.getInt8(at + 41),
      elsewhere: (type & ROM_SAMPLE) !== 0,
    });
  }
  return samples;
}

/** A list of zones: its bags, each the start of a zone's run of generators, and the generators. */
interface Zones {
  readonly view: DataView;
  readonly bags: Table;
  readonly generators: Table;
}

/**
 * The generators of one zone: the bag at `bag` says where its run of them
 * begins, and the next bag where it ends.
 */
function zoneGenerators({ view, bags, generators }: Zones, bag: number): ZoneGenerators {
  const from = view.getUint16(bags.at + bag * bags.size, true);
  const to = view.getUint16(bags.at + (bag + 1) * bags.size, true);
  if (to < from || to > generators.count) {
    throw new SoundFontUnreadable('This soundfont points a zone at generators it does not have.');
  }
  const found = new Map<number, GeneratorSaid>();
  for (let index = from; index < to; index += 1) {
    const at = generators.at + index * generators.size;
    found.set(view.getUint16(at, true), {
      operator: view.getUint16(at, true),
      signed: view.getInt16(at + 2, true),
      unsigned: view.getUint16(at + 2, true),
    });
  }
  return found;
}

/**
 * A preset's or an instrument's zones, the global one apart.
 *
 * The first zone may be global: one that names no instrument (or recording)
 * says what every other zone of the list starts from. A zone after the first
 * that names none is meaningless and passed over, as the format says.
 */
function zonesOf(
  headerAt: (index: number) => number,
  index: number,
  list: Zones,
  names: number,
): { readonly global: ZoneGenerators; readonly zones: readonly ZoneGenerators[] } {
  const from = headerAt(index);
  const to = headerAt(index + 1);
  // The last zone's run ends where the next bag begins, so even the last
  // zone needs a bag after it: the terminal one.
  if (to < from || to >= list.bags.count) {
    throw new SoundFontUnreadable('This soundfont points at zones it does not have.');
  }
  let global: ZoneGenerators = new Map();
  const zones: ZoneGenerators[] = [];
  for (let bag = from; bag < to; bag += 1) {
    const generators = zoneGenerators(list, bag);
    if (generators.has(names)) {
      zones.push(generators);
    } else if (bag === from) {
      global = generators;
    }
  }
  return { global, zones };
}

interface Instrument {
  readonly global: ZoneGenerators;
  readonly zones: readonly ZoneGenerators[];
}

function theInstruments(view: DataView, table: Table, list: Zones): readonly Instrument[] {
  const bagAt = (index: number): number => view.getUint16(table.at + index * table.size + 20, true);
  const instruments: Instrument[] = [];
  for (let index = 0; index < table.count - 1; index += 1) {
    instruments.push(zonesOf(bagAt, index, list, GENERATOR.sampleID));
  }
  return instruments;
}

function thePresets(
  bytes: Uint8Array,
  view: DataView,
  table: Table,
  list: Zones,
  instruments: readonly Instrument[],
  samples: readonly Sample[],
  sampleCount: number,
): readonly SoundFontPreset[] {
  const bagAt = (index: number): number => view.getUint16(table.at + index * table.size + 24, true);
  const presets: SoundFontPreset[] = [];
  for (let index = 0; index < table.count - 1; index += 1) {
    const at = table.at + index * table.size;
    const { global, zones } = zonesOf(bagAt, index, list, GENERATOR.instrument);
    const flattened: SoundZone[] = [];
    for (const presetZone of zones) {
      const said = withGlobal(global, presetZone);
      const instrument = instruments[said.get(GENERATOR.instrument)?.unsigned ?? -1];
      if (instrument === undefined) {
        continue;
      }
      for (const instrumentZone of instrument.zones) {
        const zone = flatten(said, withGlobal(instrument.global, instrumentZone), samples, sampleCount);
        if (zone !== null) {
          flattened.push(zone);
        }
      }
    }
    presets.push({
      name: text(bytes, at, 20),
      program: view.getUint16(at + 20, true),
      bank: view.getUint16(at + 22, true),
      zones: flattened,
    });
  }
  return presets;
}

/** A zone's generators over its list's global ones: what the zone says stands, the rest comes from the global zone. */
function withGlobal(global: ZoneGenerators, zone: ZoneGenerators): ZoneGenerators {
  return new Map([...global, ...zone]);
}

/**
 * One instrument zone as a preset zone plays it, or `null` where the two
 * share no key or no strength, or its recording is not in the file.
 *
 * The preset's ranges narrow the instrument's, and everything else it says is
 * added to what the instrument says: a preset an octave up is the
 * instrument's every zone an octave up, whatever each says of its own.
 */
function flatten(
  preset: ZoneGenerators,
  instrument: ZoneGenerators,
  samples: readonly Sample[],
  sampleCount: number,
): SoundZone | null {
  const sample = samples[instrument.get(GENERATOR.sampleID)?.unsigned ?? -1];
  if (sample === undefined || sample.elsewhere) {
    return null;
  }
  const keys = overlap(rangeOf(preset, GENERATOR.keyRange), rangeOf(instrument, GENERATOR.keyRange));
  const velocities = overlap(rangeOf(preset, GENERATOR.velRange), rangeOf(instrument, GENERATOR.velRange));
  if (keys === null || velocities === null) {
    return null;
  }

  const settings = { ...DEFAULT_SETTINGS } as Record<SettingName, number>;
  for (const name of Object.keys(DEFAULT_SETTINGS) as SettingName[]) {
    const own = instrument.get(GENERATOR[name])?.signed;
    if (own !== undefined) {
      settings[name] = own;
    }
  }
  for (const name of NUDGED_BY_A_PRESET) {
    settings[name] += preset.get(GENERATOR[name])?.signed ?? 0;
  }

  const offset = (fine: number, coarse: number): number =>
    (instrument.get(fine)?.signed ?? 0) + (instrument.get(coarse)?.signed ?? 0) * COARSE_ADDRESS;
  const within = (point: number): number => Math.min(sampleCount, Math.max(0, point));
  const overriding = instrument.get(GENERATOR.overridingRootKey)?.signed ?? -1;

  return {
    keys,
    velocities,
    sampleName: sample.name,
    sampleRate: sample.sampleRate,
    start: within(sample.start + offset(GENERATOR.startAddrsOffset, GENERATOR.startAddrsCoarseOffset)),
    end: within(sample.end + offset(GENERATOR.endAddrsOffset, GENERATOR.endAddrsCoarseOffset)),
    loopStart: within(sample.loopStart + offset(GENERATOR.startloopAddrsOffset, GENERATOR.startloopAddrsCoarseOffset)),
    loopEnd: within(sample.loopEnd + offset(GENERATOR.endloopAddrsOffset, GENERATOR.endloopAddrsCoarseOffset)),
    loop: loopFor(instrument.get(GENERATOR.sampleModes)?.unsigned ?? 0),
    rootKey:
      overriding >= 0 && overriding <= 127
        ? overriding
        : sample.originalKey === UNPITCHED || sample.originalKey > 127
          ? MIDDLE_C
          : sample.originalKey,
    correctionCents: sample.correctionCents,
    settings,
  };
}

/** A key or strength range: low in the first byte, high in the second, the whole of 0-127 where none is said. */
function rangeOf(generators: ZoneGenerators, operator: number): MidiRange {
  const said = generators.get(operator);
  if (said === undefined) {
    return { low: 0, high: 127 };
  }
  return { low: said.unsigned & 0xff, high: said.unsigned >> 8 };
}

function overlap(one: MidiRange, other: MidiRange): MidiRange | null {
  const low = Math.max(one.low, other.low);
  const high = Math.min(one.high, other.high);
  return low > high ? null : { low, high };
}

/** 1 loops for ever, 3 loops while the key is held; 0, and 2 which the format leaves unused, do not loop. */
function loopFor(mode: number): SoundLoop {
  switch (mode & 3) {
    case 1:
      return 'continuous';
    case 3:
      return 'until-release';
    default:
      return 'none';
  }
}

function fourCc(bytes: Uint8Array, at: number): string {
  return String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
}

/** A name of the file's: one byte a character, ended by the first zero. */
function text(bytes: Uint8Array, at: number, length: number): string {
  let out = '';
  for (let index = at; index < at + length; index += 1) {
    const code = bytes[index] ?? 0;
    if (code === 0) {
      break;
    }
    out += String.fromCharCode(code);
  }
  return out.trim();
}

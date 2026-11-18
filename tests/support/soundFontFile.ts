/**
 * Writes a soundfont (`.sf2`) from a description, so tests read a file made
 * for what they ask and no third party's.
 *
 * Every list is closed with the terminal record the format asks for, and
 * each recording followed by the 46 silent points it asks for too.
 */

/** A generator as the file holds it: its number, and its two bytes as one value. */
export type FileGenerator = readonly [operator: number, amount: number];

export interface FileSample {
  readonly name: string;
  readonly points: readonly number[];
  /** Where its loop begins and ends, counted from its own first point. */
  readonly loop?: readonly [start: number, end: number];
  readonly sampleRate?: number;
  readonly originalKey?: number;
  readonly correctionCents?: number;
  readonly type?: number;
}

/** A zone: what it says, its instrument or recording among it as the last generator. */
export type FileZone = readonly FileGenerator[];

export interface FileInstrument {
  readonly name: string;
  readonly zones: readonly FileZone[];
}

export interface FilePreset {
  readonly name: string;
  readonly bank?: number;
  readonly program?: number;
  readonly zones: readonly FileZone[];
}

export interface FileDescription {
  readonly name?: string;
  /** Said in a chunk of its own, of odd length where the comment is even, so the padding after it is read past. */
  readonly comment?: string;
  readonly version?: readonly [major: number, minor: number];
  readonly samples: readonly FileSample[];
  readonly instruments: readonly FileInstrument[];
  readonly presets: readonly FilePreset[];
}

/** The generators tests speak of, by the number the format gives each. */
export const GEN = {
  startAddrsOffset: 0,
  endAddrsOffset: 1,
  startloopAddrsOffset: 2,
  endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4,
  initialFilterFc: 8,
  endAddrsCoarseOffset: 12,
  pan: 17,
  holdVolEnv: 35,
  decayVolEnv: 36,
  sustainVolEnv: 37,
  releaseVolEnv: 38,
  keynumToVolEnvHold: 39,
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

/** A range generator's amount: the low end in the first byte, the high in the second. */
export function range(low: number, high: number): number {
  return low | (high << 8);
}

/** A signed amount as the two bytes hold it. */
function twoBytes(amount: number): number {
  return amount & 0xffff;
}

class Bytes {
  private readonly parts: Uint8Array[] = [];

  get length(): number {
    return this.parts.reduce((sum, part) => sum + part.length, 0);
  }

  add(part: Uint8Array): this {
    this.parts.push(part);
    return this;
  }

  u8(value: number): this {
    return this.add(Uint8Array.of(value & 0xff));
  }

  u16(value: number): this {
    return this.add(Uint8Array.of(value & 0xff, (value >> 8) & 0xff));
  }

  u32(value: number): this {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setUint32(0, value >>> 0, true);
    return this.add(out);
  }

  /** A chunk's four-letter name. */
  fourCc(name: string): this {
    return this.add(Uint8Array.from(name.slice(0, 4).padEnd(4, ' '), (letter) => letter.charCodeAt(0)));
  }

  text(value: string, length: number): this {
    const out = new Uint8Array(length);
    for (let index = 0; index < Math.min(value.length, length - 1); index += 1) {
      out[index] = value.charCodeAt(index);
    }
    return this.add(out);
  }

  done(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

function chunk(name: string, body: Uint8Array): Uint8Array {
  return new Bytes()
    .fourCc(name)
    .u32(body.length)
    .add(body)
    .add(new Uint8Array(body.length % 2))
    .done();
}

function list(kind: string, chunks: readonly Uint8Array[]): Uint8Array {
  const body = new Bytes().fourCc(kind);
  for (const inner of chunks) {
    body.add(inner);
  }
  return chunk('LIST', body.done());
}

/** Bags and generators for a list of zones: a bag says where each zone's generators begin. */
function zoneTables(owners: readonly { readonly zones: readonly FileZone[] }[]): {
  readonly bags: Uint8Array;
  readonly generators: Uint8Array;
  readonly firstBags: readonly number[];
} {
  const bags = new Bytes();
  const generators = new Bytes();
  const firstBags: number[] = [];
  let bag = 0;
  let generator = 0;
  for (const owner of owners) {
    firstBags.push(bag);
    for (const zone of owner.zones) {
      bags.u16(generator).u16(0);
      bag += 1;
      for (const [operator, amount] of zone) {
        generators.u16(operator).u16(twoBytes(amount));
        generator += 1;
      }
    }
  }
  firstBags.push(bag);
  bags.u16(generator).u16(0);
  generators.u16(0).u16(0);
  return { bags: bags.done(), generators: generators.done(), firstBags };
}

/** The silent points the format asks for after every recording. */
const SILENCE_AFTER = 46;

export function writeSoundFont(description: FileDescription): Uint8Array {
  const [major, minor] = description.version ?? [2, 1];
  const info = list('INFO', [
    chunk('ifil', new Bytes().u16(major).u16(minor).done()),
    ...(description.comment === undefined
      ? []
      : [chunk('ICMT', new Bytes().text(description.comment, description.comment.length + 1).done())]),
    chunk('INAM', new Bytes().text(description.name ?? 'Test font', 32).done()),
  ]);

  const points = new Bytes();
  const sampleHeaders = new Bytes();
  let at = 0;
  for (const sample of description.samples) {
    for (const point of sample.points) {
      points.u16(twoBytes(point));
    }
    for (let silent = 0; silent < SILENCE_AFTER; silent += 1) {
      points.u16(0);
    }
    const [loopStart, loopEnd] = sample.loop ?? [0, sample.points.length];
    sampleHeaders
      .text(sample.name, 20)
      .u32(at)
      .u32(at + sample.points.length)
      .u32(at + loopStart)
      .u32(at + loopEnd)
      .u32(sample.sampleRate ?? 44_100)
      .u8(sample.originalKey ?? 60)
      .u8(sample.correctionCents ?? 0)
      .u16(0)
      .u16(sample.type ?? 1);
    at += sample.points.length + SILENCE_AFTER;
  }
  sampleHeaders.text('EOS', 20).u32(0).u32(0).u32(0).u32(0).u32(0).u8(0).u8(0).u16(0).u16(0);
  const sdta = list('sdta', [chunk('smpl', points.done())]);

  const presetTables = zoneTables(description.presets);
  const presetHeaders = new Bytes();
  description.presets.forEach((preset, index) => {
    presetHeaders
      .text(preset.name, 20)
      .u16(preset.program ?? index)
      .u16(preset.bank ?? 0)
      .u16(presetTables.firstBags[index] ?? 0)
      .u32(0)
      .u32(0)
      .u32(0);
  });
  presetHeaders.text('EOP', 20).u16(0).u16(0).u16(presetTables.firstBags.at(-1) ?? 0).u32(0).u32(0).u32(0);

  const instrumentTables = zoneTables(description.instruments);
  const instrumentHeaders = new Bytes();
  description.instruments.forEach((instrument, index) => {
    instrumentHeaders.text(instrument.name, 20).u16(instrumentTables.firstBags[index] ?? 0);
  });
  instrumentHeaders.text('EOI', 20).u16(instrumentTables.firstBags.at(-1) ?? 0);

  const noModulators = new Uint8Array(10);
  const pdta = list('pdta', [
    chunk('phdr', presetHeaders.done()),
    chunk('pbag', presetTables.bags),
    chunk('pmod', noModulators),
    chunk('pgen', presetTables.generators),
    chunk('inst', instrumentHeaders.done()),
    chunk('ibag', instrumentTables.bags),
    chunk('imod', noModulators),
    chunk('igen', instrumentTables.generators),
    chunk('shdr', sampleHeaders.done()),
  ]);

  return chunk('RIFF', new Bytes().fourCc('sfbk').add(info).add(sdta).add(pdta).done());
}

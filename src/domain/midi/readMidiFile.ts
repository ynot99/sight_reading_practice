import { damperIsDown } from './MidiFile.js';
import { DomainError } from '../../shared/errors.js';

/** One sounded note, in the file's own ticks. */
export interface MidiFileNote {
  readonly midi: number;
  readonly startTicks: number;
  readonly endTicks: number;
  /** Which chunk it came from, which is how a writer separates the hands. */
  readonly track: number;
  readonly channel: number;
  readonly velocity: number;
}

/** Where the damper pedal went down or came up, in the file's own ticks. */
export interface MidiFilePedal {
  readonly atTicks: number;
  readonly down: boolean;
}

export interface MidiFileDocument {
  /** Ticks to the quarter note, as the file counts them. */
  readonly division: number;
  readonly notes: readonly MidiFileNote[];
  readonly pedal: readonly MidiFilePedal[];
  readonly beats: number;
  readonly beatType: number;
  /** Sharps positive, flats negative, as MIDI writes it. */
  readonly fifths: number;
  readonly tempoBpm: number;
  readonly title: string | null;
}

const HEADER = 0x4d546864; // "MThd"
const TRACK = 0x4d54726b; // "MTrk"
const DEFAULT_TEMPO_BPM = 72;

/**
 * Whether these bytes are a Standard MIDI File.
 *
 * By its header and not by its name: a file picker on a tablet renames freely
 * and a score shared through a chat app often arrives with no extension at
 * all, so the four bytes the format begins with are the only reliable answer.
 */
export function looksLikeMidi(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x4d &&
    data[1] === 0x54 &&
    data[2] === 0x68 &&
    data[3] === 0x64
  );
}

/** A cursor over the bytes, so no reader has to carry an offset by hand. */
class Bytes {
  private readonly data: Uint8Array;
  private at = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  get done(): boolean {
    return this.at >= this.data.length;
  }

  get position(): number {
    return this.at;
  }

  byte(): number {
    if (this.at >= this.data.length) {
      throw new DomainError('This MIDI file ends in the middle of an event.');
    }
    const value = this.data[this.at] ?? 0;
    this.at += 1;
    return value;
  }

  uint32(): number {
    return ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
  }

  uint16(): number {
    return (this.byte() << 8) | this.byte();
  }

  take(length: number): Uint8Array {
    if (this.at + length > this.data.length) {
      throw new DomainError('This MIDI file claims more data than it holds.');
    }
    const slice = this.data.subarray(this.at, this.at + length);
    this.at += length;
    return slice;
  }

  skip(length: number): void {
    this.at = Math.max(0, Math.min(this.data.length, this.at + length));
  }

  /**
   * A variable-length quantity: seven bits a byte, high bit says "more".
   *
   * How MIDI writes every delta time, and the reason a file cannot simply be
   * indexed into - the length of each event depends on what came before it.
   */
  variable(): number {
    let value = 0;
    for (let read = 0; read < 4; read += 1) {
      const byte = this.byte();
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) {
        return value;
      }
    }
    throw new DomainError('This MIDI file has a length field that never ends.');
  }
}

interface OpenNote {
  readonly startTicks: number;
  readonly velocity: number;
  readonly track: number;
  readonly channel: number;
}

interface TrackResult {
  readonly notes: MidiFileNote[];
  readonly pedal: MidiFilePedal[];
  beats: number | null;
  beatType: number | null;
  fifths: number | null;
  microsecondsPerQuarter: number | null;
  name: string | null;
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes).trim();
}

/**
 * Reads one track chunk.
 *
 * Running status is honoured: a file may leave the status byte out when it
 * repeats, and a reader that assumed one per event would read the data bytes
 * as commands and produce nonsense rather than an error.
 */
function readTrack(bytes: Bytes, length: number, track: number): TrackResult {
  const end = bytes.position + length;
  const result: TrackResult = {
    notes: [],
    pedal: [],
    beats: null,
    beatType: null,
    fifths: null,
    microsecondsPerQuarter: null,
    name: null,
  };
  // Keyed by channel and pitch: the same pitch on two channels is two notes.
  const open = new Map<number, OpenNote>();
  let at = 0;
  let status = 0;

  const closeNote = (key: number, atTicks: number): void => {
    const started = open.get(key);
    if (started === undefined) {
      return;
    }
    open.delete(key);
    // A note-off at its own note-on is a note nobody can play; it happens in
    // files written by machines and it would print as a zero-length value.
    if (atTicks > started.startTicks) {
      result.notes.push({
        midi: key % 128,
        startTicks: started.startTicks,
        endTicks: atTicks,
        track: started.track,
        channel: started.channel,
        velocity: started.velocity,
      });
    }
  };

  while (bytes.position < end) {
    at += bytes.variable();
    let head = bytes.byte();
    if ((head & 0x80) === 0) {
      // Running status: this byte is data, and the command is the last one.
      bytes.skip(-1);
      head = status;
    } else if (head < 0xf0) {
      status = head;
    }

    if (head === 0xff) {
      const type = bytes.byte();
      const size = bytes.variable();
      const data = bytes.take(size);
      if (type === 0x51 && size === 3) {
        result.microsecondsPerQuarter =
          ((data[0] ?? 0) << 16) | ((data[1] ?? 0) << 8) | (data[2] ?? 0);
      } else if (type === 0x58 && size >= 2) {
        result.beats = data[0] ?? 4;
        result.beatType = 2 ** (data[1] ?? 2);
      } else if (type === 0x59 && size >= 1) {
        // Signed: one byte, two's complement, flats negative.
        const raw = data[0] ?? 0;
        result.fifths = raw > 127 ? raw - 256 : raw;
      } else if ((type === 0x03 || type === 0x01) && result.name === null && size > 0) {
        result.name = decodeText(data);
      }
      continue;
    }

    if (head === 0xf0 || head === 0xf7) {
      bytes.skip(bytes.variable());
      continue;
    }

    const command = head & 0xf0;
    const channel = head & 0x0f;
    switch (command) {
      case 0x80: {
        const midi = bytes.byte();
        bytes.byte();
        closeNote(channel * 128 + midi, at);
        break;
      }
      case 0x90: {
        const midi = bytes.byte();
        const velocity = bytes.byte();
        const key = channel * 128 + midi;
        if (velocity === 0) {
          // A note-on at zero velocity is how most writers say note-off.
          closeNote(key, at);
        } else {
          closeNote(key, at);
          open.set(key, { startTicks: at, velocity: velocity / 127, track, channel });
        }
        break;
      }
      case 0xb0: {
        const controller = bytes.byte();
        const value = bytes.byte();
        if (controller === 64) {
          // Halfway counts as the felt touching, not as still down: see
          // `damperIsDown`. A file written by a keyboard that reports how far
          // the pedal travelled has the middle in it on the way through, in
          // both directions.
          result.pedal.push({ atTicks: at, down: damperIsDown(value / 127) });
        }
        break;
      }
      case 0xa0:
      case 0xe0:
        bytes.byte();
        bytes.byte();
        break;
      case 0xc0:
      case 0xd0:
        bytes.byte();
        break;
      default:
        throw new DomainError(`This MIDI file uses a command we cannot read (0x${head.toString(16)}).`);
    }
  }

  // Anything still sounding at the end of the track is released there rather
  // than dropped: a note-on without its note-off is a note that rings for ever.
  for (const key of [...open.keys()]) {
    closeNote(key, at + 1);
  }
  return result;
}

/**
 * Reads a Standard MIDI File.
 *
 * Pure, and byte-exact: what comes back is what the file says, with no
 * musical judgement applied. Turning performance ticks into notated values is
 * a separate step and a much less certain one, which is exactly why it lives
 * somewhere else.
 */
export function readMidiFile(data: Uint8Array): MidiFileDocument {
  const bytes = new Bytes(data);
  if (bytes.uint32() !== HEADER) {
    throw new DomainError('This is not a MIDI file: it does not begin with a MIDI header.');
  }
  const headerLength = bytes.uint32();
  const format = bytes.uint16();
  bytes.uint16();
  const division = bytes.uint16();
  bytes.skip(headerLength - 6);

  if (format > 2) {
    throw new DomainError(`This MIDI file is of a kind we cannot read (format ${format}).`);
  }
  if ((division & 0x8000) !== 0) {
    // SMPTE division counts frames of wall-clock time rather than fractions
    // of a beat, so there is no musical grid in the file to read at all.
    throw new DomainError('This MIDI file measures time in frames rather than in beats.');
  }
  if (division <= 0) {
    throw new DomainError('This MIDI file does not say how many ticks make a beat.');
  }

  const notes: MidiFileNote[] = [];
  const pedal: MidiFilePedal[] = [];
  let beats: number | null = null;
  let beatType: number | null = null;
  let fifths: number | null = null;
  let microsecondsPerQuarter: number | null = null;
  let title: string | null = null;
  let track = 0;

  while (!bytes.done) {
    const kind = bytes.uint32();
    const length = bytes.uint32();
    if (kind !== TRACK) {
      // An unknown chunk is to be skipped, which the specification says in so
      // many words; a reader that refused would reject valid files.
      bytes.skip(length);
      continue;
    }
    const read = readTrack(bytes, length, track);
    notes.push(...read.notes);
    pedal.push(...read.pedal);
    beats = beats ?? read.beats;
    beatType = beatType ?? read.beatType;
    fifths = fifths ?? read.fifths;
    microsecondsPerQuarter = microsecondsPerQuarter ?? read.microsecondsPerQuarter;
    title = title ?? read.name;
    track += 1;
  }

  if (notes.length === 0) {
    throw new DomainError('This MIDI file holds no notes.');
  }

  return {
    division,
    notes: notes.sort((left, right) => left.startTicks - right.startTicks || left.midi - right.midi),
    pedal: pedal.sort((left, right) => left.atTicks - right.atTicks),
    beats: beats ?? 4,
    beatType: beatType ?? 4,
    fifths: fifths ?? 0,
    tempoBpm:
      microsecondsPerQuarter === null || microsecondsPerQuarter <= 0
        ? DEFAULT_TEMPO_BPM
        : Math.round(60_000_000 / microsecondsPerQuarter),
    title,
  };
}

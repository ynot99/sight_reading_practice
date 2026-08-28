import { DomainError } from '../../shared/errors.js';

/** Turns raw DEFLATE bytes back into what they were. */
export type Inflate = (compressed: Uint8Array) => Promise<Uint8Array>;

export interface ZipEntry {
  readonly name: string;
  /** 0 is stored verbatim, 8 is DEFLATE. Nothing else is in use here. */
  readonly method: number;
  readonly compressedSize: number;
  readonly localHeaderOffset: number;
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_ENTRY = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const STORED = 0;
const DEFLATED = 8;

/** True when these bytes begin a ZIP archive - a `.mxl` always does. */
export function looksZipped(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06)
  );
}

/**
 * Lists what an archive holds, without unpacking any of it.
 *
 * Enough of the format to open a compressed MusicXML file and no more: the
 * central directory at the end names every entry, which is all that is needed
 * to find the score inside and go straight to it.
 */
export function readZipDirectory(bytes: Uint8Array): readonly ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfDirectory(view);
  const count = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);

  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== CENTRAL_ENTRY) {
      break;
    }
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    entries.push({
      name: decodeAscii(bytes, cursor + 46, nameLength),
      method: view.getUint16(cursor + 10, true),
      compressedSize: view.getUint32(cursor + 20, true),
      localHeaderOffset: view.getUint32(cursor + 42, true),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  if (entries.length === 0) {
    throw new DomainError('This archive is empty.');
  }
  return entries;
}

/** Pulls one entry out, inflating it when it was compressed. */
export async function readZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  inflate: Inflate,
): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = entry.localHeaderOffset;
  if (view.getUint32(header, true) !== LOCAL_HEADER) {
    throw new DomainError(`"${entry.name}" is not where the archive says it is.`);
  }
  // The local header repeats the name and may carry different extra fields, so
  // the data offset has to be read from it rather than from the directory.
  const nameLength = view.getUint16(header + 26, true);
  const extraLength = view.getUint16(header + 28, true);
  const start = header + 30 + nameLength + extraLength;
  const data = bytes.subarray(start, start + entry.compressedSize);

  if (entry.method === STORED) {
    return data;
  }
  if (entry.method === DEFLATED) {
    return inflate(data);
  }
  throw new DomainError(`"${entry.name}" is packed in a way this reader does not know.`);
}

function findEndOfDirectory(view: DataView): number {
  // The record is last, but a trailing comment may follow it, so scan back.
  const earliest = Math.max(0, view.byteLength - 0xffff - 22);
  for (let at = view.byteLength - 22; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === END_OF_DIRECTORY) {
      return at;
    }
  }
  throw new DomainError('This file claims to be an archive but has no directory in it.');
}

function decodeAscii(bytes: Uint8Array, start: number, length: number): string {
  let text = '';
  for (let at = start; at < start + length; at += 1) {
    text += String.fromCharCode(bytes[at] ?? 0);
  }
  return text;
}

/**
 * Inflates with the platform's own decompressor.
 *
 * `deflate-raw` because ZIP entries carry bare DEFLATE data with none of the
 * zlib framing around it.
 */
export const platformInflate: Inflate = async (compressed) => {
  const stream = new Blob([compressed as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};
